import { Mail } from "@/components/ui/icons"

/**
 * A contact address that is actually contactable — one click opens a compose
 * window. Board members chase each other by email constantly, so every address
 * Tenure displays should be actionable rather than something to retype.
 */
export function EmailLink({
  email,
  subject,
  className = "",
  showIcon = false,
}: {
  email: string
  subject?: string
  className?: string
  showIcon?: boolean
}) {
  const href = subject
    ? `mailto:${email}?subject=${encodeURIComponent(subject)}`
    : `mailto:${email}`

  return (
    <a
      href={href}
      className={`inline-flex items-center gap-1 text-[--text-link] hover:underline break-all ${className}`}
    >
      {showIcon && <Mail size={12} className="shrink-0" aria-hidden />}
      {email}
    </a>
  )
}
