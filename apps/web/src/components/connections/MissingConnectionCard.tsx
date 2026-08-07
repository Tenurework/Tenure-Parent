"use client"

import { type ReactNode } from "react"

import {
  resolveCapability,
  type CapabilityState,
} from "@/lib/connections/capability-resolution"

/**
 * TTES-030-005 — the owned missing-connection card.
 *
 * What this replaces, where it is used first: the Relay panel's unconnected
 * state was one line of prose ("AI answers aren't set up for this workspace
 * yet") with no ownership, no path to an administrator, and nothing preserving
 * the question the person had just asked. The Bible's card is four things:
 * plain language about what the capability gives you, who owns it, exactly one
 * path (connect / ask an administrator / an alternative), and the work you were
 * doing kept for when it resumes.
 *
 * The one control is decided by `resolveCapability`, never by this component —
 * so a capability the platform has not certified cannot grow a Connect button
 * because a call site thought it should have one.
 */
export function MissingConnectionCard({
  capability,
  /**
   * What the person was doing when they hit this. Held so the resumption is
   * real: the card shows it back, and the caller can requeue it once the
   * capability connects. Never persisted anywhere — this is component state
   * passed straight back out.
   */
  pendingIntent,
  onAskAdmin,
  onConnect,
  alternative,
}: {
  capability: CapabilityState
  pendingIntent?: string
  onAskAdmin?: () => void
  onConnect?: () => void
  alternative?: ReactNode
}) {
  const resolved = resolveCapability(capability)

  return (
    <div
      className="missing-connection rounded-lg border border-border bg-base px-4 py-3.5"
      data-capability={capability.key}
      data-connection-outcome={resolved.outcome}
    >
      <p className="text-sm font-semibold text-text-1">{capability.label}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-text-2">{resolved.explanation}</p>
      <p className="mt-2 text-meta uppercase tracking-wide text-text-3">
        Owned by {resolved.owner}
      </p>

      {pendingIntent ? (
        <p className="mt-3 rounded-md border border-border px-2.5 py-2 text-[13px] text-text-2">
          <span className="font-medium text-text-1">Kept for when this connects:</span>{" "}
          {pendingIntent}
        </p>
      ) : null}

      {/* Exactly one control, and only the one the resolution allows. */}
      {resolved.action.kind === "ask-admin" ? (
        <button
          type="button"
          onClick={onAskAdmin}
          aria-label={resolved.action.label}
          className="mt-3 inline-flex h-9 items-center rounded-md border border-border-strong px-3 text-[13px] font-medium text-text-1 transition-colors hover:bg-subtle"
        >
          {resolved.action.label}
        </button>
      ) : null}

      {resolved.action.kind === "connect" ? (
        <button
          type="button"
          onClick={onConnect}
          aria-label={resolved.action.label}
          className="mt-3 inline-flex h-9 items-center rounded-md bg-[--primary] px-3 text-[13px] font-medium text-[--primary-text] transition-colors hover:bg-[--primary-hover]"
        >
          {resolved.action.label}
        </button>
      ) : null}

      {alternative ? <div className="mt-3 text-[13px] text-text-2">{alternative}</div> : null}
    </div>
  )
}
