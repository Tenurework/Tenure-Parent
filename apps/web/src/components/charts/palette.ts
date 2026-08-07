/**
 * Chart colour system — the single source of truth for every mark colour.
 *
 * Colours are the validated `--chart-1 … --chart-8` slots defined in globals.css
 * (hues chosen and CVD-checked in the design spec). Status semantics
 * (over-budget, failure) use the reserved `--error` / `--success` tokens, never a
 * categorical slot, so a status colour never impersonates a series.
 *
 * There are two ways to reach a slot, and the difference matters:
 *
 *   `slotColor(i)` — position-keyed. Correct only where the series list itself
 *   is fixed by the code (a stacked bar's `series` array, a line chart's named
 *   lines): position IS the identity there.
 *
 *   `slotsForKeys(keys)` — identity-keyed. Correct wherever the rows come from
 *   the data and can be re-sorted or filtered. The hue follows the key, so a
 *   category does not swap hues with its neighbour when a range filter changes
 *   which one ranks higher, and does not shift when the row count changes.
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

/**
 * The slot a key wants, derived from the key alone: FNV-1a (32-bit), then the
 * murmur3 fmix32 avalanche, then folded onto the eight slots. Deterministic
 * across processes and platforms — no `Math.random`, no insertion order, no
 * locale — so the same category is the same hue in a server render, a client
 * re-render and a screenshot test.
 *
 * The finalizer is not decoration. FNV's low bits are weak, and `% 8` reads only
 * those three: a character's ASCII case bit (0x20) cannot propagate down into
 * them, so without the mix `"CONTACT"` and `"Contact"` — and every other pair
 * differing by case alone — collide on the same slot every time. fmix32 pushes
 * the high bits down so every character of the key reaches the result.
 */
function preferredSlot(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) % CHART_SLOTS.length
}

/**
 * Assign a colour to each category key so the hue is a property of the key, not
 * of where the key happened to land in the array.
 *
 * Each key asks for `preferredSlot(key)`. Keys are resolved in canonical
 * (code-unit) order and a key whose slot is already claimed probes forward to the
 * next free one — so within a chart of ≤ 8 categories every segment still gets a
 * distinct hue, and which key yields on a collision is decided by the keys
 * themselves, never by the order they arrived in.
 *
 * What this guarantees: the returned colour for a key is identical for any
 * permutation of the same keys, and identical across two different key sets
 * unless the key actually collides with another key present in one of them.
 * (Beyond 8 keys the slots are exhausted and colours repeat — a chart with more
 * than eight categorical colours is unreadable anyway; group the tail.)
 */
export function slotsForKeys(keys: Iterable<string>): Map<string, string> {
  const canonical = [...new Set(keys)].sort()
  const taken = new Set<number>()
  const out = new Map<string, string>()
  for (const key of canonical) {
    const preferred = preferredSlot(key)
    let slot = preferred
    for (let step = 1; step <= CHART_SLOTS.length && taken.has(slot); step++) {
      slot = (preferred + step) % CHART_SLOTS.length
    }
    taken.add(slot)
    out.set(key, CHART_SLOTS[slot])
  }
  return out
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
