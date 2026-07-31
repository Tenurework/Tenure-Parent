import {
  ModuleCatalog,
  ModuleManifestError,
  ModuleResolutionError,
  expandDependencies,
  navigationFor,
  resolveModules,
  resolveModulesOrThrow,
  validateManifest,
  type ModuleManifest,
} from "./index"

const mod = (key: string, extra: Partial<ModuleManifest> = {}): ModuleManifest => ({
  key,
  version: "1.0.0",
  name: key,
  description: key,
  lifecycle: "available",
  ...extra,
})

const CATALOG = ModuleCatalog.of([
  mod("organizations", {
    navigation: [
      {
        id: "organizations.list",
        label: "All Clubs",
        href: "/orgs",
        section: "Community",
        sectionOrder: 20,
        order: 10,
        icon: "Building2",
      },
    ],
  }),
  mod("approvals", {
    dependsOn: ["organizations"],
    permissions: ["approvals.decide", "approvals.submit"],
    navigation: [
      {
        id: "approvals.inbox",
        label: "Approvals",
        href: "/approvals",
        section: "Operations",
        sectionOrder: 30,
        order: 10,
        icon: "CheckCircle",
      },
    ],
  }),
  mod("events", {
    dependsOn: ["organizations"],
    navigation: [
      {
        id: "events.calendar",
        label: "Calendar",
        href: "/calendar",
        section: "Operations",
        sectionOrder: 30,
        order: 20,
        icon: "Calendar",
      },
    ],
  }),
  mod("budgeting", {
    dependsOn: ["organizations"],
    requiresEntitlement: "finance",
    navigation: [
      {
        id: "budgeting.reports",
        label: "Reports",
        href: "/reports",
        section: "Overview",
        sectionOrder: 10,
        order: 20,
        icon: "BarChart3",
        requiresCapability: "institution.viewReports",
      },
    ],
  }),
  mod("ledger", { dependsOn: ["budgeting"], requiresEntitlement: "finance" }),
  mod("simpleCash", { incompatibleWith: ["ledger"] }),
  mod("nextGenApprovals", { lifecycle: "development" }),
  mod("legacyForms", { lifecycle: "retired" }),
  mod("oldMessaging", { lifecycle: "deprecated" }),
])

// ── manifests ───────────────────────────────────────────────────────────────

describe("a manifest is checked when it is declared", () => {
  it("refuses a permission not namespaced under its module", () => {
    // Otherwise a permission cannot be traced to whoever is responsible for it.
    expect(() => validateManifest(mod("finance", { permissions: ["budget.read"] }))).toThrow(
      /not namespaced under "finance\."/,
    )
  })

  it("refuses a nav entry not namespaced under its module", () => {
    expect(() =>
      validateManifest(
        mod("events", {
          navigation: [
            { id: "calendar", label: "Calendar", href: "/calendar", section: "Ops", sectionOrder: 1, order: 1, icon: "Calendar" },
          ],
        }),
      ),
    ).toThrow(/not namespaced under "events\."/)
  })

  it("refuses an href that is not an app path", () => {
    expect(() =>
      validateManifest(
        mod("events", {
          navigation: [
            {
              id: "events.x",
              label: "X",
              href: "https://evil.example.com",
              section: "Ops",
              sectionOrder: 1,
              order: 1,
              icon: "Calendar",
            },
          ],
        }),
      ),
    ).toThrow(/which is not an app path/)
  })

  it("refuses a module that depends on and forbids the same module", () => {
    expect(() =>
      validateManifest(mod("a", { dependsOn: ["b"], incompatibleWith: ["b"] })),
    ).toThrow(/both depends on and is incompatible with/)
  })

  it("refuses self-dependency", () => {
    expect(() => validateManifest(mod("a", { dependsOn: ["a"] }))).toThrow(ModuleManifestError)
  })

  it("refuses a catalog whose dependency does not exist", () => {
    // A catalog defect, caught once, rather than for every tenant that resolves.
    expect(() => ModuleCatalog.of([mod("a", { dependsOn: ["ghost"] })])).toThrow(
      /depends on "ghost", which is not in the catalog/,
    )
  })

  it("refuses duplicate module keys", () => {
    expect(() => ModuleCatalog.of([mod("a"), mod("a")])).toThrow(/Duplicate module key/)
  })
})

// ── resolution ──────────────────────────────────────────────────────────────

describe("resolution decides what a system runs", () => {
  it("enables a valid set in dependency order", () => {
    const r = resolveModulesOrThrow(CATALOG, {
      requested: ["approvals", "events", "organizations"],
    })
    expect(r.problems).toEqual([])
    // organizations before both dependants, whatever order they were asked in.
    expect(r.keys.indexOf("organizations")).toBeLessThan(r.keys.indexOf("approvals"))
    expect(r.keys.indexOf("organizations")).toBeLessThan(r.keys.indexOf("events"))
  })

  it("refuses a missing dependency instead of quietly adding it", () => {
    // A package manager may pull transitive dependencies. A platform enabling a
    // module a customer did not buy, and that appears in no approved release,
    // is a different thing.
    const r = resolveModules(CATALOG, { requested: ["approvals"] })
    expect(r.problems).toEqual([
      {
        moduleKey: "approvals",
        reason: "missing-dependency",
        detail: `Needs "organizations", which is not enabled. Add it to the requested set.`,
      },
    ])
  })

  it("offers the expansion separately, so an operator can approve it", () => {
    expect(expandDependencies(CATALOG, ["ledger"])).toEqual(["budgeting", "ledger", "organizations"])
  })

  it("refuses two incompatible modules together", () => {
    const r = resolveModules(CATALOG, {
      requested: ["organizations", "budgeting", "ledger", "simpleCash"],
      entitlements: ["finance"],
    })
    expect(r.problems.map((p) => p.reason)).toContain("incompatible")
  })

  it("refuses a module the tenant is not entitled to, and says so", () => {
    const r = resolveModules(CATALOG, { requested: ["organizations", "budgeting"] })
    expect(r.problems).toEqual([
      {
        moduleKey: "budgeting",
        reason: "missing-entitlement",
        detail: `Requires entitlement "finance", which this tenant does not hold.`,
      },
    ])
    // Fail closed: it is absent, not present-but-degraded.
    expect(r.keys).toEqual(["organizations"])
  })

  it("enables it once the entitlement is held", () => {
    const r = resolveModulesOrThrow(CATALOG, {
      requested: ["organizations", "budgeting"],
      entitlements: ["finance"],
    })
    expect(r.keys).toContain("budgeting")
  })

  it("refuses a module that is not ready, with the reason", () => {
    // "Why can't I turn this on?" gets an answer instead of a 404.
    const r = resolveModules(CATALOG, { requested: ["nextGenApprovals"] })
    expect(r.problems[0].reason).toBe("not-enableable")
    expect(r.problems[0].detail).toContain("development")
  })

  it("refuses a retired module", () => {
    expect(resolveModules(CATALOG, { requested: ["legacyForms"] }).problems[0].reason).toBe(
      "not-enableable",
    )
  })

  it("still enables a deprecated module a tenant already has", () => {
    // Deprecation is a signal to stop adopting, not an outage for whoever has it.
    expect(resolveModulesOrThrow(CATALOG, { requested: ["oldMessaging"] }).keys).toEqual([
      "oldMessaging",
    ])
  })

  it("refuses an unknown module", () => {
    expect(resolveModules(CATALOG, { requested: ["telepathy"] }).problems[0].reason).toBe(
      "unknown-module",
    )
  })

  it("detects a dependency cycle rather than looping", () => {
    const cyclic = ModuleCatalog.of([
      mod("a", { dependsOn: ["b"] }),
      mod("b", { dependsOn: ["c"] }),
      mod("c", { dependsOn: ["a"] }),
    ])
    const r = resolveModules(cyclic, { requested: ["a", "b", "c"] })
    expect(r.problems.map((p) => p.reason)).toContain("dependency-cycle")
  })

  it("throws on the request path rather than returning a half-configured system", () => {
    expect(() => resolveModulesOrThrow(CATALOG, { requested: ["approvals"] })).toThrow(
      ModuleResolutionError,
    )
  })

  it("ignores duplicates in the request", () => {
    const r = resolveModulesOrThrow(CATALOG, { requested: ["organizations", "organizations"] })
    expect(r.keys).toEqual(["organizations"])
  })
})

// ── navigation ──────────────────────────────────────────────────────────────

describe("navigation is contributed by modules, not hardcoded", () => {
  const enabled = resolveModulesOrThrow(CATALOG, {
    requested: ["organizations", "approvals", "events", "budgeting"],
    entitlements: ["finance"],
  }).ordered

  it("groups and orders sections deterministically", () => {
    const nav = navigationFor(enabled, null)
    expect(nav.map((s) => s.label)).toEqual(["Overview", "Community", "Operations"])
    expect(nav.find((s) => s.label === "Operations")!.items.map((i) => i.label)).toEqual([
      "Approvals",
      "Calendar",
    ])
  })

  it("lets two modules contribute to one section", () => {
    const ops = navigationFor(enabled, null).find((s) => s.label === "Operations")!
    expect(ops.items).toHaveLength(2)
  })

  it("drops the whole section when its only module is disabled", () => {
    const withoutFinance = resolveModulesOrThrow(CATALOG, { requested: ["organizations"] }).ordered
    expect(navigationFor(withoutFinance, null).map((s) => s.label)).toEqual(["Community"])
  })

  it("hides an entry the principal has no capability for", () => {
    const nav = navigationFor(enabled, new Set<string>())
    expect(nav.map((s) => s.label)).not.toContain("Overview")

    const withCap = navigationFor(enabled, new Set(["institution.viewReports"]))
    expect(withCap.find((s) => s.label === "Overview")!.items.map((i) => i.label)).toEqual([
      "Reports",
    ])
  })

  it("shows everything when filtering is switched off, for operator views", () => {
    expect(navigationFor(enabled, null).map((s) => s.label)).toContain("Overview")
  })

  it("is stable regardless of the order modules were resolved in", () => {
    const a = navigationFor(enabled, null)
    const b = navigationFor([...enabled].reverse(), null)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
