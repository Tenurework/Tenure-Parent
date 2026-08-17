import fs from "fs"
import path from "path"

import { GLOBALS_CSS, readThemes, token, type ThemeName, type TokenMap } from "@/lib/a11y/theme-tokens"

import {
  CVD_SEPARATION_FLOOR,
  cvdAudit,
  deltaE76,
  outOfGamut,
  separationUnder,
  simulate,
  VISION_TYPES,
  type CvdAudit,
  type CvdPair,
} from "./cvd"

/**
 * ANL-020-004 / ANL-040-005 — the colour-vision audit `cvd.ts` was written to be,
 * and the file that was missing.
 *
 * `cvd.ts` ends its header with "Consumers: `cvd.test.ts`, which is what gates
 * the palette in `globals.css`". That file did not exist. 190 lines of Viénot /
 * Brettel / Mollon simulation and CIELAB ΔE were imported by nothing —
 * `grep -rn "cvd" apps packages tools tests` returned only the module itself —
 * so the sentence describing its own consumer was as unchecked as the stylesheet
 * comment it was written to replace. A validator nothing runs is a claim, which
 * is the exact failure its header warns about one paragraph earlier.
 *
 * `globals.css:13` says the eight chart slots are "validated CVD-safe in BOTH
 * modes … via the data-viz validator". No validator ran. This file runs one, and
 * the answer is not the one the comment implies:
 *
 *   * **ten of the 84 slot pairs** fall below the ΔE-20 floor `cvd.ts` declares,
 *     in the light themes AND in the dark themes;
 *   * on dark, `--chart-5` and `--chart-7` are **1.61 ΔE** apart for a
 *     deuteranope and `--chart-2` and `--chart-4` are **4.22** — the same colour
 *     in each case, and both pairs are on screen together in the reports panel;
 *   * for **tritanopia the simulation cannot answer at all** on this palette, and
 *     saying so is the point of the second half of this file.
 *
 * ## Why this test does not assert a floor
 *
 * `warnings.length === 0` would be red today, and going red on a fact nobody in
 * this wave can fix (eight simultaneously separable hues is a palette redesign,
 * and `globals.css` belongs to the design system) only gets a guard deleted.
 *
 * `cvd.ts` states the contract that IS enforceable: pairs below the floor "are
 * not an automatic failure; they are WARNs that must be enumerated with their
 * measured value, so the secondary encoding the chart kit already mandates … is a
 * decision on the record rather than an assumption."
 *
 * So they are enumerated, to two decimal places, and pinned. Any hue edit that
 * moves any pair fails this test and has to be re-decided, and the same
 * enumeration is published in `docs/architecture/anl-analytics-limitations.md`,
 * which this file holds to the computation in both directions.
 */

/** The eight categorical slots, as `globals.css` names them. */
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const

const THEMES = readThemes()

const LIMITATIONS_DOC = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "docs",
  "architecture",
  "anl-analytics-limitations.md",
)

function slotColors(theme: TokenMap): string[] {
  return SLOTS.map((n) => token(theme, `--chart-${n}`))
}

function auditOf(name: ThemeName): CvdAudit {
  return cvdAudit(slotColors(THEMES[name]))
}

/** One WARN, rendered the way the published document lists it. */
function line(pair: CvdPair): string {
  return `${pair.vision} ${pair.a}~${pair.b} ${pair.deltaE.toFixed(2)}`
}

/**
 * The measured collisions, as of this commit.
 *
 * Written out rather than snapshotted: `toMatchSnapshot` writes itself on first
 * run, so it would have recorded whatever the palette happened to be and called
 * it expected. These numbers were computed, read, and are stated here as the
 * claim the document publishes.
 *
 * `light` and `light-contrast` are identical, and so are `dark` and
 * `dark-contrast`: `@media (prefers-contrast: more)` overrides text and border
 * tokens and does not touch `--chart-1…8`. That is itself a finding — the
 * high-contrast themes do nothing for a dichromat — and it is asserted below
 * rather than assumed.
 */
const RECORDED = {
  light: [
    "deuteranopia 2~4 5.29",
    "protanopia 2~4 12.16",
    "tritanopia 1~5 14.82",
    "protanopia 1~8 14.83",
    "protanopia 3~6 14.97",
    "deuteranopia 3~6 16.54",
    "deuteranopia 4~8 16.72",
    "deuteranopia 2~8 16.83",
    "protanopia 1~4 18.77",
    "deuteranopia 5~7 19.65",
  ],
  dark: [
    "deuteranopia 5~7 1.61",
    "deuteranopia 2~4 4.22",
    "protanopia 5~7 10.74",
    "protanopia 2~4 14.02",
    "protanopia 1~8 14.13",
    "deuteranopia 3~6 14.67",
    "protanopia 3~6 15.03",
    "deuteranopia 4~8 15.94",
    "protanopia 1~4 16.03",
    "deuteranopia 2~8 19.76",
  ],
} as const

/** The slots whose tritanopia simulation has no answer, and how far out it went. */
const UNSCORABLE = {
  light: [
    "tritanopia slot 2 b -0.716",
    "tritanopia slot 3 b 1.346",
    "tritanopia slot 4 b -1.783",
    "tritanopia slot 6 b -1.225",
    "tritanopia slot 7 b 1.226",
    "tritanopia slot 8 b -1.751",
  ],
  dark: [
    "tritanopia slot 1 b 1.113",
    "tritanopia slot 2 b -0.713",
    "tritanopia slot 3 b 1.451",
    "tritanopia slot 4 b -1.710",
    "tritanopia slot 6 b -1.172",
    "tritanopia slot 7 b 1.425",
    "tritanopia slot 8 b -2.042",
  ],
} as const

const unscorableLine = (u: CvdAudit["unscorable"][number]) =>
  `${u.vision} slot ${u.slot} ${u.channel} ${u.linear.toFixed(3)}`

describe("the simulation itself", () => {
  it("leaves a neutral grey where it found it", () => {
    // A dichromat's confusion lines pass through the neutral axis, so grey is the
    // one input every projection must return roughly unchanged. A sign error in
    // `project` shifts it, and a wrong ΔE would then be measured between two
    // colours nobody sees.
    for (const vision of VISION_TYPES) {
      const grey = { r: 128, g: 128, b: 128, a: 1 }
      expect(outOfGamut(grey, vision)).toBeNull()
      expect(deltaE76(simulate(grey, vision), grey)).toBeLessThan(2)
    }
  })

  it("collapses the red-green pair for the red-green dichromacies", () => {
    const red = { r: 220, g: 40, b: 40, a: 1 }
    const green = { r: 40, g: 180, b: 60, a: 1 }
    const asShown = deltaE76(red, green)
    expect(asShown).toBeGreaterThan(60)

    expect(separationUnder(red, green, "protanopia")).toBeLessThan(asShown / 2)
    expect(separationUnder(red, green, "deuteranopia")).toBeLessThan(asShown / 2)
  })

  it("refuses the blue-yellow pair rather than scoring a clamp", () => {
    // The honest answer for tritanopia on saturated hues, and the reason
    // `outOfGamut` exists. Pure yellow projects to linear blue -7.5, which is
    // not a colour; the previous version of this module clamped it to 0 and
    // reported a number.
    const blue = { r: 40, g: 90, b: 220, a: 1 }
    const yellow = { r: 220, g: 190, b: 40, a: 1 }
    expect(outOfGamut(yellow, "tritanopia")).toMatchObject({ channel: "b" })
    expect(() => separationUnder(blue, yellow, "tritanopia")).toThrow(/leaves the display gamut/)
    // And it is specific about which side it could not read.
    expect(() => separationUnder(blue, yellow, "tritanopia")).toThrow(/of b leaves/)
  })

  it("refuses a value it cannot read rather than scoring it", () => {
    // The distinction this repository is built on: a 0 here would report a typo
    // as the worst possible collision and an Infinity would report it as safe.
    expect(() => separationUnder("var(--chart-1)", "#ffffff", "protanopia")).toThrow(/not a colour/)
  })
})

describe("the chart palette, measured", () => {
  it("resolves eight distinct hex slots in every theme", () => {
    for (const name of ["light", "dark", "light-contrast", "dark-contrast"] as const) {
      const colors = slotColors(THEMES[name])
      expect(colors).toHaveLength(8)
      for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/i)
      expect(new Set(colors).size).toBe(8)
    }
  })

  it("enumerates exactly the collisions recorded here, light and dark", () => {
    expect(auditOf("light").warnings.map(line)).toEqual([...RECORDED.light])
    expect(auditOf("dark").warnings.map(line)).toEqual([...RECORDED.dark])
  })

  it("names the slots whose tritanopia simulation has no answer", () => {
    expect(auditOf("light").unscorable.map(unscorableLine)).toEqual([...UNSCORABLE.light])
    expect(auditOf("dark").unscorable.map(unscorableLine)).toEqual([...UNSCORABLE.dark])
    // Only tritanopia. If a protan or deutan slot ever left the gamut, the
    // numbers above would have to be re-read rather than trusted.
    for (const name of ["light", "dark"] as const) {
      expect(auditOf(name).unscorable.every((u) => u.vision === "tritanopia")).toBe(true)
    }
  })

  it("accounts for every pair — scored plus skipped is the whole palette", () => {
    // The arithmetic that makes a silent drop impossible: 3 dichromacies x 28
    // unordered pairs of 8 slots. A refactor that quietly stopped measuring a
    // vision would still satisfy the two lists above.
    for (const name of ["light", "dark", "light-contrast", "dark-contrast"] as const) {
      const audit = auditOf(name)
      expect(audit.scored + audit.skipped).toBe(84)
      expect(audit.scored).toBeGreaterThan(0)
    }
    expect(auditOf("light").scored).toBe(57)
    expect(auditOf("light").skipped).toBe(27)
    expect(auditOf("dark").scored).toBe(56)
    expect(auditOf("dark").skipped).toBe(28)
  })

  it("gets no help from the high-contrast themes", () => {
    // `prefers-contrast: more` overrides text and border tokens only. A reader
    // who turns high contrast on to tell two series apart is not helped at all,
    // and that is a limitation worth stating rather than discovering.
    expect(auditOf("light-contrast").warnings.map(line)).toEqual([...RECORDED.light])
    expect(auditOf("dark-contrast").warnings.map(line)).toEqual([...RECORDED.dark])
  })

  it("has collisions a reader cannot see at all, not merely tight ones", () => {
    // What makes ten pairs a defect rather than a rounding argument is the bottom
    // of the list. Under ΔE 5 is "the same colour" by any account, and both of
    // these are rendered together by `ReportsAnalytics`.
    const same = auditOf("dark").warnings.filter((p) => p.deltaE < 5)
    expect(same.map(line)).toEqual(["deuteranopia 5~7 1.61", "deuteranopia 2~4 4.22"])
  })

  it("is measured against the floor cvd.ts declares, not one invented here", () => {
    expect(CVD_SEPARATION_FLOOR).toBe(20)
    for (const pair of [...auditOf("light").warnings, ...auditOf("dark").warnings]) {
      expect(pair.deltaE).toBeLessThan(CVD_SEPARATION_FLOOR)
    }
    // And the detector is not simply returning everything it measured.
    expect(auditOf("light").warnings.length).toBeLessThan(auditOf("light").scored)
    expect(auditOf("dark").warnings.length).toBeLessThan(auditOf("dark").scored)
  })
})

describe("the published limitation", () => {
  const doc = fs.readFileSync(LIMITATIONS_DOC, "utf8").replace(/\r\n/g, "\n")

  function block(marker: string): string {
    const start = doc.indexOf(`<!-- ${marker} -->`)
    expect(start).toBeGreaterThan(-1)
    const end = doc.indexOf(`<!-- /${marker} -->`, start)
    expect(end).toBeGreaterThan(start)
    return doc.slice(start, end)
  }

  /** The rows the document publishes for one theme group, as `vision a~b ΔE`. */
  function published(group: "light" | "dark"): string[] {
    return [...block(`cvd:${group}`).matchAll(/^\|\s*(\w+)\s*\|\s*(\d)\s*\|\s*(\d)\s*\|\s*([\d.]+)\s*\|/gm)].map(
      (m) => `${m[1]} ${m[2]}~${m[3]} ${Number(m[4]).toFixed(2)}`,
    )
  }

  /** The unscorable slots the document publishes, as `vision slot N c value`. */
  function publishedUnscorable(group: "light" | "dark"): string[] {
    return [
      ...block(`gamut:${group}`).matchAll(/^\|\s*(\w+)\s*\|\s*(\d)\s*\|\s*(\w)\s*\|\s*(-?[\d.]+)\s*\|/gm),
    ].map((m) => `${m[1]} slot ${m[2]} ${m[3]} ${Number(m[4]).toFixed(3)}`)
  }

  it("publishes exactly the collisions this computation finds, in both directions", () => {
    expect(published("light")).toEqual(auditOf("light").warnings.map(line))
    expect(published("dark")).toEqual(auditOf("dark").warnings.map(line))
  })

  it("publishes exactly the pairs it could not measure", () => {
    // The half a reader is most likely to be misled about, and the half a
    // document is most likely to leave out.
    expect(publishedUnscorable("light")).toEqual(auditOf("light").unscorable.map(unscorableLine))
    expect(publishedUnscorable("dark")).toEqual(auditOf("dark").unscorable.map(unscorableLine))
  })

  it("publishes the floor and the counts it is claiming", () => {
    expect(doc).toContain(`ΔE-${CVD_SEPARATION_FLOOR}`)
    expect(doc).toContain(`${auditOf("light").warnings.length} of the 57 pairs`)
    expect(doc).toContain(`${auditOf("dark").warnings.length} of the 56 pairs`)
    expect(doc).toContain(`${auditOf("dark").skipped} of the 28 tritanopia pairs`)
  })

  it("still quotes the stylesheet claim it contradicts", () => {
    // The document says `globals.css` claims the slots are validated CVD-safe. If
    // that comment is rewritten — because somebody fixes the palette, or because
    // somebody deletes the sentence — this limitation has to be re-decided rather
    // than left standing over a claim nobody makes any more.
    const css = fs.readFileSync(GLOBALS_CSS, "utf8")
    const quoted = "validated CVD-safe in BOTH modes"
    expect(doc).toContain(quoted)
    expect(css).toContain(quoted)
  })
})
