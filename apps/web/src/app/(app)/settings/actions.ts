"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { storageConfigured, uploadDocument } from "@/lib/s3"

async function requireUserId() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")
  return session.user.id
}

function bumpProfile() {
  revalidatePath("/settings")
  revalidatePath("/dashboard")
}

export async function updateProfile(formData: FormData) {
  const userId = await requireUserId()
  const name = String(formData.get("name") ?? "").trim()
  if (!name || name.length > 120) throw new Error("Enter a display name (max 120 chars)")
  await db.user.update({ where: { id: userId }, data: { name } })
  bumpProfile()
}

/** Set the profile picture to an external image URL (works without storage). */
export async function setProfileImageUrl(formData: FormData) {
  const userId = await requireUserId()
  const url = String(formData.get("imageUrl") ?? "").trim()
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
  await db.user.update({ where: { id: userId }, data: { image: url, imageKey: null } })
  bumpProfile()
}

/** Upload a profile picture to object storage; the /api/profile-image proxy serves it. */
export async function uploadProfileImage(formData: FormData) {
  const userId = await requireUserId()
  if (!storageConfigured())
    throw new Error("File uploads are not configured — paste an image URL instead")
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image file")
  if (!file.type.startsWith("image/")) throw new Error("That file is not an image")
  if (file.size > 5 * 1024 * 1024) throw new Error("Images must be under 5 MB")

  const ext = (file.name.split(".").pop() || "img").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5)
  const key = `profile-images/${userId}/${Date.now()}.${ext}`
  await uploadDocument(key, Buffer.from(await file.arrayBuffer()), file.type)
  await db.user.update({
    where: { id: userId },
    data: { imageKey: key, image: `/api/profile-image/${userId}?v=${Date.now()}` },
  })
  bumpProfile()
}

export async function removeProfileImage() {
  const userId = await requireUserId()
  await db.user.update({ where: { id: userId }, data: { image: null, imageKey: null } })
  bumpProfile()
}

// ── Approval delegation (name a backup who can act on your gate) ──────────────

/** The institution + eligible-backup scope for the current user's gate authority. */
async function delegationScope(userId: string) {
  const ctx = await getUserContext(userId)
  const isOse = ctx.institutionRoles.length > 0
  const presidentOrgIds = ctx.orgRoles
    .filter((r) => r.scope === "PRESIDENT" && r.status === "ACTIVE")
    .map((r) => r.organizationId)
  let institutionId: string | undefined = ctx.institutionRoles[0]?.institutionId
  if (!institutionId && presidentOrgIds.length) {
    const org = await db.organization.findFirst({
      where: { id: presidentOrgIds[0] },
      select: { institutionId: true },
    })
    institutionId = org?.institutionId
  }
  return { isOse, presidentOrgIds, institutionId, canDelegate: isOse || presidentOrgIds.length > 0 }
}

/** Eligibility filter for who may be a given user's backup approver. */
function eligibleBackupWhere(scope: { isOse: boolean; presidentOrgIds: string[]; institutionId?: string }) {
  const or: object[] = []
  if (scope.isOse && scope.institutionId)
    or.push({ institutionMembership: { some: { institutionId: scope.institutionId } } })
  if (scope.presidentOrgIds.length)
    or.push({
      roleAssignments: { some: { status: "ACTIVE", role: { organizationId: { in: scope.presidentOrgIds } } } },
    })
  return or
}

export async function setDelegation(formData: FormData) {
  const userId = await requireUserId()
  const toUserId = String(formData.get("toUserId") ?? "")
  if (!toUserId || toUserId === userId) throw new Error("Pick a different person as your backup")
  const note = String(formData.get("note") ?? "").trim() || null

  const scope = await delegationScope(userId)
  if (!scope.canDelegate) throw new Error("Only a president or OSE member can name a backup approver")
  if (!scope.institutionId) throw new Error("Could not resolve your institution")
  const institutionId = scope.institutionId // narrowed to string before any await

  const eligible = await db.user.findFirst({
    where: { id: toUserId, OR: eligibleBackupWhere(scope) },
    select: { id: true },
  })
  if (!eligible) throw new Error("That person isn't eligible to be your backup")

  await db.$transaction([
    // One active delegation at a time — retire any prior grant first.
    db.approvalDelegation.updateMany({
      where: { fromUserId: userId, revokedAt: null, institutionId },
      data: { revokedAt: new Date() },
    }),
    db.approvalDelegation.create({ data: { institutionId, fromUserId: userId, toUserId, note } }),
    db.auditEvent.create({
      data: {
        institutionId,
        actorId: userId,
        action: "Delegation.Set",
        resourceType: "ApprovalDelegation",
        outcome: "ALLOW",
        metadata: { toUserId },
      },
    }),
  ])
  revalidatePath("/settings")
}

export async function revokeDelegation(formData: FormData) {
  const userId = await requireUserId()
  const id = String(formData.get("id") ?? "")
  const del = await db.approvalDelegation.findFirst({
    where: { id, fromUserId: userId, revokedAt: null },
    select: { id: true, institutionId: true },
  })
  if (!del) return
  await db.$transaction([
    db.approvalDelegation.update({ where: { id: del.id }, data: { revokedAt: new Date() } }),
    db.auditEvent.create({
      data: {
        institutionId: del.institutionId,
        actorId: userId,
        action: "Delegation.Revoked",
        resourceType: "ApprovalDelegation",
        resourceId: del.id,
        outcome: "ALLOW",
      },
    }),
  ])
  revalidatePath("/settings")
}
