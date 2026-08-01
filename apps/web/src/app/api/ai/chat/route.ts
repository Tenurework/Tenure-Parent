import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withTenantScope } from "@/lib/tenant-scope"
import { flagDecisionForInstitution } from "@/lib/config/server"
import { loadSearchCorpus } from "@/lib/search-data"
import { rankDocs } from "@/lib/search"
import { aiComplete, aiConfigured } from "@/lib/ai"

/**
 * Tenure AI chat — retrieval-augmented over the user's permission-scoped corpus.
 * The model only ever sees content the requester can already see, and answers
 * cite numbered sources. When no model key is configured it returns the ranked
 * sources without prose, so the assistant is still useful.
 *
 * The `aiAssistant` flag gates the vendor call, and only the vendor call. This
 * is the one outbound HTTP request the application makes and it carries customer
 * content to a third party (`docs/architecture/subsystem-paths.md` §7), so
 * "stop sending our students' data to that vendor, now" is a control an
 * institution would plausibly reach for at 2am. Retrieval is unaffected: the
 * ranked sources are the requester's own rows and never leave the process, so a
 * flagged-off assistant degrades to the same sources-only answer it already
 * gives when no key is configured, rather than to an error.
 */
export const dynamic = "force-dynamic"

interface Turn {
  role: "user" | "assistant"
  content: string
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const userId = session.user.id

  return withTenantScope(userId, async (scope) => {
    const body = (await req.json().catch(() => ({}))) as { question?: string; history?: Turn[] }
    const question = body.question?.trim()
    if (!question) return NextResponse.json({ error: "bad_request" }, { status: 400 })

    const flag = await flagDecisionForInstitution(scope.institutionId, "aiAssistant", userId)

    const scored = rankDocs(await loadSearchCorpus(userId), question, 6)
    const sources = scored.map((s) => ({
      title: s.title,
      href: s.href,
      kind: s.kind,
      context: s.context,
    }))

    // Flag first, key second. They are different facts — "this tenant has
    // turned the assistant off" and "nobody has configured a model" — and the
    // response reports which one applies rather than collapsing both to a null.
    const available = flag.enabled && aiConfigured()

    let answer: string | null = null
    if (available) {
      const sourceBlock = scored
        .map((s, i) => `[${i + 1}] (${s.kind} · ${s.context}) ${s.title}\n${s.body.slice(0, 1000)}`)
        .join("\n\n")
      // `history` is client-supplied — guard that it is actually an array (and
      // that each turn is an object) before slicing/mapping, so a malformed
      // body like {"history":"abc"} can't throw a 500.
      const history = Array.isArray(body.history) ? body.history : []
      const priorTurns = history
        .slice(-6)
        .map((m) => `${m?.role === "user" ? "User" : "Tenure AI"}: ${m?.content ?? ""}`)
        .join("\n")
      answer = await aiComplete(
        "You are Tenure AI, the copilot inside Tenure (an operating system for student organizations). " +
          "Answer the user's question using ONLY the numbered sources provided. Cite every claim with its " +
          "source number in brackets, e.g. [1]. If the sources do not contain the answer, say so briefly and " +
          "suggest where they might look. Be concise and practical.",
        `${priorTurns ? priorTurns + "\n\n" : ""}Question: ${question}\n\nSources:\n${sourceBlock || "(none found)"}`,
        600
      )
    }

    return NextResponse.json({
      answer,
      aiEnabled: available,
      // Null when the flag is on, so the client cannot mistake "no key" for
      // "switched off" — the existing copy already distinguishes those.
      aiDisabledReason: flag.enabled ? null : flag.reason,
      sources,
    })
  })
}
