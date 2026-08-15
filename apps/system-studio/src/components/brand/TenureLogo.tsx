/**
 * The Tenure mark, for the deployment engine.
 *
 * ## Why this is a second copy, and what stops it drifting
 *
 * The tenant application has the same rosette at
 * `apps/web/src/components/brand/TenureLogo.tsx`. It cannot be imported from
 * here: `tests/architecture/shell-separation.test.mjs` asserts that no file
 * under one app's `src` imports another's, by relative path or by workspace
 * name, and it is right to — the two apps are deliberately separate origins
 * (PD-007) with separate builds, and a shared React component would put the
 * tenant app's render tree one import away from the operator console's.
 *
 * The honest alternatives were a `packages/brand` workspace or a duplicated
 * path with a guard. A package is the better long-term home and is where this
 * should end up; it is not what this change does, because a new workspace has
 * to reach `package-lock.json` or `npm ci` kills every CI job on its first
 * step, and that file is being edited by other work right now.
 *
 * So the geometry is duplicated and
 * `tests/architecture/brand-mark-is-one-mark.test.mjs` fails if the two paths
 * ever differ. That is the same shape this repository already uses for facts
 * two documents must agree on — one definition, and a test that makes
 * disagreement a failing build rather than a visual one somebody notices in a
 * screenshot months later.
 *
 * ## The colour
 *
 * `--md-sys-color-primary`, not the tenant app's `--primary`. The console has
 * its own Material 3 token layer and its own palette; the MARK is shared, the
 * PALETTE is not. Passing a literal here would also trip the design-token lint,
 * correctly.
 */

/** One petal, rotated six times. The single fact this file and its twin share. */
export const PETAL = "M16 16 C 12.4 10.5, 12.4 5.4, 16 3.4 C 19.6 5.4, 19.6 10.5, 16 16 Z"

export function TenureLogo({
  size = 20,
  color = "var(--md-sys-color-primary)",
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
      // Decorative: this is the mark alone, and wherever it appears the word
      // "Tenure" is beside it. A lone mark that needs a name should be given one
      // by its caller rather than by this component asserting one it cannot know
      // is correct — which is what `../md3/Logo.tsx` does, from `PETAL` above.
      aria-hidden
    >
      {[0, 60, 120, 180, 240, 300].map((r) => (
        <path key={r} d={PETAL} transform={`rotate(${r} 16 16)`} />
      ))}
    </svg>
  )
}

/*
 * ## There is no wordmark in this file, and that is the change
 *
 * A `TenureStudioWordmark` used to live here: the rosette beside the words
 * "Tenure Studio", at 0.82x the mark, inside `.brand-wordmark` and
 * `.brand-wordmark-text`. Three things were wrong with it and all three are the
 * same kind of wrong.
 *
 *   * No stylesheet in this console declares either of those class names, so it
 *     rendered as unstyled inline text with no gap, no weight and no tracking.
 *   * Nothing imported it. It had never been on a screen, which is why nobody
 *     had noticed the first point.
 *   * Its proportion was 0.82 where the brand's is 0.85, and its word was
 *     "Tenure Studio" where the brand's is "Tenure" — a second, quietly
 *     different wordmark sitting one directory away from the real one. Two
 *     wordmarks is how a console ends up with the almost-right one.
 *
 * The console's wordmark is `../md3/Logo.tsx`, which imports `PETAL` from here
 * and sets the word in the product's own type at the tenant app's proportion,
 * weight and tracking. This file is the geometry the two apps share, and only
 * that.
 */
