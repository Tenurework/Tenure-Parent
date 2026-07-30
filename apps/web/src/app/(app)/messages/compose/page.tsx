import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { Card, CardHeader } from "@/components/ui/Card"
import { BackButton } from "@/components/BackButton"
import { DraftAssist } from "@/components/DraftAssist"
import { aiConfigured } from "@/lib/ai"
import { composeMessage, getAllowedRecipients } from "../actions"

export const dynamic = "force-dynamic"

function RecipientSelect({
  name,
  label,
  required,
  recipients,
}: {
  name: string
  label: string
  required?: boolean
  recipients: { id: string; name: string | null; email: string | null; label: string }[]
}) {
  return (
    <label className="block text-xs text-text-2">
      {label}
      <select
        name={name}
        multiple
        required={required}
        size={Math.min(5, Math.max(3, recipients.length))}
        className="mt-1 w-full rounded border border-border px-2 py-1 text-sm text-text-1 bg-surface"
        aria-label={label}
      >
        {recipients.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name ?? r.email} — {r.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default async function ComposePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  const recipients = await getAllowedRecipients(session.user.id)

  return (
    <div className="max-w-2xl">
      <BackButton />
      <div className="mb-6">
        <h1 className="text-text-1">New message</h1>
        <p className="text-sm text-text-2 mt-1">
          Recipients follow the role hierarchy — you only see people you may address.
        </p>
      </div>

      {recipients.length === 0 ? (
        <Card>
          <p className="text-sm text-text-2 py-4 text-center">
            Your current role cannot start messages. Shadow and alumni access is read-only.
          </p>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Compose" subtitle="Hold Ctrl/Cmd to select multiple recipients" />
          <form action={composeMessage} className="space-y-4">
            <RecipientSelect name="to" label="To" required recipients={recipients} />
            <RecipientSelect name="cc" label="Cc (optional)" recipients={recipients} />
            <RecipientSelect name="bcc" label="Bcc (optional — hidden from other recipients)" recipients={recipients} />
            <label className="block text-xs text-text-2">
              Subject
              <input
                name="subject"
                required
                maxLength={200}
                placeholder="Spring gala budget question"
                className="mt-1 h-9 w-full rounded border border-border px-3 text-sm text-text-1 bg-surface placeholder:text-text-3"
              />
            </label>
            <label className="block text-xs text-text-2">
              Message
              <textarea
                name="body"
                required
                rows={6}
                placeholder="Write your message…"
                className="mt-1 w-full rounded border border-border px-3 py-2 text-sm text-text-1 bg-surface placeholder:text-text-3"
              />
            </label>
            {aiConfigured() && <DraftAssist kind="message" targetName="body" />}
            <button className="h-9 rounded bg-[--primary] px-5 text-sm font-medium text-[--primary-text] hover:opacity-90">
              Send
            </button>
          </form>
        </Card>
      )}
    </div>
  )
}
