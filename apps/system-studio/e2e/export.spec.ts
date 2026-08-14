import { test, expect, type APIRequestContext, type Browser } from "@playwright/test"
import { operatorFor } from "./operator-identity"

/**
 * STUDIO-100-002 (the `export` clause) — the estate leaves the building, and
 * what it says about itself when it does.
 *
 * The operator's complaint was that live AWS data cannot be taken out of this
 * console. This spec drives `GET /api/export` through a real signed-in browser
 * session against a running Studio, and asserts the five things that separate an
 * export from a screenshot with commas in it:
 *
 *   1. it arrives as a FILE — `Content-Disposition: attachment`, naming the
 *      account, the surface and the date;
 *   2. every row carries the account, the region and its own `as of`;
 *   3. a read this engine could not perform is a ROW SAYING SO, not a missing
 *      row — asserted here on an estate whose reads mostly fail, which is
 *      exactly the estate this must not lie about;
 *   4. no cell in the file begins with a character a spreadsheet executes;
 *   5. it is authorized per request, server-side, and rationed.
 *
 * ## Why every request happens in one `beforeAll`
 *
 * The endpoint rations itself — six per operator per minute, because one export
 * is of the order of a hundred AWS describes and a refresh loop on a download
 * URL is a bill. A spec whose tests each fetched four surfaces would spend that
 * budget on itself and then fail with 429s that say nothing about the code. So
 * the whole drive happens once, in order, against one session, and the tests
 * assert on what came back. The last thing the drive does is keep asking until
 * it is refused, which is how the limit itself gets exercised rather than
 * dodged.
 *
 * The requests go through a browser context's `request`, which carries the
 * session cookie sign-in established. That is deliberate rather than
 * convenient: this endpoint's whole authorization story is per request and
 * server-side, and a bare `request` fixture with no session exercises only the
 * 401 arm — which is its own test below.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

const SURFACES = ["inventory", "coverage", "drift", "posture"] as const
type Surface = (typeof SURFACES)[number]

/** The states that mean "this engine could not see it". Never an absence. */
const UNREADABLE = new Set([
  "DENIED",
  "THROTTLED",
  "UNCONFIGURED",
  "ERROR",
  "UNREADABLE",
  "NOT_COMPOSED",
  "NO_READER",
  "OMITTED",
  "NOT_DECLARABLE",
])

interface Taken {
  status: number
  headers: Record<string, string>
  body: string
}

const csvOf: Partial<Record<Surface, Taken>> = {}
let inventoryJson: Taken | undefined
let refusedAfter: number | null = null
let retryAfterSeconds = 0
let driveError: string | null = null

async function take(api: APIRequestContext, url: string): Promise<Taken> {
  const response = await api.get(url)
  return { status: response.status(), headers: response.headers(), body: await response.text() }
}

/**
 * Sign in the way an operator does — the form, not a cookie this spec forged.
 *
 * A session minted by hand would prove the export works for a session shape
 * that no browser produces, which is the failure mode of every "we set the
 * cookie ourselves" test.
 */
async function signedInContext(browser: Browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("heading", { name: "Organization systems" })).toBeVisible()
  await page.close()
  return context
}

test.describe.configure({ mode: "serial" })

test.beforeAll(async ({ browser }) => {
  const context = await signedInContext(browser)
  try {
    // 1–4: every surface as CSV. Four of the budget's six.
    for (const surface of SURFACES) {
      csvOf[surface] = await take(context.request, `/api/export?surface=${surface}&format=csv`)
    }
    // 5: the machine-readable form of the same estate.
    inventoryJson = await take(context.request, "/api/export?surface=inventory&format=json")

    // 6 onwards: keep asking until refused. The sixth is the last one inside
    // the budget, so a limiter that is wired refuses somewhere in this loop.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await take(context.request, "/api/export?surface=posture&format=csv")
      if (response.status === 429) {
        refusedAfter = attempt
        retryAfterSeconds = Number(response.headers["retry-after"] ?? "0")
        break
      }
    }
  } catch (error) {
    driveError = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  } finally {
    await context.close()
  }
})

function taken(surface: Surface): Taken {
  const value = csvOf[surface]
  if (!value) throw new Error(`the drive did not record ${surface}: ${driveError ?? "no reason"}`)
  return value
}

/**
 * RFC 4180 parsing, because the property under test is about QUOTING.
 *
 * A `split(",")` would pass on a file whose escaping is broken — every cell
 * containing a comma would simply become two cells, and every assertion about
 * cell contents would still find something. Several assertions below exist to
 * prove the quoting is right, so the reader has to honour it.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ",") {
      row.push(cell)
      cell = ""
    } else if (ch === "\r") {
      // Half of a CRLF record separator; the \n below closes the record.
    } else if (ch === "\n") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else {
      cell += ch
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function asObjects(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text)
  if (rows.length === 0) return []
  const header = rows[0]
  return rows.slice(1).map((cells) => {
    const out: Record<string, string> = {}
    header.forEach((name, index) => {
      out[name] = cells[index] ?? ""
    })
    return out
  })
}

test.describe("taking the estate away", () => {
  test("the drive itself completed", () => {
    // Reported as its own failure so that a broken sign-in or an unreachable
    // server is never mistaken for a defect in the export.
    expect(driveError).toBeNull()
  })

  test("every surface arrives as a file whose name says which account, which surface and which day", () => {
    for (const surface of SURFACES) {
      const response = taken(surface)
      expect(response.status, `${surface} must be servable`).toBe(200)

      const disposition = response.headers["content-disposition"] ?? ""
      expect(disposition, `${surface} must be a download, not a page`).toContain("attachment")
      expect(disposition).toContain(`-${surface}-`)
      // The date, to the day. An estate file with no date in its name is one
      // nobody can put in order once it is in a downloads folder.
      expect(disposition).toMatch(/-\d{4}-\d{2}-\d{2}\.csv"/)
      // The account, or an explicit admission that it could not be resolved —
      // never an account id inherited from an environment variable.
      expect(disposition).toMatch(/tenure-estate-([0-9]{12}|unknown-account)-/)

      expect(response.headers["content-type"]).toContain("text/csv")
      expect(response.headers["cache-control"]).toContain("no-store")
      expect(response.headers["x-correlation-id"]).toMatch(/^req-/)
    }
  })

  test("a read this engine could not perform leaves as a row saying so, never as a missing row", () => {
    /*
     * The assertion this whole route exists for.
     *
     * In every environment this spec runs in, most of the estate reads fail —
     * there are no credentials, or the task role is narrow. The wrong export is
     * the one that comes back with a header row and nothing under it, because
     * "we were refused" and "there is nothing there" would then be the same
     * file. Each surface must produce at least one row, every row must carry a
     * state, and every unreadable row must say why.
     */
    for (const surface of SURFACES) {
      const response = taken(surface)
      const rows = asObjects(response.body)
      expect(rows.length, `${surface} must never be a header row alone`).toBeGreaterThan(0)

      for (const row of rows) {
        expect(row.state, `every ${surface} row states whether it could be read`).not.toBe("")
        if (UNREADABLE.has(row.state)) {
          expect(row.detail, `an unreadable ${surface} row must say why`).not.toBe("")
        }
      }

      // The counts in the headers agree with the file, so a pipeline can refuse
      // a partial estate without parsing every row of it.
      expect(Number(response.headers["x-export-rows"])).toBe(rows.length)
      const unreadable = rows.filter((row) => UNREADABLE.has(row.state)).length
      expect(Number(response.headers["x-unreadable-rows"])).toBe(unreadable)
    }
  })

  test("a refused read carries the action and the statement that would fix it", () => {
    // Not merely "unknown". The remedy travels with the row, because the file
    // is read somewhere the console is not.
    const rows = SURFACES.flatMap((surface) => asObjects(taken(surface).body))
    const denied = rows.filter((row) => row.state === "DENIED" || row.state === "UNREADABLE")

    for (const row of denied) {
      // Every DENIED row names the AWS action. UNREADABLE rows come from
      // surfaces that did not report which arm failed and carry `detail` only.
      if (row.state === "DENIED") {
        expect(row.awsAction, "a denial names the action IAM would grant").not.toBe("")
        expect(row.minimumStatement, "a denial carries a pasteable statement").toContain("Effect")
      }
      expect(row.detail).not.toBe("")
    }
  })

  test("every row carries the account, the region and its own as-of", () => {
    expect(inventoryJson, driveError ?? "the drive recorded no JSON").toBeDefined()
    const response = inventoryJson as Taken
    expect(response.status).toBe(200)

    const body = JSON.parse(response.body) as {
      surface: string
      account: { accountId: string | null; region: string | null; readAs: string | null }
      counts: { rows: number; unreadable: number }
      rows: Array<Record<string, unknown>>
      note: string
    }

    expect(body.surface).toBe("inventory")
    expect(body.counts.rows).toBe(body.rows.length)
    // The envelope says what the states mean, so a consumer that reads only the
    // envelope still learns that most of them are not absences.
    expect(body.note).toContain("Only NONE asserts an absence")
    expect(body.rows.length).toBeGreaterThan(0)

    for (const row of body.rows) {
      // Provenance is per row and identical to the envelope's account, so a
      // reader can never attribute a row to the wrong estate.
      expect(row.accountId).toBe(body.account.accountId)
      expect(row.region).toBe(body.account.region)
      expect(typeof row.service).toBe("string")
      expect(row.service).not.toBe("")
      // A row that was read has a stamp. A row that was refused has none, and
      // null is the honest value — not the moment somebody pressed the button.
      if (row.state === "READ" || row.state === "STALE" || row.state === "NONE") {
        expect(typeof row.asOf).toBe("string")
      }
    }
  })

  test("no cell in the file begins with a character a spreadsheet would execute", () => {
    for (const surface of SURFACES) {
      for (const row of parseCsv(taken(surface).body)) {
        for (const cell of row) {
          const head = cell.charAt(0)
          if (head === "" || !"=+-@\t\r".includes(head)) continue
          // The two ways a cell may legitimately start with one of these: it is
          // a whole number, or it has already been neutralised.
          const inert = cell.startsWith("'") || Number.isFinite(Number(cell))
          expect(inert, `a live formula reached the file: ${JSON.stringify(cell)}`).toBe(true)
        }
      }
    }
  })

  test("no credential material is in the file", () => {
    for (const surface of SURFACES) {
      const text = taken(surface).body
      expect(text).not.toContain("BEGIN RSA PRIVATE KEY")
      expect(text).not.toContain("BEGIN PRIVATE KEY")
      // The operator secret this session signed in with must not be anywhere in
      // an estate file, whatever path could have carried it.
      if (SECRET) expect(text).not.toContain(SECRET)
      expect(text).not.toMatch(/secret[_-]?access[_-]?key\s*[=:]\s*[^[\s]/i)
    }
  })

  test("rations the export rather than serving the whole estate in a loop", () => {
    expect(
      refusedAfter,
      "the export budget must refuse a caller that keeps asking",
    ).not.toBeNull()
    expect(retryAfterSeconds).toBeGreaterThan(0)
  })

  test("refuses a surface it does not have, and a format it cannot write", async ({ browser }) => {
    // Neither of these consumes the budget: both are decided before the
    // limiter, because "there is no such surface" is a fact about the request.
    const context = await signedInContext(browser)
    try {
      const surface = await take(context.request, "/api/export?surface=everything&format=csv")
      expect(surface.status).toBe(404)
      expect(surface.headers["content-type"]).toContain("application/problem+json")
      expect(JSON.parse(surface.body).detail).toContain("inventory")
      // A problem document is never a download. A 404 that arrived as an
      // attachment is a file an operator files away as an export.
      expect(surface.headers["content-disposition"]).toBeUndefined()

      const format = await take(context.request, "/api/export?surface=inventory&format=xlsx")
      expect(format.status).toBe(400)
      expect(JSON.parse(format.body).detail).toContain("csv")
      expect(format.headers["content-disposition"]).toBeUndefined()
    } finally {
      await context.close()
    }
  })

  test("is not reachable without an operator session", async ({ request }) => {
    // The bare `request` fixture carries no session cookie. An export is a bulk
    // read of the whole estate and is precisely the endpoint that must not be
    // open.
    const response = await request.get("/api/export?surface=inventory&format=csv")
    expect(response.status()).toBe(401)
    expect(response.headers()["content-type"]).toContain("application/problem+json")
    expect(response.headers()["content-disposition"]).toBeUndefined()
  })
})
