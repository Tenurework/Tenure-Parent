"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext, isOseDirector } from "@/lib/rbac"
import { notifyUsers, orgPresidentIds, oseMemberIds } from "@/lib/notify"

async function requireUserId() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")
  return session.user.id
}

/** Post a collaboration call on behalf of one of your ACTIVE clubs. */
export async function createFeedPost(formData: FormData) {
  const userId = await requireUserId()
  const organizationId = String(formData.get("organizationId") ?? "")
  const title = String(formData.get("title") ?? "").trim()
  const body = String(formData.get("body") ?? "").trim()
  const eventId = String(formData.get("eventId") ?? "") || null

  if (!title || !body) throw new Error("Title and details are required")

  const seat = await db.roleAssignment.findFirst({
    where: { userId, status: "ACTIVE", role: { organizationId } },
    include: { role: { include: { organization: true } } },
  })
  if (!seat) throw new Error("You need an active role in that club to post")
  const org = seat.role.organization

  if (eventId) {
    const evt = await db.event.findFirst({ where: { id: eventId, organizationId } })
    if (!evt) throw new Error("Pick one of your club's events")
  }

  await db.feedPost.create({
    data: {
      institutionId: org.institutionId,
      organizationId,
      authorId: userId,
      title,
      body,
      eventId,
    },
  })

  revalidatePath("/feed")
}

/** Comment on a post — open to any current member across clubs (and OSE). */
export async function addFeedComment(formData: FormData) {
  const userId = await requireUserId()
  const postId = String(formData.get("postId") ?? "")
  const body = String(formData.get("body") ?? "").trim()
  if (!body) return

  const post = await db.feedPost.findUnique({ where: { id: postId } })
  if (!post || post.isArchived) throw new Error("Post not found")

  const ctx = await getUserContext(userId)
  const canComment =
    ctx.institutionRoles.some((m) => m.institutionId === post.institutionId) ||
    ctx.orgRoles.some((r) => r.status === "ACTIVE")
  if (!canComment) throw new Error("Only active members can comment")

  await db.feedComment.create({ data: { postId, authorId: userId, body } })

  // Light ping to the post author
  await notifyUsers([post.authorId], {
    title: `New comment on your post “${post.title}”`,
    href: "/feed",
    excludeUserId: userId,
  })

  revalidatePath("/feed")
}

/**
 * Request to collaborate — the invite that puts the OSE Director in the
 * middle. One request per club per post; lands as a Director task.
 */
export async function requestCollab(formData: FormData) {
  const userId = await requireUserId()
  const postId = String(formData.get("postId") ?? "")
  const organizationId = String(formData.get("organizationId") ?? "")
  const note = String(formData.get("note") ?? "").trim() || null

  const post = await db.feedPost.findUnique({
    where: { id: postId },
    include: { organization: { select: { name: true } } },
  })
  if (!post || post.isArchived) throw new Error("Post not found")
  if (organizationId === post.organizationId)
    throw new Error("Your club is the one hosting this post")

  const seat = await db.roleAssignment.findFirst({
    where: { userId, status: "ACTIVE", role: { organizationId } },
    include: { role: { include: { organization: { select: { name: true } } } } },
  })
  if (!seat) throw new Error("You need an active role in the club you're volunteering")

  const existing = await db.collabInterest.findUnique({
    where: { postId_organizationId: { postId, organizationId } },
  })
  if (existing) throw new Error("Your club already has a request on this post")

  const interest = await db.collabInterest.create({
    data: { postId, organizationId, requestedById: userId, note },
  })

  await db.auditEvent.create({
    data: {
      institutionId: post.institutionId,
      organizationId,
      actorId: userId,
      action: "Collab.Requested",
      resourceType: "CollabInterest",
      resourceId: interest.id,
      outcome: "ALLOW",
    },
  })

  // The Director's task + a heads-up to the hosting club
  const directors = await db.institutionMembership.findMany({
    where: { institutionId: post.institutionId, role: "OSE_DIRECTOR" },
    select: { userId: true },
  })
  await notifyUsers(directors.map((d) => d.userId), {
    title: `${seat.role.organization.name} wants to collaborate with ${post.organization.name}`,
    body: `It's on “${post.title}” and needs your approval.${note ? ` They said: “${note}”` : ""}`,
    href: "/feed",
    excludeUserId: userId,
  })
  await notifyUsers([post.authorId, ...(await orgPresidentIds(post.organizationId))], {
    title: `${seat.role.organization.name} wants to collaborate on “${post.title}”`,
    body: "It's now with the OSE Director for approval.",
    href: "/feed",
    excludeUserId: userId,
  })

  revalidatePath("/feed")
}

/** OSE Director decision — the middle of every collaboration. */
export async function decideCollab(formData: FormData) {
  const userId = await requireUserId()
  const interestId = String(formData.get("interestId") ?? "")
  const decision = String(formData.get("decision") ?? "")
  const decisionNote = String(formData.get("decisionNote") ?? "").trim() || null

  if (!["APPROVED", "DECLINED"].includes(decision)) throw new Error("Invalid decision")

  const interest = await db.collabInterest.findUnique({
    where: { id: interestId },
    include: {
      organization: { select: { name: true } },
      post: { include: { organization: { select: { id: true, name: true } } } },
    },
  })
  if (!interest || interest.status !== "PENDING_OSE") throw new Error("Request not found")

  const ctx = await getUserContext(userId)
  const allowed = isOseDirector(ctx, interest.post.institutionId)

  await db.auditEvent.create({
    data: {
      institutionId: interest.post.institutionId,
      organizationId: interest.organizationId,
      actorId: userId,
      action: `Collab.${decision === "APPROVED" ? "Approved" : "Declined"}`,
      resourceType: "CollabInterest",
      resourceId: interest.id,
      outcome: allowed ? "ALLOW" : "DENY",
    },
  })
  if (!allowed) throw new Error("Only the OSE Director can decide collaborations")

  await db.collabInterest.update({
    where: { id: interest.id },
    data: {
      status: decision as "APPROVED" | "DECLINED",
      decidedById: userId,
      decisionNote,
      decidedAt: new Date(),
    },
  })

  // Tell both sides
  const audience = [
    interest.requestedById,
    interest.post.authorId,
    ...(await orgPresidentIds(interest.organizationId)),
    ...(await orgPresidentIds(interest.post.organization.id)),
  ]
  await notifyUsers(audience, {
    title:
      decision === "APPROVED"
        ? `${interest.organization.name} and ${interest.post.organization.name} are approved to collaborate 🎉`
        : `${interest.organization.name} and ${interest.post.organization.name} won't be collaborating this time`,
    body: decisionNote ?? undefined,
    href: "/feed",
    excludeUserId: userId,
  })
  // Keep other OSE staff in the loop
  await notifyUsers(await oseMemberIds(interest.post.institutionId), {
    title:
      decision === "APPROVED"
        ? `${interest.organization.name} and ${interest.post.organization.name} are now collaborating`
        : `The collaboration between ${interest.organization.name} and ${interest.post.organization.name} was declined`,
    href: "/feed",
    excludeUserId: userId,
  })

  revalidatePath("/feed")
}
