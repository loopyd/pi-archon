import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { Component } from "@mariozechner/pi-tui";
import { ARCHON_PILL_DEFAULT, ARCHON_THEME_RGB, PANEL_GUTTER, PANEL_SIDE_PAD } from "../constants";
import type { ArchonMessageDetails, MessagePanelLine } from "../types";
import { fire } from "./rgb";

const boldHot = (text: string) => `\x1b[1m${fire.accentHot(text)}\x1b[22m`;
const panelLabel = (text: string) => fire.panel(fire.accentHot(` ${text} `));
const panelText = (text: string) => fire.panel(fire.text(text));
const panelBorder = (text: string) => fire.panel(fire.border(text));
const sectionTitle = (text: string) => `${fire.accent("◆ ")}${boldHot(text)}`;
const panelFill = (width: number) => fire.panel(" ".repeat(Math.max(0, width)));
const plainFill = (width: number) => fire.bg(" ".repeat(Math.max(0, width)));
const PANEL_BG_ON = `\x1b[48;2;${ARCHON_THEME_RGB.panel[0]};${ARCHON_THEME_RGB.panel[1]};${ARCHON_THEME_RGB.panel[2]}m`;
const PANEL_BG_OFF = "\x1b[49m";

const withRowBg = (text: string) => {
  let out = PANEL_BG_ON;
  for (let i = 0; i < text.length;) {
    if (text[i] !== "\x1b") {
      out += text[i];
      i += 1;
      continue;
    }
    const end = text.indexOf("m", i);
    if (end === -1) {
      out += text.slice(i);
      break;
    }
    const code = text.slice(i, end + 1);
    out += code;
    if (code === "\x1b[0m" || code === PANEL_BG_OFF) out += PANEL_BG_ON;
    i = end + 1;
  }
  return `${out}${PANEL_BG_OFF}`;
};

const fireRule = (width: number) => {
  const size = Math.max(1, width);
  let out = "";
  for (let i = 0; i < size; i++) out += i % 2 === 0 ? fire.border("═") : fire.accent("═");
  return out;
};

function getStatusBadge(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("success") || lower.includes("healthy") || lower.includes("started") || lower.includes("stopped") || lower.includes("finished") || lower.includes("running")) {
    return fire.panel(fire.success(` ✓ ${text.toUpperCase()} `));
  }
  if (lower.includes("failed") || lower.includes("error") || lower.includes("unhealthy")) {
    return fire.panel(fire.warning(` ✗ ${text.toUpperCase()} `));
  }
  if (lower.includes("warning") || lower.includes("cancelled")) {
    return fire.panel(fire.warning(` ! ${text.toUpperCase()} `));
  }
  return text;
}

function styleInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, (_m, code) => fire.panel(fire.warning(String(code))))
    .replace(/\*\*([^*]+)\*\*/g, (_m, bold) => boldHot(String(bold)));
}

function stylizeArchonMarkdown(md: string): string {
  return md
    .replace(/- \*\*Result:\*\* ([^\n]+)/g, (_m, status) => `- **Result:** ${getStatusBadge(String(status).trim())}`)
    .replace(/- \*\*Health check:\*\* ([^\n]+)/g, (_m, status) => `- **Health check:** ${getStatusBadge(String(status).trim())}`)
    .replace(/- \*\*Status:\*\* ([^\n]+)/g, (_m, status) => `- **Status:** ${getStatusBadge(String(status).trim())}`)
    .replace(/- \*\*Server:\*\* ([^\n]+)/g, (_m, status) => `- **Server:** ${getStatusBadge(String(status).trim())}`);
}

function stripAnsiCodes(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function wrapIndent(text: string): number {
  const plain = stripAnsiCodes(text);
  const dashIndex = plain.indexOf("—");
  if (dashIndex >= 0) {
    const gap = plain[dashIndex + 1] === " " ? 1 : 0;
    return visibleWidth(plain.slice(0, dashIndex + 1)) + gap;
  }
  const trimmed = plain.match(/^\s*(.*)$/)?.[1] ?? plain;
  return Math.max(4, Math.min(visibleWidth(trimmed), 4));
}

function tokenizeStyledText(text: string): Array<{ text: string; width: number; penalty: number }> {
  const tokens: Array<{ text: string; width: number; penalty: number }> = [];
  let active = "";
  for (let i = 0; i < text.length;) {
    if (text[i] === "\x1b") {
      const end = text.indexOf("m", i);
      if (end === -1) {
        const raw = `${active}${text.slice(i)}`;
        tokens.push({ text: raw, width: visibleWidth(raw), penalty: 4 });
        break;
      }
      const code = text.slice(i, end + 1);
      if (code === "\x1b[0m" || code === "\x1b[22m" || code === "\x1b[39m" || code === "\x1b[49m") active = "";
      else active += code;
      i = end + 1;
      continue;
    }

    let j = i;
    while (j < text.length && text[j] !== "\x1b") j += 1;
    const chunk = text.slice(i, j);
    const parts = chunk.match(/\S+\s*|\s+/g) ?? [];
    for (const part of parts) {
      if (/^\s+$/.test(part)) continue;
      const raw = `${active}${part}`;
      const trimmed = part.trimEnd();
      const penalty = /[,)]$/.test(trimmed)
        ? 1
        : /[;:]$/.test(trimmed)
          ? 2
          : /[.!?]$/.test(trimmed)
            ? 3
            : 4;
      tokens.push({ text: raw, width: visibleWidth(part), penalty });
    }
    i = j;
  }
  return tokens;
}

function trimBreakableEnd(text: string): string {
  return text.replace(/[\s.,;:!?]+$/u, "");
}

function wrapText(text: string, width: number): string[] {
  if (visibleWidth(text) <= width) return [text];
  const leading = text.match(/^(?:\x1b\[[0-9;]*m)*\s*/)?.[0] ?? "";
  const content = text.slice(leading.length);
  const indentWidth = wrapIndent(text);
  const indent = `${leading}${" ".repeat(Math.max(0, indentWidth - visibleWidth(leading)))}`;
  const tokens = tokenizeStyledText(content);
  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;
  let firstLine = true;

  const flush = () => {
    const rendered = trimBreakableEnd(`${firstLine ? leading : indent}${current}`);
    if (rendered.trim().length > 0) lines.push(rendered);
    current = "";
    currentWidth = 0;
    firstLine = false;
  };

  for (const token of tokens) {
    const base = firstLine ? visibleWidth(leading) : indentWidth;
    if (base + currentWidth + token.width <= width) {
      current += token.text;
      currentWidth += token.width;
      continue;
    }

    if (currentWidth > 0) flush();

    const nextBase = firstLine ? visibleWidth(leading) : indentWidth;
    if (nextBase + token.width <= width) {
      current = token.text;
      currentWidth = token.width;
      continue;
    }

    let rest = token.text;
    while (visibleWidth(rest) > width - nextBase) {
      let split = 1;
      for (let i = 1; i <= rest.length; i++) {
        const part = rest.slice(0, i);
        if (visibleWidth(part) > width - nextBase) break;
        split = i;
      }
      const chunk = rest.slice(0, split);
      const rendered = trimBreakableEnd(`${firstLine ? leading : indent}${chunk}`);
      if (rendered.trim().length > 0) lines.push(rendered);
      rest = rest.slice(split);
      firstLine = false;
    }
    current = rest;
    currentWidth = visibleWidth(rest);
  }

  if (currentWidth > 0) flush();
  return lines.length > 0 ? lines : [text];
}

function normalizeFences(raw: string): string {
  return raw
    .replace(/``\\`/g, "```")
    .replace(/\\`\\`\\`/g, "```");
}

function derivePanelPill(content?: unknown, details?: ArchonMessageDetails): string {
  const direct = typeof details?.pill === "string" ? details.pill.trim() : "";
  if (direct) return direct.toUpperCase();
  if (typeof content !== "string") return ARCHON_PILL_DEFAULT;
  const heading = content.split("\n", 1)[0]?.replace(/^#+\s*/, "").trim() ?? "";
  const first = heading.split(/\s+/).find(Boolean)?.replace(/[^A-Za-z0-9_-]/g, "") ?? "";
  return (first || ARCHON_PILL_DEFAULT).toUpperCase();
}

function renderBody(raw: string): MessagePanelLine[] {
  const lines = stylizeArchonMarkdown(normalizeFences(raw)).split("\n");
  let inCode = false;
  let inIndentedBlock = false;
  return lines.map((line, index) => {
    const trimmed = line.trim();
    const next = lines[index + 1] ?? "";
    if (/^[`\\]{3,}/.test(trimmed)) {
      inCode = !inCode;
      return { text: "", kind: "panel", wrap: false };
    }
    if (/^[A-Za-z][A-Za-z0-9 _-]*:$/.test(trimmed) && /^\s{4,}\S?/.test(next)) {
      inIndentedBlock = true;
      return { text: panelText(sectionTitle(trimmed.replace(/:$/, ""))), kind: "panel", wrap: true };
    }
    if (inCode) return { text: panelText(line || " "), kind: "panel", wrap: false };
    if (/^\s{4,}/.test(line)) {
      inIndentedBlock = true;
      return { text: panelText(line.slice(4) || " "), kind: "panel", wrap: false };
    }
    if (inIndentedBlock && !trimmed) return { text: panelText(" "), kind: "panel", wrap: false };
    if (inIndentedBlock) inIndentedBlock = false;
    if (/^###\s+/.test(line)) return { text: panelText(sectionTitle(line.replace(/^###\s+/, ""))), kind: "panel", wrap: true };
    if (/^##\s+/.test(line)) return { text: panelText(sectionTitle(line.replace(/^##\s+/, ""))), kind: "panel", wrap: true };
    if (/^-\s+/.test(line)) return { text: panelText(`${fire.accent("•")} ${styleInline(line.replace(/^-\s+/, ""))}`), kind: "panel", wrap: true };
    if (!trimmed) return { text: "", kind: "panel", wrap: false };
    return { text: panelText(styleInline(line)), kind: "panel", wrap: true };
  });
}

export class ArchonMessagePanel implements Component {
  readonly #lines: MessagePanelLine[];
  #cachedWidth?: number;
  #cachedLines?: string[];

  constructor(content?: unknown, details?: unknown, expanded?: boolean) {
    const messageDetails = (details && typeof details === "object") ? details as ArchonMessageDetails : undefined;
    const pill = panelLabel(derivePanelPill(content, messageDetails));
    this.#lines = [
      { text: pill, kind: "pill" },
      { text: "__ARCHON_RULE__", kind: "panel" },
      ...(typeof content === "string" ? renderBody(content).map<MessagePanelLine>((line) => ({ text: `${PANEL_GUTTER}${line.text}`, kind: line.kind, wrap: line.wrap })) : []),
      ...(expanded && details
        ? [{ text: "", kind: "panel" as const }, { text: `${PANEL_GUTTER}${sectionTitle("details")}`, kind: "plain" as const }, ...JSON.stringify(details, null, 2).split("\n").map<MessagePanelLine>((line) => ({ text: `${PANEL_GUTTER}${fire.dim(line)}`, kind: "plain" }))]
        : []),
      { text: "__ARCHON_RULE__", kind: "panel" },
    ];
  }

  invalidate(): void {
    this.#cachedWidth = undefined;
    this.#cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.#cachedLines && this.#cachedWidth === width) return this.#cachedLines;
    const paintWidth = Math.max(1, width);
    const innerWidth = Math.max(1, paintWidth - (PANEL_SIDE_PAD * 2));
    const contentWidth = Math.max(1, innerWidth - visibleWidth(PANEL_GUTTER));
    const sidePad = " ".repeat(PANEL_SIDE_PAD);
    const out = this.#lines.flatMap((rawLine) => {
      if (rawLine.text === "__ARCHON_RULE__") {
        return [`${sidePad}${withRowBg(fireRule(innerWidth))}${sidePad}`];
      }

      const targetWidth = rawLine.kind === "panel" ? contentWidth : innerWidth;
      const shouldWrap = rawLine.wrap === true;
      const segments = shouldWrap ? wrapText(rawLine.text, targetWidth) : [visibleWidth(rawLine.text) > targetWidth ? truncateToWidth(rawLine.text, targetWidth) : rawLine.text];

      return segments.map((segment) => {
        const fill = Math.max(0, innerWidth - visibleWidth(segment));
        if (rawLine.kind === "panel") return `${sidePad}${withRowBg(segment)}${panelFill(fill)}${sidePad}`;
        if (rawLine.kind === "pill") return `${sidePad}${segment}${" ".repeat(fill)}${sidePad}`;
        return `${plainFill(PANEL_SIDE_PAD)}${segment}${plainFill(fill)}${plainFill(PANEL_SIDE_PAD)}`;
      });
    });
    this.#cachedWidth = width;
    this.#cachedLines = out;
    return out;
  }
}
