import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
  ARCHON_PILL_SERVER,
  ARCHON_SERVER_STATUS_TITLE,
  ARCHON_SERVER_TITLE,
  RUNTIME_HEALTH_TIMEOUT_MS,
  RUNTIME_STATUS_LOG_LINES,
} from "../constants";
import { getArchonServerUrl, resolveArchonHome } from "../config";
import { emitArchonMessage } from "../helpers";
import { isPidRunning, readLogTail, readPidFile } from "../runtime-util";
import type { ArchonRuntimeStartResult, RuntimeHealthStatus } from "../types";
import {
  captureRuntimeCleanup,
  cleanupArchonDevProcesses,
  emitRuntimeHelp,
  emitUnknownRuntimeSubcommand,
  getArchonRuntimePaths,
  isRuntimeServerHealthy,
  launchRuntimeDetached,
  renderRuntimeStartLines,
  renderRuntimeStatus,
  resolveRuntimeHome,
  runRuntimeSingleStepProgress,
  waitForRuntimeStart,
} from "../commands/runtime";

// ─── Process management ──────────────────────




// ─── Process management ──────────────────────

async function cleanupArchonServerProcesses(pi: ExtensionAPI, projectCwd: string) {
  return cleanupArchonDevProcesses(pi, projectCwd, getArchonRuntimePaths(projectCwd, "server").pidFile, "@archon/server|bun.*src/index\\.ts");
}

async function startArchonServerDetached(pi: ExtensionAPI, projectCwd: string): Promise<ArchonRuntimeStartResult> {
  const { logFile, pidFile } = getArchonRuntimePaths(projectCwd, "server");
  const existingPid = readPidFile(pidFile);
  if (existingPid && isPidRunning(existingPid) && (await isRuntimeServerHealthy(getArchonServerUrl, projectCwd, RUNTIME_HEALTH_TIMEOUT_MS))) {
    return { pid: existingPid, logFile, pidFile, alreadyRunning: true };
  }
  await cleanupArchonServerProcesses(pi, projectCwd);

  const pid = await launchRuntimeDetached(pi, projectCwd, logFile, pidFile, "bun run dev:server");
  return waitForRuntimeStart({ pid, logFile, pidFile, alreadyRunning: false }, {
    isHealthy: () => isRuntimeServerHealthy(getArchonServerUrl, projectCwd, RUNTIME_HEALTH_TIMEOUT_MS),
    isPidRunning,
    readLogTail,
    timeoutMessage: "Archon server did not become healthy in time.",
  });
}

export async function stopArchonServer(pi: ExtensionAPI, projectCwd: string) {
  const { pidFile } = getArchonRuntimePaths(projectCwd, "server");
  const pid = readPidFile(pidFile);
  const cleanup = await cleanupArchonServerProcesses(pi, projectCwd);
  return { stopped: cleanup.remainingPids.length === 0 && (cleanup.matchedPids.length > 0 || Boolean(pid)), pid, pidFile, cleanedPids: cleanup.matchedPids, remainingPids: cleanup.remainingPids };
}

// ─── Markdown builders ──────────────

function renderServerStatus(archonHome: string, projectCwd: string, data: RuntimeHealthStatus): string {
  return renderRuntimeStatus(
    ARCHON_SERVER_STATUS_TITLE,
    [
      { label: "Archon home", value: archonHome },
      { label: "Health check", value: data.isHealthy ? "✅ healthy" : "❌ unhealthy" },
      { label: "API endpoint", value: `\`${getArchonServerUrl(projectCwd)}\`` },
    ],
    data.logTail
  );
}

async function stepStopCleanup(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  return captureRuntimeCleanup(() => stopArchonServer(pi, cwd));
}

async function stepStartServer(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  const startedAt = Date.now();
  const result = await startArchonServerDetached(pi, cwd);
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  return renderRuntimeStartLines(result, elapsed);
}

// ─── Command handler ──────────────────────

export async function handleArchonServerCommand(pi: ExtensionAPI, tokens: string[], ctx: ExtensionCommandContext): Promise<void> {
  const projectCwd = ctx.cwd || process.cwd();
  const command = tokens[0];

  if (!command || ["help", "-h", "--help"].includes(command)) {
    emitRuntimeHelp(pi, "server");
    return;
  }

  // Stop
  if (command === "stop") {
    await runRuntimeSingleStepProgress(pi, ctx, {
      title: "server-stop",
      stepTitle: "cleanup processes",
      step: () => stepStopCleanup(pi, projectCwd),
      maxLines: 4,
      reportTitle: ARCHON_SERVER_TITLE,
      reportAction: "stop",
      successLabel: "Archon server stopped.",
      errorLabel: "Archon server may still be running.",
      statusLine: (r) => r?.ok && !r.lines.some((l) => l.includes("still running")) ? "✅ stopped" : "❌ still running",
    });
    return;
  }

  // Start
  if (command === "start") {
    await runRuntimeSingleStepProgress(pi, ctx, {
      title: "server-start",
      stepTitle: "launch server",
      step: () => stepStartServer(pi, projectCwd),
      maxLines: 5,
      reportTitle: ARCHON_SERVER_TITLE,
      reportAction: "start",
      successLabel: "Archon server started.",
      errorLabel: "Server start failed.",
    });
    return;
  }

  // Status — inline (quick read-only check)
  if (command === "status") {
    const archonHome = resolveRuntimeHome(projectCwd, resolveArchonHome);
    const isHealthy = await isRuntimeServerHealthy(getArchonServerUrl, projectCwd, RUNTIME_HEALTH_TIMEOUT_MS);
    const logTail = readLogTail(getArchonRuntimePaths(projectCwd, "server").logFile, RUNTIME_STATUS_LOG_LINES);
    emitArchonMessage(pi, renderServerStatus(archonHome, projectCwd, { isHealthy, logTail }), { pill: ARCHON_PILL_SERVER });
    ctx.ui.notify(isHealthy ? "Server healthy." : "Server unhealthy or not running.", isHealthy ? "info" : "warning");
    return;
  }

  // Unknown sub-command
  emitUnknownRuntimeSubcommand(pi, ARCHON_SERVER_TITLE, "server", command);
}
