"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { fileRef, storageConfigured, uploadDocument } from "@/lib/s3"
import { sanitizeTenantImage } from "@/lib/uploads/tenant-image"

async function requireUserId() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")
  return session.user.id
}

/**
 * The two routes a profile change shows on.
 *
 * Every caller invokes this AFTER its tenant scope has closed — including
 * `uploadProfileImage`, which is the only one that opens a scope at all.
 * `revalidatePath` inside a scope body is the rule stated on `withTenantScope`
 * and enforced by
 * tests/architecture/redirect-lives-outside-tenant-scope.test.mjs.
 */
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

/**
 * Upload a profile picture to object storage; the /api/profile-image proxy
 * serves it.
 *
 * Runs inside the acting tenant's scope, which it did not before. The key used
 * to begin `profile-images/` and belonged to no institution's bucket space —
 * `parseFileRef` refuses that, because a key with no tenant prefix is a key
 * that can address another tenant's object. A person can hold seats at more
 * than one institution and the image is stored under the one they are acting
 * for, which is the same rule every other row this application writes follows.
 * Existing images keep working: reads use the key stored on the user row, and
 * only new uploads are minted here.
 */
export async function uploadProfileImage(formData: FormData) {
  const userId = await requireUserId()
  await withTenantScope(userId, async (scope) => {
    if (!storageConfigured())
      throw new Error("File uploads are not configured — paste an image URL instead")
    const file = formData.get("file")
    if (!(file instanceof File)) throw new Error("Choose an image file")

    // GE-143-007, the same rule as the club logo: the format is decided by the
    // bytes, not by `file.type` or by the file name. An avatar is served back
    // inline with the content type recorded here.
    const bytes = Buffer.from(await file.arrayBuffer())
    const verdict = sanitizeTenantImage({ bytes, declaredType: file.type || undefined })
    if (verdict.refused) throw new Error(verdict.refused.explanation)

    const key = `${scope.institutionId}/profile-images/${userId}/${Date.now()}.${verdict.accepted.extension}`
    await uploadDocument(
      fileRef({
        tenantId: scope.institutionId,
        objectKey: key,
        mimeType: verdict.accepted.mimeType,
        body: bytes,
      }),
      bytes,
    )
    await db.user.update({
      where: { id: userId },
      data: { imageKey: key, image: `/api/profile-image/${userId}?v=${Date.now()}` },
    })
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
  await withTenantScope(userId, async () => {
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
  })

  revalidatePath("/settings")
}

export async function revokeDelegation(formData: FormData) {
  const userId = await requireUserId()
  // `false` when there was no live delegation to revoke — nothing changed, so
  // nothing is invalidated.
  const revoked = await withTenantScope(userId, async () => {
    const id = String(formData.get("id") ?? "")
    const del = await db.approvalDelegation.findFirst({
      where: { id, fromUserId: userId, revokedAt: null },
      select: { id: true, institutionId: true },
    })
    if (!del) return false
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
    return true
  })

  if (revoked) revalidatePath("/settings")
}
