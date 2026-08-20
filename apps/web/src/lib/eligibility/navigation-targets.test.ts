import { lookupPermission, type AuthorizationWorld } from "@tenure/authorization"

import { NAV_CAPABILITIES } from "@/lib/authz/navigation-capabilities"

import { hiddenTargetReasons, visibleTargets } from "./module-scope"
import {
  NAVIGATION_TARGETS,
  navigationTargetAccess,
  type NavigationTargetInput,
} from "./navigation-targets"
import { validateTarget } from "./targets"

/**
 * IER-120-003 / IER-120-004 / IER-120-008 — the shipped menu targets, through
 * the composed gate, with the world `/api/me` actually builds.
 */

const NOW = new Date("2026-06-01T12:00:00.000Z")
const SUBJECT = "person-1"
const TENANT = "institution-1"

function world(over: Partial<AuthorizationWorld> = {}): AuthorizationWorld {
  return {
    principals: [{ id: SUBJECT, kind: "user" }],
    memberships: [
      { principalId: SUBJECT, tenantId: TENANT, state: "ACTIVE", effectiveFrom: "1970-01-01T00:00:00Z" },
    ],
    roles: [
      {
        key: "institution.OSE_DIRECTOR",
        permissions: [NAV_CAPABILITIES.administer, NAV_CAPABILITIES.viewReports],
      },
    ],
    grants: [
      {
        principalId: SUBJECT,
        tenantId: TENANT,
        roleKey: "institution.OSE_DIRECTOR",
        scope: { kind: "tenant" },
        state: "CONFIRMED",
        effectiveFrom: "1970-01-01T00:00:00Z",
      },
    ],
    enabledModules: ["administration", "budgeting", "dashboard"],
    ...over,
  }
}

function input(over: Partial<NavigationTargetInput> = {}): NavigationTargetInput {
  return {
    subjectId: SUBJECT,
    tenantId: TENANT,
    tenantCapabilities: ["dashboard", "administration", "budgeting"],
    entry: {
      accessState: "ACTIVE",
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      tenantCapabilities: ["dashboard", "administration", "budgeting"],
      now: NOW,
    },
    world: world(),
    ...over,
  }
}

describe("the shipped navigation targets", () => {
  it("are well-formed targets", () => {
    for (const { target } of NAVIGATION_TARGETS) expect(validateTarget(target)).toEqual([])
  })

  it("take each capability from the permission catalog rather than restating it", () => {
    for (const { target, permission } of NAVIGATION_TARGETS) {
      expect(target.capability).toBe(lookupPermission(permission)?.module)
    }
  })

  it("authorize the two permissions the menu is actually filtered by", () => {
    expect(NAVIGATION_TARGETS.map((t) => t.permission).sort()).toEqual(
      Object.values(NAV_CAPABILITIES).slice().sort(),
    )
  })
})

describe("IER-120-003 / IER-120-004 — every menu entry passes all three gates", () => {
  it("shows both entries to a director of an entitled tenant", () => {
    const decisions = navigationTargetAccess(input())
    expect(visibleTargets(decisions)).toEqual(["module:administration", "report:finance-reporting"])
    for (const d of decisions) expect(d.stage).toBe("SERVER_AUTHORIZATION")
  })

  it("hides the finance report when the tenant is not entitled to budgeting, before asking about the person", () => {
    const decisions = navigationTargetAccess(
      input({ tenantCapabilities: ["dashboard", "administration"] }),
    )
    expect(visibleTargets(decisions)).toEqual(["module:administration"])
    expect(hiddenTargetReasons(decisions)).toEqual({
      "report:finance-reporting": ["TENANT_CAPABILITY_NOT_ENTITLED"],
    })
    const hidden = decisions.find((d) => d.targetRef === "report:finance-reporting")
    expect(hidden?.eligibility).toBeNull()
  })

  it("hides both entries from a suspended member who still holds the grants", () => {
    const decisions = navigationTargetAccess(
      input({ entry: { ...input().entry, accessState: "SUSPENDED" } }),
    )
    expect(visibleTargets(decisions)).toEqual([])
    for (const d of decisions) {
      expect(d.stage).toBe("PERSON_ELIGIBILITY")
      expect(d.eligibility?.outcome).toBe("SUSPENDED")
      expect(d.authorization).toBeNull()
    }
  })

  it("hides both entries from an eligible person who holds no grants", () => {
    const decisions = navigationTargetAccess(input({ world: world({ grants: [] }) }))
    expect(visibleTargets(decisions)).toEqual([])
    for (const d of decisions) {
      expect(d.eligibility?.outcome).toBe("ELIGIBLE")
      expect(d.authorization?.reason).toBe("NO_ROLE_GRANTING")
    }
  })
})

describe("IER-120-008 — hidden-button bypass", () => {
  it("gives a client that calls for a hidden entry the same refusal the menu was built from", () => {
    const entitled = input({ tenantCapabilities: ["dashboard", "administration"] })
    const menu = visibleTargets(navigationTargetAccess(entitled))
    expect(menu).not.toContain("report:finance-reporting")

    // The same server entry point, called for the target the menu never
    // rendered. Nothing about the menu is an input to it.
    const direct = navigationTargetAccess(entitled).find(
      (d) => d.targetRef === "report:finance-reporting",
    )
    expect(direct?.allowed).toBe(false)
    expect(direct?.reasonCodes).toEqual(["TENANT_CAPABILITY_NOT_ENTITLED"])
  })

  it("does not let a person who can see one entry act through the other", () => {
    const reportsOnly = world({
      roles: [{ key: "institution.OSE_DIRECTOR", permissions: [NAV_CAPABILITIES.viewReports] }],
    })
    const decisions = navigationTargetAccess(input({ world: reportsOnly }))
    expect(visibleTargets(decisions)).toEqual(["report:finance-reporting"])
    const admin = decisions.find((d) => d.targetRef === "module:administration")
    expect(admin?.allowed).toBe(false)
    expect(admin?.authorization?.reason).toBe("NO_ROLE_GRANTING")
  })
})
