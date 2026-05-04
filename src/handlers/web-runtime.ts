import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
  ARCHON_PILL_WEB,
  ARCHON_WEB_STATUS_TITLE,
  ARCHON_WEB_TITLE,
  RUNTIME_HEALTH_TIMEOUT_MS,
  RUNTIME_STATUS_LOG_LINES,
} from "../constants";
import { getArchonServerUrl, getArchonWebUrl, resolveArchonEndpointConfig, resolveArchonHome, resolveProjectArchonAssistant } from "../config";
import type { ArchonWebCleanupResult, ArchonWebStartOptions, ArchonWebStartResult, WebHealthStatus } from "../types";
import { emitArchonMessage, shellQuote } from "../helpers";
import { isPidRunning, readLogTail, readPidFile } from "../runtime-util";
import {
  captureRuntimeCleanup,
  cleanupArchonDevProcesses,
  emitRuntimeHelp,
  emitUnknownRuntimeSubcommand,
  getArchonRuntimePaths,
  isRuntimeServerHealthy,
  launchRuntimeDetached,
  renderProgressReport,
  renderRuntimeStartLines,
  renderRuntimeStatus,
  resolveRuntimeHome,
  runRuntimeProgress,
  runRuntimeSingleStepProgress,
  waitForRuntimeStart,
} from "../commands/runtime";
import { ensureCodebaseAssistantBinding, isWebFrontendReachable, parseUiPortFromLog, readArchonWebStatus } from "../commands/runtime-web";

// ─── Process management ──────────────────────

async function cleanupArchonWebDevProcesses(pi: ExtensionAPI, projectCwd: string): Promise<ArchonWebCleanupResult> {
  return cleanupArchonDevProcesses(pi, projectCwd, getArchonRuntimePaths(projectCwd, "web").pidFile, "@archon/web|vite.*web|esbuild.*web");
}

async function startArchonWebDevDetached(pi: ExtensionAPI, projectCwd: string, assistant: string, defaultPort: string): Promise<ArchonWebStartResult> {
  const { logFile, pidFile } = getArchonRuntimePaths(projectCwd, "web");
  const existingPid = readPidFile(pidFile);
  // Check if web frontend is already reachable on its port
  const existingPort = parseUiPortFromLog(logFile, defaultPort);
  if (existingPid && isPidRunning(existingPid) && (await isWebFrontendReachable(projectCwd, existingPort))) {
    return { pid: existingPid, logFile, pidFile, alreadyRunning: true, uiPort: existingPort };
  }
  await cleanupArchonWebDevProcesses(pi, projectCwd);

  const pid = await launchRuntimeDetached(
    pi,
    projectCwd,
    logFile,
    pidFile,
    `env DEFAULT_AI_ASSISTANT=${shellQuote(assistant)} bun run dev:web`
  );
  const readUiPort = () => parseUiPortFromLog(logFile, defaultPort);
  return waitForRuntimeStart({ pid, logFile, pidFile, alreadyRunning: false, uiPort: defaultPort }, {
    isHealthy: async () => isWebFrontendReachable(projectCwd, readUiPort()),
    isPidRunning,
    readLogTail,
    getCurrentResult: async () => ({ pid, logFile, pidFile, alreadyRunning: false, uiPort: readUiPort() }),
    timeoutMessage: "Archon web frontend did not become healthy in time.",
  });
}

export async function stopArchonWebDev(pi: ExtensionAPI, projectCwd: string) {
  const { pidFile } = getArchonRuntimePaths(projectCwd, "web");
  const pid = readPidFile(pidFile);
  const cleanup = await cleanupArchonWebDevProcesses(pi, projectCwd);
  return { stopped: cleanup.remainingPids.length === 0 && (cleanup.matchedPids.length > 0 || Boolean(pid)), pid, pidFile, cleanedPids: cleanup.matchedPids, remainingPids: cleanup.remainingPids };
}

// ─── Markdown builders ──────────────

function renderWebStatus(archonHome: string, projectCwd: string, data: WebHealthStatus, uiPort: string): string {
  return renderRuntimeStatus(
    ARCHON_WEB_STATUS_TITLE,
    [
      { label: "Archon home", value: archonHome },
      { label: "Health check", value: data.isHealthy ? "✅ healthy" : "❌ unhealthy" },
      { label: "Server", value: data.serverHealthy ? "✅ running" : "⚠️ not reachable" },
      { label: "UI endpoint", value: `\`${getArchonWebUrl(projectCwd, uiPort)}\`` },
    ],
    data.logTail
  );
}

/* ─── Step: web stop ──────────────────────────────── */
async function stepStopCleanup(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  return captureRuntimeCleanup(() => stopArchonWebDev(pi, cwd));
}

/* ─── Steps: web start ──────────────────────────────── */
async function stepEnsureBinding(pi: ExtensionAPI, cwd: string, assistant: string): Promise<string[]> {
  const bind = await ensureCodebaseAssistantBinding(pi, cwd, assistant);
  return [`${bind.created ? "created" : bind.updated ? "updated" : "found"} codebase id=${bind.id}`];
}

async function stepCheckServer(projectCwd: string): Promise<string[]> {
  const serverOk = await isRuntimeServerHealthy(getArchonServerUrl, projectCwd, RUNTIME_HEALTH_TIMEOUT_MS);
  if (!serverOk) {
    return [`⚠️ Server not reachable on ${getArchonServerUrl(projectCwd).replace(/^http:\/\//, "")} — consider \`/archon server start\``];
  }
  return [`✅ Server healthy on ${getArchonServerUrl(projectCwd).replace(/^http:\/\//, "")}`];
}

function parseWebStartOptions(projectCwd: string, tokens: string[]): ArchonWebStartOptions {
  let assistant = resolveProjectArchonAssistant(projectCwd) ?? "pi";
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === "--assistant" && tokens[i + 1]) {
      assistant = tokens[++i];
      break;
    }
  }
  return { assistant, open: tokens.includes("--open"), defaultPort: resolveArchonEndpointConfig(projectCwd).webPort };
}

async function stepStartFrontend(pi: ExtensionAPI, cwd: string, assistant: string, defaultPort: string, openFlag?: boolean): Promise<string[]> {
  const startedAt = Date.now();
  const result = await startArchonWebDevDetached(pi, cwd, assistant, defaultPort);
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  return renderRuntimeStartLines(result, elapsed, [
    `UI port: ${result.uiPort}`,
    ...(openFlag ? [`UI link: ${getArchonWebUrl(cwd, result.uiPort)}`] : []),
  ]);
}



// ─── Command handler ──────────────────────

export async function handleArchonWebCommand(pi: ExtensionAPI, webTokens: string[], ctx: ExtensionCommandContext): Promise<void> {
  const projectCwd = ctx.cwd || process.cwd();
  const command = webTokens[0];

  if (!command || ["help", "-h", "--help"].includes(command)) {
    emitRuntimeHelp(pi, "web");
    return;
  }

  // Stop
  if (command === "stop") {
    await runRuntimeSingleStepProgress(pi, ctx, {
      title: ARCHON_PILL_WEB.toLowerCase() + "-stop",
      stepTitle: "cleanup processes",
      step: () => stepStopCleanup(pi, projectCwd),
      maxLines: 4,
      reportTitle: ARCHON_WEB_TITLE,
      reportAction: "stop",
      successLabel: "Archon web dev stopped.",
      errorLabel: "Archon web dev may still be running.",
      statusLine: (r) => r?.ok && !r.lines.some((l) => l.includes("still running")) ? "✅ stopped" : "❌ still running",
    });
    return;
  }

  // Start
  if (command === "start") {
    const { assistant, open: openFlag, defaultPort } = parseWebStartOptions(projectCwd, webTokens);
    await runRuntimeProgress(pi, ctx, {
      title: ARCHON_PILL_WEB.toLowerCase() + "-start",
      steps: () => [
        { title: "check server dependency", run: () => stepCheckServer(projectCwd) },
        { title: "align codebase binding", run: () => stepEnsureBinding(pi, projectCwd, assistant) },
        { title: `launch frontend (assistant=${assistant})`, run: () => stepStartFrontend(pi, projectCwd, assistant, defaultPort, openFlag) },
      ],
      maxLines: 6,
      renderReport: (results, dur) => renderProgressReport(ARCHON_WEB_TITLE, "start", results, dur),
      successLabel: "Archon web frontend started.",
      errorLabel: "Web frontend start failed.",
    });
    return;
  }

  // Status — inline (quick read-only check)
  if (command === "status") {
    const archonHome = resolveRuntimeHome(projectCwd, resolveArchonHome);
    const status = await readArchonWebStatus(
      projectCwd,
      getArchonRuntimePaths(projectCwd, "web").logFile,
      resolveArchonEndpointConfig(projectCwd).webPort,
      RUNTIME_STATUS_LOG_LINES,
      RUNTIME_HEALTH_TIMEOUT_MS
    );
    emitArchonMessage(pi, renderWebStatus(archonHome, projectCwd, status, status.port), { pill: ARCHON_PILL_WEB });
    ctx.ui.notify(status.isHealthy ? "Web frontend healthy." : "Web frontend unhealthy or not running.", status.isHealthy ? "info" : "warning");
    return;
  }

  // Unknown sub-command
  emitUnknownRuntimeSubcommand(pi, ARCHON_WEB_TITLE, "web", command);
}
