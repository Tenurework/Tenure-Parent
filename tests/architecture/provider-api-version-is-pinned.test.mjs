import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * PAY-140-002 — the provider API version is pinned in ONE place, and the ledger
 * quotes the same one.
 *
 * Bible §16: "Pin and intentionally upgrade API versions." Before
 * `packages/payments/src/api-version.ts` existed there was nothing to hold
 * still: an upgrade would have changed event shapes under a running
 * reconciliation and no test in the repository would have gone red, because no
 * test knew which version it had been written against.
 *
 * Three checks, and each one closes a different way for the pin to stop meaning
 * anything:
 *
 *   1. The constant and the ledger's evidence line agree. Bumping the constant
 *      without updating the evidence makes the ledger a record of a version
 *      that is no longer running.
 *   2. No source file outside `api-version.ts` holds a bare provider version
 *      literal. A version restated in a second file is a version that will be
 *      upgraded in one of them.
 *   3. Every `SUPPORTED_EVENT_TYPES` entry has a parser and a declared field
 *      set. An event type with no reader is one that would be recorded as
 *      processed and read by nobody.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const API_VERSION_FILE = "packages/payments/src/api-version.ts"
const LEDGER = "docs/implementation/payments-treasury-execution-ledger.md"

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8")
}

/** The pinned constant, read out of the source rather than imported. */
function pinnedVersion() {
  const source = read(API_VERSION_FILE)
  const match = /export const PROVIDER_API_VERSION = "(\d{4}-\d{2}-\d{2})" as const/.exec(source)
  assert.ok(
    match,
    `${API_VERSION_FILE} no longer declares PROVIDER_API_VERSION as a frozen date literal. ` +
      `This guard reads the source, so a change to that declaration is a change to what is pinned.`,
  )
  return match[1]
}

test("the pinned version is a date literal frozen with `as const`", () => {
  const version = pinnedVersion()
  assert.match(version, /^\d{4}-\d{2}-\d{2}$/)
})

test("the ledger's evidence line quotes the pinned version", () => {
  // MUTATION TARGET: bump PROVIDER_API_VERSION without updating the ledger and
  // this reds. That is the whole point — the two must move together, in one
  // commit, or the ledger records a version that is no longer running.
  const version = pinnedVersion()
  const ledger = read(LEDGER)
  const entry = /- \[[ xX]\] \*\*PAY-140-002\*\*[\s\S]*?(?=\n- \[[ xX]\] \*\*)/.exec(ledger)
  assert.ok(entry, "PAY-140-002 is not in the payments ledger.")
  assert.ok(
    entry[0].includes(version),
    `The payments ledger's PAY-140-002 entry does not quote the pinned version ${version}. ` +
      `Bumping the constant is an intentional upgrade (Bible §16); the evidence line moves with it.`,
  )
})

/**
 * Every tracked source file, including files not yet `git add`ed.
 *
 * `--others --exclude-standard` matters for the same reason
 * `forbidden-clients.test.mjs` states: a plain `git ls-files` sees only what has
 * been staged, so a new file restating the version would pass locally right up
 * until the commit that puts it in CI's reach.
 */
function sourceFiles() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "apps", "packages", "modules", "blueprints"],
    { encoding: "utf8", cwd: ROOT },
  )
    .split("\n")
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|mjs|cjs|jsx?)$/.test(f))

  assert.ok(
    files.length > 100,
    `only ${files.length} source files found — the scan is broken, not the code`,
  )
  return files
}

test("no source outside api-version.ts holds a bare provider version literal", () => {
  const version = pinnedVersion()
  const offenders = []

  for (const file of sourceFiles()) {
    if (file === API_VERSION_FILE) continue
    // The test file is allowed to name it: it asserts on the constant it
    // imports, and pinning the literal there would be the second copy this
    // guard exists to refuse — so it must NOT contain it either.
    let text
    try {
      text = fs.readFileSync(path.join(ROOT, file), "utf8")
    } catch {
      continue
    }
    // The pinned version is a DATE STRING, and this guard used to flag any file
    // containing it. That cannot tell a second copy of the VERSION from a
    // calendar date that happens to be the same day, and the difference is not
    // cosmetic: `packages/finops/src/general-ledger.ts` uses
    // `through: "2026-03-31"` as an accounting cut-off and its test fixes a
    // timezone boundary at `2026-03-31T23:00:00+05:30`. Those are about the 31st
    // of March. Importing PROVIDER_API_VERSION there would be actively wrong —
    // the cut-off would then silently move the next time Stripe's version is
    // bumped, which is a far worse bug than the duplication this guard prevents.
    //
    // So the match needs the version to appear in a VERSION context: on a line
    // that also names a version, or as the value of an `apiVersion`-shaped key.
    // That keeps every tooth that matters — a second `apiVersion: "2026-03-31"`,
    // a `stripe(key, { apiVersion: "2026-03-31" })`, a `const VERSION =
    // "2026-03-31"` all still fail — while letting a ledger that necessarily
    // deals in dates contain a date.
    const quoted = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const inVersionContext = new RegExp(
      `(?:version[^\\n]*["'\`]${quoted}["'\`])|(?:["'\`]${quoted}["'\`][^\\n]*version)`,
      "i",
    )
    if (inVersionContext.test(text)) {
      offenders.push(file)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these files restate the pinned provider API version ${version}:\n  ${offenders.join("\n  ")}\n` +
      `Import PROVIDER_API_VERSION from @tenure/payments. Two copies of a version is two files ` +
      `to remember on an upgrade, and the one that is forgotten is the one nothing tests.`,
  )
})

test("every supported event type has a declared field set including an id", () => {
  const source = read(API_VERSION_FILE)
  const block = /export const SUPPORTED_EVENT_TYPES[\s\S]*?\n\]/.exec(source)
  assert.ok(block, "SUPPORTED_EVENT_TYPES is no longer a literal array — this guard is not reading it.")

  const types = [...block[0].matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1])
  const fieldSets = [...block[0].matchAll(/fields:\s*\[([^\]]*)\]/g)].map((m) => m[1])

  assert.ok(types.length >= 5, `only ${types.length} event types declared — expected the shipped set.`)
  assert.equal(
    types.length,
    fieldSets.length,
    "an event type declares no `fields`. A type with no declared field set cannot be checked " +
      "against a stale provider schema, which is the case PAY-140-008 exists for.",
  )

  for (let i = 0; i < types.length; i++) {
    assert.ok(
      /"id"/.test(fieldSets[i]),
      `"${types[i]}" does not declare an "id" field, so a parsed event of that type cannot be keyed.`,
    )
  }
})

test("the parser refuses any type not in the declared set", () => {
  // Read rather than imported: this suite runs under `node --test` with no TS
  // loader. The property being asserted is that the parser's list and the
  // declared list are the SAME list, not two that happen to agree.
  const source = read(API_VERSION_FILE)
  assert.match(
    source,
    /const declared = SUPPORTED_EVENT_TYPES\.find\(\(e\) => e\.type === type\)/,
    "parseProviderEvent no longer resolves its type against SUPPORTED_EVENT_TYPES. A second list " +
      "of readable types is a list that will disagree with the declared one.",
  )
  assert.match(
    source,
    /event-type-unsupported/,
    "parseProviderEvent no longer refuses an undeclared type.",
  )
})

test("there is exactly one version comparator, and payments borrows it", () => {
  // `packages/platform-config/src/compatibility.ts` says in its own header that
  // "two copies of a version comparator is two chances to disagree". This
  // package cannot import that one at runtime — platform-config imports THIS
  // package — so the comparator is a parameter, and that is what must stay true.
  const source = read(API_VERSION_FILE)
  assert.match(
    source,
    /compare: \(x: string, y: string\) => number/,
    "api-version.ts no longer takes the comparator as a parameter. Importing @tenure/platform-config " +
      "here is a cycle (see modules.ts); writing a second comparator is the duplication that file warns about.",
  )
  assert.ok(
    !/from "@tenure\/platform-config/.test(source),
    "api-version.ts imports @tenure/platform-config, which imports @tenure/payments. That is a cycle.",
  )
})
