import { type ReactNode } from "react"
import { type IconType } from "@/components/ui/icons"

/**
 * One empty state for the whole product. A muted icon, a plain statement of
 * what would appear here, and an optional action — so a blank panel always
 * reads as "nothing yet", never as "something broke".
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: IconType
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-12 text-center ${className ?? ""}`}>
      {/* Outline-only: a hairline ring rather than a filled plate, and a
          light-weight glyph, so the state reads quiet instead of stamped. */}
      <div className="grid h-14 w-14 place-items-center rounded-full border border-border text-text-3">
        <Icon size={26} weight="light" aria-hidden />
      </div>
      <p className="mt-4 text-lead font-semibold text-text-1">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-md text-sm text-text-2">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
