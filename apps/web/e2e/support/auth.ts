import { expect, type Page } from "@playwright/test"

/**
 * Sign in as a seeded pilot account.
 *
 * This was 27 identical copies, one per spec file. It is shared now because
 * sign-in gained a step: passwordless dev login sits behind an interim shared
 * passphrase (src/lib/dev-login.ts), so every spec needs to supply it and one
 * definition is the only way that stays true.
 *
 * The passphrase is read from the environment rather than hardcoded so the
 * suite exercises whatever the server was actually started with — including
 * the un-gated case, where the field is not rendered at all.
 */
export async function signIn(page: Page, userName: string) {
  await page.context().clearCookies()
  await page.goto("/signin")

  const passphrase = process.env.DEV_LOGIN_PASSPHRASE
  if (passphrase) {
    // Fail loudly here rather than as a confusing "button not found" later: if
    // the field is absent, the server has no passphrase configured and the
    // suite is testing a weaker configuration than it thinks it is.
    const field = page.getByLabel("Access passphrase")
    await expect(
      field,
      "DEV_LOGIN_PASSPHRASE is set for the test run but the sign-in page is not asking for one — the server under test has no passphrase configured",
    ).toBeVisible()
    await field.fill(passphrase)
  }

  await page.getByRole("button", { name: new RegExp(userName) }).click()
  await page.waitForURL(/\/dashboard/)
}
