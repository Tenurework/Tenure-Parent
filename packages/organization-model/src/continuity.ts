/**
 * GE-050-001 — the entities the continuity model needs and did not have.
 *
 * `OrganizationUnit` and the typed effective-dated `OrganizationRelationship`
 * already exist in `graph.ts`; `SeatAssignment` exists in `@tenure/identity`.
 * Four did not: `Seat` itself, `Delegation`, `Team/Cohort`, and the resource
 * relationship.
 *
 * ## Seat is the primitive, and it is not the assignment
 *
 * Bible §"Executive summary": "The durable organizational position — called a
 * seat in the product — is Tenure's primary continuity primitive. People occupy
 * seats for effective-dated periods. Work, authority, decisions, relationships,
 * policies, files, financial history, and operational knowledge can attach to
 * the seat **without becoming the personal property of an occupant**."
 *
 * The whole product rests on that sentence, and it only means anything if the
 * seat exists as a record independent of whoever is in it. Until now the closest
 * thing was `SeatAssignment.roleId` — an occupancy pointing at a role — which
 * cannot own anything, cannot outlive its occupant, and gives a successor
 * nothing to inherit.
 */

/**
 * An effective-dated window, matching `graph.ts`'s flat convention.
 *
 * `@tenure/identity` carries a structurally identical `EffectiveInterval`, and
 * this deliberately does not import it: an organization model that depends on
 * the identity package would make the dependency point the wrong way — units
 * and seats exist whether or not anybody signs in. TypeScript's structural
 * typing keeps the two interchangeable where a caller holds both.
 */
export interface Dated {
  effectiveFrom: string
  effectiveTo: string | null
}

/* ─────────────────────────────────────────────────────────────── seat ── */

export interface Seat {
  id: string
  tenantId: string
  /** The unit this position belongs to. Seats move; the id does not change. */
  organizationUnitId: string
  /** What the position is called now. History lives in the audit trail. */
  title: string
  /**
   * Effective-dated, because a position is created and can be retired.
   *
   * A retired seat is not deleted: its decisions, files and financial history
   * remain attached to it, and the record of who held it stays answerable.
   */
  dated: Dated
  /** Retired deliberately, as opposed to simply past its window. */
  retiredAt: string | null
}

/**
 * What a successor receives when they take a seat.
 *
 * Bible §341: "Seat ownership never means a successor automatically receives
 * secrets. Credentials live in approved systems and are rotated or reassigned
 * through a transition workflow. Restricted predecessor communications, HR
 * records, investigations, legal material, and personal data remain governed by
 * classification and purpose."
 *
 * This is the sentence that makes the continuity primitive safe rather than a
 * privacy incident with a job title. A model that let a successor inherit "the
 * seat's things" wholesale would hand them the predecessor's mailbox.
 */
export type InheritanceClass =
  /** Attached to the position. A successor receives it. */
  | "SEAT_RECORD"
  /** Attached to the person who held the seat. A successor receives nothing. */
  | "PERSONAL"
  /** Attached to the seat and released only by a transition workflow. */
  | "CONTROLLED"

export interface SeatOwnedResource {
  resourceId: string
  seatId: string
  inheritance: InheritanceClass
  /** The classification that decides CONTROLLED release. Never inferred here. */
  classification: string | null
}

export type SuccessionOutcome =
  | { transfers: true }
  | { transfers: false; reason: "PERSONAL" | "NEEDS_TRANSITION"; detail: string }

/**
 * Whether one resource passes to a successor.
 *
 * Decided per resource, never per seat. "Transfer the seat's things" is the
 * shape of the mistake: it is one decision standing in for hundreds, and the
 * hundreds are not alike.
 */
export function succeedsTo(resource: SeatOwnedResource): SuccessionOutcome {
  switch (resource.inheritance) {
    case "SEAT_RECORD":
      return { transfers: true }
    case "PERSONAL":
      return {
        transfers: false,
        reason: "PERSONAL",
        detail:
          "This belongs to the person who held the seat, not to the seat. A successor receives nothing, " +
          "and the record stays with its owner.",
      }
    case "CONTROLLED":
      return {
        transfers: false,
        reason: "NEEDS_TRANSITION",
        detail:
          "This is the seat's and is released through a transition workflow rather than by occupancy. " +
          "Credentials are rotated or reassigned; classified material is released by classification and purpose.",
      }
  }
}

/** Whether a seat is a position somebody may currently be placed in. */
export function seatIsOpen(seat: Seat, at: Date): boolean {
  if (seat.retiredAt !== null) return false
  const from = Date.parse(seat.dated.effectiveFrom)
  if (Number.isNaN(from) || at.getTime() < from) return false
  if (seat.dated.effectiveTo === null) return true
  const until = Date.parse(seat.dated.effectiveTo)
  return !Number.isNaN(until) && at.getTime() < until
}

/* ───────────────────────────────────────────────────────── delegation ── */

export interface Delegation {
  id: string
  tenantId: string
  /** Who is lending authority. A delegation is always derived from a holder. */
  fromSeatId: string
  /** Who receives it. */
  toPersonId: string
  /**
   * The actions delegated, named explicitly.
   *
   * No wildcard. "Everything I can do" is not a delegation somebody reviewed,
   * and it is the form that survives long after the reason for it.
   */
  actions: readonly string[]
  /** The resources it applies to. Empty means the delegator's whole scope. */
  resourceIds: readonly string[]
  dated: Dated
  revokedAt: string | null
  /** How many further delegations this may produce. Zero is the default. */
  redelegationDepth: number
  /** Why. A delegation with no stated reason cannot be reviewed. */
  reason: string
}

export type DelegationRefusal =
  | "REVOKED"
  | "NOT_YET_EFFECTIVE"
  | "EXPIRED"
  | "NO_EXPIRY"
  | "ACTION_NOT_DELEGATED"
  | "RESOURCE_NOT_DELEGATED"
  | "EXCEEDS_SOURCE"
  | "SOURCE_NOT_LIVE"
  | "NO_REASON"

export interface DelegationVerdict {
  ok: boolean
  reason: DelegationRefusal | null
  detail: string
}

/**
 * Whether a delegation authorises this action on this resource, now.
 *
 * `sourceActions` is what the delegating seat itself holds, and it is checked
 * every time rather than at creation. Authority is not a snapshot: a delegator
 * whose own access ended must not keep lending what they no longer have, and a
 * delegation validated once and trusted afterwards is exactly that.
 *
 * An **unbounded** delegation is refused outright. Bible §649 asks for
 * "automatic expiry", and a delegation with no end is not authority somebody
 * granted for a reason — it is a second permanent account with no review.
 */
export function delegationAllows(
  delegation: Delegation,
  request: { action: string; resourceId: string | null; at: Date },
  source: { actions: readonly string[]; live: boolean },
): DelegationVerdict {
  const refuse = (reason: DelegationRefusal, detail: string): DelegationVerdict => ({
    ok: false,
    reason,
    detail,
  })

  if (!delegation.reason.trim()) {
    return refuse("NO_REASON", "This delegation states no reason, so nobody can review whether it is still warranted.")
  }

  if (delegation.revokedAt !== null) {
    return refuse("REVOKED", `This delegation was revoked at ${delegation.revokedAt}.`)
  }

  // Checked before the window, so a revoked-and-expired delegation reports the
  // revocation — somebody acted, and that is the more useful fact.
  if (delegation.dated.effectiveTo === null) {
    return refuse(
      "NO_EXPIRY",
      "A delegation with no end is not bounded authority, it is a second permanent account nobody reviews.",
    )
  }

  const now = request.at.getTime()
  const from = Date.parse(delegation.dated.effectiveFrom)
  if (Number.isNaN(from) || now < from) {
    return refuse("NOT_YET_EFFECTIVE", `This delegation does not begin until ${delegation.dated.effectiveFrom}.`)
  }

  const until = Date.parse(delegation.dated.effectiveTo)
  if (Number.isNaN(until) || now >= until) {
    return refuse("EXPIRED", `This delegation ended at ${delegation.dated.effectiveTo}.`)
  }

  // The delegator's own authority, now. Not at the time the delegation was
  // written — a delegation that outlives its source is authority nobody holds.
  if (!source.live) {
    return refuse(
      "SOURCE_NOT_LIVE",
      "The seat this authority came from is no longer live, so there is nothing left to lend.",
    )
  }

  if (!delegation.actions.includes(request.action)) {
    return refuse(
      "ACTION_NOT_DELEGATED",
      `"${request.action}" is not among the delegated actions. A delegation names what it permits; anything else is not implied.`,
    )
  }

  // Re-checked against the source every time. A delegator cannot lend what they
  // never had, and cannot keep lending what they have since lost.
  if (!source.actions.includes(request.action)) {
    return refuse(
      "EXCEEDS_SOURCE",
      `The delegating seat does not itself hold "${request.action}", so it cannot confer it. Authority is derived, never invented.`,
    )
  }

  if (delegation.resourceIds.length > 0) {
    if (request.resourceId === null || !delegation.resourceIds.includes(request.resourceId)) {
      return refuse(
        "RESOURCE_NOT_DELEGATED",
        `This delegation is limited to named resources and ${request.resourceId ?? "no resource"} is not one of them.`,
      )
    }
  }

  return { ok: true, reason: null, detail: "" }
}

/**
 * Whether a delegation may itself be delegated onward.
 *
 * Default zero. Onward delegation is how a bounded grant becomes an unbounded
 * one: each hop looks reasonable, and the person at the end holds authority the
 * original delegator never met.
 */
export function mayRedelegate(delegation: Delegation): boolean {
  return delegation.revokedAt === null && delegation.redelegationDepth > 0
}

/** The delegation one hop down, with the budget spent. */
export function redelegate(
  delegation: Delegation,
  next: { id: string; toPersonId: string; actions: readonly string[]; reason: string },
): Delegation | null {
  if (!mayRedelegate(delegation)) return null

  // Never wider than its parent, on either axis. A hop that could add an action
  // is not a delegation of authority, it is a new grant wearing one's name.
  const actions = next.actions.filter((action) => delegation.actions.includes(action))
  if (actions.length === 0) return null

  return {
    ...delegation,
    id: next.id,
    toPersonId: next.toPersonId,
    actions,
    reason: next.reason,
    redelegationDepth: delegation.redelegationDepth - 1,
  }
}

/* ────────────────────────────────────────────────────── team / cohort ── */

export interface Team {
  id: string
  tenantId: string
  name: string
  /** Static membership, or a rule evaluated against the directory. */
  kind: "STATIC" | "DYNAMIC"
  dated: Dated
}

export interface TeamMembership {
  teamId: string
  personId: string
  dated: Dated
}

/**
 * What belonging to a team confers.
 *
 * Bible §"Entity table": a Team/Cohort is "a dynamic or static group for
 * collaboration, **not an automatic security principal unless policy binds
 * it**."
 *
 * So this returns nothing, always, and that is the entire implementation. It is
 * a function rather than a comment because the pressure to make team membership
 * grant something is constant and reasonable-sounding — the team already exists,
 * everyone in it needs the same access, and it is one line. What that buys is
 * authority that changes when somebody edits a group, with no assignment record
 * and nothing in the audit trail. The same rule as GE-043-003, applied to a
 * group we own rather than one a directory asserts.
 */
export function teamConfers(): readonly string[] {
  return []
}

/**
 * Whether a person is in a team at an instant.
 *
 * Membership is real and worth computing — it decides who a thing is *shown* to,
 * who is notified, who appears in a roster. It does not decide what anybody may
 * do.
 */
export function inTeam(memberships: readonly TeamMembership[], input: { personId: string; teamId: string; at: Date }): boolean {
  return memberships.some((membership) => {
    if (membership.personId !== input.personId || membership.teamId !== input.teamId) return false
    const from = Date.parse(membership.dated.effectiveFrom)
    if (Number.isNaN(from) || input.at.getTime() < from) return false
    if (membership.dated.effectiveTo === null) return true
    const until = Date.parse(membership.dated.effectiveTo)
    return !Number.isNaN(until) && input.at.getTime() < until
  })
}

/* ──────────────────────────────────────────── resource relationships ── */

/** What a resource may be attached to. A seat, so it survives its occupant. */
export type ResourceOwnerKind = "SEAT" | "ORGANIZATION_UNIT" | "TEAM" | "PERSON"

export interface ResourceRelationship {
  resourceId: string
  ownerKind: ResourceOwnerKind
  ownerId: string
  /** `owns`, `stewards`, `funds`, `references` — typed, like org relationships. */
  typeId: string
  dated: Dated
}

/**
 * Whether attaching a resource this way preserves continuity.
 *
 * A resource owned by a `PERSON` leaves when they do. That is sometimes right —
 * their own notes, their own drafts — and it is the default people reach for
 * because it is the one that needs no thought. Naming it as a continuity risk at
 * the point of attachment is the only moment anybody will reconsider.
 */
export function attachmentSurvivesTurnover(relationship: ResourceRelationship): boolean {
  return relationship.ownerKind !== "PERSON"
}
