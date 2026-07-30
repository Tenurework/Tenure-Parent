"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { canManageOrg, getUserContext, isOseDirector } from "@/lib/rbac"
import { storageConfigured, uploadDocument } from "@/lib/s3"

/** OSE Director: archive or reactivate a club. */
export async function setClubStatus(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")

  const organizationId = String(formData.get("organizationId") ?? "")
  const status = String(formData.get("status") ?? "") as "ACTIVE" | "ARCHIVED"

  const org = await db.organization.findUnique({ where: { id: organizationId } })
  if (!org) throw new Error("Club not found")

  const ctx = await getUserContext(session.user.id)
  if (!isOseDirector(ctx, org.institutionId))
    throw new Error("Only the OSE Director can change club status")
  if (!["ACTIVE", "ARCHIVED"].includes(status)) throw new Error("Invalid status")

  await db.$transaction([
    db.organization.update({ where: { id: org.id }, data: { status } }),
    db.auditEvent.create({
      data: {
        institutionId: org.institutionId,
        organizationId: org.id,
        actorId: session.user.id,
        action: status === "ARCHIVED" ? "Club.Archived" : "Club.Reactivated",
        resourceType: "Organization",
        resourceId: org.id,
        outcome: "ALLOW",
      },
    }),
  ])

  revalidatePath("/orgs")
}

// ─── Club images ─────────────────────────────────────────────────────────────
// Administrators can set any club's image; club presidents can set their own.

async function requireOrgManager(organizationId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")
  const org = await db.organization.findUnique({ where: { id: organizationId } })
  if (!org) throw new Error("Club not found")
  const ctx = await getUserContext(session.user.id)
  if (!canManageOrg(ctx, org))
    throw new Error("You do not have permission to edit this club")
  return { org, userId: session.user.id }
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
  const organizationId = String(formData.get("organizationId") ?? "")
  const url = String(formData.get("imageUrl") ?? "").trim()
  const { org, userId } = await requireOrgManager(organizationId)

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
  revalidatePath("/orgs")
  revalidatePath(`/orgs/${org.slug}/members`)
  revalidatePath("/admin/clubs")
}

/** Upload a club image to object storage; the /api/org-image proxy serves it. */
export async function uploadOrgImage(formData: FormData) {
  const organizationId = String(formData.get("organizationId") ?? "")
  const { org, userId } = await requireOrgManager(organizationId)

  if (!storageConfigured())
    throw new Error("File uploads are not configured — paste an image URL instead")

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image file")
  if (!file.type.startsWith("image/")) throw new Error("That file is not an image")
  if (file.size > 5 * 1024 * 1024) throw new Error("Images must be under 5 MB")

  const ext = (file.name.split(".").pop() || "img").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5)
  const key = `org-images/${org.id}/${Date.now()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  await uploadDocument(key, buffer, file.type)

  await db.organization.update({
    where: { id: org.id },
    // Cache-bust the proxy URL so the new image shows immediately.
    data: { imageKey: key, logoUrl: `/api/org-image/${org.id}?v=${Date.now()}` },
  })
  await auditImage(org, userId, "Club.ImageUploaded")
  revalidatePath("/orgs")
  revalidatePath(`/orgs/${org.slug}/members`)
  revalidatePath("/admin/clubs")
}

/** Remove a club's image, reverting to the generated monogram. */
export async function removeOrgImage(formData: FormData) {
  const organizationId = String(formData.get("organizationId") ?? "")
  const { org, userId } = await requireOrgManager(organizationId)
  await db.organization.update({
    where: { id: org.id },
    data: { logoUrl: null, imageKey: null },
  })
  await auditImage(org, userId, "Club.ImageRemoved")
  revalidatePath("/orgs")
  revalidatePath(`/orgs/${org.slug}/members`)
  revalidatePath("/admin/clubs")
}
