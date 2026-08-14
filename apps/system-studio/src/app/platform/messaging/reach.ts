/**
 * What `/platform/messaging` says, decided as data rather than in JSX.
 *
 * ── The question, and why it has two halves ─────────────────────────────────
 *
 * "Can this platform actually reach people, and is anything queued that nobody
 * is processing?" Neither half can be answered by one reader:
 *
 *   * `lib/aws/ses.ts` answers the first. Its `mailabilityVerdict` already knows
 *     that a verified identity in a SANDBOX account can send — to a handful of
 *     addresses that are themselves verified, and to nobody else. This module
 *     does not re-derive that; it RANKS it, because the sandbox is the fact an
 *     operator opens this page for and it must not be a footnote under a green
 *     badge.
 *   * `lib/aws/sqs.ts` and `lib/aws/eventbridge.ts` answer the second, and
 *     `lib/aws/metrics.ts` supplies the number neither of them holds. `sqs.ts`
 *     says it out loud: the age of the oldest message is not an SQS attribute,
 *     it is `AWS/SQS ApproximateAgeOfOldestMessage`, and until `metrics.ts`
 *     existed no reader held `cloudwatch:GetMetricData`. A queue with a thousand
 *     visible messages that is being drained and one that nothing has consumed
 *     for six hours are the SAME depth. The age is what separates them, so this
 *     module joins the two readings and says `stalled` only when it has the age.
 *
 * ── Why this is a module and not a few ternaries in the page ────────────────
 *
 * The answer is an ORDER, and an order expressed as nested ternaries inside a
 * render is an order nothing can test. Everything here is pure — no AWS client,
 * no `server-only`, no React — so `./reach.test.ts` runs it under `apps/web`'s
 * jest and `e2e/messaging-page-logic.spec.ts` drives it at the node level with
 * no browser and no estate.
 *
 * ── The two rules the ordering encodes ──────────────────────────────────────
 *
 * 1. **A sandbox account is not "can send".** It is "can send to a list of
 *    addresses somebody verified by hand", which for a platform that mails
 *    students is indistinguishable from not sending at all — except that the
 *    application sees a 200 and nothing anywhere records the drop.
 *
 * 2. **A read that did not answer never renders as clear.** Every unknown arm
 *    here is its own verdict with its own sentence, and `CLEAR` is reachable
 *    only when every reading this page depends on actually answered. That is
 *    STUDIO-000-007 at the level of the page's headline rather than the level of
 *    one panel.
 *
 * `alarms.ts` decided that a disabled alarm outranks OK, and `eventbridge.ts`
 * decided the same for a disabled rule. This decides it for the PAGE: a disabled
 * SCHEDULED rule is ranked above every other rule state and above a merely
 * moving backlog, because a schedule that has been switched off raises no alarm,
 * logs no error, and appears in no failure count. It simply stops.
 */

import type { MetricQuerySpec, MetricSeries, MetricWindow } from "../../../lib/aws/metrics"
import type { AwsRead } from "../../../lib/aws/read"
import type { RuleRow, RuleVerdict } from "../../../lib/aws/eventbridge"
import type { DeadLetterState, QueueReading } from "../../../lib/aws/sqs"
import type { SesAccount, SesMailabilityVerdict } from "../../../lib/aws/ses"

import { describeRead } from "../../../lib/aws/read"
import { describeStated } from "../../../lib/aws/ses"

/* ═════════════════════════════════════════════════════════════════ tone ══ */

/** The tone vocabulary `components/md3/Badge.tsx` accepts. */
export type Tone = "neutral" | "info" | "ok" | "warn" | "bad"

/* ═══════════════════════════════════════════════ half one: can we reach ══ */

/**
 * Whether this platform can put a message in front of a person.
 *
 * Four arms, and `REACHES_ONLY_VERIFIED` is the one that earns the type. It is
 * produced from `mailabilityVerdict`'s `CAN_SEND` arm — SES will accept the API
 * call, an identity is verified, everything looks healthy — while the account is
 * in the sandbox and every recipient who is not themselves a verified identity
 * is silently dropped.
 */
export type ReachVerdict =
  | "REACHES_ANYONE"
  | "REACHES_ONLY_VERIFIED"
  | "CANNOT_REACH_ANYONE"
  | "UNKNOWN"

/** The word beside the badge. Bible §26.3.2: never colour alone. */
export const REACH_WORD: Readonly<Record<ReachVerdict, string>> = {
  REACHES_ANYONE: "Reaches anyone",
  REACHES_ONLY_VERIFIED: "Reaches verified addresses only",
  CANNOT_REACH_ANYONE: "Reaches nobody",
  UNKNOWN: "Not established",
}

/**
 * How loud, never what.
 *
 * `REACHES_ONLY_VERIFIED` is `bad` rather than `warn`: for a platform whose mail
 * goes to students, a sandbox account does not reach the people it exists to
 * reach. `UNKNOWN` is `warn`, because nothing is known to be broken — the next
 * move is an IAM statement or a retry rather than an incident.
 */
export const REACH_TONE: Readonly<Record<ReachVerdict, Tone>> = {
  REACHES_ANYONE: "ok",
  REACHES_ONLY_VERIFIED: "bad",
  CANNOT_REACH_ANYONE: "bad",
  UNKNOWN: "warn",
}

export interface Reach {
  verdict: ReachVerdict
  tone: Tone
  /** The one sentence this page leads with. */
  headline: string
  /** The consequence, or the refusal. Never empty. */
  because: string
  /** Identities SES will send FROM right now. Empty is a fact, not a placeholder. */
  sendableFrom: readonly string[]
}

/**
 * The first half of the question, from `ses.ts`'s own verdict.
 *
 * `mailabilityVerdict` is not re-implemented here — it already knows which
 * identities are both verified and sending-enabled, and that an account-wide
 * sending switch beats every identity. What this adds is the RANK: the sandbox
 * arm of `CAN_SEND` becomes its own headline rather than a caveat, because it is
 * the difference between "mail works" and "mail works for the four people whose
 * addresses somebody verified in the console".
 */
export function reachAnswer(verdict: SesMailabilityVerdict): Reach {
  if (verdict.verdict === "UNKNOWN") {
    return {
      verdict: "UNKNOWN",
      tone: REACH_TONE.UNKNOWN,
      headline: "Whether this platform can reach anybody is NOT known.",
      because: verdict.why,
      sendableFrom: [],
    }
  }

  if (verdict.verdict === "CANNOT_SEND") {
    const blocked = verdict.blocked.map((b) => `${b.name} (${b.why})`).join("; ")
    return {
      verdict: "CANNOT_REACH_ANYONE",
      tone: REACH_TONE.CANNOT_REACH_ANYONE,
      headline: "This platform cannot send mail at all.",
      because:
        `${verdict.why}.` +
        (blocked ? ` Identities SES holds but will not send from: ${blocked}.` : ""),
      sendableFrom: verdict.sendableFrom,
    }
  }

  // CAN_SEND. The restriction is the whole decision: `null` means AWS has
  // granted production access, and anything else is the sandbox consequence
  // `ses.ts` worded. A check keyed on the verdict alone would print the same
  // reassuring badge for both.
  if (verdict.recipientRestriction !== null) {
    return {
      verdict: "REACHES_ONLY_VERIFIED",
      tone: REACH_TONE.REACHES_ONLY_VERIFIED,
      headline:
        "This platform can send, and only to addresses that are themselves verified in SES.",
      because:
        `${verdict.recipientRestriction}. Sending from: ${verdict.sendableFrom.join(", ")}. ` +
        `Nothing in the application sees this: SES accepts the call and drops the message.`,
      sendableFrom: verdict.sendableFrom,
    }
  }

  return {
    verdict: "REACHES_ANYONE",
    tone: REACH_TONE.REACHES_ANYONE,
    headline: "This platform can send mail to any recipient.",
    because: `${verdict.why}. Sending from: ${verdict.sendableFrom.join(", ")}.`,
    sendableFrom: verdict.sendableFrom,
  }
}

/* ═══════════════════════════════ the age of the oldest message in a queue ══ */

/**
 * `AWS/SQS ApproximateAgeOfOldestMessage`, the metric `sqs.ts` names and cannot
 * read.
 *
 * The namespace and metric name are constants rather than strings typed at the
 * call site, so the query this page sends and the sentence it prints when the
 * query fails name the same metric.
 */
export const OLDEST_AGE_METRIC = {
  namespace: "AWS/SQS",
  metricName: "ApproximateAgeOfOldestMessage",
} as const

/** `AWS/SES Send` — messages SES actually accepted, as opposed to the quota. */
export const SEND_METRIC = { namespace: "AWS/SES", metricName: "Send" } as const

/**
 * Five minutes, and one hour.
 *
 * The window is short on purpose. `metrics.ts` is billed per metric per request
 * and this page reads one metric per queue on every load; an hour at five-minute
 * resolution is twelve datapoints per queue, which is enough to see the latest
 * value and the shape of the last hour without turning a page render into a line
 * on the bill.
 */
export const METRIC_PERIOD_SECONDS = 300
export const METRIC_WINDOW_MS = 3_600_000

/**
 * How many queues get an age query in one load.
 *
 * Queues past the cap are NOT dropped from the table and do not render as
 * ageless-therefore-fine: their age is `not-read` with a sentence saying the
 * engine stopped asking, which is a different sentence from "nothing old in
 * here".
 */
export const MAX_QUEUE_AGE_QUERIES = 100

/**
 * How long a message may wait before this page calls the queue stalled.
 *
 * Fifteen minutes. These queues carry transactional mail and approval
 * notifications — `infrastructure/terraform/sqs.tf`'s `email` and
 * `notifications` — and a message of either kind that has been visible for a
 * quarter of an hour is not being consumed by anything. It is a threshold rather
 * than a measurement, so it is a constant with its reasoning attached rather
 * than a number inside an `if`.
 */
export const STALLED_AFTER_SECONDS = 900

/** The caller's own handle for a queue's age series. Joined on, never parsed. */
export function queueAgeKey(queueName: string): string {
  return `queue-age:${queueName}`
}

/** The caller's own handle for the SES send series. */
export const SEND_RATE_KEY = "ses-send"

/** The window both metrics are read over, ending at the instant of this load. */
export function metricWindow(now: Date): MetricWindow {
  return {
    startIso: new Date(now.getTime() - METRIC_WINDOW_MS).toISOString(),
    endIso: now.toISOString(),
  }
}

/**
 * The metric queries this page sends, derived from the queues that were listed.
 *
 * Two properties worth stating:
 *
 *   * The SES send series is ALWAYS asked for, so the request is never empty.
 *     `validateRequest` refuses an empty request — correctly — and a page that
 *     let the queue listing decide whether any metric is read at all would lose
 *     the send rate on an account with no queues.
 *   * Duplicate keys are dropped rather than sent. Two queue URLs can yield the
 *     same last path segment when one of them is in another account, and
 *     `validateRequest` refuses the WHOLE load for a duplicate key — which would
 *     take the send rate down with it. The duplicate's age then reads `not-read`
 *     through the normal path.
 */
export function messagingMetricSpecs(
  queues: AwsRead<readonly QueueReading[]>,
): readonly MetricQuerySpec[] {
  const specs: MetricQuerySpec[] = [
    {
      key: SEND_RATE_KEY,
      namespace: SEND_METRIC.namespace,
      metricName: SEND_METRIC.metricName,
      stat: "Sum",
      periodSeconds: METRIC_PERIOD_SECONDS,
      label: "Messages SES accepted",
    },
  ]

  if (queues.state !== "ACTUAL" && queues.state !== "STALE") return specs

  const seen = new Set<string>([SEND_RATE_KEY])
  let queueQueries = 0
  for (const queue of queues.value) {
    // The SES query does not count against the queue budget: `specs.length`
    // would silently make the cap one query smaller than it says it is.
    if (queueQueries >= MAX_QUEUE_AGE_QUERIES) break
    const key = queueAgeKey(queue.name)
    if (seen.has(key)) continue
    seen.add(key)
    queueQueries += 1
    specs.push({
      key,
      namespace: OLDEST_AGE_METRIC.namespace,
      metricName: OLDEST_AGE_METRIC.metricName,
      dimensions: [{ name: "QueueName", value: queue.name }],
      stat: "Maximum",
      periodSeconds: METRIC_PERIOD_SECONDS,
      label: `Age of the oldest message in ${queue.name}`,
      // Present only when the queue has an ARN this engine can stand behind, so
      // the metric attributes exactly as the queue does.
      ...(queue.arn ? { resourceArn: queue.arn } : {}),
    })
  }
  return specs
}

/**
 * How old the oldest message in a queue is.
 *
 * Three arms and no optional number. `no-datapoints` is NOT zero: SQS stops
 * publishing metrics for a queue that has had no activity for six hours, so a
 * console that filled the gap with `0` would print "nothing is waiting" about
 * exactly the queue nothing has touched. `not-read` is the refusal arm and
 * carries the reader's own sentence.
 */
export type OldestAge =
  | { kind: "seconds"; seconds: number; at: string }
  | { kind: "no-datapoints"; why: string }
  | { kind: "not-read"; why: string }

/** The age of one queue's oldest message, from the metric load. */
export function oldestAgeFor(
  queueName: string,
  series: AwsRead<readonly MetricSeries[]>,
): OldestAge {
  if (series.state !== "ACTUAL" && series.state !== "STALE") {
    return {
      kind: "not-read",
      why: describeRead(series, `${OLDEST_AGE_METRIC.namespace} ${OLDEST_AGE_METRIC.metricName}`),
    }
  }
  const key = queueAgeKey(queueName)
  const found = series.value.find((s) => s.key === key)
  if (!found) {
    return {
      kind: "not-read",
      why:
        `no ${OLDEST_AGE_METRIC.metricName} series was requested or returned for this queue. ` +
        `This engine reads at most ${MAX_QUEUE_AGE_QUERIES} queue ages per load, and a queue past ` +
        `that cap is not asked about — which is not the same as its having nothing old in it.`,
    }
  }
  switch (found.summary.kind) {
    case "datapoints":
      return {
        kind: "seconds",
        seconds: found.summary.latest.value,
        at: found.summary.latest.at,
      }
    case "no-datapoints":
      return {
        kind: "no-datapoints",
        why:
          `${found.summary.why} SQS stops publishing this metric for a queue with no activity, so ` +
          `this is an absence of datapoints and not an age of zero.`,
      }
    case "not-read":
      return { kind: "not-read", why: found.summary.why }
  }
}

/** The sentence a table cell prints for an age. One renderer, as everywhere. */
export function describeAge(age: OldestAge): string {
  switch (age.kind) {
    case "seconds":
      return `${formatSeconds(age.seconds)} (measured ${age.at})`
    case "no-datapoints":
      return `unknown — ${age.why}`
    case "not-read":
      return `unknown — ${age.why}`
  }
}

/** Whole units, largest first. `90s`, `4m 12s`, `2h 5m`. Never a bare float. */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "an age CloudWatch did not return as a number"
  const whole = Math.round(seconds)
  if (whole < 60) return `${whole}s`
  const minutes = Math.floor(whole / 60)
  if (minutes < 60) return `${minutes}m ${whole % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/* ═══════════════════════════════════════════════════════ the queue rows ══ */

export interface QueueRow {
  queue: QueueReading
  age: OldestAge
  /**
   * Whether another queue's redrive policy names this one, or its own
   * `RedriveAllowPolicy` declares it a redrive target.
   *
   * Taken from `deadLetterState`'s own answer rather than from the name, for the
   * reason `sqs.ts` gives at length: a `-dlq` suffix rule misses the queue
   * somebody called `failed-email` and invents one for `dlq-inbox-archive`.
   */
  isDeadLetter: boolean
  /** Messages visible, when the depth read answered. Null when it did not. */
  visible: number | null
  inFlight: number | null
  /**
   * Visible messages, and an age this engine actually measured, past the
   * threshold. False when the age is unknown — a stall this page cannot see is
   * not a stall it may assert.
   */
  stalled: boolean
}

/** Which queues are dead-letter targets, from the state `sqs.ts` derived. */
export function deadLetterArns(state: DeadLetterState): ReadonlySet<string> {
  switch (state.kind) {
    case "failed-deliveries":
      return new Set(state.failures.map((f) => f.queueArn))
    case "clear":
      return new Set(state.deadLetterQueueArns)
    case "none-configured":
    case "unknown":
      return new Set()
  }
}

/** The queue table's rows: the SQS reading joined to the CloudWatch age. */
export function composeQueues(
  queues: AwsRead<readonly QueueReading[]>,
  deadLetters: DeadLetterState,
  series: AwsRead<readonly MetricSeries[]>,
): readonly QueueRow[] {
  if (queues.state !== "ACTUAL" && queues.state !== "STALE") return []
  const dlqs = deadLetterArns(deadLetters)

  return queues.value.map((queue) => {
    const depth = queue.depth
    const answered = depth.state === "ACTUAL" || depth.state === "STALE"
    const visible = answered ? depth.value.visible : null
    const inFlight = answered ? depth.value.inFlight : null
    const age = oldestAgeFor(queue.name, series)
    return {
      queue,
      age,
      isDeadLetter: queue.arn !== null && dlqs.has(queue.arn),
      visible,
      inFlight,
      stalled:
        visible !== null &&
        visible > 0 &&
        age.kind === "seconds" &&
        age.seconds >= STALLED_AFTER_SECONDS,
    }
  })
}

/* ══════════════════════════════════════════ half two: is anything stuck ══ */

/**
 * Whether anything queued is going unprocessed.
 *
 * The order of these arms IS the decision, and every arm above `UNKNOWN`
 * requires a reading that actually answered — so no refusal can produce one of
 * them, and no refusal can produce `CLEAR` either.
 */
export type ProcessingVerdict =
  | "FAILED_DELIVERIES"
  | "SCHEDULE_STOPPED"
  | "BACKLOG_STALLED"
  | "BACKLOG_AGE_UNKNOWN"
  | "BACKLOG_MOVING"
  | "UNKNOWN"
  | "PARTLY_UNKNOWN"
  | "CLEAR"

export const PROCESSING_WORD: Readonly<Record<ProcessingVerdict, string>> = {
  FAILED_DELIVERIES: "Failed deliveries",
  SCHEDULE_STOPPED: "A schedule is switched off",
  BACKLOG_STALLED: "Backlog not moving",
  BACKLOG_AGE_UNKNOWN: "Backlog, age unknown",
  BACKLOG_MOVING: "Backlog moving",
  UNKNOWN: "Not established",
  PARTLY_UNKNOWN: "Partly unknown",
  CLEAR: "Nothing waiting",
}

export const PROCESSING_TONE: Readonly<Record<ProcessingVerdict, Tone>> = {
  FAILED_DELIVERIES: "bad",
  SCHEDULE_STOPPED: "bad",
  BACKLOG_STALLED: "bad",
  BACKLOG_AGE_UNKNOWN: "warn",
  BACKLOG_MOVING: "info",
  UNKNOWN: "warn",
  PARTLY_UNKNOWN: "warn",
  CLEAR: "ok",
}

export interface Processing {
  verdict: ProcessingVerdict
  tone: Tone
  /** The sentence under the reach headline. */
  headline: string
  /** What was not read, when something was not. Empty string when everything was. */
  qualifier: string
  /** Whether the dead-letter card belongs directly under the answer. */
  hoistDeadLetters: boolean
  /** Whether the schedules card does. */
  hoistSchedules: boolean
}

export interface ProcessingInput {
  queues: AwsRead<readonly QueueReading[]>
  deadLetters: DeadLetterState
  rows: readonly QueueRow[]
  rules: AwsRead<readonly RuleRow[]>
  ruleRows: readonly RuleRow[]
}

/** Whether a reading carries an answer at all. EMPTY does; DENIED does not. */
export function answered(state: string): boolean {
  return state === "ACTUAL" || state === "STALE" || state === "EMPTY"
}

/**
 * The rules that are switched off AND carry a schedule.
 *
 * The most specific defect on this page and the one it ranks first: a cron
 * expression that is still correct, still there, and not running. `scheduler.tf`
 * has exactly one such rule and it is what fires every deliverable reminder.
 */
export function disabledSchedules(rows: readonly RuleRow[]): readonly RuleRow[] {
  return rows.filter((row) => row.verdict === "DISABLED" && row.schedule !== null)
}

/**
 * The second half of the question.
 *
 * In order:
 *
 *   1. anything in a dead-letter queue — a delivery that already failed its last
 *      retry and that nobody was told about;
 *   2. a disabled scheduled rule — a job that silently stopped;
 *   3. a backlog this engine has MEASURED as not moving;
 *   4. a backlog whose age could not be measured, which is not the same as one
 *      that is moving;
 *   5. a backlog with a fresh oldest message — work in progress, not a defect;
 *   6. nothing readable at all;
 *   7. something readable and something not;
 *   8. clear.
 *
 * Steps 6 and 7 are below the defects on purpose: a known failure outranks an
 * unread queue. They are ABOVE `CLEAR` for the reason the whole read plane
 * exists — a refused `sqs:ListQueues` rendered as "nothing waiting" is the most
 * reassuring lie this page could tell.
 */
export function processingAnswer(input: ProcessingInput): Processing {
  const queuesAnswered = answered(input.queues.state)
  const rulesAnswered = answered(input.rules.state)

  const unreadable: string[] = []
  if (!queuesAnswered) {
    unreadable.push(describeRead(input.queues, "the SQS queue listing"))
  }
  if (!rulesAnswered) {
    unreadable.push(describeRead(input.rules, "the EventBridge rules"))
  }
  if (input.deadLetters.kind === "unknown") unreadable.push(input.deadLetters.why)
  const unreadableDepths = input.rows
    .filter((row) => row.visible === null)
    .map((row) => row.queue.name)
  if (unreadableDepths.length > 0) {
    unreadable.push(`the depth of ${unreadableDepths.join(", ")} could not be read`)
  }
  const agelessBacklog = input.rows.filter(
    (row) => row.visible !== null && row.visible > 0 && row.age.kind !== "seconds",
  )
  const qualifier =
    unreadable.length > 0 ? `Not everything on this page was readable: ${unreadable.join("; ")}.` : ""

  if (input.deadLetters.kind === "failed-deliveries") {
    const named = input.deadLetters.failures
      .map((f) => `${f.queueName} (${f.messages})`)
      .join(", ")
    return {
      verdict: "FAILED_DELIVERIES",
      tone: PROCESSING_TONE.FAILED_DELIVERIES,
      headline:
        `${input.deadLetters.totalMessages} message(s) reached a dead-letter queue and nobody was ` +
        `told: ${named}. Each one is a job that has already failed its last retry and will not run.`,
      qualifier,
      hoistDeadLetters: true,
      hoistSchedules: false,
    }
  }

  const stoppedSchedules = disabledSchedules(input.ruleRows)
  if (stoppedSchedules.length > 0) {
    return {
      verdict: "SCHEDULE_STOPPED",
      tone: PROCESSING_TONE.SCHEDULE_STOPPED,
      headline:
        `${stoppedSchedules.length} scheduled rule(s) are switched off — ` +
        `${stoppedSchedules.map((r) => `${r.name} (${r.schedule})`).join(", ")}. ` +
        `A disabled rule raises no alarm, logs no error and appears in no failure count.`,
      qualifier,
      hoistDeadLetters: input.deadLetters.kind === "unknown",
      hoistSchedules: true,
    }
  }

  const stalled = input.rows.filter((row) => row.stalled)
  if (stalled.length > 0) {
    return {
      verdict: "BACKLOG_STALLED",
      tone: PROCESSING_TONE.BACKLOG_STALLED,
      headline:
        `${stalled.length} queue(s) hold messages older than ${formatSeconds(STALLED_AFTER_SECONDS)}: ` +
        `${stalled
          .map((row) => `${row.queue.name} (${row.visible} visible, oldest ${describeAge(row.age)})`)
          .join(", ")}. Nothing is consuming them fast enough to matter.`,
      qualifier,
      hoistDeadLetters: input.deadLetters.kind === "unknown",
      hoistSchedules: false,
    }
  }

  if (agelessBacklog.length > 0) {
    return {
      verdict: "BACKLOG_AGE_UNKNOWN",
      tone: PROCESSING_TONE.BACKLOG_AGE_UNKNOWN,
      headline:
        `${agelessBacklog.length} queue(s) hold messages and this engine could not measure how long ` +
        `they have been waiting: ${agelessBacklog.map((row) => row.queue.name).join(", ")}. ` +
        `Whether anything is consuming them is not established.`,
      qualifier,
      hoistDeadLetters: input.deadLetters.kind === "unknown",
      hoistSchedules: false,
    }
  }

  const moving = input.rows.filter((row) => row.visible !== null && row.visible > 0)
  if (moving.length > 0) {
    return {
      verdict: "BACKLOG_MOVING",
      tone: PROCESSING_TONE.BACKLOG_MOVING,
      headline:
        `${moving.length} queue(s) hold messages, and the oldest of them has been waiting less than ` +
        `${formatSeconds(STALLED_AFTER_SECONDS)}. That is work in progress rather than a backlog.`,
      qualifier,
      hoistDeadLetters: input.deadLetters.kind === "unknown",
      hoistSchedules: false,
    }
  }

  if (!queuesAnswered && !rulesAnswered) {
    return {
      verdict: "UNKNOWN",
      tone: PROCESSING_TONE.UNKNOWN,
      headline:
        "Whether anything is queued and unprocessed is NOT known: neither the queues nor the " +
        "scheduled rules could be read.",
      qualifier,
      hoistDeadLetters: true,
      hoistSchedules: true,
    }
  }

  if (unreadable.length > 0) {
    return {
      verdict: "PARTLY_UNKNOWN",
      tone: PROCESSING_TONE.PARTLY_UNKNOWN,
      headline:
        "Nothing that answered is queued and unprocessed — and not everything answered, so this " +
        "is not a clean bill of health.",
      qualifier,
      hoistDeadLetters: input.deadLetters.kind === "unknown",
      hoistSchedules: !rulesAnswered,
    }
  }

  return {
    verdict: "CLEAR",
    tone: PROCESSING_TONE.CLEAR,
    headline:
      "Nothing is waiting: every queue answered with no visible messages, no dead-letter queue " +
      "holds anything, and every scheduled rule is switched on.",
    qualifier,
    hoistDeadLetters: false,
    hoistSchedules: false,
  }
}

/* ═══════════════════════════════════════════════════════ the rule order ══ */

/**
 * Worst first, and deliberately not `RULE_VERDICTS`' declaration order — that
 * array is grouped by where the verdict came from, which is a fact about the
 * implementation.
 */
export const RULE_RANK: readonly RuleVerdict[] = [
  "DISABLED",
  "UNTRIGGERED",
  "NO_TARGET",
  "TARGETS_UNKNOWN",
  "STATE_UNKNOWN",
  "UNAUTHORIZED",
  "UNREADABLE",
  "SCHEDULED",
  "EVENT_DRIVEN",
]

export const RULE_TONE: Readonly<Record<RuleVerdict, Tone>> = {
  SCHEDULED: "ok",
  EVENT_DRIVEN: "ok",
  UNTRIGGERED: "bad",
  NO_TARGET: "bad",
  TARGETS_UNKNOWN: "warn",
  STATE_UNKNOWN: "warn",
  DISABLED: "bad",
  UNAUTHORIZED: "warn",
  UNREADABLE: "warn",
}

/**
 * One rule's place in the table.
 *
 * Doubled, so a disabled rule that also carries a SCHEDULE can be placed half a
 * step above every other disabled rule without a second sort key. That is the
 * one ordering this surface was asked for: a disabled schedule is a job that
 * silently stopped, and it is the same shape of defect as an alarm with its
 * actions switched off.
 *
 * A verdict missing from `RULE_RANK` sorts LAST rather than first: a row nobody
 * has classified must not be placed above a rule that is known to be switched
 * off.
 */
export function ruleRank(row: RuleRow): number {
  const at = RULE_RANK.indexOf(row.verdict)
  const base = (at === -1 ? RULE_RANK.length : at) * 2
  return row.verdict === "DISABLED" && row.schedule !== null ? base - 1 : base
}

/** The rules, worst first, then by bus and name so two loads draw one page. */
export function rankedRules(rows: readonly RuleRow[]): readonly RuleRow[] {
  return [...rows].sort(
    (a, b) => ruleRank(a) - ruleRank(b) || cmp(a.busName, b.busName) || cmp(a.name, b.name),
  )
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/* ══════════════════════════════════════════════════════ the SES panel ══ */

export interface Fact {
  label: string
  value: string
}

/**
 * The account's send quota against what it has actually sent.
 *
 * Every field goes through `describeStated`, so a fact SES did not return prints
 * "unstated — …" rather than a zero. A quota panel that renders an absent
 * `Max24HourSend` as `0` tells an operator the account can send nothing, and one
 * that renders it as blank tells them nothing at all.
 */
export function quotaFacts(read: AwsRead<SesAccount>): readonly Fact[] {
  if (read.state !== "ACTUAL" && read.state !== "STALE") {
    return [{ label: "Send quota", value: describeRead(read, "the SES account") }]
  }
  const account = read.value
  return [
    {
      label: "Sent in the last 24 hours",
      value: describeStated(account.quota.sentLast24Hours, (v) => `${v} message(s)`),
    },
    {
      label: "24-hour quota",
      value: describeStated(account.quota.max24HourSend, (v) => `${v} message(s)`),
    },
    {
      label: "Quota spent",
      value: describeStated(account.quotaUsed, (v) => `${Math.round(v * 100)}%`),
    },
    {
      label: "Maximum send rate",
      value: describeStated(account.quota.maxSendRate, (v) => `${v} message(s) per second`),
    },
    {
      label: "Account-wide sending",
      value: describeStated(account.sendingEnabled, (v) =>
        v ? "enabled" : "DISABLED — SES accepts nothing at all from this account",
      ),
    },
    {
      label: "Reputation enforcement",
      value: describeStated(account.enforcementStatus, (v) => v),
    },
    {
      label: "Auto-suppressed reasons",
      value: describeStated(account.suppressedReasons, (v) =>
        v.length > 0 ? v.join(", ") : "none — SES suppresses nothing automatically",
      ),
    },
    {
      label: "Production-access review",
      value: describeStated(
        account.productionAccessReview,
        (v) => `AWS recorded status ${v.status}${v.caseId ? ` (case ${v.caseId})` : ""}`,
      ),
    },
  ]
}

/**
 * What SES actually accepted in the metric window, as opposed to what the quota
 * allows.
 *
 * `no-datapoints` is its own arm and it is the interesting one on this page: a
 * platform that believes it is sending mail and has published no `Send`
 * datapoint in the last hour is a platform that is not sending mail.
 */
export type SendRate =
  | { kind: "sends"; total: number; windowMs: number; latestAt: string }
  | { kind: "no-datapoints"; why: string }
  | { kind: "not-read"; why: string }

export function sendRateFrom(
  series: AwsRead<readonly MetricSeries[]>,
  windowMs: number,
): SendRate {
  if (series.state !== "ACTUAL" && series.state !== "STALE") {
    return {
      kind: "not-read",
      why: describeRead(series, `${SEND_METRIC.namespace} ${SEND_METRIC.metricName}`),
    }
  }
  const found = series.value.find((s) => s.key === SEND_RATE_KEY)
  if (!found) {
    return {
      kind: "not-read",
      why: `cloudwatch:GetMetricData returned no series under the key ${SEND_RATE_KEY}.`,
    }
  }
  if (found.summary.kind !== "datapoints") {
    if (found.summary.kind === "no-datapoints") {
      return {
        kind: "no-datapoints",
        why:
          `${found.summary.why} SES publishes a Send datapoint for every message it accepts, so ` +
          `an hour with none means this account sent nothing — not that the metric is missing.`,
      }
    }
    return { kind: "not-read", why: found.summary.why }
  }
  // Summed rather than averaged: the stat is already `Sum` per period, so the
  // total over the window is the sum of the periods. A mean would be messages
  // per five minutes presented as messages.
  const total = found.datapoints.reduce((sum, point) => sum + point.value, 0)
  return { kind: "sends", total, windowMs, latestAt: found.summary.latest.at }
}

/** The sentence the send-rate line prints. */
export function describeSendRate(rate: SendRate): string {
  switch (rate.kind) {
    case "sends":
      return (
        `${rate.total} message(s) accepted by SES in the last ` +
        `${Math.round(rate.windowMs / 60_000)} minutes, most recently at ${rate.latestAt}`
      )
    case "no-datapoints":
      return `unknown — ${rate.why}`
    case "not-read":
      return `unknown — ${rate.why}`
  }
}

/* ═════════════════════════════════════════════════════════ page assembly ══ */

/**
 * The arms of a reading that carry no value.
 *
 * The same type `components/md3/UnknownState.tsx` accepts, `Extract`ed over the
 * real union rather than restated, so a fifth valueless arm added to `read.ts`
 * lands here by construction.
 */
export type UnknownArm = Extract<
  AwsRead<unknown>,
  { state: "DENIED" | "THROTTLED" | "UNCONFIGURED" | "ERROR" }
>

/**
 * The unknown arm of a reading, or null when it answered.
 *
 * A `switch` rather than a boolean helper plus a cast: the cast is exactly what
 * would let an ACTUAL read reach a panel that says "refused".
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

export const SECTIONS = [
  "answer",
  "failed-deliveries",
  "schedules",
  "sending",
  "queues",
  "provenance",
] as const

export type SectionId = (typeof SECTIONS)[number]

/**
 * Where each card goes.
 *
 * The answer is always first and the provenance is always last. The two cards
 * that MOVE are the dead-letter card and the schedules card, and they move for
 * the same reason `health`'s AWS card does: during an incident the thing that
 * failed is the second thing read and cannot be under forty rows of queue
 * depths, while outside one a negative answer is not worth the top of the page.
 */
export function sectionOrder(processing: Processing): readonly SectionId[] {
  const top: SectionId[] = []
  const bottom: SectionId[] = []
  ;(processing.hoistDeadLetters ? top : bottom).push("failed-deliveries")
  ;(processing.hoistSchedules ? top : bottom).push("schedules")
  return ["answer", ...top, "sending", "queues", ...bottom, "provenance"]
}

/** A card's supporting line, with the instant it describes attached. */
export function statedAsOf(what: string, asOf: string): string {
  return `${what}. Read at ${asOf}.`
}

/**
 * Where the page came from: every call it made, and the estate that answered.
 *
 * `Not known — …` rather than a placeholder for anything identity did not
 * resolve. An invented account id on a provenance panel is the one place a
 * fabricated fact would be believed without question.
 */
export function provenanceOf(input: {
  identityState: string
  accountId: string | null
  region: string | null
  partition: string | null
  principal: string | null
  sesState: string
  queuesState: string
  rulesState: string
  metricsState: string
  asOf: string
  refreshMs: { ses: number; queues: number; rules: number; metrics: number }
}): readonly Fact[] {
  const identityWhy =
    input.identityState === "ACTUAL" || input.identityState === "STALE"
      ? "the identity read answered but did not carry it"
      : `sts:GetCallerIdentity came back ${input.identityState}, so this console has no estate to name`
  const orUnknown = (value: string | null) =>
    value && value.trim() !== "" ? value : `Not known — ${identityWhy}`

  return [
    { label: "Read", value: "ses:GetAccount, ses:ListEmailIdentities, ses:ListSuppressedDestinations" },
    { label: "SES answered", value: input.sesState },
    { label: "Read", value: "sqs:ListQueues, sqs:GetQueueAttributes" },
    { label: "SQS answered", value: input.queuesState },
    { label: "Read", value: "events:ListRules, events:ListTargetsByRule" },
    { label: "EventBridge answered", value: input.rulesState },
    {
      label: "Read",
      value: `cloudwatch:GetMetricData — ${OLDEST_AGE_METRIC.namespace} ${OLDEST_AGE_METRIC.metricName}, ${SEND_METRIC.namespace} ${SEND_METRIC.metricName}`,
    },
    { label: "CloudWatch answered", value: input.metricsState },
    { label: "Account", value: orUnknown(input.accountId) },
    { label: "Region", value: orUnknown(input.region) },
    { label: "Partition", value: orUnknown(input.partition) },
    { label: "As", value: orUnknown(input.principal) },
    {
      label: "Refreshed",
      value:
        `SES every ${Math.round(input.refreshMs.ses / 1000)}s, queues every ` +
        `${Math.round(input.refreshMs.queues / 1000)}s, rules every ` +
        `${Math.round(input.refreshMs.rules / 1000)}s, metrics every ` +
        `${Math.round(input.refreshMs.metrics / 1000)}s`,
    },
    { label: "This reading", value: input.asOf },
  ]
}
