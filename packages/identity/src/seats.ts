import type { EffectiveInterval, TenantMembership } from "./entities"
import { membershipLiveness, type Liveness } from "./effective-state"

/**
 * GE-040-003 — one person, several identities, several tenants, several seats
 * at once.
 *
 * The entities already allow all of that structurally: an `ExternalIdentity`
 * points at a person, a `TenantMembership` names a person and a tenant, and
 * nothing limits either to one. What the item actually asks for is that the
 * *resolution* works when a person has several — and the place that stops being
 * true is time.
 *
 * ## Simultaneous seats only compose if the window is honoured
 *
 * "Simultaneous" is the whole difficulty. A handover where the outgoing
 * treasurer's term ends on 31 May and the incoming one's begins on 1 June is
 * two assignments that overlap in the record and must not overlap in authority.
 * Get the boundary wrong in one direction and there is a day with two
 * treasurers; wrong in the other and there is a day with none.
 *
 * `apps/web` had the columns and did not read them. `RoleAssignment.startDate`
 * and `endDate` appear in the schema and in no query: authority came from
 * `status` alone, and `ALUMNI` is only ever written by a person clicking. A
 * seat whose term ended in June therefore kept full authority until somebody
 * remembered — which is precisely the "temporal rules for assignment and
 * delegation start/end boundaries" Bible §9.2 requires and nothing enforced.
 *
 * ## The three statuses do not share one window rule
 *
 * This is the part that makes it more than a `where` clause. `SHADOW` exists to
 * give an incoming holder read-only access *before* their term begins, so
 * excluding seats that have not reached `startDate` would delete the feature.
 * `ACTIVE` is the opposite: it must not begin early and must not outlast
 * `endDate`.
 *
 *   * `ALUMNI`   — never live. The record is kept; the access is not.
 *   * `SHADOW`   — live until `endDate`, including before `startDate`. That is
 *                  what it is for.
 *   * `ACTIVE`   — live only within `[startDate, endDate)`.
 *
 * Half-open at the end, matching memberships, so one term ending exactly where
 * the next begins leaves no gap and no overlap.
 */

export const SEAT_STATUSES = ["SHADOW", "ACTIVE", "ALUMNI"] as const
export type SeatStatus = (typeof SEAT_STATUSES)[number]

export interface SeatAssignment {
  id: string
  personId: string
  /** The organization the seat belongs to. */
  organizationId: string
  /** The tenant that organization sits in. */
  tenantId: string
  roleId: string
  status: SeatStatus
  interval: EffectiveInterval
}

/** What a live seat may do. A SHADOW holder previews; they do not act. */
export type SeatAuthority = "NONE" | "READ_ONLY" | "FULL"

export interface SeatState {
  liveness: Liveness
  authority: SeatAuthority
}

/**
 * Whether a seat grants anything at an instant, and how much.
 *
 * Returns authority alongside liveness because the two are not the same
 * question and callers need both: a SHADOW seat is live and read-only, and code
 * that only asked "is it live" would let an incoming president approve things a
 * week early.
 */
export function seatState(seat: SeatAssignment, at: Date): SeatState {
  const now = at.getTime()
  const from = Date.parse(seat.interval.effectiveFrom)
  const until = seat.interval.effectiveUntil === null ? null : Date.parse(seat.interval.effectiveUntil)

  if (Number.isNaN(from) || (seat.interval.effectiveUntil !== null && Number.isNaN(until))) {
    return {
      liveness: { live: false, reason: "MALFORMED", detail: "The seat's term is not a pair of times." },
      authority: "NONE",
    }
  }

  if (seat.status === "ALUMNI") {
    return {
      liveness: {
        live: false,
        reason: "EXPIRED",
        detail: "This term has ended. The record is kept so past decisions still resolve; the access is not.",
      },
      authority: "NONE",
    }
  }

  // The end of the term binds both remaining statuses. A seat past its end date
  // grants nothing whatever its status says — that is the hole this closes.
  if (until !== null && now >= until) {
    return {
      liveness: {
        live: false,
        reason: "EXPIRED",
        detail: `This term ended at ${seat.interval.effectiveUntil}. Authority ends with the term, not when somebody remembers to close it.`,
      },
      authority: "NONE",
    }
  }

  if (seat.status === "SHADOW") {
    // Deliberately not gated on startDate: previewing before the term begins is
    // the entire purpose of SHADOW, and excluding it would delete the feature
    // while looking like a tightening.
    return { liveness: { live: true }, authority: "READ_ONLY" }
  }

  if (now < from) {
    return {
      liveness: {
        live: false,
        reason: "NOT_YET_EFFECTIVE",
        detail: `This term begins at ${seat.interval.effectiveFrom}. A seat scheduled to start later does not act now.`,
      },
      authority: "NONE",
    }
  }

  return { liveness: { live: true }, authority: "FULL" }
}

/** Seats granting something at an instant, in any organization. */
export function liveSeats(seats: readonly SeatAssignment[], at: Date): readonly SeatAssignment[] {
  return seats.filter((seat) => seatState(seat, at).liveness.live)
}

/** Seats granting full authority — the ones that may act rather than watch. */
export function actingSeats(seats: readonly SeatAssignment[], at: Date): readonly SeatAssignment[] {
  return seats.filter((seat) => seatState(seat, at).authority === "FULL")
}

export interface PersonReach {
  personId: string
  /** Tenants the person is a live member of. Order is stable. */
  tenantIds: readonly string[]
  /** Live seats, grouped by tenant. */
  seatsByTenant: Readonly<Record<string, readonly SeatAssignment[]>>
  /** Organizations where they may act, not merely watch. */
  actingOrganizationIds: readonly string[]
}

/**
 * Everything one person currently reaches, across every tenant.
 *
 * The multi-tenant case is the one worth being careful about, and the care is
 * mostly about what this does *not* do: a seat is only included if the person
 * has a live membership in that seat's tenant. A seat is granted inside a
 * tenant, and a membership is what makes someone part of that tenant — so a
 * seat surviving its tenant membership would be authority in a place the person
 * no longer belongs, which is the exact shape of a cross-tenant leak.
 *
 * Ordering is stable so a person with several tenants resolves the same acting
 * tenant on every request. `apps/web` already relies on that: with no explicit
 * choice it takes the first, and a set that reordered would move somebody
 * between tenants between page loads.
 */
export function personReach(
  personId: string,
  memberships: readonly TenantMembership[],
  seats: readonly SeatAssignment[],
  at: Date,
): PersonReach {
  const mine = memberships.filter((membership) => membership.personId === personId)
  const liveTenants = mine
    .filter((membership) => membershipLiveness(membership, at).live)
    .map((membership) => membership.tenantId)

  const tenantIds = [...new Set(liveTenants)].sort()
  const inScope = new Set(tenantIds)

  const mySeats = seats.filter(
    (seat) => seat.personId === personId && inScope.has(seat.tenantId) && seatState(seat, at).liveness.live,
  )

  const seatsByTenant: Record<string, SeatAssignment[]> = {}
  for (const tenantId of tenantIds) seatsByTenant[tenantId] = []
  for (const seat of mySeats) seatsByTenant[seat.tenantId].push(seat)
  for (const tenantId of tenantIds) {
    seatsByTenant[tenantId].sort((left, right) => (left.id < right.id ? -1 : 1))
  }

  const actingOrganizationIds = [
    ...new Set(
      mySeats.filter((seat) => seatState(seat, at).authority === "FULL").map((seat) => seat.organizationId),
    ),
  ].sort()

  return { personId, tenantIds, seatsByTenant, actingOrganizationIds }
}

/**
 * Seats for one role that are live at the same instant.
 *
 * A handover is meant to produce exactly one. Two means the outgoing term was
 * never closed; zero means the incoming one has not opened, and somebody is
 * locked out of a role that appears filled. Both are worth surfacing, which is
 * why this returns the seats rather than a boolean.
 */
export function concurrentHolders(
  seats: readonly SeatAssignment[],
  roleId: string,
  at: Date,
): readonly SeatAssignment[] {
  return seats
    .filter((seat) => seat.roleId === roleId && seatState(seat, at).authority === "FULL")
    .sort((left, right) => (left.id < right.id ? -1 : 1))
}
