import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { loadSearchCorpus } from "@/lib/search-data"
import { rankDocs } from "@/lib/search"

/** Live results for the header command palette — permission-scoped by the corpus. */
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ results: [] }, { status: 401 })

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? ""
  if (!q) return NextResponse.json({ results: [] })

  const results = rankDocs(await loadSearchCorpus(session.user.id), q, 8).map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    href: r.href,
    context: r.context,
    snippet: r.snippet,
  }))
  return NextResponse.json({ results })
}
