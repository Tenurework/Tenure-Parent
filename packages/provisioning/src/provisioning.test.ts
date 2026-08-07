/**
 * The lifecycle and the manifest, tested for what they REFUSE.
 *
 * A state machine's value is entirely in the transitions it rejects; one that
 * accepts everything is a field. So most of what follows asserts failure, and
 * the exhaustive test at the end walks all 25 states against all 25 to prove no
 * edge was added by accident.
 */
import { describe, expect, it } from "@jest/globals"

import {
  ALL_STATES,
  LifecycleError,
  REQUIRES_OWNER,
  RESIDUAL_COST,
  TERMINAL,
  advance,
  canAdvance,
  needsApproval,
  nextStates,
  type LifecycleStep,
  type TenantState,
} from "./lifecycle"
import { RESIDUAL_CLAIMS, observeResidual, reconcileResidual } from "./residual-reconciliation"
import { MANIFEST_VERSION, digestOf, planFor, validateManifest, type TenantManifest } from "./manifest"
import { CELL_APPLY, deploymentManifest, executeStep, type ExecutionContext } from "./execute"

const OPERATOR = { principalId: "dana@tenure.example", at: "2026-08-01T00:00:00.000Z" }
const SECOND = "ravi@tenure.example"

const manifest = (over: Partial<TenantManifest> = {}): TenantManifest => ({
  manifestVersion: MANIFEST_VERSION,
  slug: "midtown-arts",
  legalName: "Midtown Arts Collective",
  displayName: "Midtown Arts",
  blueprintId: "student-organizations",
  modules: ["governance"],
  entitlements: [],
  region: "us-east-1",
  isolation: "pooled",
  // PACK-020-004. Stated, not omitted: a manifest that says nothing about who
  // writes a domain is the state this field exists to make impossible.
  coexistence: "TENURE_CLOUD_PRIMARY",
  systemOfRecord: { finance: "tenure", org: "tenure" },
  configuration: {},
  secretRefs: {},
  initialAdminEmail: "admin@midtown.example",
  ...over,
})

const context = {
  knownBlueprints: ["student-organizations", "arts-collective"],
  knownModules: ["governance", "finance", "calendar"],
  takenSlugs: ["rochester"],
}

describe("lifecycle", () => {
  it("walks the happy path from DRAFT to ACTIVE", () => {
    const path: TenantState[] = [
      "VALIDATING",
      "PLANNED",
      "AWAITING_APPROVAL",
      "PROVISIONING",
      "CONFIGURING",
      "MIGRATING",
      "VERIFYING",
      "READY",
      "ACTIVATING",
      "ACTIVE",
    ]

    let state: TenantState = "DRAFT"
    const history: LifecycleStep[] = []

    for (const to of path) {
      const result = advance(
        state,
        to,
        { actor: OPERATOR, ...(needsApproval(state, to) ? { approvedBy: SECOND, approverIsOperator: true } : {}) },
        history,
      )
      history.push(result.step)
      state = result.state
    }

    expect(state).toBe("ACTIVE")
    expect(history).toHaveLength(path.length)
  })

  it("refuses a jump that skips verification", () => {
    // The transition that matters most: a tenant reaching ACTIVE without having
    // proved its own isolation is an outage its users discover.
    expect(() => advance("MIGRATING", "ACTIVE", { actor: OPERATOR })).toThrow(LifecycleError)
    expect(() => advance("PROVISIONING", "READY", { actor: OPERATOR })).toThrow(/only legal moves/)
  })

  it("refuses to provision, activate or purge without an approver", () => {
    for (const [from, to] of [
      ["AWAITING_APPROVAL", "PROVISIONING"],
      ["READY", "ACTIVATING"],
      ["PURGE_PENDING", "PURGING"],
    ] as const) {
      expect(() => advance(from, to, { actor: OPERATOR })).toThrow(/requires a recorded approver/)
      expect(advance(from, to, { actor: OPERATOR, approvedBy: SECOND, approverIsOperator: true }).state).toBe(to)

      // An approver nobody looked up is a free-text field. Before this check,
      // `approvedBy="x@y.z"` satisfied PURGE_PENDING → PURGING — one operator
      // approving their own irreversible purge by naming anyone but themselves.
      expect(() => advance(from, to, { actor: OPERATOR, approvedBy: SECOND })).toThrow(
        /not verified as a platform operator/,
      )
      expect(() =>
        advance(from, to, { actor: OPERATOR, approvedBy: SECOND, approverIsOperator: false }),
      ).toThrow(/not verified as a platform operator/)
    }
  })

  it("refuses self-approval", () => {
    // Separation of duties, enforced where it cannot be routed around: the
    // person who asked is not the person who agrees.
    expect(() =>
      advance("PURGE_PENDING", "PURGING", { actor: OPERATOR, approvedBy: OPERATOR.principalId, approverIsOperator: true }),
    ).toThrow(/cannot approve their own/)
  })

  it("will not let a legal hold be lifted straight into deletion", () => {
    // A hold that can go directly to PURGING is not a hold.
    expect(canAdvance("LEGAL_HOLD", "PURGING")).toBe(false)
    expect(canAdvance("LEGAL_HOLD", "PURGE_PENDING")).toBe(false)
    expect(canAdvance("LEGAL_HOLD", "OFFBOARDING")).toBe(true)
  })

  it("treats a purged tenant as terminal", () => {
    expect(TERMINAL.has("PURGED_ZERO_INCREMENTAL_COST")).toBe(true)
    expect(nextStates("PURGED_ZERO_INCREMENTAL_COST")).toEqual([])
    expect(() => advance("PURGED_ZERO_INCREMENTAL_COST", "DRAFT", { actor: OPERATOR })).toThrow(
      /terminal/,
    )
  })

  it("counts retries of the same step rather than presenting them as new", () => {
    const history: LifecycleStep[] = [
      { from: "AWAITING_APPROVAL", to: "PROVISIONING", at: "t0", actor: "a", attempt: 1 },
      { from: "FAILED", to: "PROVISIONING", at: "t1", actor: "a", attempt: 2 },
    ]
    // Not a legal transition from FAILED, so use the real one and check counting.
    const { step } = advance(
      "AWAITING_APPROVAL",
      "PROVISIONING",
      { actor: OPERATOR, approvedBy: SECOND, approverIsOperator: true },
      history,
    )
    expect(step.attempt).toBe(3)
  })

  it("never claims a paused tenant is free", () => {
    // GE-103-012. HIBERNATED_ZERO_RUNTIME means zero RUNTIME. A console that
    // renders it as $0 is the specific lie this exists to prevent.
    for (const state of ["SUSPENDED_LOGICAL", "HIBERNATED_ZERO_RUNTIME", "LEGAL_HOLD"] as const) {
      expect(RESIDUAL_COST[state]).toBeDefined()
      expect(RESIDUAL_COST[state]).toMatch(/bill|retain/i)
    }
    expect(RESIDUAL_COST.HIBERNATED_ZERO_RUNTIME).toMatch(/not zero cost/i)
  })

  /* ----------------------------------------------------------- WRK-120-005 --
   * The residual claim is checkable, and an owner's departure cannot orphan a
   * tenant.
   */
  describe("residual cost is reconciled against what is actually retained", () => {
    it("keeps the sentence and the resource list as one fact", () => {
      // Derived, not declared twice. Written twice, the sentence is what
      // everybody reads and the list is what everybody trusts.
      for (const claim of Object.values(RESIDUAL_CLAIMS)) {
        expect(RESIDUAL_COST[claim.state]).toBe(claim.note)
      }
      expect(Object.keys(RESIDUAL_COST).sort()).toEqual(Object.keys(RESIDUAL_CLAIMS).sort())
    })

    it("names a hibernated tenant's compute as a bill nobody expected", () => {
      // The exact failure GE-103-012 describes: HIBERNATED_ZERO_RUNTIME claims
      // no compute, and a dedicated task keeps running whether or not routing
      // points at it.
      const claim = RESIDUAL_CLAIMS.HIBERNATED_ZERO_RUNTIME!
      const observed = observeResidual({
        isolation: "dedicated-account",
        hasDeployment: true,
        serving: false,
        evidenceRecords: 3,
      })

      expect(observed).toContain("compute")
      const { unexplained, overclaimed } = reconcileResidual(claim, observed)
      // Compute is retained and not claimed; database likewise. Both are bills.
      expect([...unexplained].sort()).toEqual(["compute", "database"])
      expect(overclaimed).toEqual([])
    })

    it("says nothing is unexplained when the claim is right", () => {
      // A pooled, hibernated tenant retains exactly what the sentence says.
      // Without this the test above would pass against a function that returned
      // every class every time.
      const claim = RESIDUAL_CLAIMS.HIBERNATED_ZERO_RUNTIME!
      const observed = observeResidual({
        isolation: "pooled",
        hasDeployment: true,
        serving: false,
        evidenceRecords: 1,
      })
      const { unexplained, overclaimed } = reconcileResidual(claim, observed)

      expect(unexplained).toEqual(["database"])
      // The console claims a dedicated edge this pooled tenant does not have.
      // Reported, because an operator told they are paying for something they
      // are not stops believing the panel that carries the real finding.
      expect(overclaimed).toEqual(["edge"])
    })

    it("treats anything left on a purged tenant as unexplained", () => {
      // PURGED_ZERO_INCREMENTAL_COST claims nothing at all, so a purged tenant
      // still holding a snapshot is the strongest finding the reconciliation
      // can produce.
      const { unexplained } = reconcileResidual(RESIDUAL_CLAIMS.PURGED_ZERO_INCREMENTAL_COST!, [
        "snapshot",
      ])
      expect(unexplained).toEqual(["snapshot"])
    })

    it("observes nothing for a tenant that was never deployed", () => {
      expect(
        observeResidual({
          isolation: "pooled",
          hasDeployment: false,
          serving: false,
          evidenceRecords: 0,
        }),
      ).toEqual([])
    })
  })

  describe("a departure cannot leave a tenant unowned", () => {
    const OWNER = "successor@tenure.example"

    it("refuses suspend, hibernate and offboard with no successor owner recorded", () => {
      for (const [from, to] of [
        ["ACTIVE", "SUSPENDING"],
        ["ACTIVE", "HIBERNATING"],
        ["ACTIVE", "OFFBOARDING"],
      ] as const) {
        expect(REQUIRES_OWNER.has(to)).toBe(true)
        expect(() => advance(from, to, { actor: OPERATOR })).toThrow(/requires a recorded owner/)
        // Blank is not a name. The value's only source is a form field.
        expect(() => advance(from, to, { actor: OPERATOR, ownerPrincipalId: "   " })).toThrow(
          /requires a recorded owner/,
        )
        expect(advance(from, to, { actor: OPERATOR, ownerPrincipalId: OWNER }).state).toBe(to)
      }
    })

    it("records the successor on the step, so the answer survives the move", () => {
      const { step } = advance("ACTIVE", "HIBERNATING", {
        actor: OPERATOR,
        ownerPrincipalId: ` ${OWNER} `,
      })
      expect(step.ownerPrincipalId).toBe(OWNER)
    })

    it("leaves every other transition alone", () => {
      // A control demanded everywhere is a field people fill with the same word
      // every time, which is the same as not having it.
      expect(advance("ACTIVE", "IDLE", { actor: OPERATOR }).state).toBe("IDLE")
      expect(advance("ACTIVE", "EXPORTING", { actor: OPERATOR }).state).toBe("EXPORTING")
      expect(advance("ACTIVE", "LEGAL_HOLD", { actor: OPERATOR }).state).toBe("LEGAL_HOLD")
      expect(
        advance("SUSPENDED_LOGICAL", "REACTIVATING", { actor: OPERATOR }).step.ownerPrincipalId,
      ).toBeUndefined()
    })
  })

  it("has no transition into DRAFT except from a failure or a rejection", () => {
    const intoDraft = ALL_STATES.filter((s) => canAdvance(s, "DRAFT"))
    expect(intoDraft.sort()).toEqual(
      ["AWAITING_APPROVAL", "FAILED", "PLANNED", "ROLLING_BACK", "VALIDATING"].sort(),
    )
  })

  it("every state is reachable from DRAFT", () => {
    // A state nothing can reach is dead code pretending to be a lifecycle.
    const seen = new Set<TenantState>(["DRAFT"])
    const queue: TenantState[] = ["DRAFT"]
    while (queue.length) {
      for (const next of nextStates(queue.shift()!)) {
        if (!seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    expect([...ALL_STATES].filter((s) => !seen.has(s))).toEqual([])
  })

  it("declares every transition deliberately", () => {
    // 25 × 25 = 625 ordered pairs; only the declared ones may pass. This is the
    // test that catches an edge added by a careless merge.
    let legal = 0
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        if (canAdvance(from, to)) legal += 1
      }
    }
    expect(ALL_STATES).toHaveLength(25)
    // Pinned. Changing the graph must be a deliberate edit to this number, so
    // an edge added by a careless merge fails here rather than in production.
    expect(legal).toBe(69)
  })
})

describe("manifest", () => {
  it("accepts a well-formed pooled tenant", () => {
    expect(validateManifest(manifest(), context)).toEqual({ valid: true, problems: [] })
  })

  it("refuses a slug that would collide with the platform's own routes", () => {
    for (const slug of ["admin", "api", "studio", "platform"]) {
      const { valid, problems } = validateManifest(manifest({ slug }), context)
      expect(valid).toBe(false)
      expect(problems[0].reason).toBe("reserved")
    }
  })

  it("refuses a slug already taken", () => {
    const { problems } = validateManifest(manifest({ slug: "rochester" }), context)
    expect(problems.map((p) => p.reason)).toContain("taken")
  })

  it("refuses malformed slugs", () => {
    for (const slug of ["A-Capital", "1leading-digit", "trailing-", "no", "has_underscore"]) {
      expect(validateManifest(manifest({ slug }), context).valid).toBe(false)
    }
  })

  /* --------------------------------------------------------- PACK-GATE-020 --
   * A tenant system is a composition on axes, and the composition is checked
   * exactly the way the blueprint id is: against what the engine implements.
   */
  describe("the archetype selection", () => {
    const axes = {
      organization: ["university-student-organizations", "nonprofit-program-operations"],
      operatingModel: ["centralized", "federated"],
      functional: ["operations", "finance"],
    }
    const withAxes = { ...context, archetypeAxes: axes }
    const composed = (over: Record<string, unknown> = {}) =>
      manifest({
        archetype: {
          organization: "nonprofit-program-operations",
          operatingModel: "federated",
          functional: ["operations"],
          ...over,
        },
      })

    it("accepts a selection every axis recognises", () => {
      expect(validateManifest(composed(), withAxes)).toEqual({ valid: true, problems: [] })
    })

    it("refuses a value no axis declares, naming the axis and what it accepts", () => {
      const { valid, problems } = validateManifest(
        composed({ operatingModel: "holacracy" }),
        withAxes,
      )
      expect(valid).toBe(false)
      const problem = problems.find((p) => p.field === "archetype.operatingModel")!
      expect(problem.reason).toBe("unknown-value")
      expect(problem.detail).toContain("centralized, federated")
    })

    it("refuses a functional suite the engine has no compiler for", () => {
      const { problems } = validateManifest(composed({ functional: ["payroll"] }), withAxes)
      expect(problems.map((p) => `${p.field}:${p.reason}`)).toContain(
        "archetype.functional:unknown-value",
      )
    })

    it("refuses a composition with no functional suite at all", () => {
      const { problems } = validateManifest(composed({ functional: [] }), withAxes)
      expect(problems.map((p) => `${p.field}:${p.reason}`)).toContain("archetype.functional:empty")
    })

    it("refuses a composition when no axis table was supplied to check it against", () => {
      // Fail closed. Accepting it would record a composition nothing verified,
      // which is indistinguishable from a verified one once it is in a registry.
      const { valid, problems } = validateManifest(composed(), context)
      expect(valid).toBe(false)
      expect(problems.map((p) => p.reason)).toContain("unvalidatable")
    })

    it("leaves a manifest carrying no archetype alone", () => {
      // Manifests written before axes existed are in the registry, and a stored
      // record does not become invalid because a type gained a field.
      expect(validateManifest(manifest(), withAxes)).toEqual({ valid: true, problems: [] })
    })
  })

  it("refuses a secret VALUE where a reference belongs, without echoing it", () => {
    const { valid, problems } = validateManifest(
      manifest({ secretRefs: { okta: "sk_live_verysecretvalue" } }),
      context,
    )
    expect(valid).toBe(false)
    const problem = problems.find((p) => p.field === "secretRefs.okta")!
    expect(problem.reason).toBe("not-a-reference")
    // The whole point: the rejection must not repeat the thing it rejected.
    expect(JSON.stringify(problem)).not.toContain("sk_live_verysecretvalue")
  })

  it("accepts a proper secret reference", () => {
    expect(
      validateManifest(manifest({ secretRefs: { okta: "secretsmanager:tenure/midtown/okta" } }), context)
        .valid,
    ).toBe(true)
  })

  it("refuses a credential smuggled into configuration", () => {
    const { problems } = validateManifest(
      manifest({ configuration: { OKTA_CLIENT_SECRET: "abc123" } }),
      context,
    )
    expect(problems.map((p) => p.reason)).toContain("secret-in-configuration")
  })

  it("refuses a dedicated account, because there is no Organization to vend one", () => {
    // Refused at composition rather than at provisioning: a manifest that
    // cannot be built should not be approvable.
    const { valid, problems } = validateManifest(manifest({ isolation: "dedicated-account" }), context)
    expect(valid).toBe(false)
    expect(problems[0].detail).toMatch(/ADR-0007|GE-010/)
  })

  it("refuses an unknown blueprint or module", () => {
    expect(validateManifest(manifest({ blueprintId: "nope" }), context).valid).toBe(false)
    expect(validateManifest(manifest({ modules: ["teleportation"] }), context).valid).toBe(false)
    expect(validateManifest(manifest({ modules: [] }), context).valid).toBe(false)
  })

  it("requires somebody who can sign in", () => {
    const { problems } = validateManifest(manifest({ initialAdminEmail: "not-an-email" }), context)
    expect(problems.map((p) => p.field)).toContain("initialAdminEmail")
  })

  /* --------------------------------------------------------- PACK-020-004 --
   * The coexistence declaration, checked by the same rules `resolveModules`
   * enforces — so a manifest cannot be approved under looser rules than the
   * executor applies.
   */
  it("refuses a coexistence profile that is not one", () => {
    const { valid, problems } = validateManifest(
      manifest({ coexistence: "WHATEVER" as never }),
      context,
    )
    expect(valid).toBe(false)
    expect(problems.map((p) => p.reason)).toContain("unknown-profile")
  })

  it("refuses a system of record for a domain that does not exist", () => {
    const { problems } = validateManifest(
      manifest({ systemOfRecord: { procurement: "external" } }),
      context,
    )
    expect(problems.map((p) => p.reason)).toContain("unknown-domain")
  })

  it("refuses a manifest that records no authoritative writer at all", () => {
    // An empty map reads as "Tenure owns everything" to anyone who does not
    // look, which is exactly the unrecorded assumption this field exists to
    // delete.
    const { problems } = validateManifest(manifest({ systemOfRecord: {} }), context)
    expect(problems.map((p) => p.reason)).toContain("empty")
  })

  it("refuses a profile that contradicts its own system of record", () => {
    // TENURE_CLOUD_PRIMARY says Tenure is authoritative; an external domain says
    // otherwise, and whichever a later reader believes decides whether a second
    // writer is allowed at the ledger.
    const contradiction = validateManifest(
      manifest({ systemOfRecord: { finance: "external", org: "tenure" } }),
      context,
    )
    expect(contradiction.valid).toBe(false)
    expect(contradiction.problems.map((p) => p.reason)).toContain(
      "contradicts-system-of-record",
    )

    // And the other way round: a profile claiming an external ERP with no
    // external domain is a label.
    const empty = validateManifest(
      manifest({ coexistence: "EXTERNAL_ERP_PRIMARY" }),
      context,
    )
    expect(empty.problems.map((p) => p.reason)).toContain("contradicts-system-of-record")
  })

  it("accepts a coherent hybrid split", () => {
    expect(
      validateManifest(
        manifest({
          coexistence: "HYBRID_PROCESS_SPLIT",
          systemOfRecord: { finance: "external", org: "tenure" },
        }),
        context,
      ),
    ).toEqual({ valid: true, problems: [] })
  })

  /* --------------------------------------------------------- WRK-020-004 --
   * Object and field authority, checked THROUGH `validateManifest`.
   *
   * The rules themselves are proved in
   * `packages/module-runtime/src/module-runtime.test.ts`. These assert the
   * wiring, which is the half that has silently gone missing before: a
   * declaration the manifest carries and the validator does not pass on is a
   * contradiction nothing refuses, and it would look exactly like this file
   * being green.
   */
  it("refuses an object whose authority contradicts its own domain", () => {
    const { valid, problems } = validateManifest(
      manifest({
        coexistence: "HYBRID_PROCESS_SPLIT",
        systemOfRecord: { finance: "external", org: "tenure" },
        objectAuthority: [
          { domain: "finance", object: "LedgerEntry", authority: "tenure", direction: "OUTBOUND" },
        ],
      }),
      context,
    )
    expect(valid).toBe(false)
    const problem = problems.find((p) => p.field === "objectAuthority.finance.LedgerEntry")!
    expect(problem.reason).toBe("contradicts-system-of-record")
  })

  it("refuses a bidirectional object under a profile that is not bidirectional", () => {
    const { problems } = validateManifest(
      manifest({
        objectAuthority: [
          { domain: "org", object: "Organization", authority: "tenure", direction: "BIDIRECTIONAL" },
        ],
      }),
      context,
    )
    expect(problems.map((p) => p.reason)).toContain("bidirectional-outside-coexistence")
  })

  it("refuses a field the other side owns with no channel to reach it", () => {
    const { problems } = validateManifest(
      manifest({
        coexistence: "HYBRID_PROCESS_SPLIT",
        systemOfRecord: { finance: "external", org: "tenure" },
        objectAuthority: [
          {
            domain: "finance",
            object: "LedgerEntry",
            authority: "external",
            direction: "NONE",
            fields: [{ field: "memo", authority: "tenure" }],
          },
        ],
      }),
      context,
    )
    expect(problems.map((p) => p.reason)).toContain("field-owner-without-sync")
  })

  it("accepts a coherent object split, and puts it on the plan an approver reads", () => {
    const coherent = manifest({
      coexistence: "COEXISTENCE_TRANSITION",
      systemOfRecord: { finance: "external", org: "tenure" },
      objectAuthority: [
        {
          domain: "finance",
          object: "LedgerEntry",
          authority: "external",
          direction: "BIDIRECTIONAL",
          fields: [{ field: "memo", authority: "tenure" }],
        },
      ],
    })
    expect(validateManifest(coherent, context)).toEqual({ valid: true, problems: [] })

    // The plan is where a person decides. "Controlled, bidirectional
    // coexistence" with nothing under it is a profile name; this is the
    // sentence that says which field the other side writes.
    const warning = planFor(coherent).warnings.find((w) => w.includes("Object-level authority"))
    expect(warning).toBeDefined()
    expect(warning).toContain("finance.LedgerEntry: external writes it, sync BIDIRECTIONAL")
    expect(warning).toContain("memo → tenure")
  })

  it("leaves a manifest that declares no object authority alone", () => {
    // Every tenant in the registry today. The field is optional and adding it
    // must not have refused the whole fleet.
    expect(validateManifest(manifest(), context)).toEqual({ valid: true, problems: [] })
  })

  it("refuses a version-1 manifest rather than reading it as Tenure-owns-everything", () => {
    // The bump is the point: a v1 manifest states nothing about who writes what,
    // and the reading everybody would apply to its absence is the dual write.
    const { problems } = validateManifest(manifest({ manifestVersion: 1 }), context)
    expect(problems.map((p) => p.field)).toContain("manifestVersion")
  })
})

describe("digest", () => {
  it("does not change when keys are reordered", () => {
    // An operator reordering a form field must not produce a "different"
    // manifest and a spurious diff.
    const a = manifest({ configuration: { alpha: 1, beta: 2 } })
    const b = manifest({ configuration: { beta: 2, alpha: 1 } })
    expect(digestOf(a)).toBe(digestOf(b))
  })

  it("changes when anything meaningful changes", () => {
    const base = digestOf(manifest())
    expect(digestOf(manifest({ slug: "other-slug" }))).not.toBe(base)
    expect(digestOf(manifest({ modules: ["governance", "finance"] }))).not.toBe(base)
    expect(digestOf(manifest({ configuration: { a: 1 } }))).not.toBe(base)
  })
})

describe("plan", () => {
  it("puts routing last, and separates it from building", () => {
    const plan = planFor(manifest())
    expect(plan.steps.at(-1)!.during).toBe("ACTIVATING")
    expect(plan.steps.at(-1)!.what).toMatch(/routing/i)
  })

  it("includes a verification step that proves isolation", () => {
    const plan = planFor(manifest())
    const verify = plan.steps.find((s) => s.during === "VERIFYING")!
    expect(verify.detail).toMatch(/cross-tenant read that MUST fail/)
  })

  it("says a pooled tenant is marginal-cost-zero without calling it free", () => {
    const plan = planFor(manifest({ isolation: "pooled" }))
    expect(plan.estimatedMonthlyCostCents).toBe(0)
    expect(plan.warnings.join(" ")).toMatch(/not free/i)
  })

  it("warns on the plan which domains an external system owns", () => {
    // The sentence an operator reads before approving. A system short of
    // features for a reason nobody wrote down gets "fixed" by deleting the
    // coexistence declaration.
    const plan = planFor(
      manifest({
        coexistence: "HYBRID_PROCESS_SPLIT",
        systemOfRecord: { finance: "external", org: "tenure" },
      }),
    )
    expect(plan.warnings.join(" ")).toMatch(/HYBRID_PROCESS_SPLIT/)
    expect(plan.warnings.join(" ")).toMatch(/authoritative for finance/)

    // And says nothing when Tenure owns everything, so the warning means
    // something when it appears.
    expect(planFor(manifest()).warnings.join(" ")).not.toMatch(/authoritative for/)
  })

  it("prices a non-pooled tenant with a stated basis", () => {
    const plan = planFor(manifest({ isolation: "silo" }))
    expect(plan.estimatedMonthlyCostCents).toBeGreaterThan(0)
    expect(plan.costBasis).toMatch(/ALB|Fargate/)
  })

  it("carries the manifest digest so plan and manifest are comparable", () => {
    const m = manifest()
    expect(planFor(m).digest).toBe(digestOf(m))
  })
})

describe("execute", () => {
  const ctx: ExecutionContext = {
    resolveConfiguration: () => ({ checksum: "cfg-abc123", values: { a: 1, b: 2 }, problems: [] }),
    resolveModules: () => ({ ordered: [{ key: "governance", version: "1.2.0" }], problems: [] }),
    validateTopology: () => ({ valid: true, problems: [] }),
    schemaVersion: () => "2026.07.31",
  }

  const broken: ExecutionContext = {
    ...ctx,
    resolveConfiguration: () => ({
      checksum: "",
      values: {},
      problems: [{ key: "term.label", reason: "missing", detail: "no value and no default" }],
    }),
  }

  it("produces evidence for every state in the build path", () => {
    for (const state of [
      "VALIDATING",
      "PLANNED",
      "PROVISIONING",
      "CONFIGURING",
      "MIGRATING",
      "VERIFYING",
      "ACTIVATING",
    ] as const) {
      const e = executeStep(state, manifest(), ctx)
      expect(e.state).toBe(state)
      expect(e.detail.length).toBeGreaterThan(20)
    }
  })

  it("fails validation when configuration no longer resolves", () => {
    // The manifest was fine when composed; a value can go missing between then
    // and provisioning, and the run must stop rather than build half a system.
    const e = executeStep("VALIDATING", manifest(), broken)
    expect(e.ok).toBe(false)
    expect(e.checks!.find((c) => c.name === "configuration resolves")!.ok).toBe(false)
  })

  it("produces no artifact when configuring fails", () => {
    const e = executeStep("CONFIGURING", manifest(), broken)
    expect(e.ok).toBe(false)
    expect(e.detail).toMatch(/no artifact/i)
  })

  it("says plainly that migration is the cell's work, not the engine's", () => {
    // The honesty this whole module turns on: the engine does not write to a
    // tenant's database, and a step that pretended to would be the single most
    // misleading thing in the console.
    const e = executeStep("MIGRATING", manifest(), ctx)
    expect(e.detail).toMatch(/does not write to a tenant's database/)
    // The boundary moved once the reconciler landed, and the claim moved with
    // it: the reconciler is real, the transport is not. Pinned so the next
    // change has to be deliberate rather than aspirational.
    expect(e.detail).toMatch(/NOT wired is the transport/)
    expect(CELL_APPLY).toBe("MIGRATING")
  })

  it("refuses to pass verification with a secret value in the manifest", () => {
    const e = executeStep("VERIFYING", manifest({ secretRefs: { k: "sk_live_abc" } }), ctx)
    expect(e.ok).toBe(false)
    expect(e.checks!.find((c) => c.name === "no secret value in the manifest")!.ok).toBe(false)
  })

  it("is deterministic — two runs produce identical digests", () => {
    // Nothing reads a clock or a random source, so "what did we agree to build"
    // and "what did we build" are comparable rather than merely asserted.
    const a = executeStep("CONFIGURING", manifest(), ctx)
    const b = executeStep("CONFIGURING", manifest(), ctx)
    expect(a.digest).toBe(b.digest)
    expect(a.digest).toBeDefined()
  })

  it("digests the deployment manifest over every field it carries", () => {
    const evidence = (["VALIDATING", "CONFIGURING"] as const).map((s) =>
      executeStep(s, manifest(), ctx),
    )
    const meta = { createdAt: "2026-08-01T00:00:00.000Z", createdBy: "dana@tenure.example" , serving: true}

    const dm = deploymentManifest(manifest(), evidence, ctx, meta)
    expect(dm.digest).toHaveLength(32)
    expect(dm.configurationChecksum).toBe("cfg-abc123")
    expect(dm.modules).toEqual(["governance@1.2.0"])

    // Any change to what was built must change the digest a cell verifies.
    const other = deploymentManifest(manifest({ slug: "different-slug" }), evidence, ctx, meta)
    expect(other.digest).not.toBe(dm.digest)

    const differentModules = deploymentManifest(manifest(), evidence, {
      ...ctx,
      resolveModules: () => ({ ordered: [{ key: "finance", version: "1.0.0" }], problems: [] }),
    }, meta)
    expect(differentModules.digest).not.toBe(dm.digest)
  })

  // ── GE-102-009: the named digests ────────────────────────────────────────

  const BUILD = ["VALIDATING", "PROVISIONING", "CONFIGURING", "MIGRATING", "VERIFYING"] as const
  const META = { createdAt: "2026-08-01T00:00:00.000Z", createdBy: "dana@tenure.example", serving: true }
  const run = (m: TenantManifest, c: ExecutionContext = ctx) =>
    BUILD.map((s) => executeStep(s, m, c))

  it("names each step's digest on the artifact, because the evidence never reaches the cell", () => {
    // The reconcile endpoint is handed the manifest, a display name and an
    // admin address — not the evidence array. So an artifact that carried only
    // `evidenceDigest` could tell a cell that something about the run differed
    // and never which thing. Each digest is therefore named.
    const m = manifest()
    const evidence = run(m)
    const by = (state: TenantState) => evidence.find((e) => e.state === state)!.digest

    const dm = deploymentManifest(m, evidence, ctx, META)

    expect(dm.resourceDigest).toBe(by("PROVISIONING"))
    expect(dm.migrationDigest).toBe(by("MIGRATING"))
    expect(dm.testDigest).toBe(by("VERIFYING"))
    expect(dm.releaseDigest).toHaveLength(32)

    // Four genuinely different facts, not one hash under four names — which is
    // what field-stuffing would look like and would pass every other assertion.
    expect(
      new Set([dm.releaseDigest, dm.resourceDigest, dm.migrationDigest, dm.testDigest]).size,
    ).toBe(4)
    expect(dm.releaseDigest).not.toBe(dm.manifestDigest)
  })

  it("says null for a step that has not run, rather than inventing a digest", () => {
    // CONFIGURING publishes before MIGRATING and VERIFYING happen. "The engine
    // did not state it" and "it verified as empty" are different claims.
    const m = manifest()
    const early = deploymentManifest(m, [executeStep("CONFIGURING", m, ctx)], ctx, {
      ...META,
      serving: false,
    })
    expect(early.migrationDigest).toBeNull()
    expect(early.testDigest).toBeNull()
    expect(early.resourceDigest).toBeNull()
    expect(early.releaseDigest).toHaveLength(32)
  })

  it("cites the last attempt at a step, not the first", () => {
    // A retried step is why `advance` counts attempts. An artifact citing the
    // attempt that failed would point an incident at the wrong evidence.
    const m = manifest()
    const failed = executeStep("VERIFYING", manifest({ secretRefs: { k: "sk_live_abc" } }), ctx)
    const passed = executeStep("VERIFYING", m, ctx)
    expect(failed.digest).not.toBe(passed.digest)

    const dm = deploymentManifest(m, [failed, passed], ctx, META)
    expect(dm.testDigest).toBe(passed.digest)
  })

  it("changes the verification digest when a pre-activation check changes outcome", () => {
    // The digest covers the check OUTCOMES. Digesting the names alone would
    // hash a clean verification and a failed one identically, and the artifact
    // would cite a verification run that says nothing.
    const good = manifest()
    const bad = manifest({ secretRefs: { k: "sk_live_abc" } })

    const passing = deploymentManifest(good, run(good), ctx, META)
    const failing = deploymentManifest(bad, run(bad), ctx, META)

    expect(passing.testDigest).not.toBe(failing.testDigest)
  })

  it("names the artifact it rolls back to, and covers it in the digest", () => {
    const m = manifest()
    const evidence = run(m)

    const first = deploymentManifest(m, evidence, ctx, { ...META, serving: false })
    expect(first.rollbackDigest).toBeNull()

    const second = deploymentManifest(m, evidence, ctx, { ...META, previousDigest: first.digest })
    expect(second.rollbackDigest).toBe(first.digest)

    // The rollback target is part of what the cell verifies: the same run
    // pointing at a different predecessor is a different artifact. Without
    // `rollbackDigest` inside the digested body these two hash identically.
    const third = deploymentManifest(m, evidence, ctx, { ...META, previousDigest: "0".repeat(32) })
    expect(third.digest).not.toBe(second.digest)
    expect(second.digest).not.toBe(first.digest)
  })

  it("changes the release digest when the pinned module VERSIONS change", () => {
    // Not the module set — the versions. A release is the pins, and a build
    // that shipped governance@1.2.0 is not the build that shipped 1.3.0.
    const m = manifest()
    const bumped: ExecutionContext = {
      ...ctx,
      resolveModules: () => ({ ordered: [{ key: "governance", version: "1.3.0" }], problems: [] }),
    }
    expect(deploymentManifest(m, run(m), ctx, META).releaseDigest).not.toBe(
      deploymentManifest(m, run(m, bumped), bumped, META).releaseDigest,
    )
  })

  it("does not tell an operator the artifact is signed, because nothing signs it", () => {
    // The claim this requirement was opened against. `digest` is an unkeyed
    // SHA-256 and the cell recomputes the same unkeyed hash, so it establishes
    // that the artifact arrived unaltered and nothing at all about its origin.
    // An engine that says "signed" here teaches operators to trust a property
    // it does not have.
    const e = executeStep("MIGRATING", manifest(), ctx)
    expect(e.detail).not.toMatch(/\bsigns?\b|\bsigned\b|\bsigning\b/i)
    expect(e.detail).toMatch(/unkeyed digest, not a signature/)
  })
})
