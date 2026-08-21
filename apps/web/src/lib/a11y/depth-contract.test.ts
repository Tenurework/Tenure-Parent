/**
 * GE-143-015 — the depth contract, and the proof each detector works.
 *
 * The shipped stylesheet has no radius or shadow literal today, so the two
 * detectors that look for them would pass against a function that returned an
 * empty array forever. Every one of them is therefore fed a stylesheet that
 * violates it before the shipped file is asserted clean.
 */
import {
  MAX_ELEVATION_STEPS,
  TRANSLUCENCY,
  auditDepth,
  auditShippedDepth,
} from "./depth-contract"

const TOKENS = `  :root {
    --radius-sm: 7px;
    --radius-md: 9px;
    --radius-lg: 13px;
    --shadow-xs: 0 1px 2px rgba(23, 24, 26, 0.05);
    --shadow-sm: 0 1px 3px rgba(23, 24, 26, 0.06);
    --shadow-lg: 0 16px 36px rgba(23, 24, 26, 0.14);
  }
  html.dark {
    --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.4);
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
    --shadow-lg: 0 24px 50px rgba(0, 0, 0, 0.6);
  }`

const REDUCED = `  @media (prefers-reduced-transparency: reduce) {
    *, *::before, *::after {
      backdrop-filter: none !important;
    }
  }`

const RULES = `  .overlay-backdrop { backdrop-filter: blur(6px); }
  .card { border-radius: var(--radius-md); box-shadow: var(--shadow-sm); }`

function sheet(parts: { tokens?: string; rules?: string; reduced?: string } = {}) {
  return `@layer base {
${parts.tokens ?? TOKENS}
${parts.reduced ?? REDUCED}
}
@layer components {
${parts.rules ?? RULES}
}`
}

describe("the audit detects each defect it claims to", () => {
  it("passes a stylesheet that keeps to the systems", () => {
    expect(auditDepth(sheet()).findings).toEqual([])
  })

  it("names a radius off the scale", () => {
    const audit = auditDepth(sheet({ rules: RULES.replace("var(--radius-md)", "11px") }))
    const off = audit.findings.filter((f) => f.code === "radius-literal")
    expect(off).toHaveLength(1)
    expect(off[0].detail).toContain('"11px" is off the scale')
  })

  it("lets a pill and a zero through, because they are geometry not steps", () => {
    const audit = auditDepth(
      sheet({ rules: `${RULES}\n  .pill { border-radius: 9999px; }\n  .flush { border-radius: 0; }` }),
    )
    expect(audit.findings.filter((f) => f.code === "radius-literal")).toEqual([])
  })

  it("names a hand-built shadow", () => {
    const audit = auditDepth(
      sheet({ rules: RULES.replace("var(--shadow-sm)", "0 20px 60px rgba(0,0,0,.5)") }),
    )
    const off = audit.findings.filter((f) => f.code === "elevation-literal")
    expect(off).toHaveLength(1)
    expect(off[0].where).toBe(".card { box-shadow }")
  })

  it("lets box-shadow: none through", () => {
    const audit = auditDepth(sheet({ rules: `${RULES}\n  .flat { box-shadow: none; }` }))
    expect(audit.findings.filter((f) => f.code === "elevation-literal")).toEqual([])
  })

  it("names an elevation ramp with more steps than depth used sparingly allows", () => {
    const extra = Array.from(
      { length: MAX_ELEVATION_STEPS + 1 },
      (_, i) => `    --shadow-step${i}: 0 ${i}px ${i}px rgba(0,0,0,.1);`,
    ).join("\n")
    const audit = auditDepth(sheet({ tokens: `  :root {\n${extra}\n  }` }))
    const deep = audit.findings.filter((f) => f.code === "elevation-ramp-too-deep")
    expect(deep).toHaveLength(1)
    expect(deep[0].detail).toContain(`${MAX_ELEVATION_STEPS + 1} steps`)
  })

  it("names a theme that re-art-directs only part of the ramp", () => {
    // The surface that loses its edge in dark only, and survives review because
    // nobody opens both themes.
    const audit = auditDepth(
      sheet({ tokens: TOKENS.replace("    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);\n", "") }),
    )
    const partial = audit.findings.filter((f) => f.code === "elevation-ramp-incomplete-in-a-theme")
    expect(partial).toHaveLength(1)
    expect(partial[0].detail).toContain("--shadow-sm")
    expect(partial[0].where).toContain("html.dark")
  })

  it("names an unregistered blur", () => {
    const audit = auditDepth(
      sheet({ rules: `${RULES}\n  .hero { backdrop-filter: blur(20px); }` }),
    )
    const glass = audit.findings.filter((f) => f.code === "unregistered-translucency")
    expect(glass).toHaveLength(1)
    expect(glass[0].where).toBe(".hero { backdrop-filter: blur(20px) }")
  })

  it("names an unregistered filter: blur too, not only backdrop-filter", () => {
    const audit = auditDepth(sheet({ rules: `${RULES}\n  .frosted { filter: blur(4px); }` }))
    expect(
      audit.findings.filter((f) => f.code === "unregistered-translucency").map((f) => f.where),
    ).toEqual([".frosted { filter: blur(4px) }"])
  })

  it("names a register entry whose blur radius has drifted", () => {
    const audit = auditDepth(sheet({ rules: RULES.replace("blur(6px)", "blur(18px)") }))
    const drift = audit.findings.filter((f) => f.code === "register-disagrees-with-stylesheet")
    expect(drift).toHaveLength(1)
    expect(drift[0].detail).toBe('register says blur(6px); stylesheet says "blur(18px)"')
  })

  it("names a register entry the stylesheet does not back", () => {
    const audit = auditDepth(sheet({ rules: `  .card { border-radius: var(--radius-md); }` }))
    expect(
      audit.findings
        .filter((f) => f.code === "register-disagrees-with-stylesheet")
        .map((f) => f.where),
    ).toEqual(TRANSLUCENCY.map((t) => t.selector))
  })

  it("says so when nothing honours reduced transparency", () => {
    const audit = auditDepth(sheet({ reduced: "" }))
    expect(
      audit.findings.filter((f) => f.detail === "there is no reduced-transparency override at all"),
    ).toHaveLength(1)
  })

  it("names a reduced-transparency block that does not neutralise the blur", () => {
    const audit = auditDepth(
      sheet({ reduced: REDUCED.replace("backdrop-filter: none !important;", "opacity: 1;") }),
    )
    expect(
      audit.findings.filter(
        (f) => f.code === "reduced-transparency-incomplete" && f.detail.includes("survives"),
      ),
    ).toHaveLength(1)
  })

  it("names a reduced-transparency block that does not reach every element", () => {
    const audit = auditDepth(
      sheet({ reduced: REDUCED.replace("*, *::before, *::after", ".overlay-backdrop") }),
    )
    expect(
      audit.findings.filter(
        (f) => f.code === "reduced-transparency-incomplete" && f.detail.includes("every element"),
      ),
    ).toHaveLength(1)
  })

  it("does not read the reduced-transparency or forced-colors blocks as blur", () => {
    // Both blocks say `backdrop-filter: none`. Reading a suppression as a use
    // would make the fix look like the defect.
    const audit = auditDepth(
      sheet({}) + `\n@layer base { @media (forced-colors: active) { * { backdrop-filter: none !important; } } }`,
    )
    expect(audit.findings.filter((f) => f.code === "unregistered-translucency")).toEqual([])
  })
})

describe("the shipped stylesheet", () => {
  const audit = auditShippedDepth()

  it("declares both systems, so the audit is looking at something", () => {
    expect(audit.radiusSteps).toEqual([
      "--radius-full",
      "--radius-lg",
      "--radius-md",
      "--radius-sm",
      "--radius-xl",
    ])
    expect(audit.elevationSteps).toEqual([
      "--shadow-focus",
      "--shadow-lg",
      "--shadow-md",
      "--shadow-sm",
      "--shadow-xs",
    ])
    expect(audit.depthRules.length).toBeGreaterThanOrEqual(4)
  })

  it("has no finding", () => {
    expect(audit.findings).toEqual([])
  })

  it("uses depth sparingly", () => {
    expect(audit.elevationSteps.length).toBeLessThanOrEqual(MAX_ELEVATION_STEPS)
  })

  it("answers all four questions for every translucent surface it keeps", () => {
    expect(TRANSLUCENCY.length).toBeGreaterThan(0)
    for (const surface of TRANSLUCENCY) {
      expect(surface.behind.length).toBeGreaterThan(20)
      expect(surface.justification.length).toBeGreaterThan(120)
      expect(surface.whenTransparencyReduced.length).toBeGreaterThan(80)
      // The four grounds the requirement names — variable content, performance,
      // contrast, focus clarity — each addressed by name. The ground is in the
      // assertion rather than in a message, so a failure says which one is
      // missing instead of "expected true".
      for (const [ground, pattern] of [
        ["contrast", /contrast/i],
        ["focus clarity", /focus/i],
        ["performance", /cost|performance|per frame|paint/i],
        ["variable content", /text|content/i],
      ] as const) {
        expect({ selector: surface.selector, ground, addressed: pattern.test(surface.justification) }).toEqual({
          selector: surface.selector,
          ground,
          addressed: true,
        })
      }
    }
  })
})
