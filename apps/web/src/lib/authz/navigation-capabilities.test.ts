import { isPermissionKey, lookupPermission } from "@tenure/authorization"

import type { InstitutionRole } from "@prisma/client"

import type { OrgRole, UserContext } from "@/lib/rbac"

import { NAV_CAPABILITIES, navigationCapabilitiesFor, worldFor } from "./navigation-capabilities"

/**
 * The one place `apps/web` asks the authorization engine anything.
 *
 * It had no test. GE-051-001 made `decide()` refuse a permission the catalog
 * does not declare, and both capabilities here were strings invented in this
 * file — so the admin link vanished for every OSE user and 2665 unit tests
 * stayed green. The e2e suite caught it, four minutes of CI later.
 *
 * The first test below is the one that would have caught it in two seconds.
 */

const AT = "2026-08-03T12:00:00Z"
const INSTITUTION = "inst-1"

const SEAT: OrgRole = {
  organizationId: "club-1",
  roleId: "role-1",
  roleName: "President",
  scope: "PRESIDENT",
  status: "ACTIVE",
}

const ctx = (over: Partial<UserContext> = {}): UserContext => ({
  userId: "u1",
  institutionRoles: [{ institutionId: INSTITUTION, role: "OSE_DIRECTOR" }],
  orgRoles: [],
  ...over,
})

const ALL_MODULES = ["administration", "budgeting"]

describe("every navigation capability is a real permission", () => {
  it("names keys the catalog declares", () => {
    // A capability the catalog does not declare is denied outright, so the menu
    // entry it guards silently disappears. Nothing else in this app asks the
    // engine, which is exactly why nothing else would notice.
    const unknown = Object.entries(NAV_CAPABILITIES)
      .filter(([, key]) => !isPermissionKey(key))
      .map(([name, key]) => `${name} -> "${key}"`)
    expect(unknown).toEqual([])
  })

  it("names keys whose modules are the ones these entries belong to", () => {
    // The module gate is the reason these are permissions rather than booleans.
    expect(lookupPermission(NAV_CAPABILITIES.administer)?.module).toBe("administration")
    expect(lookupPermission(NAV_CAPABILITIES.viewReports)?.module).toBe("budgeting")
  })
})

describe("who sees the menu entries", () => {
  it("gives an OSE Director both", () => {
    const held = navigationCapabilitiesFor(ctx(), INSTITUTION, ALL_MODULES, AT)
    expect(held.has(NAV_CAPABILITIES.administer)).toBe(true)
    expect(held.has(NAV_CAPABILITIES.viewReports)).toBe(true)
  })

  it("gives OSE Staff and Advisor the same, deliberately", () => {
    // Unchanged from `institutionRoles.length > 0`. Narrowing Advisor is a
    // product decision; this test exists so that narrowing it is a visible
    // change rather than a silent one.
    for (const role of ["OSE_STAFF", "OSE_ADVISOR"] as InstitutionRole[]) {
      const held = navigationCapabilitiesFor(
        ctx({ institutionRoles: [{ institutionId: INSTITUTION, role }] }),
        INSTITUTION,
        ALL_MODULES,
        AT,
      )
      expect([...held].sort()).toEqual(
        [NAV_CAPABILITIES.administer, NAV_CAPABILITIES.viewReports].sort(),
      )
    }
  })

  it("gives a club officer with no institution role neither", () => {
    const held = navigationCapabilitiesFor(
      ctx({
        institutionRoles: [],
        orgRoles: [SEAT],
      }),
      INSTITUTION,
      ALL_MODULES,
      AT,
    )
    expect([...held]).toEqual([])
  })

  it("still counts a club officer as a member of the tenant", () => {
    // Without the membership projection they would resolve to NO_MEMBERSHIP,
    // which is a different denial with different consequences elsewhere.
    const world = worldFor(
      ctx({
        institutionRoles: [],
        orgRoles: [SEAT],
      }),
      INSTITUTION,
      ALL_MODULES,
    )
    expect(world.memberships).toHaveLength(1)
    expect(world.memberships[0].state).toBe("ACTIVE")
  })
})

describe("a capability belonging to a module the system does not run is not held", () => {
  it("drops the admin entry when administration is off", () => {
    const held = navigationCapabilitiesFor(ctx(), INSTITUTION, ["budgeting"], AT)
    expect(held.has(NAV_CAPABILITIES.administer)).toBe(false)
    expect(held.has(NAV_CAPABILITIES.viewReports)).toBe(true)
  })

  it("drops the reports entry when budgeting is off", () => {
    const held = navigationCapabilitiesFor(ctx(), INSTITUTION, ["administration"], AT)
    expect(held.has(NAV_CAPABILITIES.viewReports)).toBe(false)
    expect(held.has(NAV_CAPABILITIES.administer)).toBe(true)
  })

  it("drops both when the system runs neither", () => {
    expect([...navigationCapabilitiesFor(ctx(), INSTITUTION, [], AT)]).toEqual([])
  })
})

describe("the world is built from what the application stores", () => {
  it("grants only roles held in the institution being asked about", () => {
    const world = worldFor(
      ctx({
        institutionRoles: [
          { institutionId: INSTITUTION, role: "OSE_DIRECTOR" },
          { institutionId: "other-inst", role: "OSE_DIRECTOR" },
        ],
      }),
      INSTITUTION,
      ALL_MODULES,
    )
    expect(world.grants).toHaveLength(1)
    expect(world.grants[0].tenantId).toBe(INSTITUTION)
  })

  it("does not hand a role held elsewhere any capability here", () => {
    const held = navigationCapabilitiesFor(
      ctx({ institutionRoles: [{ institutionId: "other-inst", role: "OSE_DIRECTOR" }] }),
      INSTITUTION,
      ALL_MODULES,
      AT,
    )
    expect([...held]).toEqual([])
  })
})
