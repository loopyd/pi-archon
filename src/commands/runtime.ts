import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { emitArchonMessage, toPillLabel, formatElapsed } from "../helpers";
import { safeCode } from "../output-filter";
import { generateHelpForPath } from "../command-tree";
import type { ArchonRuntimeCleanupResult, ArchonRuntimeStartResult, RuntimeStatusSection, StepResult, PipelineStep } from "../types";
import { runPipeline } from "../ui/progress-runner";
export { cleanupArchonDevProcesses, isRuntimeServerHealthy, launchRuntimeDetached, waitForRuntimeStart } from "./runtime-process";

export function getArchonRuntimePaths(projectCwd: string, name: "server" | "web") {
  return {
    logFile: `${projectCwd}/tmp/archon-${name}-dev.log`,
    pidFile: `${projectCwd}/tmp/archon-${name}-dev.pid`,
  };
}

export function resolveRuntimeHome(projectCwd: string, resolveArchonHome: (projectCwd?: string) => string): string {
  try {
    return resolveArchonHome(projectCwd);
  } catch (error) {
    return `(resolve failed: ${safeCode(String(error))})`;
  }
}

export function appendRuntimeLogSection(lines: string[], logTail: string): void {
  if (logTail.length <= 0) return;
  const normalizedTail = logTail
    .replace(/```/g, "'''")
    .replace(/``\\`/g, "'''")
    .replace(/\\`\\`\\`/g, "'''");
  lines.push("", "### Recent logs", "");
  lines.push(...normalizedTail.slice(-400).split("\n").map((line) => `    ${line}`));
}

export function renderRuntimeStatus(title: string, sections: RuntimeStatusSection[], logTail: string): string {
  const lines: string[] = [title, "", ...sections.map(({ label, value }) => `- **${label}:** ${value}`)];
  appendRuntimeLogSection(lines, logTail);
  return safeCode(lines.join("\n"));
}

export function renderCleanupLines(result: ArchonRuntimeCleanupResult | { cleanedPids?: string[]; remainingPids?: string[] }): string[] {
  const matchedPids = "matchedPids" in result ? result.matchedPids : result.cleanedPids;
  const lines: string[] = [];
  if (matchedPids?.length) lines.push(`Matched PIDs: ${matchedPids.join(", ")}`);
  else lines.push("No matching processes found");
  if (result.remainingPids?.length) lines.push(`Remaining PIDs: ${result.remainingPids.join(", ")} (still running)`);
  else lines.push("All matched processes terminated");
  return lines;
}

export function renderProgressReport(title: string, action: string, results: StepResult[], durationMs: number, statusLine?: string): string {
  const body = results.flatMap((result) => result.lines.map((line) => `- ${line}`)).join("\n") || "no result";
  return `${title} ${action}\n\n${body}\n\n- **Duration:** \`${formatElapsed(Math.floor(durationMs / 1000))}\`${statusLine ? `\n- **Status:** ${statusLine}` : ""}`;
}

export function emitRuntimeHelp(pi: ExtensionAPI, group: "server" | "web"): void {
  emitArchonMessage(pi, generateHelpForPath([group]));
}

export function emitUnknownRuntimeSubcommand(pi: ExtensionAPI, title: string, group: "server" | "web", command: string): void {
  emitArchonMessage(pi, `${title}\n\n- **Unknown sub-command:** \`${safeCode(command)}\`\n\n${generateHelpForPath([group])}`);
}

export async function runRuntimeProgress(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  options: {
    title: string;
    steps: () => PipelineStep[];
    maxLines: number;
    renderReport: (results: StepResult[], durationMs: number) => string;
    successLabel: string;
    errorLabel: string;
  }
): Promise<void> {
  await runPipeline(pi, ctx, {
    ...options,
    emitLine: (text) => emitArchonMessage(pi, text, { pill: toPillLabel(options.title.split(/[-\s]+/, 1)[0]) }),
  });
}

export async function runRuntimeSingleStepProgress(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  options: {
    title: string;
    stepTitle: string;
    step: () => Promise<string[]>;
    maxLines: number;
    reportTitle: string;
    reportAction: string;
    successLabel: string;
    errorLabel: string;
    statusLine?: (result: StepResult | undefined) => string | undefined;
  }
): Promise<void> {
  await runRuntimeProgress(pi, ctx, {
    title: options.title,
    steps: () => [{ title: options.stepTitle, run: options.step }],
    maxLines: options.maxLines,
    renderReport: (results, durationMs) =>
      renderProgressReport(
        options.reportTitle,
        options.reportAction,
        results,
        durationMs,
        options.statusLine?.(results[0])
      ),
    successLabel: options.successLabel,
    errorLabel: options.errorLabel,
  });
}

export function renderRuntimeStartLines(result: ArchonRuntimeStartResult, elapsedSeconds: number, extraLines: string[] = []): string[] {
  return [
    `PID: ${result.pid}`,
    `Log file: ${result.logFile}`,
    `Already running: ${result.alreadyRunning ? "yes" : "no"}`,
    `Startup time: ${elapsedSeconds}s`,
    ...extraLines,
  ];
}

export async function captureRuntimeCleanup(step: () => Promise<ArchonRuntimeCleanupResult | { cleanedPids?: string[]; remainingPids?: string[] }>): Promise<string[]> {
  try {
    return renderCleanupLines(await step());
  } catch (error) {
    return [`error: ${String(error instanceof Error ? error.message : error)}`];
  }
}

