import { TenureWordmark } from "@/components/brand/TenureLogo"

/**
 * Hardened footer: a fixed slim bar pinned to the very bottom, spanning the
 * full width so its top border runs edge-to-edge and connects cleanly with the
 * side nav's right border into one continuous app frame. Deliberately quiet.
 *
 * The two marks are pinned to the frame's outer edges — the brand lockup flush
 * left (over the side-nav rail, so it reads as the product signature on the
 * whole frame rather than a caption on the content column) and the copyright
 * flush right. They balance each other at the extremes of the bar.
 */
export function Footer() {
  return (
    <footer className="fixed bottom-0 left-0 right-0 z-30 h-footer border-t border-border bg-surface">
      <div className="flex h-full items-center justify-between gap-3 px-4 sm:px-6">
        <TenureWordmark size={12} textClassName="text-text-3" />
        <p className="text-[11px] text-text-3">
          © {new Date().getFullYear()} Tenure. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
