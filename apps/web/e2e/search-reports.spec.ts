import { test, expect } from "@playwright/test"
import { signIn } from "./support/auth"
import { RUN_ID } from "./run-id"

/** Week 7: permission-aware search with citations + OSE reports. */

const stamp = RUN_ID
const cardTitle = `Catering vendor SIMONX${stamp}`

test.describe("search", () => {
  test("finds a memory card via the header search with a citation", async ({ page }) => {
    // Seed a distinctive card
    await signIn(page, "Victor Chen")
    await page.goto("/orgs/simon-consulting-club/memory")
    await page.getByLabel("Type").selectOption("VENDOR")
    await page.getByLabel("Title").fill(cardTitle)
    await page
      .getByPlaceholder("The details your successor will thank you for.")
      .fill(`CampusEats gives us 15% off with code SIMONX${stamp}.`)
    await page.getByRole("button", { name: "Save card" }).click()
    await expect(page.getByText(cardTitle)).toBeVisible()

    // Search from the shell header.
    //
    // `combobox`, not `textbox`: TTES-030-001 gave the palette the ARIA 1.2
    // combobox contract (aria-expanded / aria-controls / aria-activedescendant),
    // and an input carrying an explicit role="combobox" no longer matches the
    // textbox role. e2e/shell.spec.ts asserts the same element by the same role.
    await page.getByRole("combobox", { name: "Search Tenure" }).fill(`SIMONX${stamp}`)
    await page.getByRole("combobox", { name: "Search Tenure" }).press("Enter")
    await page.waitForURL(/\/search\?q=/)
    await expect(page.getByText(cardTitle)).toBeVisible()
    await expect(page.getByText("[1]")).toBeVisible()
    await expect(page.getByText(/Sources \(\d+\)/)).toBeVisible()
  })

  test("search respects role scoping — seat cards stay hidden", async ({ page }) => {
    // Priya writes a President-seat-only card whose TITLE carries the token.
    //
    // The token used to sit only in the card's body. WRK-010-003 then made
    // `memory` REFERENCE_ONLY in the search projection
    // (lib/relay/projection-policy.ts): a card contributes its title, its club
    // and its link to the corpus, and its free text "never enters the corpus,
    // never reaches ranking" — because /search hands its results to
    // `synthesizeAnswer`, which is a model-vendor boundary.
    //
    // That is a deliberate improvement, and it silently hollowed this test out.
    // A body token is now unfindable by ANYONE, so the negative half ("Maya
    // cannot see it") passed while proving nothing about role scoping, and the
    // positive half could never pass again. Titles are still projected, so
    // naming the card with the token is what puts the assertion back: Maya is
    // refused the exact string Isaiah is served, and the only thing separating
    // them is the seat.
    const secret = `SEATSECRET${stamp}`
    await signIn(page, "Priya Raman")
    await page.goto("/orgs/simon-consulting-club/memory")
    await page.getByLabel("Type").selectOption("CREDENTIAL")
    await page.getByLabel("Title").fill(`Bank portal ${secret}`)
    await page.getByLabel("Visible to").selectOption({ label: "President seat only" })
    await page
      .getByPlaceholder("The details your successor will thank you for.")
      .fill("Login hint: in the card body, which the projection withholds.")
    await page.getByRole("button", { name: "Save card" }).click()

    // Maya searches for it — invisible to her
    await signIn(page, "Maya Johnson")
    await page.goto(`/search?q=${secret}`)
    await expect(page.getByText("No results")).toBeVisible()

    /*
     * Isaiah is the SHADOW president — the incoming holder — and he must NOT find
     * this one. That is a reversal of what this test asserted before, and the
     * reversal is the point of HCM-040-003.
     *
     * It used to read "Isaiah (shadow president) finds it — the seat's memory is
     * his", because `canSeeMemoryCard` admitted a role row with status ACTIVE **or
     * SHADOW**. So an incoming officer inherited the seat's CREDENTIAL cards on the
     * day the handoff opened — the bank portal login, in this very fixture. What a
     * successor should get is a credential REISSUED to them, not the outgoing
     * holder's copy of it, and the difference is the whole requirement.
     *
     * The card is still the seat's, and it is still searchable — by the person who
     * holds the seat now and by the person who wrote it. What changed is that
     * "will hold this seat" stopped meaning "may read its secrets already".
     */
    await signIn(page, "Isaiah Brooks")
    await page.goto(`/search?q=${secret}`)
    await expect(page.getByText("No results")).toBeVisible()

    // And Priya, who wrote it, still finds it. Withholding a card from its own
    // author protects nobody — she typed the secret — and without this the
    // tightening above would silently delete her work from her own search.
    await signIn(page, "Priya Raman")
    await page.goto(`/search?q=${secret}`)
    await expect(page.getByText(`Bank portal ${secret}`)).toBeVisible()
  })

  test("searching for approvals and events works", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/search?q=E2E")
    await expect(page.getByText(/Sources \(\d+\)/)).toBeVisible()
  })
})

test.describe("reports", () => {
  test("OSE director sees institution metrics", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/reports")
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible()
    await expect(page.getByText("Active clubs")).toBeVisible()
    await expect(page.getByText("Filled seats")).toBeVisible()
    await expect(page.getByText("Approval pipeline")).toBeVisible()
    await expect(page.getByText("Institutional memory")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Denied actions" })).toBeVisible()
  })

  test("reports are hidden from club members", async ({ page }) => {
    await signIn(page, "Maya Johnson")
    // No nav link…
    await expect(page.getByRole("link", { name: "Reports" })).not.toBeVisible()
    // …and direct access 404s
    await page.goto("/reports")
    await expect(
      page.getByRole("heading", { name: /find that page/ })
    ).toBeVisible()
  })
})
