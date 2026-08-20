/**
 * GE-143-020 — the density contract, and the proof the audit is not vacuous.
 *
 * The order here matters. The last group asserts the SHIPPED stylesheet is
 * clean, and that assertion is worth nothing on its own: an `auditDensity` that
 * returns `{ governed: [], findings: [] }` for any input would pass it. So the
 * groups before it feed the audit stylesheets that are wrong in each of the six
 * ways it claims to detect, and assert it says so — with the token named.
 */
import fs from "node:fs"
import path from "node:path"

import {
  GRID_PX,
  MINIMUM_TARGET_PX,
  auditDensity,
  auditShippedDensity,
  resolvePx,
  rulesIn,
  spaceScale,
} from "./density-contract"

const GLOBALS = fs.readFileSync(
  path.join(__dirname, "..", "..", "app", "globals.css"),
  "utf8",
)

/** A minimal stylesheet with the same nesting shape as the real one. */
function sheet(comfortable: string, compact: string, extra = "") {
  return `@layer base {
  :root {
    --space-1: 4px;
    --space-3: 12px;
    --space-5: 20px;
${comfortable}
  }
  :root[data-density="compact"] {
${compact}
  }
${extra}
}`
}

const HEALTHY_COMFORTABLE = `    --control-h-sm: 32px;
    --control-h: 40px;
    --control-h-lg: 44px;
    --row-h: 32px;
    --density-gap: var(--space-5);`

const HEALTHY_COMPACT = `    --control-h-sm: 28px;
    --control-h: 36px;
    --control-h-lg: 40px;
    --row-h: 28px;
    --density-gap: var(--space-3);`

describe("rulesIn", () => {
  it("reads a rule nested two deep without stopping at the wrong brace", () => {
    // The failure this replaces: a scan to the next `}` returns the @media
    // wrapper's first child and calls it the whole rule.
    const rules = rulesIn(`@layer base { @media (max-width: 900px) { :root { --row-h: 28px; } } }`)
    const inner = rules.find((r) => r.declarations["--row-h"])
    expect(inner?.context).toEqual(["@layer base", "@media (max-width: 900px)", ":root"])
    expect(inner?.declarations["--row-h"]).toBe("28px")
  })

  it("does not read a declaration out of a comment", () => {
    const rules = rulesIn(`:root { /* --row-h: 99px; */ --row-h: 28px; }`)
    expect(rules[0].declarations["--row-h"]).toBe("28px")
  })
})

describe("spaceScale and resolvePx", () => {
  const scale = spaceScale(rulesIn(sheet(HEALTHY_COMFORTABLE, HEALTHY_COMPACT)))

  it("reads the primitive scale out of the stylesheet", () => {
    expect(scale.get("--space-1")).toBe(4)
    expect(scale.get("--space-5")).toBe(20)
  })

  it("resolves both legal forms", () => {
    expect(resolvePx("36px", scale)).toEqual({ ok: true, px: 36 })
    expect(resolvePx("var(--space-3)", scale)).toEqual({ ok: true, px: 12 })
  })

  it("refuses a form it cannot check, with the reason", () => {
    // Skipping an unreadable value is the bug: the value the grid check cannot
    // read is the one most likely to be off the grid.
    const em = resolvePx("2.25em", scale)
    expect(em.ok).toBe(false)
    expect(em.ok === false && em.reason).toContain("expected a px literal")

    const missing = resolvePx("var(--space-99)", scale)
    expect(missing.ok).toBe(false)
    expect(missing.ok === false && missing.reason).toBe(
      "--space-99 is not declared on the spacing scale",
    )
  })
})

describe("the audit detects each defect it claims to", () => {
  it("names a value off the four-pixel grid, and which density it is in", () => {
    const audit = auditDensity(
      sheet(HEALTHY_COMFORTABLE, HEALTHY_COMPACT.replace("--control-h: 36px", "--control-h: 34px")),
    )
    const offGrid = audit.findings.filter((f) => f.code === "off-grid")
    expect(offGrid).toHaveLength(1)
    expect(offGrid[0].token).toBe("--control-h")
    expect(offGrid[0].context).toContain('[data-density="compact"]')
    expect(offGrid[0].detail).toBe(`34px is not a multiple of ${GRID_PX}px`)
  })

  it("catches an off-grid value in the comfortable default too", () => {
    // Comfortable is a density, not the absence of one.
    const audit = auditDensity(
      sheet(HEALTHY_COMFORTABLE.replace("--row-h: 32px", "--row-h: 30px"), HEALTHY_COMPACT),
    )
    expect(audit.findings.filter((f) => f.code === "off-grid").map((f) => f.token)).toEqual([
      "--row-h",
    ])
  })

  it("names a control shorter than the WCAG 2.2 minimum target", () => {
    const audit = auditDensity(
      sheet(HEALTHY_COMFORTABLE, HEALTHY_COMPACT.replace("--row-h: 28px", "--row-h: 20px")),
    )
    const small = audit.findings.filter((f) => f.code === "below-minimum-target")
    expect(small).toHaveLength(1)
    expect(small[0].detail).toContain(`${MINIMUM_TARGET_PX}px`)
  })

  it("does not mistake a gap for a target", () => {
    // --density-gap at 12px is correct; a 12px control would not be.
    const audit = auditDensity(sheet(HEALTHY_COMFORTABLE, HEALTHY_COMPACT))
    expect(audit.findings.filter((f) => f.code === "below-minimum-target")).toEqual([])
  })

  it("refuses a density value it cannot resolve", () => {
    const audit = auditDensity(
      sheet(HEALTHY_COMFORTABLE, HEALTHY_COMPACT.replace("--control-h: 36px", "--control-h: 2.2rem")),
    )
    expect(audit.findings.filter((f) => f.code === "unresolvable").map((f) => f.token)).toEqual([
      "--control-h",
    ])
  })

  it("rejects a density block that changes anything but size", () => {
    // This is the half of the requirement about preserving type, focus, labels,
    // error content and safety context: compact may not restyle them.
    const audit = auditDensity(
      sheet(HEALTHY_COMFORTABLE, `${HEALTHY_COMPACT}\n    --text-body: 12px;\n    --border-focus: #999;`),
    )
    const ungoverned = audit.findings.filter((f) => f.code === "ungoverned-declaration")
    expect(ungoverned.map((f) => f.token).sort()).toEqual(["--border-focus", "--text-body"])
  })

  it("rejects a density block that hides content", () => {
    const audit = auditDensity(
      sheet(HEALTHY_COMFORTABLE, HEALTHY_COMPACT) +
        `\n@layer base { :root[data-density="compact"] .field-error { display: none; } }`,
    )
    const hidden = audit.findings.filter((f) => f.code === "hides-content")
    expect(hidden).toHaveLength(1)
    expect(hidden[0].detail).toContain("display: none")
  })

  it("names a token a density overrides but nothing declares by default", () => {
    const audit = auditDensity(
      sheet(
        HEALTHY_COMFORTABLE.replace("    --row-h: 32px;\n", ""),
        HEALTHY_COMPACT,
      ),
    )
    expect(audit.findings.filter((f) => f.code === "missing-default").map((f) => f.token)).toEqual([
      "--row-h",
    ])
  })
})

describe("the shipped stylesheet", () => {
  const audit = auditShippedDensity()

  it("governs the five density tokens, so the audit is not looking at nothing", () => {
    expect(audit.governed).toEqual([
      "--control-h",
      "--control-h-lg",
      "--control-h-sm",
      "--density-gap",
      "--row-h",
    ])
    // Comfortable, compact and the narrow-screen gap override: eleven values.
    expect(audit.values.size).toBe(11)
  })

  it("has no finding", () => {
    expect(audit.findings).toEqual([])
  })

  it("puts every governed value on the grid, in both densities", () => {
    // Asserted from the parsed values rather than from the file's text, so a
    // token that stopped being parsed cannot pass by absence.
    expect(audit.values.size).toBeGreaterThan(0)
    for (const [key, px] of audit.values) {
      expect({ key, remainder: px % GRID_PX }).toEqual({ key, remainder: 0 })
    }
  })

  it("keeps every control and row above the minimum target at compact", () => {
    const compact = [...audit.values].filter(
      ([key]) => key.includes('[data-density="compact"]') && /--(control-h|row-h)/.test(key),
    )
    expect(compact).toHaveLength(4)
    for (const [key, px] of compact) {
      expect({ key, ok: px >= MINIMUM_TARGET_PX }).toEqual({ key, ok: true })
    }
  })

  it("shrinks — every compact value is below its comfortable default", () => {
    const at = (context: string, token: string) => audit.values.get(`${context}::${token}`)
    const comfortable = "@layer base :root"
    const compact = '@layer base :root[data-density="compact"]'
    for (const token of ["--control-h-sm", "--control-h", "--control-h-lg", "--row-h", "--density-gap"]) {
      const a = at(comfortable, token)
      const b = at(compact, token)
      expect({ token, defined: a !== undefined && b !== undefined }).toEqual({
        token,
        defined: true,
      })
      expect({ token, shrinks: b! < a! }).toEqual({ token, shrinks: true })
    }
  })

  it("is the stylesheet the app loads", () => {
    // auditShippedDensity resolves its own path; this pins it to the file the
    // root layout imports, so the audit cannot drift onto a stale copy.
    expect(GLOBALS).toContain('--control-h: 40px')
    expect(fs.readFileSync(path.join(__dirname, "..", "..", "app", "layout.tsx"), "utf8")).toContain(
      'import "./globals.css"',
    )
  })
})
