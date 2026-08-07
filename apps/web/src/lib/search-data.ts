import "server-only"
import { db } from "@/lib/db"
import { getUserContext, isOse, type UserContext } from "@/lib/rbac"
import { canSeeMemoryCard } from "@/lib/memory"
import {
  requireTenantScope,
  TenantContextError,
  type TenantPurpose,
} from "@/lib/tenancy/context"
import {
  authorizeRetrieved,
  type RetrievalVisibility,
  type SearchDoc,
  type Sensitivity,
} from "@/lib/search"
import { projectionModeFor, retainedBody } from "@/lib/relay/projection-policy"

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
 *
 * WRK-010-003. Authorization decides *who* may see a row; it says nothing about
 * *how much of it* may be copied into an index or posted to a model vendor. So
 * every doc below now also carries a Bible §3.4 projection mode from
 * `projectionModeFor`, and its body passes through `retainedBody` — which
 * returns "" for a `REFERENCE_ONLY` kind. The memory bodies that used to be
 * flattened in here alongside a club's public description are therefore not in
 * the corpus at all: not scored, not snippetted by `/api/search`, and not
 * available to `/api/ai/chat` to send anywhere.
 *
 * Not exported. Every caller comes in through one of the two purpose-bound
 * entry points below, so there is no way to reach the corpus without having
 * first said what the rows are for.
 */
async function buildSearchCorpus(userId: string): Promise<SearchDoc[]> {
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

  // Read once per kind rather than per row: the policy is a property of the
  // kind, and re-deciding it inside a loop invites a row-dependent answer.
  const memoryMode = projectionModeFor("memory")
  const documentMode = projectionModeFor("document")
  const approvalMode = projectionModeFor("approval")
  const eventMode = projectionModeFor("event")
  const organizationMode = projectionModeFor("organization")

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
      mode: memoryMode,
      // `retainedBody`, not the raw value: at REFERENCE_ONLY the card's text
      // never becomes part of the corpus, so nothing downstream can leak it by
      // forgetting to check the mode.
      body: retainedBody(memoryMode, (m.content as { body?: string }).body ?? ""),
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
      mode: documentMode,
      // The caption, never the stored file: `objectKey` is not selected above.
      body: retainedBody(documentMode, d.description ?? ""),
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
      mode: approvalMode,
      body: retainedBody(
        approvalMode,
        `${a.description ?? ""} status:${a.status.toLowerCase()}`,
      ),
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
      mode: eventMode,
      body: retainedBody(eventMode, `${e.description ?? ""} ${e.venue ?? ""}`),
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
      mode: organizationMode,
      body: retainedBody(organizationMode, o.description ?? ""),
      href: `/orgs/${o.slug}/members`,
      context: "Club",
    })
  }
  return docs
}

/**
 * Retrieval is bound to the purpose its tenant scope was opened for
 * (WRK-070-002).
 *
 * `docs/architecture/REVIEW-FINDINGS.md:19` records that one of the two
 * competing `withTenant` designs carried a `purpose` and that the surviving
 * implementation dropped it. This is what the field is for. There are two ways
 * into this corpus and they differ in exactly one thing — what happens to the
 * rows afterwards. `/api/ai/chat` folds them into a prompt and posts them to a
 * model vendor; `/search` and `/api/search` render them back to the person who
 * already has permission to read them. Before this, both called one function
 * and nothing below could tell the two apart: same tenant, same actor, same
 * rows.
 *
 * The refusal runs in both directions deliberately. A gate that only stopped
 * `interactive → model` would be routed around by opening a model-exposure
 * scope and calling the interactive sibling, which is the same disclosure with
 * one more step in it.
 */
function requirePurpose(entryPoint: string, expected: TenantPurpose): void {
  const scope = requireTenantScope(entryPoint)
  if (scope.purpose === expected) return
  throw new TenantContextError(
    `${entryPoint} may only run inside a tenant scope opened for "${expected}", and this one ` +
      `was opened for "${scope.purpose}" (tenant ${scope.institutionId}). The two entry points ` +
      `into this corpus are not interchangeable: loadSearchCorpus() hands rows to a model ` +
      `vendor, loadInteractiveSearchCorpus() renders them to the requester. Open the scope with ` +
      `the purpose that matches what you are about to do with the rows.`,
  )
}

/**
 * The corpus, for rows that are about to be shown to a model.
 *
 * `/api/ai/chat` is the caller, and it opens its scope with
 * `purpose: "model-exposure"`. Any other purpose is refused here rather than
 * silently served — including the `interactive` default `withTenantScope` hands
 * out, so a new route that feeds a model and forgets to declare it fails at the
 * retrieval instead of quietly succeeding.
 */
export async function loadSearchCorpus(userId: string): Promise<SearchDoc[]> {
  requirePurpose("loadSearchCorpus", "model-exposure")
  return buildSearchCorpus(userId)
}

/**
 * The same corpus, for rows that are about to be rendered to the requester.
 *
 * `/search` (the page) and `/api/search` (the command palette) are the callers.
 * Identical rows, identical authorization — the difference is that nothing here
 * leaves the process, which is exactly the distinction the purpose records.
 */
export async function loadInteractiveSearchCorpus(userId: string): Promise<SearchDoc[]> {
  requirePurpose("loadInteractiveSearchCorpus", "interactive")
  return buildSearchCorpus(userId)
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
