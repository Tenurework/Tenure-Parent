import type { AccessState } from "@tenure/identity"

import { evaluate, type Decision, type Fact } from "./evaluate"
import {
  compilePolicyOrThrow,
  type AttributeCatalog,
  type EligibilityPolicy,
} from "./policy"

/**
 * The attribute catalog and the tenant-entry policy this deployment actually
 * decides with — IER-070-001's "declarative", made real rather than illustrated.
 *
 * Bible §7 requires every collected attribute to have "an owner, purpose,
 * source, classification, retention rule, allowed consumers, effective-date
 * behavior". The two entries below are the two facts this pilot genuinely
 * holds about whether a signed-in person belongs in a workspace: the state of
 * their institution membership, and whether they have proved they control the
 * email address it was granted against. Nothing else is listed, because §3.5
 * forbids collecting a field no active purpose justifies and a catalog padded
 * with attributes nobody asserts is exactly how that starts.
 *
 * ## Compiled at module load, deliberately
 *
 * `compilePolicyOrThrow` runs when this module is first imported, so a policy
 * that references an attribute the catalog does not define takes the deployment
 * down at import rather than denying people one request at a time. A malformed
 * policy is not a decision; it is a defect, and the two must not look alike.
 */

export const TENANT_ENTRY_CATALOG: AttributeCatalog = {
  "affiliation.status": {
    id: "affiliation.status",
    type: "enum",
    // §2 — an affiliation is an effective-dated relationship, not a role. These
    // five states are what `accessState` can conclude from the membership rows,
    // which is this platform's system of record for tenant membership.
    members: ["ACTIVE", "PENDING", "SUSPENDED", "REVOKED", "ENDED"],
    acceptedSourceRoles: ["SYSTEM_OF_RECORD", "AUTHORITATIVE"],
    // The fact is derived from the membership rows on the request that reads
    // them, so anything older than a few minutes did not come from this
    // request and should not be decided with.
    maxAgeMs: 5 * 60 * 1000,
  },
  "identity.email.verified": {
    id: "identity.email.verified",
    type: "boolean",
    acceptedSourceRoles: ["SYSTEM_OF_RECORD"],
    maxAgeMs: 5 * 60 * 1000,
  },
}

/**
 * `tenure.tenant-entry.v1` — may this person enter a workspace at all.
 *
 * Modelled on §12.1's illustrative policy and narrowed to the facts that exist:
 * the illustrative version also reads `identity.route` and `invitation.status`,
 * and asserting conditions over facts this deployment cannot supply would make
 * every decision INDETERMINATE while looking thorough. A policy that reads what
 * is there and says what it does not read is the honest shape.
 *
 * Note what it does NOT do, in the Bible's own words: "This policy establishes
 * workspace eligibility. It does not authorize finance approval, personnel
 * records, cross-club administration, or any other action."
 */
export const TENANT_ENTRY_POLICY: EligibilityPolicy = {
  policyId: "tenure.tenant-entry.v1",
  version: "1",
  owner: "platform-identity",
  purpose: "Decide whether a signed-in person may enter a tenant workspace.",
  target: "tenant.workspace",
  // Gate 1 (§2.1). `dashboard` is this platform's front-door module: a tenant
  // whose configuration does not enable it has bought no workspace, and no
  // person can be eligible for one it does not have.
  requiresTenantCapability: "dashboard",
  subject: "signed-in person with an institution membership or a live seat",
  risk: "LOW",
  activeFrom: "2026-01-01T00:00:00.000Z",
  expiresAt: null,
  rollout: { percent: 100, cohortSalt: "tenant-entry-2026" },
  attributes: [
    {
      attribute: "affiliation.status",
      acceptedSourceRoles: ["SYSTEM_OF_RECORD"],
      maxAgeMs: 5 * 60 * 1000,
    },
    {
      attribute: "identity.email.verified",
      acceptedSourceRoles: ["SYSTEM_OF_RECORD"],
      maxAgeMs: 5 * 60 * 1000,
    },
  ],
  requiredSources: ["tenure.membership"],
  deny: [
    {
      // Liftable by whoever imposed it, so it is SUSPENDED rather than
      // INELIGIBLE — the person should be told to ask, not to reapply.
      when: { attribute: "affiliation.status", op: "equals", value: "SUSPENDED" },
      code: "AFFILIATION_SUSPENDED",
      outcome: "SUSPENDED",
    },
    {
      when: { attribute: "affiliation.status", op: "equals", value: "REVOKED" },
      code: "AFFILIATION_REVOKED",
      outcome: "INELIGIBLE",
    },
  ],
  conditions: {
    all: [{ attribute: "affiliation.status", op: "in", values: ["ACTIVE"] }],
  },
  conditionallyEligible: [
    {
      when: { attribute: "identity.email.verified", op: "equals", value: true },
      code: "EMAIL_NOT_VERIFIED",
    },
  ],
  onMissing: "INDETERMINATE",
  onStale: "INDETERMINATE",
  onConflict: "MANUAL_REVIEW_REQUIRED",
  onSourceUnavailable: "INDETERMINATE",
  exceptions: [],
  reviewEveryDays: 180,
  approvedBy: "platform-identity",
  rollbackTo: null,
}

export const COMPILED_TENANT_ENTRY_POLICY = compilePolicyOrThrow(
  TENANT_ENTRY_POLICY,
  TENANT_ENTRY_CATALOG,
)

/** How `AccessState` reads as an affiliation fact. */
const AFFILIATION_STATUS: Readonly<Record<AccessState, string | null>> = {
  ACTIVE: "ACTIVE",
  NOT_YET_STARTED: "PENDING",
  SUSPENDED: "SUSPENDED",
  REVOKED: "REVOKED",
  ENDED: "ENDED",
  // Not "INELIGIBLE" and not `false`: nobody has asserted an affiliation for
  // this person at all, which §2.2 keeps distinct from asserting a negative one.
  NEVER_PLACED: null,
}

export interface TenantEntryInput {
  /** The report `accessReportFor` already produces. */
  accessState: AccessState
  /** `User.emailVerified` — a timestamp when proved, null when not. */
  emailVerifiedAt: Date | null
  /** The modules this tenant is entitled to run. Gate 1's input. */
  tenantCapabilities: readonly string[]
  now: Date
}

/**
 * Turn the bootstrap read into typed facts.
 *
 * Separate from `evaluate` so the mapping is testable without a database and
 * so the policy engine never learns what an `InstitutionMembership` is — the
 * engine decides over attributes, and knowing where an attribute came from is
 * this file's job alone.
 */
export function tenantEntryFacts(input: TenantEntryInput): Fact[] {
  const observedAt = input.now.toISOString()
  const status = AFFILIATION_STATUS[input.accessState]
  return [
    {
      attribute: "affiliation.status",
      presence: status === null ? "NOT_SUPPLIED" : "PRESENT",
      value: status,
      sourceId: "tenure.membership",
      sourceRole: "SYSTEM_OF_RECORD",
      observedAt,
    },
    {
      attribute: "identity.email.verified",
      presence: "PRESENT",
      value: input.emailVerifiedAt !== null,
      sourceId: "tenure.user",
      sourceRole: "SYSTEM_OF_RECORD",
      observedAt,
    },
  ]
}

/** Gate 2 for workspace entry, decided by the compiled policy. */
export function tenantEntryEligibility(subjectId: string, input: TenantEntryInput): Decision {
  return evaluate(COMPILED_TENANT_ENTRY_POLICY, {
    subjectId,
    facts: tenantEntryFacts(input),
    now: input.now,
    tenantCapabilities: input.tenantCapabilities,
  })
}
