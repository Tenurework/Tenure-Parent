import { db } from "@/lib/db"
import { liveDelegations } from "@/lib/authz/delegation-expiry"
import { getUserContext, type UserContext } from "@/lib/rbac"

/**
 * A user's approval context augmented with the roles of anyone who has an ACTIVE
 * delegation TO them in this institution — so delegated gate authority is
 * honoured both when deciding which actions to SHOW (detail page) and when
 * EXECUTING one (actOnApproval). The actor's own identity is preserved (so
 * isRequester stays correct); only the role authority is borrowed.
 *
 * Returns the merged context plus the delegators, so the caller can record /
 * display "on behalf of". When the user holds no delegations this is a no-op.
 */
export async function effectiveApprovalContext(
  userId: string,
  ctx: UserContext,
  institutionId: string
): Promise<{ ctx: UserContext; delegators: { id: string; name: string }[] }> {
  const granted = await db.approvalDelegation.findMany({
    where: { toUserId: userId, revokedAt: null, institutionId },
    include: { fromUser: { select: { id: true, name: true, email: true } } },
  })
  // PAY-150-008. `revokedAt: null` is "nobody withdrew it", which is not the
  // same as "it is still in force". Bible §17 requires delegation with an
  // expiry, and until this filter existed the authority a president lent for a
  // week in September was still lent in June. `liveDelegations` applies the
  // maximum lifetime — and refuses a row it cannot date rather than treating an
  // unreadable grant date as a recent one.
  const delegations = liveDelegations(granted)
  if (delegations.length === 0) return { ctx, delegators: [] }

  const institutionRoles = [...ctx.institutionRoles]
  const orgRoles = [...ctx.orgRoles]
  const delegators: { id: string; name: string }[] = []
  for (const d of delegations) {
    const dctx = await getUserContext(d.fromUserId)
    institutionRoles.push(...dctx.institutionRoles)
    orgRoles.push(...dctx.orgRoles)
    delegators.push({ id: d.fromUserId, name: d.fromUser.name ?? d.fromUser.email ?? "a delegator" })
  }
  return { ctx: { userId, institutionRoles, orgRoles }, delegators }
}
