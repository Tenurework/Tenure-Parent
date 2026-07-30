import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { canViewOrg, getUserContext } from "@/lib/rbac"
import { availableActions, ACTION_LABELS } from "@/lib/approvals"
import { formatCents } from "@/lib/finance"
import { approvalSla, slaColor } from "@/lib/approvals-sla"
import { effectiveApprovalContext } from "@/lib/delegation"
import Link from "next/link"
import { Card, CardHeader, Attribute } from "@/components/ui/Card"
import { BackButton } from "@/components/BackButton"
import { ApprovalBadge, SeverityBadge } from "@/components/ui/Badge"
import { ConfirmInlineSubmit } from "@/components/ui/ConfirmInlineSubmit"
import { actOnApproval } from "../actions"
import { openApprovalThread } from "../../messages/actions"

export const dynamic = "force-dynamic"

export default async function ApprovalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  const approval = await db.approvalRequest.findUnique({
    where: { id },
    include: {
      organization: { select: { name: true, slug: true, institutionId: true } },
      steps: { orderBy: { occurredAt: "asc" } },
      event: { include: { conflicts: { orderBy: { createdAt: "asc" } } } },
    },
  })
  if (!approval) notFound()

  const ctx = await getUserContext(session.user.id)
  const canView =
    ctx.userId === approval.submittedById ||
    canViewOrg(ctx, { id: approval.organizationId, institutionId: approval.institutionId })
  if (!canView) notFound()

  // Delegation-aware: a backup approver sees (and can use) the gates they hold
  // on someone's behalf, not just their own.
  const { ctx: effCtx, delegators } = await effectiveApprovalContext(
    session.user.id,
    ctx,
    approval.institutionId
  )
  const actions = availableActions(effCtx, approval)
  const GATE_ACTIONS = ["approve", "reject", "request_changes"]
  const directGate = availableActions(ctx, approval).some((a) => GATE_ACTIONS.includes(a))
  const backupFor =
    !directGate && delegators.length > 0 && actions.some((a) => GATE_ACTIONS.includes(a))
      ? delegators[0]
      : null
  const actWithId = actOnApproval.bind(null, approval.id)

  const actorIds = [
    ...new Set([approval.submittedById, ...approval.steps.map((s) => s.actorId)]),
  ]
  const actors = new Map(
    (
      await db.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      })
    ).map((u) => [u.id, u.name ?? u.email ?? "Unknown"])
  )

  const meta = approval.metadata as {
    amount?: string
    reimbursement?: {
      budgetLineId?: string
      amountCents?: number
      documentId?: string | null
      category?: string
    }
  }
  const reimb = meta.reimbursement
  let lineRemaining: number | null = null
  if (reimb?.budgetLineId) {
    const bl = await db.budgetLine.findUnique({
      where: { id: reimb.budgetLineId },
      select: { budgetedCents: true, actualCents: true },
    })
    if (bl) lineRemaining = bl.budgetedCents - bl.actualCents
  }

  return (
    <div className="max-w-3xl">
      <BackButton />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-text-1">{approval.title}</h1>
          <p className="text-sm text-text-2 mt-1">{approval.organization.name}</p>
          {(() => {
            const sla = approvalSla(approval.status, approval.updatedAt)
            if (sla.level === "none") return null
            return (
              <p
                className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] font-medium"
                style={{ color: slaColor(sla.level) }}
              >
                {sla.level !== "ok" && (
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: slaColor(sla.level) }}
                    aria-hidden
                  />
                )}
                {sla.level === "overdue" ? "Overdue — " : sla.level === "attention" ? "Aging — " : ""}
                {sla.label}
              </p>
            )
          })()}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <form action={openApprovalThread}>
            <input type="hidden" name="approvalId" value={approval.id} />
            <button className="h-8 rounded border border-border px-3 text-xs font-medium text-text-2 hover:bg-base">
              Discussion
            </button>
          </form>
          <ApprovalBadge status={approval.status} />
        </div>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Details" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Attribute label="Type" value={approval.type.toLowerCase()} />
            <Attribute label="Requested by" value={actors.get(approval.submittedById)} />
            <Attribute
              label="Created"
              value={approval.createdAt.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            />
            <Attribute label="Amount" value={meta.amount ? `$${meta.amount}` : "—"} />
          </div>
          {approval.description && (
            <p className="mt-4 text-sm text-text-1 whitespace-pre-wrap">
              {approval.description}
            </p>
          )}
        </Card>

        {reimb && (
          <Card>
            <CardHeader
              title="Reimbursement"
              subtitle="Posts to the club ledger as a spend on final approval — request ↔ approval ↔ receipt"
            />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Attribute label="Budget line" value={reimb.category ?? "—"} />
              <Attribute
                label="Amount"
                value={typeof reimb.amountCents === "number" ? formatCents(reimb.amountCents) : "—"}
              />
              {lineRemaining !== null && (
                <Attribute label="Line remaining" value={formatCents(lineRemaining)} />
              )}
              <Attribute
                label="Receipt"
                value={
                  reimb.documentId ? (
                    <Link
                      href={`/orgs/${approval.organization.slug}/documents/${reimb.documentId}/view`}
                      className="text-[--primary] hover:underline"
                    >
                      View receipt
                    </Link>
                  ) : (
                    "—"
                  )
                }
              />
            </div>
            {typeof reimb.amountCents === "number" &&
              lineRemaining !== null &&
              reimb.amountCents > lineRemaining && (
                <p className="mt-3 text-[13px] text-[--warning]">
                  Heads up — this exceeds the line&apos;s remaining budget of {formatCents(lineRemaining)}.
                </p>
              )}
          </Card>
        )}

        {approval.event && (
          <Card padding="none">
            <div className="p-5 border-b border-border">
              <CardHeader
                title="Schedule conflicts"
                subtitle="What this event collides with on the shared calendar"
                action={
                  <Link
                    href={`/calendar/${approval.event.id}`}
                    className="text-xs text-[--primary] hover:underline"
                  >
                    View event
                  </Link>
                }
              />
            </div>
            {approval.event.conflicts.length === 0 ? (
              <p className="px-5 py-5 text-sm text-text-3 text-center">
                No conflicts detected — clear to schedule.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {approval.event.conflicts.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-5 py-3">
                    <SeverityBadge severity={c.severity} />
                    <p className="text-sm text-text-1 flex-1">{c.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {actions.length > 0 && (
          <Card>
            <CardHeader
              title="Take action"
              subtitle="Decisions are recorded permanently in the request history."
            />
            {backupFor && (
              <p
                className="mb-3 rounded-md px-3 py-2 text-[13px]"
                style={{ background: "var(--primary-light)", color: "var(--primary)" }}
              >
                You&apos;re acting as a backup for {backupFor.name} — your decision is recorded on
                their behalf.
              </p>
            )}
            <form action={actWithId} className="space-y-3">
              <textarea
                name="reason"
                rows={2}
                placeholder="Optional note — required context for changes or rejection."
                className="w-full rounded border border-border px-3 py-2 text-sm text-text-1 bg-surface placeholder:text-text-3"
              />
              <div className="flex flex-wrap gap-2">
                {actions.map((a) => {
                  const cls =
                    a === "approve" || a === "submit" || a === "resubmit"
                      ? "h-9 rounded bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:opacity-90"
                      : a === "reject"
                        ? "h-9 rounded bg-[--error] px-4 text-sm font-medium text-white hover:opacity-90"
                        : "h-9 rounded border border-border px-4 text-sm font-medium text-text-2 hover:bg-base"

                  // Final OSE approval is terminal + publishes the linked event;
                  // reject and cancel are terminal. Those get a confirm. Every
                  // other step just advances the flow, so it stays one click.
                  const finalApprove = a === "approve" && approval.status === "PENDING_OSE"
                  const needsConfirm = a === "reject" || a === "cancel" || finalApprove

                  if (!needsConfirm) {
                    return (
                      <button
                        key={a}
                        type="submit"
                        name="action"
                        value={a}
                        className={cls}
                      >
                        {ACTION_LABELS[a]}
                      </button>
                    )
                  }

                  const copy =
                    a === "reject"
                      ? {
                          title: "Reject this request?",
                          description:
                            "The requester is notified and this decision is final — the request can't be reopened, and any linked event is cancelled. Add a reason above first if you want to explain why.",
                          confirmLabel: "Reject request",
                        }
                      : a === "cancel"
                        ? {
                            title: "Cancel this request?",
                            description:
                              "This withdraws the request for good — it moves to Cancelled and can't be resubmitted. Any linked event is cancelled, and the history keeps a permanent record.",
                            confirmLabel: "Cancel request",
                          }
                        : {
                            title: "Give final approval?",
                            description:
                              "This is the final OSE approval. The request is approved for good, any linked event is published to the shared calendar, and the requester is notified. It can't be reopened.",
                            confirmLabel: "Approve request",
                          }

                  return (
                    <ConfirmInlineSubmit
                      key={a}
                      name="action"
                      value={a}
                      title={copy.title}
                      description={copy.description}
                      confirmLabel={copy.confirmLabel}
                      variant={a === "approve" ? "primary" : "danger"}
                      triggerClassName={cls}
                    >
                      {ACTION_LABELS[a]}
                    </ConfirmInlineSubmit>
                  )
                })}
              </div>
            </form>
          </Card>
        )}

        <Card padding="none">
          <div className="p-5 border-b border-border">
            <CardHeader title="History" subtitle="Append-only decision trail" />
          </div>
          {approval.steps.length === 0 ? (
            <p className="px-5 py-6 text-sm text-text-3 text-center">
              Draft — not yet submitted.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {approval.steps.map((s) => (
                <li key={s.id} className="px-5 py-3.5">
                  <p className="text-sm text-text-1">
                    <span className="font-medium">{actors.get(s.actorId)}</span>
                    {s.actorRoleContext ? (
                      <span className="text-text-3"> ({s.actorRoleContext})</span>
                    ) : null}{" "}
                    moved this from{" "}
                    <span className="font-medium">{s.fromStatus.replace(/_/g, " ")}</span> to{" "}
                    <span className="font-medium">{s.toStatus.replace(/_/g, " ")}</span>
                  </p>
                  {s.reason && (
                    <p className="text-sm text-text-2 mt-1 italic">“{s.reason}”</p>
                  )}
                  <p className="text-xs text-text-3 mt-1">
                    {s.occurredAt.toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
