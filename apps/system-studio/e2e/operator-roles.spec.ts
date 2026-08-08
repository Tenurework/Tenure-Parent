import { test, expect, type Page } from "@playwright/test"

import { operatorFor } from "./operator-identity"

/**
 * STUDIO-020-005 in a browser: two operators, one console, different surfaces.
 *
 * Every other spec in this suite signs in as one operator and asserts what the
 * console shows. That could not distinguish a Support Engineer from a Platform
 * Super Admin, because until now there was nothing to distinguish: `isOperator`
 * returned a boolean and every page repeated it, so a read-only auditor and an
 * administrator saw byte-identical markup including every mutating control.
 *
 * The assertion that matters here is an ABSENCE, and absence is the easiest
 * thing in the world to assert for the wrong reason — a page that failed to
 * render contains no buttons either. So every absence is paired with:
 *
 *   1. a POSITIVE assertion that the same operator can still read the page, and
 *   2. the SAME assertion run as a different family, which must find the
 *      control. Without (2) this suite would pass against an authorization
 *      function that refuses everybody.
 */

const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""
const AUDITOR = operatorFor("auditor-read-only")
const ENGINEER = operatorFor("cloud-platform-engineer")
const FINOPS = operatorFor("finops-analyst")
const SUPER_ADMIN = operatorFor("platform-super-admin")

/**
 * Skipped loudly rather than quietly when the environment carries only one
 * family. A green run that proved nothing is worse than a skipped one, and this
 * is the suite whose whole subject is that two operators differ.
 */
const configured = Boolean(SECRET && AUDITOR && ENGINEER && FINOPS && SUPER_ADMIN)

async function signInAs(page: Page, email: string) {
  // A fresh session each time. Without this the second sign-in lands on a page
  // already authenticated as the first operator, and every assertion afterwards
  // describes the wrong principal.
  await page.context().clearCookies()
  await page.goto("/signin")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForLoadState("networkidle")
}

test.describe("what an operator's role family changes about the console", () => {
  test.skip(
    !configured,
    "needs PLATFORM_OPERATOR_SECRET and PLATFORM_OPERATORS carrying an auditor-read-only, " +
      "a cloud-platform-engineer and a finops-analyst entry",
  )

  test("the fleet's mutating controls are in an engineer's page and absent from an auditor's", async ({
    page,
  }) => {
    // ── The foil, first. If the control is not here, the absence below proves
    // nothing at all and this test must fail rather than pass.
    await signInAs(page, ENGINEER)
    await page.goto("/tenants")
    await expect(page.getByRole("heading", { name: "Tenants" })).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Compose a tenant" }),
      "precondition: a Cloud Platform Engineer holds tenant:write and must see the control",
    ).toHaveCount(1)

    // ── The same page, as an Auditor.
    await signInAs(page, AUDITOR)
    await page.goto("/tenants")

    // They can READ it — this is the positive half, and without it the absence
    // assertions below would pass on a blank page.
    await expect(page.getByRole("heading", { name: "Tenants" })).toBeVisible()
    await expect(page.getByText("You do not have access to this")).toHaveCount(0)

    // And the control is not in the document. Not disabled: absent.
    await expect(page.getByRole("link", { name: "Compose a tenant" })).toHaveCount(0)
    const markup = await page.content()
    expect(markup, "the compose route must not be in an auditor's markup at all").not.toContain(
      'href="/tenants/new"',
    )
    // The adopt form is the other mutating control on this page.
    await expect(page.locator("#adopt-slug")).toHaveCount(0)
  })

  test("an auditor who navigates straight to the compose form is refused", async ({ page }) => {
    // The control being absent is a courtesy; the page deciding for itself is
    // the security property. A URL is not a permission.
    await signInAs(page, AUDITOR)
    await page.goto("/tenants/new")
    await expect(page.getByText("You do not have access to this")).toBeVisible()
    await expect(page.getByRole("button", { name: /Compose/ })).toHaveCount(0)
  })

  test("the cost surface belongs to FinOps and the auditor, and not to the engineer", async ({
    page,
  }) => {
    // STUDIO-020-005's own example of a surface that must differ. `cost:read`
    // is held by the FinOps Analyst, the Auditor and the Super Admin: the fleet
    // bill and the approval thresholds are the inputs to a spend commitment.
    await signInAs(page, FINOPS)
    await page.goto("/platform/cost")
    await expect(page.getByRole("heading", { name: "Cost", exact: true })).toBeVisible()
    await expect(page.getByText("You do not have access to this")).toHaveCount(0)

    await signInAs(page, AUDITOR)
    await page.goto("/platform/cost")
    await expect(page.getByRole("heading", { name: "Cost", exact: true })).toBeVisible()

    await signInAs(page, ENGINEER)
    await page.goto("/platform/cost")
    await expect(page.getByText("You do not have access to this")).toBeVisible()
    // And the thresholds table it carries is gone with it, rather than merely
    // being scrolled past.
    await expect(page.getByRole("heading", { name: "Approval thresholds" })).toHaveCount(0)
  })

  test("both families read the platform overview, because both hold platform:read", async ({
    page,
  }) => {
    // The control case. A role model where the auditor is refused everything is
    // not a role model, it is a broken login — so at least one surface has to be
    // common to both, and this asserts which.
    for (const who of [AUDITOR, ENGINEER]) {
      await signInAs(page, who)
      await page.goto("/platform")
      await expect(page.getByRole("heading", { name: "Platform" })).toBeVisible()
      await expect(page.getByText("You do not have access to this")).toHaveCount(0)
    }
  })
})

test.describe("a tenant's lifecycle controls", () => {
  const registryConfigured = Boolean(process.env.TENANT_TABLE)
  test.skip(
    !configured || !registryConfigured,
    "needs TENANT_TABLE, a reachable DynamoDB, and the multi-family operator allowlist",
  )

  /** The first tenant in the registry, whichever it is. */
  async function firstTenantSlug(page: Page): Promise<string | null> {
    await page.goto("/tenants")
    const links = page.locator('a[href^="/tenants/"]:not([href="/tenants/new"])')
    const count = await links.count()
    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute("href")
      if (!href) continue
      const slug = href.replace("/tenants/", "").split("/")[0]
      if (slug && slug !== "new") return slug
    }
    return null
  }

  test("an engineer gets them and an auditor gets a read-only notice instead", async ({ page }) => {
    await signInAs(page, ENGINEER)
    const slug = await firstTenantSlug(page)
    // Not a skip. Reaching here means the registry is configured, so an empty
    // fleet is a broken precondition rather than an absent one — and a silent
    // pass would be this suite reporting a role separation it never observed.
    expect(slug, "the registry has no tenant to open, so nothing here was tested").not.toBeNull()

    await page.goto(`/tenants/${slug}`)
    await expect(page.getByRole("heading", { name: "State" })).toBeVisible()
    const engineerMarkup = await page.content()
    expect(
      engineerMarkup,
      "precondition: a Cloud Platform Engineer holds tenant.lifecycle:write",
    ).not.toContain('data-testid="lifecycle-read-only"')

    await signInAs(page, AUDITOR)
    await page.goto(`/tenants/${slug}`)

    // Reads it — the positive half.
    await expect(page.getByRole("heading", { name: "State" })).toBeVisible()
    await expect(page.getByText("You do not have access to this")).toHaveCount(0)

    // And the controls are not in the document. `div.advance` is
    // `AdvanceControls`' own wrapper and `Move to` its heading, so this is the
    // component being absent rather than a button being hidden.
    await expect(page.getByTestId("lifecycle-read-only")).toBeVisible()
    await expect(page.locator("div.advance")).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Move to" })).toHaveCount(0)
  })

  test("the AWS console deep links are the engineer's and not the auditor's", async ({ page }) => {
    // STUDIO-080-003 — "only to authorized break-glass/platform engineers".
    await signInAs(page, ENGINEER)
    const slug = await firstTenantSlug(page)
    expect(slug).not.toBeNull()

    await page.goto(`/tenants/${slug}`)
    await expect(page.getByRole("heading", { name: "AWS console" })).toBeVisible()
    await expect(page.getByRole("link", { name: "ECS clusters" })).toHaveCount(1)

    await signInAs(page, AUDITOR)
    await page.goto(`/tenants/${slug}`)
    await expect(page.getByRole("heading", { name: "AWS console" })).toHaveCount(0)
    expect(await page.content()).not.toContain("console.aws.amazon.com")
  })

  test("a configuration an auditor may read is one they may not edit", async ({ page }) => {
    // The foil is the Super Admin here, not the engineer: `tenant.configuration:write`
    // belongs to the Super Admin and the Tenant Implementation Lead. A Cloud
    // Platform Engineer reads a tenant's configuration and does not publish it,
    // which is the same separation from the other side.
    await signInAs(page, SUPER_ADMIN)
    const slug = await firstTenantSlug(page)
    expect(slug, "the registry has no tenant to open, so nothing here was tested").not.toBeNull()

    await page.goto(`/tenants/${slug}/configuration`)
    await expect(
      page.locator("#changeReason"),
      "precondition: a Super Admin holds tenant.configuration:write and must see the editor",
    ).toHaveCount(1)
    await expect(page.getByTestId("configuration-read-only")).toHaveCount(0)

    await signInAs(page, AUDITOR)
    await page.goto(`/tenants/${slug}/configuration`)
    await expect(page.getByRole("heading", { name: "Configuration" }).first()).toBeVisible()
    await expect(page.getByTestId("configuration-read-only")).toBeVisible()
    // The editor's own fields, the approver box and the publish button are all
    // absent rather than disabled.
    await expect(page.locator("#changeReason")).toHaveCount(0)
    await expect(page.locator("#approvedBy")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Review the change" })).toHaveCount(0)
  })
})
