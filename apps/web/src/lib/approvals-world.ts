import "server-only"

import {
  INCOMPATIBLE_DUTIES,
  type ConflictDeclaration as EngineConflict,
  type ControlWorld,
  type ISODate,
  type Recusal as EngineRecusal,
} from "@tenure/authorization"

import { db } from "@/lib/db"

/**
 * PAY-150-003 — the standing declarations `mayDecide` needs, loaded from the
 * rows that now hold them.
 *
 * Three of the six control arms in `@tenure/authorization` were unreachable
 * from production. Two of them — RECUSED and DECLARED_CONFLICT — were lost
 * here: `src/lib/approvals.ts` passed a hardcoded `const
 * NO_STANDING_DECLARATIONS: ControlWorld = {}` on every call, and said so
 * honestly, because the schema had no ConflictDeclaration and no Recusal model
 * to read. It has both now, and this is the seam that comment described.
 *
 * ── Why the time filter is HERE and not in the engine ───────────────────────
 *
 * `mayDecide`'s recusal arm checks membership only: principal, tenant,
 * resource. Its conflict arm does consult `at`, via `conflictHoldsAt`. Rather
 * than rely on one of the two, both windows are applied while loading, so a
 * declaration that is not in force at `at` never enters the world at all. That
 * makes the property testable in one place — "a recusal dated in the past
 * changes nothing" is a statement about this function — instead of depending on
 * which arm of the engine happens to look.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 *
 * Loaded per (tenant, principal, resource), which is the granularity a decision
 * is taken at. Deliberately NOT loaded for a list page: fifty rows would be
 * fifty queries to change no answer, since nobody is deciding anything from a
 * list. A list passes `NO_STANDING_DECLARATIONS`, which is a decision the
 * caller makes out loud.
 */
export async function standingDeclarationsFor(input: {
  institutionId: string
  principalId: string
  resourceId: string
  /** Permissions the principal holds, for the duties matrix. */
  permissionsHeld?: readonly string[]
  at?: ISODate
}): Promise<ControlWorld> {
  const at = input.at ?? new Date().toISOString()
  const instant = new Date(at)

  const [recusals, conflicts] = await Promise.all([
    db.recusal.findMany({
      where: {
        institutionId: input.institutionId,
        principalId: input.principalId,
        resourceId: input.resourceId,
        effectiveFrom: { lte: instant },
        // Null means it never lapses; a set date closes the window.
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: instant } }],
      },
    }),
    // Conflicts are loaded for the principal across the tenant and filtered to
    // the decision's subjects by `mayDecide`. Filtering by subject in SQL would
    // mean the caller had to enumerate every subject before the query, and a
    // subject it forgot would silently drop a declared interest.
    db.conflictDeclaration.findMany({
      where: {
        institutionId: input.institutionId,
        principalId: input.principalId,
        effectiveFrom: { lte: instant },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: instant } }],
      },
    }),
  ])

  return {
    recusals: recusals.map(
      (row): EngineRecusal => ({
        principalId: row.principalId,
        tenantId: row.institutionId,
        resourceId: row.resourceId,
        reason: row.reason,
        at: row.declaredAt.toISOString(),
      }),
    ),
    conflicts: conflicts.map(
      (row): EngineConflict => ({
        principalId: row.principalId,
        tenantId: row.institutionId,
        subjectId: row.subjectId,
        reason: row.reason,
        effectiveFrom: row.effectiveFrom.toISOString(),
        effectiveTo: row.effectiveUntil?.toISOString() ?? null,
      }),
    ),
    permissionsHeld: input.permissionsHeld ?? [],
    // The platform's shipped duties matrix. Passing it is what makes the
    // INCOMPATIBLE_DUTIES arm live for a caller that supplies
    // `permissionsHeld`; passing nothing left a fourth arm dead alongside the
    // two this function exists to revive.
    dutiesMatrix: INCOMPATIBLE_DUTIES,
  }
}
