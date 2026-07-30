import type { ConversationType } from "@prisma/client"
import { isOse, type UserContext } from "@/lib/rbac"

/**
 * Messaging access rules (blueprint §Messaging):
 *  - DIRECT_MESSAGE   explicit participants only
 *  - BOARD_CHANNEL    the club's SHADOW/ACTIVE members read, ACTIVE post;
 *                     OSE may read (advisory oversight)
 *  - APPROVAL_THREAD  requester + club president + OSE — mirrors who can
 *                     see the approval itself; participants are added as
 *                     they engage
 *  - OSE_BROADCAST    OSE posts, everyone at the institution reads
 *  - PRESIDENT_NETWORK / SYSTEM — reserved for later phases
 */

export interface ConversationLike {
  type: ConversationType
  institutionId: string
  organizationId: string | null
  participantUserIds: string[]
}

function orgStatus(ctx: UserContext, organizationId: string | null) {
  if (!organizationId) return null
  const roles = ctx.orgRoles.filter((r) => r.organizationId === organizationId)
  if (roles.some((r) => r.status === "ACTIVE")) return "ACTIVE"
  if (roles.some((r) => r.status === "SHADOW")) return "SHADOW"
  return null
}

export function canReadConversation(ctx: UserContext, convo: ConversationLike): boolean {
  if (convo.participantUserIds.includes(ctx.userId)) return true
  switch (convo.type) {
    case "BOARD_CHANNEL":
      return orgStatus(ctx, convo.organizationId) !== null || isOse(ctx, convo.institutionId)
    case "OSE_BROADCAST":
      return (
        isOse(ctx, convo.institutionId) ||
        ctx.orgRoles.some((r) => r.status === "ACTIVE" || r.status === "SHADOW")
      )
    case "APPROVAL_THREAD":
      return isOse(ctx, convo.institutionId)
    default:
      return false
  }
}

/**
 * Messaging hierarchy tier (BP: "strictest hierarchy" for who may message whom):
 *  OSE        → anyone at the institution
 *  PRESIDENT  → own clubs' members + other active presidents + OSE
 *  FUNCTIONAL → own clubs' members + OSE
 *  MEMBER     → own clubs' ACTIVE board (president + VPs) only
 *  NONE       → cannot compose (shadow/alumni/outsiders)
 */
export type MessagingTier = "OSE" | "PRESIDENT" | "FUNCTIONAL" | "MEMBER" | "NONE"

export function messagingTier(ctx: UserContext): MessagingTier {
  if (ctx.institutionRoles.length > 0) return "OSE"
  const active = ctx.orgRoles.filter((r) => r.status === "ACTIVE")
  if (active.some((r) => r.scope === "PRESIDENT")) return "PRESIDENT"
  if (active.some((r) => r.scope === "FUNCTIONAL")) return "FUNCTIONAL"
  if (active.some((r) => r.scope === "MEMBER")) return "MEMBER"
  return "NONE"
}

export function canPostToConversation(ctx: UserContext, convo: ConversationLike): boolean {
  switch (convo.type) {
    case "DIRECT_MESSAGE":
      return convo.participantUserIds.includes(ctx.userId)
    case "BOARD_CHANNEL":
      return orgStatus(ctx, convo.organizationId) === "ACTIVE" || isOse(ctx, convo.institutionId)
    case "APPROVAL_THREAD":
      return (
        convo.participantUserIds.includes(ctx.userId) || isOse(ctx, convo.institutionId)
      )
    case "OSE_BROADCAST":
      return isOse(ctx, convo.institutionId)
    default:
      return false
  }
}
