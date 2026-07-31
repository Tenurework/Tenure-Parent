"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, ExternalLink } from "@/components/ui/icons"

export interface QuickLink {
  id: string
  title: string
  href: string
  external: boolean
}

const PER_PAGE = 3
const INTERVAL = 9000

/**
 * A compact, self-rotating quick-links card. Shows a small page of links and
 * advances to the next page every 9 seconds (pausing on hover), so the card
 * stays small while still surfacing everything a board member reaches for.
 */
export function QuickLinksRotator({ links }: { links: QuickLink[] }) {
  const pages = Math.max(1, Math.ceil(links.length / PER_PAGE))
  const [page, setPage] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused || pages <= 1) return
    const id = setInterval(() => setPage((p) => (p + 1) % pages), INTERVAL)
    return () => clearInterval(id)
  }, [paused, pages])

  const shown = links.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-text-1">Quick links</h2>
          <p className="text-[13px] text-text-3">For the seats you hold.</p>
        </div>
        <Link
          href="/resources"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-text-link no-underline hover:underline"
        >
          All resources <ArrowRight size={13} />
        </Link>
      </div>

      <ul key={page} className="pop-panel space-y-2">
        {shown.map((r) => {
          const content = (
            <>
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              {r.external ? (
                <ExternalLink size={14} className="shrink-0 text-text-3" aria-hidden />
              ) : (
                <ArrowRight size={14} className="shrink-0 text-text-3" aria-hidden />
              )}
            </>
          )
          const className =
            "flex items-center gap-2 rounded-md border border-border px-3.5 py-2.5 text-sm font-medium text-text-1 no-underline transition-colors hover:border-[--primary] hover:bg-base"
          return (
            <li key={r.id}>
              {r.external ? (
                <a href={r.href} target="_blank" rel="noopener noreferrer" className={className}>
                  {content}
                </a>
              ) : r.href.startsWith("/api/") ? (
                // Downloads need a real anchor, not a router navigation
                <a href={r.href} download className={className}>
                  {content}
                </a>
              ) : (
                <Link href={r.href} className={className}>
                  {content}
                </Link>
              )}
            </li>
          )
        })}
      </ul>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1.5" aria-label="Quick link pages">
          {Array.from({ length: pages }).map((_, i) => (
            <button
              key={i}
              aria-label={`Show quick links page ${i + 1}`}
              aria-current={i === page ? "true" : undefined}
              onClick={() => setPage(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === page ? "w-5 bg-[--primary]" : "w-1.5 bg-border-strong hover:bg-text-3"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
