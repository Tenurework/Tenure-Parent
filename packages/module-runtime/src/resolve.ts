import {
  MODULE_KEYS,
  ROLE_TEMPLATES,
  lookupPermission,
  type RoleDefinition,
} from "@tenure/authorization"
import { parseProcessChain, type ProcessChain } from "@tenure/contracts"

import { moduleDomains, type SystemOfRecordMap } from "./coexistence"
import {
  ENABLEABLE,
  validateManifest,
  type ModuleDependency,
  type ModuleManifest,
  type ModuleNavEntry,
} from "./manifest"

/**
 * Numeric `major.minor.patch` comparison, supplied by the caller.
 *
 * Injected rather than implemented here. `@tenure/platform-config` already owns
 * the one copy (`compatibility.ts`, and its own comment explains why there is
 * exactly one: a string compare says 1.9.0 is newer than 1.10.0 and a numeric
 * one does not). That package imports *this* one, so importing it back would be
 * a cycle — hence a function parameter rather than an import.
 */
export type VersionComparator = (a: string, b: string) => number

/**
 * Does `version` satisfy `range`?
 *
 * The grammar is deliberately five operators and a wildcard rather than a
 * semver range language: every question asked here is "is this at least/at most
 * that", and a range expression is a small language with its own bugs.
 *
 * Fails closed. An unparseable version or range, or a comparator that throws,
 * is `false` — "we could not tell" is not "yes".
 */
export function satisfiesRange(
  version: string,
  range: string,
  compare: VersionComparator,
): boolean {
  if (range === "*") return true
  const match = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(range.trim())
  if (!match) return false
  const [, operator = "=", required] = match
  let ordering: number
  try {
    ordering = compare(version, required)
  } catch {
    return false
  }
  switch (operator) {
    case ">=":
      return ordering >= 0
    case "<=":
      return ordering <= 0
    case ">":
      return ordering > 0
    case "<":
      return ordering < 0
    default:
      return ordering === 0
  }
}

export interface CatalogGovernance {
  /**
   * The module ids the platform is allowed to ship, reconciled in **both**
   * directions.
   *
   * Defaults to the permission catalog's `MODULE_KEYS`, which is the tree's
   * second list of module ids. One direction alone is half a guard, and half is
   * what existed: a manifest whose key nothing gates on ships a module no
   * permission can ever apply to, while a `MODULE_KEYS` entry with no manifest
   * gates permissions on a module that does not exist — `decide()` then denies
   * `MODULE_NOT_ENABLED` forever for a module nobody can enable.
   *
   * This runs at construction rather than in a test, so it fires on every boot
   * of `apps/web` and the Studio: `MODULE_CATALOG` is built at import.
   *
   * `null` opts out, for fixture catalogs of made-up modules. Production passes
   * nothing and gets the reconciliation.
   */
  governedKeys?: readonly string[] | null
  /**
   * Roles whose `minTier` has to name a tier its own module declares.
   *
   * Defaults to the shipped templates. REVIEW-FINDINGS #5 asks for exactly this
   * assertion at boot, and asks for it because the runtime check fails **open**:
   * `tierRank` in `decide.ts` returns `null` for a pack that declares no tiers,
   * and the tier comparison is then skipped entirely. A role demanding a tier
   * nobody sells is therefore a role that silently demands nothing, which is the
   * one failure mode a tier gate must not have.
   */
  roles?: readonly RoleDefinition[] | null
}

/**
 * Roles whose `minTier` names a tier its own pack does not declare.
 *
 * The pack a `minTier` is measured against is the module of THE PERMISSION
 * BEING DECIDED — `decide()` reads `entitlement.tiers[mod]` where `mod` is that
 * permission's module (decide.ts, step 4). This asserts the same rule, per
 * permission-pack, because a rule stated at a different grain from the one
 * enforced is a rule about something else.
 *
 * Two shapes are refused, and one deliberately is not:
 *
 *   * a pack that declares tiers and not this one — `tierRank` returns null,
 *     the comparison is skipped, and the permission is allowed at every tier.
 *     This is REVIEW-FINDINGS #5 exactly.
 *   * a role whose tier no pack it touches could ever rank — the requirement is
 *     inert for every permission in the bundle, which is a tier requirement
 *     that requires nothing.
 *   * NOT a bundle spanning a tiered pack and an untiered one. `finance.approver`
 *     is that: the budgeting permissions are ranked against
 *     budget/ledger/consolidation and the approvals permissions are untiered,
 *     which is what a per-permission gate means. Refusing it would force every
 *     module a tiered role touches to invent tiers nobody sells.
 */
export function tierDeclarationProblems(
  roles: readonly RoleDefinition[],
  byKey: ReadonlyMap<string, ModuleManifest>,
): readonly string[] {
  const problems: string[] = []

  for (const role of roles) {
    if (!role.minTier) continue

    const packs = new Set<string>()
    for (const permission of role.permissions) {
      const definition = lookupPermission(permission)
      if (definition?.module) packs.add(definition.module)
    }

    if (packs.size === 0) {
      problems.push(
        `Role "${role.key}" requires tier "${role.minTier}" and none of its permissions is gated ` +
          `on a module, so there is no pack whose tiers could rank it. decide() skips the tier ` +
          `check in that case, which makes the requirement silently vacuous.`,
      )
      continue
    }

    const tiered = [...packs].sort().filter((pack) => byKey.get(pack)?.tiers)
    if (tiered.length === 0) {
      problems.push(
        `Role "${role.key}" requires tier "${role.minTier}" and no module its permissions reach ` +
          `(${[...packs].sort().join(", ")}) declares any tiers. tierRank() returns null for an ` +
          `undeclared pack and the tier check is skipped for every one of them, so the ` +
          `requirement is inert.`,
      )
      continue
    }

    for (const pack of tiered) {
      const declared = byKey.get(pack)!.tiers!
      if (!declared.includes(role.minTier)) {
        problems.push(
          `Role "${role.key}" requires "${pack}" tier "${role.minTier}", which "${pack}" does not ` +
            `declare. It sells: ${declared.join(", ")}.`,
        )
      }
    }
  }

  return problems
}

/** The set of modules a running system knows about. Immutable once built. */
export class ModuleCatalog {
  private readonly byKey: ReadonlyMap<string, ModuleManifest>
  private readonly byCapability: ReadonlyMap<string, readonly string[]>
  private readonly processChains: readonly ProcessChain[]

  private constructor(
    byKey: ReadonlyMap<string, ModuleManifest>,
    byCapability: ReadonlyMap<string, readonly string[]>,
    chains: readonly ProcessChain[],
  ) {
    this.byKey = byKey
    this.byCapability = byCapability
    this.processChains = chains
  }

  static of(
    manifests: readonly ModuleManifest[],
    /**
     * Business processes that cross these modules.
     *
     * Second argument rather than a field on one manifest, because a chain has
     * no single owner — that is precisely why nothing was checking it. Naming
     * it on the module that starts it would make the last step's module able to
     * be removed without the declaring module noticing.
     */
    chains: readonly ProcessChain[] = [],
    /**
     * What this catalog is reconciled against at construction. See
     * `CatalogGovernance`.
     */
    governance: CatalogGovernance = {},
  ): ModuleCatalog {
    const byKey = new Map<string, ModuleManifest>()
    for (const m of manifests) {
      validateManifest(m)
      if (byKey.has(m.key)) {
        throw new Error(`Duplicate module key "${m.key}".`)
      }
      byKey.set(m.key, m)
    }

    // Dependencies naming modules that do not exist are a catalog defect, not a
    // per-tenant one, and should fail once here rather than for every tenant.
    const problems: string[] = []

    // Who supplies each capability. A dependency may name a capability instead
    // of a module key, which is what makes an alternative expressible: the day a
    // second ledger ships, it satisfies `finance.ledger` without an edit to the
    // module that needs one.
    const byCapability = new Map<string, string[]>()
    for (const m of byKey.values()) {
      for (const capability of m.provides ?? []) {
        if (byKey.has(capability)) {
          problems.push(
            `Module "${m.key}" provides "${capability}", which is also a module key. A dependency ` +
              `naming it could not say which of the two it meant.`,
          )
          continue
        }
        byCapability.set(capability, [...(byCapability.get(capability) ?? []), m.key])
      }
    }

    for (const m of byKey.values()) {
      for (const dep of m.dependsOn ?? []) {
        if (!byKey.has(dep.module) && !byCapability.has(dep.module)) {
          problems.push(
            `Module "${m.key}" depends on "${dep.module}", which is not in the catalog and which ` +
              `no module provides.`,
          )
        }
      }
      for (const inc of m.incompatibleWith ?? []) {
        if (!byKey.has(inc)) problems.push(`Module "${m.key}" is incompatible with "${inc}", which is not in the catalog.`)
      }
    }

    // Same class of check, one level up: a module declaring it consumes an
    // event no module in the catalog emits is a subscriber to nothing. It does
    // not fail — it waits, and a wait is indistinguishable from a quiet system,
    // which is why this has to be refused at construction rather than noticed
    // in production.
    const emitters = new Map<string, string[]>()
    for (const m of byKey.values()) {
      for (const type of m.emits ?? []) {
        emitters.set(type, [...(emitters.get(type) ?? []), m.key])
      }
    }
    for (const m of byKey.values()) {
      for (const type of m.consumes ?? []) {
        if (!emitters.has(type)) {
          problems.push(
            `Module "${m.key}" consumes "${type}", which no module in the catalog emits. A ` +
              `consumer with no emitter waits forever, and waiting looks exactly like a quiet system.`,
          )
        }
      }
    }

    const parsed: ProcessChain[] = []
    const chainIds = new Set<string>()
    for (const chain of chains) {
      let valid: ProcessChain
      try {
        valid = parseProcessChain(chain)
      } catch (err) {
        problems.push(
          `Process chain "${chain?.chainId ?? "(unnamed)"}" is not a valid ProcessChain: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        )
        continue
      }
      if (chainIds.has(valid.chainId)) {
        problems.push(`Duplicate process chain "${valid.chainId}".`)
      }
      chainIds.add(valid.chainId)

      // The chain is data; these are the checks that keep it from being decor.
      // Every step must name a module that exists and must match what that
      // module says about itself, so a chain cannot claim a module publishes
      // something the module has never heard of.
      valid.steps.forEach((step, i) => {
        const owner = byKey.get(step.module)
        if (!owner) {
          problems.push(
            `Process chain "${valid.chainId}" step ${i} names module "${step.module}", which is not in the catalog.`,
          )
          return
        }
        if (step.emits && !(owner.emits ?? []).includes(step.emits)) {
          problems.push(
            `Process chain "${valid.chainId}" step ${i} says "${step.module}" emits "${step.emits}", ` +
              `which that module does not declare in its manifest.`,
          )
        }
        if (step.consumes && !(owner.consumes ?? []).includes(step.consumes)) {
          problems.push(
            `Process chain "${valid.chainId}" step ${i} says "${step.module}" consumes ` +
              `"${step.consumes}", which that module does not declare in its manifest.`,
          )
        }
      })

      parsed.push(valid)
    }

    // PACK-GATE-000 — the module catalog and the permission catalog have to be
    // one catalog, and drift in either direction is a defect of the platform
    // rather than of any tenant.
    const governedKeys =
      governance.governedKeys === undefined ? MODULE_KEYS : governance.governedKeys
    if (governedKeys) {
      const governed = new Set<string>(governedKeys)
      for (const key of byKey.keys()) {
        if (!governed.has(key)) {
          problems.push(
            `Module "${key}" has a manifest and is not in the permission catalog's MODULE_KEYS, ` +
              `so no permission can ever be gated on it and enabling it confers nothing.`,
          )
        }
      }
      for (const key of governedKeys) {
        if (!byKey.has(key)) {
          problems.push(
            `MODULE_KEYS names "${key}" and no manifest declares it, so every permission gated on ` +
              `it is denied MODULE_NOT_ENABLED with no module anybody can enable.`,
          )
        }
      }
    }

    // REVIEW-FINDINGS #5 — every minTier names a tier its own pack declares.
    const roles = governance.roles === undefined ? ROLE_TEMPLATES : governance.roles
    if (roles) problems.push(...tierDeclarationProblems(roles, byKey))

    if (problems.length > 0) throw new Error(`Invalid module catalog:\n  ${problems.join("\n  ")}`)

    return new ModuleCatalog(byKey, byCapability, parsed)
  }

  /** Module keys that supply this capability, sorted. Empty when nothing does. */
  providersOf(capability: string): readonly string[] {
    return [...(this.byCapability.get(capability) ?? [])].sort()
  }

  /**
   * The processes declared over this catalog.
   *
   * Read by `validateSystem`, which refuses a release whose enabled module set
   * breaks one of them halfway.
   */
  chains(): readonly ProcessChain[] {
    return this.processChains
  }

  get(key: string): ModuleManifest | undefined {
    return this.byKey.get(key)
  }

  has(key: string): boolean {
    return this.byKey.has(key)
  }

  keys(): string[] {
    return [...this.byKey.keys()].sort()
  }

  all(): ModuleManifest[] {
    return this.keys().map((k) => this.byKey.get(k)!)
  }

  get size(): number {
    return this.byKey.size
  }
}

export interface ModuleProblem {
  moduleKey: string
  reason:
    | "unknown-module"
    | "suspended"
    | "support-ended"
    | "not-enableable"
    | "mode-unavailable"
    | "engine-too-old"
    | "missing-dependency"
    | "version-out-of-range"
    | "incompatible"
    | "missing-entitlement"
    // Structural rather than commercial: this system is not shaped for the
    // module. See `ModuleManifest.requiresOperatingModel`.
    | "wrong-operating-model"
    /**
     * An external system is the authoritative writer for a domain this module
     * writes into.
     *
     * Bible §2: "every business domain records exactly one authoritative write
     * system per effective period. Dual write is prohibited." Enabling the
     * module anyway is how a second writer appears at somebody else's ledger.
     */
    | "system-of-record-external"
    | "dependency-cycle"
  detail: string
}

/**
 * Something true about an enabled module that its operator has to be told.
 *
 * Not a problem: an advisory never removes a module. Deprecation used to be
 * completely silent — `ENABLEABLE` admits `deprecated` and nothing anywhere
 * recorded that a tenant was running one, so a deprecated module and a supported
 * one rendered identically. Same for `READ_ONLY`: a capability that cannot write
 * back is a different product from one that can, and Bible §11 says the UI must
 * show the mode.
 */
export interface ModuleAdvisory {
  moduleKey: string
  kind: "deprecated" | "certified-limited" | "read-only" | "export-only" | "support-ending"
  detail: string
}

export class ModuleResolutionError extends Error {
  readonly problems: readonly ModuleProblem[]
  constructor(problems: readonly ModuleProblem[]) {
    super(
      `Modules did not resolve (${problems.length}):\n` +
        problems.map((p) => `  [${p.reason}] ${p.moduleKey}: ${p.detail}`).join("\n"),
    )
    this.name = "ModuleResolutionError"
    this.problems = problems
  }
}

export interface ResolveModulesInput {
  /** Modules the system asks for, by key. Order is irrelevant. */
  requested: readonly string[]
  /** Entitlements the tenant holds. */
  entitlements?: readonly string[]
  /**
   * The system's operating model — the `operatingModel` archetype axis.
   *
   * Absent is not "any". A module declaring `requiresOperatingModel` is refused
   * when this is absent, and says that is why: a caller that cannot state how
   * the tenant operates has not established that the module fits it, and
   * guessing is how a consolidating surface ends up switched on for a system
   * with nothing to consolidate.
   *
   * Every tenant-facing caller supplies it from `archetypeFor(slug)`; a caller
   * whose requested set contains no such module is unaffected either way.
   */
  operatingModel?: string
  /**
   * Which system is authoritative for each business domain — PACK-020-004.
   *
   * Absent means every domain is Tenure's, which is the only safe default in
   * the direction it fails: it enables what was asked for. It is deliberately
   * NOT a silent claim in the other direction — nothing writes "tenure" into a
   * manifest on a caller's behalf, and `TenantManifest` requires the
   * declaration explicitly so that "we never decided" and "we decided Tenure
   * owns it" are different states.
   */
  systemOfRecord?: SystemOfRecordMap
  /**
   * When this resolution is happening, ISO.
   *
   * Supplied rather than read from a clock, so "was this module still supported
   * when that release was cut?" has one answer in a test and in production.
   * Absent means dates are not checked — a caller that cannot say what time it
   * is does not get a support-window verdict invented for it.
   */
  at?: string
  /** The version of the engine actually running. See `requiresEngine`. */
  runningEngineVersion?: string
  /** Numeric version comparison. Required to check any range; see `satisfiesRange`. */
  compareVersions?: VersionComparator
}

export interface ResolvedModules {
  /** Enabled modules in dependency order — dependencies before dependants. */
  ordered: readonly ModuleManifest[]
  keys: readonly string[]
  problems: readonly ModuleProblem[]
  /** True of modules that ARE enabled, and that somebody has to be told about. */
  advisories: readonly ModuleAdvisory[]
}

/**
 * Work out which modules a system runs, or refuse.
 *
 * **Dependencies are not auto-added.** A package manager quietly installing what
 * you did not ask for is convenient; a platform quietly enabling a module a
 * customer did not buy, and did not appear in the release artifact anyone
 * approved, is not. A missing dependency is reported with the exact keys to add,
 * and `expandDependencies` exists so the Studio can offer to add them — as a
 * visible edit to the request rather than a silent one to the result.
 *
 * Fail closed throughout: a missing entitlement disables the module and says so;
 * it does not degrade to a partially-working feature. **An unsatisfiable module
 * is removed, not merely reported.** Until PACK-GATE-010 this function pushed a
 * `missing-dependency` or `incompatible` problem and then emitted the offending
 * module into `keys` anyway — and the production consumer takes `.keys` and
 * discards `.problems`, so a module with a broken dependency was enabled in
 * production, widened the capability set through the authorization module gate,
 * and rendered its navigation. The docstring said "fail closed throughout" while
 * it did the opposite.
 *
 * Removal iterates to a fixed point on purpose: dropping one module can break
 * another module's dependency on it, so a single pass leaves a system whose
 * second-order dependants are still enabled.
 */
export function resolveModules(catalog: ModuleCatalog, input: ResolveModulesInput): ResolvedModules {
  const problems: ModuleProblem[] = []
  const advisories: ModuleAdvisory[] = []
  const entitlements = new Set(input.entitlements ?? [])
  const requested = [...new Set(input.requested)]
  const compare = input.compareVersions
  const now = input.at ? Date.parse(input.at) : null

  const accepted = new Map<string, ModuleManifest>()

  for (const key of requested) {
    const m = catalog.get(key)
    if (!m) {
      problems.push({ moduleKey: key, reason: "unknown-module", detail: `No module with that key.` })
      continue
    }
    // Suspension first, ahead of every other check — the same order
    // `packages/provisioning/src/catalogs.ts` puts REVOKED in, and for the same
    // reason: a module withdrawn for a security defect is refused whether or not
    // the tenant is entitled to it, and answering "you are not entitled" when
    // the truth is "we withdrew it" is the wrong sentence in the one case where
    // the difference matters most.
    if (m.suspension) {
      problems.push({
        moduleKey: key,
        reason: "suspended",
        detail: `Suspended (${m.suspension.kind}) since ${m.suspension.since}: ${m.suspension.reason}`,
      })
      continue
    }
    if (now !== null && m.supportEndsAt && Date.parse(m.supportEndsAt) <= now) {
      problems.push({
        moduleKey: key,
        reason: "support-ended",
        detail: `Support ended ${m.supportEndsAt}; this resolution is at ${input.at}.`,
      })
      continue
    }
    if (!ENABLEABLE.has(m.lifecycle)) {
      problems.push({
        moduleKey: key,
        reason: "not-enableable",
        detail: `Lifecycle is "${m.lifecycle}"; only ${[...ENABLEABLE].join(", ")} modules can be enabled.`,
      })
      continue
    }
    if (m.mode === "UNAVAILABLE") {
      problems.push({
        moduleKey: key,
        reason: "mode-unavailable",
        detail:
          `Declared UNAVAILABLE. Bible §11: a truthful absence with a reason beats a surface ` +
          `that renders and does nothing.`,
      })
      continue
    }
    if (m.requiresEngine) {
      const running = input.runningEngineVersion
      if (!running || !compare || !satisfiesRange(running, `>=${m.requiresEngine}`, compare)) {
        problems.push({
          moduleKey: key,
          reason: "engine-too-old",
          detail: running
            ? `Needs engine ${m.requiresEngine} or later; this build is ${running}.`
            : `Needs engine ${m.requiresEngine}, and the caller did not say which engine is ` +
              `running. An engine that cannot say how old it is cannot claim to be new enough.`,
        })
        continue
      }
    }
    // Before the entitlement, deliberately: a module that does not fit how this
    // system operates would not start working if the customer bought it, so
    // "wrong operating model" is the true answer whenever both apply. Reporting
    // the entitlement first would send an operator to sell an upgrade that
    // cannot help.
    if (m.requiresOperatingModel && !m.requiresOperatingModel.includes(input.operatingModel ?? "")) {
      problems.push({
        moduleKey: key,
        reason: "wrong-operating-model",
        detail: input.operatingModel
          ? `Presumes an operating model of ${m.requiresOperatingModel.join(", ")}; this system is "${input.operatingModel}".`
          : `Presumes an operating model of ${m.requiresOperatingModel.join(", ")}, and none was supplied for this system.`,
      })
      continue
    }
    // PACK-020-004. Also before the entitlement, and for a stronger reason than
    // the operating model: buying the module would not make it legal to run.
    // The customer's external ERP is the authoritative writer for this domain,
    // and enabling a Tenure module that writes into it is the dual write Bible
    // §2 prohibits. "You have not bought it" would send an operator to sell an
    // upgrade whose only effect is a second writer at somebody else's ledger.
    if (input.systemOfRecord) {
      const owned = moduleDomains(m).filter((d) => input.systemOfRecord![d] === "external")
      if (owned.length > 0) {
        problems.push({
          moduleKey: key,
          reason: "system-of-record-external",
          detail:
            `Writes into ${owned.join(", ")}, and an external system is authoritative for ` +
            `${owned.length === 1 ? "that domain" : "those domains"}. Exactly one system writes a ` +
            `domain's facts; enabling this one would make two.`,
        })
        continue
      }
    }
    if (m.requiresEntitlement && !entitlements.has(m.requiresEntitlement)) {
      problems.push({
        moduleKey: key,
        reason: "missing-entitlement",
        detail: `Requires entitlement "${m.requiresEntitlement}", which this tenant does not hold.`,
      })
      continue
    }
    accepted.set(key, m)
  }

  /** Accepted modules that could satisfy this dependency, by key. */
  const candidatesFor = (dep: ModuleDependency): string[] =>
    accepted.has(dep.module)
      ? [dep.module]
      : catalog.providersOf(dep.module).filter((k) => accepted.has(k))

  /** Everything in the catalog that WOULD satisfy it — what makes a refusal actionable. */
  const wouldSatisfy = (dep: ModuleDependency): string[] =>
    catalog.has(dep.module) ? [dep.module] : [...catalog.providersOf(dep.module)]

  const inRange = (key: string, dep: ModuleDependency): boolean => {
    if (dep.range === "*") return true
    if (!compare) return false
    return satisfiesRange(accepted.get(key)!.version, dep.range, compare)
  }

  // Fixed point. One pass is not enough: removing a module because ITS
  // dependency was missing breaks whatever depended on IT, and a single pass
  // leaves that second-order dependant enabled with its dependency gone.
  for (;;) {
    const doomed = new Set<string>()

    for (const m of accepted.values()) {
      if (doomed.has(m.key)) continue

      for (const dep of m.dependsOn ?? []) {
        const candidates = candidatesFor(dep).filter((k) => !doomed.has(k))
        if (candidates.length === 0) {
          // An optional dependency that is absent is the case it exists for.
          if (dep.kind === "optional") continue
          const alternatives = wouldSatisfy(dep)
          problems.push({
            moduleKey: m.key,
            reason: "missing-dependency",
            detail:
              `Needs "${dep.module}" ${dep.range}, which is not enabled. ` +
              (alternatives.length > 0
                ? `Satisfied by: ${alternatives.join(", ")}. Add one to the requested set.`
                : `Nothing in the catalog satisfies it.`),
          })
          doomed.add(m.key)
          continue
        }
        if (!candidates.some((k) => inRange(k, dep))) {
          problems.push({
            moduleKey: m.key,
            reason: "version-out-of-range",
            detail:
              `Needs "${dep.module}" ${dep.range}; enabled is ` +
              `${candidates.map((k) => `${k}@${accepted.get(k)!.version}`).join(", ")}.` +
              (compare || dep.range === "*"
                ? ""
                : ` No version comparator was supplied, so no range but "*" can be satisfied.`),
          })
          doomed.add(m.key)
        }
      }

      for (const inc of m.incompatibleWith ?? []) {
        if (!accepted.has(inc) || doomed.has(inc)) continue
        // Both go. Keeping one would be this function choosing which of two
        // modules the operator meant, and the operator asked for both.
        problems.push({
          moduleKey: m.key,
          reason: "incompatible",
          detail: `Cannot be enabled alongside "${inc}". Neither is enabled; drop one and re-request.`,
        })
        problems.push({
          moduleKey: inc,
          reason: "incompatible",
          detail: `Cannot be enabled alongside "${m.key}". Neither is enabled; drop one and re-request.`,
        })
        doomed.add(m.key)
        doomed.add(inc)
      }
    }

    if (doomed.size === 0) break
    for (const key of doomed) accepted.delete(key)
  }

  // Advisories describe what survived, so they are collected after removal: an
  // advisory about a module that is not running is noise.
  for (const m of [...accepted.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    if (m.lifecycle === "deprecated") {
      advisories.push({
        moduleKey: m.key,
        kind: "deprecated",
        detail: `Deprecated. It keeps working for tenants that have it; stop adopting it.`,
      })
    }
    if (m.lifecycle === "certified-limited") {
      advisories.push({
        moduleKey: m.key,
        kind: "certified-limited",
        detail:
          `Certified with limitations — ${(m.gaps ?? []).length} declared gap(s): ` +
          `${(m.gaps ?? []).map((g) => g.dimension).join(", ")}.`,
      })
    }
    if (m.mode === "READ_ONLY") {
      advisories.push({
        moduleKey: m.key,
        kind: "read-only",
        detail: `Read-only: it ingests, views and searches, and writes nothing back.`,
      })
    }
    if (m.mode === "EXPORT_ONLY") {
      advisories.push({
        moduleKey: m.key,
        kind: "export-only",
        detail: `Export-only: it produces an artifact and claims nothing about its acceptance.`,
      })
    }
    if (m.supportEndsAt) {
      advisories.push({
        moduleKey: m.key,
        kind: "support-ending",
        detail: `Support ends ${m.supportEndsAt}; after that it is refused rather than degraded.`,
      })
    }
  }

  // Topological order, with cycle detection. Enable order matters: a module's
  // migrations and configuration have to land after the ones it depends on.
  const ordered: ModuleManifest[] = []
  const state = new Map<string, 0 | 1 | 2>()

  const visit = (key: string, stack: string[]): void => {
    const s = state.get(key)
    if (s === 2) return
    if (s === 1) {
      const start = stack.indexOf(key)
      problems.push({
        moduleKey: key,
        reason: "dependency-cycle",
        detail: `Dependency cycle: ${[...stack.slice(start), key].join(" → ")}.`,
      })
      return
    }
    state.set(key, 1)
    const m = accepted.get(key)
    for (const dep of m?.dependsOn ?? []) {
      for (const candidate of candidatesFor(dep)) visit(candidate, [...stack, key])
    }
    state.set(key, 2)
    if (m) ordered.push(m)
  }

  for (const key of [...accepted.keys()].sort()) visit(key, [])

  return {
    ordered,
    keys: ordered.map((m) => m.key),
    problems,
    advisories,
  }
}

/** Resolve, or throw. The shape a request path wants. */
export function resolveModulesOrThrow(
  catalog: ModuleCatalog,
  input: ResolveModulesInput,
): ResolvedModules {
  const result = resolveModules(catalog, input)
  if (result.problems.length > 0) throw new ModuleResolutionError(result.problems)
  return result
}

/** An expansion that would have had to choose between two modules. */
export class AmbiguousAlternativeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AmbiguousAlternativeError"
  }
}

/**
 * The requested set plus everything it transitively depends on.
 *
 * Offered to an operator so they can see and approve the expansion, rather than
 * applied inside resolution where nobody would.
 *
 * Throws when a dependency names a capability that two modules provide and
 * neither is already requested. Picking one would be this function choosing a
 * product for the customer inside a helper whose entire contract is "a visible
 * edit rather than a silent one" — and it would pick the same one every time,
 * so nobody would ever find out it had chosen. Optional dependencies are not
 * expanded at all: `optional` means the system works without it, and adding it
 * would sell something nobody asked for.
 */
export function expandDependencies(
  catalog: ModuleCatalog,
  requested: readonly string[],
): string[] {
  const out = new Set<string>()
  const queue = [...requested]
  while (queue.length > 0) {
    const key = queue.shift()!
    if (out.has(key)) continue
    out.add(key)
    for (const dep of catalog.get(key)?.dependsOn ?? []) {
      if (dep.kind === "optional") continue
      if (catalog.has(dep.module)) {
        queue.push(dep.module)
        continue
      }
      const providers = catalog.providersOf(dep.module)
      const alreadyChosen = providers.filter((p) => out.has(p) || queue.includes(p))
      if (alreadyChosen.length > 0) continue
      if (providers.length === 1) {
        queue.push(providers[0])
        continue
      }
      throw new AmbiguousAlternativeError(
        `"${key}" needs "${dep.module}", which ${providers.length} modules provide ` +
          `(${providers.join(", ")}). Choosing one here would be an invisible decision; add the ` +
          `one you want to the requested set.`,
      )
    }
  }
  return [...out].sort()
}

export interface NavSection {
  label: string
  order: number
  items: readonly ModuleNavEntry[]
}

/**
 * Navigation contributed by the enabled modules, grouped and ordered.
 *
 * Two modules may contribute to one section — that is the point of sections
 * being named rather than owned. Section order is the lowest `sectionOrder` any
 * contributor declares, so adding a module cannot silently reorder the menu.
 *
 * `capabilities` filters entries the principal cannot use. Passing `null` means
 * "do not filter", for operator views that show the whole menu.
 */
export function navigationFor(
  modules: readonly ModuleManifest[],
  capabilities: ReadonlySet<string> | null,
): NavSection[] {
  const sections = new Map<string, { order: number; items: ModuleNavEntry[] }>()

  for (const m of modules) {
    for (const entry of m.navigation ?? []) {
      if (entry.requiresCapability && capabilities && !capabilities.has(entry.requiresCapability)) {
        continue
      }
      const existing = sections.get(entry.section)
      if (existing) {
        existing.order = Math.min(existing.order, entry.sectionOrder)
        existing.items.push(entry)
      } else {
        sections.set(entry.section, { order: entry.sectionOrder, items: [entry] })
      }
    }
  }

  return [...sections.entries()]
    .map(([label, { order, items }]) => ({
      label,
      order,
      // Ties broken by id so the menu is stable rather than dependent on catalog
      // iteration order.
      items: [...items].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1)),
    }))
    .sort((a, b) => a.order - b.order || (a.label < b.label ? -1 : 1))
}
