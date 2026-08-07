import { notFound } from "next/navigation"

import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Select } from "@/components/ui/Select"
import { StateSurface } from "@/components/ui/StateSurface"
import { TextField } from "@/components/ui/TextField"
import { GALLERY_GROUPS, type GalleryEntry } from "@/components/ui/gallery-catalog"

/**
 * TTES-020-004 — the component gallery the visual-baseline matrix photographs.
 *
 * WHAT IT IS FOR
 *
 * Fourteen SurfaceStates, seven button variants at six sizes, seven badge tones
 * and five field shapes all exist in production, and every one of them is only
 * reached when a caller happens to be in that state. Nothing renders `conflict`
 * in dark mode at 320px, or a disabled `destructive` button under
 * `prefers-contrast: more`, so nothing has ever looked at them. This route
 * renders the whole catalogue at once so `e2e/visual-baselines.spec.ts` can walk
 * theme × density × direction × viewport over it.
 *
 * WHY IT CANNOT SHIP TO THE PILOT
 *
 * `TENURE_UI_GALLERY` is unset everywhere except a test run — the pilot's task
 * definition in `infrastructure/terraform/ecs.tf` does not set it — and the gate
 * fails CLOSED: any value other than the exact string "true" is a 404. It also
 * sits inside the `(app)` route group, so it is behind authentication before the
 * flag is even consulted. `dynamic = "force-dynamic"` matters here: without it
 * Next would evaluate the gate once at build time and bake the answer in, so a
 * build made with the flag on would serve the gallery forever afterwards.
 *
 * The `dir` search param applies to the catalogue container rather than to
 * `<html>`, because `<html dir>` is derived from the tenant's configured locale
 * (packages/platform-config/src/direction.ts) and seeding an RTL institution in
 * order to take a screenshot would be photographing the seed. Every logical
 * property — padding-inline, border-inline, text alignment — resolves against
 * the nearest `dir` ancestor, so the container is the same test for everything
 * inside it.
 *
 * Theme and density are NOT search params. They are read from localStorage by
 * the pre-hydration script in `src/app/layout.tsx`, so the spec sets the same
 * keys a person's browser holds and reloads. That way the matrix exercises the
 * real mechanism instead of a test-only one.
 */

export const dynamic = "force-dynamic"

export const metadata = { title: "Component gallery" }

function galleryEnabled(): boolean {
  return process.env.TENURE_UI_GALLERY === "true"
}

const SAMPLE_ROWS = (
  <ul className="m-0 list-none space-y-1 p-0 text-sm text-text-2">
    <li>Chess Club · Fall term · $1,240</li>
    <li>Robotics · Fall term · $3,980</li>
  </ul>
)

const TERM_OPTIONS = [
  { value: "fall-a", label: "Fall A" },
  { value: "fall-b", label: "Fall B" },
  { value: "spring-a", label: "Spring A" },
]

function Entry({ entry }: { entry: GalleryEntry }) {
  switch (entry.kind) {
    case "surface":
      return (
        <StateSurface state={entry.state}>{entry.withRows ? SAMPLE_ROWS : undefined}</StateSurface>
      )
    case "button":
      return (
        <Button variant={entry.variant} size={entry.size} isDisabled={entry.disabled}>
          {entry.size === "icon" || entry.size === "shellIcon" ? "•" : "Approve"}
        </Button>
      )
    case "badge":
      return <Badge variant={entry.variant}>{entry.variant}</Badge>
    case "field":
      if (entry.control === "select") {
        return <Select label={entry.label} options={TERM_OPTIONS} defaultSelectedKey="fall-a" />
      }
      return (
        <TextField
          label={entry.label}
          description={entry.description}
          errorMessage={entry.errorMessage}
          isInvalid={entry.errorMessage !== undefined}
          isDisabled={entry.disabled}
          multiline={entry.control === "textarea"}
          rows={3}
          defaultValue={entry.control === "textarea" ? "Renew the venue booking in week one." : "Chess Club"}
        />
      )
  }
}

export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ dir?: string }>
}) {
  if (!galleryEnabled()) notFound()

  const { dir } = await searchParams
  const direction = dir === "rtl" ? "rtl" : "ltr"

  return (
    <div data-gallery-root data-direction={direction} dir={direction} className="max-w-5xl">
      <h1 className="mb-1">Component gallery</h1>
      <p className="mb-6 text-sm text-text-2">
        Every entry is derived from the module that defines it — states.ts, Button&apos;s variant maps
        and Badge&apos;s tone map — so a new state or variant appears here without anyone editing this
        page.
      </p>

      {GALLERY_GROUPS.map((group) => (
        <section key={group.id} data-gallery-group={group.id} className="mb-8">
          <h2 className="mb-1">{group.title}</h2>
          <p className="mb-3 text-sm text-text-3">{group.rationale}</p>
          <div className="flex flex-wrap items-start gap-3">
            {group.entries.map((entry) => (
              <div
                key={entry.id}
                data-gallery-entry={entry.id}
                className="flex min-w-56 max-w-sm flex-1 flex-col gap-1.5 rounded-md border border-border bg-surface p-3"
              >
                <span className="micro-label">{entry.id}</span>
                <Entry entry={entry} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
