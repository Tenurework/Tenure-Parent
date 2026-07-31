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

  for (const m of system.input.modules) {
    if (!m.version) {
      problems.push({ area: "release", detail: `Module "${m.key}" is pinned with no version.` })
    }
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
