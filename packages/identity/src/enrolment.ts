import type { Invitation, Person } from "./entities"
import { invitationLiveness } from "./effective-state"

/**
 * GE-041-004 — nobody arrives without being invited.
 *
 * Bible §9.1 lists "approved Cognito local authentication, invitation-only by
 * default", and §6.1 requires a tenant's inputs to include "SAML/OIDC/SCIM
 * connection inputs **or explicit invitation-only local policy**". §6 step 13
 * describes the invitation itself: "single-use, tenant-bound, expiring,
 * audited".
 *
 * ## Default-closed, and the default is not configurable away by omission
 *
 * `enrolmentPolicy` returns `INVITATION_ONLY` for a tenant that has said
 * nothing. That is the whole design: self-service sign-up is a decision a
 * tenant makes explicitly and records, not a state a tenant falls into because
 * a field was never set. A misconfiguration should fail closed — somebody
 * cannot get in — rather than open, where the first sign anything is wrong is a
 * stranger inside a university's finance module.
 *
 * ## An invitation is single-use, tenant-bound and expiring
 *
 * All three matter, and each fails differently:
 *
 *   * **Single-use.** A shared link is an open door with extra steps, and it is
 *     the failure that spreads by being convenient — one person forwards it to
 *     a colleague and nothing complains.
 *   * **Tenant-bound.** An invitation valid in any tenant lets somebody invited
 *     to a small pilot walk into the tenant next door.
 *   * **Expiring.** An invitation is a statement about who should join *now*;
 *     an unexpiring one is a credential in an inbox that outlives the reason it
 *     was sent, the person who sent it, and often the person who received it.
 */

export const ENROLMENT_POLICIES = ["INVITATION_ONLY", "OPEN_TO_VERIFIED_DOMAIN"] as const
export type EnrolmentPolicy = (typeof ENROLMENT_POLICIES)[number]

export interface TenantEnrolment {
  tenantId: string
  /**
   * Undefined means the tenant has not decided.
   *
   * Deliberately optional rather than defaulted at the type level: the absence
   * has to be visible here so that "not decided" and "decided to be closed" are
   * the same *outcome* while remaining distinguishable *facts* — one of them is
   * something an operator should go and ask about.
   */
  policy?: EnrolmentPolicy
  /** Domains proved by DNS. Only meaningful under OPEN_TO_VERIFIED_DOMAIN. */
  verifiedDomains: readonly string[]
}

/** What a tenant's enrolment policy actually is, including when it is unset. */
export function enrolmentPolicy(tenant: TenantEnrolment): EnrolmentPolicy {
  return tenant.policy ?? "INVITATION_ONLY"
}

export type EnrolmentRefusal =
  | "INVITATION_REQUIRED"
  | "INVITATION_NOT_LIVE"
  | "INVITATION_WRONG_TENANT"
  | "INVITATION_WRONG_RECIPIENT"
  | "DOMAIN_NOT_VERIFIED"
  | "ALREADY_ENROLLED"

export interface EnrolmentRefused {
  admitted: false
  reason: EnrolmentRefusal
  /**
   * Safe to show a stranger.
   *
   * Every refusal reads the same from outside: it never distinguishes "no such
   * invitation" from "expired" from "already used", because that difference is
   * exactly what tells somebody probing whether an address was ever invited.
   * The `reason` is for the log; `detail` is for the person.
   */
  detail: string
}

export interface EnrolmentAdmitted {
  admitted: true
  /** How they got in, recorded because it decides deprovisioning later. */
  via: "INVITATION" | "VERIFIED_DOMAIN"
  /** The invitation consumed, so the caller can mark it used in the same write. */
  consumedInvitationId: string | null
}

export type EnrolmentOutcome = EnrolmentAdmitted | EnrolmentRefused

/** One refusal message for every cause. See `EnrolmentRefused.detail`. */
const SAFE_REFUSAL =
  "This invitation cannot be used. If you were expecting to join, ask whoever invited you to send a new one."

export interface EnrolmentRequest {
  tenant: TenantEnrolment
  /** The address the person is presenting. Matched, never trusted as identity. */
  email: string
  /** The invitation they presented, if any. */
  invitation: Invitation | null
  /** Set when this person is already a member — enrolment is then a no-op. */
  existingMember: Person | null
  at: Date
}

/**
 * Whether somebody may join a tenant, and how.
 *
 * Returns the invitation to consume rather than consuming it, so the caller
 * writes the membership and the consumption in one transaction. An invitation
 * marked used before the membership is written is one somebody cannot retry
 * after a crash; marked used after, it is one two people can race.
 */
export function admitToTenant(request: EnrolmentRequest): EnrolmentOutcome {
  const { tenant, invitation, at } = request

  if (request.existingMember) {
    return {
      admitted: false,
      reason: "ALREADY_ENROLLED",
      detail: "This account is already a member of this organization.",
    }
  }

  const policy = enrolmentPolicy(tenant)

  if (policy === "OPEN_TO_VERIFIED_DOMAIN") {
    const at_ = request.email.lastIndexOf("@")
    const domain = at_ === -1 ? "" : request.email.slice(at_ + 1).trim().toLowerCase()
    const permitted = tenant.verifiedDomains.some((d) => d.trim().toLowerCase() === domain)

    if (permitted) return { admitted: true, via: "VERIFIED_DOMAIN", consumedInvitationId: null }

    // Falls through to the invitation path rather than refusing: a tenant that
    // is open to its own domain still invites external advisors, and refusing
    // them here would make the open policy narrower than the closed one.
  }

  if (!invitation) {
    return {
      admitted: false,
      reason: "INVITATION_REQUIRED",
      // Says what to do without confirming anything about this address.
      detail: SAFE_REFUSAL,
    }
  }

  // Tenant-bound. An invitation valid anywhere lets somebody invited to a small
  // pilot walk into the tenant next door.
  if (invitation.tenantId !== tenant.tenantId) {
    return { admitted: false, reason: "INVITATION_WRONG_TENANT", detail: SAFE_REFUSAL }
  }

  // Addressed to one person. Compared case-insensitively because mailbox
  // providers are, and this is a match rather than a key (GE-040-002).
  if (invitation.sentToEmail.trim().toLowerCase() !== request.email.trim().toLowerCase()) {
    return { admitted: false, reason: "INVITATION_WRONG_RECIPIENT", detail: SAFE_REFUSAL }
  }

  // Single-use and expiring, both computed — `invitationLiveness` reports
  // ACCEPTED and EXPIRED distinctly for the log, and both surface identically
  // to the person.
  if (!invitationLiveness(invitation, at).live) {
    return { admitted: false, reason: "INVITATION_NOT_LIVE", detail: SAFE_REFUSAL }
  }

  return { admitted: true, via: "INVITATION", consumedInvitationId: invitation.id }
}

export interface SelfSignUpBreach {
  tenantId: string
  detail: string
}

/**
 * Tenants whose configuration would let a stranger in, across a fleet.
 *
 * The case worth catching is `OPEN_TO_VERIFIED_DOMAIN` with no verified
 * domains: it reads as an open policy, admits nobody by domain, and — because
 * the domain path falls through to invitations — behaves exactly like
 * invitation-only while *looking* configured. That is a tenant whose operator
 * believes self-service works and will be surprised.
 *
 * The inverse is not a breach and is not reported: a tenant with verified
 * domains and no policy is closed, which is correct.
 */
export function selfSignUpBreaches(tenants: readonly TenantEnrolment[]): readonly SelfSignUpBreach[] {
  return tenants
    .filter((tenant) => tenant.policy === "OPEN_TO_VERIFIED_DOMAIN" && tenant.verifiedDomains.length === 0)
    .map((tenant) => ({
      tenantId: tenant.tenantId,
      detail:
        `${tenant.tenantId} is set to open enrolment with no verified domain, so nobody can actually join ` +
        `by domain and every arrival still needs an invitation. The policy reads as open and behaves as ` +
        `closed — verify a domain, or set the policy to invitation-only so it says what it does.`,
    }))
    .sort((left, right) => (left.tenantId < right.tenantId ? -1 : 1))
}
