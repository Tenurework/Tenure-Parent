import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { canPostToConversation, canReadConversation } from "@/lib/messaging"
import { storageConfigured } from "@/lib/s3"
import { ArrowRight, Paperclip } from "@/components/ui/icons"
import { Card } from "@/components/ui/Card"
import { Avatar } from "@/components/ui/Avatar"
import { BackButton } from "@/components/BackButton"
import { AttachmentChip } from "@/components/documents/AttachmentChip"
import { sendMessage } from "../actions"

interface ChipPerson {
  id: string
  name: string | null
  image: string | null
}

/** An email-style recipient line with avatars — From / To / Cc. */
function RecipientRow({ label, people }: { label: string; people: ChipPerson[] }) {
  if (people.length === 0) return null
  return (
    <div className="flex items-start gap-3">
      <span className="w-9 shrink-0 pt-1.5 text-[13px] font-semibold text-text-3">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {people.map((u) => (
          <span
            key={u.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-base py-0.5 pl-0.5 pr-2.5"
          >
            <Avatar name={u.name ?? "?"} imageUrl={u.image} size="sm" />
            <span className="text-[13px] font-medium text-text-1">{u.name ?? "Unknown"}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export const dynamic = "force-dynamic"

const TYPE_LABEL = {
  DIRECT_MESSAGE: "Direct message",
  BOARD_CHANNEL: "Board channel",
  APPROVAL_THREAD: "Approval discussion",
  OSE_BROADCAST: "OSE broadcast",
  PRESIDENT_NETWORK: "President network",
  SYSTEM: "System",
} as const

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")
  const userId = session.user.id

  return withTenantScope(userId, async () => {
    const convo = await db.conversation.findUnique({
      where: { id },
      include: {
        organization: { select: { name: true } },
        approval: { select: { id: true, title: true } },
        participants: { include: { user: { select: { id: true, name: true, image: true } } } },
        messages: {
          orderBy: { createdAt: "asc" },
          take: 100,
          include: {
            sender: { select: { id: true, name: true, image: true } },
            attachments: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
          },
        },
      },
    })
    if (!convo) notFound()

    const ctx = await getUserContext(userId)
    const convoLike = {
      type: convo.type,
      institutionId: convo.institutionId,
      organizationId: convo.organizationId,
      participantUserIds: convo.participants.map((p) => p.userId),
    }
    if (!canReadConversation(ctx, convoLike)) notFound()
    const canPost = canPostToConversation(ctx, convoLike)

    // Mark everything here as read for this user
    const mine = convo.participants.find((p) => p.userId === userId)
    if (mine) {
      await db.delivery.updateMany({
        where: { participantId: mine.id, readAt: null },
        data: { readAt: new Date() },
      })
    }

    const others = convo.participants.filter((p) => p.userId !== userId)
    const title =
      convo.subject ??
      (convo.type === "DIRECT_MESSAGE"
        ? others.map((p) => p.user.name ?? "Unknown").join(", ") || "Direct message"
        : convo.organization?.name ?? "Conversation")

    // Email-style header lines. From = original sender; Bcc participants are
    // visible only to themselves — nobody else learns they were included.
    const firstSenderId = convo.messages[0]?.senderId
    const fromSender = convo.messages[0]?.sender
    const toParts = convo.participants
      .filter((p) => p.kind === "to" && p.userId !== firstSenderId)
      .map((p) => p.user)
    const ccParts = convo.participants.filter((p) => p.kind === "cc").map((p) => p.user)
    const selfBcc = convo.participants.find((p) => p.kind === "bcc" && p.userId === userId)

    const sendWithId = sendMessage.bind(null, convo.id)

    return (
      <div className="max-w-3xl">
        <BackButton />
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-3">
            {TYPE_LABEL[convo.type]}
          </p>
          <h1 className="text-text-1 mt-0.5">{title}</h1>
          {convo.approval && (
            <Link
              href={`/approvals/${convo.approval.id}`}
              className="text-xs text-[--text-link] hover:underline"
            >
              View the approval request →
            </Link>
          )}
        </div>

        {convo.type === "DIRECT_MESSAGE" && toParts.length > 0 && (
          <div className="mb-4 space-y-2 rounded-lg border border-border bg-surface p-4">
            {fromSender && <RecipientRow label="From" people={[fromSender]} />}
            <RecipientRow label="To" people={toParts} />
            <RecipientRow label="Cc" people={ccParts} />
            {selfBcc && (
              <div className="flex items-start gap-3">
                <span className="w-9 shrink-0 text-[13px] font-semibold text-text-3">Bcc</span>
                <span className="text-[13px] text-text-2">you</span>
              </div>
            )}
          </div>
        )}

        <Card padding="none">
          {convo.messages.length === 0 ? (
            <p className="px-5 py-10 text-sm text-text-3 text-center">
              No messages yet{canPost ? " — say hello below." : "."}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5 px-3 py-5 sm:px-4">
              {convo.messages.map((m, i) => {
                // Right-align the viewer's own messages (iMessage style); others
                // sit left. Group a run of consecutive messages from one sender so
                // the avatar + name only show on the first of the run.
                const isOwn = m.senderId === userId
                const startsRun = i === 0 || convo.messages[i - 1].senderId !== m.senderId
                const showName = convo.type !== "DIRECT_MESSAGE" && !isOwn && startsRun
                return (
                  <li
                    key={m.id}
                    className={`flex items-end gap-2 ${isOwn ? "flex-row-reverse" : "flex-row"} ${
                      startsRun && i !== 0 ? "mt-2" : ""
                    }`}
                  >
                    {!isOwn &&
                      (startsRun ? (
                        <Avatar name={m.sender.name ?? "?"} imageUrl={m.sender.image} size="sm" />
                      ) : (
                        <div className="w-8 shrink-0" aria-hidden />
                      ))}
                    <div className={`flex min-w-0 max-w-[76%] flex-col ${isOwn ? "items-end" : "items-start"}`}>
                      {showName && (
                        <span className="mb-0.5 px-1 text-[12px] font-medium text-text-3">
                          {m.sender.name ?? "Unknown"}
                        </span>
                      )}
                      {m.body && (
                        <div
                          className={`w-fit break-words rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed ${
                            isOwn
                              ? "rounded-br-md bg-[--primary] text-[--primary-text]"
                              : "rounded-bl-md bg-subtle text-text-1"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{m.body}</p>
                        </div>
                      )}
                      {m.attachments.length > 0 && (
                        <div className={`mt-1 flex flex-wrap gap-2 ${isOwn ? "justify-end" : "justify-start"}`}>
                          {m.attachments.map((a) => (
                            <AttachmentChip
                              key={a.id}
                              id={a.id}
                              fileName={a.fileName}
                              mimeType={a.mimeType}
                              sizeBytes={a.sizeBytes}
                            />
                          ))}
                        </div>
                      )}
                      <span className="px-1 pt-0.5 text-[12px] text-text-3">
                        {m.createdAt.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {canPost ? (
          <form action={sendWithId} encType="multipart/form-data" className="mt-4">
            <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-1.5 shadow-xs transition-colors focus-within:border-[--border-focus]">
              {storageConfigured() && (
                <label
                  className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-text-3 transition-colors hover:bg-base hover:text-text-1"
                  title="Attach files"
                >
                  <Paperclip size={17} />
                  <input type="file" name="attachments" multiple className="sr-only" aria-label="Attach files" />
                </label>
              )}
              <input
                name="body"
                autoComplete="off"
                placeholder="Write a message…"
                className="h-9 flex-1 bg-transparent px-2 text-[15px] text-text-1 outline-none placeholder:text-text-3"
              />
              <button
                aria-label="Send"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[--primary] text-[--primary-text] transition-colors hover:bg-[--primary-hover]"
              >
                <ArrowRight size={18} />
              </button>
            </div>
          </form>
        ) : (
          <p className="mt-4 text-xs text-text-3">
            {convo.type === "OSE_BROADCAST"
              ? "Broadcasts are read-only."
              : "You have read-only access to this conversation."}
          </p>
        )}
      </div>
    )
  })
}
