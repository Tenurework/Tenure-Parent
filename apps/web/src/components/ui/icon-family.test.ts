/**
 * GE-143-007 — the icon family, checked against the shipped tree.
 *
 * The fixtures prove the scans are not vacuous; the tree cases are the boundary.
 * A scan that returned `[]` for everything would keep every one of those tree
 * cases green forever, which is why each has a fixture beside it that MUST trip
 * it.
 */
import fs from "node:fs"
import path from "node:path"

import {
  FILLED_WEIGHTS,
  ICON_BARREL,
  ICON_VENDOR,
  OUTLINE_WEIGHTS,
  OWN_SVG_ALLOWED,
  barrelFamilies,
  drawsOwnGlyph,
  emojiInControls,
  iconWeights,
  isChartMark,
  vendorIconImports,
} from "./icon-family"

const APP_ROOT = path.resolve(__dirname, "../../..")

function productModules(): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|itest)\.tsx?$/.test(entry.name)) files.push(full)
    }
  }
  walk(path.join(APP_ROOT, "src"))
  return files
}

const relative = (file: string) => path.relative(APP_ROOT, file).split(path.sep).join("/")

describe("one family, named in one place", () => {
  it("the barrel pulls from exactly one vendor family", () => {
    const source = fs.readFileSync(path.join(APP_ROOT, ICON_BARREL), "utf8")
    expect(barrelFamilies(source)).toEqual([ICON_VENDOR])
  })

  it("would notice a second family in the barrel", () => {
    expect(barrelFamilies('import { X } from "@phosphor-icons/react/ssr"\nimport { Y } from "lucide-react"')).toEqual([
      "@phosphor-icons/react",
      "lucide-react",
    ])
  })

  it("no module outside the barrel names an icon vendor", () => {
    const offenders: string[] = []
    for (const file of productModules()) {
      if (relative(file) === ICON_BARREL) continue
      for (const specifier of vendorIconImports(fs.readFileSync(file, "utf8"))) {
        offenders.push(`${relative(file)}: ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe("outline, not filled", () => {
  it("reads the weight a component sets, and knows which are fills", () => {
    expect(iconWeights('<Icon weight="regular" /><Icon weight="fill" />')).toEqual([
      { weight: "regular", filled: false },
      { weight: "fill", filled: true },
    ])
    expect([...OUTLINE_WEIGHTS]).not.toContain("fill")
    expect([...FILLED_WEIGHTS]).toEqual(["fill", "duotone"])
  })

  it("no icon anywhere in the product is drawn filled", () => {
    const offenders: string[] = []
    for (const file of productModules()) {
      for (const use of iconWeights(fs.readFileSync(file, "utf8"))) {
        if (use.filled) offenders.push(`${relative(file)}: weight="${use.weight}"`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe("no hand-drawn glyphs outside the register", () => {
  it("calls an ordinary component's own <svg> a glyph, and a chart's marks data", () => {
    expect(drawsOwnGlyph("src/components/shell/Thing.tsx", "<svg><path d='M0 0' /></svg>")).toBe(true)
    expect(isChartMark("src/components/charts/BarChart.tsx")).toBe(true)
    expect(drawsOwnGlyph("src/components/charts/BarChart.tsx", "<svg><rect /></svg>")).toBe(false)
    // A quoted example in a comment is not a drawing.
    expect(drawsOwnGlyph("src/components/shell/Thing.tsx", "// was: <svg><path/></svg>\nexport const x = 1")).toBe(false)
  })

  it("every registered exception still draws one, and says why", () => {
    // An exemption that outlives its code is permission nobody reviewed.
    for (const entry of OWN_SVG_ALLOWED) {
      const source = fs.readFileSync(path.join(APP_ROOT, entry.file), "utf8")
      expect({ file: entry.file, draws: /<svg[\s>]/.test(source) }).toEqual({ file: entry.file, draws: true })
      expect(entry.reason.length).toBeGreaterThan(30)
    }
  })

  it("nothing else in the product draws its own glyph", () => {
    const offenders = productModules()
      .filter((file) => drawsOwnGlyph(relative(file), fs.readFileSync(file, "utf8")))
      .map(relative)
    expect(offenders).toEqual([])
  })
})

describe("no emoji in operational controls", () => {
  it("finds one in a button, a link and an accessible name", () => {
    expect(emojiInControls('<button className="x">Celebrate 🎉</button>')).toHaveLength(1)
    // One control, one report — the variation selector is part of the emoji.
    expect(emojiInControls('<a href="/x">Go ➡️</a>')).toHaveLength(1)
    expect(emojiInControls('<button aria-label="Delete 🗑" />')).toHaveLength(1)
  })

  it("does not call typography an icon", () => {
    // These appear in real copy: an arrow between two names, a multiplication
    // sign in a matrix heading, a bullet in a generated spreadsheet.
    expect(emojiInControls('<button>President → OSE</button>')).toEqual([])
    expect(emojiInControls("<label>theme × density</label>")).toEqual([])
    expect(emojiInControls("<a>• Budget</a>")).toEqual([])
  })

  it("no control in the product carries one", () => {
    const offenders: string[] = []
    for (const file of productModules()) {
      for (const use of emojiInControls(fs.readFileSync(file, "utf8"))) {
        offenders.push(`${relative(file)}: <${use.element}> ${use.emoji} — ${use.context}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
