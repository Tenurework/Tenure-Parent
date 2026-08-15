import { test, expect, type Page, type Route } from "@playwright/test"

import { operatorFor } from "./operator-identity"
import {
  MAX_BACKOFF_MULTIPLIER,
  afterFailure,
  afterSuccess,
  afterUnchanged,
  attemptLine,
  backoffMultiplier,
  readCadence,
  seedState,
  seedValue,
  statedIntervalMs,
  statusWord,
  type CadenceStatement,
  type LiveState,
} from "../src/lib/aws/refresh"

/**
 * STUDIO-140-007 — the estate reads refresh, and the refresh is honest.
 *
 * The contract existed and the loop did not. Every capability carries a
 * `refreshMs` its author argued for; `api/aws/[surface]/route.ts` puts it on
 * every response as `x-aws-refresh-ms`; `grep -rn "x-aws-refresh-ms" src` found
 * it emitted and consumed NOWHERE, and the only `setInterval` in the whole
 * application was the sign-in retry countdown. So every AWS-backed page was a
 * server-rendered snapshot: correct at load, then frozen until a human reloaded,
 * with nothing on screen admitting it.
 *
 * This spec is in two halves and both are necessary.
 *
 *   * **Pure.** `src/lib/aws/refresh.ts` imports nothing, so the four rules are
 *     driven here directly with no browser and no server: the interval is the
 *     server's, the largest instruction wins, failures slow down, and a failed
 *     read never overwrites a good value.
 *   * **Driven.** The rules are worth nothing if the component does not obey
 *     them, so the rest signs in, serves `/api/aws/<surface>` from a script with
 *     chosen headers, and MEASURES the loop that results — how many requests,
 *     how far apart, what is on screen after a failure, and whether anything is
 *     requested at all while the tab is hidden.
 *
 * The scripted surface is the point of the second half. Against a real estate
 * the cadence is five minutes and a spec cannot wait for it; against a scripted
 * one the cadence is whatever the header says, which is exactly the property
 * under test — a client that honours the header polls at 700ms here and at five
 * minutes in production, and a client that picked its own number fails here
 * whatever number it picked.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

test.beforeAll(() => {
  expect(OPERATOR, "PLATFORM_OPERATORS must be set for this suite").not.toBe("")
  expect(SECRET, "PLATFORM_OPERATOR_SECRET must be set for this suite").not.toBe("")
})

/* ════════════════════════════════════════════════════════════════════════════
 * Half one: the rules, with no browser.
 * ════════════════════════════════════════════════════════════════════════════ */

/** A `Headers`-alike, so `readCadence` can be driven without a response. */
function headers(pairs: Record<string, string>) {
  const lower = new Map(Object.entries(pairs).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null }
}

const CADENCE = (over: Partial<CadenceStatement> = {}): CadenceStatement => ({
  refreshMs: null,
  pollAfterMs: null,
  retryAfterMs: null,
  state: null,
  asOf: null,
  throttleOrigin: null,
  ...over,
})

test.describe("the refresh rules", () => {
  test("the interval is read off the response, in the units each header uses", () => {
    const cadence = readCadence(
      headers({
        "x-aws-refresh-ms": "300000",
        "x-poll-after-ms": "300000",
        "retry-after": "2",
        "x-aws-read-state": "ACTUAL",
        "x-aws-as-of": "2026-08-14T10:00:00.000Z",
        "x-throttle-origin": "aws",
      }),
    )
    expect(cadence.refreshMs).toBe(300_000)
    expect(cadence.pollAfterMs).toBe(300_000)
    // Seconds on the wire, milliseconds in this engine. A client that compared
    // `retry-after: 2` against `x-aws-refresh-ms: 300000` in the same unit would
    // conclude the throttle was the SMALLER number and poll straight through it.
    expect(cadence.retryAfterMs).toBe(2000)
    expect(cadence.state).toBe("ACTUAL")
    expect(cadence.asOf).toBe("2026-08-14T10:00:00.000Z")
  })

  test("a response that states nothing yields no interval, and no interval means stop", () => {
    // THE rule. There is no fallback constant in the module — this is what makes
    // "obey the interval the server gives you" mechanical rather than aspirational.
    expect(statedIntervalMs(CADENCE())).toBeNull()

    const stopped = afterSuccess(
      seedState(null, null),
      { count: 3, atLeast: false, asOf: null, state: "ACTUAL" },
      CADENCE(),
      1_000,
    )
    expect(stopped.nextDelayMs).toBeNull()
    expect(statusWord(stopped)).toBe("snapshot")
    expect(attemptLine(stopped)).toContain("stated no refresh interval")
  })

  test("an interval not established yet is not an interval established as none", () => {
    /*
     * The two are one `null` in the state and they are opposite facts. Caught in
     * the real thing rather than reasoned about: on `/platform/estate` against an
     * unreachable AWS, the first `/api/aws/cdn` read takes several seconds, and
     * for all of them the region read
     *
     *   "This surface has stated no refresh interval, so nothing further is
     *    asked for"
     *
     * while the request was on the wire. A screen that says it has stopped
     * asking, while asking, is the same class of untruth as a screen that shows
     * old data as fresh.
     */
    const seeded = seedState({ count: 4, atLeast: false, asOf: null, state: "ACTUAL" }, null)
    expect(seeded.attemptAt, "an attempt was recorded before one was made").toBeNull()
    expect(statusWord(seeded)).toBe("waiting")
    expect(statusWord(seedState(null, "the server's own read was refused"))).toBe("waiting")

    // And once an attempt HAS completed and the surface stated nothing, it is a
    // snapshot — the arm above must not swallow this one.
    expect(statusWord(afterSuccess(seeded, seeded.value!, CADENCE(), 1_000))).toBe("snapshot")
  })

  test("the largest instruction on the response wins", () => {
    // A 429 carries all three and they disagree on purpose: "not for two
    // seconds" from the limiter, "nothing changes inside five minutes" from the
    // capability. Obeying the largest obeys both; taking the first found obeys
    // whichever is listed first.
    expect(
      statedIntervalMs(CADENCE({ retryAfterMs: 2_000, pollAfterMs: 2_000, refreshMs: 300_000 })),
    ).toBe(300_000)
    expect(statedIntervalMs(CADENCE({ retryAfterMs: 30_000, refreshMs: 2_000 }))).toBe(30_000)
  })

  test("failures slow down, from the second one, to a bounded ceiling", () => {
    // One on the first failure: the server's own `Retry-After` IS the backoff,
    // and multiplying it would ignore the number it just gave.
    expect(backoffMultiplier(1)).toBe(1)
    expect(backoffMultiplier(2)).toBe(2)
    expect(backoffMultiplier(3)).toBe(4)
    expect(backoffMultiplier(9)).toBe(MAX_BACKOFF_MULTIPLIER)

    let state: LiveState = seedState(null, null)
    state = afterFailure(state, "first", CADENCE({ refreshMs: 1_000 }), 1_000)
    expect(state.nextDelayMs).toBe(1_000)
    state = afterFailure(state, "second", CADENCE({ refreshMs: 1_000 }), 2_000)
    expect(state.nextDelayMs).toBe(2_000)
    state = afterFailure(state, "third", CADENCE({ refreshMs: 1_000 }), 3_000)
    expect(state.nextDelayMs).toBe(4_000)
  })

  test("a failed read never overwrites a good value", () => {
    const good = afterSuccess(
      seedState(null, null),
      { count: 9, atLeast: false, asOf: "2026-08-14T10:00:00.000Z", state: "ACTUAL" },
      CADENCE({ refreshMs: 1_000 }),
      1_000,
    )
    const failed = afterFailure(good, "HTTP 403 — Refused", CADENCE({ refreshMs: 1_000 }), 2_000)

    // The rule the whole codebase is built around, at the client end of it.
    expect(failed.value).toEqual(good.value)
    expect(failed.valueAt).toBe(good.valueAt)
    expect(failed.attemptOk).toBe(false)
    expect(statusWord(failed)).toBe("stale")

    const line = attemptLine(failed)
    expect(line).toContain("FAILED")
    expect(line).toContain("HTTP 403 — Refused")
    // Not just kept: SAID to be kept, with the instant it was true.
    expect(line).toContain("2026-08-14T10:00:00.000Z")
    expect(line).toContain("has not been overwritten")
  })

  test("a 304 is a success that does not restamp the value", () => {
    const good = afterSuccess(
      seedState(null, null),
      { count: 4, atLeast: false, asOf: "2026-08-14T10:00:00.000Z", state: "ACTUAL" },
      CADENCE({ refreshMs: 1_000 }),
      1_000,
    )
    const unchanged = afterUnchanged(good, CADENCE({ refreshMs: 1_000 }), 5_000)
    expect(unchanged.value).toEqual(good.value)
    // The saving is bandwidth, not freshness. Stamping `valueAt` on a 304 would
    // report data as newer than the server said it was.
    expect(unchanged.valueAt).toBe(1_000)
    expect(unchanged.attemptAt).toBe(5_000)
    expect(unchanged.attemptOk).toBe(true)
  })

  test("a refused read seeds no number, and an empty one seeds a real zero", () => {
    expect(
      seedValue({ state: "DENIED", asOf: undefined, value: undefined }),
      "a denial seeded a count",
    ).toBeNull()
    expect(seedValue({ state: "THROTTLED", asOf: "2026-08-14T10:00:00.000Z" })).toBeNull()
    expect(seedValue({ state: "EMPTY", asOf: "2026-08-14T10:00:00.000Z" })).toEqual({
      count: 0,
      atLeast: false,
      asOf: "2026-08-14T10:00:00.000Z",
      state: "EMPTY",
    })
    expect(
      seedValue({ state: "ACTUAL", asOf: "2026-08-14T10:00:00.000Z", value: [1, 2, 3] }),
    ).toEqual({
      count: 3,
      atLeast: false,
      asOf: "2026-08-14T10:00:00.000Z",
      state: "ACTUAL",
    })
  })
})

/* ════════════════════════════════════════════════════════════════════════════
 * Half two: the loop, in a browser, measured.
 * ════════════════════════════════════════════════════════════════════════════ */

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  /*
   * Twenty seconds, not the default five.
   *
   * The page sign-in lands on scans the tenant registry before it renders a
   * heading, and on a machine running several of these consoles at once that is
   * comfortably more than five seconds — twice, this barrier timed out while the
   * thing under test had not started yet. The timeout is a property of the
   * harness, not a claim about the loop: every assertion that measures the loop
   * below runs at the default.
   */
  await expect(page.getByRole("heading", { name: "Organization systems" })).toBeVisible({
    timeout: 20_000,
  })
}

interface Scripted {
  /** Status to answer with. */
  status?: number
  /** Rows in the envelope. Omitted entirely on a non-2xx — a failure carries no rows. */
  rows?: number
  /** Headers to add. A header simply left out is how "states nothing" is scripted. */
  headers?: Record<string, string>
}

/** When each request for the scripted surface arrived, in this process's clock. */
interface Recorder {
  at: number[]
}

/**
 * Serve `/api/aws/<surface>` from a script.
 *
 * Every response is authored here — status, rows and headers — so the cadence
 * under test is a number this spec chose and the client never saw before. A
 * client that reads `x-aws-refresh-ms` polls at it; a client with an interval of
 * its own polls at its own, and no choice of constant passes both the 700ms case
 * and the "states nothing" case below.
 */
async function serve(
  page: Page,
  surface: string,
  script: (nth: number) => Scripted,
): Promise<Recorder> {
  const recorder: Recorder = { at: [] }
  await page.route(`**/api/aws/${surface}**`, async (route: Route) => {
    const nth = recorder.at.length
    recorder.at.push(Date.now())
    const plan = script(nth)
    const status = plan.status ?? 200
    const body =
      status >= 200 && status < 300
        ? JSON.stringify({
            items: Array.from({ length: plan.rows ?? 0 }, (_, i) => ({ id: `row-${i}` })),
            nextCursor: null,
            asOf: new Date().toISOString(),
            correlationId: "spec",
          })
        : JSON.stringify({
            type: "https://tenure.example/problems/internal",
            title: "The read failed",
            status,
            detail: "scripted failure",
          })
    await route.fulfill({
      status,
      contentType: status >= 200 && status < 300 ? "application/json" : "application/problem+json",
      headers: { "cache-control": "no-store", ...(plan.headers ?? {}) },
      body,
    })
  })
  return recorder
}

/** Gaps between consecutive requests, in milliseconds. */
const gaps = (at: number[]): number[] => at.slice(1).map((t, i) => t - at[i])

/** Make the tab hidden — or visible — the way the browser reports it to the page. */
async function setVisibility(page: Page, value: "hidden" | "visible") {
  await page.evaluate((state) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state })
    document.dispatchEvent(new Event("visibilitychange"))
  }, value)
}

test.describe("the estate reads refresh", () => {
  test("polls at the interval the surface states, and only at that interval", async ({ page }) => {
    // 700ms — a number this spec invents and the client cannot know. In
    // production this header says 300000 for the same surface.
    const asOf = new Date().toISOString()
    const recorder = await serve(page, "cdn", () => ({
      rows: 3,
      headers: {
        "x-aws-refresh-ms": "700",
        "x-poll-after-ms": "700",
        "x-aws-read-state": "ACTUAL",
        "x-aws-as-of": asOf,
      },
    }))

    await signIn(page)
    await page.goto("/platform/estate")

    const value = page.getByTestId("live-value-cdn")
    // Visible FIRST, then measured. `boundingBox()`/`textContent()` sample once
    // and do not retry the way `expect` does.
    await expect(value).toBeVisible()
    // The loop has replaced the server's own read — which, with no credentials,
    // seeded nothing at all — with a polled one.
    await expect(value).toHaveText("3 edge distributions")
    await expect(page.getByTestId("live-cadence-cdn")).toContainText(
      "every 700ms — the interval the surface stated",
    )

    const before = recorder.at.length
    await page.waitForTimeout(3_000)
    const made = recorder.at.length - before

    /*
     * 3000ms at 700ms is four intervals, and the boundaries make it three to
     * five. The band is what the assertion is FOR:
     *
     *   * a client polling on a constant of its own — 5s, 10s, 30s, whatever —
     *     makes zero or one and fails the floor;
     *   * a client polling as fast as it can makes hundreds and fails the ceiling.
     *
     * There is no interval a client could have picked that lands inside this
     * band here AND inside the "states nothing" band in the next test.
     */
    expect(made, `${made} requests in 3s at a stated 700ms`).toBeGreaterThanOrEqual(3)
    expect(made, `${made} requests in 3s at a stated 700ms`).toBeLessThanOrEqual(6)

    // And never FASTER than instructed, request by request. An average inside
    // the band can still hide a burst.
    for (const gap of gaps(recorder.at.slice(before === 0 ? 0 : before - 1))) {
      expect(gap, `a gap of ${gap}ms against a stated 700ms`).toBeGreaterThanOrEqual(600)
      expect(gap, `a gap of ${gap}ms against a stated 700ms`).toBeLessThanOrEqual(1_600)
    }
  })

  test("a surface that states no interval is polled once and says so", async ({ page }) => {
    const recorder = await serve(page, "cdn", () => ({
      rows: 2,
      // No `x-aws-refresh-ms`, no `x-poll-after-ms`, no `retry-after`. The
      // response states nothing about when to ask again.
      headers: { "x-aws-read-state": "ACTUAL" },
    }))

    await signIn(page)
    await page.goto("/platform/estate")

    await expect(page.getByTestId("live-value-cdn")).toHaveText("2 edge distributions")
    await expect(page.getByTestId("live-cdn")).toHaveAttribute("data-status", "snapshot")
    await expect(page.getByTestId("live-cadence-cdn")).toContainText(
      "stated no refresh interval",
    )

    await page.waitForTimeout(3_000)
    // Exactly one: the mount read that obtains the cadence. Anything more is a
    // number the client supplied, which is the whole defect this build exists to
    // remove.
    expect(recorder.at.length, "requests made against a surface that stated no cadence").toBe(1)
  })

  test("while the first read is on the wire, the region says so", async ({ page }) => {
    /*
     * Found in the running console, not reasoned about: on `/platform/estate`
     * against an unreachable AWS the first `/api/aws/cdn` read takes seconds,
     * and the region spent all of them claiming the surface had stated no
     * interval and that nothing further would be asked for — while the request
     * was on the wire. Here the response is held open on purpose.
     */
    await page.route("**/api/aws/cdn**", async (route: Route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500))
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-aws-refresh-ms": "800", "x-aws-read-state": "ACTUAL" },
        body: JSON.stringify({ items: [{ id: "a" }], nextCursor: null, asOf: new Date().toISOString() }),
      })
    })

    await signIn(page)
    await page.goto("/platform/estate")

    const region = page.getByTestId("live-cdn")
    await expect(region).toBeVisible()
    await expect(region).toHaveAttribute("data-status", "waiting")
    await expect(page.getByTestId("live-cadence-cdn")).toContainText("is in flight")
    // "Not established yet" must not be rendered as "established as none".
    await expect(page.getByTestId("live-cadence-cdn")).not.toContainText(
      "stated no refresh interval",
    )

    // And when it lands, the interval is the one it stated.
    await expect(page.getByTestId("live-value-cdn")).toHaveText("1 edge distribution")
    await expect(region).toHaveAttribute("data-status", "live")
    await expect(page.getByTestId("live-cadence-cdn")).toContainText("every 800ms")
  })

  test("a failed refresh keeps the last good value on screen, marked stale", async ({ page }) => {
    const asOf = "2026-08-14T09:00:00.000Z"
    const recorder = await serve(page, "cdn", (nth): Scripted =>
      nth === 0
        ? {
            rows: 7,
            headers: {
              "x-aws-refresh-ms": "500",
              "x-poll-after-ms": "500",
              "x-aws-read-state": "ACTUAL",
              "x-aws-as-of": asOf,
            },
          }
        : {
            status: 502,
            // A live surface never returns rows and a failure in the same
            // response — `api-contract.spec.ts` asserts the server half. The
            // failure still carries the cadence, because a client that was told
            // nothing would not know when to try again.
            headers: { "x-aws-refresh-ms": "500", "x-poll-after-ms": "500" },
          },
    )

    await signIn(page)
    await page.goto("/platform/estate")

    const value = page.getByTestId("live-value-cdn")
    await expect(value).toBeVisible()
    await expect(value).toHaveText("7 edge distributions")

    // Now every refresh fails.
    await expect(page.getByTestId("live-cdn")).toHaveAttribute("data-status", "stale")
    expect(recorder.at.length, "the failures were not attempted").toBeGreaterThan(1)

    // The number is STILL THERE. Not blanked, not zeroed, not "—".
    await expect(value).toHaveText("7 edge distributions")

    const attempt = page.getByTestId("live-attempt-cdn")
    await expect(attempt).toContainText("Last refresh FAILED")
    await expect(attempt).toContainText("HTTP 502")
    // With the instant it was true, and the claim that it was not overwritten.
    await expect(attempt).toContainText(asOf)
    await expect(attempt).toContainText("has not been overwritten")

    // Still there after several more failed attempts, and still not a zero.
    await page.waitForTimeout(1_500)
    await expect(value).toHaveText("7 edge distributions")
    await expect(value).not.toHaveText("0 edge distributions")
  })

  test("a throttle is obeyed, not retried harder", async ({ page }) => {
    const recorder = await serve(page, "cdn", (nth): Scripted =>
      nth === 0
        ? {
            rows: 1,
            headers: {
              "x-aws-refresh-ms": "300",
              "x-poll-after-ms": "300",
              "x-aws-read-state": "ACTUAL",
              "x-aws-as-of": new Date().toISOString(),
            },
          }
        : {
            status: 429,
            headers: {
              // What the route sends on a 429: the limiter's own backoff, in
              // both units, plus the cadence.
              "retry-after": "2",
              "x-poll-after-ms": "2000",
              "x-aws-refresh-ms": "300",
              "x-throttle-origin": "control-plane",
            },
          },
    )

    await signIn(page)
    await page.goto("/platform/estate")

    await expect(page.getByTestId("live-value-cdn")).toHaveText("1 edge distribution")
    await expect(page.getByTestId("live-cdn")).toHaveAttribute("data-status", "stale")

    const throttledAt = recorder.at.length
    await page.waitForTimeout(3_000)
    const after = recorder.at.length - throttledAt

    /*
     * Three seconds after a `Retry-After: 2`, with the cadence still saying
     * 300ms. A client that took the SMALLEST number would make ten requests
     * against a limiter that just refused it; a client that obeyed the largest
     * makes one, or two once the failure backoff has doubled it.
     */
    expect(after, `${after} requests in 3s after a Retry-After: 2`).toBeLessThanOrEqual(2)
    for (const gap of gaps(recorder.at.slice(throttledAt - 1))) {
      expect(gap, `a gap of ${gap}ms after a Retry-After: 2`).toBeGreaterThanOrEqual(1_800)
    }
  })

  test("nothing is polled while the tab is hidden, and it resumes on focus", async ({ page }) => {
    const recorder = await serve(page, "logs", () => ({
      rows: 5,
      headers: {
        "x-aws-refresh-ms": "400",
        "x-poll-after-ms": "400",
        "x-aws-read-state": "ACTUAL",
        "x-aws-as-of": new Date().toISOString(),
      },
    }))

    await signIn(page)
    await page.goto("/platform/health")

    const value = page.getByTestId("live-value-logs")
    await expect(value).toBeVisible()
    await expect(value).toHaveText("5 log groups")

    // Let it run, so "no requests" below is a change and not a page that never
    // started.
    await page.waitForTimeout(1_200)
    const running = recorder.at.length
    expect(running, "the loop never started").toBeGreaterThanOrEqual(2)

    await setVisibility(page, "hidden")
    const atHide = recorder.at.length
    await page.waitForTimeout(2_500)
    const whileHidden = recorder.at.length - atHide

    /*
     * A console left open overnight must not spend an operator's rate budget on
     * a screen nobody is looking at. 2500ms at a stated 400ms is six requests if
     * the loop keeps running; one is allowed for a request that was already in
     * flight when the tab went away.
     */
    expect(whileHidden, `${whileHidden} requests made while the tab was hidden`).toBeLessThanOrEqual(1)
    await expect(page.getByTestId("live-cdn")).toHaveCount(0) // health, not estate

    await setVisibility(page, "visible")
    // Resumes — and the assertion retries, so this is not a race with the paint.
    await expect
      .poll(() => recorder.at.length, { timeout: 5_000 })
      .toBeGreaterThan(atHide + 2)
  })

  test("both wired surfaces report their own cadence, not a shared one", async ({ page }) => {
    /*
     * The pattern is proven on two pages, and the two must not have collapsed
     * into one number on the way. `logs` states 400ms here and `cdn` states
     * 900ms; a client with one shared timer would report the same figure on both
     * screens.
     */
    await serve(page, "logs", () => ({
      rows: 5,
      headers: { "x-aws-refresh-ms": "400", "x-aws-read-state": "ACTUAL" },
    }))
    await serve(page, "cdn", () => ({
      rows: 6,
      headers: { "x-aws-refresh-ms": "900", "x-aws-read-state": "ACTUAL" },
    }))

    await signIn(page)

    await page.goto("/platform/health")
    await expect(page.getByTestId("live-value-logs")).toHaveText("5 log groups")
    await expect(page.getByTestId("live-cadence-logs")).toContainText("every 400ms")

    await page.goto("/platform/estate")
    await expect(page.getByTestId("live-value-cdn")).toHaveText("6 edge distributions")
    await expect(page.getByTestId("live-cadence-cdn")).toContainText("every 900ms")
  })
})
