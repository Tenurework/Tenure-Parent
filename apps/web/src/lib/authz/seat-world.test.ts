import { lookupRoleTemplate } from "@tenure/authorization"

import type { OrgRole, UserContext } from "@/lib/rbac"

import { decideFromSeats, seatGrants, seatWorld } from "./seat-world"

/**
 * GE-051-005 — a club action decided by the engine rather than by a row count.
 *
 * `submitReimbursement` asked "does this person hold an ACTIVE seat here?" and
 * treated yes as permission to file. Every seat answered the same, so a club
 * that gave somebody a read-only advisory seat had given them a spending claim,
 * and every refusal — term not started, module off, no seat at all — arrived as
 * the same sentence.
 */

const TENANT = "inst-1"
const CLUB = "club-1"
const OTHER_CLUB = "club-2"
const MODULES = ["reimbursements", "budgeting", "approvals", "organizations"]

const seat = (over: Partial<OrgRole> = {}): OrgRole => ({
  organizationId: CLUB,
  roleId: "r1",
  roleName: "Member",
  scope: "MEMBER",
  status: "ACTIVE",
  templateKey: "unit.member",
  ...over,
})

const ctx = (orgRoles: OrgRole[], institutionRoles: UserContext["institutionRoles"] = []): UserContext => ({
  userId: "u1",
  institutionRoles,
  orgRoles,
})

const file = (context: UserContext, organizationId = CLUB, enabledModules = MODULES) =>
  decideFromSeats(context, {
    permission: "finance.reimbursement.create",
    organizationId,
    tenantId: TENANT,
    enabledModules,
    at: "2026-08-03T12:00:00Z",
  })

describe("who may file a reimbursement", () => {
  it("lets an ordinary member of the club file", () => {
    // Anybody who spent money on the club's behalf may claim it back. The
    // controlled act is approving, and the duties matrix forbids one person
    // doing both.
    expect(file(ctx([seat()])).allowed).toBe(true)
  })

  it("lets the club's lead file", () => {
    expect(file(ctx([seat({ templateKey: "unit.lead", scope: "PRESIDENT" })])).allowed).toBe(true)
  })

  it("lets the finance officer file", () => {
    expect(file(ctx([seat({ templateKey: "finance.officer" })])).allowed).toBe(true)
  })

  it("refuses a read-only advisory seat", () => {
    // The case the old check could not express: an ACTIVE seat that confers
    // watching, not spending.
    const decision = file(ctx([seat({ templateKey: "oversight.advisor" })]))
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("NO_ROLE_GRANTING")
  })

  it("refuses somebody with no seat here at all", () => {
    expect(file(ctx([])).reason).toBe("NO_MEMBERSHIP")
  })

  it("refuses a seat in a different club", () => {
    // Scope, checked by the engine against the org unit rather than by a
    // `where` clause somebody has to remember to write.
    expect(file(ctx([seat({ organizationId: OTHER_CLUB })])).reason).toBe("OUT_OF_SCOPE")
  })
})

describe("the refusal says which refusal it is", () => {
  it("tells a SHADOW holder their term has not begun", () => {
    // The old check answered this with "you need an active role in this club",
    // which is both wrong and unactionable: they have one, it starts in August.
    const decision = file(ctx([seat({ status: "SHADOW" })]))
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("GRANT_NOT_CONFIRMED")
  })

  it("tells a system that does not run reimbursements so", () => {
    const decision = file(ctx([seat()]), CLUB, ["budgeting", "approvals"])
    expect(decision.reason).toBe("MODULE_NOT_ENABLED")
    expect(decision.detail).toMatch(/reimbursements/)
  })

  it("gives every refusal a detail worth showing", () => {
    for (const decision of [
      file(ctx([seat({ templateKey: "oversight.advisor" })])),
      file(ctx([])),
      file(ctx([seat({ status: "SHADOW" })])),
      file(ctx([seat()]), CLUB, []),
    ]) {
      expect(decision.allowed).toBe(false)
      expect(decision.detail.length).toBeGreaterThan(20)
    }
  })
})

describe("a seat becomes a grant of the bundle it carries", () => {
  it("grants at the club, not the tenant", () => {
    // Tenant scope would make a seat in one club a seat in all of them.
    const [grant] = seatGrants(ctx([seat()]), TENANT)
    expect(grant.scope).toEqual({ kind: "orgUnit", orgUnitId: CLUB })
  })

  it("names the template the seat carries", () => {
    const [grant] = seatGrants(ctx([seat({ templateKey: "finance.officer" })]), TENANT)
    expect(grant.roleKey).toBe("finance.officer")
    expect(lookupRoleTemplate(grant.roleKey)).not.toBeNull()
  })

  it("confirms an ACTIVE seat and holds a SHADOW one pending", () => {
    const grants = seatGrants(ctx([seat(), seat({ roleId: "r2", status: "SHADOW" })]), TENANT)
    expect(grants.map((g) => g.state)).toEqual(["CONFIRMED", "PENDING"])
  })

  it("keeps a SHADOW seat rather than dropping it", () => {
    // Dropping it would make the denial say "you have no role here", which is
    // the answer that generates a support ticket.
    expect(seatGrants(ctx([seat({ status: "SHADOW" })]), TENANT)).toHaveLength(1)
  })
})

describe("the world is built from what the application stores", () => {
  it("offers every shipped template as a role definition", () => {
    // A grant naming a template the world does not carry confers nothing, which
    // fails closed and silently.
    const world = seatWorld(ctx([seat()]), TENANT, MODULES)
    for (const grant of world.grants) {
      expect(world.roles.some((r) => r.key === grant.roleKey)).toBe(true)
    }
  })

  it("counts a seat holder as a member of the tenant", () => {
    expect(seatWorld(ctx([seat()]), TENANT, MODULES).memberships).toHaveLength(1)
  })

  it("counts an OSE member as one too, even with no seat", () => {
    // They are members; what they may do is decided elsewhere, because the
    // three institution roles do not map onto the shipped templates.
    const world = seatWorld(ctx([], [{ institutionId: TENANT, role: "OSE_DIRECTOR" }]), TENANT, MODULES)
    expect(world.memberships).toHaveLength(1)
    expect(world.grants).toEqual([])
  })

  it("counts somebody with neither as a member of nothing", () => {
    expect(seatWorld(ctx([]), TENANT, MODULES).memberships).toEqual([])
  })
})
