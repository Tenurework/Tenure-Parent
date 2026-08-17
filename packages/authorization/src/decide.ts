import {
  parsePermissionCheck,
  parsePermissionDecision,
  type PermissionCheck,
  type PermissionDecision,
} from "@tenure/contracts"

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
import { isDelegable, lookupPermission } from "./permission-catalog"
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

      // GE-053-001. `related` means *this* resource or *its* unit, and a request
      // that names no resource identifies neither. Without this the query below
      // is built with no target constraint, so `hasRelationship` matches *any*
      // live relationship of the type and the conferred role becomes
      // tenant-wide — precisely the widening `scope: "related"` exists to make
      // impossible to write, reached through a different door. It is also what
      // made `effectivePermissions` (which asks with no resource) list every
      // relationship-conferred permission as if it were held everywhere.
      if (
        conferred.scope === "related" &&
        !request.resource?.id &&
        !request.resource?.orgUnitId
      ) {
        trace.push({
          step: "relationship",
          outcome: "info",
          detail:
            `"${conferred.roleKey}" is conferred by ${conferred.via} at the related resource, and ` +
            `this request names none. An unidentified resource is not the related one.`,
        })
        continue
      }

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

  /**
   * GE-053-003. Why a delegation that was otherwise usable did not confer it.
   *
   * Recorded rather than returned immediately, because the direct path's own
   * answer is the better one when the principal holds the role themselves: being
   * told "your grant is not confirmed yet" beats being told something about
   * somebody else's delegation.
   */
  let delegationRefusal: { reason: DenyReason; detail: string } | null = null

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

      // GE-053-003 — non-delegable first, and before the delegator's own grants
      // are even looked at. Whether an authority may be borrowed at all is a
      // property of the authority; checking it after the intersection would make
      // the refusal depend on whether the delegator happened to hold it, so the
      // same delegation would be refused for two different reasons.
      if (!isDelegable(request.permission)) {
        delegationRefusal = {
          reason: "DELEGATION_NOT_PERMITTED",
          detail:
            `"${request.permission}" cannot be exercised through a delegation. The delegation from ` +
            `${d.fromPrincipalId} is real and effective; this authority is not borrowable.`,
        }
        continue
      }

      // GE-053-003 — the delegation's own bounds. `scopeCovers` is reused so a
      // delegation scoped to a unit inherits downward exactly as a grant does,
      // and refuses an unplaced resource exactly as a grant does. A second
      // scope rule here would be a second, quieter answer to "where".
      if (d.scope && !scopeCovers(d.scope)) {
        delegationRefusal = {
          reason: "DELEGATION_OUT_OF_SCOPE",
          detail:
            `The delegation from ${d.fromPrincipalId} applies at ` +
            `${d.scope.kind === "tenant" ? "the whole tenant" : `org unit "${d.scope.orgUnitId}"`}, ` +
            `which does not cover ` +
            `${request.resource?.orgUnitId ? `org unit "${request.resource.orgUnitId}"` : "an unplaced resource"}.`,
        }
        continue
      }
      if (d.resourceIds && !(request.resource && d.resourceIds.includes(request.resource.id))) {
        delegationRefusal = {
          reason: "DELEGATION_OUT_OF_SCOPE",
          detail:
            `The delegation from ${d.fromPrincipalId} covers only ` +
            `${d.resourceIds.map((id) => `"${id}"`).join(", ")}, and this request is about ` +
            `${request.resource ? `"${request.resource.id}"` : "no identified resource"}.`,
        }
        continue
      }

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
    // GE-053-003. After the direct answers, before the generic one: a delegation
    // that was refused for exceeding its own bounds is a more specific truth than
    // "no role confers this", and it is the one that tells somebody what to fix.
    if (delegationRefusal) {
      return deny(delegationRefusal.reason, delegationRefusal.detail)
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

    // GE-053-001 — a condition that could not be evaluated denies.
    //
    // Two ways it fails, and both used to read as "did not fire": a condition
    // that throws took the whole decision down with it (a 500 is not a denial —
    // nothing is audited and a retry against a cached page may well succeed),
    // and a condition answering anything other than a boolean — `undefined` from
    // an early return, a Promise from an accidentally-async condition — was
    // falsy and therefore an allow. Both are the same defect: "we could not
    // look" collapsed into "we looked and found nothing". A deny policy that
    // cannot answer is the one case where failing closed is not a judgement
    // call, because the policy exists to stop something.
    let fired: unknown
    try {
      fired = policy.condition(ctx)
    } catch (error) {
      return deny(
        "POLICY_INDETERMINATE",
        `Policy "${policy.id}" could not be evaluated: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          `${policy.description} A deny policy that cannot answer denies.`,
      )
    }
    if (typeof fired !== "boolean") {
      return deny(
        "POLICY_INDETERMINATE",
        `Policy "${policy.id}" answered with ${fired === undefined ? "undefined" : typeof fired}, ` +
          `not a boolean. ${policy.description} A deny policy that cannot answer denies.`,
      )
    }
    if (!fired) continue

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
 * The revision of the policy that decided something.
 *
 * PACK-010-001. `PermissionDecision.policyRevision` exists so a past decision
 * stays explainable — "why was this allowed in March" cannot be answered by
 * re-running today's rules against today's roles. Nothing was producing that
 * field because nothing produced a `PermissionDecision` at all, and inventing a
 * constant to fill it would have been worse than leaving it: a revision that
 * never changes says every decision was made under the same policy, which is
 * exactly the lie the field exists to prevent.
 *
 * So it is derived from the facts the decision actually rested on: the role
 * definitions consulted, the deny policies that could have fired, and the
 * modules that were enabled. Change any of those and the revision changes;
 * change none of them and two decisions a month apart carry the same revision,
 * which is the true statement.
 *
 * FNV-1a over a canonical encoding rather than a cryptographic digest. This
 * package imports nothing — `node:crypto` is not available to every runtime it
 * has to work in, and the property needed here is "different inputs, different
 * label", not collision resistance against an adversary who controls the roles.
 */
export function policyRevisionOf(world: AuthorizationWorld): string {
  const canonical = [
    ...world.roles
      .map((r) => `role:${r.key}=${[...r.permissions].sort().join(",")}|${r.minTier ?? ""}`)
      .sort(),
    ...(world.policies ?? []).map((p) => `policy:${p.id}:${p.effect}:${p.permission}`).sort(),
    ...(world.enabledModules ?? []).map((m) => `module:${m}`).sort(),
  ].join("\n")

  let hash = 0x811c9dc5
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i)
    // >>> 0 keeps it an unsigned 32-bit value; the multiply is the FNV prime,
    // expressed as shifts because 16777619 * hash overflows a double's exact
    // integer range and silently rounds.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return `pol-${hash.toString(16).padStart(8, "0")}`
}

/**
 * Decide a `PermissionCheck`, and answer with a `PermissionDecision`.
 *
 * PACK-010-001, and the reason it exists rather than callers reading `Decision`
 * directly: `Decision` is this package's internal shape — a `DenyReason` union,
 * a trace, the roles that granted it — and it is not the kernel boundary. Two
 * shapes for one concern is the drift "one platform kernel" is meant to prevent,
 * and until this existed the kernel's own `PermissionCheck`/`PermissionDecision`
 * were declared and produced by nothing.
 *
 * The contract earns its place at both ends. `parsePermissionCheck` refuses a
 * permission that is not `<module>.<action>`, so a caller cannot ask about a
 * bare word that would skip module gating; `parsePermissionDecision` refuses a
 * denial with no reason, so a refusal that reached a user as "no" and nothing
 * else could not be constructed here.
 *
 * The rich `Decision` is still returned beside it — the trace is what answers
 * "why can this person not do this", and throwing it away at the boundary would
 * make every support question a code-reading exercise.
 */
export function decideCheck(
  world: AuthorizationWorld,
  check: PermissionCheck,
  options?: { session?: SessionAssurance },
): { decision: Decision; permission: PermissionDecision } {
  const valid = parsePermissionCheck(check)

  const decision = decide(world, {
    principalId: valid.context.actorId,
    tenantId: valid.context.tenantId,
    permission: valid.permission,
    ...(valid.resourceId
      ? { resource: { type: valid.resourceType, id: valid.resourceId, orgUnitId: valid.resourceId } }
      : {}),
    at: valid.context.at,
    ...(options?.session ? { session: options.session } : {}),
  })

  return {
    decision,
    permission: parsePermissionDecision({
      allowed: decision.allowed,
      // An allow carries its reason too. `PermissionDecision` only *requires*
      // one on a denial, but "granted by finance.approver" is the answer to the
      // question somebody asks about an allow, and dropping it would make the
      // allow path the one with no explanation.
      reason: decision.detail,
      policyRevision: policyRevisionOf(world),
    }),
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
