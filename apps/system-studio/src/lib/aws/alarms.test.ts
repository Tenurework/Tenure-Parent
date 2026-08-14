import { __resetIdentity } from "./identity"
import { alarmSurface } from "./alarms"
import { EndpointRegionUnset, type AwsGateway } from "./read"

/**
 * STUDIO-080-008 — an alarm surface that was not read is not an alarm surface
 * that is healthy.
 *
 * The requirement says: never render a green alarm solely because no data is
 * present, and distinguish `OK`, `ALARM`, `INSUFFICIENT_DATA`, disabled, stale,
 * missing and unauthorized. `alarmSurface` did that for six of the seven and
 * for denial — and then handed a caller `rows: []` when the call was throttled,
 * when the account was unconfigured, and when the API failed.
 *
 * An empty array is the same value `EMPTY` produces. So the page's headline said
 * "throttled" while the table beside it drew nothing, and a table drawing
 * nothing is how an operator concludes there is nothing wrong. This suite is the
 * one that would have caught it: it asserts on `rows`, which is what a route
 * iterates, rather than on `headline`, which was already correct and was
 * therefore no protection at all.
 *
 * ## The stand-in fails the way the SDK fails
 *
 * `readAws` classifies by the ERROR the gateway throws — `AccessDeniedException`
 * for DENIED, `ThrottlingException` for THROTTLED, `EndpointRegionUnset` for
 * UNCONFIGURED — so the fake throws those rather than returning a sentinel. A
 * fake that returned `[]` for every case would prove nothing about code whose
 * entire job is telling those cases apart.
 */

const ACCOUNT = "047385673922"

/** An error shaped the way the AWS SDK v3 shapes one: the `name` carries the code. */
function awsError(name: string): Error {
  const error = new Error(`${name}: raised by the alarms suite`)
  error.name = name
  return error
}

/**
 * A gateway that answers identity and then does one chosen thing for alarms.
 *
 * Identity always succeeds: every non-answer under test is a property of the
 * ALARM read, and an identity that failed too would make the assertions pass for
 * the wrong reason.
 */
function gatewayWhereAlarmsWill(outcome: () => Promise<unknown>): AwsGateway {
  return {
    async call(capability) {
      if (capability === "sts:GetCallerIdentity") {
        return { Account: ACCOUNT, Arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio/test` }
      }
      if (capability === "cloudwatch:DescribeAlarms") return outcome()
      return {}
    },
    async resolvedRegion() {
      return "us-east-1"
    },
  }
}

const alarmsThatFailWith = (error: Error) =>
  gatewayWhereAlarmsWill(() => Promise.reject(error))

beforeEach(() => {
  __resetIdentity()
})

describe("a non-answer never arrives as an empty list", () => {
  /**
   * The table is the assertion, not the sentence.
   *
   * `retries: 0` keeps the throttle case from spending its backoff — `readAws`
   * exhausts its loop into THROTTLED either way, and a suite that waited for the
   * real backoff would be slow for no extra coverage.
   */
  const nonAnswers: readonly (readonly [string, AwsGateway, RegExp])[] = [
    [
      "throttled",
      alarmsThatFailWith(awsError("ThrottlingException")),
      /rate-limited|throttl/i,
    ],
    [
      "unconfigured",
      alarmsThatFailWith(new EndpointRegionUnset("AWS_REGION is not set for this cell")),
      /not configured/i,
    ],
    ["errored", alarmsThatFailWith(awsError("InternalFailure")), /failed/i],
    [
      "denied",
      alarmsThatFailWith(awsError("AccessDeniedException")),
      /refused|Minimum statement/i,
    ],
  ]

  for (const [name, gateway, detail] of nonAnswers) {
    it(`${name}: renders a row an operator can read, not zero rows`, async () => {
      const surface = await alarmSurface(gateway, { expected: [] })

      // The load-bearing assertion. A caller that maps over `rows` must have
      // something to draw, or the estate reads as clean.
      expect(surface.rows.length).toBeGreaterThan(0)

      // And the row must say it is not an answer. `OK` here would be worse than
      // an empty list, because it is a positive claim.
      for (const row of surface.rows) {
        expect(["UNAUTHORIZED", "UNREADABLE"]).toContain(row.verdict)
      }
      expect(surface.rows[0]?.detail).toMatch(detail)
    })
  }

  it("an account that answered and has no alarms is still allowed to draw nothing", async () => {
    /*
     * The one case where zero rows IS the answer, and the reason the fix could
     * not simply be "always synthesise a row": that would make a quiet account
     * indistinguishable from an unreachable one in the other direction.
     *
     * Note the state is ACTUAL, not EMPTY. `alarmSurface` passes
     * `isEmpty: () => false` on purpose — a successful DescribeAlarms that
     * returned nothing is a real answer about the estate, and it is also the
     * only path on which MISSING can be computed, so collapsing it to EMPTY
     * would delete the "declared in Terraform and absent" verdict.
     */
    const surface = await alarmSurface(
      gatewayWhereAlarmsWill(async () => ({ MetricAlarms: [], CompositeAlarms: [] })),
      { expected: [] },
    )

    expect(surface.read.state).toBe("ACTUAL")
    expect(surface.rows).toHaveLength(0)
    expect(surface.headline).toMatch(/^0 alarm\(s\)/)
  })

  it("tells the four non-answers apart, rather than collapsing them", async () => {
    // Four different reasons must produce four different sentences. One shared
    // "unavailable" string would satisfy every assertion above and still leave an
    // operator with no idea whether to retry, to set a variable, to fix IAM, or
    // to open an incident.
    const details = await Promise.all(
      nonAnswers.map(async ([, gateway]) => {
        const surface = await alarmSurface(gateway, { expected: [] })
        return surface.rows[0]?.detail ?? ""
      }),
    )

    expect(new Set(details).size).toBe(nonAnswers.length)
  })
})
