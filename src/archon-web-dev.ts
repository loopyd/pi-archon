import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import { basename } from "node:path";
import { ARCHON_ROOT } from "./constants";
import type { ArchonWebCleanupResult, CodebaseBindingResult } from "./types";
import { createMessageEmitter, formatElapsed, maybeString, normalizeError, readPidFile, resolveArchonHome, shellQuote, sqlQuote } from "./helpers";
import { ProgressBox } from "./ui-progress-box";
import { safeCode } from "./output-filter";

const emitWebDev = createMessageEmitter("archon");

// ─── Config parsing ──────────────────────

function parseProjectAssistantFromConfig(projectCwd: string): string | undefined {
  const configPath = `${projectCwd}/.archon/config.yaml`;
  if (!fs.existsSync(configPath)) return undefined;
  const raw = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
  for (const line of raw) {
    for (const key of ["assistant", "provider"]) {
      const m = line.match(new RegExp(`^${key}:\\s*([^#\\s]+)`));
      if (m?.[1]) return m[1].trim();
    }
  }
  return undefined;
}

async function execSqlite(pi: ExtensionAPI, sql: string): Promise<string> {
  const dbPath = `${ARCHON_ROOT}/archon.db`;
  if (!fs.existsSync(dbPath)) throw new Error("Archon DB not found at " + dbPath);
  const result = await pi.exec("sqlite3", [dbPath, sql], { cwd: ARCHON_ROOT, timeout: 15000 });
  if ((result.code ?? 0) !== 0) throw new Error(result.stderr || ("sqlite3 failed (exit " + String(result.code) + ")"));
  return (result.stdout ?? "").trim();
}

async function ensureCodebaseAssistantBinding(
  pi: ExtensionAPI, projectCwd: string, assistant: string
): Promise<CodebaseBindingResult> {
  const query = `SELECT id || '|' || name || '|' || ai_assistant_type FROM remote_agent_codebases WHERE default_cwd = ${sqlQuote(projectCwd)} ORDER BY updated_at DESC LIMIT 1;`;

  const readRow = async (): Promise<CodebaseBindingResult | undefined> => {
    const raw = await execSqlite(pi, query);
    const parts = (raw || "").split("|");
    if (!parts[0]) return undefined;
    return { id: parts[0], name: parts[1] || "", assistant: parts[2] || "claude", created: false, updated: false };
  };

  let row = await readRow();
  if (!row) {
    const projName = basename(projectCwd) || "project";
    await execSqlite(pi, `INSERT INTO remote_agent_codebases (name, default_cwd, ai_assistant_type) VALUES (${sqlQuote(projName)}, ${sqlQuote(projectCwd)}, ${sqlQuote(assistant)});`);
    row = await readRow() ?? (() => { throw new Error("DB write succeeded but read failed"); })();
    return { ...row, created: true, updated: false };
  }
  if (row.assistant !== assistant) {
    await execSqlite(pi, `UPDATE remote_agent_codebases SET ai_assistant_type = ${sqlQuote(assistant)}, updated_at = datetime('now') WHERE id = ${sqlQuote(row.id)};`);
    return { ...row, assistant, updated: true };
  }
  return row;
}

// ─── Web dev path helpers ──────────────────────

function getArchonWebPaths(projectCwd: string) {
  return { logFile: `${projectCwd}/tmp/archon-web-dev.log`, pidFile: `${projectCwd}/tmp/archon-web-dev.pid` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseUiPortFromLog(logFile: string): string {
  if (!fs.existsSync(logFile)) return "5173";
  const matches = [...fs.readFileSync(logFile, "utf8").matchAll(/Local:\s+http:\/\/localhost:(\d+)\//g)];
  return matches.at(-1)?.[1] ?? "5173";
}

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

async function isWebFrontendReachable(port: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok || res.status < 500; // Vite may return non-200 for some routes but still be alive
  } catch { return false; }
}

async function createScopedWebConversation(codebaseId: string): Promise<string | undefined> {
  try {
    const res = await fetch("http://127.0.0.1:3090/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codebaseId }) });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { conversationId?: string };
    return maybeString(data.conversationId);
  } catch { return undefined; }
}

// ─── Process management ──────────────────────

function isPidRunning(pid: string): boolean {
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

async function cleanupArchonWebDevProcesses(pi: ExtensionAPI, projectCwd: string): Promise<ArchonWebCleanupResult> {
  const { pidFile } = getArchonWebPaths(projectCwd);
  // Match only frontend processes (vite, esbuild from @archon/web) — not server or docs-web
  const script = [
    "set +e", `pidfile=${shellQuote(pidFile)}`, `archon_root=${shellQuote(ARCHON_ROOT)}`,
    "declare -A seen", "add_pid() { local p=\"$1\"; [[ \"$p\" =~ ^[0-9]+$ ]] || return 0; [ \"$p\" -eq $$ ] && return 0; [ \"$p\" -eq $PPID ] && return 0; seen[\"$p\"]=1; }",
    'if [ -f "$pidfile" ]; then add_pid "$(tr -d "\\r\\n " < "$pidfile")"; fi',
    "for pid in $(pgrep -f '@archon/web|vite.*web|esbuild.*web' 2>/dev/null); do",
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

async function startArchonWebDevDetached(pi: ExtensionAPI, projectCwd: string, assistant: string): Promise<{ pid: string; logFile: string; pidFile: string; alreadyRunning: boolean; uiPort: string }> {
  const { logFile, pidFile } = getArchonWebPaths(projectCwd);
  const existingPid = readPidFile(pidFile);
  // Check if web frontend is already reachable on its port
  const existingPort = parseUiPortFromLog(logFile);
  if (existingPid && isPidRunning(existingPid) && (await isWebFrontendReachable(existingPort))) {
    return { pid: existingPid, logFile, pidFile, alreadyRunning: true, uiPort: existingPort };
  }
  await cleanupArchonWebDevProcesses(pi, projectCwd);

  // Use bun --filter to run only the web package
  const script = [
    "set -e", `mkdir -p ${shellQuote(`${projectCwd}/tmp`)}`, `: > ${shellQuote(logFile)}`,
    `cd ${shellQuote(ARCHON_ROOT)}`,
    `setsid env DEFAULT_AI_ASSISTANT=${shellQuote(assistant)} bun run dev:web > ${shellQuote(logFile)} 2>&1 < /dev/null &`,
    "pid=$!", `echo \"$pid\" > ${shellQuote(pidFile)}`, "echo \"$pid\"",
  ].join("\n");

  const result = await pi.exec("bash", ["-lc", script], { cwd: projectCwd, timeout: 15000 });
  if ((result.code ?? 0) !== 0) throw new Error(result.stderr || result.stdout || "Failed to start Archon web frontend.");
  const pid = (result.stdout ?? "").trim().split(/\s+/).pop() || "unknown";

  for (let i = 0; i < 30; i++) {
    const tail = readLogTail(logFile, 80);
    const port = parseUiPortFromLog(logFile);
    if (await isWebFrontendReachable(port)) return { pid, logFile, pidFile, alreadyRunning: false, uiPort: port };
    if (/startup_failed|EADDRINUSE|Failed to start/i.test(tail)) throw new Error(tail || "Archon web frontend failed to become healthy.");
    if (!isPidRunning(pid)) throw new Error(tail || "Archon web frontend exited before becoming healthy.");
    await sleep(500);
  }
  throw new Error(readLogTail(logFile, 100) || "Archon web frontend did not become healthy in time.");
}

export async function stopArchonWebDev(pi: ExtensionAPI, projectCwd: string) {
  const { pidFile } = getArchonWebPaths(projectCwd);
  const pid = readPidFile(pidFile);
  const cleanup = await cleanupArchonWebDevProcesses(pi, projectCwd);
  return { stopped: cleanup.remainingPids.length === 0 && (cleanup.matchedPids.length > 0 || Boolean(pid)), pid, pidFile, cleanedPids: cleanup.matchedPids, remainingPids: cleanup.remainingPids };
}

// ─── Markdown builders ──────────────

interface WebStatusData { isHealthy: boolean; serverHealthy: boolean; logTail: string; }

function fmtStatus(archonHome: string, data: WebStatusData, uiPort: string): string {
  const lines: string[] = [
    "## Archon WEB DEV status", "",
    `- **Archon home:** ${archonHome}`,
    `- **Health check:** ${data.isHealthy ? "✅ healthy" : "❌ unhealthy"}`,
    `- **Server**: ${data.serverHealthy ? "✅ running" : "⚠️ not reachable"}`,
    `- **UI endpoint:** \`http://localhost:${uiPort}/\``,
  ];
  if (data.logTail.length > 0) {
    lines.push("", "### Recent logs", "", "```text");
    lines.push(data.logTail.slice(-400));
    lines.push("```");
  }
  return safeCode(lines.join("\n"));
}

const makeStep = (title: string, fn: () => Promise<string[]>) => ({ title, run: fn });

/* ─── Step: web stop ──────────────────────────────── */
async function stepStopCleanup(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  try {
    const result = await stopArchonWebDev(pi, cwd);
    const lines: string[] = [];
    if (result.cleanedPids?.length) lines.push(`Matched PIDs: ${result.cleanedPids.join(", ")}`);
    else lines.push("No matching processes found");
    if (result.remainingPids?.length) lines.push(`Remaining PIDs: ${result.remainingPids.join(", ")} (still running)`);
    else lines.push("All matched processes terminated");
    return lines;
  } catch (e) { return [`error: ${normalizeError(e)}`]; }
}

/* ─── Steps: web start ──────────────────────────────── */
async function stepEnsureBinding(pi: ExtensionAPI, cwd: string, assistant: string): Promise<string[]> {
  const bind = await ensureCodebaseAssistantBinding(pi, cwd, assistant);
  return [`${bind.created ? "created" : bind.updated ? "updated" : "found"} codebase id=${bind.id}`];
}

async function stepCheckServer(pi: ExtensionAPI, _cwd: string): Promise<string[]> {
  const serverOk = await isServerHealthy();
  if (!serverOk) {
    return ["⚠️ Server not reachable on port 3090 — consider `/archon server start`"];
  }
  return ["✅ Server healthy on port 3090"];
}

async function stepStartFrontend(pi: ExtensionAPI, cwd: string, assistant: string, openFlag?: boolean): Promise<string[]> {
  const startedAt = Date.now();
  const result = await startArchonWebDevDetached(pi, cwd, assistant);
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const lines: string[] = [
    `PID: ${result.pid}`,
    `Log file: ${result.logFile}`,
    `Already running: ${result.alreadyRunning ? "yes" : "no"}`,
    `Startup time: ${elapsed}s`,
    `UI port: ${result.uiPort}`,
  ];
  if (openFlag) lines.push(`UI link: http://localhost:${result.uiPort}/`);
  return lines;
}



// ─── Command handler ──────────────────────

export async function handleArchonWebCommand(pi: ExtensionAPI, webTokens: string[], ctx: ExtensionCommandContext): Promise<void> {
  const projectCwd = ctx.cwd || process.cwd();
  const command = webTokens[0];

  // Diagnostic: emit immediately so we can confirm this handler fires
  if (!command && !webTokens.length) {
    emitWebDev(pi, "## Archon WEB DEV\n\n- **Sub-command:** _(none)_ — use `/archon web start|stop|status`");
    return;
  }

  // Help
  if (!command || ["help", "-h", "--help"].includes(command)) {
    emitWebDev(pi, ["## Archon web launcher", "", "Manages the @archon/web frontend independently. Requires the Archon server to be running for full functionality.", "",
      "### Usage", "- /archon web start", "- /archon web start --assistant pi --open", "- /archon web stop", "- /archon web status", "",
      "### Notes", "- The backend API (`@archon/server`) must be running separately via `/archon server start`"
    ].join("\n"));
    return;
  }

  // Stop
  if (command === "stop") {
    await ProgressBox.run(pi, ctx, {
      title: "web-stop",
      steps: () => [makeStep("cleanup processes", () => stepStopCleanup(pi, projectCwd))],
      maxLines: 4,
      renderReport: (results, dur) => {
        const r = results[0];
        const stopped = r?.ok && !r.lines.some((l) => l.includes("still running"));
        return `## Archon WEB DEV stop\n\n${r ? r.lines.map((l) => `- ${l}`).join("\n") : "no result"}\n\n- **Duration:** \`${formatElapsed(Math.floor(dur / 1000))}\`\n- **Status:** ${stopped ? "✅ stopped" : "❌ still running"}`;
      },
      emitLine: (text) => emitWebDev(pi, text),
      successLabel: "Archon web dev stopped.",
      errorLabel: "Archon web dev may still be running.",
    });
    return;
  }

  // Start
  if (command === "start") {
    let assistant = parseProjectAssistantFromConfig(projectCwd) ?? "pi";
    for (let i = 1; i < webTokens.length; i++) {
      if (webTokens[i] === "--assistant" && webTokens[i + 1]) { assistant = webTokens[++i]; break; }
    }
    const openFlag = webTokens.includes("--open");
    await ProgressBox.run(pi, ctx, {
      title: "web-start",
      steps: () => [
        makeStep("check server dependency", () => stepCheckServer(pi, projectCwd)),
        makeStep("align codebase binding", () => stepEnsureBinding(pi, projectCwd, assistant)),
        makeStep(`launch frontend (assistant=${assistant})`, () => stepStartFrontend(pi, projectCwd, assistant, openFlag)),
      ],
      maxLines: 6,
      renderReport: (results, dur) => {
        const srvR = results[0];
        const bindR = results[1];
        const feR = results[2];
        let md = `## Archon WEB DEV start\n\n`;
        if (srvR) md += `${srvR.lines.map((l) => `- ${l}`).join("\n")}\n\n`;
        if (bindR) md += `${bindR.lines.map((l) => `- ${l}`).join("\n")}\n\n`;
        if (feR) md += `${feR.lines.map((l) => `- ${l}`).join("\n")}\n\n`;
        md += `- **Duration:** \`${formatElapsed(Math.floor(dur / 1000))}\``;
        return md;
      },
      emitLine: (text) => emitWebDev(pi, text),
      successLabel: "Archon web frontend started.",
      errorLabel: "Web frontend start failed.",
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

    const port = parseUiPortFromLog(getArchonWebPaths(projectCwd).logFile);
    const isHealthy = await isWebFrontendReachable(port, 5000);
    const serverHealthy = await isServerHealthy(5000);
    const logTail = readLogTail(getArchonWebPaths(projectCwd).logFile, 30);
    emitWebDev(pi, fmtStatus(archonHome, { isHealthy, serverHealthy, logTail }, port));
    ctx.ui.notify(isHealthy ? "Web frontend healthy." : "Web frontend unhealthy or not running.", isHealthy ? "info" : "warning");
    return;
  }

  // Unknown sub-command
  emitWebDev(pi, `## Archon WEB DEV\n\n- **Unknown sub-command:** \`${safeCode(command)}\``);
}
