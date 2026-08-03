import type {
  Delegation,
  DenyReason,
  ISODate,
  Membership,
  Policy,
  PolicyContext,
  Principal,
  ResourceRef,
  RoleDefinition,
  RoleGrant,
  TenantEntitlement,
} from "./model"
import {
  checkAssurance,
  requirementFor,
  type AssuranceRequirement,
  type SessionAssurance,
} from "./assurance"
import { lookupPermission } from "./permission-catalog"
import {
  hasRelationship,
  relationshipProblems,
  relationshipHoldsAt,
  type Relationship,
  type RelationshipGrant,
} from "./relationships"

/**
 * Everything a decision reads.
 *
 * Passed in rather than fetched, so a decision is a pure function of stated
 * facts. That is what makes it testable, reproducible in a support session, and
 * — the part that matters most — impossible to accidentally make depend on
 * ambient request state.
 */
export interface AuthorizationWorld {
  principals: readonly Principal[]
  memberships: readonly Membership[]
  roles: readonly RoleDefinition[]
  grants: readonly RoleGrant[]
  delegations?: readonly Delegation[]
  policies?: readonly Policy[]
  entitlements?: readonly TenantEntitlement[]
  /** Modules the tenant runs. A permission from a disabled module is denied. */
  enabledModules?: readonly string[]
  /**
   * Org-unit ancestry, for scope inheritance: a grant on a school covers its
   * clubs. Supplied as a lookup rather than a graph so this package does not
   * depend on the organization model — the caller passes
   * `(id) => snapshot.ancestors(id).map(u => u.id)`.
   */
  ancestorsOf?: (orgUnitId: string) => readonly string[]
  /**
   * Directed, dated relationships — GE-051-002's ReBAC half.
   *
   * A grant answers "where"; a relationship answers "to whom". An advisor's
   * access to the club they advise is not a subtree, and modelling it as one
   * means minting an org unit per person.
   */
  relationships?: readonly Relationship[]
  /**
   * Roles conferred by holding a relationship rather than by being named.
   *
   * One rule covering every advisor, including the one appointed tomorrow, and
   * revoked the instant the relationship ends rather than whenever somebody
   * remembers to remove them.
   */
  relationshipGrants?: readonly RelationshipGrant[]
  /** What each permission demands of the session asking for it. */
  assuranceRequirements?: readonly AssuranceRequirement[]
}

export interface AuthorizationRequest {
  principalId: string
  tenantId: string
  permission: string
  resource?: ResourceRef
  /** Supplied, never read from a clock, so decisions are reproducible. */
  at: ISODate
  /**
   * How well this session is authenticated.
   *
   * Absent means the caller could not describe it, which fails any requirement
   * rather than satisfying it: "we could not tell" is not "yes".
   */
  session?: SessionAssurance
}

export interface TraceStep {
  step: string
  outcome: "pass" | "fail" | "info"
  detail: string
}

export interface Decision {
  allowed: boolean
  reason: DenyReason | "ALLOWED"
  detail: string
  /**
   * What was checked, in order.
   *
   * Not decoration: "why can this person not do this?" is the single most
   * common support question about any permission system, and answering it by
   * reading code and guessing is how support tickets take a week.
   */
  trace: readonly TraceStep[]
  /** Roles that granted it, when allowed. Empty when denied. */
  viaRoles: readonly string[]
  /** Set when the authority was borrowed. */
  viaDelegationFrom?: string
}

const ts = (iso: ISODate): number => Date.parse(iso)

function effective(from: ISODate, to: ISODate | null | undefined, at: number): boolean {
  return ts(from) <= at && (to == null || ts(to) > at)
}

function tierRank(
  entitlement: TenantEntitlement | undefined,
  pack: string,
  tier: string,
): number | null {
  const order = entitlement?.tiers?.[pack]
  if (!order) return null
  const i = order.indexOf(tier)
  return i === -1 ? null : i
}

/**
 * Decide whether a principal may do something, and be able to explain it.
 *
 * The rule, in order. Each step can only deny; nothing later re-opens what an
 * earlier step closed:
 *
 *   0. the principal exists and is not disabled
 *   1. they hold an ACTIVE membership of the tenant, effective now
 *   2. the permission's module is enabled for the tenant
 *   3. some CONFIRMED, effective grant of a role carrying the permission
 *      applies at a scope covering the resource — held directly, or borrowed
 *      through an effective delegation from someone who holds it
 *   4. the tenant's tier is at or above the permission's minimum
 *   5. no deny policy fires
 *
 * Steps 0 and 1 are the ones the architecture's SQL omits, which is why a
 * suspended member keeps every capability there and loses them here.
 */
export function decide(
  world: AuthorizationWorld,
  request: AuthorizationRequest,
): Decision {
  const trace: TraceStep[] = []
  const at = ts(request.at)

  const deny = (reason: DenyReason, detail: string): Decision => {
    trace.push({ step: reason, outcome: "fail", detail })
    return { allowed: false, reason, detail, trace, viaRoles: [] }
  }

  // ── 0. principal ────────────────────────────────────────────────────────
  const principal = world.principals.find((p) => p.id === request.principalId)
  if (!principal) {
    return deny("NO_PRINCIPAL", `No principal "${request.principalId}".`)
  }
  if (principal.disabledAt && ts(principal.disabledAt) <= at) {
    return deny(
      "PRINCIPAL_DISABLED",
      `Principal was disabled at ${principal.disabledAt}; a disabled account holds nothing.`,
    )
  }
  trace.push({ step: "principal", outcome: "pass", detail: `${principal.id} is active.` })

  // ── 1. membership ───────────────────────────────────────────────────────
  const membership = world.memberships.find(
    (m) => m.principalId === principal.id && m.tenantId === request.tenantId,
  )
  if (!membership) {
    return deny("NO_MEMBERSHIP", `Not a member of tenant "${request.tenantId}".`)
  }
  if (membership.state !== "ACTIVE") {
    return deny(
      "MEMBERSHIP_NOT_ACTIVE",
      `Membership state is ${membership.state}. Only ACTIVE members hold capabilities.`,
    )
  }
  if (!effective(membership.effectiveFrom, membership.effectiveTo, at)) {
    return deny(
      "MEMBERSHIP_NOT_ACTIVE",
      `Membership is not effective at ${request.at} (from ${membership.effectiveFrom}` +
        `${membership.effectiveTo ? ` to ${membership.effectiveTo}` : ""}).`,
    )
  }
  trace.push({ step: "membership", outcome: "pass", detail: `ACTIVE in ${request.tenantId}.` })

  // ── 2. module enablement ────────────────────────────────────────────────
  // The module comes from the catalog, not from the text before the first dot.
  // Deriving it made the *name* of a permission decide which module had to be
  // enabled - wrong for `finance.reimbursement.approve`, whose module is
  // `reimbursements` - and silently mishandled a malformed key: anything with no
  // dot counted as platform-level and skipped this gate entirely.
  const definition = lookupPermission(request.permission)
  if (!definition) {
    return deny(
      "UNKNOWN_PERMISSION",
      `"${request.permission}" is not in the permission catalog. An unrecognised permission is ` +
        `denied rather than treated as platform-level, because a typo that skipped the module ` +
        `gate would be indistinguishable from a permission that has none.`,
    )
  }
  const mod = definition.module
  if (mod && world.enabledModules && !world.enabledModules.includes(mod)) {
    return deny(
      "MODULE_NOT_ENABLED",
      `"${request.permission}" belongs to module "${mod}", which this system does not run.`,
    )
  }
  trace.push({
    step: "module",
    outcome: "info",
    detail: mod ? `module "${mod}" is enabled` : "platform-level permission",
  })

  // ── 3. grants, direct then delegated ────────────────────────────────────
  const rolesByKey = new Map(world.roles.map((r) => [r.key, r]))

  const scopeCovers = (scope: RoleGrant["scope"]): boolean => {
    if (scope.kind === "tenant") return true
    const unitId = request.resource?.orgUnitId
    if (!unitId) return false // an org-scoped grant cannot authorise an unplaced resource
    if (unitId === scope.orgUnitId) return true
    // Inheritance downward only: a grant on a school covers its clubs, never
    // the reverse. Getting this backwards would let a club officer act on the
    // whole school.
    return (world.ancestorsOf?.(unitId) ?? []).includes(scope.orgUnitId)
  }

  const grantsFor = (principalId: string) =>
    world.grants.filter((g) => g.principalId === principalId && g.tenantId === request.tenantId)

  interface Match {
    roleKey: string
    role: RoleDefinition
  }

  const matchesFor = (principalId: string): { matches: Match[]; sawRole: boolean; sawScope: boolean } => {
    const matches: Match[] = []
    let sawRole = false
    let sawScope = false

    for (const grant of grantsFor(principalId)) {
      const role = rolesByKey.get(grant.roleKey)
      if (!role || !role.permissions.includes(request.permission)) continue
      sawRole = true

      if (grant.state !== "CONFIRMED") continue
      if (!effective(grant.effectiveFrom, grant.effectiveTo, at)) continue
      sawScope = true

      if (!scopeCovers(grant.scope)) continue
      matches.push({ roleKey: grant.roleKey, role })
    }
    return { matches, sawRole, sawScope }
  }

  // Roles conferred by a relationship, resolved the same way a named grant is.
  //
  // Appended to the direct matches rather than checked afterwards, so an
  // advisor's role goes through the same scope, tier and policy steps as a
  // granted one. A second path that skipped those would be a second, quieter
  // authorization model.
  const relationshipMatches = (): Match[] => {
    const out: Match[] = []
    for (const conferred of world.relationshipGrants ?? []) {
      if (conferred.tenantId !== request.tenantId) continue
      const role = rolesByKey.get(conferred.roleKey)
      if (!role || !role.permissions.includes(request.permission)) continue

      const held =
        conferred.scope === "tenant"
          ? hasRelationship(
              world.relationships ?? [],
              { principalId: principal.id, tenantId: request.tenantId, type: conferred.via },
              request.at,
            )
          : // `related` means *this* resource or *its* org unit, not any. An
            // advisor of one club is not an advisor of the next one.
            hasRelationship(
              world.relationships ?? [],
              {
                principalId: principal.id,
                tenantId: request.tenantId,
                type: conferred.via,
                ...(request.resource?.id ? { toResourceId: request.resource.id } : {}),
              },
              request.at,
            ) ||
            (request.resource?.orgUnitId != null &&
              hasRelationship(
                world.relationships ?? [],
                {
                  principalId: principal.id,
                  tenantId: request.tenantId,
                  type: conferred.via,
                  toOrgUnitId: request.resource.orgUnitId,
                },
                request.at,
              ))

      if (held) out.push({ roleKey: conferred.roleKey, role })
    }
    return out
  }

  const direct = matchesFor(principal.id)
  let matches = [...direct.matches, ...relationshipMatches()]
  let viaDelegationFrom: string | undefined

  if (matches.length === 0) {
    // A delegation is the intersection of what was delegated and what the
    // delegator actually holds *now* — so revoking the delegator's role revokes
    // the borrowed authority in the same instant, with no second write.
    for (const d of world.delegations ?? []) {
      if (d.toPrincipalId !== principal.id || d.tenantId !== request.tenantId) continue
      if (!effective(d.effectiveFrom, d.effectiveTo, at)) {
        trace.push({
          step: "delegation",
          outcome: "info",
          detail: `Delegation from ${d.fromPrincipalId} is not effective at ${request.at}.`,
        })
        continue
      }
      if (d.permissions && !d.permissions.includes(request.permission)) continue

      const borrowed = matchesFor(d.fromPrincipalId)
      if (borrowed.matches.length > 0) {
        matches = borrowed.matches
        viaDelegationFrom = d.fromPrincipalId
        trace.push({
          step: "delegation",
          outcome: "pass",
          detail: `Borrowed from ${d.fromPrincipalId}.`,
        })
        break
      }
    }
  }

  if (matches.length === 0) {
    if (direct.sawRole && !direct.sawScope) {
      return deny(
        "GRANT_NOT_CONFIRMED",
        `A role carrying "${request.permission}" is held, but no grant of it is both CONFIRMED and effective at ${request.at}.`,
      )
    }
    if (direct.sawScope) {
      return deny(
        "OUT_OF_SCOPE",
        `A confirmed role carrying "${request.permission}" is held, but not at a scope covering ` +
          `${request.resource?.orgUnitId ? `org unit "${request.resource.orgUnitId}"` : "this resource"}.`,
      )
    }
    return deny("NO_ROLE_GRANTING", `No role held in this tenant confers "${request.permission}".`)
  }

  trace.push({
    step: "grant",
    outcome: "pass",
    detail: `Granted by ${matches.map((m) => m.roleKey).join(", ")}.`,
  })

  // ── 4. tier ─────────────────────────────────────────────────────────────
  const entitlement = world.entitlements?.find((e) => e.tenantId === request.tenantId)
  for (const m of matches) {
    if (!m.role.minTier || !mod) continue
    const required = tierRank(entitlement, mod, m.role.minTier)
    const current = entitlement?.currentTier?.[mod]
      ? tierRank(entitlement, mod, entitlement.currentTier[mod])
      : null

    // Ordered comparison. String equality here is the defect that revokes a
    // tenant's capabilities the moment they upgrade.
    if (required !== null && (current === null || current < required)) {
      return deny(
        "TIER_TOO_LOW",
        `"${request.permission}" needs "${mod}" tier "${m.role.minTier}"; this tenant is on ` +
          `"${entitlement?.currentTier?.[mod] ?? "(none)"}".`,
      )
    }
  }

  // ── 5. session assurance ────────────────────────────────────────────────
  //
  // After the grant, deliberately. Someone who was never granted the permission
  // should be told that, not sent to re-authenticate for something they still
  // will not be allowed to do — a step-up prompt is also a disclosure that the
  // action exists and is worth prompting for.
  const assurance = checkAssurance(
    requirementFor(world.assuranceRequirements, request.permission),
    request.session,
    request.at,
  )
  if (!assurance.ok) {
    return deny("ASSURANCE_TOO_LOW", assurance.detail ?? "This session is not assured enough.")
  }
  trace.push({
    step: "assurance",
    outcome: "info",
    detail: request.session
      ? `session ${request.session.level}`
      : "no assurance required for this permission",
  })

  // ── 6. policies. deny always wins. ──────────────────────────────────────
  const ctx: PolicyContext = {
    principal,
    tenantId: request.tenantId,
    permission: request.permission,
    resource: request.resource,
    at: request.at,
    principalAttributes: principal.attributes,
    session: request.session,
    // A reader, not the list: a condition cannot iterate relationships it was
    // not meant to see, and cannot forget the effective-date check.
    relatedTo: (query) =>
      hasRelationship(
        world.relationships ?? [],
        {
          principalId: principal.id,
          tenantId: request.tenantId,
          ...(query.type ? { type: query.type as Relationship["type"] } : {}),
          ...(query.toPrincipalId ? { toPrincipalId: query.toPrincipalId } : {}),
          ...(query.toOrgUnitId ? { toOrgUnitId: query.toOrgUnitId } : {}),
          ...(query.toResourceId ? { toResourceId: query.toResourceId } : {}),
        },
        request.at,
      ),
  }

  for (const policy of world.policies ?? []) {
    if (policy.permission !== "*" && policy.permission !== request.permission) continue
    if (policy.effect !== "deny") continue
    if (!policy.condition(ctx)) continue

    const reason: DenyReason = policy.id.startsWith("sod.") ? "SEPARATION_OF_DUTIES" : "POLICY_DENIED"
    return deny(reason, `${policy.description} (policy "${policy.id}")`)
  }
  trace.push({ step: "policy", outcome: "pass", detail: "No deny policy fired." })

  return {
    allowed: true,
    reason: "ALLOWED",
    detail: `Granted by ${matches.map((m) => m.roleKey).join(", ")}${
      viaDelegationFrom ? ` (delegated from ${viaDelegationFrom})` : ""
    }.`,
    trace,
    viaRoles: [...new Set(matches.map((m) => m.roleKey))],
    ...(viaDelegationFrom ? { viaDelegationFrom } : {}),
  }
}

/**
 * Every permission a principal effectively holds in a tenant.
 *
 * Used to build the capability set navigation filters on, so the menu and the
 * routes cannot disagree about what someone can do: both come from `decide`.
 *
 * Resource-dependent permissions are necessarily absent — a permission granted
 * only at one org unit, or gated by a policy that reads the resource, cannot be
 * answered without one. Those are decided per resource by `decide`, which is
 * the correct place: a capability list is a menu, not an authorization.
 */
export function effectivePermissions(
  world: AuthorizationWorld,
  principalId: string,
  tenantId: string,
  at: ISODate,
): Set<string> {
  const out = new Set<string>()
  const candidates = new Set<string>()

  for (const role of world.roles) for (const p of role.permissions) candidates.add(p)

  for (const permission of candidates) {
    const decision = decide(world, { principalId, tenantId, permission, at })
    if (decision.allowed) out.add(permission)
  }
  return out
}
