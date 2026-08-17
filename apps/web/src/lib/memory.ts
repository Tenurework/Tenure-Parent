import { canViewOrg, isOse, type UserContext } from "@/lib/rbac"
import { inheritsToSuccessor, type SeatMemoryCard } from "@/lib/people/seat-memory-boundary"

/**
 * Memory visibility (blueprint §Documents & Memory):
 *  - Org-wide cards (no roleId): anyone who can view the org.
 *  - Role-scoped cards: the seat's current holder, the club's ACTIVE president,
 *    and OSE.
 *  - The seat's INCOMING holder (status SHADOW — this is the handoff) sees only
 *    what the seat may pass on. HCM-040-003: see `people/seat-memory-boundary.ts`.
 *    ALUMNI keep no access; the record persists for their successors.
 */
export function canSeeMemoryCard(
  ctx: UserContext,
  card: SeatMemoryCard,
  org: { id: string; institutionId: string }
): boolean {
  if (!canViewOrg(ctx, org)) return false
  if (!card.roleId) return true
  if (isOse(ctx, org.institutionId)) return true

  const holdsSeatNow = ctx.orgRoles.some(
    (r) => r.roleId === card.roleId && r.status === "ACTIVE"
  )
  const isActivePresident = ctx.orgRoles.some(
    (r) =>
      r.organizationId === org.id && r.scope === "PRESIDENT" && r.status === "ACTIVE"
  )
  if (holdsSeatNow || isActivePresident) return true

  const isIncomingHolder = ctx.orgRoles.some(
    (r) => r.roleId === card.roleId && r.status === "SHADOW"
  )
  if (!isIncomingHolder) return false

  /**
   * HCM-040-003. The handoff window is not "everything the predecessor could
   * read". This branch used to be `status === "ACTIVE" || status === "SHADOW"`,
   * which handed an incoming officer the seat's `CREDENTIAL` cards — "Login /
   * access info" — and every card labelled `restricted`, before their term had
   * begun. The Bible forbids exactly that in §3.4 and §17.
   *
   * Decided per card, by classification, in `seat-memory-boundary.ts`. A card
   * the seat may pass on transfers; a credential is reissued to the successor
   * rather than handed over (so: not readable here); anything controlled waits
   * for a transition, and anything unclassifiable is refused with a reason.
   */
  return inheritsToSuccessor(card).action === "TRANSFER"
}
