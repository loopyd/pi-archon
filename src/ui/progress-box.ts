import { TuiBase } from "./base";
import type { ProgressBoxParams, ProgressStepInfo, StepState, StreamMessage, LineParserFn } from "../types";
import { formatElapsed } from "../helpers";
import { ARCHON_LOG_RE } from "../output-filter";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class ProgressBox extends TuiBase {
  readonly mode: "steps" | "stream";
  readonly steps: ProgressStepInfo[];

  #messages: StreamMessage[] = [];
  #expanded = false;
  #error?: string;
  #currentStep = "";
  #totalEvents = 0;
  readonly #formatLine: LineParserFn;
  #spinner = 0;
  #ticker?: NodeJS.Timeout;
  #pendingEsc?: NodeJS.Timeout;
  readonly #startedAt = Date.now();

  constructor(params: ProgressBoxParams) {
    super(params);
    if (params.mode === "stream") {
      this.mode = "stream";
      this.steps = [];
      this.#formatLine = params.lineParser ?? ((line, isErr) => ({ text: line, isErr }));
    } else {
      this.mode = "steps";
      this.steps = (params.steps ?? []).map((title) => ({ title, state: "queued" as StepState }));
      this.#formatLine = () => ({ text: "", isErr: false });
    }

    this.#ticker = setInterval(() => {
      const hasActive = this.mode === "steps" ? this.steps.some((step) => step.state === "running") : true;
      if (!hasActive) return;
      this.#spinner = (this.#spinner + 1) % SPINNER_FRAMES.length;
      this.invalidate();
      this.tui.requestRender();
    }, 120);
  }

  stop(): void {
    if (this.#ticker) clearInterval(this.#ticker);
    if (this.#pendingEsc) clearTimeout(this.#pendingEsc);
  }

  setRunning(index: number): void {
    if (index >= this.steps.length) return;
    this.steps[index].state = "running";
    this.invalidate();
    this.tui.requestRender();
  }

  setDone(index: number, detail?: string, durationMs?: number): void {
    if (index >= this.steps.length) return;
    this.steps[index] = { ...this.steps[index], state: "done", detail, durationMs };
    this.invalidate();
    this.tui.requestRender();
  }

  setError(index: number, detail?: string, durationMs?: number): void {
    if (index >= this.steps.length) return;
    this.steps[index] = { ...this.steps[index], state: "error", detail, durationMs };
    this.invalidate();
    this.tui.requestRender();
  }

  get completedCount(): number { return this.steps.filter((step) => step.state === "done").length; }
  get errorCount(): number { return this.steps.filter((step) => step.state === "error").length; }
  get totalCount(): number { return this.steps.length; }

  appendLine(line: string, isErr: boolean): void {
    const normalized = line.replace(/\r/g, "").trim();
    if (!normalized || ARCHON_LOG_RE.test(normalized)) return;
    const event = this.#formatLine(normalized, isErr);
    if (!event?.text?.trim()) return;
    this.#totalEvents += 1;
    if (event.step) this.#currentStep = event.step;
    this.#messages.push({ text: event.text, isErr: event.isErr, timestamp: Date.now() });
    this.invalidate();
    this.tui.requestRender();
  }

  toggleExpanded(): void {
    this.#expanded = !this.#expanded;
    this.invalidate();
    this.tui.requestRender();
  }

  setStreamError(error: string): void {
    this.#error = error;
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

    if (data === "\x1c") {
      this.onAbort();
      return;
    }

    if (this.mode !== "stream") return;
    const expandKey = this.keyHint("app.tools.expand", "ctrl+o");
    if (this.matchesKey(data, "ctrl+o") || this.matchesKey(data, expandKey)) this.toggleExpanded();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    const elapsed = formatElapsed(Math.floor((Date.now() - this.#startedAt) / 1000));
    const body = this.mode === "steps"
      ? [...this.renderStepsHeader(elapsed), ...this.renderStepsBody()]
      : [...this.renderStreamHeader(elapsed), ...this.renderStreamBody()];
    body.push("");
    body.push(this.mode === "stream"
      ? `${this.panelGutter()}${this.fireDim(`[Esc] cancel · ${this.keyHint("app.tools.expand", "expand")} toggle`)}`
      : `${this.panelGutter()}${this.fireDim(`[Esc] cancel`)}`);
    const rows = [this.renderPanelPillRow(width), ...this.renderPanelRows(body, width)];
    this.cachedWidth = width;
    this.cachedLines = rows;
    return rows;
  }

  private renderStepsHeader(elapsed: string): string[] {
    const progress = `${this.completedCount}/${this.totalCount}`;
    const errBadge = this.errorCount > 0 ? ` · ${this.errorCount} error(s)` : "";
    return [
      `${this.panelGutter()}${this.fireAccentHot("◆")} ${this.theme.bold(this.fireAccentHot(this.title))} ${this.fireDim(`${progress}${errBadge} · ${elapsed}`)}`,
      "",
    ];
  }

  private renderStepsBody(): string[] {
    const visibleSteps = this.steps.slice(-this.maxLines);
    const rows: string[] = [];
    for (const step of visibleSteps) {
      let icon = "○ ";
      let color = (text: string) => this.fireMuted(text);
      switch (step.state) {
        case "running":
          icon = `${this.fireAccent(SPINNER_FRAMES[this.#spinner] ?? "•")} `;
          break;
        case "done":
          icon = this.fireSuccess("✓ ");
          color = (text: string) => this.fireSuccess(text);
          break;
        case "error":
          icon = this.fireWarning("✗ ");
          color = (text: string) => this.fireWarning(text);
          break;
      }
      let text = `${icon}${color(step.title)}`;
      if (step.detail) text += this.fireDim(` — ${step.detail}`);
      if (step.durationMs != null) text += this.fireDim(` (${formatElapsed(Math.floor(step.durationMs / 1000))})`);
      rows.push(`${this.panelGutter()}${text}`);
    }
    const dropped = Math.max(0, this.steps.length - this.maxLines);
    if (dropped > 0) rows.push(`${this.panelGutter()}${this.fireDim(`... and ${dropped} more above`)}`);
    return rows;
  }

  private renderStreamHeader(elapsed: string): string[] {
    const spinner = this.#messages.length === 0 && !this.#error
      ? this.fireAccent(SPINNER_FRAMES[this.#spinner] ?? "•")
      : this.getStateIcon();
    return [
      `${this.panelGutter()}${spinner} ${this.theme.bold(this.fireAccentHot(this.title))} ${this.fireDim(elapsed)}`,
      `${this.panelGutter()}${this.fireMuted(`events: ${this.#totalEvents} · ${this.#currentStep || "starting"}`)}`,
      "",
    ];
  }

  private renderStreamBody(): string[] {
    const rows: string[] = [];
    if (this.#error) rows.push(`${this.panelGutter()}${this.fireWarning(`❌ ${this.#error}`)}`);
    const visible = this.#expanded ? this.#messages : this.#messages.slice(-this.maxLines);
    for (const message of (visible.length > 0 ? visible : [{ text: "(waiting for output...)", isErr: false }])) {
      rows.push(`${this.panelGutter()}${message.isErr ? this.fireWarning(message.text) : this.fireFg(message.text)}`);
    }
    return rows;
  }

  private getStateIcon(): string {
    if (this.#error) return this.fireWarning("❌");
    if (this.#messages.length > 0) return this.fireSuccess("✅");
    return this.fireAccent("⏳");
  }
}

