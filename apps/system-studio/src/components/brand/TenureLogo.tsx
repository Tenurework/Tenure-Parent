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
      // Decorative wherever it appears beside the word "Tenure"; the wordmark
      // below carries the accessible name. A lone mark that needs a name should
      // be given one by its caller rather than by this component asserting one
      // it cannot know is correct.
      aria-hidden
    >
      {[0, 60, 120, 180, 240, 300].map((r) => (
        <path key={r} d={PETAL} transform={`rotate(${r} 16 16)`} />
      ))}
    </svg>
  )
}

/**
 * The mark and the word, for the console masthead.
 *
 * `Tenure Studio` rather than `Tenure`: this is the deployment engine, and an
 * operator with both open should never have to look twice to see which one they
 * are about to advance a tenant in.
 */
export function TenureStudioWordmark({
  size = 22,
  color = "var(--md-sys-color-primary)",
}: {
  size?: number
  color?: string
}) {
  return (
    <span className="brand-wordmark">
      <TenureLogo size={size} color={color} />
      <span className="brand-wordmark-text" style={{ fontSize: size * 0.82 }}>
        Tenure <span className="brand-wordmark-qualifier">Studio</span>
      </span>
    </span>
  )
}
