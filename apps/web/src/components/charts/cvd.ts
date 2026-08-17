/**
 * ANL-020-004 — colour-vision deficiency, computed rather than asserted.
 *
 * `globals.css` used to claim the eight categorical slots were "validated
 * CVD-safe in BOTH modes … via the data-viz validator". No validator existed in
 * this repository: the claim was a comment, the two named WARNs were a comment,
 * and nothing turned red if somebody edited a hue. `contrast.test.ts` checks
 * each slot against the card surface, which is a different question entirely —
 * eight slots can each clear 3:1 against the card and still be four hues to a
 * deuteranope.
 *
 * This is the arithmetic behind the claim: the Viénot, Brettel & Mollon (1999)
 * LMS dichromat simulation, then CIE76 ΔE between the simulated pair. It answers
 * "are these two series still telling apart" for protanopia, deuteranopia and
 * tritanopia, per theme, per pair — and `cvd.test.ts` pins the answer, including
 * the two WARNs, which are now expectations with measured numbers on them rather
 * than a sentence in a comment.
 *
 * Why CIE76 and not CIEDE2000: ΔE76 is a plain Euclidean distance in CIELAB, so
 * a failure is readable ("these two are 6 ΔE apart after simulation") and the
 * implementation has no branch a mistake can hide in. CIEDE2000's corrections
 * matter for near-threshold industrial tolerance work; the separations that
 * matter for categorical series are an order of magnitude larger than the point
 * where the two metrics disagree.
 *
 * What the first version of this file got wrong, recorded because the module's
 * whole purpose is not to be believed on its word: it clamped every simulation
 * into the display gamut before measuring ΔE. For protanopia and deuteranopia
 * nothing is clamped and that was harmless. For tritanopia the projection leaves
 * the cube by up to twice full scale, so the clamp collapsed six of the eight
 * slots onto two values and the audit reported pairs 0.45 ΔE apart as
 * indistinguishable hues. They are not hues at all. `outOfGamut` and `cvdAudit`
 * now separate "these two collide" from "this simulation has no answer", which
 * is the same distinction the rest of this codebase is built on.
 *
 * Consumers: `cvd.test.ts`, which is what gates the palette in `globals.css`.
 * That is the same shape as `src/lib/a11y/contrast.ts` — a colour-system
 * validator's product IS its audit; there is no runtime path that simulates
 * dichromacy, and inventing one to look "wired" would be the dishonest version.
 */
import { parseColor, type Rgb } from "@/lib/a11y/contrast"

export type Vision = "protanopia" | "deuteranopia" | "tritanopia"

/** The three dichromacies the simulation covers, in the order it reports them. */
export const VISION_TYPES: readonly Vision[] = ["protanopia", "deuteranopia", "tritanopia"]

/**
 * sRGB → linear. The 0.04045 knee is the sRGB transfer function's.
 *
 * Note this is NOT the 0.03928 knee `contrast.ts` uses: WCAG 2.x froze an older
 * value into its relative-luminance definition and the ratio has to be computed
 * with the number the criterion names. Colour conversion is not WCAG, so it uses
 * the real one. The two differ by ~0.001 of a channel; keeping each function on
 * its own spec's constant is cheaper than explaining a hybrid later.
 */
function toLinear(v: number): number {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function toSrgb(v: number): number {
  const c = Math.min(1, Math.max(0, v))
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return s * 255
}

/**
 * Viénot/Brettel/Mollon linear-RGB → LMS. The coefficients are the 1999 paper's
 * and are quoted for linear RGB, which is why `toLinear` runs first — feeding
 * gamma-encoded values in is the classic way to get a simulation that looks
 * plausible and is wrong by tens of ΔE.
 */
function rgbToLms(r: number, g: number, b: number): [number, number, number] {
  return [
    17.8824 * r + 43.5161 * g + 4.11935 * b,
    3.45565 * r + 27.1554 * g + 3.86714 * b,
    0.0299566 * r + 0.184309 * g + 1.46709 * b,
  ]
}

function lmsToRgb(l: number, m: number, s: number): [number, number, number] {
  return [
    0.080944 * l - 0.130504 * m + 0.116721 * s,
    -0.0102485 * l + 0.0540194 * m - 0.113615 * s,
    -0.000365294 * l - 0.00412163 * m + 0.693513 * s,
  ]
}

/**
 * Projects LMS onto the dichromat's reduced colour plane.
 *
 * A dichromat is missing one cone class, so their colour space is a plane rather
 * than a volume: the missing channel is not zeroed (that would darken everything
 * and invent contrast that is not there) but reconstructed from the two that
 * remain, which is what makes two hues collapse onto each other.
 */
function project(lms: [number, number, number], vision: Vision): [number, number, number] {
  const [l, m, s] = lms
  switch (vision) {
    case "protanopia":
      return [2.02344 * m - 2.52581 * s, m, s]
    case "deuteranopia":
      return [l, 0.494207 * l + 1.24827 * s, s]
    case "tritanopia":
      return [l, m, -0.395913 * l + 0.801109 * m]
  }
}

/** The projection's answer in LINEAR RGB, before anything clamps it. */
function projectedLinear(color: Rgb, vision: Vision): [number, number, number] {
  const lms = rgbToLms(toLinear(color.r), toLinear(color.g), toLinear(color.b))
  return lmsToRgb(...project(lms, vision))
}

/**
 * What a dichromat of this type sees when the display shows `color`.
 *
 * `toSrgb` clamps, as a display does. That is correct for producing a swatch and
 * WRONG as an input to ΔE, which is why `outOfGamut` exists and why
 * `separationUnder` refuses rather than scoring a clamped pair. See the note
 * there: the clamp does not merely lose precision, it manufactures collisions.
 */
export function simulate(color: Rgb, vision: Vision): Rgb {
  const [r, g, b] = projectedLinear(color, vision)
  return { r: toSrgb(r), g: toSrgb(g), b: toSrgb(b), a: color.a }
}

/**
 * How far outside the display gamut the projection landed, on its worst channel,
 * or `null` when the simulated colour is one a screen can actually show.
 *
 * ## Why this is not a rounding detail
 *
 * The Viénot single-plane projection is quoted for protanopia and deuteranopia;
 * its tritanopia arm is an approximation, and on real chart hues it leaves the
 * cube by whole multiples of full scale. Measured over the eight `--chart-*`
 * slots: every channel of every protan and deutan simulation lands inside the
 * cube, and the tritan blue channel reaches **-2.042 and +1.451** — that is
 * -521 and +370 on a 0–255 axis.
 *
 * `toSrgb` clamps all of those to 0 or 255. So six of the eight light slots and
 * seven of the eight dark slots collapse onto two clamped values, and ΔE then
 * reports pairs 0.45 and 0.50 apart — "the same colour" — for hues whose
 * simulation was never computable in the first place. That is the collapse this
 * codebase exists to refuse: "we could not look" is not "we looked and found
 * nothing", and a palette audit that reports the second when it means the first
 * would have sent somebody to redesign a hue over an arithmetic artefact.
 *
 * The tolerance is in LINEAR space, where the projection's arithmetic happens.
 * 1e-3 is a tenth of one 8-bit step, so an exact-black or exact-white boundary
 * that rounds a hair negative still reads as representable — the deuteranopia
 * simulation of `--chart-2` on light lands at -0.0003 and is a real answer.
 */
export const GAMUT_TOLERANCE = 1e-3

export type GamutExcursion = {
  vision: Vision
  channel: "r" | "g" | "b"
  /** The linear value the projection produced. Outside [0, 1] by construction. */
  linear: number
}

export function outOfGamut(color: Rgb, vision: Vision): GamutExcursion | null {
  const linear = projectedLinear(color, vision)
  const channels: ("r" | "g" | "b")[] = ["r", "g", "b"]
  let worst: GamutExcursion | null = null
  for (let i = 0; i < 3; i++) {
    const value = linear[i]
    const by = value < -GAMUT_TOLERANCE ? -value : value > 1 + GAMUT_TOLERANCE ? value - 1 : 0
    if (by === 0) continue
    const previous = worst === null ? 0 : Math.max(-worst.linear, worst.linear - 1)
    if (by > previous) worst = { vision, channel: channels[i], linear: value }
  }
  return worst
}

/** CIE 1931 XYZ (D65) from sRGB, via the linear stage. */
function toXyz(color: Rgb): [number, number, number] {
  const r = toLinear(color.r)
  const g = toLinear(color.g)
  const b = toLinear(color.b)
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ]
}

const D65: [number, number, number] = [0.95047, 1.0, 1.08883]

/** CIELAB (D65) — the space ΔE is defined in. */
export function toLab(color: Rgb): [number, number, number] {
  const xyz = toXyz(color)
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29)
  const [fx, fy, fz] = [f(xyz[0] / D65[0]), f(xyz[1] / D65[1]), f(xyz[2] / D65[2])]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIE76 ΔE — Euclidean distance in CIELAB. */
export function deltaE76(a: Rgb, b: Rgb): number {
  const la = toLab(a)
  const lb = toLab(b)
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2])
}

/**
 * How far apart two chart colours remain for a viewer with `vision`.
 *
 * Accepts the hex strings the stylesheet holds. Throws rather than returning 0
 * for anything `parseColor` does not understand: a silent 0 would report a
 * `var(--x)` typo as the worst possible collision, and a silent Infinity would
 * report it as safe. Neither is an answer.
 *
 * Throws for the same reason when either simulation left the gamut. A clamped
 * pair produces a number, and the number is about the clamp rather than about
 * the colours — see `outOfGamut`. Callers that are auditing a whole palette want
 * `cvdAudit`, which reports the unscorable pairs instead of dropping them.
 */
export function separationUnder(a: string | Rgb, b: string | Rgb, vision: Vision): number {
  const toRgb = (v: string | Rgb) => {
    const parsed = typeof v === "string" ? parseColor(v) : v
    if (!parsed) throw new Error(`separationUnder(): not a colour — ${JSON.stringify(v)}`)
    return parsed
  }
  const [left, right] = [toRgb(a), toRgb(b)]
  for (const [color, which] of [
    [left, "a"],
    [right, "b"],
  ] as const) {
    const excursion = outOfGamut(color, vision)
    if (excursion) {
      throw new Error(
        `separationUnder(): the ${vision} projection of ${which} leaves the display gamut ` +
          `(linear ${excursion.channel} = ${excursion.linear.toFixed(3)}), so ΔE would measure the ` +
          `clamp rather than the colours.`,
      )
    }
  }
  return deltaE76(simulate(left, vision), simulate(right, vision))
}

/**
 * The floor a categorical palette has to clear, in CIE76 ΔE, after simulation.
 *
 * 20 is the number this palette is held to. It is above the ~11–13 range where
 * two adjacent slots start reading as "the same colour, slightly different" in a
 * 2px-gapped bar, and below the ~30 that eight hues cannot all achieve
 * simultaneously — a palette forced to 30 everywhere is four hues and four greys.
 * Pairs below it are not an automatic failure; they are WARNs that must be
 * enumerated with their measured value, so the secondary encoding the chart kit
 * already mandates (legend + direct labels + 2px gaps) is a decision on the
 * record rather than an assumption.
 */
export const CVD_SEPARATION_FLOOR = 20

export type CvdPair = {
  vision: Vision
  /** 1-based slot numbers, as they are named in globals.css. */
  a: number
  b: number
  deltaE: number
}

/** A slot whose simulation is not a colour, and therefore not comparable. */
export type Unscorable = GamutExcursion & {
  /** 1-based slot number, as globals.css names it. */
  slot: number
}

export type CvdAudit = {
  /** Scored pairs below the floor, worst-first. */
  warnings: CvdPair[]
  /** Slots the projection could not place inside the gamut, by vision then slot. */
  unscorable: Unscorable[]
  /** How many pairs were actually measured. */
  scored: number
  /** How many pairs could not be, because a slot in them is unscorable. */
  skipped: number
}

/**
 * The whole palette, audited: which pairs collide, and which could not be asked.
 *
 * This replaced a `cvdWarnings()` that returned only the first list. That shape
 * is the one that misleads, and it did: it reported 20 collisions on light and 19
 * on dark, of which 11 and 9 were tritanopia pairs whose simulations had been
 * clamped from linear values as far out as -2.042 (see `outOfGamut`). A reader
 * would have concluded the palette fails badly for tritanopes. The truth is
 * narrower and more useful — it fails measurably for red-green dichromacy, and
 * for tritanopia this simulation cannot answer at all.
 *
 * So both numbers come back from one call, and `scored + skipped` is the total
 * number of pairs, which is the arithmetic that makes a silent drop impossible.
 */
export function cvdAudit(colors: string[], floor: number = CVD_SEPARATION_FLOOR): CvdAudit {
  const warnings: CvdPair[] = []
  const unscorable: Unscorable[] = []
  let scored = 0
  let skipped = 0

  for (const vision of VISION_TYPES) {
    const parsed = colors.map((c, i) => {
      const rgb = parseColor(c)
      if (!rgb) throw new Error(`cvdAudit(): slot ${i + 1} is not a colour — ${JSON.stringify(c)}`)
      return rgb
    })
    const excursions = parsed.map((rgb) => outOfGamut(rgb, vision))
    excursions.forEach((excursion, i) => {
      if (excursion) unscorable.push({ ...excursion, slot: i + 1 })
    })

    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        if (excursions[i] || excursions[j]) {
          skipped++
          continue
        }
        scored++
        const deltaE = deltaE76(simulate(parsed[i], vision), simulate(parsed[j], vision))
        if (deltaE < floor) warnings.push({ vision, a: i + 1, b: j + 1, deltaE })
      }
    }
  }

  warnings.sort((x, y) => x.deltaE - y.deltaE)
  return { warnings, unscorable, scored, skipped }
}
