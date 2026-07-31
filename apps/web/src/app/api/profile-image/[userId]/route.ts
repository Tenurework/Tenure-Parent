import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { documentViewUrl } from "@/lib/s3"

/**
 * Serves an uploaded profile picture by redirecting to a short-lived signed
 * URL. Any signed-in user may view a profile picture — people appear to each
 * other across messaging and rosters — but you must be signed in. External
 * (pasted) image URLs are rendered directly and never hit this route.
 */
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params
  const session = await auth()
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 })

  const user = await db.user.findUnique({ where: { id: userId }, select: { imageKey: true } })
  if (!user?.imageKey) return new NextResponse("Not found", { status: 404 })

  return NextResponse.redirect(await documentViewUrl(user.imageKey))
}
