import Link from "next/link"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CheckCircle, X } from "@/components/ui/icons"
import { db } from "@/lib/db"
import { requireAdminContext } from "@/lib/admin/guard"
import { hasCapability } from "@/lib/admin/capabilities"
import { Card, CardHeader } from "@/components/ui/Card"
import { ApprovalBadge } from "@/components/ui/Badge"
import { EmptyState } from "@/components/ui/EmptyState"
import { ConfirmSubmit } from "@/components/ui/ConfirmDialog"
import { adminDecideApproval } from "../actions"

export const metadata: Metadata = { title: "Admin · Approvals" }
export const dynamic = "force-dynamic"

const OPEN = ["DRAFT", "PENDING_PRESIDENT", "NEEDS_CHANGES", "PENDING_OSE"] as const

export default async function AdminApprovalsPage() {
  const { ctx, institutionId } = await requireAdminContext()
  if (!hasCapability(ctx, "approval.override", institutionId)) notFound()

  const requests = await db.approvalRequest.findMany({
    where: { institutionId },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { organization: { select: { name: true, slug: true } } },
  })
  const open = requests.filter((r) => (OPEN as readonly string[]).includes(r.status))
  const decided = requests.filter((r) => !(OPEN as readonly string[]).includes(r.status))

  const Row = ({ r, canDecide }: { r: (typeof requests)[number]; canDecide: boolean }) => (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <Link
          href={`/approvals/${r.id}`}
          className="truncate font-medium text-text-1 no-underline hover:text-[--accent]"
        >
          {r.title}
        </Link>
        <p className="text-[13px] text-text-3">
          {r.type.toLowerCase()} · {r.organization.name}
        </p>
      </div>
      <ApprovalBadge status={r.status} />
      {canDecide && (
        <div className="flex items-center gap-2">
          <ConfirmSubmit
            action={adminDecideApproval}
            hiddenFields={{ approvalId: r.id, decision: "APPROVED" }}
            title="Force-approve this request?"
            description={`This approves “${r.title}” right now, bypassing the President and OSE gates. The requester is notified, any linked event is published, and the override is written to the audit trail. It can't be reopened.`}
            confirmLabel="Force approve"
            variant="primary"
            triggerClassName="inline-flex items-center gap-1.5 rounded-md bg-[--primary] px-3 py-1.5 text-[13px] font-medium text-[--primary-text] hover:bg-[--primary-hover]"
          >
            <CheckCircle size={14} /> Force approve
          </ConfirmSubmit>
          <ConfirmSubmit
            action={adminDecideApproval}
            hiddenFields={{ approvalId: r.id, decision: "REJECTED" }}
            title="Force-reject this request?"
            description={`This rejects “${r.title}” right now, bypassing both approval gates. The requester is notified, any linked event is cancelled, and the decision is final — it can't be reopened.`}
            confirmLabel="Force reject"
            variant="danger"
            triggerClassName="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-[13px] font-medium text-[--error] hover:bg-[--error-light]"
          >
            <X size={14} /> Force reject
          </ConfirmSubmit>
        </div>
      )}
    </li>
  )

  return (
    <div className="w-full space-y-6">
      <Card>
        <CardHeader
          title="Override approvals"
          subtitle="Force a decision on any request across the institution, bypassing the President → OSE gates. Every override is audited."
        />
        {open.length === 0 ? (
          <EmptyState icon={CheckCircle} title="No open requests" description="Nothing is awaiting a decision right now." />
        ) : (
          <ul className="-mx-5 divide-y divide-border border-t border-border">
            {open.map((r) => (
              <Row key={r.id} r={r} canDecide />
            ))}
          </ul>
        )}
      </Card>

      {decided.length > 0 && (
        <Card padding="none">
          <div className="border-b border-border p-5">
            <CardHeader title={`Recently decided (${decided.length})`} />
          </div>
          <ul className="divide-y divide-border">
            {decided.slice(0, 30).map((r) => (
              <Row key={r.id} r={r} canDecide={false} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
