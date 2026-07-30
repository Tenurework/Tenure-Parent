"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext, isOse } from "@/lib/rbac"
import { canPostToConversation, messagingTier } from "@/lib/messaging"
import { notifyUsers } from "@/lib/notify"
import { storageConfigured, uploadDocument } from "@/lib/s3"

/** Store any files attached to a message. No-op without object storage. */
async function saveAttachments(messageId: string, formData: FormData) {
  const files = formData
    .getAll("attachments")
    .filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0 || !storageConfigured()) return
  for (const file of files.slice(0, 10)) {
    if (file.size > 25 * 1024 * 1024) continue // 25 MB per file
    const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80)
    const key = `message-attachments/${messageId}/${Date.now()}-${safe}`
    await uploadDocument(key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream")
    await db.attachment.create({
      data: {
        messageId,
        fileName: file.name.slice(0, 200),
        mimeType: file.type || "application/octet-stream",
        objectKey: key,
        sizeBytes: file.size,
      },
    })
  }
}

async function requireUserId() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")
  return session.user.id
}

async function ensureParticipant(conversationId: string, userId: string, roleContext?: string) {
  return db.participant.upsert({
    where: { conversationId_userId: { conversationId, userId } },
    update: {},
    create: { conversationId, userId, roleContext },
  })
}

/**
 * Who this user may address, per the strict hierarchy (BP):
 * OSE → institution; President → own clubs + presidents + OSE;
 * VP → own clubs + OSE; Member → own clubs' active board only.
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

/** Email-style compose: To/Cc/Bcc + subject + body, hierarchy-enforced. */
export async function composeMessage(formData: FormData) {
  const userId = await requireUserId()

  const to = formData.getAll("to").map(String).filter(Boolean)
  const cc = formData.getAll("cc").map(String).filter(Boolean)
  const bcc = formData.getAll("bcc").map(String).filter(Boolean)
  const subject = String(formData.get("subject") ?? "").trim()
  const body = String(formData.get("body") ?? "").trim()

  if (to.length === 0) throw new Error("Add at least one recipient in To")
  if (!subject) throw new Error("Subject is required")
  if (!body) throw new Error("Message body is required")

  const allowed = new Set((await getAllowedRecipients(userId)).map((u) => u.id))
  const all = [...new Set([...to, ...cc, ...bcc])]
  for (const r of all) {
    if (!allowed.has(r))
      throw new Error("One or more recipients are outside your messaging hierarchy")
  }

  const ctx = await getUserContext(userId)
  const anyOrg = ctx.orgRoles.find((r) => r.status === "ACTIVE")
  const institutionId =
    ctx.institutionRoles[0]?.institutionId ??
    (anyOrg
      ? (await db.organization.findUnique({ where: { id: anyOrg.organizationId } }))!.institutionId
      : null)
  if (!institutionId) throw new Error("No institution affiliation")

  const kindOf = (id: string) => (to.includes(id) ? "to" : cc.includes(id) ? "cc" : "bcc")

  const convo = await db.$transaction(async (tx) => {
    const c = await tx.conversation.create({
      data: {
        institutionId,
        type: "DIRECT_MESSAGE",
        subject,
        participants: {
          create: [
            { userId, kind: "to" },
            ...all.map((id) => ({ userId: id, kind: kindOf(id) })),
          ],
        },
      },
      include: { participants: true },
    })
    const m = await tx.message.create({
      data: { conversationId: c.id, senderId: userId, body },
    })
    await tx.delivery.createMany({
      data: c.participants
        .filter((p) => p.userId !== userId)
        .map((p) => ({ messageId: m.id, participantId: p.id, channel: "in_app" })),
    })
    return c
  })

  const sender = await db.user.findUnique({ where: { id: userId }, select: { name: true } })
  await notifyUsers(all, {
    title: `${sender?.name ?? "A teammate"} sent you a message: “${subject}”`,
    href: `/messages/${convo.id}`,
    excludeUserId: userId,
  })

  redirect(`/messages/${convo.id}`)
}

/** Start (or resume) a DM with another user. */
export async function startDm(formData: FormData) {
  const userId = await requireUserId()
  const otherUserId = String(formData.get("userId") ?? "")
  if (!otherUserId || otherUserId === userId) throw new Error("Pick someone to message")

  const other = await db.user.findUnique({ where: { id: otherUserId } })
  if (!other) throw new Error("User not found")

  // Enforce the messaging hierarchy — you can only DM someone you're allowed to.
  const allowed = new Set((await getAllowedRecipients(userId)).map((u) => u.id))
  if (!allowed.has(otherUserId)) {
    throw new Error("This person is outside your messaging hierarchy")
  }

  // Resolve institution for the DM (either user's affiliation)
  const ctx = await getUserContext(userId)
  const anyOrg = ctx.orgRoles[0]
  const institutionId =
    ctx.institutionRoles[0]?.institutionId ??
    (anyOrg
      ? (await db.organization.findUnique({ where: { id: anyOrg.organizationId } }))!
          .institutionId
      : null)
  if (!institutionId) throw new Error("No institution affiliation")

  // Reuse an existing 1:1 DM if there is one
  const existing = await db.conversation.findFirst({
    where: {
      type: "DIRECT_MESSAGE",
      AND: [
        { participants: { some: { userId } } },
        { participants: { some: { userId: otherUserId } } },
      ],
    },
    include: { participants: true },
  })
  const dm =
    existing && existing.participants.length === 2
      ? existing
      : await db.conversation.create({
          data: {
            institutionId,
            type: "DIRECT_MESSAGE",
            participants: {
              create: [{ userId }, { userId: otherUserId }],
            },
          },
        })

  redirect(`/messages/${dm.id}`)
}

/** Open (creating if needed) a club's board channel. */
export async function openBoardChannel(formData: FormData) {
  const userId = await requireUserId()
  const organizationId = String(formData.get("organizationId") ?? "")

  const org = await db.organization.findUnique({ where: { id: organizationId } })
  if (!org) throw new Error("Club not found")

  const ctx = await getUserContext(userId)
  const affiliated =
    isOse(ctx, org.institutionId) ||
    ctx.orgRoles.some(
      (r) => r.organizationId === organizationId && (r.status === "ACTIVE" || r.status === "SHADOW")
    )
  if (!affiliated) throw new Error("Not a member of this club")

  let channel = await db.conversation.findFirst({
    where: { organizationId, type: "BOARD_CHANNEL" },
  })
  channel ??= await db.conversation.create({
    data: {
      institutionId: org.institutionId,
      organizationId,
      type: "BOARD_CHANNEL",
      subject: `${org.name} — Board`,
    },
  })

  await ensureParticipant(channel.id, userId)
  redirect(`/messages/${channel.id}`)
}

/** Open (creating if needed) the discussion thread on an approval. */
export async function openApprovalThread(formData: FormData) {
  const userId = await requireUserId()
  const approvalId = String(formData.get("approvalId") ?? "")

  const approval = await db.approvalRequest.findUnique({ where: { id: approvalId } })
  if (!approval) throw new Error("Request not found")

  let thread = await db.conversation.findUnique({ where: { approvalId } })
  thread ??= await db.conversation.create({
    data: {
      institutionId: approval.institutionId,
      organizationId: approval.organizationId,
      type: "APPROVAL_THREAD",
      approvalId,
      subject: `Re: ${approval.title}`,
      participants: {
        create:
          approval.submittedById === userId
            ? [{ userId }]
            : [{ userId: approval.submittedById }, { userId }],
      },
    },
  })

  await ensureParticipant(thread.id, userId)
  redirect(`/messages/${thread.id}`)
}

/** OSE announcement to every current member. */
export async function sendBroadcast(formData: FormData) {
  const userId = await requireUserId()
  const subject = String(formData.get("subject") ?? "").trim()
  const body = String(formData.get("body") ?? "").trim()
  if (!subject || !body) throw new Error("Subject and message are required")

  const ctx = await getUserContext(userId)
  const institutionId = ctx.institutionRoles[0]?.institutionId
  if (!institutionId) throw new Error("Only OSE can broadcast")

  // Audience: every user with a current (ACTIVE/SHADOW) seat + OSE staff
  const seats = await db.roleAssignment.findMany({
    where: {
      status: { in: ["ACTIVE", "SHADOW"] },
      role: { organization: { institutionId } },
    },
    select: { userId: true },
  })
  const staff = await db.institutionMembership.findMany({
    where: { institutionId },
    select: { userId: true },
  })
  const audience = [...new Set([...seats.map((s) => s.userId), ...staff.map((s) => s.userId)])]

  const convo = await db.$transaction(async (tx) => {
    const c = await tx.conversation.create({
      data: {
        institutionId,
        type: "OSE_BROADCAST",
        subject,
        participants: { create: audience.map((uid) => ({ userId: uid })) },
      },
      include: { participants: true },
    })
    const m = await tx.message.create({
      data: { conversationId: c.id, senderId: userId, body },
    })
    await tx.delivery.createMany({
      data: c.participants
        .filter((p) => p.userId !== userId)
        .map((p) => ({ messageId: m.id, participantId: p.id, channel: "in_app" })),
    })
    await tx.auditEvent.create({
      data: {
        institutionId,
        actorId: userId,
        action: "Broadcast.Sent",
        resourceType: "Conversation",
        resourceId: c.id,
        outcome: "ALLOW",
        metadata: { recipients: audience.length },
      },
    })
    return c
  })

  redirect(`/messages/${convo.id}`)
}

/** Post a message into a conversation the user can write to. */
export async function sendMessage(conversationId: string, formData: FormData) {
  const userId = await requireUserId()
  const body = String(formData.get("body") ?? "").trim()
  const hasFiles = formData
    .getAll("attachments")
    .some((f) => f instanceof File && f.size > 0)
  if (!body && !hasFiles) return

  const convo = await db.conversation.findUnique({
    where: { id: conversationId },
    include: { participants: true },
  })
  if (!convo) throw new Error("Conversation not found")

  const ctx = await getUserContext(userId)
  const allowed = canPostToConversation(ctx, {
    type: convo.type,
    institutionId: convo.institutionId,
    organizationId: convo.organizationId,
    participantUserIds: convo.participants.map((p) => p.userId),
  })
  if (!allowed) throw new Error("You cannot post in this conversation")

  await ensureParticipant(conversationId, userId)
  const participants = await db.participant.findMany({ where: { conversationId } })

  const message = await db.$transaction(async (tx) => {
    const m = await tx.message.create({
      data: { conversationId, senderId: userId, body },
    })
    await tx.delivery.createMany({
      data: participants
        .filter((p) => p.userId !== userId)
        .map((p) => ({ messageId: m.id, participantId: p.id, channel: "in_app" })),
    })
    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })
    return m
  })

  await saveAttachments(message.id, formData)

  revalidatePath(`/messages/${conversationId}`)
  revalidatePath("/messages")
  revalidatePath("/dashboard")
}
