import { ARCHON_THEME_RGB } from "../constants";
import type { RgbPainter } from "../types";

const rgb = (mode: 38 | 48, [r, g, b]: readonly [number, number, number], text: string) => `\x1b[${mode};2;${r};${g};${b}m${text}\x1b[${mode === 38 ? 39 : 49}m`;

export const fire: RgbPainter = {
  rgb,
  fg: (text: string) => rgb(38, ARCHON_THEME_RGB.text, text),
  text: (text: string) => rgb(38, ARCHON_THEME_RGB.text, text),
  bg: (text: string) => rgb(48, ARCHON_THEME_RGB.bg, text),
  panel: (text: string) => rgb(48, ARCHON_THEME_RGB.panel, text),
  border: (text: string) => rgb(38, ARCHON_THEME_RGB.border, text),
  accent: (text: string) => rgb(38, ARCHON_THEME_RGB.accent, text),
  accentHot: (text: string) => rgb(38, ARCHON_THEME_RGB.accentHot, text),
  success: (text: string) => rgb(38, ARCHON_THEME_RGB.success, text),
  warning: (text: string) => rgb(38, ARCHON_THEME_RGB.warning, text),
  muted: (text: string) => rgb(38, ARCHON_THEME_RGB.muted, text),
  dim: (text: string) => rgb(38, ARCHON_THEME_RGB.dim, text),
};
