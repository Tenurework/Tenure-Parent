import { getBlueprint, getTenantBinding } from "@tenure/blueprints"
import { SEPARATION_OF_DUTIES } from "@tenure/authorization"
import { validateTopology } from "@tenure/organization-model"
import {
  createRelease,
  validateSystem,
  type SystemRelease,
  type ValidationResult,
} from "@tenure/releases"

import { modulesFor } from "@/lib/config/system-modules"
import { REGISTRY, layersFor } from "@/lib/config/system-config"
import { resolveConfig } from "@tenure/configuration"

/**
 * Assemble one organization system from its parts, and say whether it holds
 * together.
 *
 * This is the function the System Studio's "validate" button calls, the one
 * provisioning calls before it creates anything, and the one a release
 * candidate is built from. Having exactly one of it is the point: three
 * separate assemblies of the same five inputs would drift, and the drift would
 * only show up as a tenant whose preview and production differ.
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
  validation: ValidationResult
  /** Only present when validation passed. */
  candidate: SystemRelease | null
}

export interface BuildSystemOptions {
  /** Who is building it. Recorded on the release. */
  actor: string
  /** Supplied so an artifact is reproducible in a test. */
  at: string
  notes: string
  /** The tenant's currently active release, for revision numbering. */
  previous?: SystemRelease | null
}

export function buildSystem(
  institutionSlug: string,
  options: BuildSystemOptions,
): AssembledSystem {
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
  const { config, problems: configurationProblems } = resolveConfig(REGISTRY, layersFor(institutionSlug), {
    collectProblems: true,
  })

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
  const modulePins = modules.enabled.map((m) => ({ key: m.key, version: m.version }))

  const releaseInput = {
    tenantId: institutionSlug,
    blueprintId: blueprint.id,
    blueprintVersion: blueprint.version,
    topologyId: blueprint.topology.id,
    topologyVersion: blueprint.topology.version,
    modules: modulePins,
    configurationChecksum: config?.checksum ?? "(unresolved)",
    policyIds,
    notes: options.notes,
    createdBy: options.actor,
    createdAt: options.at,
    previous: options.previous ?? null,
  }

  const validation = validateSystem({
    input: releaseInput,
    // A module refused on entitlement is not a defect in the system definition —
    // it is the definition working. The blueprint asks, the entitlement decides,
    // and the release pins the result. Anything else refused IS a defect.
    moduleProblems: modules.problems.filter((p) => p.reason !== "missing-entitlement"),
    configurationProblems: configurationProblems.map((p) => ({
      key: p.key,
      reason: p.reason,
      detail: p.detail,
    })),
    topologyValid,
    topologyProblems,
    enabledModuleKeys: modules.keys,
  })

  return {
    tenantId: institutionSlug,
    blueprintId: blueprint.id,
    blueprintVersion: blueprint.version,
    configurationChecksum: config?.checksum ?? null,
    moduleKeys: modules.keys,
    policyIds,
    validation,
    candidate: validation.valid ? createRelease(releaseInput) : null,
  }
}
