"use client"

import { useEffect } from "react"
import Link from "next/link"
import { CalendarDays, RotateCw } from "@/components/ui/icons"

/**
 * Closer error boundary for the calendar segment. The date/scope loading here
 * is the riskiest part of this route, so a transient failure recovers with a
 * single "Try again" instead of unmounting the shell.
 */
export default function CalendarError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[calendar-error]", error.digest, error)
  }, [error])

  return (
    <div className="max-w-xl py-12">
      <div className="rounded-lg border border-border bg-surface p-8 shadow-sm">
        <span className="grid h-11 w-11 place-items-center rounded-full border border-border text-text-3">
          <CalendarDays size={22} />
        </span>

        <h1 className="mt-5 text-lead font-semibold text-text-1">
          The calendar couldn&rsquo;t load
        </h1>
        <p className="mt-2 text-sm text-text-2">
          Try again — your events are safe and nothing was changed.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-md bg-[--primary] px-4 py-2 text-sm font-medium text-white hover:bg-[--primary-hover]"
          >
            <RotateCw size={15} />
            Try again
          </button>
          <Link
            href="/calendar"
            className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium text-text-1 no-underline hover:bg-base"
          >
            Back to this month
          </Link>
        </div>

        {error.digest && (
          <p className="mt-6 font-mono text-xs text-text-3">Reference: {error.digest}</p>
        )}
      </div>
    </div>
  )
}
