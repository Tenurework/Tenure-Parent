import { createHash } from "node:crypto"

import { stableStringify } from "@tenure/configuration"

/**
 * An immutable, citable statement of what one organization system *is*.
 *
 * The problem it solves: a running system is currently the sum of a blueprint,
 * a set of enabled modules, a resolved configuration, an org topology and a set
 * of policies — five things that can each change independently, with nothing
 * recording which combination was live when a workflow ran, an approval was
 * decided, or an audit record was written.
 *
 * A release is that combination, frozen and hashed. Everything downstream cites
 * a release id instead of "whatever was configured at the time", and rollback
 * becomes "publish the previous artifact again" rather than an attempt to
 * reverse five independent edits in the right order.
 *
 * Deliberately not a deployment. A release says what a system is; deploying it
 * is a separate act with its own gates. Conflating them is how a configuration
 * mistake becomes an outage instead of a rejected candidate.
 */

export type ReleaseState =
  | "draft"
  | "validated"
  | "approved"
  | "active"
  | "superseded"
  | "rolled-back"
  | "rejected"

/** Legal transitions. Anything absent is refused, with both states named. */
const TRANSITIONS: Readonly<Record<ReleaseState, readonly ReleaseState[]>> = {
  draft: ["validated", "rejected"],
  validated: ["approved", "rejected", "draft"],
  approved: ["active", "rejected"],
  active: ["superseded", "rolled-back"],
  superseded: [],
  "rolled-back": [],
  rejected: [],
}

export interface ModulePin {
  key: string
  version: string
}

export interface ReleaseInput {
  tenantId: string
  blueprintId: string
  blueprintVersion: string
  topologyId: string
  topologyVersion: string
  /** Enabled modules, pinned to the versions this release ships. */
  modules: readonly ModulePin[]
  /** Checksum of the resolved configuration — see @tenure/configuration. */
  configurationChecksum: string
  /** Ids of the policies in force. */
  policyIds: readonly string[]
  notes: string
  createdBy: string
  /** Supplied, never read from a clock, so an artifact is reproducible in a test. */
  createdAt: string
  /** The currently active release for this tenant, if any. */
  previous?: SystemRelease | null
}

export interface SystemRelease {
  readonly releaseId: string
  readonly tenantId: string
  readonly revision: number
  readonly state: ReleaseState

  readonly blueprintId: string
  readonly blueprintVersion: string
  readonly topologyId: string
  readonly topologyVersion: string
  readonly modules: readonly ModulePin[]
  readonly configurationChecksum: string
  readonly policyIds: readonly string[]

  /** Content hash of everything above. Two identical systems hash identically. */
  readonly checksum: string

  readonly notes: string
  readonly createdBy: string
  readonly createdAt: string
  readonly approvedBy?: string
  readonly approvedAt?: string

  /** The revision this replaced. */
  readonly supersedes: number | null
  /** For a rolled-back release, the revision restored. */
  readonly rolledBackTo?: number
}

export class ReleaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReleaseError"
  }
}

/** The content a release's checksum covers. Order-independent by construction. */
function contentOf(input: ReleaseInput) {
  return {
    tenantId: input.tenantId,
    blueprintId: input.blueprintId,
    blueprintVersion: input.blueprintVersion,
    topologyId: input.topologyId,
    topologyVersion: input.topologyVersion,
    // Sorted, so the same system assembled in a different order hashes the same.
    modules: [...input.modules]
      .map((m) => ({ key: m.key, version: m.version }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    configurationChecksum: input.configurationChecksum,
    policyIds: [...input.policyIds].sort(),
  }
}

export function checksumOfRelease(input: ReleaseInput): string {
  return `sha256:${createHash("sha256").update(stableStringify(contentOf(input))).digest("hex")}`
}

/**
 * Create a release candidate. Always starts as a draft.
 *
 * Refuses a candidate identical to the active release: publishing one would
 * create a revision that changed nothing, so "which release introduced this?"
 * stops having a single answer.
 */
export function createRelease(input: ReleaseInput): SystemRelease {
  if (!input.tenantId) throw new ReleaseError("A release must name a tenant.")
  if (!input.createdBy) throw new ReleaseError("A release must name who created it.")
  if (!input.notes.trim()) {
    throw new ReleaseError(
      "A release needs notes. The diff shows what changed; only the notes say why.",
    )
  }
  if (input.modules.length === 0) {
    throw new ReleaseError("A release with no modules would produce a system that does nothing.")
  }
  if (!input.configurationChecksum.startsWith("sha256:")) {
    throw new ReleaseError(
      `configurationChecksum must be a resolved configuration's checksum, got ` +
        `${JSON.stringify(input.configurationChecksum)}.`,
    )
  }

  const previous = input.previous ?? null
  if (previous && previous.tenantId !== input.tenantId) {
    throw new ReleaseError(
      `Previous release belongs to tenant "${previous.tenantId}", not "${input.tenantId}".`,
    )
  }

  const checksum = checksumOfRelease(input)
  if (previous && previous.checksum === checksum && previous.state === "active") {
    throw new ReleaseError(
      `Nothing changed: the active release r${previous.revision} already has checksum ${checksum}.`,
    )
  }

  const revision = (previous?.revision ?? 0) + 1

  return Object.freeze({
    releaseId: `${input.tenantId}@r${revision}`,
    tenantId: input.tenantId,
    revision,
    state: "draft" as const,
    blueprintId: input.blueprintId,
    blueprintVersion: input.blueprintVersion,
    topologyId: input.topologyId,
    topologyVersion: input.topologyVersion,
    modules: Object.freeze([...input.modules].map((m) => Object.freeze({ ...m }))),
    configurationChecksum: input.configurationChecksum,
    policyIds: Object.freeze([...input.policyIds]),
    checksum,
    notes: input.notes,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    supersedes: previous?.revision ?? null,
  })
}

/**
 * Move a release to another state, or refuse.
 *
 * Every transition returns a new frozen object. Nothing mutates, so a reference
 * held elsewhere — in a workflow instance, an audit row — keeps meaning what it
 * meant when it was taken.
 */
export function transition(
  release: SystemRelease,
  to: ReleaseState,
  by?: { actor: string; at: string },
): SystemRelease {
  const allowed = TRANSITIONS[release.state]
  if (!allowed.includes(to)) {
    throw new ReleaseError(
      `Cannot move release ${release.releaseId} from "${release.state}" to "${to}". ` +
        `Legal from "${release.state}": ${allowed.length ? allowed.join(", ") : "(terminal)"}.`,
    )
  }

  if (to === "approved") {
    if (!by?.actor) {
      throw new ReleaseError("Approving a release requires an approver; that is the point of the gate.")
    }
    if (by.actor === release.createdBy) {
      // The same separation of duties the approval module enforces for spend.
      throw new ReleaseError(
        `${by.actor} created this release and cannot also approve it. ` +
          `A release that only one person has seen has not been reviewed.`,
      )
    }
    return Object.freeze({ ...release, state: to, approvedBy: by.actor, approvedAt: by.at })
  }

  return Object.freeze({ ...release, state: to })
}

/**
 * Roll back to an earlier release.
 *
 * Produces a NEW release carrying the old content, rather than reactivating the
 * old artifact. Reactivating would make revision numbers non-monotonic and make
 * "what was live at 14:05?" ambiguous — two periods with the same revision. The
 * history stays append-only, which is the only way it can be trusted.
 */
export function rollbackTo(
  active: SystemRelease,
  target: SystemRelease,
  by: { actor: string; at: string; notes: string },
): { rolledBack: SystemRelease; restored: SystemRelease } {
  if (active.tenantId !== target.tenantId) {
    throw new ReleaseError(`Cannot roll back across tenants.`)
  }
  if (active.state !== "active") {
    throw new ReleaseError(`Only an active release can be rolled back; this one is "${active.state}".`)
  }
  if (target.revision >= active.revision) {
    throw new ReleaseError(
      `Rollback target r${target.revision} is not earlier than the active r${active.revision}.`,
    )
  }

  const rolledBack = Object.freeze({
    ...transition(active, "rolled-back"),
    rolledBackTo: target.revision,
  })

  const restored = createRelease({
    tenantId: target.tenantId,
    blueprintId: target.blueprintId,
    blueprintVersion: target.blueprintVersion,
    topologyId: target.topologyId,
    topologyVersion: target.topologyVersion,
    modules: target.modules,
    configurationChecksum: target.configurationChecksum,
    policyIds: target.policyIds,
    notes: by.notes,
    createdBy: by.actor,
    createdAt: by.at,
    previous: rolledBack,
  })

  // The restored release must be byte-identical in content to its target — that
  // is what "rollback" means, and asserting it here beats discovering later that
  // a field was dropped in the copy.
  if (restored.checksum !== target.checksum) {
    throw new ReleaseError(
      `Rollback produced content differing from r${target.revision}. ` +
        `Expected ${target.checksum}, got ${restored.checksum}.`,
    )
  }

  return { rolledBack, restored }
}

export interface ReleaseDiffEntry {
  field: string
  change: "added" | "removed" | "changed"
  before?: unknown
  after?: unknown
}

/** What changed between two releases. What an approver reads before saying yes. */
export function diffReleases(before: SystemRelease, after: SystemRelease): ReleaseDiffEntry[] {
  const out: ReleaseDiffEntry[] = []

  const scalar = (field: keyof SystemRelease) => {
    if (before[field] !== after[field]) {
      out.push({ field, change: "changed", before: before[field], after: after[field] })
    }
  }

  scalar("blueprintId")
  scalar("blueprintVersion")
  scalar("topologyId")
  scalar("topologyVersion")
  scalar("configurationChecksum")

  const beforeModules = new Map(before.modules.map((m) => [m.key, m.version]))
  const afterModules = new Map(after.modules.map((m) => [m.key, m.version]))

  for (const key of [...new Set([...beforeModules.keys(), ...afterModules.keys()])].sort()) {
    const b = beforeModules.get(key)
    const a = afterModules.get(key)
    if (b === a) continue
    if (b === undefined) out.push({ field: `modules.${key}`, change: "added", after: a })
    else if (a === undefined) out.push({ field: `modules.${key}`, change: "removed", before: b })
    else out.push({ field: `modules.${key}`, change: "changed", before: b, after: a })
  }

  const beforePolicies = new Set(before.policyIds)
  const afterPolicies = new Set(after.policyIds)
  for (const id of [...new Set([...beforePolicies, ...afterPolicies])].sort()) {
    if (beforePolicies.has(id) && !afterPolicies.has(id)) {
      out.push({ field: `policies.${id}`, change: "removed", before: id })
    } else if (!beforePolicies.has(id) && afterPolicies.has(id)) {
      out.push({ field: `policies.${id}`, change: "added", after: id })
    }
  }

  return out
}

/**
 * Changes that remove capability from a running system.
 *
 * Surfaced separately because they are the ones that break a tenant rather than
 * merely change it: a module removed takes its routes and its data surfaces with
 * it, and a policy removed silently widens who can do what.
 */
export function breakingChanges(diff: readonly ReleaseDiffEntry[]): ReleaseDiffEntry[] {
  return diff.filter(
    (d) =>
      (d.field.startsWith("modules.") && d.change === "removed") ||
      (d.field.startsWith("policies.") && d.change === "removed") ||
      (d.field === "topologyId" && d.change === "changed"),
  )
}
