/**
 * GE-143-004 — the design-token boundary in `apps/web/eslint.config.mjs`.
 *
 * The rules are only worth anything if the linter that CI runs actually
 * enforces them, so this drives the real ESLint binary over the real config
 * file rather than reconstructing the rule objects in-process. A copy of the
 * config here would keep passing after someone deleted the rules from the file
 * that ships, which is the one failure this test exists to prevent.
 *
 * `--stdin --stdin-filename` is what lets a fixture be linted *as if* it were a
 * product module or one of the excepted files, without writing throwaway files
 * into the tree.
 *
 * It lives under scripts/ rather than beside eslint.config.mjs because jest's
 * roots are src/, scripts/ and packages/ (jest.config.js) — a test at the app
 * root would never be collected, and an uncollected test proves nothing.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

const APP_ROOT = path.resolve(__dirname, "..")
const CONFIG_HREF = pathToFileURL(path.join(APP_ROOT, "eslint.config.mjs")).href

// Resolved rather than assumed: npm hoists eslint to the monorepo root today,
// but a nested install would break a hand-written ../../ path silently.
const requireFromApp = createRequire(path.join(APP_ROOT, "package.json"))
const ESLINT_BIN = path.join(path.dirname(requireFromApp.resolve("eslint/package.json")), "bin", "eslint.js")

const SLOW = 180_000

/** The two rules this config adds. Everything else in the report is noise. */
const DESIGN_TOKEN_RULE_IDS = new Set(["no-restricted-syntax", "no-restricted-imports"])

/**
 * Lints `source` as though it were the file at `filePath`, through the real
 * ESLint CLI and the real eslint.config.mjs, and returns only the messages the
 * design-token rules produced.
 */
function lintAs(filePath, source, env = {}) {
  const run = spawnSync(
    process.execPath,
    [ESLINT_BIN, "--stdin", "--stdin-filename", filePath, "--format", "json"],
    { cwd: APP_ROOT, input: source, encoding: "utf8", env: { ...process.env, ...env } }
  )
  if (run.error) throw run.error
  const report = run.stdout.trim()
  if (!report.startsWith("[")) {
    throw new Error(`eslint produced no report for ${filePath}\nstdout: ${run.stdout}\nstderr: ${run.stderr}`)
  }
  return JSON.parse(report)[0].messages.filter((m) => DESIGN_TOKEN_RULE_IDS.has(m.ruleId))
}

const textOf = (messages) => messages.map((m) => m.message).join("\n")

/**
 * Evaluates a snippet against the config module's real exports, in real Node ESM.
 *
 * The prelude runs ESLint over a scrap of source before importing anything,
 * which is not ceremony: `eslint-config-next` loads `@rushstack/eslint-patch`,
 * and that refuses to patch — hard, with a throw — unless ESLint itself is the
 * module doing the loading. Letting the linter load the config first satisfies
 * it, and Node's ESM cache then hands back the *same module instance ESLint is
 * using*, so the helpers exercised below are the ones actually deciding what
 * `npm run lint` enforces rather than a second evaluation of the same source.
 */
function inConfigModule(body) {
  const script = [
    'import { createRequire } from "node:module"',
    `const requireFromApp = createRequire(${JSON.stringify(path.join(APP_ROOT, "package.json"))})`,
    'const { ESLint } = requireFromApp("eslint")',
    `await new ESLint({ cwd: ${JSON.stringify(APP_ROOT)} }).lintText("const primed = 1\\n", { filePath: "src/components/prime.tsx" })`,
    `const { lintToday, designTokenConfigs, DESIGN_TOKEN_EXCEPTIONS } = await import(${JSON.stringify(CONFIG_HREF)})`,
    body,
  ].join("\n")
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: APP_ROOT,
    encoding: "utf8",
  })
  if (run.error) throw run.error
  if (run.status !== 0) throw new Error(`config module evaluation failed:\n${run.stderr}`)
  return JSON.parse(run.stdout.trim())
}

describe("design-token lint boundary", () => {
  it(
    "rejects every way a product module can bypass the token layer",
    () => {
      const messages = lintAs(
        "src/components/probe/DesignTokenProbe.tsx",
        [
          'import { Star } from "lucide-react"',
          "export const Probe = () => (",
          '  <div className="bg-[#ff0000] shadow-[0_1px_2px] font-[Comic]" style={{ color: "#25a96d" }}>',
          "    <Star />",
          "  </div>",
          ")",
        ].join("\n")
      )

      const text = textOf(messages)
      expect(text).toContain("Literal colour value in a product module")
      expect(text).toContain("Tailwind arbitrary colour value")
      expect(text).toContain("Arbitrary shadow bypasses the elevation scale")
      expect(text).toContain("Unregistered font family")
      expect(text).toContain('Import icons from "@/components/ui/icons"')
      // Errors, not warnings — a warning does not fail CI, and `npm run lint`
      // is the only thing standing between this and a merged literal.
      expect(messages.every((m) => m.severity === 2)).toBe(true)
    },
    SLOW
  )

  it(
    "leaves the arbitrary values that have no token to point at alone",
    () => {
      // Deliberately out of scope, and pinned so widening the rules to cover
      // spacing or z-index is a decision someone makes on purpose: there is no
      // `spacing` or `zIndex` scale in tailwind.config.ts to name in the
      // message, and 237 existing occurrences across 58 files would red CI.
      const messages = lintAs(
        "src/components/probe/Spacing.tsx",
        'export const cls = "text-[13px] z-[60] w-[min(26rem,100vw)] p-[7px]"'
      )

      expect(messages).toHaveLength(0)
    },
    SLOW
  )

  it(
    "allows a documented exception, and only the rule that exception names",
    () => {
      // src/app/manifest.ts holds a live `allow: ["colorLiteral"]` exception —
      // the PWA manifest's colours are read before any stylesheet exists.
      expect(lintAs("src/app/manifest.ts", 'export const bg = "#f0efe9"')).toHaveLength(0)

      // The same file has no exception for shadows. The literal inside the
      // arbitrary value stays quiet (colourLiteral is suspended here); the
      // shadow does not — which is the scoping, not a blanket "off".
      const text = textOf(
        lintAs("src/app/manifest.ts", 'export const cls = "shadow-[0_1px_2px_rgba(0,0,0,0.1)]"')
      )
      expect(text).toContain("Arbitrary shadow bypasses the elevation scale")
      expect(text).not.toContain("Literal colour value in a product module")
    },
    SLOW
  )

  it(
    "stops honouring an exception once its expiry date has passed",
    () => {
      const text = textOf(
        lintAs("src/app/manifest.ts", 'export const bg = "#f0efe9"', {
          TENURE_DESIGN_TOKEN_TODAY: "2099-01-01",
        })
      )

      // Names the exception, the date, and the reason it was granted.
      expect(text).toContain("expired on 2027-08-06")
      expect(text).toContain("src/app/layout.tsx, src/app/manifest.ts")
      expect(text).toContain("read by the user agent before any stylesheet exists")
      // And the literal it was suppressing reports again.
      expect(text).toContain("Literal colour value in a product module")
    },
    SLOW
  )

  it(
    "lets the icon registry name the vendor package it exists to wrap",
    () => {
      expect(
        lintAs("src/components/ui/icons.tsx", 'export { Star as Sparkle } from "@phosphor-icons/react/ssr"')
      ).toHaveLength(0)

      // Anywhere else, the same import is the thing the registry prevents.
      const text = textOf(
        lintAs("src/components/probe/Icons.tsx", 'export { Star } from "@phosphor-icons/react/ssr"')
      )
      expect(text).toContain('Import icons from "@/components/ui/icons"')
    },
    SLOW
  )

  it(
    "moves the expiry clock forwards only, and refuses a malformed exception",
    () => {
      const out = inConfigModule(
        [
          "const at = new Date(\"2026-08-06T00:00:00Z\")",
          "const out = {}",
          'out.backwards = lintToday({ TENURE_DESIGN_TOKEN_TODAY: "1999-01-01" }, at)',
          'out.forwards = lintToday({ TENURE_DESIGN_TOKEN_TODAY: "2099-01-01" }, at)',
          "out.unset = lintToday({}, at)",
          'const base = { files: ["src/app/page.tsx"], allow: ["colorLiteral"], reason: "a reason long enough to clear the length check" }',
          'try { designTokenConfigs([base], "2026-08-06"); out.noExpiry = null } catch (e) { out.noExpiry = e.message }',
          'try { designTokenConfigs([{ ...base, expires: "soon" }], "2026-08-06"); out.badExpiry = null } catch (e) { out.badExpiry = e.message }',
          'try { designTokenConfigs([{ ...base, allow: ["nope"], expires: "2027-01-01" }], "2026-08-06"); out.unknownRule = null } catch (e) { out.unknownRule = e.message }',
          "out.shippedExpiries = DESIGN_TOKEN_EXCEPTIONS.map((e) => Date.parse(e.expires))",
          "console.log(JSON.stringify(out))",
        ].join("\n")
      )

      // A date in the past cannot revive a dead exception from CI config.
      expect(out.backwards).toBe("2026-08-06")
      expect(out.forwards).toBe("2099-01-01")
      expect(out.unset).toBe("2026-08-06")

      // An exception without an enforceable expiry is not an exception.
      expect(out.noExpiry).toContain("needs an `expires` date")
      expect(out.badExpiry).toContain("needs an `expires` date")
      expect(out.unknownRule).toContain("suspends unknown rule")

      // Every exception that actually ships carries one.
      expect(out.shippedExpiries.length).toBeGreaterThan(0)
      expect(out.shippedExpiries.every((t) => Number.isFinite(t))).toBe(true)
    },
    SLOW
  )
})
