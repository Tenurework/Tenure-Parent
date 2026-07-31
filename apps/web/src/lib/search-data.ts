import "server-only"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { canSeeMemoryCard } from "@/lib/memory"
import type { SearchDoc } from "@/lib/search"

/**
 * Everything a user is allowed to see, flattened into rankable search docs.
 * Permission is applied here (RBAC first); ranking happens on top. Shared by
 * the /search page, the header command palette (/api/search) and Tenure AI
 * (/api/ai/chat) so all three see exactly the same, correctly-scoped corpus.
 */
export async function loadSearchCorpus(userId: string): Promise<SearchDoc[]> {
  const ctx = await getUserContext(userId)
  const oseInstitutionIds = ctx.institutionRoles.map((m) => m.institutionId)
  const memberOrgIds = ctx.orgRoles
    .filter((r) => r.status === "SHADOW" || r.status === "ACTIVE")
    .map((r) => r.organizationId)

  const orgs = await db.organization.findMany({
    where: {
      OR: [
        { institutionId: { in: oseInstitutionIds } },
        { id: { in: memberOrgIds } },
      ],
    },
    select: { id: true, institutionId: true, name: true, slug: true, description: true },
  })
  const orgById = new Map(orgs.map((o) => [o.id, o]))
  const orgIds = orgs.map((o) => o.id)

  const [memory, documents, approvals, events] = await Promise.all([
    db.memoryRecord.findMany({
      where: { organizationId: { in: orgIds }, isArchived: false },
      select: { id: true, title: true, content: true, roleId: true, organizationId: true },
    }),
    db.document.findMany({
      where: { organizationId: { in: orgIds }, isArchived: false },
      select: { id: true, title: true, description: true, organizationId: true },
    }),
    db.approvalRequest.findMany({
      where: { OR: [{ organizationId: { in: orgIds } }, { submittedById: userId }] },
      select: { id: true, title: true, description: true, status: true, organizationId: true },
    }),
    db.event.findMany({
      where: { organizationId: { in: orgIds }, status: { not: "CANCELLED" } },
      select: { id: true, title: true, description: true, venue: true, organizationId: true },
    }),
  ])

  const docs: SearchDoc[] = []

  for (const m of memory) {
    const org = orgById.get(m.organizationId)
    if (!org) continue
    if (!canSeeMemoryCard(ctx, m, org)) continue
    docs.push({
      id: m.id,
      kind: "memory",
      title: m.title,
      body: (m.content as { body?: string }).body ?? "",
      href: `/orgs/${org.slug}/memory`,
      context: org.name,
    })
  }
  for (const d of documents) {
    const org = orgById.get(d.organizationId)
    if (!org) continue
    docs.push({
      id: d.id,
      kind: "document",
      title: d.title,
      body: d.description ?? "",
      href: `/orgs/${org.slug}/documents`,
      context: org.name,
    })
  }
  for (const a of approvals) {
    const org = orgById.get(a.organizationId)
    docs.push({
      id: a.id,
      kind: "approval",
      title: a.title,
      body: `${a.description ?? ""} status:${a.status.toLowerCase()}`,
      href: `/approvals/${a.id}`,
      context: org?.name ?? "Approvals",
    })
  }
  for (const e of events) {
    const org = orgById.get(e.organizationId)
    if (!org) continue
    docs.push({
      id: e.id,
      kind: "event",
      title: e.title,
      body: `${e.description ?? ""} ${e.venue ?? ""}`,
      href: `/calendar/${e.id}`,
      context: org.name,
    })
  }
  for (const o of orgs) {
    docs.push({
      id: o.id,
      kind: "organization",
      title: o.name,
      body: o.description ?? "",
      href: `/orgs/${o.slug}/members`,
      context: "Club",
    })
  }
  return docs
}
