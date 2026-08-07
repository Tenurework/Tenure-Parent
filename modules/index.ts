import {
  ModuleCatalog,
  type CompletenessDimension,
  type DimensionAssessment,
  type ModuleDependency,
  type ModuleGap,
  type ModuleManifest,
} from "@tenure/module-runtime"
import type { ProcessChain } from "@tenure/contracts"

/**
 * The module catalog.
 *
 * These describe capability the application already has. That is deliberate and
 * is the honest order to do it in: a manifest for a module that does not exist
 * declares nothing anyone can check, whereas a manifest over working code is
 * immediately falsifiable — `events` claims `/calendar`, and
 * `tests/architecture/nav-hrefs-are-served.test.mjs` fails if
 * `apps/web/src/app/(app)/calendar/page.tsx` is not there, because it derives
 * the routes the app serves from the filesystem rather than from a list.
 *
 * That sentence used to be here and was not true. The check it referred to
 * compared every href against a `const served = new Set([...])` written by hand
 * inside `packages/platform-config/src/modules.test.ts`, so deleting the
 * calendar page left it green — it tested that the manifests agreed with a
 * literal, which they were written beside. Every lifecycle claim below is a
 * claim about this application, and that is now the check which can refute the
 * part of it about surfaces: a module advertising a page nobody serves fails,
 * by id and href (PACK-000-004, PACK-070-001).
 *
 * What each manifest currently carries is what something reads: lifecycle,
 * dependencies, incompatibilities, entitlement, permissions, navigation. It does
 * not carry workflow actions, form components or integration hooks, because
 * those engines do not exist yet and a declaration nothing validates is worse
 * than no declaration.
 *
 * ## The availability claim
 *
 * Every manifest here used to say `lifecycle: "available"` — twelve of twelve —
 * and nothing checked the claim against anything. Bible §6 is explicit that "a
 * product name, navigation item, table or API scaffold does not pass", which is
 * exactly what those twelve declarations were. PACK-000-004 calls that a false
 * `Available` claim and PACK-000-002 asks for the seventeen-dimension
 * classification that replaces it.
 *
 * So each manifest now states all seventeen, and `validateManifest` refuses
 * `available` when any of them is a gap. All twelve came out
 * `certified-limited`, which is the honest answer: they run, they are supported,
 * and each carries a list of what it does not do. Nothing was downgraded
 * automatically — the validator refuses the manifest and the author states what
 * is true.
 *
 * `organizations` is the base every other module depends on, because every one
 * of them hangs its records off an organization.
 */

// ── how the assessments are written ─────────────────────────────────────────

/**
 * One dimension's verdict: id, status, what exists, and — for a gap — what does
 * not.
 *
 * A tuple rather than two hand-maintained structures, because `dimensions` and
 * `gaps` have to agree and `validateManifest` refuses them when they do not.
 * Writing a gap in one place and forgetting the other is the single most likely
 * way this classification would rot.
 */
type Verdict = readonly [CompletenessDimension, DimensionAssessment["status"], string, string?]

function assess(verdicts: readonly Verdict[]): {
  dimensions: Partial<Record<CompletenessDimension, DimensionAssessment>>
  gaps: readonly ModuleGap[]
} {
  const dimensions: Partial<Record<CompletenessDimension, DimensionAssessment>> = {}
  const gaps: ModuleGap[] = []
  for (const [dimension, status, evidence, missing] of verdicts) {
    dimensions[dimension] = { status, evidence }
    if (status === "gap") gaps.push({ dimension, detail: missing ?? "(no detail given)" })
  }
  return { dimensions, gaps }
}

const needs = (module: string, range = ">=1.0.0"): ModuleDependency => ({
  module,
  range,
  kind: "required",
})

/** Works without it; must be compatible when it is there. */
const mayUse = (module: string, range = ">=1.0.0"): ModuleDependency => ({
  module,
  range,
  kind: "optional",
})

/**
 * The engine these manifests were authored against.
 *
 * Every one of them declares it, and that is a real refusal rather than a
 * formality: a cell running an older build refuses the whole catalog instead of
 * half-applying manifests whose configuration keys it has never heard of, which
 * is the case `packages/platform-config/src/compatibility.ts` was written about.
 */
const ENGINE = "2026.8.0"

// Facts that are true of every module, written once. Repeating a sentence
// twelve times is how twelve copies come to disagree.
const NO_RUNBOOK =
  "No service objective, alert or runbook names this module. apps/web/src/instrumentation.ts is a " +
  "boot-time environment check, not an SLO, and no per-module cost is attributed."
const NO_RELAY_POLICY =
  "No retrieval policy or answer-quality evaluation is declared for this module. The only declared " +
  "Relay boundary in the catalog is the `search.corpus` tool on `search`."
const NO_LEGAL_SCOPE =
  "Locale, currency, first day of week and working days resolve per tenant " +
  "(packages/platform-config/src/localization.ts, proven by the fixture-rtl binding). No legal, " +
  "regulatory or certification scope is declared for any jurisdiction."
const RELEASE_LIFECYCLE =
  "packages/releases/src/release.ts freezes the enabled set into a checksummed artifact and " +
  "rollbackTo restores an earlier one; this manifest carries lifecycle, supportEndsAt and " +
  "suspension, which resolveModules enforces."
const NO_CUTOVER =
  "Versioned schema migrations exist under apps/web/prisma/migrations, but nothing describes " +
  "cutover from an incumbent system, coexistence with one, or a data-quality check on import."

// ── the modules ─────────────────────────────────────────────────────────────

const organizations: ModuleManifest = {
  key: "organizations",
  version: "1.0.0",
  name: "Organizations",
  description: "The organizations themselves, their rosters, and the seats people hold on them.",
  owner: "organization",
  objects: [
    "Organization",
    "Role",
    "Seat",
    "SeatHolding",
    "RoleAssignment",
    "RoleTransfer",
    "OrganizationAdvisor",
    "DirectoryPerson",
  ],
  lifecycle: "certified-limited",
  mode: "TENURE_NATIVE",
  requiresEngine: ENGINE,
  ...assess([
    ["authority-and-domain-boundary", "pass", "Owned by the `organization` domain in docs/architecture/ownership.md; org.* permissions are gated on this key in packages/authorization/src/permission-catalog.ts."],
    ["business-outcomes-and-personas", "pass", "unit.member, unit.lead and oversight.* in packages/authorization/src/role-templates.ts are the personas that act on a roster."],
    ["canonical-objects-and-invariants", "pass", "Organization, Role, Seat, SeatHolding, RoleAssignment, RoleTransfer, OrganizationAdvisor and DirectoryPerson in apps/web/prisma/schema.prisma."],
    ["state-machines-and-effective-dating", "pass", "Seats carry ACTIVE/SHADOW status and role assignments carry dates; tests/architecture/live-membership.test.mjs fails the build when a read forgets them."],
    ["commands-events-and-idempotency", "gap", "Roster writes go straight to Prisma from server actions.", "No domain event is published for a seat change and no command carries an idempotency key, so a retried roster write is a second write."],
    ["authorization-privacy-and-sod", "pass", "packages/authorization/src/decide.ts answers every roster question; the duties matrix in controls.ts covers seat assignment."],
    ["configuration-inheritance-and-terminology", "pass", "packages/platform-config renames the unit per tenant through terminologyFor; no component holds the word."],
    ["accounting-controls-and-reconciliation", "not-applicable", "The org graph records no money and posts nothing to a ledger."],
    ["ux-routes-forms-and-accessibility", "pass", "apps/web/src/app/(app)/orgs/page.tsx and the directory surfaces; accessibility helpers in apps/web/src/lib/a11y."],
    ["external-integrations-and-failure", "not-applicable", "The roster is Tenure's own record; nothing outside the platform writes it."],
    ["migration-cutover-and-data-quality", "gap", NO_CUTOVER, "No documented cutover from an incumbent roster, and no duplicate-person or orphan-seat data-quality check."],
    ["search-analytics-and-memory", "pass", "apps/web/src/lib/search-data.ts indexes organizations inside the principal's own scope."],
    ["relay-boundaries-and-evaluations", "gap", NO_RELAY_POLICY, "Nothing states what Relay may retrieve from a roster, and no evaluation scores what it returns."],
    ["localization-legal-and-certification", "gap", NO_LEGAL_SCOPE, "No jurisdiction scope is declared, so nothing can refuse this module in a country it is not cleared for."],
    ["observability-slo-and-finops", "gap", NO_RUNBOOK, "No SLO, alert or runbook for roster availability."],
    ["upgrade-rollback-and-deprecation", "pass", RELEASE_LIFECYCLE],
    ["test-and-certification-evidence", "pass", "apps/web/src/lib/rbac.test.ts, apps/web/src/lib/seat-is-not-a-role.itest.ts and tests/architecture/live-membership.test.mjs."],
  ]),
  permissions: ["org.unit.read", "org.unit.update", "org.roster.read", "org.roster.update"],
  navigation: [
    {
      id: "organizations.list",
      label: "All Clubs",
      href: "/orgs",
      section: "Community",
      sectionOrder: 20,
      order: 20,
      icon: "Building2",
    },
  ],
}

const feed: ModuleManifest = {
  key: "feed",
  version: "1.0.0",
  name: "Community feed",
  description: "Announcements and cross-organization posts.",
  owner: "notifications",
  objects: ["FeedPost", "FeedComment", "CollabInterest"],
  lifecycle: "certified-limited",
  mode: "TENURE_NATIVE",
  requiresEngine: ENGINE,
  dependsOn: [needs("organizations")],
  ...assess([
    ["authority-and-domain-boundary", "pass", "Owned by `notifications` in docs/architecture/ownership.md; communications.announcement.* is gated on this key."],
    ["business-outcomes-and-personas", "pass", "unit.lead and institution.director publish; unit.member comments — packages/authorization/src/role-templates.ts."],
    ["canonical-objects-and-invariants", "pass", "FeedPost, FeedComment and CollabInterest in apps/web/prisma/schema.prisma."],
    ["state-machines-and-effective-dating", "gap", "A post is either published or it is not.", "No draft, scheduled or expired state and no effective dating, so an announcement cannot be scheduled or retired on a date."],
    ["commands-events-and-idempotency", "gap", "Posting is a server action writing one row.", "No domain event is published when an announcement goes out, so nothing downstream can react to one."],
    ["authorization-privacy-and-sod", "pass", "communications.announcement.publish is a separate permission from .create, so drafting and publishing are separable duties."],
    ["configuration-inheritance-and-terminology", "pass", "The staff office's name in a post's byline comes from terminologyFor, not a literal."],
    ["accounting-controls-and-reconciliation", "not-applicable", "A feed post records no money."],
    ["ux-routes-forms-and-accessibility", "pass", "apps/web/src/app/(app)/feed/page.tsx; the composer uses the shared form primitives."],
    ["external-integrations-and-failure", "not-applicable", "Nothing outside the platform posts to or reads the feed."],
    ["migration-cutover-and-data-quality", "gap", NO_CUTOVER, "No import path from an incumbent announcements tool."],
    ["search-analytics-and-memory", "gap", "apps/web/src/lib/search-data.ts indexes memory, documents, approvals, events and organizations.", "Feed posts are not indexed, so an announcement is unfindable the day after it scrolls away."],
    ["relay-boundaries-and-evaluations", "gap", NO_RELAY_POLICY, "Nothing states whether Relay may quote an announcement."],
    ["localization-legal-and-certification", "gap", NO_LEGAL_SCOPE, "No declared jurisdiction scope."],
    ["observability-slo-and-finops", "gap", NO_RUNBOOK, "No SLO or runbook for feed delivery."],
    ["upgrade-rollback-and-deprecation", "pass", RELEASE_LIFECYCLE],
    ["test-and-certification-evidence", "gap", "Covered indirectly by the end-to-end suite under apps/web/e2e.", "No unit or property test names the feed's own rules."],
  ]),
  permissions: ["communications.announcement.create", "communications.announcement.publish", "communications.comment.create"],
  navigation: [
    {
      id: "feed.home",
      label: "Community Feed",
      href: "/feed",
      section: "Community",
      sectionOrder: 20,
      order: 10,
      icon: "Newspaper",
    },
  ],
}

const messaging: ModuleManifest = {
  key: "messaging",
  version: "1.0.0",
  name: "Messaging",
  description: "Direct and group conversations, scoped to the organizations people belong to.",
  owner: "notifications",
  objects: ["Conversation", "Participant", "Message", "Attachment", "Delivery"],
  lifecycle: "certified-limited",
  mode: "TENURE_NATIVE",
  requiresEngine: ENGINE,
  dependsOn: [needs("organizations")],
  ...assess([
    ["authority-and-domain-boundary", "pass", "Owned by `notifications` in docs/architecture/ownership.md; communications.message.* is gated on this key."],
    ["business-outcomes-and-personas", "pass", "Every seat template carries communications.message.read and .create — packages/authorization/src/role-templates.ts."],
    ["canonical-objects-and-invariants", "pass", "Conversation, Participant, Message, Attachment and Delivery in apps/web/prisma/schema.prisma; a message belongs to exactly one conversation."],
    ["state-machines-and-effective-dating", "pass", "Delivery carries per-participant delivery state; apps/web/src/lib/messaging.ts is the only writer."],
    ["commands-events-and-idempotency", "gap", "Sending writes a Message and its Deliveries in one transaction.", "No idempotency key, so a double-submitted send is two messages."],
    ["authorization-privacy-and-sod", "pass", "apps/web/src/lib/messaging.test.ts covers participation scoping; a non-participant cannot read a thread."],
    ["configuration-inheritance-and-terminology", "pass", "Surface wording resolves through terminologyFor rather than literals."],
    ["accounting-controls-and-reconciliation", "not-applicable", "Messaging records no money."],
    ["ux-routes-forms-and-accessibility", "pass", "apps/web/src/app/(app)/messages/page.tsx; keyboard and focus behaviour via apps/web/src/lib/a11y."],
    ["external-integrations-and-failure", "gap", "apps/web/src/lib/notify.ts sends the out-of-band email notification.", "No declared failure behaviour or retry contract when the mail transport is unavailable — a dropped notification is silent."],
    ["migration-cutover-and-data-quality", "gap", NO_CUTOVER, "No import path for message history from an incumbent tool."],
    ["search-analytics-and-memory", "gap", "apps/web/src/lib/search-data.ts indexes five row types and messages are not among them.", "Nothing decides whether private conversations should be searchable; the answer today is an omission rather than a policy."],
    ["relay-boundaries-and-evaluations", "gap", NO_RELAY_POLICY, "No declared boundary saying Relay may not read a private conversation."],
    ["localization-legal-and-certification", "gap", NO_LEGAL_SCOPE, "No retention or lawful-access position is declared for message content."],
    ["observability-slo-and-finops", "gap", NO_RUNBOOK, "No SLO on delivery latency."],
    ["upgrade-rollback-and-deprecation", "pass", RELEASE_LIFECYCLE],
    ["test-and-certification-evidence", "pass", "apps/web/src/lib/messaging.test.ts."],
  ]),
  permissions: ["communications.message.create", "communications.message.read", "communications.thread.create"],
  navigation: [
    {
      id: "messaging.inbox",
      label: "Messages",
      href: "/messages",
      section: "Community",
      sectionOrder: 20,
      order: 30,
      icon: "MessageSquare",
    },
  ],
}

const approvals: ModuleManifest = {
  key: "approvals",
  version: "1.0.0",
  name: "Requests and approvals",
  description: "Multi-gate approval requests with delegation and an audited decision trail.",
  owner: "workflow",
  objects: ["ApprovalRequest", "ApprovalStep", "ApprovalDelegation"],
  lifecycle: "certified-limited",
  mode: "TENURE_NATIVE",
  requiresEngine: ENGINE,
  dependsOn: [needs("organizations")],
  ...assess([
    ["authority-and-domain-boundary", "pass", "Owned by `workflow` in docs/architecture/ownership.md; approvals.* is gated on this key."],
    ["business-outcomes-and-personas", "pass", "Requester, gate decider and delegate are three distinct templates in packages/authorization/src/role-templates.ts."],
    ["canonical-objects-and-invariants", "pass", "ApprovalRequest, ApprovalStep and ApprovalDelegation in apps/web/prisma/schema.prisma."],
    ["state-machines-and-effective-dating", "pass", "packages/workflow implements the gate machine; delegations are effective-dated and packages/authorization/src/decide.ts intersects them with what the delegator still holds."],
    ["commands-events-and-idempotency", "pass", "ApprovalRequested and ApprovalDecided are written to the transactional outbox in the same transaction as the status change — apps/web/src/lib/outbox/outbox.ts."],
    ["authorization-privacy-and-sod", "pass", "packages/authorization/src/controls.ts refuses a template that can both raise and decide the same spend; the self-approval path is closed in apps/web/src/lib/approvals.ts."],
    ["configuration-inheritance-and-terminology", "pass", "Gate policy and thresholds resolve through the configuration registry rather than constants."],
    ["accounting-controls-and-reconciliation", "gap", "A reimbursement approval posts a SPEND ledger entry through apps/web/src/lib/finance.ts.", "Nothing reconciles the approval trail against the ledger, so a posted entry whose approval no longer exists is undetectable."],
    ["ux-routes-forms-and-accessibility", "pass", "apps/web/src/app/(app)/approvals/page.tsx with the shared form and worklist primitives."],
    ["external-integrations-and-failure", "not-applicable", "No external approver or e-signature provider is integrated."],
    ["migration-cutover-and-data-quality", "gap", NO_CUTOVER, "No import path for in-flight requests from an incumbent workflow tool."],
    ["search-analytics-and-memory", "pass", "apps/web/src/lib/search-data.ts indexes approvals within the principal's scope."],
    ["relay-boundaries-and-evaluations", "gap", NO_RELAY_POLICY, "No declared limit on what Relay may retrieve from a decision trail."],
    ["localization-legal-and-certification", "gap", NO_LEGAL_SCOPE, "No declared evidentiary or records-retention standard for the decision trail."],
    ["observability-slo-and-finops", "gap", "apps/web/src/lib/approvals-sla.ts computes an SLA per request.", "Nothing alerts on the aggregate, so a queue that has stopped moving is visible only to whoever opens it."],
    ["upgrade-rollback-and-deprecation", "pass", RELEASE_LIFECYCLE],
    ["test-and-certification-evidence", "pass", "apps/web/src/lib/approvals.test.ts, approvals-sla.test.ts and the packages/workflow suite."],
  ]),
  permissions: ["approvals.request.create", "approvals.request.read", "approvals.request.decide", "approvals.request.cancel", "approvals.request.assign", "approvals.policy.read"],
  // Both are written to the transactional outbox by
  // `apps/web/src/app/(app)/approvals/actions.ts`, in the same transaction as
  // the status change that caused them — so "the request moved" and "the event
  // exists" cannot disagree. `outboxEventRow` is the mapper both calls go
  // through, and it runs `parseDomainEvent`, which is what holds the spelling
  // here to the spelling on the wire.
  emits: ["ApprovalRequested", "ApprovalDecided"],
  // The module acts on its own submission: a submitted request is what the
  // decision gates run against.
  consumes: ["ApprovalRequested"],
  navigation: [
    {
      id: "approvals.inbox",
      label: "Approvals",
      href: "/approvals",
      section: "Operations",
      sectionOrder: 30,
      order: 10,
      icon: "CheckCircle",
    },
  ],
}

const events: ModuleManifest = {
  key: "events",
  version: "1.0.0",
  name: "Events and calendar",
  description: "Event scheduling, conflict detection and a subscribable calendar.",
  owner: "notifications",
  objects: ["Event", "ConflictRecord"],
  lifecycle: "certified-limited",
  mode: "TENURE_NATIVE",
  requiresEngine: ENGINE,
  dependsOn: [needs("organizations")],
  ...assess([
    ["authority-and-domain-boundary", "pass", "Owned by `notifications` in docs/architecture/ownership.md; events.* is gated on this key."],
    ["business-outcomes-and-personas", "pass", "unit.lead publishes and cancels; oversight.staff can cancel across units — packages/authorization/src/role-templates.ts."],
    ["canonical-objects-and-invariants", "pass", "Event and ConflictRecord in apps/web/prisma/schema.prisma."],
    ["state-machines-and-effective-dating", "pass", "Draft, published and cancelled are distinct states with distinct permissions (events.event.publish, .cancel); apps/web/src/lib/calendar-write.ts is the only writer."],
    ["commands-events-and-idempotency", "gap", "Publication and cancellation are server actions.", "No domain event is published when an event is cancelled, so nothing downstream can react to it."],
    ["authorization-privacy-and-sod", "pass", "apps/web/src/lib/calendar-permissions.test.ts covers who may publish into whose calendar."],
    ["configuration-inheritance-and-terminology", "pass", "Working days, first day of week and holidays come from the tenant's localization layer — packages/platform-config/src/localization.ts."],
    ["accounting-controls-and-reconciliation", "not-applicable", "An event records no money; spend against it belongs to budgeting."],
    ["ux-routes-forms-and-accessibility", "pass", "apps/web/src/app/(app)/calendar/page.tsx; colours go through apps/web/src/components/charts/cvd.ts for contrast."],
    ["external-integrations-and-failure", "gap", "apps/web/src/lib/calendar-sync.ts publishes a subscribable feed.", "No declared failure behaviour when a subscriber cannot fetch it, and no surface saying a subscription has gone stale."],
    ["migration-cutover-and-data-quality", "gap", NO_CUTOVER, "No import path from an incumbent calendar."],
    ["search-analytics-and-memory", "pass", "apps/web/src/lib/search-data.ts indexes events within the principal's scope."],
    ["relay-boundaries-and-evaluations", "gap", NO_RELAY_POLICY, "No declared limit on what Relay may retrieve from the calendar."],
    ["localization-legal-and-certification", "gap", NO_LEGAL_SCOPE, "No venue-accessibility or public-notice requirement is modelled for any jurisdiction."],
    ["observability-slo-and-finops", "gap", NO_RUNBOOK, "No SLO on the subscribable feed."],
    ["upgrade-rollback-and-deprecation", "pass", RELEASE_LIFECYCLE],
    ["test-and-certification-evidence", "pass", "apps/web/src/lib/calendar.test.ts, calendar-conflict-policy.test.ts, calendar-write.test.ts and calendar-permissions.test.ts."],
  ]),
  permissions: ["events.event.create", "events.event.read", "events.event.update", "events.event.publish", "events.event.cancel", "events.conflict.read"],
  navigation: [
    {
      id: "events.calendar",
      label: "Calendar",
      href: "/calendar",
      section: "Operations",
      sectionOrder: 30,
      order: 20,
      icon: "Calendar",
    },
  ],
}

const resources: ModuleManifest = {
  key: "resources",
  version: "1.0.0",
  name: "Board resources",
  description: "The staff office's published forms, guides and policies, targeted by seat.",
  owner: "erp-modules",
  objects: ["Resource"],
  lifecycle: "certified-limited",
  mode: "TENURE_NATIVE",
  requiresEngine: ENGINE,
  dependsOn: [needs("organizations")],
  ...assess([
    ["authority-and-domain-boundary", "pass", "Owned by `erp-modules` in docs/architecture/ownership.md; resources.* is gated on this key."],
    ["business-outcomes-and-personas", "pass", "institution.staff and institution.director publish; institution.advisor deliberately cannot — packages/authorization/src/role-templates.ts."],
    ["canonical-objects-and-invariants", "pass", "Resource in apps/web/prisma/schema.prisma, targeted by seat rather than by person."],
    ["state-machines-and-effective-dating", "pass", "Published and archived are distinct states with distinct permissions — resources.resource.archive."],
    ["commands-events-and-idempotency", "gap", "Publishing writes one row through apps/web/src/lib/resources-data.ts.", "No domain event when a policy is published, so nothing can notify the seats it targets."],
    ["authorization-privacy-and-sod", "pass", "apps/web/src/lib/resources-data.ts asks decideAcrossInstitution for every write and surfaces the refusal reason."],
    ["configuration-inheritance-and-terminology", "pass", "The staff office's name on the board comes from terminologyFor."],
    ["accounting-controls-and-reconciliation", "not-applicable", "A resource records no money."],
    ["ux-routes-forms-and-accessibility", "pass", "apps/web/src/app/(app)/resources/page.tsx."],
    ["external-integrations-and-failure", "gap", "Attached files are stored through apps/web/src/lib/s3.ts.", "No declared failure behaviour when object storage is unavailable — the surface renders with an unreachable link."],
    ["migration-cutover-and-data-quality", "gap", NO_CUTOVER, "No bulk import for an existing policy library, and no link-rot check."],
    ["search-analytics-and-memory", "pass", "apps/web/src/lib/search-data.ts indexes documents within the principal's scope."],
    ["relay-boundaries-and-evaluations", "gap", NO_RELAY_POLICY, "No declared limit on what Relay may quote from a policy document."],
    ["localization-legal-and-certification", "gap", NO_LEGAL_SCOPE, "No declared retention or accessibility standard for published policy."],
    ["observability-slo-and-finops", "gap", NO_RUNBOOK, "No SLO on the board's availability."],
    ["upgrade-rollback-and-deprecation", "pass", RELEASE_LIFECYCLE],
    ["test-and-certification-evidence", "gap", "The write path is exercised through the authorization suite.", "No test names the targeting rules — which seats see which resource — directly."],
  ]),
  permissions: ["resources.resource.create", "resources.resource.read", "resources.resource.update", "resources.resource.archive"],
  navigation: [
    {
      id: "resources.library",
      label: "Resources",
      href: "/resources",
      section: "Knowledge",
      sectionOrder: 40,
      order: 10,
      icon: "BookOpen",
    },
  ],
}

const search: ModuleManifest = {
  key: "search",
  version: "1.0.0",
  name: "Tenure AI",
  description: "Assisted search and drafting across everything the principal can already see.",
  owner: "search-memory",
  lifecycle: "certified-limited",
  // Bible §11. It ingests, views and searches what the principal can already
  // see, and writes nothing back to any record: a draft leaves as text for a
  // person to use, not as a row. Declaring it produces a standing advisory on
  // every system that runs it, which is what §11 asks the UI to show.
  mode: "READ_ONLY",
  requiresEngine: ENGINE,
  dependsOn: [
    needs("organizations"),
    // Real and optional: apps/web/src/lib/search-data.ts reads memoryRecord when
    // the module is there and returns documents, approvals and events when it is
    // not. A required dependency would refuse search to every system that did
    // not buy organizational memory.
    mayUse("memory"),
  ],
  ...assess([
    ["authority-and-domain-boundary", "pass", "Owned by `search-memory` in docs/architecture/ownership.md; search.index.query is gated on this key."],
    ["business-outcomes-and-personas", "pass", "Every seat template carries search.index.query — packages/authorization/src/role-templates.ts."],
    ["canonical-objects-and-invariants", "not-applicable", "Search owns no stored object; it reads other modules' records through their own scoping."],
    ["state-machines-and-effective-dating", "not-applicable", "A query has no state to machine."],
    ["commands-events-and-idempotency", "not-applicable", "Every operation is a read; there is no command to make idempotent."],
    ["authorization-privacy-and-sod", "pass", "apps/web/src/lib/search-data.ts filters every row type through the owning module's own visibility rule, and search.test.ts proves a sensitive card is dropped."],
    ["configuration-inheritance-and-terminology", "pass", "The assistant's name and the office it speaks for come from terminologyFor."],
    ["accounting-controls-and-reconciliation", "not-applicable", "Search records no money."],
    ["ux-routes-forms-and-accessibility", "pass", "apps/web/src/app/(app)/search/page.tsx plus the assistant panel opened by the `openAiPanel` command."],
    ["external-integrations-and-failure", "gap", "apps/web/src/lib/ai.ts calls a model vendor directly.", "No gateway, no timeout or fallback contract and no per-tenant policy, so a vendor outage surfaces as a raw error."],
    ["migration-cutover-and-data-quality", "not-applicable", "Nothing is stored, so there is nothing to migrate or cut over."],
    ["search-analytics-and-memory", "pass", "This module is that dimension: apps/web/src/lib/search-data.ts is the retrieval path, proven against a live database by search-data.itest.ts."],
    ["relay-boundaries-and-evaluations", "gap", "The `search.corpus` tool below is the only declared Relay boundary in the catalog, and apps/web/src/lib/relay-tools.ts re-authorizes it per call.", "No evaluation suite scores what the assistant returns, so a regression in answer quality is invisible."],
    ["localization-legal-and-certification", "gap", NO_LEGAL_SCOPE, "No declared data-residency or model-provider position, which is the first question a regulated tenant asks about an assistant."],
    ["observability-slo-and-finops", "gap", NO_RUNBOOK, "No token accounting and no per-tenant cost attribution for model calls."],
    ["upgrade-rollback-and-deprecation", "pass", RELEASE_LIFECYCLE],
    ["test-and-certification-evidence", "pass", "apps/web/src/lib/search.test.ts and apps/web/src/lib/search-data.itest.ts."],
  ]),
  permissions: ["search.index.query"],
  /**
   * The one tool Relay may invoke on this system.
   *
   * Read-only and gated on `search.index.query`, which is the permission the
   * catalog already defines for "search across everything you can already see".
   * `reauthorizesPerCall` is true and is not decoration: `/api/ai/chat` puts
   * this registration through `decide()` on every request rather than deciding
   * once per session, so a seat that ended between two questions stops
   * answering on the second.
   *
   * One entry, not a plausible list. A registered tool nothing implements is a
   * capability an assistant will try to use and a reviewer will believe exists.
   */
  tools: [
    {
      toolKey: "search.corpus",
      module: "search",
      description:
        "Retrieve passages from the requesting principal's own permission-scoped corpus — their clubs' documents, events, approvals and knowledge cards — to ground an answer.",
      requiredPermission: "search.index.query",
      readOnly: true,
      reauthorizesPerCall: true,
    },
  ],
  navigation: [
    {
      id: "search.assistant",
      label: "Tenure AI",
      href: "/search",
      section: "Knowledge",
      sectionOrder: 40,
      order: 20,
      icon: "TenureAIMark",
      // Opens the assistant panel rather than navigating. The behaviour lives in
      // the UI; the manifest only names it, so this package renders nothing.
      action: "openAiPanel",
      riskClass: "read",
      // Opening the panel shows what the principal can already see and writes
      // nothing. Drafting from it goes through `/api/ai/draft`, which is its own
      // entry point with its own guard — this entry only opens the surface.

    },
  ],
}

const memory: ModuleManifest = {
  key: "memory",
  version: "1.0.0",
  name: "Organizational memory",
  description: "Knowledge cards and documents that outlive the officers who wrote them.",
  owner: "search-memory",
  objects: ["MemoryRecord", "Document"],
  lifecycle: "certified-limited",
  mode: "TENURE_NATIVE",
  requiresEngine: ENGINE,
  dependsOn: [needs("organizations")],
  ...assess([
    ["authority-and-domain-boundary", "pass", "Owned by `search-memory` in docs/architecture/ownership.md; memory.* is gated on this key."],
    ["business-outcomes-and-personas", "pass", "Every seat reads; memory.note.read_sensitive is held separately, which is the distinction a successor's handover actually turns on."],
    ["canonical-objects-and-invariants", "pass", "MemoryRecord and Document in apps/web/prisma/schema.prisma, both carrying a sensitivity."],
    ["state-machines-and-effective-dating", "gap", "A card exists or it does not.", "No review or supersession state, so a card that has gone stale is indistinguishable from one that is current — which is the failure mode of institutional memory."],
    ["commands-events-and-idempotency", "gap", "The manifest declares it consumes ApprovalDecided so a decision becomes part of the record.", "Nothing delivers that event yet: dispatchOnce takes a `deliver` port and no runner supplies one, so the consumption is declared and not running."],
    ["authorization-privacy-and-sod", "pass", "canSeeMemoryCard in apps/web/src/lib/memory.ts, proven by memory.test.ts, gates the sensitive tier separately."],
    ["configuration-inheritance-and-terminology", "pass", "Card categories and the office's name resolve through the configuration registry."],
    ["accounting-controls-and-reconciliation", "not-applicable", "A knowledge card records no money."],
    ["ux-routes-forms-and-accessibility", "pass", "Reached at apps/web/src/app/(app)/orgs/[slug]/memory; no top-level nav entry, deliberately."],
    ["external-integrations-and-failure", "gap", "Documents are stored through apps/web/src/lib/s3.ts.", "No declared failure behaviour when object storage is unavailable, and no integrity check that a stored object still matches its row."],
    ["migration-cutover-and-data-quality", "gap", NO_CUTOVER, "No bulk import of an existing knowledge base, and no staleness measure."],
    ["search-analytics-and-memory", "pass", "apps/web/src/lib/search-data.ts indexes memory records under this module's own visibility rule."],
    ["relay-boundaries-and-evaluations", "gap", NO_RELAY_POLICY, "Nothing states whether Relay may retrieve a sensitive card, which is the one place the answer must not be a default."],
    ["localization-legal-and-certification", "gap", NO_LEGAL_SCOPE, "No declared retention schedule, which is what a records-management review asks for first."],
    ["observability-slo-and-finops", "gap", NO_RUNBOOK, "No SLO, and no measure of how much of the corpus has gone stale."],
    ["upgrade-rollback-and-deprecation", "pass", RELEASE_LIFECYCLE],
    ["test-and-certification-evidence", "pass", "apps/web/src/lib/memory.test.ts covers the sensitivity tiers."],
  ]),
  permissions: ["memory.note.create", "memory.note.read", "memory.note.read_sensitive"],
  // The last step of `request-to-approval-to-memory`: what a decision was and
  // why is the institutional record a successor needs, and it belongs to the
  // module whose whole purpose is outliving the officers who made it.
  //
  // Honest about what this does and does not buy today. Declaring it is what
  // makes a system composed WITHOUT this module refuse — `validateSystem` will
  // not release an approvals-without-memory system, because the process would
  // accept requests it can never finish recording. It does not by itself
  // deliver the event: `dispatchOnce` takes a `deliver` port and no runner
  // supplies one yet, so nothing consumes `ApprovalDecided` at runtime. That
  // runner is the next piece, and it will be held to this declaration rather
  // than inventing its own list.
  consumes: ["ApprovalDecided"],
}

const budgeting: ModuleManifest = {
  key: "budgeting",
  version: "1.0.0",
  name: "Budgeting",
  description: "Budgets, lines, actuals and the portfolio roll-up across organizations.",
  owner: "erp-modules",
  objects: ["Budget", "BudgetLine", "Transaction", "Vendor", "LedgerEntry"],
  lifecycle: "certified-limited",
  mode: "TENURE_NATIVE",
  requiresEngine: ENGINE,
  dependsOn: [needs("organizations")],
  // The capability, separate from the module that happens to supply it today.
  // `reimbursements` needs a ledger to post to; it does not need *this* module,
  // and the day a second ledger ships it satisfies the same dependency without
  // an edit to reimbursements.
  provides: ["finance.ledger"],
  requiresEntitlement: "finance",
  // Ordered, lowest first — position is the rank `decide()` compares against a
  // role template's `minTier`. `finance.approver` requires "ledger", so a tenant
  // on "budget" may read a budget and may not put one into force.
  tiers: ["budget", "ledger", "consolidation"],
  ...assess([
    ["authority-and-domain-boundary", "pass", "Owned by `erp-modules` in docs/architecture/ownership.md; finance.budget.*, finance.ledger.* and finance.report.* are gated on this key."],
    ["business-outcomes-and-personas", "pass", "finance.officer proposes, finance.approver puts into force, oversight.staff reads across units — packages/authorization/src/role-templates.ts."],
    ["canonical-objects-and-invariants", "pass", "Budget, BudgetLine, Transaction, Vendor and LedgerEntry in apps/web/prisma/schema.prisma; money is integer cents throughout — packages/platform-config/src/money.ts."],
    ["state-machines-and-effective-dating", "pass", "A budget is proposed, approved and superseded by academic year; apps/web/src/lib/finance.ts is the only writer."],
    ["commands-events-and-idempotency", "gap", "A ledger entry is posted inside the approval transaction that authorised it.", "No idempotency key on a posting, so a retried approval can post twice, and no BudgetApproved or LedgerPosted event is published."],
    ["authorization-privacy-and-sod", "pass", "packages/authorization/src/controls.ts refuses any template that can both raise and approve spend, and finance.approver deliberately cannot file a claim."],
    ["configuration-inheritance-and-terminology", "pass", "Currency, money format and category vocabulary resolve per tenant through the configuration registry."],
    ["accounting-controls-and-reconciliation", "gap", "Every posting names the approval that caused it, and money is integer cents end to end.", "Nothing reconciles the ledger against a bank statement, a card feed or any external record, and there is no period close or trial balance — the ledger is internally consistent and externally unverified."],
    ["ux-routes-forms-and-accessibility", "pass", "apps/web/src/app/(app)/reports/page.tsx and the per-organization finance surfaces; charts use the colour-vision-safe palette."],
    ["external-integrations-and-failure", "gap", "Exports are produced in process — finance.ledger.export and finance.report.export.", "No accounting-system connector at all, so the reconciliation gap above cannot be closed by an integration either."],
    ["migration-cutover-and-data-quality", "gap", NO_CUTOVER, "No opening-balance import, which is the first thing a finance cutover needs."],
    ["search-analytics-and-memory", "gap", "The portfolio roll-up aggregates across organizations.", "Ledger entries are not in the search corpus, so 'what did we spend on catering' is answerable only from the reports surface."],
    ["relay-boundaries-and-evaluations", "gap", NO_RELAY_POLICY, "No declared limit on what Relay may retrieve from financial records."],
    ["localization-legal-and-certification", "gap", NO_LEGAL_SCOPE, "No tax treatment, no statutory chart of accounts and no audit certification is claimed for any jurisdiction."],
    ["observability-slo-and-finops", "gap", NO_RUNBOOK, "No SLO on the reports surface and no alert on a failed posting."],
    ["upgrade-rollback-and-deprecation", "pass", RELEASE_LIFECYCLE],
    ["test-and-certification-evidence", "pass", "apps/web/src/lib/finance.test.ts and the money-handling suite in packages/platform-config."],
  ]),
  // The portfolio roll-up consolidates every organization's spend into one
  // view, and a view like that presumes somebody consolidates. Under a
  // `decentralized` operating model each unit keeps its own books and answers
  // to nobody for them, so the roll-up would be a page of numbers with no owner
  // and no authority behind the approval it invites. Refused there, with that
  // reason, rather than shipped as a screen that quietly means nothing.
  requiresOperatingModel: ["centralized", "federated", "matrix", "shared-services"],
  permissions: ["finance.budget.read", "finance.budget.propose", "finance.budget.approve", "finance.budget.update", "finance.ledger.read", "finance.ledger.post", "finance.ledger.export", "finance.report.read", "finance.report.export"],
  navigation: [
    {
      id: "budgeting.reports",
      label: "Reports",
      href: "/reports",
      section: "Overview",
      sectionOrder: 10,
      order: 20,
      icon: "BarChart3",
      requiresCapability: "finance.report.read",
    },
  ],
}

const reimbursements: ModuleManifest = {
  key: "reimbursements",
  version: "1.0.0",
  name: "Reimbursements",
  description: "Three-way matched reimbursement claims that post to the ledger on approval.",
  owner: "erp-modules",
  lifecycle: "certified-limited",
  mode: "TENURE_NATIVE",
  requiresEngine: ENGINE,
  dependsOn: [
    needs("organizations"),
    needs("approvals"),
    // The capability, not the module. What a claim needs is somewhere to post;
    // `budgeting` is what provides that today.
    needs("finance.ledger"),
  ],
  requiresEntitlement: "finance",
  ...assess([
    ["authority-and-domain-boundary", "pass", "Owned by `erp-modules` in docs/architecture/ownership.md; finance.reimbursement.* is gated on this key."],
    ["business-outcomes-and-personas", "pass", "Any member may file — unit.member carries finance.reimbursement.create; finance.approver approves and deliberately cannot file."],
    ["canonical-objects-and-invariants", "gap", "A claim is an ApprovalRequest carrying a reimbursement payload, matched against a BudgetLine and a Document.", "It owns no model of its own, so the three-way match is an invariant of a JSON payload rather than of a table — nothing at the database level stops a claim without a receipt."],
    ["state-machines-and-effective-dating", "pass", "The claim rides the approvals gate machine in packages/workflow rather than carrying a second one."],
    ["commands-events-and-idempotency", "gap", "Submission and the posting it eventually causes are two transactions.", "No idempotency key on submission, so a double-submitted claim is two claims against one receipt."],
    ["authorization-privacy-and-sod", "pass", "apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts asks decideFromSeats for every filing, and the requester never sits on their own gate."],
    ["configuration-inheritance-and-terminology", "pass", "Thresholds and currency resolve through the configuration registry."],
    ["accounting-controls-and-reconciliation", "gap", "Approval posts a SPEND entry linked to the request and its receipt — the three-way match.", "Nothing reconciles a posted claim against an actual payment: the platform records that money was owed, never that it was paid."],
    ["ux-routes-forms-and-accessibility", "pass", "Filed from apps/web/src/app/(app)/orgs/[slug]/finance with the shared form primitives."],
    ["external-integrations-and-failure", "gap", "Receipts are stored through apps/web/src/lib/s3.ts.", "No payment rail, card feed or payroll connector, so the last mile of a reimbursement happens outside Tenure with no record here."],
    ["migration-cutover-and-data-quality", "gap", NO_CUTOVER, "No import of in-flight claims from an incumbent process."],
    ["search-analytics-and-memory", "pass", "Claims are searchable as approvals through apps/web/src/lib/search-data.ts."],
    ["relay-boundaries-and-evaluations", "gap", NO_RELAY_POLICY, "No declared limit on what Relay may retrieve from a claim or its receipt."],
    ["localization-legal-and-certification", "gap", NO_LEGAL_SCOPE, "No tax treatment of reimbursements and no per-jurisdiction receipt requirement."],
    ["observability-slo-and-finops", "gap", NO_RUNBOOK, "No SLO on time-to-reimbursement, which is the number a claimant actually cares about."],
    ["upgrade-rollback-and-deprecation", "pass", RELEASE_LIFECYCLE],
    ["test-and-certification-evidence", "pass", "apps/web/src/lib/authz/seat-world.test.ts covers who may file and why each refusal is which refusal."],
  ]),
  permissions: ["finance.reimbursement.create", "finance.reimbursement.read", "finance.reimbursement.approve"],
}

const dashboard: ModuleManifest = {
  key: "dashboard",
  version: "1.0.0",
  name: "Dashboard",
  description: "The landing surface. Always on; every system has a front door.",
  owner: "reporting",
  lifecycle: "certified-limited",
  mode: "TENURE_NATIVE",
  requiresEngine: ENGINE,
  ...assess([
    ["authority-and-domain-boundary", "pass", "Owned by `reporting` in docs/architecture/ownership.md; dashboard.summary.read is gated on this key."],
    ["business-outcomes-and-personas", "pass", "Every shipped template carries dashboard.summary.read — it is the surface everybody lands on."],
    ["canonical-objects-and-invariants", "not-applicable", "The dashboard stores nothing; it summarises other modules' records."],
    ["state-machines-and-effective-dating", "not-applicable", "A summary has no state."],
    ["commands-events-and-idempotency", "not-applicable", "Read-only; there is no command to make idempotent."],
    ["authorization-privacy-and-sod", "pass", "Each tile re-derives its own answer through the owning module's scoping rather than trusting the page."],
    ["configuration-inheritance-and-terminology", "pass", "Every word on it resolves through terminologyFor and its colours through brandingFor."],
    ["accounting-controls-and-reconciliation", "not-applicable", "It records no money."],
    ["ux-routes-forms-and-accessibility", "pass", "apps/web/src/app/(app)/dashboard/page.tsx, the skip link and the hardened frame in apps/web/src/components/shell."],
    ["external-integrations-and-failure", "not-applicable", "No outbound connection."],
    ["migration-cutover-and-data-quality", "not-applicable", "Nothing stored, so nothing to migrate."],
    ["search-analytics-and-memory", "gap", "It summarises; it does not retrieve.", "No saved views and no drill-through from a tile to the records behind it."],
    ["relay-boundaries-and-evaluations", "gap", NO_RELAY_POLICY, "Nothing states whether Relay may read a tenant's summary tiles."],
    ["localization-legal-and-certification", "gap", NO_LEGAL_SCOPE, "No declared jurisdiction scope."],
    ["observability-slo-and-finops", "gap", NO_RUNBOOK, "No SLO on the front door, which is the one surface every session hits."],
    ["upgrade-rollback-and-deprecation", "pass", RELEASE_LIFECYCLE],
    ["test-and-certification-evidence", "gap", "Covered by the end-to-end suite under apps/web/e2e.", "No unit test names the tile rules, so a tile showing another tenant's number would be caught only end to end."],
  ]),
  navigation: [
    {
      id: "dashboard.home",
      label: "Dashboard",
      href: "/dashboard",
      section: "Overview",
      sectionOrder: 10,
      order: 10,
      icon: "LayoutDashboard",
    },
  ],
}

const administration: ModuleManifest = {
  key: "administration",
  version: "1.0.0",
  name: "Administration",
  description: "The staff office's console: people, organizations, overrides and the audit trail.",
  owner: "reporting",
  objects: ["AuditEvent"],
  lifecycle: "certified-limited",
  mode: "TENURE_NATIVE",
  requiresEngine: ENGINE,
  dependsOn: [needs("organizations")],
  ...assess([
    ["authority-and-domain-boundary", "pass", "Owned by `reporting` in docs/architecture/ownership.md; admin.* is gated on this key."],
    ["business-outcomes-and-personas", "pass", "institution.director and oversight.staff hold admin.console.read; platform.administrator holds admin.override.execute — three distinct answers."],
    ["canonical-objects-and-invariants", "pass", "AuditEvent in apps/web/prisma/schema.prisma; apps/web/src/lib/audit-append-only.ts refuses an update or a delete."],
    ["state-machines-and-effective-dating", "not-applicable", "An audit record is a fact, not a lifecycle."],
    ["commands-events-and-idempotency", "pass", "apps/web/src/lib/audit-record.ts writes the record in the transaction that caused it, so an action and its evidence cannot disagree."],
    ["authorization-privacy-and-sod", "pass", "admin.override.execute is split from admin.console.read, and identity administration is a separate template by the duties matrix."],
    ["configuration-inheritance-and-terminology", "pass", "The console's labels resolve through terminologyFor."],
    ["accounting-controls-and-reconciliation", "not-applicable", "The console records no money."],
    ["ux-routes-forms-and-accessibility", "pass", "apps/web/src/app/(app)/admin/page.tsx, guarded independently in apps/web/src/lib/admin/guard.ts."],
    ["external-integrations-and-failure", "not-applicable", "No outbound connection; the audit trail is Tenure's own record."],
    ["migration-cutover-and-data-quality", "gap", NO_CUTOVER, "No import of a prior audit history, so an adopted tenant's trail starts at adoption with nothing saying so."],
    ["search-analytics-and-memory", "gap", "The console lists and filters the trail.", "The audit trail is not in the search corpus, and there is no retention policy or export-for-review path."],
    ["relay-boundaries-and-evaluations", "gap", NO_RELAY_POLICY, "Nothing states whether Relay may read the audit trail, which is the one corpus that must not be summarised loosely."],
    ["localization-legal-and-certification", "gap", NO_LEGAL_SCOPE, "No declared retention period for audit records, which is a regulatory answer rather than a product one."],
    ["observability-slo-and-finops", "gap", NO_RUNBOOK, "No alert when an audit write fails, which would make the trail quietly incomplete."],
    ["upgrade-rollback-and-deprecation", "pass", RELEASE_LIFECYCLE],
    ["test-and-certification-evidence", "pass", "apps/web/src/lib/audit-append-only.test.ts and audit-record.test.ts."],
  ]),
  permissions: ["admin.console.read", "admin.override.execute"],
  navigation: [
    {
      id: "administration.console",
      label: "Admin Console",
      href: "/admin",
      section: "Administration",
      sectionOrder: 5,
      order: 10,
      icon: "ShieldCheck",
      requiresCapability: "admin.console.read",
    },
  ],
}

export const MODULES: readonly ModuleManifest[] = [
  dashboard,
  organizations,
  feed,
  messaging,
  approvals,
  events,
  resources,
  search,
  memory,
  budgeting,
  reimbursements,
  administration,
]

/**
 * The business processes that cross these modules.
 *
 * One chain, and it is the one this platform actually runs: somebody raises a
 * request, a gate decides it, and what was decided becomes part of the
 * organization's record. It spans two modules, which is exactly why it needed
 * declaring — neither `approvals` nor `memory` owns it, so before this nothing
 * refused a system that had the first half and not the second. A blueprint
 * selecting `approvals` without `memory` would have released cleanly and then
 * accepted requests whose outcome nothing preserves.
 *
 * Declared here rather than in a module manifest because a chain has no single
 * owner. Put it on the module that starts it and the last step's module can be
 * removed without the declaring module noticing, which is the failure this is
 * meant to catch.
 *
 * `ModuleCatalog.of` checks it against the manifests — every step's module must
 * exist and must itself declare the event the step says it emits or consumes —
 * and `validateSystem` checks it against a release: a system that enables one
 * step's module and not another's is refused, naming the chain and the missing
 * step.
 */
export const PROCESS_CHAINS: readonly ProcessChain[] = [
  {
    chainId: "request-to-approval-to-memory",
    name: "Request → approval → memory",
    steps: [
      { module: "approvals", consumes: null, emits: "ApprovalRequested" },
      { module: "approvals", consumes: "ApprovalRequested", emits: "ApprovalDecided" },
      { module: "memory", consumes: "ApprovalDecided", emits: null },
    ],
  },
]

/** Built once. Validates every manifest and every cross-reference between them. */
export const MODULE_CATALOG = ModuleCatalog.of(MODULES, PROCESS_CHAINS)
