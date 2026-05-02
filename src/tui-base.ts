import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { TuiBaseParams } from "./types";

/** Minimal shared base for interactive terminal components */
export abstract class TuiBase {
  readonly tui: NonNullable<TuiBaseParams["tui"]>;
  readonly theme: NonNullable<TuiBaseParams["theme"]>;
  readonly title: string;
  readonly onAbort: () => void;
  readonly maxLines: number;

  cachedWidth?: number;
  cachedLines?: string[];

  constructor(params: TuiBaseParams) {
    this.tui = params.tui;
    this.theme = params.theme;
    this.title = params.title;
    this.onAbort = params.onAbort;
    this.maxLines = params.maxLines ?? 5;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  /** Pad content to width using truncation + space fill */
  pad(content: string, w: number): string {
    const truncated = truncateToWidth(content, w);
    const fill = Math.max(0, w - visibleWidth(truncated));
    return `${truncated}${" ".repeat(fill)}`;
  }

  /** Format a keyboard hint (e.g. "ctrl+o") into display text */
  protected keyHint(_key: string, label?: string): string {
    return `[${label || _key}]`;
  }

  /** Compare raw input data against a named key spec */
  protected matchesKey(data: string, key: string): boolean {
    if (data === "\u001b" && key === "escape") return true;
    if (data === "\x1c" && key === "ctrl+c") return true;
    if (data.toLowerCase() === key.toLowerCase()) return true;
    return false;
  }
}
