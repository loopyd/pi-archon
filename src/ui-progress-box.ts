import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { TuiBase } from "./tui-base";
import type { LiveEventLine, TuiBaseParams } from "./types";
import { contentToText, formatElapsed, normalizeError } from "./helpers";
import { safeCode } from "./output-filter";

// ════════════════════════════════════════════════════════════
// Core types — shared across all modes
// ════════════════════════════════════════════════════════════

export type StepState = "queued" | "running" | "done" | "error";

export interface ProgressStepInfo {
  title: string;
  state: StepState;
  detail?: string;
  durationMs?: number;
}

/** Result returned by step executors */
export interface StepResult {
  title: string;
  ok: boolean;
  lines: string[];
  durationMs: number;
}

/** A parsed streaming message that may carry structured metadata */
export interface StreamMessage extends LiveEventLine {
  timestamp?: number;
}

/** Optional per-line parser for streaming output (e.g., LogEvent.parse) */
export type LineParserFn = (line: string, isErr: boolean) => LiveEventLine;

// ── Pipeline config (multi-step commands) ────────────────

export interface PipelineConfig<TData = unknown> {
  title: string;
  steps: string[] | (() => Array<{ title: string; run: () => Promise<string[]> }>);
  maxLines?: number;
  /** Optional supplementary executor called AFTER step execution for extra data payload */
  executor?: () => Promise<{ results: StepResult[]; data?: TData }>;
  renderReport?: (results: StepResult[], totalDurationMs: number, data?: TData) => string;
  emitLine?: (text: string) => void;
  successLabel?: string;
  errorLabel?: string;
}

// ── Phase runner config (single-phase + optional streaming) ──

export interface PhaseRunnerConfig<TData = unknown> {
  title: string;
  /** Async operation receiving an onLine callback for streaming output. Optional lineParser transforms each raw line into a structured event before display. */
  executor: (onLine?: (line: string, isErr?: boolean) => void) => Promise<{ lines: string[]; data?: TData }>;
  /** Per-line parser applied to every streamed line in TUI mode (e.g., LogEvent.parse). Default passes through unchanged. */
  lineParser?: LineParserFn;
  renderReport?: (lines: StreamMessage[], totalDurationMs: number, data?: TData) => string;
  emitLine?: (text: string) => void;
  successLabel?: string;
  errorLabel?: string;
  maxLines?: number;
}

// ════════════════════════════════════════════════════════════
// ProgressBox — unified terminal component supporting both
// multi-step pipelines AND continuous streaming output.
// ════════════════════════════════════════════════════════════

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class ProgressBox extends TuiBase {
  static run<TData = unknown>(
    pi: ExtensionAPI,
    ctx: ExtensionCommandContext,
    cfg: PipelineConfig<TData>
  ): Promise<{ results: StepResult[]; data?: TData }> {
    return runPipeline(pi, ctx, cfg);
  }

  // ── Mode selection ─────────────────────────────────────
  readonly mode: "steps" | "stream";

  // ── Step mode state ────────────────────────────────────
  readonly steps: ProgressStepInfo[];

  // ── Streaming mode state ───────────────────────────────
  private messages: StreamMessage[] = [];
  private expandedValue = false;
  private errorMessage?: string;
  private currentStep = "";
  private totalEvents = 0;
  private readonly formatLine: LineParserFn;

  // ── Shared UI state ────────────────────────────────────
  private spinnerIndex = 0;
  private ticker?: NodeJS.Timeout;
  readonly startedAt = Date.now();

  constructor(params: ProgressBoxParams) {
    super(params);

    if (params.mode === "stream") {
      this.mode = "stream";
      this.steps = [];
      this.formatLine = params.lineParser ?? ((line, isErr) => ({ text: line, isErr }));
    } else {
      this.mode = "steps";
      this.steps = (params.steps ?? []).map((t) => ({ title: t, state: "queued" as StepState }));
      this.formatLine = (_l, _isErr) => ({ text: "", isErr: false }); /* unused in step mode */
    }

    this.ticker = setInterval(() => {
      const hasActive = this.mode === "steps"
        ? this.steps.some((s) => s.state === "running")
        : true; /* stream always animates while running */
      if (hasActive) {
        this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
        this.invalidate();
        this.tui.requestRender();
      }
    }, 120);
  }

  stop(): void {
    if (this.ticker) clearInterval(this.ticker);
  }

  // ════════════════════════════════════════════════════════
  // Step-mode mutation API
  // ════════════════════════════════════════════════════════

  setRunning(index: number): void {
    if (index < this.steps.length) {
      this.steps[index].state = "running";
      this.invalidate();
      this.tui.requestRender();
    }
  }

  setDone(index: number, detail?: string, durationMs?: number): void {
    if (index < this.steps.length) {
      this.steps[index] = { ...this.steps[index], state: "done", detail, durationMs };
      this.invalidate();
      this.tui.requestRender();
    }
  }

  setError(index: number, detail?: string, durationMs?: number): void {
    if (index < this.steps.length) {
      this.steps[index] = { ...this.steps[index], state: "error", detail, durationMs };
      this.invalidate();
      this.tui.requestRender();
    }
  }

  addStep(title: string): number {
    const info: ProgressStepInfo = { title, state: "queued" };
    this.steps.push(info);
    this.invalidate();
    this.tui.requestRender();
    return this.steps.length - 1;
  }

  get completedCount(): number { return this.steps.filter((s) => s.state === "done").length; }
  get errorCount(): number { return this.steps.filter((s) => s.state === "error").length; }
  get totalCount(): number { return this.steps.length; }
  isAllComplete(): boolean { return this.steps.every((s) => s.state === "done" || s.state === "error"); }

  // ════════════════════════════════════════════════════════
  // Streaming mode API — appendLine feeds raw lines through
  // the registered lineParser before storing/displaying.
  // ════════════════════════════════════════════════════════

  appendLine(line: string, isErr: boolean): void {
    const normalized = line.replace(/\r/g, "").trim();
    if (!normalized) return;

    const event = this.formatLine(normalized, isErr);
    if (!event?.text?.trim()) return;

    this.totalEvents += 1;
    if (event.step) this.currentStep = event.step;

    this.messages.push({ text: event.text, isErr: event.isErr, timestamp: Date.now() });
    this.invalidate();
    this.tui.requestRender();
  }

  toggleExpanded(): void {
    this.expandedValue = !this.expandedValue;
    this.invalidate();
    this.tui.requestRender();
  }

  setStreamError(error: string): void {
    this.errorMessage = error;
    this.invalidate();
    this.tui.requestRender();
  }

  clearMessages(): void {
    this.messages.length = 0;
    this.totalEvents = 0;
    this.currentStep = "";
    this.errorMessage = undefined;
    this.invalidate();
    this.tui.requestRender();
  }

  // ─── Input handling ──────────────────────────────────────

  handleInput(data: string): void {
    // [Esc] cancel for both modes
    if (data === "\u001b" || data === "\x1c") { this.onAbort(); return; }
    // Expand toggle only in stream mode
    if (this.mode === "stream") {
      const expandKey = this.keyHint("app.tools.expand", "ctrl+o");
      if (this.matchesKey(data, "ctrl+o") || this.matchesKey(data, expandKey)) {
        this.toggleExpanded();
      }
    }
  }

  // ─── Render (branch on mode) ─────────────────────────────

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const inner = Math.max(24, width - 2);
    const elapsed = formatElapsed(Math.floor((Date.now() - this.startedAt) / 1000));
    const borderCh = this.theme.fg("border", "");

    const rows: string[] = [];
    rows.push(`${borderCh}┌${"─".repeat(inner)}┐`);

    if (this.mode === "steps") {
      Object.assign(rows, this.renderStepsHeader(inner, elapsed, borderCh));
      Object.assign(rows, this.renderStepsBody(inner, borderCh));
    } else {
      Object.assign(rows, this.renderStreamHeader(inner, elapsed, borderCh));
      Object.assign(rows, this.renderStreamBody(inner, borderCh));
    }

    rows.push(this.mode === "stream"
      ? `│${this.pad(this.theme.fg("dim", `[Esc] cancel · ${this.keyHint("app.tools.expand", "expand")} toggle`), inner)}│`
      : `│${this.pad(this.theme.fg("dim", `[Esc] cancel`), inner)}│`
    );
    rows.push(`${borderCh}└${"─".repeat(inner)}┘`);

    this.cachedWidth = width;
    this.cachedLines = rows;
    return rows;
  }

  private renderStepsHeader(inner: number, elapsed: string, borderCh: string): string[] {
    const progress = `${this.completedCount}/${this.totalCount}`;
    const errBadge = this.errorCount > 0 ? ` · ${this.errorCount} error(s)` : "";
    const headerText = `${this.theme.bold(this.title)} ${this.theme.fg("dim", `${progress}${errBadge} · ${elapsed}`)}`;
    return [
      `│${this.pad(headerText, inner)}│`,
      `${borderCh}├${"─".repeat(inner)}┤`,
    ];
  }

  private renderStepsBody(inner: number, borderCh: string): string[] {
    const visibleSteps = this.steps.slice(-this.maxLines);
    const out: string[] = [];
    for (const step of visibleSteps) {
      let icon = "○ ";
      let colorFn = (t: string) => this.theme.fg("muted", t);
      switch (step.state) {
        case "running":
          icon = this.theme.fg("accent", SPINNER_FRAMES[this.spinnerIndex] ?? "•") + " ";
          break;
        case "done":
          icon = "✓ ";
          colorFn = (t: string) => this.theme.fg("success", t);
          break;
        case "error":
          icon = "✗ ";
          colorFn = (t: string) => this.theme.fg("warning", t);
          break;
      }
      let lineText = `${icon}${step.title}`;
      if (step.detail) lineText += ` — ${step.detail}`;
      if (step.durationMs != null) lineText += ` (${formatElapsed(Math.floor(step.durationMs / 1000))})`;
      out.push(`│${this.pad(colorFn(lineText), inner)}│`);
    }
    const dropped = Math.max(0, this.steps.length - this.maxLines);
    if (dropped > 0) {
      out.push(`│${this.pad(this.theme.fg("dim", `... and ${dropped} more above`), inner)}│`);
    }
    return out;
  }

  private renderStreamHeader(inner: number, elapsed: string, _borderCh: string): string[] {
    const spinner = this.messages.length === 0 && !this.errorMessage
      ? this.theme.fg("accent", SPINNER_FRAMES[this.spinnerIndex]) ?? "•"
      : this.getStateIcon();
    const headerLine = `${spinner} ${this.theme.bold(this.title)} ${this.theme.fg("dim", elapsed)}`;
    const statsLine = `events: ${this.totalEvents} · ${this.currentStep || "starting"}`;
    return [
      `│${this.pad(headerLine, inner)}│`,
      `│${this.pad(this.theme.fg("muted", statsLine), inner)}│`,
    ];
  }

  private renderStreamBody(inner: number, borderCh: string): string[] {
    const out: string[] = [];
    if (this.errorMessage) {
      out.push(`│${this.pad(this.theme.fg("warning", `❌ ${this.errorMessage}`), inner)}│`);
    }
    const visible = this.expandedValue ? this.messages : this.messages.slice(-this.maxLines);
    const lines = visible.length > 0 ? visible : [{ text: "(waiting for output...)", isErr: false }];
    for (const msg of lines) {
      const text = msg.isErr ? this.theme.fg("warning", msg.text) : this.theme.fg("text", msg.text);
      out.push(`│${this.pad(text, inner)}│`);
    }
    return out;
  }

  private getStateIcon(): string {
    if (this.errorMessage) return "❌";
    if (this.messages.length > 0) return "✅";
    return "⏳";
  }
}

// ── ProgressBoxParams — union covering both modes ────────────

export interface StepModeParams extends TuiBaseParams {
  mode?: "steps";
  steps?: string[];
  lineParser?: never;
}

export interface StreamModeParams extends TuiBaseParams {
  mode: "stream";
  steps?: string[];       /* unused but kept for type compat */
  lineParser?: LineParserFn;
}

export type ProgressBoxParams = StepModeParams | StreamModeParams;


// ════════════════════════════════════════════════════════════
// Static factory surfaces — unified entry points for all commands
// ════════════════════════════════════════════════════════════

/** Internal step executor signature used by PipelineConfig.steps() */
type StepExecutor = () => Promise<string[]>;

// ── Multi-step pipeline runner ────────────────────────────────

/** Execute all steps sequentially with per-step lifecycle hooks */
function executeStepsSequential(
  stepDefs: Array<{ title: string; run: StepExecutor }>,
  onStart?: (idx: number) => void,
  onDone?: (idx: number, r: StepResult) => void
): Promise<StepResult[]> {
  return new Promise((resolve) => {
    const results: StepResult[] = [];
    let i = 0;
    const tick = async () => {
      while (i < stepDefs.length) {
        onStart?.(i);
        const def = stepDefs[i];
        const sectionStart = Date.now();
        try {
          const lines = await def.run();
          results.push({ title: def.title, ok: true, lines: lines.length ? lines : ["No action needed."], durationMs: Date.now() - sectionStart });
        } catch (err) {
          results.push({ title: def.title, ok: false, lines: [`❌ ${normalizeError(err)}`], durationMs: Date.now() - sectionStart });
        }
        onDone?.(i, results[i]);
        i++;
      }
      resolve(results);
    };
    void tick();
  });
}

/** Execute a multi-step pipeline via ProgressBox.run() */
async function runPipeline<TData = unknown>(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  cfg: PipelineConfig<TData>
): Promise<{ results: StepResult[]; data?: TData }> {
  const title = cfg.title;
  const maxLines = cfg.maxLines ?? 8;
  const emitLine = cfg.emitLine ?? ((text: string) => {
    pi.sendMessage({ customType: "archon", content: text, display: true });
  });
  const successLabel = cfg.successLabel ?? `${title} complete.`;
  const errorLabel = cfg.errorLabel ?? `${title} finished with errors.`;

  // Resolve steps into executable shape
  let stepDefs: Array<{ title: string; run: StepExecutor }>;
  if (Array.isArray(cfg.steps)) {
    stepDefs = cfg.steps.map((t) => ({ title: t, run: async () => ["No action needed."] }));
  } else {
    stepDefs = [];
  }

  return (async () => {
    if (!Array.isArray(cfg.steps)) {
      const stepFactory = cfg.steps;
      stepDefs = await Promise.resolve().then(() => stepFactory());
    }

    const finish = (results: StepResult[], execData?: TData): { results: StepResult[]; data?: TData } => {
      const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);
      const errorCount = results.filter((r) => !r.ok).length;
      const reportText = cfg.renderReport?.(results, totalDurationMs, execData)
        ?? renderDefaultReport(title, results, totalDurationMs);
      pi.sendMessage({ customType: "archon", content: reportText, display: true });
      ctx.ui.notify(errorCount > 0 ? errorLabel : successLabel, errorCount > 0 ? "warning" : "info");
      return { results, data: execData };
    };

    // ── TUI mode ────────────────────────────────────────
    if (ctx.hasUI && stepDefs.length > 0) {
      const stepTitles = stepDefs.map((s) => s.title);

      interface PipelineOutcome { cancelled: boolean; results?: StepResult[]; }

      const outcome = await ctx.ui.custom<PipelineOutcome>((tui, theme, _kb, done) => {
        let cancelled = false;
        let pendingResults: StepResult[] | undefined;

        const box = new ProgressBox({ tui, theme, title, steps: stepTitles, maxLines, onAbort: () => { cancelled = true; } });

        executeStepsSequential(stepDefs,
          (idx) => box.setRunning(idx),
          (idx, r) => {
            if (r.ok) box.setDone(idx, r.lines[0]?.slice(0, 40), r.durationMs);
            else     box.setError(idx, r.lines[0]?.slice(0, 40), r.durationMs);
          }
        ).then((results) => {
          pendingResults = results;
          if (!cancelled) done({ cancelled: false, results });
        }).catch((err) => {
          if (!cancelled) {
            pendingResults = [{ title: `${title}: pipeline`, ok: false, lines: [normalizeError(err)], durationMs: 0 }];
            done({ cancelled: false, results: pendingResults });
          }
        }).finally(() => box.stop());

        return box;
      });

      const capturedResults = outcome?.results ?? [];
      let capturedData: TData | undefined;
      if (cfg.executor) {
        try { capturedData = (await cfg.executor()).data; } catch {}
      }
      return finish(capturedResults, capturedData);
    }

    // ── CLI-only mode ───────────────────────────────────
    emitLine(`⏳ ${title} starting (${stepDefs.length} step(s))...`);
    const cliResults: StepResult[] = [];

    for (const def of stepDefs) {
      emitLine(`⏳ Running "${def.title}"...`);
      const sectionStart = Date.now();
      try {
        const lines = await def.run();
        cliResults.push({ title: def.title, ok: true, lines: lines.length ? lines : ["No action needed."], durationMs: Date.now() - sectionStart });
        const summary = lines.find((l) => l !== "No action needed.");
        emitLine(summary ? `✅ ${def.title}${summary.startsWith("❌") || summary.startsWith("error") ? `` : ` — ${safeCode(lines.join("; "))}`}` : `✅ ${def.title}`);
      } catch (err) {
        const msg = normalizeError(err);
        cliResults.push({ title: def.title, ok: false, lines: [`❌ ${msg}`], durationMs: Date.now() - sectionStart });
        emitLine(`❌ ${def.title}: ${safeCode(msg)}`);
      }
    }

    let execData: TData | undefined;
    if (cfg.executor) {
      try { execData = (await cfg.executor()).data; } catch {}
    }

    const totalDurationMs = cliResults.reduce((s, r) => s + r.durationMs, 0);
    pi.sendMessage({ customType: "archon", content: cfg.renderReport?.(cliResults, totalDurationMs, execData) ?? renderDefaultReport(title, cliResults, totalDurationMs), display: true });
    ctx.ui.notify(cliResults.some((r) => !r.ok) ? errorLabel : successLabel, cliResults.some((r) => !r.ok) ? "warning" : "info");
    return { results: cliResults, data: execData };
  })().catch((error) => {
    const message = normalizeError(error);
    emitLine(`## Archon ${title}\n\n- **Result:** ❌ failed — ${safeCode(message)}\n`);
    ctx.ui.notify(`${title} failed: ${message}`, "error");
    return { results: [{ title: `${title}: pipeline`, ok: false, lines: [message], durationMs: 0 }] };
  });
};

// ── Single-phase streaming runner ────────────────────────────────

/** Run a single-phase async operation with live feedback (workflow executors etc.) */
export async function runPhase<TData = unknown>(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  cfg: PhaseRunnerConfig<TData>
): Promise<{ messages: StreamMessage[]; data?: TData }> {
  const title = cfg.title;
  const maxLines = cfg.maxLines ?? 6;
  const emitLine = cfg.emitLine ?? ((text: string) => {
    pi.sendMessage({ customType: "archon", content: text, display: true });
  });
  const successLabel = cfg.successLabel ?? `${title} complete.`;
  const errorLabel = cfg.errorLabel ?? `${title} finished with errors.`;
  const lineParser: LineParserFn = cfg.lineParser ?? ((line, isErr) => ({ text: line, isErr }));

  // ── TUI mode ────────────────────────────────────────
  if (ctx.hasUI) {
    const startedAt = Date.now();

    interface PhaseOutcome { cancelled: boolean; messages?: StreamMessage[]; }

    const outcome = await ctx.ui.custom<PhaseOutcome>((tui, theme, _kb, done) => {
      let cancelled = false;
      let pendingMessages: StreamMessage[] | undefined;

      const box = new ProgressBox({ tui, theme, title, mode: "stream", lineParser, maxLines, onAbort: () => { cancelled = true; } });

      const accumulated: StreamMessage[] = [];
      cfg.executor((rawLine, isErr) => {
        const event = lineParser(rawLine, Boolean(isErr));
        const msg: StreamMessage = { text: event.text || rawLine, isErr: event.isErr ?? Boolean(isErr), timestamp: Date.now() };
        if (event.step) msg.step = event.step;
        accumulated.push(msg);
        box.appendLine(rawLine, Boolean(isErr));
      }).then(({ lines }) => {
        pendingMessages = lines.length > 0 ? lines.map((l) => {
          const ev = lineParser(l, false);
          return { text: ev.text || l, isErr: ev.isErr, timestamp: Date.now(), ...(ev.step && { step: ev.step }) };
        }) : accumulated;
        if (!cancelled) done({ cancelled: false, messages: pendingMessages });
      }).catch((err) => {
        pendingMessages = [{ text: `❌ ${normalizeError(err)}`, isErr: true, timestamp: Date.now() }];
        box.setStreamError(normalizeError(err).slice(0, 60));
        if (!cancelled) done({ cancelled: false, messages: pendingMessages });
      }).finally(() => box.stop());

      return box;
    });

    const capturedMessages = outcome?.messages ?? [];
    const totalDurationMs = Date.now() - startedAt;
    pi.sendMessage({ customType: "archon", content: cfg.renderReport?.(capturedMessages, totalDurationMs, /* istanbul ignore next */ (cfg.executor as any).__data) ?? renderDefaultPhaseReport(title, startedAt), display: true });
    const hasErrors = capturedMessages.some((m) => m.isErr);
    ctx.ui.notify(hasErrors ? errorLabel : successLabel, hasErrors ? "warning" : "info");
    return { messages: capturedMessages, data: /* istanbul ignore next */ (cfg.executor as any).__data };
  }

  // ── CLI-only mode ───────────────────────────────────
  return (async () => {
    try {
      emitLine(`⏳ ${title} starting...`);
      const startedAt = Date.now();
      const cliAccumulated: StreamMessage[] = [];
      const result = await cfg.executor((line, isErr) => {
        const ev = lineParser(line, Boolean(isErr));
        const msg: StreamMessage = { text: ev.text || line, isErr: ev.isErr ?? Boolean(isErr), timestamp: Date.now() };
        if (ev.step) msg.step = ev.step;
        cliAccumulated.push(msg);
        emitLine(ev.text || line);
      });
      const allMsgs = result.lines.length > 0 ? result.lines.map((l, i) => {
        const ev = lineParser(l, false);
        return { text: ev.text || l, isErr: ev.isErr, timestamp: Date.now(), ...(ev.step && { step: ev.step }) };
      }) : cliAccumulated;
      const totalDurationMs = Date.now() - startedAt;
      pi.sendMessage({ customType: "archon", content: cfg.renderReport?.(allMsgs, totalDurationMs, /* istanbul ignore next */ result.data) ?? renderDefaultPhaseReport(title, startedAt), display: true });
      const hasErrors = allMsgs.some((m) => m.isErr);
      ctx.ui.notify(hasErrors ? errorLabel : successLabel, hasErrors ? "warning" : "info");
      return { messages: allMsgs, data: /* istanbul ignore next */ result.data };
    } catch (error) {
      const message = normalizeError(error);
      emitLine(`## Archon ${title}\n\n- **Result:** ❌ failed — ${safeCode(message)}\n`);
      ctx.ui.notify(`${title} failed: ${message}`, "error");
      return { messages: [{ text: `❌ ${message}`, isErr: true }] };
    }
  })();
};


// ════════════════════════════════════════════════════════════
// Default report renderers
// ════════════════════════════════════════════════════════════

function renderDefaultReport(title: string, results: StepResult[], totalDurationMs: number): string {
  let md = `## Archon ${title}\n\n`;
  md += `- **Duration:** \`${formatElapsed(Math.floor(totalDurationMs / 1000))}\`\n`;
  md += `- **Total sections:** ${results.length}\n`;
  const errors = results.filter((r) => !r.ok).length;
  if (errors) md += `- **Errors:** ${errors}\n`;
  md += `\n---\n\n`;
  for (const r of results) {
    md += `### ${r.title}\n\n${r.lines.map((l) => `- ${l}`).join("\n")}\n`;
    md += `- **Section time:** \`${formatElapsed(Math.floor(r.durationMs / 1000))}\`\n\n---\n\n`;
  }
  return md;
}

function renderDefaultPhaseReport(_title: string, _startedAt: number): string {
  return "## Phase complete\n"; /* callers should provide their own renderReport */
}

// ════════════════════════════════════════════════════════════
// Static public API
// ════════════════════════════════════════════════════════════



