import { type ReactNode } from "react"

interface CardProps {
  children: ReactNode
  className?: string
  padding?: "none" | "sm" | "md" | "lg"
}

const paddingMap = {
  none: "",
  sm: "p-3.5 sm:p-4",
  md: "p-4 sm:p-5",
  lg: "p-5 sm:p-6",
}

export function Card({ children, className, padding = "md" }: CardProps) {
  return (
    <div
      className={`
        bg-surface rounded-[10px] border border-border
        ${paddingMap[padding]}
        ${className ?? ""}
      `}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-tight text-text-1">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-text-3">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

// Object attribute — label / value pair
export function Attribute({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-meta text-text-3 uppercase tracking-wide">{label}</span>
      <span className="text-sm text-text-1">{value ?? "—"}</span>
    </div>
  )
}
