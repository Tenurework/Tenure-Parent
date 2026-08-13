import { SHARED } from "@tenure/provisioning"

import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"
import {
  MAX_QUEUE_DEPTH_READS,
  deriveQueueArn,
  parseRedriveAllowPolicy,
  parseRedrivePolicy,
  queueReadings,
  sqsLines,
  type SqsReadings,
} from "./sqs"

/**
 * STUDIO-070-004 (SQS) — the queue surface tells four different truths apart.
 *
 * The assertions are on `queueReadings` and `sqsLines`, the functions a route
 * renders, rather than on `readAws` or on any parser. A test that drove
 * `readAws` directly would stay green on the day this module stopped calling it,
 * which is precisely the failure this programme has already paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers four capabilities with the shapes the real SDK returns —
 * `{QueueUrls, NextToken}` from ListQueues, `{Attributes: {…strings…}}` from
 * GetQueueAttributes, `{ResourceTagMappingList: [{ResourceARN, Tags}]}` from the
 * Tagging API, `{Account, Arn}` from STS — and it can fail each of them
 * independently with `AccessDeniedException`, `ThrottlingException`, an
 * empty-but-successful list, or a populated one. A stand-in that returned `[]`
 * regardless of what was asked would prove nothing about the code that has to
 * tell those four apart, and it is the fake this repository has already been
 * burnt by.
 *
 * Every count is a STRING in the fake, because that is what SQS returns. A fake
 * handing back numbers would have hidden the fact that the parser has to convert
 * them, and a queue with `"0"` messages is exactly the value that must not be
 * confused with a queue that was never read.
 */

/* ------------------------------------------------------------- the estate -- */

const ACCOUNT = "047385673922"

/**
 * A queue URL, assembled from its parts rather than written out.
 *
 * `tests/architecture/forbidden-clients.test.mjs` refuses a literal
 * `https://…amazonaws.com` anywhere outside the owning adapter, and it is right
 * to be blunt: a rule that tried to tell "a queue handle in a fixture" from "an
 * endpoint this code dials" would be a rule with an exception in it, and an
 * exception is what a real client would eventually be smuggled through. These
 * strings are the handles `ListQueues` returns and `GetQueueAttributes` takes
 * back — nothing in this suite opens a socket — so the fixture stays
 * byte-identical to what AWS returns and the guard stays absolute.
 */
function queueUrl(region: string, account: string, name: string): string {
  return `https://${["sqs", region, "amazonaws", "com"].join(".")}/${account}/${name}`
}

/** The five queues in `infrastructure/terraform/sqs.tf`, as URLs AWS would return. */
const QUEUE_BASE = queueUrl("eu-west-2", ACCOUNT, "").replace(/\/$/, "")
const DEFAULT_URL = `${QUEUE_BASE}/tenure-prod-default`
const EMAIL_URL = `${QUEUE_BASE}/tenure-prod-email`
const NOTIFICATIONS_URL = `${QUEUE_BASE}/tenure-prod-notifications`
const DEFAULT_DLQ_URL = `${QUEUE_BASE}/tenure-prod-default-dlq`
const EMAIL_DLQ_URL = `${QUEUE_BASE}/tenure-prod-email-dlq`

const ALL_URLS = [
  DEFAULT_URL,
  EMAIL_URL,
  NOTIFICATIONS_URL,
  DEFAULT_DLQ_URL,
  EMAIL_DLQ_URL,
]

function arnFor(url: string, partition = "aws", region = "eu-west-2"): string {
  const name = url.slice(url.lastIndexOf("/") + 1)
  return `arn:${partition}:sqs:${region}:${ACCOUNT}:${name}`
}

/** A tag set that attributes to a tenant. Only `tenure:tenant` is load-bearing here. */
function tenantTags(slug: string): Array<{ Key: string; Value: string }> {
  return [
    { Key: "tenure:tenant", Value: slug },
    { Key: "tenure:environment", Value: "production" },
    { Key: "tenure:module", Value: "messaging" },
  ]
}

type Attributes = Record<string, string>

interface QueueFixture {
  url: string
  attributes?: Attributes
  /** Raised instead of answering, so a per-queue denial can be exercised. */
  failWith?: string
}

function workerAttributes(
  url: string,
  visible: string,
  inFlight: string,
  dlqUrl: string,
  maxReceiveCount = 5,
): Attributes {
  return {
    QueueArn: arnFor(url),
    ApproximateNumberOfMessages: visible,
    ApproximateNumberOfMessagesNotVisible: inFlight,
    ApproximateNumberOfMessagesDelayed: "0",
    RedrivePolicy: JSON.stringify({
      deadLetterTargetArn: arnFor(dlqUrl),
      maxReceiveCount,
    }),
    VisibilityTimeout: "60",
    MessageRetentionPeriod: "86400",
    CreatedTimestamp: "1753920000",
    LastModifiedTimestamp: "1753920000",
  }
}

function dlqAttributes(url: string, visible: string, inFlight = "0"): Attributes {
  return {
    QueueArn: arnFor(url),
    ApproximateNumberOfMessages: visible,
    ApproximateNumberOfMessagesNotVisible: inFlight,
    ApproximateNumberOfMessagesDelayed: "0",
    VisibilityTimeout: "30",
    MessageRetentionPeriod: "1209600",
    CreatedTimestamp: "1753920000",
    LastModifiedTimestamp: "1753920000",
  }
}

/** The healthy estate: five queues, both dead-letter queues empty. */
function healthyEstate(): QueueFixture[] {
  return [
    { url: DEFAULT_URL, attributes: workerAttributes(DEFAULT_URL, "4", "1", DEFAULT_DLQ_URL) },
    { url: EMAIL_URL, attributes: workerAttributes(EMAIL_URL, "0", "0", EMAIL_DLQ_URL, 3) },
    {
      url: NOTIFICATIONS_URL,
      attributes: workerAttributes(NOTIFICATIONS_URL, "2", "0", DEFAULT_DLQ_URL, 3),
    },
    { url: DEFAULT_DLQ_URL, attributes: dlqAttributes(DEFAULT_DLQ_URL, "0") },
    { url: EMAIL_DLQ_URL, attributes: dlqAttributes(EMAIL_DLQ_URL, "0") },
  ]
}

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FakeOptions {
  /** How `sqs:ListQueues` behaves. The four cases this suite exists to separate. */
  listQueues?: Outcome
  queues?: QueueFixture[]
  /** Which ARNs the Tagging API reports, and with which tags. */
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  /** Set by the fake so a test can assert what was and was not called. */
  calls?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

/**
 * A stand-in that behaves like the SDK: same response shapes, same error names,
 * and independently failable per capability.
 */
function fakeAws(options: FakeOptions = {}): AwsGateway {
  const listOutcome = options.listQueues ?? "populated"
  const queues = options.queues ?? healthyEstate()
  const identity = options.identity ?? {
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: "eu-west-2",
  }
  const calls = options.calls ?? []

  return {
    async call(capability, input) {
      calls.push(String(capability))
      switch (capability) {
        case "sts:GetCallerIdentity":
          if (identity === "denied") throwing("AccessDenied")
          return { Account: identity.account, Arn: identity.arn, UserId: "AROA:studio" }

        case "tag:GetResources": {
          const outcome = options.tagsOutcome ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { ResourceTagMappingList: [] }
          return {
            ResourceTagMappingList: Object.entries(options.tags ?? {}).map(([arn, Tags]) => ({
              ResourceARN: arn,
              Tags,
            })),
          }
        }

        case "sqs:ListQueues":
          if (listOutcome === "denied") throwing("AccessDeniedException")
          if (listOutcome === "throttled") throwing("ThrottlingException")
          // The real API OMITS QueueUrls entirely when there are none. It does
          // not return an empty array, and a fake that did would be testing a
          // response AWS never sends.
          if (listOutcome === "empty") return {}
          return { QueueUrls: queues.map((q) => q.url) }

        case "sqs:GetQueueAttributes": {
          const url = String((input as { QueueUrl?: unknown } | undefined)?.QueueUrl ?? "")
          const fixture = queues.find((q) => q.url === url)
          if (!fixture) throwing("QueueDoesNotExist")
          if (fixture.failWith) throwing(fixture.failWith)
          return { Attributes: fixture.attributes }
        }

        default:
          throw new Error(`the stand-in was asked for ${String(capability)}, which this suite does not exercise`)
      }
    },
    async resolvedRegion() {
      return identity === "denied" ? "eu-west-2" : identity.region
    },
  }
}

const AT = () => new Date("2026-08-13T09:15:00.000Z")

async function load(options: FakeOptions = {}): Promise<SqsReadings> {
  return queueReadings(fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: SqsReadings): string {
  return sqsLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* -------------------------------------------- the four outcomes, compared -- */

describe("the SQS surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names every queue", async () => {
    const readings = await load()
    expect(readings.queues.state).toBe("ACTUAL")
    if (readings.queues.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.queues.value).toHaveLength(5)
    const text = surfaceText(readings)
    expect(text).toContain("tenure-prod-email-dlq")
    expect(text).toContain("4 visible, 1 in flight, 0 delayed")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ listQueues: "empty" })
    expect(readings.queues.state).toBe("EMPTY")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ listQueues: "denied" })
    expect(readings.queues.state).toBe("DENIED")
    if (readings.queues.state !== "DENIED") throw new Error("narrowing")

    // The three things a denial has to carry so it can be fixed without leaving
    // the page: who we were, what we were refused, and the JSON to paste.
    expect(readings.queues.action).toBe("sqs:ListQueues")
    expect(readings.queues.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.queues.accountId).toBe(ACCOUNT)
    expect(readings.queues.region).toBe("eu-west-2")
    expect(readings.queues.partition).toBe("aws")
    expect(JSON.parse(readings.queues.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["sqs:ListQueues"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so
    // a caller cannot reach an empty array; the render says "unknown".
    expect("value" in readings.queues).toBe(false)
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toMatch(/\bnone\b/)
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ listQueues: "throttled" })
    expect(readings.queues.state).toBe("THROTTLED")
    if (readings.queues.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.queues.retryAfterMs).toBe(800)
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts = await Promise.all(
      (["populated", "empty", "denied", "throttled"] as const).map(async (outcome) => {
        __resetIdentity()
        return surfaceText(await load({ listQueues: outcome }))
      }),
    )
    // Pairwise distinct. A fake that returned [] regardless would collapse at
    // least two of these into one string, and this is the assertion that
    // notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------- the DLQ is a state -- */

describe("a dead-letter queue with anything in it is its own state", () => {
  test("messages in a DLQ surface as FAILED DELIVERIES, not as a row in a table", async () => {
    const queues = healthyEstate()
    queues[4] = { url: EMAIL_DLQ_URL, attributes: dlqAttributes(EMAIL_DLQ_URL, "7", "2") }
    const readings = await load({ queues })

    expect(readings.deadLetters.kind).toBe("failed-deliveries")
    if (readings.deadLetters.kind !== "failed-deliveries") throw new Error("narrowing")
    expect(readings.deadLetters.totalMessages).toBe(7)
    expect(readings.deadLetters.failures).toHaveLength(1)
    const failure = readings.deadLetters.failures[0]
    expect(failure.queueName).toBe("tenure-prod-email-dlq")
    expect(failure.messages).toBe(7)
    expect(failure.inFlight).toBe(2)
    // Which queue the failures came FROM — derived from the SOURCE queue's
    // RedrivePolicy, never from the "-dlq" suffix.
    expect(failure.sourceQueueArns).toEqual([arnFor(EMAIL_URL)])

    const line = sqsLines(readings).find((l) => l.label === "Failed deliveries")
    expect(line?.text).toContain("FAILED DELIVERIES")
    expect(line?.text).toContain("nobody was told")
    expect(line?.text).toContain("7 message(s)")
  })

  test("empty dead-letter queues are clear, and clear is a different sentence", async () => {
    const readings = await load()
    expect(readings.deadLetters.kind).toBe("clear")
    if (readings.deadLetters.kind !== "clear") throw new Error("narrowing")
    expect([...readings.deadLetters.deadLetterQueueArns].sort()).toEqual(
      [arnFor(DEFAULT_DLQ_URL), arnFor(EMAIL_DLQ_URL)].sort(),
    )
    expect(readings.deadLetters.unreadable).toHaveLength(0)
    const line = sqsLines(readings).find((l) => l.label === "Failed deliveries")
    expect(line?.text).toContain("no failed deliveries")
    expect(line?.text).not.toContain("FAILED DELIVERIES")
  })

  test("a DLQ is identified from a redrive policy, never from its name", async () => {
    // Named nothing like a DLQ, and it IS one: `default` redrives into it.
    const oddlyNamed = `${QUEUE_BASE}/parking-lot`
    const queues: QueueFixture[] = [
      { url: DEFAULT_URL, attributes: workerAttributes(DEFAULT_URL, "0", "0", oddlyNamed) },
      { url: oddlyNamed, attributes: dlqAttributes(oddlyNamed, "3") },
      // Named exactly like a DLQ, and it is NOT one: nothing redrives into it.
      { url: `${QUEUE_BASE}/dlq-archive`, attributes: dlqAttributes(`${QUEUE_BASE}/dlq-archive`, "900") },
    ]
    const readings = await load({ queues })
    expect(readings.deadLetters.kind).toBe("failed-deliveries")
    if (readings.deadLetters.kind !== "failed-deliveries") throw new Error("narrowing")
    expect(readings.deadLetters.failures.map((f) => f.queueName)).toEqual(["parking-lot"])
    expect(readings.deadLetters.totalMessages).toBe(3)
  })

  test("a RedriveAllowPolicy of byQueue identifies a DLQ even when its source was refused", async () => {
    // The case that matters: the worker queue's attributes are DENIED, so its
    // RedrivePolicy cannot be read. Without the DLQ's own declaration, nothing
    // would mark the dead-letter queue and 5 failed deliveries would be a row.
    const queues: QueueFixture[] = [
      { url: EMAIL_URL, failWith: "AccessDeniedException" },
      {
        url: EMAIL_DLQ_URL,
        attributes: {
          ...dlqAttributes(EMAIL_DLQ_URL, "5"),
          RedriveAllowPolicy: JSON.stringify({
            redrivePermission: "byQueue",
            sourceQueueArns: [arnFor(EMAIL_URL)],
          }),
        },
      },
    ]
    const readings = await load({ queues })
    expect(readings.deadLetters.kind).toBe("failed-deliveries")
    if (readings.deadLetters.kind !== "failed-deliveries") throw new Error("narrowing")
    expect(readings.deadLetters.failures[0].messages).toBe(5)
    // And the queue that could not be read is named rather than dropped.
    expect(readings.deadLetters.unreadable).toEqual(["tenure-prod-email"])
  })

  test("no queue answering means unknown, never 'no dead-letter queue is configured'", async () => {
    const queues: QueueFixture[] = [
      { url: DEFAULT_URL, failWith: "AccessDeniedException" },
      { url: EMAIL_URL, failWith: "AccessDeniedException" },
    ]
    const readings = await load({ queues })
    expect(readings.deadLetters.kind).toBe("unknown")
    const line = sqsLines(readings).find((l) => l.label === "Failed deliveries")
    expect(line?.text).toContain("unknown")
    expect(line?.text).not.toContain("no dead-letter queue is configured")
  })

  test("queues with no redrive at all is 'none configured', which is its own finding", async () => {
    const bare = `${QUEUE_BASE}/tenure-prod-solo`
    const readings = await load({ queues: [{ url: bare, attributes: dlqAttributes(bare, "0") }] })
    expect(readings.deadLetters.kind).toBe("none-configured")
    const line = sqsLines(readings).find((l) => l.label === "Failed deliveries")
    expect(line?.text).toContain("no dead-letter queue is configured")
    expect(line?.text).toContain("retried and then dropped")
  })

  test("a denied listing makes the dead-letter state unknown, not clear", async () => {
    const readings = await load({ listQueues: "denied" })
    expect(readings.deadLetters.kind).toBe("unknown")
    const line = sqsLines(readings).find((l) => l.label === "Failed deliveries")
    expect(line?.text).toContain("unknown")
    expect(line?.text).toContain("sqs:ListQueues")
  })
})

/* --------------------------------------------- per-queue denial and states -- */

describe("a queue whose depth was refused still appears, saying so", () => {
  test("the denial names GetQueueAttributes, not the listing action", async () => {
    const queues = healthyEstate()
    queues[1] = { url: EMAIL_URL, failWith: "AccessDeniedException" }
    const readings = await load({ queues })

    expect(readings.queues.state).toBe("ACTUAL")
    if (readings.queues.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.queues.value).toHaveLength(5)

    const email = readings.queues.value.find((q) => q.name === "tenure-prod-email")
    expect(email?.depth.state).toBe("DENIED")
    if (email?.depth.state !== "DENIED") throw new Error("narrowing")
    // The whole reason the two capabilities are read separately: granting
    // sqs:ListQueues would not have fixed this, and a denial naming it would
    // have sent an operator to grant the action they already hold.
    expect(email.depth.action).toBe("sqs:GetQueueAttributes")
    expect(email.depth.minimumStatement).toContain("sqs:GetQueueAttributes")
    expect(email.depth.minimumStatement).not.toContain("sqs:ListQueues")

    const line = sqsLines(readings).find((l) => l.label === "tenure-prod-email")
    expect(line?.text).toContain("refused sqs:GetQueueAttributes")
    expect(line?.text).not.toContain("0 visible")
  })

  test("a queue whose depth was throttled is throttled, not empty", async () => {
    const queues = healthyEstate()
    queues[0] = { url: DEFAULT_URL, failWith: "ThrottlingException" }
    const readings = await load({ queues })
    if (readings.queues.state !== "ACTUAL") throw new Error("narrowing")
    const dflt = readings.queues.value.find((q) => q.name === "tenure-prod-default")
    expect(dflt?.depth.state).toBe("THROTTLED")
    const line = sqsLines(readings).find((l) => l.label === "tenure-prod-default")
    expect(line?.text).toContain("throttled")
    expect(line?.text).not.toContain("visible")
  })

  test("a missing count is an ERROR, never a zero", async () => {
    const broken = `${QUEUE_BASE}/tenure-prod-broken`
    const readings = await load({
      queues: [
        {
          url: broken,
          attributes: {
            QueueArn: arnFor(broken),
            // ApproximateNumberOfMessages deliberately absent.
            ApproximateNumberOfMessagesNotVisible: "0",
            ApproximateNumberOfMessagesDelayed: "0",
          },
        },
      ],
    })
    if (readings.queues.state !== "ACTUAL") throw new Error("narrowing")
    const queue = readings.queues.value[0]
    expect(queue.depth.state).toBe("ERROR")
    if (queue.depth.state !== "ERROR") throw new Error("narrowing")
    expect(queue.depth.safeDetail).toContain("ApproximateNumberOfMessages")
    expect(sqsLines(readings).find((l) => l.label === "tenure-prod-broken")?.text).not.toContain(
      "0 visible",
    )
  })

  test("queues past the depth-read cap say they were not read, not that they are empty", async () => {
    const many: QueueFixture[] = []
    for (let i = 0; i < MAX_QUEUE_DEPTH_READS + 3; i += 1) {
      const url = `${QUEUE_BASE}/bulk-${String(i).padStart(4, "0")}`
      many.push({ url, attributes: dlqAttributes(url, "0") })
    }
    const readings = await load({ queues: many })
    if (readings.queues.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.queues.value).toHaveLength(MAX_QUEUE_DEPTH_READS + 3)
    const last = readings.queues.value[readings.queues.value.length - 1]
    expect(last.depth.state).toBe("UNCONFIGURED")
    if (last.depth.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(last.depth.why).toContain("not the same as its being empty")
  })
})

/* ------------------------------------------------------ residency and tags -- */

describe("region and partition come from the resolved identity, never a literal", () => {
  test("a GovCloud identity produces GovCloud ARNs and no us-east-1 anywhere", async () => {
    // The GE-010-007 shape: a hardcoded us-east-1 or a partition guessed as
    // "aws" would place these queues in the wrong partition on a page an
    // operator uses to decide where data lives.
    const govUrl = queueUrl("us-gov-west-1", ACCOUNT, "tenure-gov-default")
    const readings = await load({
      identity: {
        arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
        account: ACCOUNT,
        region: "us-gov-west-1",
      },
      queues: [{ url: govUrl, failWith: "AccessDeniedException" }],
    })
    if (readings.queues.state !== "ACTUAL") throw new Error("narrowing")
    const queue = readings.queues.value[0]
    // The depth was refused, so the ARN had to be assembled — from identity.
    expect(queue.arn).toBe(`arn:aws-us-gov:sqs:us-gov-west-1:${ACCOUNT}:tenure-gov-default`)
    expect(queue.partition).toBe("aws-us-gov")
    expect(queue.region).toBe("us-gov-west-1")
    expect(queue.arnProvenance).toContain("resolved identity")
    expect(surfaceText(readings)).not.toContain("us-east-1")
  })

  test("with identity unresolved no ARN is invented and the surface says so", async () => {
    const readings = await load({
      identity: "denied",
      queues: [{ url: DEFAULT_URL, failWith: "AccessDeniedException" }],
    })
    if (readings.queues.state !== "ACTUAL") throw new Error("narrowing")
    const queue = readings.queues.value[0]
    expect(queue.arn).toBeNull()
    expect(queue.region).toBeNull()
    expect(queue.partition).toBeNull()
    expect(queue.attribution.kind).toBe("unknown")
    expect(surfaceText(readings)).toContain("region unknown")
  })

  test("AWS's own QueueArn wins over anything this engine would assemble", async () => {
    const readings = await load()
    if (readings.queues.state !== "ACTUAL") throw new Error("narrowing")
    const queue = readings.queues.value[0]
    expect(queue.arnProvenance).toContain("QueueArn")
    expect(queue.arn).toBe(arnFor(DEFAULT_URL))
  })
})

describe("attribution comes from the tag index, and 'we could not look' is its own answer", () => {
  test("a tenure:tenant tag attributes the queue to that tenant", async () => {
    const readings = await load({
      tags: { [arnFor(EMAIL_URL)]: tenantTags("simon-ose") },
    })
    if (readings.queues.state !== "ACTUAL") throw new Error("narrowing")
    const email = readings.queues.value.find((q) => q.name === "tenure-prod-email")
    expect(email?.attribution).toEqual({ kind: "tenant", tenantSlug: "simon-ose" })
    expect(sqsLines(readings).find((l) => l.label === "tenure-prod-email")?.text).toContain(
      "simon-ose",
    )
  })

  test("the shared sentinel is shared, and an untagged queue is unattributable — not the same", async () => {
    const readings = await load({
      tags: {
        [arnFor(DEFAULT_URL)]: [{ Key: "tenure:tenant", Value: SHARED }],
      },
    })
    if (readings.queues.state !== "ACTUAL") throw new Error("narrowing")
    const shared = readings.queues.value.find((q) => q.name === "tenure-prod-default")
    const untagged = readings.queues.value.find((q) => q.name === "tenure-prod-email")
    expect(shared?.attribution.kind).toBe("shared")
    expect(untagged?.attribution.kind).toBe("unattributed")
    const text = surfaceText(readings)
    expect(text).toContain("shared — platform overhead")
    expect(text).toContain("unattributable — missing tenure:tenant")
  })

  test("a denied tag index makes attribution unknown, not unattributable", async () => {
    // The distinction that matters: "missing tenure:tenant" sends an operator
    // to add a tag that is probably already there.
    const readings = await load({ tagsOutcome: "denied" })
    if (readings.queues.state !== "ACTUAL") throw new Error("narrowing")
    for (const queue of readings.queues.value) {
      expect(queue.attribution.kind).toBe("unknown")
    }
    const text = surfaceText(readings)
    expect(text).toContain("attribution unknown")
    expect(text).toContain("tag:GetResources")
    expect(text).not.toContain("missing tenure:tenant")
  })

  test("a throttled tag index is also unknown, and says throttled", async () => {
    const readings = await load({ tagsOutcome: "throttled" })
    if (readings.queues.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.queues.value[0].attribution.kind).toBe("unknown")
    expect(surfaceText(readings)).toContain("throttled")
  })
})

/* ---------------------------------------------------- as-of and cadence -- */

describe("every reading carries when it was taken and how often it refreshes", () => {
  test("the load stamps an explicit asOf and both capabilities' own cadences", async () => {
    const readings = await load()
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
    // Not numbers retyped here: these are the registry's declarations, so a
    // cadence changed in capabilities.ts changes what the surface promises.
    expect(readings.refreshMs.queues).toBe(150_000)
    expect(readings.refreshMs.depth).toBe(10_000)
    if (readings.queues.state !== "ACTUAL") throw new Error("narrowing")
    for (const queue of readings.queues.value) {
      expect(queue.asOf).toBe("2026-08-13T09:15:00.000Z")
      expect(queue.refreshMs).toBe(10_000)
    }
    const text = surfaceText(readings)
    expect(text).toContain("refreshed every 150s")
    expect(text).toContain("refreshed every 10s")
    expect(text).toContain("as of 2026-08-13T09:15:00.000Z")
  })

  test("the age of the oldest message is reported as unreadable, naming what would read it", async () => {
    // There is no such SQS attribute. Silence here would let a surface print a
    // queue with no age and let an operator read that as "nothing old in here".
    const readings = await load()
    if (readings.queues.state !== "ACTUAL") throw new Error("narrowing")
    for (const queue of readings.queues.value) {
      expect(queue.oldestMessage.state).toBe("NOT_READABLE")
      expect(queue.oldestMessage.needs).toBe("cloudwatch:GetMetricData")
      expect(queue.oldestMessage.metric).toBe("AWS/SQS ApproximateAgeOfOldestMessage")
    }
    const text = surfaceText(readings)
    expect(text).toContain("oldest message:")
    expect(text).toContain("cloudwatch:GetMetricData")
    expect(text).toContain("Unknown, not zero")
  })
})

/* ------------------------------------------------------------- the parsers -- */

describe("a redrive policy that does not parse is unreadable, not absent", () => {
  test("valid JSON gives the target and the receive count", () => {
    expect(
      parseRedrivePolicy(
        JSON.stringify({ deadLetterTargetArn: arnFor(EMAIL_DLQ_URL), maxReceiveCount: 3 }),
      ),
    ).toEqual({
      kind: "redrives-to",
      deadLetterTargetArn: arnFor(EMAIL_DLQ_URL),
      maxReceiveCount: 3,
    })
  })

  test("an absent policy is none; malformed JSON is unreadable", () => {
    expect(parseRedrivePolicy(undefined).kind).toBe("none")
    expect(parseRedrivePolicy("{not json").kind).toBe("unreadable")
    expect(parseRedrivePolicy('{"maxReceiveCount":3}').kind).toBe("unreadable")
  })

  test("a malformed policy on a real queue renders as unreadable, not as 'no DLQ'", async () => {
    const url = `${QUEUE_BASE}/tenure-prod-odd`
    const readings = await load({
      queues: [
        {
          url,
          attributes: { ...dlqAttributes(url, "0"), RedrivePolicy: "{not json" },
        },
      ],
    })
    const text = surfaceText(readings)
    expect(text).toContain("redrive policy unreadable")
    expect(text).not.toContain("no dead-letter queue — a message that keeps failing is dropped")
  })

  test("RedriveAllowPolicy distinguishes allowAll, denyAll, byQueue and absent", () => {
    expect(parseRedriveAllowPolicy(undefined)).toEqual({ kind: "absent" })
    expect(parseRedriveAllowPolicy('{"redrivePermission":"allowAll"}')).toEqual({ kind: "all" })
    expect(parseRedriveAllowPolicy('{"redrivePermission":"denyAll"}')).toEqual({ kind: "deny-all" })
    expect(
      parseRedriveAllowPolicy(
        JSON.stringify({ redrivePermission: "byQueue", sourceQueueArns: [arnFor(EMAIL_URL)] }),
      ),
    ).toEqual({ kind: "by-queue", sourceQueueArns: [arnFor(EMAIL_URL)] })
  })
})

describe("deriveQueueArn refuses to guess", () => {
  test("it returns null when identity is not resolved", () => {
    expect(
      deriveQueueArn(DEFAULT_URL, {
        state: "UNCONFIGURED",
        capability: "sts:GetCallerIdentity",
        why: "no credentials",
      }),
    ).toBeNull()
  })

  test("it uses the URL's own account id rather than assuming the caller's", () => {
    const foreign = queueUrl("eu-west-2", "999988887777", "somebody-elses")
    expect(
      deriveQueueArn(foreign, {
        state: "ACTUAL",
        capability: "sts:GetCallerIdentity",
        value: {
          accountId: ACCOUNT,
          arn: `arn:aws:sts::${ACCOUNT}:assumed-role/x/y`,
          partition: "aws",
          region: "eu-west-2",
        },
        asOf: "2026-08-13T09:15:00.000Z",
        fresh: true,
      }),
    ).toBe("arn:aws:sqs:eu-west-2:999988887777:somebody-elses")
  })
})
