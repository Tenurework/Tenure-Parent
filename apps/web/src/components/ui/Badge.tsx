import {
  type ApprovalStatus,
  type AssignmentStatus,
  type ConflictSeverity,
  type EventStatus,
} from "@prisma/client"

type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "draft"
  | "accent"

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-[--badge-draft-bg] text-[--badge-draft-text]",
  draft:   "bg-[--badge-draft-bg] text-[--badge-draft-text]",
  success: "bg-[--badge-approved-bg] text-[--badge-approved-text]",
  warning: "bg-[--badge-pending-bg] text-[--badge-pending-text]",
  error:   "bg-[--badge-rejected-bg] text-[--badge-rejected-text]",
  info:    "bg-[--primary-light] text-[--primary]",
  accent:  "bg-[--badge-accent-bg] text-[--badge-accent-text]",
}

export function Badge({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}) {
  return (
    <span
      className={`
        inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[12px] font-semibold leading-none
        ${variantStyles[variant]} ${className ?? ""}
      `}
    >
      {children}
    </span>
  )
}

// Convenience — maps ApprovalStatus to Badge variant
export function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  const map: Record<ApprovalStatus, { label: string; variant: BadgeVariant }> = {
    DRAFT:              { label: "Draft",              variant: "draft" },
    PENDING_PRESIDENT:  { label: "Pending President",  variant: "warning" },
    NEEDS_CHANGES:      { label: "Needs Changes",      variant: "warning" },
    PENDING_OSE:        { label: "Pending OSE",        variant: "info" },
    APPROVED:           { label: "Approved",           variant: "success" },
    REJECTED:           { label: "Rejected",           variant: "error" },
    CANCELLED:          { label: "Cancelled",          variant: "default" },
  }
  const { label, variant } = map[status]
  return <Badge variant={variant}>{label}</Badge>
}

export function AssignmentBadge({ status }: { status: AssignmentStatus }) {
  const map: Record<AssignmentStatus, { label: string; variant: BadgeVariant }> = {
    SHADOW: { label: "Shadow",  variant: "info" },
    ACTIVE: { label: "Active",  variant: "success" },
    ALUMNI: { label: "Alumni",  variant: "default" },
  }
  const { label, variant } = map[status]
  return <Badge variant={variant}>{label}</Badge>
}

export function EventBadge({ status }: { status: EventStatus }) {
  const map: Record<EventStatus, { label: string; variant: BadgeVariant }> = {
    DRAFT:            { label: "Draft",            variant: "draft" },
    PENDING_APPROVAL: { label: "Pending Approval", variant: "warning" },
    APPROVED:         { label: "Approved",         variant: "info" },
    PUBLISHED:        { label: "Published",        variant: "success" },
    CANCELLED:        { label: "Cancelled",        variant: "default" },
  }
  const { label, variant } = map[status]
  return <Badge variant={variant}>{label}</Badge>
}

export function SeverityBadge({ severity }: { severity: ConflictSeverity }) {
  const map: Record<ConflictSeverity, { label: string; variant: BadgeVariant }> = {
    HARD:          { label: "Hard conflict", variant: "error" },
    SOFT:          { label: "Soft conflict", variant: "warning" },
    INFORMATIONAL: { label: "FYI",           variant: "info" },
  }
  const { label, variant } = map[severity]
  return <Badge variant={variant}>{label}</Badge>
}
