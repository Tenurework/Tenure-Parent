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
 *
 * ── The second half of the question ─────────────────────────────────────────
 *
 * The page asks "is anything broken right now, AND is it us or is it AWS". The
 * ordering above answers the first half out of CloudWatch alarms, which are this
 * estate's own symptoms and cannot distinguish a bad deploy from an AWS-side
 * impairment. `awsSide` and `fleetVerdict` answer the second half out of AWS
 * Health, and they are here rather than in the render for the same reason: a
 * firing alarm during an open account-specific AWS event and a firing alarm with
 * AWS reporting nothing are the same pixels and completely different mornings.
 *
 * `fleetVerdict` never turns an unreadable AWS Health call into "it is us". A
 * refused `health:DescribeEvents` means the question has NOT been answered, and
 * attributing an incident to our own estate on that basis is the same class of
 * error as rendering a denied read as an empty list.
 */

import type { AlarmRow, AlarmVerdict } from "../../../lib/aws/alarms"
import type { HealthEventRow, HealthVerdict } from "../../../lib/aws/aws-health"
import type { AwsRead } from "../../../lib/aws/read"

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
  // Same reasoning as UNAUTHORIZED, different remedy. Nothing is known to be
  // broken; the call was throttled, unconfigured or failed, so the next move is
  // to retry or to configure rather than to open an incident.
  UNREADABLE: "warn",
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
  // Above STALE for the same reason UNAUTHORIZED is: an alarm this console
  // could not read is not evidence of health, and burying it under a stale
  // alarm would put a known fact above the absence of one.
  "UNREADABLE",
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
  /**
   * The AWS Health read's arm, when this page made that call.
   *
   * Optional, and absent means "this page did not ask" rather than "it came
   * back empty" — the two rows below are only added when there is a real
   * reading to describe. A default of `"EMPTY"` here would print a provenance
   * line about a call that was never made.
   */
  healthReadState?: string
  healthRefreshMs?: number
}): readonly Provenance[] {
  const orUnknown = (value: string | null | undefined, why: string) =>
    value && value.trim() !== "" ? value : `Not known — ${why}`

  const identityWhy =
    input.identityState === "ACTUAL" || input.identityState === "STALE"
      ? "the identity read answered but did not carry it"
      : `sts:GetCallerIdentity came back ${input.identityState}, so this console has no estate to name`

  const facts: Provenance[] = [
    { label: "Read", value: "cloudwatch:DescribeAlarms, every page, live" },
    { label: "Answer", value: input.readState },
  ]

  if (input.healthReadState !== undefined) {
    facts.push({ label: "Also read", value: "health:DescribeEvents, every page, live" })
    facts.push({ label: "AWS Health answered", value: input.healthReadState })
  }

  facts.push(
    { label: "Account", value: orUnknown(input.accountId, identityWhy) },
    { label: "Region", value: orUnknown(input.region, identityWhy) },
    { label: "Partition", value: orUnknown(input.partition, identityWhy) },
    { label: "As", value: orUnknown(input.principal, identityWhy) },
    { label: "Refreshed", value: `every ${Math.round(input.refreshMs / 1000)}s` },
  )

  if (input.healthRefreshMs !== undefined) {
    facts.push({
      label: "AWS Health refreshed",
      value: `every ${Math.round(input.healthRefreshMs / 1000)}s`,
    })
  }

  facts.push({ label: "This reading", value: asOf(input.asOf) })
  return facts
}

/* ══════════════════════════════════════════════ is it us, or is it AWS ══ */

/**
 * The arms of a reading that carry no value.
 *
 * `Extract` over the real union rather than a list of four object types, so a
 * fifth valueless arm added to `read.ts` lands here by construction. It is the
 * same type `components/md3/UnknownState.tsx` accepts, which is what lets a
 * refused read on this page render through the shared panel rather than through
 * a sentence this route wrote for itself.
 */
export type UnknownArm = Extract<
  AwsRead<unknown>,
  { state: "DENIED" | "THROTTLED" | "UNCONFIGURED" | "ERROR" }
>

/**
 * The unknown arm of a reading, or null when the reading answered.
 *
 * A `switch` rather than `isUnknown(read) ? read : null`: the boolean helper in
 * `read.ts` does not narrow, so the cast a caller would need is exactly the
 * cast that would let an `ACTUAL` read reach a panel that says "refused".
 */
export function unknownArm<T>(read: AwsRead<T>): UnknownArm | null {
  switch (read.state) {
    case "DENIED":
    case "THROTTLED":
    case "UNCONFIGURED":
    case "ERROR":
      return read
    default:
      return null
  }
}

/** A tone per AWS Health verdict. The WORD is `HEALTH_WORDS`; this is loudness. */
export const HEALTH_TONE: Readonly<Record<HealthVerdict, VerdictTone>> = {
  AFFECTING_US: "bad",
  UPCOMING: "warn",
  NOTIFICATION: "info",
  OPEN_IN_OUR_REGION: "warn",
  OPEN_ELSEWHERE: "neutral",
  OPEN_REGION_UNKNOWN: "warn",
  UNAUTHORIZED: "warn",
}

/**
 * What AWS is saying about itself, counted.
 *
 * `known` is the load-bearing field and it is deliberately not derivable from
 * the counts: every count is zero both when AWS answered "no events" and when
 * AWS Health was refused, and those are opposite facts. The first rules AWS out;
 * the second rules nothing out at all.
 */
export interface AwsSide {
  /** Whether `health:DescribeEvents` answered. Never inferred from a count. */
  known: boolean
  /** The read's arm, kept so the page can decide how loudly to place the card. */
  state: string
  /** Open, and AWS named resources in THIS account. The loudest thing here. */
  affectingUs: number
  /** Open, public, in the region STS resolved for this process. */
  inOurRegion: number
  /** Open, and this console could not resolve its own region to compare. */
  regionUnknown: number
  /** Open, in a region this account did not resolve to. Informational. */
  elsewhere: number
  /** Scheduled and not started — a retirement, a mandatory upgrade window. */
  upcoming: number
  /** AWS telling us something. Not an impairment. */
  notices: number
  /** Everything open that is not ruled out for this estate. */
  open: number
  /** Every row the surface produced, refusal rows included. */
  total: number
  /** Whether this belongs above the alarms rather than below them. */
  hoist: boolean
  /** One sentence, in the operator's language. Never "AWS is fine" on a refusal. */
  sentence: string
}

/**
 * AWS's side of the question.
 *
 * `because` is the AWS Health surface's own headline, which already words each
 * unreadable arm honestly — this does not re-word it, because a second wording
 * is a second chance to soften a refusal.
 */
export function awsSide(input: {
  state: string
  rows: readonly HealthEventRow[]
  because: string
}): AwsSide {
  const count = (verdict: HealthVerdict) => input.rows.filter((r) => r.verdict === verdict).length
  const known = readAnswered(input.state)

  const affectingUs = count("AFFECTING_US")
  const inOurRegion = count("OPEN_IN_OUR_REGION")
  const regionUnknown = count("OPEN_REGION_UNKNOWN")
  const elsewhere = count("OPEN_ELSEWHERE")
  const upcoming = count("UPCOMING")
  const notices = count("NOTIFICATION")
  const open = affectingUs + inOurRegion + regionUnknown

  if (!known) {
    return {
      known: false,
      state: input.state,
      affectingUs: 0,
      inOurRegion: 0,
      regionUnknown: 0,
      elsewhere: 0,
      upcoming: 0,
      notices: 0,
      open: 0,
      total: input.rows.length,
      /*
       * A read that can be fixed is hoisted; one that never can is not.
       *
       * UNCONFIGURED here is almost always an AWS Support plan below Business,
       * which no IAM statement and no operator action during an incident will
       * change. Holding it at the top of every load would put a permanent
       * grey panel above the alarms and train people to scroll past the place
       * a real AWS event will appear.
       */
      hoist: input.state !== "UNCONFIGURED",
      sentence: `Whether AWS is having an event of its own is NOT known — ${input.because}`,
    }
  }

  const side = {
    known: true,
    state: input.state,
    affectingUs,
    inOurRegion,
    regionUnknown,
    elsewhere,
    upcoming,
    notices,
    open,
    total: input.rows.length,
    hoist: open > 0,
  }

  if (affectingUs > 0) {
    return {
      ...side,
      sentence:
        `AWS has ${affectingUs} open event(s) raised against resources in THIS account. ` +
        `Whatever else is on this page, some of it is AWS's rather than ours.`,
    }
  }

  if (open > 0) {
    const parts: string[] = []
    if (inOurRegion > 0) parts.push(`${inOurRegion} in this estate's own region`)
    if (regionUnknown > 0) {
      parts.push(
        `${regionUnknown} whose region cannot be compared, because sts:GetCallerIdentity has not answered`,
      )
    }
    return {
      ...side,
      sentence:
        `AWS reports no event against this account's own resources, and ${open} open event(s) ` +
        `that are not ruled out for this estate — ${parts.join(", and ")}.`,
    }
  }

  const aside: string[] = []
  if (upcoming > 0) aside.push(`${upcoming} scheduled change(s) ahead`)
  if (notices > 0) aside.push(`${notices} account notification(s)`)
  if (elsewhere > 0) aside.push(`${elsewhere} open event(s) in other regions`)

  return {
    ...side,
    sentence:
      `AWS reports nothing open against this account or its region` +
      `${aside.length > 0 ? ` — ${aside.join(", ")}` : ""}. ` +
      `That is AWS's own answer, not a permission this console is missing.`,
  }
}

/* ───────────────────────────────────────────────────────── the verdict ──── */

/** Whose problem this is, once both sides have been read. */
export type Whose = "US" | "AWS" | "BOTH" | "NEITHER" | "UNKNOWN"

/** The word beside the verdict. Never colour alone, and never an abbreviation. */
export const WHOSE_WORD: Readonly<Record<Whose, string>> = {
  US: "Ours",
  AWS: "AWS",
  BOTH: "Ours and AWS",
  NEITHER: "Neither",
  UNKNOWN: "Not established",
}

export interface FleetVerdict {
  /** The alarm-side verdict, unchanged. What is broken. */
  verdict: string
  tone: VerdictTone
  /** The one sentence about whether anything is broken. */
  headline: string
  /** The second sentence: us, AWS, both, neither, or not established. */
  attribution: string
  whose: Whose
  /** The tone of the attribution badge, which is not the tone of the verdict. */
  whoseTone: VerdictTone
}

/**
 * Both halves of the page's question, decided together.
 *
 * `alarmsAnswered` is passed rather than sniffed out of `answer.verdict`,
 * because a verdict is a sentence for a human and keying control flow on its
 * text is how a copy edit becomes an outage. The rule set, in order:
 *
 *   * neither side answered            → nothing is established, and it says so
 *   * ours firing AND AWS on our estate → BOTH, and they are probably one thing
 *   * AWS on our estate                → AWS, even when our own alarms are calm
 *   * ours in trouble, AWS answered    → US: AWS was asked and said nothing
 *   * ours in trouble, AWS did not     → UNKNOWN, never US
 *   * either side unread               → UNKNOWN
 *   * otherwise                        → NEITHER
 *
 * The fifth rule is the one worth defending. Attributing an incident to our own
 * estate because the AWS Health call was refused is a claim built out of a
 * missing permission, and it is the sentence that sends an on-call engineer to
 * re-read deploys for twenty minutes during somebody else's outage.
 */
export function fleetVerdict(
  answer: LeadAnswer,
  aws: AwsSide,
  alarmsAnswered: boolean,
): FleetVerdict {
  const ourTrouble = alarmsAnswered && answer.verdict !== "Healthy"
  const awsTrouble = aws.known && aws.open > 0

  const base = { verdict: answer.verdict, tone: answer.tone, headline: answer.headline }

  if (!alarmsAnswered && !aws.known) {
    return {
      ...base,
      whose: "UNKNOWN",
      whoseTone: "warn",
      attribution:
        "Neither side answered: this console could read neither its own alarms nor AWS Health, so " +
        "nothing here rules anything out. Both panels below name the action that was refused.",
    }
  }

  if (ourTrouble && awsTrouble) {
    return {
      ...base,
      whose: "BOTH",
      whoseTone: "bad",
      attribution: `${aws.sentence} Our own alarms are not quiet either, so treat these as one incident until something separates them.`,
    }
  }

  if (awsTrouble) {
    return {
      ...base,
      whose: "AWS",
      whoseTone: "bad",
      attribution: `${aws.sentence} Nothing of ours has crossed a threshold because of it yet, which is not the same as being unaffected.`,
    }
  }

  if (ourTrouble && aws.known) {
    return {
      ...base,
      whose: "US",
      whoseTone: "bad",
      attribution: `${aws.sentence} So what this page is showing is this estate's, not an AWS-side event.`,
    }
  }

  if (ourTrouble) {
    return {
      ...base,
      whose: "UNKNOWN",
      whoseTone: "warn",
      attribution: `${aws.sentence} Until it does, "it is us" is not established — it is only the half of the question that could be read.`,
    }
  }

  if (!alarmsAnswered || !aws.known) {
    return {
      ...base,
      whose: "UNKNOWN",
      whoseTone: "warn",
      attribution: alarmsAnswered
        ? `${aws.sentence} So AWS cannot be ruled out, whatever this estate's own alarms say.`
        : "This estate's own alarms could not be read, so nothing is established about our side of it.",
    }
  }

  return {
    ...base,
    whose: "NEITHER",
    whoseTone: "ok",
    attribution: `${aws.sentence} Both halves of the question were asked and both came back.`,
  }
}

/* ──────────────────────────────────────────────────── where each card goes */

export const SECTIONS = [
  "right-now",
  "aws-health",
  "needs-attention",
  "watching-quietly",
  "coverage",
  "provenance",
] as const

export type SectionId = (typeof SECTIONS)[number]

/**
 * The order the cards are drawn in.
 *
 * AWS Health sits directly under the answer when there is an open event or when
 * the read is refused, throttled or broken — during an incident "is it us or is
 * it AWS" is the second thing read and it cannot be below a table of forty
 * alarms. With nothing open it drops below the alarms, where a negative answer
 * is still worth having and is not worth the top of the page.
 *
 * Every id in `SECTIONS` appears exactly once in both arrangements; the test
 * asserts that, because a card dropped from one arrangement is a card that
 * disappears in precisely the state it was written for.
 */
export function sectionOrder(aws: AwsSide): readonly SectionId[] {
  return aws.hoist
    ? ["right-now", "aws-health", "needs-attention", "watching-quietly", "coverage", "provenance"]
    : ["right-now", "needs-attention", "watching-quietly", "aws-health", "coverage", "provenance"]
}
