import Link from "next/link"
import { redirect } from "next/navigation"
import { Hash, Megaphone, MessageSquare, FileCheck, PenSquare } from "@/components/ui/icons"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { Card, CardHeader } from "@/components/ui/Card"
import { Avatar } from "@/components/ui/Avatar"
import { SeeAllSection } from "@/components/ui/SeeAllSection"
import { ConfirmInlineSubmit } from "@/components/ui/ConfirmInlineSubmit"
import { openBoardChannel, sendBroadcast } from "./actions"

function ago(d: Date): string {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000)
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 604800) return `${Math.floor(s / 86400)}d`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export const dynamic = "force-dynamic"

const TYPE_ICON = {
  DIRECT_MESSAGE: MessageSquare,
  BOARD_CHANNEL: Hash,
  APPROVAL_THREAD: FileCheck,
  OSE_BROADCAST: Megaphone,
  PRESIDENT_NETWORK: Hash,
  SYSTEM: Megaphone,
} as const

export default async function MessagesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")
  const userId = session.user.id

  const ctx = await getUserContext(userId)
  const oseInstitutionIds = ctx.institutionRoles.map((m) => m.institutionId)
  const currentOrgIds = ctx.orgRoles
    .filter((r) => r.status === "ACTIVE" || r.status === "SHADOW")
    .map((r) => r.organizationId)

  const conversations = await db.conversation.findMany({
    where: {
      OR: [
        { participants: { some: { userId } } },
        { type: "BOARD_CHANNEL", organizationId: { in: currentOrgIds } },
        { type: "BOARD_CHANNEL", institutionId: { in: oseInstitutionIds } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: {
      organization: { select: { name: true } },
      participants: { include: { user: { select: { id: true, name: true, image: true } } } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { sender: { select: { name: true } } },
      },
    },
  })

  // Unread counts per conversation
  const unread = await db.delivery.groupBy({
    by: ["participantId"],
    where: { readAt: null, participant: { userId } },
    _count: true,
  })
  const unreadByParticipant = new Map(unread.map((u) => [u.participantId, u._count]))

  const myOrgs = currentOrgIds.length
    ? await db.organization.findMany({ where: { id: { in: currentOrgIds } } })
    : await db.organization.findMany({ where: { institutionId: { in: oseInstitutionIds } } })

  const canBroadcast = oseInstitutionIds.length > 0

  const boardChannelList = (orgs: typeof myOrgs) => (
    <ul className="space-y-2">
      {orgs.map((o) => (
        <li key={o.id}>
          <form action={openBoardChannel}>
            <input type="hidden" name="organizationId" value={o.id} />
            <button className="inline-flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm text-text-1 transition-colors hover:border-[--primary] hover:bg-base">
              <Hash size={14} className="text-text-3" /> {o.name}
            </button>
          </form>
        </li>
      ))}
    </ul>
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-text-1">Messages</h1>
            <p className="text-sm text-text-2 mt-1">
              Conversations that survive leadership transitions.
            </p>
          </div>
          <Link
            href="/messages/compose"
            className="inline-flex items-center gap-1.5 h-9 rounded bg-[--primary] px-4 text-sm font-medium text-white hover:opacity-90 no-underline shrink-0"
          >
            <PenSquare size={15} /> Compose
          </Link>
        </div>

        {conversations.length === 0 ? (
          <Card>
            <p className="text-sm text-text-2 py-4 text-center">
              No conversations yet — start one on the right.
            </p>
          </Card>
        ) : (
          <Card padding="none">
            <ul className="divide-y divide-border">
              {conversations.map((c) => {
                const Icon = TYPE_ICON[c.type]
                const mine = c.participants.find((p) => p.userId === userId)
                const unreadCount = mine ? (unreadByParticipant.get(mine.id) ?? 0) : 0
                const others = c.participants.filter((p) => p.userId !== userId)
                const label =
                  c.subject ??
                  (c.type === "DIRECT_MESSAGE"
                    ? others.map((p) => p.user.name ?? "Unknown").join(", ") || "Direct message"
                    : c.organization?.name ?? "Conversation")
                const last = c.messages[0]
                const dm = c.type === "DIRECT_MESSAGE" ? others[0]?.user : null
                return (
                  <li key={c.id}>
                    <Link
                      href={`/messages/${c.id}`}
                      className="flex items-center gap-3 px-5 py-3.5 no-underline transition-colors hover:bg-base"
                    >
                      {dm ? (
                        <Avatar name={dm.name ?? "?"} imageUrl={dm.image} size="md" />
                      ) : (
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border text-text-3">
                          <Icon size={18} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className={`truncate text-sm ${unreadCount ? "font-semibold" : "font-medium"} text-text-1`}>
                            {label}
                          </p>
                          {last && <span className="shrink-0 text-meta text-text-3">{ago(last.createdAt)}</span>}
                        </div>
                        {last && (
                          <p className="mt-0.5 truncate text-[13px] text-text-3">
                            {last.sender?.name ? `${last.sender.name.split(" ")[0]}: ` : ""}
                            {last.body}
                          </p>
                        )}
                      </div>
                      {unreadCount > 0 && (
                        <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[--primary] px-1 text-[11px] font-bold text-white">
                          {unreadCount}
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </Card>
        )}
      </div>

      <div className="space-y-4 lg:pt-14">
        {myOrgs.length > 0 && (
          <Card>
            <SeeAllSection
              title="Board channels"
              count={myOrgs.length}
              overlayTitle="Board channels"
              full={myOrgs.length > 6 ? boardChannelList(myOrgs) : undefined}
            >
              {boardChannelList(myOrgs.slice(0, 6))}
            </SeeAllSection>
          </Card>
        )}

        {canBroadcast && (
          <Card>
            <CardHeader
              title="Broadcast"
              subtitle="Announcement to every current member"
            />
            <form action={sendBroadcast} className="space-y-2">
              <input
                name="subject"
                required
                placeholder="Subject"
                className="h-9 w-full rounded border border-border px-3 text-sm text-text-1"
              />
              <textarea
                name="body"
                required
                rows={3}
                placeholder="Message to all clubs…"
                className="w-full rounded border border-border px-3 py-2 text-sm text-text-1"
              />
              <ConfirmInlineSubmit
                title="Send this to everyone?"
                description="Every current member and OSE staff member at the institution receives this as an announcement. It's delivered immediately and can't be unsent."
                confirmLabel="Send broadcast"
                variant="primary"
                triggerClassName="h-9 rounded bg-[--primary] px-4 text-sm font-medium text-white hover:opacity-90"
              >
                Send broadcast
              </ConfirmInlineSubmit>
            </form>
          </Card>
        )}
      </div>
    </div>
  )
}
