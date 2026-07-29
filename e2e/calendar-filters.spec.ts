import { test, expect, type Page } from "@playwright/test"

/** Per-viewer calendar filters: by club, and by your own events; sticky across views. */

async function signIn(page: Page, userName: string) {
  await page.context().clearCookies()
  await page.goto("/signin")
  await page.getByRole("button", { name: new RegExp(userName) }).click()
  await page.waitForURL(/\/dashboard/)
}

test("a member can filter the calendar by club and own events, sticky across weeks", async ({
  page,
}) => {
  await signIn(page, "Victor Chen") // VP Finance, consulting club
  await page.goto("/calendar")

  const clubSelect = page.getByLabel("Filter calendar by club")
  await expect(clubSelect).toBeVisible()

  // Toggle "My events" → the filter lands in the URL…
  await page.getByRole("button", { name: "My events" }).click()
  await expect(page).toHaveURL(/mine=1/)

  // …and survives week navigation, which is the only navigation the calendar
  // has now that Month/Day/Agenda are gone.
  await page.getByRole("link", { name: "Next week" }).click()
  await expect(page).toHaveURL(/d=\d{4}-\d{2}-\d{2}/)
  await expect(page).toHaveURL(/mine=1/)

  // Filter to a club too.
  await clubSelect.selectOption({ label: "Simon Consulting Club" })
  await expect(page).toHaveURL(/club=/)

  // Both filters ride the mini-month links as well, so jumping to a date does
  // not silently reset the view to "everything".
  await page.getByRole("link", { name: "This week" }).click()
  await expect(page).toHaveURL(/mine=1/)
  await expect(page).toHaveURL(/club=/)
})
