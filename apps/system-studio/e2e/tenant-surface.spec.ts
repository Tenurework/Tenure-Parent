import { test, expect, type Page } from "@playwright/test"

import { operatorFor } from "./operator-identity"

/**
 * `/tenants/[slug]` — one tenant, in a browser, at the widths an operator uses.
 *
 * ## What this asserts that no other spec does
 *
 * `layout.spec.ts` measures geometry on nine routes and this is not one of them
 * — it is the longest page in the console and the only one whose content is a
 * dozen panels of live AWS readings, which is exactly the shape that overflows.
 * So the four geometry properties are measured here, against this route, at the
 * same four widths and with the same algorithm.
 *
 * `operator-roles.spec.ts` proves the lifecycle controls differ by family.
 * `high-risk-fails-closed.spec.ts` proves the gate refuses. Neither of them
 * looks at whether the page is READABLE, and readable is the whole subject of
 * the change this spec accompanies:
 *
 *   1. the answer is first — `#right-now` is the first region on the page
 *   2. every panel says what it is AS OF
 *   3. the panels are Material cards, not the ad-hoc `section.system` markup
 *   4. an unreadable source is reported as unreadable, never as empty
 *
 * ## It runs against the seeded fleet
 *
 * `tools/dev/seed-studio-fleet.mjs` writes `seed-deployed` (PURGE_PENDING, with
 * a DEPLOYMENT row) and `seed-nodeploy` (ACTIVE, with none). The two exercise
 * genuinely different branches — the drift and deployment panels exist only for
 * the first — so both are walked rather than one being taken as representative.
 *
 * Skipped without a registry, because a spec that quietly passes against a
 * console with no tenants is asserting that a page does not render.
 */

const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""
const OPERATOR = operatorFor("cloud-platform-engineer") || operatorFor()
const configured = Boolean(process.env.TENANT_TABLE && SECRET && OPERATOR)

/** Both seeded shapes. The second has no artifact, so half the page is absent. */
const SLUGS = ["seed-deployed", "seed-nodeploy"] as const

/** The widths `layout.spec.ts` uses. 320 is WCAG 2.2 AA 1.4.10 reflow, not a phone. */
const WIDTHS = [1440, 1180, 900, 320]

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  /*
   * Waiting for the URL to LEAVE /signin, not for the network to go idle.
   *
   * `waitForLoadState("networkidle")` resolves on the sign-in document while the
   * form's own POST and its 303 are still in flight, so the next `goto` raced
   * the redirect and the test found itself on `/` looking at the home page's
   * cards. It failed with "the first region is not the answer", which is a true
   * sentence about the wrong page — the most expensive kind of red.
   */
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 30_000 })
}

async function open(page: Page, slug: string) {
  await page.goto(`/tenants/${slug}`)
  // The page is server-rendered, so its first card is in the initial HTML. This
  // waits for the thing under test rather than for a network that a dev server's
  // hot-reload socket keeps busy forever.
  await expect(page.locator("main section").first()).toBeVisible({ timeout: 30_000 })
}

type Box = { x: number; y: number; w: number; h: number; text: string; tag: string }

/** Leaf text blocks. Measuring containers would report every parent over its child. */
async function textBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const out: Array<{ x: number; y: number; w: number; h: number; text: string; tag: string }> = []
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const text = (el.textContent ?? "").trim()
      if (!text) continue
      if (Array.from(el.children).some((c) => (c.textContent ?? "").trim())) continue

      const style = getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue

      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue

      out.push({
        x: r.x + window.scrollX,
        y: r.y + window.scrollY,
        w: r.width,
        h: r.height,
        text: text.slice(0, 60),
        tag: el.tagName.toLowerCase(),
      })
    }
    return out
  })
}

function overlapArea(a: Box, b: Box): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return x * y
}

test.describe("one tenant, read by an operator", () => {
  test.skip(
    !configured,
    "needs TENANT_TABLE, PLATFORM_OPERATOR_SECRET and PLATFORM_OPERATORS, and a seeded fleet",
  )

  /* ── The answer, first ─────────────────────────────────────────────────── */

  test("the page leads with the answer, not with the registry row", async ({ page }) => {
    await signIn(page)
    await open(page, "seed-deployed")

    const first = page.locator("main section").first()
    await expect(first, "the first region on the page is not the answer").toHaveAttribute(
      "id",
      "right-now",
    )
    await expect(page.getByRole("heading", { name: "Right now" })).toBeVisible()

    // And it is genuinely ABOVE the registry facts, rather than merely first in
    // the DOM behind a grid that reorders. Measured, because "first" is a
    // property of the paint and not of the markup.
    const answer = await page.locator("#right-now").boundingBox()
    const state = await page.locator("#state").boundingBox()
    const registry = await page.locator("#registry").boundingBox()
    expect(answer).not.toBeNull()
    expect(state).not.toBeNull()
    expect(registry).not.toBeNull()
    expect(answer!.y).toBeLessThan(state!.y)
    expect(state!.y).toBeLessThan(registry!.y)

    // The verdict is a word, not a colour (Bible §26.3.2).
    const badge = page.locator("#right-now .md3-badge").first()
    await expect(badge).toBeVisible()
    expect((await badge.innerText()).trim().length).toBeGreaterThan(2)
  })

  test("the answer names what an operator should act on, and says whether it is serving", async ({
    page,
  }) => {
    await signIn(page)
    await open(page, "seed-nodeploy")

    const answer = page.locator("#right-now")
    // `seed-nodeploy` is ACTIVE with no DEPLOYMENT row, which is the one case
    // the fleet page's `never-deployed` signal exists for. The tenant page must
    // reach the same verdict from the same function.
    await expect(answer).toContainText(/Never deployed/i)
    await expect(answer).toContainText("Serving")
    await expect(answer).toContainText(/no artifact has been published/i)
  })

  /* ── Every panel says when ─────────────────────────────────────────────── */

  test("every card on this route states what it is as of", async ({ page }) => {
    await signIn(page)

    for (const slug of SLUGS) {
      await open(page, slug)

      const cards = await page.locator("main section.md3-card").evaluateAll((sections) =>
        sections.map((section) => ({
          id: section.id,
          headline: (section.querySelector(".md3-card-headline")?.textContent ?? "").trim(),
          support: (section.querySelector(".md3-card-support")?.textContent ?? "").trim(),
        })),
      )

      expect(cards.length, `${slug} rendered no cards`).toBeGreaterThan(6)

      const silent = cards.filter((card) => !/\bAs of \S/.test(card.support))
      expect(
        silent.map((c) => c.headline || c.id),
        `${slug}: a panel that does not say when it was true`,
      ).toEqual([])

      // And the as-of is an instant, not a word like "recently".
      const undated = cards.filter(
        (card) => !/As of \d{4}-\d{2}-\d{2}T[\d:.]+Z\./.test(card.support),
      )
      expect(
        undated.map((c) => c.headline || c.id),
        `${slug}: an as-of that is not an ISO instant`,
      ).toEqual([])
    }
  })

  /* ── Material, not the ad-hoc markup ───────────────────────────────────── */

  test("this route's own panels are Material cards", async ({ page }) => {
    await signIn(page)

    for (const slug of SLUGS) {
      await open(page, slug)

      // The two panels this route renders from SHARED components — owned by
      // `components/DeploymentPanel.tsx` and `components/EvidencePanel.tsx`, not
      // by this route — are still on the pre-Material markup. Every OTHER
      // `section.system` on the page would be this route's own, and there must
      // not be one.
      const legacy = await page.locator("main section.system").evaluateAll((sections) =>
        sections.map((section) => (section.querySelector("h2")?.textContent ?? "").trim()),
      )
      const SHARED = ["Deployment manifest", "Evidence"]
      expect(
        legacy.filter((heading) => !SHARED.includes(heading)),
        `${slug}: a panel this route owns is still ad-hoc markup`,
      ).toEqual([])

      // Same argument for the tables: every `table.grid` left on the page
      // belongs to one of the shared panels.
      const strayTables = await page.locator("main table.grid").evaluateAll((tables) =>
        tables.filter((table) => table.closest("section.system") === null).length,
      )
      expect(strayTables, `${slug}: a table this route owns is still ad-hoc markup`).toBe(0)

      // And the Material tables are actually being used.
      expect(await page.locator("main table.md3-table").count()).toBeGreaterThan(2)
    }
  })

  test("a wide table scrolls inside its own container rather than the page", async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 320, height: 900 })
    await open(page, "seed-deployed")

    const shells = await page
      .locator("main .md3-table-shell")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).overflowX))
    expect(shells.length).toBeGreaterThan(2)
    expect(shells.every((overflow) => overflow === "auto" || overflow === "scroll")).toBe(true)
  })

  /* ── Geometry, at the four widths ──────────────────────────────────────── */

  for (const width of WIDTHS) {
    test(`at ${width}px the page does not scroll sideways, overlap or spill`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await signIn(page)
      await open(page, "seed-deployed")

      const overflowsPage = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      )
      expect(overflowsPage, "the page scrolls sideways").toBe(false)

      // Text drawn on top of other text.
      const boxes = await textBoxes(page)
      expect(boxes.length, "the page rendered no text at all").toBeGreaterThan(20)

      const collisions: string[] = []
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const area = overlapArea(boxes[i], boxes[j])
          if (area <= 0) continue
          const smaller = Math.min(boxes[i].w * boxes[i].h, boxes[j].w * boxes[j].h)
          if (area / smaller > 0.25) {
            collisions.push(
              `"${boxes[i].text}" (${boxes[i].tag}) over "${boxes[j].text}" (${boxes[j].tag})`,
            )
          }
        }
      }
      expect(collisions, `text drawn on top of other text at ${width}px`).toEqual([])

      // Content wider than the section it is in, unless something between the
      // two scrolls on purpose. The walk goes all the way to the section: the
      // elements that measure wide inside a scrollable table are `tr`/`td`,
      // whose parent is `tbody`, which does not scroll.
      const spills = await page.evaluate(() => {
        const bad: string[] = []
        for (const section of Array.from(document.querySelectorAll("main section, main dl"))) {
          const box = section.getBoundingClientRect()
          const scrolls = (el: Element) =>
            ["auto", "scroll"].includes(getComputedStyle(el).overflowX)

          for (const child of Array.from(section.querySelectorAll("*"))) {
            if (scrolls(child)) continue
            let ancestor: Element | null = child.parentElement
            let inScroller = false
            while (ancestor) {
              if (scrolls(ancestor)) {
                inScroller = true
                break
              }
              if (ancestor === section) break
              ancestor = ancestor.parentElement
            }
            if (inScroller) continue

            const r = child.getBoundingClientRect()
            if (r.width === 0) continue
            if (r.right > box.right + 2) {
              bad.push(`${child.tagName.toLowerCase()} "${(child.textContent ?? "").trim().slice(0, 40)}"`)
            }
          }
        }
        return [...new Set(bad)].slice(0, 8)
      })
      expect(spills, "content spills outside its section").toEqual([])

      // Text wider than the box it is drawn in — the defect no box-overlap
      // check can see, and the one a 64-character digest causes at 320px.
      const spilling = await page.evaluate(() => {
        const bad: string[] = []
        for (const el of Array.from(document.querySelectorAll("main *"))) {
          const style = getComputedStyle(el)
          if (style.overflowX !== "visible") continue
          if (!(el.textContent ?? "").trim()) continue
          if (Array.from(el.children).some((c) => (c.textContent ?? "").trim())) continue
          if (el.closest("table")) continue
          if (el.scrollWidth > el.clientWidth + 2) {
            bad.push(
              `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 45)}" ` +
                `(${el.scrollWidth}px of text in a ${el.clientWidth}px box)`,
            )
          }
        }
        return [...new Set(bad)].slice(0, 10)
      })
      expect(spilling, `text wider than its box at ${width}px`).toEqual([])
    })
  }

  /* ── An unread source is not an empty one ──────────────────────────────── */

  test("the observation table names every source, including the ones nothing could read", async ({
    page,
  }) => {
    await signIn(page)
    await open(page, "seed-deployed")

    const observed = page.locator("#observed")
    await expect(observed).toBeVisible()

    // The badge counts answers rather than asserting health, and an unread
    // source is never counted as an answer.
    // `innerText`, so this is the RENDERED text — `.md3-badge` is
    // `text-transform: uppercase`, and matching case-sensitively here asserted
    // the stylesheet rather than the count.
    const badge = (await observed.locator(".md3-badge").first().innerText()).trim()
    expect(badge, `the Observed badge said "${badge}"`).toMatch(/^\d+ OF \d+ ANSWERED$/i)

    const [, answered, total] = badge.match(/^(\d+) OF (\d+) ANSWERED$/i) ?? []
    const unknownRows = await observed.locator("tbody tr", { hasText: "unknown" }).count()
    // Every row whose status is `unknown` is one this console did not get an
    // answer from. Arithmetic, so the badge cannot drift from the table.
    expect(Number(total) - Number(answered)).toBe(unknownRows)
  })

  /* ── The ledger renders the console's own outcome codes ────────────────── */

  test("the audit ledger renders a code per attempt and links each row to the one below", async ({
    page,
  }) => {
    await signIn(page)
    await open(page, "seed-deployed")

    const ledger = page.locator("[data-testid='audit-ledger']")
    await expect(page.locator("#audit-ledger")).toBeVisible()

    const rows = await ledger.locator("tbody tr").count()
    if (rows === 0 || (await ledger.locator(".md3-empty").count()) > 0) {
      // A seeded tenant has attempted nothing, which is a real empty ledger and
      // must say so in those words rather than rendering a bare table.
      await expect(page.locator("#audit-ledger")).toContainText(/Nothing has been attempted/i)
      return
    }

    // Every outcome cell carries the console's own code, not the record-level
    // ALLOW/DENY. `_outcomeCode` is the metadata key the projection reads; the
    // page used to read `metadata.code`, which is never set, so every row said
    // DENY. A code of exactly ALLOW or DENY on every row is that bug returning.
    const codes = await ledger
      .locator("[data-audit-outcome]")
      .evaluateAll((cells) => cells.map((c) => c.getAttribute("data-audit-outcome") ?? ""))
    expect(codes.length).toBe(rows)
    expect(codes.every((code) => code === "ALLOW" || code === "DENY")).toBe(false)

    const links = await ledger
      .locator("[data-audit-hash]")
      .evaluateAll((cells) =>
        cells.map((c) => ({
          hash: c.getAttribute("data-audit-hash") ?? "",
          previous: c.getAttribute("data-audit-previous") ?? "",
        })),
      )
    expect(links.length).toBe(rows)
    for (const link of links) expect(link.hash).not.toBe("")
  })

  /* ── The diagnostic panel is still here, and is still tenant-independent ── */

  test("the refusal list is identical on two different tenants, which is why it belongs elsewhere", async ({
    page,
  }) => {
    // Recorded rather than asserted-away. `REFUSED_OPERATIONS` is a constant and
    // this table is the same on every tenant's page — a policy reference on a
    // page about one tenant. It is named in the hand-off as belonging behind the
    // Diagnostics tab, and this test is what will fail loudly if somebody makes
    // it tenant-specific in place instead of moving it.
    await signIn(page)

    await open(page, SLUGS[0])
    const first = (await page.locator("#refusals table").innerText()).replace(SLUGS[0], "<slug>")
    await open(page, SLUGS[1])
    const second = (await page.locator("#refusals table").innerText()).replace(SLUGS[1], "<slug>")

    expect(second).toBe(first)
  })
})
