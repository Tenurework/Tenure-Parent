import type { ExternalIdentity } from "./entities"
import { identityLiveness } from "./effective-state"

/**
 * GE-040-002 — how an incoming assertion becomes a known person, and how it does not.
 *
 * Bible §"Canonical objects", the `ExternalIdentity` row:
 *
 *   > Verified issuer/subject/connection identity link; email is an attribute,
 *   > never the stable key
 *
 * and §9.1:
 *
 *   > It never reveals whether a person exists or grants membership from an
 *   > email domain.
 *
 * Three rules, and each of them is a thing every identity system is tempted to
 * do because it is convenient and each of them is an account takeover.
 *
 * ## 1. The key is (connection, issuer, subject) — all three
 *
 * `subject` alone is not unique across providers. `issuer + subject` is unique
 * for a correctly behaving IdP, and `connection` is still required, because a
 * connection is *this tenant's decision to trust that issuer*. Dropping it means
 * one tenant configuring a connection to an issuer another tenant also uses
 * would let an assertion minted for the first resolve inside the second. The
 * tenant boundary is not a property of the IdP; it is a property of the trust
 * relationship, and that is what a connection records.
 *
 * ## 2. Email is an attribute, and it moves
 *
 * People change their name and their address. `assertedEmail` is a copy of what
 * the provider last said, kept for display, and updating it must never change
 * which person an identity points to. A system that keys on email loses the
 * person the day HR does a domain migration.
 *
 * ## 3. Email never merges anything, verified or not
 *
 * Two identities asserting the same address is a fact to report, never an
 * instruction to act on. Auto-merging on a matching email is the single most
 * common identity vulnerability there is: an attacker who can receive mail at
 * an address — a re-issued departmental alias, a mistyped domain, a provider
 * that does not verify what it asserts — inherits the account. Even a
 * provider-verified email only proves the provider believes it today.
 *
 * `emailCollisions` therefore returns a *report*. There is deliberately no
 * function in this module that merges anything, so there is no call site to
 * misuse; merging is a reviewed decision and belongs to GE-040-004.
 */

/** What an identity provider asserts on a successful authentication. */
export interface IdentityAssertion {
  /** The tenant's connection the assertion arrived through. */
  connectionId: string
  /** The IdP's issuer identifier, exactly as asserted. */
  issuer: string
  /** The provider's stable, opaque identifier for this human. */
  subject: string
  /** What the provider says their address is. Display only. */
  assertedEmail: string | null
  /** Whether the provider vouched for it. Still never a key. */
  emailVerified: boolean
}

/**
 * The composite key, as a single comparable string.
 *
 * `\u0000` separates the parts because it cannot occur in an issuer, a subject
 * or a connection id. Joining on a printable character means an issuer ending
 * in that character and a subject starting with it produce the same key as a
 * different pair — which is a collision an attacker can construct rather than a
 * theoretical one.
 */
export function identityKey(parts: {
  connectionId: string
  issuer: string
  subject: string
}): string {
  return [parts.connectionId, parts.issuer, parts.subject].join("\u0000")
}

export function keyOf(identity: ExternalIdentity): string {
  return identityKey(identity)
}

/** A connection, reduced to what resolution needs to know about it. */
export interface ConnectionState {
  id: string
  /** From `@tenure/provisioning`: PENDING | ACTIVE | DISABLED | REVOKED. */
  status: string
  /** The issuer this connection is configured to trust. */
  issuer: string
}

export type ResolutionOutcome =
  /** The assertion matched a live identity. */
  | { outcome: "MATCHED"; identity: ExternalIdentity; personId: string }
  /** Nothing matched, and the assertion is well-formed enough to link. */
  | { outcome: "UNKNOWN" }
  /** The assertion cannot be trusted. Never distinguishes "no such person". */
  | { outcome: "REFUSED"; reason: RefusalReason; detail: string }

export type RefusalReason =
  | "CONNECTION_NOT_TRUSTED"
  | "ISSUER_MISMATCH"
  | "MALFORMED_ASSERTION"
  | "IDENTITY_NOT_USABLE"

/** Connection states an assertion may arrive through. Nothing else resolves. */
const TRUSTED_STATUSES = new Set(["ACTIVE"])

/**
 * Resolve an assertion to a person, or say why not.
 *
 * ## `UNKNOWN` is deliberately not "no such person"
 *
 * A caller cannot tell from the outcome whether the subject is unknown or the
 * person merely has no live identity — both surface as a refusal or an
 * `UNKNOWN`, and neither carries a name, an address, or a count. Bible §9.1
 * requires that this "never reveals whether a person exists", and the usual way
 * that leaks is not a message but a *difference*: two branches that return
 * subtly different shapes, and a caller that renders them differently.
 */
export function resolveAssertion(
  assertion: IdentityAssertion,
  identities: readonly ExternalIdentity[],
  connections: readonly ConnectionState[],
  at: Date,
): ResolutionOutcome {
  if (!assertion.connectionId.trim() || !assertion.issuer.trim() || !assertion.subject.trim()) {
    return {
      outcome: "REFUSED",
      reason: "MALFORMED_ASSERTION",
      detail:
        "An assertion needs a connection, an issuer and a subject. Any one missing makes the other two " +
        "unattributable, and a key built from a blank part collides with every other blank one.",
    }
  }

  const connection = connections.find((c) => c.id === assertion.connectionId)
  if (!connection || !TRUSTED_STATUSES.has(connection.status)) {
    return {
      outcome: "REFUSED",
      reason: "CONNECTION_NOT_TRUSTED",
      detail:
        `Connection "${assertion.connectionId}" is ${connection ? connection.status.toLowerCase() : "not configured"}. ` +
        `A connection is the tenant's decision to trust an issuer; without a live one there is nothing to trust.`,
    }
  }

  // The issuer must be the one this connection was configured for. Accepting
  // whatever the assertion claims would make the connection a label rather than
  // a trust relationship — anyone who could reach the callback could name their
  // own issuer.
  if (connection.issuer !== assertion.issuer) {
    return {
      outcome: "REFUSED",
      reason: "ISSUER_MISMATCH",
      detail:
        `Connection "${connection.id}" trusts "${connection.issuer}", and this assertion claims ` +
        `"${assertion.issuer}". An assertion is trusted because of who signed it, not because of where it arrived.`,
    }
  }

  const key = identityKey(assertion)
  // Exact, case-sensitive comparison. SAML NameIDs and Cognito subs are
  // case-sensitive, and normalising case here would merge two distinct subjects
  // that differ only in case — a merge nobody asked for, performed silently, on
  // the value that decides who someone is.
  const match = identities.find((identity) => keyOf(identity) === key)

  if (!match) return { outcome: "UNKNOWN" }

  const liveness = identityLiveness(match, at)
  if (!liveness.live) {
    return {
      outcome: "REFUSED",
      reason: "IDENTITY_NOT_USABLE",
      // Deliberately says nothing about who it belongs to.
      detail: "This credential is not usable.",
    }
  }

  return { outcome: "MATCHED", identity: match, personId: match.personId }
}

/**
 * Record what the provider asserted, without re-keying anything.
 *
 * Returns a new identity with the email and verification updated and every key
 * part untouched. There is no path here that changes `connectionId`, `issuer`
 * or `subject`: a provider that starts asserting a different subject for the
 * same human is a *new* identity to be linked under review, not the same row
 * quietly repointed.
 */
export function applyAssertedEmail(
  identity: ExternalIdentity,
  assertion: IdentityAssertion,
  at: Date,
): ExternalIdentity {
  return {
    ...identity,
    assertedEmail: assertion.assertedEmail,
    emailVerified: assertion.emailVerified,
    lastAuthenticatedAt: at.toISOString(),
    // Key parts restated explicitly rather than left to the spread. If someone
    // later adds a field to the assertion that shares a name with a key part,
    // the spread would carry it in; this makes that impossible to do by
    // accident, which is the only way it would ever be done.
    connectionId: identity.connectionId,
    issuer: identity.issuer,
    subject: identity.subject,
    personId: identity.personId,
  }
}

export interface EmailCollision {
  email: string
  /** Every identity asserting it, across connections and people. */
  identityIds: readonly string[]
  /** The distinct people involved. More than one is the case worth reviewing. */
  personIds: readonly string[]
  /** Whether every asserting provider claims to have verified it. */
  allVerified: boolean
  detail: string
}

/**
 * Identities that assert the same address, reported and never acted on.
 *
 * This is a *report*. Nothing in this module merges, links or prefers one
 * identity over another on the strength of a shared address, and that absence
 * is the feature: auto-merging on email is the single most common identity
 * vulnerability there is, and the way it ships is that someone adds a helpful
 * `findByEmail` and a later caller treats it as authentication.
 *
 * Addresses are compared case-insensitively for *detection* only, because
 * mailbox providers treat them that way and a collision that differs by case is
 * still a collision worth a human looking at. That normalisation never touches
 * the stored value and never reaches a key.
 */
export function emailCollisions(identities: readonly ExternalIdentity[]): readonly EmailCollision[] {
  const byEmail = new Map<string, ExternalIdentity[]>()

  for (const identity of identities) {
    const email = identity.assertedEmail?.trim().toLowerCase()
    if (!email) continue
    const group = byEmail.get(email) ?? []
    group.push(identity)
    byEmail.set(email, group)
  }

  const collisions: EmailCollision[] = []
  for (const [email, group] of [...byEmail.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (group.length < 2) continue
    const personIds = [...new Set(group.map((identity) => identity.personId))].sort()
    const allVerified = group.every((identity) => identity.emailVerified)

    collisions.push({
      email,
      identityIds: group.map((identity) => identity.id).sort(),
      personIds,
      allVerified,
      detail:
        personIds.length === 1
          ? `${group.length} identities for one person assert ${email}. Expected when somebody has both an SSO and a local credential; nothing to do.`
          : `${group.length} identities across ${personIds.length} different people assert ${email}. ` +
            `This is reported, not resolved: an address is not proof of being the same human, and ` +
            `merging on it is how an attacker who can receive mail at a re-issued alias inherits an account.` +
            (allVerified ? " Every provider claims to have verified it, which proves only that they believe it today." : ""),
    })
  }

  return collisions
}

/**
 * The discovery hint an email may legitimately provide: which connections to
 * offer, and nothing else.
 *
 * Bible §9.1 permits a normalised work email "only as a discovery hint" and
 * forbids granting "membership from an email domain". The distinction is the
 * whole of it — the hint decides what the sign-in page *shows*, the grant comes
 * from a membership row, and the way this rule is broken is that one function
 * ends up doing both.
 *
 * So this returns connection ids and has no access to memberships at all: there
 * is no `tenantId` in the result and no person in the signature, which makes
 * "grant membership from this" unwritable rather than merely discouraged.
 */
export function connectionsToOffer(
  email: string,
  verifiedDomains: readonly { domain: string; tenantId: string; state: string }[],
  connectionsByTenant: Readonly<Record<string, readonly string[]>>,
): readonly string[] {
  const at = email.lastIndexOf("@")
  if (at === -1) return []
  const domain = email.slice(at + 1).trim().toLowerCase()
  if (!domain) return []

  // Only a verified domain hints at anything. A pending claim is somebody
  // typing a domain into a form; honouring it would let anyone enumerate which
  // tenants exist by claiming their domains.
  const tenants = verifiedDomains
    .filter((entry) => entry.state === "VERIFIED" && entry.domain.trim().toLowerCase() === domain)
    .map((entry) => entry.tenantId)

  return [...new Set(tenants.flatMap((tenantId) => connectionsByTenant[tenantId] ?? []))].sort()
}
