/**
 * GE-043-004 — proving a tenant owns a domain, and noticing before things expire.
 *
 * Bible §9.1: "The login resolver starts from verified tenant domain/subdomain
 * … It never reveals whether a person exists or **grants membership from an
 * email domain**."
 *
 * That second clause is why this is narrower than it looks. A verified domain
 * decides *which tenant's branding and login methods a visitor is offered* —
 * discovery. It never decides who anybody is or what they may do. So the
 * question is not "does this prove the person belongs here" but "does this
 * prove the organization controls this name", and the answer is a DNS record
 * only the controller could publish.
 */

export const DOMAIN_CLAIM_STATES = [
  /** Claimed, challenge issued, nothing proved. */
  "PENDING",
  /** The challenge was found in DNS. */
  "VERIFIED",
  /** Proved once and the proof has gone stale or vanished. */
  "LAPSED",
  /** Withdrawn or refused. */
  "RELEASED",
] as const

export type DomainClaimState = (typeof DOMAIN_CLAIM_STATES)[number]

export interface DomainClaim {
  domain: string
  tenantId: string
  state: DomainClaimState
  /** The value the tenant must publish. Unpredictable, supplied by the caller. */
  challengeToken: string
  claimedAt: string
  verifiedAt: string | null
}

export type ClaimRefusal =
  | "NOT_A_DOMAIN"
  | "PUBLIC_SUFFIX"
  | "HELD_BY_ANOTHER_TENANT"
  | "CLAIM_PENDING_ELSEWHERE"

export interface ClaimRefused {
  ok: false
  reason: ClaimRefusal
  detail: string
}

export interface ClaimAccepted {
  ok: true
  claim: DomainClaim
  /** The exact record the tenant must publish, for the instructions screen. */
  record: { name: string; type: "TXT"; value: string }
}

export type ClaimOutcome = ClaimAccepted | ClaimRefused

/** The record name a challenge lives at. */
export const CHALLENGE_PREFIX = "_tenure-challenge"

/**
 * Suffixes nobody may claim.
 *
 * Not the public suffix list — that is thousands of entries maintained
 * elsewhere, and vendoring a stale copy would be worse than a short honest one.
 * These are the shapes that matter for this product's customers, plus the
 * structural rule that a single label is never a claimable domain. A registrable
 * name under one of these is fine: `rochester.edu` is claimable, `edu` is not.
 */
const UNCLAIMABLE = new Set([
  "edu",
  "ac.uk",
  "edu.au",
  "com",
  "org",
  "net",
  "gov",
  "co.uk",
  "org.uk",
])

function looksLikeDomain(domain: string): boolean {
  if (domain !== domain.toLowerCase().trim()) return false
  if (domain.length === 0 || domain.length > 253) return false
  if (domain.startsWith(".") || domain.endsWith(".")) return false
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)
}

/**
 * Claim a domain for a tenant.
 *
 * `existing` is every claim the platform holds, because the interesting refusals
 * are about other tenants. Two tenants both proving the same domain would make
 * discovery ambiguous, and the resolution — whichever row the query returned
 * first — is not a decision anybody made.
 */
export function claimDomain(
  input: { domain: string; tenantId: string; challengeToken: string; at: Date },
  existing: readonly DomainClaim[],
): ClaimOutcome {
  const domain = input.domain.toLowerCase().trim()

  if (!looksLikeDomain(domain)) {
    return {
      ok: false,
      reason: "NOT_A_DOMAIN",
      detail: `"${input.domain}" is not a domain name. A single label is not one either — a tenant cannot own "edu".`,
    }
  }

  if (UNCLAIMABLE.has(domain)) {
    return {
      ok: false,
      reason: "PUBLIC_SUFFIX",
      detail: `"${domain}" is a public suffix. Nobody controls it, so nobody can prove they do — and a tenant holding it would answer discovery for every institution beneath it.`,
    }
  }

  // A verified claim elsewhere wins outright. Discovery has to resolve one
  // tenant per domain, and two proofs is not something to resolve at read time.
  const verifiedElsewhere = existing.find(
    (claim) => claim.domain === domain && claim.state === "VERIFIED" && claim.tenantId !== input.tenantId,
  )
  if (verifiedElsewhere) {
    return {
      ok: false,
      reason: "HELD_BY_ANOTHER_TENANT",
      detail: `${domain} is already verified by another tenant. Releasing it is that tenant's decision, or an operator's.`,
    }
  }

  // A pending claim is exclusive too, and deliberately: without it, two tenants
  // race to publish a TXT record and whoever polls first takes the domain. The
  // claim expires (see `claimIsStale`), so this cannot squat forever.
  const pendingElsewhere = existing.find(
    (claim) => claim.domain === domain && claim.state === "PENDING" && claim.tenantId !== input.tenantId,
  )
  if (pendingElsewhere) {
    return {
      ok: false,
      reason: "CLAIM_PENDING_ELSEWHERE",
      detail: `Another tenant is already proving ${domain}. That claim expires if it is not completed.`,
    }
  }

  return {
    ok: true,
    claim: {
      domain,
      tenantId: input.tenantId,
      state: "PENDING",
      challengeToken: input.challengeToken,
      claimedAt: input.at.toISOString(),
      verifiedAt: null,
    },
    record: { name: `${CHALLENGE_PREFIX}.${domain}`, type: "TXT", value: input.challengeToken },
  }
}

/** How long an unproved claim holds the domain. */
export const CLAIM_EXPIRY_DAYS = 14

/** How long a proof stands before it must be found again. */
export const REVERIFY_AFTER_DAYS = 30

export function claimIsStale(claim: DomainClaim, at: Date): boolean {
  if (claim.state !== "PENDING") return false
  const age = at.getTime() - Date.parse(claim.claimedAt)
  return Number.isNaN(age) || age > CLAIM_EXPIRY_DAYS * 86_400_000
}

/**
 * Named `DomainCheckOutcome` rather than `VerificationOutcome`, which
 * `assurance.ts` already uses for the result of verifying a *person's* recovery
 * method. Two verifications of two different things.
 */
export type DomainCheckOutcome =
  | { state: "VERIFIED"; claim: DomainClaim }
  | { state: "LAPSED"; claim: DomainClaim; detail: string }
  | { state: "PENDING"; claim: DomainClaim; detail: string }

/**
 * Check a claim against what DNS actually says.
 *
 * `txtRecords` is what the caller resolved. Passing it in keeps this decidable
 * and keeps DNS out of a pure module — and makes the caller's failure visible:
 * an empty array is "the lookup returned nothing", which this treats as *not
 * proved* rather than as *unchanged*.
 *
 * A previously verified domain whose record has gone is **LAPSED**, not left
 * verified. A domain that stops resolving is one a registrar may already have
 * released, and a verified claim on a name somebody else now owns would hand
 * them a tenant's login page.
 */
export function checkDomainChallenge(
  claim: DomainClaim,
  txtRecords: readonly string[],
  at: Date,
): DomainCheckOutcome {
  // Exact match against the whole record value. Not `includes`: a resolver
  // returning a concatenated or quoted value would otherwise let a record that
  // merely *contains* the token count, and a token embedded in somebody else's
  // TXT record is not a proof of control.
  const found = txtRecords.some((record) => record.trim() === claim.challengeToken)

  if (found) {
    return { state: "VERIFIED", claim: { ...claim, state: "VERIFIED", verifiedAt: at.toISOString() } }
  }

  if (claim.state === "VERIFIED") {
    return {
      state: "LAPSED",
      claim: { ...claim, state: "LAPSED" },
      detail: `The challenge record at ${CHALLENGE_PREFIX}.${claim.domain} is gone. A domain that stops proving itself may have changed hands.`,
    }
  }

  return {
    state: "PENDING",
    claim,
    detail: `No TXT record at ${CHALLENGE_PREFIX}.${claim.domain} carries the challenge value yet. DNS changes can take a few minutes to propagate.`,
  }
}

/**
 * Whether a verified domain still counts, at this instant.
 *
 * Computed rather than stored, for GE-040-001's reason: a stored flag is wrong
 * exactly in the window that matters, and a sweeper that failed last night must
 * not be what keeps a lapsed domain authoritative.
 */
export function domainIsAuthoritative(claim: DomainClaim, at: Date): boolean {
  if (claim.state !== "VERIFIED" || !claim.verifiedAt) return false
  const age = at.getTime() - Date.parse(claim.verifiedAt)
  return !Number.isNaN(age) && age <= REVERIFY_AFTER_DAYS * 86_400_000
}

/**
 * Which tenant a domain resolves to, for discovery.
 *
 * **Exact match only.** A verified `rochester.edu` does not make
 * `anything.rochester.edu` resolve to that tenant. Subdomain delegation is
 * common in universities — a department, a lab, a student society may control
 * one — and treating a parent's proof as covering all of them hands a tenant
 * discovery for names it does not control. Each is claimed separately.
 */
export function tenantForDomain(
  domain: string,
  claims: readonly DomainClaim[],
  at: Date,
): string | null {
  const normalised = domain.toLowerCase().trim()
  const match = claims.find(
    (claim) => claim.domain === normalised && domainIsAuthoritative(claim, at),
  )
  return match ? match.tenantId : null
}

/* ──────────────────────────────────────────────────── expiry monitoring ── */

export type ExpiringKind = "CERTIFICATE" | "CLIENT_SECRET" | "JWKS_CACHE" | "DOMAIN_PROOF"

export interface ExpiringThing {
  kind: ExpiringKind
  /** What it is, for the operator. Never the value. */
  label: string
  /** Null when the thing has no expiry — which is itself reportable. */
  expiresAt: string | null
}

export type ExpiryUrgency = "OK" | "WARN" | "URGENT" | "EXPIRED" | "UNKNOWN"

export interface ExpiryReport {
  kind: ExpiringKind
  label: string
  urgency: ExpiryUrgency
  detail: string
  /** Negative once expired, so a sort puts the worst first. */
  daysRemaining: number | null
}

/**
 * How much warning each kind needs, in days.
 *
 * Not one threshold. A certificate needs weeks — somebody has to raise a ticket
 * with an identity team that does not work weekends. A JWKS cache needs hours,
 * because refreshing it is automatic and a stale one means the automation
 * stopped. Warning about both at thirty days makes the certificate warning
 * arrive too late and the cache warning arrive constantly, and an operator who
 * sees a constant warning stops reading warnings.
 */
const THRESHOLDS: Record<ExpiringKind, { warn: number; urgent: number }> = {
  CERTIFICATE: { warn: 30, urgent: 7 },
  CLIENT_SECRET: { warn: 21, urgent: 5 },
  JWKS_CACHE: { warn: 1, urgent: 0.25 },
  DOMAIN_PROOF: { warn: 7, urgent: 2 },
}

export function expiryReport(thing: ExpiringThing, at: Date): ExpiryReport {
  const { warn, urgent } = THRESHOLDS[thing.kind]

  if (thing.expiresAt === null) {
    // Reported, not skipped. A credential with no expiry is a decision somebody
    // made, and it should be visible rather than looking like a healthy row.
    return {
      kind: thing.kind,
      label: thing.label,
      urgency: "UNKNOWN",
      detail: `${thing.label} has no expiry recorded, so nothing here can tell you when it stops working.`,
      daysRemaining: null,
    }
  }

  const expires = Date.parse(thing.expiresAt)
  if (Number.isNaN(expires)) {
    return {
      kind: thing.kind,
      label: thing.label,
      urgency: "UNKNOWN",
      detail: `${thing.label} has an expiry that is not a time (${thing.expiresAt}).`,
      daysRemaining: null,
    }
  }

  const days = (expires - at.getTime()) / 86_400_000

  if (days <= 0) {
    return {
      kind: thing.kind,
      label: thing.label,
      urgency: "EXPIRED",
      detail: `${thing.label} expired ${Math.abs(Math.floor(days))} days ago.`,
      daysRemaining: days,
    }
  }
  if (days <= urgent) {
    return {
      kind: thing.kind,
      label: thing.label,
      urgency: "URGENT",
      detail: `${thing.label} expires in under ${urgent === 0.25 ? "six hours" : `${urgent} days`}.`,
      daysRemaining: days,
    }
  }
  if (days <= warn) {
    return {
      kind: thing.kind,
      label: thing.label,
      urgency: "WARN",
      detail: `${thing.label} expires in ${Math.floor(days)} days.`,
      daysRemaining: days,
    }
  }

  return {
    kind: thing.kind,
    label: thing.label,
    urgency: "OK",
    detail: `${thing.label} expires in ${Math.floor(days)} days.`,
    daysRemaining: days,
  }
}

/**
 * Everything that needs attention, worst first.
 *
 * `OK` rows are dropped: this is a list somebody acts on, and burying four
 * urgent rows in two hundred healthy ones is how the four get missed. The count
 * of what was dropped is the caller's to report if it wants a total.
 */
export function expiriesNeedingAttention(
  things: readonly ExpiringThing[],
  at: Date,
): readonly ExpiryReport[] {
  const rank: Record<ExpiryUrgency, number> = { EXPIRED: 0, URGENT: 1, WARN: 2, UNKNOWN: 3, OK: 4 }

  return things
    .map((thing) => expiryReport(thing, at))
    .filter((report) => report.urgency !== "OK")
    .sort((left, right) => {
      const byUrgency = rank[left.urgency] - rank[right.urgency]
      if (byUrgency !== 0) return byUrgency

      // Within an urgency, soonest first.
      //
      // No null-handling here, because within a group there are none to handle:
      // `daysRemaining` is null exactly when the urgency is UNKNOWN, so a group
      // is either all-dated or all-undated. An earlier version carried
      // nulls-last branches that read as careful and were unreachable — a
      // mutation flipping them changed no outcome, which is how they were
      // found. Undated rows still sort below dated ones, by their urgency rank.
      return (left.daysRemaining ?? 0) - (right.daysRemaining ?? 0)
    })
}
