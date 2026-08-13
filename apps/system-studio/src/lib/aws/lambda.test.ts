import { SHARED } from "@tenure/provisioning"

import type { Capability } from "./capabilities"
import {
  APPROACHING_HORIZON_DAYS,
  CONCURRENCY_READ_BUDGET,
  attributionLine,
  calendarStaleness,
  describeFunctionAttribution,
  describeReservedConcurrency,
  describeRuntimeSupport,
  lambdaFunctionsLine,
  lambdaHeadline,
  lambdaInventory,
  lambdaLines,
  normaliseLastModified,
  residencyAnomalies,
  runtimeRiskLine,
  runtimeRisks,
  runtimeSupportFor,
} from "./lambda"
import type { AwsGateway } from "./read"
import { READ_ATTEMPTS, backoffMs } from "./throttle"

/**
 * STUDIO-080-001 / STUDIO-000-007 — the Lambda surface is provably different in
 * all four ways a read can turn out, and never says "none" when it means
 * "refused".
 *
 * Three rules this file is written under, each of them a lesson from a suite
 * that stayed green through a real defect:
 *
 *   1. **It drives `lambdaInventory`**, the function a route calls, with a
 *      stand-in substituted at the documented `AwsGateway` seam. A test that
 *      called `readAws` or `runtimeSupportFor` for the denial cases would stay
 *      green the day the reader stopped calling them.
 *   2. **The stand-in behaves like the real client.** It throws errors whose
 *      `name` is the modelled AWS shape, returns Lambda's own field names
 *      (`Functions`, `NextMarker`, `ReservedConcurrentExecutions`), paginates
 *      by `Marker`, answers per capability, and counts its calls. A stand-in
 *      that returned `[]` regardless of what was asked would prove nothing —
 *      which is the exact fake this programme has already been burned by.
 *   3. **Different states must render DIFFERENT text**, asserted as distinct
 *      strings and by the words that make them distinct, because the defect
 *      being prevented is two states that read identically.
 *
 * The runtime dates are the real ones from AWS's published runtime support page.
 * That is why some cases rewind the clock: `nodejs18.x` was end-of-lifed on
 * 2025-09-01, so the only honest way to exercise "approaching" against real data
 * is to ask what this engine would have said in June 2025. Inventing a runtime
 * with a made-up date would test the arithmetic and nothing else.
 */

/* ------------------------------------------------------------- stand-in -- */

/** An error shaped the way the AWS SDK shapes one: the `name` carries the code. */
function awsError(name: string): Error {
  const error = new Error(`${name}: simulated by the stand-in gateway`)
  error.name = name
  return error
}

type Answer = (input: Record<string, unknown>) => unknown

interface StandIn extends AwsGateway {
  calls: Map<Capability, number>
}

function standIn(answers: Partial<Record<Capability, Answer>>, region = "eu-west-2"): StandIn {
  const calls = new Map<Capability, number>()
  return {
    calls,
    async call(capability, input = {}) {
      calls.set(capability, (calls.get(capability) ?? 0) + 1)
      const answer = answers[capability]
      // Anything not named answers empty-but-successful, so a case about Lambda
      // does not accidentally become a case about an unhandled tag throw.
      if (!answer) return {}
      return answer(input)
    },
    async resolvedRegion() {
      return region
    },
  }
}

const ACCOUNT = "123456789012"
const REGION = "eu-west-2"

const IDENTITY = () => ({
  Account: ACCOUNT,
  Arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-ecs-task/abc`,
  UserId: "AROAEXAMPLE:abc",
})

const arnFor = (name: string, region = REGION, partition = "aws", account = ACCOUNT) =>
  `arn:${partition}:lambda:${region}:${account}:function:${name}`

/**
 * Six functions, one per runtime verdict, in the shape `ListFunctions` returns.
 *
 * `LastModified` carries Lambda's own `+0000` offset rather than a clean `Z`,
 * because that is what the API sends and normalising it is one of the things
 * under test.
 */
const FUNCTIONS = [
  {
    FunctionArn: arnFor("tenure-reminders"),
    FunctionName: "tenure-reminders",
    Runtime: "nodejs16.x",
    PackageType: "Zip",
    MemorySize: 512,
    Timeout: 30,
    CodeSize: 4_194_304,
    Architectures: ["x86_64"],
    LastModified: "2025-11-02T09:15:00.000+0000",
  },
  {
    FunctionArn: arnFor("tenure-webhook"),
    FunctionName: "tenure-webhook",
    Runtime: "nodejs18.x",
    PackageType: "Zip",
    MemorySize: 256,
    Timeout: 10,
    CodeSize: 1_048_576,
    Architectures: ["arm64"],
    LastModified: "2026-01-14T11:00:00.000+0000",
  },
  {
    FunctionArn: arnFor("tenure-digest"),
    FunctionName: "tenure-digest",
    Runtime: "python3.9",
    PackageType: "Zip",
    MemorySize: 1024,
    Timeout: 300,
    CodeSize: 8_388_608,
    Architectures: ["x86_64"],
    LastModified: "2025-03-01T08:00:00.000+0000",
  },
  {
    FunctionArn: arnFor("tenure-router"),
    FunctionName: "tenure-router",
    Runtime: "nodejs20.x",
    PackageType: "Zip",
    MemorySize: 128,
    Timeout: 3,
    CodeSize: 262_144,
    Architectures: ["arm64"],
    LastModified: "2026-04-02T16:30:00.000+0000",
  },
  {
    FunctionArn: arnFor("tenure-legacy-bridge"),
    FunctionName: "tenure-legacy-bridge",
    Runtime: "cobol1.x",
    PackageType: "Zip",
    MemorySize: 128,
    Timeout: 60,
    CodeSize: 131_072,
    Architectures: ["x86_64"],
    LastModified: "2024-09-09T09:09:00.000+0000",
  },
  {
    FunctionArn: arnFor("tenure-imaging"),
    FunctionName: "tenure-imaging",
    // A container-image function: no `Runtime` at all, which is exactly how
    // Lambda answers and exactly where a `runtime ?? "unknown"` would lie.
    PackageType: "Image",
    MemorySize: 2048,
    Timeout: 900,
    CodeSize: 0,
    Architectures: ["x86_64"],
    LastModified: "2026-02-20T13:45:00.000+0000",
  },
]

const populated = (): Partial<Record<Capability, Answer>> => ({
  "sts:GetCallerIdentity": IDENTITY,
  "lambda:ListFunctions": () => ({ Functions: FUNCTIONS }),
})

/** The tagging API's answer: one attributed, one deliberately shared, rest untagged. */
const TAGGED = () => ({
  ResourceTagMappingList: [
    {
      ResourceARN: arnFor("tenure-reminders"),
      Tags: [
        { Key: "tenure:tenant", Value: "simon-ose" },
        { Key: "tenure:cell", Value: "cell-eu-west-2-a" },
        { Key: "tenure:environment", Value: "production" },
      ],
    },
    {
      ResourceARN: arnFor("tenure-router"),
      Tags: [{ Key: "tenure:tenant", Value: SHARED }],
    },
  ],
})

/** 2026-07-01: 61 days past the calendar stamp, inside the window it may be trusted. */
const NOW_FRESH = () => new Date("2026-07-01T00:00:00.000Z")
/** 2026-08-13: 104 days past it, so no "supported" claim survives. */
const NOW_STALE = () => new Date("2026-08-13T00:00:00.000Z")
/** June 2025, when nodejs18.x was 78 days from its real end-of-life. */
const NOW_2025 = () => new Date("2025-06-15T00:00:00.000Z")

const noSleep = async () => {}

/* ====================================================== 1. the four cases == */

describe("a denied Lambda read is never an empty function list", () => {
  const functionsLine = async (answers: Partial<Record<Capability, Answer>>) => {
    const readings = await lambdaInventory(standIn({ "sts:GetCallerIdentity": IDENTITY, ...answers }), {
      now: NOW_STALE,
      sleep: noSleep,
    })
    return lambdaFunctionsLine(readings.functions)
  }

  it("AccessDenied, a throttle, empty-but-successful and populated render four different strings", async () => {
    const denied = await functionsLine({
      "lambda:ListFunctions": () => {
        throw awsError("AccessDeniedException")
      },
    })
    const throttled = await functionsLine({
      "lambda:ListFunctions": () => {
        throw awsError("ThrottlingException")
      },
    })
    const empty = await functionsLine({ "lambda:ListFunctions": () => ({ Functions: [] }) })
    const full = await functionsLine(populated())

    expect(new Set([denied, throttled, empty, full]).size).toBe(4)

    // And the specific words, because four timestamps would also be four strings.
    expect(denied).toContain("unknown")
    expect(denied).toContain("lambda:ListFunctions")
    expect(denied).toContain("AccessDeniedException")
    expect(denied).toContain('"Effect":"Allow"')
    expect(denied).not.toContain("none")
    expect(denied).not.toMatch(/\bfunction\(s\)/)

    expect(empty).toContain("none")
    expect(empty).not.toContain("unknown")
    expect(empty).not.toContain("Effect")

    expect(throttled).toContain("throttled")
    expect(throttled).not.toContain("none")
    expect(throttled).not.toContain("Effect")

    expect(full).toContain("as of")
    expect(full).toContain("6 function(s)")
  })

  it("carries the principal, the action and a pasteable statement on the denial itself", async () => {
    const readings = await lambdaInventory(
      standIn({
        "sts:GetCallerIdentity": IDENTITY,
        "lambda:ListFunctions": () => {
          throw awsError("AccessDeniedException")
        },
      }),
      { now: NOW_STALE, sleep: noSleep },
    )

    expect(readings.functions.state).toBe("DENIED")
    if (readings.functions.state !== "DENIED") throw new Error("unreachable")
    expect(readings.functions.action).toBe("lambda:ListFunctions")
    // The principal is the one identity resolved, not a placeholder.
    expect(readings.functions.principal).toContain("assumed-role/tenure-studio-ecs-task")
    expect(readings.functions.accountId).toBe(ACCOUNT)
    expect(readings.functions.region).toBe(REGION)
    expect(readings.functions.partition).toBe("aws")
    expect(JSON.parse(readings.functions.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["lambda:ListFunctions"],
      Resource: "*",
    })
  })

  it("says nothing about runtime risk when the function list itself is unknown", async () => {
    const riskLine = async (answers: Partial<Record<Capability, Answer>>) => {
      const readings = await lambdaInventory(
        standIn({ "sts:GetCallerIdentity": IDENTITY, ...answers }),
        { now: NOW_STALE, sleep: noSleep },
      )
      return runtimeRiskLine(readings.functions, readings.calendar)
    }

    const denied = await riskLine({
      "lambda:ListFunctions": () => {
        throw awsError("AccessDeniedException")
      },
    })
    const throttled = await riskLine({
      "lambda:ListFunctions": () => {
        throw awsError("ThrottlingException")
      },
    })
    const empty = await riskLine({ "lambda:ListFunctions": () => ({ Functions: [] }) })
    const full = await riskLine(populated())

    expect(new Set([denied, throttled, empty, full]).size).toBe(4)

    // The assertion this whole surface exists for: a refusal must not produce a
    // count, because "0 functions on a dead runtime" is a clean bill of health
    // issued by a call that never happened.
    expect(denied).toContain("unknown")
    expect(denied).not.toMatch(/\d+ function\(s\) on a runtime/)
    expect(throttled).toContain("unknown")
    expect(throttled).toContain("throttled")
    expect(throttled).not.toMatch(/\d+ function\(s\) on a runtime/)

    expect(empty).toContain("no functions to check")
    expect(empty).not.toContain("unknown")

    expect(full).toMatch(/function\(s\) on a runtime AWS has already end-of-lifed/)
  })

  it("treats an account with no functions as an answer, not a refusal, on every line", async () => {
    const readings = await lambdaInventory(
      standIn({
        "sts:GetCallerIdentity": IDENTITY,
        "lambda:ListFunctions": () => ({ Functions: [] }),
      }),
      { now: NOW_STALE, sleep: noSleep },
    )

    expect(readings.functions.state).toBe("EMPTY")
    const texts = lambdaLines(readings).map((l) => l.text)
    expect(texts[0]).toContain("none")
    expect(texts[1]).toContain("no functions to check")
    expect(texts[2]).toBe("no functions to attribute")
    // EMPTY is the one non-ACTUAL state a completed call produced, so it is the
    // one allowed to reassure. None of these lines may hedge.
    for (const text of texts) expect(text).not.toContain("unknown")
  })

  it("keeps attribution unknown when the tag index was refused, rather than reporting every function untagged", async () => {
    const gw = standIn({
      "sts:GetCallerIdentity": IDENTITY,
      "tag:GetResources": () => {
        throw awsError("AccessDeniedException")
      },
      ...populated(),
    })
    const readings = await lambdaInventory(gw, { now: NOW_STALE, sleep: noSleep })

    expect(readings.tagged.state).toBe("DENIED")
    expect(readings.functions.state).toBe("ACTUAL")
    if (readings.functions.state !== "ACTUAL") throw new Error("unreachable")

    for (const fn of readings.functions.value) {
      expect(fn.attribution.known).toBe(false)
      expect(describeFunctionAttribution(fn.attribution)).toContain("unknown")
      // Emphatically NOT the specific, actionable, false finding.
      expect(describeFunctionAttribution(fn.attribution)).not.toContain("unattributable")
      expect(fn.contract.tenantId).toBeNull()
    }

    const line = attributionLine(readings)
    expect(line).toContain("unknown for 6 of 6")
    expect(line).toContain("tag:GetResources")
    expect(line).not.toMatch(/\d+ unattributable/)
  })

  it("attributes from tags when the tag index WAS read, and separates shared from untagged", async () => {
    const readings = await lambdaInventory(
      standIn({ ...populated(), "tag:GetResources": TAGGED }),
      { now: NOW_STALE, sleep: noSleep },
    )
    if (readings.functions.state !== "ACTUAL") throw new Error("expected ACTUAL")

    // Captured, not re-read inside the closure. The guard above narrows
    // `readings.functions` to the ACTUAL arm, but TypeScript discards that
    // narrowing across a function boundary — `readings` is mutable as far as it
    // knows, so inside `by` the property is the full `AwsRead` union again and
    // `.value` does not exist on it. That is STUDIO-000-007's type doing its
    // job: no arm carries an optional value, so a caller cannot reach for one
    // without having proved the read succeeded.
    const functions = readings.functions.value
    const by = (name: string) => functions.find((f) => f.name === name)!

    expect(describeFunctionAttribution(by("tenure-reminders").attribution)).toBe("simon-ose")
    expect(by("tenure-reminders").contract.tenantId).toBe("simon-ose")
    expect(by("tenure-reminders").contract.cell).toBe("cell-eu-west-2-a")
    expect(describeFunctionAttribution(by("tenure-router").attribution)).toContain("shared")
    expect(by("tenure-router").contract.tenantId).toBeNull()
    expect(describeFunctionAttribution(by("tenure-digest").attribution)).toBe(
      "unattributable — missing tenure:tenant",
    )

    expect(attributionLine(readings)).toBe(
      "1 attributed to a tenant, 1 shared by decision, 4 unattributable",
    )
  })

  it("actually reaches the stand-in — a surface that made no call proves nothing", async () => {
    const gw = standIn({ ...populated(), "tag:GetResources": TAGGED })
    await lambdaInventory(gw, { now: NOW_STALE, sleep: noSleep })

    expect(gw.calls.get("sts:GetCallerIdentity")).toBe(1)
    expect(gw.calls.get("tag:GetResources")).toBe(1)
    expect(gw.calls.get("lambda:ListFunctions")).toBe(1)
    expect(gw.calls.get("lambda:GetFunctionConcurrency")).toBe(FUNCTIONS.length)
  })
})

/* ================================================== 2. the runtime calendar */

describe("a runtime AWS has end-of-lifed is reported as one, and nothing is assumed current", () => {
  const verdicts = async (now: () => Date) => {
    const readings = await lambdaInventory(standIn(populated()), { now, sleep: noSleep })
    if (readings.functions.state !== "ACTUAL") throw new Error("expected ACTUAL")
    return new Map(readings.functions.value.map((f) => [f.name, f.runtimeSupport]))
  }

  it("reads six different verdicts off real published dates", async () => {
    // June 2025: the only honest clock at which "approaching" exists against
    // real data, because every date AWS had published by the calendar's stamp
    // has since passed.
    const at2025 = await verdicts(NOW_2025)

    expect(at2025.get("tenure-reminders")).toMatchObject({
      status: "DEPRECATED",
      runtime: "nodejs16.x",
      deprecationDate: "2024-06-12",
    })
    expect(at2025.get("tenure-webhook")).toMatchObject({
      status: "APPROACHING",
      runtime: "nodejs18.x",
      deprecationDate: "2025-09-01",
      daysRemaining: 78,
    })
    expect(at2025.get("tenure-digest")).toMatchObject({
      status: "SUPPORTED",
      runtime: "python3.9",
      deprecationDate: "2025-12-15",
    })
    expect(at2025.get("tenure-router")).toMatchObject({
      status: "SUPPORTED",
      runtime: "nodejs20.x",
      deprecationDate: null,
    })
    expect(at2025.get("tenure-legacy-bridge")).toMatchObject({ status: "UNKNOWN_RUNTIME" })
    expect(at2025.get("tenure-imaging")).toMatchObject({ status: "NOT_A_MANAGED_RUNTIME" })

    // Six verdicts, six sentences. A reader must not be able to mistake one for
    // another, and neither must a test.
    const sentences = [...at2025.values()].map(describeRuntimeSupport)
    expect(new Set(sentences).size).toBe(6)
    expect(sentences.filter((s) => s.includes("end-of-lifed by AWS on 2024-06-12"))).toHaveLength(1)
    expect(sentences.filter((s) => s.includes("unchecked"))).toHaveLength(1)
    expect(sentences.filter((s) => s.startsWith("not applicable"))).toHaveLength(1)
  })

  it("withdraws every 'supported' claim once the transcription is too old, and keeps every 'deprecated' one", async () => {
    const fresh = await verdicts(NOW_FRESH)
    const stale = await verdicts(NOW_STALE)

    expect(calendarStaleness(NOW_FRESH()).stale).toBe(false)
    expect(calendarStaleness(NOW_STALE()).stale).toBe(true)

    // 61 days old: "supported" still means something.
    expect(fresh.get("tenure-router")).toMatchObject({ status: "SUPPORTED" })
    // 104 days old: it does not. The panel does not go blank — it stops
    // reassuring, and says why.
    expect(stale.get("tenure-router")).toMatchObject({
      status: "UNKNOWN_STALE_CALENDAR",
      ageDays: 104,
    })
    expect(describeRuntimeSupport(stale.get("tenure-router")!)).toContain("104 days old")

    // A date in the past does not move, so the warning survives staleness. Over-
    // warning costs a lookup; under-warning is the outage this file is about.
    for (const clock of [fresh, stale]) {
      expect(clock.get("tenure-reminders")).toMatchObject({ status: "DEPRECATED" })
      expect(clock.get("tenure-digest")).toMatchObject({ status: "DEPRECATED" })
    }
    // And an unheard-of runtime is never quietly promoted to supported.
    expect(fresh.get("tenure-legacy-bridge")).toMatchObject({ status: "UNKNOWN_RUNTIME" })
    expect(stale.get("tenure-legacy-bridge")).toMatchObject({ status: "UNKNOWN_RUNTIME" })
  })

  it("puts the horizon exactly where it says it does", () => {
    // python3.9's real date is 2025-12-15. 180 days before it is 2025-06-18.
    const inside = runtimeSupportFor("python3.9", "Zip", new Date("2025-06-18T00:00:00.000Z"))
    const outside = runtimeSupportFor("python3.9", "Zip", new Date("2025-06-17T00:00:00.000Z"))
    expect(inside).toMatchObject({ status: "APPROACHING", daysRemaining: APPROACHING_HORIZON_DAYS })
    expect(outside).toMatchObject({ status: "SUPPORTED" })

    // The day itself, and the day after.
    expect(runtimeSupportFor("python3.9", "Zip", new Date("2025-12-15T00:00:00.000Z"))).toMatchObject(
      { status: "APPROACHING", daysRemaining: 0 },
    )
    expect(runtimeSupportFor("python3.9", "Zip", new Date("2025-12-16T00:00:00.000Z"))).toMatchObject(
      { status: "DEPRECATED", daysSince: 1 },
    )
  })

  it("orders the risks worst-first and reports none of them off an unknown read", async () => {
    const readings = await lambdaInventory(standIn(populated()), { now: NOW_2025, sleep: noSleep })
    expect(runtimeRisks(readings.functions).map((f) => f.name)).toEqual([
      "tenure-reminders",
      "tenure-webhook",
    ])

    const denied = await lambdaInventory(
      standIn({
        "sts:GetCallerIdentity": IDENTITY,
        "lambda:ListFunctions": () => {
          throw awsError("AccessDeniedException")
        },
      }),
      { now: NOW_2025, sleep: noSleep },
    )
    // Empty, and the surface says UNKNOWN beside it — the list is not the claim.
    expect(runtimeRisks(denied.functions)).toEqual([])
    expect(runtimeRiskLine(denied.functions, denied.calendar)).toContain("unknown")
  })
})

/* ============================================== 3. reserved concurrency == */

describe("reserved concurrency distinguishes no reservation from no permission", () => {
  const oneFunction = (name: string) => ({
    "sts:GetCallerIdentity": IDENTITY,
    "lambda:ListFunctions": () => ({
      Functions: [
        {
          FunctionArn: arnFor(name),
          FunctionName: name,
          Runtime: "nodejs20.x",
          PackageType: "Zip",
          MemorySize: 128,
          Timeout: 5,
          LastModified: "2026-04-02T16:30:00.000+0000",
        },
      ],
    }),
  })

  const sentence = async (answers: Partial<Record<Capability, Answer>>, name = "solo") => {
    const readings = await lambdaInventory(standIn({ ...oneFunction(name), ...answers }), {
      now: NOW_STALE,
      sleep: noSleep,
    })
    if (readings.functions.state !== "ACTUAL") throw new Error("expected ACTUAL")
    return describeReservedConcurrency(readings.functions.value[0].reservedConcurrency)
  }

  it("reserved, zero, unreserved and refused are four different sentences", async () => {
    const reserved = await sentence({
      "lambda:GetFunctionConcurrency": () => ({ ReservedConcurrentExecutions: 25 }),
    })
    const zero = await sentence({
      "lambda:GetFunctionConcurrency": () => ({ ReservedConcurrentExecutions: 0 }),
    })
    // Lambda answers an unreserved function with the field simply absent.
    const unreserved = await sentence({ "lambda:GetFunctionConcurrency": () => ({}) })
    const refused = await sentence({
      "lambda:GetFunctionConcurrency": () => {
        throw awsError("AccessDeniedException")
      },
    })

    expect(new Set([reserved, zero, unreserved, refused]).size).toBe(4)

    expect(reserved).toBe("reserved concurrency 25, held out of the account pool")
    // Zero is not "no reservation": it is a function AWS will refuse to invoke.
    expect(zero).toContain("cannot be invoked at all")
    expect(unreserved).toContain("shares the account's unreserved concurrency pool")
    expect(refused).toContain("unknown")
    expect(refused).toContain("lambda:GetFunctionConcurrency")
    expect(refused).not.toContain("shares the account")
  })

  it("keeps listing the functions when only the concurrency call is refused", async () => {
    const readings = await lambdaInventory(
      standIn({
        ...populated(),
        "lambda:GetFunctionConcurrency": () => {
          throw awsError("AccessDeniedException")
        },
      }),
      { now: NOW_STALE, sleep: noSleep },
    )

    expect(readings.functions.state).toBe("ACTUAL")
    if (readings.functions.state !== "ACTUAL") throw new Error("unreachable")
    expect(readings.functions.value).toHaveLength(6)
    for (const fn of readings.functions.value) {
      expect(fn.reservedConcurrency.state).toBe("DENIED")
    }
    // The runtime verdicts still land: one refused sub-read does not blank the page.
    expect(runtimeRiskLine(readings.functions, readings.calendar)).toMatch(/end-of-lifed/)
  })

  it("does not report an unread function as unreserved, and stops at the budget", async () => {
    const many = Array.from({ length: CONCURRENCY_READ_BUDGET + 5 }, (_, i) => ({
      FunctionArn: arnFor(`bulk-${String(i).padStart(3, "0")}`),
      FunctionName: `bulk-${String(i).padStart(3, "0")}`,
      Runtime: "nodejs20.x",
      PackageType: "Zip",
      MemorySize: 128,
      Timeout: 5,
      LastModified: "2026-04-02T16:30:00.000+0000",
    }))
    const gw = standIn({
      "sts:GetCallerIdentity": IDENTITY,
      "lambda:ListFunctions": () => ({ Functions: many }),
      "lambda:GetFunctionConcurrency": () => ({ ReservedConcurrentExecutions: 3 }),
    })
    const readings = await lambdaInventory(gw, { now: NOW_STALE, sleep: noSleep })
    if (readings.functions.state !== "ACTUAL") throw new Error("expected ACTUAL")

    expect(gw.calls.get("lambda:GetFunctionConcurrency")).toBe(CONCURRENCY_READ_BUDGET)

    const past = readings.functions.value[CONCURRENCY_READ_BUDGET]
    expect(past.reservedConcurrency.state).toBe("UNCONFIGURED")
    const said = describeReservedConcurrency(past.reservedConcurrency)
    expect(said).toContain("not configured")
    expect(said).toContain("Not read is not unreserved")
    expect(said).not.toContain("shares the account")
  })
})

/* ==================================================== 4. throttle + paging */

describe("a throttle is its own state, on throttle.ts's schedule", () => {
  it("retries on the shared backoff curve and then reports THROTTLED rather than failing", async () => {
    const waited: number[] = []
    const gw = standIn({
      "sts:GetCallerIdentity": IDENTITY,
      "lambda:ListFunctions": () => {
        throw awsError("ThrottlingException")
      },
    })

    const readings = await lambdaInventory(gw, {
      now: NOW_STALE,
      sleep: async (ms) => {
        waited.push(ms)
      },
    })

    expect(readings.functions.state).toBe("THROTTLED")
    if (readings.functions.state !== "THROTTLED") throw new Error("unreachable")

    // The schedule is throttle.ts's, not a second curve invented in this file.
    expect(gw.calls.get("lambda:ListFunctions")).toBe(READ_ATTEMPTS)
    expect(waited).toEqual([backoffMs(2), backoffMs(3)])
    expect(readings.functions.retryAfterMs).toBe(backoffMs(READ_ATTEMPTS + 1))
    expect(readings.functions.asOf).toBe(NOW_STALE().toISOString())
  })

  it("walks every page rather than reporting the first one as the estate", async () => {
    const gw = standIn({
      "sts:GetCallerIdentity": IDENTITY,
      "lambda:ListFunctions": (input) =>
        input.Marker === "page2"
          ? { Functions: [FUNCTIONS[1]] }
          : { Functions: [FUNCTIONS[0]], NextMarker: "page2" },
    })
    const readings = await lambdaInventory(gw, { now: NOW_STALE, sleep: noSleep })
    if (readings.functions.state !== "ACTUAL") throw new Error("expected ACTUAL")

    expect(readings.functions.value.map((f) => f.name)).toEqual([
      "tenure-reminders",
      "tenure-webhook",
    ])
    expect(gw.calls.get("lambda:ListFunctions")).toBe(2)
  })
})

/* ================================== 5. residency, freshness, and the shape */

describe("the estate this reading describes is the one the identity resolved", () => {
  it("reports the resolved region and partition, never a default", async () => {
    const govcloud = await lambdaInventory(
      standIn(
        {
          "sts:GetCallerIdentity": () => ({
            Account: "987654321098",
            Arn: "arn:aws-us-gov:sts::987654321098:assumed-role/tenure-studio/task",
          }),
          "lambda:ListFunctions": () => ({
            Functions: [
              {
                FunctionArn:
                  "arn:aws-us-gov:lambda:us-gov-west-1:987654321098:function:tenure-reminders",
                FunctionName: "tenure-reminders",
                Runtime: "nodejs20.x",
                PackageType: "Zip",
                MemorySize: 128,
                Timeout: 5,
                LastModified: "2026-04-02T16:30:00.000+0000",
              },
            ],
          }),
        },
        "us-gov-west-1",
      ),
      { now: NOW_STALE, sleep: noSleep },
    )

    expect(govcloud.region).toBe("us-gov-west-1")
    expect(govcloud.partition).toBe("aws-us-gov")
    const headline = lambdaHeadline(govcloud)
    expect(headline).toContain("partition aws-us-gov")
    expect(headline).toContain("us-gov-west-1")
    expect(headline).not.toContain("us-east-1")
    expect(headline).not.toContain("partition aws,")

    if (govcloud.functions.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(govcloud.functions.value[0].partition).toBe("aws-us-gov")
    expect(govcloud.functions.value[0].contract.partition).toBe("aws-us-gov")
    expect(residencyAnomalies(govcloud)).toEqual([])
  })

  it("refuses to name an estate when identity itself is unknown", async () => {
    const readings = await lambdaInventory(
      standIn({
        "sts:GetCallerIdentity": () => {
          throw awsError("AccessDeniedException")
        },
        "lambda:ListFunctions": () => ({ Functions: [FUNCTIONS[0]] }),
      }),
      { now: NOW_STALE, sleep: noSleep },
    )

    expect(readings.region).toBeNull()
    expect(readings.partition).toBeNull()
    expect(lambdaHeadline(readings)).toContain("region and partition unknown")
    // And it does not silently claim the functions are somewhere.
    expect(residencyAnomalies(readings)).toEqual([])
  })

  it("reports a function whose ARN names a different region than the engine resolved", async () => {
    const readings = await lambdaInventory(
      standIn({
        "sts:GetCallerIdentity": IDENTITY,
        "lambda:ListFunctions": () => ({
          Functions: [
            FUNCTIONS[0],
            {
              ...FUNCTIONS[1],
              FunctionArn: arnFor("tenure-webhook", "eu-central-1"),
            },
          ],
        }),
      }),
      { now: NOW_STALE, sleep: noSleep },
    )

    expect(residencyAnomalies(readings)).toEqual([
      {
        arn: arnFor("tenure-webhook", "eu-central-1"),
        detail: `ARN names region eu-central-1; this engine resolved ${REGION}`,
      },
    ])
  })

  it("carries an explicit as-of and its own refresh cadence", async () => {
    const readings = await lambdaInventory(standIn(populated()), { now: NOW_STALE, sleep: noSleep })

    expect(readings.asOf).toBe("2026-08-13T00:00:00.000Z")
    expect(readings.refreshMs).toBe(45_000)
    expect(readings.staleAfter).toBe("2026-08-13T00:00:45.000Z")
    expect(lambdaHeadline(readings)).toContain("re-read every 45s")
    expect(readings.calendar).toMatchObject({ asOf: "2026-05-01", ageDays: 104, stale: true })

    if (readings.functions.state !== "ACTUAL") throw new Error("expected ACTUAL")
    for (const fn of readings.functions.value) expect(fn.asOf).toBe(readings.asOf)
    expect(lambdaLines(readings).map((l) => l.surface)).toEqual([
      "Functions",
      "Runtime support",
      "Tenant attribution",
    ])
  })

  it("maps memory, timeout, size, architecture and last-modified off the API's own fields", async () => {
    const readings = await lambdaInventory(standIn(populated()), { now: NOW_STALE, sleep: noSleep })
    if (readings.functions.state !== "ACTUAL") throw new Error("expected ACTUAL")

    const reminders = readings.functions.value[0]
    expect(reminders).toMatchObject({
      name: "tenure-reminders",
      runtime: "nodejs16.x",
      packageType: "Zip",
      memoryMb: 512,
      timeoutSeconds: 30,
      codeSizeBytes: 4_194_304,
      architectures: ["x86_64"],
      region: REGION,
      accountId: ACCOUNT,
      partition: "aws",
    })
    // Lambda's `+0000` offset, normalised to a Z the same way on every platform.
    expect(reminders.lastModified).toBe("2025-11-02T09:15:00.000Z")
    expect(reminders.lastModifiedRaw).toBe("2025-11-02T09:15:00.000+0000")
    // 2025-11-02T09:15Z to 2026-08-13T00:00Z is 283 whole days. Floored, not
    // rounded: a function last touched 283.6 days ago has not been touched for
    // 284 days, and this number is read as an age.
    expect(reminders.daysSinceLastModified).toBe(283)

    const image = readings.functions.value[5]
    expect(image.runtime).toBeNull()
    expect(image.packageType).toBe("Image")
  })

  it("normalises or refuses a timestamp, never invents one", () => {
    expect(normaliseLastModified("2025-11-02T09:15:00.000+0000")).toBe("2025-11-02T09:15:00.000Z")
    expect(normaliseLastModified("2025-11-02T09:15:00.000+0100")).toBe("2025-11-02T08:15:00.000Z")
    expect(normaliseLastModified("not a date")).toBeNull()
    expect(normaliseLastModified(undefined)).toBeNull()
  })

  it("refuses a malformed function rather than rendering it", async () => {
    const readings = await lambdaInventory(
      standIn({
        "sts:GetCallerIdentity": IDENTITY,
        "lambda:ListFunctions": () => ({
          Functions: [
            {
              // An account that is not twelve digits: an ARN an operator would
              // act on in the wrong place.
              FunctionArn: "arn:aws:lambda:eu-west-2:12345:function:tenure-bad",
              FunctionName: "tenure-bad",
              Runtime: "nodejs20.x",
              PackageType: "Zip",
            },
          ],
        }),
      }),
      { now: NOW_STALE, sleep: noSleep },
    )

    expect(readings.functions.state).toBe("ERROR")
    if (readings.functions.state !== "ERROR") throw new Error("unreachable")
    expect(readings.functions.code).toBe("ContractViolation")
    expect(lambdaFunctionsLine(readings.functions)).toContain("error")
    expect(lambdaFunctionsLine(readings.functions)).not.toContain("none")
  })
})
