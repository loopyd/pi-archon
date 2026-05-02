import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import { ARCHON_ROOT } from "./constants";
import { createMessageEmitter, formatElapsed, normalizeError, readPidFile, resolveArchonHome, shellQuote } from "./helpers";
import { ProgressBox } from "./ui-progress-box";
import { safeCode } from "./output-filter";

const emitServer = createMessageEmitter("archon");

// ─── Path helpers ──────────────────────

function getArchonServerPaths(projectCwd: string) {
  return { logFile: `${projectCwd}/tmp/archon-server-dev.log`, pidFile: `${projectCwd}/tmp/archon-server-dev.pid` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readLogTail(logFile: string, maxLines = 60): string {
  if (!fs.existsSync(logFile)) return "";
  return fs.readFileSync(logFile, "utf8").split(/\r?\n/).slice(-maxLines).join("\n").trim();
}

async function isServerHealthy(timeoutMs = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch("http://127.0.0.1:3090/api/health", { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch { return false; }
}

function isPidRunning(pid: string): boolean {
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

// ─── Process management ──────────────────────

async function cleanupArchonServerProcesses(pi: ExtensionAPI, projectCwd: string) {
  const { pidFile } = getArchonServerPaths(projectCwd);
  // Target only @archon/server processes (bun --filter @archon/server ...)
  const script = [
    "set +e", `pidfile=${shellQuote(pidFile)}`, `archon_root=${shellQuote(ARCHON_ROOT)}`,
    "declare -A seen", "add_pid() { local p=\"$1\"; [[ \"$p\" =~ ^[0-9]+$ ]] || return 0; [ \"$p\" -eq $$ ] && return 0; [ \"$p\" -eq $PPID ] && return 0; seen[\"$p\"]=1; }",
    'if [ -f "$pidfile" ]; then add_pid "$(tr -d "\\r\\n " < "$pidfile")"; fi',
    "for pid in $(pgrep -f '@archon/server|bun.*src/index\\.ts' 2>/dev/null); do",
    '  [ "$pid" = "$$" ] && continue',
    '  cmd="$(tr "\\0" " " < "/proc/$pid/cmdline" 2>/dev/null || true)"',
    '  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"',
    '  if [[ "$cmd" == *"$archon_root"* || "$cwd" == "$archon_root"* ]]; then add_pid "$pid"; fi', "done",
    "for pid in ${!seen[@]}; do pgid=\"$(ps -o pgid= -p \"$pid\" 2>/dev/null | tr -d \" \" || true)\";",
    '  kill -TERM "$pid" 2>/dev/null || true',
    '  [[ "$pgid" =~ ^[0-9]+$ ]] && [ "$pgid" -gt 1 ] && kill -TERM -- "-$pgid" 2>/dev/null || true; done',
    "sleep 2", "for pid in ${!seen[@]}; do if kill -0 \"$pid\" 2>/dev/null; then",
    '  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d " " || true)"',
    '  kill -KILL "$pid" 2>/dev/null || true',
    '  [[ "$pgid" =~ ^[0-9]+$ ]] && [ "$pgid" -gt 1 ] && kill -KILL -- "-$pgid" 2>/dev/null || true; fi; done',
    "sleep 1", 'remaining="$(for pid in ${!seen[@]}; do kill -0 "$pid" 2>/dev/null && printf "%s\\n" "$pid"; done | sort -n | xargs 2>/dev/null || true)"',
    'rm -f "$pidfile"', 'printf "MATCHED:%s\\n" "${!seen[*]}"', 'printf "REMAINING:%s\\n" "$remaining"',
  ].join("\n");

  const result = await pi.exec("bash", ["-lc", script], { cwd: projectCwd, timeout: 20000 });
  const lines = `${result.stdout || ""}\n${result.stderr || ""}`.split(/\r?\n/);
  return {
    pidFile,
    matchedPids: (lines.find((l) => l.startsWith("MATCHED:"))?.slice(8).trim() ?? "").split(/\s+/).filter(Boolean),
    remainingPids: (lines.find((l) => l.startsWith("REMAINING:"))?.slice(10).trim() ?? "").split(/\s+/).filter(Boolean),
  };
}

async function startArchonServerDetached(pi: ExtensionAPI, projectCwd: string): Promise<{ pid: string; logFile: string; pidFile: string; alreadyRunning: boolean }> {
  const { logFile, pidFile } = getArchonServerPaths(projectCwd);
  const existingPid = readPidFile(pidFile);
  if (existingPid && isPidRunning(existingPid) && (await isServerHealthy())) {
    return { pid: existingPid, logFile, pidFile, alreadyRunning: true };
  }
  await cleanupArchonServerProcesses(pi, projectCwd);

  // Use bun --filter to run only the server package
  const script = [
    "set -e", `mkdir -p ${shellQuote(`${projectCwd}/tmp`)}`, `: > ${shellQuote(logFile)}`,
    `cd ${shellQuote(ARCHON_ROOT)}`,
    `setsid bun run dev:server > ${shellQuote(logFile)} 2>&1 < /dev/null &`,
    "pid=$!", `echo \"$pid\" > ${shellQuote(pidFile)}`, "echo \"$pid\"",
  ].join("\n");

  const result = await pi.exec("bash", ["-lc", script], { cwd: projectCwd, timeout: 15000 });
  if ((result.code ?? 0) !== 0) throw new Error(result.stderr || result.stdout || "Failed to start Archon server.");
  const pid = (result.stdout ?? "").trim().split(/\s+/).pop() || "unknown";

  for (let i = 0; i < 30; i++) {
    if (await isServerHealthy()) return { pid, logFile, pidFile, alreadyRunning: false };
    const tail = readLogTail(logFile, 80);
    if (/startup_failed|EADDRINUSE|Failed to start/i.test(tail)) throw new Error(tail || "Archon server failed to become healthy.");
    if (!isPidRunning(pid)) throw new Error(tail || "Archon server exited before becoming healthy.");
    await sleep(500);
  }
  throw new Error(readLogTail(logFile, 100) || "Archon server did not become healthy in time.");
}

export async function stopArchonServer(pi: ExtensionAPI, projectCwd: string) {
  const { pidFile } = getArchonServerPaths(projectCwd);
  const pid = readPidFile(pidFile);
  const cleanup = await cleanupArchonServerProcesses(pi, projectCwd);
  return { stopped: cleanup.remainingPids.length === 0 && (cleanup.matchedPids.length > 0 || Boolean(pid)), pid, pidFile, cleanedPids: cleanup.matchedPids, remainingPids: cleanup.remainingPids };
}

// ─── Markdown builders ──────────────

function fmtStatus(archonHome: string, data: { isHealthy: boolean; logTail: string }): string {
  const lines: string[] = [
    "## Archon Server status", "",
    `- **Archon home:** ${archonHome}`,
    `- **Health check:** ${data.isHealthy ? "✅ healthy" : "❌ unhealthy"}`,
    `- **API endpoint:** \`http://localhost:3090\``,
  ];
  if (data.logTail.length > 0) {
    lines.push("", "### Recent logs", "", "```text");
    lines.push(data.logTail.slice(-400));
    lines.push("```");
  }
  return safeCode(lines.join("\n"));
}

const makeStep = (title: string, fn: () => Promise<string[]>) => ({ title, run: fn });

async function stepStopCleanup(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  try {
    const result = await stopArchonServer(pi, cwd);
    const lines: string[] = [];
    if (result.cleanedPids?.length) lines.push(`Matched PIDs: ${result.cleanedPids.join(", ")}`);
    else lines.push("No matching processes found");
    if (result.remainingPids?.length) lines.push(`Remaining PIDs: ${result.remainingPids.join(", ")} (still running)`);
    else lines.push("All matched processes terminated");
    return lines;
  } catch (e) { return [`error: ${normalizeError(e)}`]; }
}

async function stepStartServer(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  const startedAt = Date.now();
  const result = await startArchonServerDetached(pi, cwd);
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  return [
    `PID: ${result.pid}`,
    `Log file: ${result.logFile}`,
    `Already running: ${result.alreadyRunning ? "yes" : "no"}`,
    `Startup time: ${elapsed}s`,
  ];
}

// ─── Command handler ──────────────────────

export async function handleArchonServerCommand(pi: ExtensionAPI, tokens: string[], ctx: ExtensionCommandContext): Promise<void> {
  const projectCwd = ctx.cwd || process.cwd();
  const command = tokens[0];

  if (!command && !tokens.length) {
    emitServer(pi, "## Archon Server\n\n- **Sub-command:** _(none)_ — use `/archon server start|stop|status`");
    return;
  }

  if (!command || ["help", "-h", "--help"].includes(command)) {
    emitServer(pi, ["## Archon server launcher", "", "Manages the @archon/server backend API independently.", "",
      "### Usage", "- /archon server start", "- /archon server stop", "- /archon server status"
    ].join("\n"));
    return;
  }

  // Stop
  if (command === "stop") {
    await ProgressBox.run(pi, ctx, {
      title: "server-stop",
      steps: () => [makeStep("cleanup processes", () => stepStopCleanup(pi, projectCwd))],
      maxLines: 4,
      renderReport: (results, dur) => {
        const r = results[0];
        const stopped = r?.ok && !r.lines.some((l) => l.includes("still running"));
        return `## Archon Server stop\n\n${r ? r.lines.map((l) => `- ${l}`).join("\n") : "no result"}\n\n- **Duration:** \`${formatElapsed(Math.floor(dur / 1000))}\`\n- **Status:** ${stopped ? "✅ stopped" : "❌ still running"}`;
      },
      emitLine: (text) => emitServer(pi, text),
      successLabel: "Archon server stopped.",
      errorLabel: "Archon server may still be running.",
    });
    return;
  }

  // Start
  if (command === "start") {
    await ProgressBox.run(pi, ctx, {
      title: "server-start",
      steps: () => [makeStep(`launch server`, () => stepStartServer(pi, projectCwd))],
      maxLines: 5,
      renderReport: (results, dur) => {
        const srvR = results[0];
        let md = `## Archon Server start\n\n`;
        if (srvR) md += `${srvR.lines.map((l) => `- ${l}`).join("\n")}\n\n`;
        md += `- **Duration:** \`${formatElapsed(Math.floor(dur / 1000))}\``;
        return md;
      },
      emitLine: (text) => emitServer(pi, text),
      successLabel: "Archon server started.",
      errorLabel: "Server start failed.",
    });
    return;
  }

  // Status — inline (quick read-only check)
  if (command === "status") {
    let archonHome: string;
    try {
      archonHome = resolveArchonHome(projectCwd);
    } catch (e) {
      archonHome = "(resolve failed: " + safeCode(String(e)) + ")";
    }

    const isHealthy = await isServerHealthy(5000);
    const logTail = readLogTail(getArchonServerPaths(projectCwd).logFile, 30);
    emitServer(pi, fmtStatus(archonHome, { isHealthy, logTail }));
    ctx.ui.notify(isHealthy ? "Server healthy." : "Server unhealthy or not running.", isHealthy ? "info" : "warning");
    return;
  }

  // Unknown sub-command
  emitServer(pi, `## Archon Server\n\n- **Unknown sub-command:** \`${safeCode(command)}\``);
}
