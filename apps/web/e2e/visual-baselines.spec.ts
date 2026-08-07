import { test, expect, type Page } from "@playwright/test"
import { signIn } from "./support/auth"

/**
 * TTES-020-004 — the state / theme / density / locale / viewport matrix.
 *
 * WHAT WAS MISSING
 *
 * Fourteen SurfaceStates, seven button variants at six sizes, seven badge tones
 * and five field shapes ship today, and every one of them is reached only when a
 * production caller happens to be in that state. `states.test.ts` asserts on the
 * semantics table and on the component's source text; nothing renders `conflict`
 * in dark mode at 320px, or a disabled `destructive` button under
 * `prefers-contrast: more`. So nothing had ever looked at them.
 *
 * `/gallery` renders the catalogue, derived from `states.ts` and from Button's
 * and Badge's own variant maps. This walks it.
 *
 * WHY THE BASELINES ARE PINNED TO LINUX
 *
 * Font rasterisation is a property of the platform, not of the page: the same
 * self-hosted Inter renders through DirectWrite on Windows and FreeType on
 * Linux, and the two disagree on nearly every antialiased pixel. A baseline
 * captured on a developer's machine therefore reds CI on the first run and stays
 * red, which is how visual suites get deleted.
 *
 * So `playwright.config.ts` gives this spec its own project whose
 * `snapshotPathTemplate` carries no `{platform}` segment, and the baselines in
 * `e2e/__screenshots__` are generated in
 * `mcr.microsoft.com/playwright:v1.61.1-noble` — the same family CI's
 * `ubuntu-latest` runner uses. The guard below is what keeps that honest: on any
 * other platform the spec SKIPS rather than comparing, because a comparison
 * there would be measuring the operating system.
 *
 * To regenerate after a deliberate design change, with the app served on the
 * host at :3000:
 *
 *   docker run --rm -v "$PWD:/work" -w /tmp/pw \
 *     -e PLAYWRIGHT_BASE_URL=http://host.docker.internal:3000 \
 *     -e DEV_LOGIN_PASSPHRASE=... -e TENURE_VISUAL_ROOT=/work/apps/web \
 *     mcr.microsoft.com/playwright:v1.61.1-noble \
 *     bash -lc 'npm i -D @playwright/test@1.61.1 >/dev/null &&
 *               npx playwright test --config /work/apps/web/playwright.config.ts \
 *                 --project=visual --update-snapshots'
 *
 * WHAT MAKES IT FAIL RATHER THAN DRIFT
 *
 *  * The per-entry pass names each screenshot after the catalogue id, and the
 *    ids come from the DOM the catalogue produced. Adding a fifteenth
 *    SurfaceState, or an eighth Button variant, produces a name with no baseline
 *    on disk and Playwright fails with "A snapshot doesn't exist" — which is the
 *    whole point: a new state cannot ship unphotographed.
 *  * The matrix pass captures the entire catalogue per cell, so changing a TONE
 *    class in StateSurface, a control height in the density contract, or a
 *    logical-property mistake that only shows in RTL, fails the cells it affects
 *    and names them.
 */

type ThemeName = "light" | "dark" | "contrast"
type DensityName = "comfortable" | "compact"
type Direction = "ltr" | "rtl"

const THEMES: ThemeName[] = ["light", "dark", "contrast"]
const DENSITIES: DensityName[] = ["comfortable", "compact"]
const DIRECTIONS: Direction[] = ["ltr", "rtl"]
/** 320 is the WCAG 1.4.10 reflow floor; 768 is the drawer breakpoint side; 1440 is the working width. */
const WIDTHS = [320, 768, 1440]

/**
 * Baselines are captured in the linux container named in the header. Comparing
 * them anywhere else measures the host's font rasteriser rather than the page.
 */
const PINNED_PLATFORM = "linux"

/**
 * Puts the page in one cell of the matrix and loads the gallery.
 *
 * Theme and density go through localStorage because that is the real mechanism:
 * the pre-hydration script in `src/app/layout.tsx` reads those exact keys and
 * stamps `html.dark` / `html[data-density]` before first paint. Emulating a
 * `prefers-color-scheme` instead would exercise a branch the product only takes
 * for "system", and would never touch the density contract at all.
 *
 * Direction is a search param the route puts on the catalogue container — see
 * the header of `src/app/(app)/gallery/page.tsx` for why it is not `<html dir>`.
 */
async function enter(
  page: Page,
  cell: { theme: ThemeName; density: DensityName; dir: Direction; width: number },
) {
  await page.setViewportSize({ width: cell.width, height: 900 })
  await page.emulateMedia({
    colorScheme: cell.theme === "dark" ? "dark" : "light",
    contrast: cell.theme === "contrast" ? "more" : "no-preference",
    reducedMotion: "reduce",
  })
  await page.evaluate(
    ([theme, density]) => {
      localStorage.setItem("tenure-theme", theme)
      localStorage.setItem("tenure-density", density)
    },
    [cell.theme === "dark" ? "dark" : "light", cell.density],
  )

  await page.goto(`/gallery?dir=${cell.dir}`)
  await expect(page.locator("[data-gallery-root]")).toBeVisible()

  // The document has to actually be in the state we asked for; a silently
  // ignored preference would produce 36 identical screenshots that all pass.
  await expect(page.locator("html")).toHaveAttribute("data-density", cell.density)
  const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"))
  expect(isDark).toBe(cell.theme === "dark")

  // Self-hosted next/font faces swap in after first paint. Without this the
  // first cell in a run is captured in the fallback face and every later cell
  // in Inter, and the difference is every glyph on the page.
  await page.evaluate(() => document.fonts.ready)
}

test.describe("visual baselines", () => {
  test.skip(
    process.platform !== PINNED_PLATFORM,
    `Visual baselines are pinned to ${PINNED_PLATFORM} (see the header of this file). On ${process.platform} a comparison measures the host font rasteriser, not the page.`,
  )

  test.beforeEach(async ({ page }) => {
    await signIn(page, "Dana Whitfield")
  })

  for (const theme of THEMES) {
    for (const density of DENSITIES) {
      for (const dir of DIRECTIONS) {
        for (const width of WIDTHS) {
          const cell = { theme, density, dir, width }
          test(`catalogue · ${theme} · ${density} · ${dir} · ${width}px`, async ({ page }) => {
            await enter(page, cell)
            await expect(page.locator("[data-gallery-root]")).toHaveScreenshot(
              `catalogue-${theme}-${density}-${dir}-${width}.png`,
              { animations: "disabled", caret: "hide" },
            )
          })
        }
      }
    }
  }

  /**
   * One canonical cell, one screenshot per catalogue entry.
   *
   * This is the pass that turns "somebody added a state" into a hard failure
   * rather than a diff: the names come from `[data-gallery-entry]`, which the
   * page renders from the catalogue, which reads `ALL_STATES` and the variant
   * maps. A new entry has no file in `e2e/__screenshots__`, and a missing
   * baseline is an error, not a silently-created file (Playwright only writes
   * one when `--update-snapshots` is passed).
   */
  test("every catalogue entry has its own baseline", async ({ page }) => {
    await enter(page, { theme: "light", density: "comfortable", dir: "ltr", width: 1440 })

    const ids = await page.locator("[data-gallery-entry]").evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-gallery-entry") ?? ""),
    )

    // A page that rendered nothing would otherwise pass this test loudly.
    expect(ids.length).toBeGreaterThan(60)
    expect(new Set(ids).size).toBe(ids.length)
    // Anchors from each derived source, so a catalogue that quietly stopped
    // reading one of them fails here rather than in a diff nobody opens.
    expect(ids).toContain("surface-high-risk-confirm")
    expect(ids).toContain("surface-conflict-rows")
    expect(ids).toContain("button-destructive-disabled")
    expect(ids).toContain("badge-accent")

    for (const id of ids) {
      await expect(page.locator(`[data-gallery-entry="${id}"]`)).toHaveScreenshot(`entry-${id}.png`, {
        animations: "disabled",
        caret: "hide",
      })
    }
  })
})
