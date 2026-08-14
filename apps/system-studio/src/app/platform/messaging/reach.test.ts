import type { MetricSeries } from "../../../lib/aws/metrics"
import type { AwsRead } from "../../../lib/aws/read"
import type { RuleRow } from "../../../lib/aws/eventbridge"
import type { DeadLetterState, QueueDepth, QueueReading } from "../../../lib/aws/sqs"
import type { SesAccount, SesMailabilityVerdict } from "../../../lib/aws/ses"

import {
  MAX_QUEUE_AGE_QUERIES,
  PROCESSING_TONE,
  REACH_TONE,
  SEND_RATE_KEY,
  STALLED_AFTER_SECONDS,
  composeQueues,
  deadLetterArns,
  describeAge,
  describeSendRate,
  disabledSchedules,
  formatSeconds,
  messagingMetricSpecs,
  metricWindow,
  oldestAgeFor,
  processingAnswer,
  provenanceOf,
  quotaFacts,
  queueAgeKey,
  rankedRules,
  reachAnswer,
  ruleRank,
  sectionOrder,
  sendRateFrom,
  unknownArm,
} from "./reach"

/**
 * What `/platform/messaging` says, decided without a browser and without an
 * estate.
 *
 * Two failures this file exists to catch, and both of them read GREEN on a
 * console that has them:
 *
 *   1. **A sandbox account rendered as "mail works".** SES accepts the API call,
 *      an identity is verified, `mailabilityVerdict` returns `CAN_SEND` — and
 *      every recipient who is not themselves a verified identity is silently
 *      dropped. A page keyed on the verdict alone prints the same reassuring
 *      badge for a production account and for one that reaches four people.
 *   2. **A refused read rendered as "nothing is waiting".** `CLEAR` is
 *      reachable here only when every reading answered; every other path has its
 *      own verdict and its own sentence. That is STUDIO-000-007 at the level of
 *      the page's headline rather than the level of one panel.
 *
 * It runs under `apps/web`'s jest, whose `roots` include
 * `apps/system-studio/src`. The Studio has no jest of its own, deliberately; see
 * the comment in `apps/web/jest.config.js`.
 *
 * Every identifier below is constructed. Account `123456789012` is AWS's own
 * documentation account, the domains are RFC 2606 reserved names, and no queue,
 * rule or identity here corresponds to a real resource.
 */

/* ═══════════════════════════════════════════════════════════════ fixtures ══ */

const ACCOUNT = "123456789012"
const REGION = "example-region-1"

const depth = (over: Partial<QueueDepth> = {}): QueueDepth => ({
  arn: `arn:aws:sqs:${REGION}:${ACCOUNT}:example-default`,
  visible: 0,
  inFlight: 0,
  delayed: 0,
  redrive: { kind: "none" },
  redriveAllow: { kind: "absent" },
  visibilityTimeoutSeconds: 30,
  messageRetentionSeconds: 345_600,
  createdAt: null,
  lastModifiedAt: null,
  ...over,
})

const queue = (name: string, over: Partial<QueueReading> = {}): QueueReading => {
  const arn = `arn:aws:sqs:${REGION}:${ACCOUNT}:${name}`
  return {
    url: `https://sqs.${REGION}.example.invalid/${ACCOUNT}/${name}`,
    name,
    arn,
    arnProvenance: "AWS's own QueueArn attribute",
    region: REGION,
    partition: "aws",
    accountId: ACCOUNT,
    attribution: { kind: "shared" },
    depth: {
      state: "ACTUAL",
      capability: "sqs:GetQueueAttributes",
      value: depth({ arn }),
      asOf: "2026-01-01T00:00:00.000Z",
      fresh: true,
    },
    oldestMessage: {
      state: "NOT_READABLE",
      needs: "cloudwatch:GetMetricData",
      metric: "AWS/SQS ApproximateAgeOfOldestMessage",
      why: "constructed fixture",
    },
    refreshMs: 60_000,
    asOf: "2026-01-01T00:00:00.000Z",
    ...over,
  }
}

const queues = (...values: QueueReading[]): AwsRead<readonly QueueReading[]> => ({
  state: "ACTUAL",
  capability: "sqs:ListQueues",
  value: values,
  asOf: "2026-01-01T00:00:00.000Z",
  fresh: true,
})

const deniedQueues: AwsRead<readonly QueueReading[]> = {
  state: "DENIED",
  capability: "sqs:ListQueues",
  action: "sqs:ListQueues",
  principal: `arn:aws:sts::${ACCOUNT}:assumed-role/example-role/example-session`,
  accountId: ACCOUNT,
  region: REGION,
  partition: "aws",
  errorCode: "AccessDeniedException",
  minimumStatement: '{"Effect":"Allow","Action":"sqs:ListQueues","Resource":"*"}',
}

const series = (over: Partial<MetricSeries> = {}): MetricSeries => ({
  key: queueAgeKey("example-default"),
  namespace: "AWS/SQS",
  metricName: "ApproximateAgeOfOldestMessage",
  dimensions: [{ name: "QueueName", value: "example-default" }],
  stat: "Maximum",
  periodSeconds: 300,
  label: null,
  datapoints: [],
  status: { kind: "complete" },
  summary: { kind: "no-datapoints", why: "CloudWatch published nothing in this window." },
  coverage: {
    expectedDatapoints: 12,
    presentDatapoints: 0,
    missingDatapoints: 12,
    malformedDatapoints: 0,
  },
  attribution: { kind: "shared" },
  region: REGION,
  partition: "aws",
  accountId: ACCOUNT,
  refreshMs: 60_000,
  asOf: "2026-01-01T00:00:00.000Z",
  ...over,
})

const withAge = (queueName: string, seconds: number): MetricSeries =>
  series({
    key: queueAgeKey(queueName),
    dimensions: [{ name: "QueueName", value: queueName }],
    datapoints: [{ at: "2026-01-01T00:00:00.000Z", value: seconds }],
    summary: {
      kind: "datapoints",
      count: 1,
      latest: { at: "2026-01-01T00:00:00.000Z", value: seconds },
      earliest: { at: "2026-01-01T00:00:00.000Z", value: seconds },
      min: seconds,
      max: seconds,
      mean: seconds,
    },
  })

const seriesRead = (...values: MetricSeries[]): AwsRead<readonly MetricSeries[]> => ({
  state: "ACTUAL",
  capability: "cloudwatch:GetMetricData",
  value: values,
  asOf: "2026-01-01T00:00:00.000Z",
  fresh: true,
})

const deniedSeries: AwsRead<readonly MetricSeries[]> = {
  state: "DENIED",
  capability: "cloudwatch:GetMetricData",
  action: "cloudwatch:GetMetricData",
  principal: `arn:aws:sts::${ACCOUNT}:assumed-role/example-role/example-session`,
  accountId: ACCOUNT,
  region: REGION,
  partition: "aws",
  errorCode: "AccessDeniedException",
  minimumStatement: '{"Effect":"Allow","Action":"cloudwatch:GetMetricData","Resource":"*"}',
}

const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  name: "example-reminders",
  arn: `arn:aws:events:${REGION}:${ACCOUNT}:rule/example-reminders`,
  busName: "default",
  verdict: "SCHEDULED",
  detail: "a constructed rule",
  schedule: "cron(0 13 * * ? *)",
  eventDriven: false,
  state: "ENABLED",
  managedBy: null,
  description: null,
  targetsRead: {
    state: "EMPTY",
    capability: "events:ListTargetsByRule",
    asOf: "2026-01-01T00:00:00.000Z",
  },
  targetCount: 0,
  attribution: { kind: "shared" },
  ...over,
})

const rules = (...values: RuleRow[]): AwsRead<readonly RuleRow[]> => ({
  state: "ACTUAL",
  capability: "events:ListRules",
  value: values,
  asOf: "2026-01-01T00:00:00.000Z",
  fresh: true,
})

const deniedRules: AwsRead<readonly RuleRow[]> = {
  state: "DENIED",
  capability: "events:ListRules",
  action: "events:ListRules",
  principal: `arn:aws:sts::${ACCOUNT}:assumed-role/example-role/example-session`,
  accountId: ACCOUNT,
  region: REGION,
  partition: "aws",
  errorCode: "AccessDeniedException",
  minimumStatement: '{"Effect":"Allow","Action":"events:ListRules","Resource":"*"}',
}

const noDeadLetters: DeadLetterState = { kind: "none-configured", queuesRead: 1 }

/* ═════════════════════════════════════ 1. can this platform reach people ══ */

describe("the reach answer, and the sandbox it must not soften", () => {
  test("a verified identity in a SANDBOX account is NOT 'reaches anyone'", () => {
    // `mailabilityVerdict` returns CAN_SEND here — SES will accept the call —
    // and the recipient restriction is the whole difference. A page keyed on
    // the verdict alone prints the same green badge for this and for a
    // production account.
    const sandbox: SesMailabilityVerdict = {
      verdict: "CAN_SEND",
      sendableFrom: ["example.invalid"],
      recipientRestriction:
        "this account is in the SES sandbox: SES delivers only to recipients that are themselves verified identities",
      why: "an identity is verified, but the account is in the sandbox",
    }
    const reach = reachAnswer(sandbox)
    expect(reach.verdict).toBe("REACHES_ONLY_VERIFIED")
    expect(reach.tone).toBe("bad")
    expect(reach.tone).not.toBe("ok")
    expect(reach.because).toContain("sandbox")
    expect(reach.because).toContain("SES accepts the call and drops the message")
  })

  test("production access with a verified identity reaches anyone", () => {
    const production: SesMailabilityVerdict = {
      verdict: "CAN_SEND",
      sendableFrom: ["example.invalid"],
      recipientRestriction: null,
      why: "production access is granted and at least one identity is verified",
    }
    const reach = reachAnswer(production)
    expect(reach.verdict).toBe("REACHES_ANYONE")
    expect(reach.tone).toBe(REACH_TONE.REACHES_ANYONE)
    expect(reach.sendableFrom).toEqual(["example.invalid"])
  })

  test("no verified identity is 'reaches nobody', and it names what is blocked", () => {
    const blocked: SesMailabilityVerdict = {
      verdict: "CANNOT_SEND",
      sendableFrom: [],
      blocked: [{ name: "example.invalid", why: "PENDING — SES will refuse to send" }],
      why: "no SES identity is both verified and sending-enabled",
    }
    const reach = reachAnswer(blocked)
    expect(reach.verdict).toBe("CANNOT_REACH_ANYONE")
    expect(reach.headline).toContain("cannot send mail at all")
    expect(reach.because).toContain("example.invalid")
    expect(reach.because).toContain("PENDING")
  })

  test("a read that did not answer is UNKNOWN — never 'reaches nobody'", () => {
    // The distinction that matters: "we looked and nothing can send" is an
    // outage to fix, and "we were not allowed to look" is a grant to make.
    const unknown: SesMailabilityVerdict = {
      verdict: "UNKNOWN",
      why: "the SES account could not be read — refused ses:GetAccount",
    }
    const reach = reachAnswer(unknown)
    expect(reach.verdict).toBe("UNKNOWN")
    expect(reach.tone).toBe("warn")
    expect(reach.headline).toContain("NOT known")
    expect(reach.because).toContain("refused")
    expect(reach.sendableFrom).toEqual([])
  })
})

/* ═══════════════════════ 2. the age of the oldest message, and its absence ══ */

describe("the oldest-message age", () => {
  test("no datapoints is an absence, never an age of zero", () => {
    const age = oldestAgeFor("example-default", seriesRead(series()))
    expect(age.kind).toBe("no-datapoints")
    expect(describeAge(age)).toContain("unknown")
    // The number that must not appear.
    expect(describeAge(age)).not.toMatch(/\b0s\b/)
  })

  test("a refused metric read is not-read, and it carries the refusal", () => {
    const age = oldestAgeFor("example-default", deniedSeries)
    expect(age.kind).toBe("not-read")
    expect(describeAge(age)).toContain("cloudwatch:GetMetricData")
  })

  test("a queue past the query cap reads not-read, naming the cap", () => {
    const age = oldestAgeFor("example-uncapped", seriesRead(withAge("example-default", 10)))
    expect(age.kind).toBe("not-read")
    if (age.kind !== "not-read") throw new Error("unreachable")
    expect(age.why).toContain(String(MAX_QUEUE_AGE_QUERIES))
  })

  test("a measured age is carried with the instant it was measured", () => {
    const age = oldestAgeFor("example-default", seriesRead(withAge("example-default", 3_600)))
    expect(age).toEqual({ kind: "seconds", seconds: 3_600, at: "2026-01-01T00:00:00.000Z" })
    expect(describeAge(age)).toContain("1h 0m")
  })

  test("formatSeconds never prints a bare float, and refuses a non-number", () => {
    expect(formatSeconds(45)).toBe("45s")
    expect(formatSeconds(90)).toBe("1m 30s")
    expect(formatSeconds(3_720)).toBe("1h 2m")
    expect(formatSeconds(90_000)).toBe("1d 1h")
    expect(formatSeconds(Number.NaN)).toContain("did not return as a number")
  })
})

/* ══════════════════════════════════════════════════ 3. the metric request ══ */

describe("the metric queries this page sends", () => {
  test("the SES send series is always asked for, even with no queues", () => {
    // `validateRequest` refuses an empty request, so a page that let the queue
    // listing decide whether any metric is read would lose the send rate on an
    // account with no queues.
    const specs = messagingMetricSpecs(deniedQueues)
    expect(specs.map((s) => s.key)).toEqual([SEND_RATE_KEY])
    expect(specs[0].namespace).toBe("AWS/SES")
  })

  test("one age query per queue, dimensioned on the queue's own name", () => {
    const specs = messagingMetricSpecs(queues(queue("example-default"), queue("example-email")))
    expect(specs.map((s) => s.key)).toEqual([
      SEND_RATE_KEY,
      queueAgeKey("example-default"),
      queueAgeKey("example-email"),
    ])
    expect(specs[1].dimensions).toEqual([{ name: "QueueName", value: "example-default" }])
    expect(specs[1].resourceArn).toBe(`arn:aws:sqs:${REGION}:${ACCOUNT}:example-default`)
  })

  test("a duplicate queue name yields one query, not a request AWS refuses whole", () => {
    const specs = messagingMetricSpecs(
      queues(queue("example-default"), queue("example-default", { url: "https://other.invalid/x" })),
    )
    expect(specs.filter((s) => s.key === queueAgeKey("example-default"))).toHaveLength(1)
  })

  test("the cap counts queues, not the SES query", () => {
    const many = Array.from({ length: MAX_QUEUE_AGE_QUERIES + 5 }, (_, i) => queue(`example-${i}`))
    const specs = messagingMetricSpecs(queues(...many))
    expect(specs).toHaveLength(MAX_QUEUE_AGE_QUERIES + 1)
  })

  test("the window ends where the load was taken and is one hour wide", () => {
    const window = metricWindow(new Date("2026-01-01T12:00:00.000Z"))
    expect(window.endIso).toBe("2026-01-01T12:00:00.000Z")
    expect(window.startIso).toBe("2026-01-01T11:00:00.000Z")
  })
})

/* ═════════════════════════════════════════════════════ 4. the queue rows ══ */

describe("the queue rows", () => {
  test("a dead-letter queue is identified from the redrive data, never the name", () => {
    const dlq = queue("failed-email")
    const state: DeadLetterState = {
      kind: "clear",
      deadLetterQueueArns: [`arn:aws:sqs:${REGION}:${ACCOUNT}:failed-email`],
      unreadable: [],
    }
    expect(deadLetterArns(state).has(`arn:aws:sqs:${REGION}:${ACCOUNT}:failed-email`)).toBe(true)
    const rows = composeQueues(queues(dlq, queue("dlq-inbox-archive")), state, seriesRead())
    expect(rows[0].isDeadLetter).toBe(true)
    // Named like a dead-letter queue, and not one.
    expect(rows[1].isDeadLetter).toBe(false)
  })

  test("a queue whose depth was refused reports null, never zero", () => {
    const refused = queue("example-default", {
      depth: {
        state: "DENIED",
        capability: "sqs:GetQueueAttributes",
        action: "sqs:GetQueueAttributes",
        principal: `arn:aws:sts::${ACCOUNT}:assumed-role/example-role/example-session`,
        accountId: ACCOUNT,
        region: REGION,
        partition: "aws",
        errorCode: "AccessDeniedException",
        minimumStatement: '{"Effect":"Allow","Action":"sqs:GetQueueAttributes","Resource":"*"}',
      },
    })
    const rows = composeQueues(queues(refused), noDeadLetters, seriesRead())
    expect(rows[0].visible).toBeNull()
    expect(rows[0].inFlight).toBeNull()
    expect(rows[0].stalled).toBe(false)
  })

  test("stalled needs a MEASURED age — an unknown age is never a stall", () => {
    const backlog = queue("example-default", {
      depth: {
        state: "ACTUAL",
        capability: "sqs:GetQueueAttributes",
        value: depth({ visible: 400 }),
        asOf: "2026-01-01T00:00:00.000Z",
        fresh: true,
      },
    })
    // Age unknown: 400 messages and no measurement is not a stall this page may
    // assert.
    expect(composeQueues(queues(backlog), noDeadLetters, seriesRead())[0].stalled).toBe(false)
    // Age measured and past the threshold: it is.
    const stalled = composeQueues(
      queues(backlog),
      noDeadLetters,
      seriesRead(withAge("example-default", STALLED_AFTER_SECONDS)),
    )
    expect(stalled[0].stalled).toBe(true)
    // Age measured and under it: not.
    const fresh = composeQueues(
      queues(backlog),
      noDeadLetters,
      seriesRead(withAge("example-default", STALLED_AFTER_SECONDS - 1)),
    )
    expect(fresh[0].stalled).toBe(false)
  })

  test("an empty queue with an old measurement is not stalled", () => {
    const rows = composeQueues(
      queues(queue("example-default")),
      noDeadLetters,
      seriesRead(withAge("example-default", 99_999)),
    )
    expect(rows[0].visible).toBe(0)
    expect(rows[0].stalled).toBe(false)
  })

  test("a refused queue listing produces no rows, and never a row that says zero", () => {
    expect(composeQueues(deniedQueues, { kind: "unknown", why: "refused" }, seriesRead())).toEqual([])
  })
})

/* ═══════════════════════════════════ 5. is anything queued and unprocessed ══ */

const processing = (over: Partial<Parameters<typeof processingAnswer>[0]> = {}) =>
  processingAnswer({
    queues: queues(queue("example-default")),
    deadLetters: noDeadLetters,
    rows: composeQueues(queues(queue("example-default")), noDeadLetters, seriesRead()),
    rules: rules(rule()),
    ruleRows: [rule()],
    ...over,
  })

describe("the processing answer, and the order it decides in", () => {
  test("a dead-letter queue holding anything outranks everything else", () => {
    const failed: DeadLetterState = {
      kind: "failed-deliveries",
      failures: [
        {
          queueName: "example-email-dlq",
          queueUrl: `https://sqs.${REGION}.example.invalid/${ACCOUNT}/example-email-dlq`,
          queueArn: `arn:aws:sqs:${REGION}:${ACCOUNT}:example-email-dlq`,
          messages: 3,
          inFlight: 0,
          sourceQueueArns: [`arn:aws:sqs:${REGION}:${ACCOUNT}:example-email`],
          attribution: { kind: "shared" },
          asOf: "2026-01-01T00:00:00.000Z",
        },
      ],
      totalMessages: 3,
      unreadable: [],
    }
    // Everything else is ALSO wrong: a disabled schedule and a stalled backlog.
    const answer = processingAnswer({
      queues: queues(queue("example-default")),
      deadLetters: failed,
      rows: composeQueues(
        queues(
          queue("example-default", {
            depth: {
              state: "ACTUAL",
              capability: "sqs:GetQueueAttributes",
              value: depth({ visible: 90 }),
              asOf: "2026-01-01T00:00:00.000Z",
              fresh: true,
            },
          }),
        ),
        failed,
        seriesRead(withAge("example-default", 99_999)),
      ),
      rules: rules(rule({ verdict: "DISABLED", state: "DISABLED" })),
      ruleRows: [rule({ verdict: "DISABLED", state: "DISABLED" })],
    })
    expect(answer.verdict).toBe("FAILED_DELIVERIES")
    expect(answer.tone).toBe("bad")
    expect(answer.headline).toContain("nobody was told")
    expect(answer.headline).toContain("example-email-dlq")
    expect(answer.hoistDeadLetters).toBe(true)
  })

  test("a disabled SCHEDULED rule outranks a stalled backlog", () => {
    const backlog = queue("example-default", {
      depth: {
        state: "ACTUAL",
        capability: "sqs:GetQueueAttributes",
        value: depth({ visible: 90 }),
        asOf: "2026-01-01T00:00:00.000Z",
        fresh: true,
      },
    })
    const off = rule({ verdict: "DISABLED", state: "DISABLED" })
    const answer = processing({
      rows: composeQueues(
        queues(backlog),
        noDeadLetters,
        seriesRead(withAge("example-default", 99_999)),
      ),
      rules: rules(off),
      ruleRows: [off],
    })
    expect(answer.verdict).toBe("SCHEDULE_STOPPED")
    expect(answer.headline).toContain("example-reminders")
    expect(answer.headline).toContain("cron(0 13 * * ? *)")
    expect(answer.hoistSchedules).toBe(true)
  })

  test("a disabled rule with no schedule is not a stopped schedule", () => {
    // It is still a defect, and `eventbridge.ts` still verdicts it DISABLED —
    // but it is not the "a job silently stopped" finding this page ranks first,
    // and calling it one would put a pattern rule nobody uses above a backlog.
    const off = rule({ verdict: "DISABLED", state: "DISABLED", schedule: null, eventDriven: true })
    expect(disabledSchedules([off])).toEqual([])
    expect(processing({ rules: rules(off), ruleRows: [off] }).verdict).toBe("CLEAR")
  })

  test("a measured backlog past the threshold is BACKLOG_STALLED", () => {
    const backlog = queue("example-default", {
      depth: {
        state: "ACTUAL",
        capability: "sqs:GetQueueAttributes",
        value: depth({ visible: 12 }),
        asOf: "2026-01-01T00:00:00.000Z",
        fresh: true,
      },
    })
    const answer = processing({
      queues: queues(backlog),
      rows: composeQueues(
        queues(backlog),
        noDeadLetters,
        seriesRead(withAge("example-default", STALLED_AFTER_SECONDS + 1)),
      ),
    })
    expect(answer.verdict).toBe("BACKLOG_STALLED")
    expect(answer.headline).toContain("example-default")
  })

  test("a backlog with no measurable age is its own verdict, never 'moving'", () => {
    const backlog = queue("example-default", {
      depth: {
        state: "ACTUAL",
        capability: "sqs:GetQueueAttributes",
        value: depth({ visible: 12 }),
        asOf: "2026-01-01T00:00:00.000Z",
        fresh: true,
      },
    })
    const answer = processing({
      queues: queues(backlog),
      rows: composeQueues(queues(backlog), noDeadLetters, deniedSeries),
    })
    expect(answer.verdict).toBe("BACKLOG_AGE_UNKNOWN")
    expect(answer.tone).toBe(PROCESSING_TONE.BACKLOG_AGE_UNKNOWN)
    expect(answer.headline).toContain("not established")
  })

  test("a fresh backlog is work in progress, not a defect", () => {
    const backlog = queue("example-default", {
      depth: {
        state: "ACTUAL",
        capability: "sqs:GetQueueAttributes",
        value: depth({ visible: 12 }),
        asOf: "2026-01-01T00:00:00.000Z",
        fresh: true,
      },
    })
    const answer = processing({
      queues: queues(backlog),
      rows: composeQueues(queues(backlog), noDeadLetters, seriesRead(withAge("example-default", 10))),
    })
    expect(answer.verdict).toBe("BACKLOG_MOVING")
    expect(answer.tone).not.toBe("bad")
  })

  test("neither reading answering is UNKNOWN — never CLEAR", () => {
    const answer = processing({
      queues: deniedQueues,
      deadLetters: { kind: "unknown", why: "the SQS queue listing was refused" },
      rows: [],
      rules: deniedRules,
      ruleRows: [],
    })
    expect(answer.verdict).toBe("UNKNOWN")
    expect(answer.headline).toContain("NOT known")
    expect(answer.qualifier).toContain("sqs:ListQueues")
    expect(answer.qualifier).toContain("events:ListRules")
    expect(answer.hoistDeadLetters).toBe(true)
    expect(answer.hoistSchedules).toBe(true)
  })

  test("one reading answering and one not is PARTLY_UNKNOWN — still never CLEAR", () => {
    const answer = processing({
      rules: deniedRules,
      ruleRows: [],
    })
    expect(answer.verdict).toBe("PARTLY_UNKNOWN")
    expect(answer.headline).toContain("not a clean bill of health")
    expect(answer.qualifier).toContain("events:ListRules")
  })

  test("an unreadable queue DEPTH also blocks CLEAR", () => {
    // The listing answered, so `queues.state` is ACTUAL — but one queue's
    // attributes were refused, which means its backlog is not known. A page that
    // only checked the listing's state would print "nothing is waiting".
    const refused = queue("example-default", {
      depth: {
        state: "THROTTLED",
        capability: "sqs:GetQueueAttributes",
        retryAfterMs: 1_000,
        asOf: "2026-01-01T00:00:00.000Z",
      },
    })
    const answer = processing({
      queues: queues(refused),
      rows: composeQueues(queues(refused), noDeadLetters, seriesRead()),
    })
    expect(answer.verdict).toBe("PARTLY_UNKNOWN")
    expect(answer.qualifier).toContain("example-default")
  })

  test("everything readable and nothing waiting is CLEAR, with no qualifier", () => {
    const answer = processing()
    expect(answer.verdict).toBe("CLEAR")
    expect(answer.tone).toBe("ok")
    expect(answer.qualifier).toBe("")
  })
})

/* ══════════════════════════════════════════════════════ 6. the rule order ══ */

describe("the rule order", () => {
  test("a disabled SCHEDULED rule is first — above every other disabled rule", () => {
    const rows: RuleRow[] = [
      rule({ name: "z-scheduled" }),
      rule({ name: "b-disabled-pattern", verdict: "DISABLED", state: "DISABLED", schedule: null, eventDriven: true }),
      rule({ name: "a-no-target", verdict: "NO_TARGET" }),
      rule({ name: "c-disabled-schedule", verdict: "DISABLED", state: "DISABLED" }),
    ]
    expect(rankedRules(rows).map((r) => r.name)).toEqual([
      "c-disabled-schedule",
      "b-disabled-pattern",
      "a-no-target",
      "z-scheduled",
    ])
  })

  test("an unclassified verdict sorts LAST, never above a switched-off rule", () => {
    const unknown = rule({ name: "a-unclassified", verdict: "NOT_A_VERDICT" as RuleRow["verdict"] })
    const off = rule({ name: "z-disabled", verdict: "DISABLED", state: "DISABLED" })
    expect(ruleRank(off)).toBeLessThan(ruleRank(unknown))
    expect(rankedRules([unknown, off]).map((r) => r.name)).toEqual(["z-disabled", "a-unclassified"])
  })

  test("the order is a function of the data, not of pagination order", () => {
    const a = rule({ name: "a", busName: "default" })
    const b = rule({ name: "b", busName: "default" })
    expect(rankedRules([b, a]).map((r) => r.name)).toEqual(rankedRules([a, b]).map((r) => r.name))
  })
})

/* ═════════════════════════════════════════════════════ 7. the SES panels ══ */

describe("the SES quota panel", () => {
  const account = (over: Partial<SesAccount> = {}): AwsRead<SesAccount> => ({
    state: "ACTUAL",
    capability: "ses:GetAccount",
    asOf: "2026-01-01T00:00:00.000Z",
    fresh: true,
    value: {
      productionAccess: { state: "SANDBOX", consequence: "sandbox" },
      sendingEnabled: { stated: true, value: true },
      enforcementStatus: { stated: true, value: "HEALTHY" },
      quota: {
        max24HourSend: { stated: true, value: 200 },
        maxSendRate: { stated: true, value: 1 },
        sentLast24Hours: { stated: true, value: 50 },
      },
      quotaUsed: { stated: true, value: 0.25 },
      suppressedReasons: { stated: true, value: ["BOUNCE", "COMPLAINT"] },
      productionAccessReview: {
        stated: false,
        why: "SES returned no Details.ReviewDetails",
      },
      attribution: { kind: "shared" },
      ...over,
    },
  })

  test("a quota SES did not state prints 'unstated', never a zero", () => {
    const facts = quotaFacts(
      account({
        quota: {
          max24HourSend: { stated: false, why: "ses:GetAccount answered without Max24HourSend" },
          maxSendRate: { stated: true, value: 1 },
          sentLast24Hours: { stated: true, value: 50 },
        },
        quotaUsed: { stated: false, why: "SES did not state both halves" },
      }),
    )
    const quota = facts.find((f) => f.label === "24-hour quota")
    expect(quota?.value).toContain("unstated")
    expect(quota?.value).not.toMatch(/^0 /)
  })

  test("no production-access review is reported as unstated, never as an approval", () => {
    // The fabricated-approval failure, one level up: an absent
    // `Details.ReviewDetails` must never become "approved".
    const facts = quotaFacts(account())
    const review = facts.find((f) => f.label === "Production-access review")
    expect(review?.value).toContain("unstated")
    expect(review?.value).not.toMatch(/approved|granted/i)
  })

  test("a refused account read gives one fact carrying the refusal", () => {
    const facts = quotaFacts({
      state: "DENIED",
      capability: "ses:GetAccount",
      action: "ses:GetAccount",
      principal: `arn:aws:sts::${ACCOUNT}:assumed-role/example-role/example-session`,
      accountId: ACCOUNT,
      region: REGION,
      partition: "aws",
      errorCode: "AccessDeniedException",
      minimumStatement: '{"Effect":"Allow","Action":"ses:GetAccount","Resource":"*"}',
    })
    expect(facts).toHaveLength(1)
    expect(facts[0].value).toContain("ses:GetAccount")
  })
})

describe("the send rate", () => {
  const sendSeries = (over: Partial<MetricSeries> = {}): MetricSeries =>
    series({
      key: SEND_RATE_KEY,
      namespace: "AWS/SES",
      metricName: "Send",
      stat: "Sum",
      dimensions: [],
      ...over,
    })

  test("the window's sends are summed, not averaged", () => {
    const rate = sendRateFrom(
      seriesRead(
        sendSeries({
          datapoints: [
            { at: "2026-01-01T00:00:00.000Z", value: 4 },
            { at: "2026-01-01T00:05:00.000Z", value: 6 },
          ],
          summary: {
            kind: "datapoints",
            count: 2,
            latest: { at: "2026-01-01T00:05:00.000Z", value: 6 },
            earliest: { at: "2026-01-01T00:00:00.000Z", value: 4 },
            min: 4,
            max: 6,
            mean: 5,
          },
        }),
      ),
      3_600_000,
    )
    expect(rate).toEqual({
      kind: "sends",
      total: 10,
      windowMs: 3_600_000,
      latestAt: "2026-01-01T00:05:00.000Z",
    })
    expect(describeSendRate(rate)).toContain("10 message(s)")
  })

  test("an hour with no Send datapoint says the account sent nothing", () => {
    const rate = sendRateFrom(seriesRead(sendSeries()), 3_600_000)
    expect(rate.kind).toBe("no-datapoints")
    expect(describeSendRate(rate)).toContain("sent nothing")
  })

  test("a refused metric read is not-read, never zero sends", () => {
    const rate = sendRateFrom(deniedSeries, 3_600_000)
    expect(rate.kind).toBe("not-read")
    expect(describeSendRate(rate)).toContain("cloudwatch:GetMetricData")
    expect(describeSendRate(rate)).not.toContain("0 message(s)")
  })
})

/* ══════════════════════════════════════════ 8. the page's own assembly ══ */

describe("the page assembly", () => {
  test("the dead-letter card is hoisted under the answer when anything failed", () => {
    const order = sectionOrder({
      verdict: "FAILED_DELIVERIES",
      tone: "bad",
      headline: "x",
      qualifier: "",
      hoistDeadLetters: true,
      hoistSchedules: false,
    })
    expect(order[0]).toBe("answer")
    expect(order[1]).toBe("failed-deliveries")
    expect(order[order.length - 1]).toBe("provenance")
    expect(order).toHaveLength(6)
  })

  test("and it is below the queues when nothing failed", () => {
    const order = sectionOrder({
      verdict: "CLEAR",
      tone: "ok",
      headline: "x",
      qualifier: "",
      hoistDeadLetters: false,
      hoistSchedules: false,
    })
    expect(order).toEqual([
      "answer",
      "sending",
      "queues",
      "failed-deliveries",
      "schedules",
      "provenance",
    ])
  })

  test("every section appears exactly once, whatever the hoists say", () => {
    for (const dead of [true, false]) {
      for (const sched of [true, false]) {
        const order = sectionOrder({
          verdict: "CLEAR",
          tone: "ok",
          headline: "x",
          qualifier: "",
          hoistDeadLetters: dead,
          hoistSchedules: sched,
        })
        expect(new Set(order).size).toBe(order.length)
        expect(order).toHaveLength(6)
      }
    }
  })

  test("unknownArm narrows to the valueless arms and nothing else", () => {
    expect(unknownArm(deniedQueues)).toBe(deniedQueues)
    expect(unknownArm(queues(queue("example-default")))).toBeNull()
    expect(
      unknownArm({ state: "EMPTY", capability: "sqs:ListQueues", asOf: "2026-01-01T00:00:00.000Z" }),
    ).toBeNull()
  })

  test("provenance never invents an account, a region or a principal", () => {
    const facts = provenanceOf({
      identityState: "DENIED",
      accountId: null,
      region: null,
      partition: null,
      principal: null,
      sesState: "DENIED",
      queuesState: "DENIED",
      rulesState: "DENIED",
      metricsState: "DENIED",
      asOf: "2026-01-01T00:00:00.000Z",
      refreshMs: { ses: 60_000, queues: 60_000, rules: 300_000, metrics: 60_000 },
    })
    for (const label of ["Account", "Region", "Partition", "As"]) {
      const fact = facts.find((f) => f.label === label)
      expect(fact?.value).toContain("Not known")
      expect(fact?.value).toContain("sts:GetCallerIdentity")
    }
    // And it names every call the page made, so a reader can tell which grant
    // is missing.
    const read = facts.filter((f) => f.label === "Read").map((f) => f.value)
    expect(read.join(" ")).toContain("ses:GetAccount")
    expect(read.join(" ")).toContain("sqs:ListQueues")
    expect(read.join(" ")).toContain("events:ListRules")
    expect(read.join(" ")).toContain("cloudwatch:GetMetricData")
  })
})
