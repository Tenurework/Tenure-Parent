/**
 * Tenure brand marks — the six-petal rosette from tenure-landing
 * (src/app/icon.svg), reimplemented as flexible components.
 */

const PETAL = "M16 16 C 12.4 10.5, 12.4 5.4, 16 3.4 C 19.6 5.4, 19.6 10.5, 16 16 Z"

export function TenureLogo({
  size = 20,
  color = "var(--primary)",
  className,
}: {
  size?: number
  color?: string
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill={color}
      className={className}
      aria-hidden
    >
      {[0, 60, 120, 180, 240, 300].map((r) => (
        <path key={r} d={PETAL} transform={`rotate(${r} 16 16)`} />
      ))}
    </svg>
  )
}

export function TenureWordmark({
  size = 20,
  color = "var(--primary)",
  textClassName = "text-text-1",
}: {
  size?: number
  color?: string
  textClassName?: string
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <TenureLogo size={size} color={color} />
      <span
        className={`font-semibold tracking-tight ${textClassName}`}
        style={{ fontSize: size * 0.85 }}
      >
        Tenure
      </span>
    </span>
  )
}

/** The rosette with a spark — Tenure AI's mark. */
export function TenureAIMark({
  size = 18,
  color = "var(--primary)",
  className,
}: {
  size?: number
  color?: string
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
    >
      <g fill={color} opacity={0.92}>
        {[0, 60, 120, 180, 240, 300].map((r) => (
          <path key={r} d={PETAL} transform={`rotate(${r} 16 16) scale(0.86) translate(2.6 2.6)`} />
        ))}
      </g>
      {/* four-point spark */}
      <path
        d="M25.5 2.5 L26.9 6.1 L30.5 7.5 L26.9 8.9 L25.5 12.5 L24.1 8.9 L20.5 7.5 L24.1 6.1 Z"
        fill="var(--warning)"
      />
    </svg>
  )
}
