import type { ProjectedState } from "@/lib/relay/citation"

/**
 * WRK-070-003 / WRK-GATE-070 / WRK-010-005 — the citation, said to a person.
 *
 * §9.3 asks that "the user can distinguish source text, Tenure record, Relay
 * inference, and human-approved memory", and §3.5 that an answer "never answer
 * as though a stale, deleted, inaccessible, or reconciliation-failed source is
 * current. Show freshness and uncertainty." Both sentences are about what
 * somebody SEES.
 *
 * `/api/search` and `/api/ai/chat` already emit `state`, `observedAt` and a
 * whole `SourceCitation` per source. Every one of the three surfaces that reads
 * them — the command palette, the Tenure AI panel and the `/search` page —
 * declared a narrower type and threw the fields away before anything could
 * render them, so a record nobody had touched in two years and one saved this
 * morning were the same three lines of markup. The route carried the freshness;
 * the reader never got it. This module is the wording, in one place, so those
 * three surfaces cannot disagree about what STALE means to a person.
 *
 * ## Why this is not in `citation.ts`
 *
 * `citation.ts` reaches `@/lib/tenancy/context` for `citingTenant`, which
 * reaches `node:async_hooks`. Two of the three consumers are `"use client"`
 * components, so importing the runtime module there would pull a Node built-in
 * into the browser bundle. The `ProjectedState` import above is `import type`
 * and is erased at compile time — the states stay checked by `tsc` (the
 * `Record` below is exhaustive, so a seventh state is a compile error here)
 * while nothing at runtime is imported at all. That is what "kernel-free" has
 * to mean for a module a client component may read.
 */

/**
 * What has to be said about a source in each state, or null when the honest
 * answer is nothing.
 *
 * A `Record<ProjectedState, …>` and not a `switch` with a default: adding a
 * seventh operational verdict must be a compile error here rather than a state
 * that silently renders as though it were current, which is the exact failure
 * §3.5 names.
 *
 * `LIVE` is deliberately null. A caveat on every row is a caveat nobody reads,
 * and "this is current" is what the absence of a warning already says.
 */
export const STATE_CAVEAT: Record<ProjectedState, string | null> = {
  LIVE: null,
  STALE: "May be out of date",
  TOMBSTONED: "Deleted at the source",
  QUARANTINED: "Held — its text carried active content",
  ACCESS_LOST: "Access to the source was lost",
  CONFLICTED: "Disagrees with its source",
}

/** The caveat for a state, or null. Safe on a value that came off the wire. */
export function stateCaveat(state: string): string | null {
  return Object.prototype.hasOwnProperty.call(STATE_CAVEAT, state)
    ? STATE_CAVEAT[state as ProjectedState]
    : // A state this build cannot name is not one it may present as current.
      "State unknown — open the source directly"
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How old a source is, in words, from its own version time.
 *
 * Relative rather than a formatted date on purpose. Both client consumers run
 * without the viewer's institution time zone (`formatInZone` needs one), and an
 * absolute date rendered in whatever zone the browser happens to be in is a
 * freshness claim this platform did not make. "14 months ago" is true in every
 * zone, and it is the fact a reader is actually weighing.
 *
 * `now` is a parameter and not `new Date()` so the wording is testable without
 * freezing the clock, and so one response cannot render two different "now"s.
 *
 * An unreadable instant says so rather than rendering "just now", which is the
 * failure direction that matters: `freshnessOf` already fails closed to STALE
 * for the same input, and the label must not contradict the verdict beside it.
 */
export function ageLabel(versionAt: string, now: Date): string {
  const at = Date.parse(versionAt)
  if (Number.isNaN(at) || Number.isNaN(now.getTime())) return "age unknown"
  const elapsed = now.getTime() - at
  if (elapsed < 0) return "updated just now"
  const days = Math.floor(elapsed / DAY_MS)
  if (days < 1) return "updated today"
  if (days === 1) return "updated yesterday"
  if (days < 30) return `updated ${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `updated ${months} month${months === 1 ? "" : "s"} ago`
  const years = Math.floor(days / 365)
  return `updated ${years} year${years === 1 ? "" : "s"} ago`
}

/**
 * Which system holds the source, and whether this is the record or a copy.
 *
 * The §9.3 distinction between "source text" and "Tenure record": every row in
 * this corpus is currently Tenure's own (`TENURE_PROVIDER`), and saying so
 * plainly is what makes the first connector-backed row visibly different rather
 * than silently identical.
 */
export function originLabel(provider: string, assertion: string): string {
  const holder = provider === "tenure" ? "Tenure" : provider
  return assertion === "RECORD" ? `${holder} record` : `${holder} projection`
}

/** The whole citation for one numbered source, as one line of text. */
export function citationLine(
  citation: { ref: { provider: string }; assertion: string; versionAt: string; state: string },
  now: Date,
): string {
  const caveat = stateCaveat(citation.state)
  return (
    `${originLabel(citation.ref.provider, citation.assertion)} · ` +
    `${ageLabel(citation.versionAt, now)}${caveat ? ` · ${caveat}` : ""}`
  )
}

/**
 * The sentence that separates a retrieved record from the assistant's own
 * reasoning, for the reader.
 *
 * `citationRules()` already tells the MODEL to write "(inference)" on a claim it
 * cannot trace, and a rule the model may or may not follow is not a distinction
 * the reader can rely on. This is the half the platform can guarantee: the
 * numbered list below the prose is the retrieved records, and the prose is
 * Relay's synthesis of them. Platform-authored — no tenant text is interpolated.
 */
export const INFERENCE_NOTE =
  "Written by Relay from the numbered Tenure records below. A sentence with no bracketed " +
  "source number is Relay's own inference, not a Tenure record."

/**
 * What to say about rows that matched and may not be answered from.
 *
 * Beside `INFERENCE_NOTE` because they are the same obligation from two sides:
 * one says the prose may exceed the records, the other says the records are not
 * all of what matched. A cancelled event that is silently absent reads as "there
 * is no such event", which is a different and untrue statement.
 */
export const WITHHELD_NOTE =
  "These matched your search and cannot be answered from. Open them directly."
