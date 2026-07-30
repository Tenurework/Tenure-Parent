"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import type { ApprovalType, Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { effectiveApprovalContext } from "@/lib/delegation"
import { ledgerSignedCents } from "@/lib/finance"
import {
  availableActions,
  nextStatus,
  type ApprovalActionName,
} from "@/lib/approvals"
import {
  notifyUsers,
  orgCurrentMemberIds,
  orgPresidentIds,
  oseMemberIds,
} from "@/lib/notify"

/** Alert whoever owns the next gate of this request. */
async function notifyGate(
  approval: { id: string; title: string; organizationId: string; institutionId: string },
  target: "PENDING_PRESIDENT" | "PENDING_OSE",
  actorId: string
) {
  const gateUsers =
    target === "PENDING_PRESIDENT"
      ? await orgPresidentIds(approval.organizationId)
      : await oseMemberIds(approval.institutionId)
  await notifyUsers(gateUsers, {
    title: `${approval.title} needs your approval`,
    body:
      target === "PENDING_PRESIDENT"
        ? "It's now with you for a club-level decision."
        : "It's now with the OSE team for a final decision.",
    href: `/approvals/${approval.id}`,
    excludeUserId: actorId,
  })
}

const APPROVAL_TYPES: ApprovalType[] = [
  "EVENT",
  "BUDGET",
  "VENDOR",
  "COMMUNICATION",
  "DOCUMENT",
  "EXCEPTION",
  "ROSTER",
]

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")
  return session.user.id
}

/** Is this user the club's ACTIVE president? (Determines gate routing.) */
async function isActivePresident(userId: string, organizationId: string) {
  const seat = await db.roleAssignment.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      role: { organizationId, scope: "PRESIDENT" },
    },
  })
  return !!seat
}

export async function createApproval(formData: FormData) {
  const userId = await requireUser()

  const organizationId = String(formData.get("organizationId") ?? "")
  const type = String(formData.get("type") ?? "") as ApprovalType
  const title = String(formData.get("title") ?? "").trim()
  const description = String(formData.get("description") ?? "").trim()
  const amount = String(formData.get("amount") ?? "").trim()
  const asDraft = formData.get("intent") === "draft"

  if (!title) throw new Error("Title is required")
  if (!APPROVAL_TYPES.includes(type)) throw new Error("Invalid request type")

  // Must hold an ACTIVE seat in the org to submit requests from it
  const membership = await db.roleAssignment.findFirst({
    where: { userId, status: "ACTIVE", role: { organizationId } },
    include: { role: { include: { organization: true } } },
  })
  if (!membership) throw new Error("You need an active role in this club")

  const org = membership.role.organization
  const requesterIsPresident =
    membership.role.scope === "PRESIDENT" ||
    (await isActivePresident(userId, organizationId))

  const target = asDraft
    ? null
    : nextStatus("submit", "DRAFT", { requesterIsPresident })

  const approval = await db.$transaction(async (tx) => {
    const a = await tx.approvalRequest.create({
      data: {
        institutionId: org.institutionId,
        organizationId,
        type,
        title,
        description: description || null,
        submittedById: userId,
        status: target ?? "DRAFT",
        metadata: amount ? { amount } : {},
      },
    })
    if (target) {
      await tx.approvalStep.create({
        data: {
          approvalId: a.id,
          fromStatus: "DRAFT",
          toStatus: target,
          actorId: userId,
          actorRoleContext: membership.role.name,
          policySnapshot: { requesterIsPresident },
        },
      })
    }
    await tx.auditEvent.create({
      data: {
        institutionId: org.institutionId,
        organizationId,
        actorId: userId,
        actorRole: membership.role.name,
        action: target ? "Approval.Submitted" : "Approval.DraftCreated",
        resourceType: "ApprovalRequest",
        resourceId: a.id,
        outcome: "ALLOW",
      },
    })
    return a
  })

  if (target === "PENDING_PRESIDENT" || target === "PENDING_OSE") {
    await notifyGate(approval, target, userId)
  }

  revalidatePath("/approvals")
  redirect(`/approvals/${approval.id}`)
}

export async function actOnApproval(approvalId: string, formData: FormData) {
  const userId = await requireUser()
  const action = String(formData.get("action") ?? "") as ApprovalActionName
  const reason = String(formData.get("reason") ?? "").trim() || null

  const approval = await db.approvalRequest.findUnique({ where: { id: approvalId } })
  if (!approval) throw new Error("Request not found")

  const ctx = await getUserContext(userId)
  let allowed = availableActions(ctx, approval).includes(action)
  let onBehalfOf: { id: string; name: string } | null = null

  // Delegation: if the actor can't act directly, they may hold an active backup
  // grant from someone who can — borrow that authority and record on whose behalf.
  if (!allowed) {
    const { ctx: effCtx, delegators } = await effectiveApprovalContext(
      userId,
      ctx,
      approval.institutionId
    )
    if (delegators.length > 0 && availableActions(effCtx, approval).includes(action)) {
      allowed = true
      onBehalfOf = delegators[0]
    }
  }

  if (!allowed) {
    await db.auditEvent.create({
      data: {
        institutionId: approval.institutionId,
        organizationId: approval.organizationId,
        actorId: userId,
        action: `Approval.${action}`,
        resourceType: "ApprovalRequest",
        resourceId: approval.id,
        outcome: "DENY",
        reason: `Not permitted from ${approval.status}`,
      },
    })
    throw new Error("You cannot take this action on this request")
  }

  const requesterIsPresident = await isActivePresident(
    approval.submittedById,
    approval.organizationId
  )
  const target = nextStatus(action, approval.status, { requesterIsPresident })
  if (!target) throw new Error(`Illegal transition: ${action} from ${approval.status}`)

  // Actor's role label for the immutable step record
  const actorSeat = await db.roleAssignment.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      role: { organizationId: approval.organizationId },
    },
    include: { role: true },
  })
  const oseRole = ctx.institutionRoles.find(
    (m) => m.institutionId === approval.institutionId
  )?.role
  const baseRole = actorSeat?.role.name ?? oseRole ?? "Requester"
  const roleContext = onBehalfOf ? `${baseRole}, on behalf of ${onBehalfOf.name}` : baseRole

  // Approval-linked publishing: an EVENT approval drives its event's lifecycle
  const linkedEvent = await db.event.findUnique({ where: { approvalId: approval.id } })
  const eventUpdates =
    linkedEvent == null
      ? []
      : target === "APPROVED"
        ? [db.event.update({ where: { id: linkedEvent.id }, data: { status: "PUBLISHED" } })]
        : target === "REJECTED" || target === "CANCELLED"
          ? [db.event.update({ where: { id: linkedEvent.id }, data: { status: "CANCELLED" } })]
          : []

  // Reimbursement auto-post: on FINAL approval, post the club spend to the ledger
  // — linking this approval + the receipt document — and recompute the budget
  // line's actual (three-way match: request ↔ approval ↔ receipt). A member
  // reimbursement is real club outflow, so it posts as kind SPEND (+), NOT the
  // REIMBURSEMENT kind (which is money the club RECOVERS). Idempotent: never
  // post twice for one request. Authority is the approval gate, not finance
  // manager rights — so the OSE approver can post without canManageFinance.
  const reimb = (
    approval.metadata as {
      reimbursement?: { budgetLineId?: string; amountCents?: number; documentId?: string | null }
    } | null
  )?.reimbursement
  let reimbursementOps: Prisma.PrismaPromise<unknown>[] = []
  if (
    target === "APPROVED" &&
    reimb?.budgetLineId &&
    typeof reimb.amountCents === "number" &&
    reimb.amountCents > 0
  ) {
    const [already, line] = await Promise.all([
      db.ledgerEntry.findFirst({ where: { approvalId: approval.id }, select: { id: true } }),
      db.budgetLine.findFirst({
        where: { id: reimb.budgetLineId, organizationId: approval.organizationId },
        select: { id: true, academicYear: true },
      }),
    ])
    if (!already && line) {
      const signed = ledgerSignedCents("SPEND", reimb.amountCents)
      const agg = await db.ledgerEntry.aggregate({
        where: { budgetLineId: line.id },
        _sum: { amountCents: true },
      })
      reimbursementOps = [
        db.ledgerEntry.create({
          data: {
            organizationId: approval.organizationId,
            budgetLineId: line.id,
            academicYear: line.academicYear,
            kind: "SPEND",
            amountCents: signed,
            description: approval.title.replace(/^Reimbursement:\s*/i, "").slice(0, 140) || "Reimbursement",
            approvalId: approval.id,
            documentId: reimb.documentId ?? null,
            postedById: userId,
          },
        }),
        db.budgetLine.update({
          where: { id: line.id },
          data: { actualCents: (agg._sum.amountCents ?? 0) + signed },
        }),
      ]
    }
  }

  await db.$transaction([
    ...eventUpdates,
    ...reimbursementOps,
    db.approvalRequest.update({
      where: { id: approval.id },
      data: { status: target },
    }),
    db.approvalStep.create({
      data: {
        approvalId: approval.id,
        fromStatus: approval.status,
        toStatus: target,
        actorId: userId,
        actorRoleContext: roleContext,
        reason,
        policySnapshot: {
          action,
          requesterIsPresident,
          ...(onBehalfOf ? { onBehalfOf: onBehalfOf.id } : {}),
        },
      },
    }),
    db.auditEvent.create({
      data: {
        institutionId: approval.institutionId,
        organizationId: approval.organizationId,
        actorId: userId,
        action: `Approval.${action}`,
        resourceType: "ApprovalRequest",
        resourceId: approval.id,
        outcome: "ALLOW",
        reason,
        metadata: onBehalfOf ? { onBehalfOf: onBehalfOf.id } : {},
      },
    }),
  ])

  // ── Notifications (BP: notification system across all RBAC flows) ────────
  const label =
    action === "approve" && target === "APPROVED"
      ? "is approved"
      : action === "approve"
        ? "passed the president's review"
        : action === "reject"
          ? "was declined"
          : action === "request_changes"
            ? "needs a few changes"
            : action === "cancel"
              ? "was cancelled"
              : "moved forward"
  await notifyUsers([approval.submittedById], {
    title: `Your request “${approval.title}” ${label}`,
    body: reason ?? undefined,
    href: `/approvals/${approval.id}`,
    excludeUserId: userId,
  })
  if (target === "PENDING_OSE" || target === "PENDING_PRESIDENT") {
    await notifyGate(approval, target, userId)
  }
  if (linkedEvent && target === "APPROVED") {
    await notifyUsers(await orgCurrentMemberIds(approval.organizationId), {
      title: `${linkedEvent.title} is approved and now on the calendar`,
      href: `/calendar/${linkedEvent.id}`,
      excludeUserId: userId,
    })
  }

  revalidatePath("/approvals")
  revalidatePath(`/approvals/${approval.id}`)
  revalidatePath("/dashboard")
  if (linkedEvent) {
    revalidatePath("/calendar")
    revalidatePath(`/calendar/${linkedEvent.id}`)
  }
}
