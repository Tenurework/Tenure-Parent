import fs from "fs"
import path from "path"
import { test, type Page } from "@playwright/test"

/**
 * TTES-050-001 — what a persona actually has to do to finish a job.
 *
 * The scorecard the Bible asks for ("measure by persona and task: navigation
 * steps and context loss … time-to-object/action") had nothing behind it. This
 * is the left-hand side of it: a journey runs through the real UI, and the
 * browser — not the spec's own bookkeeping — counts what the user had to do.
 *
 * Four numbers are recorded per journey, and the first four are the ones that
 * are gated:
 *
 *   clicks        trusted pointer clicks the user made
 *   keystrokes    trusted key presses the user made
 *   navigations   committed main-frame navigations
 *   routes        distinct pathnames visited — the Bible's "context loss"
 *   wallClockMs   observed only. See `docs/architecture/ux-task-scorecard.md`:
 *                 it is a property of the machine, not of the product, and a
 *                 budget on it would be a flake generator in CI.
 *
 * `isTrusted` is the whole reason this is measured in the page rather than by
 * wrapping the Playwright API. A trusted event is one the browser synthesised
 * from real input, which is what `locator.click()` and `keyboard.press()`
 * produce; an untrusted one comes from JavaScript. So a journey cannot inflate
 * or deflate its own score by dispatching events, and — the case that matters —
 * `locator.fill()` is visible as an untrusted `input` event, because filling a
 * field is not typing it. A journey that fills has hidden its keystroke cost,
 * and `untypedInputs` is checked at zero for exactly that reason.
 */

/** One journey's observed cost. */
export type JourneyMeasurement = {
  id: string
  persona: string
  journey: string
  clicks: number
  keystrokes: number
  navigations: number
  routes: number
  /** Fields written with `fill()` instead of typed. Must be 0 for a measured journey. */
  untypedInputs: number
  wallClockMs: number
}

/** One row of the checked-in scorecard. */
export type JourneyBudget = {
  id: string
  persona: string
  journey: string
  /** `null` means the row is declared but has never been measured — see parseScorecard. */
  clicks: number | null
  keystrokes: number | null
  navigations: number | null
  routes: number | null
}

export const SCORECARD_PATH = path.resolve(
  __dirname,
  "../../../../docs/architecture/ux-task-scorecard.md",
)

/** Where a run leaves what it saw. Gitignored; the scorecard is the committed artefact. */
export const OBSERVATIONS_PATH = path.resolve(__dirname, "../../test-results/journey-metrics.json")

const GATED = ["clicks", "keystrokes", "navigations", "routes"] as const

/**
 * Read the budget table out of the scorecard.
 *
 * The table is markdown rather than JSON because the numbers exist to be read
 * by a person deciding whether a journey got worse, and a JSON file next to a
 * prose document is a JSON file nobody opens. The shape is fixed:
 *
 *   | `J01-first-day` | Club member | 3 | 0 | 3 | 3 |
 *
 * A cell of `—` means "declared, never measured" and parses to null. That is
 * deliberately not the same as a missing row: a missing row is a journey nobody
 * has admitted exists, and `measureJourney` fails on it.
 */
export function parseScorecard(markdown: string): Map<string, JourneyBudget> {
  const out = new Map<string, JourneyBudget>()
  for (const line of markdown.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue
    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim())
    if (cells.length < 7) continue
    const id = /^`([A-Za-z0-9][A-Za-z0-9-]*)`$/.exec(cells[0])?.[1]
    if (!id) continue

    const number = (cell: string): number | null => {
      if (/^[—-]$/.test(cell)) return null
      const n = Number(cell.replace(/[, ]/g, ""))
      // A cell that is neither a dash nor a number is a typo, and silently
      // reading it as "unmeasured" would switch a journey's gate off.
      if (!Number.isFinite(n)) throw new Error(`${SCORECARD_PATH}: row ${id} has "${cell}" where a count or — belongs`)
      return n
    }

    if (out.has(id)) throw new Error(`${SCORECARD_PATH}: journey ${id} has two rows`)
    out.set(id, {
      id,
      persona: cells[1],
      journey: cells[2],
      clicks: number(cells[3]),
      keystrokes: number(cells[4]),
      navigations: number(cells[5]),
      routes: number(cells[6]),
    })
  }
  return out
}

export function loadBudgets(): Map<string, JourneyBudget> {
  return parseScorecard(fs.readFileSync(SCORECARD_PATH, "utf8"))
}

/** Is every gated column of this row a real number? */
export function isMeasured(budget: JourneyBudget): boolean {
  return GATED.every((k) => budget[k] !== null)
}

/**
 * What is wrong with this measurement, in the reader's words.
 *
 * Returns an empty array when the journey is within budget. `<=`, not `===`:
 * making a job take fewer clicks is the point, and a run that beats its budget
 * says so in the observations file so the budget can be tightened.
 */
export function budgetViolations(
  measured: JourneyMeasurement,
  budget: JourneyBudget,
): string[] {
  const problems: string[] = []

  if (measured.persona !== budget.persona) {
    problems.push(
      `persona is "${measured.persona}" but the scorecard row says "${budget.persona}" — the baseline was measured for a different user`,
    )
  }

  if (measured.untypedInputs > 0) {
    problems.push(
      `${measured.untypedInputs} field(s) were filled rather than typed, so this journey's keystroke count is not the user's. Use pressSequentially() in a measured journey.`,
    )
  }

  for (const key of GATED) {
    const allowed = budget[key]
    if (allowed === null) continue
    if (measured[key] > allowed) {
      problems.push(`${key}: ${measured[key]} > budget ${allowed}`)
    }
  }
  return problems
}

/** The row a human pastes back into the scorecard once a measurement is reviewed. */
export function scorecardRow(m: JourneyMeasurement): string {
  return `| \`${m.id}\` | ${m.persona} | ${m.journey} | ${m.clicks} | ${m.keystrokes} | ${m.navigations} | ${m.routes} |`
}

type Counters = {
  clicks: number
  keystrokes: number
  untypedInputs: number
  /** Every pathname the page has landed on since instrumentation, in order. */
  routes: string[]
}

const instrumented = new WeakMap<Page, Counters>()

/**
 * The listener set, as it runs inside the page.
 *
 * Declared as a named function so the same body can be installed two ways: as
 * an init script for every document the journey navigates to, and directly into
 * the document that is already open when a journey starts. `addInitScript`
 * only reaches FUTURE documents, so without the second install the first page
 * of every journey would be uncounted — which is the page most journeys spend
 * their first three clicks on.
 *
 * Route changes are detected from `history`, not from Playwright's
 * `framenavigated`, because the App Router moves between routes with
 * `pushState` and no document ever unloads. A journey that walks the side nav
 * would otherwise register as one navigation regardless of how far it walked.
 */
function pageListeners(): void {
  const w = window as unknown as Record<string, unknown>
  if (w.__tenureJourneyInstalled) return
  w.__tenureJourneyInstalled = true

  const report = (kind: string) => {
    const fn = w.__tenureJourneyEvent
    if (typeof fn === "function") (fn as (k: string) => unknown)(kind)
  }

  // Capture phase, so a handler that stops propagation cannot hide the cost.
  addEventListener("click", (e) => { if (e.isTrusted) report("click") }, true)
  addEventListener("keydown", (e) => { if (e.isTrusted) report("keystroke") }, true)
  // Text that appeared without anybody pressing a key. Two shapes, because
  // `locator.fill()` has used both: setting `.value` and dispatching an
  // untrusted `input`, and driving the browser's own text insertion, which is
  // trusted and produces no keydown at all. A single key press can insert one
  // character, so `data` longer than that did not come from one.
  addEventListener(
    "input",
    (e) => {
      const inserted = typeof (e as InputEvent).data === "string" ? (e as InputEvent).data!.length : 0
      if (!e.isTrusted || inserted > 1) report("untypedInput")
    },
    true,
  )

  let last = ""
  const settle = () => {
    if (location.pathname === last) return
    last = location.pathname
    report(`route:${last}`)
  }
  settle()

  for (const name of ["pushState", "replaceState"] as const) {
    const original = history[name]
    history[name] = function (this: History, ...args: unknown[]) {
      const result = (original as (...a: unknown[]) => unknown).apply(this, args)
      settle()
      return result
    } as typeof history.pushState
  }
  addEventListener("popstate", settle)
}

/**
 * Install the counters on a page, once.
 *
 * `exposeBinding` and `addInitScript` both survive navigation — Playwright
 * reinstalls them into every new document — which is what makes a multi-page
 * journey countable at all. Calling either twice on the same page throws, hence
 * the WeakMap.
 */
async function instrument(page: Page): Promise<Counters> {
  const existing = instrumented.get(page)
  if (existing) return existing

  const counters: Counters = { clicks: 0, keystrokes: 0, untypedInputs: 0, routes: [] }
  instrumented.set(page, counters)

  await page.exposeBinding("__tenureJourneyEvent", (_source, kind: string) => {
    if (kind === "click") counters.clicks++
    else if (kind === "keystroke") counters.keystrokes++
    else if (kind === "untypedInput") counters.untypedInputs++
    else if (kind.startsWith("route:")) counters.routes.push(kind.slice("route:".length))
  })

  await page.addInitScript(pageListeners)
  // …and into the document that is already open. The guard inside
  // `pageListeners` makes this idempotent with the init script.
  await page.evaluate(pageListeners)

  return counters
}

export type JourneyDeclaration = {
  /** Matches the first column of the scorecard. */
  id: string
  /** Matches the second column. Changing who does the job invalidates the baseline. */
  persona: string
  /** Human sentence for the third column. */
  journey: string
}

/**
 * Run a journey, count what it cost, and hold it to the committed budget.
 *
 * Called by `e2e/journeys.spec.ts`. Sign-in is deliberately outside the
 * measured window: the persona buttons are the dev-login stand-in for SSO, so
 * their cost is a property of the fixture rather than of the product.
 */
export async function measureJourney(
  page: Page,
  declaration: JourneyDeclaration,
  body: () => Promise<void>,
): Promise<JourneyMeasurement> {
  const budgets = loadBudgets()
  const budget = budgets.get(declaration.id)
  if (!budget) {
    throw new Error(
      `Journey "${declaration.id}" has no row in ${SCORECARD_PATH}. Add one — with — for the counts if it has never been measured — so the journey is at least declared.`,
    )
  }

  const counters = await instrument(page)
  // Taken after instrumentation, so the page the journey STARTS on is not
  // charged to it: the user is already there.
  const before = { clicks: counters.clicks, keystrokes: counters.keystrokes, untypedInputs: counters.untypedInputs, routeCount: counters.routes.length }

  const started = Date.now()
  await body()
  const wallClockMs = Date.now() - started

  // Binding calls travel on the same connection as this round trip, so an
  // evaluate here flushes any event that fired during the last action.
  await page.evaluate(() => undefined)

  const visited = counters.routes.slice(before.routeCount)
  const measurement: JourneyMeasurement = {
    ...declaration,
    clicks: counters.clicks - before.clicks,
    keystrokes: counters.keystrokes - before.keystrokes,
    untypedInputs: counters.untypedInputs - before.untypedInputs,
    navigations: visited.length,
    routes: new Set(visited).size,
    wallClockMs,
  }

  record(measurement)
  test.info().annotations.push({
    type: "journey",
    description: `${scorecardRow(measurement)}  (observed ${measurement.wallClockMs} ms)`,
  })

  const problems = budgetViolations(measurement, budget)
  if (problems.length > 0) {
    throw new Error(
      [
        `Journey ${measurement.id} is outside its scorecard budget:`,
        ...problems.map((p) => `  - ${p}`),
        `Budget lives in docs/architecture/ux-task-scorecard.md. If the extra cost is the`,
        `intended design, change the row and say why in the same commit — do not widen it`,
        `to get green. Observed row:`,
        `  ${scorecardRow(measurement)}`,
      ].join("\n"),
    )
  }

  if (!isMeasured(budget)) {
    // Declared but never measured. The run is not failed for it — the journey
    // itself still asserted it reached the end state — but the number is put
    // where a person will see it, because a row that stays — forever is a gate
    // that was never switched on.
    test
      .info()
      .annotations.push({ type: "journey-unbudgeted", description: `${measurement.id}: ${scorecardRow(measurement)}` })
  }

  return measurement
}

/** Append to the run's observations file, creating it on the first journey. */
function record(measurement: JourneyMeasurement): void {
  fs.mkdirSync(path.dirname(OBSERVATIONS_PATH), { recursive: true })
  let all: JourneyMeasurement[] = []
  if (fs.existsSync(OBSERVATIONS_PATH)) {
    try {
      all = JSON.parse(fs.readFileSync(OBSERVATIONS_PATH, "utf8")) as JourneyMeasurement[]
    } catch {
      all = []
    }
  }
  all = all.filter((m) => m.id !== measurement.id)
  all.push(measurement)
  all.sort((a, b) => a.id.localeCompare(b.id))
  fs.writeFileSync(OBSERVATIONS_PATH, `${JSON.stringify(all, null, 2)}\n`)
}
