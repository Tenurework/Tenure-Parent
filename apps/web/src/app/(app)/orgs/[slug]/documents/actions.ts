"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { canContribute, canManageRoster, canViewOrg, getUserContext } from "@/lib/rbac"
import {
  documentDownloadUrl,
  documentViewUrl,
  storageConfigured,
  uploadDocument,
} from "@/lib/s3"

const MAX_BYTES = 15 * 1024 * 1024 // 15 MB pilot cap

export async function uploadDocumentAction(slug: string, formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")
  const userId = session.user.id

  const org = await db.organization.findUnique({ where: { slug } })
  if (!org) throw new Error("Organization not found")

  const ctx = await getUserContext(userId)
  if (!canContribute(ctx, org)) throw new Error("You need an active role to upload")
  if (!storageConfigured()) throw new Error("Document storage is not configured")

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) throw new Error("Pick a file")
  if (file.size > MAX_BYTES) throw new Error("File is larger than the 15 MB pilot limit")

  const title = (String(formData.get("title") ?? "").trim() || file.name).slice(0, 200)
  const description = String(formData.get("description") ?? "").trim()

  const safeName = file.name.replace(/[^\w.\-]+/g, "_")
  const objectKey = `${org.institutionId}/${org.id}/${Date.now()}-${safeName}`

  const bytes = Buffer.from(await file.arrayBuffer())
  await uploadDocument(objectKey, bytes, file.type || "application/octet-stream")

  await db.$transaction([
    db.document.create({
      data: {
        institutionId: org.institutionId,
        organizationId: org.id,
        title,
        description: description || null,
        objectKey,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        createdById: userId,
      },
    }),
    db.auditEvent.create({
      data: {
        institutionId: org.institutionId,
        organizationId: org.id,
        actorId: userId,
        action: "Document.Uploaded",
        resourceType: "Document",
        outcome: "ALLOW",
        metadata: { sizeBytes: file.size },
      },
    }),
  ])

  revalidatePath(`/orgs/${slug}/documents`)
}

/** Permission-checked, short-lived download redirect. */
export async function downloadDocumentAction(slug: string, formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")

  const documentId = String(formData.get("documentId") ?? "")
  const doc = await db.document.findUnique({
    where: { id: documentId },
    include: { organization: true },
  })
  if (!doc || doc.organization.slug !== slug) throw new Error("Document not found")

  const ctx = await getUserContext(session.user.id)
  if (!canViewOrg(ctx, doc.organization)) throw new Error("No access")

  await db.auditEvent.create({
    data: {
      institutionId: doc.institutionId,
      organizationId: doc.organizationId,
      actorId: session.user.id,
      action: "Document.Downloaded",
      resourceType: "Document",
      resourceId: doc.id,
      outcome: "ALLOW",
    },
  })

  const url = await documentDownloadUrl(doc.objectKey, doc.title)
  redirect(url)
}

/**
 * Delete (archive) a document: the uploader, the club's roster managers
 * (president / OSE Director), may remove it. Soft delete — the record and
 * object survive for audit; the file disappears from the club.
 */
export async function deleteDocumentAction(slug: string, formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")

  const documentId = String(formData.get("documentId") ?? "")
  const doc = await db.document.findUnique({
    where: { id: documentId },
    include: { organization: true },
  })
  if (!doc || doc.organization.slug !== slug) throw new Error("Document not found")

  const ctx = await getUserContext(session.user.id)
  const allowed =
    doc.createdById === session.user.id || canManageRoster(ctx, doc.organization)

  await db.auditEvent.create({
    data: {
      institutionId: doc.institutionId,
      organizationId: doc.organizationId,
      actorId: session.user.id,
      action: "Document.Deleted",
      resourceType: "Document",
      resourceId: doc.id,
      outcome: allowed ? "ALLOW" : "DENY",
    },
  })
  if (!allowed) throw new Error("Only the uploader or club leadership can delete this")

  await db.document.update({ where: { id: doc.id }, data: { isArchived: true } })
  revalidatePath(`/orgs/${slug}/documents`)
}

/**
 * Restore a soft-deleted document — the uploader or club leadership may bring it
 * back. Soft-delete is reversible by design; the record and object never left.
 */
export async function restoreDocumentAction(slug: string, formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")

  const documentId = String(formData.get("documentId") ?? "")
  const doc = await db.document.findUnique({
    where: { id: documentId },
    include: { organization: true },
  })
  if (!doc || doc.organization.slug !== slug) throw new Error("Document not found")

  const ctx = await getUserContext(session.user.id)
  const allowed =
    doc.createdById === session.user.id || canManageRoster(ctx, doc.organization)

  await db.auditEvent.create({
    data: {
      institutionId: doc.institutionId,
      organizationId: doc.organizationId,
      actorId: session.user.id,
      action: "Document.Restored",
      resourceType: "Document",
      resourceId: doc.id,
      outcome: allowed ? "ALLOW" : "DENY",
    },
  })
  if (!allowed) throw new Error("Only the uploader or club leadership can restore this")

  await db.document.update({ where: { id: doc.id }, data: { isArchived: false } })
  revalidatePath(`/orgs/${slug}/documents`)
}

/** Permission-checked inline view (opens in the browser tab). */
export async function viewDocumentAction(slug: string, formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")

  const documentId = String(formData.get("documentId") ?? "")
  const doc = await db.document.findUnique({
    where: { id: documentId },
    include: { organization: true },
  })
  if (!doc || doc.organization.slug !== slug) throw new Error("Document not found")

  const ctx = await getUserContext(session.user.id)
  if (!canViewOrg(ctx, doc.organization)) throw new Error("No access")

  await db.auditEvent.create({
    data: {
      institutionId: doc.institutionId,
      organizationId: doc.organizationId,
      actorId: session.user.id,
      action: "Document.Viewed",
      resourceType: "Document",
      resourceId: doc.id,
      outcome: "ALLOW",
    },
  })

  redirect(await documentViewUrl(doc.objectKey))
}
