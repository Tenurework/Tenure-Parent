/**
 * What `/platform/health` says, decided as data rather than in JSX.
 *
 * ── Why this is a module and not a few ternaries in the page ────────────────
 *
 * The page's job is to lead with the answer. "The answer" is a decision with an
 * ORDER in it — a firing alarm outranks a muted one, a muted one outranks a
 * quiet one, and a read that never happened outranks all of them — and an order
 * expressed as nested ternaries inside a render is an order nothing can test.
 * Everything here is pure: no AWS client, no `server-only`, no React. The only
 * imports are types, which the compiler erases, so `e2e/health-page-logic.spec.ts`
 * can drive every branch at the node level with no browser and no estate.
 *
 * ── The one rule the ordering encodes ───────────────────────────────────────
 *
 * `lib/aws/alarms.ts` already decided that DISABLED outranks OK for a single
 * alarm. This decides the same thing for the PAGE: a page whose headline reads
 * "healthy" while four alarms have their actions switched off is the same lie
 * one row up. So `leadAnswer` checks, in order:
 *
 *   1. did the read answer at all      — if not, nothing below it is knowable
 *   2. is anything firing              — the only thing that is happening now
 *   3. would anything fail to tell us  — missing, or created and muted
 *   4. is anything uncertain           — stale, or never enough data points
 *   5. is anything watching at all     — a successful read of zero alarms
 *   6. otherwise                       — healthy, and it names the count
 *
 * Step 5 is the one that is easy to leave out and is the one that matters most
 * on a young estate: `DescribeAlarms` returning an empty list is a SUCCESSFUL
 * read, and a page that renders it as "nothing wrong" has told an operator that
 * an unmonitored account is a healthy one.
 */

import type { AlarmRow, AlarmVerdict } from "../../../lib/aws/alarms"

/* ─────────────────────────────────────────────────────────────── tone ──── */

/** The tone vocabulary `components/md3/Badge.tsx` accepts. */
export type VerdictTone = "neutral" | "info" | "ok" | "warn" | "bad"

/**
 * A tone per verdict — and the tone is never the carrier of the meaning.
 *
 * Bible §26.3.2 forbids meaning conveyed by colour alone, and this palette is
 * desaturated on purpose, so every badge on this page prints `ALARM_WORDS[v]`
 * beside the tone. This table decides how loud, not what.
 *
 * `UNAUTHORIZED` is `warn` rather than `bad` on purpose, and it is the same
 * distinction `components/states.tsx` draws between `unknown` and `error`:
 * nothing is broken, this engine simply was not allowed to look, and the next
 * move is an IAM statement rather than an incident.
 */
export const VERDICT_TONE: Readonly<Record<AlarmVerdict, VerdictTone>> = {
  OK: "ok",
  ALARM: "bad",
  INSUFFICIENT_DATA: "warn",
  DISABLED: "bad",
  STALE: "warn",
  MISSING: "bad",
  UNAUTHORIZED: "warn",
}

/**
 * Worst first.
 *
 * The order the "needs attention" table is sorted in, and it is deliberately
 * not `ALARM_VERDICTS`' declaration order: that array is grouped by where the
 * verdict came from (three CloudWatch returns, then four this console derives),
 * which is a fact about the implementation. This is a fact about the operator's
 * morning.
 */
export const VERDICT_RANK: readonly AlarmVerdict[] = [
  "ALARM",
  "MISSING",
  "DISABLED",
  "UNAUTHORIZED",
  "STALE",
  "INSUFFICIENT_DATA",
  "OK",
]

function rankOf(verdict: AlarmVerdict): number {
  const at = VERDICT_RANK.indexOf(verdict)
  // A verdict added to `ALARM_VERDICTS` and forgotten here sorts LAST rather
  // than first. Sorting an unknown verdict to the top would put a row nobody
  // has classified above a firing alarm.
  return at === -1 ? VERDICT_RANK.length : at
}

/* ──────────────────────────────────────────────────────────── counting ──── */

/** How many rows carry each verdict. Every verdict is present, including zeroes. */
export function countByVerdict(rows: readonly AlarmRow[]): Readonly<Record<AlarmVerdict, number>> {
  const counts = {
    OK: 0,
    ALARM: 0,
    INSUFFICIENT_DATA: 0,
    DISABLED: 0,
    STALE: 0,
    MISSING: 0,
    UNAUTHORIZED: 0,
  }
  for (const row of rows) counts[row.verdict] += 1
  return counts
}

/**
 * The two tables the page draws.
 *
 * The split is `verdict !== "OK"`, not a list of "bad" verdicts. A list would
 * have to be extended every time `ALARM_VERDICTS` grows, and the failure mode
 * of forgetting is silent: the new verdict lands in "watching quietly", which
 * is the half nobody reads.
 *
 * Both halves are sorted by rank then by name, so the order is a function of
 * the data and not of the order CloudWatch happened to paginate in — two loads
 * of an unchanged estate draw the same page.
 */
export function partitionAlarms(rows: readonly AlarmRow[]): {
  attention: readonly AlarmRow[]
  quiet: readonly AlarmRow[]
} {
  const sort = (a: AlarmRow, b: AlarmRow) =>
    rankOf(a.verdict) - rankOf(b.verdict) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

  return {
    attention: rows.filter((row) => row.verdict !== "OK").slice().sort(sort),
    quiet: rows.filter((row) => row.verdict === "OK").slice().sort(sort),
  }
}

/* ────────────────────────────────────────────────────────── the answer ──── */

export interface LeadAnswer {
  /** The word in the badge. Never the only carrier of the meaning. */
  verdict: string
  tone: VerdictTone
  /** One sentence, in the operator's language, saying what is true right now. */
  headline: string
  /** Why the verdict is what it is, or null when the headline says everything. */
  because: string | null
}

/**
 * The states of `AwsRead` in which the rows mean anything.
 *
 * `ACTUAL` and `STALE` carry a value; `EMPTY` is a successful read of nothing,
 * which is a fact about the estate. Every other arm — DENIED, THROTTLED,
 * UNCONFIGURED, ERROR — means the question was not answered, and an answer
 * derived from zero rows in those cases would be a claim nobody made.
 */
const ANSWERED = new Set(["ACTUAL", "STALE", "EMPTY"])

export function readAnswered(readState: string): boolean {
  return ANSWERED.has(readState)
}

/**
 * The one thing an operator opened this page to learn.
 *
 * `readState` is the `AwsRead` arm and `rows` is what the surface produced. Both
 * are needed: `alarmSurface` synthesises a single UNAUTHORIZED row on denial
 * rather than returning an empty list, so rows alone cannot tell a refused read
 * from a quiet estate, and a read state alone cannot tell a firing alarm from a
 * healthy one.
 */
export function leadAnswer(readState: string, rows: readonly AlarmRow[]): LeadAnswer {
  const counts = countByVerdict(rows)

  if (!readAnswered(readState)) {
    return {
      verdict: "Unknown",
      tone: "warn",
      headline:
        "Nothing is known about this account's alarms. The read did not answer, so neither a firing alarm nor a quiet estate can be ruled out.",
      because: `cloudwatch:DescribeAlarms came back ${readState}. The panel at the foot of this card names the principal, the action and the statement that would fix it.`,
    }
  }

  if (counts.ALARM > 0) {
    return {
      verdict: "Firing",
      tone: "bad",
      headline: `${counts.ALARM} alarm${counts.ALARM === 1 ? " is" : "s are"} firing right now.`,
      because: "Everything else on this page is context for that.",
    }
  }

  const unheard = counts.MISSING + counts.DISABLED
  if (unheard > 0) {
    const parts: string[] = []
    if (counts.MISSING > 0) {
      parts.push(
        `${counts.MISSING} declared in the estate's Terraform and absent from a successful DescribeAlarms response`,
      )
    }
    if (counts.DISABLED > 0) {
      parts.push(`${counts.DISABLED} that exist with their actions switched off`)
    }
    return {
      verdict: "Nobody would be told",
      tone: "bad",
      headline: `Nothing is firing, and ${unheard} alarm${unheard === 1 ? "" : "s"} would not tell anybody if it did.`,
      because: `${parts.join(", and ")}. An alarm in OK whose actions are off protects nothing, whatever its metric says.`,
    }
  }

  const uncertain = counts.STALE + counts.INSUFFICIENT_DATA
  if (uncertain > 0) {
    const parts: string[] = []
    if (counts.STALE > 0) {
      parts.push(`${counts.STALE} has not changed state for longer than this surface allows`)
    }
    if (counts.INSUFFICIENT_DATA > 0) {
      parts.push(`${counts.INSUFFICIENT_DATA} has never had enough data points to evaluate`)
    }
    return {
      verdict: "Not certain",
      tone: "warn",
      headline: `Nothing is firing, and ${uncertain} alarm${uncertain === 1 ? " is" : "s are"} not reporting anything that can be trusted.`,
      because: `${parts.join("; ")}. A metric that stopped being published leaves its alarm in OK forever, which is why neither counts as healthy here.`,
    }
  }

  if (rows.length === 0) {
    return {
      verdict: "Nothing is watching",
      tone: "warn",
      headline:
        "CloudWatch answered successfully and this account has no alarms at all, and none is expected of it.",
      because:
        "This is a real absence rather than a refusal — and an account nothing is watching is not the same as an account with nothing wrong.",
    }
  }

  return {
    verdict: "Healthy",
    tone: "ok",
    headline: `All ${rows.length} alarm${rows.length === 1 ? "" : "s"} in this account are in OK, with their actions enabled and their state recently evaluated.`,
    because:
      "Every alarm the estate's Terraform declares was found in the response, so this is coverage rather than an absence of bad news.",
  }
}

/* ──────────────────────────────────────────────────────────── coverage ──── */

/**
 * Whether this console can say what the estate is SUPPOSED to have.
 *
 * `expectedAlarmNames()` parses `infrastructure/terraform/cloudwatch.tf`, and
 * the container image ships the app rather than the Terraform — so in
 * production the expectation is frequently empty. That is not "coverage is
 * complete"; it is "coverage is unknown", and the two have opposite next
 * actions. `known: false` is what makes the page say so out loud instead of
 * printing a reassuring zero.
 */
export interface Coverage {
  known: boolean
  /** How many alarms the Terraform declares, when that is knowable. */
  declared: number
  /** How many of those a successful response actually contained. */
  present: number
  /** How many were declared and not found. */
  missing: number
  /** When `known` is false, why — and what would make it knowable. */
  because: string | null
}

export function coverageOf(
  expected: readonly string[],
  rows: readonly AlarmRow[],
  readState: string,
): Coverage {
  if (!readAnswered(readState)) {
    return {
      known: false,
      declared: expected.length,
      present: 0,
      missing: 0,
      because:
        "The alarm read did not answer, so nothing can be compared against it. A MISSING verdict is only ever produced from a successful response, which is what stops this console describing an estate it was refused.",
    }
  }

  if (expected.length === 0) {
    return {
      known: false,
      declared: 0,
      present: 0,
      missing: 0,
      because:
        "This console holds no declaration of what alarms this estate should have, so it cannot tell a complete estate from an unmonitored one. It reads them from infrastructure/terraform/cloudwatch.tf with ${local.name_prefix} resolved from NAME_PREFIX; the container image ships the application and not the Terraform, so either mount that file or set NAME_PREFIX where it is already mounted.",
    }
  }

  const missing = rows.filter((row) => row.verdict === "MISSING").length
  return {
    known: true,
    declared: expected.length,
    present: expected.length - missing,
    missing,
    because: null,
  }
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
export interface Provenance {
  label: string
  value: string
}

/**
 * What produced this page, in the operator's language.
 *
 * Every value is a string and every unknown is spelled out. The identity read
 * is the only source of account, region and partition — this console will not
 * boot with an invented estate, and it will not print one here either.
 */
export function provenanceOf(input: {
  identityState: string
  accountId?: string | null
  region?: string | null
  partition?: string | null
  principal?: string | null
  readState: string
  refreshMs: number
  asOf: string | null
}): readonly Provenance[] {
  const orUnknown = (value: string | null | undefined, why: string) =>
    value && value.trim() !== "" ? value : `Not known — ${why}`

  const identityWhy =
    input.identityState === "ACTUAL" || input.identityState === "STALE"
      ? "the identity read answered but did not carry it"
      : `sts:GetCallerIdentity came back ${input.identityState}, so this console has no estate to name`

  return [
    { label: "Read", value: "cloudwatch:DescribeAlarms, every page, live" },
    { label: "Answer", value: input.readState },
    { label: "Account", value: orUnknown(input.accountId, identityWhy) },
    { label: "Region", value: orUnknown(input.region, identityWhy) },
    { label: "Partition", value: orUnknown(input.partition, identityWhy) },
    { label: "As", value: orUnknown(input.principal, identityWhy) },
    { label: "Refreshed", value: `every ${Math.round(input.refreshMs / 1000)}s` },
    { label: "This reading", value: asOf(input.asOf) },
  ]
}
