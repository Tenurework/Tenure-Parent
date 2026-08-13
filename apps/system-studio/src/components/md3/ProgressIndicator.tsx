/**
 * Two indicators, because "in progress" and "1 of 9 done" are different facts.
 *
 * ## Determinate is a real `<progress>` element
 *
 * Not a `<div>` with a width. The width of a `<div>` can only be set with an
 * inline style, and a component in this directory may not carry one — that rule
 * is what keeps every colour in `globals.css` where the contrast audit can see
 * it, and a `style={{ width }}` is the hole through which the first one arrives.
 * `<progress value max>` puts the number in the markup where it belongs, brings
 * its own `progressbar` role, its own `aria-valuenow`, and a text fallback for
 * anything that cannot draw it.
 *
 * ## Indeterminate is deliberately NOT a `<progress>`
 *
 * A valueless `<progress>` is drawn by the user agent, and once `appearance:
 * none` is applied to make it match this console the animation the user agent
 * was providing goes with it. So indeterminate is an element with an explicit
 * `role="progressbar"` and NO `aria-valuenow`, which is precisely how ARIA says
 * "busy, amount unknown", plus a CSS-animated bar.
 *
 * ## Reduced motion does not leave it frozen at zero
 *
 * `globals.css` zeroes every animation under `prefers-reduced-motion` and under
 * this console's own reduced-motion preference — with `!important`, deliberately.
 * An indeterminate bar under that rule stops at its first keyframe, which is an
 * empty track: a "nothing is happening" that is drawn identically to a broken
 * one. The stylesheet therefore gives the reduced-motion indeterminate bar a
 * full, static track, and the required `label` says what is running. Motion is
 * never the only carrier of the fact.
 *
 * ## `label` is required on both
 *
 * A bare bar is a rectangle. An operator watching a provisioning run needs to
 * know which of eleven steps this one is, and a screen reader needs a name for
 * the progressbar; `label` is both, rendered visibly and referenced by the
 * element.
 */

export interface DeterminateProgressProps {
  /**
   * Names what is progressing. Rendered visibly and used as the accessible name.
   */
  label: string
  /** How much is done. Clamped into `[0, max]` — see the note in the body. */
  value: number
  /** The total. Defaults to 100, so a plain percentage needs one number. */
  max?: number
  /**
   * The figure beside the bar — "4 of 11 cells", "62%".
   *
   * Optional because it is sometimes the label itself; when absent the bar
   * carries the number only in `aria-valuenow`, which a sighted reader cannot
   * hear. Supply it whenever the number matters, which is nearly always.
   */
  valueText?: string
  id?: string
}

export function ProgressIndicator({
  label,
  value,
  max = 100,
  valueText,
  id,
}: DeterminateProgressProps) {
  /*
   * Clamped, and the clamp is not defensive noise. `value` here is usually a
   * ratio computed from two AWS readings — completed cells over expected cells —
   * and an estate can legitimately report more of something than the manifest
   * expected. A `<progress>` given a value above `max` renders as INDETERMINATE
   * in Chrome, so the bar for "12 of 11 done" would start sliding as though
   * nothing were known, which is the opposite of what happened.
   */
  const safeMax = max > 0 ? max : 1
  const safeValue = Math.min(Math.max(value, 0), safeMax)

  return (
    <div className="md3-progress-field" id={id}>
      <p className="md3-progress-label md3-label-medium">
        <span>{label}</span>
        {valueText ? <span className="md3-progress-value">{valueText}</span> : null}
      </p>
      <progress
        className="md3-progress"
        value={safeValue}
        max={safeMax}
        aria-label={label}
        // The text a screen reader reads instead of "62 percent" when the raw
        // ratio is not the point — "4 of 11 cells".
        {...(valueText ? { "aria-valuetext": valueText } : {})}
      >
        {valueText ?? `${safeValue} of ${safeMax}`}
      </progress>
    </div>
  )
}

export interface IndeterminateProgressProps {
  /** What is running. Rendered visibly, and the progressbar's accessible name. */
  label: string
  id?: string
}

export function IndeterminateProgress({ label, id }: IndeterminateProgressProps) {
  return (
    <div className="md3-progress-field" id={id}>
      <p className="md3-progress-label md3-label-medium">
        <span>{label}</span>
      </p>
      {/*
        No `aria-valuenow`, which is what makes this indeterminate to assistive
        technology rather than a progressbar stuck at zero. `aria-busy` says the
        same thing to anything reading the region rather than the widget.
      */}
      <div className="md3-progress-indeterminate" role="progressbar" aria-label={label} aria-busy="true" />
    </div>
  )
}
