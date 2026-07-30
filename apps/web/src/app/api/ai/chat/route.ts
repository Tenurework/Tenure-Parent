import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { loadSearchCorpus } from "@/lib/search-data"
import { rankDocs } from "@/lib/search"
import { aiComplete, aiConfigured } from "@/lib/ai"

/**
 * Tenure AI chat — retrieval-augmented over the user's permission-scoped corpus.
 * The model only ever sees content the requester can already see, and answers
 * cite numbered sources. When no model key is configured it returns the ranked
 * sources without prose, so the assistant is still useful.
 */
export const dynamic = "force-dynamic"

interface Turn {
  role: "user" | "assistant"
  content: string
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { question?: string; history?: Turn[] }
  const question = body.question?.trim()
  if (!question) return NextResponse.json({ error: "bad_request" }, { status: 400 })

  const scored = rankDocs(await loadSearchCorpus(session.user.id), question, 6)
  const sources = scored.map((s) => ({
    title: s.title,
    href: s.href,
    kind: s.kind,
    context: s.context,
  }))

  let answer: string | null = null
  if (aiConfigured()) {
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

  return NextResponse.json({ answer, aiEnabled: aiConfigured(), sources })
}
