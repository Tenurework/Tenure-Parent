import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"

/**
 * Community Feed: clubs post collaboration calls, others comment and
 * request to collaborate, the OSE Director approves in the middle.
 */

const stamp = Date.now()
const postTitle = `Co-host wanted ${stamp}`

test.describe("community feed", () => {
  test("a member posts a collaboration call to the feed", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    await page.goto("/feed")
    await page.getByLabel("Title").fill(postTitle)
    await page
      .getByPlaceholder(/What are you planning/)
      .fill("Planning a spring networking night — looking for a co-host club to split catering.")
    await page.getByRole("button", { name: "Post to feed" }).click()
    await expect(page.getByText(postTitle)).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Simon Consulting Club" }).first()
    ).toBeVisible()
  })

  test("another member comments on the post", async ({ page }) => {
    await signIn(page, "Victor Chen")
    await page.goto("/feed")
    const comment = `Count me in for logistics ${stamp}`
    const post = page.locator("div").filter({ hasText: postTitle }).last()
    await page.getByPlaceholder("Write a comment…").first().fill(comment)
    await page.getByRole("button", { name: "Post comment" }).first().click()
    await expect(page.getByText(comment)).toBeVisible()
    void post
  })

  test("cross-club interest becomes a Director task and approval seals it", async ({ page }) => {
    // Priya requests collaboration on behalf of Simon Women in Business
    await signIn(page, "Priya Raman")
    await page.goto("/feed")
    const collabAs = page.getByLabel("Collaborate as").first()
    // selectOption matches labels exactly, and official names carry an
    // acronym ("... (SWiB)") — resolve the value instead of hardcoding it.
    const swibValue = await collabAs
      .locator("option")
      .filter({ hasText: "Simon Women in Business" })
      .first()
      .getAttribute("value")
    await collabAs.selectOption(swibValue!)
    await page.getByPlaceholder("Add a note (optional)").first().fill("We'll bring 30 members.")
    await page.getByRole("button", { name: "Request to collaborate" }).first().click()
    await expect(page.getByText("1 pending OSE").first()).toBeVisible()

    // Dana (OSE Director) has the task in notifications and on the feed rail
    await signIn(page, "Dana Whitfield")
    await page.goto("/notifications")
    await expect(
      page.getByText(/Simon Women in Business.*wants to collaborate with/).first()
    ).toBeVisible()
    await page.goto("/feed")
    await expect(page.getByText("Your approvals")).toBeVisible()
    await expect(
      // Official names carry a parenthetical acronym, e.g. "... (SWiB)"
      page.getByText(/Simon Women in Business.*↔.*Simon Consulting Club/).first()
    ).toBeVisible()
    await page.getByRole("button", { name: "Approve", exact: true }).first().click()
    await expect(
      page.getByText("Collaborating with Simon Women in Business").first()
    ).toBeVisible()

    // The requester hears back
    await signIn(page, "Priya Raman")
    await page.goto("/notifications")
    await expect(
      page.getByText(/Simon Women in Business.*are approved to collaborate/).first()
    ).toBeVisible()
  })

  test("members without an eligible club see no collaborate control on their own club's post", async ({ page }) => {
    // Maya's only club hosts the post — she can't request on it
    await signIn(page, "Maya Johnson")
    await page.goto("/feed")
    await expect(page.getByRole("button", { name: "Request to collaborate" })).not.toBeVisible()
  })
})
