import Link from "next/link"
import { redirect } from "next/navigation"
import { CalendarDays, Handshake, MessageCircle, Newspaper } from "@/components/ui/icons"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext, isOseDirector } from "@/lib/rbac"
import { viewerTimeZone } from "@/lib/institution-time"
import { formatInZone } from "@/lib/time"
import { Card, CardHeader } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { ConfirmInlineSubmit } from "@/components/ui/ConfirmInlineSubmit"
import {
  addFeedComment,
  createFeedPost,
  decideCollab,
  requestCollab,
} from "./actions"

export const dynamic = "force-dynamic"

function timeAgo(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default async function FeedPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")
  const userId = session.user.id

  const ctx = await getUserContext(userId)
  // Event dates render in the institution's zone, matching the calendar. An
  // unzoned format resolves against the server clock (UTC in production), which
  // pushes any event after ~8pm local onto the following day's date here while
  // the calendar shows the correct one.
  const tz = await viewerTimeZone(userId)
  const oseInstitutionIds = ctx.institutionRoles.map((m) => m.institutionId)
  const activeOrgIds = ctx.orgRoles
    .filter((r) => r.status === "ACTIVE")
    .map((r) => r.organizationId)

  // The whole institution sees the community feed
  const institutionIds = oseInstitutionIds.length
    ? oseInstitutionIds
    : [
        ...new Set(
          (
            await db.organization.findMany({
              where: {
                id: {
                  in: ctx.orgRoles.map((r) => r.organizationId),
                },
              },
              select: { institutionId: true },
            })
          ).map((o) => o.institutionId)
        ),
      ]

  const posts = await db.feedPost.findMany({
    where: { institutionId: { in: institutionIds }, isArchived: false },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      organization: { select: { id: true, name: true, slug: true } },
      event: { select: { id: true, title: true, startAt: true } },
      comments: { orderBy: { createdAt: "asc" }, take: 30 },
      interests: {
        include: { organization: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  // Resolve author names in one pass
  const authorIds = [
    ...new Set([
      ...posts.map((p) => p.authorId),
      ...posts.flatMap((p) => p.comments.map((c) => c.authorId)),
    ]),
  ]
  const authors = new Map(
    (
      await db.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name ?? "Unknown"])
  )

  // Clubs this user can post/collaborate on behalf of
  const myClubs = activeOrgIds.length
    ? await db.organization.findMany({
        where: { id: { in: activeOrgIds } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : []

  // Upcoming events of those clubs (composer's optional link)
  const myEvents = activeOrgIds.length
    ? await db.event.findMany({
        where: {
          organizationId: { in: activeOrgIds },
          status: { not: "CANCELLED" },
          startAt: { gte: new Date() },
        },
        select: { id: true, title: true, organizationId: true },
        orderBy: { startAt: "asc" },
        take: 20,
      })
    : []

  const director = institutionIds.some((i) => isOseDirector(ctx, i))
  const pendingForDirector = director
    ? posts.flatMap((p) =>
        p.interests
          .filter((i) => i.status === "PENDING_OSE")
          .map((i) => ({ ...i, postTitle: p.title, hostClub: p.organization.name }))
      )
    : []

  const canComment = activeOrgIds.length > 0 || oseInstitutionIds.length > 0

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-text-1">Community Feed</h1>
        <p className="text-sm text-text-2 mt-1">
          Find collaborators for your events — every partnership is approved by
          the OSE Director.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-4">
          {/* Composer */}
          {myClubs.length > 0 && (
            <Card>
              <CardHeader
                title="Share with the community"
                subtitle="Post a collaboration call on behalf of your club"
              />
              <form action={createFeedPost} className="space-y-3">
                <div className="flex flex-wrap gap-3">
                  <label className="flex flex-col gap-1 text-xs text-text-2">
                    Posting as
                    <select
                      name="organizationId"
                      required
                      className="h-9 rounded border border-border px-2 text-sm text-text-1 bg-surface"
                    >
                      {myClubs.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-2 flex-1 min-w-52">
                    Title
                    <input
                      name="title"
                      required
                      maxLength={200}
                      placeholder="Co-host wanted: Spring Case Competition"
                      className="h-9 w-full rounded border border-border px-3 text-sm text-text-1"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-2">
                    Link an event (optional)
                    <select
                      name="eventId"
                      className="h-9 rounded border border-border px-2 text-sm text-text-1 bg-surface"
                    >
                      <option value="">None</option>
                      {myEvents.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <textarea
                  name="body"
                  required
                  rows={3}
                  placeholder="What are you planning, what kind of partner are you looking for, and what's in it for them?"
                  className="w-full rounded border border-border px-3 py-2 text-sm text-text-1"
                />
                <button className="h-9 rounded bg-[--primary] px-4 text-sm font-medium text-white hover:opacity-90">
                  Post to feed
                </button>
              </form>
            </Card>
          )}

          {/* Posts */}
          {posts.length === 0 ? (
            <Card>
              <div className="py-8 text-center">
                <Newspaper size={22} className="mx-auto text-text-3" />
                <p className="text-sm text-text-2 mt-3">
                  Quiet so far — post the first collaboration call.
                </p>
              </div>
            </Card>
          ) : (
            posts.map((post) => {
              const approved = post.interests.filter((i) => i.status === "APPROVED")
              const pending = post.interests.filter((i) => i.status === "PENDING_OSE")
              const eligibleClubs = myClubs.filter(
                (c) =>
                  c.id !== post.organizationId &&
                  !post.interests.some((i) => i.organizationId === c.id)
              )
              return (
                <Card key={post.id} padding="none">
                  {/* Post header */}
                  <div className="flex items-center gap-3 px-5 pt-4">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                      style={{ background: "var(--primary)" }}
                    >
                      {post.organization.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/orgs/${post.organization.slug}/members`}
                        className="text-sm font-semibold text-text-1 hover:underline no-underline"
                      >
                        {post.organization.name}
                      </Link>
                      <p className="text-xs text-text-3">
                        {authors.get(post.authorId)} · {timeAgo(post.createdAt)}
                      </p>
                    </div>
                    {pending.length > 0 && (
                      <Badge variant="warning">{pending.length} pending OSE</Badge>
                    )}
                  </div>

                  {/* Body */}
                  <div className="px-5 pt-3 pb-4">
                    <h2 className="text-sm font-semibold text-text-1">{post.title}</h2>
                    <p className="text-sm text-text-1 mt-1 whitespace-pre-wrap">{post.body}</p>
                    {post.event && (
                      <Link
                        href={`/calendar/${post.event.id}`}
                        className="mt-2 inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs text-text-2 hover:border-[--primary] no-underline"
                      >
                        <CalendarDays size={12} />
                        {post.event.title} ·{" "}
                        {formatInZone(post.event.startAt, tz, {
                          month: "short",
                          day: "numeric",
                        })}
                      </Link>
                    )}
                    {approved.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {approved.map((i) => (
                          <span
                            key={i.id}
                            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
                            style={{ background: "var(--success-light)", color: "var(--success)" }}
                          >
                            <Handshake size={11} /> Collaborating with {i.organization.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Collaborate */}
                  {eligibleClubs.length > 0 && (
                    <div className="px-5 pb-4">
                      <form action={requestCollab} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="postId" value={post.id} />
                        <select
                          name="organizationId"
                          required
                          aria-label="Collaborate as"
                          className="h-8 rounded border border-border px-2 text-xs text-text-1 bg-surface"
                        >
                          {eligibleClubs.map((c) => (
                            <option key={c.id} value={c.id}>
                              as {c.name}
                            </option>
                          ))}
                        </select>
                        <input
                          name="note"
                          placeholder="Add a note (optional)"
                          className="h-8 flex-1 min-w-40 rounded border border-border px-2 text-xs text-text-1"
                        />
                        <button className="inline-flex items-center gap-1.5 h-8 rounded bg-[--primary] px-3 text-xs font-medium text-white hover:opacity-90">
                          <Handshake size={13} /> Request to collaborate
                        </button>
                      </form>
                    </div>
                  )}

                  {/* Comments */}
                  <div className="border-t border-border px-5 py-3 space-y-2.5">
                    {post.comments.map((c) => (
                      <div key={c.id} className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold text-text-1 shrink-0">
                          {authors.get(c.authorId)}
                        </span>
                        <span className="text-sm text-text-1">{c.body}</span>
                        <span className="text-xs text-text-3 ml-auto shrink-0">
                          {timeAgo(c.createdAt)}
                        </span>
                      </div>
                    ))}
                    {canComment && (
                      <form action={addFeedComment} className="flex gap-2 pt-1">
                        <input type="hidden" name="postId" value={post.id} />
                        <input
                          name="body"
                          required
                          autoComplete="off"
                          placeholder="Write a comment…"
                          className="h-8 flex-1 rounded-full border border-border px-3 text-xs text-text-1"
                        />
                        <button
                          className="inline-flex items-center gap-1 h-8 rounded-full border border-border px-3 text-xs font-medium text-text-2 hover:bg-base"
                          aria-label="Post comment"
                        >
                          <MessageCircle size={12} /> Comment
                        </button>
                      </form>
                    )}
                  </div>
                </Card>
              )
            })
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          {director && (
            <Card padding="none">
              <div className="p-5 border-b border-border">
                <CardHeader
                  title="Your approvals"
                  subtitle="Collaborations waiting on the Director"
                />
              </div>
              {pendingForDirector.length === 0 ? (
                <p className="px-5 py-6 text-sm text-text-3 text-center">
                  No collaborations waiting.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {pendingForDirector.map((i) => (
                    <li key={i.id} className="px-5 py-3.5">
                      <p className="text-sm font-medium text-text-1">
                        {i.organization.name} ↔ {i.hostClub}
                      </p>
                      <p className="text-xs text-text-2 mt-0.5">On “{i.postTitle}”</p>
                      {i.note && (
                        <p className="text-xs text-text-2 mt-1 italic">“{i.note}”</p>
                      )}
                      <form action={decideCollab} className="mt-2 space-y-2">
                        <input type="hidden" name="interestId" value={i.id} />
                        <input
                          name="decisionNote"
                          placeholder="Note (optional)"
                          className="h-8 w-full rounded border border-border px-2 text-xs text-text-1"
                        />
                        <div className="flex gap-2">
                          <button
                            name="decision"
                            value="APPROVED"
                            className="h-8 rounded bg-[--primary] px-3 text-xs font-medium text-white hover:opacity-90"
                          >
                            Approve
                          </button>
                          <ConfirmInlineSubmit
                            name="decision"
                            value="DECLINED"
                            title="Decline this collaboration?"
                            description={`${i.organization.name}'s request to collaborate with ${i.hostClub} is declined. The requesting club, the host club's board, and the OSE staff are all notified, and the decision is final — they'd have to submit a new request. Your note, if any, is included.`}
                            confirmLabel="Decline collaboration"
                            variant="danger"
                            triggerClassName="h-8 rounded border border-border px-3 text-xs font-medium text-[--error] hover:bg-base"
                          >
                            Decline
                          </ConfirmInlineSubmit>
                        </div>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card>
            <CardHeader title="How collaborations work" />
            <ol className="text-sm text-text-2 space-y-2 list-decimal list-inside">
              <li>A club posts what it&apos;s planning and who it needs.</li>
              <li>Another club requests to collaborate — the invite.</li>
              <li>The OSE Director reviews and approves the partnership.</li>
              <li>Both boards are notified and the badge appears on the post.</li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  )
}
