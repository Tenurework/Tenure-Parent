/**
 * GE-030-003 — the identity-connection registry.
 *
 * Which identity providers a tenant may authenticate through, which domains it
 * has actually proved it owns, and whether any of that still works today.
 *
 * ## The one invariant everything else serves
 *
 * From the architecture bible, §9.1:
 *
 *   > The login resolver starts from verified tenant domain/subdomain, tenant
 *   > slug, signed invitation, prior secure session, or normalized work email
 *   > used only as a **discovery hint**. It returns safe branding and allowed
 *   > methods through an opaque transaction. It **never reveals whether a
 *   > person exists or grants membership from an email domain**.
 *
 * A verified domain answers "which tenant's sign-in page should I show". It
 * does not answer "is this person allowed in", and the gap between those two
 * is the whole of this module's security value. Owning `rochester.edu` and
 * having an account at Rochester are different facts, and a system that
 * conflates them lets anyone with an address at a verified domain in.
 *
 * So `discoverTenantByDomain` returns a tenant id and nothing else, and
 * `loginMethods` returns what may be *offered* — never who exists.
 *
 * ## Secrets are references
 *
 * Every credential here is an ARN or a parameter name. The registry is read by
 * the console, projected into login discovery, and serialised into artifacts;
 * a client secret that lives in it lives in all three. `noSecretValues` is
 * asserted by test rather than by convention.
 */

export type ConnectionKind =
  /** Enterprise SAML 2.0. */
  | "SAML"
  /** Enterprise OIDC. */
  | "OIDC"
  /** Cognito's own user pool, invitation-only by default. */
  | "COGNITO_LOCAL"

export type ConnectionStatus =
  /** Configured but never successfully used. Not offered. */
  | "PENDING"
  | "ACTIVE"
  /** Turned off by an operator or the tenant. Not offered, not deleted. */
  | "DISABLED"
  /** Turned off by the platform — a compromised or misissued credential. */
  | "REVOKED"

/**
 * A credential the connection depends on, by reference.
 *
 * `expiresAt` is on the reference rather than fetched, because the registry has
 * to answer "does this break next month" without holding the certificate. A
 * null expiry means the credential does not expire (a Cognito pool), not that
 * nobody checked — those are recorded differently.
 */
export interface CredentialRef {
  /** What it is, for a human reading a health report. */
  purpose: "saml-signing-certificate" | "oidc-client-secret" | "scim-token"
  /** Secrets Manager ARN or SSM parameter name. Never a value. */
  ref: string
  /** ISO timestamp, or null when the credential genuinely does not expire. */
  expiresAt: string | null
  /** When it was last rotated, so a stale-but-unexpired credential is visible. */
  lastRotatedAt: string | null
}

export interface IdentityConnection {
  connectionId: string
  tenantId: string
  kind: ConnectionKind
  status: ConnectionStatus

  /** Human-readable, shown on the sign-in page. "Sign in with Rochester SSO". */
  displayName: string

  /**
   * The issuer this connection trusts. Compared exactly at callback time.
   * Empty for COGNITO_LOCAL, which has no external issuer.
   */
  issuer: string

  /** Cognito placement. One pool may host many app clients; a tenant gets its own. */
  poolId: string
  appClientId: string

  credentials: readonly CredentialRef[]

  createdAt: string
  updatedAt: string
}

export type DomainState =
  /** A claim. Proves nothing and resolves nothing. */
  | "PENDING"
  | "VERIFIED"
  /** Ownership lapsed or was withdrawn. Stops resolving immediately. */
  | "REVOKED"

export interface VerifiedDomain {
  domain: string
  tenantId: string
  state: DomainState
  /** How ownership was proved. DNS TXT is the only method today. */
  method: "dns-txt"
  /** The token the tenant published. Not a secret — it is in public DNS. */
  challenge: string
  verifiedAt: string | null
}

export interface RegistryProblem {
  field: string
  reason: string
  detail: string
}

/**
 * Normalise a domain for comparison.
 *
 * Lowercased and stripped of a trailing dot, because `Rochester.EDU` and
 * `rochester.edu.` are the same domain and a registry that treats them as three
 * lets the same name be claimed three times.
 */
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, "")
}

/**
 * Whether a hostname belongs to a verified domain.
 *
 * Exact match, or a **label-boundary** subdomain match. The distinction is the
 * point: a naive `endsWith` makes `evil-rochester.edu` match `rochester.edu`,
 * which hands an attacker who registers that name a route to Rochester's
 * sign-in page — branded, and looking exactly right.
 */
export function domainMatches(hostname: string, verified: string): boolean {
  const host = normalizeDomain(hostname)
  const base = normalizeDomain(verified)
  if (!host || !base) return false
  if (host === base) return true
  return host.endsWith(`.${base}`)
}

export function validateDomain(record: VerifiedDomain): readonly RegistryProblem[] {
  const problems: RegistryProblem[] = []
  const domain = normalizeDomain(record.domain)

  // Deliberately strict. A domain that reaches this registry has been typed by
  // an operator, and a permissive pattern here is a permissive pattern in the
  // thing that decides which tenant a stranger is shown.
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    problems.push({ field: "domain", reason: "invalid", detail: "not a hostname" })
  }

  if (record.state === "VERIFIED" && !record.verifiedAt) {
    problems.push({
      field: "verifiedAt",
      reason: "required",
      // A domain marked verified with no record of when cannot be audited, and
      // "when did we start trusting this" is the question asked after a
      // hijacked domain is discovered.
      detail: "a verified domain must record when it was verified",
    })
  }

  if (record.state === "PENDING" && !record.challenge) {
    problems.push({
      field: "challenge",
      reason: "required",
      detail: "there is nothing for the tenant to publish",
    })
  }

  return problems
}

/**
 * Which tenant a hostname belongs to.
 *
 * `null` for anything not currently verified — a pending claim proves nothing
 * and a revoked one has stopped being true. Returns the tenant id **only**: it
 * is a routing answer, and anything richer would start being an answer about
 * the tenant's users.
 *
 * Ambiguity is refused rather than resolved. Two tenants verified for one
 * domain is a state the registry must not have (see `findDomainConflicts`), and
 * silently picking the first would let whichever was written first hijack the
 * other's sign-in.
 */
export function discoverTenantByDomain(
  hostname: string,
  domains: readonly VerifiedDomain[],
): string | null {
  const matches = domains.filter(
    (d) => d.state === "VERIFIED" && domainMatches(hostname, d.domain),
  )
  if (matches.length === 0) return null

  const tenants = new Set(matches.map((d) => d.tenantId))
  if (tenants.size > 1) return null

  return matches[0].tenantId
}

/**
 * Domains claimed as VERIFIED by more than one tenant.
 *
 * A conflict is not a validation error on any single record — each looks fine
 * alone — so it can only be found by looking at the set. Left unfound, the
 * first tenant to be written wins every lookup, which is a hijack that nobody
 * had to attack anything to perform.
 */
export function findDomainConflicts(
  domains: readonly VerifiedDomain[],
): readonly { domain: string; tenantIds: readonly string[] }[] {
  const byDomain = new Map<string, Set<string>>()
  for (const d of domains) {
    if (d.state !== "VERIFIED") continue
    const key = normalizeDomain(d.domain)
    const set = byDomain.get(key) ?? new Set<string>()
    set.add(d.tenantId)
    byDomain.set(key, set)
  }
  return [...byDomain.entries()]
    .filter(([, tenants]) => tenants.size > 1)
    .map(([domain, tenants]) => ({ domain, tenantIds: [...tenants].sort() }))
    .sort((a, b) => a.domain.localeCompare(b.domain))
}

export type ConnectionHealth = "HEALTHY" | "EXPIRING_SOON" | "EXPIRED" | "NOT_OFFERED"

/** Thirty days. Long enough that a certificate renewal fits in a change window. */
export const EXPIRY_WARNING_DAYS = 30

export interface HealthReport {
  connectionId: string
  health: ConnectionHealth
  /** Why, in a form a report can group by. */
  reason:
    | "ok"
    | "credential-expired"
    | "credential-expiring"
    | "status-pending"
    | "status-disabled"
    | "status-revoked"
  /** Which credential is the problem, when one is. */
  credential?: CredentialRef["purpose"]
  /** Whole days until the soonest expiry; null when nothing expires. */
  daysUntilExpiry: number | null
}

/**
 * Whether a connection still works, and for how much longer.
 *
 * Status is checked before expiry: a revoked connection with a fresh
 * certificate is still revoked, and reporting it as HEALTHY-but-not-offered
 * would put "revoked" and "fine" in the same bucket on a fleet health page.
 */
export function connectionHealth(connection: IdentityConnection, now: Date): HealthReport {
  const base = { connectionId: connection.connectionId }

  if (connection.status !== "ACTIVE") {
    return {
      ...base,
      health: "NOT_OFFERED",
      reason:
        connection.status === "PENDING"
          ? "status-pending"
          : connection.status === "DISABLED"
            ? "status-disabled"
            : "status-revoked",
      daysUntilExpiry: null,
    }
  }

  let soonest: { ref: CredentialRef; days: number } | null = null
  for (const credential of connection.credentials) {
    if (!credential.expiresAt) continue
    const expiry = Date.parse(credential.expiresAt)
    // An unparseable expiry is treated as expired rather than ignored. A
    // credential whose expiry nobody can read is one nobody can promise works,
    // and failing closed on a login method is an inconvenience — failing open
    // is an outage discovered by users.
    const days = Number.isNaN(expiry)
      ? -1
      : Math.floor((expiry - now.getTime()) / 86_400_000)
    if (!soonest || days < soonest.days) soonest = { ref: credential, days }
  }

  if (!soonest) return { ...base, health: "HEALTHY", reason: "ok", daysUntilExpiry: null }

  if (soonest.days < 0) {
    return {
      ...base,
      health: "EXPIRED",
      reason: "credential-expired",
      credential: soonest.ref.purpose,
      daysUntilExpiry: soonest.days,
    }
  }

  if (soonest.days <= EXPIRY_WARNING_DAYS) {
    return {
      ...base,
      health: "EXPIRING_SOON",
      reason: "credential-expiring",
      credential: soonest.ref.purpose,
      daysUntilExpiry: soonest.days,
    }
  }

  return { ...base, health: "HEALTHY", reason: "ok", daysUntilExpiry: soonest.days }
}

/**
 * What the sign-in page may offer.
 *
 * The safe projection, and the counterpart to `loginProjection` in the tenant
 * registry. It carries what a stranger at a sign-in page is allowed to learn:
 * that this tenant exists (they already typed its URL), what it is called, and
 * which buttons to draw.
 *
 * It carries **no issuer, no pool id, no app client id and no credential
 * reference**. Those are configuration, and configuration on a public page is a
 * map of the estate — an issuer names the customer's own IdP, and an app client
 * id is half of what an attacker needs to craft an authorization request that
 * looks like ours.
 *
 * An EXPIRING_SOON connection is still offered: it works today, and removing it
 * early would take a working tenant offline to prevent a future problem.
 */
export interface OfferedMethod {
  kind: ConnectionKind
  displayName: string
}

export function loginMethods(
  connections: readonly IdentityConnection[],
  now: Date,
): readonly OfferedMethod[] {
  return connections
    .filter((c) => {
      const health = connectionHealth(c, now).health
      return health === "HEALTHY" || health === "EXPIRING_SOON"
    })
    .map((c) => ({ kind: c.kind, displayName: c.displayName }))
    // Deterministic order, so the sign-in page does not reshuffle its buttons
    // between requests — which looks like a bug and trains people to click
    // wherever the button was last time.
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.displayName.localeCompare(b.displayName))
}

/**
 * Connections that need attention, soonest first.
 *
 * `NOT_OFFERED` is excluded: a disabled connection is not an operational
 * problem, and mixing it in means the list an operator reads every morning is
 * mostly noise, which is how the one that matters gets missed.
 */
export function connectionsNeedingAttention(
  connections: readonly IdentityConnection[],
  now: Date,
): readonly HealthReport[] {
  return connections
    .map((c) => connectionHealth(c, now))
    .filter((r) => r.health === "EXPIRED" || r.health === "EXPIRING_SOON")
    .sort((a, b) => (a.daysUntilExpiry ?? 0) - (b.daysUntilExpiry ?? 0))
}

export function validateConnection(connection: IdentityConnection): readonly RegistryProblem[] {
  const problems: RegistryProblem[] = []

  if (!connection.connectionId.trim()) {
    problems.push({ field: "connectionId", reason: "required", detail: "cannot be empty" })
  }
  if (!connection.tenantId.trim()) {
    problems.push({
      field: "tenantId",
      reason: "required",
      // A connection belonging to no tenant is a connection any tenant could
      // be offered.
      detail: "an unowned connection could be offered to any tenant",
    })
  }

  // An external connection with no issuer cannot validate a callback: the
  // issuer is what the token is checked against, and an empty one either
  // rejects everything or, worse, is skipped by a caller that finds it falsy.
  if (connection.kind !== "COGNITO_LOCAL" && !connection.issuer.trim()) {
    problems.push({
      field: "issuer",
      reason: "required",
      detail: `${connection.kind} has no issuer to validate a callback against`,
    })
  }

  if (connection.kind !== "COGNITO_LOCAL" && !/^https:\/\//.test(connection.issuer)) {
    problems.push({
      field: "issuer",
      reason: "invalid",
      detail: "an issuer must be https — an http issuer's metadata can be rewritten in transit",
    })
  }

  if (!connection.appClientId.trim() || !connection.poolId.trim()) {
    problems.push({
      field: "appClientId",
      reason: "required",
      detail: "a connection with no pool or app client cannot be reached",
    })
  }

  for (const credential of connection.credentials) {
    if (!/^(arn:aws:secretsmanager:|\/tenure\/)/.test(credential.ref)) {
      problems.push({
        field: "credentials.ref",
        reason: "invalid",
        // The check that keeps a value out of the registry. A real secret does
        // not look like an ARN or a parameter path, so requiring one of those
        // shapes refuses a pasted certificate before it is stored.
        detail: `${credential.purpose} must be a Secrets Manager ARN or an SSM parameter path, not a value`,
      })
    }
  }

  const kinds = new Set(connection.credentials.map((c) => c.purpose))
  if (connection.kind === "SAML" && !kinds.has("saml-signing-certificate")) {
    problems.push({
      field: "credentials",
      reason: "required",
      detail: "a SAML connection with no signing certificate cannot verify an assertion",
    })
  }
  if (connection.kind === "OIDC" && !kinds.has("oidc-client-secret")) {
    problems.push({
      field: "credentials",
      reason: "required",
      detail: "an OIDC connection with no client secret cannot complete a code exchange",
    })
  }

  return problems
}
