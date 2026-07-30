import { type IconType } from "@/components/ui/icons"

/**
 * The one way to give an icon a visual anchor.
 *
 * System rule (see ICONOGRAPHY in globals.css): an icon's colour belongs to its
 * outline. Icons are never set on a tinted plate and never use Phosphor's
 * `duotone` / `fill` weights. When a glyph needs presence — an empty state, a
 * console banner, a resource card — it gets a hairline ring on the page surface
 * and the accent lands on the stroke.
 *
 *   <IconFrame icon={ShieldCheck} size="lg" tone="var(--accent-strong)" />
 *
 * Not for buttons, count badges or status chips — those are filled controls and
 * the fill is the signal.
 */

const BOX = {
  sm: { frame: "h-8 w-8 rounded-md", glyph: 16 },
  md: { frame: "h-10 w-10 rounded-lg", glyph: 20 },
  lg: { frame: "h-11 w-11 rounded-lg", glyph: 22 },
  xl: { frame: "h-14 w-14 rounded-full", glyph: 26 },
} as const

export function IconFrame({
  icon: Icon,
  size = "md",
  tone,
  weight = "regular",
  className,
}: {
  icon: IconType
  size?: keyof typeof BOX
  /** Stroke colour. Defaults to the frame's muted --text-3. */
  tone?: string
  /** Phosphor weight. `duotone`/`fill` are intentionally not offered. */
  weight?: "thin" | "light" | "regular" | "bold"
  className?: string
}) {
  const { frame, glyph } = BOX[size]
  return (
    <span className={`icon-frame ${frame} ${className ?? ""}`}>
      <Icon size={glyph} weight={weight} style={tone ? { color: tone } : undefined} aria-hidden />
    </span>
  )
}
