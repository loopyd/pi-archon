import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import { ARCHON_DEFAULT_HOME, ARCHON_ROOT } from "./constants";


export function normalizeString(value: unknown): string {
  if (typeof value !== "string") return "";
  let out = value.trim();
  while (out.length >= 2 && out.startsWith('"') && out.endsWith('"')) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

export function readPidFile(pidFile: string): string | undefined {
  if (!fs.existsSync(pidFile)) return undefined;
  const pid = fs.readFileSync(pidFile, "utf8").trim();
  return /^\d+$/.test(pid) ? pid : undefined;
}

export function isPidRunning(pid: string): boolean {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch {
    return false;
  }
}

export function maybeString(value: unknown): string | undefined {
  const v = normalizeString(value);
  return v.length > 0 ? v : undefined;
}

export function boolOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(content ?? "");
}

export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function hasFlag(args: string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

export function splitArgs(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escape = false;

  for (const ch of input) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch as "'" | '"';
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (current) out.push(current);
  return out;
}

export function resolveArchonHome(projectCwd?: string): string {
  // Project-level .archon takes priority when a project root is supplied
  if (projectCwd) {
    const projectArchon = `${projectCwd}/.archon`;
    if (fs.existsSync(projectArchon)) return projectArchon;
  }
  const envPath = `${ARCHON_ROOT}/.env`;
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf8");
    const match = raw.match(/^ARCHON_HOME=(.+)$/m);
    const value = maybeString(match?.[1]);
    if (value) return value;
  }
  return maybeString(process.env.ARCHON_HOME) ?? ARCHON_DEFAULT_HOME;
}

export function levelTag(level: number): string {
  if (level >= 50) return "ERR";
  if (level >= 40) return "WRN";
  if (level >= 30) return "INF";
  if (level >= 20) return "DBG";
  return "LOG";
}

// ─── Error normalization ──────────────────────────────

export function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
}

// ─── Message emitter factory ──────────────────────────────

/**
 * Creates a typed message-dispatch function bound to the given customType.
 * Callers use the returned closure instead of duplicating pi.sendMessage() boilerplate.
 *
 *   const emitArchon = createMessageEmitter("archon");
 *   emitArchon(pi, content);
 */
export function createMessageEmitter(customType: string) {
  return (pi: ExtensionAPI, content: string, details?: Record<string, unknown>) => {
    pi.sendMessage({ customType, content, display: true, details });
  };
}
