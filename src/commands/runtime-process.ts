import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ArchonRuntimeStartResult } from "../types";
import { shellQuote } from "../helpers";
import { isHttpReachable } from "../runtime-util";
import {
  ARCHON_ROOT,
  RUNTIME_CLEANUP_WAIT_MS,
  RUNTIME_FAILURE_LOG_LINES,
  RUNTIME_FORCE_KILL_WAIT_MS,
  RUNTIME_LOG_TAIL_LINES,
  RUNTIME_START_RETRIES,
  RUNTIME_START_RETRY_DELAY_MS,
  RUNTIME_START_TIMEOUT_MS,
  RUNTIME_STOP_TIMEOUT_MS,
} from "../constants";

export async function isRuntimeServerHealthy(getArchonServerUrl: (projectCwd?: string) => string, projectCwd: string, timeoutMs: number): Promise<boolean> {
  return isHttpReachable(`${getArchonServerUrl(projectCwd)}/api/health`, timeoutMs);
}

export async function waitForRuntimeStart<T extends ArchonRuntimeStartResult>(
  result: T,
  options: {
    isHealthy: () => Promise<boolean>;
    isPidRunning: (pid: string) => boolean;
    readLogTail: (logFile: string, maxLines: number) => string;
    getCurrentResult?: () => T | Promise<T>;
    timeoutMessage: string;
  }
): Promise<T> {
  for (let i = 0; i < RUNTIME_START_RETRIES; i++) {
    if (await options.isHealthy()) return options.getCurrentResult ? await options.getCurrentResult() : result;
    const tail = options.readLogTail(result.logFile, RUNTIME_LOG_TAIL_LINES);
    if (/startup_failed|EADDRINUSE|Failed to start/i.test(tail)) throw new Error(tail || options.timeoutMessage);
    if (!options.isPidRunning(result.pid)) throw new Error(tail || options.timeoutMessage.replace("did not become healthy in time.", "exited before becoming healthy."));
    await new Promise((resolve) => setTimeout(resolve, RUNTIME_START_RETRY_DELAY_MS));
  }
  throw new Error(options.readLogTail(result.logFile, RUNTIME_FAILURE_LOG_LINES) || options.timeoutMessage);
}

export async function launchRuntimeDetached(
  pi: ExtensionAPI,
  projectCwd: string,
  logFile: string,
  pidFile: string,
  command: string
): Promise<string> {
  const script = [
    "set -e",
    `mkdir -p ${shellQuote(`${projectCwd}/tmp`)}`,
    `: > ${shellQuote(logFile)}`,
    `cd ${shellQuote(ARCHON_ROOT)}`,
    `setsid ${command} > ${shellQuote(logFile)} 2>&1 < /dev/null &`,
    "pid=$!",
    `echo \"$pid\" > ${shellQuote(pidFile)}`,
    "echo \"$pid\"",
  ].join("\n");

  const result = await pi.exec("bash", ["-lc", script], { cwd: projectCwd, timeout: RUNTIME_START_TIMEOUT_MS });
  if ((result.code ?? 0) !== 0) throw new Error(result.stderr || result.stdout || "Failed to start runtime process.");
  return (result.stdout ?? "").trim().split(/\s+/).pop() || "unknown";
}

export async function cleanupArchonDevProcesses(pi: ExtensionAPI, projectCwd: string, pidFile: string, pattern: string) {
  const script = [
    "set +e", `pidfile=${shellQuote(pidFile)}`, `archon_root=${shellQuote(ARCHON_ROOT)}`,
    "declare -A seen", "add_pid() { local p=\"$1\"; [[ \"$p\" =~ ^[0-9]+$ ]] || return 0; [ \"$p\" -eq $$ ] && return 0; [ \"$p\" -eq $PPID ] && return 0; seen[\"$p\"]=1; }",
    'if [ -f "$pidfile" ]; then add_pid "$(tr -d "\\r\\n " < "$pidfile")"; fi',
    `for pid in $(pgrep -f ${shellQuote(pattern)} 2>/dev/null); do`,
    '  [ "$pid" = "$$" ] && continue',
    '  cmd="$(tr "\\0" " " < "/proc/$pid/cmdline" 2>/dev/null || true)"',
    '  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"',
    '  if [[ "$cmd" == *"$archon_root"* || "$cwd" == "$archon_root"* ]]; then add_pid "$pid"; fi', "done",
    "for pid in ${!seen[@]}; do pgid=\"$(ps -o pgid= -p \"$pid\" 2>/dev/null | tr -d \" \" || true)\";",
    '  kill -TERM "$pid" 2>/dev/null || true',
    '  [[ "$pgid" =~ ^[0-9]+$ ]] && [ "$pgid" -gt 1 ] && kill -TERM -- "-$pgid" 2>/dev/null || true; done',
    `sleep ${RUNTIME_CLEANUP_WAIT_MS / 1000}`, "for pid in ${!seen[@]}; do if kill -0 \"$pid\" 2>/dev/null; then",
    '  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d " " || true)"',
    '  kill -KILL "$pid" 2>/dev/null || true',
    '  [[ "$pgid" =~ ^[0-9]+$ ]] && [ "$pgid" -gt 1 ] && kill -KILL -- "-$pgid" 2>/dev/null || true; fi; done',
    `sleep ${RUNTIME_FORCE_KILL_WAIT_MS / 1000}`, 'remaining="$(for pid in ${!seen[@]}; do kill -0 "$pid" 2>/dev/null && printf "%s\\n" "$pid"; done | sort -n | xargs 2>/dev/null || true)"',
    'rm -f "$pidfile"', 'printf "MATCHED:%s\\n" "${!seen[*]}"', 'printf "REMAINING:%s\\n" "$remaining"',
  ].join("\n");

  const result = await pi.exec("bash", ["-lc", script], { cwd: projectCwd, timeout: RUNTIME_STOP_TIMEOUT_MS });
  const lines = `${result.stdout || ""}\n${result.stderr || ""}`.split(/\r?\n/);
  return {
    pidFile,
    matchedPids: (lines.find((line) => line.startsWith("MATCHED:"))?.slice(8).trim() ?? "").split(/\s+/).filter(Boolean),
    remainingPids: (lines.find((line) => line.startsWith("REMAINING:"))?.slice(10).trim() ?? "").split(/\s+/).filter(Boolean),
  };
}
