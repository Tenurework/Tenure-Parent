import { test, expect, type Page } from "@playwright/test"
import { operatorFor } from "./operator-identity"

/**
 * STUDIO-030-003 — the top bar, driven in a browser.
 *
 * Four of the operator's complaints about this console were about things that
 * were not on screen: no logout, no way back, no global search, no logo. Every
 * assertion below is about one of those, and each was checked by breaking the
 * thing it names and watching it fail — which is the property that was missing
 * from five guards found switched off in this repository.
 *
 * What is deliberately NOT asserted: that the session cookie cannot be
 * replayed. The Studio uses NextAuth's JWT strategy, so the session lives in a
 * signed cookie and not in a server-side store; signing out clears that cookie
 * with a `Set-Cookie` on a POST response, and in Cognito mode it also ends the
 * identity provider's own session. Someone who captured the cookie value
 * beforehand could still present it until it expires. That is a property of the
 * existing session strategy rather than of this change, and pretending a test
 * here proves otherwise would be exactly the kind of claim this programme
 * cannot absorb.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

test.beforeAll(() => {
  // Fail loudly rather than quietly testing a weaker configuration.
  expect(OPERATOR, "PLATFORM_OPERATORS must be set for this suite").not.toBe("")
  expect(SECRET, "PLATFORM_OPERATOR_SECRET must be set for this suite").not.toBe("")
})

/** The role slug `PLATFORM_OPERATORS` carries for the signed-in address. */
function roleSlug(): string {
  const entry = (process.env.PLATFORM_OPERATORS ?? "")
    .split(",")
    .map((e) => e.trim())
    .find((e) => e.split(":")[0]?.trim().toLowerCase() === OPERATOR.toLowerCase())
  const slug = entry?.split(":")[1]?.trim() ?? ""
  expect(slug, "the signed-in operator must carry a role in PLATFORM_OPERATORS").not.toBe("")
  return slug
}

/** The same slug as `TopBar.roleLabel` renders it. */
function roleLabel(): string {
  const words = roleSlug().split("-").join(" ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const banner = (page: Page) => page.getByRole("banner")
const accountTrigger = (page: Page) => banner(page).locator('button[aria-haspopup="menu"]')
const searchTrigger = (page: Page) => page.locator('[data-search-trigger="true"]')
const estateChip = (page: Page) => page.locator('[data-testid="topbar-estate"]')
/** Menu items an operator can actually move to. Disabled ones are read-only detail. */
const enabledItems = (page: Page) =>
  page.getByRole("menu").locator('[role="menuitem"]:not([aria-disabled="true"])')

/**
 * A real operator session, established through NextAuth's own credentials
 * callback rather than by driving the `/signin` form.
 *
 * The form is `e2e/signin.spec.ts`'s subject and is deliberately not this
 * suite's: a top-bar suite that goes red because somebody renamed a field on
 * the sign-in page is a suite nobody reads the failures of. What is posted here
 * is the request that form posts — the same endpoint, with the CSRF token the
 * server issued — so the session is the one the console actually mints, and
 * `page.request` shares the browser context's cookie jar, so the browser holds
 * it afterwards.
 *
 * The wait at the end is for the bar's own account trigger, NOT for
 * `networkidle`. `networkidle` resolves whenever the network happens to go
 * quiet, which on a loaded machine is before the console has rendered.
 */
async function signIn(page: Page) {
  const csrf = await (await page.request.get("/api/auth/csrf")).json()
  const response = await page.request.post("/api/auth/callback/operator", {
    form: {
      csrfToken: String(csrf?.csrfToken ?? ""),
      email: OPERATOR,
      secret: SECRET,
      callbackUrl: "/",
    },
  })
  expect(response.status(), "the credentials callback accepted the operator").toBeLessThan(400)
  await page.goto("/")
  await expect(accountTrigger(page)).toBeVisible({ timeout: 60_000 })
}

/**
 * Open the account menu, by mouse or by key, and tolerate the one thing every
 * server-rendered console does to the first interaction: the markup arrives
 * before the bundle that answers it. A click on a hydrated-looking trigger a
 * few hundred milliseconds too early is discarded silently — the control is
 * visible, enabled and inert — and the failure reads as "the menu does not
 * open", which is a bug report against the wrong thing.
 *
 * The retry re-issues the SAME gesture, so what is being tested is unchanged:
 * a click opens it, `Enter` opens it, and the assertion below still fails if
 * the gesture never opens it.
 */
async function openAccountMenu(page: Page, how: "click" | "Enter" = "click") {
  const trigger = accountTrigger(page)
  await expect(trigger).toBeVisible()
  await expect(async () => {
    if (how === "click") {
      await trigger.click()
    } else {
      await trigger.focus()
      await page.keyboard.press(how)
    }
    await expect(page.getByRole("menu")).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 40_000, intervals: [500, 1_000, 2_000, 3_000] })
}

/** Which element has focus, described well enough to read in a failure message. */
function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el) return "null"
    return [
      el.tagName.toLowerCase(),
      el.getAttribute("data-search-trigger") ? "[data-search-trigger]" : "",
      el.getAttribute("aria-haspopup") ? `[aria-haspopup=${el.getAttribute("aria-haspopup")}]` : "",
      el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : "",
      `"${(el.textContent ?? "").trim().slice(0, 48)}"`,
    ]
      .filter(Boolean)
      .join(" ")
  })
}

test.describe("the top bar", () => {
  test("carries the mark, and the mark is the way home", async ({ page }) => {
    await signIn(page)
    // Start somewhere deep, because "back and forth" was the complaint.
    await page.goto("/platform/security")
    await page.waitForLoadState("networkidle")

    const home = banner(page).getByRole("link", { name: "Tenure System Studio, home" })
    await expect(home).toBeVisible()
    await expect(home).toHaveAttribute("href", "/")

    // The real mark, not a word in a pill: `components/md3/Logo` draws the
    // rosette as six rotated petals, each its own <path>.
    const petals = await home.locator("svg path").count()
    expect(petals, "the rosette's petals from components/md3/Logo").toBeGreaterThanOrEqual(6)

    await home.click()
    await page.waitForURL((url) => url.pathname === "/")
    await expect(page.getByRole("heading", { name: "Organization systems" })).toBeVisible()
  })

  test("names who is signed in and which operator role they hold", async ({ page }) => {
    await signIn(page)

    const trigger = accountTrigger(page)
    await expect(trigger).toBeVisible()
    await expect(trigger).toContainText(OPERATOR)
    // The role, because five families exist and they hold different grants. An
    // operator who cannot see theirs reads a correct refusal as a broken page.
    await expect(trigger).toContainText(roleLabel(), { ignoreCase: true })

    await openAccountMenu(page)
    const menu = page.getByRole("menu")
    // And the exact value `PLATFORM_OPERATORS` carries, inside — `email:role`,
    // which is the string an administrator would have to edit to change it.
    await expect(menu).toContainText(`${OPERATOR}:${roleSlug()}`)
  })

  test("names the estate this console is pointed at, and never leaves it blank", async ({
    page,
  }) => {
    await signIn(page)

    const estate = estateChip(page)
    await expect(estate).toBeVisible()

    const known = await estate.getAttribute("data-estate-known")
    expect(known, "the estate readout says whether it was actually read").toMatch(/^(true|false)$/)

    const text = ((await estate.textContent()) ?? "").replace(/\s+/g, " ").trim()
    // `AWS <account> · <region>` — two values, neither of them empty. A blank
    // account or a blank region is the defect this asserts against: the reading
    // is either a value or the word UNKNOWN, and never nothing.
    const parts = text.replace(/^AWS/, "").split("·").map((p) => p.trim())
    expect(parts, `estate readout was "${text}"`).toHaveLength(2)
    for (const part of parts) expect(part, `estate readout was "${text}"`).not.toBe("")

    if (known === "false") {
      // No guess. `lib/aws/identity.ts` calls a confidently-printed default the
      // single most dangerous string this console could show.
      expect(parts).toEqual(["UNKNOWN", "UNKNOWN"])
      expect(await estate.getAttribute("title"), "an unknown estate says why").toContain("unknown")
    } else {
      expect(parts[0]).toMatch(/^\d{12}$/)
      expect(parts[1]).toMatch(/^[a-z]{2}(-[a-z]+)+-\d$/)
    }

    // The same reading, with its whole sentence, inside the account menu.
    await openAccountMenu(page)
    await expect(page.getByRole("menu")).toContainText(text)
  })

  test("global search is visible, says its shortcut, and opens the palette that already exists", async ({
    page,
  }) => {
    await signIn(page)

    const search = searchTrigger(page)
    await expect(search).toBeVisible()
    // The shortcut is on screen. It was Ctrl/Cmd-K and nothing else since
    // GE-022-007, which is a feature only its author uses.
    await expect(search).toContainText(/Ctrl|⌘/)
    await expect(search).toContainText("K")
    await expect(search).toHaveAttribute("aria-keyshortcuts", /Control\+K/)

    await expect(page.getByRole("dialog", { name: "Command search" })).toHaveCount(0)
    await search.click()

    const palette = page.getByRole("dialog", { name: "Command search" })
    // ONE palette. A second implementation is the failure this asserts against:
    // the trigger wires `components/CommandPalette`, it does not fork it.
    await expect(palette).toHaveCount(1)
    await expect(page.getByLabel("Search destinations")).toBeFocused()

    // It is the real one, with the real destinations behind it.
    await page.getByLabel("Search destinations").fill("tenants")
    await expect(palette.getByRole("option").first()).toBeVisible()

    // And closing it returns focus to the trigger rather than to <body>.
    await page.keyboard.press("Escape")
    await expect(palette).toHaveCount(0)
    expect(await focused(page)).toContain("[data-search-trigger]")
  })

  test("the account menu is operable by keyboard alone", async ({ page }) => {
    await signIn(page)
    const trigger = accountTrigger(page)

    await trigger.focus()
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await openAccountMenu(page, "Enter")
    await expect(trigger).toHaveAttribute("aria-expanded", "true")

    const items = enabledItems(page)
    const count = await items.count()
    expect(count, "the account menu has items to arrow through").toBeGreaterThanOrEqual(2)

    // Focus landed on the first ACTIONABLE item — not on the panel, not
    // nowhere, and specifically not on the read-only identity rows. Those rows
    // carry who is signed in and what the estate is; they are `aria-disabled`
    // so a keyboard user does not arrow past two stops that do nothing every
    // time they reach for sign-out.
    await expect(items.first()).toContainText("Operator access")
    await expect(items.first()).toBeFocused()

    // Arrow down through every item, then once more to prove it wraps. The last
    // item is Sign out, and a menu whose last item is the hardest to reach is a
    // menu with no sign-out.
    for (let i = 1; i < count; i += 1) {
      await page.keyboard.press("ArrowDown")
      await expect(items.nth(i)).toBeFocused()
    }
    await page.keyboard.press("ArrowDown")
    await expect(items.first()).toBeFocused()
    await page.keyboard.press("ArrowUp")
    await expect(items.nth(count - 1)).toBeFocused()

    // Escape closes AND hands focus back, which is the half usually missing.
    await page.keyboard.press("Escape")
    await expect(page.getByRole("menu")).toHaveCount(0)
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(trigger).toBeFocused()

    // ArrowUp from the closed trigger opens onto the LAST item: one keystroke
    // from anywhere in the console to the sign-out.
    await page.keyboard.press("ArrowUp")
    await expect(page.getByRole("menu")).toBeVisible()
    await expect(enabledItems(page).last()).toBeFocused()
    await expect(enabledItems(page).last()).toContainText("Sign out")
  })

  test("signing out ends the session on the server", async ({ page, context }) => {
    await signIn(page)

    const before = await context.cookies()
    const sessionCookie = before.find((c) => /session-token/.test(c.name))
    expect(sessionCookie, "a session cookie exists before signing out").toBeTruthy()
    // httpOnly, so nothing running in the page can clear it. Whatever removes it
    // below therefore had to be a response written by the server.
    expect(sessionCookie?.httpOnly, "the session cookie is httpOnly").toBe(true)

    const posts: string[] = []
    page.on("request", (r) => {
      if (r.method() === "POST") posts.push(r.url())
    })

    await openAccountMenu(page)
    const signOut = enabledItems(page).filter({ hasText: "Sign out" })
    await expect(signOut).toHaveCount(1)
    await signOut.click()

    await page.waitForURL(/\/signin/)
    expect(posts.length, "signing out was a POST, not a link").toBeGreaterThanOrEqual(1)

    const after = await context.cookies()
    const stillThere = after.find((c) => /session-token/.test(c.name) && c.value !== "")
    expect(stillThere, "the session cookie survived sign-out").toBeFalsy()

    // The server's own answer, not the browser's: /api/auth/session reads the
    // cookie server-side and reports who it belongs to.
    const session = await page.request.get("/api/auth/session")
    expect(await session.text(), "the server still recognises the signed-out operator").not.toContain(
      OPERATOR,
    )

    // And the console refuses to serve its index to them.
    await page.goto("/")
    await page.waitForURL(/\/signin/)
    await expect(page.getByRole("heading", { name: "Tenure staff" })).toBeVisible()
  })

  test("the signed-out bar shows the mark and nothing about the estate", async ({ page }) => {
    await page.goto("/signin")

    await expect(banner(page).getByRole("link", { name: "Tenure System Studio, home" })).toBeVisible()
    // The AWS account number is an identifier worth having if you are trying to
    // reach that account, and /signin is served to anyone who can resolve the
    // hostname.
    await expect(estateChip(page)).toHaveCount(0)
    await expect(accountTrigger(page)).toHaveCount(0)
    await expect(searchTrigger(page)).toHaveCount(0)
  })
})
