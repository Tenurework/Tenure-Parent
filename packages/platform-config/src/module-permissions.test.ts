import {
  isPermissionKey,
  lookupPermission,
  MODULE_KEYS,
  ROLE_TEMPLATES,
} from "@tenure/authorization"
import { MODULE_CATALOG } from "@tenure/modules"
import {
  ModuleCatalog,
  tierDeclarationProblems,
  type ModuleManifest,
} from "@tenure/module-runtime"

/**
 * The module catalog and the permission catalog have to be the same catalog.
 *
 * They were not, and the way that surfaced is the point. GE-051-001 made
 * `decide()` refuse a permission nothing declares. `navigation-capabilities.ts`
 * was moved onto real keys; the Admin Console link still did not appear,
 * because the *nav entry* asked for `administration.access` — a string the
 * module manifest declared and nothing else in the platform had heard of. Two
 * halves of one gate, agreeing with each other and with nobody.
 *
 * A module declaring permissions that do not exist is the failure the manifest's
 * own header warns about: "a manifest that declares workflow actions, form
 * components and integration hooks before any of those engines exist is a
 * manifest whose declarations cannot be wrong, because nothing checks them."
 * This is what checks them.
 */

const permissionsOf = (m: { permissions?: readonly string[] }) => m.permissions ?? []

/** `ModuleCatalog` is a class keyed by module id, not an array. */
const MODULES = MODULE_CATALOG.all()

describe("every permission a module declares is in the catalog", () => {
  it("has modules to check", () => {
    expect(MODULES.length).toBeGreaterThanOrEqual(10)
    expect(MODULES.flatMap(permissionsOf).length).toBeGreaterThanOrEqual(30)
  })

  it("declares no permission the catalog does not", () => {
    const unknown: string[] = []
    for (const module of MODULES) {
      for (const permission of permissionsOf(module)) {
        if (!isPermissionKey(permission)) unknown.push(`${module.key} -> "${permission}"`)
      }
    }
    expect(unknown).toEqual([])
  })

  it("declares only permissions the catalog gates on that same module", () => {
    // A module claiming somebody else's permission is a module that appears to
    // grant something turning it on cannot actually give.
    const mismatched: string[] = []
    for (const module of MODULES) {
      for (const permission of permissionsOf(module)) {
        const entry = lookupPermission(permission)
        if (!entry) continue
        if (entry.module !== null && entry.module !== module.key) {
          mismatched.push(
            `${module.key} declares "${permission}", which the catalog gates on "${entry.module}"`,
          )
        }
      }
    }
    expect(mismatched).toEqual([])
  })
})

describe("every capability a nav entry requires is in the catalog", () => {
  const required = MODULES.flatMap((m) =>
    (m.navigation ?? [])
      .filter((n) => n.requiresCapability)
      .map((n) => ({ module: m.key, entry: n.id, capability: n.requiresCapability as string })),
  )

  it("has nav entries that require something", () => {
    // Otherwise the check below passes by finding nothing to check.
    expect(required.length).toBeGreaterThan(0)
  })

  it("requires only capabilities the catalog declares", () => {
    // This is the exact assertion that would have turned a red e2e into a red
    // unit test: the link is filtered out when the required capability is not in
    // the set, and a capability nobody can hold is never in the set.
    const unknown = required
      .filter((r) => !isPermissionKey(r.capability))
      .map((r) => `${r.module}/${r.entry} requires "${r.capability}"`)
    expect(unknown).toEqual([])
  })

  it("requires capabilities its own module declares", () => {
    // A nav entry gated on a permission its module does not confer is a link
    // nobody can ever see, which looks identical to a link nobody has permission
    // for — and the difference is a bug versus a policy.
    const orphans: string[] = []
    for (const module of MODULES) {
      const declared = new Set(permissionsOf(module))
      for (const entry of module.navigation ?? []) {
        if (entry.requiresCapability && !declared.has(entry.requiresCapability)) {
          orphans.push(
            `${module.key}/${entry.id} requires "${entry.requiresCapability}", which ${module.key} does not declare`,
          )
        }
      }
    }
    expect(orphans).toEqual([])
  })
})

describe("the two module lists agree on what the platform ships", () => {
  it("gates permissions only on modules the module catalog has", () => {
    // `MODULE_KEYS` in the permission catalog is a second list of module ids.
    // Two lists that can disagree eventually do.
    const shipped = new Set(MODULES.map((m) => m.key))
    expect(MODULE_KEYS.filter((k) => !shipped.has(k))).toEqual([])
  })

  it("ships no manifest the permission catalog has never heard of", () => {
    // The other direction. A module nothing gates permissions on is a module
    // that confers nothing when it is switched on, which looks identical to a
    // module whose permissions were forgotten.
    const gated = new Set<string>(MODULE_KEYS)
    expect(MODULES.map((m) => m.key).filter((k) => !gated.has(k))).toEqual([])
  })
})

/* ----------------------------------------------------------- PACK-GATE-000 --
 * The reconciliation is not only a test. It runs when the catalog is BUILT.
 *
 * A test proves the shipped catalog agrees today; `ModuleCatalog.of` proves it
 * for every catalog anybody constructs, on every boot of `apps/web` and the
 * Studio — `MODULE_CATALOG` is built at import.
 */
describe("catalog construction refuses drift in either direction", () => {
  /** The shipped manifests, so the fixtures below differ by exactly one thing. */
  const shipped = () => MODULE_CATALOG.all()

  it("builds the shipped catalog", () => {
    // The control. Everything below asserts a throw, and a constructor that
    // threw for every input would pass all of them.
    expect(() => ModuleCatalog.of(shipped(), [], { roles: null })).not.toThrow()
  })

  /**
   * A manifest for a module the platform does not ship.
   *
   * Built from a real one so it satisfies every OTHER rule — owner, the
   * seventeen dimensions, lifecycle — and differs by exactly the key. Its
   * navigation, tools and permissions are stripped because they are namespaced
   * under the module they came from, and a nav-namespace error would throw
   * first and prove the wrong thing.
   */
  const foreignManifest = (): ModuleManifest => ({
    ...shipped()[0],
    key: "procurement",
    permissions: [],
    navigation: [],
    tools: [],
    provides: [],
    emits: [],
    consumes: [],
    dependsOn: [],
    incompatibleWith: [],
    objects: [],
  })

  it("refuses a manifest whose key is not in MODULE_KEYS", () => {
    expect(() => ModuleCatalog.of([...shipped(), foreignManifest()], [], { roles: null })).toThrow(
      /"procurement" has a manifest and is not in the permission catalog's MODULE_KEYS/,
    )
  })

  it("refuses a MODULE_KEYS entry with no manifest", () => {
    // `decide()` denies MODULE_NOT_ENABLED for it forever, naming a module
    // nobody can enable because it does not exist.
    const withoutBudgeting = shipped().filter(
      (m) => m.key !== "budgeting" && !(m.dependsOn ?? []).some((d) => d.module === "budgeting"),
    )
    expect(() => ModuleCatalog.of(withoutBudgeting, [], { roles: null })).toThrow(
      /MODULE_KEYS names "budgeting" and no manifest declares it/,
    )
  })

  it("lets a fixture catalog opt out, and only by saying so", () => {
    expect(() =>
      ModuleCatalog.of([foreignManifest()], [], { governedKeys: null, roles: null }),
    ).not.toThrow()
  })
})

/* ------------------------------------------- REVIEW-FINDINGS #5, at boot ----
 * Every role `minTier` names a tier its own pack declares.
 *
 * The runtime check fails open: `tierRank` in decide.ts returns null for a pack
 * that declares no tiers and the whole tier comparison is skipped, so a role
 * demanding a tier nobody sells demands nothing at all.
 */
describe("a role may not require a tier its pack does not declare", () => {
  const byKey = new Map(MODULE_CATALOG.all().map((m) => [m.key, m]))

  it("passes for the shipped role templates", () => {
    // The control. `finance.approver` really does name a tier, so this is not
    // vacuous: it asserts that "ledger" is one budgeting declares.
    expect(ROLE_TEMPLATES.filter((r) => r.minTier).length).toBeGreaterThan(0)
    expect(tierDeclarationProblems(ROLE_TEMPLATES, byKey)).toEqual([])
  })

  it("allows a bundle spanning a tiered pack and an untiered one", () => {
    // What `finance.approver` is. The gate is per permission's pack: the
    // budgeting permissions are ranked, the approvals ones are untiered.
    // Refusing this would force every module a tiered role touches to invent
    // tiers nobody sells.
    expect(
      tierDeclarationProblems(
        [
          {
            key: "spanning",
            permissions: ["finance.budget.approve", "approvals.request.decide"],
            minTier: "ledger",
          },
        ],
        byKey,
      ),
    ).toEqual([])
  })

  it("refuses a tier the pack does not sell", () => {
    // Against the real declaration — `budgeting` sells budget/ledger/
    // consolidation — so this proves the shipped manifest is what is read, not
    // a map the test built.
    const problems = tierDeclarationProblems(
      [{ key: "financeOfficer", permissions: ["finance.budget.update"], minTier: "platinum" }],
      byKey,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/requires "budgeting" tier "platinum", which "budgeting" does not/)
    expect(problems[0]).toMatch(/budget, ledger, consolidation/)
  })

  it("accepts a tier the pack does sell", () => {
    expect(
      tierDeclarationProblems(
        [{ key: "financeOfficer", permissions: ["finance.budget.update"], minTier: "ledger" }],
        byKey,
      ),
    ).toEqual([])
  })

  it("refuses a tier no pack the role touches could ever rank", () => {
    // This is the fail-open itself: with no declared tiers anywhere in the
    // bundle, `tierRank` returns null for every permission, decide() skips the
    // comparison, and the requirement evaporates entirely. `approvals` and
    // `events` both sell no tiers.
    const problems = tierDeclarationProblems(
      [
        {
          key: "approver",
          permissions: ["approvals.request.decide", "events.event.publish"],
          minTier: "gold",
        },
      ],
      byKey,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/no module its permissions reach \(approvals, events\)/)
  })

  it("refuses a tier on a platform-level permission, which has no pack at all", () => {
    const problems = tierDeclarationProblems(
      [{ key: "auditor", permissions: ["admin.audit.read"], minTier: "gold" }],
      byKey,
    )
    expect(problems[0]).toMatch(/none of its permissions is gated on a module/)
  })

  it("fires from catalog construction, not only from this test", () => {
    expect(() =>
      ModuleCatalog.of(MODULE_CATALOG.all(), [], {
        roles: [{ key: "financeOfficer", permissions: ["finance.budget.update"], minTier: "platinum" }],
      }),
    ).toThrow(/tier "platinum"/)
  })
})
