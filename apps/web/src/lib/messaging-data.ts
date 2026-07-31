import "server-only"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { messagingTier } from "@/lib/messaging"

/**
 * Who this user may address, per the strict hierarchy (BP):
 * OSE → institution; President → own clubs + presidents + OSE;
 * VP → own clubs + OSE; Member → own clubs' active board only.
 *
 * A plain helper, deliberately not a server action. It reads Organization,
 * InstitutionMembership and RoleAssignment and takes the user it answers for as
 * an argument — exported from a `"use server"` module, Next would publish it as
 * an action endpoint any signed-in client could POST directly, outside the
 * tenant scope its callers open. Every caller (the messages actions, the
 * compose page, the club roster page) runs it inside `withTenantScope`.
 */
export async function getAllowedRecipients(userId: string) {
  const ctx = await getUserContext(userId)
  const tier = messagingTier(ctx)
  if (tier === "NONE") return []

  const myOrgIds = ctx.orgRoles
    .filter((r) => r.status === "ACTIVE")
    .map((r) => r.organizationId)

  const institutionIds = ctx.institutionRoles.length
    ? ctx.institutionRoles.map((m) => m.institutionId)
    : (
        await db.organization.findMany({
          where: { id: { in: myOrgIds } },
          select: { institutionId: true },
        })
      ).map((o) => o.institutionId)

  const users = new Map<string, { id: string; name: string | null; email: string | null; label: string }>()
  const add = (u: { id: string; name: string | null; email: string | null }, label: string) => {
    if (u.id !== userId && !users.has(u.id)) users.set(u.id, { ...u, label })
  }

  // OSE staff are reachable by every tier except MEMBER
  if (tier !== "MEMBER") {
    const staff = await db.institutionMembership.findMany({
      where: { institutionId: { in: institutionIds } },
      include: { user: { select: { id: true, name: true, email: true } } },
    })
    for (const s of staff) add(s.user, s.role === "OSE_DIRECTOR" ? "OSE Director" : "OSE")
  }

  if (tier === "OSE") {
    const seats = await db.roleAssignment.findMany({
      where: {
        status: { in: ["ACTIVE", "SHADOW"] },
        role: { organization: { institutionId: { in: institutionIds } } },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        role: { include: { organization: { select: { name: true } } } },
      },
    })
    for (const s of seats) add(s.user, `${s.role.name} · ${s.role.organization.name}`)
    return [...users.values()]
  }

  // Own clubs
  const scopeFilter =
    tier === "MEMBER" ? { in: ["PRESIDENT", "FUNCTIONAL"] as ("PRESIDENT" | "FUNCTIONAL")[] } : undefined
  const clubmates = await db.roleAssignment.findMany({
    where: {
      status: "ACTIVE",
      role: { organizationId: { in: myOrgIds }, ...(scopeFilter ? { scope: scopeFilter } : {}) },
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      role: { include: { organization: { select: { name: true } } } },
    },
  })
  for (const c of clubmates) add(c.user, `${c.role.name} · ${c.role.organization.name}`)

  if (tier === "PRESIDENT") {
    const presidents = await db.roleAssignment.findMany({
      where: {
        status: "ACTIVE",
        role: { scope: "PRESIDENT", organization: { institutionId: { in: institutionIds } } },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        role: { include: { organization: { select: { name: true } } } },
      },
    })
    for (const p of presidents) add(p.user, `President · ${p.role.organization.name}`)
  }

  return [...users.values()]
}
