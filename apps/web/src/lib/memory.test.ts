import { canSeeMemoryCard } from "./memory"
import type { UserContext } from "./rbac"

const INST = "inst_1"
const ORG = { id: "org_1", institutionId: INST }
const SEAT = "role_vp_finance"

function ctx(userId: string, overrides: Partial<UserContext> = {}): UserContext {
  return { userId, institutionRoles: [], orgRoles: [], ...overrides }
}

const orgCard = { roleId: null }
const seatCard = { roleId: SEAT }

const activeHolder = ctx("holder", {
  orgRoles: [{ organizationId: ORG.id, roleId: SEAT, roleName: "VP Finance", scope: "FUNCTIONAL", status: "ACTIVE" }],
})
const incomingHolder = ctx("incoming", {
  orgRoles: [{ organizationId: ORG.id, roleId: SEAT, roleName: "VP Finance", scope: "FUNCTIONAL", status: "SHADOW" }],
})
const pastHolder = ctx("past", {
  orgRoles: [{ organizationId: ORG.id, roleId: SEAT, roleName: "VP Finance", scope: "FUNCTIONAL", status: "ALUMNI" }],
})
const president = ctx("president", {
  orgRoles: [{ organizationId: ORG.id, roleId: "role_p", roleName: "President", scope: "PRESIDENT", status: "ACTIVE" }],
})
const otherMember = ctx("member", {
  orgRoles: [{ organizationId: ORG.id, roleId: "role_m", roleName: "Member", scope: "MEMBER", status: "ACTIVE" }],
})
const ose = ctx("ose", { institutionRoles: [{ institutionId: INST, role: "OSE_STAFF" }] })

describe("org-wide cards", () => {
  it("are visible to any org viewer, not outsiders", () => {
    expect(canSeeMemoryCard(otherMember, orgCard, ORG)).toBe(true)
    expect(canSeeMemoryCard(incomingHolder, orgCard, ORG)).toBe(true)
    expect(canSeeMemoryCard(ctx("outsider"), orgCard, ORG)).toBe(false)
  })
})

describe("role-scoped cards (the handoff)", () => {
  it("current and incoming seat holders see them", () => {
    expect(canSeeMemoryCard(activeHolder, seatCard, ORG)).toBe(true)
    expect(canSeeMemoryCard(incomingHolder, seatCard, ORG)).toBe(true)
  })
  it("past holders lose access — the record outlives them", () => {
    expect(canSeeMemoryCard(pastHolder, seatCard, ORG)).toBe(false)
  })
  it("the active president and OSE see them; other members do not", () => {
    expect(canSeeMemoryCard(president, seatCard, ORG)).toBe(true)
    expect(canSeeMemoryCard(ose, seatCard, ORG)).toBe(true)
    expect(canSeeMemoryCard(otherMember, seatCard, ORG)).toBe(false)
  })
})
