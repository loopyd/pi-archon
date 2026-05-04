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

function isNoiseLine(line: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(line)) || ARCHON_LOG_RE.test(line);
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

/** Lines that are archon internal noise (step markers, json logs, tool warnings, empty) */
const NOISE_PATTERNS = [
  /^\s*$/,
  /^\[(?:INFO|WARN|ERR|DBG|LOG|EVT|INF|WRN)\]\s/,
  /^\{.*\}$/,
  /^\[archon\]\s/,
  /^\[dotenv@\]/,
  /^\[(?:scout|planner|worker|reviewer|implementer|classifier|supervisor|task-merger|task-reviewer|task-worker)\]\s*/,
  /^⚠️\s*Tool\s/,
  /^Running workflow:/,
  /^Working directory:/,
  /^Dispatching workflow:/,
  /^🚀\s*Starting workflow:/,
  /^▶️\s*Resuming workflow/,
  /^❌\s*DAG workflow/,
  /^Workflow completed successfully\.$/,
];

/** Full cleaning pipeline: normalize newlines → filter lines → preserve all sections */
export function cleanOutput(text: string): string {
  const lines = (text || "").replace(/\r\n?/g, "\n").split("\n");

  let startAt = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().startsWith("## Goal")) {
      startAt = i;
      break;
    }
  }

  if (startAt < 0) {
    const headers = findAllSectionHeaders(lines);
    startAt = headers.length > 0 ? headers[0] : -1;
  }

  if (startAt < 0) {
    return lines
      .filter((l) => !isNoiseLine(l))
      .map(parseLine)
      .filter((e) => e.text.trim())
      .map((e) => e.text)
      .join("\n")
      .trim();
  }

  // Find the end of the last section to trim trailing summaries/logs
  let endAt = lines.length;
  for (let i = lines.length - 1; i >= startAt; i--) {
    // We want to find the last line of the last section.
    // Since sections end at the next header, the last section ends at the end of the file.
    // But if there's a trailing block of text that doesn't look like the plan, we want to cut it.
    // Heuristic: the plan ends after "## Risks" block.
  }
  
  // Actually, safer to just slice from startAt and then apply a "last section" trim if needed.
  // But the most common issue is the model adding a summary AFTER the final structured plan.
  // Let's find the last occurrence of "## Risks" and include that block.
  let risksIdx = -1;
  for (let i = lines.length - 1; i >= startAt; i--) {
    if (lines[i].trim().startsWith("## Risks")) {
      risksIdx = i;
      break;
    }
  }

  if (risksIdx !== -1) {
    // Find where the Risks section actually ends (first line that looks like a new block or noise)
    let risksEnd = lines.length;
    for (let i = risksIdx + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l.startsWith("##") || l.startsWith("Goal:") || l.startsWith("Plan:")) {
        risksEnd = i;
        break;
      }
    }
    endAt = risksEnd;
  }

  const body = lines.slice(startAt, endAt).filter((l) => !isNoiseLine(l));
  
  // --- Unwrap forced newlines ---
  const unwrapped: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    const next = body[i + 1];

    // If this line doesn't look like a header/list/code and next line exists and also doesn't look like a header/list/code
    // then it's probably a wrap.
    const isStructural = (l: string) => /^##|^[*+-]|^[0-9]+\.|^>|^ ```/.test(l.trim());
    
    if (i < body.length - 1 && !isStructural(line) && !isStructural(next)) {
      unwrapped.push(line + " ");
    } else {
      unwrapped.push(line);
    }
  }

  return unwrapped.join("\n").trim();
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
