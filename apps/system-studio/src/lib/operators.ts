/**
 * Who may use the System Studio, and as what.
 *
 * Two environment variables, both required, both failing closed:
 *
 *   PLATFORM_OPERATORS        `email:role` pairs, comma separated
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
 *
 * ## Why the grammar changed (STUDIO-020-005)
 *
 * `PLATFORM_OPERATORS` used to be a bare list of addresses and `isOperator`
 * returned a boolean, so a Support Engineer and a Platform Super Admin saw
 * byte-identical surfaces — including every tenant's published configuration
 * and every mutating control on it. The bible names nine role families; none of
 * them existed anywhere in `apps/system-studio/src`, so nothing could be gated
 * to a FinOps Analyst or a break-glass Emergency Responder.
 *
 * An entry with no `:role`, or with a role that is not one of the nine, is
 * REFUSED by `operatorConfigProblems` rather than defaulted. A default is how
 * everybody quietly ends up an administrator, and the correct behaviour for a
 * console whose allowlist cannot be read is to serve nobody.
 *
 * This is a breaking configuration change on purpose. A deployment carrying the
 * old grammar renders "Not configured" and prints the exact rewrite, which is a
 * refusal an operator can act on in a minute — as against a silent promotion
 * nobody would ever notice.
 */

/**
 * Values that are obviously not secrets.
 *
 * Matched against the WHOLE value, not as substrings. Substring matching was the
 * first attempt and it rejected `a-long-enough-operator-secret-2026` because it
 * contains "secret" — a legitimate value refused with a message accusing it of
 * being a placeholder. A rule that rejects correct input while explaining
 * nothing is worse than no rule.
 */
const PLACEHOLDERS = [
  "changeme",
  "change-me",
  "password",
  "secret",
  "tenure",
  "test",
  "placeholder",
  "operator-secret",
  "platform-operator-secret",
]

/** Strip separators and digits, so "changeme-123" is still "changeme". */
const normalise = (v: string) => v.toLowerCase().replace(/[^a-z]/g, "")

/**
 * Distinct characters, as a cheap entropy floor.
 *
 * Catches the other way a secret is trivially weak — "aaaaaaaa…" or
 * "abababab…" — which a placeholder list never will.
 */
const distinctChars = (v: string) => new Set(v).size

/* ─────────────────────────────────────────────────────── STUDIO-020-005 ──
 * The nine operator role families.
 *
 * The order and the names are the bible's, transliterated to kebab case so an
 * environment variable can carry them without quoting. A tenth family is a
 * decision, not a typo, so an unrecognised value is refused rather than
 * tolerated.
 */
export const OPERATOR_ROLES = [
  "platform-super-admin",
  "tenant-implementation-lead",
  "cloud-platform-engineer",
  "security-administrator",
  "release-manager",
  "support-engineer",
  "finops-analyst",
  "auditor-read-only",
  "emergency-responder",
] as const

export type OperatorRole = (typeof OPERATOR_ROLES)[number]

/**
 * What a permission is ABOUT — the resource half of STUDIO-020-006's semantic
 * pair. Deliberately the console's own vocabulary rather than AWS action names,
 * per STUDIO-080-004: an operator decides whether someone may change a tenant's
 * configuration, not whether they may call `dynamodb:PutItem`.
 */
export const OPERATOR_RESOURCES = [
  "platform",
  "cost",
  "tenant",
  "tenant.configuration",
  "tenant.lifecycle",
  "aws.console",
] as const

export type OperatorResource = (typeof OPERATOR_RESOURCES)[number]

/**
 * What may be DONE to it.
 *
 * `approve` is separate from `write` because four-eyes is the whole point of
 * having it: a role that may approve a lifecycle move and a role that may make
 * one are different roles, and collapsing them makes the gate decorative.
 * `break-glass` is separate from `read` for the same reason — opening a console
 * link and assuming an emergency permission set are not the same act.
 */
export const OPERATOR_VERBS = ["read", "write", "approve", "break-glass"] as const

export type OperatorVerb = (typeof OPERATOR_VERBS)[number]

export type OperatorPermission = `${OperatorResource}:${OperatorVerb}`

/**
 * Resources that mean nothing without a tenant.
 *
 * `authorizeOperator` denies when one of these is asked for with no tenant in
 * scope. A configuration permission that is not about a particular tenant is a
 * permission over all of them, which is exactly the confusion this exists to
 * stop.
 */
export const TENANT_SCOPED_RESOURCES: ReadonlySet<OperatorResource> = new Set<OperatorResource>([
  "tenant.configuration",
  "tenant.lifecycle",
])

/**
 * What each family holds. The whole authorization model, in one readable table.
 *
 * Written out per role rather than composed from a hierarchy on purpose: a
 * hierarchy makes "what can a Support Engineer do" a question you answer by
 * following inheritance, and the answer people give from memory is the one that
 * turns out to be wrong. Every grant is listed where somebody reviewing this
 * file will see it.
 *
 * Notable separations, each of which was previously impossible to express:
 *
 *   - `cost:read` belongs to the FinOps Analyst, the Auditor and the Super
 *     Admin only. A Cloud Platform Engineer does not need the fleet's bill to
 *     do their job, and the FinOps Center is where a spend commitment is
 *     approved.
 *   - `aws.console:*` belongs to the Cloud Platform Engineer and the Emergency
 *     Responder (STUDIO-080-003: deep links only for authorized break-glass and
 *     platform engineers). Only the Emergency Responder holds `break-glass`.
 *   - `auditor-read-only` holds nothing but reads. That is the assertion the
 *     role's whole name is making, and a test drives the DOM to prove the
 *     mutating controls are ABSENT rather than merely disabled.
 */
export const OPERATOR_GRANTS = {
  "platform-super-admin": [
    "platform:read",
    "cost:read",
    "tenant:read",
    "tenant:write",
    "tenant.configuration:read",
    "tenant.configuration:write",
    "tenant.configuration:approve",
    "tenant.lifecycle:read",
    "tenant.lifecycle:write",
    "tenant.lifecycle:approve",
    "aws.console:read",
  ],
  "tenant-implementation-lead": [
    "platform:read",
    "tenant:read",
    "tenant:write",
    "tenant.configuration:read",
    "tenant.configuration:write",
    "tenant.lifecycle:read",
  ],
  "cloud-platform-engineer": [
    "platform:read",
    "tenant:read",
    "tenant:write",
    "tenant.configuration:read",
    "tenant.lifecycle:read",
    "tenant.lifecycle:write",
    "aws.console:read",
  ],
  "security-administrator": [
    "platform:read",
    "tenant:read",
    "tenant.configuration:read",
    "tenant.configuration:approve",
    "tenant.lifecycle:read",
  ],
  "release-manager": [
    "platform:read",
    "tenant:read",
    "tenant.configuration:read",
    "tenant.configuration:approve",
    "tenant.lifecycle:read",
    "tenant.lifecycle:approve",
  ],
  "support-engineer": ["platform:read", "tenant:read", "tenant.configuration:read"],
  "finops-analyst": ["platform:read", "cost:read", "tenant:read"],
  "auditor-read-only": [
    "platform:read",
    "cost:read",
    "tenant:read",
    "tenant.configuration:read",
    "tenant.lifecycle:read",
  ],
  "emergency-responder": [
    "platform:read",
    "tenant:read",
    "tenant.lifecycle:read",
    "tenant.lifecycle:write",
    "aws.console:read",
    "aws.console:break-glass",
  ],
} as const satisfies Record<OperatorRole, readonly OperatorPermission[]>

function holds(role: OperatorRole | null | undefined, permission: OperatorPermission): boolean {
  if (!role) return false
  const grants: readonly OperatorPermission[] = OPERATOR_GRANTS[role]
  return grants.includes(permission)
}

/**
 * May this role SEE this surface?
 *
 * Read-only sugar over the same table `mayAct` uses, so a surface cannot be
 * visible to somebody the action layer would refuse.
 */
export function mayView(role: OperatorRole | null | undefined, surface: OperatorResource): boolean {
  return holds(role, `${surface}:read`)
}

/** May this role DO this? Deny by default: an unknown role holds nothing. */
export function mayAct(
  role: OperatorRole | null | undefined,
  action: OperatorPermission,
): boolean {
  return holds(role, action)
}

export interface OperatorConfigProblem {
  variable: string
  detail: string
}

export interface OperatorConfigOptions {
  requireSharedSecret?: boolean
}

/** One parsed `email:role` entry. */
export interface OperatorEntry {
  email: string
  role: OperatorRole
}

interface ParsedOperators {
  entries: readonly OperatorEntry[]
  problems: readonly OperatorConfigProblem[]
}

const ROLE_LIST = OPERATOR_ROLES.join(", ")

function parseOperators(env: NodeJS.ProcessEnv): ParsedOperators {
  const entries: OperatorEntry[] = []
  const problems: OperatorConfigProblem[] = []
  const seen = new Set<string>()

  const items = (env.PLATFORM_OPERATORS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)

  for (const item of items) {
    const parts = item.split(":")
    if (parts.length !== 2) {
      // Refused, never defaulted. An address with no role used to be every
      // authority in the console; giving it one silently is how a Support
      // Engineer ends up publishing configuration.
      problems.push({
        variable: "PLATFORM_OPERATORS",
        detail:
          `"${item}" names no role. Every entry is "email:role" — one of ${ROLE_LIST}. ` +
          `No role is refused rather than defaulted, because a default here makes everybody an administrator.`,
      })
      continue
    }

    const email = parts[0].trim().toLowerCase()
    const role = parts[1].trim().toLowerCase()

    if (!email) {
      problems.push({
        variable: "PLATFORM_OPERATORS",
        detail: `"${item}" has a role and no address.`,
      })
      continue
    }
    if (!(OPERATOR_ROLES as readonly string[]).includes(role)) {
      problems.push({
        variable: "PLATFORM_OPERATORS",
        detail: `"${item}" names the role "${role}", which is not one of ${ROLE_LIST}.`,
      })
      continue
    }
    if (seen.has(email)) {
      // Two roles for one address is ambiguous, and the tempting resolutions —
      // first wins, last wins, union — are three different answers nobody
      // decided between. Refuse and let a person say which.
      problems.push({
        variable: "PLATFORM_OPERATORS",
        detail: `"${email}" is listed twice with different roles. One address, one role.`,
      })
      continue
    }

    seen.add(email)
    entries.push({ email, role: role as OperatorRole })
  }

  return { entries, problems }
}

/** Problems with the operator configuration. Empty means usable. */
export function operatorConfigProblems(
  env: NodeJS.ProcessEnv = process.env,
  options: OperatorConfigOptions = {},
): OperatorConfigProblem[] {
  const problems: OperatorConfigProblem[] = []

  const parsed = parseOperators(env)
  problems.push(...parsed.problems)
  if (parsed.entries.length === 0 && parsed.problems.length === 0) {
    problems.push({
      variable: "PLATFORM_OPERATORS",
      detail:
        "Not set, or empty. No one can sign in, which is the correct default and not a usable state. " +
        `Each entry is "email:role" — one of ${ROLE_LIST}.`,
    })
  }

  const rawMode = (env.STUDIO_AUTH_MODE ?? "").trim().toLowerCase()
  const requireSharedSecret =
    options.requireSharedSecret ?? (rawMode === "cognito" ? false : true)

  if (requireSharedSecret) {
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
      if (PLACEHOLDERS.includes(normalise(secret))) {
        problems.push({
          variable: "PLATFORM_OPERATOR_SECRET",
          detail: `Is a placeholder ("${secret}"). The usual failure is a value set during setup and never revisited.`,
        })
      }
      if (secret.length >= 24 && distinctChars(secret) < 10) {
        problems.push({
          variable: "PLATFORM_OPERATOR_SECRET",
          detail: `Only ${distinctChars(secret)} distinct characters. Long is not the same as unguessable.`,
        })
      }
    }
  }

  return problems
}

/**
 * Which family this address belongs to, or null.
 *
 * Exact match only — no domain wildcards. Returns null for an address whose
 * entry did not parse, so a malformed line grants nothing rather than granting
 * whatever the parser guessed.
 */
export function roleOf(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): OperatorRole | null {
  if (!email) return null
  const wanted = email.trim().toLowerCase()
  if (!wanted) return null
  for (const entry of parseOperators(env).entries) {
    if (entry.email === wanted) return entry.role
  }
  return null
}

/**
 * Is this address Tenure staff?
 *
 * The AUTHENTICATION half, and nothing more. It answers "do we know who this
 * is", which is what the sign-in form and the approver lookup need. What they
 * may then do is `authorizeOperator` in `./authorize`, which is what every page
 * and every server action calls.
 */
export function isOperator(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return roleOf(email, env) !== null
}

/**
 * Constant-time-ish comparison of the shared secret.
 *
 * Not because a timing attack on this is likely, but because the alternative
 * costs nothing and the cost of being wrong is every tenant's configuration.
 */
export function secretMatches(provided: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = (env.PLATFORM_OPERATOR_SECRET ?? "").trim()
  if (!expected || operatorConfigProblems(env, { requireSharedSecret: true }).length > 0) {
    return false
  }

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
