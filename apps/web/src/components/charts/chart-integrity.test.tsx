/**
 * @jest-environment jsdom
 */

/**
 * GE-143-033 — the prohibitions, checked against the kit that ships.
 *
 * Three kinds of case, matching the three kinds of enforcement the register
 * declares. The scanned prohibitions are run over every chart module AND over a
 * fixture that violates each one, because a scan that has never fired is
 * indistinguishable from a scan that cannot. The `construction` prohibitions are
 * asserted against the marks' own source — zero baselines, one y-scale, no
 * arithmetic hues. The `review` ones are asserted only to be declared as review,
 * which is the honest thing a test can say about them.
 */
import fs from "node:fs"
import path from "node:path"

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import {
  PROHIBITIONS,
  SCANNED_PROHIBITIONS,
  prohibitedConstructs,
  scaleDisclosure,
} from "./chart-integrity"
import { Sparkline } from "./Sparkline"

const CHARTS = path.resolve(__dirname)

function chartModules(): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|itest)\.tsx?$/.test(entry.name)) files.push(full)
    }
  }
  walk(CHARTS)
  return files
}

const source = (file: string) => fs.readFileSync(path.join(CHARTS, file), "utf8")

describe("the register", () => {
  it("covers all nine prohibitions and says how each is enforced", () => {
    expect(PROHIBITIONS.map((p) => p.id)).toEqual([
      "3d-perspective",
      "exploding-pie",
      "decorative-gauge",
      "silent-truncated-axis",
      "dual-axis",
      "rainbow-categorical",
      "status-colour-reuse",
      "hidden-denominator",
      "ai-numbers-without-provenance",
    ])
    for (const prohibition of PROHIBITIONS) {
      expect(prohibition.why.length).toBeGreaterThan(40)
      if (prohibition.enforcement === "scan") expect(prohibition.detect).toBeDefined()
      // A prohibition nothing scans must say where its guarantee comes from, or
      // that there is none. Silence there is the failure mode this register has.
      else expect(prohibition.note!.length).toBeGreaterThan(40)
    }
  })

  it("keeps two prohibitions honestly marked as unscannable", () => {
    expect(PROHIBITIONS.filter((p) => p.enforcement === "review").map((p) => p.id)).toEqual([
      "status-colour-reuse",
      "hidden-denominator",
      "ai-numbers-without-provenance",
    ])
  })
})

describe("the scanned prohibitions", () => {
  it("fire on a module that commits each one", () => {
    const fixture = `
      const style = { transform: "perspective(600px) rotateX(35deg)" }
      const slice = { explode: 12 }
      export function GaugeChart() { return null }
    `
    expect(prohibitedConstructs(fixture).map((o) => o.id).sort()).toEqual([
      "3d-perspective",
      "decorative-gauge",
      "exploding-pie",
    ])
    expect(SCANNED_PROHIBITIONS).toHaveLength(3)
  })

  it("does not fire on a 2D rotation, which is how a donut places its arcs", () => {
    // DonutChart.tsx:107. A detector that flagged `rotate(` would have made the
    // register something people turn off.
    expect(prohibitedConstructs('transform: `rotate(${s.startAngleDeg}deg)`')).toEqual([])
  })

  it("does not fire on the defect quoted in a comment", () => {
    expect(prohibitedConstructs("// never write perspective(600px) here\nconst x = 1")).toEqual([])
  })

  it("finds none in any chart module", () => {
    const offences: string[] = []
    for (const file of chartModules()) {
      // The register names the constructs it forbids — that is what a detector
      // is — so scanning it reports its own regular expressions. Excluded here
      // and nowhere else; every other module in the kit is scanned.
      if (path.basename(file) === "chart-integrity.ts") continue
      for (const offence of prohibitedConstructs(fs.readFileSync(file, "utf8"))) {
        offences.push(`${path.basename(file)}: ${offence.prohibited} — ${offence.line}`)
      }
    }
    expect(offences).toEqual([])
  })
})

describe("the prohibitions that hold by construction", () => {
  it("scales the three axis marks from zero", () => {
    // `Math.max(0, v) / yMax` is the zero baseline: a value's height is its
    // share of the ceiling, not its share of the gap above the smallest value.
    expect(source("BarChart.tsx")).toContain("(Math.max(0, v) / yMax) * plotH")
    expect(source("LineAreaChart.tsx")).toContain("(Math.max(0, v) / yMax) * plotH")
    expect(source("HBarChart.tsx")).toContain("(Math.max(0, v) / xMax) * plotW")
  })

  it("draws the bar chart's overlay line on the bars' own scale", () => {
    // One `hAt`, so the two series cannot be scaled against each other.
    const bar = source("BarChart.tsx")
    expect(bar).toContain("baseline - hAt(v)")
    expect(bar.match(/const hAt = /g)).toHaveLength(1)
    expect(bar).not.toMatch(/overlay(?:Max)?Scale|hAt2|secondaryAxis/)
  })

  it("generates no hue arithmetic anywhere in the kit", () => {
    // A rainbow is what you get from `hsl(i * 360 / n)`. Categorical colour comes
    // from the eight --chart-* tokens instead.
    for (const file of chartModules()) {
      const code = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "")
      expect({ file: path.basename(file), hueArithmetic: /hsl\(|hsla\(|hue\s*[*+]/.test(code) }).toEqual({
        file: path.basename(file),
        hueArithmetic: false,
      })
    }
  })
})

describe("scaleDisclosure", () => {
  it("reports a zero-based scale as untruncated, with no exaggeration", () => {
    expect(scaleDisclosure([0, 4, 10], 0)).toEqual({
      floor: 0,
      ceiling: 10,
      truncated: false,
      exaggeration: 1,
      sentence: "From 0 to 10. The axis starts at zero.",
    })
  })

  it("computes how much a truncated axis exaggerates, as arithmetic", () => {
    // 100–101 drawn min–max: the visible span is 1 where a zero-based span would
    // be 101, so the slope is 101× steeper than the truth.
    const disclosure = scaleDisclosure([100, 100, 101], 100)
    expect(disclosure.truncated).toBe(true)
    expect(disclosure.exaggeration).toBe(101)
    expect(disclosure.sentence).toBe(
      "From 100 to 101. The axis starts at 100, not zero, so this shape overstates the change by about 101×.",
    )
  })

  it("says it cannot compute the factor rather than inventing one", () => {
    // A flat series has no visible span to divide by. "We could not look" is a
    // different answer from "1×", and the sentence has to be the first one.
    const flat = scaleDisclosure([7, 7, 7], 7)
    expect(flat.exaggeration).toBeNull()
    expect(flat.sentence).toContain("cannot be computed")
  })

  it("says so when there is nothing to plot", () => {
    expect(scaleDisclosure([]).sentence).toBe("No values to plot.")
    expect(scaleDisclosure([Number.NaN]).sentence).toBe("No values to plot.")
  })

  it("defaults its floor to the data's minimum, which is what a min–max mark draws", () => {
    expect(scaleDisclosure([100, 101]).floor).toBe(100)
    expect(scaleDisclosure([100, 101]).truncated).toBe(true)
  })
})

// ─── The mark that was silent ────────────────────────────────────────────────

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("Sparkline discloses the scale it drew", () => {
  let container: HTMLDivElement
  let root: Root

  beforeAll(() => {
    // The sparkline measures its parent with `clientWidth` and a ResizeObserver.
    // jsdom reports 0 for the first and does not implement the second, so the
    // SVG would never render and every assertion below would pass vacuously
    // against an empty div.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { value: 240, configurable: true })
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })

  function render(node: React.ReactNode) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(node)
    })
    return container
  }

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("renders at all — the guard against a vacuous pass", () => {
    expect(render(<Sparkline values={[1, 2, 3]} />).querySelector("svg")).not.toBeNull()
  })

  it("labels a truncated series with its exaggeration, and is not aria-hidden", () => {
    const dom = render(<Sparkline values={[100, 100, 101]} labelPrefix="Active members" />)
    const svg = dom.querySelector("svg")!
    expect(svg.getAttribute("aria-hidden")).toBeNull()
    expect(svg.getAttribute("role")).toBe("img")
    expect(svg.getAttribute("data-scale-truncated")).toBe("true")
    expect(svg.getAttribute("aria-label")).toBe(
      "Active members. Trend of 3 points. From 100 to 101. The axis starts at 100, not zero, so this shape overstates the change by about 101×.",
    )
    // And on hover, for the sighted reader who is the one being misled.
    expect(svg.querySelector("title")!.textContent).toBe(svg.getAttribute("aria-label"))
  })

  it("says a zero-floored series starts at zero", () => {
    const dom = render(<Sparkline values={[0, 5, 9]} labelPrefix="Events" />)
    const svg = dom.querySelector("svg")!
    expect(svg.getAttribute("data-scale-truncated")).toBe("false")
    expect(svg.getAttribute("aria-label")).toBe(
      "Events. Trend of 3 points. From 0 to 9. The axis starts at zero.",
    )
  })
})
