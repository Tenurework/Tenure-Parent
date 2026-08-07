import "server-only"
import { createHash } from "node:crypto"

import { Prisma } from "@prisma/client"
import {
  CHAIN_METADATA_KEYS,
  buildAuditRecord,
  redactMetadata,
  type AuditOutcome,
  type AuditRecord,
} from "@tenure/audit"
import { stableStringify } from "@tenure/configuration"

import { isPaymentMode, type PaymentMode } from "@tenure/contracts"

import { db, type TxClient } from "@/lib/db"
import { currentEnvironment } from "@/lib/tenancy/context"
import type { UserContext } from "@/lib/rbac"

/**
 * The way the application writes an audit row.
 *
 * `@tenure/audit` has had a builder that cannot produce an invalid record since
 * it was written, and for a long time two call sites used it while thirty-six
 * hand-assembled the object and passed it straight to `db.auditEvent.create`.
 * A builder nobody goes through is a style guide. This is the function that
 * makes going through it easier than not: it takes what a call site actually
 * has — an actor, a permission context, a before and an after — and produces a
 * validated, redacted, hash-chained row.
 *
 * What it adds over a hand-assembled `create`:
 *
 *   · Validation and redaction, from `buildAuditRecord`. A row that cannot be
 *     attributed is refused rather than stored, and a metadata blob carrying a
 *     token is redacted whether or not the caller thought about it.
 *   · A hash chain. Each record commits to the previous one for that
 *     institution, so removing or rewriting a row around the application —
 *     `psql`, a raw query, a restored backup — breaks a link that
 *     `verifyChain` finds. The append-only extension in audit-append-only.ts
 *     closes the application path; this is what makes the other paths
 *     detectable rather than merely forbidden.
 *   · The seat the actor held. `actorId` alone says who, never under what
 *     authority — and the authority is what the reader six months later is
 *     trying to establish.
 *   · A before/after change block with a digest, so "the event was edited" is
 *     "the venue went from Schlegel 203 to off campus".
 *   · The release the code was running under, from IMAGE_TAG — the same value
 *     the deploy stamps onto the container.
 *
 * ── Deliberately absent ─────────────────────────────────────────────────────
 * A configuration or policy version. `buildAuditRecord` accepts one, and the
 * application has no way to answer it on a write path: `buildSystem` resolves a
 * checksum from an institution *slug* and a tenant binding, this runs from an
 * institution *id* on a request path, and there is no persisted release or
 * configuration row to read. Passing a placeholder would be worse than the gap
 * — a version field that is always "(unresolved)" reads like provenance and is
 * not. It stays out until something can answer it.
 *
 * ── Two writers use this; the rest do not ───────────────────────────────────
 * Stated plainly because the value of every property above is zero for a writer
 * that has not been migrated, and a header that implied otherwise would be the
 * more expensive kind of wrong.
 *
 * On this today (PAY-000-007):
 *   · `src/lib/admin/guard.ts` — `requireCapability`, the single gate every
 *     privileged administration command passes through, allow and deny alike.
 *   · `src/lib/provisioning/reconcile.ts` — the `Tenant.Reconciled` record,
 *     written inside the reconciler's own transaction via `txAuditLedger`.
 *
 * The remaining `db.auditEvent.create` call sites still hand-assemble their
 * rows, so their records carry no chain position and `verifyChain` reports them
 * unchained. That is a true statement about the audit trail, not a caveat about
 * this file.
 *
 * Migration is one call site at a time, and each is mechanical:
 *
 *     await db.auditEvent.create({ data: { institutionId, actorId, … } })
 *   becomes
 *     await recordAuditEvent({ institutionId, actor: { principalId }, …,
 *       seat: seatFor(ctx, { organizationId, institutionId }),
 *       change: { before, after } })
 *
 * The one thing to check when migrating: this reads and writes inside a
 * `$transaction` callback, so a test standing in for `@/lib/db` needs a
 * `$transaction` that accepts a function (several currently accept only the
 * array form) and an `auditEvent.findFirst`.
 */

/** The columns `AuditEvent` actually has. Written by `prismaAuditLedger`. */
export interface AuditEventRow {
  institutionId: string
  organizationId: string | null
  actorId: string | null
  actorRole: string | null
  action: string
  resourceType: string
  resourceId: string | null
  outcome: string
  reason: string | null
  metadata: Record<string, unknown>
  traceId: string | null
  /** PAY-000-007. "test" or "live" — which money-mode the action happened in. */
  mode: PaymentMode
  occurredAt: Date
}

/** An `AuditEvent` row as read back, with `metadata` still opaque JSON. */
export interface StoredAuditEvent {
  institutionId: string
  organizationId: string | null
  actorId: string | null
  actorRole: string | null
  action: string
  resourceType: string
  resourceId: string | null
  outcome: string
  reason: string | null
  metadata: unknown
  traceId: string | null
  /** PAY-000-007. Selected on the chain read so the read-back shape is honest. */
  mode: string
  occurredAt: Date
}

/** Where the change block lives inside `metadata`, alongside the `_`-namespaced provenance. */
export const CHANGE_METADATA_KEY = "_change"
/** Where the acting seat lives inside `metadata`. */
export const SEAT_METADATA_KEY = "_seat"
/**
 * Where the money-mode is mirrored inside `metadata`.
 *
 * The `mode` COLUMN is what queries filter on; this is the same value inside
 * the blob the hash chain covers. Without the mirror the column would be the
 * one field of an audit row that could be rewritten around the application
 * without breaking a link — which is the exact property the chain exists to
 * provide, and it would be missing from the field that says whether real money
 * was involved.
 */
export const MODE_METADATA_KEY = "_mode"

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * Turn a stored row back into the canonical record, or return null.
 *
 * Null is the answer for every row written before this function existed: the
 * thirty-six hand-assembled writers store no chain position, and a record with
 * no `sequence` cannot be extended (`buildAuditRecord` refuses it, correctly —
 * a chain rooted in a record whose hash nobody computed proves nothing). Those
 * rows are outside the chain, which is honest: they always were.
 *
 * The round trip has to be exact or every later record fails verification, so
 * the two values a database changes are handled explicitly: `occurredAt` comes
 * back as a `Date` and is re-canonicalised to the ISO string the builder
 * hashed, and `impersonatedBy` is read from the metadata mirror rather than
 * from a column, because the table has no column for it.
 */
export function rehydrateAuditRecord(row: StoredAuditEvent | null): AuditRecord | null {
  if (!row) return null
  if (!isObject(row.metadata)) return null
  if (!row.actorId) return null
  if (row.outcome !== "ALLOW" && row.outcome !== "DENY") return null

  const metadata = row.metadata
  const sequence = metadata[CHAIN_METADATA_KEYS.sequence]
  const previousHash = metadata[CHAIN_METADATA_KEYS.previousHash]
  const recordHash = metadata[CHAIN_METADATA_KEYS.recordHash]

  if (typeof sequence !== "number" || typeof recordHash !== "string") return null
  if (previousHash !== null && typeof previousHash !== "string") return null

  const impersonatedBy = metadata["_impersonatedBy"]

  return {
    tenantId: row.institutionId,
    organizationId: row.organizationId,
    actorId: row.actorId,
    actorRole: row.actorRole,
    impersonatedBy: typeof impersonatedBy === "string" ? impersonatedBy : null,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    outcome: row.outcome as AuditOutcome,
    reason: row.reason,
    metadata,
    traceId: row.traceId,
    occurredAt: row.occurredAt.toISOString(),
    sequence,
    previousHash: previousHash ?? null,
    recordHash,
  }
}

/**
 * The storage this needs, as two operations rather than a Prisma client.
 *
 * Narrow on purpose: the read-then-append has to happen under one transaction,
 * and the interesting logic — what the previous record is, what the next one
 * hashes to, what happens when the previous one is unchained — is then testable
 * against a ledger that behaves like the database instead of against a mock
 * that returns whatever the test wants to see.
 */
export interface AuditLedger {
  /**
   * Read this institution's latest chained record and append the record
   * `next` derives from it, atomically.
   */
  appendChained(
    institutionId: string,
    next: (previous: AuditRecord | null) => AuditEventRow,
  ): Promise<void>
}

/** Columns the chain read needs. Everything `hashRecord` covers. */
const CHAIN_SELECT = {
  institutionId: true,
  organizationId: true,
  actorId: true,
  actorRole: true,
  action: true,
  resourceType: true,
  resourceId: true,
  outcome: true,
  reason: true,
  metadata: true,
  traceId: true,
  mode: true,
  occurredAt: true,
} as const

/**
 * The production ledger.
 *
 * Two things are worth pointing at.
 *
 * The JSON predicate. It selects the latest row that *carries a chain
 * position*, not simply the latest row. While the other writers remain
 * unmigrated their unchained rows are interleaved with these, and taking the
 * newest row outright would find one of theirs, fail to rehydrate it, and start
 * a fresh chain at sequence 0 on almost every write — a chain of length one,
 * repeatedly, which proves nothing.
 *
 * The transaction. It makes the read and the append atomic, not serial: under
 * PostgreSQL's default READ COMMITTED two concurrent writers for the same
 * institution can read the same predecessor and both extend it, producing two
 * records at the same sequence. That is a fork, and `verifyChain` reports it as
 * a duplicate rather than silently accepting it — the property being bought
 * here is detectability, and a fork is detected. Making it impossible needs
 * SERIALIZABLE plus a retry, or a unique index on (institutionId, sequence),
 * and the latter needs a column the table does not have.
 */
export function prismaAuditLedger(client: typeof db = db): AuditLedger {
  return {
    async appendChained(institutionId, next) {
      await client.$transaction(async (tx) => {
        await txAuditLedger(tx).appendChained(institutionId, next)
      })
    },
  }
}

/**
 * The same ledger, for a writer already inside an interactive transaction.
 *
 * `prismaAuditLedger` opens its own `$transaction`, and PostgreSQL has no
 * nested transactions — calling it from inside `db.$transaction(async (tx) =>
 * …)` would either deadlock on the pool or, worse, write the audit row on a
 * second connection that commits independently of the change it describes. That
 * is the one failure an audit row must not have: the club's money moves, the
 * transaction rolls back, and the trail still says it happened.
 *
 * So the read-then-append runs on the caller's `tx`, inheriting its atomicity
 * rather than inventing its own. The chain property is unchanged — the
 * predecessor is read and the successor written under one transaction — and it
 * is now the *same* transaction as the business write, which is stronger.
 */
export function txAuditLedger(tx: TxClient): AuditLedger {
  return {
    async appendChained(institutionId, next) {
      const previous = await tx.auditEvent.findFirst({
        where: {
          institutionId,
          metadata: { path: [CHAIN_METADATA_KEYS.sequence], not: Prisma.DbNull },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        select: CHAIN_SELECT,
      })

      const row = next(rehydrateAuditRecord(previous))

      await tx.auditEvent.create({
        data: { ...row, metadata: row.metadata as Prisma.InputJsonObject },
      })
    },
  }
}

/**
 * The authority an actor held at the moment they acted.
 *
 * Not the same question as `actorId`, and the one an incident review asks
 * first. `roleName` is the tenant's own label and may be renamed tomorrow;
 * `templateKey` is the authority the platform actually decided from. Both are
 * recorded, because "the Treasurer approved it" and "a seat carrying
 * finance-approver authority approved it" are different sentences and a reader
 * needs each.
 */
export interface AuditSeat {
  roleId?: string
  roleName?: string
  templateKey?: string
  scope?: string
  organizationId?: string
  institutionRole?: string
}

/**
 * Derive the acting seat from the permission context that already gated the
 * write, so the audit row and the decision agree by construction rather than
 * because a caller passed the same string to both.
 *
 * PRESIDENT wins among the actor's seats in the target organization for the
 * same reason `canEditEvent` checks it first: where a person holds more than
 * one seat, the one that carries the authority is the one they acted under.
 */
export function seatFor(
  ctx: UserContext,
  target: { organizationId?: string | null; institutionId: string },
): AuditSeat | undefined {
  const seats = ctx.orgRoles.filter(
    (r) =>
      r.status === "ACTIVE" &&
      (target.organizationId == null || r.organizationId === target.organizationId),
  )
  const seat = seats.find((r) => r.scope === "PRESIDENT") ?? seats[0]
  const institutionRole = ctx.institutionRoles.find(
    (m) => m.institutionId === target.institutionId,
  )?.role

  if (!seat && !institutionRole) return undefined

  return {
    ...(seat
      ? {
          roleId: seat.roleId,
          roleName: seat.roleName,
          templateKey: seat.templateKey,
          scope: seat.scope,
          organizationId: seat.organizationId,
        }
      : {}),
    ...(institutionRole ? { institutionRole } : {}),
  }
}

/** What a write changed. Shallow: the fields of one row, before and after. */
export interface AuditChange {
  before?: Readonly<Record<string, unknown>>
  after?: Readonly<Record<string, unknown>>
}

export interface AuditChangeBlock {
  before: Record<string, unknown>
  after: Record<string, unknown>
  /** The field names whose values differ. Computed before redaction. */
  changedKeys: string[]
  /** `sha256:…` over the redacted before/after. */
  digest: string
  algorithm: "sha256"
}

/**
 * Build the change block.
 *
 * Two decisions here, and they pull against each other.
 *
 * `changedKeys` is computed from the *raw* values, so "the passphrase changed"
 * is recorded even though the passphrase is not. That is the whole point of a
 * change record on a sensitive field: an audit trail that cannot say a
 * credential was rotated is missing the events that matter most.
 *
 * `digest` is computed from the *redacted* values, and that is the deliberately
 * weaker choice. A digest over the raw values would let anyone holding the
 * audit row brute-force a low-entropy secret offline — a four-digit PIN, a
 * memorable passphrase — which is a disclosure the audit trail would have
 * created rather than recorded. Over the redacted values it is recomputable
 * from what is stored, which is what a reader can actually use.
 */
export function changeBlockFor(
  change: AuditChange,
  sensitiveKeys: readonly string[] = [],
): AuditChangeBlock {
  const before = change.before ?? {}
  const after = change.after ?? {}

  const changedKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => stableStringify(before[k]) !== stableStringify(after[k]))
    .sort()

  const redactedBefore = redactMetadata(before, sensitiveKeys)
  const redactedAfter = redactMetadata(after, sensitiveKeys)

  const digest = `sha256:${createHash("sha256")
    .update(stableStringify({ before: redactedBefore, after: redactedAfter }))
    .digest("hex")}`

  return {
    before: redactedBefore,
    after: redactedAfter,
    changedKeys,
    digest,
    algorithm: "sha256",
  }
}

export interface RecordAuditEventInput {
  institutionId: string
  organizationId?: string | null
  actor: {
    principalId: string
    /** The authority held at the time. Defaults to the seat's, when a seat is given. */
    role?: string
    /** Set when someone acted *as* this principal — support, or an admin reproducing a fault. */
    impersonatedBy?: string
  }
  /** The seat the actor acted under. `seatFor` derives it from the permission context. */
  seat?: AuditSeat
  /** e.g. "Event.Rescheduled". */
  action: string
  resourceType: string
  resourceId?: string | null
  outcome: AuditOutcome
  reason?: string
  metadata?: Readonly<Record<string, unknown>>
  /** Metadata keys this call site knows are sensitive, on top of the standing denylist. */
  sensitiveKeys?: readonly string[]
  change?: AuditChange
  traceId?: string
  /**
   * Which money-mode the action happened in (PAY-000-007).
   *
   * Defaults to the ambient `TenantScope.environment`, which is where every
   * caller already is: `withTenantScope`, `withSystemTenantScope` and
   * `forEachInstitution` all open one, and all three resolve it from the
   * tenant's published `platform.payments.mode`. Threading it through every
   * writer by hand is how one writer eventually does not.
   *
   * Explicit only for a caller genuinely outside a tenant scope — the
   * provisioning reconciler, which materialises the tenant and therefore runs
   * before one can be opened — and for a test that pins it.
   */
  mode?: PaymentMode
  occurredAt?: Date
  /**
   * The release the code was running under. Defaults to IMAGE_TAG, which is
   * what the deploy stamps onto the container; explicit only so a test can pin
   * it without touching the process environment.
   */
  releaseId?: string
}

/**
 * Write one audit row: validated, redacted, seated, and chained.
 *
 * The ledger parameter defaults to the real one, so a call site writes
 * `await recordAuditEvent({...})` and gets every property above. Tests pass a
 * ledger that stores rows the way the database does.
 */
export async function recordAuditEvent(
  input: RecordAuditEventInput,
  ledger: AuditLedger = prismaAuditLedger(),
): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date()
  const releaseId = input.releaseId ?? process.env.IMAGE_TAG

  // PAY-000-007. The mode the action happened in, taken from the tenant scope
  // the writer is already inside. `test` when there is neither an explicit
  // value nor a scope — the direction that claims the least, because a row
  // that says `live` is a row somebody will read as "real money moved".
  const ambient = currentEnvironment()
  const mode: PaymentMode = isPaymentMode(input.mode) ? input.mode : (ambient ?? "test")

  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) }
  metadata[MODE_METADATA_KEY] = mode
  if (input.seat) metadata[SEAT_METADATA_KEY] = input.seat
  if (input.change) metadata[CHANGE_METADATA_KEY] = changeBlockFor(input.change, input.sensitiveKeys)

  await ledger.appendChained(input.institutionId, (previous) => {
    // `previous` supplies both the position and the tamper check: the builder
    // refuses to extend a record whose content no longer hashes to its recorded
    // hash, so a rewritten log stops growing at the rewrite instead of burying
    // it under a valid-looking suffix. `sequence: 0` starts a chain when there
    // is nothing to extend.
    const record = buildAuditRecord({
      tenantId: input.institutionId,
      organizationId: input.organizationId ?? undefined,
      actor: {
        principalId: input.actor.principalId,
        role: input.actor.role ?? input.seat?.institutionRole ?? input.seat?.templateKey,
        impersonatedBy: input.actor.impersonatedBy,
      },
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? undefined,
      outcome: input.outcome,
      reason: input.reason,
      metadata,
      sensitiveKeys: input.sensitiveKeys,
      traceId: input.traceId,
      releaseId,
      occurredAt: occurredAt.toISOString(),
      ...(previous ? { previous } : { sequence: 0 }),
    })

    return {
      institutionId: record.tenantId,
      organizationId: record.organizationId,
      actorId: record.actorId,
      actorRole: record.actorRole,
      action: record.action,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      outcome: record.outcome,
      reason: record.reason,
      // Wholesale, because the chain fields and the provenance live inside it —
      // picking keys out here is how the hash stops matching what was stored.
      metadata: { ...record.metadata },
      traceId: record.traceId,
      mode,
      occurredAt: new Date(record.occurredAt),
    }
  })
}
