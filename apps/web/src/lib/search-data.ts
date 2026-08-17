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
import { cellContext } from "@/lib/cell-context"
import {
  projectionModeFor,
  retainedBody,
  type ProjectionMode,
} from "@/lib/relay/projection-policy"
import {
  citingTenant,
  projectsBody,
  projectTenureRecord,
  type ProjectedState,
  type SourceCitation,
} from "@/lib/relay/citation"
import { activeContentFindings } from "@/lib/relay/untrusted-content"

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
 * WRK-010-005 / WRK-070-003. Authorization decides who, projection mode decides
 * how much — and neither says whether the row is still TRUE. Every doc below now
 * also carries a lifecycle state and a §9.3 citation from `projectTenureRecord`,
 * built from the row's own `updatedAt` (newly selected: none of the five queries
 * asked for a temporal column, so no consumer *could* have shown freshness).
 * Three consequences, and each was a silent failure before:
 *
 *   * A CANCELLED `Event` is TOMBSTONED rather than dropped. `where: { status:
 *     { not: "CANCELLED" } }` made a cancelled event indistinguishable from an
 *     event that never existed — the same absence, to every consumer.
 *   * A body carrying an executable payload is QUARANTINED: held, not cleaned
 *     into a plausible-looking fiction and indexed.
 *   * A row untouched for longer than `SEARCH_STALE_AFTER_MS` is STALE, and says
 *     so in the response and in the model's own prompt.
 *
 * Not exported. Every caller comes in through one of the two purpose-bound
 * entry points below, so there is no way to reach the corpus without having
 * first said what the rows are for.
 */
async function buildSearchCorpus(userId: string): Promise<SearchDoc[]> {
  // One instant for the whole corpus. Reading the clock per row would let two
  // rows in one response disagree about when "now" was, which is exactly the
  // kind of drift a freshness verdict must not have.
  const now = new Date()
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
    // `updatedAt` is selected because it is now read: it is the version time
    // (§9.3) every citation carries and the input to the LIVE/STALE verdict.
    // Dropping it from this projection makes every club's freshness unreadable,
    // which `freshnessOf` fails closed on — STALE, not silently current.
    select: {
      id: true,
      institutionId: true,
      name: true,
      slug: true,
      description: true,
      updatedAt: true,
    },
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
      select: {
        id: true,
        title: true,
        content: true,
        roleId: true,
        organizationId: true,
        updatedAt: true,
        // HCM-040-003. `type` and `sensitivity` are selected because
        // `canSeeMemoryCard` now reads them: what an INCOMING seat holder
        // inherits is decided per card by `people/seat-memory-boundary.ts`.
        // Dropping either from this projection is a type error there, for the
        // same reason the document projection below carries its own note —
        // omitting a classification column silently reclassifies every row.
        type: true,
        sensitivity: true,
        // Who wrote it. `canSeeMemoryCard` exempts a card's author from the seat
        // inheritance rules, and it cannot do that with a column it was not given
        // — omitting this hides a writer's own card from her own search, which is
        // the defect `search-reports.spec.ts` caught.
        authorId: true,
      },
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
        updatedAt: true,
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
        updatedAt: true,
      },
    }),
    // WRK-010-005. The `status: { not: "CANCELLED" }` filter is GONE, and its
    // removal is the requirement: a cancelled event was dropped here, and an
    // absent row is indistinguishable from one that never existed. The row now
    // comes back and is tombstoned below — findable, citable, carrying no body,
    // and refused by `rankDocs` as a source an answer may rest on. `status` is
    // selected because it is now read; dropping it from this projection makes
    // every cancelled event read as live again.
    db.event.findMany({
      where: { organizationId: { in: orgIds } },
      select: {
        id: true,
        title: true,
        description: true,
        venue: true,
        organizationId: true,
        status: true,
        updatedAt: true,
      },
    }),
  ])

  const docs: SearchDoc[] = []

  // WRK-070-001. Where this cell runs, asked once and passed to every mode
  // decision below. The projection used to be global — `projectionModeFor(kind)`
  // over a module-level constant — so a tenant in a partition with no route to
  // the model vendor got the same `SEARCH_PROJECTION` as one in `us-east-1`, and
  // its bodies were assembled at full retention ready to post. `cellContext()`
  // is the value `lib/ai.ts` already refuses a model on; the corpus now reads
  // the same one, so the two cannot disagree about where this tenant's rows are
  // allowed to be processed.
  const residency = cellContext()

  // Read once per kind rather than per row: the policy is a property of the
  // kind and of the cell, and re-deciding it inside a loop invites a
  // row-dependent answer.
  const memoryMode = projectionModeFor("memory", residency)
  const documentMode = projectionModeFor("document", residency)
  const approvalMode = projectionModeFor("approval", residency)
  const eventMode = projectionModeFor("event", residency)
  const organizationMode = projectionModeFor("organization", residency)

  // The tenant every citation is stamped with, taken from the OPEN SCOPE — the
  // value `resolveTenantScope` validated against live membership — rather than
  // from a row's own column, which would be the row asserting its own tenancy.
  const tenant = citingTenant("buildSearchCorpus")

  /**
   * The body a row is allowed to contribute, and the state that decision came
   * from — the §3.4 mode and the §9.4/§3.5 lifecycle applied together, once.
   *
   * Both halves drop the text at CONSTRUCTION rather than marking it for a
   * consumer to withhold, which is the lesson WRK-010-003 already recorded here:
   * a body that is absent from the doc cannot be leaked by a ranker, a snippet
   * builder or a prompt assembler that forgot to check a flag.
   */
  function project(
    mode: ProjectionMode,
    rawBody: string,
    row: { externalId: string; href: string; asOf: Date; deleted?: boolean },
  ): { body: string; state: ProjectedState; citation: SourceCitation } {
    const quarantined = activeContentFindings(rawBody).length > 0
    const { state, citation } = projectTenureRecord({
      tenant,
      externalId: row.externalId,
      href: row.href,
      asOf: row.asOf,
      now,
      deleted: row.deleted,
      quarantined,
    })
    return {
      body: projectsBody(state) ? retainedBody(mode, rawBody) : "",
      state,
      citation,
    }
  }

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
    const href = `/orgs/${org.slug}/memory`
    docs.push({
      id: m.id,
      kind: "memory",
      title: m.title,
      mode: memoryMode,
      href,
      context: org.name,
      asOf: m.updatedAt,
      // `project`, not the raw value: at REFERENCE_ONLY the card's text never
      // becomes part of the corpus, so nothing downstream can leak it by
      // forgetting to check the mode — and the same call decides the state.
      ...project(memoryMode, (m.content as { body?: string }).body ?? "", {
        externalId: m.id,
        href,
        asOf: m.updatedAt,
      }),
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
    const href = `/orgs/${org.slug}/documents`
    docs.push({
      id: d.id,
      kind: "document",
      title: d.title,
      mode: documentMode,
      href,
      context: org.name,
      asOf: d.updatedAt,
      // The caption, never the stored file: `objectKey` is not selected above.
      ...project(documentMode, d.description ?? "", {
        externalId: d.id,
        href,
        asOf: d.updatedAt,
      }),
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
    const href = `/approvals/${a.id}`
    docs.push({
      id: a.id,
      kind: "approval",
      title: a.title,
      mode: approvalMode,
      href,
      context: org?.name ?? "Approvals",
      asOf: a.updatedAt,
      ...project(approvalMode, `${a.description ?? ""} status:${a.status.toLowerCase()}`, {
        externalId: a.id,
        href,
        asOf: a.updatedAt,
      }),
    })
  }
  for (const e of events) {
    if (!authorizeRetrieved({ organizationId: e.organizationId }, visibility)) continue
    const org = orgById.get(e.organizationId)
    if (!org) continue
    const href = `/calendar/${e.id}`
    docs.push({
      id: e.id,
      kind: "event",
      title: e.title,
      mode: eventMode,
      href,
      context: org.name,
      asOf: e.updatedAt,
      // WRK-010-005. `deleted` is where the dropped `status: { not: "CANCELLED" }`
      // filter went: the row now comes back and is TOMBSTONED, so a member
      // searching for the event their club cancelled is told it was cancelled
      // rather than told nothing — which reads as "there is no such event".
      ...project(eventMode, `${e.description ?? ""} ${e.venue ?? ""}`, {
        externalId: e.id,
        href,
        asOf: e.updatedAt,
        deleted: e.status === "CANCELLED",
      }),
    })
  }
  // `orgs` is where `visibleOrgIds` came from, so re-checking these rows against
  // it would compare a set with itself and prove nothing.
  for (const o of orgs) {
    const href = `/orgs/${o.slug}/members`
    docs.push({
      id: o.id,
      kind: "organization",
      title: o.name,
      mode: organizationMode,
      href,
      context: "Club",
      asOf: o.updatedAt,
      ...project(organizationMode, o.description ?? "", {
        externalId: o.id,
        href,
        asOf: o.updatedAt,
      }),
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
