import fs from "fs"
import path from "path"

/**
 * The claim this file exists to keep honest: **the two readers are reached by a
 * production caller.**
 *
 * `lib/aws/guardduty.ts` and `lib/aws/compliance.ts` were written, tested,
 * granted an IAM statement and given a capability — and imported by no page, so
 * nothing they read ever reached a screen. A unit test of the mapping functions
 * in `./posture.ts` cannot catch that regressing: those functions would keep
 * passing on the day `page.tsx` stopped calling the reader that feeds them, which
 * is precisely how eleven readers came to be dark in the first place.
 *
 * So this asserts on the ROUTE FILE. It is a source-level assertion and it is a
 * deliberate one — the alternative is a browser, and a browser cannot tell a page
 * that read GuardDuty and found nothing from a page that never called it.
 *
 * `e2e/security-surface.spec.ts` is the other half: that the rendered page
 * carries these readings in a browser, at every width, with no AWS reachable.
 */

const ROUTE_DIR = __dirname

/**
 * Read a route file with its line endings normalised.
 *
 * A checked-in file is CRLF on a Windows checkout and LF on a Linux one, and an
 * assertion written with `\n` matches on one and not the other — which is how a
 * test becomes "green here, red in CI".
 */
function routeFile(name: string): string {
  return fs.readFileSync(path.join(ROUTE_DIR, name), "utf8").split("\r\n").join("\n")
}

describe("the security surface actually calls the two readers it reports from", () => {
  test("GuardDuty is read on every load, by the page itself", () => {
    const page = routeFile("page.tsx")
    expect(page).toContain("guardDutyReadings()")
    expect(page).toContain('from "@/lib/aws/guardduty"')
    // Read live, not at build time. Without this the authorization check above
    // it never runs in production either — `tests/architecture` holds that rule
    // and this page's whole reading would be a prerendered snapshot.
    expect(page).toContain('export const dynamic = "force-dynamic"')
  })

  test("AWS Config is read on every load, by the page itself", () => {
    const page = routeFile("page.tsx")
    expect(page).toContain("complianceReadings()")
    expect(page).toContain('from "@/lib/aws/compliance"')
  })

  test("the page reads AWS only through the readers, never through an SDK client", () => {
    const page = routeFile("page.tsx")
    // The one path to the SDK is the reader. A page constructing a command would
    // bypass every governed state, every denial context and every capability
    // declaration in one line.
    expect(page).not.toContain("@aws-sdk/client")
    expect(page).not.toContain("liveGateway")
    expect(page).not.toContain("new GuardDutyClient")
    expect(page).not.toContain("new ConfigServiceClient")
  })

  test("both readings reach the coverage model, and both reach the ranked list", () => {
    const page = routeFile("page.tsx")
    for (const call of [
      "controlsFromGuardDuty(",
      "controlsFromCompliance(",
      "exposuresFromGuardDuty(",
      "exposuresFromConfigRules(",
    ]) {
      expect([call, page.includes(call)]).toEqual([call, true])
    }
  })

  test("every valueless arm of both new reads is rendered through the shared primitive", () => {
    const page = routeFile("page.tsx")
    // Four reads land on this page from the two new readers — the detector
    // listing, the per-detector finding ids and findings, the rule listing and
    // the aggregator listing — and each one gets an `UnknownState` rather than an
    // empty table.
    expect(page).toContain("detectorsUnknown")
    expect(page).toContain("detectorUnknowns")
    expect(page).toContain("rulesUnknown")
    expect(page).toContain("aggregationUnknown")
    expect(page).toContain("<UnknownState")
  })

  test("the reader's own sentences are printed, not reworded by the page", () => {
    const page = routeFile("page.tsx")
    // Two sentences describing one fact drift, and the one that drifts is the one
    // nobody reruns. Every state word on these two cards comes from the module
    // that read it.
    for (const renderer of [
      "describeGuardDutyPosture(",
      "describeDetectorConfiguration(",
      "describeComplianceHealth(",
      "describeRecorder(",
      "describeEnablement(",
      "describeRuleHealth(",
    ]) {
      expect([renderer, page.includes(renderer)]).toEqual([renderer, true])
    }
  })

  test("the page states the recorder question rather than assuming recording is on", () => {
    const page = routeFile("page.tsx")
    // A Config rule can only evaluate a resource type the recorder is recording,
    // so a page that omits this renders COMPLIANT verdicts over an unknown.
    expect(page).toContain("Recorder")
    expect(page).toContain("describeRecorder(config.enablement.recorder)")
  })

  test("no literal colour and no inline style arrived with the two new cards", () => {
    const page = routeFile("page.tsx")
    expect(page).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(page).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|color-mix)\(/)
    expect(page).not.toMatch(/\bstyle=\{\{/)
  })
})
