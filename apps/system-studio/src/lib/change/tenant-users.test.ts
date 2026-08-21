import { tenantUsers, userPoolIdsFrom, type PoolUserReading } from "./tenant-users"

/**
 * STUDIO-060-004, the `users` axis, at the module that answers it.
 *
 * Five of these assert a REFUSAL. That is the point of the module: a blast
 * radius that understates is the dangerous direction, so every way of not
 * knowing has to arrive as "we could not look" and never as `0`. The sixth
 * asserts the number, because a module that refuses everything would satisfy
 * the other five and tell an operator nothing.
 */

const POOL_ARN = "arn:aws:cognito-idp:us-east-1:000000000000:userpool/us-east-1_SIMON1"
const TABLE_ARN = "arn:aws:dynamodb:us-east-1:000000000000:table/tenure-simon"

const answered = (poolId: string, users: number | null): PoolUserReading => ({
  poolId,
  users: { known: true, value: users },
})

describe("which stores are this tenant's", () => {
  test("a user pool is recognised by its ARN, not by its name", () => {
    expect(userPoolIdsFrom([POOL_ARN, TABLE_ARN])).toEqual(["us-east-1_SIMON1"])
  })

  test("a pool ARN with a name that looks like a table is still a pool", () => {
    expect(
      userPoolIdsFrom(["arn:aws:cognito-idp:us-east-1:000000000000:userpool/us-east-1_table"]),
    ).toEqual(["us-east-1_table"])
  })

  test("the same pool attributed twice is counted once", () => {
    expect(userPoolIdsFrom([POOL_ARN, POOL_ARN])).toEqual(["us-east-1_SIMON1"])
  })

  test("a cognito ARN that is not a user pool is not one", () => {
    expect(
      userPoolIdsFrom(["arn:aws:cognito-idp:us-east-1:000000000000:identityprovider/x"]),
    ).toEqual([])
  })

  test("something that is not an ARN at all is skipped rather than throwing", () => {
    expect(userPoolIdsFrom(["us-east-1_SIMON1", "", "arn:bad"])).toEqual([])
  })
})

describe("the count, and the five ways there is not one", () => {
  test("an unattributed estate cannot say which stores are this tenant's", () => {
    const reading = tenantUsers(null, [])
    expect(reading.known).toBe(false)
    if (reading.known) throw new Error("unreachable")
    expect(reading.because).toContain("was not attributed")
  })

  test("an attribution naming no pool is not a tenant with no users", () => {
    const reading = tenantUsers([TABLE_ARN], [])
    expect(reading.known).toBe(false)
    if (reading.known) throw new Error("unreachable")
    expect(reading.because).toContain("no user pool is attributed")
    expect(reading.fix).toContain("Do not copy user rows into the control plane.")
  })

  test("a pool that could not be described takes the axis with it", () => {
    const reading = tenantUsers([POOL_ARN], [
      {
        poolId: "us-east-1_SIMON1",
        users: { known: false, because: "it was denied", fix: "Grant DescribeUserPool." },
      },
    ])
    expect(reading.known).toBe(false)
    if (reading.known) throw new Error("unreachable")
    expect(reading.because).toContain("us-east-1_SIMON1 could not be described")
    expect(reading.because).toContain("smaller than the truth")
    expect(reading.fix).toBe("Grant DescribeUserPool.")
  })

  test("a pool that was attributed and never read is a refusal, not an omission", () => {
    const reading = tenantUsers([POOL_ARN], [])
    expect(reading.known).toBe(false)
    if (reading.known) throw new Error("unreachable")
    expect(reading.because).toContain("was not read at all")
  })

  test("a pool AWS gave no estimate for is its own refusal, with its own remedy", () => {
    const reading = tenantUsers([POOL_ARN], [answered("us-east-1_SIMON1", null)])
    expect(reading.known).toBe(false)
    if (reading.known) throw new Error("unreachable")
    expect(reading.because).toContain("returned no EstimatedNumberOfUsers")
    expect(reading.fix).toContain("Nothing is misconfigured")
  })

  test("every pool answering gives the sum, and names the stores it came from", () => {
    const second = "arn:aws:cognito-idp:us-east-1:000000000000:userpool/us-east-1_SIMON2"
    const reading = tenantUsers(
      [POOL_ARN, second, TABLE_ARN],
      [answered("us-east-1_SIMON1", 1_800), answered("us-east-1_SIMON2", 42)],
    )
    if (!reading.known) throw new Error("expected a reading")
    expect(reading.value.count).toBe(1_842)
    expect(reading.value.stores).toEqual(["us-east-1_SIMON1", "us-east-1_SIMON2"])
  })

  test("a pool that genuinely holds nobody is zero, and zero is a KNOWN answer", () => {
    const reading = tenantUsers([POOL_ARN], [answered("us-east-1_SIMON1", 0)])
    if (!reading.known) throw new Error("expected a reading")
    expect(reading.value.count).toBe(0)
  })
})
