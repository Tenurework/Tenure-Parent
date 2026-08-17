/**
 * GE-143-033 — the chart prohibitions, as something that can fail.
 *
 * The requirement: "Prohibit 3D/perspective distortion, decorative gauges,
 * exploding pies, unjustified dual axes, silent truncated axes, rainbow
 * categorical scales, status colors reused arbitrarily, hidden denominators, and
 * visualized AI numbers without canonical provenance."
 *
 * Nine prohibitions, and they are not all the same kind of thing. Three of them
 * are constructs a scanner can see in the source. Four are properties of the
 * marks the kit ships and are true by construction — the test below asserts them
 * against the real component source rather than trusting this sentence. Two are
 * judgements about a particular chart's data and cannot be decided from code at
 * all. `PROHIBITIONS` says which is which per prohibition, because a register
 * that implied all nine were enforced would be the more comfortable lie and the
 * more expensive one: it is the two nobody is checking that need naming.
 *
 * ## The one that was live
 *
 * "Silent truncated axes". `Sparkline` scaled its line between the minimum and
 * maximum of its own data — `(v - min) / span` — with `aria-hidden` on the SVG
 * and no label anywhere. A tile whose series went 100, 100, 101 drew a line from
 * the floor to the ceiling of the box: a 1% change rendered as a full-height
 * climb, with nothing on screen, in the DOM or in the accessibility tree saying
 * the axis did not start at zero. `scaleDisclosure` computes the sentence that
 * says so and `Sparkline` renders it; the shape of the line is unchanged,
 * because for a 34-pixel trend line min–max is the right scale — what was wrong
 * was that it was silent.
 */

export type Enforcement =
  /** A scanner can see it in the source; `detect` finds it and the test fails. */
  | "scan"
  /** A property of the shipped marks, asserted against their source in the test. */
  | "construction"
  /** Neither: it depends on what a particular chart is OF. Named, not implied. */
  | "review"

export interface Prohibition {
  id: string
  /** The requirement's own words. */
  prohibited: string
  why: string
  enforcement: Enforcement
  /** For `scan`: what it looks like in source. */
  detect?: RegExp
  /** For `construction` / `review`: where the guarantee comes from, or does not. */
  note?: string
}

export const PROHIBITIONS: readonly Prohibition[] = [
  {
    id: "3d-perspective",
    prohibited: "3D / perspective distortion",
    why: "Perspective makes the near end of a series larger than the far end, so the reader compares foreshortened areas rather than values.",
    enforcement: "scan",
    // `rotate(` alone is legitimate: DonutChart rotates arcs into place in 2D.
    detect: /\b(?:perspective\s*\(|rotate3d\s*\(|rotateX\s*\(|rotateY\s*\(|matrix3d\s*\()/,
  },
  {
    id: "exploding-pie",
    prohibited: "exploding pies",
    why: "Pulling a slice out of a pie moves its centroid; the reader's estimate of its share moves with it, and the offset encodes nothing.",
    enforcement: "scan",
    detect: /\b(?:explode|explodedSlice|sliceOffset|pullOut)\b/,
  },
  {
    id: "decorative-gauge",
    prohibited: "decorative gauges",
    why: "A speedometer spends a semicircle of ink on one number and a needle angle the reader has to translate back into it.",
    enforcement: "scan",
    detect: /\b(?:GaugeChart|SpeedometerChart|needleAngle|dialGauge)\b/,
  },
  {
    id: "silent-truncated-axis",
    prohibited: "silent truncated axes",
    why: "An axis that does not start at zero exaggerates change by whatever the ratio of the visible span to the full one happens to be. Truncation is sometimes right; silence never is.",
    enforcement: "construction",
    note: "The three axis marks (BarChart, HBarChart, LineAreaChart) scale from zero — asserted against their source below. Sparkline scales min–max, by design for a 34px trend line, and discloses it through `scaleDisclosure` in its title and label.",
  },
  {
    id: "dual-axis",
    prohibited: "unjustified dual axes",
    why: "Two scales in one frame let the author choose where the lines cross, which is the same as choosing the conclusion.",
    enforcement: "construction",
    note: "BarChart's `overlayLine` is drawn through the SAME `hAt` as the bars — asserted below. No mark in the kit accepts a second y domain.",
  },
  {
    id: "rainbow-categorical",
    prohibited: "rainbow categorical scales",
    why: "A hue ramp implies an order the categories do not have, and its lightness is uneven, so some categories shout.",
    enforcement: "construction",
    note: "Categorical colour comes from the eight `--chart-*` tokens through `palette.ts`, which is CVD-audited by `cvd.test.ts`. No chart module generates hues arithmetically — asserted below.",
  },
  {
    id: "status-colour-reuse",
    prohibited: "status colors reused arbitrarily",
    why: "If red is a category on one chart and a failure on the next, the reader has to learn the legend twice and will not.",
    enforcement: "review",
    note: "Not scannable: FinanceDashboard paints the over-budget slice in the error token, which is the status colour used FOR its status meaning and correct. A detector could not tell that from the same token used as category three.",
  },
  {
    id: "hidden-denominator",
    prohibited: "hidden denominators",
    why: "A percentage without its base is unfalsifiable — 50% of two is not 50% of two thousand.",
    enforcement: "review",
    note: "Not scannable: it is a property of what a chart is of. `ChartFrame` carries unit and source for the charts that sit in one, which is where this is answerable; GE-143-029 is the item that makes the frame mandatory.",
  },
  {
    id: "ai-numbers-without-provenance",
    prohibited: "visualized AI numbers without canonical provenance",
    why: "A number a model produced, drawn in the same ink as a number the ledger produced, is indistinguishable from it.",
    enforcement: "review",
    note: "Not scannable from a chart module: provenance is a property of the data handed in. `ChartFrame`'s `source` is the disclosure; making it mandatory for AI-produced series is GE-143-037's work.",
  },
]

/** The prohibitions a scanner enforces, with their detectors. */
export const SCANNED_PROHIBITIONS = PROHIBITIONS.filter(
  (p): p is Prohibition & { detect: RegExp } => p.enforcement === "scan" && p.detect !== undefined,
)

export interface ProhibitionOffence {
  id: string
  prohibited: string
  /** The line of source that matched. */
  line: string
}

/** Prohibited constructs a module's source names. `[]` is the passing answer. */
export function prohibitedConstructs(source: string): ProhibitionOffence[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
  const offences: ProhibitionOffence[] = []
  for (const line of code.split("\n")) {
    for (const prohibition of SCANNED_PROHIBITIONS) {
      if (prohibition.detect.test(line)) {
        offences.push({ id: prohibition.id, prohibited: prohibition.prohibited, line: line.trim() })
      }
    }
  }
  return offences
}

// ─── The truncated axis, disclosed ───────────────────────────────────────────

export interface ScaleDisclosure {
  /** The floor of the drawn scale. */
  floor: number
  /** The ceiling of the drawn scale. */
  ceiling: number
  /** Whether the floor is something other than zero — i.e. the axis is truncated. */
  truncated: boolean
  /**
   * How much the truncation magnifies change: the drawn slope divided by the
   * slope a zero-based axis would have given. 1 when the axis starts at zero.
   * `null` when the ceiling is zero or below and the ratio has no meaning —
   * "cannot be computed" rather than a fabricated 1.
   */
  exaggeration: number | null
  /** The sentence a mark on this scale has to say out loud. */
  sentence: string
}

const round = (value: number) => Math.round(value * 10) / 10

/**
 * What a mark must disclose about the scale it drew.
 *
 * The exaggeration factor is the honest number, and it is arithmetic rather than
 * an adjective: a series spanning 100–101 drawn min–max has a visible span of 1
 * against a zero-based span of 101, so its slope is 101× steeper than the truth.
 * Saying "the axis starts at 100" leaves the reader to work that out; saying it
 * is 101× is the disclosure.
 */
export function scaleDisclosure(values: readonly number[], floor?: number): ScaleDisclosure {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) {
    return {
      floor: 0,
      ceiling: 0,
      truncated: false,
      exaggeration: null,
      sentence: "No values to plot.",
    }
  }

  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const drawnFloor = floor ?? min
  const truncated = drawnFloor !== 0
  const drawnSpan = max - drawnFloor
  const zeroSpan = max

  const exaggeration =
    !truncated || zeroSpan <= 0 || drawnSpan <= 0 ? (truncated ? null : 1) : round(zeroSpan / drawnSpan)

  if (!truncated) {
    return {
      floor: 0,
      ceiling: max,
      truncated: false,
      exaggeration: 1,
      sentence: `From 0 to ${max}. The axis starts at zero.`,
    }
  }

  return {
    floor: drawnFloor,
    ceiling: max,
    truncated: true,
    exaggeration,
    sentence:
      exaggeration === null
        ? `From ${drawnFloor} to ${max}. The axis starts at ${drawnFloor}, not zero, so this shape overstates the change by an amount that cannot be computed from these values.`
        : `From ${drawnFloor} to ${max}. The axis starts at ${drawnFloor}, not zero, so this shape overstates the change by about ${exaggeration}×.`,
  }
}
