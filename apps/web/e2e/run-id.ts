/**
 * One identifier per suite run, stable across retries.
 *
 * Specs name the records they create after a timestamp so that repeated runs
 * against the same database do not collide. Several of those names are declared
 * once at module or describe level and shared: one test publishes the record,
 * a later test retires it, acts on it, or asserts someone else cannot.
 *
 * `Date.now()` cannot do that job, because a retry re-imports the spec file and
 * evaluates it again. Playwright retries the failing test alone, so the producer
 * does not re-run — the consumer wakes up looking for a record named after a
 * moment that never created anything, and waits out its timeout. The retry is
 * unable to pass by construction, which turns an ordinary flake into a
 * permanent red, and CI gates Deploy behind that.
 *
 * The value is seeded in playwright.config.ts, which the main process loads
 * before it forks any worker, so every worker and every retry inherits the same
 * string through the environment. The fallback covers a spec imported outside
 * the Playwright runner, where nothing has seeded it.
 */
export const RUN_ID = process.env.E2E_RUN_ID ?? String(Date.now())

/**
 * A stable non-negative integer for the same run.
 *
 * The calendar suite parks each run on its own far-future week, so that events
 * left behind by an earlier run cannot trip conflict detection in this one. It
 * needs a number to do that arithmetic, and RUN_ID is a string — deliberately,
 * since an outer runner may pin it to something descriptive rather than a
 * timestamp. `Number(RUN_ID)` would then be NaN and every date would silently
 * become Invalid Date, so hash the string instead of parsing it.
 */
export const RUN_SEED = [...RUN_ID].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)
