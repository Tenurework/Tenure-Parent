import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  canManageFinance,
  canViewFinance,
  decideFinanceAction,
  getUserContext,
} from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { OrgTabs } from "@/components/OrgTabs"
import { FinanceDashboard } from "@/components/finance/FinanceDashboard"
import { ReimbursementForm } from "@/components/finance/ReimbursementForm"
import { type LedgerEntryRow } from "@/components/finance/LedgerDrawer"
import { financeIntegrity, type LedgerKindName } from "@/lib/finance"

export const dynamic = "force-dynamic"

const CURRENT_YEAR = "2026-2027"

export default async function FinancePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  return withTenantScope(session.user.id, async () => {
    const org = await db.organization.findUnique({
      where: { slug },
      // PAY-040-007. The institution's registered name is the seller a payer
      // would see; the club is an internal dimension under it and is not a
      // merchant of its own (Bible §6: departments and clubs do not become
      // merchants unless separately recognised).
      include: { institution: { select: { slug: true, name: true } } },
    })
    if (!org) notFound()

    // Finance is readable by the club's members (+ OSE); editing stays restricted.
    const ctx = await getUserContext(session.user.id)
    if (!canViewFinance(ctx, org)) notFound()
    const canManage = canManageFinance(ctx, org)
    // PAY-150-001. Correcting a posted transaction is its own capability, and
    // the club president does not hold it. Decided by the same call the server
    // action makes, so the control renders for exactly the people it will work
    // for rather than for everyone who can edit a budget.
    const canReverse = decideFinanceAction(
      ctx,
      org,
      org.institution.slug,
      "finance.ledger.reverse",
    ).allowed
    // Mirrors submitReimbursement's own gate exactly.
    const canFileReimbursement = ctx.orgRoles.some(
      (r) => r.organizationId === org.id && r.status === "ACTIVE"
    )

    const [lines, ledger, approvals, vendors, documents] = await Promise.all([
      db.budgetLine.findMany({
        where: { organizationId: org.id, academicYear: CURRENT_YEAR },
        orderBy: [{ sortOrder: "asc" }, { category: "asc" }],
      }),
      db.ledgerEntry.findMany({
        where: { organizationId: org.id, academicYear: CURRENT_YEAR },
        orderBy: { occurredAt: "desc" },
        include: {
          approval: { select: { id: true, title: true } },
          vendor: { select: { id: true, name: true } },
          document: { select: { id: true, title: true } },
          // PAY-120-001. Which side of a reversal pair this row is on. The
          // drawer needs both: a reversal is not itself reversible, and a
          // posting that has been answered cannot be answered twice.
          reversedBy: { select: { id: true } },
        },
      }),
      db.approvalRequest.findMany({
        where: { organizationId: org.id, status: "APPROVED", type: { in: ["BUDGET", "VENDOR"] } },
        select: { id: true, title: true },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
      db.vendor.findMany({
        where: { organizationId: org.id, isArchived: false },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 100,
      }),
      db.document.findMany({
        where: { organizationId: org.id, isArchived: false },
        select: { id: true, title: true },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
    ])

    // Group the ledger by line for the drill-down drawer.
    //
    // PAY-130-002. Only the budget-dimensioned half of a journal has a
    // `budgetLineId`; the counter-half — the payable to whoever fronted the
    // cash, or the cash-clearing position on a recovery — is an
    // organization-level row and belongs to no line. It is skipped here rather
    // than bucketed under a placeholder key, because a drawer titled with a
    // budget category must not list a row that is not against that category.
    const ledgerByLine: Record<string, LedgerEntryRow[]> = {}
    for (const e of ledger) {
      if (e.budgetLineId === null) continue
      ;(ledgerByLine[e.budgetLineId] ??= []).push({
        id: e.id,
        kind: e.kind as LedgerKindName,
        amountCents: e.amountCents,
        description: e.description,
        memo: e.memo,
        occurredAt: e.occurredAt.toISOString(),
        approval: e.approval,
        vendor: e.vendor,
        document: e.document,
        reversesId: e.reversesId,
        reversedById: e.reversedBy?.id ?? null,
      })
    }

    /*
     * PAY-080-007 — the reconciliation that exists to be done today.
     *
     * `BudgetLine.actualCents` is a CACHE of the sum of its ledger entries,
     * maintained by a relative `increment` in the approvals action. Nothing
     * anywhere compared the two, so a cache that drifted stayed drifted and the
     * page went on rendering it. Computed here, on the rows already read for the
     * drawer, and shown rather than corrected: silently rewriting the cache to
     * match would hide whichever write went missing.
     */
    const integrity = financeIntegrity(
      lines.map((l) => ({ id: l.id, category: l.category, actualCents: l.actualCents })),
      // Budget-dimensioned rows only. The counter-halves sum a journal to zero
      // by construction, so including them would compare each line's cache
      // against a figure that is not what the line holds.
      ledger
        .filter((e): e is typeof e & { budgetLineId: string } => e.budgetLineId !== null)
        .map((e) => ({ budgetLineId: e.budgetLineId, amountCents: e.amountCents })),
      lines[0]?.currency ?? undefined,
    )

    return (
      <div className="w-full">
        <div className="mb-4">
          <h1 className="text-text-1">{org.name}</h1>
          <p className="mt-1 text-sm text-text-2">
            Finance — actual vs budget for {CURRENT_YEAR}, with editable forecasting.
          </p>
        </div>
        <OrgTabs slug={slug} />

        {/* Shown on both arms. "Reconciled" is a claim worth making explicitly:
            a page that only speaks up when something is wrong is one nobody can
            tell apart from a page whose check has stopped running. */}
        <p
          data-testid="ledger-integrity"
          className={`mt-3 text-sm ${integrity.reconciles ? "text-text-2" : "text-text-1 font-medium"}`}
        >
          {integrity.detail}
        </p>

        <FinanceDashboard
          slug={slug}
          canManage={canManage}
          canReverse={canReverse}
          merchantLegalName={org.institution.name}
          // 22 characters is what card networks show; truncating here rather
          // than in the component keeps the preview equal to what the payer
          // would actually read.
          merchantStatementDescriptor={org.institution.name.slice(0, 22)}
          lines={lines.map((l) => ({
            id: l.id,
            category: l.category,
            budgetedCents: l.budgetedCents,
            actualCents: l.actualCents,
            forecastCents: l.forecastCents,
            source: l.source,
            note: l.note,
          }))}
          ledgerByLine={ledgerByLine}
          sources={{ approvals, vendors, documents }}
        />

        {/* Filing requires an ACTIVE seat in THIS club — submitReimbursement
            enforces that so a requester never sits on their own approval gate.
            The form used to render for every finance viewer, so OSE staff,
            SHADOW holders and ALUMNI could fill it in and only discover on
            submit, via an unhandled server error, that they were never eligible.
            Show the control to exactly the people who can use it. */}
        {canFileReimbursement && (
          <div className="mt-4">
            <ReimbursementForm
              slug={slug}
              lines={lines.map((l) => ({
                id: l.id,
                category: l.category,
                remainingCents: l.budgetedCents - l.actualCents,
              }))}
            />
          </div>
        )}
      </div>
    )
  })
}
