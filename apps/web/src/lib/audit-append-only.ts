import { Prisma } from "@prisma/client"

/**
 * The thing that makes `AuditEvent` append-only.
 *
 * Until this existed, nothing did. `AuditEvent` is classified TENANT_SCOPED in
 * src/lib/tenancy/registry.ts, and src/lib/tenancy/scope-args.ts happily scopes
 * and permits `update`, `updateMany`, `delete`, `deleteMany` and `upsert` on it
 * — the tenant chokepoint filtered the audit trail to your own institution and
 * then let you rewrite or erase it. There is no GRANT-level backstop either:
 * the application connects as the RDS master role (scripts/entrypoint.sh
 * composes DATABASE_URL from DB_CREDS), so it owns the table it audits into.
 *
 * Unlike the tenancy extension, this ships in enforce mode from the first
 * commit. Enforcement was staged there because roughly sixty call sites did not
 * yet open a tenant scope; here there is nothing to stage. A repository-wide
 * search for a mutation of this model finds exactly one call site, and it is an
 * integration-test teardown (src/lib/provisioning/reconcile.itest.ts) — no
 * product code has ever needed to change an audit row, so an "observe" period
 * would only be a period in which the control does not work.
 *
 * ── What this does and does not buy ─────────────────────────────────────────
 * It closes the application path: every Prisma model call in the product goes
 * through the single client in src/lib/db.ts, and this refuses the mutating
 * ones on an append-only model before they reach the database. It does NOT stop
 * `$executeRaw`, a psql session, or anything else holding the database
 * credential — Prisma's `$allModels` hook does not see raw SQL, and a role that
 * owns the table can always rewrite it. The durable answer to that is a
 * least-privilege application role with `REVOKE UPDATE, DELETE ON "AuditEvent"`
 * plus a `BEFORE UPDATE OR DELETE` trigger, which is a migration and a
 * credentials change rather than a code change.
 *
 * So the claim this file supports, exactly: the application cannot rewrite its
 * own audit trail. Detecting a rewrite performed *around* the application needs
 * the hash chain in src/lib/audit-record.ts, and that is written but not yet
 * reached by any writer — read its header before relying on it.
 */

export class AuditAppendOnlyError extends Error {
  readonly model: string
  readonly operation: string

  constructor(model: string, operation: string) {
    super(
      `${operation} on ${model} was refused: ${model} is append-only. ` +
        `An audit trail the application can rewrite is not an audit trail — the row that ` +
        `mattered is exactly the row someone would edit. Correct a mistaken record by ` +
        `appending a correcting one; if you genuinely need to remove history (retention, ` +
        `a subject-erasure order), that is a reviewed database operation, not an app write.`,
    )
    this.name = "AuditAppendOnlyError"
    this.model = model
    this.operation = operation
  }
}

/**
 * Models the application may only insert into and read back.
 *
 * A set rather than a hardcoded `=== "AuditEvent"` because the next append-only
 * table (an outbox archive, a retention journal) should be one line here rather
 * than a second copy of this extension.
 */
export const APPEND_ONLY_MODELS: ReadonlySet<string> = new Set(["AuditEvent"])

/**
 * The only operations permitted on an append-only model.
 *
 * An allow-list, deliberately, and this is the one design decision in the file
 * worth arguing about. A deny-list of `update | delete | …` is easier to read
 * and fails open: Prisma has added operations before (`createManyAndReturn` and
 * `updateManyAndReturn` in 5.14 and 6.x), and the day it adds another mutating
 * one, a deny-list silently permits it on the audit table. An allow-list fails
 * closed — a new operation is refused until somebody classifies it, which is
 * the correct default for the table that records what everyone did.
 *
 * Note what is absent: `upsert`. It can insert, but it can also update, and the
 * insert half is already available as `create`.
 */
export const APPEND_ONLY_ALLOWED_OPERATIONS: ReadonlySet<string> = new Set([
  // Reads.
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  // Appends.
  "create",
  "createMany",
  "createManyAndReturn",
])

/**
 * The rule, as a pure function: does this model/operation pair have to be
 * refused, and with what error?
 *
 * Separated from the extension that calls it for the same reason
 * `decideScope` is separated from `tenancyExtension` — the decision can then be
 * asserted directly for every operation Prisma has, including the ones that are
 * awkward to provoke through a client.
 */
export function appendOnlyRefusal(
  model: string | undefined,
  operation: string,
): AuditAppendOnlyError | null {
  // No model means a raw query or a client-level operation. Those never reach
  // this hook as model calls, and pretending to guard them here would be a lie
  // about coverage — see the note at the top of the file.
  if (!model) return null
  if (!APPEND_ONLY_MODELS.has(model)) return null
  if (APPEND_ONLY_ALLOWED_OPERATIONS.has(operation)) return null
  return new AuditAppendOnlyError(model, operation)
}

/**
 * The Prisma client extension. Attached in src/lib/db.ts, so every query the
 * application makes passes through it.
 */
export function auditAppendOnlyExtension() {
  return Prisma.defineExtension({
    name: "audit-append-only",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const refusal = appendOnlyRefusal(model, operation)
          if (refusal) throw refusal
          return query(args)
        },
      },
    },
  })
}
