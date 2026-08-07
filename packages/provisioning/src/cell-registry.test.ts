import {
  DEFAULT_CELL_RESERVE,
  admissionLimit,
  cellHeadroom,
  cellReserve,
  choosePlacement,
  isCellHot,
  isCellServing,
  validateCellRecord,
  warnThreshold,
  type CellHealth,
  type CellRecord,
} from "./cell-registry"

/**
 * GE-030-002 — the cell registry.
 *
 * Placement is the reason this exists, so most of these are about placement
 * refusing correctly. A placement that succeeds when it should not puts a
 * tenant's data somewhere it was not allowed to go, and nobody finds out from
 * the outside.
 */
const CELL: CellRecord = {
  cellId: "cell-use1-a",
  awsAccountId: "047385673922",
  region: "us-east-1",
  environment: "production",
  partition: "aws",
  health: "HEALTHY",
  capacity: { tenants: 3, maxTenants: 50 },
  release: "1.0.512",
  schemaVersion: "2026.07.31",
  residencyZones: ["us-east-1"],
  routing: { baseUrl: "https://platform.tenurework.com" },
  backup: { lastVerifiedAt: "2026-08-01T03:00:00.000Z", retentionDays: 7 },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
}

const cell = (over: Partial<CellRecord>): CellRecord => ({ ...CELL, ...over })

describe("a cell record validates before it is trusted", () => {
  it("accepts a well-formed cell", () => {
    expect(validateCellRecord(CELL)).toEqual([])
  })

  it("refuses a cell that may not hold its own region's data", () => {
    // A cell in us-east-1 whose residency zones exclude us-east-1 holds its own
    // data somewhere it is not permitted to.
    const problems = validateCellRecord(cell({ residencyZones: ["eu-west-1"] }))
    expect(problems.map((p) => p.field)).toContain("residencyZones")
  })

  it("refuses an empty residency zone list rather than reading it as 'none'", () => {
    // "No tenant may be placed here" is a real state — it is DRAINING, said
    // explicitly. An empty array says the same thing by accident, and the two
    // need different operator responses.
    expect(validateCellRecord(cell({ residencyZones: [] })).map((p) => p.field)).toContain(
      "residencyZones",
    )
  })

  it("refuses a malformed AWS account id", () => {
    // "Which account is this in" is the first question asked in an incident.
    for (const bad of ["", "12345", "not-an-account", "0473856739222"]) {
      expect(validateCellRecord(cell({ awsAccountId: bad })).map((p) => p.field)).toContain(
        "awsAccountId",
      )
    }
  })

  it("refuses a cell reachable over http", () => {
    // A cell whose sessions can be read on the wire.
    expect(
      validateCellRecord(cell({ routing: { baseUrl: "http://platform.tenurework.com" } })).map(
        (p) => p.field,
      ),
    ).toContain("routing.baseUrl")
  })

  it("refuses a cell with no retention", () => {
    expect(validateCellRecord(cell({ backup: { lastVerifiedAt: null, retentionDays: 0 } })).length)
      .toBeGreaterThan(0)
  })

  it("allows a cell that has never been backed up, and records it", () => {
    // A newly built cell has no verified backup yet. That is a fact worth
    // showing, not a validation failure — refusing it would mean a cell cannot
    // be registered until after its first backup runs.
    const fresh = cell({ backup: { lastVerifiedAt: null, retentionDays: 7 } })
    expect(validateCellRecord(fresh)).toEqual([])
    expect(fresh.backup.lastVerifiedAt).toBeNull()
  })

  it("refuses a migration to itself", () => {
    expect(
      validateCellRecord(
        cell({ migration: { direction: "out", counterpartCellId: "cell-use1-a", startedAt: "x" } }),
      ).map((p) => p.field),
    ).toContain("migration.counterpartCellId")
  })
})

describe("health says whether it is serving, and separately whether it may take more", () => {
  it("keeps serving in every state except OFFLINE", () => {
    const serving = (
      ["HEALTHY", "DEGRADED", "UPGRADING", "DRAINING", "OFFLINE"] as CellHealth[]
    ).filter(isCellServing)
    expect(serving.sort()).toEqual(["DEGRADED", "DRAINING", "HEALTHY", "UPGRADING"].sort())
  })

  it("places into HEALTHY only", () => {
    // Each of these is serving traffic and must not receive a new tenant, for a
    // different reason. Collapsing them into `healthy: false` loses the reason,
    // and the reason is what tells an operator whether to wait or to act.
    for (const health of ["DEGRADED", "UPGRADING", "DRAINING", "OFFLINE"] as CellHealth[]) {
      expect(choosePlacement([cell({ health })], PROD_TENANT).cellId).toBeNull()
      expect(choosePlacement([cell({ health })], PROD_TENANT).reason).toBe("no-healthy-cell")
    }
    expect(choosePlacement([cell({ health: "HEALTHY" })], PROD_TENANT).cellId).toBe("cell-use1-a")
  })
})

const PROD_TENANT = { residency: ["us-east-1"], environment: "production" as const }

describe("placement", () => {
  it("refuses when no cell may legally hold the tenant, and says so", () => {
    // The order of the filters is the point. Reporting "no capacity" when the
    // real problem is residency sends an operator to add hardware that cannot
    // help.
    const decision = choosePlacement([cell({ region: "us-east-1" })], {
      residency: ["eu-west-1"],
      environment: "production",
    })
    expect(decision.cellId).toBeNull()
    expect(decision.reason).toBe("no-cell-in-residency")
    expect(decision.considered).toEqual({
      inResidency: 0,
      healthy: 0,
      withCapacity: 0,
      withHeadroom: 0,
    })
  })

  it("distinguishes 'nowhere legal' from 'nothing healthy' from 'nothing with room'", () => {
    const region = { region: "us-east-1", residencyZones: ["us-east-1"] }

    expect(choosePlacement([cell({ ...region, health: "DEGRADED" })], PROD_TENANT).reason).toBe(
      "no-healthy-cell",
    )

    const full = choosePlacement(
      [cell({ ...region, capacity: { tenants: 50, maxTenants: 50 } })],
      PROD_TENANT,
    )
    expect(full.reason).toBe("no-capacity")
    // And it reports where it narrowed to nothing, so the refusal is actionable.
    expect(full.considered).toEqual({
      inResidency: 1,
      healthy: 1,
      withCapacity: 0,
      withHeadroom: 0,
    })
  })

  it("never places into another environment", () => {
    // A production tenant in a staging cell is a production tenant on staging's
    // backup schedule, staging's release cadence and staging's access controls.
    expect(
      choosePlacement([cell({ environment: "staging" })], PROD_TENANT).reason,
    ).toBe("no-cell-in-residency")
  })

  it("picks the emptiest cell", () => {
    const decision = choosePlacement(
      [
        cell({ cellId: "cell-use1-a", capacity: { tenants: 30, maxTenants: 50 } }),
        cell({ cellId: "cell-use1-b", capacity: { tenants: 4, maxTenants: 50 } }),
        cell({ cellId: "cell-use1-c", capacity: { tenants: 12, maxTenants: 50 } }),
      ],
      PROD_TENANT,
    )
    expect(decision.cellId).toBe("cell-use1-b")
    expect(decision.considered).toEqual({
      inResidency: 3,
      healthy: 3,
      withCapacity: 3,
      withHeadroom: 3,
    })
  })

  it("breaks a tie deterministically", () => {
    // A placement that depends on iteration order cannot be reproduced when
    // someone asks why a tenant went where it did.
    const cells = [
      cell({ cellId: "cell-use1-c", capacity: { tenants: 5, maxTenants: 50 } }),
      cell({ cellId: "cell-use1-a", capacity: { tenants: 5, maxTenants: 50 } }),
      cell({ cellId: "cell-use1-b", capacity: { tenants: 5, maxTenants: 50 } }),
    ]
    expect(choosePlacement(cells, PROD_TENANT).cellId).toBe("cell-use1-a")
    expect(choosePlacement([...cells].reverse(), PROD_TENANT).cellId).toBe("cell-use1-a")
  })

  it("refuses an empty fleet without pretending it is a capacity problem", () => {
    expect(choosePlacement([], PROD_TENANT).reason).toBe("no-cell-in-residency")
  })

  it("places a multi-region tenant in one of its permitted regions", () => {
    const decision = choosePlacement(
      [
        cell({ cellId: "cell-usw2-a", region: "us-west-2", residencyZones: ["us-west-2"] }),
        cell({ cellId: "cell-euw1-a", region: "eu-west-1", residencyZones: ["eu-west-1"] }),
      ],
      { residency: ["us-west-2", "us-east-1"], environment: "production" },
    )
    expect(decision.cellId).toBe("cell-usw2-a")
    // The eu cell was never in the running, and the count says so.
    expect(decision.considered.inResidency).toBe(1)
  })
})

/**
 * GE-101-004 — admission, thresholds, and what to do about them.
 *
 * The failure this closes is quiet: a fleet that refuses only at exhaustion is
 * a fleet that finds out it has no room on the day it needs some, having given
 * the last slot to whoever signed up first. So there are two capacity tests —
 * "is there a slot" and "may onboarding have it" — and the fleet says what to
 * do while the answer is still yes.
 */
describe("capacity arithmetic", () => {
  it("holds a slot back by default, without taking a small cell's only one", () => {
    expect(cellReserve({ tenants: 0, maxTenants: 50 })).toBe(DEFAULT_CELL_RESERVE)
    expect(admissionLimit({ tenants: 0, maxTenants: 50 })).toBe(49)
    expect(cellHeadroom({ tenants: 45, maxTenants: 50 })).toBe(4)

    // A cell that can hold one tenant has nothing to hold back. Applying the
    // default there would make it admit nobody — a fleet-wide capacity change
    // wearing a default's clothes.
    expect(cellReserve({ tenants: 0, maxTenants: 1 })).toBe(0)
    expect(admissionLimit({ tenants: 0, maxTenants: 1 })).toBe(1)
  })

  it("uses an explicit reserve exactly as written", () => {
    expect(cellReserve({ tenants: 0, maxTenants: 50, reserve: 5 })).toBe(5)
    expect(admissionLimit({ tenants: 0, maxTenants: 50, reserve: 5 })).toBe(45)
    // Including zero, which is a real choice: a disposable staging cell may
    // legitimately be filled to the last slot.
    expect(cellReserve({ tenants: 0, maxTenants: 50, reserve: 0 })).toBe(0)
    expect(admissionLimit({ tenants: 0, maxTenants: 50, reserve: 0 })).toBe(50)
  })

  it("never reports negative headroom for an over-full cell", () => {
    // Capacity counts come from configuration and can drift past the limit.
    // A negative here would sum into a fleet headroom that reads as room.
    expect(cellHeadroom({ tenants: 60, maxTenants: 50 })).toBe(0)
  })

  it("warns at four fifths by default, and at the threshold rather than past it", () => {
    expect(warnThreshold({ tenants: 0, maxTenants: 50 })).toBe(40)
    expect(warnThreshold({ tenants: 0, maxTenants: 50, warnAt: 30 })).toBe(30)

    // At, not past. A threshold of 40 that fires at 41 is a threshold of 41
    // written down wrong, and the difference is a cell's worth of lead time.
    expect(isCellHot({ tenants: 39, maxTenants: 50 })).toBe(false)
    expect(isCellHot({ tenants: 40, maxTenants: 50 })).toBe(true)
  })

  it("refuses a reserve or a threshold that means something impossible", () => {
    const problems = (capacity: CellRecord["capacity"]) =>
      validateCellRecord(cell({ capacity })).map((p) => p.field)

    // A reserve that consumes the cell admits nobody. That is DRAINING, said
    // explicitly — not a capacity number that happens to work out to zero.
    expect(problems({ tenants: 0, maxTenants: 50, reserve: 50 })).toContain("capacity.reserve")
    expect(problems({ tenants: 0, maxTenants: 50, reserve: -1 })).toContain("capacity.reserve")
    // A threshold above the limit never fires, and never firing looks exactly
    // like never being hot.
    expect(problems({ tenants: 0, maxTenants: 50, warnAt: 51 })).toContain("capacity.warnAt")
    expect(problems({ tenants: 0, maxTenants: 50, warnAt: 0 })).toContain("capacity.warnAt")

    expect(validateCellRecord(cell({ capacity: { tenants: 0, maxTenants: 50, reserve: 49, warnAt: 50 } }))).toEqual([])
  })
})

describe("admission stops before exhaustion", () => {
  it("refuses the last reserved slot, and says that is what happened", () => {
    // 49 of 50 with a reserve of one. There IS a slot. Onboarding may not have
    // it — that slot belongs to a tenant migrating in off a failing cell.
    const decision = choosePlacement(
      [cell({ capacity: { tenants: 49, maxTenants: 50 } })],
      PROD_TENANT,
    )
    expect(decision.cellId).toBeNull()
    expect(decision.reason).toBe("no-headroom")
    // The gap between the two counts is the reserve, visible. Without it an
    // operator reads "no room" against a console showing 49/50 and stops
    // believing one of the two.
    expect(decision.considered.withCapacity).toBe(1)
    expect(decision.considered.withHeadroom).toBe(0)
    expect(decision.admission.admits).toBe(false)
    expect(decision.admission.headroom).toBe(0)
  })

  it("distinguishes holding the last slots back from having none", () => {
    const at = (tenants: number) =>
      choosePlacement([cell({ capacity: { tenants, maxTenants: 50 } })], PROD_TENANT).reason

    expect(at(48)).toBe("placed")
    expect(at(49)).toBe("no-headroom")
    expect(at(50)).toBe("no-capacity")
  })

  it("admits into the reserve when the cell says its reserve is zero", () => {
    // The reserve is a fleet policy with a default, not a law. A cell that
    // declares none is filled to the last slot.
    const decision = choosePlacement(
      [cell({ capacity: { tenants: 49, maxTenants: 50, reserve: 0 } })],
      PROD_TENANT,
    )
    expect(decision.reason).toBe("placed")
    expect(decision.admission.headroom).toBe(1)
  })

  it("never places into a cell it has no headroom for", () => {
    // The property, across the whole boundary: whatever else the decision says,
    // the cell it names must have room to spare after taking this tenant.
    for (let tenants = 0; tenants <= 50; tenants++) {
      const fleet = [cell({ capacity: { tenants, maxTenants: 50 } })]
      const decision = choosePlacement(fleet, PROD_TENANT)
      if (decision.cellId === null) continue
      const chosen = fleet.find((c) => c.cellId === decision.cellId)!
      expect(cellHeadroom(chosen.capacity)).toBeGreaterThan(0)
      expect(chosen.capacity.tenants + 1).toBeLessThanOrEqual(admissionLimit(chosen.capacity))
    }
  })
})

describe("the fleet says what to do about its capacity", () => {
  const recommendation = (cells: readonly CellRecord[], tenant = PROD_TENANT) =>
    choosePlacement(cells, tenant).admission.recommendation

  it("recommends nothing while there is room to spare", () => {
    expect(recommendation([cell({ capacity: { tenants: 3, maxTenants: 50 } })])).toBe("none")
  })

  it("recommends a new cell while it is still saying yes", () => {
    // The point of a threshold. 45 of 50 places successfully AND asks for a
    // cell, because building one is not a same-day operation and the refusal
    // is four tenants away.
    const decision = choosePlacement(
      [cell({ capacity: { tenants: 45, maxTenants: 50 } })],
      PROD_TENANT,
    )
    expect(decision.reason).toBe("placed")
    expect(decision.cellId).toBe("cell-use1-a")
    expect(decision.admission.recommendation).toBe("add-cell")
    expect(decision.admission.hot).toBe(1)
  })

  it("recommends rebalancing when the load is lopsided rather than large", () => {
    // Placement sends this tenant to the cold cell, which does nothing for the
    // hot one: placement only moves NEW tenants. Buying a cell here solves a
    // distribution problem with infrastructure.
    const decision = choosePlacement(
      [
        cell({ cellId: "cell-use1-a", capacity: { tenants: 45, maxTenants: 50 } }),
        cell({ cellId: "cell-use1-b", capacity: { tenants: 5, maxTenants: 50 } }),
      ],
      PROD_TENANT,
    )
    expect(decision.cellId).toBe("cell-use1-b")
    expect(decision.admission.recommendation).toBe("shard-cell")
    expect(decision.admission.hot).toBe(1)
    expect(decision.admission.headroom).toBe(4 + 44)
  })

  it("recommends a new cell once there is nothing cold left to rebalance into", () => {
    expect(
      recommendation([
        cell({ cellId: "cell-use1-a", capacity: { tenants: 45, maxTenants: 50 } }),
        cell({ cellId: "cell-use1-b", capacity: { tenants: 41, maxTenants: 50 } }),
      ]),
    ).toBe("add-cell")
  })

  it("recommends vending an account when a residency has no footprint at all", () => {
    // The estate is healthy. It just does not exist in eu-west-1, and the first
    // move there is an account, not a cell in an account Tenure does not have.
    const decision = choosePlacement([cell({})], {
      residency: ["eu-west-1"],
      environment: "production",
    })
    expect(decision.reason).toBe("no-cell-in-residency")
    expect(decision.admission.recommendation).toBe("vend-account")
  })

  it("does not recommend vending an account when nothing anywhere is healthy", () => {
    // Nothing to extend from. Vending an account would be the wrong first move
    // for a fleet whose problem is that it has no serving cells.
    expect(
      recommendation([cell({ health: "OFFLINE" })], {
        residency: ["eu-west-1"],
        environment: "production",
      }),
    ).toBe("add-cell")
    expect(recommendation([])).toBe("add-cell")
  })

  it("tells a wait apart from a build when nothing here is healthy", () => {
    // DEGRADED and UPGRADING clear on their own; recommending a cell for them
    // buys hardware for a transient.
    expect(recommendation([cell({ health: "DEGRADED" })])).toBe("none")
    expect(recommendation([cell({ health: "UPGRADING" })])).toBe("none")

    // DRAINING and OFFLINE do not clear. A residency whose only cells are being
    // emptied has no capacity here and will not grow any by waiting.
    expect(recommendation([cell({ health: "DRAINING" })])).toBe("add-cell")
    expect(recommendation([cell({ health: "OFFLINE" })])).toBe("add-cell")
    expect(
      recommendation([
        cell({ cellId: "cell-use1-a", health: "DRAINING" }),
        cell({ cellId: "cell-use1-b", health: "DEGRADED" }),
      ]),
    ).toBe("none")
  })

  it("never answers 'nothing to do' to a refusal that will not clear itself", () => {
    const refusals = [
      [cell({ capacity: { tenants: 49, maxTenants: 50 } })],
      [cell({ capacity: { tenants: 50, maxTenants: 50 } })],
      [cell({ health: "DRAINING" })],
      [cell({ health: "OFFLINE" })],
      [],
      // A threshold configured above the admission limit can never fire, so the
      // hot count stays zero while the fleet refuses. "Nothing to do" there
      // would be a lie about a fleet that is turning tenants away.
      [cell({ capacity: { tenants: 5, maxTenants: 10, reserve: 5, warnAt: 10 } })],
    ]
    for (const fleet of refusals) {
      const decision = choosePlacement(fleet, PROD_TENANT)
      expect(decision.cellId).toBeNull()
      expect(decision.admission.admits).toBe(false)
      expect(decision.admission.recommendation).not.toBe("none")
    }
  })

  it("says why, in words an operator can act on", () => {
    const hot = choosePlacement([cell({ capacity: { tenants: 45, maxTenants: 50 } })], PROD_TENANT)
    expect(hot.admission.detail).toContain("warn threshold")
    expect(hot.admission.detail).toContain("4 admissions left")

    const wait = choosePlacement([cell({ health: "UPGRADING" })], PROD_TENANT)
    expect(wait.admission.detail).toContain("clears on its own")
  })

  it("reaches the same recommendation whatever order the fleet is listed in", () => {
    const cells = [
      cell({ cellId: "cell-use1-c", capacity: { tenants: 45, maxTenants: 50 } }),
      cell({ cellId: "cell-use1-a", capacity: { tenants: 5, maxTenants: 50 } }),
      cell({ cellId: "cell-use1-b", capacity: { tenants: 44, maxTenants: 50 } }),
    ]
    expect(choosePlacement(cells, PROD_TENANT).admission).toEqual(
      choosePlacement([...cells].reverse(), PROD_TENANT).admission,
    )
  })
})
