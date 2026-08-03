/**
 * Which models the tenant chokepoint can enforce on, and which it cannot.
 *
 * Isolation is currently a convention: there is no middleware, no client
 * extension and no row-level security, so roughly sixty server actions each
 * hand-roll their own tenant check. The gap that matters is not any single
 * missing check — it is that nothing can tell you a check is missing.
 *
 * This registry is that. Every model in schema.prisma must be classified into
 * exactly one bucket below, and registry.test.ts reads schema.prisma and fails
 * if any model is missing or unknown. Adding a model therefore forces a
 * decision about its tenancy at the moment it is added, rather than leaving one
 * to be discovered later by a customer.
 *
 * The three buckets are honest about a real limitation: only 15 of 39 models
 * carry `institutionId`, so only those can be filtered by the query layer
 * today. The rest are named in UNENFORCEABLE rather than quietly omitted.
 */

/**
 * Carries `institutionId`. The query extension injects a tenant predicate on
 * reads and stamps it on writes.
 */
export const TENANT_SCOPED = [
  // An outbox row is a tenant's event awaiting delivery. Scoped like the change
  // that produced it: a dispatcher reading across tenants would be reading every
  // tenant's activity, which is the thing the chokepoint exists to prevent.
  "OutboxEvent",
  // institutionId with a declared relation to Institution
  "InstitutionMembership",
  "Organization",
  "Deliverable",
  "AuditEvent",
  "RoleTransfer",
  "ApprovalDelegation",
  "Resource",
  // institutionId as a bare String, with no foreign key backing it
  "ApprovalRequest",
  "Event",
  "Conversation",
  "Document",
  "MemoryRecord",
  "Budget",
  "Vendor",
  "FeedPost",
] as const

/**
 * Global by design — not owned by any one tenant.
 *
 * `User` is deliberately here: one person holds seats at more than one
 * organization, and the platform model calls for a single global identity with
 * per-tenant membership rather than a duplicated account per institution.
 * Tenant separation for a user's *data* is enforced on the membership and
 * assignment rows that point at them, not on the identity row itself.
 */
export const PLATFORM_GLOBAL = [
  "Institution",
  "User",
  "Account",
  "Session",
  "VerificationToken",
] as const

/**
 * Tenant-owned, but with no column the query layer can filter on.
 *
 * These are the real remaining exposure. They are reachable only through a
 * parent that is itself scoped (an Attachment through its Message, a
 * RoleAssignment through its Role's Organization), so today they are protected
 * by whatever check the calling code happens to perform — which is exactly the
 * situation this registry exists to make visible.
 *
 * `reachableVia` records the relation a future migration would denormalise
 * `institutionId` from. Nothing reads it yet; it is here so the follow-up work
 * is specified rather than rediscovered.
 */
export const UNENFORCEABLE: Record<string, { reachableVia: string; note?: string }> = {
  DirectoryPerson: {
    reachableVia: "(none)",
    note: "No parent at all, and `email` is globally unique. Real students and advisors with contact details. Needs a schema change before a second tenant exists, not a code fix.",
  },
  Attachment: { reachableVia: "Message -> Conversation.institutionId" },
  Message: { reachableVia: "Conversation.institutionId" },
  Participant: { reachableVia: "Conversation.institutionId" },
  Delivery: { reachableVia: "Message -> Conversation.institutionId" },
  ApprovalStep: { reachableVia: "ApprovalRequest.institutionId" },
  ConflictRecord: { reachableVia: "Event.institutionId" },
  Transaction: { reachableVia: "Budget.institutionId" },
  FeedComment: { reachableVia: "FeedPost.institutionId" },
  DeliverableReminder: { reachableVia: "Deliverable.institutionId" },
  SeatHolding: { reachableVia: "Role -> Organization.institutionId" },
  RoleAssignment: { reachableVia: "Role -> Organization.institutionId" },
  Notification: { reachableVia: "User (delivered per-user; no tenant column)" },
  NotificationPreference: { reachableVia: "User (per-user; no tenant column)" },
  // organizationId only — the tenant is one join away
  Role: { reachableVia: "Organization.institutionId" },
  // GE-050-002. A seat is a durable position inside an organization, so it is
  // tenant-owned and reaches its tenant exactly as its Role does — through the
  // Organization. It has no institutionId of its own to filter on, which puts
  // it here rather than in TENANT_SCOPED.
  Seat: { reachableVia: "Organization.institutionId" },
  OrganizationAdvisor: { reachableVia: "Organization.institutionId" },
  BudgetLine: { reachableVia: "Organization.institutionId" },
  LedgerEntry: { reachableVia: "Organization.institutionId" },
  CollabInterest: { reachableVia: "Organization.institutionId" },
}

export type TenantScopedModel = (typeof TENANT_SCOPED)[number]

const tenantScopedSet: ReadonlySet<string> = new Set(TENANT_SCOPED)
const platformSet: ReadonlySet<string> = new Set(PLATFORM_GLOBAL)

export function isTenantScoped(model: string | undefined): model is TenantScopedModel {
  return model !== undefined && tenantScopedSet.has(model)
}

export function isPlatformGlobal(model: string | undefined): boolean {
  return model !== undefined && platformSet.has(model)
}

export function isUnenforceable(model: string | undefined): boolean {
  return model !== undefined && Object.prototype.hasOwnProperty.call(UNENFORCEABLE, model)
}

/** Every model this registry knows about, in one set. */
export function allRegisteredModels(): string[] {
  return [...TENANT_SCOPED, ...PLATFORM_GLOBAL, ...Object.keys(UNENFORCEABLE)]
}
