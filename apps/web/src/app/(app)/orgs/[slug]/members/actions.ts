"use server"

import { revalidatePath } from "next/cache"
import type { AssignmentStatus, Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { canManageRoster, getUserContext, isOseDirector } from "@/lib/rbac"
import { notifyUsers } from "@/lib/notify"

/**
 * Gate a roster mutation. On denial we audit the DENY and throw; on allow we
 * DON'T audit yet — the caller writes the audit once it knows the target
 * identity, so every roster event records WHO was affected (not just that
 * "some" change happened). Returns the org, actor id, and the loaded context.
 */
async function requireRosterManager(slug: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")

  const org = await db.organization.findUnique({ where: { slug } })
  if (!org) throw new Error("Organization not found")

  const ctx = await getUserContext(session.user.id)
  const allowed = canManageRoster(ctx, org)

  if (!allowed) {
    await db.auditEvent.create({
      data: {
        institutionId: org.institutionId,
        organizationId: org.id,
        actorId: session.user.id,
        action: "Roster.Manage",
        resourceType: "RoleAssignment",
        outcome: "DENY",
      },
    })
    throw new Error("You do not have permission to manage this roster")
  }

  return { org, userId: session.user.id, ctx }
}

/** Record an allowed roster mutation with full target identity in metadata. */
async function auditRoster(
  org: { id: string; institutionId: string },
  actorId: string,
  resourceId: string,
  metadata: Prisma.InputJsonValue
) {
  await db.auditEvent.create({
    data: {
      institutionId: org.institutionId,
      organizationId: org.id,
      actorId,
      action: "Roster.Manage",
      resourceType: "RoleAssignment",
      resourceId,
      outcome: "ALLOW",
      metadata,
    },
  })
}

/** Assign a user (by email) to a role seat. Creates the user if unknown. */
export async function assignMember(slug: string, formData: FormData) {
  const { org, userId } = await requireRosterManager(slug)

  const email = String(formData.get("email") ?? "").trim().toLowerCase()
  const roleId = String(formData.get("roleId") ?? "")
  const status = String(formData.get("status") ?? "ACTIVE") as AssignmentStatus

  if (!email || !roleId) throw new Error("Email and role are required")
  if (!["SHADOW", "ACTIVE"].includes(status)) throw new Error("Invalid status")

  const role = await db.role.findFirst({
    where: { id: roleId, organizationId: org.id },
  })
  if (!role) throw new Error("Role not found in this organization")

  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: { email, name: email.split("@")[0] },
  })

  const existing = await db.roleAssignment.findFirst({
    where: { userId: user.id, roleId, status: { in: ["SHADOW", "ACTIVE"] } },
  })
  if (existing) throw new Error("This person already holds that role")

  const assignment = await db.roleAssignment.create({ data: { userId: user.id, roleId, status } })
  await auditRoster(org, userId, assignment.id, {
    action: "assign",
    targetUserId: user.id,
    targetEmail: email,
    roleId,
    roleName: role.name,
    status,
  })
  await notifyUsers([user.id], {
    title:
      status === "SHADOW"
        ? `You're the incoming ${role.name} of ${org.name}`
        : `You've been added to ${org.name} as ${role.name}`,
    body:
      status === "SHADOW"
        ? "Shadow access is read-only until your term begins — your seat's memory is already available."
        : undefined,
    href: `/orgs/${slug}/members`,
  })
  revalidatePath(`/orgs/${slug}/members`)
}

/**
 * Transition an assignment along the handoff lifecycle:
 * SHADOW → ACTIVE (term begins) or ACTIVE → ALUMNI (term ends, access revoked).
 */
export async function transitionAssignment(slug: string, formData: FormData) {
  const { org, userId, ctx } = await requireRosterManager(slug)

  const assignmentId = String(formData.get("assignmentId") ?? "")
  const to = String(formData.get("to") ?? "") as AssignmentStatus

  const assignment = await db.roleAssignment.findFirst({
    where: { id: assignmentId, role: { organizationId: org.id } },
    include: { role: { select: { id: true, name: true, scope: true } } },
  })
  if (!assignment) throw new Error("Assignment not found")

  const legal =
    (assignment.status === "SHADOW" && to === "ACTIVE") ||
    (assignment.status === "ACTIVE" && to === "ALUMNI")
  if (!legal) throw new Error(`Cannot move ${assignment.status} to ${to}`)

  // Zero-president guard: don't let the club's only active president end their
  // own term (or be ended) with no active successor in place — that leaves the
  // club leaderless (only OSE could then manage the roster). A successor must
  // be ACTIVE first, unless an OSE Director is making the change.
  if (assignment.status === "ACTIVE" && to === "ALUMNI" && assignment.role.scope === "PRESIDENT") {
    const otherActivePresidents = await db.roleAssignment.count({
      where: {
        status: "ACTIVE",
        id: { not: assignment.id },
        role: { organizationId: org.id, scope: "PRESIDENT" },
      },
    })
    if (otherActivePresidents === 0 && !isOseDirector(ctx, org.institutionId))
      throw new Error(
        "You're the club's only active president. Add your successor and activate them first so the club is never left without a leader. (An OSE Director can make this change for you if needed.)"
      )
  }

  await db.roleAssignment.update({
    where: { id: assignment.id },
    data: { status: to, ...(to === "ALUMNI" ? { endDate: new Date() } : {}) },
  })
  await auditRoster(org, userId, assignment.id, {
    action: "transition",
    targetUserId: assignment.userId,
    roleId: assignment.role.id,
    roleName: assignment.role.name,
    fromStatus: assignment.status,
    toStatus: to,
  })
  await notifyUsers([assignment.userId], {
    title:
      to === "ACTIVE"
        ? `Your term at ${org.name} has begun`
        : `Your term at ${org.name} has wrapped up`,
    body:
      to === "ACTIVE"
        ? "You've got full access to your seat now — dive in whenever you're ready."
        : "Thank you for everything you did here. Your day-to-day access ends now, but the knowledge you leave behind stays ready for whoever comes next.",
    href: to === "ACTIVE" ? `/orgs/${slug}/members` : undefined,
  })
  revalidatePath(`/orgs/${slug}/members`)
}
