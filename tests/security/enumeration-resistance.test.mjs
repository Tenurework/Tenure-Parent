import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-042-007 — no unauthenticated surface says which check failed.
 *
 * Bible §9.1: "strong recovery and enumeration resistance."
 *
 * The engine names four ways authentication fails, and each is a different fact
 * somebody needs. Showing which one to the browser answers "is this person
 * here" for anybody who asks, one address at a time, and a school's address
 * format is guessable. "Your account is suspended" is worse: it confirms the
 * account exists *and* volunteers its state to whoever is holding the
 * credential, who at that moment is more likely to be the attacker than the
 * owner.
 *
 * This scans the pages a visitor reaches **before** authenticating. Everything
 * behind the session is deliberately out of scope — `accessState` (GE-042-006)
 * distinguishes suspended from revoked from never-placed, and that is right,
 * because the person reading it has proved who they are. Authentication is the
 * line: before it say nothing, after it say everything useful.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

/**
 * The surfaces a visitor reaches with no session.
 *
 * Listed rather than inferred: "unauthenticated" is not a property of a file
 * path, and a guard that guessed would either miss a page or fire on one behind
 * the session, and the second gets an exemption added rather than a bug fixed.
 */
const PRE_AUTH_SURFACES = [
  "apps/web/src/app/signin/page.tsx",
  "apps/web/src/middleware.ts",
]

/** Kept in step with `packages/identity/src/auth-errors.ts` by the test below. */
const TERMS_SOURCE = "packages/identity/src/auth-errors.ts"

function read(file) {
  try {
    return fs.readFileSync(path.join(ROOT, file), "utf8")
  } catch (error) {
    // Another guard writes a probe into the source tree while these run in
    // parallel, and a file listed a moment ago can be gone by the read.
    if (error.code === "ENOENT") return ""
    throw error
  }
}

/** The disclosing terms, read from the module rather than copied. */
function disclosingTerms() {
  const source = read(TERMS_SOURCE)
  const block = source.match(/export const DISCLOSING_TERMS = \[([\s\S]*?)\] as const/)
  assert.ok(block, `DISCLOSING_TERMS not found in ${TERMS_SOURCE}`)
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/**
 * The user-visible strings in a TSX file: JSX text, and quoted strings.
 *
 * Comments are stripped first, so prose *about* the rule — this guard exists
 * because somebody wrote "That passphrase is not correct" — is not a violation
 * of it. That distinction has caught four guards in this repository out.
 */
function visibleText(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

test("no pre-authentication surface names which check failed", () => {
  const terms = disclosingTerms()
  const offenders = []

  for (const file of PRE_AUTH_SURFACES) {
    const source = visibleText(read(file))
    for (const term of terms) {
      // Word-boundary, so `passphrase-help` (an aria id) is not a message and
      // `type="password"` is an input type rather than a sentence about one.
      const inProse = new RegExp(String.raw`[>"'\s]([^<>"'\n]{0,60}\b${term}\b[^<>"'\n]{0,60})`, "gi")
      for (const match of source.matchAll(inProse)) {
        const text = match[1].trim()
        // Only sentences. An attribute value, an identifier or a class name is
        // not something a person reads.
        if (!/[a-z] [a-z]/i.test(text)) continue
        if (!/[.!?]/.test(text)) continue
        offenders.push(`${file} — "${text.slice(0, 90)}"`)
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these tell an unauthenticated visitor which check failed:\n  ${offenders.join("\n  ")}\n` +
      `Bible §9.1 asks for enumeration resistance. Use SIGN_IN_FAILED_MESSAGE from @tenure/identity: ` +
      `one sentence for every reason, with the real one in the audit record.`,
  )
})

test("the sign-in page renders the engine's message rather than its own", () => {
  // The stronger statement, and the one that survives somebody rewording a
  // message into terms the list does not hold: the page must not author a
  // failure sentence at all.
  const source = read("apps/web/src/app/signin/page.tsx")

  assert.match(
    source,
    /SIGN_IN_FAILED_MESSAGE/,
    "the sign-in page must render the engine's single message",
  )
  // Anchored on the attribute, not the substring. `data-role="alert"` contains
  // `role="alert"` and announces nothing — a mutation that made exactly that
  // change survived the first version of this assertion.
  assert.match(
    visibleText(source),
    /(?<![-\w])role="alert"/,
    "the failure must be announced — WCAG 2.2 AA error identification (Bible §17)",
  )
})

test("the engine's own message does not name a check", () => {
  // The guard scans the page, and the page holds `{SIGN_IN_FAILED_MESSAGE}` —
  // an identifier, not a sentence. Editing the constant to "That password is
  // incorrect" therefore passed every assertion above while restoring the
  // exact disclosure this file exists to prevent. Read the value and run it
  // through the same matcher.
  const source = read(TERMS_SOURCE)
  const declared = source.match(/export const SIGN_IN_FAILED_MESSAGE\s*=\s*\n?\s*"([^"]+)"/)
  assert.ok(declared, `SIGN_IN_FAILED_MESSAGE not found in ${TERMS_SOURCE}`)

  const message = declared[1]
  const named = disclosingTerms().filter((term) => message.toLowerCase().includes(term))

  assert.deepEqual(
    named,
    [],
    `the single sign-in message names ${named.join(", ")}: "${message}"`,
  )
  assert.ok(message.length > 30, "the message must still tell the person what to do")
})

test("the terms this guard checks are the ones the engine ships", () => {
  // Asserted because the failure mode is silence: a regex that stopped matching
  // the export would yield an empty list and report every page as clean.
  const terms = disclosingTerms()

  assert.ok(terms.length > 5, `expected a real list of terms, got ${terms.length}`)
  for (const expected of ["password", "suspended", "revoked", "member"]) {
    assert.ok(terms.includes(expected), `DISCLOSING_TERMS no longer holds "${expected}"`)
  }
})

test("the guard fires on the sentence this page used to show", () => {
  // The regression it exists for, run through the same matcher rather than
  // asserted in prose. "That passphrase is not correct" names the check.
  const terms = disclosingTerms()
  const wasShown = '<p role="alert">That passphrase is not correct.</p>'

  const fired = terms.some((term) => {
    const inProse = new RegExp(String.raw`[>"'\s]([^<>"'\n]{0,60}\b${term}\b[^<>"'\n]{0,60})`, "gi")
    return [...visibleText(wasShown).matchAll(inProse)].some((m) => {
      const text = m[1].trim()
      return /[a-z] [a-z]/i.test(text) && /[.!?]/.test(text)
    })
  })

  assert.ok(fired, "the matcher no longer catches the message this guard was written for")
})

test("every pre-authentication surface listed here exists", () => {
  // An exemption list that names a moved file silently checks nothing.
  for (const file of PRE_AUTH_SURFACES) {
    assert.ok(
      fs.existsSync(path.join(ROOT, file)),
      `${file} is scanned by this guard but does not exist — did it move?`,
    )
  }
})

test("the surfaces listed are the ones a visitor can actually reach", () => {
  // The list is hand-maintained, so this catches a new public page nobody added
  // to it. `middleware.ts` decides what is public; anything it lets through
  // without a session belongs above.
  const middleware = read("apps/web/src/middleware.ts")
  assert.ok(middleware.length > 0, "middleware.ts is where the public routes are decided")

  const routes = execFileSync("git", ["ls-files", "apps/web/src/app"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((file) => /\/(signin|signout|signed-out|error|invitation|invite)\/page\.tsx$/.test(file))

  const unlisted = routes.filter((file) => !PRE_AUTH_SURFACES.includes(file))
  assert.deepEqual(
    unlisted,
    [],
    `these look like pre-authentication pages and are not scanned:\n  ${unlisted.join("\n  ")}\n` +
      `Add them to PRE_AUTH_SURFACES, or say in a comment why they are behind the session.`,
  )
})
