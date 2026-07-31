"use client"

import { type ReactNode, useState } from "react"
import Link from "next/link"
import { ArrowRight } from "@/components/ui/icons"
import { Overlay } from "./Overlay"

/**
 * The product-wide answer to overflowing panels. Instead of a section that
 * scrolls its own inner list to a different height than its neighbours, every
 * long section shows a fixed, uniform preview and a single "See all" control
 * that either opens a centered overlay with the complete list or routes to the
 * section's own page. Panels stay the same height across the whole dashboard.
 */
export function SeeAllSection({
  title,
  count,
  children,
  full,
  href,
  overlayTitle,
  overlayDescription,
  action,
  className,
}: {
  title: string
  /** Total items behind the preview — surfaced on the "See all" control. */
  count?: number
  /** The capped preview rendered inline. */
  children: ReactNode
  /** Full content for the overlay. When present, "See all" opens the overlay. */
  full?: ReactNode
  /** Route to the full page. Used when `full` is not supplied. */
  href?: string
  overlayTitle?: string
  overlayDescription?: string
  /** Extra header control (e.g. a filter), shown left of "See all". */
  action?: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const showSeeAll = Boolean(full) || Boolean(href)
  const label = typeof count === "number" ? `See all (${count})` : "See all"

  return (
    <section className={className}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lead font-display font-semibold text-text-1">{title}</h2>
        <div className="flex items-center gap-3">
          {action}
          {showSeeAll &&
            (full ? (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-text-link outline-none transition-colors hover:bg-base focus-visible:ring-2 focus-visible:ring-[--primary]"
              >
                {label}
                <ArrowRight size={15} className="shrink-0" />
              </button>
            ) : (
              <Link
                href={href!}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-text-link no-underline outline-none transition-colors hover:bg-base focus-visible:ring-2 focus-visible:ring-[--primary]"
              >
                {label}
                <ArrowRight size={15} className="shrink-0" />
              </Link>
            ))}
        </div>
      </div>

      {children}

      {full && (
        <Overlay
          isOpen={open}
          onOpenChange={setOpen}
          title={overlayTitle ?? title}
          description={overlayDescription}
          size="lg"
        >
          {full}
        </Overlay>
      )}
    </section>
  )
}
