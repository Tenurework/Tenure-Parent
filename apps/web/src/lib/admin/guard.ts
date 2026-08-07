import "server-only"
import type { InstitutionRole, Prisma } from "@prisma/client"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit-record"
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

  // Written through `recordAuditEvent`, not assembled inline and not through
  // `buildAuditRecord` directly. Every privileged action in the product passes
  // through here, so this is the one audit write worth making impossible to get
  // wrong, and the chokepoint adds three things the bare builder cannot:
  //
  //   · the hash chain — each record commits to this institution's previous
  //     one, so a rewrite performed around the application (psql, a restored
  //     backup) breaks a link that `verifyChain` finds. Calling the builder
  //     directly produced records with no chain position, which is exactly the
  //     state `verifyChain` reports as unchained;
  //   · the release the code was running under, from IMAGE_TAG;
  //   · the money-mode (PAY-000-007), from the ambient tenant scope — so
  //     "which mode did this administrator act in" is answerable from the row
  //     rather than inferred from when it was written.
  //
  // The builder's own guarantees are unchanged and still apply: it requires a
  // tenant, an actor, an action, a resource type and an outcome, refuses a DENY
  // that does not say why, and redacts anything credential-shaped out of
  // `metadata` before it reaches an append-only table.
  await recordAuditEvent({
    institutionId,
    organizationId: opts?.organizationId,
    actor: { principalId: userId, role: adminRoleAt(ctx, institutionId) ?? undefined },
    action: `Admin.${capId}`,
    resourceType: opts?.resourceType ?? "Admin",
    resourceId: opts?.resourceId,
    outcome: allowed ? "ALLOW" : "DENY",
    // A denial here is always the same denial, and saying so beats a null that
    // makes the row unreadable six months later.
    reason: opts?.reason ?? (allowed ? undefined : `Capability "${capId}" not held.`),
    metadata: (opts?.metadata ?? {}) as Record<string, unknown>,
  })

  if (!allowed) throw new Error("You do not have permission for this action")
  return { userId, institutionId, ctx }
}
