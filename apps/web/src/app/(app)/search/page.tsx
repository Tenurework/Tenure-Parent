import Link from "next/link"
import { redirect } from "next/navigation"
import { Brain, FileText, CalendarDays, CheckCircle, Building2, BookOpen } from "@/components/ui/icons"
import { auth } from "@/lib/auth"
import { withTenantScope } from "@/lib/tenant-scope"
import { rankDocs } from "@/lib/search"
import { loadInteractiveSearchCorpus } from "@/lib/search-data"
import { aiConfigured, synthesizeAnswer } from "@/lib/ai"
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
  return withTenantScope(session.user.id, async () => {
    // Next 15 delivers a repeated `?q=a&q=b` as string[]; coerce to a single
    // string so `.trim()` never explodes on a crafted/shared URL.
    const query = (Array.isArray(q) ? q[0] ?? "" : q ?? "").trim()
    const results = query
      ? rankDocs(await loadInteractiveSearchCorpus(session.user.id), query)
      : []
    const answer = query ? await synthesizeAnswer(query, results.slice(0, 6)) : null

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
                    return (
                      <li key={`${r.kind}-${r.id}`}>
                        <Link
                          href={r.href}
                          className="flex items-start gap-3 px-5 py-3.5 hover:bg-base transition-colors no-underline"
                        >
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
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ol>
              )}
            </Card>
          </div>
        )}
      </div>
    )
  })
}
