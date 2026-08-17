/**
 * GE-143-012 — the role boundary, tested against the real stylesheet and the
 * real product tree rather than against fixtures.
 *
 * Three of these cases would pass against a fixture and tell you nothing: the
 * token-existence case, the capture case and the product-module scan all read
 * files that ship. The fixtures that ARE here exist to prove the analyses are
 * not vacuous — a `capturedMeanings` that always returns `[]` would pass over
 * `globals.css` forever.
 */
import fs from "node:fs"
import path from "node:path"

import { brandingCss, type Branding } from "@tenure/platform-config"

import {
  BRAND_ROLES,
  BRAND_WRITABLE_PROPERTIES,
  PROTECTED_MEANINGS,
  PROTECTED_TOKENS,
  brandDerivedTokens,
  capturedMeanings,
  conditionalMeaningOffenders,
  MEANING_CONDITIONAL_EXCEPTIONS,
  definedBrandingKeys,
  guardBrandingCss,
  meaningsOf,
  varReferences,
} from "./brand-roles"
import { ALL_THEMES, readBlocks, readThemes, token } from "./theme-tokens"

const APP_ROOT = path.resolve(__dirname, "../../..")

/** Every .ts/.tsx that ships, excluding tests. Same set as design-contracts.test.ts. */
function productModules(): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|itest)\.tsx?$/.test(entry.name)) files.push(full)
    }
  }
  walk(path.join(APP_ROOT, "src/app"))
  walk(path.join(APP_ROOT, "src/components"))
  return files
}

describe("the protected-meaning register", () => {
  it("names all nine meanings the requirement names", () => {
    expect(PROTECTED_MEANINGS.map((m) => m.meaning)).toEqual([
      "focus",
      "status",
      "destructive",
      "financial polarity",
      "permission",
      "data quality",
      "link",
      "disabled",
      "security",
    ])
    // A meaning with no token protects nothing. `security` is the one that
    // borrows another family's tokens, and it says so in its `why`.
    for (const meaning of PROTECTED_MEANINGS) {
      expect({ meaning: meaning.meaning, tokens: meaning.tokens.length > 0 }).toEqual({
        meaning: meaning.meaning,
        tokens: true,
      })
      expect(meaning.why.length).toBeGreaterThan(20)
    }
  })

  it("names only tokens the stylesheet actually declares, in every theme", () => {
    // The mutation this catches: rename a token in globals.css, or protect one
    // that was never there. Either leaves a meaning nothing defends.
    const themes = readThemes()
    for (const theme of ALL_THEMES) {
      for (const name of PROTECTED_TOKENS) {
        expect(() => token(themes[theme], name)).not.toThrow()
      }
    }
  })

  it("classifies every branding key the platform defines, and invents none", () => {
    // A new `platform.branding.*` key cannot reach a page without a human
    // deciding which role it occupies — that is the "validated roles" half.
    expect(BRAND_ROLES.map((r) => r.key).sort()).toEqual(definedBrandingKeys())
    for (const role of BRAND_ROLES) {
      for (const property of role.writes) {
        expect(BRAND_WRITABLE_PROPERTIES).toContain(property)
      }
    }
  })

  it("reports the meanings a shared token carries, all of them", () => {
    expect(meaningsOf("--error").sort()).toEqual([
      "destructive",
      "financial polarity",
      "permission",
      "security",
    ])
    expect(meaningsOf("--border-focus")).toEqual(["focus"])
    expect(meaningsOf("--bg-surface")).toEqual([])
  })
})

describe("the allowlist and the emitter agree", () => {
  const overridden: Branding = {
    primaryColor: "#123456",
    primaryTextColor: "#fefefe",
    wordmark: "Example College",
    colorScheme: "dark",
  }

  it("writes exactly the properties the allowlist permits", () => {
    // Both directions. A property added to brandingCss without being added here
    // is dropped at the page by the guard and reported; one removed from the
    // emitter fails here rather than sitting in the allowlist as dead permission.
    const emitted = [...brandingCss(overridden).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])
    expect([...new Set(emitted)].sort()).toEqual([...BRAND_WRITABLE_PROPERTIES].sort())
  })

  it("passes a legitimate branding block through unchanged in meaning", () => {
    const guarded = guardBrandingCss(brandingCss(overridden))
    expect(guarded.rejections).toEqual([])
    for (const property of BRAND_WRITABLE_PROPERTIES) {
      expect(guarded.css).toContain(`${property}:`)
    }
  })

  it("adds no bytes when a tenant has changed nothing", () => {
    expect(guardBrandingCss("")).toEqual({ css: "", rejections: [] })
  })
})

describe("guardBrandingCss", () => {
  it("drops a protected property and explains which meaning it carries", () => {
    const guarded = guardBrandingCss(":root{--primary: #123456;--border-focus: #ff0000;}")
    expect(guarded.css).toBe(":root{--primary: #123456;}")
    expect(guarded.rejections).toEqual([
      {
        property: "--border-focus",
        refused: "#ff0000",
        explanation: expect.stringContaining("carries the focus meaning"),
      },
    ])
  })

  it("names every meaning a shared token carries in the explanation", () => {
    const { rejections } = guardBrandingCss(":root{--error: #00ff00;}")
    expect(rejections[0].explanation).toContain(
      "destructive / financial polarity / permission / security",
    )
  })

  it("drops a property that is merely unknown, without pretending to know it", () => {
    const { css, rejections } = guardBrandingCss(":root{--tenant-mystery: 3px;}")
    expect(css).toBe("")
    expect(rejections[0].explanation).toContain("is not one of the properties")
    expect(rejections[0].explanation).not.toContain("carries the")
  })

  it("refuses a block it cannot read as declarations, whole", () => {
    // The safe direction for a string about to be interpolated into <style>.
    const { css, rejections } = guardBrandingCss(":root{--primary:#fff} a{background:url(x)}")
    expect(css).toBe("")
    expect(rejections).toHaveLength(1)
    expect(rejections[0].property).toBe("(whole block)")
  })
})

describe("the stylesheet's var() graph", () => {
  it("reads every reference in a value, including inside color-mix()", () => {
    expect(varReferences("color-mix(in srgb, var(--primary) 88%, black)")).toEqual(["--primary"])
    expect(varReferences("linear-gradient(var(--a), var( --b ))")).toEqual(["--a", "--b"])
    expect(varReferences("#0f3d2e")).toEqual([])
  })

  it("follows a chain, not just a direct reference", () => {
    const derived = brandDerivedTokens({
      "--primary": "#198052",
      "--halo": "var(--primary)",
      "--halo-soft": "color-mix(in srgb, var(--halo) 20%, white)",
      "--unrelated": "var(--tenure-navy-700)",
      "--tenure-navy-700": "#26405e",
    })
    expect(derived).toEqual(["--halo", "--halo-soft"])
  })

  it("finds nothing in globals.css: no protected meaning derives from the accent", () => {
    // The real assertion. `--border-focus: #198052` is the SAME COLOUR as
    // `--primary` and is declared independently of it, which is the whole trick:
    // the ring looks like the brand until a tenant changes the brand, and then it
    // stays where a keyboard user can find it.
    expect(capturedMeanings(readBlocks())).toEqual([])
  })

  it("would find one: a --error mixed from the accent is reported for four meanings", () => {
    // Proves the case above is not vacuous.
    const blocks = readBlocks()
    const captured = capturedMeanings({
      ...blocks,
      root: { ...blocks.root, "--error": "color-mix(in srgb, var(--primary) 70%, #c2402a)" },
    })
    expect(captured.map((c) => c.meaning).sort()).toEqual([
      "destructive",
      "financial polarity",
      "permission",
      "security",
    ])
    expect(new Set(captured.map((c) => c.token))).toEqual(new Set(["--error"]))
  })

  it("catches a capture that exists only in the high-contrast override", () => {
    // The theme where the reader most needs status colours to hold.
    const blocks = readBlocks()
    const captured = capturedMeanings({
      ...blocks,
      darkContrast: { ...blocks.darkContrast, "--warning": "var(--primary-light)" },
    })
    // Both meanings --warning carries, not the first one found.
    expect(captured).toEqual([
      { meaning: "status", token: "--warning" },
      { meaning: "data quality", token: "--warning" },
    ])
  })
})

describe("no component encodes a protected meaning in the brand token", () => {
  it("finds the three call sites that did, from their own source text", () => {
    // Verbatim from FinanceDashboard.tsx:271 / :439 and LiveStats.tsx:73 before
    // GE-143-012 changed them. A detector that cannot find the defect it was
    // written for is not a detector.
    const variance = `className={\`px-3 py-2.5 text-right \${
      variance < 0 ? "text-[--error]" : "text-[--primary]"
    }\`}`
    const summary = `const color =
      tone === "good" ? "text-[--primary]" : tone === "bad" ? "text-[--error]" : "text-text-1"`
    const live = `const accent = tone === "warn" && value > 0 ? "var(--warning)" : "var(--primary)"`

    expect(conditionalMeaningOffenders(variance)).toEqual([
      {
        conditional: expect.stringContaining("text-[--error]"),
        brandToken: "--primary",
        protectedToken: "--error",
        meanings: ["destructive", "financial polarity", "permission", "security"],
      },
    ])
    expect(conditionalMeaningOffenders(summary)).toHaveLength(1)
    expect(conditionalMeaningOffenders(live)).toEqual([
      {
        conditional: expect.stringContaining("var(--warning)"),
        brandToken: "--primary",
        protectedToken: "--warning",
        meanings: ["status", "data quality"],
      },
    ])
  })

  it("does not flag a hover accent beside a focus ring in one unconditional class list", () => {
    // CalendarTimeGrid.tsx:845 — both are true at once, neither encodes the
    // other's state. A proximity rule would have failed the file.
    const both =
      'className="border-[--border-strong] hover:border-[--primary] focus-visible:ring-[--border-focus]"'
    expect(conditionalMeaningOffenders(both)).toEqual([])
  })

  it("does not flag a conditional between two brand shades", () => {
    expect(
      conditionalMeaningOffenders('const c = active ? "var(--primary)" : "var(--primary-light)"'),
    ).toEqual([])
  })

  it("ignores the defect quoted inside a comment", () => {
    expect(
      conditionalMeaningOffenders(
        '// was: variance < 0 ? "text-[--error]" : "text-[--primary]"\nconst x = 1',
      ),
    ).toEqual([])
  })

  it("does not flag two JSX subtrees that merely contain the tokens", () => {
    // settings/page.tsx is this shape. Reporting it would have had somebody
    // "fix" correct code, which is the expensive kind of false positive.
    const jsx =
      'cond ? (<div className="bg-[--primary]"><p>a</p></div>) : (<div className="text-[--error]"><p>b</p></div>)'
    expect(conditionalMeaningOffenders(jsx)).toEqual([])
  })

  it("leaves no unexcepted offender anywhere in the product tree", () => {
    const offenders: string[] = []
    for (const file of productModules()) {
      const relative = path.relative(APP_ROOT, file).split(path.sep).join("/")
      if (MEANING_CONDITIONAL_EXCEPTIONS.some((e) => e.file === relative)) continue
      for (const offence of conditionalMeaningOffenders(fs.readFileSync(file, "utf8"))) {
        offenders.push(
          `${relative}: ${offence.brandToken} against ${offence.protectedToken} (${offence.meanings.join("/")}) — ${offence.conditional}`,
        )
      }
    }
    expect(offenders).toEqual([])
  })

  it("keeps no exception that has stopped matching anything", () => {
    // An exception that outlives its code is permission nobody reviewed.
    for (const exception of MEANING_CONDITIONAL_EXCEPTIONS) {
      const source = fs.readFileSync(path.join(APP_ROOT, exception.file), "utf8")
      expect({ file: exception.file, offences: conditionalMeaningOffenders(source).length }).toEqual({
        file: exception.file,
        offences: 1,
      })
      expect(exception.reason.length).toBeGreaterThan(40)
    }
  })
})
