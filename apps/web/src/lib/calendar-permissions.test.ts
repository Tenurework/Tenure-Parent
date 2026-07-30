import { canEditEvent } from "./calendar-write"
import type { UserContext } from "./rbac"

/**
 * Who may move an event on the shared calendar.
 *
 * This became load-bearing the moment the week grid gained drag-to-reschedule:
 * before that, an event's time could only change through the approval chain.
 * The first rule shipped here was "any ACTIVE member of the owning club", which
 * let every rank-and-file member with a generic Member seat drag a published,
 * fully-approved event onto a different day. These tests pin the narrower rule.
 */

const INST = "inst_1"
const ORG = "org_1"
const OWNER_ROLE = "role_vp_finance"

const EVENT = {
  organizationId: ORG,
  institutionId: INST,
  status: "PUBLISHED",
  ownerRoleId: OWNER_ROLE,
}

function ctx(overrides: Partial<UserContext> = {}): UserContext {
  return { userId: "user_1", institutionRoles: [], orgRoles: [], ...overrides }
}

const seat = (
  roleId: string,
  scope: "PRESIDENT" | "FUNCTIONAL" | "MEMBER",
  status: "ACTIVE" | "SHADOW" | "ALUMNI" = "ACTIVE",
  organizationId = ORG
) => ({ organizationId, roleId, roleName: roleId, scope, status })

describe("canEditEvent", () => {
  it("lets the seat that proposed the event move it while it is still pending", () => {
    const pending = { ...EVENT, status: "PENDING_APPROVAL" }
    expect(canEditEvent(ctx({ orgRoles: [seat(OWNER_ROLE, "FUNCTIONAL")] }), pending)).toBe(true)
  })

  it("stops the proposer from rewriting the event once it has been approved", () => {
    // The approval record is a snapshot: approvers read the description written
    // at submission, not the live Event row. Leaving the proposer write access
    // after PUBLISHED let an approved "Case Prep, Schlegel 203, Tue 6pm" become
    // "Bar Crawl, off campus, Fri 10pm" with the approval page unchanged.
    expect(canEditEvent(ctx({ orgRoles: [seat(OWNER_ROLE, "FUNCTIONAL")] }), EVENT)).toBe(false)
  })

  it("lets the club's ACTIVE president move any of the club's events", () => {
    expect(canEditEvent(ctx({ orgRoles: [seat("role_pres", "PRESIDENT")] }), EVENT)).toBe(true)
  })

  it("lets OSE move anything at the institution", () => {
    const director = ctx({ institutionRoles: [{ institutionId: INST, role: "OSE_DIRECTOR" }] })
    const staff = ctx({ institutionRoles: [{ institutionId: INST, role: "OSE_STAFF" }] })
    expect(canEditEvent(director, EVENT)).toBe(true)
    expect(canEditEvent(staff, EVENT)).toBe(true)
  })

  it("does NOT let a plain club member move a published event", () => {
    // The regression: a generic "Member" seat is ACTIVE in the club, so a
    // club-membership check alone handed out reschedule rights to everyone.
    expect(canEditEvent(ctx({ orgRoles: [seat("role_member", "MEMBER")] }), EVENT)).toBe(false)
  })

  it("does not let another officer of the same club move someone else's event", () => {
    expect(canEditEvent(ctx({ orgRoles: [seat("role_vp_events", "FUNCTIONAL")] }), EVENT)).toBe(
      false
    )
  })

  it("keeps SHADOW holders read-only, including the incoming president", () => {
    expect(
      canEditEvent(ctx({ orgRoles: [seat(OWNER_ROLE, "FUNCTIONAL", "SHADOW")] }), EVENT)
    ).toBe(false)
    expect(
      canEditEvent(ctx({ orgRoles: [seat("role_pres", "PRESIDENT", "SHADOW")] }), EVENT)
    ).toBe(false)
  })

  it("revokes access from alumni", () => {
    expect(canEditEvent(ctx({ orgRoles: [seat(OWNER_ROLE, "FUNCTIONAL", "ALUMNI")] }), EVENT)).toBe(
      false
    )
  })

  it("does not leak across clubs", () => {
    const otherClubPresident = ctx({
      orgRoles: [seat("role_pres", "PRESIDENT", "ACTIVE", "org_other")],
    })
    expect(canEditEvent(otherClubPresident, EVENT)).toBe(false)
  })

  it("does not leak across institutions", () => {
    const otherOse = ctx({ institutionRoles: [{ institutionId: "inst_other", role: "OSE_DIRECTOR" }] })
    expect(canEditEvent(otherOse, EVENT)).toBe(false)
  })

  it("freezes a cancelled event for everyone, including OSE", () => {
    const cancelled = { ...EVENT, status: "CANCELLED" }
    const director = ctx({ institutionRoles: [{ institutionId: INST, role: "OSE_DIRECTOR" }] })
    expect(canEditEvent(director, cancelled)).toBe(false)
    expect(canEditEvent(ctx({ orgRoles: [seat(OWNER_ROLE, "FUNCTIONAL")] }), cancelled)).toBe(false)
  })

  it("denies an event with no recorded owner unless you are president or OSE", () => {
    // Legacy rows predate ownerRoleId; they must not fall open.
    const orphan = { ...EVENT, ownerRoleId: null }
    expect(canEditEvent(ctx({ orgRoles: [seat("role_any", "FUNCTIONAL")] }), orphan)).toBe(false)
    expect(canEditEvent(ctx({ orgRoles: [seat("role_pres", "PRESIDENT")] }), orphan)).toBe(true)
  })

  it("keeps the president and OSE able to move an approved event", () => {
    // Tightening the proposer's rights must not freeze the calendar: someone
    // accountable has to be able to move a published event when a room falls
    // through. Both paths are audited and write back onto the approval.
    expect(canEditEvent(ctx({ orgRoles: [seat("role_pres", "PRESIDENT")] }), EVENT)).toBe(true)
    expect(
      canEditEvent(ctx({ institutionRoles: [{ institutionId: INST, role: "OSE_DIRECTOR" }] }), EVENT)
    ).toBe(true)
  })

  it("denies a signed-in user with no affiliation at all", () => {
    expect(canEditEvent(ctx(), EVENT)).toBe(false)
  })
})
