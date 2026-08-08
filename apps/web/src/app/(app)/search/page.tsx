import Link from "next/link"
import { redirect } from "next/navigation"
import { Brain, FileText, CalendarDays, CheckCircle, Building2, BookOpen } from "@/components/ui/icons"
import { auth } from "@/lib/auth"
import { withTenantScope } from "@/lib/tenant-scope"
import { rankDocs, withheldMatches } from "@/lib/search"
import { loadInteractiveSearchCorpus } from "@/lib/search-data"
import { aiConfigured, synthesizeAnswer } from "@/lib/ai"
import {
  citationLine,
  stateCaveat,
  INFERENCE_NOTE,
  WITHHELD_NOTE,
} from "@/lib/relay/citation-display"
import { Card, CardHeader } from "@/components/ui/Card"

export const dynamic = "force-dynamic"

const KIND_ICON = {
  memory: BookOpen,
  document: FileText,
  approval: CheckCircle,
  event: CalendarDays,
  organization: Building2,
} as const

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>
}) {
  const { q } = await searchParams
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  // WRK-070-002. `interactive`: these rows are rendered back to the person who
  // asked for them and never leave the process. The sibling entry point
  // (`loadSearchCorpus`) is the one /api/ai/chat uses to post them to a model
  // vendor, and each refuses the other's purpose.
  return withTenantScope(session.user.id, async (scope) => {
    // Next 15 delivers a repeated `?q=a&q=b` as string[]; coerce to a single
    // string so `.trim()` never explodes on a crafted/shared URL.
    const query = (Array.isArray(q) ? q[0] ?? "" : q ?? "").trim()
    // Loaded once and read twice. `rankDocs` returns what an answer may rest on
    // and `withheldMatches` returns what matched and may not be — two views of
    // one corpus, so a second load could disagree with the first about a row's
    // state between them.
    const corpus = query ? await loadInteractiveSearchCorpus(session.user.id) : []
    const results = rankDocs(corpus, query)
    // WRK-010-005. The rows a state disqualified. Until this, `/search` dropped
    // them silently: a member looking for the event their club cancelled got
    // "No results", which reads as "there is no such event" — a different and
    // untrue statement. No body and no snippet; `WithheldMatch` has no field
    // that could carry one.
    const withheld = query ? withheldMatches(corpus, query) : []
    // One instant for the whole page, so two sources cannot render ages
    // measured from two different "now"s.
    const renderedAt = new Date()
    // WRK-120-004. The institution the answer is charged to is the one whose
    // scope this page is already running inside — the same rows the answer is
    // built from, so the meter and the retrieval cannot name different tenants.
    const answer = query
      ? await synthesizeAnswer(query, results.slice(0, 6), scope.institutionId)
      : null

    return (
      <div className="max-w-4xl">
        <div className="mb-6">
          <h1 className="text-text-1">Search</h1>
          <p className="text-sm text-text-2 mt-1">
            Ask across everything you have access to — answers cite their sources.
          </p>
        </div>

        <form action="/search" method="get" className="mb-6 flex gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="Who is our catering contact? What's pending approval?"
            className="h-10 flex-1 rounded border border-border px-3 text-sm text-text-1 bg-surface placeholder:text-text-3"
            autoFocus
          />
          <button className="h-10 rounded bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:opacity-90">
            Search
          </button>
        </form>

        {query && (
          <div className="space-y-4">
            {answer && (
              <Card>
                <CardHeader
                  title="Answer"
                  subtitle="Generated only from the cited sources below"
                  action={<Brain size={16} className="text-[--primary]" />}
                />
                <p className="text-sm text-text-1 whitespace-pre-wrap">{answer}</p>
                {/* WRK-070-003 / §9.3. The reader has to be able to tell a
                    retrieved record from the assistant's own reasoning, and
                    until this the page asserted the first and showed neither. */}
                <p className="mt-2 text-xs text-text-3">{INFERENCE_NOTE}</p>
              </Card>
            )}
            {!answer && aiConfigured() && results.length > 0 && (
              <p className="text-xs text-text-3">
                Answer generation was unavailable — showing sources.
              </p>
            )}

            <Card padding="none">
              <div className="p-5 border-b border-border">
                <CardHeader
                  title={results.length ? `Sources (${results.length})` : "No results"}
                  subtitle={
                    results.length
                      ? "Everything below respects your role's access"
                      : "Nothing you can access matches that query."
                  }
                />
              </div>
              {results.length > 0 && (
                <ol className="divide-y divide-border">
                  {results.map((r, i) => {
                    const Icon = KIND_ICON[r.kind]
                    // The GOVERNED deep link (§9.3), minted by
                    // `governedDeepLink` inside the citation, never the raw
                    // stored `href`. Null means no link may be vouched for, and
                    // the row renders as text rather than as a link Tenure
                    // appears to stand behind.
                    const link = r.citation.href
                    const body = (
                      <>
                        <span className="text-xs font-semibold text-text-3 mt-0.5 w-6 shrink-0">
                          [{i + 1}]
                        </span>
                        <Icon size={15} className="text-text-3 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-text-1">{r.title}</p>
                          {r.snippet && (
                            <p className="text-xs text-text-2 mt-0.5 line-clamp-2">{r.snippet}</p>
                          )}
                          <p className="text-xs text-text-3 mt-0.5">
                            {r.kind} · {r.context}
                          </p>
                          {/* §3.5. Which system holds it, how old it is, and
                              what has to be said about that. A page that
                              rendered a two-year-old row identically to one
                              saved this morning was asserting a currency
                              nothing had checked. */}
                          <p className="text-xs text-text-3 mt-0.5">
                            {citationLine(r.citation, renderedAt)}
                          </p>
                        </div>
                      </>
                    )
                    return (
                      <li key={`${r.kind}-${r.id}`}>
                        {link ? (
                          <Link
                            href={link}
                            className="flex items-start gap-3 px-5 py-3.5 hover:bg-base transition-colors no-underline"
                          >
                            {body}
                          </Link>
                        ) : (
                          <div className="flex items-start gap-3 px-5 py-3.5">{body}</div>
                        )}
                      </li>
                    )
                  })}
                </ol>
              )}
            </Card>

            {/* WRK-010-005. Matched, and not answerable from. */}
            {withheld.length > 0 && (
              <Card padding="none">
                <div className="p-5 border-b border-border">
                  <CardHeader
                    title={`Not answerable (${withheld.length})`}
                    subtitle={WITHHELD_NOTE}
                  />
                </div>
                <ul className="divide-y divide-border">
                  {withheld.map((w) => {
                    const Icon = KIND_ICON[w.kind]
                    return (
                      <li key={`${w.kind}-${w.id}`} className="flex items-start gap-3 px-5 py-3.5">
                        <Icon size={15} className="text-text-3 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-text-1">{w.title}</p>
                          {/* No snippet and no body: the type has no field that
                              could carry one, so this cannot leak the text the
                              state withheld. */}
                          <p className="text-xs text-text-3 mt-0.5">
                            {w.kind} · {w.context} · {stateCaveat(w.state) ?? w.state}
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </Card>
            )}
          </div>
        )}
      </div>
    )
  })
}
