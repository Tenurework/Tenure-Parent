import {
  actingSeats,
  concurrentHolders,
  liveSeats,
  personReach,
  seatState,
  type SeatAssignment,
  type TenantMembership,
} from "./index"

/**
 * GE-040-003 — one person, several tenants, several seats at once.
 *
 * "Simultaneous" is the whole difficulty. A handover where one term ends on 31
 * May and the next begins on 1 June is two assignments that overlap in the
 * record and must not overlap in authority. Get the boundary wrong one way and
 * there is a day with two treasurers; the other way, a day with none.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

const seat = (over: Partial<SeatAssignment> = {}): SeatAssignment => ({
  id: "seat-1",
  personId: "person-1",
  organizationId: "org-chess",
  tenantId: "rochester",
  roleId: "role-treasurer",
  status: "ACTIVE",
  interval: { effectiveFrom: days(-30), effectiveUntil: null },
  ...over,
})

const membership = (over: Partial<TenantMembership> = {}): TenantMembership => ({
  id: "mem-1",
  personId: "person-1",
  tenantId: "rochester",
  origin: "INVITATION",
  status: "ACTIVE",
  interval: { effectiveFrom: days(-100), effectiveUntil: null },
  statusReason: null,
  ...over,
})

describe("a seat's authority ends with its term", () => {
  it("grants full authority inside the term", () => {
    expect(seatState(seat(), NOW)).toEqual({ liveness: { live: true }, authority: "FULL" })
  })

  it("grants nothing after the term ends, whatever the status says", () => {
    // The hole this closes: ALUMNI is only ever written by a person clicking,
    // so an ACTIVE seat whose term ended in June kept full authority until
    // somebody remembered.
    const ended = seatState(seat({ interval: { effectiveFrom: days(-30), effectiveUntil: days(-1) } }), NOW)
    expect(ended.authority).toBe("NONE")
    expect(ended.liveness.live).toBe(false)
    if (ended.liveness.live) return
    expect(ended.liveness.detail).toMatch(/not when somebody remembers/)
  })

  it("grants nothing before an ACTIVE term begins", () => {
    const early = seatState(seat({ interval: { effectiveFrom: days(3), effectiveUntil: null } }), NOW)
    expect(early.authority).toBe("NONE")
    if (early.liveness.live) return
    expect(early.liveness.reason).toBe("NOT_YET_EFFECTIVE")
  })

  it("grants nothing to a past holder", () => {
    expect(seatState(seat({ status: "ALUMNI" }), NOW).authority).toBe("NONE")
  })
})

describe("SHADOW is read-only, and deliberately live before its term", () => {
  it("previews before the term begins", () => {
    // Excluding seats that have not reached startDate would delete the feature
    // while looking like a tightening. This is the assertion that stops that.
    const incoming = seatState(
      seat({ status: "SHADOW", interval: { effectiveFrom: days(7), effectiveUntil: null } }),
      NOW,
    )
    expect(incoming.liveness.live).toBe(true)
    expect(incoming.authority).toBe("READ_ONLY")
  })

  it("never acts, only watches", () => {
    // Code that asked only "is it live" would let an incoming president approve
    // things a week early.
    expect(seatState(seat({ status: "SHADOW" }), NOW).authority).toBe("READ_ONLY")
    expect(actingSeats([seat({ status: "SHADOW" })], NOW)).toEqual([])
    expect(liveSeats([seat({ status: "SHADOW" })], NOW)).toHaveLength(1)
  })

  it("still stops at the end of the term", () => {
    const stale = seatState(
      seat({ status: "SHADOW", interval: { effectiveFrom: days(-30), effectiveUntil: days(-1) } }),
      NOW,
    )
    expect(stale.authority).toBe("NONE")
  })
})

describe("a handover leaves neither a gap nor an overlap", () => {
  const handoverAt = days(0)
  const outgoing = seat({ id: "seat-out", interval: { effectiveFrom: days(-300), effectiveUntil: handoverAt } })
  const incoming = seat({
    id: "seat-in",
    personId: "person-2",
    interval: { effectiveFrom: handoverAt, effectiveUntil: null },
  })

  it("has exactly one holder at the instant of handover", () => {
    // Half-open at the end: the outgoing term ending exactly where the next
    // begins leaves no gap and no overlap.
    const holders = concurrentHolders([outgoing, incoming], "role-treasurer", NOW)
    expect(holders.map((s) => s.id)).toEqual(["seat-in"])
  })

  it("has exactly one holder the instant before", () => {
    const before = new Date(NOW.getTime() - 1)
    expect(concurrentHolders([outgoing, incoming], "role-treasurer", before).map((s) => s.id)).toEqual([
      "seat-out",
    ])
  })

  it("surfaces two holders when a term was never closed", () => {
    // Worth surfacing rather than hiding: it means the outgoing term is still
    // open, which is a real authority problem somebody has to resolve.
    const neverClosed = seat({ id: "seat-out", interval: { effectiveFrom: days(-300), effectiveUntil: null } })
    expect(concurrentHolders([neverClosed, incoming], "role-treasurer", NOW)).toHaveLength(2)
  })

  it("does not count a SHADOW successor as a concurrent holder", () => {
    // This is the NORMAL state of a planned handover: the outgoing holder is
    // ACTIVE and the incoming one is SHADOW, previewing. Counting SHADOW would
    // report every planned handover as a two-holder conflict, and a conflict
    // report that fires on the correct case is one nobody reads.
    const outgoingOpen = seat({ id: "seat-out", interval: { effectiveFrom: days(-300), effectiveUntil: days(30) } })
    const successor = seat({
      id: "seat-shadow",
      personId: "person-2",
      status: "SHADOW",
      interval: { effectiveFrom: days(30), effectiveUntil: null },
    })

    expect(liveSeats([outgoingOpen, successor], NOW)).toHaveLength(2)
    expect(concurrentHolders([outgoingOpen, successor], "role-treasurer", NOW).map((s) => s.id)).toEqual([
      "seat-out",
    ])
  })

  it("surfaces zero holders when the incoming term has not opened", () => {
    // Somebody is locked out of a role that appears filled.
    const late = seat({ id: "seat-in", interval: { effectiveFrom: days(5), effectiveUntil: null } })
    expect(concurrentHolders([outgoing, late], "role-treasurer", NOW)).toEqual([])
  })
})

describe("one person across several tenants", () => {
  const memberships = [
    membership({ id: "m-roch", tenantId: "rochester" }),
    membership({ id: "m-simon", tenantId: "simon" }),
    membership({ id: "m-gone", tenantId: "departed", status: "REVOKED", statusReason: "left" }),
  ]
  const seats = [
    seat({ id: "s-roch", tenantId: "rochester", organizationId: "org-chess" }),
    seat({ id: "s-simon", tenantId: "simon", organizationId: "org-debate" }),
    seat({ id: "s-gone", tenantId: "departed", organizationId: "org-old" }),
  ]

  it("reaches every tenant it is a live member of", () => {
    const reach = personReach("person-1", memberships, seats, NOW)
    expect(reach.tenantIds).toEqual(["rochester", "simon"])
  })

  it("holds simultaneous seats in different tenants", () => {
    const reach = personReach("person-1", memberships, seats, NOW)
    expect(reach.seatsByTenant.rochester.map((s) => s.id)).toEqual(["s-roch"])
    expect(reach.seatsByTenant.simon.map((s) => s.id)).toEqual(["s-simon"])
    expect(reach.actingOrganizationIds).toEqual(["org-chess", "org-debate"])
  })

  it("drops a seat whose tenant membership has ended", () => {
    // A seat is granted inside a tenant, and a membership is what makes someone
    // part of it. A seat outliving its membership is authority in a place the
    // person no longer belongs — the exact shape of a cross-tenant leak.
    const reach = personReach("person-1", memberships, seats, NOW)
    expect(reach.tenantIds).not.toContain("departed")
    expect(Object.values(reach.seatsByTenant).flat().map((s) => s.id)).not.toContain("s-gone")
  })

  it("never returns another person's seats or memberships", () => {
    const reach = personReach(
      "person-2",
      [...memberships, membership({ id: "m-other", personId: "person-2", tenantId: "simon" })],
      [...seats, seat({ id: "s-other", personId: "person-2", tenantId: "simon" })],
      NOW,
    )
    expect(reach.tenantIds).toEqual(["simon"])
    expect(Object.values(reach.seatsByTenant).flat().map((s) => s.id)).toEqual(["s-other"])
  })

  it("orders tenants stably, so the acting tenant does not move between requests", () => {
    // apps/web takes the first when no explicit choice is stored. A set that
    // reordered would move somebody between tenants between page loads.
    const shuffled = [memberships[1], memberships[0], memberships[2]]
    expect(personReach("person-1", shuffled, seats, NOW).tenantIds).toEqual(
      personReach("person-1", memberships, seats, NOW).tenantIds,
    )
  })

  it("holds several identities' worth of seats in one organization", () => {
    // Two seats in one org at once is normal — treasurer and webmaster — and
    // both must survive the aggregation.
    const two = [
      seat({ id: "s-a", roleId: "role-treasurer" }),
      seat({ id: "s-b", roleId: "role-webmaster" }),
    ]
    const reach = personReach("person-1", [membership()], two, NOW)
    expect(reach.seatsByTenant.rochester.map((s) => s.id)).toEqual(["s-a", "s-b"])
    expect(reach.actingOrganizationIds).toEqual(["org-chess"])
  })

  it("reports a person with no live membership as reaching nothing", () => {
    const reach = personReach("person-1", [membership({ status: "REVOKED", statusReason: "left" })], seats, NOW)
    expect(reach.tenantIds).toEqual([])
    expect(reach.actingOrganizationIds).toEqual([])
  })
})
