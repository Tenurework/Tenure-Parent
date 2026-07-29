"use client"

import { useActionState, useEffect, useState } from "react"
import { Overlay } from "@/components/ui/Overlay"
import { Button } from "@/components/ui/Button"
import { publishResource, type ResourceFormState } from "@/app/(app)/resources/actions"
import {
  KIND_LABELS,
  RESOURCE_KINDS,
  SEAT_KEYS,
  SEAT_LABELS,
  type Resource,
} from "@/lib/resources"

const fieldClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-1 outline-none transition-colors focus:border-[--border-focus] focus:[box-shadow:var(--shadow-focus)]"
const labelClass = "block text-[13px] font-semibold text-text-2"

/**
 * Publish or edit a board resource.
 *
 * Only rendered for viewers who pass `canManageResources`, and the server
 * action re-checks — the dialog is the affordance, not the control.
 */
export function ResourceEditor({
  resource,
  isOpen,
  onClose,
}: {
  /** Omit to publish a new resource. */
  resource?: Resource
  isOpen: boolean
  onClose: () => void
}) {
  const [state, formAction, pending] = useActionState<ResourceFormState, FormData>(
    publishResource,
    {}
  )
  const [seats, setSeats] = useState<string[]>(resource?.seats ?? ["ALL"])

  useEffect(() => {
    if (state.ok) onClose()
  }, [state.ok, onClose])

  useEffect(() => {
    if (isOpen) setSeats(resource?.seats ?? ["ALL"])
  }, [isOpen, resource])

  const toggleSeat = (seat: string) =>
    setSeats((s) => (s.includes(seat) ? s.filter((x) => x !== seat) : [...s, seat]))

  return (
    <Overlay
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      size="md"
      title={resource ? "Edit resource" : "Publish a resource"}
      description="Routed to the seats you choose, and surfaced on their dashboards."
    >
      <form id="resource-form" action={formAction} className="space-y-4">
        {resource && <input type="hidden" name="id" value={resource.id} />}

        {state.error && (
          <p
            role="alert"
            className="rounded-md border border-[--error] px-3 py-2 text-[13px] text-[--error]"
          >
            {state.error}
          </p>
        )}

        <label className={labelClass}>
          Title
          <input
            name="title"
            required
            maxLength={160}
            defaultValue={resource?.title}
            placeholder="Room Booking Request"
            className={`mt-1 ${fieldClass}`}
          />
        </label>

        <label className={labelClass}>
          Description
          <textarea
            name="description"
            required
            rows={2}
            maxLength={600}
            defaultValue={resource?.description}
            placeholder="What this is for, in one sentence."
            className={`mt-1 ${fieldClass}`}
          />
        </label>

        {/* Helper text lives outside the <label> and is wired with
            aria-describedby. Nesting it inside would fold it into the field's
            accessible name — which made "Link" and "Hard rule" ambiguous to
            both screen readers and tests, since the rule's hint mentions "link". */}
        <div>
          <label htmlFor="resource-href" className={labelClass}>
            Link
          </label>
          <input
            id="resource-href"
            name="href"
            required
            aria-describedby="resource-href-hint"
            defaultValue={resource?.href}
            placeholder="https://… or /resources/…"
            className={`mt-1 ${fieldClass}`}
          />
          <p id="resource-href-hint" className="mt-1 text-xs text-text-3">
            A full https:// address, or an internal Tenure path starting with /.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Type
            <select
              name="kind"
              defaultValue={resource?.kind ?? "GUIDE"}
              className={`mt-1 ${fieldClass}`}
            >
              {RESOURCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>

          <label className={`${labelClass} flex flex-col justify-end`}>
            <span className="mb-1">Availability</span>
            <select
              name="ready"
              defaultValue={resource?.ready === false ? "off" : "on"}
              className={fieldClass}
            >
              <option value="on">Live — officers can open it</option>
              <option value="off">Being built — shown but not clickable</option>
            </select>
          </label>
        </div>

        <fieldset>
          <legend className={labelClass}>Route to</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {SEAT_KEYS.map((seat) => {
              const on = seats.includes(seat)
              return (
                <button
                  key={seat}
                  type="button"
                  onClick={() => toggleSeat(seat)}
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    on
                      ? "border-[--primary] bg-[--primary] text-[--primary-text]"
                      : "border-border text-text-2 hover:border-[--border-strong] hover:text-text-1"
                  }`}
                >
                  {SEAT_LABELS[seat]}
                </button>
              )
            })}
          </div>
          {seats.map((s) => (
            <input key={s} type="hidden" name="seats" value={s} />
          ))}
          {seats.length === 0 && (
            <p className="mt-2 text-xs text-[--error]">Choose at least one seat.</p>
          )}
        </fieldset>

        <div>
          <label htmlFor="resource-rule" className={labelClass}>
            Hard rule <span className="font-normal text-text-3">(optional)</span>
          </label>
          <input
            id="resource-rule"
            name="rule"
            maxLength={300}
            aria-describedby="resource-rule-hint"
            defaultValue={resource?.rule ?? ""}
            placeholder="Submit at least 3 weeks in advance."
            className={`mt-1 ${fieldClass}`}
          />
          <p id="resource-rule-hint" className="mt-1 text-xs text-text-3">
            Surfaced beside the link, so the deadline is impossible to miss.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-border pt-4">
          <Button variant="secondary" size="sm" onPress={onClose}>
            Cancel
          </Button>
          <button
            type="submit"
            disabled={pending || seats.length === 0}
            className="inline-flex h-8 items-center rounded-md bg-[--primary] px-3.5 text-[13px] font-medium text-[--primary-text] transition-colors hover:bg-[--primary-hover] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Saving…" : resource ? "Save changes" : "Publish resource"}
          </button>
        </div>
      </form>
    </Overlay>
  )
}
