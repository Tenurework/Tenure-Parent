import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  canContribute,
  canManageRoster,
  canViewOrg,
  getUserContext,
} from "@/lib/rbac"
import { storageConfigured, uploadDocument } from "@/lib/s3"

/**
 * Save an in-place edit back to the SAME object key.
 *
 * ACL: uploader OR canManageRoster OR canContribute (any ACTIVE member / OSE
 * may edit a shared club doc — recorded as the deliberate choice for this
 * pilot). Optimistic-locked on `updatedAt`: a stale baseUpdatedAt → 409 so the
 * client can prompt a reopen. On success we overwrite S3, bump sizeBytes +
 * version, write one "Document.Edited" audit, and return the fresh updatedAt.
 */
export const dynamic = "force-dynamic"

const MAX_SAVE_BYTES = 15 * 1024 * 1024

type Body =
  | { kind: "text"; content: string; baseUpdatedAt: string }
  | { kind: "xlsx"; base64: string; baseUpdatedAt: string }

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 })

  if (!storageConfigured()) {
    return NextResponse.json(
      { error: "Document storage is not configured" },
      { status: 400 }
    )
  }

  const doc = await db.document.findUnique({
    where: { id },
    include: { organization: true },
  })
  if (!doc || doc.isArchived) return new NextResponse("Not found", { status: 404 })

  const ctx = await getUserContext(session.user.id)
  if (!canViewOrg(ctx, doc.organization)) {
    return new NextResponse("Forbidden", { status: 403 })
  }
  const canEdit =
    doc.createdById === session.user.id ||
    canManageRoster(ctx, doc.organization) ||
    canContribute(ctx, doc.organization)
  if (!canEdit) {
    await db.auditEvent.create({
      data: {
        institutionId: doc.institutionId,
        organizationId: doc.organizationId,
        actorId: session.user.id,
        action: "Document.Edited",
        resourceType: "Document",
        resourceId: doc.id,
        outcome: "DENY",
      },
    })
    return new NextResponse("Forbidden", { status: 403 })
  }

  let payload: Body
  try {
    payload = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  if (doc.updatedAt.toISOString() !== payload.baseUpdatedAt) {
    return NextResponse.json({ conflict: true }, { status: 409 })
  }

  let bytes: Buffer
  if (payload.kind === "text") {
    if (typeof payload.content !== "string") {
      return NextResponse.json({ error: "Invalid content" }, { status: 400 })
    }
    bytes = Buffer.from(payload.content, "utf8")
  } else if (payload.kind === "xlsx") {
    if (typeof payload.base64 !== "string") {
      return NextResponse.json({ error: "Invalid content" }, { status: 400 })
    }
    bytes = Buffer.from(payload.base64, "base64")
  } else {
    return NextResponse.json({ error: "Unsupported edit kind" }, { status: 400 })
  }

  if (bytes.length > MAX_SAVE_BYTES) {
    return NextResponse.json(
      { error: "The edited file exceeds the 15 MB limit" },
      { status: 413 }
    )
  }

  try {
    // Overwrite in place — keep the original content type so the viewer keeps
    // rendering it the same way.
    await uploadDocument(doc.objectKey, bytes, doc.mimeType)
  } catch {
    return NextResponse.json({ error: "Save failed — try again" }, { status: 500 })
  }

  const updated = await db.document.update({
    where: { id: doc.id },
    data: { sizeBytes: bytes.length, version: { increment: 1 } },
  })

  await db.auditEvent.create({
    data: {
      institutionId: doc.institutionId,
      organizationId: doc.organizationId,
      actorId: session.user.id,
      action: "Document.Edited",
      resourceType: "Document",
      resourceId: doc.id,
      outcome: "ALLOW",
      metadata: { sizeBytes: bytes.length, version: updated.version },
    },
  })

  return NextResponse.json({
    updatedAt: updated.updatedAt.toISOString(),
    version: updated.version,
    sizeBytes: bytes.length,
  })
}
