import "server-only"

import {
  credentialExpiry,
  credentialReferenceProblems,
  type CellEnvironment,
} from "@/lib/auth-connections"

/**
 * WRK-040-004 — the Connection Credential Broker.
 *
 * ## What was wrong, in one line each
 *
 * `src/lib/ai.ts` read `process.env.ANTHROPIC_API_KEY!` inside the `fetch` to
 * `api.anthropic.com`, and `src/lib/auth.ts` read
 * `process.env.OKTA_CLIENT_SECRET!` inside the provider literal. Both are
 * long-lived, reusable provider secrets with no expiry the code can see, no
 * reference indirection, and no single door — and nothing stopped a fourth call
 * site appearing beside them.
 *
 * The contrast that makes this a defect rather than a missing feature is one
 * file away: `src/lib/auth-connections.ts` already models a credential as a
 * REFERENCE (`{ purpose, ref, expiresAt, lastRotatedAt }`, "the value never
 * appears here") and already refuses an expired one through `connectionHealth`.
 * That machinery was applied to the connection's DESCRIPTION and bypassed
 * entirely by the code that used the secret.
 *
 * ## Three properties, each of them testable
 *
 * 1. **It returns a capability, not a value.** The secret is handed to a
 *    callback and never returned, so no caller can hold it past the call, put
 *    it in a field, or interpolate it into a log line. `use` is generic over
 *    the callback's return type rather than fixed to `Promise<T>` because one
 *    of the two real callers needs it synchronously: NextAuth's provider
 *    literal is built at module evaluation and takes `clientSecret` as a
 *    string, so `auth.ts` constructs the provider INSIDE the callback. Fixing
 *    the signature to a promise would have left that call site outside the
 *    door, which is the whole failure being fixed.
 * 2. **It resolves through the registry's rules, and writes none of its own.**
 *    Expiry is `connectionHealth`'s answer and reference-shape is
 *    `validateConnection`'s, both reached through `src/lib/auth-connections.ts`
 *    — the one module in this cell that holds the engine dependency. There is
 *    no second expiry rule here and there must never be one.
 * 3. **It is the only door.** `tests/security/provider-secrets-go-through-the-broker.test.mjs`
 *    fails on any secret-shaped `process.env` read outside this file, which is
 *    what makes the door real for code that has not been written yet.
 *
 * ## What this is NOT
 *
 * Not a KMS-bound token vault, and not broker-only refresh. Both need a stored
 * credential this deployment does not have — the secrets live in the task
 * definition and Secrets Manager, and the cell receives values, not handles. A
 * `vault.decrypt()` that read an environment variable would be a name for
 * something that is not happening. WRK-040-004 stays open on those halves and
 * the ledger says so.
 */

/**
 * The provider credentials this cell presents to a third party.
 *
 * Deliberately a closed union rather than a string: adding a provider secret is
 * then an edit to this list, in this file, next to the reference and the expiry
 * that go with it — instead of a new `process.env` read wherever the call
 * happens to be.
 */
export type ProviderCredentialPurpose = "anthropic-api-key" | "okta-client-secret"

export type CredentialRefusal =
  /** No value is configured for this deployment. */
  | "not-configured"
  /** The credential's declared reference is a value, not a reference. */
  | "unreferenced"
  /** `connectionHealth` says the credential has expired. */
  | "expired"

export type BorrowedCredential =
  | {
      ok: true
      /**
       * Run `fn` with the secret. The secret is not returned, not stored, and
       * not reachable after `fn` finishes.
       */
      use<T>(fn: (secret: string) => T): T
    }
  | { ok: false; reason: CredentialRefusal }

interface CredentialDescriptor {
  /** Where the VALUE arrives — populated from the reference at task start. */
  valueVar: string
  /** Where the REFERENCE is declared, and the default when nobody declared one. */
  refVar: string
  defaultRef: string
  /** Where the expiry is declared. Absent means this cell does not track it. */
  expiresAtVar: string
  /** How the registry names this kind of credential. */
  purpose: "oidc-client-secret" | "scim-token"
}

/**
 * The registry's `purpose` vocabulary has three members and none of them is
 * "vendor API key" — it describes identity credentials, which is what it is
 * for. `scim-token` is the closest true statement available for the Anthropic
 * key (a long-lived bearer token presented to a provider's API) and it is used
 * for one thing only: to satisfy the type of the carrier that asks
 * `connectionHealth` whether the expiry has passed. It is never rendered and
 * never stored. Widening that union belongs to `@tenure/provisioning`, and this
 * cell must not reach into the engine to do it
 * (`tests/security/cell-independence.test.mjs`).
 */
const DESCRIPTORS: Record<ProviderCredentialPurpose, CredentialDescriptor> = {
  "anthropic-api-key": {
    valueVar: "ANTHROPIC_API_KEY",
    refVar: "ANTHROPIC_API_KEY_REF",
    defaultRef: "/tenure/anthropic/api-key",
    expiresAtVar: "ANTHROPIC_API_KEY_EXPIRES_AT",
    purpose: "scim-token",
  },
  "okta-client-secret": {
    valueVar: "OKTA_CLIENT_SECRET",
    // The same reference and the same default `cellConnections()` already
    // builds for the Okta connection record, so the broker and the registry
    // describe one credential rather than two.
    refVar: "OKTA_CLIENT_SECRET_REF",
    defaultRef: "/tenure/okta/client-secret",
    expiresAtVar: "OKTA_CLIENT_SECRET_EXPIRES_AT",
    purpose: "oidc-client-secret",
  },
}

/**
 * Borrow a provider credential.
 *
 * The refusals are ordered so the most specific answer wins: a deployment with
 * no key at all is `not-configured` (which is not a fault — the pilot runs
 * without an Anthropic key and the assistant degrades to sources-only), a
 * deployment that pasted the secret where the reference goes is `unreferenced`,
 * and one whose credential has passed its declared expiry is `expired`.
 *
 * `env` is a parameter rather than a read of `process.env` inside so a test can
 * describe a deployment without mutating the process — the same shape
 * `cellConnections(env)` takes, for the same reason.
 */
export function borrowProviderCredential(
  purpose: ProviderCredentialPurpose,
  env: CellEnvironment = process.env,
  at: Date = new Date(),
): BorrowedCredential {
  const descriptor = DESCRIPTORS[purpose]

  const secret = env[descriptor.valueVar]
  if (!secret) return { ok: false, reason: "not-configured" }

  // A deployment that has not declared a reference gets the standing one: the
  // environment variable IS populated from that parameter at task start, and
  // refusing every deployment that has not restated it would take working
  // sign-in and a working assistant away to enforce a naming convention.
  const ref = env[descriptor.refVar] ?? descriptor.defaultRef
  if (credentialReferenceProblems(ref, descriptor.purpose).length > 0) {
    return { ok: false, reason: "unreferenced" }
  }

  const expiresAt = env[descriptor.expiresAtVar] ?? null
  if (credentialExpiry(expiresAt, at, descriptor.purpose).expired) {
    return { ok: false, reason: "expired" }
  }

  return {
    ok: true,
    use<T>(fn: (value: string) => T): T {
      return fn(secret)
    },
  }
}

/**
 * Whether a provider credential is usable, without borrowing it.
 *
 * For the surfaces that need to know whether a capability is configured — the
 * Connection Center, the chat route's `aiEnabled` flag — and must not receive
 * the value to find out. Deliberately returns the refusal too, so a surface can
 * say "expired" rather than "not connected".
 */
export function providerCredentialStatus(
  purpose: ProviderCredentialPurpose,
  env: CellEnvironment = process.env,
  at: Date = new Date(),
): { usable: boolean; reason: CredentialRefusal | "ok"; expiresAt: string | null } {
  const borrowed = borrowProviderCredential(purpose, env, at)
  return {
    usable: borrowed.ok,
    reason: borrowed.ok ? "ok" : borrowed.reason,
    expiresAt: env[DESCRIPTORS[purpose].expiresAtVar] ?? null,
  }
}
