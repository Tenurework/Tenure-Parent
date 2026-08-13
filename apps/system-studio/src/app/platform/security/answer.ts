/**
 * What `/platform/security` says, decided as data rather than in JSX.
 *
 * ── Why this is a module and not a few ternaries in the page ────────────────
 *
 * The page's job is to lead with the answer. "The answer" on a security surface
 * is a decision with an ORDER in it — a read that never happened outranks
 * everything, six products that are switched off outrank an empty findings
 * list, and an open CRITICAL outranks a count — and an order written as nested
 * ternaries inside a render is an order nothing can test.
 *
 * Everything here is pure. The only imports are TYPES, which the compiler
 * erases, so nothing in this file pulls `lib/aws/findings.ts` (and through it
 * `server-only`, the SDK clients and a live gateway) into the module graph.
 * That is what lets `e2e/security-page-logic.spec.ts` drive every branch at the
 * node level with no browser, no server and no AWS account — including the four
 * branches a browser pointed at a healthy estate can never reach.
 *
 * `SEVERITY_SLA_HOURS` is deliberately a PARAMETER of `slaRows` rather than an
 * import for the same reason: it is a value, and importing a value out of
 * `findings.ts` would drag the whole gateway in behind it.
 *
 * ── The one rule the ordering encodes ───────────────────────────────────────
 *
 * A page must never report an estate it was not allowed to look at, and must
 * never report six switched-off products as a clean bill of health. So
 * `leadAnswer` checks, in order:
 *
 *   1. did the read answer at all       — if not, nothing below it is knowable
 *   2. did any source answer            — nothing is looking, which is not "clear"
 *   3. is anything CRITICAL open        — the loudest thing that is true
 *   4. is anything past its SLA         — open longer than its severity allows
 *   5. is anything open at all          — the count, and the worst severity in it
 *   6. otherwise                        — clear, and it names how many answered
 *
 * Step 2 is the one that is easy to leave out and is the one that matters most:
 * when Security Hub is not enabled the reader returns an empty list through a
 * SUCCESSFUL read, and a page that renders that as "no open findings" has told
 * an operator that an unwatched account is a clean one.
 */

import type { FindingSource, SecurityFinding, Severity, SourceState } from "../../../lib/aws/findings"

/* ─────────────────────────────────────────────────────────────── tone ──── */

/** The tone vocabulary `components/md3/Badge.tsx` accepts. */
export type Tone = "neutral" | "info" | "ok" | "warn" | "bad"

/**
 * A tone per severity — and the tone is never the carrier of the meaning.
 *
 * Bible §26.3.2 forbids meaning conveyed by colour alone and this palette is
 * desaturated on purpose, so every badge on this page prints the severity word
 * beside the tone. This table decides how loud, not what.
 *
 * `INFORMATIONAL` is `neutral` rather than `info`: `info` is the tertiary
 * family and reads as "a fact worth noticing", and a product's own
 * informational label is the one severity that is explicitly not.
 */
export const SEVERITY_TONE: Readonly<Record<Severity, Tone>> = {
  CRITICAL: "bad",
  HIGH: "bad",
  MEDIUM: "warn",
  LOW: "info",
  INFORMATIONAL: "neutral",
}

/**
 * A tone per source state.
 *
 * `UNKNOWN` is `warn` rather than `bad`, and it is the same distinction
 * `components/states.tsx` draws between `unknown` and `error`: nothing is
 * broken, this engine simply was not allowed to look, and the operator's next
 * move is an IAM statement rather than an incident.
 *
 * `NOT_ENABLED` is `warn` too, and for a different reason worth stating: a
 * product that is switched off is not a failure of this console, it is a fact
 * about the estate — but it is never `ok`, because a source that cannot report
 * is indistinguishable from a source with nothing to report.
 */
export const SOURCE_TONE: Readonly<Record<SourceState, Tone>> = {
  AGGREGATED: "ok",
  DIRECT: "ok",
  NOT_ENABLED: "warn",
  UNKNOWN: "warn",
}

/**
 * Worst first.
 *
 * The order the findings table is sorted in, and it is deliberately the
 * severity ladder rather than the order Security Hub happened to paginate in.
 */
export const SEVERITY_RANK: readonly Severity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFORMATIONAL",
]

function rankOf(severity: Severity): number {
  const at = SEVERITY_RANK.indexOf(severity)
  // A severity added to the union and forgotten here sorts LAST rather than
  // first. Sorting an unclassified severity to the top would put a row nobody
  // has ranked above an open CRITICAL.
  return at === -1 ? SEVERITY_RANK.length : at
}

/* ──────────────────────────────────────────────────────────── counting ──── */

/** How many findings carry each severity. Every severity is present, including zeroes. */
export function countBySeverity(
  findings: readonly SecurityFinding[],
): Readonly<Record<Severity, number>> {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFORMATIONAL: 0 }
  for (const finding of findings) counts[finding.severity] += 1
  return counts
}

/** How many are open past the hours their severity allows. */
export function countPastSla(findings: readonly SecurityFinding[]): number {
  return findings.filter((finding) => finding.pastSla).length
}

/**
 * The sources that actually answered.
 *
 * `AGGREGATED` and `DIRECT` are the two states in which a product reported.
 * Written as a positive list rather than as `!== "UNKNOWN"`, because the
 * failure mode of the negative form is silent: a seventh source state added
 * later would count as "answered" by default, and the arm it would land in is
 * the one that prints a clean bill of health.
 */
export function answeredSources(
  sources: readonly FindingSource[],
): readonly FindingSource[] {
  return sources.filter((source) => source.state === "AGGREGATED" || source.state === "DIRECT")
}

/**
 * Worst first, then oldest, then by key.
 *
 * The last tiebreak is what makes two loads of an unchanged estate draw the
 * same page. It compares with `<` and `>` rather than `localeCompare`, which is
 * locale-dependent and would order the same two findings differently on two
 * machines.
 */
export function sortFindings(
  findings: readonly SecurityFinding[],
): readonly SecurityFinding[] {
  return findings.slice().sort((a, b) => {
    const bySeverity = rankOf(a.severity) - rankOf(b.severity)
    if (bySeverity !== 0) return bySeverity
    // Past its SLA first inside a severity band: same severity, but one of them
    // has already broken the promise this console makes about it.
    if (a.pastSla !== b.pastSla) return a.pastSla ? -1 : 1
    if (a.ageHours !== b.ageHours) return b.ageHours - a.ageHours
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}

/* ────────────────────────────────────────────────────────── the answer ──── */

export interface LeadAnswer {
  /** The word in the badge. Never the only carrier of the meaning. */
  verdict: string
  tone: Tone
  /** One sentence, in the operator's language, saying what is true right now. */
  headline: string
  /** Why the verdict is what it is. Never null — every arm here has a because. */
  because: string
}

/**
 * The states of `AwsRead` in which the findings mean anything.
 *
 * `ACTUAL` and `STALE` carry a value; `EMPTY` is a successful read of nothing.
 * Every other arm — DENIED, THROTTLED, UNCONFIGURED, ERROR — means the question
 * was not answered, and an answer derived from zero findings in those cases
 * would be a claim nobody made.
 */
const ANSWERED = new Set(["ACTUAL", "STALE", "EMPTY"])

export function readAnswered(readState: string): boolean {
  return ANSWERED.has(readState)
}

/**
 * The one thing an operator opened this page to learn.
 *
 * Both arguments are needed and neither is sufficient. `securityFindings`
 * returns an empty list both when the estate is clean and when Security Hub is
 * switched off — the second case comes back as a successful read — so the
 * findings alone cannot tell those apart, and the sources alone cannot tell a
 * clean estate from one with an open CRITICAL.
 */
export function leadAnswer(
  readState: string,
  findings: readonly SecurityFinding[],
  sources: readonly FindingSource[],
): LeadAnswer {
  if (!readAnswered(readState)) {
    return {
      verdict: "Unknown",
      tone: "warn",
      headline:
        "Nothing is known about this account's security findings. The read did not answer, so an estate with nothing open and an estate with an open CRITICAL look identical from here.",
      because: `securityhub:GetFindings came back ${readState}, and no findings table is drawn — an empty table under this heading would read as "there are none", which is the one thing this page must never say about an estate it could not look at. The panel below names the principal, the action and the minimum statement that would fix it.`,
    }
  }

  const answered = answeredSources(sources)
  if (answered.length === 0) {
    const notEnabled = sources.filter((source) => source.state === "NOT_ENABLED").length
    return {
      verdict: "Nothing is looking",
      tone: "warn",
      headline: `The read succeeded and none of ${sources.length} security product${sources.length === 1 ? "" : "s"} reported into it.`,
      because:
        notEnabled === sources.length
          ? "Security Hub is not enabled in this account, and the other five products publish through it — so this is an account nothing is inspecting, not an account with nothing wrong. The sources card names each one."
          : "No source reached a state in which it could report, so an empty findings list here is an absence of reporting rather than an absence of findings. The sources card names each one and what it said.",
    }
  }

  const counts = countBySeverity(findings)
  const pastSla = countPastSla(findings)
  const answeredNote =
    answered.length === sources.length
      ? `All ${sources.length} sources answered.`
      : `${answered.length} of ${sources.length} sources answered; the rest are named in the sources card, and anything they hold is not counted here.`

  if (counts.CRITICAL > 0) {
    return {
      verdict: "Critical open",
      tone: "bad",
      headline: `${counts.CRITICAL} CRITICAL finding${counts.CRITICAL === 1 ? " is" : "s are"} open in this account.`,
      because: `${pastSla > 0 ? `${pastSla} of the ${findings.length} open finding${findings.length === 1 ? "" : "s"} ${pastSla === 1 ? "is" : "are"} already past the hours its severity allows. ` : ""}${answeredNote} Everything else on this page is context for that.`,
    }
  }

  if (pastSla > 0) {
    return {
      verdict: "Past SLA",
      tone: "bad",
      headline: `Nothing CRITICAL is open, and ${pastSla} finding${pastSla === 1 ? " has" : "s have"} been open longer than the hours its severity allows.`,
      because: `${findings.length} finding${findings.length === 1 ? " is" : "s are"} open in total. ${answeredNote} An age past its band is a promise this console already broke, whatever the severity says.`,
    }
  }

  if (findings.length > 0) {
    const worst = SEVERITY_RANK.find((severity) => counts[severity] > 0) ?? "INFORMATIONAL"
    return {
      verdict: "Open findings",
      tone: "warn",
      headline: `${findings.length} finding${findings.length === 1 ? " is" : "s are"} open, the worst of them ${worst}, and every one of them is still inside the hours its severity allows.`,
      because: `${answeredNote} Severity is the product's own label and never a guess from a numeric score, so this is what the products said rather than what this console inferred.`,
    }
  }

  return {
    verdict: "Clear",
    tone: answered.length === sources.length ? "ok" : "warn",
    headline: `${answered.length} of ${sources.length} security product${sources.length === 1 ? "" : "s"} reported, and none of them has an open finding for this account.`,
    because:
      answered.length === sources.length
        ? "Every source answered, so this is coverage rather than an absence of bad news."
        : "This is a clean result from the sources that answered and says nothing at all about the ones that did not. The sources card names them.",
  }
}

/* ─────────────────────────────────────────────────────────────── SLA ───── */

export interface SlaRow {
  severity: Severity
  /** The limit, in words. Never a bare number, and never `Infinity`. */
  limit: string
}

/**
 * How long each severity may stay open, as a table an operator can read.
 *
 * The map is a parameter rather than an import so this module stays free of
 * runtime dependencies — see the header. `INFORMATIONAL` is
 * `Number.POSITIVE_INFINITY` in that map, and printing that verbatim is how a
 * table ends up with the word "Infinity" in it; the arm below says what the
 * number means instead.
 */
export function slaRows(hours: Readonly<Record<Severity, number>>): readonly SlaRow[] {
  return SEVERITY_RANK.map((severity) => {
    const limit = hours[severity]
    return {
      severity,
      limit: Number.isFinite(limit)
        ? `${limit}h — ${Math.round(limit / 24)} day${Math.round(limit / 24) === 1 ? "" : "s"}`
        : "no limit — an informational finding is never past an SLA",
    }
  })
}

/* ─────────────────────────────────────────────────────────── as of ────── */

/**
 * The sentence a panel ends with.
 *
 * Every panel on this page says when what it shows was true. A panel with no
 * as-of is a set of claims that were correct at some point, and an operator
 * cannot tell it from one that stopped refreshing — which is the difference
 * between an outage and a stale tab.
 */
export function asOf(at: string | null): string {
  if (at === null || at.trim() === "") {
    return "As of an unknown time — nothing recorded when this was read."
  }
  return `As of ${at}.`
}

/** A panel's supporting line: what it is, then when it was true. */
export function statedAsOf(what: string, at: string | null): string {
  const trimmed = what.trim()
  const sentence = trimmed.endsWith(".") ? trimmed : `${trimmed}.`
  return `${sentence} ${asOf(at)}`
}

/* ────────────────────────────────────────────────────── where it came from */

/** One row of the provenance list: a fact, and whether it is known. */
export interface Fact {
  label: string
  value: string
}

function orUnknown(value: string | null | undefined, why: string): string {
  return value && value.trim() !== "" ? value : `Not known — ${why}`
}

function identityWhy(identityState: string): string {
  return identityState === "ACTUAL" || identityState === "STALE"
    ? "the identity read answered but did not carry it"
    : `sts:GetCallerIdentity came back ${identityState}, so this console has no estate to name`
}

export interface Scope {
  identityState: string
  accountId?: string | null
  region?: string | null
  partition?: string | null
  principal?: string | null
}

/**
 * Which estate this page is describing, at the top and without scrolling.
 *
 * Three facts, and an unknown is spelled out rather than defaulted. The console
 * refuses to boot without `AWS_ACCOUNT_ID` and `AWS_PARTITION` precisely so it
 * never invents an estate, and printing a plausible-looking account number here
 * would undo that at the last step.
 */
export function scopeOf(scope: Scope): readonly Fact[] {
  const why = identityWhy(scope.identityState)
  return [
    { label: "Account", value: orUnknown(scope.accountId, why) },
    { label: "Region", value: orUnknown(scope.region, why) },
    { label: "Partition", value: orUnknown(scope.partition, why) },
  ]
}

/**
 * The one line the lead prints when the estate itself is not known.
 *
 * The chip row is for three short facts. When the identity read did not answer
 * every one of them becomes a sentence, and three sentences in three pills is
 * how a 320px viewport draws one over the next — so the page swaps the row for
 * this, and the same reason is repeated as a labelled fact in the provenance
 * card. It names the read and the remedy rather than printing "unknown" three
 * times, which is a word an operator cannot act on.
 */
export function scopeSentence(scope: Scope): string {
  return (
    `This console cannot say which estate it is describing — ${identityWhy(scope.identityState)}. ` +
    "Account, region and partition are named as unknown throughout this page rather than defaulted to a plausible-looking value."
  )
}

/**
 * What produced this page, in the operator's language.
 *
 * Every value is a string and every unknown is spelled out. The identity read
 * is the only source of account, region, partition and principal.
 */
export function provenanceOf(
  input: Scope & {
    readState: string
    refreshMs: number
    asOf: string | null
    duplicatesRemoved: number
  },
): readonly Fact[] {
  const why = identityWhy(input.identityState)
  return [
    { label: "Read", value: "securityhub:GetFindings, every page, live, following NextToken to the end" },
    { label: "Answer", value: input.readState },
    { label: "Account", value: orUnknown(input.accountId, why) },
    { label: "Region", value: orUnknown(input.region, why) },
    { label: "Partition", value: orUnknown(input.partition, why) },
    { label: "As", value: orUnknown(input.principal, why) },
    { label: "Refreshed", value: `every ${Math.round(input.refreshMs / 60_000)} min` },
    {
      label: "Duplicates collapsed",
      value:
        input.duplicatesRemoved > 0
          ? `${input.duplicatesRemoved} record${input.duplicatesRemoved === 1 ? "" : "s"} — Security Hub re-emits a finding on every update, and the same GuardDuty finding arrives again through the aggregator`
          : "none in this read",
    },
    { label: "This reading", value: asOf(input.asOf) },
  ]
}
