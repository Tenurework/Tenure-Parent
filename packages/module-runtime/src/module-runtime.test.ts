import { compareVersionStrings } from "@tenure/platform-config"

import {
  AmbiguousAlternativeError,
  COMPLETENESS_DIMENSIONS,
  ModuleCatalog,
  ModuleManifestError,
  ModuleResolutionError,
  expandDependencies,
  navigationFor,
  resolveModules,
  resolveModulesOrThrow,
  satisfiesRange,
  validateManifest,
  type ModuleDependency,
  type ModuleManifest,
} from "./index"

/**
 * The real comparator, not a stand-in.
 *
 * `resolveModules` takes the version comparison as an argument because
 * `@tenure/platform-config` owns the only copy and imports this package, so this
 * package cannot import it back. A fake here — `(a, b) => a < b ? -1 : 1` — would
 * pass every assertion below and disagree with production on 1.10.0 vs 1.9.0,
 * which is the exact bug the single-copy rule exists to prevent. The test
 * imports the production function.
 */
const compareVersions = compareVersionStrings

/**
 * The seventeen dimensions, stated for a module that ships nowhere.
 *
 * A fixture declaring `available` has to satisfy the same contract the real
 * catalog does — that is the point of the contract — and the honest verdict for
 * a module that exists only inside this file is that none of the dimensions
 * applies to it. Written once here rather than per fixture so that the
 * assertions below are about resolution, not about paperwork.
 */
const FIXTURE_DIMENSIONS = Object.fromEntries(
  COMPLETENESS_DIMENSIONS.map((d) => [
    d,
    {
      status: "not-applicable" as const,
      evidence: "Fixture module declared in module-runtime.test.ts; it governs nothing and ships nowhere.",
    },
  ]),
) as ModuleManifest["dimensions"]

const mod = (key: string, extra: Partial<ModuleManifest> = {}): ModuleManifest => ({
  key,
  version: "1.0.0",
  name: key,
  description: key,
  owner: "erp-modules",
  lifecycle: "available",
  dimensions: FIXTURE_DIMENSIONS,
  ...extra,
})

/** `dependsOn` shorthand for a fixture: required, any version. */
const on = (...keys: string[]): ModuleDependency[] =>
  keys.map((module) => ({ module, range: "*", kind: "required" as const }))

/**
 * Fixture catalogs are not the shipped one.
 *
 * `ModuleCatalog.of` reconciles against the permission catalog's `MODULE_KEYS`
 * and the shipped role templates by default (PACK-GATE-000), which is exactly
 * what production wants and exactly what a catalog of three made-up modules
 * cannot satisfy. Opting out here is explicit so that a real catalog cannot
 * acquire the exemption by accident.
 */
const UNGOVERNED = { governedKeys: null, roles: null } as const

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
    dependsOn: on("organizations"),
    permissions: ["approvals.request.decide", "approvals.request.create"],
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
    dependsOn: on("organizations"),
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
    dependsOn: on("organizations"),
    requiresEntitlement: "finance",
    provides: ["finance.ledgerCapability"],
    navigation: [
      {
        id: "budgeting.reports",
        label: "Reports",
        href: "/reports",
        section: "Overview",
        sectionOrder: 10,
        order: 20,
        icon: "BarChart3",
        requiresCapability: "finance.report.read",
      },
    ],
  }),
  mod("ledger", { dependsOn: on("budgeting"), requiresEntitlement: "finance" }),
  mod("simpleCash", { incompatibleWith: ["ledger"] }),
  mod("nextGenApprovals", { lifecycle: "development" }),
  mod("legacyForms", { lifecycle: "retired" }),
  mod("oldMessaging", { lifecycle: "deprecated" }),
], [], UNGOVERNED)

// ── manifests ───────────────────────────────────────────────────────────────

describe("a manifest is checked when it is declared", () => {
  it("refuses a permission the catalog does not declare", () => {
    // A module cannot confer a capability nothing can grant. This replaced a
    // rule that a permission must start with `<key>.`, which the platform's own
    // domains break: `finance.budget.read` is the budgeting module.
    expect(() => validateManifest(mod("budgeting", { permissions: ["budget.read"] }))).toThrow(
      /not in the permission catalog/,
    )
  })

  it("refuses a permission the catalog gates on a different module", () => {
    // Declaring it would advertise a capability that turning this module on
    // cannot actually give.
    expect(() =>
      validateManifest(mod("budgeting", { permissions: ["finance.reimbursement.approve"] })),
    ).toThrow(/gates on module "reimbursements"/)
  })

  it("accepts a permission whose domain is not its module key", () => {
    // The case the old prefix rule could not express.
    expect(() =>
      validateManifest(mod("budgeting", { permissions: ["finance.budget.read"] })),
    ).not.toThrow()
  })

  it("accepts a platform-level permission from any module", () => {
    expect(() =>
      validateManifest(mod("budgeting", { permissions: ["admin.audit.read"] })),
    ).not.toThrow()
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
      validateManifest(mod("a", { dependsOn: on("b"), incompatibleWith: ["b"] })),
    ).toThrow(/both depends on and is incompatible with/)
  })

  it("refuses self-dependency", () => {
    expect(() => validateManifest(mod("a", { dependsOn: on("a") }))).toThrow(ModuleManifestError)
  })

  it("refuses a catalog whose dependency does not exist", () => {
    // A catalog defect, caught once, rather than for every tenant that resolves.
    expect(() => ModuleCatalog.of([mod("a", { dependsOn: on("ghost") })], [], UNGOVERNED)).toThrow(
      /depends on "ghost", which is not in the catalog/,
    )
  })

  it("refuses duplicate module keys", () => {
    expect(() => ModuleCatalog.of([mod("a"), mod("a")], [], UNGOVERNED)).toThrow(/Duplicate module key/)
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
    expect(r.problems.map((p) => [p.moduleKey, p.reason])).toEqual([
      ["approvals", "missing-dependency"],
    ])
    expect(r.problems[0].detail).toContain(`Needs "organizations"`)
    // PACK-GATE-010. The assertion that was missing, and the one that matters:
    // the offender is REMOVED, not reported and then enabled anyway. Before
    // this, `problems` said no and `keys` said yes, and the only production
    // consumer reads `keys`.
    expect(r.keys).toEqual([])
    expect(r.ordered).toEqual([])
  })

  it("removes the second-order dependant too, which one pass would not", () => {
    // ledger → budgeting → organizations. Asking for the top two without the
    // base has to drop BOTH: a single removal pass drops `budgeting` and leaves
    // `ledger` enabled with its dependency gone, which is a worse system than
    // either refusing or accepting.
    const r = resolveModules(CATALOG, {
      requested: ["ledger", "budgeting"],
      entitlements: ["finance"],
    })
    expect(r.keys).toEqual([])
    expect(r.problems.map((p) => p.moduleKey).sort()).toEqual(["budgeting", "ledger"])
  })

  it("offers the expansion separately, so an operator can approve it", () => {
    expect(expandDependencies(CATALOG, ["ledger"])).toEqual(["budgeting", "ledger", "organizations"])
  })

  it("refuses two incompatible modules together", () => {
    const r = resolveModules(CATALOG, {
      requested: ["organizations", "budgeting", "ledger", "simpleCash"],
      entitlements: ["finance"],
      compareVersions,
    })
    expect(r.problems.map((p) => p.reason)).toContain("incompatible")
    // Both members go. Keeping either would be the resolver choosing which of
    // two modules the operator meant — and the operator asked for both.
    expect(r.keys).not.toContain("ledger")
    expect(r.keys).not.toContain("simpleCash")
    // And what did not conflict is untouched.
    expect(r.keys).toEqual(["organizations", "budgeting"])
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
    const cyclic = ModuleCatalog.of(
      [mod("a", { dependsOn: on("b") }), mod("b", { dependsOn: on("c") }), mod("c", { dependsOn: on("a") })],
      [],
      UNGOVERNED,
    )
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

    const withCap = navigationFor(enabled, new Set(["finance.report.read"]))
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

// ── the completeness contract ───────────────────────────────────────────────

describe("an availability claim has to be backed by evidence", () => {
  const complete = (status: "pass" | "gap" | "not-applicable" = "pass") =>
    Object.fromEntries(
      COMPLETENESS_DIMENSIONS.map((d) => [d, { status, evidence: `evidence for ${d}` }]),
    ) as ModuleManifest["dimensions"]

  it("refuses `available` from a manifest that assesses nothing", () => {
    // PACK-000-002 / PACK-000-004. Before this, twelve of twelve manifests said
    // `available` and nothing checked it against anything — Bible §6 says a
    // product name, a nav item and a table do not pass, and that is exactly what
    // those declarations were.
    expect(() => validateManifest({ ...mod("a"), dimensions: undefined })).toThrow(
      /without assessing 17 of the seventeen completeness dimensions/,
    )
  })

  it("refuses `available` when one dimension is short", () => {
    const rest = { ...complete() }
    delete rest["accounting-controls-and-reconciliation"]
    expect(() => validateManifest({ ...mod("a"), dimensions: rest })).toThrow(
      /accounting-controls-and-reconciliation/,
    )
  })

  it("refuses `available` beside a declared gap, which is a contradiction", () => {
    expect(() =>
      validateManifest({
        ...mod("a"),
        dimensions: {
          ...complete(),
          "accounting-controls-and-reconciliation": { status: "gap", evidence: "no reconciliation here" },
        },
        gaps: [
          {
            dimension: "accounting-controls-and-reconciliation",
            detail: "Nothing reconciles the ledger against an external record.",
          },
        ],
      }),
    ).toThrow(/is "available" and declares 1 gap/)
  })

  it("accepts the same manifest as certified-limited", () => {
    // The state the whole shipped catalog is actually in. Bible §6: a pack
    // missing an applicable dimension remains SPECIFIED, DEVELOPING or
    // CERTIFIED_LIMITED — it does not stop existing.
    expect(() =>
      validateManifest({
        ...mod("a"),
        lifecycle: "certified-limited",
        dimensions: {
          ...complete(),
          "accounting-controls-and-reconciliation": { status: "gap", evidence: "no reconciliation here" },
        },
        gaps: [
          {
            dimension: "accounting-controls-and-reconciliation",
            detail: "Nothing reconciles the ledger against an external record.",
          },
        ],
      }),
    ).not.toThrow()
  })

  it("refuses a gap assessed in one place and not the other, in both directions", () => {
    // The two fields have to agree or the classification rots into a list
    // somebody stopped maintaining.
    expect(() =>
      validateManifest({
        ...mod("a"),
        lifecycle: "certified-limited",
        dimensions: {
          ...complete(),
          "observability-slo-and-finops": { status: "gap", evidence: "nothing observes it" },
        },
        gaps: [{ dimension: "search-analytics-and-memory", detail: "an unrelated declared gap" }],
      }),
    ).toThrow(/does not list it in `gaps`/)

    expect(() =>
      validateManifest({
        ...mod("a"),
        lifecycle: "certified-limited",
        dimensions: complete(),
        gaps: [
          { dimension: "observability-slo-and-finops", detail: "declared here, assessed pass there" },
        ],
      }),
    ).toThrow(/while assessing it as "pass"/)
  })

  it("refuses certified-limited with no gap — limited by what?", () => {
    expect(() =>
      validateManifest({ ...mod("a"), lifecycle: "certified-limited", dimensions: complete() }),
    ).toThrow(/declares no gap/)
  })

  it("refuses an assessment with no evidence anybody could check", () => {
    expect(() =>
      validateManifest({
        ...mod("a"),
        dimensions: {
          ...complete(),
          "ux-routes-forms-and-accessibility": { status: "pass", evidence: "yes" },
        },
      }),
    ).toThrow(/with no evidence/)
  })

  it("refuses a manifest that names no owner", () => {
    // PACK-040-002. A capability nobody owns is one nobody is paged for.
    expect(() => validateManifest({ ...mod("a"), owner: "" })).toThrow(/names no owner/)
  })
})

// ── modes, suspension and the support window ────────────────────────────────

describe("a module can be withdrawn, suspended or unsupported", () => {
  const LATER = "2030-01-01T00:00:00Z"

  const withdrawn = ModuleCatalog.of(
    [
      mod("base"),
      mod("unavailable", { mode: "UNAVAILABLE" }),
      mod("readOnly", { mode: "READ_ONLY" }),
      mod("suspended", {
        suspension: {
          kind: "security",
          since: "2026-07-01",
          reason: "An authorization bypass was found in its export path.",
        },
      }),
      mod("suspendedAndUnentitled", {
        requiresEntitlement: "finance",
        suspension: {
          kind: "regulatory",
          since: "2026-07-01",
          reason: "Withdrawn pending a regulator's decision on the export.",
        },
      }),
      mod("sunsetting", { supportEndsAt: "2027-01-01" }),
    ],
    [],
    UNGOVERNED,
  )

  it("refuses an UNAVAILABLE module rather than rendering a surface that does nothing", () => {
    const r = resolveModules(withdrawn, { requested: ["unavailable"] })
    expect(r.problems[0].reason).toBe("mode-unavailable")
    expect(r.keys).toEqual([])
  })

  it("refuses a suspended module and says which suspension it is", () => {
    const r = resolveModules(withdrawn, { requested: ["suspended"] })
    expect(r.problems[0].reason).toBe("suspended")
    expect(r.problems[0].detail).toContain("security")
    expect(r.problems[0].detail).toContain("authorization bypass")
    expect(r.keys).toEqual([])
  })

  it("reports the suspension ahead of the entitlement, because it is the true answer", () => {
    // Both apply. "You are not entitled" would send an operator to sell an
    // upgrade that cannot help — the module was withdrawn. Moving the suspension
    // check below the entitlement check is what this catches.
    const r = resolveModules(withdrawn, { requested: ["suspendedAndUnentitled"] })
    expect(r.problems[0].reason).toBe("suspended")
  })

  it("refuses a module past its support window, at the date given", () => {
    expect(
      resolveModules(withdrawn, { requested: ["sunsetting"], at: LATER }).problems[0].reason,
    ).toBe("support-ended")
    // And enables it before that date, with the end named.
    const before = resolveModules(withdrawn, {
      requested: ["sunsetting"],
      at: "2026-08-01T00:00:00Z",
    })
    expect(before.keys).toEqual(["sunsetting"])
    expect(before.advisories.map((a) => a.kind)).toEqual(["support-ending"])
    expect(before.advisories[0].detail).toContain("2027-01-01")
  })

  it("advises on a read-only module rather than letting it look like any other", () => {
    const r = resolveModules(withdrawn, { requested: ["readOnly"] })
    expect(r.keys).toEqual(["readOnly"])
    expect(r.advisories).toEqual([
      {
        moduleKey: "readOnly",
        kind: "read-only",
        detail: "Read-only: it ingests, views and searches, and writes nothing back.",
      },
    ])
  })

  it("advises on a deprecated module, which used to be completely silent", () => {
    const r = resolveModulesOrThrow(CATALOG, { requested: ["oldMessaging"] })
    expect(r.keys).toEqual(["oldMessaging"])
    expect(r.advisories.map((a) => a.kind)).toEqual(["deprecated"])
  })
})

// ── alternatives, version ranges and the engine ─────────────────────────────

describe("a dependency is a range on a capability, not a bare key", () => {
  const ledgers = ModuleCatalog.of(
    [
      mod("classicLedger", { version: "1.4.0", provides: ["finance.ledgerCapability"] }),
      mod("nextLedger", { version: "2.0.0", provides: ["finance.ledgerCapability"] }),
      mod("claims", {
        dependsOn: [{ module: "finance.ledgerCapability", range: ">=1.0.0", kind: "required" }],
      }),
      mod("modernClaims", {
        dependsOn: [{ module: "finance.ledgerCapability", range: ">=2.0.0", kind: "required" }],
      }),
      mod("reporting", {
        dependsOn: [{ module: "classicLedger", range: ">=1.10.0", kind: "required" }],
      }),
      mod("optionalReader", {
        dependsOn: [{ module: "classicLedger", range: ">=2.0.0", kind: "optional" }],
      }),
      mod("futureModule", { requiresEngine: "2.0.0" }),
      mod("currentModule", { requiresEngine: "1.9.0" }),
    ],
    [],
    UNGOVERNED,
  )

  it("is satisfied by anything that provides the capability", () => {
    const r = resolveModulesOrThrow(ledgers, {
      requested: ["claims", "classicLedger"],
      compareVersions,
    })
    expect(r.keys).toEqual(["classicLedger", "claims"])
  })

  it("is satisfied by the other provider just as well", () => {
    expect(
      resolveModulesOrThrow(ledgers, { requested: ["claims", "nextLedger"], compareVersions }).keys,
    ).toEqual(["nextLedger", "claims"])
  })

  it("names every module that WOULD satisfy it when none is enabled", () => {
    // What makes an alternative actionable rather than a second name for the
    // same failure.
    const r = resolveModules(ledgers, { requested: ["claims"], compareVersions })
    expect(r.problems[0].reason).toBe("missing-dependency")
    expect(r.problems[0].detail).toContain("classicLedger")
    expect(r.problems[0].detail).toContain("nextLedger")
    expect(r.keys).toEqual([])
  })

  it("refuses a provider whose version is below the range", () => {
    const r = resolveModules(ledgers, {
      requested: ["modernClaims", "classicLedger"],
      compareVersions,
    })
    expect(r.problems.map((p) => p.reason)).toEqual(["version-out-of-range"])
    expect(r.problems[0].detail).toContain("classicLedger@1.4.0")
    expect(r.keys).toEqual(["classicLedger"])
  })

  it("accepts the provider that does satisfy it", () => {
    expect(
      resolveModulesOrThrow(ledgers, {
        requested: ["modernClaims", "nextLedger"],
        compareVersions,
      }).keys,
    ).toContain("modernClaims")
  })

  it("compares versions numerically, so 1.4.0 does not satisfy >=1.10.0", () => {
    // A string compare says "1.4.0" > "1.10.0" and lets this through. This is
    // the assertion that proves the injected comparator is the real one.
    const r = resolveModules(ledgers, {
      requested: ["reporting", "classicLedger"],
      compareVersions,
    })
    expect(r.problems.map((p) => p.reason)).toEqual(["version-out-of-range"])
  })

  it("lets an optional dependency be absent, and still holds it to its range", () => {
    expect(
      resolveModulesOrThrow(ledgers, { requested: ["optionalReader"], compareVersions }).keys,
    ).toEqual(["optionalReader"])

    const incompatible = resolveModules(ledgers, {
      requested: ["optionalReader", "classicLedger"],
      compareVersions,
    })
    expect(incompatible.problems.map((p) => p.reason)).toEqual(["version-out-of-range"])
  })

  it("fails closed when no comparator is supplied and a range is not a wildcard", () => {
    const r = resolveModules(ledgers, { requested: ["claims", "classicLedger"] })
    expect(r.problems[0].reason).toBe("version-out-of-range")
    expect(r.problems[0].detail).toContain("No version comparator was supplied")
  })

  it("refuses a module the running engine is too old for", () => {
    const r = resolveModules(ledgers, {
      requested: ["futureModule"],
      runningEngineVersion: "1.9.0",
      compareVersions,
    })
    expect(r.problems[0].reason).toBe("engine-too-old")
    expect(r.keys).toEqual([])
  })

  it("does not refuse 1.10.0 under an engine needing 1.9.0", () => {
    // Numeric again, in the direction a string compare gets wrong.
    expect(
      resolveModulesOrThrow(ledgers, {
        requested: ["currentModule"],
        runningEngineVersion: "1.10.0",
        compareVersions,
      }).keys,
    ).toEqual(["currentModule"])
  })

  it("refuses when the caller cannot say which engine is running", () => {
    const r = resolveModules(ledgers, { requested: ["futureModule"], compareVersions })
    expect(r.problems[0].reason).toBe("engine-too-old")
    expect(r.problems[0].detail).toContain("did not say which engine")
  })

  it("refuses to expand an ambiguous alternative rather than picking one", () => {
    // `expandDependencies` exists so an operator sees the expansion. Choosing
    // between two ledgers inside it would be an invisible product decision, made
    // the same way every time so nobody would ever find out.
    expect(() => expandDependencies(ledgers, ["claims"])).toThrow(AmbiguousAlternativeError)
    // Unambiguous once one of them is already asked for.
    expect(expandDependencies(ledgers, ["claims", "nextLedger"])).toEqual(["claims", "nextLedger"])
  })

  it("refuses a catalog whose capability name collides with a module key", () => {
    expect(() => ModuleCatalog.of([mod("a", { provides: ["b"] }), mod("b")], [], UNGOVERNED)).toThrow(
      /which is also a module key/,
    )
  })

  it("compares a range the way the operators say", () => {
    expect(satisfiesRange("1.2.3", "*", compareVersions)).toBe(true)
    expect(satisfiesRange("1.2.3", ">=1.2.3", compareVersions)).toBe(true)
    expect(satisfiesRange("1.2.3", ">1.2.3", compareVersions)).toBe(false)
    expect(satisfiesRange("1.10.0", ">=1.9.0", compareVersions)).toBe(true)
    expect(satisfiesRange("1.2.3", "1.2.3", compareVersions)).toBe(true)
    // Fails closed rather than throwing out of a resolution.
    expect(satisfiesRange("not-a-version", ">=1.0.0", compareVersions)).toBe(false)
    expect(satisfiesRange("1.2.3", "^1.0.0", compareVersions)).toBe(false)
  })
})
