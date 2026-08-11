import { test, expect } from "@playwright/test"

import {
  authConfigProblems,
  cognitoConfigProblems,
  studioAuthMode,
} from "../src/lib/auth-config"
import { operatorConfigProblems } from "../src/lib/operators"

const OPERATORS = "operator@tenure.example:platform-super-admin"
const SECRET = "spec-operator-secret-9f3b2c71d4"

function env(over: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return over as unknown as NodeJS.ProcessEnv
}

test.describe("System Studio auth mode", () => {
  test("production defaults to Cognito", () => {
    expect(studioAuthMode(env({ NODE_ENV: "production" }))).toBe("cognito")
  })

  test("local and test runs default to the credentials harness", () => {
    expect(studioAuthMode(env({ NODE_ENV: "development" }))).toBe("credentials")
    expect(studioAuthMode(env({ NODE_ENV: "test" }))).toBe("credentials")
  })

  test("Cognito mode requires the OIDC issuer and app client values", () => {
    const problems = cognitoConfigProblems(env({ NODE_ENV: "production" }))
    expect(problems.map((p) => p.variable).sort()).toEqual([
      "COGNITO_CLIENT_ID",
      "COGNITO_CLIENT_SECRET",
      "COGNITO_ISSUER",
    ])
  })

  test("Cognito mode validates the issuer as a user-pool issuer", () => {
    const problems = authConfigProblems(
      env({
        NODE_ENV: "production",
        COGNITO_CLIENT_ID: "client",
        COGNITO_CLIENT_SECRET: "secret",
        COGNITO_ISSUER: "https://tenure-studio.auth.us-east-1.amazoncognito.com",
      }),
    )

    expect(problems.map((p) => p.variable)).toContain("COGNITO_ISSUER")
  })

  test("Cognito production still requires the operator allowlist, but not the shared secret", () => {
    expect(
      operatorConfigProblems(
        env({
          NODE_ENV: "production",
          STUDIO_AUTH_MODE: "cognito",
          PLATFORM_OPERATORS: OPERATORS,
        }),
      ),
    ).toEqual([])
  })

  test("the credentials harness still refuses to run without the shared secret", () => {
    const problems = operatorConfigProblems(
      env({
        NODE_ENV: "test",
        STUDIO_AUTH_MODE: "credentials",
        PLATFORM_OPERATORS: OPERATORS,
      }),
    )

    expect(problems.map((p) => p.variable)).toContain("PLATFORM_OPERATOR_SECRET")
    expect(
      operatorConfigProblems(
        env({
          NODE_ENV: "test",
          STUDIO_AUTH_MODE: "credentials",
          PLATFORM_OPERATORS: OPERATORS,
          PLATFORM_OPERATOR_SECRET: SECRET,
        }),
      ),
    ).toEqual([])
  })
})
