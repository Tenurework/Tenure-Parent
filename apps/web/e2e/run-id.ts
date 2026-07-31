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
