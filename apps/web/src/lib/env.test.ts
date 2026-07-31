import { validateEnv, assertEnv, formatEnvProblems } from "./env"

type EnvOverrides = Record<string, string | undefined>

/** A production environment that is safe to serve with. */
function productionEnv(overrides: EnvOverrides = {}): EnvOverrides {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://tenure:pw@db.internal:5432/tenure",
    AUTH_SECRET: "a".repeat(48),
    NEXTAUTH_URL: "https://platform.tenurework.com",
    OKTA_ISSUER: "https://rochester.okta.com",
    OKTA_CLIENT_ID: "0oa-client",
    OKTA_CLIENT_SECRET: "shhh-a-real-secret-value",
    JOB_SECRET: "a-real-job-secret-value",
    S3_DOCUMENTS_BUCKET: "tenure-pilot-documents",
    ...overrides,
  }
}

const fatalVars = (env: EnvOverrides) =>
  validateEnv(env)
    .problems.filter((p) => p.level === "fatal")
    .map((p) => p.variable)

describe("validateEnv — baseline", () => {
  it("accepts a correctly configured production environment", () => {
    const result = validateEnv(productionEnv())

    expect(result.ok).toBe(true)
    expect(result.problems.filter((p) => p.level === "fatal")).toHaveLength(0)
  })

  it("accepts a loose development environment", () => {
    const result = validateEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://tenure:tenure@localhost:5433/tenure",
      AUTH_SECRET: "short-dev-secret",
      AUTH_DEV_LOGIN: "true",
    })

    // Every production-only rule must stay out of a developer's way.
    expect(result.ok).toBe(true)
  })

  it("defaults NODE_ENV to development rather than assuming production", () => {
    const result = validateEnv({
      DATABASE_URL: "postgresql://localhost:5432/tenure",
      AUTH_SECRET: "x",
    })

    expect(result.ok).toBe(true)
  })
})

describe("validateEnv — required values", () => {
  it("refuses to start without DATABASE_URL", () => {
    expect(fatalVars(productionEnv({ DATABASE_URL: undefined }))).toContain("DATABASE_URL")
  })

  it("refuses a DATABASE_URL that is not postgres", () => {
    expect(fatalVars(productionEnv({ DATABASE_URL: "mysql://localhost:3306/tenure" }))).toContain("DATABASE_URL")
  })

  it("refuses to start without AUTH_SECRET", () => {
    expect(fatalVars(productionEnv({ AUTH_SECRET: undefined }))).toContain("AUTH_SECRET")
  })
})

describe("validateEnv — passwordless dev sign-in", () => {
  // The seeded demo accounts have no password and director@tenure.demo holds
  // OSE_DIRECTOR, so this flag is a complete authentication bypass wherever the
  // demo accounts exist.
  it("refuses to serve production with dev login on and no acknowledgement", () => {
    const result = validateEnv(productionEnv({ AUTH_DEV_LOGIN: "true" }))

    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.variable === "AUTH_DEV_LOGIN" && p.level === "fatal")).toBe(true)
  })

  it("allows the pilot to keep dev login when acknowledged AND gated", () => {
    const result = validateEnv(
      productionEnv({
        AUTH_DEV_LOGIN: "true",
        ALLOW_DEV_LOGIN_IN_PRODUCTION: "true",
        DEV_LOGIN_PASSPHRASE: "a-real-shared-pilot-passphrase",
      }),
    )

    expect(result.ok).toBe(true)
    // Explicit does not mean silent.
    expect(result.problems.some((p) => p.variable === "AUTH_DEV_LOGIN" && p.level === "warning")).toBe(true)
  })

  // Acknowledging the exposure must not be a way to opt out of defending it.
  it("refuses acknowledged dev login with no access passphrase", () => {
    const result = validateEnv(
      productionEnv({ AUTH_DEV_LOGIN: "true", ALLOW_DEV_LOGIN_IN_PRODUCTION: "true" }),
    )

    expect(result.ok).toBe(false)
    expect(fatalVars(productionEnv({ AUTH_DEV_LOGIN: "true", ALLOW_DEV_LOGIN_IN_PRODUCTION: "true" }))).toContain(
      "DEV_LOGIN_PASSPHRASE",
    )
  })

  it("refuses a trivially short access passphrase", () => {
    const short = productionEnv({
      AUTH_DEV_LOGIN: "true",
      ALLOW_DEV_LOGIN_IN_PRODUCTION: "true",
      DEV_LOGIN_PASSPHRASE: "tenure2026",
    })

    expect(fatalVars(short)).toContain("DEV_LOGIN_PASSPHRASE")
  })

  it("does not require a passphrase when dev login is off", () => {
    // Okta-only production has nothing for the gate to stand in front of.
    expect(fatalVars(productionEnv())).not.toContain("DEV_LOGIN_PASSPHRASE")
  })

  it("does not let the acknowledgement enable anything on its own", () => {
    const result = validateEnv(productionEnv({ ALLOW_DEV_LOGIN_IN_PRODUCTION: "true" }))

    expect(result.ok).toBe(true)
    expect(result.problems.filter((p) => p.level === "warning")).toHaveLength(0)
  })

  it('treats any value other than exactly "true" as off', () => {
    for (const value of ["TRUE", "1", "yes", "on", ""]) {
      expect(validateEnv(productionEnv({ AUTH_DEV_LOGIN: value })).ok).toBe(true)
    }
  })

  // This is the environment the live pilot task definition actually sets
  // (infrastructure/terraform/ecs.tf). It must not pass without the
  // acknowledgement, or this control does nothing.
  it("rejects the live pilot task definition as written before this change", () => {
    const result = validateEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://tenure_admin:pw@tenure-pilot.rds.amazonaws.com:5432/tenure",
      AUTH_SECRET: "b".repeat(44),
      NEXTAUTH_URL: "https://d1n6mdis7bs02g.cloudfront.net",
      AUTH_DEV_LOGIN: "true",
      OKTA_ISSUER: "",
      OKTA_CLIENT_ID: "",
      OKTA_CLIENT_SECRET: "",
      JOB_SECRET: "a-real-job-secret-value",
    })

    expect(result.ok).toBe(false)
  })
})

describe("validateEnv — no way in at all", () => {
  it("refuses production where neither dev login nor Okta is configured", () => {
    expect(fatalVars(productionEnv({ OKTA_ISSUER: undefined }))).toContain("OKTA_ISSUER")
  })

  it("does not accept a half-configured Okta as configured", () => {
    expect(fatalVars(productionEnv({ OKTA_CLIENT_SECRET: undefined }))).toContain("OKTA_ISSUER")
    expect(fatalVars(productionEnv({ OKTA_ISSUER: "rochester.okta.com" }))).toContain("OKTA_ISSUER")
  })
})

describe("validateEnv — weak and placeholder secrets", () => {
  it.each(["ci-build-secret-not-for-production", "e2e-test-secret", "REPLACE_ME_AFTER_DEPLOY", "changeme"])(
    "refuses the %s placeholder in production",
    (secret) => {
      expect(fatalVars(productionEnv({ AUTH_SECRET: secret }))).toContain("AUTH_SECRET")
    },
  )

  it("refuses an AUTH_SECRET shorter than 32 characters in production", () => {
    expect(fatalVars(productionEnv({ AUTH_SECRET: "a".repeat(31) }))).toContain("AUTH_SECRET")
    expect(fatalVars(productionEnv({ AUTH_SECRET: "a".repeat(32) }))).not.toContain("AUTH_SECRET")
  })

  it("refuses a placeholder JOB_SECRET in production", () => {
    expect(fatalVars(productionEnv({ JOB_SECRET: "e2e-job-secret" }))).toContain("JOB_SECRET")
  })

  it("warns, but starts, when JOB_SECRET is absent", () => {
    // The route fails closed with a 503, so this is a broken feature and not an
    // open endpoint — reminders silently stop, which is worth saying out loud.
    const result = validateEnv(productionEnv({ JOB_SECRET: undefined }))

    expect(result.ok).toBe(true)
    expect(result.problems.some((p) => p.variable === "JOB_SECRET" && p.level === "warning")).toBe(true)
  })
})

describe("validateEnv — transport", () => {
  it("refuses a non-https NEXTAUTH_URL in production", () => {
    expect(fatalVars(productionEnv({ NEXTAUTH_URL: "http://platform.tenurework.com" }))).toContain("NEXTAUTH_URL")
  })

  it("refuses a NEXTAUTH_URL that is not a URL at all", () => {
    expect(fatalVars(productionEnv({ NEXTAUTH_URL: "platform.tenurework.com" }))).toContain("NEXTAUTH_URL")
  })

  // `next start` sets NODE_ENV=production, so the 128-scenario e2e suite runs
  // against these rules. A loopback address carries no cookie over a network,
  // and failing it here would only teach people to disable the check.
  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])(
    "allows %s in production mode",
    (url) => {
      expect(fatalVars(productionEnv({ NEXTAUTH_URL: url }))).not.toContain("NEXTAUTH_URL")
    },
  )

  it("still refuses plain http to a real host", () => {
    expect(fatalVars(productionEnv({ NEXTAUTH_URL: "http://tenure.internal:3000" }))).toContain("NEXTAUTH_URL")
  })
})

// The environment CI actually starts the e2e server with must satisfy the
// production contract, because `next start` puts it in production mode.
describe("the CI e2e environment", () => {
  it("is accepted by the same rules production is held to", () => {
    const result = validateEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://tenure:tenure@localhost:5432/tenure",
      AUTH_SECRET: "e2e-not-a-placeholder-2f8c1d9b4a6e7350f1c2",
      AUTH_TRUST_HOST: "true",
      AUTH_DEV_LOGIN: "true",
      ALLOW_DEV_LOGIN_IN_PRODUCTION: "true",
      DEV_LOGIN_PASSPHRASE: "e2e-shared-pilot-passphrase",
      NEXTAUTH_URL: "http://localhost:3000",
      OKTA_CLIENT_ID: "",
      OKTA_CLIENT_SECRET: "",
      OKTA_ISSUER: "",
      JOB_SECRET: "e2e-not-a-placeholder-job-4b7d2e9a",
      S3_DOCUMENTS_BUCKET: "",
    })

    expect(result.problems.filter((p) => p.level === "fatal")).toEqual([])
    expect(result.ok).toBe(true)
  })
})

describe("assertEnv", () => {
  it("returns the parsed environment when it is safe", () => {
    expect(assertEnv(productionEnv()).NODE_ENV).toBe("production")
  })

  it("throws with the offending variable named", () => {
    expect(() => assertEnv(productionEnv({ AUTH_DEV_LOGIN: "true" }))).toThrow(/AUTH_DEV_LOGIN/)
  })

  it("throws rather than returning a partial environment", () => {
    expect(() => assertEnv(productionEnv({ DATABASE_URL: undefined }))).toThrow(/Refusing to start/)
  })
})

describe("formatEnvProblems", () => {
  it("marks fatal and warning problems differently", () => {
    const text = formatEnvProblems([
      { variable: "A", message: "bad", level: "fatal" },
      { variable: "B", message: "meh", level: "warning" },
    ])

    expect(text).toContain("A: bad")
    expect(text).toContain("B: meh")
    // Fatal and warning must be visually distinguishable in a container log.
    expect(text.split("\n")[0]).not.toEqual(text.split("\n")[1])
  })
})
