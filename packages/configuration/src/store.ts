import { immutabilityBreaches, layerDigest, provenanceDigest, type PublishedDigest } from "./integrity"
import { EXPRESSION_LANGUAGE_VERSION } from "./expression"
import type { VersionedLayer } from "./layer-schema"
import type { PublicationPlan } from "./publication"

/**
 * GE-031-007 — the one way configuration is written.
 *
 * Bible §7.1 requires the admin UI to write "the same canonical configuration
 * used by config-as-code" with "no parallel hidden settings store". Today the
 * console has no configuration editor at all, so that requirement is satisfied
 * by having nothing — which is the least durable way to satisfy anything. The
 * moment somebody builds an editor, the cheapest implementation is a settings
 * table, and then there are two sources of truth and a reconciliation problem
 * nobody chose.
 *
 * So the path exists before the editor does: everything that publishes
 * configuration goes through `commit`, and `tests/security/one-config-writer.test.mjs`
 * fails if a second writer appears.
 *
 * ## It also closes three deferrals
 *
 * Three earlier items ended with "nothing persists this yet":
 *
 *   * GE-031-003 — `immutabilityBreaches` took previously published digests as
 *     an argument and nothing stored them. `commit` supplies them from the
 *     store, so an edit in place is caught against real history.
 *   * GE-031-005 — the expression language declared a version that was recorded
 *     nowhere. Every record carries it, so an expression can be re-evaluated
 *     deliberately rather than optimistically.
 *   * GE-031-006 — `planPublication` produced everything an audit entry needs
 *     and wrote nothing. The plan is stored with the revision it justified.
 *
 * ## A port, not a database
 *
 * The adapter is supplied by the caller. The engine must not know whether
 * configuration lives in DynamoDB, Postgres or a file, and a package that
 * imported a database client would make the configuration engine untestable
 * without one and undeployable outside the cell that has it.
 */

/** One published revision. Immutable once written — `append` refuses to replace. */
export interface ConfigRecord {
  tenantId: string
  /** Monotonic per tenant, starting at 1. */
  revision: number
  layers: readonly VersionedLayer[]
  /** Digest over the ordered layers, from `provenanceDigest`. */
  provenance: string
  /** Per-layer digests, so an edit in place is detectable later. */
  layerDigests: readonly PublishedDigest[]
  /** The resolved values this revision produced. */
  values: Readonly<Record<string, unknown>>
  /** The checksum of those values. */
  checksum: string
  /**
   * The expression language this revision's expressions were validated against.
   *
   * Recorded because an expression evaluated by a different language version is
   * a different expression, and without this nothing could notice.
   */
  languageVersion: string
  publishedBy: string
  publishedAt: string
  activateAt: string
  /** Null on a first publication — stated, not implied. */
  rollbackTo: number | null
  /** The plan that justified it. The audit record GE-031-006 could not write. */
  plan: PublicationPlan
}

/**
 * What the engine needs from a persistence layer.
 *
 * Four operations, all of them append-or-read. There is deliberately no
 * `update` and no `delete`: a published revision that can be edited is not a
 * record of what was live, and every claim built on it — an incident
 * reconstruction, a rollback target, an audit trail — becomes a guess.
 */
export interface ConfigStore {
  /** Every revision for a tenant, oldest first. */
  history(tenantId: string): Promise<readonly ConfigRecord[]>
  /** The newest revision, or null when the tenant has never published. */
  latest(tenantId: string): Promise<ConfigRecord | null>
  /** Append. Must reject a revision that already exists. */
  append(record: ConfigRecord): Promise<void>
}

export class ConfigStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigStoreError"
  }
}

export interface CommitInput {
  store: ConfigStore
  tenantId: string
  plan: PublicationPlan
  layers: readonly VersionedLayer[]
  values: Readonly<Record<string, unknown>>
  checksum: string
  publishedBy: string
  publishedAt: Date
}

/**
 * Write a configuration revision. The only way one is written.
 *
 * Refuses in three cases, and each refusal is the point of a different item:
 *
 *   * A blocked plan (GE-031-006). Committing one would make the gate advisory,
 *     and an advisory gate is a gate people learn to click past.
 *   * A layer that contradicts a version already published (GE-031-003). The
 *     digests come from this store's own history, which is what turns that
 *     check from a function taking an argument into a guarantee.
 *   * A revision that already exists. The store is append-only; a `commit` that
 *     silently replaced would destroy the evidence a rollback depends on.
 */
export async function commit(input: CommitInput): Promise<ConfigRecord> {
  const { store, tenantId, plan, layers, values, checksum, publishedBy, publishedAt } = input

  if (!tenantId.trim()) throw new ConfigStoreError("Refusing to publish configuration with no tenant.")
  if (!publishedBy.trim()) throw new ConfigStoreError("Refusing to publish configuration with no actor.")

  if (plan.blocked) {
    throw new ConfigStoreError(
      `Refusing to publish a blocked plan. ${plan.blockers.length} blocker(s) and ` +
        `${plan.rejections.length} rejection(s):\n  ` +
        [...plan.blockers, ...plan.rejections.map((r) => r.detail)].join("\n  "),
    )
  }

  const history = await store.history(tenantId)

  // Every digest this tenant has ever published, so an edit in place is caught
  // against real history rather than against whatever the caller passed in.
  const published: PublishedDigest[] = history.flatMap((record) => [...record.layerDigests])
  const breaches = immutabilityBreaches(layers, published)
  if (breaches.length > 0) {
    throw new ConfigStoreError(
      `Refusing to publish: ${breaches.length} layer(s) contradict a version already published.\n  ` +
        breaches
          .map(
            (b) =>
              `${b.kind} "${b.id}" version ${b.version} was ${b.digest} and is now ${b.actualDigest}. ` +
              `A version is immutable; publish a new one.`,
          )
          .join("\n  "),
    )
  }

  // The plan was computed against some revision; if the tenant has moved since,
  // the diff the operator reviewed is not the diff this would apply. Found by a
  // mutation: recomputing `rollbackTo` as `revision - 1` gave the same answer
  // as the plan in every linear test, which was only true because nothing
  // stopped a stale plan being committed.
  const currentRevision = history.length === 0 ? null : history[history.length - 1].revision
  if (plan.rollbackTo !== currentRevision) {
    throw new ConfigStoreError(
      `This plan was reviewed against revision ${plan.rollbackTo ?? "none"}, and the tenant is now at ` +
        `revision ${currentRevision ?? "none"}. The diff that was approved is not the diff this would ` +
        `apply. Re-plan against the current revision.`,
    )
  }

  const revision = history.length === 0 ? 1 : history[history.length - 1].revision + 1

  const record: ConfigRecord = {
    tenantId,
    revision,
    layers,
    provenance: provenanceDigest(layers),
    layerDigests: layers.map((layer) => ({
      kind: layer.kind,
      id: layer.id,
      version: layer.metadata.version,
      digest: layerDigest(layer),
    })),
    values,
    checksum,
    languageVersion: EXPRESSION_LANGUAGE_VERSION,
    publishedBy,
    publishedAt: publishedAt.toISOString(),
    activateAt: plan.activateAt,
    // From the plan rather than recomputed: the operator signed a plan that
    // named this target, and a rollback pointing somewhere else is not the
    // change they approved.
    rollbackTo: plan.rollbackTo,
    plan,
  }

  await store.append(record)
  return record
}

/**
 * An in-memory store.
 *
 * Real, not a mock: it enforces append-only and rejects a duplicate revision,
 * which are the properties `commit` depends on. It is what the tests run
 * against and what a local Studio can use before a cell has a table — and
 * because it implements the same interface, the adapter that replaces it cannot
 * quietly relax those properties without failing the same tests.
 */
export class InMemoryConfigStore implements ConfigStore {
  private readonly byTenant = new Map<string, ConfigRecord[]>()

  async history(tenantId: string): Promise<readonly ConfigRecord[]> {
    return [...(this.byTenant.get(tenantId) ?? [])]
  }

  async latest(tenantId: string): Promise<ConfigRecord | null> {
    const records = this.byTenant.get(tenantId) ?? []
    return records.length === 0 ? null : records[records.length - 1]
  }

  async append(record: ConfigRecord): Promise<void> {
    const records = this.byTenant.get(record.tenantId) ?? []
    if (records.some((r) => r.revision === record.revision)) {
      throw new ConfigStoreError(
        `Revision ${record.revision} already exists for "${record.tenantId}". The store is append-only.`,
      )
    }
    records.push(record)
    this.byTenant.set(record.tenantId, records)
  }
}

/**
 * The revision to roll back to, and whether that is possible.
 *
 * Rolling back is publishing the earlier revision's layers again as a NEW
 * revision, never rewinding the history — the record of what was live has to
 * survive the decision to stop living with it.
 */
export async function rollbackTarget(
  store: ConfigStore,
  tenantId: string,
): Promise<{ from: ConfigRecord; to: ConfigRecord } | { from: ConfigRecord | null; to: null; why: string }> {
  const history = await store.history(tenantId)
  if (history.length === 0) return { from: null, to: null, why: "This tenant has never published a configuration." }

  const from = history[history.length - 1]
  if (from.rollbackTo === null) {
    return { from, to: null, why: "Revision 1 is the first publication; there is nothing behind it." }
  }
  const to = history.find((r) => r.revision === from.rollbackTo)
  if (!to) {
    return { from, to: null, why: `Revision ${from.rollbackTo} is named as the target and is not in the history.` }
  }
  return { from, to }
}
