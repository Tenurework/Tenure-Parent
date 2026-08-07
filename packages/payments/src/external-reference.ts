/**
 * PAY-020-004 / PAY-030-003 — a provider id is not a key until it is qualified.
 *
 * Bible §5, stated as the rule this module enforces:
 *
 * > A raw stripe_customer_id without account context is not globally unique
 * > enough.
 *
 * Three things make that true, and all three are routinely dropped:
 *
 *   1. **Mode.** `cus_123` in test and `cus_123` in live are different objects.
 *      A key that omits the mode merges a sandbox row onto a real one, and the
 *      merge is silent — the reconciliation simply reports the wrong figure.
 *   2. **Account.** Under Connect the same id can exist beneath two connected
 *      accounts. Without the account the second is read as a duplicate of the
 *      first.
 *   3. **Object type.** Providers do not promise ids are unique across types.
 *
 * So the external key is the 4-tuple plus the id, and the id Tenure OWNS —
 * `canonicalId` — is what every other row points at. That direction matters: a
 * schema keyed on the provider's id cannot change provider, cannot hold two
 * providers at once, and cannot survive the provider reissuing an id.
 *
 * `qualify` REFUSES rather than defaulting. A default mode is how a live
 * reconciliation ends up keyed as test: the caller that did not know its mode
 * is exactly the caller whose guess is wrong.
 */

/** An unvalidated reference, as a caller assembles it. */
export interface ProviderRefInput {
  provider?: string | null
  mode?: string | null
  /** The provider PROGRAM / platform account, when the provider has one. */
  programId?: string | null
  connectedAccountId?: string | null
  objectType?: string | null
  externalId?: string | null
  /** Tenure's own id for the thing. Owned here, never the provider's. */
  canonicalId?: string | null
  /** The tenant the reference belongs to. */
  institutionId?: string | null
}

/** A reference that has been checked. Every field that keys it is present. */
export interface QualifiedProviderRef {
  institutionId: string
  provider: string
  mode: ProviderMode
  programId: string | null
  connectedAccountId: string
  objectType: string
  externalId: string
  canonicalId: string
}

/**
 * The two modes every provider has, whatever it calls them.
 *
 * An enum rather than a free string: "test", "sandbox", "Test" and "TEST" as
 * four distinct index keys is four partitions of what is one mode, and the
 * uniqueness constraint then stops constraining anything.
 */
export type ProviderMode = "test" | "live"

const MODES: readonly string[] = ["test", "live"]

export class UnqualifiedReferenceError extends Error {
  readonly missing: readonly string[]

  constructor(missing: readonly string[]) {
    super(
      `A provider reference is missing ${missing.join(", ")}. A raw provider id without ` +
        `provider, mode and account context is not unique enough to key on: the same id in ` +
        `test and in live, or under two connected accounts, is not the same object, and ` +
        `treating it as one silently merges them.`,
    )
    this.name = "UnqualifiedReferenceError"
    this.missing = missing
  }
}

function present(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

/**
 * Check a reference, or refuse it by name.
 *
 * Returns the qualified value so a caller cannot hold the unchecked shape and
 * the checked one at the same time — the only way to obtain a
 * `QualifiedProviderRef` is to have been through here.
 */
export function qualify(input: ProviderRefInput): QualifiedProviderRef {
  const missing: string[] = []

  const institutionId = present(input.institutionId)
  if (!institutionId) missing.push("institutionId")

  const provider = present(input.provider)
  if (!provider) missing.push("provider")

  const rawMode = present(input.mode)
  if (!rawMode) missing.push("mode")
  else if (!MODES.includes(rawMode.toLowerCase())) missing.push(`a recognised mode (got "${rawMode}")`)

  const connectedAccountId = present(input.connectedAccountId)
  if (!connectedAccountId) missing.push("connectedAccountId")

  const objectType = present(input.objectType)
  if (!objectType) missing.push("objectType")

  const externalId = present(input.externalId)
  if (!externalId) missing.push("externalId")

  const canonicalId = present(input.canonicalId)
  if (!canonicalId) missing.push("canonicalId")

  if (missing.length > 0) throw new UnqualifiedReferenceError(missing)

  return {
    institutionId: institutionId!,
    provider: provider!.toLowerCase(),
    mode: rawMode!.toLowerCase() as ProviderMode,
    programId: present(input.programId),
    connectedAccountId: connectedAccountId!,
    objectType: objectType!,
    externalId: externalId!,
    canonicalId: canonicalId!,
  }
}

/**
 * The string form of the external key, for a map or a log line.
 *
 * Segments joined by a character that cannot appear in a provider id, so
 * ("stripe", "live", "acct_1", "customer", "cus_2") can never collide with
 * ("stripe", "live", "acct_1|customer", "cus_2") — the classic ambiguity of a
 * delimiter that is legal inside the parts. `|` is not legal in any provider id
 * this platform accepts, and `refKey` is not a storage key: the DATABASE unique
 * is the real constraint (ExternalReference's 5-column @@unique), and this is
 * for grouping a batch in memory before it gets there.
 */
export function refKey(ref: QualifiedProviderRef): string {
  return [ref.provider, ref.mode, ref.connectedAccountId, ref.objectType, ref.externalId].join("|")
}

/**
 * A TENANT-SCOPED idempotency key.
 *
 * REVIEW-FINDINGS #7: `ApprovalRequest.idempotencyKey` was a client-supplied
 * GLOBAL unique, so tenant B retrying with a key tenant A had already used
 * resolved onto tenant A's approval. The database index is scoped now
 * (`@@unique([institutionId, idempotencyKey])`), and this is the other half:
 * the VALUE a writer stores already carries the tenant, so a key read back out
 * of a row names the tenant it belongs to instead of relying on the index alone
 * to have been right.
 *
 * Refuses a blank tenant or key rather than composing `":abc"`, which would be
 * a key every tenant with no id could collide on.
 */
export function tenantScopedIdempotencyKey(tenantId: string, clientKey: string): string {
  const tenant = present(tenantId)
  const key = present(clientKey)
  if (!tenant || !key) {
    throw new UnqualifiedReferenceError([!tenant ? "tenantId" : "clientKey"])
  }
  return `${tenant}:${key}`
}
