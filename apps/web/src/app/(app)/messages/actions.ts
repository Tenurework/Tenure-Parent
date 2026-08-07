"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { liveMembershipWhere } from "@/lib/identity/live-membership"
import { getUserContext, isOse } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { canPostToConversation } from "@/lib/messaging"
import { getAllowedRecipients } from "@/lib/messaging-data"
import { notifyUsers } from "@/lib/notify"
import { fileRef, storageConfigured, uploadDocument } from "@/lib/s3"

/**
 * Store any files attached to a message. No-op without object storage.
 *
 * `institutionId` is threaded in rather than looked up, because the caller
 * already holds the conversation it is posting to and a second read could
 * disagree with it. The key used to begin `message-attachments/` and named no
 * tenant at all, which `parseFileRef` refuses: a key with no tenant prefix is
 * one that can address another tenant's object. Attachments already stored keep
 * working — reads use the key on the Attachment row.
 */
async function saveAttachments(messageId: string, institutionId: string, formData: FormData) {
  const files = formData
    .getAll("attachments")
    .filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0 || !storageConfigured()) return
  for (const file of files.slice(0, 10)) {
    if (file.size > 25 * 1024 * 1024) continue // 25 MB per file
    const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80)
    const key = `${institutionId}/message-attachments/${messageId}/${Date.now()}-${safe}`
    const bytes = Buffer.from(await file.arrayBuffer())
    await uploadDocument(
      fileRef({
        tenantId: institutionId,
        objectKey: key,
        mimeType: file.type || "application/octet-stream",
        body: bytes,
      }),
      bytes,
    )
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

/** Email-style compose: To/Cc/Bcc + subject + body, hierarchy-enforced. */
export async function composeMessage(formData: FormData) {
  const userId = await requireUserId()
  // The scope hands the conversation id back and closes; the navigation happens
  // after it. `redirect()` is a throw, and this body opens a `db.$transaction`
  // — reached from inside, it aborts that transaction, so the conversation and
  // its first message roll back while the browser follows a 307 to them.
  const conversationId = await withTenantScope(userId, async () => {
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

    return convo.id
  })

  redirect(`/messages/${conversationId}`)
}

/** Start (or resume) a DM with another user. */
export async function startDm(formData: FormData) {
  const userId = await requireUserId()
  const conversationId = await withTenantScope(userId, async () => {
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

    return dm.id
  })

  redirect(`/messages/${conversationId}`)
}

/** Open (creating if needed) a club's board channel. */
export async function openBoardChannel(formData: FormData) {
  const userId = await requireUserId()
  const conversationId = await withTenantScope(userId, async () => {
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
    return channel.id
  })

  redirect(`/messages/${conversationId}`)
}

/** Open (creating if needed) the discussion thread on an approval. */
export async function openApprovalThread(formData: FormData) {
  const userId = await requireUserId()
  const conversationId = await withTenantScope(userId, async () => {
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
    return thread.id
  })

  redirect(`/messages/${conversationId}`)
}

/** OSE announcement to every current member. */
export async function sendBroadcast(formData: FormData) {
  const userId = await requireUserId()
  const conversationId = await withTenantScope(userId, async () => {
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
      // Live only. A revoked staff member must fall out of the message
      // audience immediately, not at the next cleanup.
      where: { ...liveMembershipWhere(), institutionId },
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

    return convo.id
  })

  redirect(`/messages/${conversationId}`)
}

/** Post a message into a conversation the user can write to. */
export async function sendMessage(conversationId: string, formData: FormData) {
  const userId = await requireUserId()
  // `false` when there was nothing to post: an empty submission must not
  // invalidate three cached routes, and the caches are bumped outside the scope
  // for the same reason the redirects above are.
  const posted = await withTenantScope(userId, async () => {
    const body = String(formData.get("body") ?? "").trim()
    const hasFiles = formData
      .getAll("attachments")
      .some((f) => f instanceof File && f.size > 0)
    if (!body && !hasFiles) return false

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

    await saveAttachments(message.id, convo.institutionId, formData)
    return true
  })

  if (!posted) return
  revalidatePath(`/messages/${conversationId}`)
  revalidatePath("/messages")
  revalidatePath("/dashboard")
}
