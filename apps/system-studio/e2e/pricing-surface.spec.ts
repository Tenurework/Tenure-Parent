import { test, expect, type Page } from "@playwright/test"
import { operatorFor } from "./operator-identity"

/**
 * NEXT-SESSION §7 — the running total, on the actual page.
 *
 * `pricing-logic.spec.ts` proves the resolver emits the money. This proves the
 * Studio renders it, in a browser, on the surface an operator uses to choose
 * options. Those are different claims and the gap between them is where this
 * repository has been burned before: GE-031-006, GE-032-001 and GE-032-003 were
 * all recorded PASS over pure functions while the publish path was dead in the
 * real UI, because nothing had ever driven the page.
 *
 * Skipped without a registry, and skipped loudly. A pricing spec that quietly
 * passes when there is no tenant to price is worse than none.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""
const configured = !!process.env.TENANT_TABLE

/** The tenant seeded into the registry. */
const SLUG = "rochester"

/**
 * Sign in, and wait for the redirect to LAND.
 *
 * `waitForLoadState("networkidle")` is not enough: the sign-in POST answers 303
 * and the browser is still following it, so the next `goto` is aborted mid
 * navigation with `ERR_ABORTED` and the assertion runs against the home page.
 * Waiting on the URL leaving `/signin` waits for the thing that actually has to
 * finish.
 */
async function signIn(page: Page) {
  await page.goto("/signin", { waitUntil: "domcontentloaded" })
  // The session survives inside a worker, so a second test arrives already
  // signed in and is redirected straight off the sign-in page.
  if (!new URL(page.url()).pathname.startsWith("/signin")) return
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 150_000 })
}

/** Generous, because a cold Next route compiles on first request. */
const VISIBLE = { timeout: 60_000 }

test.describe("the configuration surface shows what it costs", () => {
  test.skip(!configured, "TENANT_TABLE is not set — no registry to read a tenant from.")
  test.skip(!OPERATOR || !SECRET, "PLATFORM_OPERATORS / PLATFORM_OPERATOR_SECRET are not set.")

  test("renders a running total, per seat and for the organisation", async ({ page }) => {
    await signIn(page)
    await page.goto(`/tenants/${SLUG}/configuration?seats=250`, { waitUntil: "domcontentloaded" })

    const section = page.locator("section.system").filter({ hasText: "What this costs" })
    await expect(section).toBeVisible(VISIBLE)

    // The assistant ships on and costs $4.00 a seat, so an untouched tenant is
    // quoted 250 x $4.00 = $1,000.00. The number is the resolver's; if the page
    // stops asking for it, or asks with the wrong seat count, this reds.
    await expect(section.getByText("4.00 USD per seat")).toBeVisible(VISIBLE)
    await expect(section.getByText("1000.00 USD running total, per month")).toBeVisible(VISIBLE)
    // `toContainText` on the section, not `getByText` on the sentence: React
    // renders the seat count as its own <b>, so the sentence is three text
    // nodes and no single element holds it whole.
    await expect(section).toContainText("for exactly 250 seat", VISIBLE)
    await expect(section.locator("#seats")).toHaveValue("250", VISIBLE)

    // And the line it is made of, named, so the total can be read rather than
    // taken on trust.
    await expect(section.getByRole("cell", { name: "platform.flags.aiAssistant.enabled" })).toBeVisible(VISIBLE)
  })

  test("re-quotes when the operator states a different seat count", async ({ page }) => {
    await signIn(page)
    await page.goto(`/tenants/${SLUG}/configuration?seats=10`, { waitUntil: "domcontentloaded" })

    const section = page.locator("section.system").filter({ hasText: "What this costs" })
    await expect(section.getByText("40.00 USD running total, per month")).toBeVisible(VISIBLE)
  })

  test("puts a price beside every option in the editor", async ({ page }) => {
    await signIn(page)
    await page.goto(`/tenants/${SLUG}/configuration`, { waitUntil: "domcontentloaded" })

    // §7: at every stage of setup, not on a summary somebody has to find. The
    // wordmark is the white-label charge; the locale is included and says why.
    await expect(page.locator('[data-price="platform.branding.wordmark"]')).toContainText(
      "99.00 USD for the organisation",
      VISIBLE,
    )
    await expect(page.locator('[data-price="platform.localization.locale"]')).toContainText(
      "included —",
      VISIBLE,
    )

    // Every editable field carries one. A blank price is the defect §7 names.
    const prices = page.locator("[data-price]")
    const count = await prices.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      await expect(prices.nth(i)).not.toBeEmpty()
    }
  })
})
