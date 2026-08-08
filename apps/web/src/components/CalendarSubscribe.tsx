"use client"

import { useId, useState } from "react"
import { Button } from "@/components/ui/Button"
import { CalendarDays, ExternalLink } from "@/components/ui/icons"
import { Overlay } from "@/components/ui/Overlay"
import { calendarSyncSentence } from "@tenure/platform-config"

/**
 * The subscription dialog: the per-user ICS feed URL, and one honest sentence
 * about what subscribing does.
 *
 * WRK-GATE-080. This component used to tell a student "Two-way sync (edits made
 * in Outlook flowing back into Tenure) turns on once your institution connects
 * Microsoft 365", and to call the feed "the credential-free half of Outlook
 * sync". There is no other half. No Microsoft Graph connector exists, no app
 * registration exists, and nobody has submitted anything to a Microsoft review
 * programme.
 *
 * So the sentence is a LOOKUP, not a literal: `sync` is
 * `calendarSyncSentence(now)` — `providerActivation(GRAPH_CALENDAR_SCOPES,
 * GRAPH_CALENDAR_REVIEW, now)` — resolved by the calendar page and passed in.
 * The copy cannot outlive the record, in either direction: it cannot promise a
 * sync nobody has built, and it cannot keep denying one after somebody records
 * a real approval.
 *
 * `sync` is a required prop rather than a default computed here. There is one
 * construction site, `app/(app)/calendar/page.tsx`, and a default would let a
 * future caller ship this dialog with copy nobody decided.
 */
export function CalendarSubscribe({
  feedPath,
  sync,
}: {
  feedPath: string
  sync: ReturnType<typeof calendarSyncSentence>
}) {
  const [copied, setCopied] = useState(false)
  /**
   * The field's id, so "Subscription URL" is its LABEL and not a paragraph that
   * happens to sit above it.
   *
   * The `<label>` below carried no `htmlFor` and the input no `id`, so the
   * element a screen reader reached was an unnamed text box and the only way a
   * test could find it was `input[readonly]` — a selector that names the
   * styling, not the field. `useId` rather than a constant because two dialogs
   * can be mounted at once (the calendar page renders one; a future caller may
   * render another) and a duplicated id would point both labels at the first.
   */
  const urlFieldId = useId()

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
    <Button variant="secondary" size="md">
      <CalendarDays size={16} className="text-text-3" /> Subscribe
    </Button>
  )

  return (
    <Overlay trigger={trigger} title="Subscribe to your Tenure calendar" size="md">
      <div className="space-y-5">
        <p className="text-sm text-text-2">
          Add this calendar to Outlook, Google or Apple Calendar and your Tenure events keep
          themselves up to date automatically.
        </p>

        <div>
          <label
            htmlFor={urlFieldId}
            className="mb-1.5 block text-[13px] font-semibold text-text-2"
          >
            Subscription URL
          </label>
          <div className="flex gap-2">
            <input
              id={urlFieldId}
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
          <p className="mt-1.5 text-meta text-text-3">
            This link is yours alone and stops working 180 days after it was issued. Open this
            dialog again for a fresh one, and don&apos;t paste it anywhere public.
          </p>
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

        <p className="text-meta text-text-3" data-testid="calendar-sync-claim">
          {sync.sentence}
        </p>
      </div>
    </Overlay>
  )
}
