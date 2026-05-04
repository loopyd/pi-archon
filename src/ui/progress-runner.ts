import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { emitArchonMessage, formatElapsed, normalizeError } from "../helpers";
import { safeCode } from "../output-filter";
import { ProgressBox } from "./progress-box";
import type { LineParserFn, PhaseRunnerConfig, PipelineConfig, PipelineStep, StepResult, StreamMessage } from "../types";

function defaultEmit(pi: ExtensionAPI): (text: string) => void {
  return (text: string) => emitArchonMessage(pi, text);
}

function defaultPill(title: string): string {
  return title.split(/[\s-]+/, 1)[0] ?? title;
}

function renderDefaultReport(title: string, results: StepResult[], totalDurationMs: number): string {
  let md = `## Archon ${title}\n\n`;
  md += `- **Duration:** \`${formatElapsed(Math.floor(totalDurationMs / 1000))}\`\n`;
  md += `- **Total sections:** ${results.length}\n`;
  const errors = results.filter((r) => !r.ok).length;
  if (errors) md += `- **Errors:** ${errors}\n`;
  md += `\n---\n\n`;
  for (const r of results) {
    md += `### ${r.title}\n\n${r.lines.map((line) => `- ${line}`).join("\n")}\n`;
    md += `- **Section time:** \`${formatElapsed(Math.floor(r.durationMs / 1000))}\`\n\n---\n\n`;
  }
  return md;
}

function renderDefaultPhaseReport(): string {
  return "## Phase complete\n";
}

function executeStepsSequential(
  stepDefs: PipelineStep[],
  onStart?: (idx: number) => void,
  onDone?: (idx: number, result: StepResult) => void
): Promise<StepResult[]> {
  return new Promise((resolve) => {
    const results: StepResult[] = [];
    let index = 0;
    const tick = async () => {
      while (index < stepDefs.length) {
        onStart?.(index);
        const step = stepDefs[index];
        const sectionStart = Date.now();
        try {
          const lines = await step.run();
          results.push({ title: step.title, ok: true, lines: lines.length > 0 ? lines : ["No action needed."], durationMs: Date.now() - sectionStart });
        } catch (err) {
          results.push({ title: step.title, ok: false, lines: [`❌ ${normalizeError(err)}`], durationMs: Date.now() - sectionStart });
        }
        onDone?.(index, results[index]);
        index += 1;
      }
      resolve(results);
    };
    void tick();
  });
}

export async function runPipeline<TData = unknown>(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  cfg: PipelineConfig<TData>
): Promise<{ results: StepResult[]; data?: TData }> {
  const title = cfg.title;
  const maxLines = cfg.maxLines ?? 8;
  const emitLine = cfg.emitLine ?? defaultEmit(pi);
  const successLabel = cfg.successLabel ?? `${title} complete.`;
  const errorLabel = cfg.errorLabel ?? `${title} finished with errors.`;
  const stepDefs: PipelineStep[] = Array.isArray(cfg.steps)
    ? cfg.steps.map((stepTitle) => ({ title: stepTitle, run: async () => ["No action needed."] }))
    : await Promise.resolve().then(() => (cfg.steps as () => PipelineStep[])());

  const finish = (results: StepResult[], execData?: TData): { results: StepResult[]; data?: TData } => {
    const totalDurationMs = results.reduce((sum, result) => sum + result.durationMs, 0);
    const errorCount = results.filter((result) => !result.ok).length;
    pi.sendMessage({
      customType: "archon",
      content: cfg.renderReport?.(results, totalDurationMs, execData) ?? renderDefaultReport(title, results, totalDurationMs),
      display: true,
    });
    ctx.ui.notify(errorCount > 0 ? errorLabel : successLabel, errorCount > 0 ? "warning" : "info");
    return { results, data: execData };
  };

  if (ctx.hasUI && stepDefs.length > 0) {
    interface PipelineOutcome { cancelled: boolean; results?: StepResult[]; }
    const outcome = await ctx.ui.custom<PipelineOutcome>((tui, theme, _kb, done) => {
      let cancelled = false;
      let finished = false;
      let pendingResults: StepResult[] | undefined;
      const box = new ProgressBox({
        tui,
        theme,
        title,
        pill: defaultPill(title),
        steps: stepDefs.map((step) => step.title),
        maxLines,
        onAbort: () => {
          cancelled = true;
          if (finished) return;
          finished = true;
          box.stop();
          done({ cancelled: true, results: pendingResults });
        },
      });

      executeStepsSequential(
        stepDefs,
        (idx) => box.setRunning(idx),
        (idx, result) => result.ok
          ? box.setDone(idx, result.lines[0]?.slice(0, 40), result.durationMs)
          : box.setError(idx, result.lines[0]?.slice(0, 40), result.durationMs),
      ).then((results) => {
        pendingResults = results;
        if (cancelled || finished) return;
        finished = true;
        box.stop();
        done({ cancelled: false, results });
      }).catch((err) => {
        pendingResults = [{ title: `${title}: pipeline`, ok: false, lines: [normalizeError(err)], durationMs: 0 }];
        if (cancelled || finished) return;
        finished = true;
        box.stop();
        done({ cancelled: false, results: pendingResults });
      });

      return box;
    });

    if (outcome?.cancelled) {
      ctx.ui.notify(`${title} cancelled.`, "warning");
      return { results: outcome.results ?? [] };
    }

    let capturedData: TData | undefined;
    if (cfg.executor) {
      try { capturedData = (await cfg.executor()).data; } catch {}
    }
    return finish(outcome?.results ?? [], capturedData);
  }

  emitLine(`⏳ ${title} starting (${stepDefs.length} step(s))...`);
  const cliResults: StepResult[] = [];
  for (const step of stepDefs) {
    emitLine(`⏳ Running "${step.title}"...`);
    const sectionStart = Date.now();
    try {
      const lines = await step.run();
      cliResults.push({ title: step.title, ok: true, lines: lines.length > 0 ? lines : ["No action needed."], durationMs: Date.now() - sectionStart });
      const summary = lines.find((line) => line !== "No action needed.");
      emitLine(summary ? `✅ ${step.title}${summary.startsWith("❌") || summary.startsWith("error") ? "" : ` — ${safeCode(lines.join("; "))}`}` : `✅ ${step.title}`);
    } catch (err) {
      const msg = normalizeError(err);
      cliResults.push({ title: step.title, ok: false, lines: [`❌ ${msg}`], durationMs: Date.now() - sectionStart });
      emitLine(`❌ ${step.title}: ${safeCode(msg)}`);
    }
  }

  let execData: TData | undefined;
  if (cfg.executor) {
    try { execData = (await cfg.executor()).data; } catch {}
  }
  return finish(cliResults, execData);
}

export async function runPhase<TData = unknown>(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  cfg: PhaseRunnerConfig<TData>
): Promise<{ messages: StreamMessage[]; data?: TData }> {
  const title = cfg.title;
  const maxLines = cfg.maxLines ?? 6;
  const emitLine = cfg.emitLine ?? defaultEmit(pi);
  const successLabel = cfg.successLabel ?? `${title} complete.`;
  const errorLabel = cfg.errorLabel ?? `${title} finished with errors.`;
  const lineParser: LineParserFn = cfg.lineParser ?? ((line, isErr) => ({ text: line, isErr }));

  if (ctx.hasUI) {
    const startedAt = Date.now();
    interface PhaseOutcome { cancelled: boolean; messages?: StreamMessage[]; data?: TData; }
    const outcome = await ctx.ui.custom<PhaseOutcome>((tui, theme, _kb, done) => {
      let cancelled = false;
      let finished = false;
      let pendingMessages: StreamMessage[] | undefined;
      let pendingData: TData | undefined;
      const box = new ProgressBox({
        tui,
        theme,
        title,
        pill: defaultPill(title),
        mode: "stream",
        lineParser,
        maxLines,
        onAbort: () => {
          cancelled = true;
          if (finished) return;
          finished = true;
          box.stop();
          done({ cancelled: true, messages: pendingMessages, data: pendingData });
        },
      });

      const accumulated: StreamMessage[] = [];
      cfg.executor((rawLine, isErr) => {
        const event = lineParser(rawLine, Boolean(isErr));
        const message: StreamMessage = { text: event.text || rawLine, isErr: event.isErr ?? Boolean(isErr), timestamp: Date.now() };
        if (event.step) message.step = event.step;
        accumulated.push(message);
        box.appendLine(rawLine, Boolean(isErr));
      }).then(({ lines, data }) => {
        pendingData = data;
        pendingMessages = lines.length > 0
          ? lines.map((line) => {
            const event = lineParser(line, false);
            return { text: event.text || line, isErr: event.isErr, timestamp: Date.now(), ...(event.step && { step: event.step }) };
          })
          : accumulated;
        if (cancelled || finished) return;
        finished = true;
        box.stop();
        done({ cancelled: false, messages: pendingMessages, data: pendingData });
      }).catch((err) => {
        pendingMessages = [{ text: `❌ ${normalizeError(err)}`, isErr: true, timestamp: Date.now() }];
        box.setStreamError(normalizeError(err).slice(0, 60));
        if (cancelled || finished) return;
        finished = true;
        box.stop();
        done({ cancelled: false, messages: pendingMessages, data: pendingData });
      });

      return box;
    });

    if (outcome?.cancelled) {
      ctx.ui.notify(`${title} cancelled.`, "warning");
      return { messages: outcome.messages ?? [], data: outcome.data };
    }

    const capturedMessages = outcome?.messages ?? [];
    const totalDurationMs = Date.now() - startedAt;
    pi.sendMessage({ customType: "archon", content: cfg.renderReport?.(capturedMessages, totalDurationMs, outcome?.data) ?? renderDefaultPhaseReport(), display: true });
    const hasErrors = capturedMessages.some((message) => message.isErr);
    ctx.ui.notify(hasErrors ? errorLabel : successLabel, hasErrors ? "warning" : "info");
    return { messages: capturedMessages, data: outcome?.data };
  }

  try {
    emitLine(`⏳ ${title} starting...`);
    const startedAt = Date.now();
    const cliAccumulated: StreamMessage[] = [];
    const result = await cfg.executor((line, isErr) => {
      const event = lineParser(line, Boolean(isErr));
      const message: StreamMessage = { text: event.text || line, isErr: event.isErr ?? Boolean(isErr), timestamp: Date.now() };
      if (event.step) message.step = event.step;
      cliAccumulated.push(message);
      emitLine(event.text || line);
    });
    const allMessages = result.lines.length > 0
      ? result.lines.map((line) => {
        const event = lineParser(line, false);
        return { text: event.text || line, isErr: event.isErr, timestamp: Date.now(), ...(event.step && { step: event.step }) };
      })
      : cliAccumulated;
    const totalDurationMs = Date.now() - startedAt;
    pi.sendMessage({ customType: "archon", content: cfg.renderReport?.(allMessages, totalDurationMs, result.data) ?? renderDefaultPhaseReport(), display: true });
    const hasErrors = allMessages.some((message) => message.isErr);
    ctx.ui.notify(hasErrors ? errorLabel : successLabel, hasErrors ? "warning" : "info");
    return { messages: allMessages, data: result.data };
  } catch (error) {
    const message = normalizeError(error);
    emitLine(`## Archon ${title}\n\n- **Result:** ❌ failed — ${safeCode(message)}\n`);
    ctx.ui.notify(`${title} failed: ${message}`, "error");
    return { messages: [{ text: `❌ ${message}`, isErr: true }] };
  }
}
