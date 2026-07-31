import { getBlueprint, TENANT_BINDINGS } from "@tenure/blueprints"
import { MODULE_CATALOG } from "@tenure/modules"

import { hasModule, modulesFor, navigationForSystem } from "./system-modules"

const ALL = null // show every entry, regardless of capability

describe("a system runs the modules its blueprint selects", () => {
  it("gives Simon OSE everything the pilot has today", () => {
    const keys = modulesFor("rochester").keys
    expect(keys).toEqual(
      expect.arrayContaining([
        "dashboard",
        "organizations",
        "feed",
        "messaging",
        "approvals",
        "events",
        "resources",
        "search",
        "memory",
        "budgeting",
        "reimbursements",
        "administration",
      ]),
    )
    expect(modulesFor("rochester").problems).toEqual([])
  })

  it("enables dependencies before the modules that need them", () => {
    const keys = modulesFor("rochester").keys
    expect(keys.indexOf("organizations")).toBeLessThan(keys.indexOf("approvals"))
    expect(keys.indexOf("budgeting")).toBeLessThan(keys.indexOf("reimbursements"))
  })

  it("gives the nonprofit a genuinely different system, not the same one renamed", () => {
    const np = modulesFor("midtown-arts").keys
    // No community feed, no student messaging, no reimbursements.
    expect(np).not.toContain("feed")
    expect(np).not.toContain("messaging")
    expect(np).not.toContain("reimbursements")
    expect(np).toContain("approvals")
  })
})

describe("entitlements gate modules, and say so when they refuse", () => {
  it("refuses budgeting for a tenant without the finance entitlement", () => {
    // In its blueprint, absent from the running system, with the reason attached
    // — which is what turns "why is Reports missing?" into a one-line answer.
    const { keys, problems } = modulesFor("midtown-arts")
    expect(keys).not.toContain("budgeting")
    expect(problems).toEqual([
      {
        moduleKey: "budgeting",
        reason: "missing-entitlement",
        detail: `Requires entitlement "finance", which this tenant does not hold.`,
      },
    ])
  })

  it("grants it for the tenant that holds the entitlement", () => {
    expect(hasModule("rochester", "budgeting")).toBe(true)
    expect(hasModule("midtown-arts", "budgeting")).toBe(false)
  })

  it("gives an unbound institution the front door only, not everything", () => {
    // An unconfigured tenant should look empty rather than fully provisioned.
    const { keys } = modulesFor("not-a-tenant-yet")
    expect(keys).toEqual(["dashboard"])
  })
})

describe("navigation is what the enabled modules contribute", () => {
  it("builds the pilot's menu from modules rather than from two booleans", () => {
    const nav = navigationForSystem("rochester", ALL)
    expect(nav.map((s) => s.label)).toEqual([
      "Administration",
      "Overview",
      "Community",
      "Operations",
      "Knowledge",
    ])
    expect(nav.find((s) => s.label === "Community")!.items.map((i) => i.label)).toEqual([
      "Community Feed",
      "All Clubs",
      "Messages",
    ])
  })

  it("gives the nonprofit a shorter menu, because it runs fewer modules", () => {
    const nav = navigationForSystem("midtown-arts", ALL)
    const labels = nav.flatMap((s) => s.items.map((i) => i.label))
    expect(labels).not.toContain("Community Feed")
    expect(labels).not.toContain("Messages")
    expect(labels).not.toContain("Reports") // budgeting refused on entitlement
    expect(labels).toContain("Approvals")
  })

  it("hides entries the principal has no capability for", () => {
    const none = navigationForSystem("rochester", new Set<string>())
    expect(none.map((s) => s.label)).not.toContain("Administration")
    expect(none.flatMap((s) => s.items.map((i) => i.label))).not.toContain("Reports")

    const admin = navigationForSystem(
      "rochester",
      new Set(["institution.administer", "institution.viewReports"]),
    )
    expect(admin.map((s) => s.label)).toContain("Administration")
    expect(admin.flatMap((s) => s.items.map((i) => i.label))).toContain("Reports")
  })

  it("keeps every href pointing at a route the app actually serves", () => {
    // A manifest over working code is falsifiable; this is what falsifies it.
    // Routes that exist as app/(app)/<x>/page.tsx.
    const served = new Set([
      "/dashboard",
      "/orgs",
      "/feed",
      "/messages",
      "/approvals",
      "/calendar",
      "/resources",
      "/search",
      "/reports",
      "/admin",
    ])
    for (const section of navigationForSystem("rochester", ALL)) {
      for (const item of section.items) {
        expect(served.has(item.href)).toBe(true)
      }
    }
  })
})

describe("every blueprint's module selection actually resolves", () => {
  it.each(TENANT_BINDINGS.map((b) => [b.slug, b] as const))("%s", (slug, binding) => {
    const blueprint = getBlueprint(binding.blueprintId)!
    for (const key of blueprint.modules) {
      expect(MODULE_CATALOG.has(key)).toBe(true)
    }
    // Only entitlement refusals are acceptable; a missing dependency or an
    // unknown module in a shipped blueprint is a defect.
    for (const p of modulesFor(slug).problems) {
      expect(p.reason).toBe("missing-entitlement")
    }
  })
})
