import { test, expect, type Page } from "@playwright/test"
import { operatorFor } from "./operator-identity"

/**
 * STUDIO-070-004 — `/platform/network`, in a browser, with no AWS account.
 *
 * `src/app/platform/network/answer.test.ts` drives every decision this page
 * makes, over fixtures a browser cannot produce: a refused
 * `DescribeSecurityGroups`, a rule spanning 3000–4000, a target reporting
 * `Target.ResponseCodeMismatch`, a subnet named `…-private-a` that routes to an
 * internet gateway. Neither of those things can see what this file is for:
 *
 *   **that the route renders at all when STS, EC2 and ELBv2 are unreachable,
 *   and that what it renders in that case is a named unknown rather than an
 *   empty list, a zero, or a reassuring default.**
 *
 * That is not hypothetical here. This suite runs against a Studio whose
 * credentials are DynamoDB-Local shaped and cannot reach any AWS endpoint, so
 * every read on this page lands in a valueless arm of `AwsRead` — which is
 * precisely the state in which a naive network page reports "0 paths from the
 * internet" and an operator believes it. A page that 500s for want of
 * credentials fails these too: the heading assertion is the one that catches it.
 *
 * The route requires an operator session and nothing else — no DynamoDB row, no
 * seeded tenant, no VPC — so it has no data precondition to skip on.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""
const configured = OPERATOR !== "" && SECRET !== ""

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForLoadState("networkidle")
}

async function openNetwork(page: Page) {
  await signIn(page)
  await page.goto("/platform/network")
  await page.waitForLoadState("networkidle")
}

test.describe("the network surface", () => {
  test.skip(!configured, "needs PLATFORM_OPERATORS and PLATFORM_OPERATOR_SECRET")

  test("it boots without AWS, and leads with the question in words", async ({ page }) => {
    await openNetwork(page)

    await expect(page.getByRole("heading", { name: "Network", level: 1 })).toBeVisible()
    // The question, before any apparatus. If the console had 500'd on an
    // unreachable STS, neither of these would be here at all.
    await expect(
      page.getByText(
        "What can reach this estate from the internet, and is traffic actually getting to the services?",
      ),
    ).toBeVisible()
  })

  test("an unreachable read renders as a named unknown, never as an empty list", async ({
    page,
  }) => {
    await openNetwork(page)

    // `components/md3/UnknownState` — a `role="status"` carrying the capability,
    // the action, the principal and a pasteable minimum IAM statement. The
    // credentials in this environment cannot reach AWS, so at least one read
    // must land here.
    const unknown = page.locator(".md3-unknown")
    await expect(unknown.first()).toBeVisible()
    await expect(unknown.first()).toContainText("Unknown")

    // And the state is named rather than generic: every arm has its own word,
    // because every arm has a different remedy.
    const reason = await unknown.first().getAttribute("data-reason")
    expect(["DENIED", "THROTTLED", "UNCONFIGURED", "ERROR"]).toContain(reason)
  })

  test("a refused security-group read is never rendered as zero paths from the internet", async ({
    page,
  }) => {
    await openNetwork(page)

    // The single most dangerous sentence this surface could print. With no
    // reachable AWS, the exposure count must be absent and said to be absent —
    // not drawn as a count of nothing.
    const body = await page.locator("body").innerText()
    expect(body).toContain("No count is shown")
    expect(body).toContain(
      "this console knows of no path from the internet and of no absence of one",
    )
    expect(body).not.toContain("Nothing beyond HTTP and HTTPS is reachable from the internet")
  })

  test("the open-to-the-internet card is above everything else on the page", async ({ page }) => {
    await openNetwork(page)

    const open = page.getByRole("heading", { name: "Open to the internet" })
    const layout = page.getByRole("heading", { name: "VPC and subnet layout" })
    await expect(open).toBeVisible()
    await expect(layout).toBeVisible()

    // Rendered order, measured rather than assumed. The whole argument of this
    // page is that a rule accepting the whole internet is the finding the estate
    // cannot currently see, and putting it below the inventory is how that
    // argument is quietly lost.
    const openBox = await open.boundingBox()
    const layoutBox = await layout.boundingBox()
    expect(openBox).not.toBeNull()
    expect(layoutBox).not.toBeNull()
    expect(layoutBox!.y).toBeGreaterThan(openBox!.y)
  })

  test("no table is drawn from a read that did not answer", async ({ page }) => {
    await openNetwork(page)

    // The paths table is the one that must not exist here: an empty table under
    // a heading saying what can reach this estate reads as "nothing can".
    const paths = page.locator("table", {
      has: page.locator("caption", { hasText: "Paths from the internet, ranked" }),
    })
    await expect(paths).toHaveCount(0)

    // And the sentence that replaces it names the remedy rather than a number.
    await expect(page.getByText("No table is drawn.").first()).toBeVisible()
  })

  test("it says what it does not read, rather than being silent about it", async ({ page }) => {
    await openNetwork(page)

    // The disclosure is closed by default and `globals.css` hides a closed
    // `<details>`'s contents outright, so this opens it rather than reading text
    // the browser is not painting.
    await page.getByText("What this page does not read").click()

    const disclosure = page.locator("details", {
      has: page.getByText("What this page does not read"),
    })
    // The call an operator would otherwise assume this page answers.
    await expect(disclosure).toContainText("ec2:DescribeNetworkInterfaces")
    // And two more that are genuinely absent from the capability registry.
    await expect(disclosure).toContainText("ec2:GetManagedPrefixListEntries")
    await expect(disclosure).toContainText("Classic load balancers")
  })

  test("every panel says what it is as of", async ({ page }) => {
    await openNetwork(page)

    // `statedAsOf` puts a time on every card, and names its absence when there
    // is none. Either is acceptable; a card with neither is not.
    const body = await page.locator("body").innerText()
    expect(body).toMatch(/As of \d{4}-\d{2}-\d{2}T|As of an unknown time/)
  })

  test("it names no drift candidate while the load balancers are unread", async ({ page }) => {
    await openNetwork(page)

    const card = page.locator(".md3-card", {
      has: page.getByRole("heading", { name: "Security groups nothing this engine read carries" }),
    })
    await expect(card).toBeVisible()

    // The defect this bars: a security group an internet-facing load balancer is
    // carrying, appearing on a list an operator might act on by deleting it.
    // With ELBv2 unreachable, the page must refuse to name a single candidate.
    await expect(card).toContainText("No list is drawn")
    await expect(card).toContainText("while the load balancers are unread")
    await expect(card.locator("table")).toHaveCount(0)
  })
})
