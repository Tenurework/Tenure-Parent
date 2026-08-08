import "server-only"
import { createHash } from "node:crypto"

import { db } from "@/lib/db"
import { paymentModeForInstitution } from "@/lib/config/server"
import { runInTenantScope } from "@/lib/tenancy/context"
import { TENANT_SCOPED, UNENFORCEABLE } from "@/lib/tenancy/registry"

/**
 * Everything one tenant owns, as data they can take with them.
 *
 * Required by the platform's own definition of done, and by every conversation
 * about offboarding: a customer who cannot get their data out is a customer who
 * cannot leave, and a platform that cannot answer "what do you hold about us?"
 * cannot answer a privacy request either.
 *
 * Three things this deliberately does, each because the obvious version is
 * wrong in a way that only shows up later:
 *
 * **It runs inside a tenant scope.** Not "adds a where clause" — opens the
 * chokepoint, so the extension supplies the predicate for the 15 models it can
 * enforce on. An export written as sixty hand-rolled `where: { institutionId }`
 * clauses is sixty chances to omit one, and the omission produces another
 * tenant's rows inside a file that is about to be handed to a customer. That is
 * the worst possible place for a leak.
 *
 * **It reports what it could not export.** 24 of 39 models carry no tenant
 * column (`UNENFORCEABLE` in the registry), so a scope does not filter them and
 * this cannot honestly export them by scope alone. They are listed as gaps with
 * the relation they would have to be reached through, rather than silently
 * omitted — an export that quietly excludes a table looks identical to one
 * where the table was empty.
 *
 * **It is checksummed and counted.** An export nobody can verify is a file, not
 * evidence. The digest covers the exported content, so two exports of an
 * unchanged tenant match, and one taken after a change does not.
 */

export interface TenantExportGap {
  model: string
  reason: string
  reachableVia?: string
}

export interface TenantExport {
  tenantId: string
  tenantSlug: string
  exportedAt: string
  /** Model name → rows. Only models the chokepoint can enforce on. */
  data: Record<string, unknown[]>
  counts: Record<string, number>
  totalRows: number
  /** Models deliberately not exported, and why. */
  gaps: readonly TenantExportGap[]
  /** Digest over the exported content. */
  checksum: string
}

/**
 * Prisma delegates for the tenant-scoped models, by model name.
 *
 * Written out rather than derived from a string, because `(db as any)[name]`
 * would turn a renamed model into a silent empty section in a customer's export
 * instead of a compile error.
 */
const SCOPED_READERS: Record<(typeof TENANT_SCOPED)[number], () => Promise<unknown[]>> = {
  InstitutionMembership: () => db.institutionMembership.findMany(),
  Organization: () => db.organization.findMany(),
  Deliverable: () => db.deliverable.findMany(),
  AuditEvent: () => db.auditEvent.findMany(),
  // Events awaiting or having completed delivery. Included because an export
  // that omitted them would be missing the tenant's own record of what its
  // changes told the rest of the platform — and a dead-lettered row is exactly
  // the thing someone asks about after an incident.
  OutboxEvent: () => db.outboxEvent.findMany(),
  // And what consumed them. Without this half an export says an event was
  // delivered and cannot say to whom, which is the question a redelivery
  // dispute is actually about.
  InboxEvent: () => db.inboxEvent.findMany(),
  RoleTransfer: () => db.roleTransfer.findMany(),
  ApprovalDelegation: () => db.approvalDelegation.findMany(),
  Resource: () => db.resource.findMany(),
  ApprovalRequest: () => db.approvalRequest.findMany(),
  Event: () => db.event.findMany(),
  Conversation: () => db.conversation.findMany(),
  Document: () => db.document.findMany(),
  MemoryRecord: () => db.memoryRecord.findMany(),
  Budget: () => db.budget.findMany(),
  Vendor: () => db.vendor.findMany(),
  FeedPost: () => db.feedPost.findMany(),
  // PAY-030-007 / PAY-230-004. The posted ledger and the allocation of an
  // inbound receipt across club, fund and event. Both gained an
  // `institutionId`, which is what moved them into TENANT_SCOPED and therefore
  // into this table — and an export of an institution's data that omitted its
  // own financial record would be the one omission nobody would accept.
  LedgerEntry: () => db.ledgerEntry.findMany(),
  ReceiptAllocation: () => db.receiptAllocation.findMany(),
  // PAY-150-003. The standing declarations behind a decision. An export that
  // shows an approval was refused and cannot show the recusal that refused it
  // does not answer the question it was requested for.
  ConflictDeclaration: () => db.conflictDeclaration.findMany(),
  Recusal: () => db.recusal.findMany(),
  // PAY-020-004 / PAY-080-004 / PAY-130-004. The payments objects. Exported as
  // stored: `ExternalReference` holds the provider's OWN id, which is a
  // reference to an object in the provider's system rather than a credential
  // for it — no key, no token, nothing that authenticates. The canonical id is
  // Tenure's and belongs to the tenant by definition.
  ExternalReference: () => db.externalReference.findMany(),
  Settlement: () => db.settlement.findMany(),
  ProviderBalanceTransaction: () => db.providerBalanceTransaction.findMany(),
  // WRK-120-004. What this tenant's assistant use cost, call by call. It
  // belongs in an export for the reason the ledger does: it is the record
  // behind an invoice, and a customer disputing a bill after they have left
  // needs the same rows the bill was computed from. It holds no content — a
  // model id and two token counts, never a prompt and never an answer.
  ModelUsageMeter: () => db.modelUsageMeter.findMany(),
  // PAY-270-002. Which charge model each club runs under and who is liable for
  // the money. Commercial terms the tenant agreed to, so they belong in the
  // tenant's own export; it holds no credential — the provider account it names
  // is an identifier, not a key.
  //
  // Its sibling `ProviderEventReceipt` is deliberately NOT here. That table is
  // PLATFORM_GLOBAL: it records that the platform saw a provider event once,
  // before the event is attributed to anybody, and it carries no institutionId
  // to filter on. Exporting it under one tenant would hand that tenant rows
  // about every other.
  PaymentsFundsFlowConfig: () => db.paymentsFundsFlowConfig.findMany(),
  // WRK-030-002. Short-lived, user-bound tokens that launch a connection flow.
  // Tenant-scoped, so it belongs in the tenant's own export — a token readable
  // across tenants would let one institution resume another's connection, which
  // is why the registry classifies it that way and why it is here rather than
  // in PLATFORM_GLOBAL.
  ConnectionLaunchToken: () => db.connectionLaunchToken.findMany(),
}

/** Stable JSON so two exports of unchanged data produce the same digest. */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null"
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`
}

export function checksumOfExport(data: Record<string, unknown[]>): string {
  return `sha256:${createHash("sha256").update(stableStringify(data)).digest("hex")}`
}

export interface ExportOptions {
  /** Supplied so an export is reproducible in a test. */
  at: string
  /** Who asked. Recorded on the artifact. */
  requestedBy: string
}

/**
 * Export one tenant.
 *
 * `institutionId` is the tenant; `slug` is carried for the filename and for a
 * human reading the artifact. The caller is responsible for having established
 * that the requester may do this — this is a platform-operator capability, and
 * the Studio route gates it.
 */
export async function exportTenant(
  institutionId: string,
  tenantSlug: string,
  options: ExportOptions,
): Promise<TenantExport> {
  const scope = {
    institutionId,
    // Bulk extraction of one tenant's own rows. Distinct from `support` (a
    // diagnostic read) and from `model-exposure` (rows that leave for a vendor)
    // because those are the two questions asked of an export after the fact:
    // who read this, and did any of it go anywhere.
    purpose: "export" as const,
    // The tenant's own mode, resolved from its published configuration. An
    // export is evidence of what a tenant held, and evidence that cannot say
    // whether the tenant was live is evidence somebody will read the wrong way.
    environment: await paymentModeForInstitution(institutionId),
    actor: { principalId: options.requestedBy, principalType: "support" as const },
  }

  // Inside the scope, so the extension applies the predicate. Every read below
  // is filtered by the same mechanism the application uses, rather than by
  // sixty hand-written clauses.
  const data = await runInTenantScope(scope, async () => {
    const out: Record<string, unknown[]> = {}
    for (const model of TENANT_SCOPED) {
      out[model] = await SCOPED_READERS[model]()
    }
    return out
  })

  const counts: Record<string, number> = {}
  let totalRows = 0
  for (const [model, rows] of Object.entries(data)) {
    counts[model] = rows.length
    totalRows += rows.length
  }

  const gaps: TenantExportGap[] = Object.entries(UNENFORCEABLE).map(([model, info]) => ({
    model,
    reason:
      "No tenant column, so a tenant scope cannot filter it. Exporting it safely needs a join " +
      "the query layer cannot add, and exporting it unfiltered would put another tenant's rows " +
      "in this file.",
    reachableVia: info.reachableVia,
  }))

  return {
    tenantId: institutionId,
    tenantSlug,
    exportedAt: options.at,
    data,
    counts,
    totalRows,
    gaps,
    checksum: checksumOfExport(data),
  }
}
