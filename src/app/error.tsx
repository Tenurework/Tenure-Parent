"use client"

import { useEffect } from "react"
import Link from "next/link"
import { AlertTriangle, RotateCw } from "@/components/ui/icons"

/**
 * Route-level error boundary. Without this, an exception in any server
 * component surfaces Next's bare "Application error: a server-side exception
 * has occurred" screen, which tells the user nothing and offers no way out.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[route-error]", error.digest, error)
  }, [error])

  return (
    <div className="max-w-screen-md py-12">
      <div className="rounded-lg border border-[--border] bg-[--bg-surface] p-8">
        <div className="flex items-start gap-4">
          <span className="rounded-full bg-[--warning-light] p-2 text-[--warning]">
            <AlertTriangle size={20} />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-[--text-1]">
              Something went wrong on our side
            </h1>
            <p className="mt-2 text-sm text-[--text-2]">
              This page failed to load. Your data is safe — nothing was changed.
              Try again, and if it keeps happening let the Ainslie OSE team know.
            </p>

            {error.digest && (
              <p className="mt-4 font-mono text-xs text-[--text-3]">
                Reference: {error.digest}
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded bg-[--primary] px-4 py-2 text-sm font-medium text-[--primary-text] hover:bg-[--primary-hover]"
              >
                <RotateCw size={15} />
                Try again
              </button>
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded border border-[--border] px-4 py-2 text-sm font-medium text-[--text-1] hover:bg-[--bg-base]"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
