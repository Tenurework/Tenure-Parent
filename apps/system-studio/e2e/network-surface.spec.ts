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
  /*
    Wait for the redirect the sign-in action performs, not for `networkidle`.

    The shell renders a `<Link>` for every console surface and Next prefetches
    them, so this app is essentially never idle: a `networkidle` wait here
    resolves at an arbitrary moment and, measured, frequently resolved while the
    browser was still on `/signin`. Every assertion in every test then ran
    against the sign-in screen and reported the page's content as missing — a
    whole-suite red with nothing wrong on the page. Waiting on the URL leaving
    `/signin` is the event that actually means "the session cookie is applied".
  */
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 60_000 })
}

async function openNetwork(page: Page) {
  await signIn(page)
  await page.goto("/platform/network")
  // Same reasoning: `load` is a real event this page reaches, `networkidle` is
  // not one a prefetching shell ever reliably reaches.
  await page.waitForLoadState("load")
  await expect(page.getByRole("heading", { name: "Network", level: 1 })).toBeVisible()
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

  /* ── the edge: CloudFront, Route 53, ACM and WAF ────────────────────────
   *
   * STUDIO-080-002. Four readers that until now reached no screen at all —
   * `lib/aws/cdn.ts`, `lib/aws/dns.ts`, `lib/aws/certificates.ts` and
   * `lib/aws/waf.ts` — are rendered on this route as ONE chain, because a
   * broken edge is a chain: a record aliases a distribution, that distribution
   * presents a certificate, and something either does or does not sit in front
   * of it. `src/app/platform/network/edge.test.ts` drives every arm of that
   * join over fixtures a browser cannot produce. These are the assertions only
   * a browser can make: that the chain is on the page, that it is joined rather
   * than stacked, and that with AWS unreachable every leg says so instead of
   * rendering a reassuring default.
   */

  test("the edge chain is on the page, joined rather than stacked", async ({ page }) => {
    await openNetwork(page)

    await expect(
      page.getByRole("heading", { name: "The edge chain, hostname to origin" }),
    ).toBeVisible()

    // The five legs, in the order a request travels them. A page that rendered
    // four separate tables would have none of these headers in one table.
    const chain = page.locator(".md3-card", {
      has: page.getByRole("heading", { name: "The edge chain, hostname to origin" }),
    })
    for (const leg of [
      "1. DNS",
      "2. Distribution",
      "3. Certificate",
      "4. Web ACL",
      "5. Origin",
    ]) {
      await expect(chain).toContainText(leg)
    }
  })

  test("the takeover card is above the chain, and above the inventory below it", async ({
    page,
  }) => {
    await openNetwork(page)

    const takeover = page.getByRole("heading", {
      name: "Records pointing at names this account does not own",
    })
    const chain = page.getByRole("heading", { name: "The edge chain, hostname to origin" })
    const zones = page.getByRole("heading", { name: "Hosted zones" })

    // Rendered order, measured. A record aliasing a name somebody else can
    // register outranks everything on this page, and putting it under the
    // inventory is how that argument is quietly lost.
    // Wait, then measure. `boundingBox()` samples once and returns null for
    // anything not yet painted, unlike `toBeVisible()` which retries.
    // `breadcrumbs.spec.ts` failed in CI on exactly this pattern while a full
    // local suite had passed minutes before.
    await expect(takeover).toBeVisible()
    await expect(chain).toBeVisible()
    await expect(zones).toBeVisible()

    const takeoverBox = await takeover.boundingBox()
    const chainBox = await chain.boundingBox()
    const zonesBox = await zones.boundingBox()
    expect(takeoverBox).not.toBeNull()
    expect(chainBox).not.toBeNull()
    expect(zonesBox).not.toBeNull()
    expect(chainBox!.y).toBeGreaterThan(takeoverBox!.y)
    expect(zonesBox!.y).toBeGreaterThan(chainBox!.y)
  })

  test("an unreachable CloudFront read is never rendered as an intact edge", async ({ page }) => {
    await openNetwork(page)

    const chain = page.locator(".md3-card", {
      has: page.getByRole("heading", { name: "The edge chain, hostname to origin" }),
    })

    // The sentence the `intact` arm prints. With no reachable AWS it must be
    // absent — an edge nobody could read is not an edge that holds.
    await expect(chain).not.toContainText("Edge intact")
    await expect(chain).not.toContainText("not one of them carries a break")

    // And the replacement names the absence rather than showing a clean table.
    await expect(chain).toContainText("no absence of one")

    // Each of the four reads gets its own named unknown, carrying the action
    // and a pasteable minimum statement.
    await expect(
      chain.locator(".md3-unknown", { hasText: "the CloudFront distributions" }),
    ).toBeVisible()
    await expect(
      chain.locator(".md3-unknown", { hasText: "the Route 53 hosted zones" }),
    ).toBeVisible()
    await expect(chain.locator(".md3-unknown", { hasText: "the ACM certificates" })).toBeVisible()
  })

  test("a WAF read that could not be taken never renders as an empty table", async ({ page }) => {
    await openNetwork(page)

    const card = page.locator(".md3-card", {
      has: page.getByRole("heading", { name: "What sits in front of this estate" }),
    })
    await expect(card).toBeVisible()

    // A successful-empty and an AccessDenied mean opposite things. With AWS
    // unreachable this must be the second: no table, no "no web ACL exists"
    // finding — that sentence is reserved for BOTH scopes answering — and an
    // Unknown panel in its place.
    await expect(card.locator("table")).toHaveCount(0)
    await expect(card).not.toContainText("Both scopes answered")
    await expect(card.locator(".md3-unknown").first()).toBeVisible()
  })

  test("a certificate table is not drawn from a listing that did not answer", async ({ page }) => {
    await openNetwork(page)

    const card = page.locator(".md3-card", {
      has: page.getByRole("heading", { name: "Certificates, soonest to expire first" }),
    })
    await expect(card).toBeVisible()

    // No row, and no zero. "0 days remaining" over a refused read is the single
    // most dangerous number this card could print.
    await expect(card).toContainText("No certificate table")
    await expect(card).toContainText("of no absence of one")
  })

  test("it says the four things about the edge it does not read", async ({ page }) => {
    await openNetwork(page)

    await page.getByText("What this page does not read").click()
    const disclosure = page.locator("details", {
      has: page.getByText("What this page does not read"),
    })

    // Each of these is a call an operator would otherwise assume this page made.
    await expect(disclosure).toContainText("wafv2:GetWebACL")
    await expect(disclosure).toContainText("route53domains:GetDomainDetail")
    await expect(disclosure).toContainText("acm:ListCertificates is regional")
    await expect(disclosure).toContainText("us-east-1")
  })

  test("the provenance names the state of every one of the four edge reads", async ({ page }) => {
    await openNetwork(page)

    const card = page.locator(".md3-card", {
      has: page.getByRole("heading", { name: "Where this reading came from" }),
    })
    for (const label of [
      "Distributions read",
      "Hosted zones read",
      "Certificates read",
      "Web ACLs read (REGIONAL)",
      "Web ACLs read (CLOUDFRONT)",
    ]) {
      await expect(card).toContainText(label)
    }
  })

  test("the edge section holds its geometry at 1440, 1180, 900 and 320px", async ({ page }) => {
    await openNetwork(page)

    // `e2e/layout.spec.ts` measures the whole route; this measures the section
    // this agent added, because a five-leg table is the thing on this page most
    // likely to push the document sideways.
    for (const width of [1440, 1180, 900, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(120)

      // Measured on THIS page, not on whatever the browser happened to be
      // showing. Without this the assertion below passes on the sign-in screen,
      // which is a false green and the exact shape of defect this suite exists
      // to catch.
      await expect(page.getByRole("heading", { name: "Network", level: 1 })).toBeVisible()
      await expect(
        page.getByRole("heading", { name: "The edge chain, hostname to origin" }),
      ).toBeVisible()

      /*
        Measured on the edge cards themselves, not on the document.

        `e2e/layout.spec.ts` owns the document-level claim for every route, and
        it has to: the shell is above this section and a top bar wider than the
        viewport would fail a document-level assertion here for a reason that has
        nothing to do with this section — which is exactly what happened while
        this was being written, with the top bar's account button measuring 331px
        inside a 320px viewport. Naming what is measured keeps a red in this file
        a red about this file.

        The rule the section must hold: nothing inside these cards may be wider
        than the viewport UNLESS it is inside a container that scrolls on its own
        — `.md3-table-shell` carries `overflow-x: auto`, which is the sanctioned
        bargain for a seven-column table and a pasteable IAM statement.
      */
      const offenders = await page.evaluate(() => {
        const headings = [
          "Records pointing at names this account does not own",
          "The edge chain, hostname to origin",
          "Certificates, soonest to expire first",
          "What sits in front of this estate",
          "Cache purges still running",
          "Hosted zones",
        ]
        const cards = Array.from(document.querySelectorAll(".md3-card")).filter((card) =>
          headings.some((h) => card.querySelector("h2, h3")?.textContent?.trim().startsWith(h)),
        )
        const limit = document.documentElement.clientWidth
        const bad: string[] = []
        for (const card of cards) {
          for (const el of Array.from(card.querySelectorAll("*"))) {
            const rect = el.getBoundingClientRect()
            if (rect.width === 0 || rect.right <= limit + 1) continue
            let node: Element | null = el
            let scrolls = false
            while (node && node !== card) {
              const overflowX = getComputedStyle(node).overflowX
              if (overflowX === "auto" || overflowX === "scroll") {
                scrolls = true
                break
              }
              node = node.parentElement
            }
            if (!scrolls) {
              bad.push(
                `${el.tagName}.${String(el.className || "").slice(0, 40)} right=${Math.round(
                  rect.right,
                )} limit=${limit} text=${(el.textContent ?? "").trim().slice(0, 60)}`,
              )
            }
          }
        }
        return { cards: cards.length, bad: bad.slice(0, 10) }
      })

      expect(offenders.cards, `the six edge cards must be present at ${width}px`).toBe(6)
      expect(
        offenders.bad,
        `elements in the edge section overflow the viewport at ${width}px outside any scroller`,
      ).toEqual([])
    }
  })
})
