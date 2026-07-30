import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { canReadConversation } from "@/lib/messaging"
import { documentDownloadUrl } from "@/lib/s3"

/**
 * Downloads a message attachment via a short-lived signed URL, but only for
 * someone allowed to read the conversation it belongs to.
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

  return NextResponse.redirect(await documentDownloadUrl(att.objectKey, att.fileName))
}
