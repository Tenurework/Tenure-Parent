import { SEPARATION_OF_DUTIES } from "@tenure/authorization"
import { getBlueprint, getTenantBinding } from "@tenure/blueprints"
import { resolveConfig } from "@tenure/configuration"
import { MODULE_CATALOG } from "@tenure/modules"
import { satisfiesRange } from "@tenure/module-runtime"
import { validateTopology } from "@tenure/organization-model"
import {
  breakingChanges,
  createRelease,
  diffReleases,
  signRelease,
  transition,
  validateSystem,
  type ReleaseDiffEntry,
  type ReleaseInput,
  type ReleaseState,
  type SigningKey,
  type SystemRelease,
  type SystemUnderValidation,
  type ValidationResult,
} from "@tenure/releases"

import { compareVersions, parseVersion, type CompatibilityVerdict } from "./compatibility"
import { modulesFor } from "./modules"
import { REGISTRY, layersFor } from "./resolve"

/**
 * Assemble one organization system from its parts, and say whether it holds
 * together.
 *
 * Having exactly one of this is the point: separate assemblies of the same
 * inputs drift, and the drift only shows up as a tenant whose preview and
 * production differ. It lives in this package rather than in an application for
 * the reason this package exists at all — the tenant application and the System
 * Studio need the SAME answer to "what is this institution's system", and two
 * copies of that answer is two answers.
 *
 * It previously lived in `apps/web/src/lib/system/build-system.ts` and claimed,
 * in its own docstring, to be what the Studio's validate button called. It was
 * not: it had one importer, its own test, and the Studio re-derived its own
 * assembly a repository away. That claim is now true because the Studio can
 * reach this, not because the sentence was left in place.
 *
 * Nothing here knows any tenant's name. It reads a binding, resolves the parts,
 * and reports.
 */

export interface AssembledSystem {
  tenantId: string
  blueprintId: string
  blueprintVersion: string
  /** Configuration, resolved and checksummed. Null when it did not resolve. */
  configurationChecksum: string | null
  moduleKeys: readonly string[]
  policyIds: readonly string[]
  /** The migration this system's database is expected to be at. */
  schemaVersion: string
  validation: ValidationResult
  /**
   * Only present when validation passed, and signed when a signing key is
   * configured. An unsigned candidate cannot be approved — `transition` refuses
   * it — so a system with no key produces a visible dead end rather than an
   * artifact that quietly nobody can be held to.
   */
  candidate: SystemRelease | null
}

export interface BuildSystemOptions {
  /** Who is building it. Recorded on the release. */
  actor: string
  /** Supplied so an artifact is reproducible in a test. */
  at: string
  notes: string
  /** The tenant's currently active release, for revision numbering and downgrade detection. */
  previous?: SystemRelease | null
  /**
   * The migration this artifact runs against.
   *
   * Defaults to `SCHEMA_VERSION`, the same variable the Studio's execution
   * context reads. A caller that knows better — the Studio, which knows the
   * schema the target CELL is at, rather than the one this process was built
   * against — passes it explicitly.
   */
  schemaVersion?: string
  /**
   * Migrations the target reports as applied. When supplied, a release pinning
   * a schema that is not among them is refused. Omitted means the caller does
   * not know, which is not the same as "everything is applied".
   */
  appliedMigrations?: readonly string[]
  /**
   * The key to sign with. Defaults to the environment. `null` forces an
   * unsigned artifact, which only a test that is asserting on the approval gate
   * has any reason to want.
   */
  signWith?: SigningKey | null
}

/** `major.minor.patch`, through the one comparator this package owns. */
const compareModuleVersions = (a: string, b: string): number =>
  compareVersions(parseVersion(a), parseVersion(b))

/** The resolved parts of a system, before anything has judged them. */
export interface SystemParts {
  input: ReleaseInput
  moduleProblems: readonly { moduleKey: string; reason: string; detail: string }[]
  configurationProblems: readonly { key: string; reason: string; detail: string }[]
  topologyValid: boolean
  topologyProblems: readonly string[]
  enabledModuleKeys: readonly string[]
  previous?: SystemRelease | null
  appliedMigrations?: readonly string[]
}

/**
 * The question this platform puts to `validateSystem`, in exactly one place.
 *
 * Everything a release is checked against — the declared process chains, the
 * version comparator, what the catalog still ships, which migrations the target
 * has applied — is attached here rather than at each call site. A caller that
 * assembles this object itself is a caller that can forget one of them, and a
 * forgotten input is a check that silently does not run: the whole reason the
 * downgrade rule and the chain rule existed as unreachable code before this.
 *
 * Exported so a test can put a system through the identical question with one
 * part changed. That is what makes "the chains are wired in" falsifiable rather
 * than asserted — drop `chains` here and a test reds.
 */
export function systemUnderValidation(parts: SystemParts): SystemUnderValidation {
  return {
    input: parts.input,
    // A module the system's own definition declined is not a defect in that
    // definition — it is the definition working. The preset asks, an entitlement
    // (commercial) or an operating-model axis (structural) decides, and the
    // release pins the result. Anything ELSE refused is a defect: an unknown
    // module, a missing dependency, an incompatibility, a cycle. Those mean the
    // system as described cannot be built, which is what validation is for.
    moduleProblems: parts.moduleProblems.filter(
      (p) => p.reason !== "missing-entitlement" && p.reason !== "wrong-operating-model",
    ),
    configurationProblems: parts.configurationProblems,
    topologyValid: parts.topologyValid,
    topologyProblems: parts.topologyProblems,
    enabledModuleKeys: parts.enabledModuleKeys,
    // The processes that cross these modules, as the catalog declares them.
    // Checked here rather than inside `modulesFor`, because a broken chain is
    // not a resolution problem — every module resolved — it is a system that
    // resolves cleanly and cannot finish the work it exists to do.
    chains: MODULE_CATALOG.chains(),
    // The pins, against the release being replaced and against what the catalog
    // can still ship. Both were unchecked: a candidate could move a pin
    // backwards, or name a version the catalog had withdrawn, and validate clean.
    previousModules: parts.previous?.modules,
    compare: compareModuleVersions,
    catalogVersions: Object.fromEntries(MODULE_CATALOG.all().map((m) => [m.key, m.version])),
    // PACK-010-002. Every declared dependency edge, with the capability
    // resolved to the modules that actually provide it, so the pinned VERSIONS
    // are checked against the declared RANGES. The key-set check above proves
    // the release pins what resolved; a release can satisfy that and still pin a
    // ledger three major versions below what the module needing it declares.
    moduleDependencies: MODULE_CATALOG.all().flatMap((m) =>
      (m.dependsOn ?? []).map((dependency) => ({
        module: m.key,
        dependsOn: dependency.module,
        range: dependency.range,
        satisfiedBy: MODULE_CATALOG.has(dependency.module)
          ? [dependency.module]
          : MODULE_CATALOG.providersOf(dependency.module),
      })),
    ),
    satisfiesRange: (version, range) => satisfiesRange(version, range, compareModuleVersions),
    appliedMigrations: parts.appliedMigrations,
  }
}

/**
 * The signing key, from the environment.
 *
 * Absent is a legitimate state — a developer checkout has no key — and produces
 * an unsigned candidate rather than a throw, because a build that cannot be
 * inspected is worse than one that cannot be approved. The refusal happens at
 * the approval gate, where it names the missing signature.
 */
function signingKeyFromEnvironment(): SigningKey | null {
  const keyId = process.env.RELEASE_SIGNING_KEY_ID?.trim()
  const secret = process.env.RELEASE_SIGNING_SECRET?.trim()
  if (!keyId || !secret) return null
  return { keyId, secret }
}

export function buildSystem(institutionSlug: string, options: BuildSystemOptions): AssembledSystem {
  const binding = getTenantBinding(institutionSlug)
  if (!binding) {
    throw new Error(
      `No tenant binding for "${institutionSlug}". A system cannot be assembled for an ` +
        `institution nothing has configured — that is a provisioning step, not a default.`,
    )
  }

  const blueprint = getBlueprint(binding.blueprintId)
  if (!blueprint) {
    throw new Error(
      `Institution "${institutionSlug}" is bound to blueprint "${binding.blueprintId}", which does not exist.`,
    )
  }

  // Configuration. collectProblems, not throw: assembling a system is exactly
  // the moment an operator wants every problem listed at once.
  const { config, problems: configurationProblems } = resolveConfig(
    REGISTRY,
    layersFor(institutionSlug),
    { collectProblems: true },
  )

  const modules = modulesFor(institutionSlug)

  let topologyValid = true
  let topologyProblems: string[] = []
  try {
    validateTopology(blueprint.topology)
  } catch (err) {
    topologyValid = false
    topologyProblems = err instanceof Error ? [err.message] : [String(err)]
  }

  const policyIds = SEPARATION_OF_DUTIES.map((p) => p.id)

  // A release pins exactly what the resolver enabled. Pinning the blueprint's
  // request instead would produce an artifact that disagrees with the running
  // system whenever an entitlement refuses something.
  // PACK-030-002. Lifecycle and mode travel with the pin, so the artifact can
  // say what a module WAS when this system was frozen — a version number cannot
  // express "and it was deprecated", and six months later nobody can tell.
  const modulePins = modules.enabled.map((m) => ({
    key: m.key,
    version: m.version,
    lifecycle: m.lifecycle,
    mode: m.mode ?? "TENURE_NATIVE",
  }))

  const schemaVersion =
    options.schemaVersion?.trim() || process.env.SCHEMA_VERSION?.trim() || "unpinned"

  const releaseInput: ReleaseInput = {
    tenantId: institutionSlug,
    blueprintId: blueprint.id,
    blueprintVersion: blueprint.version,
    topologyId: blueprint.topology.id,
    topologyVersion: blueprint.topology.version,
    modules: modulePins,
    configurationChecksum: config?.checksum ?? "(unresolved)",
    policyIds,
    schemaVersion,
    notes: options.notes,
    createdBy: options.actor,
    createdAt: options.at,
    previous: options.previous ?? null,
  }

  const validation = validateSystem(
    systemUnderValidation({
      input: releaseInput,
      moduleProblems: modules.problems,
      configurationProblems: configurationProblems.map((p) => ({
        key: p.key,
        reason: p.reason,
        detail: p.detail,
      })),
      topologyValid,
      topologyProblems,
      enabledModuleKeys: modules.keys,
      previous: options.previous,
      appliedMigrations: options.appliedMigrations,
    }),
  )

  const key = options.signWith === undefined ? signingKeyFromEnvironment() : options.signWith
  const unsigned = validation.valid ? createRelease(releaseInput) : null

  return {
    tenantId: institutionSlug,
    blueprintId: blueprint.id,
    blueprintVersion: blueprint.version,
    configurationChecksum: config?.checksum ?? null,
    moduleKeys: modules.keys,
    policyIds,
    schemaVersion,
    validation,
    candidate: unsigned && key ? signRelease(unsigned, key) : unsigned,
  }
}

/**
 * The states a release passes through on its way to serving everyone, in order.
 *
 * `canary` is in the middle deliberately. Approval says a release MAY go out; it
 * does not say the whole fleet takes it at the same instant. Before this,
 * `approved → active` meant the first evidence that a release was bad was every
 * tenant having it.
 */
export const ROLLOUT_PATH: readonly ReleaseState[] = [
  "validated",
  "approved",
  "scheduled",
  "canary",
  "active",
]

export interface PromotionStep {
  to: ReleaseState
  reached: boolean
  /** Why it was not reached. Null when it was. */
  refusedBecause: string | null
}

export interface PromotionPlan {
  releaseId: string
  /** The furthest state this release can legally reach right now. */
  reachable: ReleaseState | "draft"
  steps: readonly PromotionStep[]
  /** The single sentence that explains a stalled promotion. Null when it reaches `active`. */
  blocked: string | null
  /** What changed against the release supplied as `previous`. */
  diff: readonly ReleaseDiffEntry[]
  /** The subset of the diff that takes capability away. */
  breaking: readonly ReleaseDiffEntry[]
}

export interface PromotionInput {
  candidate: SystemRelease
  validation: ValidationResult
  /** From `compatibilityFor`. A cell that cannot honour the configuration must not serve it. */
  compatibility: CompatibilityVerdict
  approver: string
  at: string
  /** The release this would replace, when there is one. */
  previous?: SystemRelease | null
  /**
   * Whether an operator has explicitly accepted the capability this release
   * removes. Unacknowledged breaking changes stop the promotion at `approved`.
   */
  acknowledgeBreaking?: boolean
}

/**
 * Walk a candidate as far towards `active` as the gates allow, and say where it
 * stopped.
 *
 * Every gate is exercised by actually calling `transition` rather than by
 * re-stating its rules here. A promotion screen that decided for itself which
 * moves were legal would be a second copy of the state machine, and the copy
 * that drifts is whichever nobody is looking at — which is the same failure the
 * Studio's tenant page already avoids by reading `nextStates` from the
 * lifecycle engine instead of listing buttons.
 *
 * Nothing is persisted. This answers "what would happen", which is what an
 * operator needs before deciding, and is the honest limit of what can be done
 * while there is no store for release artifacts.
 */
export function planPromotion(input: PromotionInput): PromotionPlan {
  const diff = input.previous ? diffReleases(input.previous, input.candidate) : []
  const breaking = diff.length > 0 ? breakingChanges(diff, compareModuleVersions) : []

  const steps: PromotionStep[] = []
  let current = input.candidate
  let blocked: string | null = null

  for (const to of ROLLOUT_PATH) {
    let refusal: string | null = null

    // The gates that are about the system rather than about the state machine
    // are checked before the move they guard, so the reason names the real
    // cause instead of "cannot move from validated to approved".
    if (to === "validated" && !input.validation.valid) {
      refusal =
        `The system did not validate: ` +
        input.validation.problems.map((p) => `[${p.area}] ${p.detail}`).join(" ")
    } else if (to === "approved" && !input.compatibility.compatible) {
      const first = input.compatibility.problems[0]
      refusal = first
        ? `The cell running this tenant cannot honour "${first.key}" (${first.reason}; ` +
          `requires ${first.requires}, running ${first.running}). Refusing is visible; ` +
          `half-applying a configuration is not.`
        : `The cell cannot state an engine version, so it cannot claim to be new enough.`
    } else if (to === "approved" && breaking.length > 0 && !input.acknowledgeBreaking) {
      refusal =
        `This release removes capability and nobody has said that is intended: ` +
        breaking.map((b) => `${b.field} ${b.change}`).join(", ") +
        `. Acknowledge the breaking changes to continue.`
    }

    if (!refusal) {
      try {
        current = transition(
          current,
          to,
          to === "approved" ? { actor: input.approver, at: input.at } : undefined,
        )
      } catch (err) {
        refusal = err instanceof Error ? err.message : String(err)
      }
    }

    steps.push({ to, reached: refusal === null, refusedBecause: refusal })
    if (refusal) {
      blocked = refusal
      break
    }
  }

  return {
    releaseId: input.candidate.releaseId,
    reachable: current.state,
    steps,
    blocked,
    diff,
    breaking,
  }
}
