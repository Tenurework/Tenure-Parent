import {
  choosePlacement,
  isCellServing,
  validateCellRecord,
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
    expect(decision).toEqual({
      cellId: null,
      reason: "no-cell-in-residency",
      considered: { inResidency: 0, healthy: 0, withCapacity: 0 },
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
    expect(full.considered).toEqual({ inResidency: 1, healthy: 1, withCapacity: 0 })
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
    expect(decision.considered).toEqual({ inResidency: 3, healthy: 3, withCapacity: 3 })
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
