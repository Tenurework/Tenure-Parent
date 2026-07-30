/**
 * A deterministic monogram avatar. The same name always yields the same hue, so
 * a person or club is recognisable at a glance across the product without
 * needing an uploaded image. Used for people, clubs, and directory rows.
 */

const HUES = [210, 262, 288, 152, 24, 340, 190, 128]

function hueFor(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return HUES[h % HUES.length]
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-16 w-16 text-xl",
} as const

export function Avatar({
  name,
  imageUrl,
  size = "md",
  className,
}: {
  name: string
  imageUrl?: string | null
  size?: keyof typeof SIZES
  className?: string
}) {
  // Muted, low-saturation tints: distinguishable per person/club but never
  // colourful. Only entities without a profile picture fall back to this.
  const h = hueFor(name || "?")
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        className={`${SIZES[size]} shrink-0 rounded-full border border-border object-cover ${className ?? ""}`}
      />
    )
  }
  return (
    <span
      aria-hidden
      // Both theme pairs are emitted as custom properties and resolved by
      // `.avatar-monogram` in globals.css. A single light-mode hsl() here — a
      // 90%-lightness disc — rendered as a glaring near-white puck on the
      // #0f1113 dark card, on every roster in the product. This is the same fix
      // lib/calendar-color.ts already documents making for event chips.
      className={`avatar-monogram ${SIZES[size]} grid shrink-0 place-items-center rounded-full font-semibold ${className ?? ""}`}
      style={
        {
          "--avatar-bg": `hsl(${h} 20% 90%)`,
          "--avatar-text": `hsl(${h} 24% 34%)`,
          "--avatar-bg-dark": `hsl(${h} 26% 16%)`,
          "--avatar-text-dark": `hsl(${h} 40% 82%)`,
        } as React.CSSProperties
      }
    >
      {initials(name)}
    </span>
  )
}
