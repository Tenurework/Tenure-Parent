import Link from "next/link"

/**
 * Global 404 for URLs that never enter the app shell (unmatched routes, or a
 * notFound() outside the (app) group). Rendered inside the root layout only —
 * no shell — so it stands on its own as a centered, branded card.
 */
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-base px-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 text-center shadow-sm">
        <p className="font-display text-5xl font-bold leading-none text-text-1">404</p>
        <h1 className="mt-4 text-lead font-semibold text-text-1">We couldn&rsquo;t find that page</h1>
        <p className="mt-2 text-sm text-text-2">
          The link may be broken, or the page may have moved.
        </p>
        <div className="mt-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-md bg-[--primary] px-4 py-2 text-sm font-medium text-[--primary-text] no-underline hover:bg-[--primary-hover]"
          >
            Back to Tenure
          </Link>
        </div>
      </div>
    </main>
  )
}
