import type { Dated, ISODate } from "./model"

/**
 * GE-051-002 — the relationships authorization has to be able to read.
 *
 * Bible §9.2 lists ReBAC alongside RBAC and ABAC: "organization, seat, manager,
 * owner, participant, advisor, overseer, and collaboration relationships."
 *
 * The engine could not express any of them. A grant covers a tenant or an org
 * unit subtree, which answers "where" and never "who to". The questions this
 * exists for are the ones a scope cannot phrase:
 *
 *   - a manager may read their report's expenses, and nobody else's
 *   - an advisor may see the club they advise, which is not a subtree
 *   - the person who raised a request may withdraw it, whatever their seat
 *   - a participant may read the event they are on, not every event
 *
 * Modelling those as scopes means minting an org unit per person, which is how
 * an organization chart becomes an access-control list nobody can audit.
 *
 * ## Relationships are directed and typed
 *
 * `MANAGES` from A to B is not `REPORTS_TO` from B to A wearing a different
 * name — the platform stores one and derives the other, and storing both is how
 * they drift. Only the outward form is declared here.
 */

/**
 * The closed set.
 *
 * Closed for the same reason permissions are: two names for one relationship is
 * two answers to "may this person see that", and the second one is always the
 * one nobody remembered to check.
 */
export const RELATIONSHIP_TYPES = [
  /** A manages B. Covers B's work, not B's person. */
  "MANAGES",
  /** A holds a seat in the unit B. The ordinary membership relationship. */
  "HOLDS_SEAT_IN",
  /** A created or owns the resource B. */
  "OWNS",
  /** A takes part in B — an event, a project, a conversation. */
  "PARTICIPATES_IN",
  /** A advises B without being inside it. A staff advisor to a club. */
  "ADVISES",
  /** A oversees B on behalf of the institution. Broader than advises. */
  "OVERSEES",
  /** A and B work together on something neither owns. */
  "COLLABORATES_WITH",
] as const

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number]

/**
 * One directed, dated relationship.
 *
 * Dated because every one of them ends. An advisor who left in June is not an
 * advisor in July, and a relationship without an end date is a permission
 * nobody will ever revoke — the failure the seat model exists to prevent, one
 * level down.
 */
export interface Relationship extends Dated {
  type: RelationshipType
  /** The principal the relationship is *from*. */
  fromPrincipalId: string
  /** The tenant it holds in. Relationships never cross tenants. */
  tenantId: string
  /** The other end: a principal, an org unit, or a resource. Exactly one. */
  toPrincipalId?: string | null
  toOrgUnitId?: string | null
  toResourceId?: string | null
}

export type RelationshipProblem =
  | "NO_TARGET"
  | "TWO_TARGETS"
  | "ENDS_BEFORE_IT_STARTS"
  | "UNKNOWN_TYPE"

/**
 * What is wrong with a relationship, or nothing.
 *
 * `TWO_TARGETS` matters more than it looks: a relationship pointing at both a
 * person and a unit reads as either, so two call sites resolve it two ways and
 * one of them is wrong. Refusing it keeps the question single-valued.
 */
export function relationshipProblems(relationship: Relationship): readonly RelationshipProblem[] {
  const problems: RelationshipProblem[] = []
  const targets = [
    relationship.toPrincipalId,
    relationship.toOrgUnitId,
    relationship.toResourceId,
  ].filter((t) => t != null)

  if (targets.length === 0) problems.push("NO_TARGET")
  if (targets.length > 1) problems.push("TWO_TARGETS")
  if (!(RELATIONSHIP_TYPES as readonly string[]).includes(relationship.type)) {
    problems.push("UNKNOWN_TYPE")
  }
  if (relationship.effectiveTo != null) {
    const from = Date.parse(relationship.effectiveFrom)
    const to = Date.parse(relationship.effectiveTo)
    if (!Number.isNaN(from) && !Number.isNaN(to) && to < from) {
      problems.push("ENDS_BEFORE_IT_STARTS")
    }
  }
  return problems
}

/** Live at an instant. Half-open: starts count, ends do not. */
export function relationshipHoldsAt(relationship: Relationship, at: ISODate): boolean {
  const instant = Date.parse(at)
  if (Number.isNaN(instant)) return false
  const from = Date.parse(relationship.effectiveFrom)
  if (Number.isNaN(from) || instant < from) return false
  if (relationship.effectiveTo == null) return true
  const to = Date.parse(relationship.effectiveTo)
  return Number.isNaN(to) ? true : instant < to
}

export interface RelationshipQuery {
  principalId: string
  tenantId: string
  type?: RelationshipType
  toPrincipalId?: string
  toOrgUnitId?: string
  toResourceId?: string
}

/**
 * Does this principal hold a live relationship matching the query?
 *
 * A malformed relationship never matches. It could be read charitably — take
 * the first non-null target and carry on — and that is exactly how a
 * relationship pointing at two things grants access to the wrong one. It is
 * dropped, and `relationshipProblems` is how it gets found before it is stored.
 */
export function hasRelationship(
  relationships: readonly Relationship[],
  query: RelationshipQuery,
  at: ISODate,
): boolean {
  return relationships.some((relationship) => {
    if (relationship.fromPrincipalId !== query.principalId) return false
    if (relationship.tenantId !== query.tenantId) return false
    if (query.type && relationship.type !== query.type) return false
    if (relationshipProblems(relationship).length > 0) return false
    if (!relationshipHoldsAt(relationship, at)) return false

    if (query.toPrincipalId != null && relationship.toPrincipalId !== query.toPrincipalId) {
      return false
    }
    if (query.toOrgUnitId != null && relationship.toOrgUnitId !== query.toOrgUnitId) return false
    if (query.toResourceId != null && relationship.toResourceId !== query.toResourceId) return false
    return true
  })
}

/**
 * Everyone A manages, directly.
 *
 * Deliberately not transitive. A skip-level manager reading their reports'
 * reports' records is a decision somebody should make on purpose, and deriving
 * it from the chart makes it the default — which at the top of an organization
 * means one person can read everything, having been granted nothing.
 */
export function directReportsOf(
  relationships: readonly Relationship[],
  managerId: string,
  tenantId: string,
  at: ISODate,
): readonly string[] {
  const out = new Set<string>()
  for (const relationship of relationships) {
    if (relationship.type !== "MANAGES") continue
    if (relationship.fromPrincipalId !== managerId) continue
    if (relationship.tenantId !== tenantId) continue
    if (relationshipProblems(relationship).length > 0) continue
    if (!relationshipHoldsAt(relationship, at)) continue
    if (relationship.toPrincipalId) out.add(relationship.toPrincipalId)
  }
  return [...out].sort()
}

/**
 * A grant conferred by holding a relationship rather than by being named.
 *
 * This is what makes ReBAC part of the decision instead of a lookup a policy
 * happens to do. The grant says "whoever advises this unit holds this role in
 * it" — one rule covering every advisor, including the one appointed tomorrow,
 * and revoked the instant the relationship ends rather than whenever somebody
 * remembers to remove them.
 */
export interface RelationshipGrant {
  tenantId: string
  /** Relationship that confers it. */
  via: RelationshipType
  roleKey: string
  /**
   * Scope the conferred role applies at.
   *
   * `related` means the thing at the other end of the relationship — the unit
   * advised, the resource owned. `tenant` would make an advisor of one club an
   * advisor of all of them, which is the mistake this shape exists to make
   * impossible to write by accident.
   */
  scope: "related" | "tenant"
}
