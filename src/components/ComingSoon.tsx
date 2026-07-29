import type { IconType } from "@/components/ui/icons"
import { Card } from "@/components/ui/Card"

export function ComingSoon({
  icon: Icon,
  title,
  description,
  phase,
}: {
  icon: IconType
  title: string
  description: string
  phase: string
}) {
  return (
    <div className="max-w-2xl">
      <Card padding="lg" className="text-center py-14">
        {/* Outline-only: a hairline ring, never a tinted plate. */}
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-border">
          <Icon size={24} weight="regular" style={{ color: "var(--primary)" }} aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-text-1">{title}</h1>
        <p className="mt-2 text-sm text-text-2 max-w-md mx-auto">{description}</p>
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-text-3">
          {phase}
        </p>
      </Card>
    </div>
  )
}
