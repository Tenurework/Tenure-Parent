import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/**
 * The interim gate in front of passwordless pilot sign-in.
 *
 * Every other spec proves the gate lets the right passphrase through, because
 * they all sign in. This one proves it keeps the wrong one out — which is the
 * half that actually matters, and the half a passing suite would not notice if
 * the check were silently removed.
 */

const PASSPHRASE = process.env.DEV_LOGIN_PASSPHRASE

test.describe("interim sign-in gate", () => {
  test.skip(!PASSPHRASE, "No DEV_LOGIN_PASSPHRASE configured for this run — the gate is inactive.")

  test("asks for a passphrase before showing anything", async ({ page }) => {
    await page.context().clearCookies()
    await page.goto("/signin")

    await expect(page.getByLabel("Access passphrase")).toBeVisible()
  })

  test("a wrong passphrase does not sign anyone in", async ({ page }) => {
    await page.context().clearCookies()
    await page.goto("/signin")

    await page.getByLabel("Access passphrase").fill("not-the-passphrase")
    await page.getByRole("button", { name: /Dana Whitfield/ }).click()

    // Must not reach the app.
    await expect(page).not.toHaveURL(/\/dashboard/)

    // And the session must not exist — navigating directly still bounces.
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/signin/)
  })

  test("an empty passphrase does not sign anyone in", async ({ page }) => {
    await page.context().clearCookies()
    await page.goto("/signin")

    // The field is `required`, so the browser blocks submission client-side.
    // Defeat that to prove the server refuses too — hiding a control in the UI
    // is not the same as enforcing it.
    await page.getByLabel("Access passphrase").evaluate((el: HTMLInputElement) => {
      el.removeAttribute("required")
    })
    await page.getByRole("button", { name: /Dana Whitfield/ }).click()

    await expect(page).not.toHaveURL(/\/dashboard/)
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/signin/)
  })

  test("the correct passphrase still admits the OSE Director", async ({ page }) => {
    await signIn(page, "Dana Whitfield")

    await expect(page).toHaveURL(/\/dashboard/)
  })
})
