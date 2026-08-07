import type { Metadata } from "next"
import {
  PAYMENT_CAPABILITIES,
  RESPONSIBILITY_AXES,
  RESPONSIBILITY_PARTIES,
} from "@tenure/payments"

import { db } from "@/lib/db"
import { requireAdminContext } from "@/lib/admin/guard"
import { withTenantScope } from "@/lib/tenant-scope"
import { hasCapability } from "@/lib/admin/capabilities"
import { Card, CardHeader } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { StateSurface } from "@/components/ui/StateSurface"
import { FundsFlowForm } from "@/components/admin/FundsFlowForm"

export const metadata: Metadata = { title: "Admin · Payments" }
export const dynamic = "force-dynamic"

/**
 * PAY-040-003 / PAY-070-003 — where a funds flow is decided and written.
 *
 * The eight responsibility axes are inputs on this page rather than defaults in
 * code, which is the whole point of Bible §6: an unanswered axis has to be
 * visibly unanswered. The form posts every axis it collected; anything left
 * blank arrives as a blocker from `resolveResponsibility` and the write is
 * refused with the axis named.
 *
 * Nothing on this page can move money. `saveFundsFlowConfiguration` records a
 * decision; it makes no provider call, and there is none to make — every leaf
 * in the registry below is `PLANNED` or `UNSUPPORTED`.
 */
export default async function AdminPaymentsPage() {
  const { userId, ctx, institutionId } = await requireAdminContext()

  return withTenantScope(userId, async () => {
    // Configuring who carries a loss is a budget-authority decision, and it is
    // gated on the capability that already means "may change what this
    // institution's money does" rather than on a new one nobody holds.
    if (!hasCapability(ctx, "budget.override", institutionId)) {
      return <StateSurface state="permission-denied" />
    }

    const [organizations, configured] = await Promise.all([
      db.organization.findMany({
        where: { institutionId, status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 100,
      }),
      db.paymentsFundsFlowConfig.findMany({
        where: { institutionId },
        orderBy: { updatedAt: "desc" },
        take: 50,
        include: {
          organization: { select: { name: true } },
          exceptionApproval: { select: { id: true, status: true } },
        },
      }),
    ])

    const registered = PAYMENT_CAPABILITIES.filter((c) => c.state !== "UNSUPPORTED")

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Funds flow"
            subtitle="Which charge model a club's legal entity uses, and who carries the loss. A flow that moves liability onto Tenure needs an approved exception pinned to this exact decision."
          />
          <FundsFlowForm
            organizations={organizations}
            capabilities={registered.map((c) => ({ id: c.id, state: c.state }))}
            axes={[...RESPONSIBILITY_AXES]}
            parties={[...RESPONSIBILITY_PARTIES]}
          />
        </Card>

        <Card>
          <CardHeader
            title={`Configured — ${configured.length}`}
            subtitle="Each row records the decision digest it was written from. Changing the decision changes the digest, which is what forces a new approval instead of reusing the old one's authority."
          />
          {configured.length === 0 ? (
            <p className="px-5 py-6 text-sm text-text-3">
              No funds flow is configured. Nothing can be charged, which is the correct state
              while every payments capability is PLANNED or UNSUPPORTED.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-3">
                    <th className="px-5 py-2 font-medium">Club</th>
                    <th className="px-3 py-2 font-medium">Legal entity</th>
                    <th className="px-3 py-2 font-medium">Capability</th>
                    <th className="px-3 py-2 font-medium">Model</th>
                    <th className="px-3 py-2 font-medium">Loss</th>
                    <th className="px-3 py-2 font-medium">Exception</th>
                    <th className="px-3 py-2 font-medium">Digest</th>
                  </tr>
                </thead>
                <tbody>
                  {configured.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-2.5 text-text-1">{row.organization.name}</td>
                      <td className="px-3 py-2.5 text-text-2">{row.legalEntityId}</td>
                      <td className="px-3 py-2.5 text-text-3">{row.capabilityId}</td>
                      <td className="px-3 py-2.5">
                        <Badge variant="info">{row.chargeModel}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-text-2">{row.liableParty}</td>
                      <td className="px-3 py-2.5 text-text-2">
                        {row.exceptionApproval
                          ? `${row.exceptionApproval.id} (${row.exceptionApproval.status})`
                          : "not required"}
                      </td>
                      <td className="px-3 py-2.5 text-text-3">
                        {row.decisionDigest.slice(0, 12)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    )
  })
}
