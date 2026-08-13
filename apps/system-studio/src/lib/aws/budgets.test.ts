import { REQUIRED_RESOURCE_TAGS, SHARED } from "@tenure/provisioning"
import { toMinorUnits } from "@tenure/finops"

import {
  budgetReadings,
  budgetsOf,
  describeBudget,
  describeBudgets,
  watchedTenant,
  type BudgetReadings,
} from "./budgets"
// `Capability` comes from `./capabilities`, which declares it — `./read` imports
// it for its own signatures and does not re-export it, so reaching for it there
// is a compile error rather than a style choice. `capabilities.test.ts` beside
// this file already imports it from the declaring module.
import { BUDGETS_TTL_MS, CAPABILITIES, type Capability } from "./capabilities"
import { describeRead, isUnknown, type AwsGateway } from "./read"
import { READ_ATTEMPTS, backoffMs } from "./throttle"

/**
 * STUDIO-120-009 / STUDIO-000-007 — the budgets surface must say four different
 * things for four different truths.
 *
 * The assertions are on `budgetReadings`, the PRODUCER the route agent will
 * call, and never on the projection helpers directly. A test that called
 * `project()` would stay green on the day `budgetReadings` stopped calling it,
 * which is the exact shape of failure this programme has already paid for.
 *
 * The stand-in gateway is the load-bearing part. It answers the way the real
 * client answers — `{ Budgets: [{ BudgetLimit: { Amount, Unit } }], NextToken }`
 * with `Amount` as a decimal STRING, `TimePeriod` as `Date`s, and errors thrown
 * with the `name` the SDK models — and it can produce all four outcomes:
 * AccessDenied, a throttle, an empty-but-successful list, and a populated one. A
 * fake that returned `[]` whatever the code did would prove nothing, which is
 * why every case below asserts a DIFFERENT sentence out of the same function.
 */

/* ------------------------------------------------------------ the estate -- */

/**
 * A GovCloud identity, deliberately.
 *
 * Every ARN this module builds is checked against `aws-us-gov`, so a literal
 * `arn:aws:` anywhere in the projection fails here rather than in the partition
 * where nobody is looking. That is GE-010-007 in miniature.
 */
const ACCOUNT = "210987654321"
const PARTITION = "aws-us-gov"
const REGION = "us-gov-west-1"
const PRINCIPAL = `arn:${PARTITION}:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`

const IDENTITY_RESPONSE = { Account: ACCOUNT, Arn: PRINCIPAL, UserId: "AROAEXAMPLE:abc" }

const TENANT_TAG = REQUIRED_RESOURCE_TAGS[0]

function budgetArn(name: string): string {
  return `arn:${PARTITION}:budgets::${ACCOUNT}:budget/${name}`
}

/* ------------------------------------------------------ the AWS responses -- */

/** An error shaped the way the SDK throws one: the modelled `name` is the signal. */
function awsError(name: string): Error {
  const error = new Error(`${name}: raised by the stand-in gateway`)
  error.name = name
  return error
}

/**
 * Two pages, because the reader walks `NextToken` and a single-page fixture
 * would leave that loop unexercised.
 */
const PAGE_ONE = {
  NextToken: "page-2",
  Budgets: [
    {
      BudgetName: "tenure-simon-ose-monthly",
      BudgetType: "COST",
      TimeUnit: "MONTHLY",
      BudgetLimit: { Amount: "1234.56", Unit: "USD" },
      CalculatedSpend: {
        ActualSpend: { Amount: "400.00", Unit: "USD" },
        ForecastedSpend: { Amount: "1500.00", Unit: "USD" },
      },
      CostFilters: { TagKeyValue: [`user:${TENANT_TAG}$simon-ose`] },
      TimePeriod: { Start: new Date("2026-08-01T00:00:00Z"), End: new Date("2026-09-01T00:00:00Z") },
      LastUpdatedTime: new Date("2026-08-12T06:00:00Z"),
    },
    {
      BudgetName: "tenure-control-plane-monthly",
      BudgetType: "COST",
      TimeUnit: "MONTHLY",
      BudgetLimit: { Amount: "500.00", Unit: "USD" },
      CalculatedSpend: {
        ActualSpend: { Amount: "640.00", Unit: "USD" },
        ForecastedSpend: { Amount: "700.00", Unit: "USD" },
      },
      // Owned by the platform (its tag says `tenure:shared`) and filtered to ONE
      // tenant's spend. That is a real misconfiguration and the only fixture
      // shape that can tell `attribution` and `watchesTenant` apart — a budget
      // whose owner tag and cost filter name the same tenant proves nothing
      // about which field the reader actually read.
      CostFilters: { TagKeyValue: [`user:${TENANT_TAG}$north-hills`] },
      TimePeriod: { Start: new Date("2026-08-01T00:00:00Z"), End: new Date("2026-09-01T00:00:00Z") },
    },
  ],
}

const PAGE_TWO = {
  Budgets: [
    {
      // Not money. `Unit` is GB, and a Money denominated in "GB" sums with
      // dollars without complaining.
      BudgetName: "tenure-egress-gb",
      BudgetType: "USAGE",
      TimeUnit: "MONTHLY",
      BudgetLimit: { Amount: "500", Unit: "GB" },
      CalculatedSpend: { ActualSpend: { Amount: "120", Unit: "GB" } },
    },
    {
      // A currency with NO minor unit. A hardcoded two-decimal parser counts
      // 120,000 minor units here; the true count is 1,200.
      BudgetName: "tenure-jp-cell-monthly",
      BudgetType: "COST",
      TimeUnit: "MONTHLY",
      BudgetLimit: { Amount: "1200", Unit: "JPY" },
      CalculatedSpend: { ActualSpend: { Amount: "100", Unit: "JPY" } },
    },
    {
      // A sub-cent actual, which is what a Lambda line item looks like. Any
      // implementation that goes through a float and rounds to cents zeroes it.
      BudgetName: "tenure-relay-daily",
      BudgetType: "COST",
      TimeUnit: "DAILY",
      BudgetLimit: { Amount: "1.00", Unit: "USD" },
      CalculatedSpend: { ActualSpend: { Amount: "0.0000004", Unit: "USD" } },
    },
  ],
}

/** The tag index the Resource Groups Tagging API returns for those ARNs. */
const TAGGED_RESPONSE = {
  ResourceTagMappingList: [
    {
      ResourceARN: budgetArn("tenure-simon-ose-monthly"),
      Tags: [
        { Key: TENANT_TAG, Value: "simon-ose" },
        { Key: "tenure:environment", Value: "production" },
      ],
    },
    {
      ResourceARN: budgetArn("tenure-control-plane-monthly"),
      Tags: [{ Key: TENANT_TAG, Value: SHARED }],
    },
    // `tenure-egress-gb` is deliberately absent: an untagged resource must read
    // as unattributable, not as shared.
  ],
}

/* ------------------------------------------------------- the fake gateway -- */

type BudgetsAnswer =
  | { kind: "denied" }
  | { kind: "throttled" }
  | { kind: "empty" }
  | { kind: "populated" }

interface Recorder {
  gateway: AwsGateway
  calls: Capability[]
  sleeps: number[]
  sleep: (ms: number) => Promise<void>
}

/**
 * A gateway that behaves like `client.ts` across every case the surface has to
 * tell apart, and records what was asked of it.
 *
 * `identityAnswer` is separate from `budgetsAnswer` so the case where identity
 * itself failed can prove the budgets call was never MADE — an assertion about
 * an absent call, which is the only way to catch a reader that would have sent
 * `AccountId: "undefined"`.
 */
function fakeAws(
  budgetsAnswer: BudgetsAnswer,
  options: { identity?: "ok" | "denied"; tagged?: "ok" | "denied" } = {},
): Recorder {
  const calls: Capability[] = []
  const sleeps: number[] = []

  const gateway: AwsGateway = {
    async call(capability, input) {
      calls.push(capability)
      switch (capability) {
        case "sts:GetCallerIdentity":
          if (options.identity === "denied") throw awsError("AccessDeniedException")
          return IDENTITY_RESPONSE

        case "tag:GetResources":
          if (options.tagged === "denied") throw awsError("AccessDeniedException")
          return TAGGED_RESPONSE

        case "budgets:DescribeBudgets": {
          // The real API refuses a request with no account, and a reader that
          // let `undefined` through would get an empty list from AWS rather
          // than an error. Reproduced here so that path cannot pass silently.
          if (typeof input?.AccountId !== "string" || !/^\d{12}$/.test(input.AccountId)) {
            throw awsError("ValidationException")
          }
          if (budgetsAnswer.kind === "denied") throw awsError("AccessDeniedException")
          if (budgetsAnswer.kind === "throttled") throw awsError("ThrottlingException")
          if (budgetsAnswer.kind === "empty") return { Budgets: [] }
          return input.NextToken === "page-2" ? PAGE_TWO : PAGE_ONE
        }

        default:
          throw new Error(`the stand-in gateway was asked for ${capability}, which it does not model`)
      }
    },
    async resolvedRegion() {
      return REGION
    },
  }

  return {
    gateway,
    calls,
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms)
    },
  }
}

const CLOCK = () => new Date("2026-08-13T09:30:00.000Z")

async function read(
  answer: BudgetsAnswer,
  options: { identity?: "ok" | "denied"; tagged?: "ok" | "denied" } = {},
): Promise<{ readings: BudgetReadings; recorder: Recorder }> {
  const recorder = fakeAws(answer, options)
  const readings = await budgetReadings(recorder.gateway, {
    now: CLOCK,
    sleep: recorder.sleep,
  })
  return { readings, recorder }
}

/* ------------------------------------------------------------ case 1: denied -- */

describe("a refused budgets call is UNKNOWN, never an empty list", () => {
  test("it is DENIED and carries the principal, the action and a pasteable statement", async () => {
    const { readings } = await read({ kind: "denied" })
    const budgets = readings.budgets

    expect(budgets.state).toBe("DENIED")
    if (budgets.state !== "DENIED") throw new Error("narrowing")

    // The action is spelled the way IAM spells it. `budgets:DescribeBudgets` in
    // a policy grants nothing at all and denies identically, which is the whole
    // reason the registry separates the API name from the action.
    expect(budgets.action).toBe("budgets:ViewBudget")
    expect(budgets.principal).toBe(PRINCIPAL)
    expect(budgets.accountId).toBe(ACCOUNT)
    expect(budgets.region).toBe(REGION)
    expect(budgets.partition).toBe(PARTITION)
    expect(budgets.errorCode).toBe("AccessDeniedException")

    const statement = JSON.parse(budgets.minimumStatement)
    expect(statement).toEqual({
      Effect: "Allow",
      Action: ["budgets:ViewBudget"],
      Resource: CAPABILITIES["budgets:DescribeBudgets"].resource,
    })
  })

  test("no state a denial can reach carries a value, so nothing can render it as none", async () => {
    const { readings } = await read({ kind: "denied" })
    expect(readings.budgets.state).not.toBe("EMPTY")
    expect(readings.budgets.state).not.toBe("ACTUAL")
    expect(isUnknown(readings.budgets)).toBe(true)
    // `budgetsOf` returns [] here, and that is exactly why a caller may not use
    // its length to decide what to say. The sentence is what a surface prints.
    expect(budgetsOf(readings.budgets)).toEqual([])
    expect(describeBudgets(readings)).toContain("budgets:ViewBudget")
    expect(describeBudgets(readings)).not.toContain("none")
  })
})

/* --------------------------------------------------------- case 2: throttled -- */

describe("a throttle is its own state, on throttle.ts's schedule", () => {
  test("it is THROTTLED, not ERROR and not EMPTY", async () => {
    const { readings } = await read({ kind: "throttled" })
    expect(readings.budgets.state).toBe("THROTTLED")
    expect(describeBudgets(readings)).toContain("throttled")
  })

  test("the backoff is the console's one schedule, not a number typed here", async () => {
    const { readings, recorder } = await read({ kind: "throttled" })
    if (readings.budgets.state !== "THROTTLED") throw new Error("narrowing")

    // The waits are throttle.ts's curve. `backoffMs(1)` is zero because the
    // first attempt is not a retry, so the observed pauses start at attempt 2.
    expect(recorder.sleeps).toEqual([backoffMs(2), backoffMs(3)])
    // The budgets call was attempted exactly the budgeted number of times.
    expect(recorder.calls.filter((c) => c === "budgets:DescribeBudgets")).toHaveLength(READ_ATTEMPTS)
    // What the surface tells an operator to expect is the schedule's next step,
    // not a guess.
    expect(readings.budgets.retryAfterMs).toBe(backoffMs(READ_ATTEMPTS + 1))
  })
})

/* ------------------------------------------------------------- case 3: empty -- */

describe("an account with no budgets says so, and says it differently", () => {
  test("EMPTY, with an as-of and no value to reach for", async () => {
    const { readings } = await read({ kind: "empty" })
    expect(readings.budgets.state).toBe("EMPTY")
    if (readings.budgets.state !== "EMPTY") throw new Error("narrowing")
    expect(readings.budgets.asOf).toBe(CLOCK().toISOString())
    expect(describeBudgets(readings)).toContain("none")
    expect(describeBudgets(readings)).not.toContain("unknown")
  })

  test("an account with NO budget at all is a finding, not a clean page", async () => {
    // The read succeeded and there is genuinely nothing. That is a real answer
    // and a bad one — nothing is watching this account's spend — and it must
    // not be confused with the denial above.
    const empty = await read({ kind: "empty" })
    const denied = await read({ kind: "denied" })
    expect(describeBudgets(empty.readings)).not.toBe(describeBudgets(denied.readings))
  })
})

/* --------------------------------------------------------- case 4: populated -- */

describe("a populated read is real budgets, in integer minor units", () => {
  test("every page is walked", async () => {
    const { readings } = await read({ kind: "populated" })
    expect(readings.budgets.state).toBe("ACTUAL")
    const budgets = budgetsOf(readings.budgets)
    expect(budgets.map((b) => b.name)).toEqual([
      "tenure-simon-ose-monthly",
      "tenure-control-plane-monthly",
      "tenure-egress-gb",
      "tenure-jp-cell-monthly",
      "tenure-relay-daily",
    ])
  })

  test("money is integer minor units with the currency carried, never a float", async () => {
    const { readings } = await read({ kind: "populated" })
    const budgets = budgetsOf(readings.budgets)
    const tenant = budgets[0]

    expect(tenant.limit).not.toBeNull()
    expect(tenant.limit!.amount.currency).toBe("USD")
    expect(Number.isInteger(tenant.limit!.amount.units)).toBe(true)
    expect(toMinorUnits(tenant.limit!.amount, "down")).toBe(123456)
    expect(toMinorUnits(tenant.actual!.amount, "down")).toBe(40000)
    expect(toMinorUnits(tenant.forecast!.amount, "down")).toBe(150000)
    // The kinds are distinct, so nothing can render a projection as a bill.
    expect([tenant.limit!.kind, tenant.actual!.kind, tenant.forecast!.kind]).toEqual([
      "BUDGET",
      "ACTUAL",
      "FORECAST",
    ])
  })

  test("a currency with no minor unit is not counted in hundredths", async () => {
    const { readings } = await read({ kind: "populated" })
    const jpy = budgetsOf(readings.budgets).find((b) => b.name === "tenure-jp-cell-monthly")!
    expect(jpy.limit!.amount.currency).toBe("JPY")
    expect(toMinorUnits(jpy.limit!.amount, "down")).toBe(1200)
  })

  test("a sub-cent figure survives ingest instead of rounding to nothing", async () => {
    const { readings } = await read({ kind: "populated" })
    const relay = budgetsOf(readings.budgets).find((b) => b.name === "tenure-relay-daily")!
    // 0.0000004 USD at SCALE 6 below the cent is 40 units. A float path that
    // rounded to cents would make this zero and the budget look unused.
    expect(relay.actual!.amount.units).toBe(40)
  })

  test("a budget whose unit is not a currency produces no Money at all", async () => {
    const { readings } = await read({ kind: "populated" })
    const usage = budgetsOf(readings.budgets).find((b) => b.name === "tenure-egress-gb")!
    expect(usage.limit).toBeNull()
    expect(usage.actual).toBeNull()
    expect(usage.quantity).toEqual({
      limit: { amount: "500", unit: "GB" },
      actual: { amount: "120", unit: "GB" },
      forecast: null,
    })
    // And it says so rather than reporting a healthy spend limit.
    expect(usage.posture).toBe("NO_BUDGET")
  })

  test("posture is assessed against AWS's forecast, and says so when there is none", async () => {
    const { readings } = await read({ kind: "populated" })
    const budgets = budgetsOf(readings.budgets)

    // Inside the limit today (400 of 1234.56) and projected past it (1500).
    expect(budgets[0].posture).toBe("AT_RISK")
    // Already past the limit in fact.
    expect(budgets[1].posture).toBe("OVER")
    expect(toMinorUnits(budgets[1].variance!, "down")).toBe(14000)
    // No forecast at all: not on track, not off track — unknown, and stated.
    const jpy = budgets.find((b) => b.name === "tenure-jp-cell-monthly")!
    expect(jpy.posture).toBe("NO_FORECAST")
    expect(jpy.variance).toBeNull()
    expect(jpy.postureDetail).toContain("unknown")
  })

  test("period, cadence and as-of travel with the reading", async () => {
    const { readings } = await read({ kind: "populated" })
    const tenant = budgetsOf(readings.budgets)[0]
    expect(tenant.period).toEqual({
      start: "2026-08-01T00:00:00.000Z",
      end: "2026-09-01T00:00:00.000Z",
    })
    expect(tenant.lastUpdated).toBe("2026-08-12T06:00:00.000Z")
    expect(readings.asOf).toBe(CLOCK().toISOString())
    expect(readings.refreshMs).toBe(BUDGETS_TTL_MS)
    expect(readings.refreshMs).toBe(CAPABILITIES["budgets:DescribeBudgets"].refreshMs)
  })
})

/* ------------------------------------------------- partition and residency -- */

describe("the estate comes from the resolved identity, never from a literal", () => {
  test("every budget ARN is built in the partition the caller is actually in", async () => {
    const { readings } = await read({ kind: "populated" })
    for (const budget of budgetsOf(readings.budgets)) {
      expect(budget.arn).toBe(budgetArn(budget.name))
      expect(budget.arn.startsWith(`arn:${PARTITION}:budgets::${ACCOUNT}:`)).toBe(true)
      // Budgets is partition-scoped: the region segment is genuinely empty.
      expect(budget.arn).not.toContain(`:${REGION}:`)
    }
  })

  test("the account the call is scoped by is the one STS answered with", async () => {
    // Proven through the gateway: it refuses anything that is not a twelve-digit
    // account, so a reader passing an environment default or `undefined` would
    // land in ERROR here rather than quietly reading the wrong account.
    const { readings } = await read({ kind: "populated" })
    expect(readings.budgets.state).toBe("ACTUAL")
  })
})

/* ------------------------------------------------------------- attribution -- */

describe("attribution comes from the tag index, and unattributed is its own answer", () => {
  test("tenant, shared and unattributable are three answers, not two", async () => {
    const { readings } = await read({ kind: "populated" })
    const budgets = budgetsOf(readings.budgets)

    expect(budgets[0].attribution).toEqual({ kind: "tenant", tenantSlug: "simon-ose" })
    expect(budgets[1].attribution).toEqual({ kind: "shared" })
    // No tag at all. Folding this into "shared" is how an untagged resource
    // becomes every tenant's problem, so it stays its own answer.
    const usage = budgets.find((b) => b.name === "tenure-egress-gb")!
    expect(usage.attribution).toEqual({ kind: "unattributed" })
    expect(describeBudget(usage)).toContain("unattributable")
  })

  test("who OWNS the budget and whose spend it WATCHES are separate facts", async () => {
    const { readings } = await read({ kind: "populated" })
    const budgets = budgetsOf(readings.budgets)

    expect(budgets[0].watchesTenant).toBe("simon-ose")

    // The case that makes the two fields worth having. This budget's OWNER tag
    // says `tenure:shared` and its cost filter watches `north-hills`: reading
    // either one for the other reports a budget that is watching nobody, or a
    // tenant budget that is really the platform's. Both are wrong and both look
    // fine.
    expect(budgets[1].attribution).toEqual({ kind: "shared" })
    expect(budgets[1].watchesTenant).toBe("north-hills")
    const line = describeBudget(budgets[1])
    expect(line).toContain("shared")
    expect(line).toContain("north-hills")

    // A budget with no tenant cost filter covers the whole account, and saying
    // otherwise would attribute the fleet's bill to one tenant.
    const jpy = budgets.find((b) => b.name === "tenure-jp-cell-monthly")!
    expect(jpy.watchesTenant).toBeNull()
    expect(describeBudget(jpy)).toContain("the whole account")
  })

  test("the cost-filter parser reads the tagging namespace AWS actually sends", () => {
    expect(watchedTenant({ TagKeyValue: [`user:${TENANT_TAG}$acme`] })).toBe("acme")
    expect(watchedTenant({ TagKeyValue: [`${TENANT_TAG}$acme`] })).toBe("acme")
    // A filter on some other tag is not a tenant filter.
    expect(watchedTenant({ TagKeyValue: ["user:tenure:module$relay"] })).toBeNull()
    expect(watchedTenant({ Service: ["Amazon Relational Database Service"] })).toBeNull()
    expect(watchedTenant(undefined)).toBeNull()
  })

  test("a denied tag index does not silently make every budget unattributed-looking", async () => {
    const { readings } = await read({ kind: "populated" }, { tagged: "denied" })
    // The budgets still read — attribution is a join, not a precondition — but
    // the tag read's own state is carried so a surface can say the attribution
    // column is unknown rather than empty.
    expect(readings.budgets.state).toBe("ACTUAL")
    expect(readings.tagged.state).toBe("DENIED")
    expect(isUnknown(readings.tagged)).toBe(true)
    expect(describeRead(readings.tagged, "tenant tag index")).toContain("tag:GetResources")
  })
})

/* ------------------------------------------------------- the alerting hole -- */

describe("whether a budget notifies anybody is UNKNOWN, and says which capability is missing", () => {
  test("no budget claims its thresholds are wired", async () => {
    const { readings } = await read({ kind: "populated" })
    for (const budget of budgetsOf(readings.budgets)) {
      expect(budget.alerting.state).toBe("UNCONFIGURED")
      expect(isUnknown(budget.alerting)).toBe(true)
      // Emphatically not EMPTY: "this budget has no thresholds" is a claim, and
      // it is the claim that makes a budget notifying nobody look fine.
      expect(budget.alerting.state).not.toBe("EMPTY")
      expect(budget.alerting.state).not.toBe("ACTUAL")
    }
  })

  test("the reason names the two capabilities that would answer it", async () => {
    const { readings } = await read({ kind: "populated" })
    const alerting = budgetsOf(readings.budgets)[0].alerting
    if (alerting.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(alerting.why).toContain("budgets:DescribeNotificationsForBudget")
    expect(alerting.why).toContain("budgets:DescribeSubscribersForNotification")
    // And that it is not an IAM problem, so nobody is sent to edit a policy that
    // is already correct.
    expect(alerting.why).toContain("budgets:ViewBudget")
  })

  test("neither capability is in the registry, which is why the field is unknown", () => {
    // The test that turns this from a comment into a tripwire: the day the two
    // capabilities land, this fails and the UNCONFIGURED arm above must be
    // replaced with a real read rather than left in place.
    const registry = Object.keys(CAPABILITIES)
    expect(registry).not.toContain("budgets:DescribeNotificationsForBudget")
    expect(registry).not.toContain("budgets:DescribeSubscribersForNotification")
  })

  test("the headline counts the budgets that cannot be shown to notify anybody", async () => {
    const { readings } = await read({ kind: "populated" })
    expect(describeBudgets(readings)).toContain("5 of them cannot be shown to notify anybody")
  })
})

/* ---------------------------------------------- identity is a precondition -- */

describe("without a resolved account the call is not made at all", () => {
  test("a denied identity makes budgets UNCONFIGURED, not EMPTY", async () => {
    const { readings } = await read({ kind: "populated" }, { identity: "denied" })

    expect(readings.identity.state).toBe("DENIED")
    expect(readings.budgets.state).toBe("UNCONFIGURED")
    if (readings.budgets.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(readings.budgets.why).toContain("account")
    // The identity denial is quoted, so the operator is sent to the read that
    // actually failed rather than to the Budgets policy.
    expect(readings.budgets.why).toContain("sts:GetCallerIdentity")
  })

  test("the budgets API is never called with an account nobody resolved", async () => {
    const { recorder } = await read({ kind: "populated" }, { identity: "denied" })
    expect(recorder.calls).not.toContain("budgets:DescribeBudgets")
  })
})

/* ------------------------------------------------- the four say four things -- */

test("all four outcomes produce different sentences", async () => {
  const sentences = await Promise.all(
    (["denied", "throttled", "empty", "populated"] as const).map(async (kind) => {
      const { readings } = await read({ kind })
      return describeBudgets(readings)
    }),
  )

  expect(new Set(sentences).size).toBe(4)
  // And each is recognisable as its own answer rather than merely distinct.
  const [denied, throttled, empty, populated] = sentences
  expect(denied).toContain("unknown")
  expect(throttled).toContain("throttled")
  expect(empty).toContain("none")
  expect(populated).toContain("5 budget(s)")
})
