import Link from "next/link"
import { redirect } from "next/navigation"
import { Plus } from "@/components/ui/icons"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { Card } from "@/components/ui/Card"
import { ApprovalBadge } from "@/components/ui/Badge"
import { approvalSla, slaColor } from "@/lib/approvals-sla"
import { documentLocalization } from "@/lib/tenancy/locale-cookie"

export const dynamic = "force-dynamic"

const TYPE_LABELS: Record<string, string> = {
  EVENT: "Event",
  BUDGET: "Budget",
  VENDOR: "Vendor",
  COMMUNICATION: "Communication",
  DOCUMENT: "Document",
  EXCEPTION: "Exception",
  ROSTER: "Roster",
}

export default async function ApprovalsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  return withTenantScope(session.user.id, async () => {
    const ctx = await getUserContext(session.user.id)
    const oseInstitutionIds = ctx.institutionRoles.map((m) => m.institutionId)
    const memberOrgIds = ctx.orgRoles
      .filter((r) => r.status === "SHADOW" || r.status === "ACTIVE")
      .map((r) => r.organizationId)

    const approvals = await db.approvalRequest.findMany({
      where: {
        OR: [
          { institutionId: { in: oseInstitutionIds } },
          { organizationId: { in: memberOrgIds } },
          { submittedById: ctx.userId },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { organization: { select: { name: true, slug: true } } },
    })

    const submitterIds = [...new Set(approvals.map((a) => a.submittedById))]
    const submitters = new Map(
      (
        await db.user.findMany({
          where: { id: { in: submitterIds } },
          select: { id: true, name: true, email: true },
        })
      ).map((u) => [u.id, u.name ?? u.email ?? "Unknown"])
    )

    const canCreate = ctx.orgRoles.some((r) => r.status === "ACTIVE")
    const now = new Date()
    // The institution's own working days and closures, not Mon–Fri by
    // assumption (GE-022-004).
    const { businessCalendar } = await documentLocalization()

    return (
      <div className="w-full">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-text-1">Approvals</h1>
            <p className="text-sm text-text-2 mt-1">
              Requests flowing through the President → OSE approval chain.
            </p>
          </div>
          {canCreate && (
            <Link
              href="/approvals/new"
              className="inline-flex items-center gap-1.5 h-9 rounded bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:opacity-90 no-underline shrink-0"
            >
              <Plus size={15} /> New request
            </Link>
          )}
        </div>

        {approvals.length === 0 ? (
          <Card>
            <p className="text-sm text-text-2 py-4 text-center">
              No requests yet.{" "}
              {canCreate ? "Create the first one with “New request”." : ""}
            </p>
          </Card>
        ) : (
          <Card padding="none">
            <ul className="divide-y divide-border">
              {approvals.map((a) => {
                const sla = approvalSla(a.status, a.updatedAt, now, businessCalendar)
                return (
                  <li key={a.id}>
                    <Link
                      href={`/approvals/${a.id}`}
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-base transition-colors no-underline"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-1 truncate">{a.title}</p>
                        <p className="text-xs text-text-3 mt-0.5">
                          {TYPE_LABELS[a.type]} · {a.organization.name} ·{" "}
                          {submitters.get(a.submittedById)} ·{" "}
                          {a.updatedAt.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </p>
                      </div>
                      {sla.level !== "none" && (
                        <span
                          className="hidden shrink-0 items-center gap-1.5 text-[12px] tabular-nums sm:inline-flex"
                          style={{ color: slaColor(sla.level) }}
                          title={`This request has been in its current stage for ${sla.days} day${sla.days === 1 ? "" : "s"}`}
                        >
                          {sla.level !== "ok" && (
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${sla.level === "overdue" ? "live-dot" : ""}`}
                              style={{ background: slaColor(sla.level) }}
                              aria-hidden
                            />
                          )}
                          {sla.label}
                        </span>
                      )}
                      <ApprovalBadge status={a.status} />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </Card>
        )}
      </div>
    )
  })
}
