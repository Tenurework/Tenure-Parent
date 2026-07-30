import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { canViewOrg, getUserContext } from "@/lib/rbac"
import { documentViewUrl } from "@/lib/s3"

/**
 * Serves an uploaded club image by redirecting to a short-lived signed URL.
 * Access mirrors who can see the club, so uploaded images are no more visible
 * than the club itself. External (pasted) image URLs never hit this route —
 * they are rendered directly.
 */
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const session = await auth()
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 })

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, institutionId: true, imageKey: true },
  })
  if (!org?.imageKey) return new NextResponse("Not found", { status: 404 })

  const ctx = await getUserContext(session.user.id)
  if (!canViewOrg(ctx, org)) return new NextResponse("Forbidden", { status: 403 })

  const url = await documentViewUrl(org.imageKey)
  return NextResponse.redirect(url)
}
