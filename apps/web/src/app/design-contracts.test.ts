/**
 * TTES-010-003 / TTES-010-005 — the z-layer, motion and density contracts.
 *
 * These are the three token families that carry an ORDER or a RELATIONSHIP
 * rather than a single value, which is why they get a test and `--radius-md`
 * does not. A radius that drifts looks slightly wrong; a scrim that drifts above
 * the nav it belongs to makes the navigation unclickable, and nothing about the
 * stylesheet says so.
 *
 * Everything here reads the shipped files — `src/app/globals.css` and
 * `tailwind.config.ts` — rather than a fixture. A fixture would keep passing
 * after someone deleted the `zIndex` block from the config that Tailwind
 * actually loads, which is the single mutation this file exists to catch.
 *
 * The last case is the one that keeps the whole thing honest: it walks every
 * product module and asserts none of them names a raw layer or duration. The
 * ESLint rule in `eslint.config.mjs` enforces that at commit time, but the two
 * fail differently — the lint rule fails on the file being edited, this fails on
 * the contract as a whole — and the contract is what the invariants are about.
 */
import fs from "node:fs"
import path from "node:path"

import { THEME_BOOT_SCRIPT } from "@/lib/a11y/theme-resolution"
import tailwindConfig from "../../tailwind.config"

const APP_ROOT = path.resolve(__dirname, "../..")
const GLOBALS_CSS = fs.readFileSync(path.join(APP_ROOT, "src/app/globals.css"), "utf8")

const extend = tailwindConfig.theme?.extend ?? {}

/** `--name: value;` declarations, first occurrence wins (the `:root` default). */
function declarations(prefix: string): Map<string, string> {
  const out = new Map<string, string>()
  // `(?:-…)?` so a family whose base token has no suffix — `--control-h` beside
  // `--control-h-sm` — is not silently dropped from its own family.
  const rx = new RegExp(String.raw`^\s*--(${prefix}(?:-[a-z0-9-]+)?)\s*:\s*([^;]+);`, "gm")
  for (const m of GLOBALS_CSS.matchAll(rx)) {
    if (!out.has(m[1])) out.set(m[1], m[2].trim())
  }
  return out
}

/** The `:root[data-density="compact"]` block, so the override can be read alone. */
function compactBlock(): string {
  const start = GLOBALS_CSS.indexOf(':root[data-density="compact"]')
  expect(start).toBeGreaterThan(-1)
  const open = GLOBALS_CSS.indexOf("{", start)
  const close = GLOBALS_CSS.indexOf("}", open)
  return GLOBALS_CSS.slice(open, close)
}

function ms(value: string): number {
  const m = /^(-?[\d.]+)(ms|s)$/.exec(value.trim())
  if (!m) throw new Error(`not a CSS time: ${JSON.stringify(value)}`)
  return m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1])
}

/** Every .ts/.tsx that ships, excluding tests. Mirrors PRODUCT_MODULES in eslint.config.mjs. */
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

describe("z-layer contract", () => {
  const layers = declarations("z")

  it("declares a scale, and every layer is a distinct integer", () => {
    // Not a smoke check: a duplicate value is exactly the defect this replaced.
    // SkipLink and Overlay were both z-[100], so which one won was decided by
    // where react-aria happened to portal the dialog.
    expect(layers.size).toBeGreaterThanOrEqual(12)

    const values = [...layers.values()].map((v) => {
      expect(v).toMatch(/^\d+$/)
      return Number(v)
    })
    expect(new Set(values).size).toBe(values.length)
  })

  it("is strictly increasing in declaration order", () => {
    // Declaration order is the documentation. A scale you have to sort to read
    // is a scale nobody reads.
    const values = [...layers.values()].map(Number)
    for (let i = 1; i < values.length; i++) {
      expect(`${[...layers.keys()][i]}=${values[i]}`).toBe(`${[...layers.keys()][i]}=${values[i]}`)
      expect(values[i]).toBeGreaterThan(values[i - 1])
    }
  })

  it("keeps the nav-drawer scrim strictly between the footer and the nav", () => {
    // The invariant the bare `z-index: 39` encoded and nothing checked. The
    // scrim has to dim the page AND the fixed footer, while leaving the drawer
    // it belongs to on top of itself. Move it below --z-sticky and the footer
    // stays bright over a dimmed page; move it above --z-nav and it covers the
    // navigation the user opened it to use.
    const value = (name: string) => Number(layers.get(name))
    expect(value("z-sticky")).toBeLessThan(value("z-scrim"))
    expect(value("z-scrim")).toBeLessThan(value("z-nav"))

    // And it is what the stylesheet's own scrim rule uses.
    expect(GLOBALS_CSS).toContain("z-index: var(--z-scrim)")
  })

  it("keeps the skip link above the modal overlay", () => {
    // WCAG 2.4.1's escape hatch cannot be the one thing a dialog covers. This
    // was the live collision: both were z-[100].
    expect(Number(layers.get("z-skip-link"))).toBeGreaterThan(Number(layers.get("z-overlay")))
  })

  it("binds every declared layer as a Tailwind class, and invents none", () => {
    // The mutation this catches: delete the zIndex block from
    // tailwind.config.ts. The classes stop existing, every migrated call site
    // silently loses its layer, and nothing else in the suite notices.
    const zIndex = extend.zIndex as Record<string, string> | undefined
    expect(zIndex).toBeDefined()

    const declared = [...layers.keys()].map((n) => n.replace(/^z-/, "")).sort()
    expect(Object.keys(zIndex!).sort()).toEqual(declared)
    for (const [key, value] of Object.entries(zIndex!)) {
      expect(value).toBe(`var(--z-${key})`)
    }
  })
})

describe("motion contract", () => {
  const motion = declarations("motion")

  it("declares three real, strictly increasing durations", () => {
    // The mutation: set --motion-base to 0s. Every panel, drawer and frame
    // reflow in the product snaps instead of moving, and no screenshot or DOM
    // assertion anywhere else would notice — `prefers-reduced-motion` collapses
    // durations too, so the reduced-motion e2e stays green either way.
    expect([...motion.keys()].sort()).toEqual(["motion-base", "motion-fast", "motion-slow"])

    const fast = ms(motion.get("motion-fast")!)
    const base = ms(motion.get("motion-base")!)
    const slow = ms(motion.get("motion-slow")!)
    expect(fast).toBeGreaterThan(0)
    expect(base).toBeGreaterThan(fast)
    expect(slow).toBeGreaterThan(base)
    // A "duration" long enough to feel like a hang is not a duration.
    expect(slow).toBeLessThanOrEqual(400)
  })

  it("declares an entry and an exit curve", () => {
    const eases = declarations("ease")
    expect([...eases.keys()].sort()).toEqual(["ease-entry", "ease-exit"])
    for (const value of eases.values()) expect(value).toMatch(/^cubic-bezier\(/)
  })

  it("binds the scale as Tailwind duration and easing classes", () => {
    expect(extend.transitionDuration).toEqual({
      fast: "var(--motion-fast)",
      base: "var(--motion-base)",
      slow: "var(--motion-slow)",
    })
    expect(extend.transitionTimingFunction).toEqual({
      entry: "var(--ease-entry)",
      exit: "var(--ease-exit)",
    })
  })

  it("leaves no literal millisecond value in the stylesheet's own animations", () => {
    // The keyframe rules are where the five original literals lived
    // (140/150/160/180/200ms). Anything still written out here is a duration
    // outside the scale, and the ESLint rule cannot see a .css file.
    const rules = GLOBALS_CSS.split("\n").filter(
      (line) => /^\s*[.:[]/.test(line) && /(animation|transition)\s*:/.test(line),
    )
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) expect(rule).not.toMatch(/\b\d+ms\b/)
  })
})

describe("density contract", () => {
  it("declares comfortable defaults that match what shipped before it existed", () => {
    // Turning the contract on had to move nothing. h-8 / h-10 / h-11 and the
    // 32px nav row are the values the product rendered before, so a regression
    // here is a visible resize of every control in the product.
    const density = declarations("control-h")
    expect(density.get("control-h-sm")).toBe("32px")
    expect(density.get("control-h")).toBe("40px")
    expect(density.get("control-h-lg")).toBe("44px")
    expect(declarations("row-h").get("row-h")).toBe("32px")
  })

  it("overrides every density token in the compact block, and only shrinks", () => {
    // A compact mode that forgets one token produces a row of controls at two
    // different heights, which reads as a rendering bug rather than a setting.
    const block = compactBlock()
    const comfortable = new Map([...declarations("control-h"), ...declarations("row-h")])

    for (const [name, value] of comfortable) {
      const m = new RegExp(String.raw`--${name}\s*:\s*([^;]+);`).exec(block)
      // The token name is in the assertion, not in a message argument, so a
      // failure names the token that was forgotten.
      expect({ token: name, overridden: m !== null }).toEqual({ token: name, overridden: true })
      expect(Number.parseFloat(m![1])).toBeLessThan(Number.parseFloat(value))
    }
    expect(block).toContain("--density-gap")
  })

  it("binds the control and row heights as Tailwind classes", () => {
    const height = extend.height as Record<string, string>
    expect(height["control-sm"]).toBe("var(--control-h-sm)")
    expect(height.control).toBe("var(--control-h)")
    expect(height["control-lg"]).toBe("var(--control-h-lg)")
    expect(height.row).toBe("var(--row-h)")
    // Square icon buttons follow the height or compact makes them oblong.
    expect((extend.width as Record<string, string>).control).toBe("var(--control-h)")
  })

  it("is stamped on <html> before hydration, and by the switcher afterwards", () => {
    // The tokens are inert until something writes the attribute. Two callers do,
    // and both have to agree on the key and on the narrowing — a script that
    // wrote `data-density="Compact"` would select nothing and fail silently.
    // GE-143-013 moved the pre-hydration string out of layout.tsx and into
    // `@/lib/a11y/theme-resolution` beside `resolveTheme`, so the theme rule
    // stopped having three implementations. The density stamp travelled with
    // it — it shares the one blocking script — so the assertion follows the
    // string rather than the file it used to be typed into, and layout.tsx is
    // checked for still injecting it.
    const layout = fs.readFileSync(path.join(APP_ROOT, "src/app/layout.tsx"), "utf8")
    expect(layout).toContain("THEME_BOOT_SCRIPT")
    expect(THEME_BOOT_SCRIPT).toContain('localStorage.getItem("tenure-density")')
    expect(THEME_BOOT_SCRIPT).toContain('setAttribute("data-density"')
    expect(THEME_BOOT_SCRIPT).toContain('"compact":"comfortable"')

    const switcher = fs.readFileSync(path.join(APP_ROOT, "src/components/DensitySwitcher.tsx"), "utf8")
    expect(switcher).toContain('"tenure-density"')
    expect(switcher).toContain('setAttribute("data-density"')

    // And it is reachable: the settings page renders the switcher.
    const settings = fs.readFileSync(path.join(APP_ROOT, "src/app/(app)/settings/page.tsx"), "utf8")
    expect(settings).toContain("<DensitySwitcher />")
  })
})

describe("the migration holds", () => {
  it("leaves no product module naming a raw layer or a raw duration", () => {
    // Twelve call sites carried a hand-picked number before this. The ESLint
    // rule stops the thirteenth; this asserts the twelve actually moved, which
    // a rule that only runs on changed files would never tell you.
    const offenders: string[] = []
    for (const file of productModules()) {
      const source = fs.readFileSync(file, "utf8")
      // Strip comments: the SkipLink header explains the z-[100] collision it
      // fixed, and quoting the defect is not committing it.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      for (const m of code.matchAll(/\bz-(?:\[|\d)[^\s"'`]*|\bduration-(?:\[|\d)[^\s"'`]*/g)) {
        offenders.push(`${path.relative(APP_ROOT, file)}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
