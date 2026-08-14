import { fromDecimal, toMinorUnits } from "@tenure/finops"

import { budgetReadings, type BudgetReading } from "../../../lib/aws/budgets"
import type { Capability } from "../../../lib/aws/capabilities"
import type { AwsGateway } from "../../../lib/aws/read"
import { taggedResources } from "../../../lib/aws/tags"

import {
  attributionAnswer,
  budgetRows,
  formatAmount,
  minorUnits,
  notifyVerdict,
  runawayAnswer,
  thresholdRows,
  unknownArm,
} from "./cost-decisions"

/**
 * The FinOps Center's decisions, driven through the PRODUCERS the page calls.
 *
 * Every budget below comes out of the real `budgetReadings` and every tagged
 * resource out of the real `taggedResources`, both fed by a stand-in gateway
 * that answers the way `client.ts` answers — decimal `Amount` STRINGS, `Date`
 * timestamps, and errors carrying the `name` the SDK models. A test that
 * hand-built `BudgetReading` objects would stay green on the day the reader
 * stopped producing that shape, which is the failure this repository has
 * already paid for once.
 *
 * The four things asserted here are the four ways this page could lie while
 * every assertion on it stayed green:
 *
 *   1. A refused read rendering as "nothing is over budget".
 *   2. A budget with no AWS forecast counted as a budget that is on track.
 *   3. An all-clear that does not mention that no threshold can be shown to
 *      reach a human — the combination that renders as a clean page on every
 *      console that has ever shipped.
 *   4. Resources tagged `tenure:shared` folded together with resources carrying
 *      no tenant tag at all.
 */

/* ------------------------------------------------------------- the estate -- */

const ACCOUNT = "444455556666"
const PARTITION = "aws"
const REGION = "eu-west-2"
const PRINCIPAL = `arn:${PARTITION}:sts::${ACCOUNT}:assumed-role/tenure-studio-task/cost`
const IDENTITY_RESPONSE = { Account: ACCOUNT, Arn: PRINCIPAL, UserId: "AROAEXAMPLE:cost" }
const TENANT_TAG = "tenure:tenant"
const CLOCK = () => new Date("2026-08-13T09:30:00.000Z")

const budgetArn = (name: string) => `arn:${PARTITION}:budgets::${ACCOUNT}:budget/${name}`

/** An error shaped the way the SDK throws one: the modelled `name` is the signal. */
function awsError(name: string): Error {
  const error = new Error(`${name}: raised by the stand-in gateway`)
  error.name = name
  return error
}

/**
 * Four budgets, each in a different posture, and every posture is one the page
 * has to word differently.
 */
const MIXED_BUDGETS = {
  Budgets: [
    {
      // Spend has already passed the limit. Fact, not projection.
      BudgetName: "tenure-platform-monthly",
      BudgetType: "COST",
      TimeUnit: "MONTHLY",
      BudgetLimit: { Amount: "500.00", Unit: "USD" },
      CalculatedSpend: {
        ActualSpend: { Amount: "640.00", Unit: "USD" },
        ForecastedSpend: { Amount: "900.00", Unit: "USD" },
      },
      TimePeriod: { Start: new Date("2026-08-01T00:00:00Z"), End: new Date("2026-09-01T00:00:00Z") },
    },
    {
      // Inside the limit today, projected past it.
      BudgetName: "tenure-simon-ose-monthly",
      BudgetType: "COST",
      TimeUnit: "MONTHLY",
      BudgetLimit: { Amount: "1000.00", Unit: "USD" },
      CalculatedSpend: {
        ActualSpend: { Amount: "400.00", Unit: "USD" },
        ForecastedSpend: { Amount: "1500.00", Unit: "USD" },
      },
      CostFilters: { TagKeyValue: [`user:${TENANT_TAG}$simon-ose`] },
    },
    {
      // AWS computed no forecast at all. "On track" has no answer for this one.
      BudgetName: "tenure-relay-daily",
      BudgetType: "COST",
      TimeUnit: "DAILY",
      BudgetLimit: { Amount: "10.00", Unit: "USD" },
      CalculatedSpend: { ActualSpend: { Amount: "0.0000004", Unit: "USD" } },
    },
    {
      // Not money: the unit is GB. No limit in currency, so nothing to be over.
      BudgetName: "tenure-egress-gb",
      BudgetType: "USAGE",
      TimeUnit: "MONTHLY",
      BudgetLimit: { Amount: "500", Unit: "GB" },
      CalculatedSpend: { ActualSpend: { Amount: "120", Unit: "GB" } },
    },
  ],
}

/** Two budgets, both projected comfortably inside their limits. The all-clear. */
const CALM_BUDGETS = {
  Budgets: [
    {
      BudgetName: "tenure-platform-monthly",
      BudgetType: "COST",
      TimeUnit: "MONTHLY",
      BudgetLimit: { Amount: "1000.00", Unit: "USD" },
      CalculatedSpend: {
        ActualSpend: { Amount: "80.00", Unit: "USD" },
        ForecastedSpend: { Amount: "200.00", Unit: "USD" },
      },
    },
    {
      BudgetName: "tenure-simon-ose-monthly",
      BudgetType: "COST",
      TimeUnit: "MONTHLY",
      BudgetLimit: { Amount: "1000.00", Unit: "USD" },
      CalculatedSpend: {
        ActualSpend: { Amount: "90.00", Unit: "USD" },
        ForecastedSpend: { Amount: "300.00", Unit: "USD" },
      },
      CostFilters: { TagKeyValue: [`user:${TENANT_TAG}$simon-ose`] },
    },
  ],
}

/** No forecast on either, and nothing over. The "partly unknown" case. */
const UNFORECAST_BUDGETS = {
  Budgets: [
    {
      BudgetName: "tenure-relay-daily",
      BudgetType: "COST",
      TimeUnit: "DAILY",
      BudgetLimit: { Amount: "10.00", Unit: "USD" },
      CalculatedSpend: { ActualSpend: { Amount: "1.00", Unit: "USD" } },
    },
  ],
}

/**
 * The tag inventory: one tenant with two resources, one with one, one resource
 * deliberately tagged shared, and one carrying no tenant tag at all.
 */
const TAGGED_RESPONSE = {
  ResourceTagMappingList: [
    { ResourceARN: budgetArn("tenure-simon-ose-monthly"), Tags: [{ Key: TENANT_TAG, Value: "simon-ose" }] },
    {
      ResourceARN: `arn:${PARTITION}:rds:${REGION}:${ACCOUNT}:db:simon-ose-1`,
      Tags: [{ Key: TENANT_TAG, Value: "simon-ose" }],
    },
    {
      ResourceARN: `arn:${PARTITION}:rds:${REGION}:${ACCOUNT}:db:north-hills-1`,
      Tags: [{ Key: TENANT_TAG, Value: "north-hills" }],
    },
    {
      ResourceARN: budgetArn("tenure-platform-monthly"),
      Tags: [{ Key: TENANT_TAG, Value: "tenure:shared" }],
    },
    {
      // No tenure:tenant key at all. This is the gap, and it is not "shared".
      ResourceARN: `arn:${PARTITION}:ec2:${REGION}:${ACCOUNT}:natgateway/nat-0abc`,
      Tags: [{ Key: "Name", Value: "nat-a" }],
    },
  ],
}

/* --------------------------------------------------------- the fake gateway -- */

type Answer = "populated" | "calm" | "unforecast" | "empty" | "denied" | "throttled"

function fakeAws(budgets: Answer, tagged: "ok" | "denied" | "empty" = "ok"): AwsGateway {
  return {
    async call(capability: Capability, input?: Record<string, unknown>) {
      switch (capability) {
        case "sts:GetCallerIdentity":
          return IDENTITY_RESPONSE
        case "tag:GetResources":
          if (tagged === "denied") throw awsError("AccessDeniedException")
          if (tagged === "empty") return { ResourceTagMappingList: [] }
          return TAGGED_RESPONSE
        case "budgets:DescribeBudgets": {
          // The real API refuses a request with no account, and a reader that
          // let `undefined` through would get an empty list back rather than an
          // error. Reproduced so that path cannot pass silently.
          if (typeof input?.AccountId !== "string" || !/^\d{12}$/.test(input.AccountId)) {
            throw awsError("ValidationException")
          }
          if (budgets === "denied") throw awsError("AccessDeniedException")
          if (budgets === "throttled") throw awsError("ThrottlingException")
          if (budgets === "empty") return { Budgets: [] }
          if (budgets === "calm") return CALM_BUDGETS
          if (budgets === "unforecast") return UNFORECAST_BUDGETS
          return MIXED_BUDGETS
        }
        default:
          throw new Error(`the stand-in gateway was asked for ${capability}, which it does not model`)
      }
    },
    async resolvedRegion() {
      return REGION
    },
  }
}

const readBudgets = (answer: Answer) =>
  budgetReadings(fakeAws(answer), { now: CLOCK, sleep: async () => {} })

const readTags = (tagged: "ok" | "denied" | "empty") =>
  taggedResources(fakeAws("populated", tagged), { now: CLOCK })

/* --------------------------------------------------------------- the money -- */

describe("money is integer minor units with an explicit currency", () => {
  it("renders each currency at its own precision, and says what the integer is", () => {
    const usd = fromDecimal("1234.56", "USD")
    expect(formatAmount(usd)).toBe("$1234.56")
    expect(minorUnits(usd)).toBe(`${toMinorUnits(usd, "down")} minor units of USD`)

    // A currency with no minor unit. A hardcoded two-decimal formatter renders
    // this a hundredfold high, which is the defect `toDecimal` was fixed for.
    const jpy = fromDecimal("1200", "JPY")
    expect(formatAmount(jpy)).toBe("1200 JPY")
    expect(minorUnits(jpy)).toBe("1200 minor units of JPY")
  })
})

/* ---------------------------------------------------- the approval thresholds -- */

describe("the approval thresholds are read from the policy, not transcribed", () => {
  it("chains: each band begins exactly where the previous one ended", () => {
    const rows = thresholdRows()
    expect(rows).toHaveLength(4)

    const amountsIn = (band: string) => band.match(/\$[\d.,]+/g) ?? []
    const [first, second, third, fourth] = rows.map((row) => amountsIn(row.band))

    expect(first).toHaveLength(1)
    expect(second[0]).toBe(first[0])
    expect(third[0]).toBe(second[1])
    expect(fourth[0]).toBe(third[1])
    expect(fourth).toHaveLength(1)

    /**
     * A band with no amount in it is a broken table, not a zero. Assert the
     * cell was there before parsing it, so the failure names the missing amount
     * rather than arriving later as a NaN comparison nobody can read — and so
     * the parameter can admit `undefined`, which is what indexing a
     * `string[]` yields under this tsconfig.
     */
    const value = (amount: string | undefined) => {
      if (amount === undefined) throw new Error("a threshold band named no dollar amount")
      return parseFloat(amount.replace(/[$,]/g, ""))
    }
    expect(value(third[0])).toBeGreaterThan(value(second[0]))
    expect(value(fourth[0])).toBeGreaterThan(value(third[0]))
  })

  it("puts each verdict on its own band, ascending", () => {
    expect(thresholdRows().map((row) => row.approval)).toEqual([
      "none",
      "one reviewer",
      "two people",
      "executive",
    ])
  })
})

/* ------------------------------------------------- is anything running away -- */

describe("a read this engine could not perform never renders as good news", () => {
  it("says UNKNOWN, not 'nothing is over budget', when budgets are refused", async () => {
    const readings = await readBudgets("denied")
    const answer = runawayAnswer(readings.budgets)

    expect(answer.known).toBe(false)
    expect(answer.counts).toBeNull()
    expect(answer.badge).toBe("unknown")
    expect(answer.headline).toMatch(/UNKNOWN/)
    // The remedy travels with the refusal: the principal, the IAM action as IAM
    // spells it (`budgets:ViewBudget`, not the capability's own name), and the
    // minimum statement an operator pastes into a policy.
    expect(answer.headline).toContain("budgets:ViewBudget")
    expect(answer.headline).toContain(PRINCIPAL)
    expect(answer.headline).toContain("Minimum statement")
    // And it is explicit that this is not an absence.
    expect(answer.headline).toMatch(/not\s+an account with no budgets/)
  })

  it("hands the refusal to UnknownState as an arm carrying no value", async () => {
    const readings = await readBudgets("denied")
    const arm = unknownArm(readings.budgets)
    expect(arm?.state).toBe("DENIED")

    // And a successful read is NOT an unknown arm, so a good read cannot be
    // rendered as a denial.
    expect(unknownArm((await readBudgets("populated")).budgets)).toBeNull()
  })

  it("distinguishes a throttle from a denial, because the remedies differ", async () => {
    const readings = await readBudgets("throttled")
    expect(unknownArm(readings.budgets)?.state).toBe("THROTTLED")
    expect(runawayAnswer(readings.budgets).known).toBe(false)
  })

  it("says an account with no budgets is watched by nothing, not that it is fine", async () => {
    const answer = runawayAnswer((await readBudgets("empty")).budgets)
    expect(answer.badge).toBe("no budgets")
    expect(answer.tone).toBe("warn")
    expect(answer.headline).toMatch(/Nothing is watching/)
    expect(answer.headline).toMatch(/not the same as spend being under control/)
  })
})

describe("a budget with no forecast is not a budget that is on track", () => {
  it("counts postures apart and leads with the worst one", async () => {
    const answer = runawayAnswer((await readBudgets("populated")).budgets)

    expect(answer.counts).toEqual({
      total: 4,
      over: 1,
      atRisk: 1,
      noForecast: 1,
      noLimit: 1,
      within: 0,
    })
    expect(answer.badge).toBe("over limit")
    expect(answer.tone).toBe("bad")
    expect(answer.headline).toMatch(/^1 budget\(s\) are already past their limit/)
  })

  it("refuses to call an unforecast budget 'within limits'", async () => {
    const answer = runawayAnswer((await readBudgets("unforecast")).budgets)

    expect(answer.counts?.noForecast).toBe(1)
    expect(answer.counts?.within).toBe(0)
    expect(answer.badge).toBe("partly unknown")
    expect(answer.tone).toBe("warn")
    expect(answer.headline).toMatch(/no answer rather than a good one/)
  })
})

describe("a budget nobody is subscribed to is not a budget that is fine", () => {
  it("keeps the caveat on an otherwise all-clear page", async () => {
    const answer = runawayAnswer((await readBudgets("calm")).budgets)

    // The good news is real: both budgets are projected inside their limits.
    expect(answer.counts).toEqual({
      total: 2,
      over: 0,
      atRisk: 0,
      noForecast: 0,
      noLimit: 0,
      within: 2,
    })

    // And it does not stand alone. This engine cannot read subscriber lists, so
    // neither budget can be shown to reach a human, and the all-clear says so.
    expect(answer.unreachable).toBe(2)
    expect(answer.caveat).toMatch(/cannot be shown to notify anybody/)
    expect(answer.caveat).toMatch(/breaches in\s+silence/)
    expect(answer.badge).toBe("within limits, unwatched")
    expect(answer.tone).not.toBe("ok")
  })

  it("names the capability that would answer it, per budget", async () => {
    const readings = await readBudgets("calm")
    const rows = budgetRows(
      readings.budgets.state === "ACTUAL" ? readings.budgets.value : [],
    )
    expect(rows).toHaveLength(2)

    for (const row of rows) {
      expect(row.notifies.verdict).toBe("UNKNOWN")
      expect(row.notifies.word).toBe("unknown")
      expect(row.notifies.detail).toContain("budgets:DescribeSubscribersForNotification")
      // Never the word that would let a reader move on.
      expect(row.notifies.word).not.toMatch(/^(ok|configured|yes)$/i)
    }
  })

  it("tells a threshold with no subscriber apart from one that was never read", async () => {
    const readings = await readBudgets("calm")
    const [real] = readings.budgets.state === "ACTUAL" ? readings.budgets.value : []

    /*
     * The `alerting` field is the ONE part of a reading this test substitutes,
     * and it substitutes it because `budgets.ts` cannot produce an ACTUAL arm
     * today — the two capabilities are not in the registry, so every real
     * reading is UNCONFIGURED. These are the arms the page will render on the
     * day they land, and they are the whole reason the field is a read rather
     * than a `BudgetAlert[]` defaulted to `[]`. Everything else about the
     * budget is still the production projection.
     */
    const withAlerts = (subscribers: number): BudgetReading => ({
      ...real,
      alerting: {
        state: "ACTUAL",
        capability: "budgets:DescribeBudgets",
        asOf: CLOCK().toISOString(),
        fresh: true,
        value: [
          {
            notificationType: "ACTUAL",
            comparisonOperator: "GREATER_THAN",
            threshold: 80,
            thresholdType: "PERCENTAGE",
            state: "OK",
            subscribers: Array.from({ length: subscribers }, (_unused, index) => ({
              via: "EMAIL" as const,
              address: `finops+${index}@tenure.example`,
            })),
          },
        ],
      },
    })

    expect(notifyVerdict(withAlerts(0)).verdict).toBe("SILENT")
    expect(notifyVerdict(withAlerts(0)).word).toMatch(/notify nobody/)
    expect(notifyVerdict(withAlerts(1)).verdict).toBe("NOTIFIES")
    expect(notifyVerdict(withAlerts(1)).word).toMatch(/1 subscriber/)

    // Three different verdicts for three different truths — and the one the
    // engine actually has today is neither of the other two.
    expect(notifyVerdict(real).verdict).toBe("UNKNOWN")
  })
})

describe("the budget table never renders a missing figure as a zero", () => {
  it("says 'not set' for a budget AWS gave no forecast for", async () => {
    const readings = await readBudgets("populated")
    const rows = budgetRows(readings.budgets.state === "ACTUAL" ? readings.budgets.value : [])
    const relay = rows.find((row) => row.name === "tenure-relay-daily")

    expect(relay?.forecast.present).toBe(false)
    expect(relay?.forecast.text).toBe("not set")
    expect(relay?.forecast.text).not.toMatch(/0/)
    expect(relay?.forecast.title).toMatch(/is not zero/)
    expect(relay?.posture).toBe("no forecast")
  })

  it("carries a non-currency budget's real unit rather than dropping it", async () => {
    const readings = await readBudgets("populated")
    const rows = budgetRows(readings.budgets.state === "ACTUAL" ? readings.budgets.value : [])
    const egress = rows.find((row) => row.name === "tenure-egress-gb")

    expect(egress?.limit.text).toBe("500 GB")
    expect(egress?.limit.text).not.toMatch(/\$/)
    expect(egress?.posture).toBe("no limit set")
  })

  it("puts the integer minor units beside every money figure", async () => {
    const readings = await readBudgets("populated")
    const rows = budgetRows(readings.budgets.state === "ACTUAL" ? readings.budgets.value : [])
    const platform = rows.find((row) => row.name === "tenure-platform-monthly")

    expect(platform?.limit.text).toBe("$500.00")
    expect(platform?.limit.title).toBe("50000 minor units of USD")
  })

  it("keeps who OWNS a budget apart from whose spend it WATCHES", async () => {
    const readings = await readBudgets("populated")
    const rows = budgetRows(readings.budgets.state === "ACTUAL" ? readings.budgets.value : [])

    const platform = rows.find((row) => row.name === "tenure-platform-monthly")
    // Tagged tenure:shared, and filtered to nothing: it watches the account.
    expect(platform?.owner).toEqual({ kind: "shared" })
    expect(platform?.watches).toBe("the whole account")

    const tenant = rows.find((row) => row.name === "tenure-simon-ose-monthly")
    expect(tenant?.owner).toEqual({ kind: "tenant", tenantSlug: "simon-ose" })
    expect(tenant?.watches).toBe("simon-ose")
  })
})

/* ---------------------------------------------------- who it is costing for -- */

describe("shared and unattributable are two answers, and stay two answers", () => {
  it("counts tenants, shared and untagged separately", async () => {
    const answer = attributionAnswer(await readTags("ok"))

    expect(answer.known).toBe(true)
    expect(answer.total).toBe(5)
    expect(answer.tenants).toEqual([
      { slug: "simon-ose", resources: 2 },
      { slug: "north-hills", resources: 1 },
    ])
    expect(answer.attributed).toBe(3)
    // One tagged tenure:shared — a decision. One with no tenant key — a gap.
    expect(answer.shared).toBe(1)
    expect(answer.unattributed).toBe(1)
    expect(answer.shared + answer.unattributed).toBe(2)
  })

  it("says the untagged group is not the shared group", async () => {
    const answer = attributionAnswer(await readTags("ok"))
    expect(answer.headline).toMatch(/not shared/)
    expect(answer.headline).toMatch(/reported rather than spread/)
    expect(answer.badge).toBe("1 unattributable")
    expect(answer.tone).toBe("warn")
  })

  it("orders tenants by size then name, so the page is deterministic", async () => {
    const first = attributionAnswer(await readTags("ok")).tenants
    const second = attributionAnswer(await readTags("ok")).tenants
    expect(first).toEqual(second)
    expect(first[0].resources).toBeGreaterThanOrEqual(first[1].resources)
  })

  it("renders a refused tag read as UNKNOWN rather than as an unattributed estate", async () => {
    const read = await readTags("denied")
    const answer = attributionAnswer(read)

    expect(answer.known).toBe(false)
    expect(answer.total).toBe(0)
    expect(answer.unattributed).toBe(0)
    expect(answer.headline).toMatch(/UNKNOWN/)
    expect(answer.headline).toMatch(/not a report that nothing is tagged/)
    expect(unknownArm(read)?.state).toBe("DENIED")
  })

  it("says an empty tag inventory means no bill could ever be attributed", async () => {
    const answer = attributionAnswer(await readTags("empty"))
    expect(answer.known).toBe(true)
    expect(answer.badge).toBe("nothing tagged")
    expect(answer.headline).toMatch(/no resources at all/)
  })
})
