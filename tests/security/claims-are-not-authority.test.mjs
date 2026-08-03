import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-043-003 — an assertion proposes an identity and grants nothing.
 *
 * Bible §"Decisions" 3: authority "comes from an active, scoped assignment or
 * explicit delegation, not from a title string, email domain, Cognito group, or
 * UI state."
 *
 * `provider-independence.test.mjs` forbids an authorization path from *reading*
 * a group claim — the negative half, which can only catch spellings somebody
 * thought of. This guards the positive half's two structural properties:
 * `IdentityProposal` has nowhere to put authority, and
 * `authorityFromTenureRecords` has nowhere to receive claims.
 *
 * Both are enforced by the type and the signature, which is the real defence.
 * This exists because both are one careless edit from being untrue, and that
 * edit reads as helpful — *the token already has the groups, and it saves a
 * query*.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const MODULE = "packages/identity/src/claims-input.ts"

function read(file) {
  try {
    return fs.readFileSync(path.join(ROOT, file), "utf8")
  } catch (error) {
    // Guards run in parallel; an untracked file can vanish between the
    // listing and the read.
    if (error.code === "ENOENT") return ""
    throw error
  }
}

/** Source with comments stripped, so prose about a rule is not a breach of it. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/** The body of a named interface or function-parameter object, brace-matched. */
function blockAfter(source, marker) {
  const start = source.indexOf(marker)
  if (start === -1) return null
  const open = source.indexOf("{", start)
  if (open === -1) return null

  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++
    else if (source[i] === "}") {
      depth--
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return null
}

/**
 * Words that would make a field authority-bearing.
 *
 * Not the same list as the claim denylist elsewhere: this is about a *field on
 * our own type*, so it covers what somebody would name such a field rather than
 * what a provider would name a claim.
 */
const AUTHORITY_FIELDS =
  /\b(role|roles|group|groups|permission|permissions|capabilit|entitlement|privilege|scope|isadmin|admin|grant)/i

test("IdentityProposal has nowhere to put authority", () => {
  const source = code(read(MODULE))
  const body = blockAfter(source, "export interface IdentityProposal")

  assert.ok(body, "IdentityProposal not found — has it been renamed?")

  const offenders = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && AUTHORITY_FIELDS.test(line))

  assert.deepEqual(
    offenders,
    [],
    `IdentityProposal now carries authority:\n  ${offenders.join("\n  ")}\n` +
      `An assertion says who somebody is. What they may do comes from a membership, a seat or a ` +
      `policy — Bible "Decisions" 3.`,
  )
})

test("the proposal carries exactly the three fields it is documented to", () => {
  // A field named `department` would pass the check above and still be a claim
  // reaching further than the mapping allows. The type is small on purpose, and
  // growing it is a decision rather than an oversight.
  const source = code(read(MODULE))
  const body = blockAfter(source, "export interface IdentityProposal")

  const fields = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => /^([A-Za-z_]\w*)\??\s*:/.exec(line))
    .filter(Boolean)
    .map((match) => match[1])

  assert.deepEqual(
    [...fields].sort(),
    ["displayName", "email", "subject"],
    "IdentityProposal changed shape. Every field here is a claim that reaches the rest of the platform.",
  )
})

test("authorityFromTenureRecords cannot receive claims", () => {
  // The enforcement is the signature: a rule written as "do not read the token
  // here" is one somebody breaks by reading the token here.
  const source = code(read(MODULE))
  const body = blockAfter(source, "export function authorityFromTenureRecords")

  assert.ok(body, "authorityFromTenureRecords not found — has it been renamed?")

  const parameters = body.slice(0, body.indexOf("}"))
  assert.ok(
    !/\b(claim|claims|token|assertion|proposal|idToken|jwt)\b/i.test(parameters),
    `authorityFromTenureRecords now takes an assertion-derived value:\n${parameters.trim()}\n` +
      `Authority comes from Tenure's own records. Resolving which person this is, and what that ` +
      `person may do, are deliberately not the same call.`,
  )
})

test("the mapping reads a fixed set of claims, not whatever the token holds", () => {
  // An allowlist. A denylist has to guess every spelling — `custom:isAdmin`,
  // `urn:example:entitlements`, `dept_code` — and the one nobody thought of is
  // the one that leaks.
  const source = code(read(MODULE))
  const body = blockAfter(source, "export function proposalFromClaims")

  assert.ok(body, "proposalFromClaims not found")
  assert.ok(
    !/Object\.(keys|entries|values)\s*\(\s*claims/.test(body),
    "proposalFromClaims now enumerates the token's claims. It must read only the claims the mapping names.",
  )
  assert.ok(
    !/\.\.\.claims/.test(body),
    "proposalFromClaims now spreads the token's claims into its result.",
  )
})

test("the detectors work at all", () => {
  // Each check above passes when it finds nothing. A blockAfter that stopped
  // matching would report every one of them clean.
  const source = code(read(MODULE))

  assert.ok(blockAfter(source, "export interface IdentityProposal"), "the interface detector found nothing")
  assert.ok(blockAfter(source, "export function proposalFromClaims"), "the function detector found nothing")
  assert.ok(AUTHORITY_FIELDS.test("roles: string[]"), "the field matcher does not match an obvious case")
  assert.ok(!AUTHORITY_FIELDS.test("email: string | null"), "the field matcher fires on an ordinary field")
})
