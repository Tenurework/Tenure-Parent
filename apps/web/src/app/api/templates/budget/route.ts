import { DEFAULT_MONEY_FORMAT } from "@tenure/platform-config/money"
import { minorDigits } from "@tenure/finops"
import * as XLSX from "xlsx"
import { auth } from "@/lib/auth"
import { parseMoneyToCents } from "@/lib/finance"
import { SpreadRuleError, spread, type SpreadRule } from "@/lib/planning/spread"

/**
 * The standardized club budget template, generated on request rather than
 * committed as a binary. Generating it in code keeps it provably in sync
 * with the Finance-tab importer: the headers here are the exact ones
 * parseBudgetSheet() detects, so a club that starts from this file gets a
 * clean import every time. An e2e test round-trips the template through the
 * parser to enforce that.
 *
 * ## PLN-030-001 — `?total=` distributes a top-down target
 *
 * A club handed an allocated total starts by dividing it across the categories
 * by hand, and the division is where the number stops adding up: ten categories
 * out of $8,300 is $830 each, out of $8,333 it is not, and a spreadsheet full of
 * hand-rounded shares tots to something other than the allocation. So `?total=`
 * runs the target through `spread()` in `@/lib/planning/spread`, which is
 * integer largest-remainder over `@tenure/finops` — the Budgeted column adds to
 * exactly the target, and the rule that produced it is written onto the
 * Instructions sheet rather than left as an invisible assumption in the numbers.
 *
 * `basis=even` is the only basis this route can offer, and the reason is not
 * that the engine has one: it supports six. The other five need data this
 * request does not have — a driver measurement, a season profile, last year's
 * actuals per category, the club's own proposal. Offering them here would mean
 * inventing the basis, which is the one thing a spread must never do.
 */

export const dynamic = "force-dynamic"

// Standard categories across Simon clubs — aligned with how OSE talks about
// club spending (events, food, swag, travel) so budgets read the same way
// from club to club.
const CATEGORIES = [
  ["Catering & Food", "Food and drink for club events"],
  ["Venue & Space", "Room bookings, off-campus venue fees"],
  ["Speaker & Guest Expenses", "Honoraria, speaker gifts, guest travel"],
  ["Marketing & Print", "Flyers, printing, promotion"],
  ["Club Swag & Apparel", "Members pay at least 50% out of pocket"],
  ["Career Treks & Travel", "Tier 1/2 treks — no club funds on Tier 3"],
  ["Collaboration Events", "Your club's share of co-hosted events"],
  ["Software & Tools", "Subscriptions and tooling"],
  ["Supplies & Materials", "Recurring materials and one-off purchases"],
  ["Contingency", "Unplanned costs — keep a small buffer"],
] as const

/**
 * The rule the `?total=` spread runs under, with every field §7 of the Planning
 * Bible requires declared.
 *
 * Built per request rather than held as a constant because three of its fields
 * are properties of THIS request: the owner is whoever asked, the source names
 * the target they gave, and the effective period is the academic year the
 * template is for. A rule whose owner is a literal in a module is a rule nobody
 * owns.
 */
function templateSpreadRule(input: {
  ownerUserId: string
  targetCents: number
  academicYearStart: number
}): SpreadRule {
  const { ownerUserId, targetCents, academicYearStart } = input
  return {
    id: `budget-template-even-${academicYearStart}`,
    source: `?total=${targetCents} on GET /api/templates/budget, requested by user ${ownerUserId}`,
    target: "Club Budget!Budgeted",
    basis: "even",
    exclusions: [],
    order: 0,
    currency: DEFAULT_MONEY_FORMAT.currency,
    unit: "currency",
    // `down` before the largest-remainder step hands the leftover units out, so
    // no category is credited a unit the allocation did not contain before the
    // remainder is distributed deterministically. Stated, never defaulted.
    precision: "down",
    zeroNegative: "refuse-negative",
    effectiveFrom: `${academicYearStart}-07-01`,
    effectiveTo: `${academicYearStart + 1}-06-30`,
    owner: `user:${ownerUserId}`,
    approval: null,
    test: "apps/web/src/lib/planning/spread.test.ts",
  }
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response("Sign in to download the template", { status: 401 })
  }

  // ── PLN-030-001: an optional top-down target, spread across the categories ──
  const requested = new URL(request.url).searchParams.get("total")
  const targetCents = requested === null ? null : parseMoneyToCents(requested)
  if (requested !== null && targetCents === null) {
    return new Response(
      `"${requested}" is not an amount. Pass ?total= as a number of ${DEFAULT_MONEY_FORMAT.currency}, ` +
        `for example ?total=8300 — the template is generated with a blank Budgeted column when it ` +
        `is omitted, and refusing an unparseable one is deliberate: guessing would put a number in ` +
        `front of a club that nobody chose.`,
      { status: 400 },
    )
  }

  const wb = XLSX.utils.book_new()

  // ── Sheet 1: the budget itself ──────────────────────────────────────────
  // Must be first: the importer reads the first sheet. Header names must
  // stay within parseBudgetSheet()'s detection hints.
  const header = ["Category", "Budgeted", "Actual Spent", "Notes"]

  // The academic year this template is for, from the request's own clock. July
  // starts the year, matching `Budget.academicYear`'s "2026-27" convention.
  const now = new Date()
  const academicYearStart = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1

  let spreadRule: SpreadRule | null = null
  let budgetedByCategory: Record<string, number> = {}
  if (targetCents !== null) {
    spreadRule = templateSpreadRule({
      ownerUserId: session.user.id,
      targetCents,
      academicYearStart,
    })
    try {
      const result = spread({
        rule: spreadRule,
        targetMinorUnits: targetCents,
        members: CATEGORIES.map(([name]) => ({ key: name })),
      })
      const divisor = 10 ** minorDigits(spreadRule.currency)
      budgetedByCategory = Object.fromEntries(
        result.cells.map((cell) => [cell.key, cell.minorUnits / divisor]),
      )
    } catch (error) {
      // A refusal from the engine is a 400, not a 500: every one of them is a
      // statement about the request — a negative target, an unparseable amount —
      // and reporting it as a server fault would send the reader looking for a
      // bug that is not there.
      if (error instanceof SpreadRuleError) {
        return new Response(error.message, { status: 400 })
      }
      throw error
    }
  }

  const budgetRows: (string | number)[][] = [
    header,
    ...CATEGORIES.map(
      ([name, note]) => [name, budgetedByCategory[name] ?? 0, 0, note] as (string | number)[],
    ),
  ]
  const budget = XLSX.utils.aoa_to_sheet(budgetRows)

  // Total row with live formulas, so the sheet illustrates itself in Excel.
  // The importer skips rows whose category starts with "Total", so this
  // never double-counts on upload.
  const totalRowIndex = budgetRows.length // 0-based row after the last category
  XLSX.utils.sheet_add_aoa(budget, [["Total", 0, 0, ""]], { origin: -1 })
  const lastDataRow = totalRowIndex // 1-based Excel row of the last category
  budget[`B${totalRowIndex + 1}`] = { t: "n", f: `SUM(B2:B${lastDataRow})` }
  budget[`C${totalRowIndex + 1}`] = { t: "n", f: `SUM(C2:C${lastDataRow})` }

  budget["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 46 }]
  XLSX.utils.book_append_sheet(wb, budget, "Club Budget")

  // ── Sheet 2: a filled-in example ────────────────────────────────────────
  const example = XLSX.utils.aoa_to_sheet([
    header,
    ["Catering & Food", 2500, 1875, "Two networking dinners done, one to go"],
    ["Venue & Space", 1200, 1350, "Spring venue ran over — flag to advisor"],
    ["Speaker & Guest Expenses", 1800, 900, "One honorarium paid of two planned"],
    ["Club Swag & Apparel", 800, 880, "Members covered 50% per OSE policy"],
    ["Career Treks & Travel", 2000, 0, "NYC trek booked for Spring A"],
    ["Total", 8300, 5005, "Running totals"],
  ])
  example["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 46 }]
  XLSX.utils.book_append_sheet(wb, example, "Example (filled in)")

  // ── Sheet 3: instructions ───────────────────────────────────────────────
  const instructions = XLSX.utils.aoa_to_sheet([
    ["Tenure — Standard Club Budget Template"],
    [""],
    ["How to use this file"],
    ["1.", "Fill in the Club Budget sheet. One row per spending category."],
    ["2.", "Budgeted = what you planned for the year. Actual Spent = what has gone out so far."],
    ["3.", "Keep dollar amounts as numbers ($ signs and commas are fine)."],
    ["4.", "Add or rename category rows freely — the standard ones keep clubs comparable."],
    ["5.", "Upload this file on your club's Finance tab in Tenure to turn it into a live dashboard."],
    [""],
    ["Good to know"],
    ["•", "The Total row is calculated for you and is ignored on upload, so it never double-counts."],
    ["•", "Only the Club Budget sheet is imported. This sheet and the example are for reference."],
    ["•", "Audits are due the last weekday of every month — the due dates are on your Tenure calendar."],
    ["•", "Track your budget in this file independently of monthly reports; charges can lag."],
  ])
  // PLN-030-001 — §7: "Allocation results drill to basis and original source."
  // A pre-filled Budgeted column with no stated basis is a set of numbers a club
  // cannot defend and a reviewer cannot check, so the rule travels in the
  // workbook with the figures it produced.
  if (spreadRule) {
    XLSX.utils.sheet_add_aoa(
      instructions,
      [
        [""],
        ["How the Budgeted column was filled in"],
        ["Rule", spreadRule.id],
        ["Target", `${spreadRule.target}, ${DEFAULT_MONEY_FORMAT.currency}`],
        ["Source", spreadRule.source],
        ["Basis", `${spreadRule.basis} — every category receives an equal share`],
        ["Rounding", `${spreadRule.precision}, then whole units to the largest remainders`],
        ["Effective", `${spreadRule.effectiveFrom} to ${spreadRule.effectiveTo}`],
        ["Owner", spreadRule.owner],
        ["Approval", spreadRule.approval ?? "none — this is a draft distribution, not an approved plan"],
        ["Adds to", "exactly the target: the shares are whole units and their sum is the allocation"],
        ["Change it", "edit any Budgeted cell — this is a starting point, not a locked figure"],
      ],
      { origin: -1 },
    )
  }

  instructions["!cols"] = [{ wch: 4 }, { wch: 95 }]
  XLSX.utils.book_append_sheet(wb, instructions, "Instructions")

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="Tenure Club Budget Template.xlsx"',
      "Cache-Control": "private, no-store",
    },
  })
}
