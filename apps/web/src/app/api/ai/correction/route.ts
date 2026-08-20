import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withTenantScope } from "@/lib/tenant-scope"
import { getUserContext } from "@/lib/rbac"
import { recordAuditEvent, seatFor } from "@/lib/audit-record"
import {
  correctionMetadata,
  isDisclosureIncident,
  parseCorrectionReport,
  CorrectionError,
  CORRECTION_ACTION,
  CORRECTION_REASONS,
  CORRECTION_RESOURCE_TYPE,
} from "@/lib/relay/correction"

/**
 * GE-092-007 — where a reader says the answer, or the record behind it, is wrong.
 *
 * `/api/ai/chat` can now say four things about its own evidence: insufficient,
 * conflicting, stale, inaccessible. All four are the platform's judgement about
 * what it holds. This is the one path that carries what the platform does not
 * know — the reader recognises a figure as last year's, or sees a document they
 * believe they should not have been shown — and until this endpoint existed
 * there was nowhere for it to go.
 *
 * ## Bound to a version, filed under the actor, kept append-only
 *
 * The report is validated by `parseCorrectionReport`, which requires §9.3's
 * citation and parses it with the producer's own parser. It is then written
 * with `recordAuditEvent`, which chains it off the tenant's last chained row
 * inside one transaction, records the acting seat, and lands in a table the
 * shared Prisma client refuses every mutating operation on. A correction cannot
 * be quietly withdrawn, which is the property that makes it worth filing.
 *
 * ## Why a `SHOULD_NOT_SEE` report is a DENY
 *
 * It is the only reason in the set that says a CONTROL failed rather than that
 * a fact is wrong. Filed with `outcome: "DENY"` it sorts with the refusals an
 * auditor already reads, so it is found by somebody who has never heard of this
 * endpoint. Filed as an ordinary ALLOW it would be one row among the day's
 * traffic, which is where a disclosure report goes to die.
 */
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to report a correction." }, { status: 401 })
  }
  const userId = session.user.id

  return withTenantScope(userId, async (scope) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "A correction report must be JSON." }, { status: 400 })
    }

    let report
    try {
      report = parseCorrectionReport(body)
    } catch (error) {
      // The parser's own sentence. It names what was wrong with the report —
      // which reason values exist, that a citation is required — and none of it
      // is tenant data or an internal identifier, so it is safe to return and
      // useless to withhold: a client that cannot tell a malformed report from
      // a refused one retries the same broken request forever.
      if (error instanceof CorrectionError || (error as Error)?.name === "CitationError") {
        return NextResponse.json({ error: (error as Error).message }, { status: 400 })
      }
      throw error
    }

    const ctx = await getUserContext(userId)
    await recordAuditEvent({
      institutionId: scope.institutionId,
      actor: { principalId: userId },
      seat: seatFor(ctx, { institutionId: scope.institutionId }),
      action: CORRECTION_ACTION,
      resourceType: CORRECTION_RESOURCE_TYPE,
      // The record the reader is disputing, by the identity the citation
      // carried — the same value `/api/ai/chat` returned to them.
      resourceId: report.citation.ref.externalId,
      outcome: isDisclosureIncident(report.reason) ? "DENY" : "ALLOW",
      reason: `Correction reported: ${report.reason}`,
      metadata: correctionMetadata(report),
    })

    return NextResponse.json({
      recorded: true,
      reason: report.reason,
      // Echoed back so a client can show the reader what was filed against
      // WHICH version — the point of the whole exchange is that the report is
      // about the state they saw, not about the record's state now.
      citedVersionAt: report.citation.versionAt,
      // Stated rather than implied. A reader told "reported" reasonably assumes
      // somebody was paged; nobody was. The report is durable, attributable and
      // reviewable at /admin/audit, and there is no triage queue behind it.
      disposition:
        "Recorded in this institution's audit trail against the exact version you were shown. " +
        "It is reviewable by your institution's staff; it does not open a ticket.",
    })
  })
}

/** The reasons a client may offer, from the one list the parser enforces. */
export async function GET() {
  return NextResponse.json({ reasons: CORRECTION_REASONS })
}
