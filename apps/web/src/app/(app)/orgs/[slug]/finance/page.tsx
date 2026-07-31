import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { canManageFinance, canViewFinance, getUserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { OrgTabs } from "@/components/OrgTabs"
import { FinanceDashboard } from "@/components/finance/FinanceDashboard"
import { ReimbursementForm } from "@/components/finance/ReimbursementForm"
import { type LedgerEntryRow } from "@/components/finance/LedgerDrawer"
import { type LedgerKindName } from "@/lib/finance"

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
    const org = await db.organization.findUnique({ where: { slug } })
    if (!org) notFound()

    // Finance is readable by the club's members (+ OSE); editing stays restricted.
    const ctx = await getUserContext(session.user.id)
    if (!canViewFinance(ctx, org)) notFound()
    const canManage = canManageFinance(ctx, org)
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
    const ledgerByLine: Record<string, LedgerEntryRow[]> = {}
    for (const e of ledger) {
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
      })
    }

    return (
      <div className="w-full">
        <div className="mb-4">
          <h1 className="text-text-1">{org.name}</h1>
          <p className="mt-1 text-sm text-text-2">
            Finance — actual vs budget for {CURRENT_YEAR}, with editable forecasting.
          </p>
        </div>
        <OrgTabs slug={slug} />

        <FinanceDashboard
          slug={slug}
          canManage={canManage}
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
