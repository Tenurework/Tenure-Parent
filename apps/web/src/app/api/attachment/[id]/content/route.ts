import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { canReadConversation } from "@/lib/messaging"
import { buildDocContent } from "@/app/api/documents/_lib/content"
import type { AttachmentContentResponse } from "@/components/documents/types"

/**
 * JSON content for the unified viewer, for a message attachment. Same ACL as the
 * download route (auth → attachment.findUnique → canReadConversation), but returns
 * parsed content instead of a signed download so pdf/text/sheets/pptx/images all
 * preview in the shared overlay. Attachments are never editable. Parsing lives in
 * buildDocContent, which degrades bad files to "unsupported" rather than throwing.
 */
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 })

  const att = await db.attachment.findUnique({
    where: { id },
    include: {
      message: {
        include: {
          conversation: { include: { participants: { select: { userId: true } } } },
        },
      },
    },
  })
  if (!att) return new NextResponse("Not found", { status: 404 })

  const convo = att.message.conversation
  const ctx = await getUserContext(session.user.id)
  const allowed = canReadConversation(ctx, {
    type: convo.type,
    institutionId: convo.institutionId,
    organizationId: convo.organizationId,
    participantUserIds: convo.participants.map((p) => p.userId),
  })
  if (!allowed) return new NextResponse("Forbidden", { status: 403 })

  const content = await buildDocContent({
    objectKey: att.objectKey,
    mime: att.mimeType,
    sizeBytes: att.sizeBytes,
  })

  const body: AttachmentContentResponse = {
    meta: {
      id: att.id,
      title: att.fileName,
      mimeType: att.mimeType,
      sizeBytes: att.sizeBytes,
    },
    content,
  }

  return NextResponse.json(body)
}
