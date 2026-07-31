import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getUserContext } from "@/lib/rbac"
import { isAdmin } from "@/lib/admin/capabilities"
import { directory } from "@/lib/directory"
import type { DirectoryKind } from "@prisma/client"

/** Typeahead over the University directory — administrators only. */
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ results: [] }, { status: 401 })
  const ctx = await getUserContext(session.user.id)
  if (!isAdmin(ctx)) return NextResponse.json({ results: [] }, { status: 403 })

  const url = new URL(req.url)
  const q = url.searchParams.get("q") ?? ""
  const kindParam = url.searchParams.get("kind")
  const kind = kindParam === "STUDENT" || kindParam === "ADVISOR" ? (kindParam as DirectoryKind) : undefined

  const results = await directory().search(q, { limit: 10, kind })
  return NextResponse.json({ results })
}
