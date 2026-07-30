import { test, expect, type Page } from "@playwright/test"
import { signIn } from "./support/auth"

/**
 * OSE Director transfer pipeline — the atomic, two-party handoff.
 *
 * State-neutral by construction: it hands the Director role from Dana to Sam and
 * then hands it straight back, so the seeded roster (Dana = Director, Sam = Staff)
 * is restored for every other spec regardless of run order. Exercises the full
 * pipeline in both directions: initiate → notify → accept (with confirm) → atomic
 * role swap, with the outgoing Director keeping power until the successor accepts.
 */

/** Only the current Director sees the "Transfer Director role" initiate control. */
const initiateControl = (page: Page) =>
  page.getByRole("button", { name: "Transfer Director role" })

async function handOff(page: Page, fromName: string, toName: string, toEmail: string) {
  // The outgoing Director initiates the transfer; keeps power until acceptance.
  await signIn(page, fromName)
  await page.goto("/admin/people")
  await expect(initiateControl(page)).toBeVisible()
  await initiateControl(page).click()
  await page.getByLabel("Successor email").fill(toEmail)
  await page.getByRole("button", { name: "Send transfer invite" }).click()
  // Outgoing pending handoff is now shown to the initiator.
  await expect(page.getByText(/Waiting for them to accept/)).toBeVisible()

  // The successor accepts — a deliberate confirm, then the atomic swap.
  await signIn(page, toName)
  await page.goto("/admin/people")
  await page.getByRole("button", { name: "Accept", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Accept and take over" }).click()

  // The successor now holds the Director role (the initiate control is theirs)…
  await expect(initiateControl(page)).toBeVisible()
  // …and the initiator has stepped down (no longer a Director).
  await signIn(page, fromName)
  await page.goto("/admin/people")
  await expect(initiateControl(page)).toHaveCount(0)
}

test.describe("OSE Director transfer pipeline", () => {
  test("hands the Director role over atomically, then back", async ({ page }) => {
    // Dana (Director) → Sam (Staff): after this, Sam is Director, Dana is Staff.
    await handOff(page, "Dana Whitfield", "Sam Ortiz", "staff@tenure.demo")

    // Reverse it so the seed is restored: Sam (now Director) → Dana.
    await handOff(page, "Sam Ortiz", "Dana Whitfield", "director@tenure.demo")

    // Final state matches the seed: Dana is Director again, Sam is not.
    await signIn(page, "Dana Whitfield")
    await page.goto("/admin/people")
    await expect(initiateControl(page)).toBeVisible()
  })
})
