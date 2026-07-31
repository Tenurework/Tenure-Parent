import "server-only"
import type { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { canManageResources, getUserContext, type UserContext } from "@/lib/rbac"
import { terminologyForInstitution } from "@/lib/config/server"
import { validateResourceForm } from "@/lib/forms/resource-form"
import {
  isSeatKey,
  type Resource,
  type ResourceKind,
  type SeatKey,
} from "@/lib/resources"

/**
 * Data access for the board-resource library.
 *
 * Resources are institution-owned records rather than a hardcoded array, so
 * OSE can publish, correct and retire them without a deploy. Every write goes
 * through `canManageResources` and lands an audit event — the resource board is
 * institution policy, and policy changes have to be attributable.
 */

type Row = {
  id: string
  key: string
  title: string
  description: string
  href: string
  external: boolean
  ready: boolean
  kind: ResourceKind
  seats: string[]
  rule: string | null
  sortOrder: number
}

/** Stored seats are plain strings; drop anything that is no longer a seat. */
function toResource(row: Row): Resource {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    description: row.description,
    href: row.href,
    external: row.external,
    ready: row.ready,
    kind: row.kind,
    seats: row.seats.filter(isSeatKey),
    rule: row.rule,
    sortOrder: row.sortOrder,
  }
}

const SELECT = {
  id: true,
  key: true,
  title: true,
  description: true,
  href: true,
  external: true,
  ready: true,
  kind: true,
  seats: true,
  rule: true,
  sortOrder: true,
} as const

/** Live resources for an institution, in publication order. */
export async function listResources(institutionId: string): Promise<Resource[]> {
  const rows = await db.resource.findMany({
    where: { institutionId, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    select: SELECT,
  })
  return rows.map(toResource)
}

/** Retired resources, for the manage view's restore path. */
export async function listArchivedResources(institutionId: string): Promise<Resource[]> {
  const rows = await db.resource.findMany({
    where: { institutionId, archivedAt: { not: null } },
    orderBy: [{ title: "asc" }],
    select: SELECT,
  })
  return rows.map(toResource)
}

/**
 * The institution a viewer's resource board belongs to: their OSE institution
 * if they have one, otherwise the institution behind their club seats.
 */
export async function resourceInstitutionFor(ctx: UserContext): Promise<string | null> {
  if (ctx.institutionRoles.length > 0) return ctx.institutionRoles[0].institutionId
  const orgIds = [...new Set(ctx.orgRoles.map((r) => r.organizationId))]
  if (orgIds.length === 0) return null
  const org = await db.organization.findFirst({
    where: { id: { in: orgIds } },
    orderBy: { id: "asc" },
    select: { institutionId: true },
  })
  return org?.institutionId ?? null
}

export interface ResourceInput {
  title: string
  description: string
  href: string
  kind: ResourceKind
  seats: SeatKey[]
  rule: string | null
  ready: boolean
}

export type WriteResult = { ok: true; id: string } | { error: string }

/** A URL-ish value: an absolute http(s) URL, or an internal Tenure path. */
function normaliseHref(raw: string): { href: string; external: boolean } | null {
  const href = raw.trim()
  if (!href) return null
  if (href.startsWith("/")) return { href, external: false }
  try {
    const url = new URL(href)
    // Anything but http(s) — javascript:, data:, file: — is an XSS vector on a
    // link the whole institution is told to trust.
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return { href: url.toString(), external: true }
  } catch {
    return null
  }
}

/**
 * Validate a submission against the published form definition.
 *
 * The rules used to be six `if`s here. They are now RESOURCE_FORM, which means
 * a different organization system can require different fields on this form by
 * pinning a different definition rather than by editing this function.
 *
 * Behaviour is unchanged, message for message: resource-form.test.ts holds the
 * original as an oracle and compares the two across every boundary — empty,
 * whitespace-only, exactly at the limit, one past it, each malformed href, and
 * the combinations where two rules could fire and the ORDER decides which
 * message the person sees.
 *
 * `normaliseHref` stays here and is passed in. It accepts an https URL or an
 * internal path AND rewrites it, which makes it a normalising parser rather
 * than a validator; folding it into a field type would either lose the rewrite
 * or duplicate it.
 */
function validate(input: ResourceInput): string | null {
  return validateResourceForm(input, (href) => normaliseHref(href) !== null)
}

/** Slug from a title, uniquified against the institution's existing keys. */
async function nextKey(institutionId: string, title: string): Promise<string> {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "resource"
  const taken = new Set(
    (
      await db.resource.findMany({
        where: { institutionId, key: { startsWith: base } },
        select: { key: true },
      })
    ).map((r) => r.key)
  )
  if (!taken.has(base)) return base
  for (let i = 2; i < 500; i++) {
    if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
  }
  return `${base}-${Date.now()}`
}

async function audit(
  institutionId: string,
  userId: string,
  action: string,
  resourceId: string,
  metadata: Prisma.InputJsonValue
) {
  await db.auditEvent.create({
    data: {
      institutionId,
      actorId: userId,
      actorRole: "OSE",
      action,
      resourceType: "Resource",
      resourceId,
      outcome: "ALLOW",
      metadata,
    },
  })
}

export async function createResource(
  userId: string,
  institutionId: string,
  input: ResourceInput
): Promise<WriteResult> {
  const ctx = await getUserContext(userId)
  if (!canManageResources(ctx, institutionId)) {
    return { error: `Only ${(await terminologyForInstitution(institutionId)).staffOffice} can publish board resources.` }
  }
  const invalid = validate(input)
  if (invalid) return { error: invalid }

  const link = normaliseHref(input.href)!
  const created = await db.resource.create({
    data: {
      institutionId,
      key: await nextKey(institutionId, input.title),
      title: input.title.trim(),
      description: input.description.trim(),
      href: link.href,
      external: link.external,
      ready: input.ready,
      kind: input.kind,
      seats: input.seats,
      rule: input.rule?.trim() || null,
      // New resources land at the end of the board rather than jumping the
      // curated launch content.
      sortOrder:
        ((
          await db.resource.aggregate({
            where: { institutionId },
            _max: { sortOrder: true },
          })
        )._max.sortOrder ?? 0) + 10,
      createdById: userId,
    },
    select: { id: true, title: true },
  })

  await audit(institutionId, userId, "Resource.Published", created.id, {
    title: created.title,
    kind: input.kind,
    seats: input.seats,
  })
  return { ok: true, id: created.id }
}

export async function updateResource(
  userId: string,
  resourceId: string,
  input: ResourceInput
): Promise<WriteResult> {
  const existing = await db.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, institutionId: true },
  })
  if (!existing) return { error: "That resource no longer exists." }

  const ctx = await getUserContext(userId)
  if (!canManageResources(ctx, existing.institutionId)) {
    return {
      error: `Only ${(await terminologyForInstitution(existing.institutionId)).staffOffice} can edit board resources.`,
    }
  }
  const invalid = validate(input)
  if (invalid) return { error: invalid }

  const link = normaliseHref(input.href)!
  await db.resource.update({
    where: { id: resourceId },
    data: {
      title: input.title.trim(),
      description: input.description.trim(),
      href: link.href,
      external: link.external,
      ready: input.ready,
      kind: input.kind,
      seats: input.seats,
      rule: input.rule?.trim() || null,
    },
  })

  await audit(existing.institutionId, userId, "Resource.Edited", resourceId, {
    title: input.title.trim(),
    kind: input.kind,
    seats: input.seats,
  })
  return { ok: true, id: resourceId }
}

/**
 * Retire or restore a resource. Soft delete throughout: a resource that guided
 * a decision last term has to stay auditable, and OSE retires far more often
 * than it deletes (a form comes back every year).
 */
export async function setResourceArchived(
  userId: string,
  resourceId: string,
  archived: boolean
): Promise<WriteResult> {
  const existing = await db.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, institutionId: true, title: true },
  })
  if (!existing) return { error: "That resource no longer exists." }

  const ctx = await getUserContext(userId)
  if (!canManageResources(ctx, existing.institutionId)) {
    return {
      error: `Only ${(await terminologyForInstitution(existing.institutionId)).staffOffice} can retire board resources.`,
    }
  }

  await db.resource.update({
    where: { id: resourceId },
    data: { archivedAt: archived ? new Date() : null },
  })
  await audit(
    existing.institutionId,
    userId,
    archived ? "Resource.Retired" : "Resource.Restored",
    resourceId,
    { title: existing.title }
  )
  return { ok: true, id: resourceId }
}
