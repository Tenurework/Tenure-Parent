import type { AuditRecord, ChainVerification } from "@tenure/audit"

/**
 * The Evidence surface's decisions, as functions rather than as JSX.
 *
 * ## Why this module exists
 *
 * `page.tsx` is a server component. Nothing can render it without a DynamoDB
 * table, an operator session and a Next.js request scope, which means every
 * judgement it makes inside its own markup is a judgement no test can reach. The
 * three judgements on this page that MUST be provable are:
 *
 *   1. the chain verdict — and specifically that a chain nobody could READ is
 *      never reported as an intact one;
 *   2. the projection of a stored record into the four things an operator asks
 *      of an audit entry: who, what, against what, and how it ended;
 *   3. **that a filter cannot hide a break.** This is the load-bearing one. A
 *      ledger with a search box is a ledger where the most important row on the
 *      page is one query away from being invisible, and "we would never filter
 *      that out" is not a property — it is a hope. Here it is an invariant with
 *      a name (`hiddenBroken`), computed independently of the code that decides
 *      what to show, so a regression in the filter is a failing number rather
 *      than a missing row nobody notices.
 *
 * Nothing here imports React, `@/lib/*`, `next/*` or the AWS SDK. It takes
 * records and returns data, so `entries.test.ts` runs it under apps/web's jest
 * with no server, no table and no session.
 */

/* ── The projection ──────────────────────────────────────────────────────── */

/**
 * Where `src/lib/audit-ledger.ts` puts the console's own fields inside a
 * record's metadata.
 *
 * Restated here rather than imported because `ROW_KEYS` is private to that
 * module and this page is not its owner. The duplication is made safe by the
 * fallbacks below: every one of these has a record-level field behind it, so a
 * key that is renamed there degrades to the record's own `resourceId`,
 * `reason` and `outcome` instead of rendering blank. A record written by a
 * different writer — the lifecycle path, a future one — projects correctly with
 * none of these keys present at all.
 */
const META = {
  target: "_target",
  detail: "_detail",
  outcome: "_outcomeCode",
  phase: "_phase",
  resolves: "_resolves",
} as const

/**
 * How an attempt ended, in the four states an operator has to tell apart.
 *
 * The audit package's own vocabulary is ALLOW and DENY, deliberately small,
 * because that is what a reader across two stores can compare. The other two are
 * facts about the PAIR of records the console writes for one act — an INTENT
 * before the mutating call and an OUTCOME after — and they cannot be read off a
 * single record's `outcome` field at all:
 *
 *   * `BEGUN` — an intent whose outcome row exists. The row records that the act
 *     started; how it ended is the row that closes it. Rendering these as ALLOW
 *     (which is what the record's own `outcome` field carries, because the
 *     package will not build a record without one) would double every successful
 *     act on the page.
 *   * `OPEN` — an intent with NO closing record. The act was begun and this
 *     console cannot say how it ended: what a process that died mid-flight
 *     leaves behind, and the one thing an outcome-only trail cannot express,
 *     because there its silence is indistinguishable from nothing having been
 *     attempted. Never folded into DENY (it is not a refusal) or ALLOW (it is
 *     emphatically not a success).
 */
export type OutcomeKind = "ALLOW" | "DENY" | "OPEN" | "BEGUN"

export interface LedgerEntry {
  /** Stable across renders: chain plus position, or plus digest when unchained. */
  key: string
  /** The chain this record belongs to — a tenant slug, or the platform's own. */
  chain: string
  /** Position in that chain, or null for a record the chain does not cover. */
  sequence: number | null
  /** When the act happened, as recorded. ISO-8601, UTC. */
  at: string
  /** WHO. The principal the ledger recorded, never a display name. */
  actor: string
  /** WHAT. `Resource.Action`, as written. */
  action: string
  /** AGAINST WHAT. */
  target: string
  /** The kind of thing the target is, from the record itself. */
  targetType: string
  /** HOW IT ENDED, in the console's richer vocabulary — `APPLIED`, `REFUSED_*`. */
  outcome: string
  outcomeKind: OutcomeKind
  /** The sentence the writer recorded. Already redacted at write time. */
  detail: string
  /** On an INTENT row: the sequence of the outcome that closed it, if one exists. */
  closedBy: number | null
  /** On an OUTCOME row: the sequence of the intent it closes. */
  resolves: number | null
  /** `sha256:…` over this record's content. The thing `verifyChain` checks. */
  digest: string
  previousDigest: string | null
  /**
   * Why THIS record failed verification, or null when it verified.
   *
   * `CONTENT_ALTERED` or `BROKEN_LINK`, straight from `verifyChain`. Not a
   * boolean: the two mean different things to an operator — one row was edited,
   * versus something between two rows is gone — and a boolean would force the
   * page to look the reason up a second time.
   */
  broken: string | null
}

/**
 * One chain's records, as entries, newest first.
 *
 * Newest first because an operator opens an audit trail to ask "what just
 * happened", and the answer is at the bottom of a chronological list. The chain
 * itself is stored oldest-first — `previousDigest` points at the row that would
 * be ABOVE in that order — so `digest`/`previousDigest` are both rendered on
 * every row rather than relying on adjacency to make the link checkable.
 *
 * `verification` is the one computed over `records`, not a second read. A break
 * list from a different read of the table would mark the wrong rows.
 */
export function projectChain(
  chain: string,
  records: readonly AuditRecord[],
  verification: ChainVerification,
): LedgerEntry[] {
  const breakBySequence = new Map<number, string>()
  /** Unchained records have no sequence, so they are keyed by digest instead. */
  const breakByDigest = new Map<string, string>()
  for (const t of verification.tampered) {
    if (t.sequence === null) breakByDigest.set(t.recordHash, t.reason)
    else breakBySequence.set(t.sequence, t.reason)
  }

  /*
   * Which intents were closed, and by what.
   *
   * Built over the WHOLE chain before any row is projected, because an intent
   * cannot know whether it was resolved by looking at itself — the closing
   * record is a separate row, written later, carrying `_resolves`. Marking every
   * intent OPEN without this pass is the defect that would report every
   * completed act on the page twice: once as a success and once as a process
   * that vanished.
   */
  const closedBy = new Map<number, number>()
  for (const record of records) {
    const resolves = numeric((record.metadata as Record<string, unknown>)[META.resolves])
    if (resolves !== null && record.sequence !== null) closedBy.set(resolves, record.sequence)
  }

  return records
    .map((record) => entryOf(chain, record, breakBySequence, breakByDigest, closedBy))
    .sort(newestFirst)
}

function entryOf(
  chain: string,
  record: AuditRecord,
  breakBySequence: ReadonlyMap<number, string>,
  breakByDigest: ReadonlyMap<string, string>,
  closedByIndex: ReadonlyMap<number, number>,
): LedgerEntry {
  const meta = record.metadata as Record<string, unknown>
  const intent = meta[META.phase] === "INTENT"
  const closedBy = record.sequence === null ? null : (closedByIndex.get(record.sequence) ?? null)
  const open = intent && closedBy === null

  return {
    key: record.sequence === null ? `${chain}:unchained:${record.recordHash}` : `${chain}:${record.sequence}`,
    chain,
    sequence: record.sequence,
    at: record.occurredAt,
    actor: record.actorId,
    action: record.action,
    target: text(meta[META.target]) ?? record.resourceId ?? record.resourceType,
    targetType: record.resourceType,
    // An intent carries `outcome: ALLOW` because the package will not build a
    // record without one. Rendering that would report a crashed act as a success
    // and would count every completed act twice.
    outcome: intent ? (open ? "OPEN" : "begun") : (text(meta[META.outcome]) ?? record.outcome),
    outcomeKind: intent
      ? open
        ? "OPEN"
        : "BEGUN"
      : record.outcome === "ALLOW"
        ? "ALLOW"
        : "DENY",
    detail: text(meta[META.detail]) ?? record.reason ?? "",
    closedBy,
    resolves: numeric(meta[META.resolves]),
    digest: record.recordHash,
    previousDigest: record.previousHash,
    broken:
      record.sequence === null
        ? (breakByDigest.get(record.recordHash) ?? null)
        : (breakBySequence.get(record.sequence) ?? null),
  }
}

/** A metadata value only if it is a non-empty string. Never `"undefined"`. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * A metadata value only if it is a real number.
 *
 * `Number(value)` would turn `undefined` into `NaN` and `""` into `0` — and `0`
 * is a legitimate chain position, so a coerced empty string would claim an
 * outcome closes the head of the chain.
 */
function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * Newest first, and deterministic when two records share an instant.
 *
 * Two acts inside one millisecond is normal — an intent and its outcome on a
 * fast path — and a sort that left them in read order would reorder the page
 * between two loads of an unchanged table. The tiebreak is the chain position,
 * descending, so the outcome row sorts above the intent it closes.
 */
function newestFirst(a: LedgerEntry, b: LedgerEntry): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1
  if (a.chain !== b.chain) return a.chain < b.chain ? -1 : 1
  return (b.sequence ?? -1) - (a.sequence ?? -1)
}

/** Every chain's entries merged into one newest-first trail. */
export function mergeChains(chains: readonly LedgerEntry[][]): LedgerEntry[] {
  return chains.flat().sort(newestFirst)
}

/* ── The filter, and the thing it may never do ───────────────────────────── */

export interface EntryFilter {
  chain: string | null
  actor: string | null
  action: string | null
  outcome: OutcomeKind | null
}

export const NO_FILTER: EntryFilter = { chain: null, actor: null, action: null, outcome: null }

const OUTCOME_KINDS: readonly OutcomeKind[] = ["ALLOW", "DENY", "OPEN", "BEGUN"]

/**
 * A filter from the query string.
 *
 * Everything unrecognised becomes `null` — no filter — rather than a filter
 * matching nothing. A typo'd `?outcome=allowed` that silently emptied the trail
 * would be a URL that hides the ledger, which is the same defect as a filter
 * that hides a break arriving by a different door.
 */
export function parseEntryFilter(
  params: Readonly<Record<string, string | string[] | undefined>>,
): EntryFilter {
  const one = (name: string): string | null => {
    const raw = params[name]
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
    return value ? value : null
  }
  const outcome = one("outcome")
  return {
    chain: one("chain"),
    actor: one("actor"),
    action: one("action"),
    outcome: OUTCOME_KINDS.includes(outcome as OutcomeKind) ? (outcome as OutcomeKind) : null,
  }
}

export function filterIsActive(filter: EntryFilter): boolean {
  return filterTerms(filter).length > 0
}

/** The active clauses, for a sentence that says what is being excluded. */
export function filterTerms(filter: EntryFilter): { field: string; value: string }[] {
  const terms: { field: string; value: string }[] = []
  if (filter.chain) terms.push({ field: "chain", value: filter.chain })
  if (filter.actor) terms.push({ field: "actor", value: filter.actor })
  if (filter.action) terms.push({ field: "action", value: filter.action })
  if (filter.outcome) terms.push({ field: "outcome", value: filter.outcome })
  return terms
}

export interface FilteredEntries {
  /** What the table draws, newest first. */
  shown: LedgerEntry[]
  /** Entries shown even though the filter excludes them, because they are broken. */
  forced: LedgerEntry[]
  /** Matched nothing in the filter, and verified, so not listed. */
  hiddenByFilter: number
  /** Matched the filter, verified, and fell off the end of the cap. */
  hiddenByLimit: number
  /**
   * Broken entries that are not on the page. **This must be zero, always.**
   *
   * Counted from `entries` against `shown` rather than derived from the logic
   * that built `shown`, so the two cannot agree with each other while both being
   * wrong. The page renders it, loudly, if it is ever not zero — a silent
   * invariant is one nobody finds out has broken.
   */
  hiddenBroken: number
  active: boolean
  terms: { field: string; value: string }[]
  /** Entries considered, before anything was excluded. */
  total: number
}

/**
 * Apply the filter and the cap, and account for everything left out.
 *
 * Two rules, and the second is the reason this function is not three lines of
 * `Array.filter`:
 *
 *   * a broken entry is ALWAYS shown, whatever the filter says and whatever the
 *     cap is, and is reported in `forced` so the page can mark it as kept
 *     against the filter rather than pretending it matched;
 *   * everything excluded is COUNTED and the counts are separated by cause,
 *     because "your filter excluded 41" and "40 older entries did not fit" are
 *     different sentences with different next actions.
 *
 * The cap exists because a chain has no upper bound and a page that renders
 * every record of a years-old ledger is a page that does not render. It is the
 * newest `limit` that survive — but only after every broken entry has taken its
 * seat, so a break from three years ago is on the page above a cap of twenty.
 */
export function filterEntries(
  entries: readonly LedgerEntry[],
  filter: EntryFilter,
  limit: number,
): FilteredEntries {
  const matches = (e: LedgerEntry): boolean =>
    (filter.chain === null || e.chain === filter.chain) &&
    (filter.actor === null || e.actor === filter.actor) &&
    (filter.action === null || e.action === filter.action) &&
    (filter.outcome === null || e.outcomeKind === filter.outcome)

  const forced: LedgerEntry[] = []
  const candidates: LedgerEntry[] = []
  let hiddenByFilter = 0

  for (const entry of entries) {
    if (matches(entry)) {
      candidates.push(entry)
    } else if (entry.broken !== null) {
      // Excluded by the filter, kept anyway. This is the whole point.
      candidates.push(entry)
      forced.push(entry)
    } else {
      hiddenByFilter++
    }
  }

  // Seat every break first, then fill the remaining room with the newest of the
  // rest. `candidates` is already newest-first, so the second pass is in order.
  const kept = new Set<LedgerEntry>()
  for (const entry of candidates) if (entry.broken !== null) kept.add(entry)
  let room = Math.max(0, limit - kept.size)
  for (const entry of candidates) {
    if (kept.has(entry)) continue
    if (room === 0) break
    kept.add(entry)
    room--
  }

  const shown = candidates.filter((entry) => kept.has(entry))

  return {
    shown,
    forced,
    hiddenByFilter,
    hiddenByLimit: candidates.length - shown.length,
    // Independently computed, against the finished output.
    hiddenBroken: entries.filter((e) => e.broken !== null && !kept.has(e)).length,
    active: filterIsActive(filter),
    terms: filterTerms(filter),
    total: entries.length,
  }
}

/**
 * What the filter left out, in a sentence, always rendered.
 *
 * Rendered even when nothing is filtered, because "no filter is applied" is the
 * fact that makes the list below trustworthy, and a page that only speaks up
 * when something IS hidden is a page where the absence of a warning is
 * indistinguishable from the absence of the code that would write one.
 */
export function exclusionSentence(result: FilteredEntries): string {
  const parts: string[] = []

  if (result.active) {
    const clauses = result.terms.map((t) => `${t.field} = ${t.value}`).join(", ")
    parts.push(`Filtered by ${clauses}.`)
  } else {
    parts.push("No filter is applied.")
  }

  if (result.hiddenByFilter === 0 && result.hiddenByLimit === 0) {
    parts.push(`All ${result.total} entries read from the ledger are listed.`)
  } else {
    parts.push(`${result.shown.length} of ${result.total} entries are listed.`)
    if (result.hiddenByFilter > 0) {
      parts.push(`${result.hiddenByFilter} were excluded by the filter.`)
    }
    if (result.hiddenByLimit > 0) {
      parts.push(`${result.hiddenByLimit} older entries matched but did not fit on this page.`)
    }
  }

  if (result.forced.length > 0) {
    parts.push(
      `${result.forced.length} entries that failed verification are listed regardless of the ` +
        "filter: a filter must not be able to hide a break.",
    )
  }

  return parts.join(" ")
}

/* ── The verdict ─────────────────────────────────────────────────────────── */

/**
 * What the page knows about the chains, before it decides what to say.
 *
 * `unreadable` is separate from `broken` and that separation is the entire
 * reason this is a function with a test. A chain whose read threw has `ok:
 * false` on a verification of zero records, so counting it as broken overstates
 * a tamper, and counting it as fine understates a blind spot. It is neither.
 */
export interface ChainCounts {
  /** Chains this page attempted — one per tenant, plus the platform's own. */
  attempted: number
  /** Of those, the ones that came back. */
  readable: number
  /** Of the readable ones, the ones holding at least one record or hold. */
  written: number
  /** Of the readable ones, the ones `verifyChain` says do not verify. */
  broken: number
  /** Records across every readable chain. */
  records: number
}

export interface ChainVerdict {
  /** The badge word. */
  word: string
  tone: "ok" | "bad" | "warn"
  /** The card headline — the answer, in a sentence. */
  headline: string
  /**
   * Whether the page can claim the record is unaltered.
   *
   * False whenever anything is broken OR anything could not be read. The second
   * half is the one that was wrong before: a chain nobody could read proves
   * nothing, and a page that says "intact" over it is a page that would have
   * said "intact" while the table was being emptied.
   */
  proven: boolean
}

export function chainVerdict(counts: ChainCounts): ChainVerdict {
  const unreadable = counts.attempted - counts.readable

  if (counts.broken > 0) {
    return {
      word: `${counts.broken} broken`,
      tone: "bad",
      headline: `No — ${counts.broken} of ${counts.written} chains no longer verify`,
      proven: false,
    }
  }

  if (unreadable > 0) {
    return {
      word: `${unreadable} unreadable`,
      tone: "warn",
      headline:
        `Not fully — every chain that could be read verifies, but ${unreadable} of ` +
        `${counts.attempted} could not be read`,
      proven: false,
    }
  }

  if (counts.written === 0) {
    return {
      word: "nothing recorded",
      tone: "warn",
      headline: "Nothing has been recorded through this console yet",
      proven: false,
    }
  }

  return {
    word: "intact",
    tone: "ok",
    headline:
      `Yes — all ${counts.written} chains verify, ${counts.records} records, ` +
      "none altered and none missing",
    proven: true,
  }
}

/**
 * A timestamp a reader can compare against a clock, from the ISO string.
 *
 * Sliced rather than formatted through `Intl`: a locale-dependent rendering is a
 * different string on a different machine, and this stamp is the thing an
 * operator quotes in an incident channel. UTC because the estate is.
 */
export function asOfLabel(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

/** A digest short enough to compare by eye, without pretending to be the whole. */
export function shortDigest(digest: string | null): string {
  if (digest === null) return "none — head of the chain"
  const body = digest.startsWith("sha256:") ? digest.slice(7) : digest
  return `${body.slice(0, 12)}…`
}

const alphabetical = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** The distinct values of one field, sorted, for a filter's options. */
export function distinct(entries: readonly LedgerEntry[], of: (e: LedgerEntry) => string): string[] {
  return [...new Set(entries.map(of))].sort(alphabetical)
}

/**
 * A filter control's options, including whatever the filter is currently set to.
 *
 * The options come from the entries that were read, so a filter naming an actor
 * who has no surviving entries — a URL somebody pasted, a chain whose records
 * all expired — would otherwise not be among them, and the native `<select>`
 * would fall back to displaying its first option. The control would then read
 * "Anyone" while the page was filtering by somebody, which is the control lying
 * about the state of the page it sits on.
 */
export function optionsFor(values: readonly string[], active: string | null): string[] {
  if (active === null || values.includes(active)) return [...values]
  return [...values, active].sort(alphabetical)
}
