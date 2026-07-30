import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  canContribute,
  canManageRoster,
  canViewOrg,
  getUserContext,
} from "@/lib/rbac"
import { aiConfigured } from "@/lib/ai"
import { buildDocContent } from "@/app/api/documents/_lib/content"
import type { DocContentResponse } from "@/components/documents/types"

/**
 * JSON content for the unified viewer. ACL mirrors the /view page exactly:
 * auth → findUnique(include organization) → optional ?slug= match → isArchived
 * 404 → canViewOrg. Writes one "Document.Viewed" audit per fetch. Parsing lives
 * in buildDocContent, which never throws (bad files degrade to "unsupported").
 */
export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 })

  const doc = await db.document.findUnique({
    where: { id },
    include: { organization: true },
  })
  if (!doc) return new NextResponse("Not found", { status: 404 })

  const slug = new URL(req.url).searchParams.get("slug")
  if (slug && doc.organization.slug !== slug) {
    return new NextResponse("Not found", { status: 404 })
  }
  if (doc.isArchived) return new NextResponse("Not found", { status: 404 })

  const ctx = await getUserContext(session.user.id)
  if (!canViewOrg(ctx, doc.organization)) {
    return new NextResponse("Forbidden", { status: 403 })
  }

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

  const content = await buildDocContent({
    objectKey: doc.objectKey,
    mime: doc.mimeType,
    sizeBytes: doc.sizeBytes,
  })

  // Active members can edit shared docs: uploader, roster managers, or any
  // ACTIVE contributor (canContribute) may write — but only text / spreadsheet
  // formats are actually editable.
  const canEditPermission =
    doc.createdById === session.user.id ||
    canManageRoster(ctx, doc.organization) ||
    canContribute(ctx, doc.organization)
  const editable =
    canEditPermission && (content.kind === "text" || content.kind === "sheets")

  const body: DocContentResponse = {
    meta: {
      id: doc.id,
      title: doc.title,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      updatedAt: doc.updatedAt.toISOString(),
      version: doc.version,
      orgName: doc.organization.name,
      orgSlug: doc.organization.slug,
    },
    editable,
    canSummarize: aiConfigured(),
    content,
  }

  return NextResponse.json(body)
}
