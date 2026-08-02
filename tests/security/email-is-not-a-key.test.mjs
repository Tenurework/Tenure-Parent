import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-040-002 — email is an attribute, never the stable key.
 *
 * Bible §"Canonical objects": `ExternalIdentity` is a "verified
 * issuer/subject/connection identity link; email is an attribute, never the
 * stable key". §9.1 adds that the login resolver "never reveals whether a
 * person exists or grants membership from an email domain".
 *
 * `packages/identity/src/keying.ts` gets this right and is tested for it. This
 * file exists because the rule is only worth anything if it holds at every call
 * site, and the way it breaks is not that somebody argues with it — it is that
 * somebody writes `findUnique({ where: { email } })` because it is the obvious
 * thing to write, and a later caller treats the result as authentication.
 *
 * The distinction this enforces:
 *
 *   * Looking a person up by address to *show* something, to invite them, or to
 *     report a collision is fine. Those are the legitimate uses and they are
 *     the majority.
 *   * Resolving an authenticated identity by address is not. That is the
 *     takeover: an attacker who can receive mail at a re-issued departmental
 *     alias inherits the account.
 *
 * So this does not ban email lookups. It bans them in the modules that decide
 * *who someone is* — the authentication and authorization paths — where the
 * only legitimate key is the composite one.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

/**
 * The modules that answer "who is this" and "what may they do".
 *
 * Deliberately a short, named list rather than the whole tree. A rule applied
 * everywhere would fire on the invitation form and the people directory, both
 * of which look people up by address for good reasons, and a guard that cries
 * wolf gets an exemption added rather than a bug fixed.
 */
const IDENTITY_DECIDING = [
  "apps/web/src/lib/rbac.ts",
  "apps/web/src/lib/auth.ts",
  "apps/web/src/lib/auth-connections.ts",
  "packages/identity/src",
  "packages/authorization/src",
]

/**
 * Lookups that resolve identity by address on purpose, with the reason and the
 * residual risk. Named files, never patterns.
 */
const EXEMPT = new Map([
  [
    "apps/web/src/lib/auth.ts",
    "The pilot's interim dev-login provider authenticates by email plus a shared passphrase, " +
      "gated on AUTH_DEV_LOGIN. It is exactly the pattern this rule exists to stop, and it is " +
      "here deliberately until Cognito replaces it (GE-041). Residual risk, stated rather than " +
      "hidden: anyone holding the shared passphrase can enumerate which addresses have accounts, " +
      "because the lookup returns a user for a known address and null for an unknown one. The " +
      "passphrase gate runs BEFORE the lookup, so someone without it cannot probe at all — that " +
      "ordering is asserted below, because it is the only part of this that protects anyone.",
  ],
])

/** Files under the identity-deciding paths, tracked or merely present. */
function decidingFiles() {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", ...IDENTITY_DECIDING],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.(test|itest)\.tsx?$/.test(file))

  assert.ok(listed.length > 0, "the identity-deciding path list matched no files — it has drifted")
  return listed
}

/** Source with comments stripped, so prose about email is not a lookup by email. */
function code(file) {
  return fs
    .readFileSync(path.join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/**
 * A database lookup keyed on an email field.
 *
 * Matches `where: { email`, `where: { email:`, and the `email_something`
 * compound-key form Prisma generates. Not a bare mention of the word: the
 * identity package handles `assertedEmail` constantly and legitimately.
 */
const KEYED_ON_EMAIL = /where\s*:\s*\{[^}]*\bemail\s*[:,}]/

test("no identity-deciding module resolves a person by email", () => {
  const offenders = []

  for (const file of decidingFiles()) {
    if (EXEMPT.has(file)) continue
    const text = code(file)
    if (KEYED_ON_EMAIL.test(text)) {
      const line = text.split("\n").findIndex((l) => KEYED_ON_EMAIL.test(l)) + 1
      offenders.push(`${file}:${line}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these modules decide identity and look a person up by email:\n  ${offenders.join("\n  ")}\n` +
      `An authenticated identity is resolved by connection + issuer + subject ` +
      `(packages/identity/src/keying.ts). An address is an attribute the provider asserts, and ` +
      `anyone who can receive mail at it is not thereby the person.`,
  )
})

test("the keying module offers no way to resolve an identity by email", () => {
  // The rule is worth more as an absence than as a check: if there is no
  // `findByEmail` on the surface, there is no call site to misuse. This asserts
  // the absence rather than trusting it, because adding one is a two-line
  // change that would look like a convenience.
  const surface = code("packages/identity/src/keying.ts")
  for (const forbidden of ["findByEmail", "resolveByEmail", "identityForEmail", "lookupEmail"]) {
    assert.ok(!surface.includes(forbidden), `keying.ts exposes ${forbidden}, which is the takeover path`)
  }

  // And nothing merges. Merging is a reviewed decision (GE-040-004); a function
  // here would be one anybody could call on a collision report.
  assert.ok(!/export function\s+\w*[Mm]erge/.test(surface), "keying.ts exports a merge — that belongs to a reviewed flow")
})

test("the composite key includes all three parts", () => {
  // A regression to `issuer + subject` alone would let an assertion minted for
  // one tenant resolve inside another that trusts the same IdP. Asserted on the
  // source because the unit tests could be made to pass by a key that merely
  // *contains* the connection without depending on it.
  const source = code("packages/identity/src/keying.ts")
  const fn = source.slice(source.indexOf("export function identityKey"))
  const body = fn.slice(0, fn.indexOf("\n}"))

  for (const part of ["connectionId", "issuer", "subject"]) {
    assert.ok(body.includes(part), `identityKey does not use ${part}`)
  }
})

test("dev-login checks its gate before it looks anyone up", () => {
  // The one property that makes the exempted lookup defensible. If the lookup
  // moved above the gate, a wrong passphrase would still reveal which addresses
  // exist — enumeration by anyone, not merely by passphrase holders, which is
  // what Bible §9.1 forbids outright.
  // Matched on the CALL, not the identifier. `indexOf("checkDevLoginGate")`
  // finds the import at the top of the file, which precedes everything — so the
  // assertion held no matter where the gate actually ran, and moving the lookup
  // above it left this green. Third time today that use-vs-mention has bitten a
  // guard here; the shape to distrust is any guard that locates code by name.
  const text = code("apps/web/src/lib/auth.ts").replace(/^import .*$/gm, "")
  const gate = text.search(/checkDevLoginGate\s*\(/)
  const lookup = text.search(/db\.user\.findUnique\s*\(/)

  assert.ok(gate !== -1, "the dev-login gate call is gone — so is the only thing protecting the lookup")
  assert.ok(lookup !== -1, "the dev-login lookup moved; re-anchor this assertion")
  assert.ok(
    gate < lookup,
    "the dev-login lookup runs before its passphrase gate, so a wrong passphrase can probe which addresses exist",
  )
})

test("every exemption names a real file, and says why", () => {
  for (const [file, why] of EXEMPT) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is exempt but does not exist`)
    assert.ok(why.length > 80, `${file} is exempt without a real reason`)
  }
  assert.equal(EXEMPT.size, 1, "the identity-by-email exemption list changed")
})

test("every identity-deciding path still exists", () => {
  // A path that has been moved or renamed stops protecting anything, silently.
  for (const target of IDENTITY_DECIDING) {
    assert.ok(fs.existsSync(path.join(ROOT, target)), `${target} is guarded but does not exist`)
  }
})
