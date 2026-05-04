import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { ARCHON_ROOT, EXEC_TIMEOUT_MS, PROGRESS_UPDATE_MS } from "./constants";
import type { ArchonRunResult, ArchonToolUpdate } from "./types";
import { formatElapsed, hasFlag, maybeString } from "./helpers";
import { redactSecrets, safeCode, truncateOutputBlock } from "./output-filter";

// ─── Invocation resolution ──────────────────────────────────────

function resolveInvocation(args: string[], projectCwd: string): { command: string; args: string[]; cwd: string } {
  const cmdArgs = hasFlag(args, "--cwd") ? [...args] : [...args, "--cwd", projectCwd];
  if (fs.existsSync(`${ARCHON_ROOT}/package.json`)) {
    return { command: "bun", args: ["run", "cli", ...cmdArgs], cwd: ARCHON_ROOT };
  }
  return { command: "archon", args: cmdArgs, cwd: projectCwd };
}

// ─── Core execution engine ──────────────────────────────────────

interface ExecOptions {
  signal?: AbortSignal;
  onLine?: (line: string, isErr: boolean) => void;
  buffered?: boolean; // true = use pi.exec (default); false = raw spawn for line callbacks
}

async function execCore(
  pi: ExtensionAPI | undefined,
  args: string[],
  projectCwd: string,
  opts?: ExecOptions
): Promise<ArchonRunResult> {
  const inv = resolveInvocation(args, projectCwd);

  // Buffered path — delegates through pi.exec (handles timeout + abort natively)
  if (!opts?.onLine && (opts?.buffered ?? true) && pi) {
    const result = await pi.exec(inv.command, inv.args, { cwd: inv.cwd, timeout: EXEC_TIMEOUT_MS, signal: opts?.signal });
    return {
      command: `${inv.command} ${inv.args.join(" ")}`,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.code ?? 0,
    };
  }

  // Streaming path — raw child_process spawn with line-by-line pumping
  return new Promise<ArchonRunResult>((resolve, reject) => {
    const child = spawn(inv.command, inv.args, {
      cwd: inv.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let outCarry = "";
    let errCarry = "";
    let timedOut = false;
    let settled = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500);
    }, EXEC_TIMEOUT_MS);

    const flushLine = (line: string, isErr: boolean) => {
      const normalized = line.replace(/\r/g, "");
      if (!normalized.trim()) return;
      opts?.onLine?.(normalized, isErr);
    };

    const pump = (chunk: string, isErr: boolean) => {
      const priorCarry = isErr ? errCarry : outCarry;
      const combined = `${priorCarry}${chunk.replace(/\r\n?/g, "\n")}`;
      const parts = combined.split("\n");
      const nextCarry = parts.pop() ?? "";
      for (const line of parts) flushLine(line, isErr);
      if (isErr) errCarry = nextCarry;
      else outCarry = nextCarry;
    };

    const finalize = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      opts?.signal?.removeEventListener("abort", onAbort);
      if (outCarry) flushLine(outCarry, false);
      if (errCarry) flushLine(errCarry, true);
      if (timedOut) stderr += `\nCommand timed out after ${Math.floor(EXEC_TIMEOUT_MS / 1000)}s.`;
      resolve({
        command: `${inv.command} ${inv.args.join(" ")}`,
        stdout,
        stderr,
        exitCode: timedOut ? 124 : (code ?? 0),
      });
    };

    const onAbort = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500);
    };

    if (opts?.signal) opts.signal.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      opts?.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      pump(text, false);
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      pump(text, true);
    });

    child.on("exit", (code) => {
      finalize(code);
    });

    child.on("close", (code) => {
      finalize(code);
    });
  });
}

// ─── Public API — backward-compatible named exports ──────────────

/** Buffered execution via pi.exec (default path) */
export async function runArchonCommand(
  pi: ExtensionAPI,
  args: string[],
  projectCwd: string,
  signal?: AbortSignal
): Promise<ArchonRunResult> {
  return execCore(pi, args, projectCwd, { signal, buffered: true });
}

/** Streaming execution with per-line callback (raw spawn) */
export async function runArchonCommandStreaming(
  args: string[],
  projectCwd: string,
  signal: AbortSignal | undefined,
  onLine?: (line: string, isErr: boolean) => void
): Promise<ArchonRunResult> {
  return execCore(undefined, args, projectCwd, { signal, onLine, buffered: false });
}

/** Tool-update-wrapped execution with progress pings */
export async function runArchonCommandWithToolUpdates(
  pi: ExtensionAPI,
  commandArgs: string[],
  cwd: string,
  signal: AbortSignal | undefined,
  onUpdate: ((update: ArchonToolUpdate) => void) | undefined,
  label: string,
  details: Record<string, unknown>
): Promise<{ run: ArchonRunResult; durationMs: number }> {
  const startedAt = Date.now();

  const pushUpdate = (phase: "start" | "running" | "done", text: string, extra?: Record<string, unknown>) => {
    onUpdate?.({
      content: [{ type: "text", text }],
      details: { ...details, phase, label, elapsedSec: Math.floor((Date.now() - startedAt) / 1000), ...extra },
    });
  };

  pushUpdate("start", `Running Archon ${label}...`);

  const interval = setInterval(() => {
    pushUpdate("running", `Archon ${label} running (${formatElapsed(Math.floor((Date.now() - startedAt) / 1000))})...`);
  }, PROGRESS_UPDATE_MS);

  try {
    const run = await runArchonCommand(pi, commandArgs, cwd, signal);
    const durationMs = Date.now() - startedAt;
    pushUpdate(
      "done",
      run.exitCode === 0
        ? `Archon ${label} finished in ${formatElapsed(Math.floor(durationMs / 1000))}.`
        : `Archon ${label} failed (exit ${run.exitCode}) after ${formatElapsed(Math.floor(durationMs / 1000))}.`,
      { exitCode: run.exitCode, durationMs }
    );
    return { run, durationMs };
  } finally {
    clearInterval(interval);
  }
}

// ─── Output formatting ──────────────────────────────────────────────

export function formatArchonOutput(title: string, run: ArchonRunResult, durationMs?: number): string {
  const out = truncateOutputBlock(run.stdout, "stdout");
  const status = run.exitCode === 0 ? "✅ success" : "❌ failed";

  let md = `## Archon ${title}\n\n`;
  md += `- **Result:** ${status} (exit \`${String(run.exitCode)}\`)\n`;
  if (typeof durationMs === "number") {
    md += `- **Duration:** \`${formatElapsed(Math.floor(durationMs / 1000))}\`\n`;
  }
  md += "\n### Output\n\n```text\n";
  md += safeCode(out) + "\n```\n";
  return md;
}

export function formatArchonToolResult(
  title: string,
  run: ArchonRunResult,
  details: Record<string, unknown>,
  durationMs?: number
) {
  return {
    content: [{ type: "text" as const, text: formatArchonOutput(title, run, durationMs) }],
    details: { ...details, exitCode: run.exitCode, command: redactSecrets(run.command), durationMs },
  };
}
