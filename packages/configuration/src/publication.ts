import type { ConfigRegistry } from "./definition"
import { resolveVersionedLayers } from "./layer-bridge"
import type { VersionedLayer } from "./layer-schema"
import { stableStringify } from "./merge"
import { authorityViolations, type AuthorityViolation } from "./authority"
import { allRejections, type ModuleLike, type Rejection } from "./rejections"
import type { ConfigDiffEntry } from "./version"

/**
 * GE-031-006 — deciding whether a configuration change may be published.
 *
 * The engine could already resolve layers, reject bad ones (GE-031-004), digest
 * them (GE-031-003) and record a version (GE-031-001). What it could not do was
 * answer the question an operator actually asks before signing: *what will this
 * change, for whom, and can I undo it?*
 *
 * ## Lint is not rejection, and the difference is the whole design
 *
 * A rejection is "this cannot be published". A lint finding is "this is
 * probably not what you meant". Conflating them has two failure modes and both
 * are common: warnings that block become noise people route around, and errors
 * demoted to warnings become defects that ship. So `blocked` is decided ONLY by
 * rejections, and `lint` never contributes to it — asserted, not merely
 * intended.
 *
 * ## Simulation runs the real resolver
 *
 * Fixtures are environments, not expected outputs. A simulation that compares
 * against hand-written expectations tests the fixture; this one resolves the
 * proposed layers through `resolveVersionedLayers` — the same function
 * production uses — and reports what each fixture would actually see.
 */

export interface LintFinding {
  code:
    | "value-equals-default"
    | "no-effective-end"
    | "approved-by-author"
    | "empty-change-reason"
    | "layer-sets-nothing"
  detail: string
  layerId?: string
  key?: string
}

/**
 * Advisory findings. None of these blocks a publication.
 *
 * Each is something that is legal, occasionally deliberate, and usually a
 * mistake — which is exactly the category that must not be an error.
 */
export function lint(
  layers: readonly VersionedLayer[],
  registry: ConfigRegistry,
  publishedBy: string,
): readonly LintFinding[] {
  const findings: LintFinding[] = []

  for (const layer of layers) {
    const keys = Object.keys(layer.values)

    if (keys.length === 0) {
      findings.push({
        code: "layer-sets-nothing",
        layerId: layer.id,
        detail: `"${layer.id}" sets no values. It carries metadata, an approval and a version, and changes nothing.`,
      })
    }

    if (layer.metadata.effectiveUntil === null && layer.kind === "experiment") {
      // An experiment is time-bounded by definition. One without an end is a
      // permanent change wearing a temporary label, and nobody comes back to it.
      findings.push({
        code: "no-effective-end",
        layerId: layer.id,
        detail: `Experiment "${layer.id}" has no end date. Experiments that never end become undocumented defaults.`,
      })
    }

    if (layer.metadata.approvedBy && layer.metadata.approvedBy === publishedBy) {
      // Not blocked here — `planPublication` blocks it. Reported too, because a
      // reviewer reading the lint should see it without opening the verdict.
      findings.push({
        code: "approved-by-author",
        layerId: layer.id,
        detail: `"${layer.id}" is approved by the same identity publishing it.`,
      })
    }

    if (layer.metadata.changeReason.trim().length < 8) {
      findings.push({
        code: "empty-change-reason",
        layerId: layer.id,
        detail: `"${layer.id}" has a change reason of "${layer.metadata.changeReason}", which will mean nothing in an incident review.`,
      })
    }

    for (const key of keys) {
      const definition = registry.get(key)
      if (!definition) continue
      if (stableStringify(layer.values[key]) === stableStringify(definition.default)) {
        findings.push({
          code: "value-equals-default",
          layerId: layer.id,
          key,
          detail: `"${key}" is set to the platform default. The override does nothing and hides that the default is what applies.`,
        })
      }
    }
  }

  return findings
}

/** What a change does, in numbers an operator can act on. */
export interface Impact {
  keysAdded: number
  keysRemoved: number
  keysChanged: number
  /** Module or feature keys whose enablement flips, named. A count is not enough here. */
  modulesAffected: readonly string[]
  /** Fixtures whose resolved values differ from the current configuration. */
  fixturesAffected: readonly string[]
}

/**
 * A human-readable diff.
 *
 * Values are rendered through `stableStringify`, so two objects that differ only
 * in key order do not read as a change — the machine diff already treats them
 * as equal, and a human diff that disagreed with it would be worse than none.
 */
export function renderDiff(entries: readonly ConfigDiffEntry[]): string {
  if (entries.length === 0) return "No values change."
  return entries
    .map((entry) => {
      switch (entry.change) {
        case "added":
          return `+ ${entry.key} = ${stableStringify(entry.after)}`
        case "removed":
          return `- ${entry.key}  (was ${stableStringify(entry.before)})`
        default:
          return `~ ${entry.key}: ${stableStringify(entry.before)} -> ${stableStringify(entry.after)}`
      }
    })
    .join("\n")
}

/** A named environment to resolve against. Not an expected output — see the header. */
export interface Fixture {
  name: string
  /** Extra layers this fixture adds, e.g. an org-unit overlay a large tenant has. */
  layers?: readonly VersionedLayer[]
  at?: Date
}

export interface SimulationResult {
  fixture: string
  /** Null when resolution failed outright. */
  values: Readonly<Record<string, unknown>> | null
  checksum: string | null
  rejections: readonly Rejection[]
  problems: readonly string[]
}

/**
 * Resolve the proposal against each fixture, through the real resolver.
 *
 * A fixture that fails to resolve is a result, not an exception: the point of
 * simulating is to find out which environments break, and throwing on the first
 * one hides the rest.
 */
export function simulate(
  registry: ConfigRegistry,
  proposed: readonly VersionedLayer[],
  fixtures: readonly Fixture[],
  at: Date,
): readonly SimulationResult[] {
  return fixtures.map((fixture) => {
    const layers = [...proposed, ...(fixture.layers ?? [])]
    try {
      const result = resolveVersionedLayers(registry, layers, fixture.at ?? at, { collectProblems: true })
      return {
        fixture: fixture.name,
        values: result.config ? result.config.values : null,
        checksum: result.config ? result.config.checksum : null,
        rejections: result.rejections,
        problems: result.problems.map((p) => `${p.key}: ${p.detail}`),
      }
    } catch (error) {
      return {
        fixture: fixture.name,
        values: null,
        checksum: null,
        rejections: [],
        problems: [error instanceof Error ? error.message : String(error)],
      }
    }
  })
}

export interface PublicationInput {
  registry: ConfigRegistry
  /** What is live now. Null for a first publication, which is a stated case rather than an implied one. */
  current: { values: Readonly<Record<string, unknown>>; revision: number } | null
  proposed: readonly VersionedLayer[]
  publishedBy: string
  /** When it takes effect. Refused if in the past — a schedule nobody can act on. */
  activateAt: Date
  now: Date
  fixtures?: readonly Fixture[]
  modules?: readonly ModuleLike[]
  enabledModules?: readonly string[]
  entitlements?: readonly string[]
}

export interface PublicationPlan {
  /** True only when nothing rejects. Lint never contributes; there is a test. */
  blocked: boolean
  blockers: readonly string[]
  rejections: readonly Rejection[]
  /**
   * Platform invariants a tenant-authored change may not touch (GE-032-002).
   *
   * Separate from `rejections` because the answer differs: a rejection is
   * "this configuration is wrong", a violation is "this is not yours to
   * change". Both block, and an operator needs to know which they are looking
   * at before deciding whether to fix it or to ask.
   */
  violations: readonly AuthorityViolation[]
  lint: readonly LintFinding[]
  diff: readonly ConfigDiffEntry[]
  humanDiff: string
  impact: Impact
  simulations: readonly SimulationResult[]
  /**
   * The revision this would return to.
   *
   * `null` on a first publication, and that is reported rather than hidden: a
   * change with nothing to roll back to is a different risk from one with a
   * rollback target, and an operator should be told which they are signing.
   */
  rollbackTo: number | null
  activateAt: string
}

/** Everything an operator needs before signing, in one object. */
export function planPublication(input: PublicationInput): PublicationPlan {
  const {
    registry,
    current,
    proposed,
    publishedBy,
    activateAt,
    now,
    fixtures = [],
    modules = [],
    enabledModules = [],
    entitlements = [],
  } = input

  const rejections = allRejections({ layers: proposed, modules, enabledModules, entitlements })

  // GE-032-002. Without this the domain refusal happened at RESOLUTION: the
  // value was stripped, the plan showed no blockers, and the change published
  // cleanly and quietly did nothing. An operator who submits a residency change
  // and sees it accepted has been told their data moved.
  const violations = authorityViolations({
    layers: proposed,
    knownKeys: new Set(registry.keys()),
    enabledModules,
    entitlements,
    moduleEntitlements: Object.fromEntries(modules.map((m) => [m.key, m.entitlement])),
  })
  const lintFindings = lint(proposed, registry, publishedBy)

  const blockers: string[] = []

  // Four eyes. The lifecycle engine enforces this for tenant state transitions;
  // configuration needs it for the same reason — an approval by the person
  // making the change records a second signature that was never obtained.
  for (const layer of proposed) {
    if (layer.metadata.approvedBy && layer.metadata.approvedBy === publishedBy) {
      blockers.push(
        `"${layer.id}" is approved by ${publishedBy}, who is publishing it. An approval by the author is not a second pair of eyes.`,
      )
    }
  }

  if (activateAt.getTime() < now.getTime()) {
    blockers.push(
      `Activation is scheduled for ${activateAt.toISOString()}, which is in the past. A schedule nobody can act on is not a schedule.`,
    )
  }

  // Resolve the proposal once to produce the diff and the impact.
  let proposedValues: Readonly<Record<string, unknown>> = {}
  try {
    const resolved = resolveVersionedLayers(registry, proposed, activateAt, { collectProblems: true })
    if (resolved.config) proposedValues = resolved.config.values
    else blockers.push("The proposed configuration does not resolve.")
  } catch (error) {
    blockers.push(`The proposed configuration does not resolve: ${error instanceof Error ? error.message : error}`)
  }

  const before = current?.values ?? {}
  const diff: ConfigDiffEntry[] = []
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(proposedValues)])].sort()) {
    const inBefore = key in before
    const inAfter = key in proposedValues
    if (inBefore && !inAfter) diff.push({ key, change: "removed", before: before[key] })
    else if (!inBefore && inAfter) diff.push({ key, change: "added", after: proposedValues[key] })
    else if (stableStringify(before[key]) !== stableStringify(proposedValues[key])) {
      diff.push({ key, change: "changed", before: before[key], after: proposedValues[key] })
    }
  }

  const simulations = simulate(registry, proposed, fixtures, activateAt)

  const impact: Impact = {
    keysAdded: diff.filter((d) => d.change === "added").length,
    keysRemoved: diff.filter((d) => d.change === "removed").length,
    keysChanged: diff.filter((d) => d.change === "changed").length,
    // Named, not counted. "3 modules affected" sends an operator to find out
    // which; the whole point of a preview is not having to.
    modulesAffected: diff
      .filter((d) => d.key.startsWith("platform.flags.") || d.key.startsWith("platform.modules."))
      .map((d) => d.key)
      .sort(),
    fixturesAffected: simulations
      .filter((s) => s.checksum === null || s.rejections.length > 0 || s.problems.length > 0)
      .map((s) => s.fixture)
      .sort(),
  }

  return {
    // Rejections and blockers only. Lint is absent from this expression on
    // purpose, and `publication.test.ts` asserts that a lint-heavy proposal
    // with no rejections is publishable.
    blocked: rejections.length > 0 || blockers.length > 0 || violations.length > 0,
    blockers,
    rejections,
    violations,
    lint: lintFindings,
    diff,
    humanDiff: renderDiff(diff),
    impact,
    simulations,
    rollbackTo: current?.revision ?? null,
    activateAt: activateAt.toISOString(),
  }
}
