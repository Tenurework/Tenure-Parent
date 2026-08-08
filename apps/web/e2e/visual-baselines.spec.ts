import { readFileSync } from "fs"
import { test, expect, type Page } from "@playwright/test"
import { ALL_STATES } from "../src/components/ui/states"
import { signIn } from "./support/auth"

/**
 * TTES-020-004 — the state / theme / density / locale / viewport matrix.
 *
 * WHAT WAS MISSING
 *
 * Fourteen SurfaceStates, seven button variants at six sizes, seven badge tones
 * and six field shapes ship today, and every one of them is reached only when a
 * production caller happens to be in that state. `states.test.ts` asserts on the
 * semantics table and on the component's source text; nothing renders `conflict`
 * in dark mode at 320px, or a disabled `destructive` button under
 * `prefers-contrast: more`. So nothing had ever looked at them.
 *
 * `/gallery` renders the catalogue, derived from `states.ts` and from Button's
 * and Badge's own variant maps. This walks it.
 *
 * WHY THE BASELINES ARE PINNED TO ONE CONTAINER IMAGE
 *
 * Font rasterisation is a property of the platform, not of the page: the same
 * self-hosted Inter renders through DirectWrite on Windows and FreeType on
 * Linux, and the two disagree on nearly every antialiased pixel. Even between
 * two Linux hosts the answer depends on which fontconfig rules are installed. A
 * baseline captured anywhere else therefore reds CI on the first run and stays
 * red, which is how visual suites get deleted — and it is exactly how the first
 * attempt at this spec died (`db95980`, 37/37 red, withdrawn in `a8ceb8b`).
 *
 * So the comparison happens in ONE environment and only there:
 * `mcr.microsoft.com/playwright:v1.61.1-noble`. `playwright.config.ts` gives
 * this spec its own project whose `snapshotPathTemplate` carries no `{platform}`
 * segment, `e2e/__screenshots__` holds the PNGs that image produced, and
 * `.github/workflows/ci.yml` runs this project by launching that same image
 * against the server the `e2e` job already has running.
 *
 * `runningInPinnedImage()` below is what keeps that honest. It fingerprints the
 * image rather than trusting a flag someone can export: the image is the only
 * place where linux, `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` and an
 * `/etc/os-release` saying `noble` are all true at once — a bare `ubuntu-latest`
 * runner with `npx playwright install` puts its browsers in `~/.cache` and
 * leaves that variable unset. Anywhere else the spec SKIPS, with the reason
 * naming which check failed, because a comparison there measures the operating
 * system instead of the page.
 *
 * To regenerate after a deliberate design change, with the app served on the
 * host (any port; `PORT`/`-p` and the URL below just have to agree):
 *
 *   docker run --rm -v "$PWD:/work" -w /work/apps/web \
 *     -e PLAYWRIGHT_BASE_URL=http://host.docker.internal:3462 \
 *     -e DEV_LOGIN_PASSPHRASE=... \
 *     mcr.microsoft.com/playwright:v1.61.1-noble \
 *     node /work/node_modules/@playwright/test/cli.js test \
 *       --project=visual --workers=4 --update-snapshots
 *
 * (On a Linux host `--network host` and `http://localhost:3462` work as well;
 * `host.docker.internal` is what reaches the host from Docker Desktop. The
 * repository's own node_modules are used directly — `playwright-core` is pure
 * JavaScript, and the image already carries the matching browser build, so no
 * second install is needed and no version can drift between the two.)
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

/** The image the committed baselines were produced in. */
const PINNED_IMAGE = "mcr.microsoft.com/playwright:v1.61.1-noble"

/**
 * Fingerprint the container the baselines belong to.
 *
 * Returns `null` when this is that container, or the reason it is not. Three
 * independent facts, because any one of them alone is either forgeable or
 * accidental:
 *
 *   · platform — rules out every developer machine at once.
 *   · PLAYWRIGHT_BROWSERS_PATH=/ms-playwright — the Playwright images set this
 *     because their browsers are baked in at build time. `npx playwright
 *     install` on a bare runner does not; it uses `~/.cache/ms-playwright` and
 *     leaves the variable unset. This is the check that separates the image from
 *     `ubuntu-latest`.
 *   · os-release codename — the images are versioned by Ubuntu release, and a
 *     jammy image rasterises differently from a noble one.
 */
function pinnedImageMismatch(): string | null {
  if (process.platform !== "linux") return `platform is ${process.platform}, not linux`
  if (process.env.PLAYWRIGHT_BROWSERS_PATH !== "/ms-playwright") {
    return `PLAYWRIGHT_BROWSERS_PATH is ${process.env.PLAYWRIGHT_BROWSERS_PATH ?? "unset"}, not /ms-playwright — this is not a Playwright container image`
  }
  let osRelease = ""
  try {
    osRelease = readFileSync("/etc/os-release", "utf8")
  } catch {
    return "/etc/os-release is unreadable"
  }
  if (!/VERSION_CODENAME=noble/.test(osRelease)) return "the base image is not Ubuntu noble"
  return null
}

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
  /**
   * The one spec in this suite that may run its own tests concurrently.
   *
   * `playwright.config.ts` sets `fullyParallel: false` because the flow specs
   * share seeded data and mutate it — an approval approved twice is a different
   * test. Nothing here writes: every test signs in (JWT sessions, `auth.ts:62`,
   * so not even a row), reads `/gallery`, and photographs it. Without this the
   * four tests are one file on one worker no matter what `--workers` says,
   * because Playwright parallelises across files rather than within them.
   */
  test.describe.configure({ mode: "parallel" })

  const mismatch = pinnedImageMismatch()
  test.skip(
    mismatch !== null,
    `Visual baselines are pinned to ${PINNED_IMAGE} (see the header of this file): ${mismatch}. Comparing here would measure the host font rasteriser, not the page.`,
  )

  test.beforeEach(async ({ page }) => {
    await signIn(page, "Dana Whitfield")
  })

  /**
   * One test per theme, twelve cells inside it — not thirty-six tests.
   *
   * Thirty-six tests meant thirty-six browser contexts and thirty-six sign-ins to
   * photograph a route that never changes between them, which is most of the
   * suite's cost for none of its coverage. The cells are identical either way;
   * what moves is how many times the harness is paid for.
   *
   * `expect.soft` is what keeps that from costing a report: a hard assertion
   * would abandon the remaining eleven cells at the first diff, so a theme-wide
   * regression would be reported as one cell and re-run three times before
   * anyone saw the shape of it. Soft failures accumulate and the test still
   * fails, and each one names its own baseline file.
   */
  for (const theme of THEMES) {
    test(`catalogue · ${theme}`, async ({ page }) => {
      for (const density of DENSITIES) {
        for (const dir of DIRECTIONS) {
          for (const width of WIDTHS) {
            await enter(page, { theme, density, dir, width })
            await expect
              .soft(page.locator("[data-gallery-root]"))
              .toHaveScreenshot(`catalogue-${theme}-${density}-${dir}-${width}.png`, {
                animations: "disabled",
                caret: "hide",
              })
          }
        }
      }
    })
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

    const ids = await page
      .locator("[data-gallery-entry]")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-gallery-entry") ?? ""))

    // A page that rendered nothing — or an error page, or a sign-in redirect —
    // would otherwise pass this test loudly.
    //
    // The count is DERIVED, not guessed. `> 60` used to sit here: a number
    // chosen to be above nothing and below the real 90, so it failed for the
    // right reason by accident rather than by design. `ALL_STATES` is the table
    // the catalogue reads, and the surfaces group renders each state twice (bare
    // and wrapping rows), so a fifteenth state fails HERE with a count as well as
    // below with a missing baseline — and neither number goes stale.
    const idsWith = (prefix: string) => ids.filter((id) => id.startsWith(prefix))
    expect(idsWith("surface-")).toHaveLength(ALL_STATES.length * 2)
    // Every group renders something. A catalogue group that started returning an
    // empty array would otherwise take its entries out of the matrix silently.
    for (const prefix of ["button-", "badge-", "field-"]) {
      expect(idsWith(prefix).length, `no catalogue entries with the ${prefix} prefix`).toBeGreaterThan(0)
    }
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
