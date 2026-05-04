import { TuiBase } from "./base";
import type { BufferLine, LiveEventLine, TuiBaseParams } from "../types";
import { formatElapsed } from "../helpers";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Params accepted by RunBox — single shape, no overloads */
export interface RunBoxParams extends TuiBaseParams {
  formatLine: (line: string, isErr: boolean) => LiveEventLine;
}

/** Streaming terminal box that displays live command output with animated spinner */
export class RunBox extends TuiBase {
  readonly #formatLine: (line: string, isErr: boolean) => LiveEventLine;
  readonly #startedAt = Date.now();
  readonly #lines: BufferLine[] = [];
  #totalEvents = 0;
  #step = "starting";
  #cachedWidth?: number;
  #cachedLines?: string[];
  #spinnerIndex = 0;
  #ticker?: NodeJS.Timeout;
  #pendingEsc?: NodeJS.Timeout;

  constructor(params: RunBoxParams) {
    super(params);
    this.#formatLine = params.formatLine;

    this.#ticker = setInterval(() => {
      this.#spinnerIndex = (this.#spinnerIndex + 1) % SPINNER_FRAMES.length;
      this.invalidate();
      this.tui.requestRender();
    }, 120);
  }

  stop(): void {
    if (this.#ticker) clearInterval(this.#ticker);
    if (this.#pendingEsc) clearTimeout(this.#pendingEsc);
  }

  override invalidate(): void {
    this.#cachedWidth = undefined;
    this.#cachedLines = undefined;
  }

  append(line: string, isErr: boolean): void {
    const normalized = line.replace(/\r/g, "").trim();
    if (!normalized) return;

    const event = this.#formatLine(normalized, isErr);
    if (!event?.text?.trim()) return;

    this.#totalEvents += 1;
    if (event.step) this.#step = event.step;

    this.#lines.push({ text: event.text, isErr: event.isErr });
    while (this.#lines.length > this.maxLines) this.#lines.shift();

    this.invalidate();
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (this.#pendingEsc) {
      clearTimeout(this.#pendingEsc);
      this.#pendingEsc = undefined;
    }
    if (data === "\u001b") {
      this.#pendingEsc = setTimeout(() => {
        this.#pendingEsc = undefined;
        this.onAbort();
      }, 40);
      return;
    }
    if (data === "\x1c") this.onAbort();
  }

  render(width: number): string[] {
    if (this.#cachedLines && this.#cachedWidth === width) return this.#cachedLines;

    const inner = Math.max(1, width - (this.sidePad().length * 2));
    const elapsed = formatElapsed(Math.floor((Date.now() - this.#startedAt) / 1000));
    const frame = this.fireAccent(SPINNER_FRAMES[this.#spinnerIndex] ?? "•");
    const rows = [this.renderPanelPillRow(width)];

    const body: string[] = [];
    body.push(`${this.panelGutter()}${frame} ${this.theme.bold(this.fireAccentHot(this.title))} ${this.fireDim(elapsed)}`);

    const dropped = Math.max(0, this.#totalEvents - this.#lines.length);
    body.push(`${this.panelGutter()}${this.fireMuted(`step: ${this.#step} · events: ${this.#totalEvents} · dropped: ${dropped}`)}`);
    body.push("");

    const buf = this.#lines.length ? [...this.#lines] : [{ text: "(waiting for output...)", isErr: false }];
    for (let i = 0; i < this.maxLines; i++) {
      const e = buf[i];
      const txt = e ? (e.isErr ? this.fireWarning(e.text) : this.fireFg(e.text)) : "";
      body.push(`${this.panelGutter()}${txt}`);
    }

    body.push("");
    body.push(`${this.panelGutter()}${this.fireDim(`[Esc] cancel`)}`);

    const out = [...rows, ...this.renderPanelRows(body, width)];
    this.#cachedWidth = width;
    this.#cachedLines = out;
    return out;
  }
}
