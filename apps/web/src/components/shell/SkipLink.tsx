/**
 * GE-022-003 — WCAG 2.4.1, Bypass Blocks.
 *
 * The shell puts a header and a side nav in front of every page. For a keyboard
 * or screen-reader user that is thirty-odd stops between arriving on a page and
 * reaching what they came for, repeated on every navigation. This is the way
 * out: the first thing Tab reaches on any page, and it goes straight to `main`.
 *
 * Visually hidden until focused rather than `display: none` — a hidden element
 * is not focusable, so a skip link that hides that way is a skip link nobody can
 * use, which is the most common way this criterion is failed while looking met.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="
        sr-only
        focus:not-sr-only
        focus:fixed focus:left-3 focus:top-3 focus:z-[100]
        focus:rounded-md focus:border focus:border-border-control
        focus:bg-surface focus:px-4 focus:py-2
        focus:text-sm focus:font-semibold focus:text-text-1
        focus:[box-shadow:var(--shadow-focus)]
      "
    >
      Skip to main content
    </a>
  )
}
