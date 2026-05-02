import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { BufferLine, LiveEventLine, TuiBaseParams } from "./types";
import { formatElapsed } from "./helpers";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Params accepted by RunBox — single shape, no overloads */
export interface RunBoxParams extends TuiBaseParams {
  formatLine: (line: string, isErr: boolean) => LiveEventLine;
}

/** Streaming terminal box that displays live command output with animated spinner */
export class RunBox {
  // ── Injected via params ────────────────────────────────────────
  readonly #tui: NonNullable<TuiBaseParams["tui"]>;
  readonly #theme: NonNullable<TuiBaseParams["theme"]>;
  readonly title: string;
  readonly onAbort: () => void;
  readonly maxLines: number;
  readonly formatFn: (line: string, isErr: boolean) => LiveEventLine;

  // ── Mutable state ──────────────────────────────────────────────
  readonly startedAt = Date.now();
  readonly lines: BufferLine[] = [];
  totalEvents = 0;
  step = "starting";
  cachedWidth?: number;
  cachedLines?: string[];

  // Spinner internals (merged from UiSpinner)
  spinnerIndex = 0;
  ticker?: NodeJS.Timeout;

  constructor(params: RunBoxParams) {
    this.#tui = params.tui;
    this.#theme = params.theme;
    this.title = params.title;
    this.onAbort = params.onAbort;
    this.maxLines = params.maxLines ?? 5;
    this.formatFn = params.formatLine;

    this.ticker = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
      this.invalidate();
      this.#tui.requestRender();
    }, 120);
  }

  stop(): void {
    if (this.ticker) clearInterval(this.ticker);
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  append(line: string, isErr: boolean): void {
    const normalized = line.replace(/\r/g, "").trim();
    if (!normalized) return;

    const event = this.formatFn(normalized, isErr);
    if (!event?.text?.trim()) return;

    this.totalEvents += 1;
    if (event.step) this.step = event.step;

    this.lines.push({ text: event.text, isErr: event.isErr });
    while (this.lines.length > this.maxLines) this.lines.shift();

    this.invalidate();
    this.#tui.requestRender();
  }

  handleInput(data: string): void {
    if (data === "\u001b" || data === "\x1c") this.onAbort(); // escape or ctrl+c
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const inner = Math.max(24, width - 2);
    const elapsed = formatElapsed(Math.floor((Date.now() - this.startedAt) / 1000));
    const frame = this.#theme.fg("accent", SPINNER_FRAMES[this.spinnerIndex] ?? "•");
    const border = this.#theme.fg("border", "");

    const rows: string[] = [];
    rows.push(`${border}┌${"─".repeat(inner)}┐`);
    rows.push(`│${pad.call(this, `${frame} ${this.#theme.bold(this.title)} ${this.#theme.fg("dim", elapsed)}`, inner)}│`);

    const dropped = Math.max(0, this.totalEvents - this.lines.length);
    rows.push(`│${pad.call(this, this.#theme.fg("muted", `step: ${this.step} · events: ${this.totalEvents} · dropped: ${dropped}`), inner)}│`);

    const buf = this.lines.length ? [...this.lines] : [{ text: "(waiting for output...)", isErr: false }];
    for (let i = 0; i < this.maxLines; i++) {
      const e = buf[i];
      const txt = e ? (e.isErr ? this.#theme.fg("warning", e.text) : this.#theme.fg("text", e.text)) : "";
      rows.push(`│${pad.call(this, txt, inner)}│`);
    }

    rows.push(`│${pad.call(this, this.#theme.fg("dim", `[Esc] cancel`), inner)}│`);
    rows.push(`${border}└${"─".repeat(inner)}┘`);

    this.cachedWidth = width;
    this.cachedLines = rows;
    return rows;
  }
}

// Shared padding helper — uses theme from RunBox instance
function pad(this: RunBox, content: string, w: number): string {
  const truncated = truncateToWidth(content, w);
  const fill = Math.max(0, w - visibleWidth(truncated));
  return `${truncated}${" ".repeat(fill)}`;
}
