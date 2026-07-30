"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import type { AssignmentStatus, InstitutionRole, OrgCategory, RoleScope } from "@prisma/client"
import { db } from "@/lib/db"
import { auth } from "@/lib/auth"
import { getUserContext, isOseDirector } from "@/lib/rbac"
import { requireCapability } from "@/lib/admin/guard"
import { ORG_CATEGORIES, chartClub, clubCode, uniquePositionCode } from "@/lib/clubs"
import { directory } from "@/lib/directory"
import { notifyUsers } from "@/lib/notify"

const INSTITUTION_ROLES: InstitutionRole[] = ["OSE_DIRECTOR", "OSE_STAFF", "OSE_ADVISOR"]

/** "OSE_DIRECTOR" → "Director" (human, for notification copy). */
function roleWord(role: InstitutionRole): string {
  return { OSE_DIRECTOR: "Director", OSE_STAFF: "Staff", OSE_ADVISOR: "Advisor" }[role]
}

function revalidateAdmin(slug?: string) {
  revalidatePath("/admin")
  revalidatePath("/admin/clubs")
  revalidatePath("/admin/people")
  if (slug) {
    revalidatePath(`/admin/clubs/${slug}`)
    revalidatePath(`/orgs/${slug}/members`)
  }
  revalidatePath("/orgs")
}

async function orgOrThrow(organizationId: string) {
  const org = await db.organization.findUnique({ where: { id: organizationId } })
  if (!org) throw new Error("Club not found")
  return org
}

/** Resolve (and upsert) a login user for a directory person, so a seat holder
 *  can eventually authenticate. Name comes from the directory when known. */
async function upsertHolder(email: string, name?: string) {
  const clean = email.trim().toLowerCase()
  if (!clean) throw new Error("A person is required")
  const entry = name ? null : await directory().getByEmail(clean)
  return db.user.upsert({
    where: { email: clean },
    update: {},
    create: { email: clean, name: name?.trim() || entry?.name || clean.split("@")[0] },
  })
}

// ─── Clubs ──────────────────────────────────────────────────────────────────

export async function adminCharterClub(formData: FormData) {
  const { userId, institutionId } = await requireCapability("club.create")
  const name = String(formData.get("name") ?? "")
  const category = String(formData.get("category") ?? "") as OrgCategory
  const description = String(formData.get("description") ?? "")
  const club = await chartClub(institutionId, { name, category, description }, userId)
  revalidateAdmin(club.slug)
  redirect(`/admin/clubs/${club.slug}`)
}

export async function adminEditClub(formData: FormData) {
  const organizationId = String(formData.get("organizationId") ?? "")
  const org = await orgOrThrow(organizationId)
  await requireCapability("club.edit", {
    institutionId: org.institutionId,
    organizationId: org.id,
    resourceType: "Organization",
    resourceId: org.id,
  })

  const name = String(formData.get("name") ?? "").trim()
  const shortName = String(formData.get("shortName") ?? "").trim()
  const description = String(formData.get("description") ?? "").trim()
  const category = String(formData.get("category") ?? "") as OrgCategory
  if (!name) throw new Error("Club name is required")
  if (!ORG_CATEGORIES.includes(category)) throw new Error("Pick a category")

  await db.organization.update({
    where: { id: org.id },
    data: {
      name,
      shortName: shortName || null,
      description: description || null,
      category,
    },
  })
  revalidateAdmin(org.slug)
}

export async function adminSetOrgStatus(formData: FormData) {
  const organizationId = String(formData.get("organizationId") ?? "")
  const status = String(formData.get("status") ?? "") as "ACTIVE" | "ARCHIVED"
  const org = await orgOrThrow(organizationId)
  await requireCapability("club.archive", {
    institutionId: org.institutionId,
    organizationId: org.id,
    resourceType: "Organization",
    resourceId: org.id,
  })
  if (!["ACTIVE", "ARCHIVED"].includes(status)) throw new Error("Invalid status")
  await db.organization.update({ where: { id: org.id }, data: { status } })
  revalidateAdmin(org.slug)
}

// ─── Roles: assign / remove / transfer ────────────────────────────────────────

export async function adminAssignSeat(formData: FormData) {
  const organizationId = String(formData.get("organizationId") ?? "")
  const roleId = String(formData.get("roleId") ?? "")
  const email = String(formData.get("personEmail") ?? "")
  const name = String(formData.get("personName") ?? "")
  const status = (String(formData.get("status") ?? "ACTIVE") as AssignmentStatus) || "ACTIVE"
  const org = await orgOrThrow(organizationId)
  await requireCapability("role.assign", {
    institutionId: org.institutionId,
    organizationId: org.id,
    resourceType: "RoleAssignment",
    resourceId: roleId,
    metadata: { targetEmail: email.trim().toLowerCase(), roleId, status },
  })

  const role = await db.role.findFirst({ where: { id: roleId, organizationId: org.id } })
  if (!role) throw new Error("Seat not found in this club")
  if (!["ACTIVE", "SHADOW"].includes(status)) throw new Error("Invalid status")

  const user = await upsertHolder(email, name)
  const existing = await db.roleAssignment.findFirst({
    where: { userId: user.id, roleId, status: { in: ["SHADOW", "ACTIVE"] } },
  })
  if (existing) throw new Error("This person already holds that seat")

  await db.roleAssignment.create({ data: { userId: user.id, roleId, status } })
  await notifyUsers([user.id], {
    title: `You've been assigned to ${org.name} as ${role.name}`,
    body: status === "SHADOW" ? "Shadow access is read-only until your term begins." : undefined,
    href: `/orgs/${org.slug}/members`,
  })
  revalidateAdmin(org.slug)
}

export async function adminRemoveAssignment(formData: FormData) {
  const assignmentId = String(formData.get("assignmentId") ?? "")
  const mode = String(formData.get("mode") ?? "revoke") // "revoke" | "delete"
  const assignment = await db.roleAssignment.findUnique({
    where: { id: assignmentId },
    include: { role: { include: { organization: true } } },
  })
  if (!assignment) throw new Error("Assignment not found")
  const org = assignment.role.organization
  await requireCapability("role.remove", {
    institutionId: org.institutionId,
    organizationId: org.id,
    resourceType: "RoleAssignment",
    resourceId: assignmentId,
    metadata: {
      targetUserId: assignment.userId,
      roleId: assignment.roleId,
      roleName: assignment.role.name,
      fromStatus: assignment.status,
      mode,
    },
  })

  if (mode === "delete") {
    // Hard-delete destroys append-only history. Only a not-yet-started (shadow)
    // assignment — one that never granted access — may be removed outright; an
    // ACTIVE seat must be revoked (ALUMNI) first, and an ALUMNI record is part
    // of the club's permanent history and is never deleted.
    if (assignment.status !== "SHADOW")
      throw new Error(
        "Only a not-yet-started (shadow) assignment can be removed outright. Revoke an active role instead — its alumni record is part of the club's permanent history and can't be deleted."
      )
    await db.roleAssignment.delete({ where: { id: assignmentId } })
  } else {
    await db.roleAssignment.update({
      where: { id: assignmentId },
      data: { status: "ALUMNI", endDate: new Date() },
    })
    await notifyUsers([assignment.userId], {
      title: `Your ${assignment.role.name} term at ${org.name} has wrapped up`,
      body: "Your day-to-day access ends here, but everything you built stays in the seat's memory for whoever comes next. Thank you for serving.",
    })
  }
  revalidateAdmin(org.slug)
}

export async function adminTransferSeat(formData: FormData) {
  const roleId = String(formData.get("roleId") ?? "")
  const email = String(formData.get("personEmail") ?? "")
  const name = String(formData.get("personName") ?? "")
  const role = await db.role.findUnique({
    where: { id: roleId },
    include: { organization: true, assignments: { where: { status: "ACTIVE" } } },
  })
  if (!role) throw new Error("Seat not found")
  const org = role.organization
  await requireCapability("role.transfer", {
    institutionId: org.institutionId,
    organizationId: org.id,
    resourceType: "RoleAssignment",
    resourceId: roleId,
    metadata: {
      targetEmail: email.trim().toLowerCase(),
      roleId,
      roleName: role.name,
      previousHolderIds: role.assignments.map((a) => a.userId),
    },
  })

  const user = await upsertHolder(email, name)
  if (role.assignments.some((a) => a.userId === user.id))
    throw new Error("That person already holds this seat")

  await db.$transaction(async (tx) => {
    // End the current holder(s), then place the new person.
    for (const a of role.assignments) {
      await tx.roleAssignment.update({
        where: { id: a.id },
        data: { status: "ALUMNI", endDate: new Date() },
      })
    }
    await tx.roleAssignment.create({ data: { userId: user.id, roleId, status: "ACTIVE" } })
  })

  const previousHolders = role.assignments.map((a) => a.userId)
  await notifyUsers([user.id], {
    title: `You now hold ${role.name} at ${org.name}`,
    body: "The seat was transferred to you — its full history is available.",
    href: `/orgs/${org.slug}/members`,
  })
  if (previousHolders.length)
    await notifyUsers(previousHolders, {
      title: `Your ${role.name} role at ${org.name} was transferred`,
      body: "Thank you for your service — the seat's knowledge stays for your successor.",
    })
  revalidateAdmin(org.slug)
}

// ─── Seats (Role CRUD) ────────────────────────────────────────────────────────

export async function adminCreateSeat(formData: FormData) {
  const organizationId = String(formData.get("organizationId") ?? "")
  const name = String(formData.get("name") ?? "").trim()
  const scope = (String(formData.get("scope") ?? "FUNCTIONAL") as RoleScope) || "FUNCTIONAL"
  const org = await orgOrThrow(organizationId)
  await requireCapability("seat.manage", {
    institutionId: org.institutionId,
    organizationId: org.id,
    resourceType: "Role",
  })
  if (!name) throw new Error("Seat name is required")
  const dupe = await db.role.findFirst({ where: { organizationId: org.id, name } })
  if (dupe) throw new Error("That seat already exists")

  const suffix = name.replace(/[^A-Za-z0-9]+/g, "").slice(0, 6).toUpperCase()
  // positionCode is globally unique; two clubs with the same initials would
  // collide (P2002) — dedupe by suffixing a counter, same as the charter path.
  const positionCode = await uniquePositionCode(db, `${clubCode(org.name)}-${suffix}`)
  await db.role.create({
    data: { organizationId: org.id, name, scope, positionCode },
  })
  revalidateAdmin(org.slug)
}

export async function adminRenameSeat(formData: FormData) {
  const roleId = String(formData.get("roleId") ?? "")
  const name = String(formData.get("name") ?? "").trim()
  const role = await db.role.findUnique({ where: { id: roleId }, include: { organization: true } })
  if (!role) throw new Error("Seat not found")
  await requireCapability("seat.manage", {
    institutionId: role.organization.institutionId,
    organizationId: role.organizationId,
    resourceType: "Role",
    resourceId: roleId,
  })
  if (!name) throw new Error("Seat name is required")
  await db.role.update({ where: { id: roleId }, data: { name } })
  revalidateAdmin(role.organization.slug)
}

export async function adminDeleteSeat(formData: FormData) {
  const roleId = String(formData.get("roleId") ?? "")
  const role = await db.role.findUnique({
    where: { id: roleId },
    include: {
      organization: true,
      _count: { select: { assignments: true, holdings: true, memoryRecords: true } },
    },
  })
  if (!role) throw new Error("Seat not found")
  await requireCapability("seat.manage", {
    institutionId: role.organization.institutionId,
    organizationId: role.organizationId,
    resourceType: "Role",
    resourceId: roleId,
  })
  const { assignments, holdings, memoryRecords } = role._count
  if (assignments + holdings + memoryRecords > 0)
    throw new Error("This seat carries history and cannot be deleted — retire it instead")
  await db.role.delete({ where: { id: roleId } })
  revalidateAdmin(role.organization.slug)
}

// ─── Directory ────────────────────────────────────────────────────────────────

export async function adminAddDirectoryPerson(formData: FormData) {
  await requireCapability("directory.manage", { resourceType: "DirectoryPerson" })
  const name = String(formData.get("name") ?? "").trim()
  const email = String(formData.get("email") ?? "").trim().toLowerCase()
  const kind = (String(formData.get("kind") ?? "STUDENT") as "STUDENT" | "ADVISOR") || "STUDENT"
  const affiliation = String(formData.get("affiliation") ?? "").trim()
  if (!name || !email) throw new Error("Name and email are required")
  await db.directoryPerson.upsert({
    where: { email },
    update: { name, kind, affiliation: affiliation || null },
    create: { name, email, kind, affiliation: affiliation || null },
  })
  revalidateAdmin()
}

// ─── Institution (OSE) access ─────────────────────────────────────────────────

export async function adminGrantInstitutionRole(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase()
  const role = String(formData.get("role") ?? "") as InstitutionRole
  if (!email) throw new Error("Email is required")
  if (!INSTITUTION_ROLES.includes(role)) throw new Error("Pick a role")

  const { institutionId, userId: actorId } = await requireCapability("institution.grantRole", {
    resourceType: "InstitutionMembership",
    metadata: { targetEmail: email, role },
  })

  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: { email, name: email.split("@")[0] },
  })

  // Zero-director guard: this same upsert can silently DEMOTE an existing
  // Director (update:{ role }). If the target is currently the institution's
  // last Director and we're moving them to a lower role, that would leave the
  // institution with no Director — and institution.grantRole itself requires a
  // Director, so the console would be permanently locked. Block it and point
  // to the transfer pipeline, which hands the role off without a coverage gap.
  const existing = await db.institutionMembership.findUnique({
    where: { userId_institutionId: { userId: user.id, institutionId } },
  })
  const isDemotingDirector = existing?.role === "OSE_DIRECTOR" && role !== "OSE_DIRECTOR"
  if (isDemotingDirector) {
    const otherDirectors = await db.institutionMembership.count({
      where: { institutionId, role: "OSE_DIRECTOR", NOT: { userId: user.id } },
    })
    if (otherDirectors === 0)
      throw new Error(
        user.id === actorId
          ? "You're the institution's last OSE Director, so you can't step yourself down here — that would leave no one in charge. Use “Transfer Director role” to hand off to a successor first; you keep your access until they accept."
          : "That person is the institution's last OSE Director. Grant Director access to a successor first, or use the transfer pipeline — the institution must always keep at least one Director."
      )
  }

  await db.institutionMembership.upsert({
    where: { userId_institutionId: { userId: user.id, institutionId } },
    update: { role },
    create: { userId: user.id, institutionId, role },
  })
  const roleName = roleWord(role)
  await notifyUsers([user.id], {
    title: "Welcome to the OSE Admin console",
    body: `You've been given OSE ${roleName} access. The Admin console is open to you now — head over whenever you're ready to jump in.`,
    href: "/admin",
  })
  revalidateAdmin()
}

// ─── Approvals: force-decide (override the gates) ─────────────────────────────

export async function adminDecideApproval(formData: FormData) {
  const approvalId = String(formData.get("approvalId") ?? "")
  const decision = String(formData.get("decision") ?? "") as "APPROVED" | "REJECTED"
  const approval = await db.approvalRequest.findUnique({
    where: { id: approvalId },
    include: { event: { select: { id: true, title: true } } },
  })
  if (!approval) throw new Error("Request not found")
  const { userId } = await requireCapability("approval.override", {
    institutionId: approval.institutionId,
    organizationId: approval.organizationId,
    resourceType: "ApprovalRequest",
    resourceId: approvalId,
    reason: "OSE override",
  })
  if (!["APPROVED", "REJECTED"].includes(decision)) throw new Error("Invalid decision")
  if (["APPROVED", "REJECTED", "CANCELLED"].includes(approval.status))
    throw new Error("This request is already decided")

  await db.$transaction([
    db.approvalRequest.update({ where: { id: approvalId }, data: { status: decision } }),
    db.approvalStep.create({
      data: {
        approvalId,
        fromStatus: approval.status,
        toStatus: decision,
        actorId: userId,
        actorRoleContext: "OSE Override",
        reason: "Administrator override",
        policySnapshot: { override: true },
      },
    }),
    ...(approval.event && decision === "APPROVED"
      ? [db.event.update({ where: { id: approval.event.id }, data: { status: "PUBLISHED" } })]
      : []),
    ...(approval.event && decision === "REJECTED"
      ? [db.event.update({ where: { id: approval.event.id }, data: { status: "CANCELLED" } })]
      : []),
  ])

  await notifyUsers([approval.submittedById], {
    title: `“${approval.title}” was ${decision === "APPROVED" ? "approved" : "rejected"} by OSE`,
    body: "An administrator decided this request directly.",
    href: `/approvals/${approvalId}`,
    excludeUserId: userId,
  })
  revalidateAdmin()
  revalidatePath("/admin/approvals")
  revalidatePath("/approvals")
  revalidatePath(`/approvals/${approvalId}`)
}

export async function adminRevokeInstitutionRole(formData: FormData) {
  const membershipId = String(formData.get("membershipId") ?? "")
  const membershipPre = await db.institutionMembership.findUnique({
    where: { id: membershipId },
    include: { user: { select: { email: true } } },
  })
  const { institutionId, userId: actorId } = await requireCapability("institution.grantRole", {
    resourceType: "InstitutionMembership",
    resourceId: membershipId,
    metadata: membershipPre
      ? { targetUserId: membershipPre.userId, targetEmail: membershipPre.user.email, role: membershipPre.role }
      : undefined,
  })
  const membership = membershipPre
  if (!membership || membership.institutionId !== institutionId)
    throw new Error("Membership not found")

  // Never remove the last Director — the institution must always keep an owner.
  // This also blocks a lone Director from revoking themselves: to step down
  // cleanly they must hand off through the transfer pipeline first.
  if (membership.role === "OSE_DIRECTOR") {
    const directors = await db.institutionMembership.count({
      where: { institutionId, role: "OSE_DIRECTOR" },
    })
    if (directors <= 1)
      throw new Error(
        membership.userId === actorId
          ? "You're the institution's last OSE Director, so you can't revoke your own access — that would lock everyone out. Use “Transfer Director role” to hand off to a successor first; you keep your access until they accept."
          : "This is the institution's last OSE Director and can't be revoked. Grant Director access to a successor first — the institution must always keep at least one Director."
      )
  }
  await db.institutionMembership.delete({ where: { id: membershipId } })
  if (membership.userId !== actorId)
    await notifyUsers([membership.userId], {
      title: "Your OSE Admin access has been turned off",
      body: "Your access to the OSE Admin console has been removed. Your past activity stays on record. If you think this was a mistake, reach out to an OSE Director.",
    })
  revalidateAdmin()
}

// ─── OSE Director / administration transfer pipeline ──────────────────────────
//
// A first-class, atomic, two-party handoff of an institution role. The outgoing
// Director KEEPS their role until the successor accepts (no coverage gap), and
// the grant + step-down happen inside one transaction. This is the ONLY clean
// way for a lone Director to step down — the grant/revoke guards above point
// here on purpose.

async function actingUserId(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")
  return session.user.id
}

/**
 * A Director opens a handoff of their Director role to a successor (by email;
 * the user row is created if they're new, same as grant). Creates a PENDING
 * RoleTransfer and notifies the successor. Nothing about the initiator's own
 * access changes yet — they keep the Director role until the successor accepts.
 */
export async function initiateRoleTransfer(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase()
  const note = String(formData.get("note") ?? "").trim()
  // "STEP_DOWN" (become Staff) or "REVOKE" (leave the console entirely).
  const stepDown = String(formData.get("stepDown") ?? "STEP_DOWN")
  if (!email) throw new Error("A successor email is required")

  const { institutionId, userId: actorId } = await requireCapability("institution.transferRole", {
    resourceType: "RoleTransfer",
    metadata: { successorEmail: email, stepDown },
  })

  // The initiator must currently hold the Director role they're handing off.
  const actorMembership = await db.institutionMembership.findUnique({
    where: { userId_institutionId: { userId: actorId, institutionId } },
  })
  if (!actorMembership || actorMembership.role !== "OSE_DIRECTOR")
    throw new Error("Only a current OSE Director can start a Director transfer")

  const successor = await db.user.upsert({
    where: { email },
    update: {},
    create: { email, name: email.split("@")[0] },
  })
  if (successor.id === actorId)
    throw new Error("Choose someone other than yourself to receive the role")

  // One open handoff at a time, so the pipeline stays unambiguous.
  const openForActor = await db.roleTransfer.findFirst({
    where: { institutionId, fromUserId: actorId, role: "OSE_DIRECTOR", status: "PENDING" },
  })
  if (openForActor)
    throw new Error("You already have a pending Director transfer. Cancel it before starting another.")

  const stepDownRole: InstitutionRole | null = stepDown === "REVOKE" ? null : "OSE_STAFF"
  const transfer = await db.roleTransfer.create({
    data: {
      institutionId,
      fromUserId: actorId,
      toUserId: successor.id,
      role: "OSE_DIRECTOR",
      status: "PENDING",
      note: note || null,
      stepDownRole,
      initiatedById: actorId,
    },
  })

  await db.auditEvent.create({
    data: {
      institutionId,
      actorId,
      actorRole: "OSE_DIRECTOR",
      action: "Admin.institution.transferRole.initiated",
      resourceType: "RoleTransfer",
      resourceId: transfer.id,
      outcome: "ALLOW",
      metadata: {
        transferId: transfer.id,
        fromUserId: actorId,
        toUserId: successor.id,
        toEmail: successor.email,
        role: "OSE_DIRECTOR",
        stepDownRole,
      },
    },
  })

  await notifyUsers([successor.id], {
    title: "You've been asked to take over as OSE Director",
    body: `A current OSE Director would like to hand the Director role to you${
      note ? ` — “${note}”` : ""
    }. Open the Admin people page to accept or decline. Nothing changes until you accept.`,
    href: "/admin/people",
  })
  revalidateAdmin()
}

/**
 * The named successor accepts. In ONE transaction: grant them the role, step the
 * initiator down (to their chosen role, or fully revoke), and close the transfer
 * COMPLETED. Because we add the successor as Director before/with stepping the
 * initiator down, the institution is never left without a Director.
 */
export async function acceptRoleTransfer(formData: FormData) {
  const transferId = String(formData.get("transferId") ?? "")
  const actorId = await actingUserId()

  const transfer = await db.roleTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromUser: { select: { id: true, name: true, email: true } },
      toUser: { select: { id: true, name: true, email: true } },
    },
  })
  if (!transfer) throw new Error("Transfer not found")
  if (transfer.toUserId !== actorId)
    throw new Error("Only the named successor can accept this transfer")
  if (transfer.status !== "PENDING")
    throw new Error("This transfer is no longer pending")

  await db.$transaction(async (tx) => {
    // 1. Grant the successor the role (add a Director — coverage first).
    await tx.institutionMembership.upsert({
      where: { userId_institutionId: { userId: transfer.toUserId, institutionId: transfer.institutionId } },
      update: { role: transfer.role },
      create: { userId: transfer.toUserId, institutionId: transfer.institutionId, role: transfer.role },
    })
    // 2. Step the initiator down (or fully revoke).
    if (transfer.stepDownRole) {
      await tx.institutionMembership.updateMany({
        where: { userId: transfer.fromUserId, institutionId: transfer.institutionId },
        data: { role: transfer.stepDownRole },
      })
    } else {
      await tx.institutionMembership.deleteMany({
        where: { userId: transfer.fromUserId, institutionId: transfer.institutionId },
      })
    }
    // 3. Close the transfer.
    await tx.roleTransfer.update({
      where: { id: transfer.id },
      data: { status: "COMPLETED", resolvedAt: new Date() },
    })
    // 4. Audit with full target identity.
    await tx.auditEvent.create({
      data: {
        institutionId: transfer.institutionId,
        actorId,
        actorRole: transfer.role,
        action: "Admin.institution.transferRole.completed",
        resourceType: "RoleTransfer",
        resourceId: transfer.id,
        outcome: "ALLOW",
        metadata: {
          transferId: transfer.id,
          fromUserId: transfer.fromUserId,
          fromEmail: transfer.fromUser.email,
          toUserId: transfer.toUserId,
          toEmail: transfer.toUser.email,
          role: transfer.role,
          initiatorLandedAs: transfer.stepDownRole ?? "REVOKED",
        },
      },
    })
  })

  const successorName = transfer.toUser.name ?? "your successor"
  const outgoingName = transfer.fromUser.name ?? "the outgoing Director"
  await notifyUsers([transfer.toUserId], {
    title: "You're now the OSE Director",
    body: `The handoff from ${outgoingName} is complete — the Director console is fully yours. Welcome; the whole institution is in your hands now.`,
    href: "/admin",
  })
  await notifyUsers([transfer.fromUserId], {
    title: "Your Director handoff is complete",
    body:
      transfer.stepDownRole
        ? `${successorName} has accepted the Director role, and you've moved to OSE ${roleWord(transfer.stepDownRole)}. Thank you for your leadership — everything you built stays right where it is.`
        : `${successorName} has accepted the Director role. Your Director access has now wound down as you asked. Thank you for your leadership — the institution is in good hands.`,
    href: "/admin",
  })
  revalidateAdmin()
}

/** The named successor declines. The transfer closes DECLINED; the initiator
 *  keeps their role unchanged and is notified. */
export async function declineRoleTransfer(formData: FormData) {
  const transferId = String(formData.get("transferId") ?? "")
  const actorId = await actingUserId()

  const transfer = await db.roleTransfer.findUnique({
    where: { id: transferId },
    include: { toUser: { select: { name: true, email: true } } },
  })
  if (!transfer) throw new Error("Transfer not found")
  if (transfer.toUserId !== actorId)
    throw new Error("Only the named successor can decline this transfer")
  if (transfer.status !== "PENDING")
    throw new Error("This transfer is no longer pending")

  await db.roleTransfer.update({
    where: { id: transfer.id },
    data: { status: "DECLINED", resolvedAt: new Date() },
  })
  await db.auditEvent.create({
    data: {
      institutionId: transfer.institutionId,
      actorId,
      action: "Admin.institution.transferRole.declined",
      resourceType: "RoleTransfer",
      resourceId: transfer.id,
      outcome: "ALLOW",
      metadata: {
        transferId: transfer.id,
        fromUserId: transfer.fromUserId,
        toUserId: transfer.toUserId,
        toEmail: transfer.toUser.email,
        role: transfer.role,
      },
    },
  })

  const successorName = transfer.toUser.name ?? "The person you invited"
  await notifyUsers([transfer.fromUserId], {
    title: "Your Director transfer was declined",
    body: `${successorName} isn't able to take over the Director role right now, so nothing changed — you're still the Director. You can start a new transfer with someone else whenever you're ready.`,
    href: "/admin/people",
  })
  revalidateAdmin()
}

/** The initiator (or any current Director) withdraws a still-pending transfer.
 *  The role is untouched; the successor is let know. */
export async function cancelRoleTransfer(formData: FormData) {
  const transferId = String(formData.get("transferId") ?? "")
  const actorId = await actingUserId()

  const transfer = await db.roleTransfer.findUnique({
    where: { id: transferId },
    include: { fromUser: { select: { name: true } } },
  })
  if (!transfer) throw new Error("Transfer not found")

  const ctx = await getUserContext(actorId)
  const isInitiator = actorId === transfer.fromUserId || actorId === transfer.initiatedById
  if (!isInitiator && !isOseDirector(ctx, transfer.institutionId))
    throw new Error("Only the initiator or an OSE Director can cancel this transfer")
  if (transfer.status !== "PENDING")
    throw new Error("This transfer is no longer pending")

  await db.roleTransfer.update({
    where: { id: transfer.id },
    data: { status: "CANCELLED", resolvedAt: new Date() },
  })
  await db.auditEvent.create({
    data: {
      institutionId: transfer.institutionId,
      actorId,
      action: "Admin.institution.transferRole.cancelled",
      resourceType: "RoleTransfer",
      resourceId: transfer.id,
      outcome: "ALLOW",
      metadata: {
        transferId: transfer.id,
        fromUserId: transfer.fromUserId,
        toUserId: transfer.toUserId,
        role: transfer.role,
      },
    },
  })

  await notifyUsers([transfer.toUserId], {
    title: "A Director transfer was called off",
    body: `The invitation to take over as OSE Director has been withdrawn — no action is needed from you. Feel free to reach out to ${
      transfer.fromUser.name ?? "the OSE Director"
    } if you have questions.`,
    href: "/admin/people",
  })
  revalidateAdmin()
}

// ─── Entity overrides: events, content, budgets ──────────────────────────────

export async function adminSetEventStatus(formData: FormData) {
  const eventId = String(formData.get("eventId") ?? "")
  const status = String(formData.get("status") ?? "") as "PUBLISHED" | "CANCELLED"
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, institutionId: true, organizationId: true },
  })
  if (!event) throw new Error("Event not found")
  await requireCapability("event.override", {
    institutionId: event.institutionId,
    organizationId: event.organizationId,
    resourceType: "Event",
    resourceId: eventId,
  })
  if (!["PUBLISHED", "CANCELLED"].includes(status)) throw new Error("Invalid status")
  await db.event.update({ where: { id: eventId }, data: { status } })
  revalidateAdmin()
  revalidatePath("/calendar")
  revalidatePath(`/calendar/${eventId}`)
  revalidatePath("/admin/overrides")
}

export async function adminSetMemoryArchived(formData: FormData) {
  const memoryId = String(formData.get("memoryId") ?? "")
  const archived = String(formData.get("archived") ?? "") === "true"
  const rec = await db.memoryRecord.findUnique({
    where: { id: memoryId },
    select: { id: true, institutionId: true, organizationId: true },
  })
  if (!rec) throw new Error("Memory record not found")
  await requireCapability("content.override", {
    institutionId: rec.institutionId,
    organizationId: rec.organizationId,
    resourceType: "MemoryRecord",
    resourceId: memoryId,
  })
  await db.memoryRecord.update({ where: { id: memoryId }, data: { isArchived: archived } })
  revalidateAdmin()
  revalidatePath("/admin/overrides")
}

export async function adminSetDocumentArchived(formData: FormData) {
  const documentId = String(formData.get("documentId") ?? "")
  const archived = String(formData.get("archived") ?? "") === "true"
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: { id: true, institutionId: true, organizationId: true },
  })
  if (!doc) throw new Error("Document not found")
  await requireCapability("content.override", {
    institutionId: doc.institutionId,
    organizationId: doc.organizationId,
    resourceType: "Document",
    resourceId: documentId,
  })
  await db.document.update({ where: { id: documentId }, data: { isArchived: archived } })
  revalidateAdmin()
  revalidatePath("/admin/overrides")
}

export async function adminAdjustBudget(formData: FormData) {
  const budgetId = String(formData.get("budgetId") ?? "")
  const allocatedCents = Math.max(0, Math.round(Number(formData.get("allocatedDollars") ?? 0) * 100))
  const notes = String(formData.get("notes") ?? "").trim()
  const budget = await db.budget.findUnique({
    where: { id: budgetId },
    select: { id: true, institutionId: true, organizationId: true },
  })
  if (!budget) throw new Error("Budget not found")
  await requireCapability("budget.override", {
    institutionId: budget.institutionId,
    organizationId: budget.organizationId,
    resourceType: "Budget",
    resourceId: budgetId,
  })
  await db.budget.update({ where: { id: budgetId }, data: { allocatedCents, notes: notes || null } })
  revalidateAdmin()
  revalidatePath("/admin/overrides")
}
