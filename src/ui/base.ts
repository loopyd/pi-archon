import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { ARCHON_PILL_DEFAULT, ARCHON_THEME_RGB, PANEL_GUTTER, PANEL_SIDE_PAD } from "../constants";
import type { TuiBaseParams } from "../types";
import { toPillLabel } from "../helpers";
import { fire } from "./rgb";

const PANEL_BG_ON = `\x1b[48;2;${ARCHON_THEME_RGB.panel[0]};${ARCHON_THEME_RGB.panel[1]};${ARCHON_THEME_RGB.panel[2]}m`;
const PANEL_BG_OFF = "\x1b[49m";

function withPanelBg(text: string): string {
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
}

export abstract class TuiBase {
  readonly tui: NonNullable<TuiBaseParams["tui"]>;
  readonly theme: NonNullable<TuiBaseParams["theme"]>;
  readonly title: string;
  readonly onAbort: () => void;
  readonly maxLines: number;
  readonly pill: string;

  cachedWidth?: number;
  cachedLines?: string[];

  constructor(params: TuiBaseParams) {
    this.tui = params.tui;
    this.theme = params.theme;
    this.title = params.title;
    this.onAbort = params.onAbort;
    this.maxLines = params.maxLines ?? 5;
    this.pill = toPillLabel(params.pill || params.title.split(/[\s-]+/, 1)[0] || ARCHON_PILL_DEFAULT);
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  pad(content: string, w: number): string {
    const truncated = truncateToWidth(content, w);
    const fill = Math.max(0, w - visibleWidth(truncated));
    return `${truncated}${" ".repeat(fill)}`;
  }

  protected fireFg(text: string): string { return fire.fg(text); }
  protected panelLabel(text: string): string { return fire.panel(fire.accentHot(` ${text} `)); }
  protected panelFill(width: number): string { return fire.panel(" ".repeat(Math.max(0, width))); }
  protected plainFill(width: number): string { return fire.bg(" ".repeat(Math.max(0, width))); }
  protected sidePad(): string { return " ".repeat(PANEL_SIDE_PAD); }
  protected panelGutter(): string { return PANEL_GUTTER; }
  protected fireBg(text: string): string { return fire.bg(text); }
  protected firePanel(text: string): string { return fire.panel(text); }
  protected fireBorder(text: string): string { return fire.border(text); }
  protected fireAccent(text: string): string { return fire.accent(text); }
  protected fireAccentHot(text: string): string { return fire.accentHot(text); }
  protected fireSuccess(text: string): string { return fire.success(text); }
  protected fireWarning(text: string): string { return fire.warning(text); }
  protected fireMuted(text: string): string { return fire.muted(text); }
  protected fireDim(text: string): string { return fire.dim(text); }

  protected paintRow(row: string, width: number): string {
    const safe = visibleWidth(row) > width ? truncateToWidth(row, width) : row;
    const fill = Math.max(0, width - visibleWidth(safe));
    return this.fireBg(`${safe}${" ".repeat(fill)}`);
  }

  protected renderPanelRows(lines: string[], width: number): string[] {
    const innerWidth = Math.max(1, width - (PANEL_SIDE_PAD * 2));
    const contentWidth = Math.max(1, innerWidth - visibleWidth(PANEL_GUTTER));
    const sidePad = this.sidePad();
    return lines.map((line) => {
      const truncated = visibleWidth(line) > contentWidth ? truncateToWidth(line, contentWidth) : line;
      const fill = Math.max(0, innerWidth - visibleWidth(truncated));
      return `${sidePad}${withPanelBg(truncated)}${this.panelFill(fill)}${sidePad}`;
    });
  }

  protected renderPanelPillRow(width: number, text = this.pill): string {
    const innerWidth = Math.max(1, width - (PANEL_SIDE_PAD * 2));
    const pill = this.panelLabel(text);
    const truncated = visibleWidth(pill) > innerWidth ? truncateToWidth(pill, innerWidth) : pill;
    const fill = Math.max(0, innerWidth - visibleWidth(truncated));
    return `${this.sidePad()}${truncated}${" ".repeat(fill)}${this.sidePad()}`;
  }

  protected keyHint(_key: string, label?: string): string {
    return `[${label || _key}]`;
  }

  protected matchesKey(data: string, key: string): boolean {
    if (data === "\u001b" && key === "escape") return true;
    if (data === "\x1c" && key === "ctrl+c") return true;
    if (data.toLowerCase() === key.toLowerCase()) return true;
    return false;
  }
}
