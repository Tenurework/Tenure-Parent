"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { canManageOrg, getUserContext, isOseDirector } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { fileRef, storageConfigured, uploadDocument } from "@/lib/s3"
import { sanitizeTenantImage } from "@/lib/uploads/tenant-image"

async function requireUserId() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")
  return session.user.id
}

/** OSE Director: archive or reactivate a club. */
export async function setClubStatus(formData: FormData) {
  const userId = await requireUserId()
  await withTenantScope(userId, async () => {
    const organizationId = String(formData.get("organizationId") ?? "")
    const status = String(formData.get("status") ?? "") as "ACTIVE" | "ARCHIVED"

    const org = await db.organization.findUnique({ where: { id: organizationId } })
    if (!org) throw new Error("Club not found")

    const ctx = await getUserContext(userId)
    if (!isOseDirector(ctx, org.institutionId))
      throw new Error("Only the OSE Director can change club status")
    if (!["ACTIVE", "ARCHIVED"].includes(status)) throw new Error("Invalid status")

    await db.$transaction([
      db.organization.update({ where: { id: org.id }, data: { status } }),
      db.auditEvent.create({
        data: {
          institutionId: org.institutionId,
          organizationId: org.id,
          actorId: userId,
          action: status === "ARCHIVED" ? "Club.Archived" : "Club.Reactivated",
          resourceType: "Organization",
          resourceId: org.id,
          outcome: "ALLOW",
        },
      }),
    ])
  })

  // Outside the scope. `revalidatePath` inside a tenant scope is the same rule
  // `redirect()` breaks more loudly — see `withTenantScope` and
  // tests/architecture/redirect-lives-outside-tenant-scope.test.mjs.
  revalidatePath("/orgs")
}

// ─── Club images ─────────────────────────────────────────────────────────────
// Administrators can set any club's image; club presidents can set their own.

// Reads the club, so it runs inside the caller's tenant scope; the caller has
// already resolved the session and passes the acting user in.
async function requireOrgManager(userId: string, organizationId: string) {
  const org = await db.organization.findUnique({ where: { id: organizationId } })
  if (!org) throw new Error("Club not found")
  const ctx = await getUserContext(userId)
  if (!canManageOrg(ctx, org))
    throw new Error("You do not have permission to edit this club")
  return org
}

/**
 * The three routes a club image appears on.
 *
 * Called after the tenant scope has closed, never inside it: `revalidatePath`
 * belongs outside the body for the same reason `redirect()` does.
 */
function bumpClub(slug: string) {
  revalidatePath("/orgs")
  revalidatePath(`/orgs/${slug}/members`)
  revalidatePath("/admin/clubs")
}

async function auditImage(org: { id: string; institutionId: string }, actorId: string, action: string) {
  await db.auditEvent.create({
    data: {
      institutionId: org.institutionId,
      organizationId: org.id,
      actorId,
      action,
      resourceType: "Organization",
      resourceId: org.id,
      outcome: "ALLOW",
    },
  })
}

/** Point a club's image at an external URL (works without object storage). */
export async function setOrgImageUrl(formData: FormData) {
  const userId = await requireUserId()
  const slug = await withTenantScope(userId, async () => {
    const organizationId = String(formData.get("organizationId") ?? "")
    const url = String(formData.get("imageUrl") ?? "").trim()
    const org = await requireOrgManager(userId, organizationId)

    if (!url) throw new Error("Enter an image URL")
    if (url.length > 2048) throw new Error("That URL is too long")
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error("Enter a valid image URL")
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      throw new Error("Image URL must start with http(s)://")

    await db.organization.update({
      where: { id: org.id },
      data: { logoUrl: url, imageKey: null },
    })
    await auditImage(org, userId, "Club.ImageSet")
    return org.slug
  })

  bumpClub(slug)
}

/** Upload a club image to object storage; the /api/org-image proxy serves it. */
export async function uploadOrgImage(formData: FormData) {
  const userId = await requireUserId()
  const slug = await withTenantScope(userId, async () => {
    const organizationId = String(formData.get("organizationId") ?? "")
    const org = await requireOrgManager(userId, organizationId)

    if (!storageConfigured())
      throw new Error("File uploads are not configured — paste an image URL instead")

    const file = formData.get("file")
    if (!(file instanceof File)) throw new Error("Choose an image file")

    // GE-143-007. The format is decided by the BYTES. `file.type` and the file
    // name are both claims by the client, and this object is stored with the
    // content type it is served back with — so an SVG admitted here is a
    // document served inline from the platform's own storage.
    const buffer = Buffer.from(await file.arrayBuffer())
    const verdict = sanitizeTenantImage({ bytes: buffer, declaredType: file.type || undefined })
    if (verdict.refused) throw new Error(verdict.refused.explanation)

    // Tenant-prefixed, which it was not: the key used to begin `org-images/`,
    // so nothing about it said which institution's bucket space it belonged in
    // and `parseFileRef` refuses it outright. Existing images are unaffected —
    // reads use the key stored on the row, and only new uploads are minted
    // here. The extension comes from the sniffed format, never from the name.
    const key = `${org.institutionId}/org-images/${org.id}/${Date.now()}.${verdict.accepted.extension}`
    await uploadDocument(
      fileRef({
        tenantId: org.institutionId,
        objectKey: key,
        mimeType: verdict.accepted.mimeType,
        body: buffer,
      }),
      buffer,
    )

    await db.organization.update({
      where: { id: org.id },
      // Cache-bust the proxy URL so the new image shows immediately.
      data: { imageKey: key, logoUrl: `/api/org-image/${org.id}?v=${Date.now()}` },
    })
    await auditImage(org, userId, "Club.ImageUploaded")
    return org.slug
  })

  bumpClub(slug)
}

/** Remove a club's image, reverting to the generated monogram. */
export async function removeOrgImage(formData: FormData) {
  const userId = await requireUserId()
  const slug = await withTenantScope(userId, async () => {
    const organizationId = String(formData.get("organizationId") ?? "")
    const org = await requireOrgManager(userId, organizationId)
    await db.organization.update({
      where: { id: org.id },
      data: { logoUrl: null, imageKey: null },
    })
    await auditImage(org, userId, "Club.ImageRemoved")
    return org.slug
  })

  bumpClub(slug)
}
