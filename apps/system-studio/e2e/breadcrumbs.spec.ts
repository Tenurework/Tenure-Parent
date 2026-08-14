import { test, expect, type Page } from "@playwright/test"

import { GROUPS } from "../src/components/Nav"
import { trailFor, type Crumb } from "../src/components/Breadcrumbs"
import { operatorFor } from "./operator-identity"

/**
 * Where the operator is, and the way back — §6 of
 * `docs/architecture/studio-information-architecture.md`, STUDIO-030-008.
 *
 * Two halves, and they answer different questions.
 *
 * **The decision** (`trailFor`, no browser). Every branch where a breadcrumb
 * can invent something: a tenant whose name the console holds, a tenant whose
 * name it does not, a segment no route names, a fixed sub-route whose page
 * calls itself something the URL does not. A seeded fleet has one shape; these
 * are the shapes it does not have, and they are exactly where "prettify the
 * slug" hides.
 *
 * **The rendering** (a browser, signed in). That the trail is on the page at
 * all, on static routes and dynamic ones, that it sits above the page's own
 * `<h1>` rather than in the top bar, that the current page is not a link, and
 * that the tenant crumb on a real route reads the name the registry binding
 * holds rather than the slug in the address bar.
 *
 * The second half cannot pass until the shell mounts the component. That is
 * one line in `src/app/layout.tsx`, a file this lane does not own, and the
 * failure message on the first test says so rather than making a reader guess.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

/* ── the decision ────────────────────────────────────────────────────────── */

const labels = (trail: readonly Crumb[]) => trail.map((crumb) => crumb.label)
const hrefs = (trail: readonly Crumb[]) => trail.map((crumb) => crumb.href)
const sources = (trail: readonly Crumb[]) => trail.map((crumb) => crumb.source)

test.describe("the trail a path produces", () => {
  test("a tenant is named by its binding, not by title-casing its address", () => {
    const trail = trailFor("/tenants/rochester/configuration", {
      rochester: "Simon Business School — Ainslie OSE",
    })

    expect(labels(trail)).toEqual([
      "Tenants",
      "Simon Business School — Ainslie OSE",
      "Configuration",
    ])
    expect(sources(trail)).toEqual(["nav", "binding", "fixed"])
    expect(hrefs(trail)).toEqual(["/tenants", "/tenants/rochester", null])
  })

  test("a tenant this console cannot name renders its address, and invents nothing", () => {
    const trail = trailFor("/tenants/rochester/configuration")

    // The address, exactly as it is in the URL. Not "Rochester", which is what
    // a `capitalize(segment)` would produce and is a name nobody agreed to.
    expect(labels(trail)).toEqual(["Tenants", "rochester", "Configuration"])
    expect(labels(trail)).not.toContain("Rochester")
    expect(sources(trail)[1]).toBe("segment")
  })

  test("a segment no route names renders the segment itself, unlinked", () => {
    const trail = trailFor("/tenants/rochester/telemetry")
    const last = trail[trail.length - 1]

    expect(last.label).toBe("telemetry")
    expect(last.source).toBe("segment")
    expect(last.href).toBeNull()
  })

  test("a path deeper than any route this console serves still says only its segments", () => {
    // Reaches `crumbBelow`'s last arm — the one for a depth no table describes.
    // Without this the arm is only mutation-proof through the `/tenants/<slug>/…`
    // branch above it, and a prettifier planted here passed twelve green tests.
    const trail = trailFor("/tenants/rochester/configuration/audit-trail")

    expect(labels(trail)).toEqual(["Tenants", "rochester", "Configuration", "audit-trail"])
    expect(labels(trail)).not.toContain("Audit-trail")
    expect(sources(trail).at(-1)).toBe("segment")
    expect(hrefs(trail).slice(-2)).toEqual([null, null])
  })

  test("a percent-encoded segment is shown decoded, and a malformed one is shown as it is", () => {
    expect(labels(trailFor("/tenants/rochester%20east"))).toEqual(["Tenants", "rochester east"])
    expect(labels(trailFor("/tenants/%E0%A4%A"))).toEqual(["Tenants", "%E0%A4%A"])
  })

  test("a fixed sub-route takes its own page's name, and never appears as an href", () => {
    const trail = trailFor("/tenants/new")

    // `/tenants/new`'s <h1> is "Compose a tenant". "New" is the URL's word.
    expect(labels(trail)).toEqual(["Tenants", "Compose a tenant"])
    expect(sources(trail)[1]).toBe("fixed")
    // `e2e/operator-roles.spec.ts:79` requires `href="/tenants/new"` to be
    // absent from an auditor's markup, and this component renders on every
    // route for every role.
    expect(hrefs(trail)).not.toContain("/tenants/new")
  })

  test("the current page is the last crumb, is not a link, and every ancestor is", () => {
    for (const path of ["/", "/tenants", "/platform/network", "/tenants/seed-deployed"]) {
      const trail = trailFor(path, { "seed-deployed": "Seed seed-deployed" })
      expect(trail.length, path).toBeGreaterThan(0)
      expect(trail[trail.length - 1].href, path).toBeNull()
      for (const crumb of trail.slice(0, -1)) {
        expect(crumb.href, `${path} → ${crumb.label}`).not.toBeNull()
      }
    }
  })

  test("the domain leads the trail when it says something the entry does not", () => {
    // `/platform/network` is the AWS domain; its group's first entry is Estate.
    expect(labels(trailFor("/platform/network"))).toEqual(["AWS", "Network"])
    expect(hrefs(trailFor("/platform/network"))[0]).toBe("/platform/estate")
    // `/platform` is behind the Diagnostics line, and the trail says so.
    expect(labels(trailFor("/platform"))).toEqual(["Diagnostics", "Platform"])
  })

  test("and is dropped when it would be a link to where the next crumb goes", () => {
    // Fleet's only entry is Tenants: "Fleet › Tenants" would be two adjacent
    // controls with one destination.
    expect(labels(trailFor("/tenants"))).toEqual(["Tenants"])
    expect(labels(trailFor("/"))).toEqual(["Systems"])
  })

  test("every navigation destination produces a trail ending in that entry's own word", () => {
    const destinations = GROUPS.flatMap((group) => group.entries)
    // The floor: a reader that stopped reading `GROUPS` would report a clean
    // navigation. Fourteen entries ship today (IA §4.1).
    expect(destinations.length).toBeGreaterThanOrEqual(14)

    for (const entry of destinations) {
      const trail = trailFor(entry.href)
      expect(trail.length, entry.href).toBeGreaterThan(0)
      expect(labels(trail).at(-1), entry.href).toBe(entry.label)
      expect(trail[trail.length - 1].href, entry.href).toBeNull()
    }
  })

  test("a path no entry owns says only what it can, and links nothing", () => {
    const trail = trailFor("/reports/q3")

    expect(labels(trail)).toEqual(["reports", "q3"])
    expect(sources(trail)).toEqual(["segment", "segment"])
    // Linking `/reports` would assert this console serves it. It does not know that.
    expect(hrefs(trail)).toEqual([null, null])
  })

  test("the sign-in page has no trail at all", () => {
    expect(trailFor("/signin")).toEqual([])
    expect(trailFor("/signin/")).toEqual([])
  })

  test("a trailing slash is the same place as none", () => {
    expect(trailFor("/tenants/seed-deployed/")).toEqual(trailFor("/tenants/seed-deployed"))
  })
})

/* ── the rendering ───────────────────────────────────────────────────────── */

/** Every route the shell frames, including the two dynamic ones. */
const ROUTES = [
  "/",
  "/tenants",
  "/tenants/new",
  "/tenants/seed-deployed",
  "/tenants/seed-deployed/configuration",
  "/platform",
  "/platform/estate",
  "/platform/network",
  "/platform/compute",
  "/platform/messaging",
  "/platform/identity",
  "/platform/data",
  "/platform/security",
  "/platform/health",
  "/platform/cost",
  "/platform/audit",
  "/platform/diagnostics",
]

/** The shell's trail, told apart from a page's own local one by its data attribute. */
const shellTrail = (page: Page) => page.locator('nav[data-breadcrumbs="shell"]')

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()

  /*
    Waiting for the URL to LEAVE `/signin`, not for `networkidle`.

    This console renders a `<Link>` for every section and Next prefetches them,
    so it is never idle; a `networkidle` wait resolves while the browser is
    still on the sign-in page. The ledger records that exact false green in
    `e2e/network-surface.spec.ts` — sixteen tests asserting against the sign-in
    screen — and a breadcrumb suite is the shape that hides it best, because
    `/signin` legitimately has no trail. Every "no breadcrumb" failure below
    would then have been indistinguishable from "never signed in".
  */
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 60_000 })
  await expect(page, "sign-in did not leave /signin").not.toHaveURL(/\/signin/)
}

test.describe("the trail on the page", () => {
  test.beforeAll(() => {
    expect(OPERATOR, "PLATFORM_OPERATORS must be set").not.toBe("")
    expect(SECRET, "PLATFORM_OPERATOR_SECRET must be set").not.toBe("")
  })

  test("the shell renders it, on every route it frames", async ({ page }) => {
    await signIn(page)

    for (const route of ROUTES) {
      /*
        `domcontentloaded`, not the default `load`. Nothing below needs the
        subresources — every assertion is a Playwright locator, which waits on
        its own — and against a `next dev` server the longer wait is a window in
        which a Fast Refresh from another lane's save aborts the navigation
        (`net::ERR_ABORTED`). The assertions are unchanged; only the moment they
        start is.
      */
      await page.goto(route, { waitUntil: "domcontentloaded" })
      await expect(
        shellTrail(page),
        `${route} has no breadcrumb. The component is components/Breadcrumbs.tsx; ` +
          `the shell mounts it in src/app/layout.tsx, inside <main>, above {children} ` +
          `(docs/architecture/studio-information-architecture.md §6).`,
      ).toHaveCount(1)

      // A landmark a screen reader can announce and skip.
      await expect(shellTrail(page)).toHaveAttribute("aria-label", "Breadcrumb")

      // Exactly one current page, and it is not a control.
      const current = shellTrail(page).locator('[aria-current="page"]')
      await expect(current, route).toHaveCount(1)
      await expect(current, route).not.toHaveRole("link")
    }
  })

  test("the sign-in page has none", async ({ page }) => {
    await page.goto("/signin")
    await expect(shellTrail(page)).toHaveCount(0)
  })

  test("it sits above the page's own headline, not in the top bar", async ({ page }) => {
    await signIn(page)
    await page.goto("/tenants/seed-deployed")

    // Wait for each, THEN measure. `boundingBox()` samples once and returns
    // null for anything not yet painted — it does not retry on visibility the
    // way `expect().toBeVisible()` does. Measuring straight after `goto()` made
    // this test a coin toss: it passed, then failed twice in a row locally on an
    // unchanged tree, and failed in CI while a full local suite had gone green
    // minutes earlier. The `<h1>` is server-rendered and always arrives; the
    // test was simply asking before it had.
    //
    // The assertions below are unchanged. This only stops the measurement
    // racing the paint.
    await expect(shellTrail(page)).toBeVisible()
    await expect(page.locator("h1").first()).toBeVisible()
    await expect(page.locator("header.masthead")).toBeVisible()

    const trail = await shellTrail(page).boundingBox()
    const headline = await page.locator("h1").first().boundingBox()
    const masthead = await page.locator("header.masthead").boundingBox()

    expect(trail, "the trail must be on the page").not.toBeNull()
    expect(headline).not.toBeNull()
    expect(masthead).not.toBeNull()
    // Above the <h1>…
    expect(trail!.y + trail!.height).toBeLessThanOrEqual(headline!.y + 1)
    // …and below the bar, which is where §6 says it must NOT be.
    expect(trail!.y).toBeGreaterThanOrEqual(masthead!.y + masthead!.height - 1)
  })

  test("a tenant crumb reads the name on the binding and links back to the tenant", async ({
    page,
  }) => {
    await signIn(page)
    await page.goto("/tenants/seed-deployed/configuration")

    const crumbs = shellTrail(page).locator("li")
    // `tools/dev/seed-studio-fleet.mjs` writes displayName `Seed <slug>`, so
    // the name and the address are different strings and this assertion can
    // tell them apart. A trail built by title-casing the URL would read
    // "Seed Deployed"; one built from the address would read "seed-deployed".
    await expect(crumbs).toHaveText([/Tenants/, /Seed seed-deployed/, /Configuration/])

    const named = shellTrail(page).getByRole("link", { name: "Seed seed-deployed" })
    await expect(named).toHaveAttribute("href", "/tenants/seed-deployed")
    await expect(shellTrail(page).locator('li[data-crumb-source="binding"]')).toHaveCount(1)

    // Up: the fleet is one click from a tenant's configuration.
    await shellTrail(page).getByRole("link", { name: "Tenants" }).click()
    // The destination, not the wait: 60s because a dev server compiles the
    // route on the first client navigation to it. The assertion is unchanged —
    // the fleet, reached from a tenant's configuration, in one click.
    await expect(page).toHaveURL(/\/tenants$/, { timeout: 60_000 })
  })

  test("at 320px it collapses to the parent, and the rest is not merely moved off-screen", async ({
    page,
  }) => {
    await signIn(page)
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto("/tenants/seed-deployed/configuration")

    const parent = shellTrail(page).locator('li[data-crumb-role="parent"]')
    await expect(parent).toBeVisible()
    await expect(parent).toContainText("Seed seed-deployed")

    // `display: none`, not a translation: `layout.spec.ts` measures anything
    // with a box in PAGE coordinates, so a crumb pushed off the viewport is
    // still measured and still overlaps whatever it lands on.
    const ancestors = shellTrail(page).locator('li[data-crumb-role="ancestor"]')
    await expect(ancestors).toHaveCount(1)
    await expect(ancestors.first()).toBeHidden()
    expect(
      await ancestors.first().evaluate((element) => getComputedStyle(element).display),
    ).toBe("none")

    // No sideways scroll from the trail at the narrowest width WCAG 2.2 names.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  })
})
