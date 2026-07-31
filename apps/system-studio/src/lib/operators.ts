/**
 * Who may use the System Studio.
 *
 * The same allowlist the console previously used inside apps/web, moved here
 * with it. Two environment variables, both required, both failing closed:
 *
 *   PLATFORM_OPERATORS        comma-separated Tenure staff email addresses
 *   PLATFORM_OPERATOR_SECRET  a shared secret they present at sign-in
 *
 * A shared secret rather than per-person credentials because this console has
 * no user table and should not grow one: identity for Tenure staff belongs with
 * the identity provider PD-003 already commits to (Okta/Entra), and inventing a
 * second, weaker account system here would be a thing to migrate off later.
 * Until then, the allowlist names who, and the secret proves they are inside
 * Tenure — which is exactly the interim shape the pilot's own sign-in gate took.
 *
 * The secret has a floor on its length and refuses obvious placeholders,
 * because the failure mode of a shared secret is that someone sets it to
 * "tenure" during setup and nobody revisits it.
 */

const PLACEHOLDERS = ["changeme", "change-me", "password", "secret", "tenure", "test", "placeholder"]

export interface OperatorConfigProblem {
  variable: string
  detail: string
}

/** Problems with the operator configuration. Empty means usable. */
export function operatorConfigProblems(
  env: NodeJS.ProcessEnv = process.env,
): OperatorConfigProblem[] {
  const problems: OperatorConfigProblem[] = []

  const list = parseOperators(env)
  if (list.size === 0) {
    problems.push({
      variable: "PLATFORM_OPERATORS",
      detail: "Not set, or empty. No one can sign in, which is the correct default and not a usable state.",
    })
  }

  const secret = (env.PLATFORM_OPERATOR_SECRET ?? "").trim()
  if (!secret) {
    problems.push({ variable: "PLATFORM_OPERATOR_SECRET", detail: "Not set." })
  } else {
    if (secret.length < 24) {
      problems.push({
        variable: "PLATFORM_OPERATOR_SECRET",
        detail: `Too short (${secret.length}); at least 24 characters. This is the only thing standing between the internet and every tenant's configuration.`,
      })
    }
    if (PLACEHOLDERS.some((p) => secret.toLowerCase().includes(p))) {
      problems.push({
        variable: "PLATFORM_OPERATOR_SECRET",
        detail: "Looks like a placeholder. The usual failure is a value set during setup and never revisited.",
      })
    }
  }

  return problems
}

function parseOperators(env: NodeJS.ProcessEnv): Set<string> {
  return new Set(
    (env.PLATFORM_OPERATORS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** Is this address Tenure staff? Exact match only — no domain wildcards. */
export function isOperator(email: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!email) return false
  const list = parseOperators(env)
  if (list.size === 0) return false
  return list.has(email.trim().toLowerCase())
}

/**
 * Constant-time-ish comparison of the shared secret.
 *
 * Not because a timing attack on this is likely, but because the alternative
 * costs nothing and the cost of being wrong is every tenant's configuration.
 */
export function secretMatches(provided: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = (env.PLATFORM_OPERATOR_SECRET ?? "").trim()
  if (!expected || operatorConfigProblems(env).length > 0) return false

  const a = Buffer.from(provided.trim())
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false

  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Both halves. Either failing is a refusal, with no hint about which. */
export function authenticateOperator(
  email: string,
  secret: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Both are evaluated regardless, so a wrong address and a wrong secret take
  // the same path and cannot be told apart by an observer.
  const emailOk = isOperator(email, env)
  const secretOk = secretMatches(secret, env)
  return emailOk && secretOk
}
