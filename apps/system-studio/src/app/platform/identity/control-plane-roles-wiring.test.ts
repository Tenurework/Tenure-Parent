import fs from "fs"
import path from "path"

/**
 * STUDIO-010-005 — the declared split of AWS authority is reached by a
 * production caller.
 *
 * The same assertion, for the same reason, as `../estate/organizational-units-wiring.test.ts`
 * and `./../security/wiring.test.ts`: a declaration nothing renders is a
 * document, and this repository has already paid for eleven readers that were
 * written, tested, granted an IAM statement and imported by nobody.
 *
 * It also pins the ONE property that keeps this reconciliation honest at the
 * call site: it is fed `iam.read`, the `AwsRead` union, and not `iam.posture` —
 * which is `IamPosture | null` and would make a refused IAM read arrive as
 * "no roles", i.e. as eight roles missing.
 */

const ROUTE_DIR = __dirname

function routeFile(name: string): string {
  return fs.readFileSync(path.join(ROUTE_DIR, name), "utf8").split("\r\n").join("\n")
}

describe("the identity surface reconciles the declared control-plane roles", () => {
  test("the page reconciles them on every load", () => {
    const page = routeFile("page.tsx")
    expect(page).toContain("reconcileDeploymentRoles({ posture: iam.read })")
    expect(page).toContain('from "@/lib/aws/deployment-roles"')
  })

  test("it is fed the union, so a refused IAM read is not eight missing roles", () => {
    const page = routeFile("page.tsx")
    // `iam.posture` is `IamPosture | null`. Passing it would compile and would
    // turn every denial into "the account holds none of these roles".
    expect(page).not.toContain("reconcileDeploymentRoles({ posture: iam.posture")
  })

  test("the verdicts reach a table rather than a variable", () => {
    const page = routeFile("page.tsx")
    expect(page).toContain("roleSummary(")
    expect(page).toContain("rows={controlPlaneRoles}")
    expect(page).toContain('data-testid="control-plane-role-summary"')
  })

  test("the boundary and the session tags are printed, not just the role name", () => {
    const page = routeFile("page.tsx")
    expect(page).toContain("row.role.permissionsBoundary")
    expect(page).toContain("row.role.sessionTags")
    expect(page).toContain("nothing caps this role")
    expect(page).toContain("cannot be tagged")
  })

  test("the page reads AWS only through the reader, never through an SDK client", () => {
    const page = routeFile("page.tsx")
    expect(page).not.toContain("@aws-sdk/client")
    expect(page).not.toContain("liveGateway")
  })
})
