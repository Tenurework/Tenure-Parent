import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/**
 * The System Studio is internal. A customer administrator — even the highest
 * role the product has — must not be able to reach the console that configures
 * other customers.
 *
 * The suite runs with PLATFORM_OPERATORS set to director@tenure.demo (see
 * playwright.config.ts), so Dana Whitfield is Tenure staff *for the test run
 * only*, and everyone else is a customer. That split is the thing under test:
 * it is not enough that the page renders, it has to be unreachable for the
 * account that holds every capability the product otherwise grants.
 */

test.describe("Tenure System Studio", () => {
  test("a platform operator sees every configured organization system", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/studio")

    await expect(page.getByRole("heading", { name: "System Studio" })).toBeVisible()

    // Both reference systems, from one codebase.
    await expect(page.getByText("Simon Business School — Ainslie OSE")).toBeVisible()
    await expect(page.getByText("Midtown Arts Collective")).toBeVisible()
  })

  test("it shows what each system is made of, and why a module is missing", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/studio")

    // Simon runs reimbursements; Midtown is refused budgeting on entitlement,
    // and the console says so rather than leaving it silently absent.
    await expect(page.getByText("reimbursements", { exact: false }).first()).toBeVisible()
    await expect(
      page.getByText(/Requires entitlement "finance", which this tenant does not hold/),
    ).toBeVisible()

    // A resolved configuration value, with the layer that supplied it.
    await expect(page.getByText("Ainslie OSE", { exact: false }).first()).toBeVisible()
    await expect(page.getByText(/blueprint → tenant/).first()).toBeVisible()

    // The release candidate is checksummed.
    await expect(page.getByText(/^sha256:[0-9a-f]{64}$/).first()).toBeVisible()
  })

  test("an OSE Director who is not Tenure staff cannot reach it", async ({ page }) => {
    // Priya holds the top *customer* role. The Studio configures other
    // customers, so this must 404 — not 403, which would confirm it exists.
    await signIn(page, "Priya Raman")
    await page.goto("/studio")

    await expect(page.getByRole("heading", { name: "System Studio" })).toHaveCount(0)
    await expect(page.getByText("Midtown Arts Collective")).toHaveCount(0)
  })

  test("a club member cannot reach it either", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    await page.goto("/studio")
    await expect(page.getByRole("heading", { name: "System Studio" })).toHaveCount(0)
  })

  test("an operator can export a tenant's data, and it contains only that tenant", async ({ page }) => {
    await signIn(page, "Dana Whitfield")

    const res = await page.request.get("/api/platform/export/rochester")
    expect(res.status()).toBe(200)
    expect(res.headers()["content-disposition"]).toContain("tenure-export-rochester-")
    // One tenant's data must never sit in a shared cache keyed on the URL.
    expect(res.headers()["cache-control"]).toContain("no-store")

    const dump = await res.json()
    expect(dump.tenantSlug).toBe("rochester")
    expect(dump.checksum).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(dump.counts.Organization).toBeGreaterThan(0)

    // Every exported organization belongs to the tenant that was asked for.
    for (const org of dump.data.Organization) {
      expect(org.institutionId).toBe(dump.tenantId)
    }

    // And what could not be exported is stated rather than omitted.
    expect(dump.gaps.length).toBeGreaterThan(0)
    expect(dump.gaps[0]).toHaveProperty("reachableVia")
  })

  test("a customer administrator cannot download an export", async ({ page }) => {
    // The most sensitive endpoint in the product: a leak here lands in a file
    // that is about to be handed to someone outside the tenant.
    await signIn(page, "Priya Raman")
    const res = await page.request.get("/api/platform/export/rochester")
    expect(res.status()).toBe(404)
  })

  test("an unknown tenant is a 404, not an empty export", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    const res = await page.request.get("/api/platform/export/no-such-tenant")
    expect(res.status()).toBe(404)
  })
})
