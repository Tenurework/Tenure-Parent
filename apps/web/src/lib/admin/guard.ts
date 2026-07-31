import "server-only"
import type { InstitutionRole, Prisma } from "@prisma/client"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext, type UserContext } from "@/lib/rbac"
import { adminRoleAt, hasCapability, isAdmin, type CapabilityId } from "./capabilities"

/**
 * Read-side gate for admin pages: resolves the acting admin or bounces a
 * non-admin to a 404. Does not audit (reads are not privileged operations).
 */
export async function requireAdminContext(): Promise<{
  userId: string
  ctx: UserContext
  institutionId: string
  role: InstitutionRole
}> {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")
  const ctx = await getUserContext(session.user.id)
  if (!isAdmin(ctx)) notFound()
  const institutionId = ctx.institutionRoles[0].institutionId
  return { userId: session.user.id, ctx, institutionId, role: adminRoleAt(ctx, institutionId)! }
}

interface CapabilityContext {
  userId: string
  institutionId: string
  ctx: UserContext
}

/**
 * The single gate for every administration command. Resolves the acting admin,
 * checks the capability at the target institution, and writes an audit row for
 * both allow and deny — so the admin console's "override anything" power is
 * always accountable. Throws on denial (after auditing it).
 */
export async function requireCapability(
  capId: CapabilityId,
  opts?: {
    institutionId?: string
    organizationId?: string
    resourceType?: string
    resourceId?: string
    reason?: string
    /** Target identity / before-after detail — recorded on the audit row so
     *  every privileged action says WHO was affected and HOW, not just that
     *  "some" grant/revoke/transfer happened. */
    metadata?: Prisma.InputJsonValue
  }
): Promise<CapabilityContext> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")
  const userId = session.user.id
  const ctx = await getUserContext(userId)

  const institutionId = opts?.institutionId ?? ctx.institutionRoles[0]?.institutionId
  if (!institutionId) throw new Error("You are not an administrator")

  const allowed = hasCapability(ctx, capId, institutionId)

  await db.auditEvent.create({
    data: {
      institutionId,
      actorId: userId,
      actorRole: adminRoleAt(ctx, institutionId) ?? undefined,
      action: `Admin.${capId}`,
      resourceType: opts?.resourceType ?? "Admin",
      resourceId: opts?.resourceId,
      organizationId: opts?.organizationId,
      outcome: allowed ? "ALLOW" : "DENY",
      reason: opts?.reason,
      ...(opts?.metadata !== undefined ? { metadata: opts.metadata } : {}),
    },
  })

  if (!allowed) throw new Error("You do not have permission for this action")
  return { userId, institutionId, ctx }
}
