/**
 * Chart colour system — the single source of truth for every mark colour.
 *
 * Colours are the validated `--chart-1 … --chart-8` slots defined in globals.css
 * (hues chosen and CVD-checked in the design spec). They are assigned to entities
 * in FIXED SLOT ORDER and never cycled or repainted when a filter changes the
 * series count: the hue follows the entity, not its rank. Status semantics
 * (over-budget, failure) use the reserved `--error` / `--success` tokens, never a
 * categorical slot, so a status colour never impersonates a series.
 *
 * Everything is a CSS var so charts theme automatically in light/dark and honour
 * the high-contrast overrides — no raw hex ever reaches a mark.
 */

/** The eight categorical slots, in fixed order. */
export const CHART_SLOTS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
] as const

/** Colour for categorical slot `i` (0-based). Single-series charts pass 0. */
export function slotColor(i: number): string {
  return CHART_SLOTS[i % CHART_SLOTS.length]
}

/** Recessive chart furniture. */
export const CHART_GRID = "var(--chart-grid)"
export const CHART_AXIS = "var(--chart-axis)"

/** The card surface a chart sits on — used for gaps and marker rings. */
export const SURFACE = "var(--bg-surface)"

/** Reserved status tokens — only where the colour *means* good / bad. */
export const STATUS = {
  error: "var(--error)",
  success: "var(--success)",
  warning: "var(--warning)",
  info: "var(--info)",
} as const

/**
 * A muted reference fill for NON-DATA marks only: a target line, a baseline
 * bar, the unfilled remainder of a meter track.
 *
 * Do not use it for a data series. `--border-strong` is a hairline token at
 * roughly 1.4:1 against the card, which is legible as a 1px rule and invisible
 * as a filled area — and "Vacant seats" is precisely the series a roster chart
 * exists to draw attention to. Use `MUTED_SERIES` for a real series that should
 * read as secondary.
 */
export const REFERENCE = "var(--border-strong)"

/**
 * For a data series that is genuinely secondary — vacant, remaining, in flight
 * — but still has to be seen and compared. Carries enough weight to read as a
 * filled area in both themes without competing with the primary series.
 */
export const MUTED_SERIES = "var(--text-3)"
