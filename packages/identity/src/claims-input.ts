import type { TenantMembership } from "./entities"
import { membershipLiveness } from "./effective-state"
import type { ClaimsMapping } from "./oidc-connection"
import { validateClaimsMapping } from "./oidc-connection"

/**
 * GE-043-003 — claims are inputs, and inputs are not authority.
 *
 * Bible §"Decisions" 3: authority "comes from an active, scoped assignment or
 * explicit delegation, not from a title string, email domain, Cognito group, or
 * UI state." §9.1: "Cognito Groups are not canonical RBAC."
 *
 * `tests/security/provider-independence.test.mjs` already forbids an
 * authorization path from *reading* a group claim. That is the negative half,
 * and it can only ever catch the spelling somebody used. This is the positive
 * half: what an assertion is actually allowed to contribute, expressed so that
 * contributing anything else is not a thing the code can do.
 *
 * ## An allowlist, not a denylist
 *
 * `withoutIgnoredClaims` (GE-041) strips a named list — `groups`,
 * `cognito:groups`, `roles`. It is worth having and it is not sufficient: a
 * provider can call the same thing `custom:isAdmin`, `urn:example:entitlements`,
 * or `dept_code` where `OSE-ADMIN` means something to somebody. A denylist has
 * to guess every spelling; an allowlist admits only what a person deliberately
 * configured, and everything else falls on the floor whatever it is called.
 *
 * So `proposalFromClaims` reads exactly the three claims a mapping names and no
 * others. It cannot leak a claim it has never heard of, which is the class of
 * claim that leaks.
 */

/**
 * What an assertion may contribute about a person.
 *
 * The whole type. There is no `roles`, no `capabilities`, no `isAdmin` — not
 * because they are stripped, but because there is nowhere to put them. Code
 * that wanted to carry authority from a token would have to change this
 * interface, which is a diff a reviewer sees.
 */
export interface IdentityProposal {
  /** Stable per-person identifier at the provider. Never an email address. */
  subject: string
  email: string | null
  displayName: string | null
}

export type ProposalRefusal = "INVALID_MAPPING" | "NO_SUBJECT"

export interface ProposalRejected {
  ok: false
  reason: ProposalRefusal
  detail: string
}

export interface ProposalAccepted {
  ok: true
  proposal: IdentityProposal
}

export type ProposalOutcome = ProposalAccepted | ProposalRejected

function stringClaim(claims: Readonly<Record<string, unknown>>, name: string | null): string | null {
  if (!name) return null
  const value = claims[name]
  // Only strings. A provider sending `{"email": ["a@b", "c@d"]}` or a nested
  // object would otherwise stringify into something that looks like an
  // identifier and is not one.
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * Turn an assertion's claims into a proposal.
 *
 * Refuses on an invalid mapping rather than applying the valid parts of it. A
 * mapping that maps `groups` is a mapping somebody wrote intending it to do
 * something, and quietly dropping that one field while honouring the rest would
 * leave them believing it worked.
 */
export function proposalFromClaims(
  claims: Readonly<Record<string, unknown>>,
  mapping: ClaimsMapping,
): ProposalOutcome {
  const findings = validateClaimsMapping(mapping)
  if (findings.length > 0) {
    return {
      ok: false,
      reason: "INVALID_MAPPING",
      detail: findings.map((finding) => finding.detail).join(" "),
    }
  }

  const subject = stringClaim(claims, mapping.subjectClaim)
  if (!subject) {
    return {
      ok: false,
      reason: "NO_SUBJECT",
      detail: `The assertion carries no usable "${mapping.subjectClaim}" claim, so there is nothing stable to key this person on.`,
    }
  }

  // Exactly three reads. Every other claim in the token — however it is spelled,
  // whatever it asserts — is not read at all.
  return {
    ok: true,
    proposal: {
      subject,
      email: stringClaim(claims, mapping.emailClaim),
      displayName: stringClaim(claims, mapping.displayNameClaim),
    },
  }
}

/**
 * What somebody may do, computed from Tenure's own records.
 *
 * **This function takes no claims, and that is the enforcement.** A rule written
 * as "do not read the token here" is a rule somebody breaks by reading the token
 * here; a function with no token parameter cannot. Adding one is a signature
 * change, in a file whose name says what it is for, reviewed by somebody who can
 * see both sides of the diff.
 *
 * The identity the assertion proposed has already done its job by this point: it
 * resolved *which person this is*. What that person may do is a different
 * question with a different source, and the two are deliberately not answered by
 * the same call.
 */
export function authorityFromTenureRecords(input: {
  memberships: readonly TenantMembership[]
  /** Seat-derived capabilities, already resolved from live assignments. */
  seatCapabilities: readonly string[]
  /** Capabilities a policy grants in this tenant. */
  policyCapabilities: readonly string[]
  tenantId: string
  at: Date
}): readonly string[] {
  const { memberships, seatCapabilities, policyCapabilities, tenantId, at } = input

  // No live membership of this tenant means no authority in it, whatever a seat
  // or a policy says. A seat is scoped to an organization inside a tenant, so a
  // seat surviving the end of the membership that placed it is a seat nobody
  // reviewed.
  const live = memberships.some(
    (membership) => membership.tenantId === tenantId && membershipLiveness(membership, at).live,
  )
  if (!live) return []

  return [...new Set([...seatCapabilities, ...policyCapabilities])].sort()
}
