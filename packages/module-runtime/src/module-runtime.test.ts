import { compareVersionStrings } from "@tenure/platform-config"

import {
  AmbiguousAlternativeError,
  COMPLETENESS_DIMENSIONS,
  ModuleCatalog,
  ModuleManifestError,
  ModuleResolutionError,
  SloObjectiveError,
  coexistenceProblems,
  expandDependencies,
  navigationFor,
  objectAuthorityNotes,
  resolveModules,
  resolveModulesOrThrow,
  satisfiesRange,
  sloBurn,
  validateManifest,
  type CoexistenceDeclaration,
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
  // PAY-160-002: every manifest states a list price, including a fixture. A
  // default here would be the optional field the required one exists to avoid,
  // so it is written out — and it is written as free WITH a reason, which is
  // what `validateManifest` requires of any option priced at zero.
  price: {
    perSeatMinor: 0,
    perOrgMinor: 0,
    currency: "USD",
    rounding: "half-up",
    includedBecause: "Fixture module declared in module-runtime.test.ts; it ships nowhere and is sold to nobody.",
  },
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

  /**
   * WRK-120-003. A fixture claiming `observability-slo-and-finops` passes has to
   * declare an objective, exactly as the shipped catalog does.
   *
   * Written out here rather than folded into `complete()` because it is the
   * point: the dimension is the only one of the seventeen whose pass now needs
   * a second declaration, and a fixture that got it for free would make the
   * rule true of nothing.
   */
  const FIXTURE_SLO: ModuleManifest["slo"] = [
    {
      objective: "the fixture answers within its fictional budget",
      target: 0.99,
      window: "30d",
      measure: "packages/module-runtime/src/module-runtime.test.ts",
      runbook: "docs/runbooks/approvals-queue-stalled.md",
    },
  ]

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
    expect(() => validateManifest({ ...mod("a"), slo: FIXTURE_SLO, dimensions: rest })).toThrow(
      /accounting-controls-and-reconciliation/,
    )
  })

  it("refuses `available` beside a declared gap, which is a contradiction", () => {
    expect(() =>
      validateManifest({
        ...mod("a"),
        slo: FIXTURE_SLO,
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
        slo: FIXTURE_SLO,
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
        slo: FIXTURE_SLO,
        dimensions: complete(),
        gaps: [
          { dimension: "observability-slo-and-finops", detail: "declared here, assessed pass there" },
        ],
      }),
    ).toThrow(/while assessing it as "pass"/)
  })

  it("refuses certified-limited with no gap — limited by what?", () => {
    expect(() =>
      validateManifest({
        ...mod("a"),
        lifecycle: "certified-limited",
        slo: FIXTURE_SLO,
        dimensions: complete(),
      }),
    ).toThrow(/declares no gap/)
  })

  it("refuses an assessment with no evidence anybody could check", () => {
    expect(() =>
      validateManifest({
        ...mod("a"),
        slo: FIXTURE_SLO,
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

/* ───────────────────────────────────────────── WRK-020-004 ─────────────
 * Authority below the domain grain, and the direction facts travel in.
 *
 * Asserted through `coexistenceProblems`, which is what
 * `packages/provisioning/src/manifest.ts` calls for every tenant manifest —
 * not through a helper this file could keep green on its own.
 */

/** Every domain the fixtures below refer to, so nothing fails on "not declared". */
const DOMAINS = {
  finance: "external",
  org: "tenure",
} as const

const declare = (extra: Partial<CoexistenceDeclaration> = {}): CoexistenceDeclaration => ({
  profile: "HYBRID_PROCESS_SPLIT",
  systemOfRecord: { ...DOMAINS },
  ...extra,
})

const reasons = (d: CoexistenceDeclaration) => coexistenceProblems(d).map((p) => p.reason)

describe("a domain says who writes; an object says which way it travels", () => {
  it("accepts a declaration with no object-level refinement at all", () => {
    // Every tenant in this repository today. The field is optional and its
    // absence has to stay a complete declaration, or adding the vocabulary
    // would have refused the whole fleet.
    expect(coexistenceProblems(declare())).toEqual([])
  })

  it("accepts an object that agrees with its domain and states a direction", () => {
    expect(
      coexistenceProblems(
        declare({
          objectAuthority: [
            { domain: "finance", object: "LedgerEntry", authority: "external", direction: "INBOUND" },
          ],
        }),
      ),
    ).toEqual([])
  })

  // (a) — the invisible second writer.
  it("refuses an object claiming Tenure inside a domain an external system owns", () => {
    const problems = coexistenceProblems(
      declare({
        objectAuthority: [
          { domain: "finance", object: "LedgerEntry", authority: "tenure", direction: "OUTBOUND" },
        ],
      }),
    )
    expect(problems.map((p) => p.reason)).toContain("contradicts-system-of-record")
    const contradiction = problems.find((p) => p.reason === "contradicts-system-of-record")!
    expect(contradiction.field).toBe("objectAuthority.finance.LedgerEntry")
    // The message has to name both sides, because the fix is to move one of
    // them and an operator cannot tell which without knowing what the other says.
    expect(contradiction.detail).toContain("claims tenure")
    expect(contradiction.detail).toContain("records external")
  })

  it("refuses the same contradiction in the other direction", () => {
    expect(
      reasons(
        declare({
          objectAuthority: [
            { domain: "org", object: "Organization", authority: "external", direction: "INBOUND" },
          ],
        }),
      ),
    ).toContain("contradicts-system-of-record")
  })

  it("refuses an object in a domain nothing decided, rather than assuming Tenure", () => {
    expect(
      reasons(
        declare({
          objectAuthority: [
            { domain: "events", object: "Event", authority: "tenure", direction: "OUTBOUND" },
          ],
        }),
      ),
    ).toContain("domain-not-declared")
  })

  it("refuses two authorities for one object", () => {
    expect(
      reasons(
        declare({
          objectAuthority: [
            { domain: "finance", object: "LedgerEntry", authority: "external", direction: "INBOUND" },
            { domain: "finance", object: "LedgerEntry", authority: "external", direction: "NONE" },
          ],
        }),
      ),
    ).toContain("duplicate-object")
  })

  it("refuses a direction that is not one", () => {
    expect(
      reasons(
        declare({
          objectAuthority: [
            {
              domain: "finance",
              object: "LedgerEntry",
              authority: "external",
              direction: "UPSTREAM" as never,
            },
          ],
        }),
      ),
    ).toContain("unknown-direction")
  })

  it("refuses an entry that names an object but no domain", () => {
    expect(
      reasons(
        declare({
          objectAuthority: [
            { domain: "", object: "LedgerEntry", authority: "external", direction: "INBOUND" },
          ],
        }),
      ),
    ).toContain("malformed")
  })

  // (b) — a direction the profile does not have.
  it("refuses BIDIRECTIONAL under a profile with one authoritative side", () => {
    const problems = coexistenceProblems({
      profile: "TENURE_CLOUD_PRIMARY",
      systemOfRecord: { finance: "tenure" },
      objectAuthority: [
        { domain: "finance", object: "LedgerEntry", authority: "tenure", direction: "BIDIRECTIONAL" },
      ],
    })
    expect(problems.map((p) => p.reason)).toContain("bidirectional-outside-coexistence")
  })

  it("accepts BIDIRECTIONAL under the two profiles that declare it", () => {
    for (const profile of ["COEXISTENCE_TRANSITION", "HYBRID_PROCESS_SPLIT"] as const) {
      expect(
        reasons(
          declare({
            profile,
            objectAuthority: [
              {
                domain: "finance",
                object: "LedgerEntry",
                authority: "external",
                direction: "BIDIRECTIONAL",
              },
            ],
          }),
        ),
      ).not.toContain("bidirectional-outside-coexistence")
    }
  })

  // (c) — a field the other side owns with nowhere for it to arrive.
  it("refuses a field owned by the other side when the object has no sync channel", () => {
    const problems = coexistenceProblems(
      declare({
        objectAuthority: [
          {
            domain: "finance",
            object: "LedgerEntry",
            authority: "external",
            direction: "NONE",
            fields: [{ field: "memo", authority: "tenure" }],
          },
        ],
      }),
    )
    const problem = problems.find((p) => p.reason === "field-owner-without-sync")
    expect(problem).toBeDefined()
    expect(problem!.field).toBe("objectAuthority.finance.LedgerEntry.memo")
  })

  it("allows a field with the same owner as its object under NONE", () => {
    // Nothing has to travel, so nothing is silently not travelling. Refusing
    // this would make the rule about `NONE` rather than about the split.
    expect(
      reasons(
        declare({
          objectAuthority: [
            {
              domain: "finance",
              object: "LedgerEntry",
              authority: "external",
              direction: "NONE",
              fields: [{ field: "postedAt", authority: "external" }],
            },
          ],
        }),
      ),
    ).not.toContain("field-owner-without-sync")
  })

  it("allows the split once the object declares a channel", () => {
    expect(
      reasons(
        declare({
          objectAuthority: [
            {
              domain: "finance",
              object: "LedgerEntry",
              authority: "external",
              direction: "INBOUND",
              fields: [{ field: "memo", authority: "tenure" }],
            },
          ],
        }),
      ),
    ).not.toContain("field-owner-without-sync")
  })

  it("refuses the same field twice and a field with no name", () => {
    expect(
      reasons(
        declare({
          objectAuthority: [
            {
              domain: "finance",
              object: "LedgerEntry",
              authority: "external",
              direction: "INBOUND",
              fields: [
                { field: "memo", authority: "tenure" },
                { field: "memo", authority: "external" },
                { field: "", authority: "tenure" },
              ],
            },
          ],
        }),
      ),
    ).toEqual(expect.arrayContaining(["duplicate-field", "malformed"]))
  })

  it("still applies every domain-level rule beside the object ones", () => {
    // The two grains are not alternatives. A declaration wrong at both has to
    // report both, or fixing the visible one would make the other disappear.
    const problems = coexistenceProblems({
      profile: "TENURE_CLOUD_PRIMARY",
      systemOfRecord: { finance: "external" },
      objectAuthority: [
        { domain: "finance", object: "LedgerEntry", authority: "tenure", direction: "OUTBOUND" },
      ],
    })
    expect(problems.map((p) => p.reason)).toEqual(
      expect.arrayContaining(["contradicts-system-of-record"]),
    )
    expect(problems.filter((p) => p.field === "coexistence")).toHaveLength(1)
    expect(problems.filter((p) => p.field.startsWith("objectAuthority"))).toHaveLength(1)
  })

  it("writes the split out for the plan an operator approves", () => {
    // What `planFor` puts in front of an approver. A bidirectional profile
    // whose plan says only "an external system is authoritative for finance"
    // is a plan that does not mention the fields the other side writes.
    expect(
      objectAuthorityNotes({
        objectAuthority: [
          { domain: "finance", object: "Budget", authority: "external", direction: "NONE" },
          {
            domain: "finance",
            object: "LedgerEntry",
            authority: "external",
            direction: "INBOUND",
            fields: [{ field: "memo", authority: "tenure" }],
          },
        ],
      }),
    ).toEqual([
      "finance.Budget: external writes it, sync NONE.",
      "finance.LedgerEntry: external writes it, sync INBOUND, except memo → tenure.",
    ])
  })
})

/* ───────────────────────────────────────────── WRK-120-003 ─────────────
 * A dimension nothing could ever pass, and the declaration that changes it.
 *
 * `observability-slo-and-finops` was a gap on all twelve shipped modules, and
 * it was an honest gap — there was no objective type, no error budget and no
 * evaluator, so nothing could have made it true. These are the rules that stop
 * it becoming true by rewriting a sentence.
 */

const REAL_SLO: NonNullable<ModuleManifest["slo"]> = [
  {
    objective: "a pending approval is decided within its SLA",
    target: 0.95,
    window: "30d",
    measure: "apps/web/src/lib/approvals-sla.ts",
    runbook: "docs/runbooks/approvals-queue-stalled.md",
  },
]

/**
 * A certified-limited manifest with observability set to whatever a case needs.
 *
 * The migration dimension is held at `gap` throughout so the fixture keeps
 * satisfying the older rule — certified-limited with no gap is refused — and
 * the only thing moving between cases is the one under test.
 */
const observing = (
  status: "pass" | "gap" | "not-applicable",
  extra: Partial<ModuleManifest> = {},
): ModuleManifest => ({
  ...mod("a"),
  lifecycle: "certified-limited",
  dimensions: Object.fromEntries(
    COMPLETENESS_DIMENSIONS.map((d) => [
      d,
      d === "observability-slo-and-finops"
        ? { status, evidence: `observability is ${status} for this fixture` }
        : d === "migration-cutover-and-data-quality"
          ? { status: "gap" as const, evidence: "nothing describes a cutover" }
          : { status: "pass" as const, evidence: `evidence for ${d}` },
    ]),
  ) as ModuleManifest["dimensions"],
  gaps: [
    {
      dimension: "migration-cutover-and-data-quality" as const,
      detail: "No import path from an incumbent system.",
    },
    ...(status === "gap"
      ? [
          {
            dimension: "observability-slo-and-finops" as const,
            detail: "No objective, alert or runbook is declared for this fixture.",
          },
        ]
      : []),
  ],
  ...extra,
})

describe("an observability claim needs an objective, not an adjective", () => {
  it("refuses a pass with no objective declared", () => {
    // The whole point. Eleven modules still say `gap` here and still are one;
    // the twelfth may only say `pass` because it declares something an
    // evaluator can be wrong about.
    expect(() => validateManifest(observing("pass"))).toThrow(
      /assesses "observability-slo-and-finops" as a pass and declares no service objective/,
    )
  })

  it("accepts the pass once the objective is there", () => {
    expect(() => validateManifest(observing("pass", { slo: REAL_SLO }))).not.toThrow()
  })

  it("accepts an objective beside a gap, because the dimension is two things", () => {
    // `approvals` is exactly here: a real objective, a real evaluator and a
    // real runbook, and still no per-module cost attribution. Refusing this
    // pairing would force the catalog to claim the half that is not built in
    // order to record the half that is.
    expect(() => validateManifest(observing("gap", { slo: REAL_SLO }))).not.toThrow()
  })

  it("refuses a target that is not a fraction, in both directions", () => {
    for (const target of [0, 1, 1.5, -0.1, 95, Number.NaN]) {
      expect(() =>
        validateManifest(observing("pass", { slo: [{ ...REAL_SLO[0], target }] })),
      ).toThrow(/not a fraction strictly/)
    }
  })

  it("accepts the fractions in between", () => {
    for (const target of [0.5, 0.95, 0.999]) {
      expect(() =>
        validateManifest(observing("pass", { slo: [{ ...REAL_SLO[0], target }] })),
      ).not.toThrow()
    }
  })

  it("refuses a target with no window to measure it over", () => {
    expect(() =>
      validateManifest(observing("pass", { slo: [{ ...REAL_SLO[0], window: "a month" }] })),
    ).toThrow(/which is not a window such as/)
  })

  it("refuses an objective nothing measures", () => {
    expect(() =>
      validateManifest(observing("pass", { slo: [{ ...REAL_SLO[0], measure: "  " }] })),
    ).toThrow(/names nothing that measures it/)
  })

  it("refuses a runbook that is not a document", () => {
    expect(() =>
      validateManifest(observing("pass", { slo: [{ ...REAL_SLO[0], runbook: "page somebody" }] })),
    ).toThrow(/not a document path/)
  })

  it("refuses the same objective declared twice", () => {
    expect(() =>
      validateManifest(observing("pass", { slo: [REAL_SLO[0], REAL_SLO[0]] })),
    ).toThrow(/twice/)
  })

  it("refuses a number with no sentence it is a number about", () => {
    expect(() =>
      validateManifest(observing("pass", { slo: [{ ...REAL_SLO[0], objective: "99.9%" }] })),
    ).toThrow(/no statement of what is promised/)
  })
})

describe("burn is how much of the error budget went, not whether it went", () => {
  const objective = REAL_SLO[0]

  it("attains 1 and burns nothing on an empty window", () => {
    // An institution with no pending approvals has not breached anything.
    // Reporting one would train whoever reads the alert to stop reading it.
    const burn = sloBurn([], objective)
    expect(burn).toMatchObject({ total: 0, attained: 1, burn: 0, met: true, breaching: [] })
  })

  it("separates a target that has slipped from a queue that has stopped", () => {
    // Both fail `met`. Only one is an outage, and `burn` is what says which.
    const slipped = sloBurn(
      [...Array(100).keys()].map((i) => ({ subject: `r${i}`, good: i >= 6 })),
      objective,
    )
    const stopped = sloBurn(
      [...Array(100).keys()].map((i) => ({ subject: `r${i}`, good: i >= 60 })),
      objective,
    )
    expect(slipped.met).toBe(false)
    expect(stopped.met).toBe(false)
    expect(slipped.burn).toBeCloseTo(1.2, 5)
    expect(stopped.burn).toBeCloseTo(12, 5)
  })

  it("names what breached, in the order it was measured", () => {
    const burn = sloBurn(
      [
        { subject: "late-1", good: false },
        { subject: "fine", good: true },
        { subject: "late-2", good: false },
      ],
      objective,
    )
    expect(burn.breaching).toEqual(["late-1", "late-2"])
    expect(burn.bad).toBe(2)
    expect(burn.good).toBe(1)
    expect(burn.runbook).toBe(objective.runbook)
  })

  it("is met exactly at target rather than only above it", () => {
    const at = sloBurn(
      [...Array(20).keys()].map((i) => ({ subject: `r${i}`, good: i >= 1 })),
      objective,
    )
    expect(at.attained).toBeCloseTo(0.95, 10)
    expect(at.met).toBe(true)
    expect(at.burn).toBeCloseTo(1, 5)
  })

  it("refuses an objective whose error budget is zero rather than returning Infinity", () => {
    // `validateManifest` refuses this at declaration, so reaching it means an
    // objective was built somewhere other than a manifest. A number that means
    // nothing beside real ones on a dashboard is worse than a throw.
    expect(() => sloBurn([{ subject: "x", good: false }], { ...objective, target: 1 })).toThrow(
      SloObjectiveError,
    )
    expect(() => sloBurn([], { ...objective, target: 0 })).toThrow(SloObjectiveError)
  })
})
