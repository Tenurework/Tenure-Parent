import fs from "fs"
import path from "path"

/**
 * STUDIO-010-003 — the OU hierarchy is reached by a production caller.
 *
 * `organization-units.ts` declares the hierarchy, computes the inherited
 * guardrails and reconciles both against a live Organization read. All of that
 * is worth nothing if no page calls it: eleven readers in this directory were
 * written, tested, granted an IAM statement and imported by nobody, and their
 * unit tests kept passing the whole time. That is the failure this file exists
 * against, and it is asserted the same way `../security/wiring.test.ts` asserts
 * it — on the route file itself, because a browser cannot tell a page that read
 * the Organization and was refused from a page that never asked.
 */

const ROUTE_DIR = __dirname

/** CRLF on a Windows checkout, LF on a Linux one. Normalised so `\n` matches both. */
function routeFile(name: string): string {
  return fs.readFileSync(path.join(ROUTE_DIR, name), "utf8").split("\r\n").join("\n")
}

describe("the estate surface actually reads the organizational-unit hierarchy", () => {
  test("the page calls the reader on every load", () => {
    const page = routeFile("page.tsx")
    expect(page).toContain("organizationalUnitSurface()")
    expect(page).toContain('from "@/lib/aws/organization-units"')
    // Read live, not at build time. Without this the whole reading is a
    // prerendered snapshot of whatever the build machine could see, which for
    // an Organization read is nothing at all.
    expect(page).toContain('export const dynamic = "force-dynamic"')
  })

  test("the verdicts reach a table rather than a variable", () => {
    const page = routeFile("page.tsx")
    expect(page).toContain("unitSummary(")
    expect(page).toContain("rows={units}")
    expect(page).toContain('data-testid="organizational-unit-summary"')
  })

  test("the page prints the inherited guardrails, which is the half a unit list cannot show", () => {
    const page = routeFile("page.tsx")
    expect(page).toContain("row.effective")
    expect(page).toContain("row.deniedActions")
  })

  test("a misplaced unit is reported as inheriting a different guardrail set", () => {
    const page = routeFile("page.tsx")
    // The finding, in the page's own words. A MISPLACED row rendered as a bare
    // badge says a unit is in the wrong place; the sentence says why that
    // matters, which is the only reason the row is worth drawing.
    expect(page).toContain("MISPLACED")
    expect(page).toContain("inherits a different guardrail set")
  })

  test("the page reads AWS only through the reader, never through an SDK client", () => {
    const page = routeFile("page.tsx")
    expect(page).not.toContain("@aws-sdk/client")
    expect(page).not.toContain("liveGateway")
    expect(page).not.toContain("new OrganizationsClient")
  })
})
