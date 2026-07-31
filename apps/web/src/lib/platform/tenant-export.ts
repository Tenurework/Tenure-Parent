import "server-only"
import { createHash } from "node:crypto"

import { db } from "@/lib/db"
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
