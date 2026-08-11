export type StudioAuthMode = "cognito" | "credentials"

export interface AuthConfigProblem {
  variable: string
  detail: string
}

const MODES = new Set<string>(["cognito", "credentials"])

function clean(value: string | undefined): string {
  return (value ?? "").trim()
}

function defaultAuthMode(env: NodeJS.ProcessEnv): StudioAuthMode {
  return env.NODE_ENV === "production" ? "cognito" : "credentials"
}

export function studioAuthMode(env: NodeJS.ProcessEnv = process.env): StudioAuthMode {
  const raw = clean(env.STUDIO_AUTH_MODE).toLowerCase()
  if (raw === "cognito" || raw === "credentials") return raw
  return defaultAuthMode(env)
}

export function studioAuthModeProblems(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfigProblem[] {
  const raw = clean(env.STUDIO_AUTH_MODE).toLowerCase()
  if (!raw || MODES.has(raw)) return []
  return [
    {
      variable: "STUDIO_AUTH_MODE",
      detail: 'Must be "cognito" or "credentials". Production uses Cognito.',
    },
  ]
}

export function cognitoProviderConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    clientId: clean(env.COGNITO_CLIENT_ID),
    clientSecret: clean(env.COGNITO_CLIENT_SECRET),
    issuer: clean(env.COGNITO_ISSUER),
  }
}

export function cognitoConfigProblems(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfigProblem[] {
  if (studioAuthMode(env) !== "cognito") return studioAuthModeProblems(env)

  const problems = studioAuthModeProblems(env)
  const config = cognitoProviderConfig(env)

  if (!config.clientId) {
    problems.push({ variable: "COGNITO_CLIENT_ID", detail: "Not set." })
  }
  if (!config.clientSecret) {
    problems.push({ variable: "COGNITO_CLIENT_SECRET", detail: "Not set." })
  }
  if (!config.issuer) {
    problems.push({ variable: "COGNITO_ISSUER", detail: "Not set." })
  } else {
    try {
      const url = new URL(config.issuer)
      if (url.protocol !== "https:") {
        problems.push({ variable: "COGNITO_ISSUER", detail: "Must be an https issuer URL." })
      }
      if (!url.hostname.startsWith("cognito-idp.")) {
        problems.push({
          variable: "COGNITO_ISSUER",
          detail: "Must be an AWS Cognito user-pool issuer, not a hosted UI or arbitrary URL.",
        })
      }
    } catch {
      problems.push({ variable: "COGNITO_ISSUER", detail: "Must be a valid URL." })
    }
  }

  return problems
}

export function authConfigProblems(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfigProblem[] {
  if (studioAuthMode(env) === "cognito") return cognitoConfigProblems(env)
  return studioAuthModeProblems(env)
}
