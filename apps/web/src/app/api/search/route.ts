import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withTenantScope } from "@/lib/tenant-scope"
import { loadInteractiveSearchCorpus } from "@/lib/search-data"
import { rankDocs } from "@/lib/search"

/** Live results for the header command palette — permission-scoped by the corpus. */
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ results: [] }, { status: 401 })
  const userId = session.user.id

  // WRK-070-002. `interactive`: the palette renders these back to the requester.
  // Nothing here reaches a model vendor — that is `/api/ai/chat`, which opens
  // its scope for `model-exposure` and calls the sibling entry point.
  return withTenantScope(userId, async () => {
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? ""
    if (!q) return NextResponse.json({ results: [] })

    const results = rankDocs(await loadInteractiveSearchCorpus(userId), q, 8).map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      href: r.href,
      context: r.context,
      snippet: r.snippet,
    }))
    return NextResponse.json({ results })
  })
}
