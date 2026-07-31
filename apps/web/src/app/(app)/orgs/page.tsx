import Link from "next/link"
import { redirect } from "next/navigation"
import { Archive } from "@/components/ui/icons"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext, isOse, isOseDirector } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { ShieldCheck } from "@/components/ui/icons"
import { Card } from "@/components/ui/Card"
import { PageHeader } from "@/components/ui/PageHeader"
import { ClubCard, type ClubCardStats } from "@/components/ClubCard"

export const dynamic = "force-dynamic"

const CATEGORY_LABELS = {
  ORGANIZATION: "Organizations",
  PROFESSIONAL: "Professional",
  COMMUNITY: "Community",
  SOCIAL: "Social",
} as const
const CATEGORY_ORDER = ["ORGANIZATION", "PROFESSIONAL", "COMMUNITY", "SOCIAL"] as const

type OrgWithRoles = Awaited<ReturnType<typeof loadOrgs>>[number]

async function loadOrgs(where: object) {
  return db.organization.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      roles: {
        include: {
          assignments: {
            where: { status: "ACTIVE" },
            include: { user: { select: { name: true } } },
          },
          holdings: {
            where: { isCurrent: true },
            include: { person: { select: { name: true } } },
          },
        },
      },
    },
  })
}

function statsFor(org: OrgWithRoles): ClubCardStats {
  const presidentSeat = org.roles.find((r) => r.scope === "PRESIDENT")
  const president =
    presidentSeat?.holdings[0]?.person.name ?? presidentSeat?.assignments[0]?.user?.name
  const boardSeats = org.roles.filter((r) => r.name !== "Member")
  const filledSeats = boardSeats.filter(
    (r) => r.holdings.length > 0 || r.assignments.length > 0
  ).length
  return {
    filledSeats,
    boardSeats: boardSeats.length,
    vacancies: boardSeats.length - filledSeats,
    president,
  }
}

const GRID = "grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"

export default async function OrgsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>
}) {
  const { category: categoryParam } = await searchParams
  const activeCategory = CATEGORY_ORDER.find((c) => c === categoryParam) ?? null

  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  return withTenantScope(session.user.id, async () => {
    const ctx = await getUserContext(session.user.id)
    const oseInstitutionIds = ctx.institutionRoles.map((m) => m.institutionId)
    const memberOrgIds = ctx.orgRoles
      .filter((r) => r.status === "SHADOW" || r.status === "ACTIVE")
      .map((r) => r.organizationId)

    const orgs = await loadOrgs({
      OR: [
        { institutionId: { in: oseInstitutionIds } },
        { id: { in: memberOrgIds } },
      ],
    })

    const isOseViewer = orgs.some((o) => isOse(ctx, o.institutionId))
    const isDirector =
      orgs.some((o) => isOseDirector(ctx, o.institutionId)) ||
      ctx.institutionRoles.some((m) => m.role === "OSE_DIRECTOR")

    // Active clubs power the category grid; archived clubs live in their own
    // section and are never mixed in with the active ones. Members only ever
    // see their own (active) clubs; archived is an OSE-only view.
    const activeClubs = orgs.filter((o) => o.status !== "ARCHIVED")
    const archivedClubs = isOseViewer ? orgs.filter((o) => o.status === "ARCHIVED") : []

    const countByCategory = new Map<string, number>()
    for (const o of activeClubs) {
      countByCategory.set(o.category, (countByCategory.get(o.category) ?? 0) + 1)
    }

    const byCategory = new Map<string, OrgWithRoles[]>()
    for (const o of activeClubs) {
      if (activeCategory && o.category !== activeCategory) continue
      byCategory.set(o.category, [...(byCategory.get(o.category) ?? []), o])
    }

    return (
      <div className="w-full">
        <PageHeader
          title={isOseViewer ? "All Clubs" : "My Clubs"}
          subtitle={
            isOseViewer
              ? "Every registered organization at your institution."
              : "Organizations where you hold a current or incoming role."
          }
          actions={
            isOseViewer ? (
              <Link
                href="/admin/clubs"
                className="inline-flex h-10 items-center gap-2 rounded-md bg-[--accent] px-4 text-sm font-medium text-[--accent-text] no-underline transition-colors hover:bg-[--accent-hover]"
              >
                <ShieldCheck size={16} /> Manage in Admin
              </Link>
            ) : undefined
          }
        />

        {/* Category filter — URL-driven so a filtered view is shareable */}
        <nav aria-label="Filter clubs by category" className="mb-6 flex flex-wrap gap-2">
          {[
            { key: null, label: "All", count: activeClubs.length },
            ...CATEGORY_ORDER.map((c) => ({
              key: c as string | null,
              label: CATEGORY_LABELS[c],
              count: countByCategory.get(c) ?? 0,
            })),
          ]
            .filter((chip) => chip.key === null || chip.count > 0)
            .map((chip) => {
              const selected = activeCategory === chip.key
              return (
                <Link
                  key={chip.label}
                  href={chip.key ? `/orgs?category=${chip.key}` : "/orgs"}
                  aria-current={selected ? "page" : undefined}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium no-underline transition-colors ${
                    selected
                      ? "border-[--primary] bg-[--primary] text-[--primary-text]"
                      : "border-border text-text-2 hover:border-[--border-strong] hover:text-text-1"
                  }`}
                >
                  {chip.label}
                  <span className={selected ? "opacity-80" : "text-text-3"}>{chip.count}</span>
                </Link>
              )
            })}
        </nav>

        {activeClubs.length === 0 ? (
          <Card>
            <p className="text-sm text-text-2">
              No organizations yet. Ask your OSE office for access.
            </p>
          </Card>
        ) : (
          <div className="space-y-8">
            {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((cat) => (
              <section key={cat}>
                <h2 className="mb-3 text-meta font-semibold uppercase tracking-wide text-text-3">
                  {CATEGORY_LABELS[cat]} ({byCategory.get(cat)!.length})
                </h2>
                <div className={GRID}>
                  {byCategory.get(cat)!.map((org) => (
                    <ClubCard key={org.id} org={org} stats={statsFor(org)} canArchive={isDirector} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Archived clubs — a separate section, OSE-only, never mixed with active */}
        {archivedClubs.length > 0 && (
          <section className="mt-12 border-t border-border pt-8">
            <h2 className="mb-1 flex items-center gap-2 text-lead font-display font-semibold text-text-1">
              <Archive size={18} className="text-text-3" /> Archived clubs ({archivedClubs.length})
            </h2>
            <p className="mb-4 text-sm text-text-2">
              History is preserved. Reactivate a club to return it to the active roster.
            </p>
            <div className={GRID}>
              {archivedClubs.map((org) => (
                <ClubCard key={org.id} org={org} stats={statsFor(org)} canArchive={isDirector} />
              ))}
            </div>
          </section>
        )}
      </div>
    )
  })
}
