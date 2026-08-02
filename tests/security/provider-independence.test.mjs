import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-041-001 — the identity provider stays behind its adapter.
 *
 * Bible §9.1 divides the work: "Amazon Cognito authenticates and federates.
 * Tenure resolves the person, tenant membership, identity connection, active
 * assignments, policies, and session." §"Cells" makes the consequence explicit —
 * "region, pool, database, bucket, search index, issuer, callback, KMS key, and
 * service endpoint are never globally hard-coded in business modules".
 *
 * There is no Cognito adapter yet, and that is precisely why this exists now.
 * The rule costs nothing to hold at zero violations and is expensive to
 * retrofit: GE-041-002 through GE-041-005 add pool strategies, provisioning,
 * MFA and recovery, and each of them is an opportunity for a `UserPoolId` to
 * reach a page. Once it has, every caller has Cognito's shape in it and the
 * sharded/tenant/dedicated-pool strategies become a rewrite rather than a
 * configuration change.
 *
 * ## What this does and does not forbid
 *
 * It does not forbid the word "Cognito". The registry legitimately has a
 * `COGNITO_LOCAL` connection *kind* — that is Tenure's vocabulary for a
 * provider family, chosen by Tenure, and naming the thing you integrate with is
 * not coupling. The Studio's platform page legitimately counts Cognito user
 * pools in the AWS inventory, because that is what the inventory contains.
 *
 * It forbids the provider's *implementation surface* leaking: its SDK, and the
 * identifiers only its API has.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const SCAN_ROOTS = ["apps", "packages", "modules", "blueprints"]

/**
 * Where a provider SDK may be imported.
 *
 * Nothing lives here yet. The directory is named in advance so the adapter has
 * an obvious home and so this guard does not have to be edited — and therefore
 * reconsidered — on the day somebody is busy writing the adapter.
 */
const ADAPTER_PATHS = ["packages/identity-cognito/", "apps/web/src/lib/identity/providers/"]

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
 * Source with comments stripped, so prose about a thing is not a use of it.
 *
 * Returns "" for a file that has vanished. `git ls-files --others` lists
 * untracked files, and an untracked file can disappear between the listing and
 * the read — an editor, a build, or another guard in this same parallel run.
 * `tests/security/operator-plane-content.test.mjs` writes a probe file into the
 * Studio's source tree to prove its own grep matches something, and deletes it
 * again; every guard that enumerates and then reads has raced it. That produced
 * an ENOENT that looks exactly like a real guard failure and cost three
 * separate debugging sessions.
 *
 * A file that is gone has no content to check, so skipping it is correct as
 * well as convenient.
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

const inAdapter = (file) => ADAPTER_PATHS.some((prefix) => file.startsWith(prefix))

/** Any Cognito SDK, however imported. */
const COGNITO_SDK = /from\s*["']@aws-sdk\/client-cognito[\w-]*["']|require\(\s*["']@aws-sdk\/client-cognito[\w-]*["']\s*\)/

test("no module outside an adapter imports a Cognito SDK", () => {
  const offenders = sourceFiles().filter((file) => !inAdapter(file) && COGNITO_SDK.test(code(file)))

  assert.deepEqual(
    offenders,
    [],
    `these modules import a Cognito SDK outside an adapter:\n  ${offenders.join("\n  ")}\n` +
      `Depend on the IdentityProvider port in @tenure/identity. A provider SDK in a business module ` +
      `puts one vendor's shape into every caller, and makes GE-041-002's pool strategies a rewrite.`,
  )
})

/**
 * Identifiers that exist only in one provider's API.
 *
 * Narrow on purpose. `UserPoolId` and `ClientId` are the two that spread
 * fastest, because they are what every Cognito call needs and the obvious fix
 * is to thread them through. `cognito:groups` is the claim Bible §9.1 says is
 * "not canonical RBAC" and is the one somebody reads because it is right there
 * in the token and saves a query.
 */
const PROVIDER_VOCABULARY = [
  /\bUserPoolId\b/,
  /\bUserPoolClientId\b/,
  /\bcognito:groups\b/,
  /\bcognito:username\b/,
  /\bAdminInitiateAuth\b/,
  /\bAdminGetUser\b/,
]

test("no module outside an adapter speaks a provider's vocabulary", () => {
  const offenders = []

  for (const file of sourceFiles()) {
    if (inAdapter(file)) continue

    // Use, not mention — the same distinction that has caught three guards in
    // this repository already.
    //
    // The port names the ignored claims deliberately, as the list of things
    // Tenure must NOT act on, and a test asserting that `cognito:groups` is
    // stripped has to write `cognito:groups`. Naming a claim in order to refuse
    // it is the opposite of depending on it. This guard flagged its own test
    // file the moment that file was written, which is exactly the shape that
    // gets a guard weakened rather than a bug fixed.
    //
    // Tests are excluded from THIS check only. The SDK-import check above still
    // applies to them, because a test that imports a provider SDK is a real
    // dependency on it whatever it is asserting.
    if (file === "packages/identity/src/provider.ts") continue
    if (/\.(test|itest)\.(ts|tsx|mjs)$/.test(file)) continue

    const text = code(file)
    for (const pattern of PROVIDER_VOCABULARY) {
      if (pattern.test(text)) offenders.push(`${file} — ${pattern.source}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these modules use identifiers that exist only in one provider's API:\n  ${offenders.join("\n  ")}\n` +
      `Bible: pool, issuer, callback and endpoint are never hard-coded in business modules.`,
  )
})

test("no authorization path reads a group or role claim from a provider", () => {
  // Bible: authority "comes from an active, scoped assignment or explicit
  // delegation, not from a title string, email domain, Cognito group, or UI
  // state". The failure is not somebody deciding groups should be
  // authoritative — it is somebody reading claims.groups because it is right
  // there and saves a query.
  const authority = ["apps/web/src/lib/rbac.ts", "packages/authorization/src", "packages/identity/src"]
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", ...authority],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter((file) => /\.ts$/.test(file) && !/\.(test|itest)\.ts$/.test(file))

  assert.ok(files.length > 0, "the authority path list matched no files — it has drifted")

  const offenders = []
  for (const file of files) {
    if (file === "packages/identity/src/provider.ts") continue
    const text = code(file)
    if (/\bclaims\s*(\.|\[\s*["'])\s*(groups|roles)\b/.test(text)) offenders.push(file)
  }

  assert.deepEqual(offenders, [], `these authorization modules read a provider group/role claim:\n  ${offenders.join("\n  ")}`)
})

test("the port is implementable without AWS", () => {
  // The honest test of whether the seam is real: a SAML-only deployment with no
  // AWS account must be able to implement it. Asserted on the port's own
  // source, because the way this stops being true is one convenient method
  // signature, not a decision anybody announces.
  const port = code("packages/identity/src/provider.ts")

  for (const leak of ["@aws-sdk", "UserPool", "aws-cdk", "AdminInitiateAuth"]) {
    assert.ok(!port.includes(leak), `the IdentityProvider port mentions ${leak}, so it is not provider-independent`)
  }
  assert.match(port, /export interface IdentityProvider/, "the port is gone; this guard is measuring nothing")
})

test("the adapter directories are named, even before one exists", () => {
  // Deliberately allowed to be absent. The point of naming them in advance is
  // that the guard does not need editing — and therefore reconsidering — on the
  // day somebody is busy writing the adapter.
  for (const prefix of ADAPTER_PATHS) {
    assert.ok(prefix.endsWith("/"), `${prefix} must be a directory prefix, or it will match files by accident`)
  }
  assert.equal(ADAPTER_PATHS.length, 2, "the adapter allowlist changed")
})
