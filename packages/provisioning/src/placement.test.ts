import { choosePlacement, type CellRecord } from "./cell-registry"
import {
  PLACEMENT_ADAPTERS,
  PLACEMENT_ADAPTER_TABLE,
  PLACEMENT_RESOURCES,
  adapterFor,
} from "./placement-adapters"
import {
  MIN_OVERRIDE_REASON,
  OVERRIDE_CHANGE_CLASS,
  OverrideRefused,
  applyOverride,
  overrideProblems,
  type OverrideApproval,
  type OverrideRequest,
} from "./placement-override"
import {
  GATES_ENFORCED_BY_ADMISSION,
  OVERRIDABLE_GATES,
  PLACEMENT_GATES,
  PLACEMENT_POLICY_VERSION,
  evaluateCell,
  evaluatePlacementPolicy,
  placementConfigVersion,
  type CellPlacementFacts,
  type PlacementGate,
  type PlacementRequest,
} from "./placement-policy"

/**
 * GE-101-001 / GE-101-002 / GE-101-003 — the placement policy, its five shapes,
 * and the override that may not waive a boundary.
 *
 * The assertions that matter most are the ones about `unverifiable`. A gate that
 * was demanded and could not be checked must not read as passing anywhere — not
 * in the verdict, not in eligibility, and not through an override.
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

const cell = (over: Partial<CellRecord> = {}): CellRecord => ({ ...CELL, ...over })

/** The minimum a caller can honestly declare: where the data may live, and the shape. */
const REQUEST: PlacementRequest = {
  tenantId: "t-simon",
  environment: "production",
  allowedRegions: ["us-east-1"],
  isolation: "pooled",
  requiredPartition: "aws",
}

const request = (over: Partial<PlacementRequest> = {}): PlacementRequest => ({
  ...REQUEST,
  ...over,
})

/** A cell that publishes nothing beyond its fleet record. */
const silent = (cellId = CELL.cellId): CellPlacementFacts => ({ cellId })

const gate = (
  result: ReturnType<typeof evaluateCell>,
  name: PlacementGate,
): { verdict: string; demanded: string; observed: string; overridable: boolean } => {
  const found = result.gates.find((g) => g.gate === name)
  if (!found) throw new Error(`no ${name} gate`)
  return found
}

describe("the eleven axes the Bible names each have a gate", () => {
  it("evaluates every named axis, once", () => {
    const result = evaluateCell(cell(), silent(), request())
    expect(result.gates.map((g) => g.gate)).toEqual([...PLACEMENT_GATES])
    expect(PLACEMENT_GATES).toHaveLength(11)
  })

  it("passes a placement whose declared demands the fleet actually meets", () => {
    const result = evaluateCell(cell(), silent(), request())
    expect(gate(result, "partition").verdict).toBe("pass")
    expect(gate(result, "allowed-regions").verdict).toBe("pass")
    expect(gate(result, "capacity").verdict).toBe("pass")
    expect(gate(result, "isolation-tier").verdict).toBe("pass")
    expect(result.eligible).toBe(true)
    expect(result.blocking).toEqual([])
  })

  it("refuses a cell in another partition", () => {
    const result = evaluateCell(cell({ partition: "aws-us-gov" }), silent(), request())
    expect(gate(result, "partition").verdict).toBe("fail")
    expect(result.eligible).toBe(false)
  })

  it("refuses a cell whose region is outside the allowlist", () => {
    const result = evaluateCell(
      cell({ region: "eu-west-1", residencyZones: ["eu-west-1"] }),
      silent(),
      request(),
    )
    expect(gate(result, "allowed-regions").verdict).toBe("fail")
  })

  it("reports a residency refusal without narrowing on it, because admission says it better", () => {
    // The gate is evaluated and explained; eligibility is left to
    // choosePlacement, which distinguishes 'no cell in your residency' from
    // 'every cell is full'.
    const result = evaluateCell(
      cell({ region: "eu-west-1", residencyZones: ["eu-west-1"] }),
      silent(),
      request(),
    )
    expect(result.reported).toContain("allowed-regions")
    expect(result.blocking).not.toContain("allowed-regions")
    expect(result.eligible).toBe(true)
    expect(GATES_ENFORCED_BY_ADMISSION).toEqual(["capacity", "allowed-regions"])
  })

  it("reads an empty allowlist as undeclared, never as 'anywhere'", () => {
    const result = evaluateCell(cell(), silent(), request({ allowedRegions: [] }))
    expect(gate(result, "allowed-regions").verdict).toBe("not-demanded")
    // And choosePlacement still refuses it, which is the point of leaving the
    // refusal there: an empty allowlist places nothing.
    expect(
      choosePlacement([cell()], { residency: [], environment: "production" }).cellId,
    ).toBeNull()
  })

  it("refuses a cell with no headroom on the capacity axis", () => {
    const full = cell({ capacity: { tenants: 50, maxTenants: 50 } })
    expect(gate(evaluateCell(full, silent(), request()), "capacity").verdict).toBe("fail")
  })
})

describe("a gate that could not be checked is not a gate that passed", () => {
  it("says unverifiable when a latency budget has no origin region to measure from", () => {
    const result = evaluateCell(cell(), silent(), request({ latencyBudgetMs: 120 }))
    expect(gate(result, "latency").verdict).toBe("unverifiable")
    expect(gate(result, "latency").observed).toMatch(/names no region the users are in/)
    expect(result.eligible).toBe(false)
  })

  it("says unverifiable when the cell publishes no measurement from that origin", () => {
    const facts: CellPlacementFacts = {
      cellId: CELL.cellId,
      latencyMsByOriginRegion: { "eu-west-1": 22 },
    }
    const result = evaluateCell(
      cell(),
      facts,
      request({ latencyBudgetMs: 120, primaryUserRegion: "us-east-1" }),
    )
    expect(gate(result, "latency").verdict).toBe("unverifiable")
  })

  it("compares the measurement when there is one", () => {
    const facts: CellPlacementFacts = {
      cellId: CELL.cellId,
      latencyMsByOriginRegion: { "us-east-1": 118 },
    }
    const near = request({ latencyBudgetMs: 120, primaryUserRegion: "us-east-1" })
    expect(gate(evaluateCell(cell(), facts, near), "latency").verdict).toBe("pass")
    expect(
      gate(evaluateCell(cell(), facts, { ...near, latencyBudgetMs: 100 }), "latency").verdict,
    ).toBe("fail")
  })

  it("tells 'certified for nothing' apart from 'publishes no certifications'", () => {
    const demand = request({ dataClasses: ["student-record"] })

    const unpublished = evaluateCell(cell(), { cellId: CELL.cellId }, demand)
    expect(gate(unpublished, "classification").verdict).toBe("unverifiable")

    const publishedEmpty = evaluateCell(
      cell(),
      { cellId: CELL.cellId, certifiedDataClasses: [] },
      demand,
    )
    expect(gate(publishedEmpty, "classification").verdict).toBe("fail")

    const certified = evaluateCell(
      cell(),
      { cellId: CELL.cellId, certifiedDataClasses: ["student-record", "hr"] },
      demand,
    )
    expect(gate(certified, "classification").verdict).toBe("pass")
  })

  it("tells an unattested regulation apart from an unpublished attestation list", () => {
    const demand = request({ regulations: ["FERPA"] })
    expect(gate(evaluateCell(cell(), silent(), demand), "regulation").verdict).toBe("unverifiable")
    expect(
      gate(
        evaluateCell(cell(), { cellId: CELL.cellId, attestedRegulations: ["SOC2"] }, demand),
        "regulation",
      ).verdict,
    ).toBe("fail")
    expect(
      gate(
        evaluateCell(cell(), { cellId: CELL.cellId, attestedRegulations: ["FERPA"] }, demand),
        "regulation",
      ).verdict,
    ).toBe("pass")
  })

  it("refuses to compare a cost ceiling against a figure in another currency", () => {
    const demand = request({ costCeilingMinor: 40_000, costCurrency: "USD" })
    const eur: CellPlacementFacts = {
      cellId: CELL.cellId,
      marginalTenantCostMinor: 30_000,
      costCurrency: "EUR",
    }
    // 30,000 is under 40,000 as a number and means nothing as money.
    expect(gate(evaluateCell(cell(), eur, demand), "cost").verdict).toBe("unverifiable")
    expect(
      gate(
        evaluateCell(cell(), { ...eur, costCurrency: "USD" }, demand),
        "cost",
      ).verdict,
    ).toBe("pass")
  })

  it("says unverifiable rather than pass when no marginal cost is published", () => {
    const demand = request({ costCeilingMinor: 40_000, costCurrency: "USD" })
    expect(gate(evaluateCell(cell(), silent(), demand), "cost").verdict).toBe("unverifiable")
  })

  it("compares both halves of a recovery objective", () => {
    const facts: CellPlacementFacts = { cellId: CELL.cellId, dr: { rpoMinutes: 5, rtoMinutes: 60 } }
    expect(
      gate(evaluateCell(cell(), facts, request({ dr: { rpoMinutes: 5, rtoMinutes: 60 } })), "dr")
        .verdict,
    ).toBe("pass")
    // RPO fine, RTO too slow. One axis passing is not the gate passing.
    expect(
      gate(evaluateCell(cell(), facts, request({ dr: { rpoMinutes: 5, rtoMinutes: 30 } })), "dr")
        .verdict,
    ).toBe("fail")
    expect(gate(evaluateCell(cell(), silent(), request({ dr: { rpoMinutes: 5, rtoMinutes: 60 } })), "dr").verdict).toBe(
      "unverifiable",
    )
  })

  it("checks key custody and the region the key is held in separately", () => {
    const facts: CellPlacementFacts = {
      cellId: CELL.cellId,
      kms: { customerManagedKeySupported: true, keyRegion: "us-east-1" },
    }
    expect(
      gate(evaluateCell(cell(), facts, request({ kms: { customerManagedKey: true } })), "kms").verdict,
    ).toBe("pass")
    expect(
      gate(
        evaluateCell(
          cell(),
          facts,
          request({ kms: { customerManagedKey: true, keyRegion: "eu-west-1" } }),
        ),
        "kms",
      ).verdict,
    ).toBe("fail")
    expect(
      gate(
        evaluateCell(
          cell(),
          { cellId: CELL.cellId, kms: { customerManagedKeySupported: false, keyRegion: "us-east-1" } },
          request({ kms: { customerManagedKey: true } }),
        ),
        "kms",
      ).verdict,
    ).toBe("fail")
  })

  it("needs both a service list and a model list before it will judge either", () => {
    const demand = request({ requiredServices: ["bedrock"], requiredModels: ["claude-sonnet"] })
    const servicesOnly: CellPlacementFacts = { cellId: CELL.cellId, availableServices: ["bedrock"] }
    expect(gate(evaluateCell(cell(), servicesOnly, demand), "service-availability").verdict).toBe(
      "unverifiable",
    )
    expect(
      gate(
        evaluateCell(
          cell(),
          { ...servicesOnly, availableModels: ["claude-sonnet"] },
          demand,
        ),
        "service-availability",
      ).verdict,
    ).toBe("pass")
    expect(
      gate(
        evaluateCell(cell(), { ...servicesOnly, availableModels: [] }, demand),
        "service-availability",
      ).verdict,
    ).toBe("fail")
  })

  it("asks nothing of an axis the placement declared nothing on", () => {
    const result = evaluateCell(cell(), silent(), request())
    const quiet = result.gates.filter((g) => g.verdict === "not-demanded").map((g) => g.gate)
    expect(quiet).toEqual([
      "latency",
      "classification",
      "regulation",
      "service-availability",
      "kms",
      "dr",
      "cost",
    ])
  })
})

describe("the five shapes are one contract", () => {
  it("names all five and resolves each to one adapter", () => {
    expect(PLACEMENT_ADAPTERS).toEqual([
      "pooled",
      "bridge",
      "silo",
      "dedicated-account",
      "regional-sovereign",
    ])
    for (const id of PLACEMENT_ADAPTERS) {
      expect(PLACEMENT_ADAPTER_TABLE[id].id).toBe(id)
    }
  })

  it("plans a different amount of dedicated infrastructure per shape", () => {
    const shared = (id: (typeof PLACEMENT_ADAPTERS)[number]) =>
      PLACEMENT_ADAPTER_TABLE[id].resources.filter((r) => r.sharing === "shared-cell").length
    expect(shared("pooled")).toBe(PLACEMENT_ADAPTER_TABLE.pooled.resources.length)
    // Bridge keeps the cluster and the identity pool shared, deliberately.
    expect(shared("bridge")).toBe(2)
    expect(shared("silo")).toBe(0)
    expect(shared("dedicated-account")).toBe(0)
  })

  it("only vends an account for the shapes that are an account", () => {
    expect(PLACEMENT_ADAPTER_TABLE.pooled.requiresDedicatedAccount).toBe(false)
    expect(PLACEMENT_ADAPTER_TABLE.bridge.requiresDedicatedAccount).toBe(false)
    expect(PLACEMENT_ADAPTER_TABLE.silo.requiresDedicatedAccount).toBe(false)
    expect(PLACEMENT_ADAPTER_TABLE["dedicated-account"].requiresDedicatedAccount).toBe(true)
    expect(PLACEMENT_ADAPTER_TABLE["regional-sovereign"].requiresDedicatedAccount).toBe(true)
    expect(
      PLACEMENT_ADAPTER_TABLE["dedicated-account"].resources.map((r) => r.resource),
    ).toContain("account")
    expect(PLACEMENT_ADAPTER_TABLE.silo.resources.map((r) => r.resource)).not.toContain("account")
    expect(PLACEMENT_RESOURCES).toContain("account")
  })

  it("selects the sovereign shape over the tier when sovereignty is declared", () => {
    expect(adapterFor({ isolation: "pooled" }).id).toBe("pooled")
    expect(adapterFor({ isolation: "silo" }).id).toBe("silo")
    expect(adapterFor({ isolation: "pooled", sovereign: true }).id).toBe("regional-sovereign")
  })

  it("serves a pooled tenant on a cell that publishes nothing, because every cell is shared", () => {
    const result = evaluateCell(cell(), silent(), request({ isolation: "pooled" }))
    expect(gate(result, "isolation-tier").verdict).toBe("pass")
  })

  it("refuses a silo tenant on a fleet that does not say it can provide one", () => {
    const result = evaluateCell(cell(), silent(), request({ isolation: "silo" }))
    expect(gate(result, "isolation-tier").verdict).toBe("unverifiable")
    // Its own key is in the shape's resource plan, so the demand is derived
    // from the plan rather than reported as something the operator forgot.
    // The cell says nothing about key custody, so it cannot be checked.
    expect(gate(result, "kms").verdict).toBe("unverifiable")
    expect(gate(result, "kms").demanded).toMatch(/customer-managed key/)
    expect(result.eligible).toBe(false)
  })

  it("does not derive a recovery objective from a shape, because no shape implies a number", () => {
    const sovereign = request({ isolation: "dedicated-account", sovereign: true })
    const result = evaluateCell(cell(), silent(), sovereign)
    expect(gate(result, "dr").verdict).toBe("fail")
    expect(gate(result, "dr").observed).toMatch(/declares none/)
    // Same for the region allowlist a sovereign placement has to name.
    expect(gate(evaluateCell(cell(), silent(), { ...sovereign, allowedRegions: [] }), "allowed-regions").verdict).toBe(
      "fail",
    )
  })

  it("places a silo tenant once the cell publishes the shape and the key", () => {
    const facts: CellPlacementFacts = {
      cellId: CELL.cellId,
      isolationClasses: ["pooled", "bridge", "silo"],
      kms: { customerManagedKeySupported: true, keyRegion: "us-east-1" },
    }
    const result = evaluateCell(
      cell(),
      facts,
      request({ isolation: "silo", kms: { customerManagedKey: true } }),
    )
    expect(result.blocking).toEqual([])
    expect(result.eligible).toBe(true)
  })

  it("refuses a sovereign placement on a cell that does not say it is certified", () => {
    const facts: CellPlacementFacts = {
      cellId: CELL.cellId,
      isolationClasses: ["dedicated-account"],
      kms: { customerManagedKeySupported: true, keyRegion: "us-east-1" },
      dr: { rpoMinutes: 5, rtoMinutes: 30 },
    }
    const result = evaluateCell(
      cell(),
      facts,
      request({
        isolation: "dedicated-account",
        sovereign: true,
        kms: { customerManagedKey: true, keyRegion: "us-east-1" },
        dr: { rpoMinutes: 5, rtoMinutes: 30 },
      }),
    )
    expect(gate(result, "isolation-tier").verdict).toBe("unverifiable")
    expect(
      evaluateCell(
        cell(),
        { ...facts, sovereignCertified: true },
        request({
          isolation: "dedicated-account",
          sovereign: true,
          kms: { customerManagedKey: true, keyRegion: "us-east-1" },
          dr: { rpoMinutes: 5, rtoMinutes: 30 },
        }),
      ).eligible,
    ).toBe(true)
  })

  it("waives nothing for a sovereign placement", () => {
    const sovereign = request({ isolation: "dedicated-account", sovereign: true })
    const result = evaluateCell(cell({ capacity: { tenants: 50, maxTenants: 50 } }), silent(), sovereign)
    for (const g of result.gates) expect(g.overridable).toBe(false)
    // Where the same gates are waivable for every other shape.
    const pooled = evaluateCell(cell(), silent(), request())
    expect(pooled.gates.filter((g) => g.overridable).map((g) => g.gate)).toEqual([
      ...OVERRIDABLE_GATES,
    ].sort((a, b) => PLACEMENT_GATES.indexOf(a) - PLACEMENT_GATES.indexOf(b)))
  })
})

describe("a decision says which policy and which configuration produced it", () => {
  it("carries the policy version and a digest of what it read", () => {
    const decision = evaluatePlacementPolicy({
      cells: [cell()],
      facts: [silent()],
      request: request(),
    })
    expect(decision.policyVersion).toBe(PLACEMENT_POLICY_VERSION)
    expect(decision.configVersion).toMatch(/^[0-9a-f]{16}$/)
    expect(decision.adapter).toBe("pooled")
  })

  it("digests the same fleet to the same version whatever order it was listed in", () => {
    const a = cell({ cellId: "cell-use1-a" })
    const b = cell({ cellId: "cell-use1-b" })
    expect(placementConfigVersion([a, b], [silent("cell-use1-a"), silent("cell-use1-b")])).toBe(
      placementConfigVersion([b, a], [silent("cell-use1-b"), silent("cell-use1-a")]),
    )
  })

  it("changes the config version when a fact a decision depended on changes", () => {
    const before = placementConfigVersion([cell()], [{ cellId: CELL.cellId }])
    const after = placementConfigVersion(
      [cell()],
      [{ cellId: CELL.cellId, certifiedDataClasses: ["student-record"] }],
    )
    expect(after).not.toBe(before)
  })

  it("explains every gate that did not pass, on every cell, and says who enforces it", () => {
    const decision = evaluatePlacementPolicy({
      cells: [cell({ capacity: { tenants: 50, maxTenants: 50 } })],
      facts: [silent()],
      request: request({ latencyBudgetMs: 50, primaryUserRegion: "us-east-1" }),
    })
    expect(decision.explanation).toEqual([
      expect.stringContaining("latency could not be checked"),
      expect.stringContaining("capacity refused"),
    ])
    expect(decision.explanation.join("\n")).toContain("(enforced by fleet admission)")
    expect(decision.explanation.join("\n")).toContain("(waivable by approved override)")
  })

  it("leaves the choice to choosePlacement, over the cells it found eligible", () => {
    const good = cell({ cellId: "cell-use1-a" })
    const wrongPartition = cell({ cellId: "cell-use1-b", partition: "aws-us-gov" })
    const decision = evaluatePlacementPolicy({
      cells: [wrongPartition, good],
      facts: [silent("cell-use1-a"), silent("cell-use1-b")],
      request: request(),
    })
    expect(decision.eligibleCellIds).toEqual(["cell-use1-a"])
    const eligible = [wrongPartition, good].filter((c) =>
      decision.eligibleCellIds.includes(c.cellId),
    )
    expect(choosePlacement(eligible, { residency: ["us-east-1"], environment: "production" }).cellId).toBe(
      "cell-use1-a",
    )
  })

  it("treats a cell with no published facts as silent, not as failing", () => {
    const decision = evaluatePlacementPolicy({ cells: [cell()], facts: [], request: request() })
    expect(decision.eligibleCellIds).toEqual([CELL.cellId])
  })
})

describe("an operator override is approved, bounded and refused a boundary", () => {
  const blocked = () =>
    evaluatePlacementPolicy({
      cells: [cell()],
      facts: [{ cellId: CELL.cellId, marginalTenantCostMinor: 90_000, costCurrency: "USD" }],
      request: request({ costCeilingMinor: 40_000, costCurrency: "USD" }),
    })

  const OVERRIDE: OverrideRequest = {
    cellId: CELL.cellId,
    gates: ["cost"],
    requestedBy: "operator:ada",
    reason: "Migrating off cell-use1-c, which is DRAINING after the 2026-08-14 storage incident.",
    requestedAt: "2026-08-17T09:00:00.000Z",
    expiresAt: "2026-08-17T17:00:00.000Z",
  }
  const APPROVAL: OverrideApproval = {
    approvedBy: "operator:grace",
    approvedAt: "2026-08-17T09:05:00.000Z",
    typedConfirmation: CELL.cellId,
  }
  const NOW = "2026-08-17T09:06:00.000Z"

  it("is held to the change taxonomy's customer-visible class", () => {
    expect(OVERRIDE_CHANGE_CLASS).toBe("C6")
  })

  it("refuses the placement before the override, and allows it after", () => {
    const decision = blocked()
    expect(decision.eligibleCellIds).toEqual([])
    expect(decision.override).toBeNull()

    const overridden = applyOverride(decision, OVERRIDE, APPROVAL, NOW)
    expect(overridden.eligibleCellIds).toEqual([CELL.cellId])
    expect(overridden.override).toEqual({
      cellId: CELL.cellId,
      gates: ["cost"],
      requestedBy: "operator:ada",
      approvedBy: "operator:grace",
      approvedAt: APPROVAL.approvedAt,
      expiresAt: OVERRIDE.expiresAt,
      reason: OVERRIDE.reason,
    })
    // The un-overridden evaluation is the evidence for why it was needed.
    expect(decision.evaluations[0].blocking).toEqual(["cost"])
    expect(overridden.evaluations[0].gates.find((g) => g.gate === "cost")?.waived).toBe(true)
    expect(overridden.explanation.at(-1)).toContain("waived by operator:grace")
  })

  it("will not waive a gate that decides where the data lives", () => {
    const decision = evaluatePlacementPolicy({
      cells: [cell({ partition: "aws-us-gov" })],
      facts: [silent()],
      request: request(),
    })
    const problems = overrideProblems(
      decision,
      { ...OVERRIDE, gates: ["partition"] },
      APPROVAL,
      NOW,
    )
    expect(problems.map((p) => p.reason)).toEqual(["gate-not-overridable"])
    expect(() => applyOverride(decision, { ...OVERRIDE, gates: ["partition"] }, APPROVAL, NOW)).toThrow(
      OverrideRefused,
    )
  })

  it("will not waive a gate nobody could check", () => {
    const decision = evaluatePlacementPolicy({
      cells: [cell()],
      facts: [silent()],
      request: request({ costCeilingMinor: 40_000, costCurrency: "USD" }),
    })
    expect(decision.evaluations[0].unverifiable).toEqual(["cost"])
    const problems = overrideProblems(decision, OVERRIDE, APPROVAL, NOW)
    expect(problems.map((p) => p.reason)).toEqual(["gate-unverifiable"])
    expect(problems[0].detail).toMatch(/deciding not to find out/)
  })

  it("will not pre-authorize a gate that is not refusing anything", () => {
    const decision = evaluatePlacementPolicy({
      cells: [cell()],
      facts: [silent()],
      request: request(),
    })
    expect(
      overrideProblems(decision, { ...OVERRIDE, gates: ["latency"] }, APPROVAL, NOW).map(
        (p) => p.reason,
      ),
    ).toEqual(["gate-not-blocking"])
  })

  it("sends a capacity refusal back to admission rather than waiving it here", () => {
    const decision = evaluatePlacementPolicy({
      cells: [cell({ capacity: { tenants: 50, maxTenants: 50 } })],
      facts: [silent()],
      request: request(),
    })
    expect(
      overrideProblems(decision, { ...OVERRIDE, gates: ["capacity"] }, APPROVAL, NOW).map(
        (p) => p.reason,
      ),
    ).toEqual(["gate-enforced-by-admission"])
  })

  it("needs two people, the cell typed out, a reason and an expiry", () => {
    const decision = blocked()
    const reasons = (over: Partial<OverrideRequest>, ap: Partial<OverrideApproval> = {}, at = NOW) =>
      overrideProblems(decision, { ...OVERRIDE, ...over }, { ...APPROVAL, ...ap }, at).map(
        (p) => p.reason,
      )

    expect(reasons({}, { approvedBy: OVERRIDE.requestedBy })).toEqual(["self-approval"])
    expect(reasons({}, { typedConfirmation: "cell-use1-b" })).toEqual(["confirmation-mismatch"])
    expect(reasons({ reason: "needed" })).toEqual(["reason-too-short"])
    expect(reasons({ gates: [] })).toEqual(["no-gates"])
    expect(reasons({ cellId: "cell-nowhere" })).toContain("unknown-cell")
    // Expired: the clock is a parameter, so this is arithmetic and not timing.
    expect(reasons({}, {}, "2026-08-17T17:00:00.000Z")).toEqual(["expired"])
    expect(reasons({ expiresAt: OVERRIDE.requestedAt })).toContain("expiry-before-request")
    expect(reasons({})).toEqual([])
  })

  it("reports every problem at once rather than one per attempt", () => {
    const decision = evaluatePlacementPolicy({
      cells: [cell({ partition: "aws-us-gov" })],
      facts: [{ cellId: CELL.cellId, marginalTenantCostMinor: 90_000, costCurrency: "USD" }],
      request: request({ costCeilingMinor: 40_000, costCurrency: "USD" }),
    })
    const problems = overrideProblems(
      decision,
      { ...OVERRIDE, reason: "ok", gates: ["partition"] },
      { ...APPROVAL, approvedBy: OVERRIDE.requestedBy },
      NOW,
    )
    expect(problems.map((p) => p.reason).sort()).toEqual([
      "gate-not-overridable",
      "reason-too-short",
      "self-approval",
    ])
  })

  it("never echoes what the approver typed", () => {
    const decision = blocked()
    const problems = overrideProblems(
      decision,
      OVERRIDE,
      { ...APPROVAL, typedConfirmation: "cell-production-secret" },
      NOW,
    )
    expect(JSON.stringify(problems)).not.toContain("cell-production-secret")
  })

  it("keeps the reason a minimum length rather than a shape", () => {
    expect(MIN_OVERRIDE_REASON).toBe(20)
  })
})
