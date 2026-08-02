import type { LifecycleStatus, TenantMembership } from "./entities"
import { membershipLiveness } from "./effective-state"

/**
 * GE-040-001 — "and audit".
 *
 * The requirement pairs effective state with audit, and the pairing is the
 * point: an effective-dated record whose changes are not attributable tells you
 * *that* a membership ended and never *who* ended it or why. Both halves are
 * needed before the history is worth keeping.
 *
 * ## There is no setter
 *
 * `reviseMembership` is the only way to change a membership's state, and it
 * returns the new membership **and** its audit record together, in one value.
 * There is deliberately no function that returns just the membership.
 *
 * That shape is doing real work. An audit write issued as a separate call is one
 * a code path can skip — by an early return, a thrown error between the two, or
 * simply by a developer who did not know it was expected. Making the record part
 * of the return means the only way to persist a status change is to have the
 * record in hand, and the only way to lose it is to explicitly throw it away.
 *
 * ## Revocation is effective-dating, not deletion
 *
 * `apps/web` deleted the membership row on revoke, while the notification it
 * sent said "Your past activity stays on record". The audit log recorded the
 * revocation; the membership fact did not survive it, so nothing could answer
 * "was this person a Director on 12 March" — which is exactly the question an
 * approval signed on 12 March raises. Revocation here closes the window and
 * keeps the row.
 */

export type MembershipChange = "GRANT" | "SUSPEND" | "REINSTATE" | "REVOKE" | "RESCHEDULE"

export interface MembershipRevision {
  change: MembershipChange
  /** Who is making the change. Never the person being changed, for a revoke. */
  actorId: string
  /** Required for anything that removes access. */
  reason?: string
  /** For RESCHEDULE, and for a GRANT that starts later. */
  effectiveFrom?: string
  effectiveUntil?: string | null
  at: Date
}

/**
 * The audit record a revision produces.
 *
 * Shaped to hand straight to `@tenure/audit`'s `buildAuditRecord`, but not
 * built with it here — this package would then need the audit package as a
 * dependency to express a data structure, and the cell that stores memberships
 * is not always the process that writes the audit trail.
 */
export interface MembershipAudit {
  tenantId: string
  actor: { principalId: string }
  action: string
  resourceType: "TenantMembership"
  resourceId: string
  outcome: "ALLOW"
  reason: string
  metadata: Readonly<Record<string, unknown>>
  occurredAt: string
}

export interface RevisionRefused {
  ok: false
  problem: string
}

export interface RevisionApplied {
  ok: true
  membership: TenantMembership
  /** Produced here, so it cannot be skipped. */
  audit: MembershipAudit
}

export type RevisionOutcome = RevisionApplied | RevisionRefused

const REMOVES_ACCESS: readonly MembershipChange[] = ["SUSPEND", "REVOKE"]

/**
 * Apply a change to a membership, or refuse and say why.
 *
 * Pure: it takes the current membership and returns the next one. Persisting is
 * the caller's job, and it must persist both halves or neither — the audit
 * record and the membership are one fact.
 */
export function reviseMembership(
  membership: TenantMembership,
  revision: MembershipRevision,
): RevisionOutcome {
  const { change, actorId, reason, at } = revision

  if (!actorId.trim()) {
    return { ok: false, problem: "No actor. A membership change nobody is attached to cannot be audited." }
  }

  if (REMOVES_ACCESS.includes(change) && !reason?.trim()) {
    return {
      ok: false,
      problem:
        `A ${change.toLowerCase()} needs a reason. It is what the person is told and what a review reads; ` +
        `"revoked" on its own answers nothing six months later.`,
    }
  }

  const wasLive = membershipLiveness(membership, at).live
  let status: LifecycleStatus = membership.status
  let interval = { ...membership.interval }
  let statusReason = membership.statusReason

  switch (change) {
    case "GRANT":
      if (membership.status === "REVOKED") {
        return {
          ok: false,
          problem:
            "This membership was revoked. Granting access again is a new membership, not a revival of this one — " +
            "reusing the row would erase the fact that it ended.",
        }
      }
      status = "ACTIVE"
      statusReason = null
      interval = {
        effectiveFrom: revision.effectiveFrom ?? membership.interval.effectiveFrom,
        effectiveUntil: revision.effectiveUntil ?? membership.interval.effectiveUntil,
      }
      break

    case "SUSPEND":
      if (membership.status === "REVOKED") {
        return { ok: false, problem: "This membership is already revoked; suspending it would weaken it." }
      }
      status = "SUSPENDED"
      statusReason = reason!.trim()
      break

    case "REINSTATE":
      if (membership.status !== "SUSPENDED") {
        return {
          ok: false,
          problem: `Only a suspended membership can be reinstated; this one is ${membership.status}.`,
        }
      }
      status = "ACTIVE"
      statusReason = null
      break

    case "REVOKE":
      if (membership.status === "REVOKED") {
        return { ok: false, problem: "This membership is already revoked." }
      }
      status = "REVOKED"
      statusReason = reason!.trim()
      // The window closes now rather than being cleared. An end date of "now"
      // is a fact; a null one would read as still open and make the row
      // indistinguishable from a live membership to anything reading the
      // interval rather than the status.
      interval = { ...interval, effectiveUntil: at.toISOString() }
      break

    case "RESCHEDULE": {
      if (revision.effectiveFrom === undefined && revision.effectiveUntil === undefined) {
        return { ok: false, problem: "A reschedule that changes neither end of the window changes nothing." }
      }
      const next = {
        effectiveFrom: revision.effectiveFrom ?? interval.effectiveFrom,
        effectiveUntil: revision.effectiveUntil === undefined ? interval.effectiveUntil : revision.effectiveUntil,
      }
      if (next.effectiveUntil !== null && Date.parse(next.effectiveUntil) <= Date.parse(next.effectiveFrom)) {
        return { ok: false, problem: "A membership cannot end before it starts." }
      }
      interval = next
      break
    }
  }

  const next: TenantMembership = { ...membership, status, interval, statusReason }
  const isLive = membershipLiveness(next, at).live

  return {
    ok: true,
    membership: next,
    audit: {
      tenantId: membership.tenantId,
      actor: { principalId: actorId },
      action: `TenantMembership.${change}`,
      resourceType: "TenantMembership",
      resourceId: membership.id,
      outcome: "ALLOW",
      reason: statusReason ?? `${change} by ${actorId}`,
      metadata: {
        personId: membership.personId,
        from: { status: membership.status, ...membership.interval },
        to: { status, ...interval },
        // Whether this change actually altered access. A reschedule that moves
        // an end date a year out changes the record without changing anything
        // today, and a review reading only "RESCHEDULE" cannot tell those apart.
        accessChanged: wasLive !== isLive,
        liveAfter: isLive,
      },
      occurredAt: at.toISOString(),
    },
  }
}
