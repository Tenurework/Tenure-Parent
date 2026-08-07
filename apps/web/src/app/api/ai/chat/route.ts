import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { parseTenantContext } from "@tenure/contracts"
import { auth } from "@/lib/auth"
import { withTenantScope } from "@/lib/tenant-scope"
import {
  configSnapshotForInstitution,
  flagDecisionForInstitution,
  institutionSlugFor,
} from "@/lib/config/server"
import { getUserContext } from "@/lib/rbac"
import { authorizeRelayTools, toolOffered } from "@/lib/relay-tools"
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
 *
 * ## Retrieval is a registered tool, and it is authorized (PACK-070-004)
 *
 * `search.corpus` is declared by the `search` module in `modules/index.ts` as a
 * `ToolRegistration`, and this route retrieves nothing until that registration
 * survives `decide()` for this requester, in this tenant, on this request. Three
 * things follow, and none of them were true when the retrieval was
 * unconditional:
 *
 *   * A system whose blueprint does not select `search` has no such tool, so
 *     the assistant here does not silently do the one thing it does. It says
 *     the capability is not part of this system.
 *   * A principal who does not hold `search.index.query` gets a refusal with
 *     the engine's reason, not an empty result set that reads like "there is
 *     nothing here" — which is a different and untrue statement.
 *   * The registration's `reauthorizesPerCall` is honoured literally: the seats
 *     are re-read per request, so a seat that ended between two questions stops
 *     answering on the second one.
 *
 * The flag and the tool are checked independently and reported separately. One
 * is "this tenant switched the vendor off", the other is "you may not search
 * here", and collapsing them would tell at least one person something false.
 */
export const dynamic = "force-dynamic"

interface Turn {
  role: "user" | "assistant"
  content: string
}

/** The tool this route is. Named once so the registration and the use agree. */
const RETRIEVAL_TOOL = "search.corpus"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const userId = session.user.id

  return withTenantScope(userId, async (scope) => {
    const body = (await req.json().catch(() => ({}))) as { question?: string; history?: Turn[] }
    const question = body.question?.trim()
    if (!question) return NextResponse.json({ error: "bad_request" }, { status: 400 })

    const flag = await flagDecisionForInstitution(scope.institutionId, "aiAssistant", userId)

    // ── which tools this system offers this person ──────────────────────────
    //
    // The context is built once and validated, so the tenant, the actor and the
    // instant every tool decision rests on come from one value rather than from
    // three arguments that could disagree. `configRevision` is the resolved
    // configuration's own identity, which is what makes "why did the assistant
    // answer that in March" answerable at all.
    const [slug, config] = await Promise.all([
      institutionSlugFor(scope.institutionId),
      configSnapshotForInstitution(scope.institutionId),
    ])
    const ctx = await getUserContext(userId)

    const context = parseTenantContext({
      tenantId: scope.institutionId,
      actorId: userId,
      actorKind: scope.actor.principalType,
      channel: "web",
      correlationId: randomUUID(),
      configRevision: config.revision,
      at: new Date().toISOString(),
    })

    const tools = authorizeRelayTools(ctx, context, slug)
    const mayRetrieve = toolOffered(tools, RETRIEVAL_TOOL)

    const scored = mayRetrieve ? rankDocs(await loadSearchCorpus(userId), question, 6) : []
    const sources = scored.map((s) => ({
      title: s.title,
      href: s.href,
      kind: s.kind,
      context: s.context,
    }))

    // Flag first, key second. They are different facts — "this tenant has
    // turned the assistant off" and "nobody has configured a model" — and the
    // response reports which one applies rather than collapsing both to a null.
    //
    // The tool is a third: a model asked to answer from sources it was not
    // allowed to retrieve would answer from its own training instead, which is
    // the exact failure a grounded assistant exists to avoid. So a refused tool
    // stops the vendor call too.
    const available = flag.enabled && aiConfigured() && mayRetrieve

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
      // Why nothing was retrieved, when nothing was. Null when the tool was
      // offered, so the client cannot mistake "no matches" for "not allowed".
      toolRefusal: mayRetrieve
        ? null
        : (tools.refused.find((r) => r.toolKey === RETRIEVAL_TOOL)?.reason ??
          `This system does not offer the ${RETRIEVAL_TOOL} capability.`),
      sources,
    })
  })
}
