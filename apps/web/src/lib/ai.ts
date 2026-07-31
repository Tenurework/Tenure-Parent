import type { ScoredDoc } from "@/lib/search"

/**
 * Answer synthesis over retrieved, permission-filtered sources.
 * Uses the Anthropic API when ANTHROPIC_API_KEY is configured; otherwise
 * the caller falls back to showing cited sources without a prose answer.
 * The model only ever sees content the requesting user is allowed to see.
 */
export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

/** Generic best-effort completion — Tenure AI's single entry point. */
export async function aiComplete(
  system: string,
  user: string,
  maxTokens = 500
): Promise<string | null> {
  if (!aiConfigured()) return null

  const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001"
  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  })

  // One retry for transient failures (rate limit / overload), then give up and
  // degrade to sources-only. NEVER fail silently: log the real status + body so
  // an invalid key, billing block, or model error is visible in the container
  // logs (CloudWatch) instead of collapsing to an indistinguishable null.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body,
        signal: AbortSignal.timeout(20_000),
      })
      if (res.ok) {
        const data = (await res.json()) as { content?: { type: string; text?: string }[] }
        return data.content?.find((b) => b.type === "text")?.text ?? null
      }
      const detail = await res.text().catch(() => "")
      console.error(
        `[ai] Anthropic API ${res.status} (model=${model}, attempt=${attempt + 1}): ${detail.slice(0, 500)}`
      )
      // 429 (rate limit) and 529 (overloaded) are worth one retry; auth/model
      // errors (401/400/404) will just fail again, so stop immediately.
      if (res.status !== 429 && res.status !== 529) return null
      await new Promise((r) => setTimeout(r, 600))
    } catch (err) {
      console.error(`[ai] Anthropic API request failed (model=${model}, attempt=${attempt + 1}):`, err)
      if (attempt === 1) return null
      await new Promise((r) => setTimeout(r, 600))
    }
  }
  return null // Callers degrade gracefully — generation is best-effort
}

export async function synthesizeAnswer(
  question: string,
  sources: ScoredDoc[]
): Promise<string | null> {
  if (sources.length === 0) return null
  const sourceBlock = sources
    .map((s, i) => `[${i + 1}] (${s.kind} · ${s.context}) ${s.title}\n${s.body.slice(0, 1200)}`)
    .join("\n\n")
  return aiComplete(
    "You answer questions for student-organization leaders using ONLY the numbered sources provided. " +
      "Cite every claim with its source number in brackets, e.g. [1]. " +
      "If the sources do not contain the answer, say so briefly. Never invent facts.",
    `Question: ${question}\n\nSources:\n${sourceBlock}`
  )
}

export async function draftText(
  kind: "message" | "memory" | "event",
  instruction: string
): Promise<string | null> {
  const contexts = {
    message: "a professional message between student-organization leaders",
    memory: "an institutional-memory knowledge card a successor will rely on — concrete details, names, amounts, dates",
    event: "an event description for a university club calendar",
  }
  return aiComplete(
    `You are Tenure AI, the copilot inside Tenure (an operating system for student organizations). ` +
      `Draft ${contexts[kind]}. Return ONLY the drafted text — no preamble, no quotes, no markdown headers. Be concise and specific.`,
    instruction,
    400
  )
}

export async function summarizeDocument(
  title: string,
  content: string
): Promise<string | null> {
  return aiComplete(
    "You are Tenure AI. Summarize this club document for a busy student leader: " +
      "3-6 bullet points covering purpose, key facts (names, amounts, dates, deadlines), and any action items. Plain text bullets.",
    `Document: ${title}\n\n${content.slice(0, 24_000)}`,
    600
  )
}
