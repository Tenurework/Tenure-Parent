import Link from "next/link"
import { Search } from "@/components/ui/icons"

/**
 * Branded 404 for anything inside the app shell — a notFound() from a page or
 * a mistyped in-app URL. Rendered within (app)/layout.tsx, so the header,
 * side-nav and footer survive and the user is one click from home.
 */
export default function AppNotFound() {
  return (
    <div className="max-w-xl py-12">
      <div className="rounded-lg border border-border bg-surface p-8 shadow-sm">
        <span className="grid h-11 w-11 place-items-center rounded-full border border-border text-text-3">
          <Search size={22} />
        </span>

        <h1 className="mt-5 text-lead font-semibold text-text-1">We couldn&rsquo;t find that page</h1>
        <p className="mt-2 text-sm text-text-2">
          The link may be broken, or the page may have moved. Let&rsquo;s get you back on track.
        </p>

        <div className="mt-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-md bg-[--primary] px-4 py-2 text-sm font-medium text-white no-underline hover:bg-[--primary-hover]"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
