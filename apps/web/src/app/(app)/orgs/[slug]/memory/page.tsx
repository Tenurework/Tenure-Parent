import { notFound, redirect } from "next/navigation"
import {
  BookOpen,
  Contact,
  DollarSign,
  KeyRound,
  Lightbulb,
  ListTodo,
  Store,
  Timer,
} from "@/components/ui/icons"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { canContribute, canViewOrg, getUserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { canSeeMemoryCard } from "@/lib/memory"
import { Card, CardHeader } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { OrgTabs } from "@/components/OrgTabs"
import { DraftAssist } from "@/components/DraftAssist"
import { aiConfigured } from "@/lib/ai"
import { createMemoryCard } from "./actions"

export const dynamic = "force-dynamic"

const TYPE_META = {
  CONTACT:    { label: "Contact",  icon: Contact,    hint: "Sponsor, vendor, or university contact" },
  PLAYBOOK:   { label: "Playbook", icon: BookOpen,   hint: "How to run a recurring event or task" },
  BUDGET:     { label: "Budget",   icon: DollarSign, hint: "Financial record or template" },
  VENDOR:     { label: "Vendor",   icon: Store,      hint: "Deal, contract, or relationship" },
  LESSON:     { label: "Lesson",   icon: Lightbulb,  hint: "Hard-won insight for your successor" },
  THREAD:     { label: "Thread",   icon: ListTodo,   hint: "Ongoing initiative or open question" },
  CREDENTIAL: { label: "Credential", icon: KeyRound, hint: "Login or access info" },
  DEADLINE:   { label: "Deadline", icon: Timer,      hint: "Compliance or recurring deadline" },
} as const

export default async function MemoryPage({
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
      include: { roles: { orderBy: { scope: "asc" } } },
    })
    if (!org) notFound()

    const ctx = await getUserContext(session.user.id)
    if (!canViewOrg(ctx, org)) notFound()
    const canAdd = canContribute(ctx, org)

    const allCards = await db.memoryRecord.findMany({
      where: { organizationId: org.id, isArchived: false },
      orderBy: { updatedAt: "desc" },
      include: { role: { select: { name: true } } },
    })
    // Role-scoped cards only for the seat's holders, president, OSE
    const cards = allCards.filter((c) => canSeeMemoryCard(ctx, c, org))

    const authorIds = [...new Set(cards.map((c) => c.authorId).filter((x): x is string => !!x))]
    const authors = new Map(
      (
        await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })
      ).map((u) => [u.id, u.name ?? "Unknown"])
    )

    const createWithSlug = createMemoryCard.bind(null, slug)

    return (
      <div className="w-full">
        <div className="mb-4">
          <h1 className="text-text-1">{org.name}</h1>
          <p className="text-sm text-text-2 mt-1">
            Institutional memory — knowledge that outlives every board.
          </p>
        </div>
        <OrgTabs slug={slug} />

        <div className="space-y-4">
          {canAdd && (
            <Card>
              <CardHeader
                title="Add to memory"
                subtitle="Scope a card to a role seat and its future holders inherit it automatically."
              />
              <form action={createWithSlug} className="space-y-3">
                <div className="flex flex-wrap gap-3">
                  <label className="flex flex-col gap-1 text-xs text-text-2">
                    Type
                    <select
                      name="type"
                      required
                      className="h-9 rounded border border-border px-2 text-sm text-text-1 bg-surface"
                    >
                      {Object.entries(TYPE_META).map(([value, meta]) => (
                        <option key={value} value={value}>
                          {meta.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-2 flex-1 min-w-48">
                    Title
                    <input
                      name="title"
                      required
                      maxLength={200}
                      placeholder="Catering contact for spring gala"
                      className="h-9 w-full rounded border border-border px-3 text-sm text-text-1 bg-surface placeholder:text-text-3"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-2">
                    Visible to
                    <select
                      name="roleId"
                      className="h-9 rounded border border-border px-2 text-sm text-text-1 bg-surface"
                    >
                      <option value="">Whole club</option>
                      {org.roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} seat only
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <textarea
                  name="body"
                  required
                  rows={3}
                  placeholder="The details your successor will thank you for."
                  className="w-full rounded border border-border px-3 py-2 text-sm text-text-1 bg-surface placeholder:text-text-3"
                />
                {aiConfigured() && <DraftAssist kind="memory" targetName="body" />}
                <button className="h-9 rounded bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:opacity-90">
                  Save card
                </button>
              </form>
            </Card>
          )}

          {cards.length === 0 ? (
            <Card>
              <p className="text-sm text-text-2 py-4 text-center">
                No memory yet. {canAdd ? "Capture the first lesson above." : ""}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {cards.map((card) => {
                const meta = TYPE_META[card.type]
                const body = (card.content as { body?: string }).body ?? ""
                return (
                  <Card key={card.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <meta.icon size={15} className="text-text-3" />
                        <h2 className="text-sm font-semibold text-text-1">{card.title}</h2>
                      </div>
                      <Badge variant={card.roleId ? "info" : "default"}>
                        {card.role ? `${card.role.name} seat` : meta.label}
                      </Badge>
                    </div>
                    <p className="text-sm text-text-1 mt-2 whitespace-pre-wrap line-clamp-6">
                      {body}
                    </p>
                    <p className="text-xs text-text-3 mt-3">
                      {card.authorId ? authors.get(card.authorId) : "Unknown"} ·{" "}
                      {card.updatedAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  })
}
