import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DEFAULT_QUERY, PROGRESS_UPDATE_MS } from "./constants";
import type { ArchonRunResult, CommandWorkflowOutcome, WorkflowName } from "./types";
import { createMessageEmitter, formatElapsed, normalizeError, normalizeString } from "./helpers";
import { redactSecrets, safeCode, LogEvent } from "./output-filter";
import { ProgressBox } from "./ui-progress-box";
import { runArchonCommand, runArchonCommandStreaming, formatArchonOutput, formatArchonToolResult } from "./archon-exec";

const emitPlan = createMessageEmitter("plannator");

// ─── Error output formatting ──────────────────────────────

export function formatCommandErrorOutput(workflow: WorkflowName, query: string, error: string): string {
  return `## Plannator ${workflow.toUpperCase()} — ${redactSecrets(query)}\n\n- **Result:** ❌ failed before completion\n\n\`\`\`text\n${safeCode(error)}\n\`\`\`\n`;
}

// ─── Direct workflow execution ──────────────────────────────

async function runArchonWorkflow(
  pi: ExtensionAPI,
  workflow: WorkflowName,
  query: string,
  projectCwd: string,
  signal?: AbortSignal
): Promise<ArchonRunResult> {
  return runArchonCommand(pi, ["workflow", "run", workflow, query.trim(), "--no-worktree"], projectCwd, signal);
}

async function runArchonWorkflowStreaming(
  workflow: WorkflowName,
  query: string,
  projectCwd: string,
  signal: AbortSignal | undefined,
  onLine?: (line: string, isErr: boolean) => void
): Promise<ArchonRunResult> {
  return runArchonCommandStreaming(["workflow", "run", workflow, query.trim(), "--no-worktree"], projectCwd, signal, onLine);
}

// ─── Command-context runner with TUI box ──────────────────

async function runWorkflowForCommand(
  pi: ExtensionAPI,
  workflow: WorkflowName,
  query: string,
  ctx: ExtensionCommandContext
): Promise<CommandWorkflowOutcome> {
  const cwd = ctx.cwd || process.cwd();

  if (!ctx.hasUI) {
    const startedAt = Date.now();
    const run = await runArchonWorkflow(pi, workflow, query, cwd);
    return { run, durationMs: Date.now() - startedAt };
  }

  const outcome = await ctx.ui.custom<CommandWorkflowOutcome>((tui, theme, _keybindings, done) => {
    const startedAt = Date.now();
    const controller = new AbortController();
    let finished = false;

    const box = new ProgressBox({
      mode: "stream", tui, theme, title: `plannator ${workflow}`,
      onAbort: () => { controller.abort(); finish({ cancelled: true, durationMs: Date.now() - startedAt }); },
      maxLines: 6,
      lineParser: (line: string, isErr: boolean) => LogEvent.parse(redactSecrets(line), isErr),
    });

    const finish = (value: CommandWorkflowOutcome) => {
      if (finished) return;
      finished = true;
      box.stop();
      done(value);
    };

    runArchonWorkflowStreaming(workflow, query, cwd, controller.signal, (line, isErr) => box.appendLine(line, isErr))
      .then((run) => {
        if (controller.signal.aborted) return;
        if (run.exitCode !== 0) box.setStreamError(`exit code ${run.exitCode}`);
        finish({ run, durationMs: Date.now() - startedAt });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        box.setStreamError(normalizeError(error));
        finish({ error: normalizeError(error), durationMs: Date.now() - startedAt });
      });

    return box;
  });

  return outcome ?? { cancelled: true };
}

// ─── Tool-update-wrapped runner ──────────────────────────────

export async function runWorkflowWithToolUpdates(
  pi: ExtensionAPI,
  workflow: WorkflowName,
  query: string,
  cwd: string,
  signal: AbortSignal | undefined,
  onUpdate?: (update: any) => void
): Promise<{ run: ArchonRunResult; durationMs: number }> {
  const startedAt = Date.now();
  const preview = query.length > 72 ? `${query.slice(0, 72)}...` : query;

  const pushUpdate = (phase: "start" | "running" | "done", text: string, extra?: Record<string, unknown>) => {
    onUpdate?.({ content: [{ type: "text", text }], details: { phase, workflow, queryPreview: preview, elapsedSec: Math.floor((Date.now() - startedAt) / 1000), ...extra } });
  };

  pushUpdate("start", `Starting Archon workflow '${workflow}'...`);
  const interval = setInterval(() => {
    pushUpdate("running", `Archon '${workflow}' running (${formatElapsed(Math.floor((Date.now() - startedAt) / 1000))})...`);
  }, PROGRESS_UPDATE_MS);

  try {
    const run = await runArchonWorkflow(pi, workflow, query, cwd, signal);
    const durationMs = Date.now() - startedAt;
    pushUpdate("done", run.exitCode === 0
      ? `Archon '${workflow}' finished in ${formatElapsed(Math.floor(durationMs / 1000))}.`
      : `Archon '${workflow}' failed (exit ${run.exitCode}) after ${formatElapsed(Math.floor(durationMs / 1000))}.`,
      { exitCode: run.exitCode, durationMs });
    return { run, durationMs };
  } finally { clearInterval(interval); }
}

// ─── CLI command handler for plannator workflows ──────────

export async function handleWorkflowCommand(
  pi: ExtensionAPI,
  workflow: WorkflowName,
  args: string,
  ctx: ExtensionCommandContext
): Promise<void> {
  const query = normalizeString(args) || DEFAULT_QUERY;

  try {
    const outcome = await runWorkflowForCommand(pi, workflow, query, ctx);

    if (outcome.cancelled) {
      emitPlan(pi, `## Plannator ${workflow.toUpperCase()} — ${redactSecrets(query)}\n\n- **Result:** ⚠️ cancelled by user\n`, { workflow, query, cancelled: true, durationMs: outcome.durationMs });
      ctx.ui.notify(`Plannator ${workflow} cancelled.`, "warning");
      return;
    }

    if (!outcome.run) throw new Error(outcome.error || "Workflow did not return a result.");

    // Strip archon's own log lines from emitted output (they leak via sendMessage during execution)
    const cleaned = formatArchonOutput(`${workflow.toUpperCase()} — ${redactSecrets(query)}`, outcome.run, outcome.durationMs)
      .split('\n')
      .filter(l => !/^\[(?:INF|WRN)\] /m.test(l))
      .join('\n');
    emitPlan(pi, cleaned, {
      workflow, query, exitCode: outcome.run.exitCode, command: outcome.run.command, durationMs: outcome.durationMs,
    });

    ctx.ui.notify(outcome.run.exitCode === 0 ? `Plannator ${workflow} finished.` : `Plannator ${workflow} failed (exit ${outcome.run.exitCode}).`, outcome.run.exitCode === 0 ? "info" : "warning");
  } catch (error) {
    const message = normalizeError(error);
    emitPlan(pi, formatCommandErrorOutput(workflow, query, message), { workflow, query, error: message });
    ctx.ui.notify(`Plannator ${workflow} failed: ${message}`, "error");
  }
}
