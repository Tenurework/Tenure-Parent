import {
  planBootstrap,
  isRetryableConnectionError,
  classifyProbeResult,
  BASELINE_MIGRATION,
} from "./db-bootstrap.mjs"

describe("planBootstrap", () => {
  it("applies pending migrations on a database that already has a ledger", () => {
    const plan = planBootstrap({ hasMigrationLedger: true, hasApplicationTables: true })

    expect(plan.steps).toEqual(["deploy"])
    expect(plan.database).toBe("managed")
  })

  it("baselines a pre-migrations pilot database instead of replaying over live tables", () => {
    // The live pilot: 39 tables built by `db push`, no `_prisma_migrations`.
    // Replaying the baseline here would fail on `CREATE TABLE` for tables that
    // already hold customer data, so it must be recorded, not executed.
    const plan = planBootstrap({ hasMigrationLedger: false, hasApplicationTables: true })

    expect(plan.steps).toEqual(["baseline", "deploy"])
    expect(plan.database).toBe("legacy-pilot")
    expect(plan.reason).toContain(BASELINE_MIGRATION)
  })

  it("applies the full history to an empty database", () => {
    const plan = planBootstrap({ hasMigrationLedger: false, hasApplicationTables: false })

    expect(plan.steps).toEqual(["deploy"])
    expect(plan.database).toBe("empty")
  })

  it("never baselines a database that already has a ledger", () => {
    // Baselining twice would record an applied migration a second time and
    // desynchronise the ledger from reality.
    for (const hasApplicationTables of [true, false]) {
      expect(planBootstrap({ hasMigrationLedger: true, hasApplicationTables }).steps).not.toContain("baseline")
    }
  })

  it("always ends by deploying, whatever the starting state", () => {
    for (const hasMigrationLedger of [true, false]) {
      for (const hasApplicationTables of [true, false]) {
        const plan = planBootstrap({ hasMigrationLedger, hasApplicationTables })
        expect(plan.steps[plan.steps.length - 1]).toBe("deploy")
      }
    }
  })

  it("never plans a destructive step", () => {
    for (const hasMigrationLedger of [true, false]) {
      for (const hasApplicationTables of [true, false]) {
        const plan = planBootstrap({ hasMigrationLedger, hasApplicationTables })
        expect(plan.steps.every((s) => s === "baseline" || s === "deploy")).toBe(true)
      }
    }
  })
})

describe("classifyProbeResult", () => {
  it("reads a clean exit as 'the table is there'", () => {
    expect(classifyProbeResult({ status: 0, output: "Script executed successfully." })).toBe("exists")
  })

  it("reads Prisma's P1014 as 'the table is not there'", () => {
    expect(
      classifyProbeResult({
        status: 1,
        output: "Error: P1014\n\nThe underlying table for model `_prisma_migrations` does not exist.",
      }),
    ).toBe("absent")
  })

  it("reads a raw Postgres 'relation does not exist' as absent", () => {
    expect(classifyProbeResult({ status: 1, output: 'ERROR: relation "Institution" does not exist' })).toBe("absent")
  })

  it("asks to retry when the database is merely unreachable", () => {
    expect(classifyProbeResult({ status: 1, output: "P1001: Can't reach database server" })).toBe("retry")
  })

  // The regression that motivated this function. Node 20+ refuses to spawn
  // `npx.cmd` without a shell, so the probe never ran; status was null, which
  // is not 0, and the old code read that as "table absent". Both probes came
  // back absent, the plan became "empty database", and `migrate deploy` tried
  // to CREATE TABLE over a populated schema.
  it("refuses to interpret a probe that never ran", () => {
    expect(classifyProbeResult({ status: null, output: "spawnSync npx.cmd EINVAL" })).toBe("fatal")
  })

  it.each([
    ["permission denied", 'ERROR: permission denied for table "Institution"'],
    ["bad credentials", "P1000 Authentication failed against database server"],
    ["no output at all", ""],
  ])("treats %s as fatal rather than as absence", (_label, output) => {
    expect(classifyProbeResult({ status: 1, output })).toBe("fatal")
  })

  it("never reports absence without the database having said so", () => {
    const ambiguous = [
      { status: null, output: "" },
      { status: 1, output: "some unexpected CLI change" },
      { status: 127, output: "command not found" },
      { status: 1, output: undefined },
    ]
    for (const probe of ambiguous) {
      expect(classifyProbeResult(probe)).not.toBe("absent")
    }
  })
})

describe("isRetryableConnectionError", () => {
  it.each([
    ["P1001", "Error: P1001: Can't reach database server at `db:5432`"],
    ["P1002", "P1002 The database server was reached but timed out"],
    ["ECONNREFUSED", "connect ECONNREFUSED 10.0.1.5:5432"],
    ["DNS", "getaddrinfo EAI_AGAIN tenure.rds.amazonaws.com"],
  ])("retries a %s connection failure", (_label, output) => {
    expect(isRetryableConnectionError(output)).toBe(true)
  })

  it.each([
    ["a missing relation", 'ERROR: relation "_prisma_migrations" does not exist'],
    ["a failed migration", "P3009 migrate found failed migrations in the target database"],
    ["bad credentials", "P1000 Authentication failed against database server"],
  ])("does not retry %s", (_label, output) => {
    // Retrying these just delays a fail-closed exit behind a backoff loop.
    expect(isRetryableConnectionError(output)).toBe(false)
  })

  it("treats absent output as non-retryable", () => {
    expect(isRetryableConnectionError(undefined)).toBe(false)
    expect(isRetryableConnectionError("")).toBe(false)
  })
})
