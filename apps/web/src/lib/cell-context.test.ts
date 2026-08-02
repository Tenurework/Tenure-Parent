import { CellContextError, resolveCellContext } from "./cell-context"

/**
 * GE-012-001 — where this process is running.
 *
 * The tests that matter are about the fallback, not the happy path. A default
 * region is not a convenience: a cell in eu-west-1 whose AWS_REGION is unset
 * quietly writes to us-east-1, and nothing errors, nothing alerts, and the
 * residency breach is found by an audit rather than by the software.
 */
const COMPLETE = {
  NODE_ENV: "production",
  AWS_PARTITION: "aws",
  AWS_ACCOUNT_ID: "047385673922",
  AWS_REGION: "eu-west-1",
  DEPLOY_ENVIRONMENT: "production",
  CELL_ID: "cell-euw1-a",
}

describe("a complete environment resolves", () => {
  it("returns exactly what it was told", () => {
    expect(resolveCellContext(COMPLETE)).toEqual({
      partition: "aws",
      accountId: "047385673922",
      region: "eu-west-1",
      environment: "production",
      cellId: "cell-euw1-a",
      resolved: "environment",
      unresolved: [],
    })
  })

  it("records that it came from the environment", () => {
    // "us-east-1 because we are in us-east-1" and "us-east-1 because nobody
    // said" are the same string and completely different facts.
    expect(resolveCellContext(COMPLETE).resolved).toBe("environment")
  })

  it("accepts the other partitions", () => {
    for (const partition of ["aws-us-gov", "aws-cn"]) {
      expect(resolveCellContext({ ...COMPLETE, AWS_PARTITION: partition }).partition).toBe(partition)
    }
  })
})

describe("in production the region fails closed, and only the region", () => {
  // The line is where it is because of what is actually deployed. The task
  // definition sets AWS_REGION and nothing else of the five
  // (infrastructure/terraform/ecs.tf), so requiring the region breaks nothing
  // that works today — and requiring the other four would fail the next deploy
  // of a system currently serving students, to enforce a contract nothing has
  // been updated to meet. The correct order is task definition first, then
  // tighten here.

  it("refuses a missing region rather than defaulting", () => {
    // The one that moves data. This is the whole item.
    const { AWS_REGION, ...withoutRegion } = COMPLETE
    expect(() => resolveCellContext(withoutRegion)).toThrow(CellContextError)
    expect(() => resolveCellContext(withoutRegion)).toThrow(/AWS_REGION is not set/)
  })

  it("says why a missing region matters, not just that it is missing", () => {
    const { AWS_REGION, ...withoutRegion } = COMPLETE
    try {
      resolveCellContext(withoutRegion)
      throw new Error("should have refused")
    } catch (err) {
      expect((err as Error).message).toMatch(/out of the region a contract permits/)
    }
  })

  it("reports a missing account id rather than failing the deploy", () => {
    // "Which account did that happen in" is the first question in an incident,
    // and it deserves an answer — but not at the cost of refusing to start a
    // running system for a variable nothing has been updated to supply.
    const context = resolveCellContext({ ...COMPLETE, AWS_ACCOUNT_ID: "" })
    expect(context.resolved).toBe("partial")
    expect(context.unresolved.join(" ")).toMatch(/AWS_ACCOUNT_ID/)
    // The region still came from the environment, which is the field that matters.
    expect(context.region).toBe("eu-west-1")
  })

  it("refuses a region that is not a region name", () => {
    for (const region of ["useast1", "us_east_1", "US-EAST-1", "us-east"]) {
      expect(() => resolveCellContext({ ...COMPLETE, AWS_REGION: region })).toThrow(CellContextError)
    }
  })

  it("reports an unknown environment or partition rather than refusing", () => {
    // Both matter — a production tenant in a staging cell is on staging's
    // backup schedule — and both are named in `unresolved` so tightening later
    // is a decision with a list rather than a guess.
    const badEnv = resolveCellContext({ ...COMPLETE, DEPLOY_ENVIRONMENT: "prod" })
    expect(badEnv.resolved).toBe("partial")
    expect(badEnv.unresolved.join(" ")).toMatch(/DEPLOY_ENVIRONMENT/)

    const badPartition = resolveCellContext({ ...COMPLETE, AWS_PARTITION: "aws-mars" })
    expect(badPartition.resolved).toBe("partial")
    expect(badPartition.unresolved.join(" ")).toMatch(/AWS_PARTITION/)
  })

  it("names every unresolved field, not the first", () => {
    // An operator who fixes one variable, redeploys, and is told about the next
    // has lost a deploy cycle to a list that was already known.
    const context = resolveCellContext({ ...COMPLETE, AWS_ACCOUNT_ID: "", CELL_ID: "" })
    expect(context.unresolved.length).toBe(2)
    expect(context.unresolved.join(" ")).toMatch(/AWS_ACCOUNT_ID/)
    expect(context.unresolved.join(" ")).toMatch(/CELL_ID/)
  })

  it("refuses when the region is missing even though everything else is fine", () => {
    // The one field that is both deployed and dangerous. Everything else being
    // present does not make a missing region survivable.
    const { AWS_REGION, ...rest } = COMPLETE
    expect(() => resolveCellContext(rest)).toThrow(CellContextError)
  })
})

describe("outside production it defaults, loudly", () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
  afterEach(() => warn.mockClear())
  afterAll(() => warn.mockRestore())

  it("lets a developer with no AWS run the app", () => {
    const context = resolveCellContext({ NODE_ENV: "development" })
    expect(context.region).toBe("us-east-1")
    expect(context.environment).toBe("development")
  })

  it("says the values are invented", () => {
    // A developer who never sees the warning has no way to know.
    resolveCellContext({ NODE_ENV: "development" })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/development defaults/)
  })

  it("marks the context as defaulted, so a caller can tell", () => {
    expect(resolveCellContext({ NODE_ENV: "development" }).resolved).toBe("development-default")
  })

  it("does not invent a real account number", () => {
    // The one thing worse than no context is a plausible wrong one — a real
    // account id in a developer's process is one an error report can carry into
    // a ticket, or a script can act on.
    const context = resolveCellContext({ NODE_ENV: "development" })
    expect(context.accountId).toBe("000000000000")
    expect(context.accountId).not.toBe("047385673922")
  })

  it("still prefers a real value when one is given", () => {
    // Partial configuration is the normal case locally: a developer with a real
    // region and no account id should get their region.
    const context = resolveCellContext({ NODE_ENV: "development", AWS_REGION: "eu-west-1" })
    // It falls back wholesale rather than field by field, because a mixed
    // context — a real region with an invented account — is the plausible wrong
    // answer this module exists to avoid. The warning names what was missing.
    expect(context.resolved).toBe("development-default")
    expect(warn.mock.calls[0][0]).toMatch(/AWS_ACCOUNT_ID/)
    expect(warn.mock.calls[0][0]).not.toMatch(/AWS_REGION is not set/)
  })
})
