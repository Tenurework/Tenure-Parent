import { decideSeedAllowed, OPT_IN_VAR } from "./seed-guard.mjs"

/** The two URLs that actually occur: CI/local, and the pilot's RDS instance. */
const LOCAL = "postgresql://tenure:tenure@localhost:5433/tenure?schema=public"
const RDS =
  "postgresql://master:s3cret@tenure-pilot.cluster-abc123.us-east-1.rds.amazonaws.com:5432/tenure?schema=public&connection_limit=5"

describe("decideSeedAllowed", () => {
  it("refuses in production, which is what a redeploy is", () => {
    // infrastructure/terraform/ecs.tf sets NODE_ENV=production on the pilot
    // task definition, so this is the exact input a booting task supplies.
    const verdict = decideSeedAllowed({
      nodeEnv: "production",
      databaseUrl: RDS,
      seedDestructive: undefined,
    })

    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toContain("production")
    expect(verdict.reason).toContain(OPT_IN_VAR)
  })

  it("refuses in production even when DATABASE_URL looks local", () => {
    // A tunnel, a sidecar proxy, or a pgbouncer on 127.0.0.1 all put a local
    // host in front of a production database. NODE_ENV is the stronger signal
    // and must not be overridden by the weaker one.
    expect(
      decideSeedAllowed({ nodeEnv: "production", databaseUrl: LOCAL }).allowed,
    ).toBe(false)
  })

  it("allows production only when SEED_DESTRUCTIVE is exactly \"true\"", () => {
    expect(
      decideSeedAllowed({
        nodeEnv: "production",
        databaseUrl: RDS,
        seedDestructive: "true",
      }).allowed,
    ).toBe(true)

    // Near-misses stay refused: an operator resetting a production database
    // types the whole word, and a stray flag from elsewhere does not arm it.
    for (const near of ["1", "yes", "TRUE", "True", " true", "false", ""]) {
      expect(
        decideSeedAllowed({
          nodeEnv: "production",
          databaseUrl: RDS,
          seedDestructive: near,
        }).allowed,
      ).toBe(false)
    }
  })

  it("says it was overridden rather than pretending it was fine", () => {
    const verdict = decideSeedAllowed({
      nodeEnv: "production",
      databaseUrl: RDS,
      seedDestructive: "true",
    })

    expect(verdict.allowed).toBe(true)
    expect(verdict.reason).toContain("Overridden")
    expect(verdict.reason).toContain("production")
  })

  it("refuses a remote database when nothing has declared what it is", () => {
    // A local shell with DATABASE_URL exported at the pilot: NODE_ENV unset,
    // so production's guard does not fire and the host is the only evidence.
    const verdict = decideSeedAllowed({ nodeEnv: undefined, databaseUrl: RDS })

    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toContain("rds.amazonaws.com")
  })

  it("never prints the database password in its reason", () => {
    // The reason is printed to container logs and CI output.
    for (const nodeEnv of [undefined, "", "production", "development", "test"]) {
      for (const seedDestructive of [undefined, "true"]) {
        const { reason } = decideSeedAllowed({ nodeEnv, databaseUrl: RDS, seedDestructive })
        expect(reason).not.toContain("s3cret")
        expect(reason).not.toContain("master")
      }
    }
  })

  it("refuses an unreadable DATABASE_URL rather than assuming it is local", () => {
    const verdict = decideSeedAllowed({ nodeEnv: "", databaseUrl: "postgres-not-a-url" })

    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toContain("cannot be parsed")
  })

  it("allows the CI and local paths that really run it", () => {
    // .github/workflows/ci.yml runs `node scripts/seed.mjs` twice with
    // DATABASE_URL=postgresql://tenure:tenure@localhost:5432/tenure and no
    // NODE_ENV; CLAUDE.md's local instructions export localhost:5433. Both
    // must stay green, or this guard is a build break rather than a guard.
    for (const databaseUrl of [
      LOCAL,
      "postgresql://tenure:tenure@localhost:5432/tenure",
      "postgresql://postgres:postgres@127.0.0.1:5432/tenure",
      "postgresql://tenure:tenure@[::1]:5432/tenure",
    ]) {
      expect(decideSeedAllowed({ nodeEnv: undefined, databaseUrl }).allowed).toBe(true)
    }
  })

  it("allows development and test, where the fixture is the point", () => {
    for (const nodeEnv of ["development", "test"]) {
      expect(decideSeedAllowed({ nodeEnv, databaseUrl: LOCAL }).allowed).toBe(true)
    }
  })

  it("allows a bare invocation with no DATABASE_URL in the process env", () => {
    // Prisma resolves the URL itself from prisma/schema.prisma's env(), so an
    // absent process.env.DATABASE_URL is a local developer, not evidence of a
    // remote database. NODE_ENV=production remains the guard that matters, and
    // scripts/entrypoint.sh exports DATABASE_URL before node starts anyway.
    expect(decideSeedAllowed({ nodeEnv: undefined, databaseUrl: undefined }).allowed).toBe(true)
    expect(decideSeedAllowed({ nodeEnv: "", databaseUrl: "   " }).allowed).toBe(true)
  })

  it("refuses with no arguments at all only if it can tell — and never throws", () => {
    expect(() => decideSeedAllowed()).not.toThrow()
    expect(typeof decideSeedAllowed().reason).toBe("string")
  })
})

describe("seed.mjs wiring", () => {
  it("calls the guard before any write, and exits non-zero when refused", async () => {
    // The guard is only worth testing because a real caller reaches it. This
    // asserts the wiring in scripts/seed.mjs itself — the import, the call in
    // main() ahead of the first upsert, and the non-zero exit — so deleting
    // the call reds this test rather than silently leaving a pure module that
    // nothing consults.
    const fs = await import("fs")
    const path = await import("path")
    const source = fs.readFileSync(
      path.join(__dirname, "seed.mjs"),
      "utf8",
    )

    expect(source).toContain('import { decideSeedAllowed } from "./seed-guard.mjs"')

    const call = source.indexOf("decideSeedAllowed({")
    const firstWrite = source.indexOf("db.institution.upsert")
    const firstDelete = source.indexOf("deleteMany")
    expect(call).toBeGreaterThan(-1)
    expect(call).toBeLessThan(firstWrite)
    expect(call).toBeLessThan(firstDelete)

    // Every field the decision depends on is actually supplied.
    const callSite = source.slice(call, source.indexOf("})", call))
    expect(callSite).toContain("process.env.NODE_ENV")
    expect(callSite).toContain("process.env.DATABASE_URL")
    expect(callSite).toContain("process.env.SEED_DESTRUCTIVE")

    // Refusal has to stop the process, not warn and carry on into the deletes.
    const refusal = source.slice(source.indexOf("if (!verdict.allowed)"), firstWrite)
    expect(refusal).toContain("process.exit(1)")
  })
})
