import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ArchonMessageDetails } from "./types";
import { ARCHON_PILL_DEFAULT, ARCHON_TITLE } from "./constants";

interface TextContentPart {
  text?: string;
}


export function normalizeString(value: unknown): string {
  if (typeof value !== "string") return "";
  let out = value.trim();
  while (out.length >= 2 && out.startsWith('"') && out.endsWith('"')) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

export function maybeString(value: unknown): string | undefined {
  const v = normalizeString(value);
  return v.length > 0 ? v : undefined;
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
      .map((part: TextContentPart | string) => {
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
  return (pi: ExtensionAPI, content: string, details?: ArchonMessageDetails) => {
    pi.sendMessage({ customType, content, display: true, details });
  };
}

export const emitArchonMessage = createMessageEmitter("archon");

export function toPillLabel(value?: string): string {
  const text = value?.trim();
  if (!text) return ARCHON_PILL_DEFAULT;
  return text.toUpperCase();
}

export function formatToolTextResult(text: string, details?: Record<string, unknown>) {
  return { content: [{ type: "text", text }], details };
}

export function formatArchonMessage(...lines: string[]): string {
  return [ARCHON_TITLE, "", ...lines].join("\n");
}
