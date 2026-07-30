import * as XLSX from "xlsx"
import { auth } from "@/lib/auth"

/**
 * The standardized club budget template, generated on request rather than
 * committed as a binary. Generating it in code keeps it provably in sync
 * with the Finance-tab importer: the headers here are the exact ones
 * parseBudgetSheet() detects, so a club that starts from this file gets a
 * clean import every time. An e2e test round-trips the template through the
 * parser to enforce that.
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

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response("Sign in to download the template", { status: 401 })
  }

  const wb = XLSX.utils.book_new()

  // ── Sheet 1: the budget itself ──────────────────────────────────────────
  // Must be first: the importer reads the first sheet. Header names must
  // stay within parseBudgetSheet()'s detection hints.
  const header = ["Category", "Budgeted", "Actual Spent", "Notes"]
  const budgetRows: (string | number)[][] = [
    header,
    ...CATEGORIES.map(([name, note]) => [name, 0, 0, note] as (string | number)[]),
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
