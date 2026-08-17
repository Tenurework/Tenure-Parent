import { canSeeMemoryCard } from "./memory"
import type { SeatMemoryCard } from "./people/seat-memory-boundary"
import type { UserContext } from "./rbac"

const INST = "inst_1"
const ORG = { id: "org_1", institutionId: INST }
const SEAT = "role_vp_finance"

function ctx(userId: string, overrides: Partial<UserContext> = {}): UserContext {
  return { userId, institutionRoles: [], orgRoles: [], ...overrides }
}

/**
 * HCM-040-003. The card fixtures now carry `type` and `sensitivity`, because
 * `canSeeMemoryCard` reads them: what an INCOMING holder inherits is decided per
 * card by `people/seat-memory-boundary.ts`, not by their status alone. `roleId`
 * alone no longer type-checks, which is the point — a read path that does not
 * select the classification columns cannot get the permissive answer by
 * omission.
 */
const orgCard: SeatMemoryCard = {
  id: "mem_org",
  roleId: null,
  type: "LESSON",
  sensitivity: "standard",
}
const seatCard: SeatMemoryCard = {
  id: "mem_seat",
  roleId: SEAT,
  type: "PLAYBOOK",
  sensitivity: "standard",
}
/** The seat's login card. `schema.prisma`: "Login / access info". */
const seatCredentialCard: SeatMemoryCard = {
  id: "mem_login",
  roleId: SEAT,
  type: "CREDENTIAL",
  sensitivity: "standard",
}
/** A seat card somebody classified above `standard`. */
const seatRestrictedCard: SeatMemoryCard = {
  id: "mem_restricted",
  roleId: SEAT,
  type: "LESSON",
  sensitivity: "restricted",
}

const activeHolder = ctx("holder", {
  orgRoles: [{ organizationId: ORG.id, roleId: SEAT, roleName: "VP Finance", templateKey: "finance.officer", scope: "FUNCTIONAL", status: "ACTIVE" }],
})
const incomingHolder = ctx("incoming", {
  orgRoles: [{ organizationId: ORG.id, roleId: SEAT, roleName: "VP Finance", templateKey: "finance.officer", scope: "FUNCTIONAL", status: "SHADOW" }],
})
const pastHolder = ctx("past", {
  orgRoles: [{ organizationId: ORG.id, roleId: SEAT, roleName: "VP Finance", templateKey: "finance.officer", scope: "FUNCTIONAL", status: "ALUMNI" }],
})
const president = ctx("president", {
  orgRoles: [{ organizationId: ORG.id, roleId: "role_p", roleName: "President", templateKey: "unit.lead", scope: "PRESIDENT", status: "ACTIVE" }],
})
const otherMember = ctx("member", {
  orgRoles: [{ organizationId: ORG.id, roleId: "role_m", roleName: "Member", templateKey: "unit.member", scope: "MEMBER", status: "ACTIVE" }],
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

/**
 * HCM-040-003 — the boundary inside the handoff.
 *
 * The Bible, §3.4: "Never transfer another person's private messages,
 * performance, health, compensation or unrestricted files to a successor." §17
 * lists "expose private data to successors" as a prohibited shortcut. Before
 * this, an incoming holder saw every card scoped to the seat, `CREDENTIAL` cards
 * included, before their term had begun.
 */
describe("what an incoming holder does NOT inherit", () => {
  it("cannot read the seat's credential card", () => {
    expect(canSeeMemoryCard(incomingHolder, seatCredentialCard, ORG)).toBe(false)
  })

  it("cannot read a card classified above standard", () => {
    expect(canSeeMemoryCard(incomingHolder, seatRestrictedCard, ORG)).toBe(false)
  })

  it("still inherits the seat's own working record — that is the product", () => {
    expect(canSeeMemoryCard(incomingHolder, seatCard, ORG)).toBe(true)
  })

  it("does not narrow anyone else: the holder, the president and OSE still read both", () => {
    // The boundary applies to the handoff window only. Narrowing the current
    // holder's own access would be a different (and wrong) change.
    for (const viewer of [activeHolder, president, ose]) {
      expect(canSeeMemoryCard(viewer, seatCredentialCard, ORG)).toBe(true)
      expect(canSeeMemoryCard(viewer, seatRestrictedCard, ORG)).toBe(true)
    }
  })

  it("keeps org-wide cards open to them — those are not seat memory", () => {
    expect(canSeeMemoryCard(incomingHolder, orgCard, ORG)).toBe(true)
  })
})
