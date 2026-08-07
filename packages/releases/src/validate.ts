import type { ProcessChain } from "@tenure/contracts"

import type { ReleaseInput } from "./release"

/**
 * Whole-system validation, before a candidate can leave draft.
 *
 * The point of validating the *combination* rather than each piece is that each
 * piece is already valid on its own — the configuration resolved, the modules
 * resolved, the topology validated — and the interesting failures are between
 * them. A blueprint that selects a module whose navigation points at a route no
 * enabled module serves is four valid parts and one broken system.
 *
 * Callers supply what they resolved. This package deliberately does not import
 * the configuration, module or organization packages: a release is a statement
 * *about* those results, and importing them would make the artifact's shape
 * depend on their internals.
 */

export interface SystemUnderValidation {
  input: ReleaseInput
  /** Problems the module resolver reported. Any one blocks the release. */
  moduleProblems: readonly { moduleKey: string; reason: string; detail: string }[]
  /** Problems the configuration resolver reported. */
  configurationProblems: readonly { key: string; reason: string; detail: string }[]
  /** Whether the topology validated. */
  topologyValid: boolean
  topologyProblems?: readonly string[]
  /** Module keys the resolver actually enabled. */
  enabledModuleKeys: readonly string[]

  /**
   * The process chains the module catalog declares, for the coherence check.
   *
   * `ModuleCatalog.chains()` is the source; it has already held every step's
   * module against the manifests, so what arrives here is a chain whose steps
   * name modules that exist. This check asks the different question: are they
   * all *enabled in this system*.
   *
   * Omitted means "the caller has no chain declarations", not "there are none
   * to satisfy" — so a caller that forgets gets no chain checking rather than a
   * false pass on chains it never described.
   */
  chains?: readonly ProcessChain[]

  /** The pins on the release this candidate would replace. */
  previousModules?: readonly { key: string; version: string }[]
  /**
   * Orders two module versions. Negative when `a` is older.
   *
   * Injected because `@tenure/releases` imports nothing: the one comparator
   * lives in `@tenure/platform-config` (`compareVersions`/`parseVersion`),
   * where it is owned precisely so there is a single copy that cannot disagree
   * about whether 1.10.0 is newer than 1.9.0.
   */
  compare?: (a: string, b: string) => number
  /** The version the catalog currently ships, per module key. */
  catalogVersions?: Readonly<Record<string, string>>
  /**
   * Every declared dependency edge, flattened, so the pins can be checked
   * against the ranges rather than only against the key set.
   *
   * `module` is the module that declares it, `dependsOn` is what it names — a
   * module key or a capability — and `satisfiedBy` is the module keys that
   * actually supply that capability, resolved by the caller from the catalog.
   * This package must not import the module runtime, so the resolution is done
   * where the catalog is.
   */
  moduleDependencies?: readonly {
    module: string
    dependsOn: string
    range: string
    satisfiedBy?: readonly string[]
  }[]
  /**
   * Whether a version satisfies a range. `satisfiesRange` from
   * `@tenure/module-runtime`, injected for the same reason `compare` is: one
   * implementation, and it does not live here.
   */
  satisfiesRange?: (version: string, range: string) => boolean
  /**
   * Migrations the target database reports as applied.
   *
   * Passed in as strings rather than read here, so this package stays free of
   * Prisma — a release is a statement *about* a schema, not a client of one.
   */
  appliedMigrations?: readonly string[]
}

export interface ValidationProblem {
  area: "modules" | "configuration" | "topology" | "release" | "coherence"
  detail: string
}

export interface ValidationResult {
  valid: boolean
  problems: readonly ValidationProblem[]
}

/**
 * Validate a system definition.
 *
 * Collects everything rather than stopping at the first failure: an operator
 * fixing a system wants the list, not a sequence of single-problem rejections.
 */
export function validateSystem(system: SystemUnderValidation): ValidationResult {
  const problems: ValidationProblem[] = []

  for (const p of system.moduleProblems) {
    problems.push({ area: "modules", detail: `${p.moduleKey}: ${p.reason} — ${p.detail}` })
  }
  for (const p of system.configurationProblems) {
    problems.push({ area: "configuration", detail: `${p.key}: ${p.reason} — ${p.detail}` })
  }
  if (!system.topologyValid) {
    for (const detail of system.topologyProblems ?? ["Topology did not validate."]) {
      problems.push({ area: "topology", detail })
    }
  }

  // ── coherence between the parts ─────────────────────────────────────────

  // The release must pin exactly the modules that were enabled. A release
  // claiming a module the resolver refused would deploy a system whose manifest
  // and behaviour disagree — and the manifest is what everything downstream
  // cites.
  const pinned = new Set(system.input.modules.map((m) => m.key))
  const enabled = new Set(system.enabledModuleKeys)

  for (const key of [...pinned].sort()) {
    if (!enabled.has(key)) {
      problems.push({
        area: "coherence",
        detail: `Release pins module "${key}", which the resolver did not enable.`,
      })
    }
  }
  for (const key of [...enabled].sort()) {
    if (!pinned.has(key)) {
      problems.push({
        area: "coherence",
        detail: `Module "${key}" is enabled but not pinned in the release. An unpinned module can change under a released system.`,
      })
    }
  }

  // A system is more than a set of modules that individually resolve. A release
  // pinning `budgeting` with no `approvals` passes every check above — the
  // module resolves, it is enabled, it is pinned — and produces a system where
  // spend can be requested and never decided. Set equality cannot see that,
  // because the thing that is missing was never asked for.
  //
  // Only chains the enabled set STARTS are enforced. A tenant that does not run
  // budgeting at all has not left the budget chain half-built; it is not in it.
  //
  // One field and one rule. `ProcessChain` already names the `DomainEvent.type`
  // each step consumes and emits, which is what `ModuleCatalog.of` holds the
  // manifests against — so a second, prose-only chain shape would be a second
  // place for "the chain stops halfway" to be decided, and the two would
  // eventually disagree about which systems are releasable. The event names
  // earn their place in the message: a missing step is reported by the event it
  // would have consumed, which is the string an operator can search the
  // emitting module for.
  for (const chain of system.chains ?? []) {
    if (chain.steps.length === 0) continue
    const first = chain.steps[0]
    if (!enabled.has(first.module)) continue

    const index = chain.steps.findIndex((s) => !enabled.has(s.module))
    if (index > 0) {
      const missing = chain.steps[index]
      problems.push({
        area: "coherence",
        detail:
          `The "${chain.name}" chain (${chain.chainId}) starts in module "${first.module}" but ` +
          `cannot finish: step ${index + 1} handles "${missing.consumes ?? "(nothing)"}" and needs ` +
          `module "${missing.module}", which this system does not enable. Enable ` +
          `"${missing.module}", or take "${first.module}" out of this system — a step that accepts ` +
          `work it can never hand on fails in front of whoever raised it, not whoever composed it.`,
      })
    }
  }

  for (const m of system.input.modules) {
    if (!m.version) {
      problems.push({ area: "release", detail: `Module "${m.key}" is pinned with no version.` })
    }
    // PACK-030-004. A retired module is not a version problem and a version
    // number cannot express it: the pin can be perfectly well formed and name a
    // module nobody may run. Refused here rather than only at resolution,
    // because a release artifact outlives the resolution that produced it.
    if (m.lifecycle === "retired") {
      problems.push({
        area: "release",
        detail:
          `Module "${m.key}" is pinned at ${m.version} and its lifecycle is "retired". A release ` +
          `may not carry a module nobody may enable.`,
      })
    }
    if (m.mode === "UNAVAILABLE") {
      problems.push({
        area: "release",
        detail:
          `Module "${m.key}" is pinned and declared UNAVAILABLE. Bible §11: a truthful absence ` +
          `beats a surface that ships and does nothing.`,
      })
    }
  }

  // ── declared dependency ranges against the pinned versions ───────────────
  //
  // PACK-010-002. The key-set check above proves the release pins what the
  // resolver enabled; it says nothing about VERSIONS. A release could satisfy
  // every dependency by name and pin `budgeting@1.0.0` beside a module that
  // declares it needs `>=2.0.0` — four valid parts, one system that cannot work.
  if (system.moduleDependencies) {
    const satisfies = system.satisfiesRange
    if (!satisfies) {
      problems.push({
        area: "release",
        detail:
          `Dependency ranges were declared but no range predicate was supplied, so no version ` +
          `could be checked. Failing rather than passing silently: an unchecked range is not a ` +
          `satisfied one.`,
      })
    } else {
      const pinnedVersions = new Map(system.input.modules.map((m) => [m.key, m.version]))
      for (const dependency of system.moduleDependencies) {
        if (!pinnedVersions.has(dependency.module)) continue
        const satisfiedBy = dependency.satisfiedBy ?? [dependency.dependsOn]
        const candidates = satisfiedBy.filter((key) => pinnedVersions.has(key))
        if (candidates.length === 0) continue
        if (candidates.some((key) => satisfies(pinnedVersions.get(key)!, dependency.range))) continue
        problems.push({
          area: "coherence",
          detail:
            `Module "${dependency.module}" needs "${dependency.dependsOn}" ${dependency.range}, ` +
            `and the release pins ` +
            `${candidates.map((key) => `${key}@${pinnedVersions.get(key)}`).join(", ")}.`,
        })
      }
    }
  }

  // ── the pins against the past and against the catalog ────────────────────
  //
  // `rollbackTo` is exempt by construction: it builds its artifact from a target
  // release rather than from a validated candidate, and never reaches here. That
  // is the point — a rollback IS a deliberate downgrade, and the only one.
  if (system.previousModules) {
    const compare = system.compare
    if (!compare) {
      problems.push({
        area: "release",
        detail:
          `A previous release was supplied without a version comparator, so a downgrade ` +
          `cannot be detected. Pass \`compare\` (compareVersions from @tenure/platform-config).`,
      })
    } else {
      const previous = new Map(system.previousModules.map((m) => [m.key, m.version]))
      for (const m of system.input.modules) {
        const was = previous.get(m.key)
        if (!was || !m.version) continue
        let order: number
        try {
          order = compare(was, m.version)
        } catch (err) {
          // Fails loud, not open. An unorderable pin is not "no downgrade".
          problems.push({
            area: "release",
            detail:
              `Module "${m.key}" pins ${JSON.stringify(m.version)} against a previous ` +
              `${JSON.stringify(was)}, and the two cannot be ordered: ` +
              `${err instanceof Error ? err.message : String(err)}.`,
          })
          continue
        }
        if (order > 0) {
          problems.push({
            area: "release",
            detail:
              `Module "${m.key}" is pinned at ${m.version}, below the active release's ${was}. ` +
              `A downgrade must be an explicit rollback, not a validated candidate.`,
          })
        }
      }
    }
  }

  if (system.catalogVersions) {
    for (const m of system.input.modules) {
      const shipped = system.catalogVersions[m.key]
      if (shipped === undefined) {
        problems.push({
          area: "release",
          detail:
            `Module "${m.key}" is pinned at ${m.version || "(no version)"}, and the catalog no ` +
            `longer ships it. A release cannot bind a version nothing can install.`,
        })
      } else if (m.version && shipped !== m.version) {
        problems.push({
          area: "release",
          detail:
            `Module "${m.key}" is pinned at ${m.version}, but the catalog ships ${shipped}. ` +
            `The artifact would name a version this engine cannot produce.`,
        })
      }
    }
  }

  if (!system.input.schemaVersion.trim()) {
    problems.push({
      area: "release",
      detail: `The release pins no schema version, so nothing records which database shape it runs on.`,
    })
  } else if (system.appliedMigrations && !system.appliedMigrations.includes(system.input.schemaVersion)) {
    problems.push({
      area: "release",
      detail:
        `The release pins schema "${system.input.schemaVersion}", which the target reports as ` +
        `unapplied. Applied: ${system.appliedMigrations.length ? system.appliedMigrations.join(", ") : "(none)"}.`,
    })
  }

  if (!system.input.configurationChecksum.startsWith("sha256:")) {
    problems.push({
      area: "release",
      detail: `configurationChecksum is not a checksum: ${JSON.stringify(system.input.configurationChecksum)}.`,
    })
  }

  if (system.input.policyIds.length !== new Set(system.input.policyIds).size) {
    problems.push({ area: "release", detail: `Duplicate policy ids in the release.` })
  }

  return { valid: problems.length === 0, problems }
}
