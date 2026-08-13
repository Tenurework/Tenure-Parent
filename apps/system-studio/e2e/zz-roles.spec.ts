import { test, expect, type Page } from "@playwright/test"
import { operatorFor } from "./operator-identity"

/** Same assertions as operator-roles.spec.ts:56, with a sign-in that waits for
 *  the navigation instead of for network idle. Scratch file, not committed. */
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""
const AUDITOR = operatorFor("auditor-read-only")
const ENGINEER = operatorFor("cloud-platform-engineer")

async function signInAs(page: Page, email: string) {
  await page.context().clearCookies()
  await page.goto("/signin")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Operator secret").fill(SECRET)
  await Promise.all([
    page.waitForURL((u) => new URL(u).pathname !== "/signin", { timeout: 20000 }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ])
}

test("the fleet's mutating controls: engineer has them, auditor does not", async ({ page }) => {
  await signInAs(page, ENGINEER)
  await page.goto("/tenants")
  await expect(page.getByRole("heading", { name: "Tenants" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Compose a tenant" })).toHaveCount(1)

  await signInAs(page, AUDITOR)
  await page.goto("/tenants")
  await expect(page.getByRole("heading", { name: "Tenants" })).toBeVisible()
  await expect(page.getByText("You do not have access to this")).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Compose a tenant" })).toHaveCount(0)
  const markup = await page.content()
  expect(markup).not.toContain('href="/tenants/new"')
  await expect(page.locator("#adopt-slug")).toHaveCount(0)
})
