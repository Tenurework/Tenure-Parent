import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { test } from "node:test"

import { ROOT } from "../../tools/pack-surface-inventory.mjs"

/**
 * PACK-030-005 — no UI and no API labels unsupported scope available.
 *
 * The gates themselves exist and are tested: `isUsable` and
 * `availabilityDecisions` in `packages/provisioning/src/catalogs.ts` refuse an
 * uncertified entry, a lapsed certification and a region the entry was never
 * reviewed for (PACK-050-004, PACK-080-003, 47 tests), `resolveModules` refuses
 * an `UNAVAILABLE` mode and removes an unresolvable module to a fixed point
 * (PACK-GATE-010), and `validateManifest` refuses `lifecycle: "available"`
 * beside a declared gap (PACK-000-002).
 *
 * None of that is what this requirement asks. It asks whether the SURFACE can
 * say "available" about something the gate would refuse — and every failure of
 * that kind this repository has actually had was a literal at a call site,
 * invisible to the gate and to every test that builds its own fixture:
 *
 *   * `certified: true` written into JSX at four call sites while
 *     `RELAY_ANTHROPIC_REVIEW.state` was `NOT_SUBMITTED`
 *     (`tests/architecture/certified-is-derived.test.mjs`, WRK-030-005);
 *   * the Studio composer mapping `MODULE_CATALOG.all()` and DROPPING
 *     `lifecycle`, so a module in `development` was offered as an ordinary
 *     checkbox — "an `Available` claim made by omission", and the one thing
 *     PACK-000-004's entry records as having no automated check.
 *
 * So this is lexical, deliberately, and it states four separate properties. A
 * label must be derived; nothing may assert availability as a literal; the
 * tenant application may not render the catalog instead of the system it
 * resolved; and a surface that offers the whole catalog must carry each
 * module's lifecycle and take `enableable` from the resolver's own set rather
 * than from a second list.
 */

const IS_TEST = /\.(test|itest|spec)\.tsx?$/

function tracked(dir) {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", dir], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => !IS_TEST.test(f))
}

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n")

/**
 * Comments stripped.
 *
 * Four files in this tree discuss the `Available` claim in prose — including
 * `catalogs.ts`, which quotes Bible §5 about it — and a guard that fired on the
 * documentation of the rule it enforces would have to be switched off to pass.
 */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n")

/** Every shipped surface either app renders. */
const SURFACE_ROOTS = [
  "apps/web/src/app",
  "apps/web/src/components",
  "apps/system-studio/src/app",
  "apps/system-studio/src/components",
]

/** Everything that is shipped, surfaces and libraries alike. */
const SHIPPED_ROOTS = ["apps/web/src", "apps/system-studio/src", "packages", "modules", "blueprints"]

/**
 * What counts as deriving the label.
 *
 * Each of these is a value some gate computed: `available` is the field
 * `availabilityDecisions` sets, `isUsable` is the function that sets it,
 * `certificationState` decides whether a certification is current, `ENABLEABLE`
 * is the set `resolveModules` refuses with, and `lifecycle` is the manifest
 * field `validateManifest` guards. A file rendering the word while touching
 * none of them is rendering an opinion.
 */
const DERIVATIONS = ["availabilityDecisions", ".available", "isUsable", "certificationState", "ENABLEABLE", "lifecycle"]

test("every surface that labels something Available derives the label", () => {
  const files = SURFACE_ROOTS.flatMap(tracked)
  assert.ok(files.length > 100, `scanned ${files.length} surface files — the listing is broken, not the code`)

  const labelled = files.filter((f) => /\bAvailable\b/.test(code(read(f))))
  // The probe has to find something. An absence asserted over a scan that
  // matches nothing is the shape of a test that passes because it is blind, and
  // this one is calibrated against a label that is really rendered:
  // `apps/system-studio/src/app/page.tsx` draws "Available — n of m".
  assert.ok(
    labelled.length >= 1,
    "no shipped surface contains the label `Available` at all — the scanner is broken",
  )

  const undeclared = labelled.filter((f) => {
    const text = code(read(f))
    return !DERIVATIONS.some((d) => text.includes(d))
  })
  assert.deepEqual(
    undeclared,
    [],
    `these surfaces label something Available without deriving it from a gate: ${undeclared.join(", ")}`,
  )
})

test("nothing asserts availability as a literal", () => {
  const files = SHIPPED_ROOTS.flatMap(tracked)
  assert.ok(files.length > 400, `scanned ${files.length} shipped files — the listing is broken`)

  // `available: true` written by hand is the claim itself: a value no gate
  // produced, in the shape the gate's own output takes, which every consumer
  // downstream will treat as a decision. `available: false` is not forbidden —
  // refusing is always safe — so the asymmetry here is deliberate.
  const asserted = files.filter((f) => /\bavailable\s*:\s*true\b/.test(code(read(f))))
  assert.deepEqual(asserted, [], `these files assert availability rather than deriving it: ${asserted.join(", ")}`)
})

test("the tenant application renders the system it resolved, never the catalog", () => {
  // `resolveModules` removes an unresolvable, suspended, unsupported or
  // wrong-mode module to a fixed point, and `modulesFor` is the only door to
  // it. A tenant surface that reached `MODULE_CATALOG` instead would list every
  // module the platform ships as though this tenant ran it — the widest
  // possible version of this requirement's failure, and one no unit test on the
  // resolver can see.
  const ui = [...tracked("apps/web/src/app/(app)"), ...tracked("apps/web/src/components")]
  assert.ok(ui.length > 80, `scanned ${ui.length} tenant UI files — the listing is broken`)

  const reachers = ui.filter((f) => /@tenure\/modules/.test(code(read(f))))
  assert.deepEqual(
    reachers,
    [],
    `these tenant surfaces import the module catalog directly: ${reachers.join(", ")}`,
  )

  // And the one API that reports a tenant's module state reports the resolver's
  // answer, including what it refused. Reporting the enabled set alone would be
  // a UI that cannot tell "you do not run this" from "we could not resolve it".
  const me = code(read("apps/web/src/app/api/me/route.ts"))
  assert.match(me, /modulesFor/, "/api/me does not resolve the tenant's modules")
  assert.match(me, /moduleProblems/, "/api/me does not report what resolution refused")
  assert.match(me, /moduleAdvisories/, "/api/me does not report the limits of what it enabled")
})

test("an operator surface that offers the whole catalog carries each module's state", () => {
  // Surfaces only. `packages/platform-config/src/build-system.ts` also walks
  // `MODULE_CATALOG.all()` — for the version and dependency maps a release is
  // validated against — and offers nothing to anybody. The claim here is about
  // a list somebody is invited to choose from, so it is scoped to the files
  // that render one.
  const files = SURFACE_ROOTS.flatMap(tracked)
  const offers = files.filter((f) => /MODULE_CATALOG\s*\.\s*all\s*\(/.test(code(read(f))))
  // PACK-000-004's defect was in exactly one such file. If this list is empty
  // the check has stopped watching anything.
  assert.ok(
    offers.length >= 1,
    "nothing calls MODULE_CATALOG.all() — either the composer stopped offering modules or this scan is broken",
  )

  for (const f of offers) {
    const text = code(read(f))
    // A property assignment, not the word. `enableable: ENABLEABLE.has(m.lifecycle)`
    // mentions `lifecycle` while handing the UI nothing to show, and the first
    // version of this check passed against exactly that — the field deleted, the
    // word still present twice. One token absorbing another is how a guard comes
    // to certify the defect it was written for.
    assert.match(
      text,
      /\blifecycle\s*:/,
      `${f} offers every module in the catalog without carrying its lifecycle into what it renders — ` +
        "a module in `development` or `retired` would be offered as an ordinary choice",
    )
    // The call, not the import. `enableable: true` leaves the symbol imported
    // and the decision gone.
    assert.match(
      text,
      /ENABLEABLE\s*\.\s*has\s*\(/,
      `${f} offers every module in the catalog and decides what may be enabled from something other ` +
        "than the ENABLEABLE set the resolver refuses with",
    )
  }
})
