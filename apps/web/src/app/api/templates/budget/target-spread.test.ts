/**
 * PLN-030-001 at its caller: the template's Budgeted column adds to exactly the
 * top-down target.
 *
 * `spread.test.ts` proves the arithmetic. This proves the arithmetic is REACHED —
 * that the route parses the target, runs it through the engine, writes whole
 * currency amounts into the sheet the importer reads, and carries the rule that
 * produced them into the workbook. A spreading engine nothing calls is a library,
 * and the whole reason this route grew a parameter is that the division a club
 * does by hand is where the allocation stops adding up.
 *
 * The assertion is made against the GENERATED WORKBOOK, parsed back out — not
 * against the engine's return value, which the engine's own suite already covers.
 * The failure this is aimed at lives in the gap between them: cents divided by
 * the wrong power of ten, the shares written to the wrong column, a total row
 * that double-counts. Reading the bytes back is the only way to see it.
 *
 * `@/lib/auth` is the single mocked boundary. The route touches no database, so
 * everything else here is the real thing: the real xlsx writer, the real
 * `parseMoneyToCents`, the real `spread`.
 */

import * as XLSX from "xlsx"

let signedIn = true

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(async () => (signedIn ? { user: { id: "user_pln_test" } } : null)),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require("./route") as typeof import("./route")

const request = (query = "") => new Request(`http://localhost:3000/api/templates/budget${query}`)

/** The Club Budget sheet, as rows of cell values. */
async function budgetSheet(response: Response): Promise<unknown[][]> {
  const book = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" })
  return XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Club Budget"], { header: 1, blankrows: false })
}

async function instructionsText(response: Response): Promise<string> {
  const book = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" })
  return XLSX.utils
    .sheet_to_json<unknown[]>(book.Sheets["Instructions"], { header: 1, blankrows: false })
    .map((row) => row.join(" | "))
    .join("\n")
}

/**
 * The Budgeted figures of the category rows.
 *
 * The `Total` row is excluded by name, exactly as `parseBudgetSheet` excludes it,
 * so this cannot accidentally count the allocation twice and call it balanced.
 */
function budgetedValues(rows: unknown[][]): number[] {
  return rows
    .slice(1)
    .filter((row) => typeof row[0] === "string" && !row[0].startsWith("Total"))
    .map((row) => row[1] as number)
}

beforeEach(() => {
  signedIn = true
})

describe("GET /api/templates/budget", () => {
  it("still generates a blank template when no target is given", async () => {
    const rows = await budgetSheet(await GET(request()))
    const budgeted = budgetedValues(rows)
    expect(budgeted).toHaveLength(10)
    expect(budgeted.every((value) => value === 0)).toBe(true)
  })

  it("spreads a whole target across every category, adding to exactly the target", async () => {
    const rows = await budgetSheet(await GET(request("?total=8300")))
    const budgeted = budgetedValues(rows)
    expect(budgeted).toHaveLength(10)
    expect(budgeted.reduce((sum, value) => sum + value, 0)).toBe(8300)
    expect(budgeted.every((value) => value === 830)).toBe(true)
  })

  it("spreads an indivisible target to the cent, without losing one", async () => {
    // 833,333 cents over ten categories is 83,333.3 each. Ten hand-rounded
    // shares of $833.33 add to $8,333.30 and lose three cents of an allocation.
    const rows = await budgetSheet(await GET(request("?total=8333.33")))
    const budgeted = budgetedValues(rows)
    const cents = budgeted.map((value) => Math.round(value * 100))
    expect(cents.reduce((sum, value) => sum + value, 0)).toBe(833_333)
    // Largest-remainder: three categories carry the leftover cent, in order.
    expect(cents).toEqual([83_334, 83_334, 83_334, 83_333, 83_333, 83_333, 83_333, 83_333, 83_333, 83_333])
  })

  it("writes the rule that filled the column into the workbook", async () => {
    // §7: allocation results drill to basis and original source. A pre-filled
    // column with no stated basis is a set of numbers nobody can defend.
    const text = await instructionsText(await GET(request("?total=8300")))
    expect(text).toContain("How the Budgeted column was filled in")
    expect(text).toMatch(/Rule \| budget-template-even-\d{4}/)
    expect(text).toContain("Basis | even")
    expect(text).toContain("Owner | user:user_pln_test")
    expect(text).toContain("Source | ?total=830000 on GET /api/templates/budget")
    expect(text).toContain("draft distribution, not an approved plan")
  })

  it("says nothing about a rule when no target was spread", async () => {
    const text = await instructionsText(await GET(request()))
    expect(text).not.toContain("How the Budgeted column was filled in")
  })

  it("refuses an unparseable target rather than guessing one", async () => {
    const response = await GET(request("?total=about%20eight%20thousand"))
    expect(response.status).toBe(400)
    expect(await response.text()).toContain("is not an amount")
  })

  it("refuses a negative target, in the engine's own words", async () => {
    const response = await GET(request("?total=-500"))
    expect(response.status).toBe(400)
    expect(await response.text()).toContain("refuse-negative")
  })

  it("still requires a session", async () => {
    signedIn = false
    const response = await GET(request("?total=8300"))
    expect(response.status).toBe(401)
  })
})
