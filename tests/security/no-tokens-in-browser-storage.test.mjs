import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-042-005 — no token ever reaches browser storage.
 *
 * Bible §9.1: "Tokens are not stored in browser local storage." The reason is
 * the whole of GE-042-004's design: the session cookie is `HttpOnly` precisely
 * so that one XSS is not one stolen session, and putting a token in
 * `localStorage` hands that back — anything script can read, injected script
 * can read and exfiltrate. `sessionStorage` and `IndexedDB` are the same
 * property with a shorter lifetime, and a token in a JS-writable cookie is the
 * same mistake wearing the shape of the thing that was supposed to prevent it.
 *
 * ## This bans tokens, not storage
 *
 * `localStorage` is the right place for a theme preference, a collapsed
 * sidebar, and the command palette's recents — all of which this repository
 * legitimately stores today. A guard that banned the API outright would fire on
 * correct code, and a guard that fires on correct code gets an exemption added
 * rather than a bug fixed.
 *
 * So it matches the *vocabulary of credentials* at a storage call site: a key
 * or value naming a token, a JWT, a bearer credential, a secret or a refresh.
 * Written while the count was zero, which is the cheap moment: the first token
 * put there will be put there by somebody wiring an API call in a hurry.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const SCAN_ROOTS = ["apps", "packages", "modules", "blueprints"]

function sourceFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", ...SCAN_ROOTS],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter((file) => /\.(ts|tsx|mjs|cjs|jsx?)$/.test(file))
}

/**
 * Source with comments stripped, so prose about localStorage is not a use of it.
 *
 * Returns "" for a file that has vanished — `git ls-files --others` lists
 * untracked files, and one can disappear between the listing and the read when
 * guards run in parallel.
 */
function code(file) {
  let text
  try {
    text = fs.readFileSync(path.join(ROOT, file), "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return ""
    throw error
  }
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/** A write to somewhere script can read back. */
const STORAGE_WRITE =
  /\b(localStorage|sessionStorage)\s*\.\s*setItem\s*\(|\bindexedDB\s*\.\s*open\s*\(|\bdocument\s*\.\s*cookie\s*=/g

/**
 * Credential vocabulary.
 *
 * Deliberately not the bare word "session": this repository stores a
 * `tenure-nav` preference and a session-scoped UI hint, and matching "session"
 * would fire on `sessionStorage` itself.
 */
const CREDENTIAL = /\b(access_?token|refresh_?token|id_?token|bearer|jwt|credential|api_?key|apikey|secret|password)\b/i

/** The argument text of each storage write, brace-matched. */
function storageWrites(text) {
  const writes = []
  for (const match of text.matchAll(STORAGE_WRITE)) {
    // A `document.cookie = ...` assignment has no parentheses; take the line.
    if (match[0].includes("cookie")) {
      const end = text.indexOf("\n", match.index)
      writes.push(text.slice(match.index, end === -1 ? text.length : end))
      continue
    }
    const open = text.indexOf("(", match.index)
    let depth = 0
    for (let i = open; i < text.length; i++) {
      if (text[i] === "(") depth++
      else if (text[i] === ")") {
        depth--
        if (depth === 0) {
          writes.push(text.slice(match.index, i + 1))
          break
        }
      }
    }
  }
  return writes
}

/**
 * The credential-bearing storage writes in one file's source.
 *
 * Extracted so the sweep below is a single call to it and the self-test
 * exercises the same function. A mutation *inside* this is caught; only
 * deleting the sweep entirely is not, and no guard can catch its own removal —
 * that is what the exemption-count ratchets and review are for.
 */
export function credentialWrites(text) {
  return storageWrites(text).filter((write) => CREDENTIAL.test(write))
}

test("no token, key or credential is written to browser storage", () => {
  const offenders = []

  for (const file of sourceFiles()) {
    for (const write of credentialWrites(code(file))) {
      offenders.push(`${file} — ${write.replace(/\s+/g, " ").slice(0, 110)}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these write a credential somewhere script can read it back:\n  ${offenders.join("\n  ")}\n` +
      `Bible §9.1: tokens are not stored in browser storage. The session cookie is HttpOnly so that ` +
      `one XSS is not one stolen session; a token in localStorage hands that back.`,
  )
})

test("the detector can tell a preference from a credential", () => {
  // Asserted on the detector, because its failure mode is silence: a matcher
  // that finds nothing reports every file as clean. The first version of a
  // guard like this usually bans the API outright and fires on correct code.
  const preference = 'window.localStorage.setItem("tenure-theme", "dark")'
  const credential = 'window.localStorage.setItem("access_token", token)'
  const cookie = 'document.cookie = "jwt=" + token'

  // Through `credentialWrites`, which is what the sweep calls — testing the
  // pieces separately would leave the composition of them unproven.
  assert.equal(storageWrites(preference).length, 1, "the extractor must find the write at all")
  assert.deepEqual(credentialWrites(preference), [], "a theme preference is not a credential")
  assert.equal(credentialWrites(credential).length, 1, "an access token is")
  assert.equal(credentialWrites(cookie).length, 1, "a token in a script-written cookie is")
})

test("the storage this repository legitimately uses is still allowed", () => {
  // The guard's value depends on it never firing on the theme switcher, the
  // side-nav state or the command palette's recents. If it did, somebody would
  // exempt the file rather than fix the finding.
  const known = [
    "apps/web/src/components/ThemeSwitcher.tsx",
    "apps/web/src/components/shell/SideNav.tsx",
    "apps/system-studio/src/components/CommandPalette.tsx",
  ]
  for (const file of known) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is asserted on but does not exist`)
    assert.deepEqual(
      credentialWrites(code(file)),
      [],
      `${file} now stores a credential`,
    )
  }
})

test("an ID token cannot be validated as an API access token", () => {
  // The other half of the item, asserted on the surface: the two validators
  // must not be interchangeable. `ExpectedAccessToken` names its audience field
  // `resourceServer` deliberately — the field name is what stops somebody
  // passing the client id, which is the mistake that makes an ID token pass.
  const source = code("packages/identity/src/token-validation.ts")

  assert.match(source, /export function validateAccessToken/)
  assert.match(source, /resourceServer/, "the access-token audience is the API, not the client")
  assert.match(
    source,
    /claims\.token_use !== "access"/,
    "an access token must be positively identified, not assumed when the marker is absent",
  )
  assert.ok(
    !/interface ExpectedAccessToken[\s\S]{0,400}clientId/.test(source),
    "ExpectedAccessToken names a clientId, which invites passing the value that makes an ID token pass",
  )
})
