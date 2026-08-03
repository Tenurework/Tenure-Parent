/**
 * What authorization is decided from.
 *
 * The shape here is chosen to make a specific class of defect impossible rather
 * than merely discouraged. The architecture's own effective-permission SQL
 * filters role assignments on `state='CONFIRMED'` and effective dates and never
 * touches membership state or `principal.disabled_at` — so a SUSPENDED member
 * and a disabled principal keep every capability, forever. It ships a
 * `MEMBERSHIP_SUSPENDED` deny reason with no code path that can produce it.
 *
 * Here, membership state and principal status are conditions (0) and (1) of the
 * rule, checked before any grant is looked at, and each has a deny reason a test
 * asserts is reachable.
 */

export type ISODate = string

export interface Principal {
  id: string
  /** Set means the account is disabled platform-wide. Beats every grant. */
  disabledAt?: ISODate | null
  /** A support principal's access is time-boxed and always audited. */
  kind?: "user" | "service" | "support" | "system"
}

export type MembershipState = "ACTIVE" | "INVITED" | "SUSPENDED" | "LEFT"

export interface Membership {
  principalId: string
  tenantId: string
  state: MembershipState
  effectiveFrom: ISODate
  effectiveTo?: ISODate | null
}

/** Where a grant applies. `tenant` covers everything; `orgUnit` covers a subtree. */
export type GrantScope = { kind: "tenant" } | { kind: "orgUnit"; orgUnitId: string }

export type GrantState = "PENDING" | "CONFIRMED" | "REVOKED"

export interface RoleDefinition {
  key: string
  /** Permission keys this role confers. Namespaced `<module>.<action>`. */
  permissions: readonly string[]
  /**
   * Tier this role's permissions require the tenant to be on, per permission.
   *
   * Ordered comparison, not string equality. The architecture compares tiers
   * with `i.tier = c.min_tier OR i.tier = 'enterprise'`, so a tenant upgraded
   * from `budget` to `ledger` matches neither and loses every budget-tier
   * capability the moment you sell them the upgrade.
   */
  minTier?: string
}

export interface RoleGrant {
  principalId: string
  tenantId: string
  roleKey: string
  scope: GrantScope
  state: GrantState
  effectiveFrom: ISODate
  effectiveTo?: ISODate | null
}

/**
 * One principal acting with another's authority, for a bounded time.
 *
 * `permissions` narrows the delegation; absent means everything the delegator
 * holds. A delegation can never widen: the delegate gets the intersection of
 * what was delegated and what the delegator actually has at decision time, so
 * revoking the delegator's role revokes the delegate's borrowed authority in
 * the same instant.
 */
export interface Delegation {
  fromPrincipalId: string
  toPrincipalId: string
  tenantId: string
  permissions?: readonly string[]
  effectiveFrom: ISODate
  effectiveTo?: ISODate | null
}

/** Attributes a condition can read. Deliberately plain data. */
export interface ResourceRef {
  type: string
  id: string
  /** The org unit that owns it, for scope checks. */
  orgUnitId?: string
  /** Who created it — the input separation-of-duties rules need most. */
  createdByPrincipalId?: string
  /** Anything else a condition wants. Never used for scope. */
  attributes?: Readonly<Record<string, unknown>>
}

export interface PolicyContext {
  principal: Principal
  tenantId: string
  permission: string
  resource?: ResourceRef
  /** Supplied by the caller so a decision is reproducible in a test. */
  at: ISODate
}

/**
 * A named, deterministic rule that can allow or deny.
 *
 * `deny` wins over any allow, always. There is no ordering to reason about and
 * no "last rule wins" — a policy that forbids something forbids it.
 *
 * Conditions are functions here rather than a DSL because there is no rules
 * engine yet and a half-built expression language is worse than TypeScript. The
 * constraint that matters is that they are pure and deterministic; when the
 * rules engine lands, these become its first test cases.
 */
export interface Policy {
  id: string
  /** Permission this applies to, or "*" for all. */
  permission: string
  effect: "allow" | "deny"
  /** Why, in a sentence — surfaced in the decision trace and in support views. */
  description: string
  condition: (ctx: PolicyContext) => boolean
}

/** What a tenant has bought. Gates modules and tiered permissions. */
export interface TenantEntitlement {
  tenantId: string
  /** Ordered tiers, lowest first. Position is the rank. */
  tiers?: Readonly<Record<string, readonly string[]>>
  /** Current tier per pack, e.g. { finance: "ledger" }. */
  currentTier?: Readonly<Record<string, string>>
  entitlements?: readonly string[]
}

export const DENY_REASONS = [
  "UNKNOWN_PERMISSION",
  "NO_PRINCIPAL",
  "PRINCIPAL_DISABLED",
  "NO_MEMBERSHIP",
  "MEMBERSHIP_NOT_ACTIVE",
  "NO_ROLE_GRANTING",
  "GRANT_NOT_CONFIRMED",
  "GRANT_NOT_EFFECTIVE",
  "OUT_OF_SCOPE",
  "MODULE_NOT_ENABLED",
  "TIER_TOO_LOW",
  "POLICY_DENIED",
  "SEPARATION_OF_DUTIES",
  "DELEGATION_NOT_EFFECTIVE",
] as const

export type DenyReason = (typeof DENY_REASONS)[number]
