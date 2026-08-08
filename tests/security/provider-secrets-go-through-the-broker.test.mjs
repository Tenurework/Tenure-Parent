import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * WRK-040-004 — a provider secret is borrowed from the broker, never read.
 *
 * The defect this ratchets: `apps/web/src/lib/ai.ts` read
 * `process.env.ANTHROPIC_API_KEY!` inside the `fetch` to `api.anthropic.com`,
 * and `apps/web/src/lib/auth.ts` read `process.env.OKTA_CLIENT_SECRET!` inside
 * the NextAuth provider literal. Both are long-lived, reusable vendor
 * credentials, and neither passed through the reference / expiry / rotation
 * machinery the cell already had one file away in `auth-connections.ts`.
 *
 * Rewiring those two call sites fixes today. This is what fixes tomorrow:
 * nothing stopped a fourth `process.env.SOMETHING_API_KEY` appearing beside
 * them, and a chokepoint a new call site can decline to use is a suggestion.
 *
 * ## This test never reads a value
 *
 * It matches variable NAMES in source text. It does not read `process.env`, it
 * does not execute the files it scans, and it prints only the identifier and
 * the file it appeared in. A guard that had to see a secret to check on one
 * would be the more expensive kind of wrong.
 *
 * ## Inbound secrets are a different concern, and are named
 *
 * Not everything matching the pattern is a credential this cell PRESENTS to a
 * third party. `JOB_SECRET`, `PLATFORM_EXPORT_SECRET`,
 * `PLATFORM_RECONCILE_SECRET` and `PAYMENTS_WEBHOOK_SECRET` are compared
 * against a value an inbound caller supplied; `AUTH_SECRET` is an HMAC key used
 * in-process; `DEV_LOGIN_PASSPHRASE` is compared, not sent. None of them
 * travels outward, so none of them has an expiry a vendor enforces or a
 * rotation a vendor observes — which is what the broker exists to model. They
 * are allow-listed BY NAME, each with a reason and a date, and the size of that
 * list is itself asserted so it cannot grow quietly.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

/** Where a secret-shaped read is allowed to be, and why. */
const BROKER = "apps/web/src/lib/connections/credential-broker.ts"

/**
 * Names that are NOT provider credentials, with the reason each is exempt.
 *
 * Dated deliberately: an exemption with no date is one nobody revisits.
 */
const INBOUND_OR_LOCAL = new Map([
  [
    "JOB_SECRET",
    "2026-08-07 — a bearer value the scheduler presents to THIS cell. Compared against an inbound Authorization header (api/jobs/*), never sent anywhere.",
  ],
  [
    "PLATFORM_EXPORT_SECRET",
    "2026-08-07 — same shape as JOB_SECRET, for the platform export route. Inbound comparison only.",
  ],
  [
    "PLATFORM_RECONCILE_SECRET",
    "2026-08-07 — same shape as JOB_SECRET, for the reconcile route. Inbound comparison only.",
  ],
  [
    "PAYMENTS_WEBHOOK_SECRET",
    "2026-08-07 — the provider's webhook signing secret, used to VERIFY a signature on an inbound request. Nothing is presented to the provider with it.",
  ],
  [
    "AUTH_SECRET",
    "2026-08-07 — NextAuth's own signing key, and the HMAC key for the calendar feed token (src/lib/calendar-sync.ts). Used in-process; never leaves the cell.",
  ],
  [
    "DEV_LOGIN_PASSPHRASE",
    "2026-08-07 — the pilot demo passphrase (src/lib/auth.ts). It is COMPARED against what the person typed, not sent to a provider.",
  ],
])

/** `PROCESS.ENV.<NAME>` where the name looks like a credential. */
const SECRET_READ = /process\.env\.([A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD))\b/g

/**
 * Non-test source of the cell.
 *
 * Tests are excluded because a test SETS these variables to describe a
 * deployment — `partition-services.test.ts` assigns `ANTHROPIC_API_KEY` to
 * prove the partition gate refuses it — and a guard that fired on that would be
 * exempted rather than fixed.
 */
function cellSources() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "apps/web/src", "apps/web/scripts"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter((file) => /\.(ts|tsx|mjs|cjs|jsx?)$/.test(file))
    .filter((file) => !/\.(test|itest|spec)\.[a-z]+$/.test(file))
}

/** Source with comments stripped, so prose naming a variable is not a read of it. */
function code(file) {
  let text
  try {
    text = fs.readFileSync(path.join(ROOT, file), "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return ""
    throw error
  }
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/**
 * The provider-credential reads in one file's source.
 *
 * Exported so the sweep and the self-test exercise the same function — a
 * detector tested only through the sweep is one whose failure mode (finding
 * nothing) reads as a clean repository.
 */
export function providerSecretReads(text) {
  const names = []
  for (const match of text.matchAll(SECRET_READ)) {
    if (INBOUND_OR_LOCAL.has(match[1])) continue
    names.push(match[1])
  }
  return names
}

test("no provider credential is read outside the broker", () => {
  const offenders = []

  for (const file of cellSources()) {
    if (file === BROKER) continue
    for (const name of providerSecretReads(code(file))) {
      offenders.push(`${file} — process.env.${name}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these read a provider credential directly instead of borrowing it:\n  ${offenders.join("\n  ")}\n\n` +
      `WRK-040-004: a vendor secret is borrowed from ${BROKER}, which resolves it through the ` +
      `credential REFERENCE the identity registry already models, refuses an expired one via ` +
      `connectionHealth, and hands the value to a callback so no caller can hold it.`,
  )
})

test("the broker is where the reads live, and it is one file", () => {
  // The converse of the sweep. If the broker stopped naming the variables, the
  // sweep above would pass over an application that had simply lost the ability
  // to reach either provider.
  const broker = code(BROKER)
  assert.match(broker, /ANTHROPIC_API_KEY/, "the broker no longer names the Anthropic key")
  assert.match(broker, /OKTA_CLIENT_SECRET/, "the broker no longer names the Okta client secret")
})

test("the two rewired callers borrow rather than read", () => {
  // Asserted on the PRODUCERS, not on the broker: the defect was at the call
  // sites, and a broker nothing calls is the thing this whole item is about.
  const ai = code("apps/web/src/lib/ai.ts")
  assert.match(
    ai,
    /borrowProviderCredential\("anthropic-api-key"\)/,
    "src/lib/ai.ts must borrow the vendor key",
  )
  assert.match(ai, /"x-api-key": secret/, "the fetch must use the borrowed value, not an env read")

  const auth = code("apps/web/src/lib/auth.ts")
  assert.match(
    auth,
    /borrowProviderCredential\("okta-client-secret"\)/,
    "src/lib/auth.ts must borrow the Okta client secret",
  )
  assert.match(auth, /clientSecret: secret/, "the provider must take the borrowed value")
})

test("the detector tells a provider credential from an inbound one", () => {
  // Asserted on the detector because its failure mode is silence: a matcher
  // that finds nothing reports every file as clean.
  assert.deepEqual(providerSecretReads('const k = process.env.ANTHROPIC_API_KEY'), [
    "ANTHROPIC_API_KEY",
  ])
  assert.deepEqual(providerSecretReads('const k = process.env.STRIPE_SECRET'), ["STRIPE_SECRET"])
  assert.deepEqual(
    providerSecretReads('const k = process.env.JOB_SECRET'),
    [],
    "an inbound bearer is not a provider credential",
  )
  assert.deepEqual(
    providerSecretReads('const k = process.env.S3_DOCUMENTS_BUCKET'),
    [],
    "a bucket name is not a credential",
  )
})

test("the exemption list is what it says it is", () => {
  for (const [name, why] of INBOUND_OR_LOCAL) {
    assert.match(name, /^[A-Z][A-Z0-9_]*$/, `${name} is not an environment variable name`)
    assert.match(why, /^20\d\d-\d\d-\d\d — /, `${name} is exempt without a dated reason`)
    assert.ok(why.length > 40, `${name} is exempt without a real reason`)
  }
  // A ratchet, not a spec: it may only fall. A seventh exemption means somebody
  // decided a new secret does not travel outward, and that decision should be
  // read by a person rather than absorbed by a passing test.
  assert.equal(INBOUND_OR_LOCAL.size, 6, "the non-provider-secret exemption list grew")
})
