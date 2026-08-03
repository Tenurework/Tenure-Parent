import { execFileSync } from "child_process"
import path from "path"
import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/** Proceed 2 batch D: brand shell, footer, nav layout, notifications page. */

/**
 * The cookie the acting institution is kept in, as declared by
 * `src/lib/tenant-scope.ts`. Repeated here rather than imported because that
 * module is `server-only` and pulls in the Prisma client extension; importing
 * it into the runner would fail before a single assertion ran.
 *
 * A stale copy of this name would turn the "a forged cookie is ignored" test
 * below into a test that a cookie nobody reads is ignored — true, and worth
 * nothing. That is why the switch test asserts the application sets a cookie
 * with exactly this name: get the name wrong and it fails first.
 */
const ACTING_INSTITUTION_COOKIE = "tenure.acting-institution"



test.describe("shell + brand", () => {
  test("the Tenure AI entry opens the right-side assistant panel", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    const ai = page.getByRole("button", { name: "Ask Tenure AI" })
    await expect(ai).toBeVisible()
    await ai.click()
    const panel = page.getByRole("complementary", { name: "Tenure AI assistant" })
    await expect(panel).toBeVisible()
    await expect(panel.getByRole("textbox", { name: "Ask Tenure AI" })).toBeVisible()
    await panel.getByRole("button", { name: "Close Tenure AI" }).click()
  })

  test("footer with wordmark and copyright renders on every page", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    for (const path of ["/dashboard", "/orgs", "/calendar", "/messages"]) {
      await page.goto(path)
      await expect(
        page.getByText(/© \d{4} Tenure\. All rights reserved\./)
      ).toBeVisible()
    }
  })

  test("side panel has sections and Settings pinned at the bottom", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    const nav = page.getByRole("navigation", { name: "Primary navigation" })
    await expect(nav.getByText("Community", { exact: true })).toBeVisible()
    await expect(nav.getByText("Operations", { exact: true })).toBeVisible()
    await expect(nav.getByText("Knowledge", { exact: true })).toBeVisible()
    const settings = nav.getByRole("link", { name: "Settings" })
    await expect(settings).toBeVisible()
    // Settings sits below every section label (pinned bottom)
    const settingsBox = (await settings.boundingBox())!
    const opsBox = (await nav.getByText("Operations").boundingBox())!
    expect(settingsBox.y).toBeGreaterThan(opsBox.y)
  })

  test("the bell opens a centered notifications overlay (no side-nav entry)", async ({ page }) => {
    await signIn(page, "Alex Kim")
    // Notifications is no longer a side-nav item — the header bell owns it.
    await expect(
      page.getByRole("navigation").getByRole("link", { name: /Notifications/ })
    ).toHaveCount(0)
    // Bell → dropdown → "See all notifications" opens a centered overlay, not a page.
    await page.getByRole("button", { name: /Notifications/ }).click()
    await page.getByRole("button", { name: "See all notifications" }).click()
    await expect(
      page.getByText("Approvals, roster changes, events, and messages that involve you.")
    ).toBeVisible()
    // The standalone page still works as a deep link.
    await page.goto("/notifications")
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible()
  })
})

/**
 * GE-022-001 — which tenant am I in, how do I change it, and what stops me
 * changing it to one that is not mine.
 *
 * The seeded pilot has exactly one Institution row, so every one of these
 * assertions would pass vacuously against it: with a single tenant, "acting in
 * the right one" and "acting in the only one" are the same sentence. The
 * second and third institutions below are what make the difference observable
 * — one the signed-in user genuinely holds a seat at, and one they do not.
 *
 * Built by `scripts/ci-two-tenant-fixture.mjs --switcher` rather than in this
 * file. Creating a tenant means writing across tenants, which is control-plane
 * work that script already owns and is exempted for by name in
 * `tests/architecture/forbidden-clients.test.mjs`; a database client built here
 * would be a second unextended client with no such reason. There is no
 * tenant-provisioning endpoint to use instead (`entry-points.md`, "Import and
 * export").
 */
const FIXTURE_SCRIPT = path.join(__dirname, "..", "scripts", "ci-two-tenant-fixture.mjs")

type SwitcherFixture = {
  b: { id: string; slug: string; name: string }
  c: { id: string; slug: string; name: string }
  org: { id: string; slug: string; name: string }
  member: { email: string; name: string }
  outsider: { email: string; name: string }
}

/** The fixture's own description of what it built. Names live in one place. */
let fixture: SwitcherFixture

/** A club that exists only in the pilot tenant. Its absence is the proof. */
const TENANT_A_CLUB = "Simon Consulting Club (SCC)"
const TENANT_A_NAME = "University of Rochester"

test.describe("acting institution", () => {
  test.beforeAll(() => {
    const output = execFileSync("node", [FIXTURE_SCRIPT, "--switcher"], { encoding: "utf8" })
    fixture = JSON.parse(output.trim().split("\n").pop()!)
  })

  test.afterAll(() => {
    execFileSync("node", [FIXTURE_SCRIPT, "--switcher-teardown"], { encoding: "utf8" })
  })

  test("every page names the institution it is showing", async ({ page }) => {
    await signIn(page, fixture.member.name)

    for (const route of ["/dashboard", "/orgs", "/calendar", "/messages"]) {
      await page.goto(route)
      await expect(page.getByTestId("active-tenant")).toHaveText(TENANT_A_NAME)
    }
  })

  test("a user with one institution is still told which one", async ({ page }) => {
    // Priya holds a seat in the pilot tenant and nowhere else. The label is not
    // conditional on there being a choice: "no switcher" must not be
    // indistinguishable from "the tenant you assumed".
    await signIn(page, fixture.outsider.name)

    await expect(page.getByTestId("active-tenant")).toHaveText(TENANT_A_NAME)
    await expect(page.getByRole("button", { name: /Switch institution/ })).toHaveCount(0)
  })

  test("/api/me reports who is signed in and which tenant they are acting in", async ({ page }) => {
    await signIn(page, fixture.member.name)

    const response = await page.request.get("/api/me")
    expect(response.status()).toBe(200)
    const me = await response.json()

    expect(me.user.email).toBe(fixture.member.email)
    expect(me.activeInstitution.slug).toBe("rochester")
    expect(me.institutions.map((i: { slug: string }) => i.slug)).toEqual([
      "rochester",
      fixture.b.slug,
    ])
    expect(me.institutions.find((i: { slug: string }) => i.slug === "rochester").active).toBe(true)
    // Bootstrap, not authorization: it reports the enabled modules so a client
    // can render truthfully, and every route still decides for itself.
    expect(me.modules).toContain("dashboard")

    // GE-042-006. Somebody with a live membership is ACTIVE, and the state is
    // carried alongside `activeInstitution` rather than inferred from it —
    // `activeInstitution: null` used to be the only answer for every way of
    // having no access, so a suspended director saw the onboarding path a new
    // account sees.
    //
    // Only the ACTIVE branch is reachable from here: every account the dev
    // sign-in offers is a seeded demo account holding a live membership, and
    // adding a fake unplaced account to the product's sign-in page to make a
    // test possible would be the wrong trade. The other five states are proved
    // against real PostgreSQL in `src/lib/identity/access-state.itest.ts`,
    // through `accessReportFor` — the same function this route calls, not a
    // copy of its query.
    expect(me.access.state).toBe("ACTIVE")
    expect(me.access.waitingOnTheClock).toBe(false)
  })

  test("/api/me refuses a request with no session", async ({ request }) => {
    // The `request` fixture carries no cookies, so this is a genuinely
    // anonymous call rather than the signed-in browser with a header removed.
    const response = await request.get("/api/me")

    expect(response.status()).toBe(401)
    expect(await response.json()).toEqual({ error: "Not signed in." })
  })

  test("switching institution moves the whole app to the other tenant", async ({ page }) => {
    await signIn(page, fixture.member.name)

    await page.goto("/orgs")
    await expect(page.getByText(TENANT_A_CLUB)).toBeVisible()
    await expect(page.getByText(fixture.org.name)).toHaveCount(0)

    await page.getByRole("button", { name: /Switch institution/ }).click()
    await page.getByRole("menuitem", { name: fixture.b.name }).click()

    await expect(page.getByTestId("active-tenant")).toHaveText(fixture.b.name)

    // The choice is persisted, not held in a component's state: it has to
    // survive the next request, which is the whole reason it is a cookie.
    const cookie = (await page.context().cookies()).find(
      (c) => c.name === ACTING_INSTITUTION_COOKIE,
    )
    expect(cookie?.value).toBe(fixture.b.id)
    expect(cookie?.httpOnly).toBe(true)

    // The point of the whole feature. Tenant A's club is not merely hidden from
    // a menu — it is not in the answer any more.
    await page.goto("/orgs")
    await expect(page.getByText(fixture.org.name)).toBeVisible()
    await expect(page.getByText(TENANT_A_CLUB)).toHaveCount(0)

    const me = await (await page.request.get("/api/me")).json()
    expect(me.activeInstitution.slug).toBe(fixture.b.slug)

    // ...and switching back is a switch, not a special case.
    await page.getByRole("button", { name: /Switch institution/ }).click()
    await page.getByRole("menuitem", { name: TENANT_A_NAME }).click()
    await expect(page.getByTestId("active-tenant")).toHaveText(TENANT_A_NAME)
    await page.goto("/orgs")
    await expect(page.getByText(TENANT_A_CLUB)).toBeVisible()
  })

  test("a non-member cannot reach another tenant's rows by naming it in the cookie", async ({
    page,
  }) => {
    // The leak, stated as an attack. Priya holds a seat in the pilot tenant and
    // nowhere else; tenant B is a real tenant with real rows in it. If the
    // cookie were believed, this is the request that would return them.
    await signIn(page, fixture.outsider.name)

    await page.context().addCookies([
      { name: ACTING_INSTITUTION_COOKIE, value: fixture.b.id, url: new URL(page.url()).origin },
    ])

    await page.goto("/orgs")
    await expect(page.getByTestId("active-tenant")).toHaveText(TENANT_A_NAME)
    await expect(page.getByText(fixture.org.name)).toHaveCount(0)
    await expect(page.getByText(TENANT_A_CLUB)).toBeVisible()

    const me = await (await page.request.get("/api/me")).json()
    expect(me.activeInstitution.slug).toBe("rochester")
    expect(me.institutions.map((i: { slug: string }) => i.slug)).toEqual(["rochester"])
  })

  test("a cookie naming an institution nobody has placed the user in buys nothing", async ({
    page,
  }) => {
    // The cookie is the only thing that says which tenant to act in, and it is
    // entirely under the caller's control. If it were believed, any signed-in
    // account could read any tenant by editing a string in their own browser.
    await signIn(page, fixture.member.name)

    await page.context().addCookies([
      {
        name: ACTING_INSTITUTION_COOKIE,
        value: fixture.c.id,
        url: new URL(page.url()).origin,
      },
    ])

    const me = await (await page.request.get("/api/me")).json()
    expect(me.activeInstitution.slug).toBe("rochester")
    expect(me.institutions.map((i: { slug: string }) => i.slug)).not.toContain(fixture.c.slug)

    await page.goto("/orgs")
    await expect(page.getByTestId("active-tenant")).toHaveText(TENANT_A_NAME)
    await expect(page.getByText(TENANT_A_CLUB)).toBeVisible()
  })
})
