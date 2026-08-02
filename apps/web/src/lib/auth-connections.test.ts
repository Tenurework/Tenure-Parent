import {
  cellConnections,
  cellLoginMethods,
  connectionRefusals,
  oktaIsUsable,
  type CellEnvironment,
} from "./auth-connections"

/**
 * GE-030-003 — this cell's own connections, through the registry.
 *
 * The value of routing `auth.ts` through the registry is that the registry
 * refuses things the inline check accepted. These are those things: each one
 * used to produce a provider NextAuth registers happily and that fails at the
 * callback.
 */
const OKTA: CellEnvironment = {
  OKTA_ISSUER: "https://example.okta.com",
  OKTA_CLIENT_ID: "0oa1b2c3d4e5f6g7h8i9",
  OKTA_CLIENT_SECRET_REF: "/tenure/okta/client-secret",
}

describe("what the old inline check would have accepted", () => {
  it("accepts a fully configured connection", () => {
    expect(oktaIsUsable(OKTA)).toBe(true)
  })

  it("refuses an http issuer", () => {
    // The inline check tested `startsWith("https://")`, so this one it caught.
    expect(oktaIsUsable({ ...OKTA, OKTA_ISSUER: "http://example.okta.com" })).toBe(false)
  })

  it("refuses a connection with no client id", () => {
    // The inline check did NOT catch this. The provider registers, the
    // authorization request goes out with an empty client_id, and Okta rejects
    // it at the callback — visibly to the user, invisibly to anyone watching.
    expect(oktaIsUsable({ ...OKTA, OKTA_CLIENT_ID: "" })).toBe(false)
    const refusals = connectionRefusals({ ...OKTA, OKTA_CLIENT_ID: "" })
    expect(refusals[0].problems.join(" ")).toMatch(/pool or app client/)
  })

  it("refuses a credential pasted as a value rather than referenced", () => {
    // Also not caught before. A secret in an environment variable that is meant
    // to hold a reference is a secret that reaches every log line that dumps
    // the config.
    const pasted = { ...OKTA, OKTA_CLIENT_SECRET_REF: "s3cr3t-client-secret-value" }
    expect(oktaIsUsable(pasted)).toBe(false)
    expect(connectionRefusals(pasted)[0].problems.join(" ")).toMatch(/must be a Secrets Manager/)
  })

  it("refuses a connection whose secret has expired", () => {
    const expired = { ...OKTA, OKTA_CLIENT_SECRET_EXPIRES_AT: "2020-01-01T00:00:00.000Z" }
    expect(oktaIsUsable(expired)).toBe(false)
    expect(connectionRefusals(expired)[0].problems.join(" ")).toMatch(/has expired/)
  })

  it("still offers a connection whose secret expires soon", () => {
    // It works today. Refusing it early takes working sign-in away to prevent a
    // future problem.
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString()
    expect(oktaIsUsable({ ...OKTA, OKTA_CLIENT_SECRET_EXPIRES_AT: soon })).toBe(true)
  })

  it("refuses when nothing is configured at all", () => {
    expect(oktaIsUsable({})).toBe(false)
    expect(connectionRefusals({})).toEqual([])
  })
})

describe("the cell describes its own providers as registry records", () => {
  it("describes no connection when none is configured", () => {
    expect(cellConnections({})).toEqual([])
    expect(cellLoginMethods({})).toEqual([])
  })

  it("describes dev-login as a real, active connection", () => {
    // ACTIVE because it genuinely is. Marking it PENDING to express
    // disapproval would make the registry disagree with reality, and a registry
    // that lies about what is enabled is worse than one that says nothing.
    const connections = cellConnections({ AUTH_DEV_LOGIN: "true" })
    expect(connections).toHaveLength(1)
    expect(connections[0]).toMatchObject({
      connectionId: "cell-dev-login",
      status: "ACTIVE",
      kind: "COGNITO_LOCAL",
    })
    expect(cellLoginMethods({ AUTH_DEV_LOGIN: "true" })).toEqual([
      { kind: "COGNITO_LOCAL", displayName: "Pilot demo user" },
    ])
  })

  it("offers both when both are configured, in a stable order", () => {
    const methods = cellLoginMethods({ ...OKTA, AUTH_DEV_LOGIN: "true" })
    expect(methods.map((m) => m.kind)).toEqual(["COGNITO_LOCAL", "OIDC"])
  })

  it("never puts a secret VALUE in a record", () => {
    // The records are built from the environment, and the environment is where
    // the secret actually lives. What ends up in the record must be the
    // reference the value was read from, not the value.
    const withSecret = { ...OKTA, OKTA_CLIENT_SECRET: "super-secret-value" }
    const serialized = JSON.stringify(cellConnections(withSecret))
    expect(serialized).not.toContain("super-secret-value")
  })

  it("does not report a healthy connection as needing attention", () => {
    expect(connectionRefusals(OKTA)).toEqual([])
  })
})
