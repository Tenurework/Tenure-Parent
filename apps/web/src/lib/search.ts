/**
 * Permission-aware retrieval (blueprint §Search & AI).
 * Pure scoring/snippet helpers — the query layer filters by RBAC first,
 * then these rank whatever the user is allowed to see.
 */

export interface SearchDoc {
  id: string
  kind: "memory" | "document" | "approval" | "event" | "organization"
  title: string
  body: string
  href: string
  context: string // e.g. club name — shown with the citation
}

export interface ScoredDoc extends SearchDoc {
  score: number
  snippet: string
}

export function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)
}

export function scoreDoc(doc: SearchDoc, terms: string[]): number {
  if (terms.length === 0) return 0
  const title = doc.title.toLowerCase()
  const body = doc.body.toLowerCase()
  let score = 0
  for (const t of terms) {
    if (title === t) score += 12
    else if (title.includes(t)) score += 6
    if (body.includes(t)) score += 2
  }
  // Require every term to appear somewhere — AND semantics
  const all = terms.every((t) => title.includes(t) || body.includes(t))
  return all ? score : 0
}

/** A short window of body text around the first matched term. */
export function makeSnippet(body: string, terms: string[], width = 160): string {
  const lower = body.toLowerCase()
  let idx = -1
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i !== -1 && (idx === -1 || i < idx)) idx = i
  }
  if (idx === -1) return body.slice(0, width) + (body.length > width ? "…" : "")
  const start = Math.max(0, idx - Math.floor(width / 3))
  const end = Math.min(body.length, start + width)
  return (
    (start > 0 ? "…" : "") + body.slice(start, end) + (end < body.length ? "…" : "")
  )
}

export function rankDocs(docs: SearchDoc[], query: string, limit = 12): ScoredDoc[] {
  const terms = tokenize(query)
  return docs
    .map((d) => ({ ...d, score: scoreDoc(d, terms), snippet: makeSnippet(d.body, terms) }))
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
