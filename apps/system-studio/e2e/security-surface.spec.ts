import { test, expect, type Page } from "@playwright/test"
import { operatorFor } from "./operator-identity"

/**
 * STUDIO-110-006 — `/platform/security`, in a browser, with no AWS account.
 *
 * `security-page-logic.spec.ts` drives `./answer.ts` and reads the route files;
 * `src/app/platform/security/posture.test.ts` drives the coverage model through
 * every arm. Neither can see the thing this file is for: **that the page renders
 * at all when STS, Security Hub and IAM are unreachable, and that what it
 * renders in that case is a named unknown rather than an empty list.**
 *
 * That is not a hypothetical here. This suite runs against a Studio whose
 * credentials are DynamoDB-Local shaped and cannot reach any AWS endpoint, so
 * every read on this page lands in a valueless arm of `AwsRead` — which is
 * precisely the state a naive page renders as "0 findings, all clear". A page
 * that 500s for want of credentials fails these too: the heading assertion is
 * the one that catches it.
 *
 * The route requires an operator session and nothing else — no DynamoDB row, no
 * seeded tenant — so unlike the fleet specs it has no data precondition to skip
 * on.
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

async function openSecurity(page: Page) {
  await signIn(page)
  await page.goto("/platform/security")
  await page.waitForLoadState("networkidle")
}

test.describe("the security posture surface", () => {
  test.skip(!configured, "needs PLATFORM_OPERATORS and PLATFORM_OPERATOR_SECRET")

  test("it boots without AWS, and leads with the question in words", async ({ page }) => {
    await openSecurity(page)

    await expect(page.getByRole("heading", { name: "Security posture", level: 1 })).toBeVisible()
    // The question, before any apparatus. If the console had 500'd on an
    // unreachable STS, neither of these would be here at all.
    await expect(
      page.getByText("What in this estate is exposed, unencrypted, unrotated or unwatched?"),
    ).toBeVisible()
  })

  test("an unreachable read renders as a named unknown, never as an empty list", async ({
    page,
  }) => {
    await openSecurity(page)

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

  test("what is not being checked is drawn, and above what was found", async ({ page }) => {
    await openSecurity(page)

    const notChecking = page.getByRole("heading", { name: "Not being checked" })
    const found = page.getByRole("heading", { name: "What this console found" })
    await expect(notChecking).toBeVisible()
    await expect(found).toBeVisible()

    // Rendered order, measured rather than assumed. The whole argument of this
    // page is that a control's silence is not a pass, and putting the coverage
    // card below the findings is how that argument is quietly lost.
    const gapsBox = await notChecking.boundingBox()
    const foundBox = await found.boundingBox()
    expect(gapsBox).not.toBeNull()
    expect(foundBox).not.toBeNull()
    expect(foundBox!.y).toBeGreaterThan(gapsBox!.y)
  })

  test("a control nothing here reads is listed, with its action and a remedy", async ({ page }) => {
    await openSecurity(page)

    const table = page.locator("table", {
      has: page.locator("caption", { hasText: "Controls that are not answering" }),
    })
    await expect(table).toBeVisible()

    // The four the requirement names by hand. Each must be on the page as a row
    // saying it is not being checked — not absent, which is how a blind spot
    // becomes invisible.
    for (const control of [
      "GuardDuty detector state",
      "Access Analyzer existence",
      "Config rule verdicts",
      "ECR image scanning",
    ]) {
      await expect(table.getByText(control, { exact: true })).toBeVisible()
    }

    // And the IAM action behind one of them, so the row is actionable rather
    // than an apology.
    await expect(table.getByText("guardduty:ListDetectors", { exact: true }).first()).toBeVisible()
  })

  /* ── the two readers that reached no screen until now ──────────────────── */

  test("GuardDuty is read directly, and no detector is ever shown as enabled", async ({ page }) => {
    await openSecurity(page)

    // The card exists at all — which is the whole claim. `lib/aws/guardduty.ts`
    // was a tested module with a capability and an IAM grant that no page
    // imported, so nothing it read reached an operator.
    await expect(page.getByRole("heading", { name: "Threat detection — GuardDuty" })).toBeVisible()

    const body = await page.locator("body").innerText()
    // `guardduty:ListDetectors` lists a SUSPENDED detector exactly as it lists a
    // running one, and `guardduty:GetDetector` is not a capability this build
    // holds — so the page says so rather than implying threat detection is on.
    expect(body).toContain("guardduty:GetDetector")
    expect(body).toContain("Why no detector on this page is ever shown as enabled")
    // Every protection plan, named. "Some data sources may be off" is not a
    // sentence anybody can act on.
    for (const plan of ["S3 Protection", "EKS Protection", "Malware Protection", "RDS Protection", "Lambda Protection"]) {
      expect(body, plan).toContain(plan)
    }
  })

  test("AWS Config is read, and the recorder question is stated rather than assumed", async ({
    page,
  }) => {
    await openSecurity(page)

    await expect(
      page.getByRole("heading", { name: "Configuration compliance — AWS Config" }),
    ).toBeVisible()

    const body = await page.locator("body").innerText()
    // A rule can only evaluate a resource type the recorder is recording, and
    // neither capability that would answer it is in this engine's registry.
    expect(body).toContain("RECORDER UNKNOWN")
    expect(body).toContain("config:DescribeConfigurationRecorders")
    expect(body).toContain("config:DescribeConfigurationRecorderStatus")
    // And INSUFFICIENT_DATA is named as what it is, wherever it appears.
    expect(body).toContain("INSUFFICIENT_DATA")
  })

  test("both new controls are listed among the ones not answering", async ({ page }) => {
    await openSecurity(page)

    const table = page.locator("table", {
      has: page.locator("caption", { hasText: "Controls that are not answering" }),
    })
    await expect(table).toBeVisible()

    // Two rows that did not exist before these readers were wired: neither is a
    // placeholder, and neither can be answered by anything in this build.
    for (const control of [
      "GuardDuty detector status and protection plans",
      "Config recorder — is anything being recorded",
    ]) {
      await expect(table.getByText(control, { exact: true })).toBeVisible()
    }
  })

  test("with no AWS reachable, neither new card claims a clean control", async ({ page }) => {
    await openSecurity(page)

    // The badge beside each card's headline is the summary, and in this
    // environment — where every read lands in a valueless arm — neither may be
    // the reassuring word. `Compliant` and an enabled detector are exactly what a
    // naive page prints when a read returns nothing.
    const guard = page.locator(".md3-card", {
      has: page.getByRole("heading", { name: "Threat detection — GuardDuty" }),
    })
    const config = page.locator(".md3-card", {
      has: page.getByRole("heading", { name: "Configuration compliance — AWS Config" }),
    })
    await expect(guard.locator(".md3-badge").first()).toHaveText(/No detector|Not readable|Status unverified/)
    await expect(config.locator(".md3-badge").first()).toHaveText(
      /Not readable|No verdict readable|No rules|Nothing evaluated|failing|Partly evaluated|Compliant in part/,
    )
  })

  test("the verdict never prints a clean bill of health over a gap", async ({ page }) => {
    await openSecurity(page)

    // With controls this console does not read yet, plus an estate it cannot
    // reach, "Clear" is unreachable — and that is the point. The badge and the
    // headline must agree, and neither may say the estate is clean.
    const body = await page.locator("body").innerText()
    expect(body).not.toContain(
      "Every control on this page is checking, and none of them has found anything",
    )
    expect(body).toMatch(/Nothing is checking|Partly answered|Exposures open|Critical exposure/)
  })
})
