import type { ApprovalStatus } from "@prisma/client"
import { availableActions, nextStatus, type ApprovalView } from "./approvals"
import type { UserContext } from "./rbac"

const INST = "inst_1"
const ORG = "org_1"

function approval(status: ApprovalStatus, submittedById = "vp_user"): ApprovalView {
  return { id: "ap_1", status, submittedById, organizationId: ORG, institutionId: INST }
}

function ctx(userId: string, overrides: Partial<UserContext> = {}): UserContext {
  return { userId, institutionRoles: [], orgRoles: [], ...overrides }
}

const vp = ctx("vp_user", {
  orgRoles: [
    { organizationId: ORG, roleId: "r_vp", roleName: "VP Finance", scope: "FUNCTIONAL", status: "ACTIVE" },
  ],
})
const president = ctx("pres_user", {
  orgRoles: [
    { organizationId: ORG, roleId: "r_p", roleName: "President", scope: "PRESIDENT", status: "ACTIVE" },
  ],
})
const oseDirector = ctx("ose_user", {
  institutionRoles: [{ institutionId: INST, role: "OSE_DIRECTOR" }],
})
const outsider = ctx("random_user")

describe("availableActions", () => {
  it("lets the requester submit or cancel a draft", () => {
    expect(availableActions(vp, approval("DRAFT"))).toEqual(["submit", "cancel"])
    expect(availableActions(president, approval("DRAFT"))).toEqual([])
  })

  it("gates PENDING_PRESIDENT on the active president", () => {
    const a = approval("PENDING_PRESIDENT")
    expect(availableActions(president, a)).toEqual(["approve", "request_changes", "reject"])
    expect(availableActions(vp, a)).toEqual(["cancel"]) // requester may withdraw
    expect(availableActions(oseDirector, a)).toEqual([]) // not their gate yet
  })

  it("gates PENDING_OSE on OSE staff", () => {
    const a = approval("PENDING_OSE")
    expect(availableActions(oseDirector, a)).toEqual(["approve", "request_changes", "reject"])
    expect(availableActions(president, a)).toEqual([])
  })

  it("lets only the requester resubmit after NEEDS_CHANGES", () => {
    const a = approval("NEEDS_CHANGES")
    expect(availableActions(vp, a)).toEqual(["resubmit", "cancel"])
    expect(availableActions(president, a)).toEqual([])
  })

  it("offers nothing on terminal states or to outsiders", () => {
    expect(availableActions(vp, approval("APPROVED"))).toEqual([])
    expect(availableActions(vp, approval("REJECTED"))).toEqual([])
    expect(availableActions(vp, approval("CANCELLED"))).toEqual([])
    expect(availableActions(outsider, approval("PENDING_PRESIDENT"))).toEqual([])
  })
})

describe("nextStatus", () => {
  it("routes VP submissions through the president gate", () => {
    expect(nextStatus("submit", "DRAFT", { requesterIsPresident: false })).toBe("PENDING_PRESIDENT")
  })

  it("skips the president gate for the president's own requests", () => {
    expect(nextStatus("submit", "DRAFT", { requesterIsPresident: true })).toBe("PENDING_OSE")
    expect(nextStatus("resubmit", "NEEDS_CHANGES", { requesterIsPresident: true })).toBe("PENDING_OSE")
  })

  it("moves through both gates to APPROVED", () => {
    expect(nextStatus("approve", "PENDING_PRESIDENT", { requesterIsPresident: false })).toBe("PENDING_OSE")
    expect(nextStatus("approve", "PENDING_OSE", { requesterIsPresident: false })).toBe("APPROVED")
  })

  it("returns null for illegal transitions", () => {
    expect(nextStatus("submit", "APPROVED", { requesterIsPresident: false })).toBeNull()
    expect(nextStatus("approve", "DRAFT", { requesterIsPresident: false })).toBeNull()
    expect(nextStatus("resubmit", "DRAFT", { requesterIsPresident: false })).toBeNull()
    expect(nextStatus("cancel", "APPROVED", { requesterIsPresident: false })).toBeNull()
  })
})
