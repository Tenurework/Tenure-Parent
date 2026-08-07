import { test, expect, type Page } from "@playwright/test"
import { loadBudgets, measureJourney, parseScorecard } from "./journey-metrics"

/**
 * The measurement harness, measured.
 *
 * `journeys.spec.ts` uses this harness against the real product, and a harness
 * that quietly counts zero would leave every one of those journeys green while
 * measuring nothing — which is the exact shape of the failure the scorecard
 * exists to prevent. So the counters are checked against a page whose clicks,
 * keystrokes and route changes are known by construction.
 *
 * The fixture is a real three-page site served by request interception rather
 * than a stub of a browser: real documents, real trusted input, one real
 * cross-document navigation and one real `pushState`. Nothing here fakes the
 * dependency under test — the dependency is Chromium, and it is Chromium.
 *
 * It also means this file needs no application server, so the harness stays
 * verifiable when the app cannot be built or seeded.
 */

const ORIGIN = "http://journey.fixture"

const PAGES: Record<string, string> = {
  "/start": `
    <!doctype html><html lang="en"><body>
      <h1>Start</h1>
      <a href="/roster">Open the roster</a>
    </body></html>`,
  "/roster": `
    <!doctype html><html lang="en"><body>
      <h1>Roster</h1>
      <label for="q">Find someone</label>
      <input id="q" name="q">
      <button id="filter" type="button">Filter</button>
      <a href="/start">Back to start</a>
      <script>
        document.getElementById('filter').addEventListener('click', function () {
          history.pushState({}, '', '/roster/filtered')
          document.querySelector('h1').textContent = 'Roster (filtered)'
        })
      </script>
    </body></html>`,
}

async function serveFixture(page: Page) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const body = PAGES[pathname]
    if (!body) return route.fulfill({ status: 404, contentType: "text/html", body: "<h1>404</h1>" })
    return route.fulfill({ status: 200, contentType: "text/html", body })
  })
}

test.describe("journey metrics harness", () => {
  test("counts the clicks, keystrokes and route changes the user actually made", async ({
    page,
  }) => {
    await serveFixture(page)
    await page.goto(`${ORIGIN}/start`)

    const measurement = await measureJourney(
      page,
      {
        id: "J00-harness",
        persona: "Harness fixture",
        journey: "Open the roster, search it, filter it and come back",
      },
      async () => {
        // 1 click, cross-document navigation to /roster.
        await page.getByRole("link", { name: "Open the roster" }).click()
        await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible()

        // 4 keystrokes. pressSequentially types; fill() would not, and the
        // "fills are not typing" test below is what holds that line.
        await page.getByLabel("Find someone").pressSequentially("acme")

        // 1 click, and a same-document route change — the App Router's shape.
        await page.getByRole("button", { name: "Filter" }).click()
        await expect(page.getByRole("heading", { name: "Roster (filtered)" })).toBeVisible()

        // 1 click, back across a document boundary.
        await page.getByRole("link", { name: "Back to start" }).click()
        await expect(page.getByRole("heading", { name: "Start" })).toBeVisible()
      },
    )

    // Exact, not "within budget". A counter that reports nothing is inside
    // every budget ever written, so a budget check alone cannot tell a working
    // harness from a dead one.
    expect({
      clicks: measurement.clicks,
      keystrokes: measurement.keystrokes,
      navigations: measurement.navigations,
      routes: measurement.routes,
      untypedInputs: measurement.untypedInputs,
    }).toEqual({ clicks: 3, keystrokes: 4, navigations: 3, routes: 3, untypedInputs: 0 })

    // And the wall clock is a real elapsed time rather than a constant.
    expect(measurement.wallClockMs).toBeGreaterThan(0)
  })

  test("fails the journey when it costs more than its recorded budget", async ({ page }) => {
    await serveFixture(page)
    await page.goto(`${ORIGIN}/start`)

    // `J00-harness-tight` is recorded at 0 clicks, so one click is a regression.
    await expect(
      measureJourney(
        page,
        { id: "J00-harness-tight", persona: "Harness fixture", journey: "One click against a zero-click budget" },
        async () => {
          await page.getByRole("link", { name: "Open the roster" }).click()
          await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible()
        },
      ),
    ).rejects.toThrow(/clicks: 1 > budget 0/)
  })

  test("refuses a journey that fills a field instead of typing it", async ({ page }) => {
    await serveFixture(page)
    await page.goto(`${ORIGIN}/roster`)

    await expect(
      measureJourney(
        page,
        { id: "J00-harness-fill", persona: "Harness fixture", journey: "Fill a field rather than type it" },
        async () => {
          await page.getByLabel("Find someone").fill("acme")
        },
      ),
    ).rejects.toThrow(/filled rather than typed/)
  })

  test("refuses a journey with no row in the scorecard", async ({ page }) => {
    await serveFixture(page)
    await page.goto(`${ORIGIN}/start`)

    await expect(
      measureJourney(
        page,
        { id: "J99-undeclared", persona: "Nobody", journey: "A journey nobody wrote down" },
        async () => {},
      ),
    ).rejects.toThrow(/has no row in/)
  })

  test("the scorecard on disk is the one the harness reads", async () => {
    // The parser is exercised on its real input, not on a string literal: a
    // parser that only ever sees its own fixture is a parser that stops
    // matching the document the moment somebody reformats a column.
    const budgets = loadBudgets()
    expect(budgets.get("J00-harness")).toEqual({
      id: "J00-harness",
      persona: "Harness fixture",
      journey: "Open the roster, search it, filter it and come back",
      clicks: 3,
      keystrokes: 4,
      navigations: 3,
      routes: 3,
    })

    // An unmeasured row parses to nulls rather than to zeros — zeros would be
    // a budget of "nothing is allowed", which every journey fails.
    const unmeasured = parseScorecard("| `J-x` | P | J | — | — | — | — |").get("J-x")
    expect(unmeasured).toMatchObject({ clicks: null, keystrokes: null, navigations: null, routes: null })
  })
})
