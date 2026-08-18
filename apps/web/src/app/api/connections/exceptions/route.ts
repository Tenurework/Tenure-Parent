import { auth } from "@/lib/auth"
import { deadDeliveryExceptions } from "@/lib/connections/exception-worklist"
import { prismaDeadDeliveryPorts } from "@/lib/connections/prisma-dead-deliveries"
import { getUserContext, isOse } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { TenantContextError } from "@/lib/tenancy/context"

/**
 * INT-060-002 / Bible §16.8 — the exception worklist, served.
 *
 * Bible §16 lists thirteen Integration Studio surfaces and the eighth is
 * "Exception worklist — severity/owner/SLA/remediation/replay". This is that
 * surface's data, for one tenant, derived from the integration failures this
 * platform actually has: `OutboxEvent` rows that stopped being retried. Nothing
 * is stored for it and nothing is invented — one item per dead row, and a row
 * whose stored error nobody can classify arrives as `classification:
 * "unclassified"` rather than as a confident guess.
 *
 * ## Why a read, and only a read
 *
 * Replay lives in `src/lib/outbox/outbox.ts`, which refuses ids that are not
 * dead and refuses a bulk request, and its route is the dispatcher's. Putting a
 * replay button behind the endpoint that LISTS failures is how "replay
 * everything" gets built: the list is right there, and the ids are already in
 * hand. An operator who has read this list can replay explicit ids through the
 * path that was designed to refuse the rest.
 *
 * ## Who may read it
 *
 * Institution staff (`isOse`), inside their own tenant's scope. The worklist
 * names resource ids and the text of downstream errors, which is operational
 * data about the tenant — not something a club member has any business reading.
 * The scope is what keeps it to one tenant: `OutboxEvent` is TENANT_SCOPED, so
 * the read is filtered by the extension rather than by a predicate somebody
 * remembered to write.
 *
 * ## What it will not print
 *
 * `buildIntegrationException` runs every field that carries provider text
 * through the audit scanner, so a `lastError` that quoted a credential arrives
 * redacted. §16 requires it — "never secret values" — and a worklist is exactly
 * the page where a leaked token would sit unnoticed, because it is the page
 * people only open when something is already wrong.
 */

export const dynamic = "force-dynamic"

/** Enough to work through, bounded so one tenant's incident is not a full scan. */
const LIMIT = 100

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const worklist = await withTenantScope(userId, async (scope) => {
      const context = await getUserContext(userId)
      if (!isOse(context, scope.institutionId)) return null

      return deadDeliveryExceptions(prismaDeadDeliveryPorts(), {
        now: new Date().toISOString(),
        limit: LIMIT,
      })
    })

    if (worklist === null) {
      return Response.json({ error: "forbidden" }, { status: 403 })
    }

    return Response.json({
      // The counts first, deliberately: an operator opening this during an
      // incident needs "how bad" before "which rows", and `unclassified` is the
      // number that says how much of it nobody has looked at yet.
      breached: worklist.breached,
      unclassified: worklist.unclassified,
      needingReconciliation: worklist.needingReconciliation,
      bySeverity: worklist.bySeverity,
      items: worklist.items,
    })
  } catch (error) {
    // A person with no tenant has no worklist. A refusal, not a fault.
    if (error instanceof TenantContextError) {
      return Response.json({ error: "no_tenant" }, { status: 403 })
    }
    throw error
  }
}
