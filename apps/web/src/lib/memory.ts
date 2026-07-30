import { canViewOrg, isOse, type UserContext } from "@/lib/rbac"

/**
 * Memory visibility (blueprint §Documents & Memory):
 *  - Org-wide cards (no roleId): anyone who can view the org.
 *  - Role-scoped cards: the seat's current and incoming holders (ACTIVE or
 *    SHADOW — this is the handoff), the club's ACTIVE president, and OSE.
 *    ALUMNI keep no access; the record persists for their successors.
 */
export function canSeeMemoryCard(
  ctx: UserContext,
  card: { roleId: string | null },
  org: { id: string; institutionId: string }
): boolean {
  if (!canViewOrg(ctx, org)) return false
  if (!card.roleId) return true
  if (isOse(ctx, org.institutionId)) return true

  const holdsSeat = ctx.orgRoles.some(
    (r) =>
      r.roleId === card.roleId && (r.status === "ACTIVE" || r.status === "SHADOW")
  )
  const isActivePresident = ctx.orgRoles.some(
    (r) =>
      r.organizationId === org.id && r.scope === "PRESIDENT" && r.status === "ACTIVE"
  )
  return holdsSeat || isActivePresident
}
