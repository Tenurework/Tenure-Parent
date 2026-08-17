import {
  DISCLOSURE_LABELS,
  DISCLOSURE_ORDER,
  disclosureSentence,
  isKnown,
  validateDestructivePreview,
  type Disclosure,
  type DestructivePreview,
} from "./destructive-preview"

/**
 * GE-143-025 — the nine disclosures, drawn the same way every time.
 *
 * Rendering rules, each of which is a decision rather than a style:
 *
 *   * Every disclosure appears, always, in the requirement's order. A disclosure
 *     that is missing from the screen is indistinguishable from one that is
 *     empty, and "there is no cost impact" is a different sentence from silence.
 *   * A disclosure that could not be computed prints its reason where its value
 *     would have been, marked `data-disclosure-state="unavailable"` and in the
 *     caution family — not blank, not zero, not an em-dash.
 *   * An invalid preview is not rendered at all. The panel prints what is wrong
 *     with it instead: a confirmation missing a disclosure is worse than no
 *     confirmation, because the reader believes they have been told everything.
 *
 * Type comes from `text-sm`, the 14px body step, rather than the arbitrary
 * pixel size the confirmation's other blocks use: an arbitrary type value is a counted debt
 * class in `tools/ttes-governance-dashboard.mjs`, whose budget may only shrink,
 * and a new file has no business spending it.
 *
 * Presentational only — a `<dl>` and text. It is placed inside `ConfirmDialog`'s
 * body, which owns the focus trap and the confirm gate.
 */
export function DestructivePreviewPanel({ preview }: { preview: DestructivePreview }) {
  const problems = validateDestructivePreview(preview)

  if (problems.length > 0) {
    return (
      <div
        className="rounded-md border border-border bg-base px-4 py-3 text-sm leading-relaxed text-text-2"
        data-destructive-preview="invalid"
        role="alert"
      >
        <p className="font-semibold text-text-1">
          This action’s preview is incomplete, so it is not being shown.
        </p>
        <ul className="mt-1.5 list-disc space-y-0.5 ps-4">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <dl
      className="grid gap-x-4 gap-y-2 rounded-md border border-border bg-base px-4 py-3 text-sm leading-relaxed sm:grid-cols-[minmax(0,11rem)_1fr]"
      data-destructive-preview="complete"
    >
      {DISCLOSURE_ORDER.map((key) => {
        // `as Disclosure<unknown>`: each key has its own payload type, so the
        // union of nine `Disclosure<T>`s cannot infer one T. Only known-ness is
        // read here; the sentence comes from `disclosureSentence`.
        const known = isKnown(preview[key] as Disclosure<unknown>)
        return (
          <div key={key} className="contents">
            <dt className="font-semibold text-text-2">{DISCLOSURE_LABELS[key]}</dt>
            <dd
              className={known ? "text-text-1" : "text-[--warning-text]"}
              data-disclosure={key}
              data-disclosure-state={known ? "known" : "unavailable"}
            >
              {disclosureSentence(preview, key)}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
