import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { Building2, DollarSign, AlertTriangle, BarChart3 } from "@/components/ui/icons"
import { PageHeader } from "@/components/ui/PageHeader"
import { StatGrid, StatTile } from "@/components/ui/Bento"
import { Card, CardHeader } from "@/components/ui/Card"
import { PortfolioSankey } from "@/components/finance/PortfolioSankey"
import { formatCentsIn, rollUpPortfolio } from "@/lib/finance"

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

  return withTenantScope(session.user.id, async () => {
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
          // `currency` is selected because the roll-up refuses to add lines
          // that disagree about it. Dropping it from this select is how the
          // page went back to summing bare integers.
          select: {
            category: true,
            budgetedCents: true,
            actualCents: true,
            currency: true,
          },
        },
      },
    })

    // PAY-080-004. The totals are grouped by currency rather than summed into
    // one figure: this page spans every club in the institution, which is
    // exactly where two denominations meet.
    const portfolio = rollUpPortfolio(
      orgs.map((o) => ({
        name: o.shortName ?? o.name,
        slug: o.slug,
        lines: o.budgetLines,
      })),
    )

    const clubs = portfolio.clubs
      .filter((c) => c.budgetedCents > 0 || c.actualCents > 0)
      .map((c) => ({
        name: c.name,
        slug: c.slug,
        currency: c.currency,
        budgeted: c.budgetedCents,
        actual: c.actualCents,
        lines: c.lineCount,
      }))
      .sort((a, b) => b.budgeted - a.budgeted)

    // The headline figures name their currency. When an institution runs more
    // than one, the largest is shown and the rest are named in the hint —
    // never added together.
    const primary = portfolio.totals[0] ?? {
      currency: "USD",
      budgetedCents: 0,
      actualCents: 0,
      clubCount: 0,
    }
    const otherTotals = portfolio.totals.slice(1)
    const money = (cents: number, currency: string | null) =>
      formatCentsIn(cents, { locale: "en-US", currency: currency ?? primary.currency })
    const totalBudgeted = primary.budgetedCents
    const totalActual = primary.actualCents
    const utilPct = totalBudgeted > 0 ? Math.round((totalActual / totalBudgeted) * 100) : 0
    const overClubs = clubs.filter((c) => c.actual > c.budgeted).length

    // Each club's budget splits into what's spent and what remains. Only the
    // primary currency's clubs: a flow diagram whose ribbon widths are two
    // different units is a picture of nothing.
    const sankeyClubs = clubs.filter((c) => c.currency === primary.currency)
    const sankey = {
      nodes: [
        ...sankeyClubs.map((c) => ({ id: `club:${c.slug}`, label: c.name })),
        { id: "spent", label: "Spent", color: "var(--chart-1)" },
        { id: "remaining", label: "Remaining", color: "var(--border-strong)" },
      ],
      links: sankeyClubs.flatMap((c) => [
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
            <StatTile
              label="Clubs with budgets"
              value={clubs.length}
              hint={
                portfolio.mixedCurrencyClubs.length > 0
                  ? `${portfolio.mixedCurrencyClubs.length} not totalled — mixed currencies`
                  : undefined
              }
              icon={Building2}
            />
            <StatTile
              label={`Total budgeted (${primary.currency})`}
              value={money(totalBudgeted, primary.currency)}
              hint={
                otherTotals.length > 0
                  ? `plus ${otherTotals.map((t) => money(t.budgetedCents, t.currency)).join(", ")}`
                  : undefined
              }
              icon={DollarSign}
            />
            <StatTile
              label={`Total spent (${primary.currency})`}
              value={money(totalActual, primary.currency)}
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
                        <td className="px-3 py-2.5 text-right text-text-2">{money(c.budgeted, c.currency)}</td>
                        <td className="px-3 py-2.5 text-right text-text-2">{money(c.actual, c.currency)}</td>
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
  })
}
