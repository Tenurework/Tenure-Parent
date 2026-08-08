import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withTenantScope } from "@/lib/tenant-scope"
import { loadInteractiveSearchCorpus } from "@/lib/search-data"
import { rankDocs, withheldMatches } from "@/lib/search"

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

    const corpus = await loadInteractiveSearchCorpus(userId)
    const results = rankDocs(corpus, q, 8).map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      href: r.href,
      context: r.context,
      snippet: r.snippet,
      // WRK-070-003 / §9.3. Every result now says when its source last changed
      // and what state it is in, because a palette that renders a row from last
      // September identically to one from this morning is asserting a currency
      // nothing checked. `rankDocs` only scores an answerable state, so this is
      // LIVE or STALE here — and the label is what makes the difference visible.
      state: r.state,
      observedAt: r.citation.observedAt,
      citation: r.citation,
    }))

    // WRK-010-005. The matches an answer may not rest on, named rather than
    // omitted. A cancelled event used to be dropped by the corpus query, so
    // searching for it returned nothing — indistinguishable from an event that
    // never existed. It now comes back here, with its state and no body.
    const withheld = withheldMatches(corpus, q)
    return NextResponse.json({ results, withheld })
  })
}
