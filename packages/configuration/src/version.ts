import type { ConfigLayer, ResolvedConfig } from "./resolve"
import { checksumOf } from "./resolve"

/**
 * A published configuration is immutable. Changing one produces a new version.
 *
 * The reason is not tidiness. A workflow instance, an audit record and a release
 * artifact each cite the configuration they ran under; if that configuration can
 * be edited in place, every one of those citations becomes a lie the moment
 * someone changes a setting — and the lie is undetectable, because nothing
 * records that it changed.
 *
 * So: draft → validate → publish → (superseded). Rollback is publishing an
 * earlier version's contents as a new version, never mutating back.
 */
export type PublicationState = "draft" | "published" | "superseded"

export interface ConfigVersion {
  readonly versionId: string
  readonly tenantId: string
  /** Monotonic per tenant, starting at 1. */
  readonly revision: number
  readonly state: PublicationState
  readonly checksum: string
  /** The layers exactly as they were resolved. Enough to reproduce the values. */
  readonly layers: readonly ConfigLayer[]
  readonly values: Readonly<Record<string, unknown>>
  readonly publishedAt: string
  readonly publishedBy: string
  readonly note: string
  /** The revision this replaced, if any. */
  readonly supersedes: number | null
}

export class ConfigVersionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigVersionError"
  }
}

export interface PublishInput {
  tenantId: string
  config: ResolvedConfig
  layers: readonly ConfigLayer[]
  publishedBy: string
  note: string
  /** The currently active version for this tenant, if there is one. */
  previous?: ConfigVersion | null
  /**
   * Supplied by the caller rather than read from a clock, so publishing is a
   * pure function and a test can assert an exact artifact. Production passes
   * `new Date().toISOString()`.
   */
  publishedAt: string
}

/**
 * Freeze a resolved configuration into a citable version.
 *
 * Refuses a no-op: publishing an identical checksum would create a revision that
 * changed nothing, so "which revision introduced this?" stops having one answer.
 */
export function publish(input: PublishInput): ConfigVersion {
  const { tenantId, config, layers, publishedBy, note, previous, publishedAt } = input

  if (!tenantId) throw new ConfigVersionError("Refusing to publish configuration with no tenant.")
  if (!publishedBy) throw new ConfigVersionError("Refusing to publish configuration with no actor.")
  if (!note.trim()) {
    throw new ConfigVersionError(
      "A publication needs a note. Six months on, the diff will not say why.",
    )
  }

  if (previous && previous.tenantId !== tenantId) {
    throw new ConfigVersionError(
      `Previous version belongs to tenant "${previous.tenantId}", not "${tenantId}".`,
    )
  }

  if (previous && previous.checksum === config.checksum) {
    throw new ConfigVersionError(
      `Nothing changed: revision ${previous.revision} already has checksum ${config.checksum}.`,
    )
  }

  const revision = (previous?.revision ?? 0) + 1

  const version: ConfigVersion = {
    versionId: `${tenantId}@${revision}`,
    tenantId,
    revision,
    state: "published",
    checksum: config.checksum,
    layers: Object.freeze(layers.map((l) => Object.freeze({ ...l, values: Object.freeze({ ...l.values }) }))),
    values: config.values,
    publishedAt,
    publishedBy,
    note,
    supersedes: previous?.revision ?? null,
  }

  return Object.freeze(version)
}

/** Mark a version replaced. Returns a new object; the original is untouched. */
export function supersede(version: ConfigVersion): ConfigVersion {
  if (version.state === "superseded") return version
  return Object.freeze({ ...version, state: "superseded" as const })
}

/**
 * What changed between two versions, per key.
 *
 * The Studio's release diff, and the thing an approver reads before saying yes.
 */
export interface ConfigDiffEntry {
  key: string
  change: "added" | "removed" | "changed"
  before?: unknown
  after?: unknown
}

export function diffVersions(before: ConfigVersion, after: ConfigVersion): ConfigDiffEntry[] {
  const keys = new Set([...Object.keys(before.values), ...Object.keys(after.values)])
  const out: ConfigDiffEntry[] = []

  for (const key of [...keys].sort()) {
    const inBefore = key in before.values
    const inAfter = key in after.values

    if (inBefore && !inAfter) {
      out.push({ key, change: "removed", before: before.values[key] })
    } else if (!inBefore && inAfter) {
      out.push({ key, change: "added", after: after.values[key] })
    } else if (checksumOf({ v: before.values[key] }) !== checksumOf({ v: after.values[key] })) {
      out.push({ key, change: "changed", before: before.values[key], after: after.values[key] })
    }
  }

  return out
}
