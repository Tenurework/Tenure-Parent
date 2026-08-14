import fs from "fs"
import path from "path"

import { test, expect, type Page } from "@playwright/test"
import { operatorFor } from "./operator-identity"

/**
 * `/platform/identity`, in a browser, with no AWS account — plus the structural
 * half nothing in a browser can see.
 *
 * `src/app/platform/identity/doors.test.ts` drives the decision layer through
 * every arm at the node level: an account with no Access Analyzer, a Cognito
 * pool with MFA OPTIONAL, a refused roster, a truncated key listing, and the one
 * estate where every guard answers.
 *
 * Eight mutations were applied to `doors.ts` and every one of them was killed by
 * a named test: `isPass` admitting NOT_RUNNING (3 tests red), the missing-analyzer
 * arm mapped to CHECKED_CLEAN (2), MFA OPTIONAL mapped to CHECKED_CLEAN (2),
 * `if (false && notChecking.length > 0)` on the verdict's second branch (1), the
 * same disabling of the uncertain-operator qualifier (1), a partial KMS posture
 * reported clean (1), a refused IAM read reported clean (1), and an unknown
 * secrets posture reported clean (1).
 *
 * This file is for the two things that test cannot see:
 *
 *   1. **that the page renders at all** when STS, Cognito, IAM, Access Analyzer,
 *      KMS and Secrets Manager are every one of them unreachable — which is the
 *      state this suite actually runs in, and precisely the state a naive page
 *      renders as "0 findings, all clear"; and
 *   2. **that what it renders in that case is a named unknown**, in the shared
 *      `UnknownState`, carrying the principal, the action and a pasteable
 *      minimum IAM statement, rather than an empty list, a zero or a default.
 *
 * The route needs an operator session and nothing else — no DynamoDB row, no
 * seeded tenant — so it has no data precondition to skip on beyond the operator
 * credentials themselves.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""
const configured = OPERATOR !== "" && SECRET !== ""

const ROUTE_DIR = path.join(__dirname, "..", "src", "app", "platform", "identity")

/** A route file, with line endings normalised so an index is the same on both platforms. */
function routeFile(name: string): string {
  return fs.readFileSync(path.join(ROUTE_DIR, name), "utf8").split("\r\n").join("\n")
}

/**
 * The same file with its comments removed.
 *
 * Every lexical guard in this repository has at some point fired on the prose
 * explaining the rule it enforces — this one did, on the module header of
 * `doors.ts` saying it drags no `server-only` into its graph. Rewording the
 * explanation each time treats the symptom: a guard that cannot tell code from a
 * comment punishes explaining, and the explanation is usually the most valuable
 * line in the file. Scanning code only is the fix, and it is the same fix
 * `tests/security/operator-plane-content.test.mjs` already made.
 */
function routeCode(name: string): string {
  return routeFile(name)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForLoadState("networkidle")
}

async function openIdentity(page: Page) {
  await signIn(page)
  await page.goto("/platform/identity")
  await page.waitForLoadState("networkidle")
}

/* ─────────────────────────────────────────────────────── in the browser ── */

test.describe("the identity surface", () => {
  test.skip(!configured, "needs PLATFORM_OPERATORS and PLATFORM_OPERATOR_SECRET")

  test("it boots without AWS, and leads with the question in words", async ({ page }) => {
    await openIdentity(page)

    await expect(page.getByRole("heading", { name: "Identity", level: 1 })).toBeVisible()
    // The question, before any apparatus. If the console had 500'd on an
    // unreachable STS, neither of these would be here at all.
    await expect(
      page.getByText(
        "Who can get into this control plane and into this account, and what is protecting those doors?",
      ),
    ).toBeVisible()
  })

  test("the lead is the count of principals who can administer, and it is never a bare zero", async ({
    page,
  }) => {
    await openIdentity(page)

    await expect(
      page.getByRole("heading", { name: "How many principals can administer this platform" }),
    ).toBeVisible()

    const body = await page.locator("body").innerText()
    // In an environment that cannot reach AWS, the honest answer is UNKNOWN or a
    // floor — never a total, and never "0 principals", which is the sentence
    // this page exists to stop printing.
    expect(body).toMatch(/UNKNOWN|At least/)
    expect(body).not.toMatch(/\b0 principal\(s\) can administer/)
    expect(body).toContain("This is not a report that nobody can")
  })

  test("an unreachable read renders as a named unknown, never as an empty list", async ({
    page,
  }) => {
    await openIdentity(page)

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

  test("what is NOT protection is drawn, and above what is", async ({ page }) => {
    await openIdentity(page)

    const gaps = page.getByRole("heading", { name: "Not protection" })
    const guarding = page.getByRole("heading", { name: "Protection", exact: true })
    await expect(gaps).toBeVisible()
    await expect(guarding).toBeVisible()

    // Rendered order, measured rather than assumed. The whole argument of this
    // page is that a guard's silence is not a pass, and putting the gaps card
    // below the protection card is how that argument is quietly lost.
    const gapsBox = await gaps.boundingBox()
    const guardingBox = await guarding.boundingBox()
    expect(gapsBox).not.toBeNull()
    expect(guardingBox).not.toBeNull()
    expect(guardingBox!.y).toBeGreaterThan(gapsBox!.y)
  })

  test("a guard that is not running is worded differently from one that is clean", async ({
    page,
  }) => {
    await openIdentity(page)

    const table = page.locator("table", {
      has: page.locator("caption", { hasText: "Guards that are not protection" }),
    })
    await expect(table).toBeVisible()

    // Every guard this page knows about is a row, with its door and its remedy.
    for (const guard of [
      "Multi-factor authentication on the console's user pool",
      "Operator accounts in the console's user pool",
      "Password policy on the console's user pool",
      "Wildcard actions and resources in this account's IAM policies",
      "Long-lived IAM access keys",
      "IAM Access Analyzer external-access findings",
      "Automatic rotation on customer-managed KMS keys",
      "Rotation on Secrets Manager secrets",
    ]) {
      await expect(table.getByText(guard, { exact: true })).toBeVisible()
    }

    // The word, not the colour. A guard that did not run must never carry the
    // sentence a guard that ran and found nothing carries.
    const body = await table.innerText()
    expect(body).not.toContain("Checked and clean")
    expect(body).toMatch(/Not readable from here|Not running — nothing is checking/)
    // And no guard that did not run may print a count of zero.
    expect(body).toContain("no count — this guard did not run")
  })

  test("the verdict never prints a clean bill of health over a gap", async ({ page }) => {
    await openIdentity(page)

    // With an estate this console cannot reach, "Clear" is unreachable — and
    // that is the point.
    const body = await page.locator("body").innerText()
    expect(body).not.toContain("This is the only condition under which an empty list on this page")
    expect(body).toMatch(/At risk|Not fully checked|Unknown/)
  })

  test("nothing on the page is a password, a token or a client secret", async ({ page }) => {
    await openIdentity(page)

    const body = await page.locator("body").innerText()
    // The reader carries no such value out of `lib/aws/cognito.ts`; this asserts
    // the rendered page does not acquire one from anywhere else either.
    expect(body).not.toMatch(/ClientSecret/i)
    expect(body).not.toMatch(/\bTemporaryPassword\s*[:=]/i)
    expect(body).not.toMatch(/SecretString/i)
    expect(body).not.toMatch(/\bAWS_SECRET_ACCESS_KEY\b/)
  })
})

/* ──────────────────────────────────── the structural half, with no browser ── */

test.describe("the identity route's own files", () => {
  test("no literal colour and no inline style in the page", () => {
    const page = routeCode("page.tsx")
    expect(page).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(page).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/)
    expect(page).not.toMatch(/style=\{\{/)
  })

  test("the stylesheet carries geometry and nothing else", () => {
    const css = routeFile("identity.module.css")
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/)
    // Type, elevation and shape are the token layer's answers, asked for through
    // `components/md3/`. A page that sets its own is a page the contrast and type
    // audits cannot see.
    expect(css).not.toMatch(/font-size\s*:/)
    expect(css).not.toMatch(/font-weight\s*:/)
    expect(css).not.toMatch(/box-shadow\s*:/)
    expect(css).not.toMatch(/border-radius\s*:/)
  })

  test("the stylesheet has no physical directions in it", () => {
    // `layout.spec.ts` re-runs every route under dir="rtl". One `margin-left`
    // reds that while every LTR test stays green.
    const css = routeFile("identity.module.css")
    expect(css).not.toMatch(/\b(margin|padding|border|inset)-(left|right)\s*:/)
    expect(css).not.toMatch(/\btext-align\s*:\s*(left|right)\b/)
    expect(css).not.toMatch(/\bfloat\s*:/)
    // `max-width` inside `@media (...)` is a media FEATURE and is how the
    // stylesheet reflows at 320px; a `width:` DECLARATION is the physical one.
    expect(css).not.toMatch(/^\s*(min-|max-)?(width|height)\s*:/m)
  })

  test("every long identifier the page prints is opted back into wrapping", () => {
    // `globals.css` excludes `td`/`th` from its global `overflow-wrap: anywhere`
    // so a wide table scrolls rather than collapsing its columns. A role ARN in a
    // cell without `.cell` or `.identifier` runs out of its box at 320px, which
    // `layout.spec.ts` measures as `scrollWidth > clientWidth`.
    const css = routeFile("identity.module.css")
    // `[^}]` rather than the `s` flag: this project's TypeScript target predates
    // `dotAll`, and a character class that excludes the closing brace is the same
    // assertion without it.
    expect(css).toMatch(/\.cell\s*\{[^}]*overflow-wrap:\s*anywhere/)
    expect(css).toMatch(/\.identifier\s*\{[^}]*overflow-wrap:\s*anywhere/)
  })

  test("the question is asked in words, at the top, before any apparatus", () => {
    const page = routeFile("page.tsx")
    const question = page.indexOf(
      "Who can get into this control plane and into this account, and what is protecting those",
    )
    expect(question, "the page no longer asks its question in words").toBeGreaterThan(-1)
    expect(page.indexOf("<Card")).toBeGreaterThan(question)
  })

  test("what is NOT protection is drawn above what is", () => {
    // The ordering IS the argument of this page. A guard that is not running,
    // read as a pass, is the defect; putting the gaps card below the protection
    // card is how a page quietly reintroduces it.
    const page = routeFile("page.tsx")
    const gaps = page.indexOf('headline="Not protection"')
    const guarding = page.indexOf('headline="Protection"')
    expect(gaps, "the gaps card is gone").toBeGreaterThan(-1)
    expect(guarding).toBeGreaterThan(gaps)
  })

  test("every reader's refusal renders through the shared UnknownState", () => {
    const page = routeFile("page.tsx")
    for (const what of [
      "the Cognito user pools in this region",
      "this account's IAM roles, policies and access keys",
      "the IAM Access Analyzer listing",
      "this account's KMS keys",
      "this account's Secrets Manager secrets",
      "the console pool's operator roster",
    ]) {
      expect(page, `${what} no longer renders through UnknownState`).toContain(what)
    }
    // And the narrowing is the shared one: a page that hand-rolled it would be
    // a page that could pass a value-carrying arm to a panel that reports denials.
    expect(page).toContain("unknownArm")
  })

  test("the IAM tables are not drawn from a read that did not answer", () => {
    // The structural half of "a denied read is never an empty list". A
    // `<DataTable>` outside this guard would draw an empty table under a heading
    // naming wildcard grants, which reads as "there are none".
    //
    // `routeCode` and NOT `routeFile`: this assertion was written against the raw
    // file, and the prose above the badge in `page.tsx` quotes the very string
    // being searched for. `indexOf` matched the COMMENT, at an index earlier than
    // the table, so replacing the real guard with `{true ? (` left this test
    // green — a guard that could not fail, proving nothing about the code it
    // named. Scanning comment-stripped code is what makes the mutation kill it.
    const page = routeCode("page.tsx")
    const guarded = page.indexOf("{iam.posture ? (")
    const table = page.indexOf("Wildcard actions and resources —")
    expect(guarded, "the IAM tables are no longer behind the posture check").toBeGreaterThan(-1)
    expect(table).toBeGreaterThan(guarded)
  })

  test("the page reads AWS only through the readers, and never the SDK", () => {
    // `src/lib/aws/*` is the only path to the SDK, and `mutate.ts` is the only
    // place a mutation lives. A surface that imported a client would be a surface
    // picking its own region and credential chain.
    const page = routeCode("page.tsx")
    expect(page).not.toMatch(/@aws-sdk\//)
    expect(page).not.toMatch(/from "@\/lib\/aws\/client"/)
    expect(page).not.toMatch(/from "@\/lib\/aws\/mutate"/)
    // And no Prisma anywhere: the Studio reads AWS and DynamoDB, never the
    // tenant database. `tests/security/operator-plane-content.test.mjs` asserts
    // this repository-wide; this is the same rule at the file it applies to.
    expect(page).not.toMatch(/@prisma\/client|PrismaClient/)
  })

  test("the decision layer is pure — no reader, no client, no server-only in its graph", () => {
    // What makes `doors.test.ts` able to drive every arm at the node level. A
    // value import from `lib/aws/*` here would pull `server-only` into the test's
    // module graph and the eight mutations would stop being provable.
    const doors = routeCode("doors.ts")
    const valueImports = doors.match(/^import (?!type )/gm) ?? []
    expect(valueImports, "doors.ts acquired a value import").toEqual([])
    expect(doors).not.toMatch(/@aws-sdk\//)
    expect(doors).not.toMatch(/server-only/)
  })
})
