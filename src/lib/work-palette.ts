// Chart palette for the time tracker.
//
// These eight hues are the validated categorical set, stepped for a dark
// surface and re-validated against this app's panel colour (#111827):
// lightness band, chroma floor, CVD separation (worst adjacent ΔE 8.4),
// normal-vision floor (19.3) and 3:1 contrast all pass.
//
// Do not hand-pick new hues — a ninth colour is indistinguishable from an
// existing one under colour-vision deficiency. Categories past the chart's
// series ceiling fold into "Övrigt" instead.

export const CHART_SURFACE = "#111827";

export const PALETTE_SLOTS: { name: string; hex: string }[] = [
  { name: "Blå", hex: "#3987e5" },
  { name: "Orange", hex: "#d95926" },
  { name: "Turkos", hex: "#199e70" },
  { name: "Gul", hex: "#c98500" },
  { name: "Magenta", hex: "#d55181" },
  { name: "Grön", hex: "#008300" },
  { name: "Violett", hex: "#9085e9" },
  { name: "Röd", hex: "#e66767" },
];

export const PALETTE_HEXES: string[] = PALETTE_SLOTS.map((s) => s.hex);

/** Everything beyond the series ceiling collapses into this neutral. */
export const OTHER_COLOR = "#64748b";
export const OTHER_LABEL = "Övrigt";

/** The picker offers the eight hues plus the neutral (for catch-all buckets). */
export const PICKABLE_COLORS: { name: string; hex: string }[] = [
  ...PALETTE_SLOTS,
  { name: "Neutral", hex: OTHER_COLOR },
];

/** Max distinct hues in one chart — the tail folds into OTHER. */
export const SERIES_CEILING = 6;

/**
 * Stack/legend order follows this list, so touching segments are always the
 * pairs the palette was validated on — never an order that happens to fall
 * out of "biggest first".
 */
export function paletteRank(hex: string): number {
  const i = PALETTE_HEXES.indexOf(hex.toLowerCase());
  return i === -1 ? PALETTE_HEXES.length : i;
}

/** Sequential blue ramp for the activity heatmap: darker = less, brighter = more. */
export const HEAT_RAMP = ["#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4"];
export const HEAT_EMPTY = "rgba(255,255,255,0.045)";

/** Chart chrome — recessive by design; text never wears a series colour. */
export const INK = {
  primary: "#ffffff",
  secondary: "#c3c2b7",
  muted: "#898781",
  grid: "rgba(255,255,255,0.06)",
  axis: "rgba(255,255,255,0.12)",
};

/** Bucket a value 0..1 onto the sequential ramp. */
export function heatColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return HEAT_EMPTY;
  const ratio = value / max;
  const index = Math.min(HEAT_RAMP.length - 1, Math.floor(ratio * HEAT_RAMP.length));
  return HEAT_RAMP[index];
}
