import { test, expect } from "@playwright/test"

const OPERATOR = process.env.PLATFORM_OPERATORS?.split(",")[0]?.trim() ?? ""
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

/** Same sign-in the rest of the suite uses. Duplicated rather than extracted
 *  because platform.spec.ts owns it and moving it is a change to a passing
 *  spec that this one does not need to make. */
async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("heading", { name: "Organization systems" })).toBeVisible()
}

/**
 * Adopting Simon OSE through the console.
 *
 * The pilot has been serving real students since before this control plane
 * existed. It is bound in `blueprints/` and the console has always listed it
 * under "Configured by file" — visible, and outside the registry, so every
 * fleet view that reads the registry did not see the one tenant that matters.
 *
 * This drives the real form against a real DynamoDB and then reads the record
 * back, because the thing worth proving is not that a button exists.
 *
 * Skipped when the registry is not configured: without a table there is nothing
 * to adopt into, and a test that quietly passes in that case would be asserting
 * that the form does not render.
 */
const registryConfigured = !!process.env.TENANT_TABLE

test.describe("adopting a tenant that predates the registry", () => {
  test.skip(!registryConfigured, "needs TENANT_TABLE and a reachable DynamoDB")

  test("Simon OSE goes from file-bound to registered, and says it was adopted", async ({ page }) => {
    await signIn(page)
    await page.goto("/tenants")

    // It starts outside the registry. If this ever reads "in the registry"
    // before the form runs, the test after it is proving nothing.
    const row = page.locator("tr", { hasText: "rochester" })
    await expect(row).toContainText("not adopted")

    await page.selectOption("#adopt-slug", "rochester")
    await page.fill("#adopt-contact", "ose@example.invalid")
    await page.fill("#adopt-residency", "us-east-1")
    await page.check("#adopt-institution")
    await page.getByRole("button", { name: /Adopt into the registry/ }).click()

    // Lands on the tenant's own page — it is a tenant now, not a table row.
    await page.waitForURL(/\/tenants\/rochester/)
    await expect(page.getByRole("heading", { name: /Ainslie OSE/ })).toBeVisible()

    // And the console says how it got here. This is the assertion that matters:
    // an adopted tenant must never present as one that was provisioned.
    await expect(page.getByText(/adopted/i).first()).toBeVisible()
  })

  test("refuses without the operator's confirmation", async ({ page }) => {
    // The engine does not read tenant databases, so "the institution exists" is
    // an assertion a person makes. Adoption without it would write a registry
    // record claiming a cell holds a tenant it may not hold.
    await signIn(page)
    await page.goto("/tenants")

    const adoptable = await page.locator("#adopt-slug option").count()
    test.skip(adoptable === 0, "every binding is already adopted")

    await page.fill("#adopt-contact", "ose@example.invalid")
    await page.fill("#adopt-residency", "us-east-1")
    // Deliberately not checking the box.
    await page.getByRole("button", { name: /Adopt into the registry/ }).click()

    await expect(page.locator(".adopt .problems")).toContainText("institution-exists")
  })

  test("refuses a residency the placement would violate", async ({ page }) => {
    await signIn(page)
    await page.goto("/tenants")

    const adoptable = await page.locator("#adopt-slug option").count()
    test.skip(adoptable === 0, "every binding is already adopted")

    await page.fill("#adopt-contact", "ose@example.invalid")
    // The cell is in us-east-1; claiming the tenant may only live in eu-west-1
    // means the record would place it somewhere it is not permitted.
    await page.fill("#adopt-residency", "eu-west-1")
    await page.check("#adopt-institution")
    await page.getByRole("button", { name: /Adopt into the registry/ }).click()

    await expect(page.locator(".adopt .problems")).toContainText(/residency|placement/)
  })
})
