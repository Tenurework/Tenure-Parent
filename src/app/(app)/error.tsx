"use client"

import { useEffect } from "react"
import Link from "next/link"
import { AlertCircle, RotateCw } from "@/components/ui/icons"

/**
 * Segment error boundary for the whole (app) shell. Because it lives at
 * (app)/, the header, side-nav and footer rendered by (app)/layout.tsx stay
 * put — only the page content is replaced by this calm card. "Try again"
 * calls reset() to re-render the failed segment in place, so a transient
 * failure (a DB blip, a slow S3 read) recovers without a full reload.
 *
 * No scary wording: the user never needs to know it was a server exception,
 * only that their data is intact and they can retry.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[app-error]", error.digest, error)
  }, [error])

  return (
    <div className="max-w-xl py-12">
      <div className="rounded-lg border border-border bg-surface p-8 shadow-sm">
        <span className="grid h-11 w-11 place-items-center rounded-full border border-border text-text-3">
          <AlertCircle size={22} />
        </span>

        <h1 className="mt-5 text-lead font-semibold text-text-1">This page didn&rsquo;t load</h1>
        <p className="mt-2 text-sm text-text-2">
          Your data is safe — nothing was changed. Try again, and if it keeps happening let the
          Ainslie OSE team know.
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
            href="/dashboard"
            className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium text-text-1 no-underline hover:bg-base"
          >
            Back to dashboard
          </Link>
        </div>

        {error.digest && (
          <p className="mt-6 font-mono text-xs text-text-3">Reference: {error.digest}</p>
        )}
      </div>
    </div>
  )
}
