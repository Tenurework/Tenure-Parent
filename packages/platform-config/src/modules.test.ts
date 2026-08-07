import {
  ARCHETYPE_COMPILED_KEYS,
  ArchetypeError,
  BLUEPRINTS,
  ModuleEditError,
  TENANT_BINDINGS,
  applyModuleEdits,
  archetypeFor,
  archetypeProblems,
  compileArchetype,
  compiledArchetypeFor,
  getBlueprint,
  getTenantBinding,
  moduleEditsBetween,
  type ArchetypeSelection,
} from "@tenure/blueprints"
import { ENGINE_VERSION } from "@tenure/configuration"
import { MODULE_CATALOG } from "@tenure/modules"
import { coexistenceProblems, navigationFor, resolveModules } from "@tenure/module-runtime"

import { compareVersionStrings } from "./compatibility"
import {
  compatibilityFor,
  configuredKeysFor,
  fleetCompatibility,
  hasModule,
  moduleAdoption,
  modulesFor,
  navigationForSystem,
  tenantsRunning,
  tiersFor,
} from "./index"

const ALL = null // show every entry, regardless of capability

/**
 * What a resolution needs to know about the build running it.
 *
 * Spelled out rather than defaulted inside `resolveModules`: a caller that
 * cannot say which engine is running does not get a "new enough" verdict
 * invented for it, so a test calling the resolver directly has to say too.
 */
const ENGINE = {
  runningEngineVersion: ENGINE_VERSION,
  compareVersions: compareVersionStrings,
}

/** The pilot blueprint's own point on every axis. Read, never restated. */
const universityAxes = (): ArchetypeSelection =>
  getBlueprint("university-student-organizations")!.axes

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
      new Set(["admin.console.read", "finance.report.read"]),
    )
    expect(admin.map((s) => s.label)).toContain("Administration")
    expect(admin.flatMap((s) => s.items.map((i) => i.label))).toContain("Reports")
  })

  // "keeps every href pointing at a route the app actually serves" used to live
  // here and did not do that. It compared each href against a `const served =
  // new Set([...])` written by hand ten lines above, so deleting
  // `apps/web/src/app/(app)/calendar/page.tsx` left it green — it proved the
  // manifests agreed with a literal in their own test file, which is a thing
  // that cannot be wrong.
  //
  // It now lives in `tests/architecture/nav-hrefs-are-served.test.mjs`, which
  // derives the served routes from the filesystem. It had to move: a package
  // test runs inside `apps/web`'s jest and has no business reading the
  // repository, and reading the repository is the only way that check can be
  // true (PACK-070-001, PACK-000-004).
})

describe("every blueprint's module selection actually resolves", () => {
  it.each(TENANT_BINDINGS.map((b) => [b.slug, b] as const))("%s", (slug, binding) => {
    expect(getBlueprint(binding.blueprintId)).toBeDefined()
    for (const key of compiledArchetypeFor(slug)!.modules) {
      expect(MODULE_CATALOG.has(key)).toBe(true)
    }
    // Only refusals somebody deliberately configured are acceptable; a missing
    // dependency or an unknown module in a shipped blueprint is a defect.
    //
    // `system-of-record-external` is admitted only for a binding that actually
    // declares an external domain, so the exemption cannot widen into "any
    // refusal is fine" — a binding with no coexistence block is still held to
    // entitlement refusals alone.
    const declaresExternal = Object.values(binding.coexistence?.systemOfRecord ?? {}).includes(
      "external",
    )
    const allowed = declaresExternal
      ? ["missing-entitlement", "system-of-record-external"]
      : ["missing-entitlement"]
    for (const p of modulesFor(slug).problems) {
      expect(allowed).toContain(p.reason)
    }

    // WRK-020-004. A binding's coexistence block is what an adopted manifest
    // is built from (`apps/system-studio/src/lib/adopt.ts`), and it is checked
    // by the same function the manifest validator calls. A binding declaring an
    // object that contradicts its own domain would produce a manifest the
    // engine refuses to build, discovered at adoption rather than here.
    if (binding.coexistence) {
      expect(coexistenceProblems(binding.coexistence)).toEqual([])
    }
  })
})

/* ------------------------------ PACK-020-001 / PACK-GATE-020 / PACK-020-003 --
 * The archetype axes, and the compiler that turns a selection into a system.
 *
 * The claim being held falsifiable is that an axis is an INPUT TO RESOLUTION
 * rather than a label on a blueprint. Every assertion below therefore reads the
 * resolved system — the module set, the refusal reason, the menu, the resolved
 * configuration — and not the axis value it came from.
 */
describe("a blueprint's axes compile to the system it runs", () => {
  it("gives each blueprint exactly the modules its functional axis selects", () => {
    // The pilot's twelve, from eight suites plus the two every system runs. If
    // this were still a frozen list on the blueprint, the two would agree by
    // being the same literal; they agree here by being compiled.
    expect([...compileArchetype(universityAxes()).modules]).toEqual([
      "administration",
      "approvals",
      "budgeting",
      "dashboard",
      "events",
      "feed",
      "memory",
      "messaging",
      "organizations",
      "reimbursements",
      "resources",
      "search",
    ])

    // The nonprofit runs three suites, so it has no library, no assisted search
    // and no reimbursements — and that follows from the axis rather than from a
    // second list somebody kept in step by hand.
    expect([...compiledArchetypeFor("midtown-arts")!.modules]).toEqual([
      "approvals",
      "budgeting",
      "dashboard",
      "events",
      "memory",
      "organizations",
    ])
  })

  it("says which entitlements the composition needs, without granting any", () => {
    // `midtown-arts` selects the `finance` suite and holds no finance
    // entitlement. The compiler reports the requirement; only the plan grants,
    // which is why budgeting is still refused for this tenant.
    expect(compiledArchetypeFor("midtown-arts")!.entitlements).toEqual(["finance"])
    expect(modulesFor("midtown-arts").keys).not.toContain("budgeting")
  })

  it("names the same shape on the organization axis as the topology declares", () => {
    // Two names for one structural shape is how a "university" archetype ends
    // up bound to a corporate topology with nothing to catch it.
    for (const blueprint of BLUEPRINTS) {
      expect([blueprint.id, blueprint.axes.organization]).toEqual([
        blueprint.id,
        blueprint.topology.id,
      ])
    }
  })

  it("lets no blueprint set a key its own axes compile", () => {
    // The `archetype` scope sits ABOVE `blueprint`, so a blueprint setting a
    // compiled key would be setting a value the archetype layer silently
    // overrides — a line of configuration that reads as deliberate and does
    // nothing. Enforced here rather than left to a comment.
    for (const blueprint of BLUEPRINTS) {
      const overlap = Object.keys(blueprint.values).filter((key) =>
        ARCHETYPE_COMPILED_KEYS.includes(key),
      )
      expect([blueprint.id, overlap]).toEqual([blueprint.id, []])
    }
  })

  it("refuses a selection naming an axis value nobody implemented", () => {
    // A selection arrives from a form, a manifest or a DynamoDB item as a bag of
    // strings. Compiling one unchecked produces a system nobody designed.
    expect(() =>
      compileArchetype({ ...universityAxes(), operatingModel: "holacracy" as never }),
    ).toThrow(ArchetypeError)
    expect(archetypeProblems({ ...universityAxes(), functional: ["payroll"] })).toEqual([
      expect.stringContaining(`does not accept "payroll"`),
    ])
    expect(archetypeProblems({ ...universityAxes(), scale: "MICRO" })).toEqual([
      expect.stringContaining(`"scale" is not an archetype axis`),
    ])
  })
})

describe("the operating-model axis decides which modules a system may run", () => {
  const pilotPreset = () => compiledArchetypeFor("rochester")!.modules

  it("runs budgeting for the centralized pilot", () => {
    expect(archetypeFor("rochester")!.operatingModel).toBe("centralized")
    expect(modulesFor("rochester").keys).toContain("budgeting")
  })

  it("refuses budgeting to a decentralized system that holds the entitlement", () => {
    // Same preset, same entitlement, one axis moved. Nothing else in the
    // resolver could have refused it, which is what makes this a test of the
    // axis rather than of the entitlement beside it.
    const { keys, problems } = resolveModules(MODULE_CATALOG, {
      requested: pilotPreset(),
      entitlements: ["finance"],
      operatingModel: "decentralized",
      ...ENGINE,
    })
    expect(keys).not.toContain("budgeting")
    expect(problems).toContainEqual({
      moduleKey: "budgeting",
      reason: "wrong-operating-model",
      detail:
        'Presumes an operating model of centralized, federated, matrix, shared-services; this system is "decentralized".',
    })
  })

  it("takes Reports out of the menu, with that reason", () => {
    // `navigationFor` is the function `navigationForSystem` — and therefore
    // apps/web's (app)/layout.tsx — builds the menu with. A refused module
    // contributes nothing, so the entry is gone rather than dead.
    const { ordered, problems } = resolveModules(MODULE_CATALOG, {
      requested: pilotPreset(),
      entitlements: ["finance"],
      operatingModel: "decentralized",
      ...ENGINE,
    })
    const labels = navigationFor(ordered, ALL).flatMap((s) => s.items.map((i) => i.label))
    expect(labels).not.toContain("Reports")
    expect(problems.find((p) => p.moduleKey === "budgeting")!.reason).toBe(
      "wrong-operating-model",
    )

    // And it IS there for the same system operating the way its axis says.
    const ok = resolveModules(MODULE_CATALOG, {
      requested: pilotPreset(),
      entitlements: ["finance"],
      operatingModel: archetypeFor("rochester")!.operatingModel,
      ...ENGINE,
    })
    expect(navigationFor(ok.ordered, ALL).flatMap((s) => s.items.map((i) => i.label))).toContain(
      "Reports",
    )
  })

  it("refuses before the entitlement, because buying it would not help", () => {
    const { problems } = resolveModules(MODULE_CATALOG, {
      requested: ["dashboard", "organizations", "budgeting"],
      entitlements: [], // not held either
      operatingModel: "decentralized",
      ...ENGINE,
    })
    expect(problems.map((p) => p.reason)).toContain("wrong-operating-model")
    expect(problems.map((p) => p.reason)).not.toContain("missing-entitlement")
  })

  it("refuses when no operating model was supplied at all", () => {
    // Fail closed. A caller that cannot say how the tenant operates has not
    // established that the module fits it.
    const { keys, problems } = resolveModules(MODULE_CATALOG, {
      requested: ["dashboard", "organizations", "budgeting"],
      entitlements: ["finance"],
      ...ENGINE,
    })
    expect(keys).not.toContain("budgeting")
    expect(problems.find((p) => p.moduleKey === "budgeting")!.detail).toMatch(
      /none was supplied/,
    )
  })
})

describe("a binding moves one axis and inherits the rest", () => {
  it("gives two tenants on one blueprint genuinely different systems", () => {
    // `midtown-arts` and `fixture-rtl` are both bound to
    // `nonprofit-program-operations`. One overrides the `functional` axis. A
    // locked tenant type cannot produce this at all — the only alternative
    // would be a fourth blueprint.
    expect(getTenantBinding("fixture-rtl")!.blueprintId).toBe(
      getTenantBinding("midtown-arts")!.blueprintId,
    )
    expect(compiledArchetypeFor("midtown-arts")!.modules).toContain("budgeting")
    expect(compiledArchetypeFor("fixture-rtl")!.modules).not.toContain("budgeting")
  })

  it("keeps every axis the binding did not touch at the blueprint's default", () => {
    // The editable-preset property. An override is per axis, not wholesale: get
    // this wrong and moving one axis silently resets the others, which is a
    // locked type wearing a different shape.
    const preset = getBlueprint("nonprofit-program-operations")!.axes
    const overridden = archetypeFor("fixture-rtl")!

    expect(overridden.functional).not.toEqual(preset.functional)
    expect(overridden.organization).toBe(preset.organization)
    expect(overridden.operatingModel).toBe(preset.operatingModel)

    // And the untouched axes still do their work: the organization axis is what
    // supplies this tenant's word for one organization.
    expect(compiledArchetypeFor("fixture-rtl")!.values).toEqual(
      compiledArchetypeFor("midtown-arts")!.values,
    )
  })

  it("resolves the override, not the blueprint's selection", () => {
    // The end of the chain: what the tenant actually runs.
    expect(modulesFor("fixture-rtl").keys).not.toContain("budgeting")
    expect(modulesFor("fixture-rtl").problems).toEqual([])
  })
})

/* ------------------------------------------------------------ PACK-020-004 --
 * Coexistence: exactly one authoritative write system per business domain.
 */
describe("a module is refused when an external system owns the domain it writes", () => {
  it("drops budgeting and reimbursements for the external-ERP fixture", () => {
    const external = modulesFor("fixture-external-erp")

    // The preset asks for them — this tenant runs the pilot's blueprint — and
    // it holds the `finance` entitlement, so nothing else in the resolver would
    // have refused them.
    expect(compiledArchetypeFor("fixture-external-erp")!.modules).toContain("budgeting")
    expect(external.keys).not.toContain("budgeting")
    expect(external.keys).not.toContain("reimbursements")

    const reasons = new Map(external.problems.map((p) => [p.moduleKey, p.reason]))
    expect(reasons.get("budgeting")).toBe("system-of-record-external")
    expect(reasons.get("reimbursements")).toBe("system-of-record-external")
    // Named, so an operator knows which domain and not merely that something
    // was refused.
    expect(external.problems.find((p) => p.moduleKey === "budgeting")!.detail).toMatch(/finance/)
  })

  it("leaves every domain Tenure owns alone", () => {
    // The refusal is per domain, not per tenant. A coexistence profile that
    // switched the whole system off would be indistinguishable from not having
    // bought it.
    const external = modulesFor("fixture-external-erp")
    for (const key of ["dashboard", "organizations", "approvals", "events", "memory"]) {
      expect(external.keys).toContain(key)
    }
  })

  it("still runs finance for a tenant that is authoritative for it", () => {
    // The control. Same blueprint, same entitlement, no coexistence block.
    expect(modulesFor("rochester").keys).toContain("budgeting")
  })

  it("refuses before the entitlement, because buying it would not help", () => {
    // Directly, so the ordering is pinned rather than inferred from a fixture
    // that happens to hold the entitlement.
    const { problems } = resolveModules(MODULE_CATALOG, {
      requested: ["dashboard", "organizations", "budgeting"],
      entitlements: [], // not held either
      systemOfRecord: { finance: "external" },
      // Both supplied so that neither the engine gate nor the operating-model
      // gate fires first and masks the ordering this test is about.
      operatingModel: "centralized",
      ...ENGINE,
    })
    expect(problems.map((p) => p.reason)).toContain("system-of-record-external")
    expect(problems.map((p) => p.reason)).not.toContain("missing-entitlement")
  })
})

/* ------------------------------------------------------------ PACK-020-002 --
 * A preset is an editable starting point, not a locked tenant type.
 *
 * The archetype axes are one grain of edit and `moduleEdits` is the other. These
 * cover the second: a per-module delta, which is the only way to say "this
 * module and not the rest of its suite" without inventing a blueprint per
 * customer.
 */
describe("a tenant may edit its preset, and the edit is still subject to every rule", () => {
  it("reports where each enabled module came from", () => {
    const rtl = modulesFor("fixture-rtl")

    // `feed` is not in what this tenant's axes compile to; its binding adds it.
    expect(compiledArchetypeFor("fixture-rtl")!.modules).not.toContain("feed")
    expect(rtl.keys).toContain("feed")
    expect(rtl.provenance.find((p) => p.key === "feed")).toEqual({
      key: "feed",
      from: "tenant-add",
    })

    // Everything else came from the preset, and saying so is the point: an
    // absolute module list cannot distinguish these two cases at all.
    expect(rtl.provenance.find((p) => p.key === "approvals")!.from).toBe("preset")
    expect(rtl.provenance.map((p) => p.key)).toEqual([...rtl.keys])
  })

  it("gives a tenant with no edit an all-preset provenance", () => {
    const pilot = modulesFor("rochester")
    expect(pilot.provenance.every((p) => p.from === "preset")).toBe(true)
  })

  it("refuses an add the tenant is not entitled to, rather than granting it", () => {
    // The rule that makes an edit safe to expose to an operator. `add` puts a
    // module into the REQUESTED set; it does not put it into the running one.
    const preset = compiledArchetypeFor("midtown-arts")!.modules
    const requested = applyModuleEdits(preset, { add: ["reimbursements"], remove: [] })
    expect(requested).toContain("reimbursements")

    const resolved = resolveModules(MODULE_CATALOG, {
      requested,
      entitlements: [], // what midtown-arts holds
      ...ENGINE,
    })
    expect(resolved.keys).not.toContain("reimbursements")
    expect(resolved.problems).toContainEqual({
      moduleKey: "reimbursements",
      reason: "missing-entitlement",
      detail: `Requires entitlement "finance", which this tenant does not hold.`,
    })
  })

  it("reports a removal that breaks a dependency instead of silently dropping it", () => {
    // `reimbursements` dependsOn `budgeting`. Removing budgeting from the pilot's
    // preset must SAY that reimbursements is now broken — the alternative is a
    // tenant whose claims ledger quietly stops matching, with nothing said.
    const preset = compiledArchetypeFor("rochester")!.modules
    const requested = applyModuleEdits(preset, { add: [], remove: ["budgeting"] })
    expect(requested).not.toContain("budgeting")

    const resolved = resolveModules(MODULE_CATALOG, {
      requested,
      entitlements: ["finance"],
      ...ENGINE,
    })
    expect(resolved.problems.map((p) => `${p.moduleKey}:${p.reason}`)).toContain(
      "reimbursements:missing-dependency",
    )
  })

  it("refuses an edit that cannot be applied at all", () => {
    const preset = compiledArchetypeFor("rochester")!.modules
    // Says both things about one module.
    expect(() => applyModuleEdits(preset, { add: ["events"], remove: ["events"] })).toThrow(
      ModuleEditError,
    )
    // Removes something the preset never listed — a removal that removes
    // nothing, which reads as a deliberate opt-out and is not one.
    expect(() => applyModuleEdits(preset, { add: [], remove: ["notAModule"] })).toThrow(
      ModuleEditError,
    )
  })

  it("round-trips a selection through the diff the Studio submits", () => {
    // `moduleEditsBetween` is what the composer records and `applyModuleEdits`
    // is what the server replays. If they disagree, an operator's checkboxes and
    // the registered manifest describe different systems.
    const preset = compiledArchetypeFor("midtown-arts")!.modules
    const selected = [...preset.filter((k) => k !== "memory"), "resources"]

    const edits = moduleEditsBetween(preset, selected)
    expect(edits).toEqual({ add: ["resources"], remove: ["memory"] })
    expect([...applyModuleEdits(preset, edits)].sort()).toEqual([...selected].sort())
  })
})

/* ----------------------------------------------------------- PACK-GATE-080 --
 * Which tenants run a module — the question a lifecycle change needs answered
 * BEFORE it is made.
 */
describe("the blast radius of a module lifecycle change", () => {
  it("names the tenants running a module, and only those", () => {
    // `midtown-arts` has budgeting in what its axes compile to and does not run
    // it, because it holds no finance entitlement (see the entitlement suite
    // above, which fixes that fact). Anything that answered this from the
    // compiled preset rather than from the resolver would list it here.
    expect(compiledArchetypeFor("midtown-arts")!.modules).toContain("budgeting")
    expect(tenantsRunning("budgeting")).toContain("rochester")
    expect(tenantsRunning("budgeting")).not.toContain("midtown-arts")
  })

  it("counts a module a tenant runs only because of its own edit", () => {
    // The other direction: `feed` is absent from fixture-rtl's compiled preset
    // and present in its running system. A blast radius that read presets would
    // miss this tenant entirely and report the deprecation as safe for it.
    expect(compiledArchetypeFor("fixture-rtl")!.modules).not.toContain("feed")
    expect(tenantsRunning("feed")).toContain("fixture-rtl")
  })

  it("covers the whole catalog and every tenant it is true of", () => {
    const adoption = moduleAdoption()
    expect(adoption.map((a) => a.key)).toEqual(MODULE_CATALOG.keys())

    // Asserted against the resolver rather than against a slug list written
    // here, so a binding added later is covered rather than breaking this.
    for (const row of adoption) {
      expect(row.tenants.map((t) => t.slug)).toEqual(tenantsRunning(row.key))
      for (const tenant of row.tenants) {
        expect(modulesFor(tenant.slug).keys).toContain(row.key)
      }
    }
    // And it is not vacuously empty everywhere.
    expect(adoption.some((row) => row.tenants.length > 0)).toBe(true)
  })

  it("carries each tenant's provenance into the fleet view", () => {
    const feed = moduleAdoption().find((a) => a.key === "feed")!
    expect(feed.tenants.find((t) => t.slug === "rochester")).toEqual({
      slug: "rochester",
      displayName: "Simon Business School — Ainslie OSE",
      from: "preset",
    })
    expect(feed.tenants.find((t) => t.slug === "fixture-rtl")).toEqual({
      slug: "fixture-rtl",
      displayName: "Right-to-left conventions fixture",
      from: "tenant-add",
    })
  })

  it("carries the risk class of every command surface a module contributes", () => {
    // PACK-070-001's declarative field, read here rather than declared and
    // ignored. Only entries that fire a command have one; a link does not.
    const search = moduleAdoption().find((a) => a.key === "search")!
    expect(search.commands).toEqual([
      { id: "search.assistant", label: "Tenure AI", riskClass: "read" },
    ])
    expect(moduleAdoption().find((a) => a.key === "events")!.commands).toEqual([])
  })
})

/* ----------------------------------------------------------- PACK-GATE-080 --
 * The compatibility gate, which until now had no caller outside its own test.
 */
describe("a tenant's configuration against the engine version running it", () => {
  it("passes when the cell is at or beyond the engine the configuration needs", () => {
    const verdict = compatibilityFor("rochester", ENGINE_VERSION)
    expect(verdict).toEqual({ compatible: true, problems: [] })
    expect(configuredKeysFor("rochester")).toContain("platform.terminology.staffOfficeName")
  })

  it("refuses a cell older than the engine the configuration was authored on", () => {
    const verdict = compatibilityFor("fixture-rtl", "2026.7.0")
    expect(verdict.compatible).toBe(false)
    expect(verdict.problems.map((p) => p.key)).toEqual(
      expect.arrayContaining(["platform.localization.workingDays"]),
    )
    expect(new Set(verdict.problems.map((p) => p.reason))).toEqual(new Set(["engine-too-old"]))
  })

  it("refuses a cell that cannot say how old it is", () => {
    // `SCHEMA_VERSION` is literally "unpinned" in a cell that was not given one,
    // and an engine that cannot state its version cannot claim to be new enough.
    const verdict = compatibilityFor("rochester", "unpinned")
    expect(verdict.compatible).toBe(false)
    expect(verdict.problems.every((p) => p.running === "unpinned")).toBe(true)
  })

  it("answers for every bound tenant, not just the one asked about", () => {
    const fleet = fleetCompatibility(ENGINE_VERSION)
    expect(fleet.map((t) => t.slug)).toEqual(TENANT_BINDINGS.map((b) => b.slug))
    expect(fleet.every((t) => t.verdict.compatible)).toBe(true)
    expect(fleet.find((t) => t.slug === "fixture-rtl")!.keys).toContain(
      "platform.localization.holidays",
    )
  })
})

describe("an unsatisfiable module is removed from the running system, not just reported", () => {
  /**
   * PACK-GATE-010, at the only place a tenant meets it.
   *
   * `modulesFor` returns `{enabled, keys, problems}` and the two production
   * consumers — `(app)/layout.tsx` and `/api/me` — take `.keys` and discard
   * `.problems`. So for as long as `resolveModules` pushed a problem and then
   * emitted the offender into `keys` anyway, a module with an unsatisfied
   * dependency was enabled in production: its key went into the authorization
   * module gate, which widened the capability set, and its navigation rendered.
   *
   * These assertions are on `keys`, deliberately. Asserting the problem list
   * alone is what the old tests did, and it passed throughout.
   */
  const pilot = () => compiledArchetypeFor("rochester")!.modules

  it("drops a module whose dependency the tenant removed", () => {
    // `reimbursements` needs approvals and a ledger. Take approvals away and it
    // cannot run — and must not appear to.
    const { keys, problems } = resolveModules(MODULE_CATALOG, {
      requested: pilot().filter((m) => m !== "approvals"),
      entitlements: ["finance"],
      operatingModel: archetypeFor("rochester")!.operatingModel,
      ...ENGINE,
    })

    expect(keys).not.toContain("reimbursements")
    expect(keys).not.toContain("approvals")
    expect(problems.find((p) => p.moduleKey === "reimbursements")!.reason).toBe(
      "missing-dependency",
    )
    // Everything that did not depend on it is untouched — removal is surgical,
    // not a refusal of the whole system.
    expect(keys).toContain("budgeting")
    expect(keys).toContain("dashboard")
  })

  it("drops the whole chain when the base module goes", () => {
    // organizations is the base every module hangs off. Removing it must not
    // leave ten modules enabled against a module that is not there.
    const { keys } = resolveModules(MODULE_CATALOG, {
      requested: pilot().filter((m) => m !== "organizations"),
      entitlements: ["finance"],
      operatingModel: archetypeFor("rochester")!.operatingModel,
      ...ENGINE,
    })
    expect(keys).toEqual(["dashboard"])
  })

  it("still gives the pilot every module it runs today", () => {
    // The other direction, and the one that stops the rule above being a way to
    // pass by refusing everything.
    expect(modulesFor("rochester").problems).toEqual([])
    expect(modulesFor("rochester").keys).toEqual(
      expect.arrayContaining(["budgeting", "reimbursements", "approvals", "organizations"]),
    )
  })

  it("satisfies the reimbursements ledger dependency through `provides`", () => {
    // `reimbursements` depends on the capability `finance.ledger`, not on the
    // `budgeting` module by name. It resolves because budgeting provides it —
    // delete that `provides` and this becomes a missing dependency.
    expect(MODULE_CATALOG.providersOf("finance.ledger")).toEqual(["budgeting"])
    expect(modulesFor("rochester").keys).toContain("reimbursements")
  })
})

describe("what a running system has to say about itself", () => {
  it("reports the limitations of the modules it is actually running", () => {
    // PACK-030-002 / PACK-040-004. Every shipped module is `certified-limited`
    // with declared gaps, and `search` is READ_ONLY. Before advisories existed a
    // module running with limitations was indistinguishable from one without.
    const { advisories, keys } = modulesFor("rochester")

    for (const key of keys) {
      expect(advisories.some((a) => a.moduleKey === key && a.kind === "certified-limited")).toBe(
        true,
      )
    }
    expect(advisories).toContainEqual(
      expect.objectContaining({ moduleKey: "search", kind: "read-only" }),
    )
    // An advisory names what is missing, not merely that something is.
    const budgeting = advisories.find(
      (a) => a.moduleKey === "budgeting" && a.kind === "certified-limited",
    )!
    expect(budgeting.detail).toContain("accounting-controls-and-reconciliation")
  })

  it("says nothing about a module it is not running", () => {
    // midtown-arts has no finance entitlement, so budgeting is refused.
    const { advisories, keys } = modulesFor("midtown-arts")
    expect(keys).not.toContain("budgeting")
    expect(advisories.map((a) => a.moduleKey)).not.toContain("budgeting")
  })
})

describe("the tiers a tenant bought, as the authorization engine needs them", () => {
  it("reads the ordering from the catalog and the position from the binding", () => {
    const { tiers, currentTier } = tiersFor("rochester")
    expect(tiers.budgeting).toEqual(["budget", "ledger", "consolidation"])
    expect(currentTier.budgeting).toBe("ledger")
  })

  it("offers no tier ordering for a module the system does not run", () => {
    // Ranking a requirement that can never apply is worse than not ranking it.
    expect(tiersFor("midtown-arts").tiers.budgeting).toBeUndefined()
  })

  it("leaves an unrecorded tier absent rather than defaulting to the lowest", () => {
    // Fail closed: `decide()` denies TIER_TOO_LOW for a role that demands a tier
    // the tenant has none of. Defaulting here would grant the bottom tier to
    // every tenant nobody recorded a sale for.
    const erp = TENANT_BINDINGS.find((b) => b.slug === "fixture-external-erp")
    if (!erp) return
    expect(tiersFor(erp.slug).currentTier.budgeting).toBeUndefined()
  })
})
