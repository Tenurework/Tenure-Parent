"use client"

import { useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import { CalendarDays, ExternalLink } from "@/components/ui/icons"
import { Overlay } from "@/components/ui/Overlay"

/**
 * Subscribe-to-Outlook flow. The per-user ICS feed URL, which Outlook / Google /
 * Apple Calendar poll to keep a student's school calendar in step with Tenure —
 * the credential-free half of Outlook sync.
 */
export function CalendarSubscribe({ feedPath }: { feedPath: string }) {
  const [copied, setCopied] = useState(false)

  // Built on the client so it always reflects the real deployed origin.
  const httpsUrl = typeof window !== "undefined" ? `${window.location.origin}${feedPath}` : feedPath
  const webcalUrl = httpsUrl.replace(/^https?:/, "webcal:")

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(httpsUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — the field is selectable */
    }
  }

  const trigger = (
    <AriaButton className="inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium text-text-1 outline-none transition-colors data-[hovered]:bg-base data-[focus-visible]:ring-2 data-[focus-visible]:ring-[--primary]">
      <CalendarDays size={16} className="text-text-3" /> Subscribe
    </AriaButton>
  )

  return (
    <Overlay trigger={trigger} title="Sync with Outlook" size="md">
      <div className="space-y-5">
        <p className="text-sm text-text-2">
          Add this calendar to Outlook, Google or Apple Calendar and your Tenure events keep
          themselves up to date automatically.
        </p>

        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-text-2">
            Subscription URL
          </label>
          <div className="flex gap-2">
            <input
              readOnly
              value={httpsUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="h-10 flex-1 rounded-md border border-border bg-base px-3 text-[13px] text-text-1 outline-none"
            />
            <button
              onClick={copy}
              className="h-10 shrink-0 rounded-md bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:bg-[--primary-hover]"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <a
          href={webcalUrl}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-text-link no-underline hover:underline"
        >
          <ExternalLink size={15} /> Open in your default calendar app (webcal)
        </a>

        <div className="rounded-lg border border-border bg-subtle p-4 text-[13px] text-text-2">
          <p className="font-semibold text-text-1">Outlook (web)</p>
          <p className="mt-1">
            Calendar → Add calendar → Subscribe from web → paste the URL above → Import.
          </p>
          <p className="mt-3 font-semibold text-text-1">Google Calendar</p>
          <p className="mt-1">
            Other calendars → From URL → paste the URL above → Add calendar.
          </p>
        </div>

        <p className="text-meta text-text-3">
          Two-way sync (edits made in Outlook flowing back into Tenure) turns on once your
          institution connects Microsoft&nbsp;365.
        </p>
      </div>
    </Overlay>
  )
}
