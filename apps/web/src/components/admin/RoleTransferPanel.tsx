"use client"

import { useState } from "react"
import { ArrowLeftRight, ShieldCheck, X, CheckCircle } from "@/components/ui/icons"
import { Card, CardHeader } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Avatar } from "@/components/ui/Avatar"
import { ConfirmSubmit } from "@/components/ui/ConfirmDialog"
import {
  initiateRoleTransfer,
  acceptRoleTransfer,
  declineRoleTransfer,
  cancelRoleTransfer,
} from "@/app/(app)/admin/actions"

export interface TransferView {
  id: string
  fromName: string
  fromEmail: string | null
  toName: string
  toEmail: string | null
  note: string | null
  /** null = the outgoing Director leaves the console entirely. */
  stepDownRole: "OSE_STAFF" | null
  createdAt: string
}

function landingWord(stepDownRole: "OSE_STAFF" | null): string {
  return stepDownRole ? "step down to OSE Staff" : "leave the OSE console entirely"
}

/**
 * The OSE Director / administration transfer pipeline surface. Shows the
 * signed-in admin any handoff waiting on THEM (accept / decline), and — for a
 * current Director — the control to start a handoff plus any of their own
 * pending transfers (cancel). The outgoing Director keeps their role the whole
 * time; only accepting completes the swap.
 */
export function RoleTransferPanel({
  incoming,
  outgoing,
  canInitiate,
}: {
  incoming: TransferView[]
  outgoing: TransferView[]
  canInitiate: boolean
}) {
  const [showForm, setShowForm] = useState(false)

  if (incoming.length === 0 && outgoing.length === 0 && !canInitiate) return null

  return (
    <Card>
      <CardHeader
        title="Director transfer"
        subtitle="Hand the OSE Director role to a successor as one clean, two-party step. You keep full access until they accept — the institution is never left without a Director."
      />

      {/* Incoming — a handoff is waiting on this person. */}
      {incoming.length > 0 && (
        <div className="mb-5 space-y-3">
          {incoming.map((t) => (
            <div
              key={t.id}
              className="rounded-lg border border-[--accent] bg-[--accent-light] p-4"
            >
              <div className="flex items-start gap-3">
                <Avatar name={t.fromName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-1">
                    {t.fromName} wants to hand you the OSE Director role
                  </p>
                  <p className="mt-0.5 text-[13px] text-text-2">
                    If you accept, you become OSE Director and {t.fromName} will{" "}
                    {landingWord(t.stepDownRole)}. Nothing changes until you accept.
                  </p>
                  {t.note && (
                    <p className="mt-2 rounded-md bg-surface px-3 py-2 text-[13px] italic text-text-2">
                      “{t.note}”
                    </p>
                  )}
                </div>
                <Badge variant="accent">Awaiting you</Badge>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <ConfirmSubmit
                  action={declineRoleTransfer}
                  hiddenFields={{ transferId: t.id }}
                  title="Decline this transfer?"
                  description={`Let ${t.fromName} know you can't take over as OSE Director right now. Nothing changes — they stay Director and can invite someone else.`}
                  confirmLabel="Decline"
                  variant="danger"
                  triggerVariant="secondary"
                >
                  <X size={15} /> Decline
                </ConfirmSubmit>
                <ConfirmSubmit
                  action={acceptRoleTransfer}
                  hiddenFields={{ transferId: t.id }}
                  title="Accept the OSE Director role?"
                  description={`You'll become the OSE Director for this institution right away, and ${t.fromName} will ${landingWord(
                    t.stepDownRole
                  )}. This is the full keys to the console.`}
                  details={
                    <>
                      You&rsquo;ll gain: every OSE Director power — chartering and
                      archiving clubs, assigning and transferring seats, approval
                      and budget overrides, and granting OSE access. The change is
                      logged in the audit trail.
                    </>
                  }
                  confirmLabel="Accept and take over"
                  variant="primary"
                  triggerVariant="primary"
                >
                  <CheckCircle size={15} /> Accept
                </ConfirmSubmit>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Outgoing — this person's own pending handoffs. */}
      {outgoing.length > 0 && (
        <div className="mb-5 space-y-2">
          <p className="micro-label">Pending handoffs you started</p>
          {outgoing.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-base p-3"
            >
              <ArrowLeftRight size={16} className="shrink-0 text-text-3" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-1">
                  Director role → {t.toName}
                  {t.toEmail ? ` (${t.toEmail})` : ""}
                </p>
                <p className="text-[13px] text-text-3">
                  Waiting for them to accept. You&rsquo;ll {landingWord(t.stepDownRole)} once they do.
                </p>
              </div>
              <Badge variant="default">Pending</Badge>
              <ConfirmSubmit
                action={cancelRoleTransfer}
                hiddenFields={{ transferId: t.id }}
                title="Cancel this transfer?"
                description={`Withdraw the Director handoff to ${t.toName}. You keep the Director role and they'll be told it was called off.`}
                confirmLabel="Cancel transfer"
                variant="danger"
                triggerVariant="secondary"
                triggerAriaLabel={`Cancel transfer to ${t.toName}`}
              >
                <X size={15} /> Cancel
              </ConfirmSubmit>
            </div>
          ))}
        </div>
      )}

      {/* Initiate — Director only. */}
      {canInitiate && (
        <div className="border-t border-border pt-4">
          {!showForm ? (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium text-text-1 outline-none transition-colors hover:bg-base"
            >
              <ArrowLeftRight size={16} className="text-text-3" /> Transfer Director role
            </button>
          ) : (
            <form action={initiateRoleTransfer} className="space-y-4">
              <p className="text-sm text-text-2">
                Invite a successor to take over as OSE Director. They&rsquo;ll be notified and can accept
                or decline. You keep every Director power until they accept — there&rsquo;s no gap in
                coverage.
              </p>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-text-2">
                Successor email
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="successor@rochester.edu"
                  className="h-10 rounded-md border border-border px-3.5 text-[15px] text-text-1 bg-surface outline-none focus:border-[--border-focus] placeholder:text-text-3"
                />
              </label>
              <fieldset className="flex flex-col gap-2 text-[13px] text-text-2">
                <legend className="mb-1 font-semibold">When they accept, you will…</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="stepDown" value="STEP_DOWN" defaultChecked />
                  Step down to OSE Staff (keep console access at a lower level)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="stepDown" value="REVOKE" />
                  Leave the OSE console entirely
                </label>
              </fieldset>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-text-2">
                A note for your successor (optional)
                <textarea
                  name="note"
                  rows={2}
                  placeholder="A quick word on where things stand…"
                  className="rounded-md border border-border px-3.5 py-2 text-[15px] text-text-1 bg-surface outline-none focus:border-[--border-focus] placeholder:text-text-3"
                />
              </label>
              <div className="flex items-center gap-2">
                <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[--accent] px-5 text-sm font-medium text-[--accent-text] hover:bg-[--accent-hover]">
                  <ShieldCheck size={16} /> Send transfer invite
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="inline-flex h-10 items-center rounded-md px-4 text-sm font-medium text-text-2 hover:bg-base"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </Card>
  )
}
