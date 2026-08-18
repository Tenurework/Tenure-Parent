import type { ControlWorld } from "@tenure/authorization"
import type { Delegation } from "@tenure/organization-model"
import { validateDefinition } from "@tenure/workflow"

import {
  CORPORATE_GATES,
  CORPORATE_PURCHASE_WORKFLOW,
  availablePurchaseActions,
  corporateWorkflowRoles,
  decidePurchase,
  delegatedGates,
  gatesForAmount,
  gatesOfRung,
  purchaseConditions,
  purchaseLadderProblems,
  type CorporatePurchase,
} from "./corporate-purchase"
import { rungByKey } from "./corporate-org"

const AT = "2026-06-01T00:00:00Z"
const NO_DECLARATIONS: ControlWorld = {}

const purchase = (over: Partial<CorporatePurchase> = {}): CorporatePurchase => ({
  requestId: "pr-1",
  tenantId: "fixture-corporate",
  state: "PENDING_DEPARTMENT",
  amountCents: 120_000, // $1,200 — departmental
  raisedByPrincipalId: "ana",
  preparedByPrincipalId: null,
  subjectIds: ["emea-industrial-procurement"],
  decidedByPrincipalIds: [],
  ...over,
})

/**
 * GE-052-003 — "Implement corporate purchase workflow with amount thresholds,
 * department/finance/procurement approvals, delegation, and self-approval
 * denial."
 */
describe("GE-052-003 — the corporate purchase chain", () => {
  it("publishes a definition the shipped validator accepts", () => {
    expect(() => validateDefinition(CORPORATE_PURCHASE_WORKFLOW)).not.toThrow()
    expect(purchaseLadderProblems()).toEqual([])
  })

  describe("amount thresholds", () => {
    it("prices each band to the gates it has to clear", () => {
      expect(gatesForAmount(0)).toEqual(["departmentGate"])
      expect(gatesForAmount(499_999)).toEqual(["departmentGate"])
      expect(gatesForAmount(500_000)).toEqual(["departmentGate", "financeGate"])
      expect(gatesForAmount(4_999_999)).toEqual(["departmentGate", "financeGate"])
      expect(gatesForAmount(5_000_000)).toEqual([
        "departmentGate",
        "financeGate",
        "procurementGate",
      ])
    })

    it("says it could not look rather than that nobody is needed", () => {
      // The collapse this codebase keeps finding. An unpriced amount must not
      // produce an empty gate list, which every caller reads as "no approval".
      expect(gatesForAmount(Number.NaN)).toBeNull()
      expect(gatesForAmount(Number.POSITIVE_INFINITY)).toBeNull()
      expect(purchaseConditions(Number.NaN)).toBeNull()

      const outcome = decidePurchase(
        purchase({ amountCents: Number.NaN }),
        { principalId: "mo", roles: ["departmentGate"] },
        NO_DECLARATIONS,
        "approve",
        AT,
      )
      expect(outcome).toMatchObject({ ok: false, stage: "ladder", reason: "NO_RUNG" })
      expect(
        availablePurchaseActions(
          purchase({ amountCents: Number.NaN }),
          { principalId: "mo", roles: ["departmentGate"] },
          NO_DECLARATIONS,
          AT,
        ),
      ).toEqual([])
    })

    it("stops a small purchase at the department and escalates a large one", () => {
      const small = decidePurchase(
        purchase({ amountCents: 120_000 }),
        { principalId: "mo", roles: ["departmentGate"] },
        NO_DECLARATIONS,
        "approve",
        AT,
      )
      expect(small).toMatchObject({ ok: true, to: "APPROVED" })

      const medium = decidePurchase(
        purchase({ amountCents: 900_000 }),
        { principalId: "mo", roles: ["departmentGate"] },
        NO_DECLARATIONS,
        "approve",
        AT,
      )
      expect(medium).toMatchObject({ ok: true, to: "PENDING_FINANCE" })
    })

    it("routes the largest band through all three gates in order", () => {
      const big = { amountCents: 9_000_000 }

      const dept = decidePurchase(
        purchase({ ...big }),
        { principalId: "mo", roles: ["departmentGate"] },
        NO_DECLARATIONS,
        "approve",
        AT,
      )
      expect(dept).toMatchObject({ ok: true, to: "PENDING_FINANCE" })

      const fin = decidePurchase(
        purchase({ ...big, state: "PENDING_FINANCE", decidedByPrincipalIds: ["mo"] }),
        { principalId: "di", roles: ["financeGate"] },
        NO_DECLARATIONS,
        "approve",
        AT,
      )
      expect(fin).toMatchObject({ ok: true, to: "PENDING_PROCUREMENT" })

      const proc = decidePurchase(
        purchase({ ...big, state: "PENDING_PROCUREMENT", decidedByPrincipalIds: ["mo", "di"] }),
        { principalId: "ex", roles: ["procurementGate"] },
        NO_DECLARATIONS,
        "approve",
        AT,
      )
      expect(proc).toMatchObject({ ok: true, to: "APPROVED" })
    })

    it("refuses a mid-band purchase to the finance gate as a final answer", () => {
      // $9,000 needs finance and does NOT need procurement, so the finance gate
      // approves outright. The condition is what makes those two different
      // transitions on one action.
      const fin = decidePurchase(
        purchase({ amountCents: 900_000, state: "PENDING_FINANCE", decidedByPrincipalIds: ["mo"] }),
        { principalId: "di", roles: ["financeGate"] },
        NO_DECLARATIONS,
        "approve",
        AT,
      )
      expect(fin).toMatchObject({ ok: true, to: "APPROVED" })
    })
  })

  describe("who holds which gate", () => {
    it("gives each rung the gates it reaches and no more", () => {
      expect(gatesOfRung(rungByKey("analyst"))).toEqual([])
      expect(gatesOfRung(rungByKey("manager"))).toEqual(["departmentGate"])
      expect(gatesOfRung(rungByKey("director"))).toEqual(["departmentGate", "financeGate"])
      expect(gatesOfRung(rungByKey("executive"))).toEqual([
        "departmentGate",
        "financeGate",
        "procurementGate",
      ])
      expect(gatesOfRung(null)).toEqual([])
    })

    it("confers nothing on an unrecognised rung", () => {
      expect(corporateWorkflowRoles({ principalId: "x", rungKey: "Manager", isRequester: false })).toEqual([])
      expect(corporateWorkflowRoles({ principalId: "x", rungKey: null, isRequester: true })).toEqual([
        "requester",
      ])
    })

    it("refuses an analyst the department gate", () => {
      const outcome = decidePurchase(
        purchase(),
        {
          principalId: "ana2",
          roles: corporateWorkflowRoles({ principalId: "ana2", rungKey: "analyst", isRequester: false }),
        },
        NO_DECLARATIONS,
        "approve",
        AT,
      )
      expect(outcome).toMatchObject({ ok: false, stage: "workflow", reason: "actor-not-permitted" })
    })
  })

  describe("self-approval denial", () => {
    it("refuses the manager who raised it, even though they hold the gate", () => {
      const outcome = decidePurchase(
        purchase({ raisedByPrincipalId: "mo" }),
        { principalId: "mo", roles: ["departmentGate"] },
        NO_DECLARATIONS,
        "approve",
        AT,
      )
      expect(outcome).toMatchObject({ ok: false, stage: "controls", reason: "SELF_APPROVAL" })
    })

    it("still lets the requester cancel their own request", () => {
      // Self-approval must not become the reason nobody can withdraw anything.
      const outcome = decidePurchase(
        purchase({ raisedByPrincipalId: "ana" }),
        { principalId: "ana", roles: ["requester"] },
        NO_DECLARATIONS,
        "cancel",
        AT,
      )
      expect(outcome).toMatchObject({ ok: true, to: "CANCELLED" })
    })

    it("refuses the preparer at the gate", () => {
      const outcome = decidePurchase(
        purchase({ preparedByPrincipalId: "mo" }),
        { principalId: "mo", roles: ["departmentGate"] },
        NO_DECLARATIONS,
        "approve",
        AT,
      )
      expect(outcome).toMatchObject({ ok: false, stage: "controls", reason: "SAME_MAKER" })
    })

    it("refuses a director the second gate they already cleared", () => {
      // A director reaches both the department and the finance gate. Taking
      // both is one gate that took longer, and this is the arm that says so.
      const roles = corporateWorkflowRoles({ principalId: "di", rungKey: "director", isRequester: false })
      expect(roles).toEqual(["departmentGate", "financeGate"])

      const first = decidePurchase(
        purchase({ amountCents: 900_000 }),
        { principalId: "di", roles },
        NO_DECLARATIONS,
        "approve",
        AT,
      )
      expect(first).toMatchObject({ ok: true, to: "PENDING_FINANCE" })

      const second = decidePurchase(
        purchase({ amountCents: 900_000, state: "PENDING_FINANCE", decidedByPrincipalIds: ["di"] }),
        { principalId: "di", roles },
        NO_DECLARATIONS,
        "approve",
        AT,
      )
      expect(second).toMatchObject({ ok: false, stage: "controls", reason: "ALREADY_DECIDED" })
    })

    it("refuses an approver who declared an interest in the spending unit", () => {
      const world: ControlWorld = {
        conflicts: [
          {
            principalId: "mo",
            tenantId: "fixture-corporate",
            subjectId: "emea-industrial-procurement",
            reason: "Chairs the supplier's advisory board.",
            effectiveFrom: "2026-01-01",
            effectiveTo: null,
          },
        ],
      }
      const outcome = decidePurchase(
        purchase(),
        { principalId: "mo", roles: ["departmentGate"] },
        world,
        "approve",
        AT,
      )
      expect(outcome).toMatchObject({ ok: false, stage: "controls", reason: "DECLARED_CONFLICT" })
    })
  })

  describe("delegation", () => {
    const delegation = (over: Partial<Delegation> = {}): Delegation => ({
      id: "del-1",
      tenantId: "fixture-corporate",
      fromSeatId: "seat-director-emea",
      toPersonId: "cover",
      actions: ["approvals.request.decide"],
      resourceIds: [],
      dated: { effectiveFrom: "2026-05-01", effectiveTo: "2026-07-01" },
      revokedAt: null,
      redelegationDepth: 0,
      reason: "Director on parental leave; cover agreed with the executive.",
      ...over,
    })

    const request = {
      action: "approvals.request.decide",
      resourceId: "pr-1",
      at: new Date(AT),
    }
    const liveDirector = { actions: ["approvals.request.decide"], live: true }

    it("lends exactly the source seat's gates", () => {
      const borrowed = delegatedGates(delegation(), "director", liveDirector, request)
      expect(borrowed.verdict.ok).toBe(true)
      expect(borrowed.roles).toEqual(["departmentGate", "financeGate"])
      // Never the rung above the source: a director cannot lend procurement.
      expect(borrowed.roles).not.toContain("procurementGate")
    })

    it("lets the delegate clear the finance gate the director cannot reach today", () => {
      const borrowed = delegatedGates(delegation(), "director", liveDirector, request)
      const outcome = decidePurchase(
        purchase({ amountCents: 900_000, state: "PENDING_FINANCE", decidedByPrincipalIds: ["mo"] }),
        { principalId: "cover", roles: borrowed.roles },
        NO_DECLARATIONS,
        "approve",
        AT,
      )
      expect(outcome).toMatchObject({ ok: true, to: "APPROVED" })
    })

    it("lends nothing once the delegating seat is no longer live", () => {
      const borrowed = delegatedGates(
        delegation(),
        "director",
        { actions: ["approvals.request.decide"], live: false },
        request,
      )
      expect(borrowed.verdict.reason).toBe("SOURCE_NOT_LIVE")
      expect(borrowed.roles).toEqual([])
    })

    it("lends nothing the source does not itself hold", () => {
      const borrowed = delegatedGates(
        delegation(),
        "director",
        { actions: [], live: true },
        request,
      )
      expect(borrowed.verdict.reason).toBe("EXCEEDS_SOURCE")
      expect(borrowed.roles).toEqual([])
    })

    it("lends nothing after it is revoked", () => {
      const borrowed = delegatedGates(
        delegation({ revokedAt: "2026-05-20" }),
        "director",
        liveDirector,
        request,
      )
      expect(borrowed.verdict.reason).toBe("REVOKED")
      expect(borrowed.roles).toEqual([])
    })

    it("refuses an unbounded delegation outright", () => {
      const borrowed = delegatedGates(
        delegation({ dated: { effectiveFrom: "2026-05-01", effectiveTo: null } }),
        "director",
        liveDirector,
        request,
      )
      expect(borrowed.verdict.reason).toBe("NO_EXPIRY")
      expect(borrowed.roles).toEqual([])
    })

    it("does not let a delegation launder a self-approval", () => {
      // The delegate raised the purchase. Borrowed authority is still
      // authority, and the control runs on the person, not on where their
      // gate came from.
      const borrowed = delegatedGates(delegation(), "director", liveDirector, request)
      const outcome = decidePurchase(
        purchase({ amountCents: 900_000, state: "PENDING_FINANCE", raisedByPrincipalId: "cover" }),
        { principalId: "cover", roles: borrowed.roles },
        NO_DECLARATIONS,
        "approve",
        AT,
      )
      expect(outcome).toMatchObject({ ok: false, stage: "controls", reason: "SELF_APPROVAL" })
    })
  })

  describe("what a reviewer is offered", () => {
    it("hides an action the decision path would refuse", () => {
      const raisedByTheManager = purchase({ raisedByPrincipalId: "mo" })
      const offered = availablePurchaseActions(
        raisedByTheManager,
        { principalId: "mo", roles: ["departmentGate", "requester"] },
        NO_DECLARATIONS,
        AT,
      ).map((a) => a.action)

      expect(offered).not.toContain("approve")
      expect(offered).not.toContain("reject")
      // Withdrawing their own request is still theirs to do.
      expect(offered).toContain("cancel")
    })

    it("offers the department gate exactly one approve, labelled for the band", () => {
      const small = availablePurchaseActions(
        purchase({ amountCents: 120_000 }),
        { principalId: "mo", roles: ["departmentGate"] },
        NO_DECLARATIONS,
        AT,
      )
      expect(small.filter((a) => a.action === "approve")).toHaveLength(1)
      expect(small.find((a) => a.action === "approve")!.to).toBe("APPROVED")

      const large = availablePurchaseActions(
        purchase({ amountCents: 9_000_000 }),
        { principalId: "mo", roles: ["departmentGate"] },
        NO_DECLARATIONS,
        AT,
      )
      expect(large.find((a) => a.action === "approve")!.to).toBe("PENDING_FINANCE")
    })
  })

  it("sends a resubmitted request back to the bottom of the chain", () => {
    const outcome = decidePurchase(
      purchase({ state: "NEEDS_CHANGES", amountCents: 9_000_000 }),
      { principalId: "ana", roles: [CORPORATE_GATES.requester] },
      NO_DECLARATIONS,
      "resubmit",
      AT,
    )
    expect(outcome).toMatchObject({ ok: true, to: "PENDING_DEPARTMENT" })
  })
})
