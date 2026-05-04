import { DEFAULT_LEVEL_CONFIG, JSON_STEP_MAP, SKIP_KEYS, STEP_PATTERNS } from "./constants";
import { levelTag } from "./helpers";

/** Parsed JSON structure emitted by Archon subprocesses */
interface JsonPayload extends Record<string, unknown> {
  level?: number;
  module?: string;
  msg?: string;
  nodeId?: string;
  err?: unknown;
}

/** Normalized event line produced during output parsing */
interface LiveEventLine {
  text: string;
  isErr: boolean;
  step?: string;
}

// ════════════════════════════════════════════════════════════════
// Secret redaction (public API — consumed by archon-exec truncation)
// ════════════════════════════════════════════════════════════════

export function redactSecrets(text: string): string {
  let out = text;
  out = out.replace(/(apikey\s*[=:]\s*)[^\s"']+/gi, "$1***");
  out = out.replace(/(api[_\- ]?key\s*(?:is|:|=)\s*)[^\s"']+/gi, "$1***");
  out = out.replace(/sqlitecloud:\/\/[^\s"']+/gi, "sqlitecloud://***");
  out = out.replace(/\b[A-Za-z0-9_-]{24,}\b/g, (token) => {
    if (!(/[a-z]/.test(token) && /[A-Z]/.test(token) && /\d/.test(token))) return token;
    return `${token.slice(0, 4)}***${token.slice(-4)}`;
  });
  return out;
}

export function safeCode(text: string): string {
  return text.replace(/```/g, "``\\`");
}

/** Wrap sanitized + cleaned stdout/stderr in a labeled block */
export function truncateOutputBlock(text: string, label: "stdout" | "stderr"): string {
  const cleaned = cleanOutput(redactSecrets(text || ""));
  return cleaned || `(no ${label})`;
}

// ════════════════════════════════════════════════════════════════
// Output cleaning pipeline (formerly sanitizer.ts)
// ════════════════════════════════════════════════════════════════

const PREFIX_RE = /^\[(INF|WRN|ERR|DBG|LOG|EVT)\]|\[dotenv@|\[(scout|planner|worker|reviewer|implementer)\]|^(Running workflow:|Working directory:|Dispatching workflow:|Workflow completed successfully\.)|^(🚀|⚠️|❌|✅|>\s)/i;

function keepPrefix(line: string): boolean {
  return PREFIX_RE.test(line.trim());
}

/** Find all ## SECTION_HEADER indices (ascending) */
function findAllSectionHeaders(lines: string[]): number[] {
  const headers: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+/.test((lines[i] ?? "").trim())) headers.push(i);
  }
  return headers;
}

/** Find the last ## SECTION_HEADER index */
function findFinalSection(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^##\s+/.test((lines[i] ?? "").trim())) return i;
  }
  return -1;
}

/** Parse JSON or pass-through with step extraction */
function parseLine(raw: string): LiveEventLine {
  const trimmed = raw.trim();
  if (!trimmed) return { text: "", isErr: false };
  if (/^\[+$/.test(trimmed) || /^\]+$/.test(trimmed)) return { text: "", isErr: false };

  // Try structured JSON event first
  let payload: JsonPayload | undefined;
  try {
    const candidate = trimmed.startsWith("{") ? trimmed : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
    const parsed = JSON.parse(candidate) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as JsonPayload;
  } catch { /* fall through to plain-text parsing */ }

  if (payload) return formatJsonEvent(payload, false);

  // Plain-text line — extract optional step marker
  const t = trimmed;
  let match = t.match(STEP_PATTERNS.started);
  if (match) return { text: t, isErr: false, step: `${match[1]} started` };
  match = t.match(STEP_PATTERNS.completed);
  if (match) return { text: t, isErr: false, step: `${match[1]} completed` };
  match = t.match(STEP_PATTERNS.dispatching);
  if (match) return { text: t, isErr: false, step: `dispatching ${match[1]}` };
  if (STEP_PATTERNS.startingWorkflow.test(t)) return { text: t, isErr: false, step: "starting workflow" };
  if (STEP_PATTERNS.workflowCompleted.test(t)) return { text: t, isErr: false, step: "workflow completed" };
  if (STEP_PATTERNS.workflowPaused.test(t)) return { text: t, isErr: false, step: "workflow paused" };
  return { text: t, isErr: false };
}

function formatJsonEvent(payload: JsonPayload, baseIsErr: boolean): LiveEventLine {
  const level = typeof payload.level === "number" ? payload.level : undefined;
  const mod = typeof payload.module === "string" ? payload.module : "event";
  const msg = typeof payload.msg === "string" ? payload.msg : "event";

  const details: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (SKIP_KEYS.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      details.push(`${key}=${value}`);
    } else if (Array.isArray(value)) {
      details.push(`${key}=[${value.length}]`);
    }
  }
  const errObj = payload.err;
  if (errObj && typeof errObj === "object" && typeof (errObj as Record<string, unknown>).message === "string") {
    details.push(`err=${(errObj as { message: string }).message}`);
  }
  let detail = details.join(" ");
  if (detail.length > 240) detail = `${detail.slice(0, 237)}...`;

  const nodeId = typeof payload.nodeId === "string" ? payload.nodeId : "";
  const step = JSON_STEP_MAP[msg]?.(nodeId);
  const text = `[${level !== undefined ? levelTag(level) : "EVT"}] ${mod}: ${msg}${detail ? ` — ${detail}` : ""}`;
  return { text, isErr: baseIsErr || (typeof level === "number" && level >= DEFAULT_LEVEL_CONFIG.warn), step };
}

/** Archon's own internal logs — strip from user-visible output. Matches:
 *   [WRN] workflow.loader: ...
 *   [INF] db.connection: ...
 *   ⚠️ Tool bash failed
 */
export const ARCHON_LOG_RE = /^\[(?:INFO|WARN|ERR|DBG|LOG|EVT|INF|WRN)\]\s+\w+[\-.\w]*:/;
const TOOL_WARNING_RE = /^⚠/;

/** Full cleaning pipeline: normalize newlines → filter lines → preserve all sections */
export function cleanOutput(text: string): string {
  const lines = (text || "").replace(/\r\n?/g, "\n").split("\n");

  // Collect all ## SECTION_HEADER indices so we keep every section block.
  // Between sections only prefix-allowed content is kept; after the last
  // section everything is preserved verbatim (user output).
  const headers = findAllSectionHeaders(lines);

  if (headers.length === 0) {
    // No structured section found — transform all lines uniformly, strip archon logs
    return lines
      .filter((l) => !ARCHON_LOG_RE.test(l))
      .map(parseLine)
      .filter((e) => e.text.trim())
      .map((e) => e.text)
      .join("\n")
      .trim();
  }

  const parts: string[] = [];

  // Prefix content before the first header (logs, status markers)
  if (headers[0] > 0) {
    const prefix = lines.slice(0, headers[0])
      .map(parseLine)
      .filter((e) => keepPrefix(e.text))
      .filter((e) => !ARCHON_LOG_RE.test(e.text));
    // Also strip archon logs that appear inline (bypassed by PREFIX_RE matching)
    const allLines = lines.slice(0, headers[0]).map(parseLine).filter((e) => e.text.trim());
    parts.push(...allLines.filter((e) => !ARCHON_LOG_RE.test(e.text)).map((e) => e.text));
  }

  // Each section block: from header through the next header or EOF.
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i];
    const end = i + 1 < headers.length ? headers[i + 1] : lines.length;
    parts.push(...lines.slice(start, end).filter((l) => !ARCHON_LOG_RE.test(l)));
  }

  // Final sweep: strip any remaining archon log lines (they may leak from execution)
  return parts.join("\n").trim();
}

// ════════════════════════════════════════════════════════════════
// LogEvent class (merged from log-events.ts — used by UI boxes)
// ════════════════════════════════════════════════════════════════

export class LogEvent implements LiveEventLine {
  readonly text: string;
  readonly isErr: boolean;
  readonly step?: string;

  constructor(text: string, isErr: boolean, step?: string) {
    this.text = text;
    this.isErr = isErr;
    this.step = step;
  }

  /** Parse a raw output line into a typed event with optional step tracking */
  static parse(line: string, isErr: boolean): LiveEventLine {
    const ev = parseLine(line);
    return new LogEvent(ev.text, ev.isErr, ev.step);
  }

  toJson(): string {
    return JSON.stringify({ text: this.text, isErr: this.isErr, step: this.step });
  }
}
