import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * WRK-010-004 — the shipped external-identity link, and the merge it must never
 * perform by itself.
 *
 * Bible §3.2:
 *
 *   > Do not use email address alone as identity. Resolve external principals
 *   > through verified provider identifiers and a versioned identity-link
 *   > record. Never merge identities automatically when ambiguity exists.
 *
 * ## What this file adds that `email-is-not-a-key.test.mjs` does not
 *
 * That guard (GE-040-002) bans `where: { email }` inside the identity-deciding
 * modules — the LOOKUP half. It says nothing about the MERGE half, and the
 * merge half of this application is not written in this repository at all: the
 * external principal is linked by `@auth/prisma-adapter`, which attaches an
 * `Account` row to a `User` row and, by default, refuses to attach a provider
 * account to an existing user merely because the addresses match.
 *
 * "By default" is the problem. That refusal is one boolean away —
 * `allowDangerousEmailAccountLinking: true` on a provider literal is a
 * three-word change that type-checks, renders, and passes every unit test in
 * the tree, and it converts every sign-in into precisely the automatic merge
 * §3.2 prohibits: anybody who can receive mail at a re-issued departmental
 * alias inherits the Tenure account it matches. NextAuth names it "dangerous"
 * and ships it anyway; nothing here noticed either way.
 *
 * So this file asserts the three facts that make the shipped link safe:
 *
 *   1. no provider anywhere in the tree enables email-based account linking;
 *   2. the link's key is the VERIFIED PROVIDER IDENTIFIER — `Account` is unique
 *      on `[provider, providerAccountId]` and carries no email column, so the
 *      address cannot become the key by a later schema edit without this
 *      reding;
 *   3. the merge that does exist in `packages/identity` is a REVIEWED one — it
 *      refuses a shared address as its evidence, and refuses a review by the
 *      proposer — resolved against that module's own source rather than assumed.
 *
 * ## What it deliberately does NOT claim
 *
 * `resolveAssertion` and `planLink` have no production caller: the running
 * application authenticates through NextAuth, not through them. This guard
 * therefore protects the path that runs and records what the other path is; it
 * is not evidence that §3.2's "versioned identity-link record" is implemented,
 * because `Account` carries no issuer and no version. See the WRK-010-004 row.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

/** Source with comments stripped, so prose about a flag is not the flag. */
function code(file) {
  let text
  try {
    text = fs.readFileSync(path.join(ROOT, file), "utf8")
  } catch (error) {
    // Another guard in the same parallel run may delete its own probe file
    // between the listing and the read; a file that is gone has no flag in it.
    if (error.code === "ENOENT") return ""
    throw error
  }
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/**
 * Every TypeScript source in the applications and packages, tracked or not.
 *
 * The whole tree rather than a named list, because unlike an email LOOKUP —
 * which has legitimate uses all over the product — there is no legitimate use
 * of this flag anywhere. A rule with no exceptions gets no exemption list.
 */
function sources() {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "apps", "packages", "modules"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => !file.includes("/.next/"))

  assert.ok(listed.length > 100, `expected the application sources, listed ${listed.length}`)
  return listed
}

/**
 * The provider option that turns a sign-in into an email-keyed account merge.
 *
 * Matched on the option name alone, at any value, because `false` written
 * explicitly is a reader being told the question was considered — and `true` is
 * the vulnerability. Both are worth a conversation; only one is a defect, and
 * the assertion below distinguishes them.
 */
const EMAIL_LINKING = /allowDangerousEmailAccountLinking\s*:\s*(true|false|\w+)/g

test("no provider links accounts by email address", () => {
  const offenders = []

  for (const file of sources()) {
    for (const match of code(file).matchAll(EMAIL_LINKING)) {
      // An explicit `false` is the safe value and is allowed: it says the
      // question was asked. Anything else — `true`, or a variable whose value
      // this guard cannot see — is the automatic merge §3.2 prohibits.
      if (match[1] === "false") continue
      offenders.push(`${file} — ${match[0]}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these enable email-based account linking:\n  ${offenders.join("\n  ")}\n` +
      `That attaches a provider account to whichever Tenure user shares its address, with no ` +
      `verification that they are the same human. An address is re-issued, mistyped, and ` +
      `asserted by providers that never checked it. §3.2: never merge identities automatically ` +
      `when ambiguity exists — and a matching address IS the ambiguity.`,
  )
})

test("the detector would see the flag if somebody set it", () => {
  // The sweep above passes today because the flag appears nowhere, which is
  // indistinguishable from a sweep whose pattern matches nothing.
  const planted = 'Okta({ clientId: id, allowDangerousEmailAccountLinking: true })'
  assert.equal([...planted.matchAll(EMAIL_LINKING)].length, 1)
  assert.equal([...planted.matchAll(EMAIL_LINKING)][0][1], "true")

  // And the safe form is told apart rather than lumped in.
  const explicit = "Okta({ allowDangerousEmailAccountLinking: false })"
  assert.equal([...explicit.matchAll(EMAIL_LINKING)][0][1], "false")

  // A value the guard cannot evaluate is not a pass.
  const indirect = "Okta({ allowDangerousEmailAccountLinking: linkByEmail })"
  assert.equal([...indirect.matchAll(EMAIL_LINKING)][0][1], "linkByEmail")
})

/* ───────────────────────── the link's key is the provider's own identifier */

const SCHEMA = "apps/web/prisma/schema.prisma"

test("an external account is keyed on the provider's verified identifier, not an address", () => {
  const schema = fs.readFileSync(path.join(ROOT, SCHEMA), "utf8")
  const model = schema.slice(schema.indexOf("\nmodel Account {"))
  const body = model.slice(0, model.indexOf("\n}"))

  assert.ok(body.includes("model Account {"), `${SCHEMA} no longer declares an Account model`)
  assert.match(
    body,
    /@@unique\(\[provider,\s*providerAccountId\]\)/,
    `${SCHEMA}'s Account model no longer keys on [provider, providerAccountId]. That pair IS the ` +
      `verified provider identifier §3.2 requires; without it, two provider accounts can point at ` +
      `one user by whatever else happens to match.`,
  )
  assert.doesNotMatch(
    body,
    /^\s*email\s/m,
    `${SCHEMA}'s Account model has grown an email column. An address on the link record is an ` +
      `address something will eventually join on.`,
  )
})

/* ──────────────────────────── the merge that exists is a reviewed one */

const LINKING = "packages/identity/src/linking.ts"

test("a credential held by somebody else is a refusal, never a reassignment", () => {
  const source = code(LINKING)

  const collision = source.indexOf('reason: "COLLISION"')
  assert.notEqual(
    collision,
    -1,
    `${LINKING} no longer refuses a credential that belongs to a different person. Signing in ` +
      `would then move it, which is the automatic merge performed one credential at a time.`,
  )
  // The refusal is a refusal: `linked: false` in the same returned object.
  const returned = source.slice(source.lastIndexOf("return", collision), collision)
  assert.match(
    returned,
    /linked:\s*false/,
    `${LINKING} reports a COLLISION on a successful link. A collision that still links is a merge.`,
  )
})

test("a shared address is not admissible evidence for the reviewed merge", () => {
  const source = code(LINKING)

  assert.match(
    source,
    /export function validateMergeProposal/,
    `${LINKING} no longer validates merge proposals`,
  )
  // The clause that refuses an address as the whole of the evidence. Matched on
  // the test, not on the prose beside it — comments are stripped above.
  assert.match(
    source,
    /\/\^\\S\+@\\S\+\\\.\\S\+\$\//,
    `${LINKING} no longer refuses a merge proposal whose entire evidence is an email address. ` +
      `That is the automatic merge performed by hand: a reviewer shown "same email" and nothing ` +
      `else is being asked to rubber-stamp the assumption §3.2 refuses.`,
  )
  assert.match(
    source,
    /review\.reviewedBy === proposal\.proposedBy/,
    `${LINKING} no longer refuses a merge reviewed by its own proposer. A self-approved merge is ` +
      `an automatic merge with a name attached.`,
  )
})
