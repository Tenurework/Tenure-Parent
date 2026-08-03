import type { Dated } from "./continuity"
import { succeedsTo, type SeatOwnedResource } from "./continuity"

/**
 * GE-050-007 — ending an assignment, and what a successor actually gets.
 *
 * Two halves of one sentence in the Bible, §8.3:
 *
 *   "Seat ownership never means a successor automatically receives secrets.
 *    Credentials live in approved systems and are rotated or reassigned through
 *    a transition workflow. Restricted predecessor communications, HR records,
 *    investigations, legal material, and personal data remain governed by
 *    classification and purpose."
 *
 * GE-050-001 classified a seat's resources as `SEAT_RECORD`, `PERSONAL` or
 * `CONTROLLED`, and left `CONTROLLED` saying only "released by a transition
 * workflow". This decides what such a workflow may release — because "a
 * workflow handles it" is where the actual rule usually goes to die.
 */

/* ─────────────────────────────────────────────── ending an assignment ── */

export interface EndableAssignment {
  id: string
  seatId: string
  personId: string
  stateId: string
  dated: Dated
}

export type EndRefusal = "ALREADY_ENDED" | "ENDS_BEFORE_IT_STARTS" | "NO_REASON"

export type EndOutcome =
  | { ok: true; assignment: EndableAssignment; authorityRemovedAt: string }
  | { ok: false; reason: EndRefusal; detail: string }

/**
 * End an assignment.
 *
 * **Sets a date; never removes a row.** The record of who held a seat and when
 * is the thing the platform exists to keep, and an implementation that deleted
 * the assignment would remove authority correctly and destroy the answer to
 * "who approved this in March" at the same time.
 *
 * Authority stops at the instant the assignment ends, not at next sign-in.
 * `stateAuthorityAt` (GE-050-004) reads the window on every call, so a person
 * whose assignment ended at noon has nothing at 12:00:01 — there is no cached
 * grant to expire, which is the whole reason authority is computed rather than
 * stored.
 */
export function endAssignment(
  assignment: EndableAssignment,
  input: { at: Date; reason: string },
): EndOutcome {
  if (input.reason.trim().length < 10) {
    return {
      ok: false,
      reason: "NO_REASON",
      detail: "Ending an assignment needs a stated reason. A seat that emptied and nobody can say why is a gap nobody can explain to the person who lost it.",
    }
  }

  if (assignment.dated.effectiveTo !== null) {
    const existing = Date.parse(assignment.dated.effectiveTo)
    if (!Number.isNaN(existing) && existing <= input.at.getTime()) {
      return {
        ok: false,
        reason: "ALREADY_ENDED",
        detail: `This assignment already ended at ${assignment.dated.effectiveTo}.`,
      }
    }
  }

  const from = Date.parse(assignment.dated.effectiveFrom)
  if (!Number.isNaN(from) && input.at.getTime() < from) {
    // Ending a future assignment before it begins is a cancellation, and the
    // difference matters: a cancelled appointment never happened, an ended one
    // did. Recording the second as the first loses the fact that somebody was
    // appointed.
    return {
      ok: false,
      reason: "ENDS_BEFORE_IT_STARTS",
      detail:
        "This assignment has not begun. Cancelling an appointment and ending one are different facts, and " +
        "recording the second as the first loses that somebody was appointed at all.",
    }
  }

  return {
    ok: true,
    assignment: {
      ...assignment,
      dated: { ...assignment.dated, effectiveTo: input.at.toISOString() },
    },
    authorityRemovedAt: input.at.toISOString(),
  }
}

/* ──────────────────────────────────────────── release to a successor ── */

/**
 * Why a resource is restricted, which decides whether it can ever be released.
 *
 * Not a severity scale. `LEGAL_HOLD` and `INVESTIGATION` are not "more secret"
 * than `HR_RECORD` — they are restricted for a reason that no seat transition
 * can satisfy, and a numeric level invites somebody to configure a threshold
 * that lets them through.
 */
export type Classification =
  /** Ordinary operational material belonging to the seat. */
  | "OPERATIONAL"
  /** A credential. Never content to transfer; see below. */
  | "CREDENTIAL"
  /** Personnel material about the predecessor. */
  | "HR_RECORD"
  /** Subject to a legal hold. */
  | "LEGAL_HOLD"
  /** Part of an open investigation. */
  | "INVESTIGATION"
  /** Correspondence the predecessor held in confidence. */
  | "RESTRICTED_COMMUNICATION"

export interface ReleasePolicy {
  id: string
  /**
   * Classifications this policy releases to a successor.
   *
   * An allowlist. A denylist would release anything a policy author had not
   * thought of, and the material worth restricting is exactly the material
   * nobody anticipated.
   */
  releases: readonly Classification[]
}

/** Classifications no policy may release, whatever it declares. */
const NEVER_RELEASABLE: ReadonlySet<Classification> = new Set<Classification>([
  "LEGAL_HOLD",
  "INVESTIGATION",
])

export interface ClassifiedResource extends SeatOwnedResource {
  /** Overrides the loose `classification: string | null` on the base type. */
  classification: Classification | null
}

export type ReleaseAction =
  /** The successor receives it. */
  | "TRANSFER"
  /**
   * Not transferred. A new one is issued to the successor and the old one is
   * revoked.
   *
   * Bible §8.3: credentials "are rotated or reassigned". Handing a successor the
   * predecessor's password gives them the predecessor's *identity*, so every
   * action afterwards is attributed to somebody who has left — and if it is
   * misused, to somebody who could not have done it.
   */
  | "ROTATE"
  /** Withheld. */
  | "WITHHOLD"

export interface ReleaseDecision {
  action: ReleaseAction
  reason: string
}

export interface SuccessionContext {
  /** Whether the successor actually holds the seat now. */
  successorHoldsSeat: boolean
  /** Whether a transition workflow has been completed for this handover. */
  transitionCompleted: boolean
  policy: ReleasePolicy
}

/**
 * What a successor gets for one resource.
 *
 * Decided per resource, never per seat. "Hand over the seat's things" is one
 * decision standing in for hundreds that are not alike, and the tidy version of
 * it is how a successor ends up reading their predecessor's HR file.
 *
 * Ordered so the unconditional refusals come first. A resource under legal hold
 * is withheld whether or not a transition completed, whether or not the policy
 * names it, and whether or not the successor holds the seat — putting those
 * checks after the policy lookup would make a misconfigured policy able to
 * release it.
 */
export function releaseToSuccessor(
  resource: ClassifiedResource,
  context: SuccessionContext,
): ReleaseDecision {
  // Personal material never transfers, and this is checked before anything
  // about the seat: it is not the seat's to release.
  const inheritance = succeedsTo(resource)
  if (!inheritance.transfers && inheritance.reason === "PERSONAL") {
    return {
      action: "WITHHOLD",
      reason: "This belongs to the person who held the seat, not to the seat.",
    }
  }

  if (resource.classification !== null && NEVER_RELEASABLE.has(resource.classification)) {
    return {
      action: "WITHHOLD",
      reason: `This is under ${resource.classification.toLowerCase().replace("_", " ")} and no seat transition can release it, however the policy is configured.`,
    }
  }

  if (resource.classification === "CREDENTIAL") {
    // Never content, whatever the policy says. Returned as ROTATE rather than
    // WITHHOLD because the successor does need access — they need their own.
    return {
      action: "ROTATE",
      reason:
        "A credential is rotated or reassigned, never handed over. Passing the predecessor's would attribute " +
        "every later action to somebody who has left.",
    }
  }

  // A seat record with no restriction passes on: that is the continuity the
  // product exists for.
  if (inheritance.transfers) {
    return { action: "TRANSFER", reason: "This is the seat's own record." }
  }

  // Everything left is CONTROLLED. It needs the successor actually in the seat,
  // a completed transition, and a policy that names the classification.
  if (!context.successorHoldsSeat) {
    return {
      action: "WITHHOLD",
      reason: "The successor does not hold this seat yet, so there is no occupancy to release against.",
    }
  }
  if (!context.transitionCompleted) {
    return {
      action: "WITHHOLD",
      reason: "No transition workflow has completed for this handover. Controlled material is released by that step, not by occupancy.",
    }
  }
  if (resource.classification === null) {
    // Default deny. An unclassified controlled resource is one nobody has
    // decided about, and releasing it treats an omission as permission.
    return {
      action: "WITHHOLD",
      reason: "This is controlled and unclassified, so no policy can say whether it may be released. Classify it first.",
    }
  }
  if (!context.policy.releases.includes(resource.classification)) {
    return {
      action: "WITHHOLD",
      reason: `Policy "${context.policy.id}" does not release ${resource.classification.toLowerCase().replace("_", " ")} material.`,
    }
  }

  return {
    action: "TRANSFER",
    reason: `Policy "${context.policy.id}" releases this classification, and the transition completed.`,
  }
}

export interface HandoverSummary {
  transferred: readonly string[]
  rotated: readonly string[]
  withheld: readonly { resourceId: string; reason: string }[]
}

/**
 * The whole handover, so somebody can look at it before it happens.
 *
 * Withheld items carry their reason. A handover that reported only what moved
 * would leave the successor discovering the gaps one confused request at a
 * time, and the predecessor unable to check that what should have stayed did.
 */
export function planHandover(
  resources: readonly ClassifiedResource[],
  context: SuccessionContext,
): HandoverSummary {
  const transferred: string[] = []
  const rotated: string[] = []
  const withheld: { resourceId: string; reason: string }[] = []

  for (const resource of resources) {
    const decision = releaseToSuccessor(resource, context)
    if (decision.action === "TRANSFER") transferred.push(resource.resourceId)
    else if (decision.action === "ROTATE") rotated.push(resource.resourceId)
    else withheld.push({ resourceId: resource.resourceId, reason: decision.reason })
  }

  return { transferred, rotated, withheld }
}
