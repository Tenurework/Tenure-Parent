import "server-only"

/**
 * Who is Tenure staff.
 *
 * The System Studio is an internal surface: it shows every tenant's system
 * definition, and will eventually change them. That is a different population
 * from every role the application already models — an OSE Director is a
 * *customer* administrator with full authority inside their own institution and
 * none at all over the platform. Gating the Studio on any existing role would
 * hand a customer the console that configures other customers.
 *
 * So platform operators are named explicitly, in `PLATFORM_OPERATORS`, as a
 * comma-separated list of email addresses.
 *
 * Fails closed in every direction that matters:
 *
 *   * unset or empty            → nobody is an operator, and the Studio 404s
 *   * no signed-in email        → not an operator
 *   * comparison is exact       → case-normalised, whitespace-trimmed, but not
 *                                 fuzzy; no domain wildcards, because
 *                                 "@tenure.com" as a rule is one typo'd DNS
 *                                 record away from being everybody
 *
 * This is deliberately a small, boring control rather than a role model. A
 * platform-operator *role*, with grants and audit, belongs with the control
 * plane; an env list is honest about being the interim, and is one grep away
 * from being found and replaced.
 */

function allowlist(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.PLATFORM_OPERATORS ?? ""
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  )
}

/** True when this email belongs to Tenure staff. Fails closed. */
export function isPlatformOperator(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!email) return false
  const list = allowlist(env)
  if (list.size === 0) return false
  return list.has(email.trim().toLowerCase())
}

/** How many operators are configured. For the "not configured" diagnostic. */
export function platformOperatorCount(env: NodeJS.ProcessEnv = process.env): number {
  return allowlist(env).size
}
