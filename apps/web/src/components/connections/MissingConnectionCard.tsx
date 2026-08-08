"use client"

import { type ReactNode } from "react"
import Link from "next/link"

import {
  resolveCapability,
  type CapabilityState,
  type ConnectionResolution,
} from "@/lib/connections/capability-resolution"

/**
 * TTES-030-005 / WRK-110-005 — the owned connection card, and the one control
 * a resolution earns.
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

/**
 * The single control, rendered from a resolution.
 *
 * Exported because there are two surfaces that must offer the same control for
 * the same capability — this card (the Relay panel) and the Connection Centre
 * in `app/(app)/settings/page.tsx` — and WRK-110-005 opened because the second
 * rendered none at all, while the first had branches for `ask-admin` and
 * `connect` and no `disconnect` anywhere in the tree. Two renderers of one
 * decision drift; one renderer with two callers cannot.
 *
 * The split between what comes from where is deliberate and is the rule
 * `resolveCapability`'s header states:
 *
 *   * WHICH control, and what it says — `action.kind` and `action.label`, from
 *     the resolution. A call site cannot choose to offer Connect for something
 *     that is connected, or any control at all for something uncertified.
 *   * WHERE it goes — `href`, from the declaration. Which page of Tenure
 *     manages a capability is a fact about that capability, and the resolver is
 *     deliberately free of route knowledge (it is shared with a client bundle).
 *
 * Every kind except `none` renders the same way: a person following a control
 * should not have to learn a different affordance per outcome. `none` renders
 * nothing, which is the whole point of it existing.
 */
export function ConnectionActionControl({
  action,
  href,
}: {
  action: ConnectionResolution["action"]
  /** Where in Tenure this capability is managed. Never a provider console. */
  href: string
}) {
  if (action.kind === "none") return null

  // `connect` is the affirmative path and reads as one; everything else —
  // disconnect, reauthorize, upgrade-scope, choose-resources, ask-admin — is a
  // secondary control, because none of them is the thing the person came for.
  const primary = action.kind === "connect"

  return (
    <Link
      href={href}
      data-connection-action={action.kind}
      className={
        primary
          ? "mt-3 inline-flex h-9 items-center rounded-md bg-[--primary] px-3 text-[13px] font-medium text-[--primary-text] no-underline transition-colors hover:bg-[--primary-hover]"
          : "mt-3 inline-flex h-9 items-center rounded-md border border-border-strong px-3 text-[13px] font-medium text-text-1 no-underline transition-colors hover:bg-subtle"
      }
    >
      {action.label}
    </Link>
  )
}

export function MissingConnectionCard({
  capability,
  /** Where in Tenure this capability is managed. See `ConnectionActionControl`. */
  manageHref,
  /**
   * What the person was doing when they hit this. Held so the resumption is
   * real: the card shows it back, and the caller can requeue it once the
   * capability connects. Never persisted anywhere — this is component state
   * passed straight back out.
   */
  pendingIntent,
  alternative,
}: {
  capability: CapabilityState
  manageHref: string
  pendingIntent?: string
  /**
   * A richer alternative than the resolution's sentence — the Relay panel
   * passes a link to search. Falls back to `resolved.alternative`, so a caller
   * that passes nothing still gets the way forward the resolution decided
   * rather than a dead end.
   */
  alternative?: ReactNode
}) {
  const resolved = resolveCapability(capability)

  return (
    <div
      className="missing-connection rounded-lg border border-border bg-base px-4 py-3.5"
      data-capability={capability.key}
      data-connection-outcome={resolved.outcome}
      data-connection-status={resolved.statusWord}
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
      <ConnectionActionControl action={resolved.action} href={manageHref} />

      {alternative ? (
        <div className="mt-3 text-[13px] text-text-2">{alternative}</div>
      ) : resolved.alternative ? (
        <p className="mt-3 text-[13px] text-text-2">{resolved.alternative}</p>
      ) : null}
    </div>
  )
}
