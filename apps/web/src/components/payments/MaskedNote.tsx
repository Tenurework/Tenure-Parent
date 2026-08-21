import type { MaskedDisplay } from "@/lib/payments/masked-display"

/**
 * PAY-200-003 — free text with its financial identifiers masked, and a line
 * saying so.
 *
 * The masking decision is made on the server by `maskForDisplay`; this renders
 * it. It is a separate component for one reason: the notice must not be
 * optional at the call site. A helper returning a string would let a surface
 * render `display.text` and drop `display.notice`, and a masked note with no
 * notice reads as the complete note — the reader has no way to tell that the
 * sentence they are looking at is missing sixteen digits.
 *
 * Type-only import of `MaskedDisplay`, deliberately: the module it comes from
 * reaches `@/lib/rbac`, which is server code. The type is erased, so this file
 * stays renderable anywhere.
 */
export function MaskedNote({
  display,
  className,
  italic = false,
  quoted = false,
}: {
  display: MaskedDisplay
  className?: string
  italic?: boolean
  quoted?: boolean
}) {
  if (!display.text) return null
  const body = quoted ? `“${display.text}”` : display.text
  return (
    <>
      <p
        className={[
          className ?? "text-sm text-text-1 whitespace-pre-wrap",
          italic ? "italic" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid="masked-note"
      >
        {body}
      </p>
      {display.notice && (
        <p className="mt-1 text-xs text-text-3" data-testid="masked-note-notice">
          {display.notice}
        </p>
      )}
    </>
  )
}
