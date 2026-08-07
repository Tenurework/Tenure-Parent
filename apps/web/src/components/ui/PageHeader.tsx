import { type ReactNode } from "react"
import Link from "next/link"
import { ChevronRight } from "@/components/ui/icons"

/**
 * The Atlassian-style page header: a consistent title block at the top of every
 * page with an optional breadcrumb trail, a lead subtitle, and a right-aligned
 * actions slot. Using one component means every page announces itself the same
 * way and the primary action always lands in the same spot.
 */
export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
  eyebrow,
  status,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  breadcrumbs?: { label: string; href?: string }[]
  actions?: ReactNode
  /** A small label above the title, e.g. a section or club name. */
  eyebrow?: ReactNode
  /**
   * TTES-030-001, Bible section 5.3 (record anatomy). The record's STATE, sat
   * between its identity and its primary actions — badges, a lifecycle chip, a
   * count of what is outstanding. A page header that names a record without
   * saying what state it is in makes the reader hunt the page for it, and
   * different pages hid it in different places.
   */
  status?: ReactNode
  className?: string
}) {
  return (
    <header className={`mb-5 sm:mb-6 ${className ?? ""}`}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-meta text-text-3">
          {breadcrumbs.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight size={13} className="text-text-disabled" />}
              {c.href ? (
                <Link href={c.href} className="no-underline text-text-3 transition-colors hover:text-text-1">
                  {c.label}
                </Link>
              ) : (
                <span className="text-text-2">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 text-meta font-semibold uppercase tracking-wider text-text-3">
              {eyebrow}
            </p>
          )}
          <h1 className="text-text-1">{title}</h1>
          {status && <div className="mt-2 flex flex-wrap items-center gap-2">{status}</div>}
          {subtitle && (
            <p className="mt-1.5 max-w-2xl text-lead text-text-2">{subtitle}</p>
          )}
        </div>
        {/* The action row wraps instead of pushing the page wide.
            `shrink-0` here used to defeat the `flex-wrap` beside it: the row
            refused to narrow, so it never had a reason to wrap and instead
            forced horizontal scroll on every page with several actions (the
            calendar's filter + subscribe + propose row overflowed a 768px
            tablet by ~120px). `min-w-0` lets it take the space it has. */}
        {actions && (
          <div className="flex min-w-0 flex-wrap items-center gap-2.5 sm:justify-end">
            {actions}
          </div>
        )}
      </div>
    </header>
  )
}
