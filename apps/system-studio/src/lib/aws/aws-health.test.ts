import {
  awsHealthSurface,
  chunkEventArns,
  taggableArnOf,
  tenantsAffected,
  verdictFor,
  AWS_HEALTH_TTL_MS,
} from "./aws-health"
import type { AwsGateway } from "./read"

/**
 * STUDIO-070-004 / STUDIO-000-007 — AWS Health, proven against a stand-in that
 * can be wrong in every way the real API can be wrong.
 *
 * The assertions are on `awsHealthSurface`, the PRODUCER a route renders, and
 * never on `readAws` or on a private helper. A test that called the helper
 * directly would stay green on the day the surface stopped calling it — the
 * exact shape of failure this programme has already paid for twice.
 *
 * The stand-in below returns the shapes the AWS Health API actually returns —
 * `events` / `entities` in lowerCamelCase, `nextToken` pagination, a
 * `ValidationException` when a filter carries more than ten event ARNs — rather
 * than a convenient array. And it can answer FOUR different ways per capability:
 * AccessDenied, a throttle, an empty-but-successful list, and a populated list.
 * A fake that returns `[]` regardless proves nothing about a surface whose whole
 * job is telling those four apart, which is why each one is asserted to produce
 * DIFFERENT text.
 */

/* ------------------------------------------------------------ the stand-in -- */

type Behaviour =
  /** Successful, paged. Each element is one response page, in order. */
  | { kind: "ok"; pages: readonly Record<string, unknown>[] }
  /** Throws every time, with an error named the way the SDK names it. */
  | { kind: "throw"; name: string; message: string }
  /** Throws `name` for the first `times` calls, then serves `pages`. */
  | { kind: "throwThen"; name: string; message: string; times: number; pages: readonly Record<string, unknown>[] }

interface FakeSpec {
  region?: string
  identity?: Behaviour
  events?: Behaviour
  entities?: Behaviour
  tags?: Behaviour
}

interface Fake extends AwsGateway {
  calls: { capability: string; input: Record<string, unknown> }[]
}

function awsError(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

const OK_IDENTITY: Behaviour = {
  kind: "ok",
  pages: [{ Account: "210987654321", Arn: "arn:aws:sts::210987654321:assumed-role/tenure-studio/task" }],
}

/**
 * A gateway that behaves like the real client.
 *
 * Pagination is served by handing out the next page each call and echoing a
 * `nextToken` while pages remain, so a surface that ignores the token reads one
 * page and the count assertions fail. The entity call filters by the `eventArns`
 * it was actually given, so a surface that forgot to pass the filter gets
 * nothing back rather than everything.
 */
function fake(spec: FakeSpec): Fake {
  const cursors = new Map<string, number>()
  const calls: { capability: string; input: Record<string, unknown> }[] = []
  const failures = new Map<string, number>()

  /**
   * `key` is the capability; `cursor` is what pagination is counted against.
   *
   * The two are the same for every call except the affected-entity read, whose
   * cursor also carries the event ARNs in the filter — because the real API
   * pages each FILTER independently, and a stand-in that shared one cursor
   * across chunks would hand chunk two the tail of chunk one's pages. That is a
   * property of the API worth reproducing: it is exactly the confusion a
   * chunking bug would hide behind.
   */
  function serve(
    key: string,
    cursor: string,
    behaviour: Behaviour | undefined,
    input: Record<string, unknown>,
  ): unknown {
    if (!behaviour) return {}
    if (behaviour.kind === "throw") throw awsError(behaviour.name, behaviour.message)
    if (behaviour.kind === "throwThen") {
      const failedSoFar = failures.get(cursor) ?? 0
      if (failedSoFar < behaviour.times) {
        failures.set(cursor, failedSoFar + 1)
        throw awsError(behaviour.name, behaviour.message)
      }
    }
    const pages = behaviour.pages
    const index = cursors.get(cursor) ?? 0
    cursors.set(cursor, index + 1)
    const page = pages[index] ?? {}
    const more = index + 1 < pages.length
    const tokenKey = key === "tag:GetResources" ? "PaginationToken" : "nextToken"
    const body: Record<string, unknown> = { ...page }
    if (more) body[tokenKey] = `page-${index + 1}`
    if (key === "health:DescribeAffectedEntities") {
      const wanted = (input.eventArns as string[]) ?? []
      // The real API rejects a filter with more than ten event ARNs outright.
      if (wanted.length > 10) {
        throw awsError(
          "ValidationException",
          `1 validation error detected: value at 'filter.eventArns' failed to satisfy constraint: member must have length less than or equal to 10`,
        )
      }
      const all = (page.entities as Record<string, unknown>[]) ?? []
      body.entities = all.filter((e) => wanted.includes(String(e.eventArn)))
    }
    return body
  }

  return {
    calls,
    async call(capability, input = {}) {
      calls.push({ capability, input })
      switch (capability) {
        case "sts:GetCallerIdentity":
          return serve(capability, capability, spec.identity ?? OK_IDENTITY, input)
        case "health:DescribeEvents":
          return serve(capability, capability, spec.events, input)
        case "health:DescribeAffectedEntities":
          return serve(
            capability,
            `${capability}|${((input.eventArns as string[]) ?? []).join(",")}`,
            spec.entities,
            input,
          )
        case "tag:GetResources":
          return serve(capability, capability, spec.tags, input)
        default:
          throw awsError("UnexpectedCall", `the surface called ${capability}, which this case does not stub`)
      }
    },
    async resolvedRegion() {
      return spec.region ?? "eu-west-2"
    },
  }
}

/** Frozen clock, so every assertion on an "as of" and on an hour count is exact. */
const NOW = new Date("2026-08-13T09:00:00.000Z")
const clock = () => NOW

/** Instant backoff, and two attempts, so a throttle case is a test and not a wait. */
const FAST = { now: clock, attempts: 2, sleep: async () => {} }

const OPEN_EVENT = {
  arn: "arn:aws:health:eu-west-2::event/RDS/AWS_RDS_OPERATIONAL_ISSUE/1",
  service: "RDS",
  eventTypeCode: "AWS_RDS_OPERATIONAL_ISSUE",
  eventTypeCategory: "issue",
  region: "eu-west-2",
  statusCode: "open",
  eventScopeCode: "ACCOUNT_SPECIFIC",
  startTime: "2026-08-13T08:30:00.000Z",
  lastUpdatedTime: "2026-08-13T08:45:00.000Z",
}

const ELSEWHERE_EVENT = {
  arn: "arn:aws:health:ap-southeast-2::event/EC2/AWS_EC2_OPERATIONAL_ISSUE/2",
  service: "EC2",
  eventTypeCode: "AWS_EC2_OPERATIONAL_ISSUE",
  eventTypeCategory: "issue",
  region: "ap-southeast-2",
  statusCode: "open",
  eventScopeCode: "PUBLIC",
  startTime: "2026-08-13T07:00:00.000Z",
}

const UPCOMING_EVENT = {
  arn: "arn:aws:health:eu-west-2::event/RDS/AWS_RDS_MAINTENANCE_SCHEDULED/3",
  service: "RDS",
  eventTypeCode: "AWS_RDS_MAINTENANCE_SCHEDULED",
  eventTypeCategory: "scheduledChange",
  region: "eu-west-2",
  statusCode: "upcoming",
  eventScopeCode: "ACCOUNT_SPECIFIC",
  startTime: "2026-08-14T09:00:00.000Z",
}

const TENANT_DB_ARN = "arn:aws:rds:eu-west-2:210987654321:db:tenure-simon-ose"
const UNTAGGED_ARN = "arn:aws:rds:eu-west-2:210987654321:db:tenure-orphan"

const POPULATED: FakeSpec = {
  region: "eu-west-2",
  events: { kind: "ok", pages: [{ events: [OPEN_EVENT] }, { events: [ELSEWHERE_EVENT, UPCOMING_EVENT] }] },
  entities: {
    kind: "ok",
    pages: [
      {
        entities: [
          {
            eventArn: OPEN_EVENT.arn,
            entityArn: "arn:aws:health:eu-west-2:210987654321:entity/aBcD",
            entityValue: TENANT_DB_ARN,
            statusCode: "IMPAIRED",
            lastUpdatedTime: "2026-08-13T08:50:00.000Z",
            tags: { "tenure:tenant": "stale-value-from-when-the-event-was-raised" },
          },
          {
            eventArn: OPEN_EVENT.arn,
            entityArn: "arn:aws:health:eu-west-2:210987654321:entity/eFgH",
            entityValue: UNTAGGED_ARN,
            statusCode: "IMPAIRED",
          },
          {
            eventArn: UPCOMING_EVENT.arn,
            entityValue: "i-0abc123def456",
            statusCode: "PENDING",
          },
        ],
      },
    ],
  },
  tags: {
    kind: "ok",
    pages: [
      {
        ResourceTagMappingList: [
          {
            ResourceARN: TENANT_DB_ARN,
            Tags: [
              { Key: "tenure:tenant", Value: "simon-ose" },
              { Key: "tenure:environment", Value: "production" },
            ],
          },
        ],
      },
    ],
  },
}

/* ------------------------------------------- the four answers, told apart -- */

describe("the four ways an AWS call can answer produce four different sentences", () => {
  test("populated — the events are real, attributed, and counted", async () => {
    const gw = fake(POPULATED)
    const surface = await awsHealthSurface(gw, FAST)

    expect(surface.events.state).toBe("ACTUAL")
    // Both pages. A surface that ignored `nextToken` would have one event here.
    expect(surface.rows.map((r) => r.eventTypeCode)).toEqual([
      "AWS_RDS_OPERATIONAL_ISSUE",
      "AWS_EC2_OPERATIONAL_ISSUE",
      "AWS_RDS_MAINTENANCE_SCHEDULED",
    ])
    expect(surface.rows.map((r) => r.verdict)).toEqual([
      "AFFECTING_US",
      "OPEN_ELSEWHERE",
      "UPCOMING",
    ])
    expect(surface.headline).toContain("3 open or upcoming AWS Health event(s)")
    expect(surface.headline).toContain("account 210987654321")
    expect(surface.headline).toContain("as of 2026-08-13T09:00:00.000Z")
    // Not a page's guess: the registry's own cadence for this capability.
    expect(surface.refreshMs).toBe(AWS_HEALTH_TTL_MS)
  })

  test("empty-but-successful — a claim, worded as AWS's answer", async () => {
    const gw = fake({ events: { kind: "ok", pages: [{ events: [] }] } })
    const surface = await awsHealthSurface(gw, FAST)

    expect(surface.events.state).toBe("EMPTY")
    expect(surface.rows).toEqual([])
    expect(surface.headline).toContain("none — AWS Health answered with no open or upcoming events")
    // The thing that makes it different from a denial, asserted rather than assumed.
    expect(surface.headline).not.toContain("Minimum statement")
    expect(surface.entityHeadline).toBe(
      "no open or upcoming events, so no resources in this account are affected by one.",
    )
    // The entity call is never made when there is nothing to ask about, and the
    // tag index is not read either. Both are recorded as decisions rather than
    // performed and thrown away — and UNCONFIGURED is `isUnknown`, so neither
    // reaches a page as "nothing is affected".
    expect(surface.entities.state).toBe("UNCONFIGURED")
    expect(surface.tagged.state).toBe("UNCONFIGURED")
    expect(gw.calls.map((c) => c.capability)).toEqual([
      "sts:GetCallerIdentity",
      "health:DescribeEvents",
    ])
  })

  test("AccessDenied — UNKNOWN carrying the principal, the action and a statement", async () => {
    const surface = await awsHealthSurface(
      fake({
        events: {
          kind: "throw",
          name: "AccessDeniedException",
          message: "User: arn:aws:sts::210987654321:assumed-role/tenure-studio/task is not authorized to perform: health:DescribeEvents",
        },
      }),
      FAST,
    )

    expect(surface.events.state).toBe("DENIED")
    expect(surface.headline).toContain("unknown")
    expect(surface.headline).toContain("health:DescribeEvents was refused")
    expect(surface.headline).toContain("AccessDeniedException")
    expect(surface.headline).toContain("arn:aws:sts::210987654321:assumed-role/tenure-studio/task")
    expect(surface.headline).toContain('{"Effect":"Allow","Action":["health:DescribeEvents"],"Resource":"*"}')
    // The sentence a denial must NEVER contain.
    expect(surface.headline).not.toContain("none —")
    // And never an empty table: one row that says the surface is unauthorized.
    expect(surface.rows).toHaveLength(1)
    expect(surface.rows[0].verdict).toBe("UNAUTHORIZED")
    expect(surface.rows[0].entitiesKnown).toBe(false)
  })

  test("throttled — its own state, not a failure and not an absence", async () => {
    const surface = await awsHealthSurface(
      fake({
        events: { kind: "throw", name: "ThrottlingException", message: "Rate exceeded" },
      }),
      FAST,
    )

    expect(surface.events.state).toBe("THROTTLED")
    expect(surface.headline).toContain("throttled")
    expect(surface.headline).toContain("retrying in")
    expect(surface.headline).not.toContain("none —")
    expect(surface.headline).not.toContain("Minimum statement")
    expect(surface.rows).toEqual([])
  })

  test("a throttle that clears on the retry is an ACTUAL reading, not a THROTTLED one", async () => {
    const gw = fake({
      region: "eu-west-2",
      events: {
        kind: "throwThen",
        name: "ThrottlingException",
        message: "Rate exceeded",
        times: 1,
        pages: [{ events: [OPEN_EVENT] }],
      },
      entities: { kind: "ok", pages: [{ entities: [] }] },
      tags: { kind: "ok", pages: [{ ResourceTagMappingList: [] }] },
    })
    const surface = await awsHealthSurface(gw, { ...FAST, attempts: 3 })

    expect(surface.events.state).toBe("ACTUAL")
    expect(surface.rows).toHaveLength(1)
    expect(gw.calls.filter((c) => c.capability === "health:DescribeEvents")).toHaveLength(2)
  })

  test("all four headlines are provably different text", async () => {
    const headlines = await Promise.all(
      [
        POPULATED,
        { events: { kind: "ok", pages: [{ events: [] }] } } as FakeSpec,
        { events: { kind: "throw", name: "AccessDeniedException", message: "no" } } as FakeSpec,
        { events: { kind: "throw", name: "ThrottlingException", message: "Rate exceeded" } } as FakeSpec,
        {
          events: {
            kind: "throw",
            name: "SubscriptionRequiredException",
            message: "Amazon Health API is only available to Business and Enterprise support plan customers",
          },
        } as FakeSpec,
      ].map(async (spec) => (await awsHealthSurface(fake(spec), FAST)).headline),
    )

    expect(new Set(headlines).size).toBe(headlines.length)
  })
})

/* ------------------------------------------------- the support-plan answer -- */

describe("SubscriptionRequiredException is an UNKNOWN with a named remedy", () => {
  test("it is not EMPTY, not ERROR, and names the plan to buy", async () => {
    const surface = await awsHealthSurface(
      fake({
        events: {
          kind: "throw",
          name: "SubscriptionRequiredException",
          message: "Amazon Health API is only available to Business and Enterprise support plan customers",
        },
      }),
      FAST,
    )

    expect(surface.events.state).toBe("UNCONFIGURED")
    expect(surface.headline).toContain("unknown")
    expect(surface.headline).toContain("Business")
    expect(surface.headline).toContain("Remedy: raise this account's AWS Support plan")
    // The two sentences it must never be confused with.
    expect(surface.headline).not.toContain("none —")
    expect(surface.headline).not.toContain("Minimum statement")
    expect(surface.rows).toEqual([])
  })
})

/* --------------------------------------------------- the partial-knowledge -- */

describe("events readable and entities refused is its own state", () => {
  test("a row never reads as 'touches nothing' when the entity call was refused", async () => {
    const surface = await awsHealthSurface(
      fake({
        region: "eu-west-2",
        events: { kind: "ok", pages: [{ events: [OPEN_EVENT] }] },
        entities: {
          kind: "throw",
          name: "AccessDeniedException",
          message: "not authorized to perform: health:DescribeAffectedEntities",
        },
        tags: { kind: "ok", pages: [{ ResourceTagMappingList: [] }] },
      }),
      FAST,
    )

    expect(surface.events.state).toBe("ACTUAL")
    expect(surface.entities.state).toBe("DENIED")
    expect(surface.rows).toHaveLength(1)
    expect(surface.rows[0].entitiesKnown).toBe(false)
    expect(surface.rows[0].entitiesDetail).toContain("unknown")
    expect(surface.rows[0].entitiesDetail).not.toContain("0 affected resource(s)")
    // The denial quotes the action that was actually refused — not the one that
    // succeeded, which is the mistake that sends an operator to the wrong grant.
    expect(surface.entityHeadline).toContain("health:DescribeAffectedEntities was refused")
    expect(surface.entityHeadline).not.toContain("health:DescribeEvents was refused")
    expect(surface.entityHeadline).toContain(
      '{"Effect":"Allow","Action":["health:DescribeAffectedEntities"],"Resource":"*"}',
    )
    expect(tenantsAffected(surface).eventsWithUnknownEntities).toBe(1)
  })

  test("an entity call that answers with nothing IS a count, and says so", async () => {
    const surface = await awsHealthSurface(
      fake({
        region: "eu-west-2",
        events: { kind: "ok", pages: [{ events: [OPEN_EVENT] }] },
        entities: { kind: "ok", pages: [{ entities: [] }] },
        tags: { kind: "ok", pages: [{ ResourceTagMappingList: [] }] },
      }),
      FAST,
    )

    expect(surface.entities.state).toBe("EMPTY")
    expect(surface.rows[0].entitiesKnown).toBe(true)
    expect(surface.rows[0].entitiesDetail).toContain("AWS named none for this event")
    expect(surface.entityHeadline).toContain("AWS Health named no resources in this account")
  })
})

/* ------------------------------------------------------------- residency -- */

describe("the region an event is compared against is resolved, never a literal", () => {
  test("an eu-west-2 estate does not read its own region's event as somebody else's", async () => {
    const surface = await awsHealthSurface(
      fake({
        region: "eu-west-2",
        events: { kind: "ok", pages: [{ events: [{ ...OPEN_EVENT, eventScopeCode: "PUBLIC" }] }] },
        entities: { kind: "ok", pages: [{ entities: [] }] },
        tags: { kind: "ok", pages: [{ ResourceTagMappingList: [] }] },
      }),
      FAST,
    )
    expect(surface.region).toBe("eu-west-2")
    expect(surface.rows[0].verdict).toBe("OPEN_IN_OUR_REGION")
  })

  test("the SAME event in a us-east-1 estate is another region's", async () => {
    const surface = await awsHealthSurface(
      fake({
        region: "us-east-1",
        events: { kind: "ok", pages: [{ events: [{ ...OPEN_EVENT, eventScopeCode: "PUBLIC" }] }] },
        entities: { kind: "ok", pages: [{ entities: [] }] },
        tags: { kind: "ok", pages: [{ ResourceTagMappingList: [] }] },
      }),
      FAST,
    )
    expect(surface.region).toBe("us-east-1")
    expect(surface.rows[0].verdict).toBe("OPEN_ELSEWHERE")
    expect(surface.rows[0].detail).toContain("this process resolved us-east-1")
  })

  test("identity that did not answer produces OPEN_REGION_UNKNOWN, not a guess", async () => {
    const surface = await awsHealthSurface(
      fake({
        region: "eu-west-2",
        identity: { kind: "throw", name: "AccessDeniedException", message: "not authorized: sts:GetCallerIdentity" },
        events: { kind: "ok", pages: [{ events: [{ ...OPEN_EVENT, eventScopeCode: "PUBLIC" }] }] },
        entities: { kind: "ok", pages: [{ entities: [] }] },
        tags: { kind: "ok", pages: [{ ResourceTagMappingList: [] }] },
      }),
      FAST,
    )

    expect(surface.region).toBeNull()
    expect(surface.accountId).toBeNull()
    expect(surface.partition).toBeNull()
    expect(surface.rows[0].verdict).toBe("OPEN_REGION_UNKNOWN")
    expect(surface.rows[0].detail).toContain("UNKNOWN")
    expect(surface.headline).toContain("an account this engine could not resolve")
  })

  test("a global event is never filed as another region's problem", () => {
    expect(
      verdictFor({ region: undefined, statusCode: "open", eventScopeCode: "PUBLIC" }, { ourRegion: "eu-west-2", now: NOW })
        .verdict,
    ).toBe("OPEN_IN_OUR_REGION")
  })
})

/* ----------------------------------------------------------- attribution -- */

describe("attribution comes from the tagging index, and 'untagged' is not 'shared'", () => {
  test("the current tag index outranks the tags the event was raised with", async () => {
    const surface = await awsHealthSurface(fake(POPULATED), FAST)
    const affected = surface.rows[0].entities

    expect(affected).toHaveLength(2)
    expect(affected[0].attribution).toEqual({ kind: "tenant", tenantSlug: "simon-ose" })
    expect(affected[0].attributionText).toBe("simon-ose")
    // The entity's own map said something else; the index is what is true now.
    expect(affected[0].tags["tenure:tenant"]).toBe("simon-ose")

    // Nobody tagged this one. It is NOT shared, and the word matters: shared is
    // a decision somebody made, unattributed is a decision nobody made.
    expect(affected[1].attribution).toEqual({ kind: "unattributed" })
    expect(affected[1].attributionText).toBe("unattributable — missing tenure:tenant")

    expect(surface.rows[0].tenants).toEqual(["simon-ose"])
    expect(tenantsAffected(surface)).toEqual({
      tenants: ["simon-ose"],
      unattributedEntities: 2,
      eventsWithUnknownEntities: 0,
    })
    expect(surface.entityHeadline).toContain("1 tenant(s) (simon-ose)")
    expect(surface.entityHeadline).toContain("2 with no tenure:tenant tag at all")
  })

  test("a tag index that was refused weakens attribution and SAYS so", async () => {
    const surface = await awsHealthSurface(
      fake({
        ...POPULATED,
        tags: { kind: "throw", name: "AccessDeniedException", message: "not authorized: tag:GetResources" },
      }),
      FAST,
    )

    expect(surface.tagged.state).toBe("DENIED")
    // The event's own tag map is still used — it is a weaker fact, not no fact.
    expect(surface.rows[0].entities[0].tags["tenure:tenant"]).toBe(
      "stale-value-from-when-the-event-was-raised",
    )
    expect(surface.rows[0].entitiesDetail).toContain("attribution is from the event's own tags only")
    expect(surface.entityHeadline).toContain("tag:GetResources")
  })

  test("an entity whose value is not an ARN cannot be joined, and is not pretended otherwise", () => {
    expect(taggableArnOf({ entityValue: TENANT_DB_ARN })).toBe(TENANT_DB_ARN)
    expect(taggableArnOf({ entityValue: "i-0abc", entityArn: "arn:aws:health:eu-west-2:1:entity/x" })).toBe(
      "arn:aws:health:eu-west-2:1:entity/x",
    )
    expect(taggableArnOf({ entityValue: "i-0abc" })).toBeNull()
  })
})

/* ------------------------------------------------------------- the calls -- */

describe("the calls this surface makes are the ones the API accepts", () => {
  test("event ARNs are chunked to the filter's limit of ten", async () => {
    const many = Array.from({ length: 23 }, (_, i) => ({
      ...OPEN_EVENT,
      arn: `arn:aws:health:eu-west-2::event/RDS/AWS_RDS_OPERATIONAL_ISSUE/${i}`,
    }))
    const gw = fake({
      region: "eu-west-2",
      events: { kind: "ok", pages: [{ events: many }] },
      entities: { kind: "ok", pages: [{ entities: [] }] },
      tags: { kind: "ok", pages: [{ ResourceTagMappingList: [] }] },
    })

    const surface = await awsHealthSurface(gw, FAST)

    // The stand-in throws ValidationException past ten, exactly as AWS does, so
    // an unchunked call would land as ERROR rather than as three reads.
    expect(surface.entities.state).not.toBe("ERROR")
    const entityCalls = gw.calls.filter((c) => c.capability === "health:DescribeAffectedEntities")
    expect(entityCalls).toHaveLength(3)
    expect(entityCalls.map((c) => (c.input.eventArns as string[]).length)).toEqual([10, 10, 3])
    expect(chunkEventArns(many.map((e) => e.arn)).map((c) => c.length)).toEqual([10, 10, 3])
  })

  test("the entity read follows its own nextToken", async () => {
    const gw = fake({
      region: "eu-west-2",
      events: { kind: "ok", pages: [{ events: [OPEN_EVENT] }] },
      entities: {
        kind: "ok",
        pages: [
          { entities: [{ eventArn: OPEN_EVENT.arn, entityValue: TENANT_DB_ARN, statusCode: "IMPAIRED" }] },
          { entities: [{ eventArn: OPEN_EVENT.arn, entityValue: UNTAGGED_ARN, statusCode: "IMPAIRED" }] },
        ],
      },
      tags: { kind: "ok", pages: [{ ResourceTagMappingList: [] }] },
    })

    const surface = await awsHealthSurface(gw, FAST)

    // A surface that stopped at the first page would report one affected
    // resource for an event that touches two, which is a blast radius nobody
    // could act on correctly.
    expect(surface.rows[0].entities.map((e) => e.entityValue)).toEqual([TENANT_DB_ARN, UNTAGGED_ARN])
    expect(gw.calls.filter((c) => c.capability === "health:DescribeAffectedEntities")).toHaveLength(2)
  })

  test("only the four capabilities this surface owns are ever called", async () => {
    const gw = fake(POPULATED)
    await awsHealthSurface(gw, FAST)
    expect([...new Set(gw.calls.map((c) => c.capability))].sort()).toEqual([
      "health:DescribeAffectedEntities",
      "health:DescribeEvents",
      "sts:GetCallerIdentity",
      "tag:GetResources",
    ])
  })
})

/* ----------------------------------------------------------------- clock -- */

describe("every reading carries an explicit as-of", () => {
  test("the surface, the read and the upcoming countdown all use the same clock", async () => {
    const surface = await awsHealthSurface(fake(POPULATED), FAST)
    expect(surface.asOf).toBe("2026-08-13T09:00:00.000Z")
    if (surface.events.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(surface.events.asOf).toBe("2026-08-13T09:00:00.000Z")
    // 2026-08-14T09:00Z is 24 hours after the frozen clock.
    expect(surface.rows[2].detail).toContain("(24 hour(s) from this reading)")
  })
})
