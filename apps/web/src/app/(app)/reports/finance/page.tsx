import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { Building2, DollarSign, AlertTriangle, BarChart3 } from "@/components/ui/icons"
import { PageHeader } from "@/components/ui/PageHeader"
import { StatGrid, StatTile } from "@/components/ui/Bento"
import { Card, CardHeader } from "@/components/ui/Card"
import { PortfolioSankey } from "@/components/finance/PortfolioSankey"
import { formatCents } from "@/lib/finance"

export const dynamic = "force-dynamic"

const CURRENT_YEAR = "2026-2027"

/**
 * OSE finance portfolio — the two-tier ERP consolidation view. Every club's
 * budget rolls up into one picture, and each row drills straight into that
 * club's finance dashboard (and from there, its ledger). OSE-only.
 */
export default async function PortfolioFinancePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  const ctx = await getUserContext(session.user.id)
  const institutionId = ctx.institutionRoles[0]?.institutionId
  if (!institutionId) notFound() // OSE only

  const orgs = await db.organization.findMany({
    where: { institutionId, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      shortName: true,
      slug: true,
      budgetLines: {
        where: { academicYear: CURRENT_YEAR },
        select: { budgetedCents: true, actualCents: true },
      },
    },
  })

  const clubs = orgs
    .map((o) => {
      const budgeted = o.budgetLines.reduce((s, l) => s + l.budgetedCents, 0)
      const actual = o.budgetLines.reduce((s, l) => s + l.actualCents, 0)
      return { name: o.shortName ?? o.name, slug: o.slug, budgeted, actual, lines: o.budgetLines.length }
    })
    .filter((c) => c.budgeted > 0 || c.actual > 0)
    .sort((a, b) => b.budgeted - a.budgeted)

  const totalBudgeted = clubs.reduce((s, c) => s + c.budgeted, 0)
  const totalActual = clubs.reduce((s, c) => s + c.actual, 0)
  const utilPct = totalBudgeted > 0 ? Math.round((totalActual / totalBudgeted) * 100) : 0
  const overClubs = clubs.filter((c) => c.actual > c.budgeted).length

  // Each club's budget splits into what's spent and what remains.
  const sankey = {
    nodes: [
      ...clubs.map((c) => ({ id: `club:${c.slug}`, label: c.name })),
      { id: "spent", label: "Spent", color: "var(--chart-1)" },
      { id: "remaining", label: "Remaining", color: "var(--border-strong)" },
    ],
    links: clubs.flatMap((c) => [
      ...(c.actual > 0 ? [{ source: `club:${c.slug}`, target: "spent", value: c.actual }] : []),
      ...(c.budgeted - c.actual > 0
        ? [{ source: `club:${c.slug}`, target: "remaining", value: c.budgeted - c.actual }]
        : []),
    ]),
  }

  return (
    <div className="w-full">
      <PageHeader
        title="Finance portfolio"
        subtitle="Every club's budget in one place — drill from the portfolio into any club's ledger."
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Finance portfolio" }]}
      />

      <div className="mb-5">
        <StatGrid>
          <StatTile label="Clubs with budgets" value={clubs.length} icon={Building2} />
          <StatTile label="Total budgeted" value={formatCents(totalBudgeted)} icon={DollarSign} />
          <StatTile
            label="Total spent"
            value={formatCents(totalActual)}
            hint={`${utilPct}% utilized`}
            icon={BarChart3}
          />
          <StatTile
            label="Over budget"
            value={overClubs}
            hint={`club${overClubs === 1 ? "" : "s"} over plan`}
            icon={AlertTriangle}
          />
        </StatGrid>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Where the money goes" subtitle="Each club's budget split into spent and remaining" />
          <PortfolioSankey
            nodes={sankey.nodes}
            links={sankey.links}
            height={Math.max(300, clubs.length * 34)}
          />
        </Card>

        <Card className="lg:col-span-2" padding="none">
          <div className="border-b border-border p-4">
            <CardHeader title="By club" subtitle="Budgeted vs spent — click to drill in" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-3">
                  <th className="px-4 py-2 font-medium">Club</th>
                  <th className="px-3 py-2 text-right font-medium">Budget</th>
                  <th className="px-3 py-2 text-right font-medium">Spent</th>
                  <th className="px-3 py-2 text-right font-medium">Used</th>
                </tr>
              </thead>
              <tbody>
                {clubs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-text-3">
                      No club budgets yet.
                    </td>
                  </tr>
                )}
                {clubs.map((c) => {
                  const pct = c.budgeted > 0 ? Math.round((c.actual / c.budgeted) * 100) : 0
                  const over = c.actual > c.budgeted
                  return (
                    <tr key={c.slug} className="border-b border-border last:border-0 hover:bg-base">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/orgs/${c.slug}/finance`}
                          className="text-text-1 no-underline hover:text-[--primary]"
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-right text-text-2">{formatCents(c.budgeted)}</td>
                      <td className="px-3 py-2.5 text-right text-text-2">{formatCents(c.actual)}</td>
                      <td
                        className={`px-3 py-2.5 text-right tabular-nums ${over ? "text-[--error]" : "text-text-1"}`}
                      >
                        {pct}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
