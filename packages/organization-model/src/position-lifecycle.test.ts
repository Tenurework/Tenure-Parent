import {
  archivePosition,
  freezePosition,
  mergePositions,
  planTermTransition,
  positionMayBeFilled,
  splitPosition,
  transferPosition,
  unfreezePosition,
  type LivePosition,
  type OperationContext,
  type PositionRefusal,
  type PositionRefused,
} from "./position-lifecycle"

/**
 * GE-050-006 — most of these read like CRUD and are not.
 *
 * A seat is the continuity primitive, so every operation is really a question
 * about where its history goes, and the wrong answer is usually the tidy one.
 */

const NOW = new Date("2026-08-03T12:00:00Z")
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

const position = (over: Partial<LivePosition> = {}): LivePosition => ({
  id: "seat-president",
  tenantId: "rochester",
  organizationUnitId: "unit-consulting-club",
  title: "President",
  dated: { effectiveFrom: days(-365), effectiveTo: null },
  retiredAt: null,
  frozenAt: null,
  ...over,
})

const context = (over: Partial<OperationContext> = {}): OperationContext => ({
  at: NOW,
  reason: "Board restructure approved at the July meeting.",
  occupied: false,
  ...over,
})

/**
 * Assert a refusal and its reason.
 *
 * Typed against the union every operation returns, so narrowing on `ok` gives
 * the refusal's fields. A `Record<string, unknown>` parameter would have
 * accepted anything and read the fields off `any`, which is a helper that
 * passes whatever it is given.
 */
const refusedBecause = (
  outcome: { ok: true } | PositionRefused,
  reason: PositionRefusal,
) => {
  expect(outcome.ok).toBe(false)
  if (outcome.ok) throw new Error("expected a refusal")
  expect(outcome.reason).toBe(reason)
  expect(outcome.detail.length).toBeGreaterThan(20)
}

describe("freezing stops a position being filled, not being held", () => {
  it("freezes an open position", () => {
    const outcome = freezePosition(position(), context())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("unreachable")
    expect(outcome.position.frozenAt).toBe(NOW.toISOString())
  })

  it("does not evict the current holder", () => {
    // A hiring freeze that evicted incumbents would be a redundancy programme
    // wearing a budget decision's name, and the two need very different
    // approvals.
    const outcome = freezePosition(position(), context({ occupied: true }))
    expect(outcome.ok).toBe(true)
  })

  it("stops the position being filled", () => {
    const frozen = position({ frozenAt: days(-1) })
    expect(positionMayBeFilled(frozen, NOW)).toBe(false)
    expect(positionMayBeFilled(position(), NOW)).toBe(true)
  })

  it("refuses to freeze twice", () => {
    refusedBecause(freezePosition(position({ frozenAt: days(-1) }), context()), "ALREADY_FROZEN")
  })

  it("lifts a freeze", () => {
    const outcome = unfreezePosition(position({ frozenAt: days(-1) }), context())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("unreachable")
    expect(outcome.position.frozenAt).toBeNull()
  })

  it("refuses to lift a freeze that is not there", () => {
    refusedBecause(unfreezePosition(position(), context()), "NOT_FROZEN")
  })
})

describe("a position that may not be filled", () => {
  it("is closed once archived", () => {
    expect(positionMayBeFilled(position({ retiredAt: days(-1) }), NOW)).toBe(false)
  })

  it("is closed before it opens and after it ends", () => {
    expect(positionMayBeFilled(position({ dated: { effectiveFrom: days(7), effectiveTo: null } }), NOW)).toBe(false)
    expect(
      positionMayBeFilled(position({ dated: { effectiveFrom: days(-30), effectiveTo: days(-1) } }), NOW),
    ).toBe(false)
  })

  it("is closed when its window will not parse", () => {
    expect(
      positionMayBeFilled(position({ dated: { effectiveFrom: "not-a-date", effectiveTo: null } }), NOW),
    ).toBe(false)
  })
})

describe("a transfer moves the position and keeps its identity", () => {
  const target = { organizationUnitId: "unit-finance", holdsSeats: true }

  it("keeps the seat id", () => {
    // An id that changed on a reorganisation would detach every decision, file
    // and financial record that referenced it — which is what a durable
    // position exists to prevent, and reorganisations are frequent.
    const outcome = transferPosition(position(), target, context())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("unreachable")
    expect(outcome.position.id).toBe("seat-president")
    expect(outcome.position.organizationUnitId).toBe("unit-finance")
  })

  it("does not touch the occupant", () => {
    // Somebody whose department was renamed has not changed job, and a transfer
    // that vacated the seat would make every reorganisation look like a wave of
    // resignations.
    const outcome = transferPosition(position(), target, context({ occupied: true }))
    expect(outcome.ok).toBe(true)
  })

  it("refuses a unit type that holds no positions", () => {
    // GE-050-003. A seat at a location is authority attached to an address.
    refusedBecause(
      transferPosition(position(), { organizationUnitId: "unit-warehouse", holdsSeats: false }, context()),
      "TARGET_HOLDS_NO_SEATS",
    )
  })

  it("refuses a move to where it already is", () => {
    refusedBecause(
      transferPosition(position(), { organizationUnitId: "unit-consulting-club", holdsSeats: true }, context()),
      "SAME_UNIT",
    )
  })
})

describe("a split archives the original rather than copying its history", () => {
  const parts = [
    { id: "seat-vp-internal", title: "VP Internal" },
    { id: "seat-vp-external", title: "VP External" },
  ]

  it("archives the original and creates the parts", () => {
    const outcome = splitPosition(position(), parts, context())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("unreachable")

    expect(outcome.archived.retiredAt).toBe(NOW.toISOString())
    expect(outcome.parts.map((p) => p.id)).toEqual(["seat-vp-internal", "seat-vp-external"])
  })

  it("gives each part a reference back, not a copy of the past", () => {
    // Two seats each claiming the same past leave a reader unable to tell which
    // decision belonged to which successor, and a financial history duplicated
    // across two cost centres is a reconciliation nobody can close.
    const outcome = splitPosition(position(), parts, context())
    if (!outcome.ok) throw new Error("unreachable")

    for (const part of outcome.parts) {
      expect(part.splitFromSeatId).toBe("seat-president")
      // The part is new. It does not inherit the original's start date, which
      // would claim a history it does not have.
      expect(part.dated.effectiveFrom).toBe(NOW.toISOString())
    }
  })

  it("refuses to split a position somebody holds", () => {
    // Splitting a post somebody holds gives them two jobs or none, and which is
    // a decision for a person rather than a default.
    refusedBecause(splitPosition(position(), parts, context({ occupied: true })), "STILL_OCCUPIED")
  })

  it("refuses a split into one", () => {
    // That is a change of title, which does not archive the original.
    refusedBecause(splitPosition(position(), [parts[0]], context()), "TOO_FEW_PARTS")
  })

  it("lets a part land in a different unit", () => {
    const outcome = splitPosition(
      position(),
      [parts[0], { ...parts[1], organizationUnitId: "unit-finance" }],
      context(),
    )
    if (!outcome.ok) throw new Error("unreachable")
    expect(outcome.parts[0].organizationUnitId).toBe("unit-consulting-club")
    expect(outcome.parts[1].organizationUnitId).toBe("unit-finance")
  })
})

describe("a merge will not drop a holder", () => {
  const folding = (occupied: boolean) => [
    { position: position({ id: "seat-secretary", title: "Secretary" }), occupied },
  ]

  it("folds an empty position into another", () => {
    const outcome = mergePositions(position(), folding(false), context())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("unreachable")

    expect(outcome.surviving.mergedFromSeatIds).toEqual(["seat-secretary"])
    expect(outcome.archived[0].retiredAt).toBe(NOW.toISOString())
  })

  it("refuses when both have live holders", () => {
    // A merge that quietly kept one occupant and dropped the other is a
    // dismissal recorded as a data change, and the person who lost their seat
    // would find out from an org chart.
    refusedBecause(
      mergePositions(position(), folding(true), context({ occupied: true })),
      "MERGE_WOULD_DROP_A_HOLDER",
    )
  })

  it("allows exactly one holder across the whole merge", () => {
    // One person keeping their seat while empty posts fold into it is the
    // ordinary case and must not be blocked.
    expect(mergePositions(position(), folding(false), context({ occupied: true })).ok).toBe(true)
    expect(mergePositions(position(), folding(true), context({ occupied: false })).ok).toBe(true)
  })

  it("refuses to fold in a position that is already archived", () => {
    refusedBecause(
      mergePositions(
        position(),
        [{ position: position({ id: "gone", retiredAt: days(-1) }), occupied: false }],
        context(),
      ),
      "ALREADY_ARCHIVED",
    )
  })

  it("refuses a merge with nothing to fold in", () => {
    refusedBecause(mergePositions(position(), [], context()), "TOO_FEW_PARTS")
  })

  it("accumulates rather than replacing an earlier merge's record", () => {
    const outcome = mergePositions(
      position({ mergedFromSeatIds: ["seat-treasurer"] }),
      folding(false),
      context(),
    )
    if (!outcome.ok) throw new Error("unreachable")
    expect(outcome.surviving.mergedFromSeatIds).toEqual(["seat-treasurer", "seat-secretary"])
  })
})

describe("archiving keeps the history and refuses to end an assignment quietly", () => {
  it("retires an empty position", () => {
    const outcome = archivePosition(position(), context())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("unreachable")
    expect(outcome.position.retiredAt).toBe(NOW.toISOString())
  })

  it("refuses while somebody holds it", () => {
    // Ending the assignment first is one extra step and one extra record, and
    // the record is the point.
    refusedBecause(archivePosition(position(), context({ occupied: true })), "STILL_OCCUPIED")
  })

  it("refuses to archive twice", () => {
    refusedBecause(archivePosition(position({ retiredAt: days(-1) }), context()), "ALREADY_ARCHIVED")
  })
})

describe("every operation needs a stated reason", () => {
  it("refuses an unexplained change", () => {
    // An org chart that moved and nobody can say why is one nobody can put back.
    const bare = context({ reason: "moved" })
    refusedBecause(freezePosition(position(), bare), "NO_REASON")
    refusedBecause(archivePosition(position(), bare), "NO_REASON")
    refusedBecause(
      transferPosition(position(), { organizationUnitId: "u2", holdsSeats: true }, bare),
      "NO_REASON",
    )
    refusedBecause(
      splitPosition(position(), [{ id: "a", title: "A" }, { id: "b", title: "B" }], bare),
      "NO_REASON",
    )
    refusedBecause(
      mergePositions(position(), [{ position: position({ id: "x" }), occupied: false }], bare),
      "NO_REASON",
    )
  })

  it("refuses an archived position to every operation", () => {
    const archived = position({ retiredAt: days(-1) })
    refusedBecause(freezePosition(archived, context()), "ALREADY_ARCHIVED")
    refusedBecause(
      transferPosition(archived, { organizationUnitId: "u2", holdsSeats: true }, context()),
      "ALREADY_ARCHIVED",
    )
    refusedBecause(
      splitPosition(archived, [{ id: "a", title: "A" }, { id: "b", title: "B" }], context()),
      "ALREADY_ARCHIVED",
    )
  })
})

describe("a term turnover is not a bulk update", () => {
  it("separates handovers, vacancies and cold starts", () => {
    // The failure a bulk update invites: every seat reassigned, and nobody
    // notices that some have nobody named and some incoming holders have no
    // predecessor to learn from.
    const plan = planTermTransition([
      { seatId: "president", outgoingPersonId: "dana", incomingPersonId: "sam" },
      { seatId: "treasurer", outgoingPersonId: "priya", incomingPersonId: null },
      { seatId: "secretary", outgoingPersonId: null, incomingPersonId: "alex" },
    ])

    expect(plan.handovers.map((h) => h.seatId)).toEqual(["president"])
    expect(plan.vacancies).toEqual(["treasurer"])
    expect(plan.coldStarts).toEqual(["secretary"])
  })

  it("keeps vacancies and cold starts apart, because they need different action", () => {
    // A vacancy needs somebody found. A cold start has somebody — they simply
    // have nobody to hand over from, which is where the seat's accumulated
    // memory is the only continuity there is.
    const plan = planTermTransition([
      { seatId: "a", outgoingPersonId: null, incomingPersonId: null },
      { seatId: "b", outgoingPersonId: null, incomingPersonId: "new" },
    ])
    expect(plan.vacancies).toEqual(["a"])
    expect(plan.coldStarts).toEqual(["b"])
  })

  it("does not call a re-election a handover", () => {
    // Listing it would put a meaningless task on somebody's transition
    // checklist, and a checklist with meaningless tasks is one nobody finishes.
    const plan = planTermTransition([
      { seatId: "president", outgoingPersonId: "dana", incomingPersonId: "dana" },
    ])
    expect(plan.handovers).toEqual([])
    expect(plan.vacancies).toEqual([])
    expect(plan.coldStarts).toEqual([])
  })

  it("handles a whole board at once", () => {
    const plan = planTermTransition([
      { seatId: "s1", outgoingPersonId: "a", incomingPersonId: "b" },
      { seatId: "s2", outgoingPersonId: "c", incomingPersonId: "d" },
      { seatId: "s3", outgoingPersonId: "e", incomingPersonId: null },
      { seatId: "s4", outgoingPersonId: null, incomingPersonId: "f" },
      { seatId: "s5", outgoingPersonId: "g", incomingPersonId: "g" },
    ])
    expect(plan.handovers).toHaveLength(2)
    expect(plan.vacancies).toHaveLength(1)
    expect(plan.coldStarts).toHaveLength(1)
  })
})
