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
  // The acknowledgement side of the same events. A consumer that could read
  // another tenant's inbox could tell whether that tenant's event had been
  // processed, and — worse — a dedupe check that spanned tenants would let one
  // institution's already-consumed event suppress another's.
  "InboxEvent",
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
  // PAY-030-007. LedgerEntry moved up from UNENFORCEABLE: it carries its own
  // `institutionId` now, backfilled from Organization, so the chokepoint can
  // filter it directly instead of hoping the caller joined.
  "LedgerEntry",
  // PAY-230-004. One slice of an inbound receipt.
  "ReceiptAllocation",
  // PAY-150-003. Standing declarations the approval gate reads. Scoped like the
  // decisions they constrain: a recusal readable across tenants would let one
  // institution see who has stood down from what in another.
  "ConflictDeclaration",
  // WRK-030-002. A connection opportunity and its single-use launch token.
  // Scoped because the row carries what a person was trying to do when a
  // capability blocked them: readable across tenants it would let one
  // institution enumerate another's members and their questions, and
  // REDEEMABLE across tenants it would restore one tenant's intent inside
  // another's scope. `redeemConnectionLaunchToken` refuses a cross-tenant
  // redemption explicitly (WRONG_TENANT) rather than relying on the predicate
  // alone, because the two answer different questions — the predicate hides the
  // row, the refusal names why.
  "ConnectionLaunchToken",
  "Recusal",
  // PAY-020-004 / PAY-080-004 / PAY-130-004. The payments objects. Every one of
  // them names a tenant, and the reason they must be scoped is sharper than
  // usual: a provider id, a payout figure and a balance transaction are the
  // most directly sensitive rows on the platform, and their UNIQUE keys are
  // deliberately NOT tenant-first — (provider, mode, account, externalId) is
  // global by design — so the index cannot be what keeps one tenant out of
  // another's reads. The chokepoint has to.
  "ExternalReference",
  "Settlement",
  "ProviderBalanceTransaction",
  // PAY-270-002. Which charge model applies to a club, and who is liable for
  // the money under it. Read across tenants it exposes commercial terms;
  // written across tenants it redirects who pays.
  "PaymentsFundsFlowConfig",
  // WRK-120-004. One row per model call, with the tokens the vendor reported.
  // Scoped for two reasons that both matter: read across tenants it is a usage
  // profile of another institution's assistant, and SUMMED across tenants it is
  // the wrong number — `budgetVerdict` would compare one tenant's allowance
  // against the whole platform's spend and refuse everybody.
  "ModelUsageMeter",
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
  // PAY-000-007. The webhook dedupe table, and global for a real reason rather
  // than an omission: a provider event is written here at the moment it is
  // RECEIVED and verified, which is before anything has attributed it to a
  // tenant — attribution is what the connected `accountId` is later used to do.
  // Its uniqueness is (provider, mode, accountId, eventId), deliberately not
  // tenant-first, because the property it enforces is "this platform has seen
  // this event once", which is not a per-tenant claim. It carries no
  // institutionId and must not: scoping it would make the same redelivery
  // processable once per tenant, which is the exact bug it exists to stop.
  "ProviderEventReceipt",
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
