import {
  connectionHealth,
  loginMethods,
  validateConnection,
  type IdentityConnection,
  type OfferedMethod,
} from "@tenure/provisioning"

/**
 * GE-030-003 — this cell's own identity connections, as registry records.
 *
 * `auth.ts` decided whether to offer Okta with an inline
 * `!!OKTA_ISSUER && startsWith("https://")`. That is three of the checks the
 * identity registry makes and none of the others, and the gap is the point: an
 * issuer that parses is not the same as a connection that is configured,
 * enabled, and holding a credential that has not expired. A registry that only
 * describes *other* people's connections is a registry nothing exercises.
 *
 * So the running application's own providers are described as
 * `IdentityConnection` records and gated by the same `loginMethods` a tenant's
 * sign-in page will use. One code path, exercised on every boot.
 *
 * The records are built from the environment rather than stored, because for
 * this cell the environment IS the registry — the connection is configured by
 * the task definition and Secrets Manager, and a second copy in a table would
 * be a second answer to the same question.
 */

/**
 * The environment this reads, narrowed to what it actually reads.
 *
 * Deliberately not `NodeJS.ProcessEnv`: that type demands NODE_ENV, which has
 * nothing to do with an identity connection and forces every test to supply it
 * to describe a connection. A parameter
 * typed as the whole environment also invites reaching for one more variable
 * later without anyone noticing the surface grew.
 */
export type CellEnvironment = Readonly<Record<string, string | undefined>>

/** A far-future expiry for a credential whose rotation this cell does not track. */
const NOT_TRACKED = null

/**
 * What this cell is configured to accept.
 *
 * Returns records, not booleans, so the caller can ask *why* something is not
 * offered rather than only whether it is.
 */
export function cellConnections(env: CellEnvironment = process.env): IdentityConnection[] {
  const connections: IdentityConnection[] = []
  const now = new Date().toISOString()

  if (env.OKTA_ISSUER) {
    connections.push({
      connectionId: "cell-okta",
      // The cell's own connection is not a tenant's. Named so a health report
      // does not have to guess.
      tenantId: "platform",
      kind: "OIDC",
      status: "ACTIVE",
      displayName: "Okta",
      issuer: env.OKTA_ISSUER,
      poolId: "okta",
      appClientId: env.OKTA_CLIENT_ID ?? "",
      credentials: [
        {
          purpose: "oidc-client-secret",
          // The registry requires a reference rather than a value, and this is
          // the reference: the environment variable is populated from this
          // secret at task start. The value never appears here.
          ref: env.OKTA_CLIENT_SECRET_REF ?? "/tenure/okta/client-secret",
          expiresAt: env.OKTA_CLIENT_SECRET_EXPIRES_AT ?? NOT_TRACKED,
          lastRotatedAt: env.OKTA_CLIENT_SECRET_ROTATED_AT ?? null,
        },
      ],
      createdAt: now,
      updatedAt: now,
    })
  }

  if (env.AUTH_DEV_LOGIN === "true") {
    connections.push({
      connectionId: "cell-dev-login",
      tenantId: "platform",
      kind: "COGNITO_LOCAL",
      // ACTIVE, because it genuinely is. Whether it SHOULD be is a separate
      // question, answered by `devLoginRisk` below — marking it PENDING to
      // express disapproval would make the registry disagree with reality.
      status: "ACTIVE",
      displayName: "Pilot demo user",
      issuer: "",
      poolId: "local",
      appClientId: "dev-login",
      credentials: [],
      createdAt: now,
      updatedAt: now,
    })
  }

  return connections
}

/**
 * Whether the Okta connection may be registered as a provider.
 *
 * The whole reason this file exists. `auth.ts` asked whether the issuer looked
 * like a URL; this asks whether the registry considers the connection usable,
 * which additionally covers a missing client id, a credential that is a pasted
 * value rather than a reference, and an expired secret. Each of those produced
 * a provider that NextAuth would happily register and that would fail at the
 * callback — visibly to a user, invisibly to anyone watching.
 */
export function oktaIsUsable(env: CellEnvironment = process.env): boolean {
  const okta = cellConnections(env).find((c) => c.connectionId === "cell-okta")
  if (!okta) return false
  if (validateConnection(okta).length > 0) return false
  const { health } = connectionHealth(okta, new Date())
  // EXPIRING_SOON is still usable — it works today, and refusing it early would
  // take working sign-in away to prevent a future problem.
  return health === "HEALTHY" || health === "EXPIRING_SOON"
}

/** What a sign-in page may draw, through the same projection a tenant's will use. */
export function cellLoginMethods(env: CellEnvironment = process.env): readonly OfferedMethod[] {
  return loginMethods(cellConnections(env), new Date())
}

/**
 * Why a configured connection is not being offered.
 *
 * Returned rather than logged, so a caller can put it somewhere a person will
 * see it. A connection silently absent from a sign-in page is the failure mode
 * that gets reported as "SSO is broken" with no further detail.
 */
export function connectionRefusals(
  env: CellEnvironment = process.env,
): readonly { connectionId: string; problems: readonly string[] }[] {
  return cellConnections(env)
    .map((c) => {
      const problems = validateConnection(c).map((p) => `${p.field}: ${p.detail}`)
      const health = connectionHealth(c, new Date())
      if (health.health === "EXPIRED") {
        problems.push(`credentials: ${health.credential ?? "a credential"} has expired`)
      }
      return { connectionId: c.connectionId, problems }
    })
    .filter((r) => r.problems.length > 0)
}
