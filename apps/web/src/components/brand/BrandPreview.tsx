import { brandingFor } from "@tenure/platform-config"

import { THEME_SWATCHES, assessBrand, measuredRatios } from "@/lib/a11y/tenant-brand"

/**
 * TTES-010-004 — the preview half.
 *
 * An institution sets a colour in configuration and finds out what it looks like
 * when a student opens the app. Worse, it finds out what it MEASURES only if
 * someone thinks to check: the contrast gate that now runs on that colour drops
 * unsafe values silently, and a silent correction is indistinguishable from a
 * setting that did not save.
 *
 * So this shows both — the accent as it will actually be painted, in every theme
 * the product ships, with the measured ratio beside it and the reason for any
 * value that was refused.
 *
 * A server component, deliberately: `brandingFor` reads the resolved
 * configuration and `assessBrand` is the same call the shell layout makes, so
 * what is drawn here is what is shipped rather than a second implementation of
 * it. The theme colours come from `THEME_SWATCHES`, which `tenant-brand.test.ts`
 * reconciles against `globals.css` token by token — a preview that drifted from
 * the stylesheet would be worse than no preview, because it would be believed.
 */
export function BrandPreview({ institutionSlug }: { institutionSlug: string }) {
  const requested = brandingFor(institutionSlug)
  const { accepted, rejections } = assessBrand(requested)
  const ratios = measuredRatios(accepted)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {THEME_SWATCHES.map((swatch) => {
          const accent = swatch.brandApplies ? accepted.primaryColor : swatch.platformPrimary
          const measured = ratios.surfaces.find((s) => s.label === swatch.label)
          return (
            <div
              key={swatch.theme}
              className="rounded-lg border border-border p-3"
              style={{ background: swatch.surface, color: swatch.text }}
            >
              <p className="micro-label" style={{ color: swatch.text, opacity: 0.7 }}>
                {swatch.label}
              </p>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {/* The primary button: the accent carrying its own label. */}
                <span
                  className="inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium"
                  style={{ background: accent, color: accepted.primaryTextColor }}
                >
                  {accepted.wordmark}
                </span>

                {/* An active navigation row: the accent as a rule, not a fill. */}
                <span
                  className="inline-flex h-8 items-center rounded-md border-s-[3px] px-2.5 text-[13px]"
                  style={{ borderInlineStartColor: accent, color: swatch.text, opacity: 0.9 }}
                >
                  Navigation
                </span>

                {/* The focus ring. Drawn from --border-focus, which branding
                    cannot reach — that is the point of showing it here. */}
                <span
                  className="inline-flex h-8 items-center rounded-md px-2.5 text-[13px]"
                  style={{
                    outline: `2px solid ${swatch.focusRing}`,
                    outlineOffset: "2px",
                    color: swatch.text,
                  }}
                >
                  Focus
                </span>
              </div>

              <p className="mt-3 text-[12px]" style={{ color: swatch.text, opacity: 0.75 }}>
                {measured?.ratio}:1 against this surface, needs {measured?.floor}:1
                {swatch.brandApplies ? "" : " · platform accent, this theme is not branded"}
              </p>
            </div>
          )
        })}
      </div>

      <p className="text-[13px] text-text-2">
        The label reads {ratios.label}:1 on the accent — WCAG 2.2 AA asks 4.5:1 of text and 3:1 of a
        control&apos;s edge. The focus ring is drawn from <code>--border-focus</code> and is not part
        of what branding can set: it is the only thing telling a keyboard user where they are.
      </p>

      {rejections.length > 0 && (
        <ul className="space-y-1.5 rounded-lg border border-border bg-subtle p-3 text-[13px] text-text-2">
          {rejections.map((rejection) => (
            <li key={`${rejection.token}-${rejection.against}`}>
              <span className="font-medium text-text-1">{rejection.refused}</span> was not applied to{" "}
              <code>{rejection.token}</code>: {rejection.ratio}:1 against {rejection.against}, below
              the {rejection.floor}:1 floor. Showing {rejection.fallback} instead.
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
