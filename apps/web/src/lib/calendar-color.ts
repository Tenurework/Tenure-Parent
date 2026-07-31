/**
 * Deterministic per-club calendar colour. A club always maps to the same hue,
 * so its events read consistently across the time grid and the "My calendars"
 * rail (the Outlook pattern: colour follows the calendar). Shared by the client
 * time-grid and the server-rendered sidebar so the two never drift.
 *
 * Theme handling: the swatch is emitted as CSS custom properties carrying BOTH
 * the light and the dark values, and `.cal-chip` in globals.css selects the
 * right pair per theme. The previous version returned a single hard-coded
 * `hsl(h 24% 94%)` fill — correct on the paper card, and a glaring near-white
 * block on the #0f1113 dark card. It was the one surface in the product that
 * ignored dark mode entirely.
 *
 * Hues lead with the brand's warm-forward order (grove green, amber, teal…) to
 * match the chart palette. Colour is never the sole encoding: every chip also
 * carries its club name, and the "My calendars" rail names each colour.
 */
const CLUB_HUES = [152, 24, 190, 288, 210, 340, 128, 262]

export function clubHue(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return CLUB_HUES[h % CLUB_HUES.length]
}

export interface ClubSwatch {
  /** The saturated "spine" colour — legend dots and the chip's leading rule. */
  border: string
  /** Custom properties consumed by `.cal-chip`; spread onto the element style. */
  vars: Record<string, string>
}

/**
 * The event-chip palette for a club.
 *
 * `border` is a mid-tone that reads on both surfaces, so it can be used
 * directly for a small solid legend swatch. `vars` must be spread into the
 * `style` prop of an element carrying `.cal-chip`, which resolves light/dark.
 */
export function clubSwatch(seed: string): ClubSwatch {
  const h = clubHue(seed)
  return {
    border: `hsl(${h} 42% 42%)`,
    vars: {
      "--chip-bg": `hsl(${h} 30% 93%)`,
      "--chip-border": `hsl(${h} 42% 42%)`,
      "--chip-text": `hsl(${h} 40% 22%)`,
      "--chip-bg-dark": `hsl(${h} 32% 15%)`,
      "--chip-border-dark": `hsl(${h} 48% 55%)`,
      "--chip-text-dark": `hsl(${h} 45% 85%)`,
    },
  }
}
