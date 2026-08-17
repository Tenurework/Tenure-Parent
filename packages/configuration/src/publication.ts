import { findSecretValues } from "@tenure/audit"
import { isPaymentMode, PAYMENT_MODE_CONFIG_KEY, type PaymentMode } from "@tenure/contracts"

import type { ConfigRegistry } from "./definition"
import { resolveVersionedLayers } from "./layer-bridge"
import type { VersionedLayer } from "./layer-schema"
import { stableStringify } from "./merge"
import { authorityViolations, type AuthorityViolation } from "./authority"
import { applyExceptions, type GuardrailException } from "./exceptions"
import { allRejections, type ModuleLike, type Rejection } from "./rejections"
import {
  compileGraph,
  graphSigningKeyFromEnv,
  snapshotBlockers,
  type GraphSnapshot,
  type PackageManifest,
} from "./graph-snapshot"
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
  /** Approved guardrail exceptions to weigh against the violations. */
  exceptions?: readonly GuardrailException[]
  modules?: readonly ModuleLike[]
  enabledModules?: readonly string[]
  entitlements?: readonly string[]
  /**
   * Capabilities the publishing principal actually holds (PAY-000-007).
   *
   * Empty by default, which is the fail-closed direction: a definition
   * declaring `requiresCapability` is unpublishable until a caller says who is
   * publishing and what they hold. Nothing declared one before this existed, so
   * no existing publication changes behaviour — but the day one does, the
   * declaration is a control rather than a comment.
   */
  publisherCapabilities?: readonly string[]
}

/**
 * The tenant's money-mode as its CURRENT configuration says it is.
 *
 * Read off `current.values` rather than taken as a separate input, deliberately:
 * the mode is itself a published configuration value, so a second parameter
 * would be a second source of truth able to disagree with the one the resolver
 * reads. Absent or unrecognised resolves to `test` — the direction that
 * withholds rather than grants.
 */
export function currentPaymentMode(
  current: { values: Readonly<Record<string, unknown>> } | null,
): PaymentMode {
  const value = current?.values?.[PAYMENT_MODE_CONFIG_KEY]
  return isPaymentMode(value) ? value : "test"
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
  /**
   * Violations an approved exception permitted, and which one (GE-032-004).
   *
   * Recorded, not merely removed. A publication that proceeded because an
   * operator reviewed a request must carry which exception and for which key,
   * or the audit trail says a change was clean when it was permitted.
   */
  excused: readonly { exceptionId: string; invariant: string; key: string }[]
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
  /**
   * The compiled configuration graph this publication would run under (CFG-030).
   *
   * Set on every plan, because "the graph compiled cleanly" and "nobody compiled
   * the graph" are different answers and a plan that omitted the snapshot when it
   * was clean would make them look the same. Its `digest` is what an approval can
   * be bound to; its `problems` are already folded into `blockers`.
   *
   * Optional in the TYPE and unconditional in the code, which is a deliberate
   * trade and not an oversight. `PublicationPlan` is built as an object literal by
   * fixtures in two other applications' test files, and making the field required
   * would red their type-check for a field they have no reason to care about. The
   * guarantee is therefore asserted rather than typed: `graph-snapshot.test.ts`
   * fails if `planPublication` ever returns a plan without it. There is exactly
   * one producer of this object, so a test is a sufficient place to hold the
   * invariant; if a second producer appears, make it required.
   */
  graph?: GraphSnapshot
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
    exceptions = [],
    modules = [],
    enabledModules = [],
    entitlements = [],
    publisherCapabilities = [],
  } = input

  const rejections = allRejections({ layers: proposed, modules, enabledModules, entitlements })

  // GE-032-002. Without this the domain refusal happened at RESOLUTION: the
  // value was stripped, the plan showed no blockers, and the change published
  // cleanly and quietly did nothing. An operator who submits a residency change
  // and sees it accepted has been told their data moved.
  const allViolations = authorityViolations({
    layers: proposed,
    knownKeys: new Set(registry.keys()),
    enabledModules,
    entitlements,
    moduleEntitlements: Object.fromEntries(modules.map((m) => [m.key, m.entitlement])),
  })

  // An exception excuses a violation; it does not make the tenant able to
  // write. The operator publishes, with the reviewed request attached.
  const { remaining: violations, relied: excused } = applyExceptions(allViolations, exceptions, now)
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

  // PAY-000-007 — mode separation, and the capability that gates a mode change.
  //
  // The tenant's mode is whatever its CURRENT configuration resolves to, not
  // whatever this proposal would set it to. That ordering is the control: a
  // proposal that flips the mode to live AND carries live-only values is
  // blocked, because at the moment it is signed the tenant is still in test and
  // nobody has reviewed the live values under a live tenant. Flip first, with
  // its own diff, then publish what the flip made meaningful.
  const held = new Set(publisherCapabilities)
  const modeNow = currentPaymentMode(current)

  // ── WRK-040-005: the configuration sink ─────────────────────────────────────
  //
  // `sensitivity: "secret"` is a LABEL on a definition. It changes how a value
  // is displayed and who is shown it; it has never refused a value on the
  // grounds of what the value IS. So `sk_live_…` typed into any ordinary
  // `platform.*` string — a support note, a webhook URL, a display name —
  // resolved into the snapshot every request reads, was checksummed into a
  // revision, and became part of an immutable version history that cannot be
  // un-published. That is the worst of the six sinks this item names: the other
  // five leak a credential to somewhere it can be deleted from.
  //
  // Refuse rather than redact, exactly as the outbox does. A published
  // configuration with a hole in it is a tenant running on values nobody
  // authored, and the operator who submitted the change would be told it
  // succeeded.
  //
  // Scanned per layer so the blocker names the layer AND the key, which is the
  // difference between "somewhere in this publication" and a line to edit.
  for (const layer of proposed) {
    for (const found of findSecretValues(layer.values)) {
      blockers.push(
        `"${layer.id}" sets "${found.path}" to a value that looks like a ${found.kind}. ` +
          `A published configuration value is resolved into every snapshot this tenant reads and ` +
          `is checksummed into an immutable revision, so it cannot be un-published. Rotate the ` +
          `credential, then put a reference to the vault here instead of the secret itself.`,
      )
    }
  }

  for (const layer of proposed) {
    for (const key of Object.keys(layer.values)) {
      const definition = registry.get(key)
      if (!definition) continue

      if (definition.requiresCapability && !held.has(definition.requiresCapability)) {
        blockers.push(
          `"${layer.id}" sets "${key}", which requires the capability "${definition.requiresCapability}". ` +
            `The principal publishing this holds ${held.size === 0 ? "none" : [...held].sort().join(", ")}. ` +
            `A key that decides authority is not published by whoever can reach the form.`,
        )
      }

      if (definition.liveOnly && modeNow === "test") {
        blockers.push(
          `"${layer.id}" sets "${key}", which only means anything in live mode, while this tenant is in ` +
            `test mode. Publish the mode change first — "${PAYMENT_MODE_CONFIG_KEY}" is its own change, ` +
            `with its own diff and its own approval — so a live-only value is never sitting dormant ` +
            `waiting for a flip nobody re-reads it at.`,
        )
      }
    }
  }

  // CFG-030 — compile the package closure into one typed graph before anything
  // is signed.
  //
  // The catalogue reaching this function is the closure the tenant would run:
  // `modules` already carries `dependsOn` and `provides`, so no new input is
  // needed and no caller has to be changed for the compile to be live. Only the
  // problems `allRejections` does not already report are added as blockers —
  // `snapshotBlockers` says which and why — so an operator never sees one defect
  // twice.
  const graph = compileGraph({
    packages: modules as readonly PackageManifest[],
    enabled: enabledModules,
    signWith: graphSigningKeyFromEnv(),
  })
  blockers.push(...snapshotBlockers(graph))

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
    excused,
    lint: lintFindings,
    diff,
    humanDiff: renderDiff(diff),
    impact,
    simulations,
    rollbackTo: current?.revision ?? null,
    activateAt: activateAt.toISOString(),
    graph,
  }
}
