import {
  RULE_WORDS,
  describeRuleAttribution,
  eventBridgeSurface,
  ruleVerdict,
  serviceOf,
  stoppedRules,
  EVENTBRIDGE_TTL_MS,
} from "./eventbridge"
import { minimumStatementText } from "./capabilities"
import type { AwsGateway } from "./read"

/**
 * STUDIO-070-004 (EventBridge) — the surface says something DIFFERENT for
 * AccessDenied, a throttle, an empty-but-successful list and a populated one.
 *
 * The assertions are on `eventBridgeSurface`, the PRODUCER the route agent will
 * call — never on `ruleVerdict` alone. A test that only exercised the helper
 * would stay green on the day the surface stopped calling it, which is the exact
 * shape of failure this programme has already paid for.
 *
 * The stand-in gateway returns the shapes the real EventBridge API returns —
 * `{ Rules: [{ Name, Arn, State, ScheduleExpression, EventPattern, ManagedBy }],
 * NextToken }` and `{ Targets: [{ Id, Arn, RoleArn, Input, RetryPolicy,
 * DeadLetterConfig }] }` — and it can FAIL the way the real client fails, with a
 * thrown error carrying AWS's own `name`. A fake that returns `[]` regardless of
 * the code under test proves nothing, and is the fake this programme has already
 * been burned by; this one has to be told which of four behaviours to perform,
 * and each produces a different sentence.
 */

/* ------------------------------------------------------------- fixtures -- */

const ACCOUNT = "111122223333"
const REGION = "eu-west-1"
const PARTITION = "aws"
const PRINCIPAL = `arn:${PARTITION}:sts::${ACCOUNT}:assumed-role/tenure-studio/task`

const RULE_ARN = (name: string) => `arn:${PARTITION}:events:${REGION}:${ACCOUNT}:rule/${name}`

/** The real rule `infrastructure/terraform/scheduler.tf` creates. */
const REMINDERS = {
  Name: "tenure-pilot-deliverable-reminders",
  Arn: RULE_ARN("tenure-pilot-deliverable-reminders"),
  Description: "Daily 24-hour warning for club deliverables",
  ScheduleExpression: "cron(0 13 * * ? *)",
  State: "ENABLED",
  EventBusName: "default",
}

const REMINDER_TARGET = {
  Id: "reminders",
  Arn: `arn:${PARTITION}:events:${REGION}:${ACCOUNT}:api-destination/tenure-pilot-reminders/abc`,
  RoleArn: `arn:${PARTITION}:iam::${ACCOUNT}:role/tenure-pilot-scheduler`,
  Input: "{}",
  RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 3600 },
}

const FULLY_TAGGED: Record<string, string> = {
  "tenure:tenant": "simon-ose",
  "tenure:environment": "production",
  "tenure:cell": "cell-eu-west-1-a",
  "tenure:account-purpose": "workload",
  "tenure:module": "tenant-cell",
  "tenure:release": "2026.08.13",
  "tenure:stack": "pilot/terraform.tfstate",
  "tenure:data-class": "student-record",
  "tenure:owner-seat": "platform-engineering",
  "tenure:cost-center": "tenant-cells",
  "tenure:retention": "P7Y",
  "tenure:managed-by": "terraform",
}

const NOW = () => new Date("2026-08-13T09:00:00.000Z")

function awsError(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

/* ------------------------------------------------------- the stand-in AWS -- */

type Behaviour =
  | { kind: "populated"; pages?: unknown[]; targets?: Record<string, unknown> }
  | { kind: "empty" }
  | { kind: "denied" }
  | { kind: "throttled" }

interface FakeOptions {
  rules: Behaviour
  /** How `events:ListTargetsByRule` behaves, per rule name. Default: populated. */
  targets?: Record<string, Behaviour>
  /** How the tag index behaves. Default: one page attributing the reminders rule. */
  tagging?: Behaviour
  identity?: Behaviour
}

/** Every call the fake was asked to make, so a test can assert it was not skipped. */
interface Fake extends AwsGateway {
  calls: string[]
}

function fakeAws(options: FakeOptions): Fake {
  const calls: string[] = []
  const rulePages = new Map<string, number>()

  const answer = (behaviour: Behaviour, capability: string, ok: () => unknown): unknown => {
    switch (behaviour.kind) {
      case "denied":
        throw awsError(
          "AccessDeniedException",
          `User: ${PRINCIPAL} is not authorized to perform: ${capability} because no identity-based policy allows it`,
        )
      case "throttled":
        throw awsError("ThrottlingException", "Rate exceeded")
      case "empty":
        return capability === "events:ListRules"
          ? { Rules: [] }
          : capability === "events:ListTargetsByRule"
            ? { Targets: [] }
            : { ResourceTagMappingList: [] }
      case "populated":
        return ok()
    }
  }

  return {
    calls,
    async call(capability, input = {}) {
      calls.push(capability)

      if (capability === "sts:GetCallerIdentity") {
        const identity = options.identity ?? { kind: "populated" as const }
        return answer(identity, capability, () => ({ Account: ACCOUNT, Arn: PRINCIPAL }))
      }

      if (capability === "tag:GetResources") {
        const tagging = options.tagging ?? { kind: "populated" as const }
        return answer(tagging, capability, () => ({
          ResourceTagMappingList: [
            {
              ResourceARN: REMINDERS.Arn,
              Tags: Object.entries(FULLY_TAGGED).map(([Key, Value]) => ({ Key, Value })),
            },
          ],
        }))
      }

      if (capability === "events:ListRules") {
        return answer(options.rules, capability, () => {
          const pages = (options.rules.kind === "populated" && options.rules.pages) || []
          const bus = String(input.EventBusName ?? "default")
          const index = rulePages.get(bus) ?? 0
          rulePages.set(bus, index + 1)
          return pages[index] ?? { Rules: [] }
        })
      }

      if (capability === "events:ListTargetsByRule") {
        const name = String(input.Rule)
        const behaviour = options.targets?.[name] ?? { kind: "populated" as const }
        return answer(behaviour, capability, () => {
          const supplied =
            options.rules.kind === "populated" ? options.rules.targets?.[name] : undefined
          return supplied ?? { Targets: [REMINDER_TARGET] }
        })
      }

      throw new Error(`the EventBridge surface asked for ${capability}, which it has no business calling`)
    },
    async resolvedRegion() {
      return REGION
    },
  }
}

/** No real waiting: the retry SCHEDULE is asserted, never spent. */
const instantly = async () => {}

const surface = (options: FakeOptions, extra: Record<string, unknown> = {}) =>
  eventBridgeSurface(fakeAws(options), { now: NOW, wait: instantly, ...extra })

/* ================================================================ cases == */

describe("four AWS behaviours, four different sentences", () => {
  it("1. AccessDenied is UNKNOWN carrying the principal, the action and a pasteable statement — never an empty list", async () => {
    const result = await surface({ rules: { kind: "denied" } })

    expect(result.read.state).toBe("DENIED")
    if (result.read.state !== "DENIED") throw new Error("expected DENIED")

    expect(result.read.action).toBe("events:ListRules")
    expect(result.read.principal).toBe(PRINCIPAL)
    expect(result.read.accountId).toBe(ACCOUNT)
    expect(result.read.region).toBe(REGION)
    expect(result.read.partition).toBe(PARTITION)
    // Pasteable, and identical to what the registry says the grant is.
    expect(result.read.minimumStatement).toBe(minimumStatementText("events:ListRules"))
    expect(JSON.parse(result.read.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["events:ListRules"],
      Resource: "*",
    })

    // The single most dangerous thing this surface could do is render rows: [].
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].verdict).toBe("UNAUTHORIZED")
    expect(result.rows[0].detail).toContain("events:ListRules")
    expect(result.rows[0].detail).toContain(PRINCIPAL)
    expect(result.rows[0].targetCount).toBeNull()

    expect(result.headline).toContain("unknown")
    expect(result.headline).toContain("was refused")
    expect(result.headline).not.toMatch(/^none/)
  })

  it("2. a throttle is its own state — not a failure, not an empty result, and it names the wait", async () => {
    const result = await surface({ rules: { kind: "throttled" } })

    expect(result.read.state).toBe("THROTTLED")
    if (result.read.state !== "THROTTLED") throw new Error("expected THROTTLED")

    // The schedule is throttle.ts's, so the console cannot quote two waits.
    // backoffMs(READ_ATTEMPTS + 1) = 200 * 2 ** 2.
    expect(result.read.retryAfterMs).toBe(800)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].verdict).toBe("UNREADABLE")
    expect(result.headline).toContain("throttled")
    expect(result.headline).toContain("800ms")
    // Emphatically not the denial's remedy: no IAM statement fixes a throttle.
    expect(result.headline).not.toContain("Minimum statement")
    expect(result.headline).not.toMatch(/^none/)
  })

  it("3. empty-but-successful says none, and says which buses it asked", async () => {
    const result = await surface({ rules: { kind: "empty" } })

    expect(result.read.state).toBe("EMPTY")
    expect(result.rows).toEqual([])
    expect(result.headline).toMatch(/^none — events:ListRules answered with no rules/)
    expect(result.headline).toContain("default")
    expect(result.headline).not.toContain("refused")
    expect(result.headline).not.toContain("throttled")
  })

  it("4. a populated list verdicts every rule and counts the ones that stopped", async () => {
    const result = await surface({
      rules: {
        kind: "populated",
        pages: [
          {
            Rules: [
              REMINDERS,
              {
                Name: "tenure-pilot-nightly-rollup",
                Arn: RULE_ARN("tenure-pilot-nightly-rollup"),
                ScheduleExpression: "rate(1 day)",
                State: "DISABLED",
                EventBusName: "default",
              },
            ],
          },
        ],
      },
    })

    expect(result.read.state).toBe("ACTUAL")
    expect(result.rows.map((r) => r.name)).toEqual([
      "tenure-pilot-deliverable-reminders",
      "tenure-pilot-nightly-rollup",
    ])
    expect(result.rows.map((r) => r.verdict)).toEqual(["SCHEDULED", "DISABLED"])
    expect(result.rows[0].targetCount).toBe(1)
    expect(result.headline).toContain("1 of 2 rule(s) are not running work")
    expect(result.headline).toContain(RULE_WORDS.DISABLED)
    expect(result.headline).not.toContain("refused")
    expect(result.headline).not.toMatch(/^none/)
  })

  it("the four headlines are four different sentences", async () => {
    const headlines = [
      (await surface({ rules: { kind: "denied" } })).headline,
      (await surface({ rules: { kind: "throttled" } })).headline,
      (await surface({ rules: { kind: "empty" } })).headline,
      (
        await surface({
          rules: { kind: "populated", pages: [{ Rules: [REMINDERS] }] },
        })
      ).headline,
    ]
    expect(new Set(headlines).size).toBe(4)
  })
})

/* ------------------------------------------------ the alarms.ts precedent -- */

describe("DISABLED outranks OK, exactly as it does in alarms.ts", () => {
  it("reports a disabled rule with a live schedule and a live target as switched off", async () => {
    const result = await surface({
      rules: {
        kind: "populated",
        pages: [{ Rules: [{ ...REMINDERS, State: "DISABLED" }] }],
      },
    })

    const row = result.rows[0]
    // Everything about it reads healthy except the one field that decides.
    expect(row.schedule).toBe("cron(0 13 * * ? *)")
    expect(row.targetCount).toBe(1)
    expect(row.verdict).toBe("DISABLED")
    expect(row.verdict).not.toBe("SCHEDULED")
    expect(row.detail).toContain("switched off")
    expect(row.detail).toContain("raises no alarm")
    expect(stoppedRules(result.rows)).toHaveLength(1)
  })

  it("an ENABLED rule whose targets were all removed is enabled and inert, not healthy", async () => {
    const result = await surface({
      rules: { kind: "populated", pages: [{ Rules: [REMINDERS] }] },
      targets: { [REMINDERS.Name]: { kind: "empty" } },
    })

    expect(result.rows[0].verdict).toBe("NO_TARGET")
    expect(result.rows[0].targetCount).toBe(0)
    expect(result.rows[0].detail).toContain("fires into nothing")
    expect(result.headline).toContain("1 of 1 rule(s) are not running work")
  })

  it("a rule with neither a schedule nor a pattern cannot fire, whatever its targets say", async () => {
    const result = await surface({
      rules: {
        kind: "populated",
        pages: [
          {
            Rules: [
              { Name: "orphan", Arn: RULE_ARN("orphan"), State: "ENABLED", EventBusName: "default" },
            ],
          },
        ],
      },
    })
    expect(result.rows[0].verdict).toBe("UNTRIGGERED")
    expect(result.rows[0].detail).toContain("neither a schedule expression nor an event pattern")
  })

  it("an ENABLED variant AWS added later is still enabled, and an unrecognised state is reported not mapped", async () => {
    const result = await surface({
      rules: {
        kind: "populated",
        pages: [
          {
            Rules: [
              {
                Name: "cloudtrail-managed",
                Arn: RULE_ARN("cloudtrail-managed"),
                EventPattern: '{"source":["aws.s3"]}',
                State: "ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS",
                ManagedBy: "securityhub.amazonaws.com",
                EventBusName: "default",
              },
              {
                Name: "state-from-the-future",
                Arn: RULE_ARN("state-from-the-future"),
                ScheduleExpression: "rate(5 minutes)",
                State: "PAUSED_BY_SOMETHING_NEW",
                EventBusName: "default",
              },
            ],
          },
        ],
      },
    })

    const managed = result.rows.find((r) => r.name === "cloudtrail-managed")!
    expect(managed.verdict).toBe("EVENT_DRIVEN")
    expect(managed.detail).toContain("Managed by securityhub.amazonaws.com")

    const unknown = result.rows.find((r) => r.name === "state-from-the-future")!
    expect(unknown.verdict).toBe("STATE_UNKNOWN")
    expect(unknown.detail).toContain("PAUSED_BY_SOMETHING_NEW")
    // Not silently treated as running.
    expect(unknown.verdict).not.toBe("SCHEDULED")
  })
})

/* ------------------------------ the same defect one level down: targets -- */

describe("a refused ListTargetsByRule is not a rule with no targets", () => {
  it("says TARGETS_UNKNOWN and quotes the action that was actually refused", async () => {
    const result = await surface({
      rules: { kind: "populated", pages: [{ Rules: [REMINDERS] }] },
      targets: { [REMINDERS.Name]: { kind: "denied" } },
    })

    const row = result.rows[0]
    expect(row.verdict).toBe("TARGETS_UNKNOWN")
    expect(row.verdict).not.toBe("NO_TARGET")
    // null, not 0. Zero would be a claim the read never made.
    expect(row.targetCount).toBeNull()
    expect(row.targetsRead.state).toBe("DENIED")
    if (row.targetsRead.state !== "DENIED") throw new Error("expected DENIED")
    // The action quoted must be the one that failed, not the one that succeeded.
    expect(row.targetsRead.action).toBe("events:ListTargetsByRule")
    expect(row.targetsRead.minimumStatement).toBe(minimumStatementText("events:ListTargetsByRule"))
    expect(JSON.parse(row.targetsRead.minimumStatement).Resource).toBe("arn:*:events:*:*:rule/*")
    expect(row.detail).toContain('NOT "no targets"')

    // The rule itself is still known, so the surface is not collapsed.
    expect(result.read.state).toBe("ACTUAL")
    // And it is not counted among the rules to go and fix.
    expect(stoppedRules(result.rows)).toHaveLength(0)
  })

  it("a throttled targets read is a third answer again, with its own wait", async () => {
    const result = await surface({
      rules: { kind: "populated", pages: [{ Rules: [REMINDERS] }] },
      targets: { [REMINDERS.Name]: { kind: "throttled" } },
    })

    const row = result.rows[0]
    expect(row.verdict).toBe("TARGETS_UNKNOWN")
    expect(row.targetsRead.state).toBe("THROTTLED")
    expect(row.targetCount).toBeNull()
    expect(row.detail).toContain("throttled")
    expect(row.detail).not.toContain("Minimum statement")
  })
})

/* ---------------------------------------------------------- residency -- */

describe("region and partition come from the resolved identity, never a literal", () => {
  it("reports the region the identity resolved to", async () => {
    const result = await surface({ rules: { kind: "populated", pages: [{ Rules: [REMINDERS] }] } })
    expect(result.region).toBe(REGION)
    expect(result.partition).toBe(PARTITION)
    expect(result.accountId).toBe(ACCOUNT)
    expect(result.scopeNote).toContain(`in region ${REGION}`)
    expect(result.scopeNote).not.toContain("us-east-1")
  })

  it("says the region is unknown when identity was refused, rather than naming one", async () => {
    const result = await surface({
      rules: { kind: "populated", pages: [{ Rules: [REMINDERS] }] },
      identity: { kind: "denied" },
    })

    expect(result.region).toBeNull()
    expect(result.partition).toBeNull()
    expect(result.accountId).toBeNull()
    expect(result.scopeNote).toContain("cannot name")
    expect(result.scopeNote).not.toContain("us-east-1")

    // And a denial elsewhere names the unresolved principal rather than going blank.
    const denied = await surface({ rules: { kind: "denied" }, identity: { kind: "denied" } })
    if (denied.read.state !== "DENIED") throw new Error("expected DENIED")
    expect(denied.read.principal).toContain("unknown principal")
    expect(denied.read.region).toBeNull()
  })

  it("states the bus scope, so silence about other buses is not read as absence", async () => {
    const result = await surface({ rules: { kind: "empty" } }, { buses: ["default", "tenure-bus"] })
    expect(result.busesRead).toEqual(["default", "tenure-bus"])
    expect(result.scopeNote).toContain("tenure-bus")
    expect(result.scopeNote).toContain("is not claimed to be absent")
  })
})

/* -------------------------------------------------------- attribution -- */

describe("attribution comes from the tag index and says so when it cannot", () => {
  it("attributes a tagged rule to its tenant and leaves an untagged one unattributed", async () => {
    const result = await surface({
      rules: {
        kind: "populated",
        pages: [
          {
            Rules: [
              REMINDERS,
              {
                Name: "scratch-rule",
                Arn: RULE_ARN("scratch-rule"),
                ScheduleExpression: "rate(1 hour)",
                State: "ENABLED",
                EventBusName: "default",
              },
            ],
          },
        ],
      },
    })

    const mine = result.rows.find((r) => r.name === REMINDERS.Name)!
    expect(mine.attribution).toEqual({ kind: "tenant", tenantSlug: "simon-ose" })
    expect(describeRuleAttribution(mine.attribution)).toBe("simon-ose")

    const scratch = result.rows.find((r) => r.name === "scratch-rule")!
    // NOT shared. "Nobody tagged it" and "somebody decided this is platform
    // overhead" are different facts, and folding them charges an untagged
    // resource to every customer.
    expect(scratch.attribution.kind).toBe("unattributed")
    expect(scratch.attribution.kind).not.toBe("shared")
  })

  it("does not attribute anything when the tag index itself was refused", async () => {
    const result = await surface({
      rules: { kind: "populated", pages: [{ Rules: [REMINDERS] }] },
      tagging: { kind: "denied" },
    })

    const row = result.rows[0]
    expect(row.attribution.kind).toBe("unknown")
    expect(row.attribution.kind).not.toBe("shared")
    expect(row.attribution.kind).not.toBe("unattributed")
    expect(describeRuleAttribution(row.attribution)).toContain("tag:GetResources")
    expect(result.tagged.state).toBe("DENIED")
    // The rules themselves are still readable — one denial does not blank the page.
    expect(row.verdict).toBe("SCHEDULED")
  })
})

/* --------------------------------------------------------- mechanics -- */

describe("the mechanics a caller depends on", () => {
  it("walks every page rather than reporting the first one as the estate", async () => {
    const result = await surface({
      rules: {
        kind: "populated",
        pages: [
          { Rules: [{ ...REMINDERS, Name: "a-rule", Arn: RULE_ARN("a-rule") }], NextToken: "more" },
          { Rules: [{ ...REMINDERS, Name: "b-rule", Arn: RULE_ARN("b-rule") }] },
        ],
      },
    })
    expect(result.rows.map((r) => r.name)).toEqual(["a-rule", "b-rule"])
  })

  it("carries an explicit as-of and this capability's own cadence", async () => {
    const result = await surface({ rules: { kind: "populated", pages: [{ Rules: [REMINDERS] }] } })
    expect(result.asOf).toBe("2026-08-13T09:00:00.000Z")
    expect(result.refreshMs).toBe(EVENTBRIDGE_TTL_MS)
    expect(result.refreshMs).toBe(240_000)
  })

  it("reads a target's shape without carrying its input body", async () => {
    const result = await surface({
      rules: {
        kind: "populated",
        pages: [{ Rules: [REMINDERS] }],
        targets: {
          [REMINDERS.Name]: {
            Targets: [
              { ...REMINDER_TARGET, Input: '{"authorization":"Bearer do-not-render-me"}' },
              { Id: "no-dlq", Arn: `arn:${PARTITION}:sqs:${REGION}:${ACCOUNT}:tenure-pilot-dlq` },
            ],
          },
        },
      },
    })

    const row = result.rows[0]
    if (row.targetsRead.state !== "ACTUAL") throw new Error("expected ACTUAL")
    const [destination, queue] = row.targetsRead.value

    expect(destination.service).toBe("events")
    expect(destination.hasInput).toBe(true)
    expect(destination.retryAttempts).toBe(3)
    expect(queue.service).toBe("sqs")
    expect(queue.retryAttempts).toBeNull()
    expect(queue.deadLetterArn).toBeNull()

    // The body is a place a bearer token lives. It must not reach the surface.
    expect(JSON.stringify(row)).not.toContain("do-not-render-me")
    expect(row.detail).toContain("no dead-letter queue")
  })

  it("retries a transient failure read.ts alone would call an ERROR, on throttle.ts's schedule", async () => {
    // ServiceUnavailable is in throttle.ts's transient set and NOT in read.ts's
    // throttle set. Without the shared schedule it would arrive as a red ERROR
    // box for a condition that clears itself in 200ms.
    let attempts = 0
    const waits: number[] = []
    const flaky: AwsGateway = {
      async call(capability) {
        if (capability === "sts:GetCallerIdentity") return { Account: ACCOUNT, Arn: PRINCIPAL }
        if (capability === "tag:GetResources") return { ResourceTagMappingList: [] }
        if (capability === "events:ListTargetsByRule") return { Targets: [REMINDER_TARGET] }
        attempts += 1
        if (attempts < 3) throw awsError("ServiceUnavailable", "the service is unavailable")
        return { Rules: [REMINDERS] }
      },
      async resolvedRegion() {
        return REGION
      },
    }

    const result = await eventBridgeSurface(flaky, {
      now: NOW,
      wait: async (ms) => {
        waits.push(ms)
      },
    })

    expect(attempts).toBe(3)
    // throttle.ts's schedule: backoffMs(2)=200, backoffMs(3)=400. Deterministic,
    // no jitter, so "how long until it tries again" is testable.
    expect(waits).toEqual([200, 400])
    expect(result.read.state).toBe("ACTUAL")
    expect(result.rows[0].verdict).toBe("SCHEDULED")
  })

  it("sorts by codepoint so the order is identical on Linux and on Windows", async () => {
    const names = ["Zulu-rule", "alpha-rule", "Alpha-rule", "zulu-rule"]
    const result = await surface({
      rules: {
        kind: "populated",
        pages: [
          {
            Rules: names.map((Name) => ({
              ...REMINDERS,
              Name,
              Arn: RULE_ARN(Name),
            })),
          },
        ],
      },
    })
    // Uppercase before lowercase — codepoint order. `localeCompare` would
    // interleave them, and differently under different ICU data.
    expect(result.rows.map((r) => r.name)).toEqual([
      "Alpha-rule",
      "Zulu-rule",
      "alpha-rule",
      "zulu-rule",
    ])
  })

  it("does not call ListTargetsByRule at all when the rule list was refused", async () => {
    const fake = fakeAws({ rules: { kind: "denied" } })
    await eventBridgeSurface(fake, { now: NOW, wait: instantly })
    expect(fake.calls).toContain("events:ListRules")
    expect(fake.calls).not.toContain("events:ListTargetsByRule")
  })
})

describe("the helpers, at their edges", () => {
  it("serviceOf refuses to guess at anything that is not an ARN", () => {
    expect(serviceOf(`arn:${PARTITION}:sqs:${REGION}:${ACCOUNT}:q`)).toBe("sqs")
    expect(serviceOf("arn:aws-us-gov:events:us-gov-west-1:1:rule/x")).toBe("events")
    expect(serviceOf("not-an-arn")).toBeNull()
    expect(serviceOf("arn:aws:events")).toBeNull()
  })

  it("ruleVerdict checks disabled before it looks at anything else", () => {
    const disabled = ruleVerdict(
      { schedule: "cron(0 13 * * ? *)", eventDriven: false, state: "DISABLED", managedBy: null },
      { state: "ACTUAL", capability: "events:ListTargetsByRule", value: [], asOf: "x", fresh: true },
    )
    expect(disabled.verdict).toBe("DISABLED")
  })

  it("gives every verdict a word, so nothing is rendered by colour alone", () => {
    for (const [verdict, word] of Object.entries(RULE_WORDS)) {
      expect(word.length).toBeGreaterThan(0)
      expect(word).not.toBe(verdict)
    }
  })
})
