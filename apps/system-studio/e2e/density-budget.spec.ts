import { test, expect, type Page } from "@playwright/test"
import { operatorFor } from "./operator-identity"

/**
 * STUDIO-030-010 — "most is visible in a single view", as a number.
 *
 * ADR-0009 §"Component scale: compact by default" ends by naming the check this
 * file is: *"the complement — that the DEFAULT shows a useful working set —
 * belongs with STUDIO-030-010 … and is checked by asserting a minimum number of
 * rows visible in a standard viewport rather than by eye."*
 *
 * Nothing checked it before, and that is how the console got here. Every
 * assertion in `layout.spec.ts` is about text not colliding, not overflowing and
 * not being clipped — all of which a wall of half-empty cards satisfies
 * perfectly. Density has no failure mode that any existing test can see, so it
 * degrades one padding change at a time and each change is individually
 * defensible.
 *
 * ## The property, stated so it can be false
 *
 * Three separate things, because they fail for different reasons and a single
 * conflated number would not say which:
 *
 *   1. **Rows per fold.** One screen's worth of space, measured from the top of
 *      the first data row, holds at least N rows. This is what padding, line
 *      height and how much prose a cell carries all spend, and it is the number
 *      the ADR means by "every 4px of padding on a row costs a row of the estate
 *      at the bottom of the screen".
 *   2. **The table's own chrome.** The first data row sits close under the top
 *      of the table's scroll region — a caption and one header row, not a
 *      toolbar and a legend.
 *   3. **The section's chrome.** The section that PRESENTS the facts does not
 *      spend a screen introducing them.
 *
 * ## What is deliberately NOT asserted
 *
 * **No maximum.** Every row assertion is `>= min(rowsAvailable, budget)`. A
 * surface legitimately holding three tenants must show three, not fail for not
 * holding nine; and a fleet that grows past the budget must still fit the budget
 * inside a fold. That shape is the whole reason the assertion is a floor against
 * what the table actually has rather than a floor against a constant — a
 * constant would red the suite for the estate being small, which is a fact about
 * the estate and not a defect in the layout.
 *
 * **Not the count of rows the page chose to render.** `layout.spec.ts` already
 * owns the DOM-node budget that catches a table which stopped paging. This file
 * is about the space each rendered row costs.
 *
 * ## Where the fold is put, and why not at the top of the document
 *
 * "Above the fold" is measured from the top of the first data row rather than
 * from the top of the page. Measured from the page top the answer on all three
 * surfaces is ZERO — but the reason is the preamble, and the preamble is
 * assertion 3's job. Conflating them would produce one failure that could mean
 * either "rows got fatter" or "somebody added a panel", which is the least
 * useful thing a density test could say.
 *
 * It is computed from the row rectangles rather than by scrolling and counting
 * what is on screen, so it does not depend on the document being tall enough to
 * scroll that far: a table near the bottom of a short page cannot be scrolled to
 * the top of the viewport, and a scroll-and-count version of this would undercount
 * there and red for a reason that has nothing to do with density.
 *
 * The fold subtracts the sticky masthead. `header.masthead` is `position: sticky;
 * inset-block-start: 0` with `min-block-size: 64px` (`topbar.module.css`), so an
 * operator scrolled into a table has 836 of a 900px viewport, not 900. Measured
 * at run time rather than hardcoded, because a bar that grows a row takes rows
 * off the bottom of every table in the console and that is a regression this
 * file should catch rather than be blind to.
 *
 * ## The empty-table trap
 *
 * An assertion about rows passes vacuously on a table with no rows, and this
 * console's fleet table is empty without a seeded registry: `/tenants` reads
 * DynamoDB, and with no items it renders an `EmptyState` inside a single
 * `.md3-table-empty` row. So `.md3-table-empty` rows are excluded from the count
 * and every surface must produce rows or fail LOUDLY — see
 * `expect(measured.total, …).toBeGreaterThan(0)` below, which names the seeder.
 *
 * Run against the harness in the task brief: `dynalite`, then
 * `tools/create-registry-table.mjs`, then `tools/dev/seed-studio-fleet.mjs`.
 * CI's `studio-e2e` job already runs all three (`.github/workflows/ci.yml`).
 *
 * ## Where these numbers come from
 *
 * MEASURED TWICE on 2026-08-17, at 1440x900 in Chromium, on the local harness
 * (dynalite + `seed-studio-fleet.mjs`, three tenants, no AWS credentials — which
 * is also exactly what CI's `studio-e2e` job renders). "rows/fold" is
 * comfortable / compact, and the fold has the sticky masthead subtracted.
 *
 * (A) BEFORE the base-scale pass — commit 024eb0d, clean working tree:
 *
 *   route                | densest table          | rows | rows/fold | under table | under section | under main
 *   ---------------------|------------------------|------|-----------|-------------|---------------|-----------
 *   /platform/estate     | service coverage       |  21  |   9 / 10  |  74 /  62   |  229 /  204   |  1408
 *   /tenants             | registered tenants     |   3  |   3 /  3  |  74 /  62   |  459 /  422   |  2036
 *   /platform/security   | controls not answering |  20  |   4 /  4  |  74 /  62   |  215 /  194   |  2774
 *
 *   row heights: estate 78-97px, tenants 245-246px, security 189-208px.
 *
 * (B) AFTER it — the same three surfaces rebuilt against STUDIO-030-001's
 *     base-scale work as it stood in this working tree, uncommitted:
 *
 *   route                | rows | rows/fold | under table | under section | under main
 *   ---------------------|------|-----------|-------------|---------------|-----------
 *   /platform/estate     |  21  |  10 / 12  |  58 /  50   |  211 /  190   |  1294
 *   /tenants             |   3  |   3 /  3  |  58 /  50   |  426 /  395   |  1812
 *   /platform/security   |  20  |   4 /  5  |  58 /  50   |  196 /  179   |  2456
 *
 *   row heights: estate 68-85px, tenants 222-223px, security 170-188px. Every
 *   number moved the right way, which is the pass working.
 *
 * `td` padding-block is `--space-2` — 16px of a 208px security row, 12px after the
 * pass. So most of what this budget defends is NOT padding: it is how much prose a
 * cell is allowed to carry. Both are ways to waste a viewport and both red this
 * file, which is why the budget is measured in rows rather than in tokens.
 *
 * ## Ambitious, or merely current?
 *
 * Merely current, deliberately — a FLOOR AT TODAY. A budget cannot demand an
 * improvement nobody has made; what it can do, and what this file is for, is make
 * an improvement unlosable. So the numbers below are ratcheted onto (B) where (B)
 * is a clean, reproducible measurement, and left at (A) where it is not:
 *
 *   - `ROWS_PER_FOLD` for `/platform/estate` is RATCHETED, 9 → 10. It is the
 *     headline property, (B) was measured on a from-scratch build, and compact
 *     still affords 12 — two rows of headroom above the floor.
 *   - `TABLE_CHROME_CEILING_PX` is RATCHETED, 96 → 80, against a measured 58.
 *   - `SECTION_CHROME_CEILING_PX` (560) and `PREAMBLE_FOLD_CEILING` (3.5) are NOT
 *     ratcheted, and this is the one judgement call in the file. (B) supports 520
 *     and 3.2. Both were left where they are because (B) is an UNCOMMITTED tree:
 *     tightening a ceiling onto work that may still be tuned buys a few pixels of
 *     strictness and risks reddening CI for somebody else's in-flight change,
 *     which is how a budget gets deleted instead of raised. **Move them to 520 and
 *     3.2 once STUDIO-030-001 is committed** — that is the follow-up, and leaving a
 *     floor at the old value after the floor has moved is a test that has stopped
 *     measuring anything.
 *
 * `/tenants` cannot be ratcheted at all: it holds three rows and all three fit, so
 * 3 is simultaneously the measurement and the ceiling of what the fixture can
 * prove. See `ROWS_PER_FOLD` for why raising it today would be a false alarm.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

test.beforeAll(() => {
  expect(OPERATOR, "PLATFORM_OPERATORS must be set").not.toBe("")
  expect(SECRET, "PLATFORM_OPERATOR_SECRET must be set").not.toBe("")
})

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForLoadState("networkidle")
}

/**
 * 1440x900.
 *
 * 1440 is the width `layout.spec.ts` already treats as the desktop case and the
 * width the shell's "use the width available" assertions are written at, so a
 * density budget at any other width would be measuring a layout no other spec
 * describes. 900 is what a 1080p screen leaves for the document after the
 * operating system's bar and the browser's own chrome — about 180px on this
 * machine. It is deliberately the SHORTER of the plausible heights: a budget set
 * on a tall screen is a budget that passes for nobody on a laptop.
 */
const VIEWPORT = { width: 1440, height: 900 }

/**
 * The minimum number of data rows that must fit in one fold, per surface.
 *
 * Each is what the surface measured on 2026-08-17 (table above), not a round
 * figure. Read as: "the layout must not get worse than it is today."
 *
 *  - `/platform/estate` — 10, ratcheted from the 9 that measurement (A) gave.
 *    The coverage table's 21 rows are 68-85px after the base-scale pass; ten of
 *    them come to 765px of the 836px fold and the eleventh needs 850px. This is
 *    the tightest budget in the file and the one that bites first, because it is
 *    the only surface here whose rows are one line of content each: nothing but
 *    padding and line height sits between 10 and 9.
 *  - `/tenants` — 3. Three rows at 223px come to 669px. The fleet row is the
 *    fattest row in the console — 3x the estate row, because every cell carries a
 *    value and a caption under it — and the seeder provides exactly three
 *    tenants, so `min(total, budget)` makes this "all three fit". Raising it above
 *    3 today would demand rows the registry does not hold; a fourth tenant needs
 *    892px, still inside the fold, but a fifth needs 1115px and would red this
 *    file for the FLEET GROWING, which is the exact false alarm the "no maximum"
 *    rule exists to prevent. It becomes a real constraint the moment the seeder
 *    writes more tenants — and at 223px a fold holds 3, so 3 is also all this
 *    fixture can prove.
 *  - `/platform/security` — 4. Four control rows at 170-188px come to 734px; a
 *    fifth needs 922px. Compact fits 5, so this is the number with the most
 *    headroom and the least urgency.
 */
const ROWS_PER_FOLD: Record<string, number> = {
  "/platform/estate": 10,
  "/tenants": 3,
  "/platform/security": 4,
}

/**
 * How far the first data row may sit below the top of the table's scroll region.
 *
 * Measured 58px on all three surfaces after the base-scale pass and 50px under
 * compact — a caption plus one header row plus a hairline. (It was 74/62 before
 * the pass, which is where the 96 this constant started at came from.)
 *
 * 80, and it is chosen against specific regressions rather than as slack:
 *
 *   58 + 25 = 83   this table with a SECOND header row
 *   58 + 24 = 82   this table with one more control above the data
 *                  (`--tap` is 24px, the floor for anything hittable)
 *
 * Both land above 80, so both fail; and 22px of margin is enough that a copy edit
 * or a font-metric difference between platforms cannot red the suite on its own.
 * That last part is not hypothetical — CI is Linux/FreeType and this was measured
 * on Windows/DirectWrite, a difference `layout.spec.ts` has already been bitten
 * by once, at 2px, in its section-overflow walk.
 *
 * The property: the table's chrome is a caption and a header. Anything else added
 * above the data has to justify itself by moving this number on purpose.
 */
const TABLE_CHROME_CEILING_PX = 80

/**
 * How far the first data row may sit below the top of the section that presents
 * it — the heading, the summary line, the as-of, any filter control, then the
 * table's own chrome.
 *
 * Measured 211 (`/platform/estate`), 426 (`/tenants`), 196 (`/platform/security`)
 * after the base-scale pass, and 229 / 459 / 215 before it. The ceiling is 560:
 * about 100px above the worst PRE-pass value, which is one heading plus one line
 * of prose of headroom — enough that rewording a summary does not red the suite,
 * not enough to absorb a new panel — and under two thirds of the 836px fold, so
 * the section that carries the facts can never spend a whole screen introducing
 * them.
 *
 * Post-pass this could be 520. It is left at 560 on purpose; the header's
 * "ambitious, or merely current?" section says why, and 520 is the number to move
 * it to once STUDIO-030-001 is committed.
 *
 * This is the assertion that catches "a screen of chrome before the first fact"
 * at the scale a page author actually works at. The page-level version is below
 * and is a much weaker instrument, for a reason stated there.
 */
const SECTION_CHROME_CEILING_PX = 560

/**
 * The page-level version of the same thing, and the one honest caveat in this
 * file: it is a RATCHET, not a standard.
 *
 * Measured from the top of `main` to the first data row: 1294px on
 * `/platform/estate`, 1812 on `/tenants`, 2456 on `/platform/security` after the
 * base-scale pass — 1.5, 2.2 and 2.9 folds; 1408 / 2036 / 2774 before it. The
 * sensible number is ONE fold. Setting it there would red this
 * file on all three surfaces today, and it would red for something the token
 * layer cannot fix: the space above these tables is mostly occupied by the
 * console's own explanations of what it could NOT read. This harness — and CI,
 * which is the same — holds no AWS credentials, so every reader on
 * `/platform/estate` and `/platform/security` returns an unknown state with a
 * paragraph saying which call was refused and why. `aws-unknown-is-not-absent.spec.ts`
 * exists to keep those paragraphs there; they are the product working, and a
 * density test must not become an argument for deleting them.
 *
 * So 3.5 folds: it stops the preamble GROWING, and it says nothing about the
 * preamble being acceptable. Expressed in folds rather than pixels so it scales
 * with the viewport constant above rather than silently loosening if that changes.
 *
 * Post-pass this could be 3.2. Left at 3.5 for the reason in the header, and it is
 * the ceiling where being cautious costs the least: it is already the loosest
 * instrument in the file, and 3.2 would buy ~250px of strictness on the one
 * measurement whose value is dominated by prose somebody may legitimately reword.
 *
 * The number that fixes this properly is not in a stylesheet — it is progressive
 * disclosure, which ADR-0009 names ("fewer simultaneous surfaces per view, with
 * detail behind disclosure"). When that lands, bring this to 1.
 */
const PREAMBLE_FOLD_CEILING = 3.5

/**
 * STUDIO-030-007. WCAG 2.2 AA 2.5.8 — 24 CSS pixels.
 *
 * Here so that density cannot be bought with the touch target, which is the
 * cheapest way to make any of the budgets above pass. Measured over the
 * interactive elements INSIDE the counted rows, in both densities: the three fleet
 * links measured 48x52 on 2026-08-17, so this has real headroom and is not a
 * coincidence waiting to break.
 *
 * Measured on the rendered geometry, never on `--tap`. A test that read the token
 * and compared it to 24 would pass on a control that renders at 12px for any of
 * the ordinary reasons — a `block-size` further down the cascade, a flex parent, an
 * `overflow: hidden` — which is exactly the class of bug it would exist to catch.
 */
const MINIMUM_TAP_PX = 24

/**
 * The fixture floor — how many data rows the densest table must HOLD for the
 * measurement to mean anything. Not a layout budget, and the distinction is the
 * whole reason it is a separate constant.
 *
 * `ROWS_PER_FOLD` is asserted as `>= min(rowsAvailable, budget)` so it can never
 * become a maximum. That shape has one hole: when the table holds fewer rows than
 * the budget, `min` collapses to the row count and the budget stops constraining
 * anything at all. `/tenants` against an unseeded registry is exactly that — the
 * fleet table renders an empty state, the densest table on the page becomes the
 * one-row `Systems bound in blueprints/`, and a nine-row budget is satisfied by
 * one row.
 *
 * So each value here is EQUAL TO its row budget, which is the least data that
 * makes the budget exercise itself, and no more: 10, 3 and 4 against the 21, 3 and
 * 20 rows the harness actually supplies. Estate and security get theirs from
 * static declarations in the app; `/tenants` gets its three from
 * `tools/dev/seed-studio-fleet.mjs`, and that is the one a person will hit.
 *
 * If this file is ever pointed at a registry with fewer than three tenants, THIS
 * is the number to change, and changing it does not weaken the layout budget —
 * it only admits that the measurement is now weaker, which is the honest thing
 * for it to say.
 */
const MINIMUM_ROWS_FOR_A_MEANINGFUL_MEASUREMENT: Record<string, number> = {
  "/platform/estate": 10,
  "/tenants": 3,
  "/platform/security": 4,
}

const ROUTES = Object.keys(ROWS_PER_FOLD)

type Measured = {
  caption: string
  total: number
  perFold: number
  fold: number
  masthead: number
  heights: number[]
  underTable: number
  underSection: number
  underMain: number
  tapFailures: string[]
  interactive: number
}

/**
 * Everything this file asserts on, read in one pass over the DENSEST table on the
 * page.
 *
 * Densest = most data rows, and it is chosen rather than named because these
 * pages each render four to six tables and the one that carries the working set
 * is the long one. Naming it by caption would make this file fail when somebody
 * rewords a caption, which is not a density regression.
 *
 * ## Zero-row tables are candidates, and that is deliberate
 *
 * The obvious way to write the line below is
 * `.filter((candidate) => candidate.rows.length > 0)`, and it is wrong in a way
 * that is invisible: it makes the `total > 0` guard in every test DEAD CODE, and
 * the whole point of that guard is to red rather than pass when the registry was
 * not seeded. With the filter in, an unseeded `/tenants` silently measures the
 * one-row `Systems bound in blueprints/` table instead of the empty fleet table,
 * `min(total, budget)` collapses to 1, and the suite goes green on a console
 * showing no tenants at all. So the sort is on data-row count over ALL tables and
 * a table of zero rows is allowed to win — which is exactly the state the guard
 * needs to see in order to fire.
 *
 * `null` is returned only when the page holds no table whatsoever, which is a
 * different failure and gets a different message.
 */
async function measure(page: Page): Promise<Measured | null> {
  return page.evaluate(
    ({ minimumTap }) => {
      const candidates = Array.from(document.querySelectorAll("table.md3-table, table.grid")).map(
        (table) => ({
          table,
          rows: Array.from(table.querySelectorAll("tbody tr")).filter(
            (row) =>
              // `DataTable` renders its empty state as ONE `.md3-table-empty`
              // row spanning every column. Counting it is how an assertion about
              // rows passes on a table with no data in it.
              !row.classList.contains("md3-table-empty") &&
              row.getBoundingClientRect().height > 0,
          ),
        }),
      )
      if (candidates.length === 0) return null

      candidates.sort((a, b) => b.rows.length - a.rows.length)
      const { table, rows } = candidates[0]

      const masthead = document.querySelector("header.masthead")
      const mastheadHeight = masthead ? Math.round(masthead.getBoundingClientRect().height) : 0
      // A sticky bar takes its height off the top of every scrolled screen.
      const fold = window.innerHeight - mastheadHeight

      const documentTop = (el: Element) => el.getBoundingClientRect().top + window.scrollY
      const caption = (table.querySelector("caption")?.textContent ?? "").trim().slice(0, 60)

      // No data rows anywhere on the page. Return the counts, not the geometry:
      // there is no first row to measure from, and every caller checks `total`
      // before it reads any of the offsets.
      if (rows.length === 0) {
        return {
          caption,
          total: 0,
          perFold: 0,
          fold,
          masthead: mastheadHeight,
          heights: [] as number[],
          underTable: -1,
          underSection: -1,
          underMain: -1,
          tapFailures: [] as string[],
          interactive: 0,
        }
      }

      const firstRowTop = documentTop(rows[0])

      // How many rows fit in one fold, measured from the top of the first one.
      // Contiguous from the first row and stopping at the first that does not
      // fit — not a filter, because "rows that happen to be short enough" is not
      // what an operator sees.
      let perFold = 0
      for (const row of rows) {
        const box = row.getBoundingClientRect()
        if (box.bottom + window.scrollY - firstRowTop > fold + 1) break
        perFold++
      }

      const shell = table.closest(".md3-table-shell") ?? table
      const section = table.closest("section") ?? shell
      const main = document.querySelector("main")

      // Hit areas inside the rows this budget counts.
      const tapFailures: string[] = []
      let interactive = 0
      for (const row of rows.slice(0, Math.max(perFold, 1))) {
        for (const el of Array.from(
          row.querySelectorAll(
            'a[href], button, input, select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])',
          ),
        )) {
          const box = el.getBoundingClientRect()
          if (box.width === 0 && box.height === 0) continue
          interactive++
          if (box.height + 0.5 < minimumTap || box.width + 0.5 < minimumTap) {
            tapFailures.push(
              `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 28)}" ` +
                `${Math.round(box.width)}x${Math.round(box.height)}`,
            )
          }
        }
      }

      return {
        caption,
        total: rows.length,
        perFold,
        fold,
        masthead: mastheadHeight,
        heights: rows.map((row) => Math.round(row.getBoundingClientRect().height)),
        underTable: Math.round(firstRowTop - documentTop(shell)),
        underSection: Math.round(firstRowTop - documentTop(section)),
        underMain: main ? Math.round(firstRowTop - documentTop(main)) : -1,
        tapFailures: [...new Set(tapFailures)].slice(0, 6),
        interactive,
      }
    },
    { minimumTap: MINIMUM_TAP_PX },
  )
}

/** `comfortable` REMOVES the attribute — `lib/preferences.ts` sets it to `null`. */
async function setDensity(page: Page, density: "comfortable" | "compact") {
  await page.evaluate((value) => {
    if (value === "compact") document.documentElement.setAttribute("data-density", "compact")
    else document.documentElement.removeAttribute("data-density")
  }, density)
  // One frame for the cascade; the tokens are CSS custom properties, so the
  // relayout is synchronous, but the read below must not race the paint.
  await page.waitForTimeout(120)
}

/*
 * ── How each assertion in this file was proven to catch something ───────────
 *
 * Every constant was verified by injecting the regression it forbids into the
 * running page with `page.addStyleTag`, confirming the INTENDED assertion reds and
 * that no other one did, and removing it. Injected at run time rather than edited
 * into `globals.css`, because STUDIO-030-001 was editing that file in this working
 * tree at the same time, and a mutation left behind in a shared stylesheet is
 * worse than no proof at all.
 *
 * Run on 2026-08-17 against measurement (B) — a from-scratch build of the tree
 * with the base-scale pass in it — after a clean pass of all five tests:
 *
 *   `.md3-table td { padding-block: 32px }`
 *       → rows/fold 10→6 (estate), 4→3 (security). Those two red on
 *         ROWS_PER_FOLD and nothing else does. `/tenants` stays GREEN, correctly:
 *         its rows go 223→271px and three of them still fit a 836px fold, which
 *         is a fair account of how much slack a 3-row fixture leaves. That is the
 *         cost of the "no maximum" rule and it is the right trade — see
 *         `MINIMUM_ROWS_FOR_A_MEANINGFUL_MEASUREMENT`.
 *   `.md3-table > caption { padding: 44px }`
 *       → first row 58px→130px under the scroll region. All three red on
 *         TABLE_CHROME_CEILING_PX.
 *   `.md3-table-shell { margin-block-start: 420px }`
 *       → section chrome 211→631, 426→846, 196→616. All three red on
 *         SECTION_CHROME_CEILING_PX and NOT on the table ceiling, which is the
 *         whole point of having both: the two failures name different edits.
 *   `main { padding-block-start: 1400px }`
 *       → preamble 1812→3200 and 2456→3844. `/tenants` and `/platform/security`
 *         red on PREAMBLE_FOLD_CEILING; `/platform/estate` stays green at 2694 of
 *         2926, which is an honest account of how loose that ceiling is.
 *   `:root[data-density="compact"] .md3-table td { padding-block: 40px }`
 *       → compact fits 5 where comfortable fits 10. ONLY the compact test reds,
 *         and the three per-surface tests stay green — a "compact" looser than the
 *         default is invisible to a budget written on the default alone, which is
 *         why STUDIO-030-005 gets its own test here.
 *   `.md3-table td a { block-size: 12px; inline-size: 12px }`
 *       → the fleet links go 48x52 → 12x12. `/tenants` and the compact test red on
 *         MINIMUM_TAP_PX; estate and security stay green because their rows hold
 *         nothing interactive — which is why the non-vacuity test exists.
 *   removing the `<a>` from every fleet row
 *       → only the non-vacuity test reds.
 *   emptying the registry for real, with `tools/dev/reset-registry-table.mjs`
 *       → `/tenants`' densest table degrades to the one-row
 *         `Systems bound in blueprints/` and the fixture floor reds with the
 *         seeding commands attached. This is the trap in the brief reproduced end
 *         to end: WITHOUT that floor the same run was a GREEN report about a
 *         console showing no tenants at all. Estate and security stayed green,
 *         correctly — neither reads the registry.
 *
 * ## One thing this file finds and deliberately does not assert
 *
 * The `open` links in `/tenants`' `Tenants needing an operator, worst first` table
 * measure 29x17 CSS pixels, with no `::before`/`::after` carrying an expanded hit
 * area. That is under WCAG 2.2 AA 2.5.8 and it is a real defect — but it belongs to
 * STUDIO-030-007, whose own spec measures targets across every theme and density
 * combination, and it is in a DIFFERENT table from the one this budget measures.
 * Widening the check here to every table on the page would red this file for a
 * fault it is not about and cannot fix. Recorded rather than asserted, so the next
 * person finds it instead of rediscovering it.
 */

/*
 * ── The budget, per surface, in the default density ────────────────────────
 */
for (const route of ROUTES) {
  test(`${route} shows a working set in one fold`, async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
    await signIn(page)
    await page.goto(route)
    await page.waitForLoadState("networkidle")
    await setDensity(page, "comfortable")

    const measured = await measure(page)
    expect(
      measured,
      `${route} rendered no data table at all. Either the page changed shape or this spec is ` +
        `pointed at the wrong console; it is not a density result.`,
    ).not.toBeNull()
    const m = measured!

    /*
     * The vacuous-pass guard, and it is first on purpose.
     *
     * The row assertion below is `>= min(total, budget)`, which is satisfied by
     * one row when the table holds one — and the fleet table holds NONE against a
     * registry with no items, which is the state of this console on any machine
     * that has not run the seeder. A green suite there would be the worst outcome
     * available: the test reporting that density is fine because it found nothing
     * to measure.
     */
    expect(
      m.total,
      `${route}: the densest table on the page ("${m.caption}") holds ${m.total} data rows, and ` +
        `${MINIMUM_ROWS_FOR_A_MEANINGFUL_MEASUREMENT[route]} is what this budget needs in order to ` +
        `measure anything — below that, \`min(total, budget)\` collapses and every row assertion ` +
        `below passes vacuously. Seed the registry first:\n` +
        `  npx dynalite@3.2.2 --port 8001\n` +
        `  AWS_ENDPOINT_URL_DYNAMODB=http://127.0.0.1:8001 TENANT_TABLE=tenure-tenants-ci ` +
        `node tools/create-registry-table.mjs\n` +
        `  AWS_ENDPOINT_URL_DYNAMODB=http://127.0.0.1:8001 TENANT_TABLE=tenure-tenants-ci ` +
        `node tools/dev/seed-studio-fleet.mjs`,
    ).toBeGreaterThanOrEqual(MINIMUM_ROWS_FOR_A_MEANINGFUL_MEASUREMENT[route])

    const budget = ROWS_PER_FOLD[route]
    /*
     * `min`, not the budget. A surface that holds fewer rows than the budget must
     * show all of them and must not fail for the estate being small — the
     * property is "the layout does not waste the viewport", never "there are
     * always N rows".
     */
    const required = Math.min(m.total, budget)
    expect(
      m.perFold,
      `${route}: ${m.perFold} of ${m.total} rows of "${m.caption}" fit in one fold; ${required} is ` +
        `the floor (budget ${budget}, capped at the ${m.total} rows this surface holds).\n` +
        `  fold        ${m.fold}px (${VIEWPORT.height}px viewport less a ${m.masthead}px sticky masthead)\n` +
        `  row heights ${m.heights.slice(0, 12).join(", ")}${m.heights.length > 12 ? ", …" : ""}\n` +
        `  This is padding, line height, or a cell that grew a paragraph. It is the number ` +
        `ADR-0009 means by "every 4px of padding on a row costs a row of the estate at the bottom ` +
        `of the screen".`,
    ).toBeGreaterThanOrEqual(required)

    expect(
      m.underTable,
      `${route}: the first data row of "${m.caption}" is ${m.underTable}px below the top of its ` +
        `scroll region; ${TABLE_CHROME_CEILING_PX}px is the ceiling. A caption and one header row ` +
        `measured 58px. Anything else above the data — a second header row, a toolbar, a legend — ` +
        `costs every table in the console a row.`,
    ).toBeLessThanOrEqual(TABLE_CHROME_CEILING_PX)

    expect(
      m.underSection,
      `${route}: the section presenting "${m.caption}" spends ${m.underSection}px between its own ` +
        `top and its first fact; ${SECTION_CHROME_CEILING_PX}px is the ceiling, which is under two ` +
        `thirds of the ${m.fold}px fold. A section that introduces its data for a whole screen has ` +
        `buried it.`,
    ).toBeLessThanOrEqual(SECTION_CHROME_CEILING_PX)

    const preambleCeiling = Math.round(PREAMBLE_FOLD_CEILING * m.fold)
    expect(
      m.underMain,
      `${route}: ${m.underMain}px of page above the first data row — ` +
        `${(m.underMain / m.fold).toFixed(1)} folds, against a ceiling of ${PREAMBLE_FOLD_CEILING} ` +
        `(${preambleCeiling}px). This ceiling is a ratchet at roughly today's value, not a ` +
        `standard: read the PREAMBLE_FOLD_CEILING comment before raising it. What it forbids is ` +
        `ADDING to the preamble.`,
    ).toBeLessThanOrEqual(preambleCeiling)

    // Density is not paid for out of the touch target.
    expect(
      m.tapFailures,
      `${route}: interactive elements inside the counted rows are under ${MINIMUM_TAP_PX}px ` +
        `(WCAG 2.2 AA 2.5.8). Rows may be visually compact; the HIT AREA may not shrink with them.`,
    ).toEqual([])
  })
}

/*
 * ── STUDIO-030-005: the toggle still exists, and compact loses nothing ─────
 *
 * The instruction this file implements moves the BASE that the density
 * preference sits around; it does not delete the preference. Two things follow
 * and both are asserted here rather than assumed:
 *
 *   * compact must never show FEWER rows than comfortable. A "compact" that
 *     grew a row is a mislabelled control, and nothing else in the suite would
 *     notice — `preferences.spec.ts` measures contrast and `--tap` in every
 *     combination, not how much fits.
 *   * compact must show the SAME rows. "Without information loss" is the item's
 *     own wording; a density achieved by dropping rows is not a density.
 *
 * One test over all three surfaces rather than three, because the failure it
 * describes is a property of the token layer and would appear on all of them at
 * once.
 */
test("compact tightens the same information, on every dense surface", async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await signIn(page)

  const report: string[] = []
  for (const route of ROUTES) {
    await page.goto(route)
    await page.waitForLoadState("networkidle")

    await setDensity(page, "comfortable")
    const comfortable = await measure(page)
    await setDensity(page, "compact")
    const compact = await measure(page)

    expect(comfortable, `${route} rendered no data table`).not.toBeNull()
    expect(compact, `${route} rendered no data table under compact`).not.toBeNull()
    const roomy = comfortable!
    const tight = compact!

    expect(
      roomy.total,
      `${route}: the densest table holds ${roomy.total} rows, under the ` +
        `${MINIMUM_ROWS_FOR_A_MEANINGFUL_MEASUREMENT[route]} this comparison needs. See the ` +
        `seeding commands on the per-surface tests.`,
    ).toBeGreaterThanOrEqual(MINIMUM_ROWS_FOR_A_MEANINGFUL_MEASUREMENT[route])

    expect(
      tight.total,
      `${route}: compact shows ${tight.total} rows of "${tight.caption}" where comfortable shows ` +
        `${roomy.total}. Compact tightens SPACE; a compact view that drops a row has lost ` +
        `information, which STUDIO-030-005 forbids in those words.`,
    ).toBe(roomy.total)

    expect(
      tight.perFold,
      `${route}: compact fits ${tight.perFold} rows in a fold and comfortable fits ` +
        `${roomy.perFold}. Compact must never fit fewer — that is the whole of what the control ` +
        `claims to do.`,
    ).toBeGreaterThanOrEqual(roomy.perFold)

    expect(
      tight.tapFailures,
      `${route}: compact shrank a hit area below ${MINIMUM_TAP_PX}px. \`--tap\` is the one token ` +
        `compact does not reduce (globals.css, \`:root[data-density="compact"]\`), and this is the ` +
        `assertion that says so from the rendered geometry rather than from the stylesheet.`,
    ).toEqual([])

    report.push(
      `${route}: ${roomy.perFold} → ${tight.perFold} rows/fold, ${roomy.total} rows either way`,
    )
  }

  // Printed rather than asserted on. The assertions are above; this is so a
  // green run still tells the next person what the current numbers ARE, which is
  // what they need in order to raise the budgets after the base-scale pass.
  console.log(`density budget — ${report.join(" | ")}`)
})

/*
 * The `tapFailures` assertions are `[]`-valued: they pass on a page where nothing
 * inside a row is interactive, which is true of `/platform/estate` and
 * `/platform/security` and is the shape in which a check quietly stops checking.
 * `/tenants` puts a link to each tenant in its rows, so that is where the
 * non-vacuity of the whole hit-area half of this file is pinned.
 */

test("the hit-area check in this file is not vacuous", async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await signIn(page)
  await page.goto("/tenants")
  await page.waitForLoadState("networkidle")
  await setDensity(page, "comfortable")

  const m = await measure(page)
  expect(m, "/tenants rendered no data table").not.toBeNull()
  /*
   * `/tenants` is the surface that carries interactive elements inside its data
   * rows — one link per tenant. If that stops being true, the `MINIMUM_TAP_PX`
   * assertions on every surface above are passing over an empty set and this
   * file has stopped defending the touch target. Asserted separately so the
   * failure says THAT, rather than a density budget failing for an unrelated
   * reason.
   */
  expect(
    m!.interactive,
    `no interactive element was found inside the counted rows of "${m!.caption}", so this file's ` +
      `${MINIMUM_TAP_PX}px assertions measured nothing. Either the fleet table lost its per-tenant ` +
      `link or the seeder did not run.`,
  ).toBeGreaterThan(0)
})
