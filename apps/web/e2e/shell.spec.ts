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

  /**
   * TTES-030-001 — Bible §5.1's "Global command/search (⌘/Ctrl K) with
   * permission-aware actions and recent objects".
   *
   * There was no ⌘K anywhere in the tenant product: the only key handler in the
   * whole shell was an onKeyDown on the search input itself, so the palette was
   * unreachable from the keyboard from every route. The operator console has
   * had one since GE-022-007.
   */
  test("Ctrl-K opens the command palette from any route, with combobox semantics", async ({
    page,
  }) => {
    await signIn(page, "Maya Johnson")

    for (const route of ["/dashboard", "/calendar"]) {
      await page.goto(route)
      await page.waitForLoadState("networkidle")

      const combobox = page.getByRole("combobox", { name: "Search Tenure" })
      await expect(combobox).toHaveAttribute("aria-expanded", "false")

      // Pressed on the document, with nothing focused — the point of the item.
      await page.keyboard.press("Control+k")

      await expect(combobox).toBeFocused()
      await expect(combobox).toHaveAttribute("aria-expanded", "true")
      await expect(combobox).toHaveAttribute("aria-controls", "shell-search-listbox")

      // Permission-aware ACTIONS, not only objects. They come from the same
      // capability-filtered navigation the side nav renders, so an action this
      // principal does not hold was never in the list to be filtered out.
      const listbox = page.locator("#shell-search-listbox")
      await expect(listbox).toHaveAttribute("role", "listbox")
      const options = listbox.getByRole("option")
      expect(await options.count()).toBeGreaterThan(0)
      await expect(options.first()).toContainText("Go to")

      // Maya is a plain member: the admin console is not in her navigation, so
      // it cannot be offered here either.
      await expect(listbox).not.toContainText("Admin Console")

      // Arrowing tracks aria-activedescendant, which is the whole reason a
      // screen-reader user can follow the selection.
      await expect(combobox).not.toHaveAttribute("aria-activedescendant", /.+/)
      await page.keyboard.press("ArrowDown")
      await expect(combobox).toHaveAttribute("aria-activedescendant", "shell-search-opt-0")
      await expect(options.first()).toHaveAttribute("aria-selected", "true")
      await page.keyboard.press("ArrowDown")
      await expect(combobox).toHaveAttribute("aria-activedescendant", "shell-search-opt-1")

      await page.keyboard.press("Escape")
      await expect(combobox).toHaveAttribute("aria-expanded", "false")
    }
  })

  test("the palette offers an admin their admin actions, and remembers what they opened", async ({
    page,
  }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle")

    await page.keyboard.press("Control+k")
    const listbox = page.locator("#shell-search-listbox")
    await expect(listbox).toBeVisible()
    // The director's navigation carries the console, so the palette does too —
    // the same resolution, not a second list that could disagree with it.
    await expect(listbox).toContainText("Admin Console")

    // Recent objects (§5.1). Open one from a search, then reopen the palette
    // with an empty query and it is offered back.
    await page.getByRole("combobox", { name: "Search Tenure" }).fill("Simon Consulting")
    const result = listbox.getByRole("option").filter({ hasText: "Simon Consulting" }).first()
    await expect(result).toBeVisible({ timeout: 10_000 })
    await result.click()
    await page.waitForLoadState("networkidle")

    await page.keyboard.press("Control+k")
    // Empty query: the palette offers the actions and then the objects this
    // person opened recently — §5.1's "recent objects", which did not exist.
    await expect(page.locator("#shell-search-listbox")).toContainText("Simon Consulting")
  })

  /**
   * TTES-030-001 — Bible §5.1's "Work inbox with approvals, tasks, exceptions,
   * mentions and due items", which did not exist: the product had `/approvals`,
   * `/notifications` and `/calendar` and nothing that answered "what needs me".
   *
   * Asserts on what the PRODUCTION page emits — the bucket headings the route
   * renders from `groupWorkItems`, and the ordering that puts the overdue band
   * above every other one. A test that called `orderWorkItems` directly would
   * stay green if the page stopped calling it, which is the failure this repo
   * has shipped before.
   */
  test("the work inbox is reachable from the shell and orders overdue work first", async ({
    page,
  }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/dashboard")

    // §5.1 puts the inbox in the UNIVERSAL SHELL, so it must be reachable from
    // a route that is not itself the inbox.
    await page.getByRole("link", { name: "Work inbox" }).click()
    await page.waitForURL(/\/inbox/)

    await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible()
    // The page's state, in the header's status band — the count of what
    // genuinely needs attention, which is `needsAttentionCount`'s output and
    // not a total. (`Badge` forwards no `data-testid`, so this reads the band
    // the shared `PageHeader` marks, which is what production renders.)
    await expect(page.locator("[data-slot='record-status']")).toContainText(/needs? attention/)

    const groups = page.getByTestId("inbox-groups")
    await expect(groups).toBeVisible()

    // The bands the page actually rendered, in the order it rendered them.
    const buckets = await groups.locator("h2[data-bucket]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-bucket")),
    )
    expect(buckets.length).toBeGreaterThan(0)

    // Whatever subset of bands this seed produces, they must be in §5.1's
    // urgency order — overdue before today before this-week before later
    // before undated. This is the assertion that reds if `orderWorkItems` /
    // `groupWorkItems` stops being what the page renders from.
    const ORDER = ["overdue", "today", "this-week", "later", "no-date"]
    const indices = buckets.map((b) => ORDER.indexOf(b!))
    expect(indices).toEqual([...indices].sort((a, b) => a - b))
    expect(indices.every((i) => i >= 0)).toBe(true)

    // Every row names which of the five kinds it is, so an exception is not
    // filed among twenty budget requests.
    const kinds = await groups.locator("li[data-work-kind]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-work-kind")),
    )
    expect(kinds.length).toBeGreaterThan(0)
    for (const k of kinds) {
      expect(["approval", "exception", "task", "mention", "due"]).toContain(k)
    }
  })

  /**
   * TTES-030-001 — Bible §5.3, record anatomy.
   *
   * "Every important record uses a stable anatomy: identity + status + primary
   * actions / summary and key facts / work-content tabs." The club is the
   * product's central record and its six surfaces each hand-rolled their own
   * header; five emitted a bare `<h1>{org.name}</h1>` with nowhere to put the
   * state at all. They now all go through `OrgRecordHeader`.
   *
   * The assertion is deliberately on ALL SIX, in one case: the requirement is a
   * STABLE anatomy, and a spec that checked one surface would pass while five
   * disagreed — which is exactly the state this found.
   */
  test("every club surface shows the same record anatomy: identity, then state, then tabs", async ({
    page,
  }) => {
    // Six server-rendered club surfaces in one case, deliberately — see above.
    // Six full page loads do not fit the suite's 45s default, and splitting
    // them into six cases would let five pass while one disagreed, which is
    // the state this case exists to catch.
    test.slow()
    await signIn(page, "Maya Johnson")

    for (const section of ["members", "finance", "documents", "memory", "handoff", "impact"]) {
      await page.goto(`/orgs/simon-consulting-club/${section}`)

      const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) })

      // Identity: the breadcrumb back to the record's collection, and the name.
      await expect(
        page.getByRole("navigation", { name: "Breadcrumb" }),
        `${section} has no breadcrumb`,
      ).toBeVisible()
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Simon Consulting Club")

      // Status: the band that did not exist. At least one badge of real state,
      // rendered INSIDE the header — above the tabs, below the identity.
      const status = header.locator("[data-slot='record-status']")
      await expect(status, `${section} renders no record status`).toBeVisible()
      await expect(status.locator("> *")).not.toHaveCount(0)

      // Work/content tabs, the third band, on every one of them.
      await expect(
        page.getByRole("navigation", { name: "Club sections" }),
        `${section} has no section tabs`,
      ).toBeVisible()
    }
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

  /**
   * TTES-GATE-030 — the menu offers a person what they can do, and nothing else.
   *
   * Nothing proved this before, and the near-misses are the interesting part.
   * `navigation-capabilities.test.ts` does exercise `navigationCapabilitiesFor`
   * — freezing that function to `new Set(Object.values(NAV_CAPABILITIES))` reds
   * four of its cases — but every one of those calls the function DIRECTLY with
   * a hand-built `UserContext`. None of them says the layout still passes the
   * result on. Change `(app)/layout.tsx` to hand `navigationForSystem` a `null`
   * capability set — its documented "show everything, for operator views" —
   * and the whole unit suite stays green while every signed-in member is
   * offered an Admin Console link. That is the mutate-the-producer hole, and it
   * is the mutation this case is proven against.
   *
   * `admin-console.spec.ts` came closest and still missed it: it asserts a
   * member cannot reach the /admin PAGE, never that the member's side nav stops
   * offering it. A hidden page behind a visible link is still clutter, and it is
   * still the gate failing.
   *
   * So this reads the RENDERED nav — the thing `(app)/layout.tsx` emits after
   * `navigationCapabilitiesFor` has filtered `navigationForSystem` — for two
   * seeded personas against the same database, in one test so that neither
   * reading can be explained away by a different fixture.
   *
   * The `Calendar` / `Messages` assertions in the member half are not padding.
   * `toHaveCount(0)` passes just as happily against a nav that failed to render
   * at all, and a suite that cannot tell "correctly scoped" from "absent" is
   * measuring nothing. Those two entries carry no `requiresCapability`, so they
   * are what the menu looks like when it is working and still narrow.
   */
  test("the side nav offers privileged entries to the director and not to a member", async ({
    page,
  }) => {
    const nav = page.getByRole("navigation", { name: "Primary navigation" })

    // Dana Whitfield holds OSE_DIRECTOR, which maps to both navigation
    // capabilities: admin.console.read (Admin Console) and finance.report.read
    // (Reports).
    await signIn(page, "Dana Whitfield")
    await expect(nav.getByRole("link", { name: "Admin Console" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Reports" })).toBeVisible()

    // Maya Johnson holds a club seat and no institution membership, so she holds
    // neither capability. Same database, same nav, same run.
    await signIn(page, "Maya Johnson")
    await expect(nav.getByRole("link", { name: "Admin Console" })).toHaveCount(0)
    await expect(nav.getByRole("link", { name: "Reports" })).toHaveCount(0)
    await expect(nav.getByRole("link", { name: "Calendar" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Messages" })).toBeVisible()
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
