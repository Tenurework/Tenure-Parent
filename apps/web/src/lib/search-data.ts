import "server-only"
import { db } from "@/lib/db"
import { getUserContext, isOse, type UserContext } from "@/lib/rbac"
import { canSeeMemoryCard } from "@/lib/memory"
import {
  authorizeRetrieved,
  type RetrievalVisibility,
  type SearchDoc,
  type Sensitivity,
} from "@/lib/search"

/**
 * Everything a user is allowed to see, flattened into rankable search docs.
 * Permission is applied here (RBAC first); ranking happens on top. Shared by
 * the /search page, the header command palette (/api/search) and Tenure AI
 * (/api/ai/chat) so all three see exactly the same, correctly-scoped corpus.
 *
 * GE-062-004. Every row is re-authorized *after* it comes back, through
 * `authorizeRetrieved`, rather than being trusted because a `where` clause
 * fetched it. Three things follow from that: the approvals loop, which had no
 * check of any kind, has one; a document's `sensitivity` label is consulted for
 * the first time; and widening one of the queries below can no longer widen
 * what a caller reads without also changing the authorization rule.
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

  const visibility: RetrievalVisibility = {
    viewerId: userId,
    visibleOrgIds: new Set(orgIds),
    clearanceByOrg: new Map(orgs.map((o) => [o.id, clearanceIn(ctx, o)])),
  }

  const [memory, documents, approvals, events] = await Promise.all([
    db.memoryRecord.findMany({
      where: { organizationId: { in: orgIds }, isArchived: false },
      select: { id: true, title: true, content: true, roleId: true, organizationId: true },
    }),
    db.document.findMany({
      where: { organizationId: { in: orgIds }, isArchived: false },
      // `sensitivity` is selected because it is now read. Dropping it from this
      // projection silently reclassifies every document as `standard`.
      select: {
        id: true,
        title: true,
        description: true,
        organizationId: true,
        sensitivity: true,
      },
    }),
    db.approvalRequest.findMany({
      where: { OR: [{ organizationId: { in: orgIds } }, { submittedById: userId }] },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        organizationId: true,
        submittedById: true,
      },
    }),
    db.event.findMany({
      where: { organizationId: { in: orgIds }, status: { not: "CANCELLED" } },
      select: { id: true, title: true, description: true, venue: true, organizationId: true },
    }),
  ])

  const docs: SearchDoc[] = []

  // Note on the `orgById.get` that follows each check below: it is a lookup for
  // the club's name and slug, not a second gate. `authorizeRetrieved` has
  // already refused any row whose organization is outside the visible set.
  for (const m of memory) {
    const org = orgById.get(m.organizationId)
    if (!org) continue
    // Memory keeps its own richer rule (org-wide vs role-scoped cards, the
    // handoff window, the ACTIVE president) — the org-visibility half of
    // `authorizeRetrieved` is subsumed by `canViewOrg` inside it.
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
    if (
      !authorizeRetrieved(
        { organizationId: d.organizationId, sensitivity: d.sensitivity },
        visibility,
      )
    )
      continue
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
    // The one loop with no post-retrieval check at all: an approval whose club
    // the caller cannot see was pushed with its full title and description.
    // `ownerId` keeps the submitter's own request readable, matching
    // `/approvals/[id]/page.tsx`, which this result links to.
    if (
      !authorizeRetrieved(
        { organizationId: a.organizationId, ownerId: a.submittedById },
        visibility,
      )
    )
      continue
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
    if (!authorizeRetrieved({ organizationId: e.organizationId }, visibility)) continue
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
  // `orgs` is where `visibleOrgIds` came from, so re-checking these rows against
  // it would compare a set with itself and prove nothing.
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

/**
 * How high up the classification ladder this caller reads *in this club*.
 *
 * The two elevated readers are the ones `canSeeMemoryCard` already elevates for
 * role-scoped memory: the institution's OSE (oversight) and the club's own
 * ACTIVE president (accountability). SHADOW presidents preview the club but do
 * not yet hold it, matching every other write-or-elevation check in `rbac.ts`.
 * Everyone else — ordinary members, incoming holders — reads `standard`.
 */
function clearanceIn(
  ctx: UserContext,
  org: { id: string; institutionId: string },
): Sensitivity {
  if (isOse(ctx, org.institutionId)) return "restricted"
  const isActivePresident = ctx.orgRoles.some(
    (r) => r.organizationId === org.id && r.scope === "PRESIDENT" && r.status === "ACTIVE",
  )
  return isActivePresident ? "restricted" : "standard"
}
