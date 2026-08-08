import { renderToStaticMarkup } from "react-dom/server"

import { TagCompliancePanel } from "../components/TagCompliancePanel"
import { taggedResources } from "./aws/tags"
import type { AwsGateway } from "./aws/read"

/**
 * STUDIO-070-002 — the tag contract, asserted where an operator actually meets
 * it.
 *
 * `taggedResources` is the producer: the one function every `tag:GetResources`
 * page passes through, and the only place `tagProblems` is called. The panel is
 * the surface `apps/system-studio/src/app/platform/estate/page.tsx` renders.
 * This test drives the real producer through a stand-in gateway and renders the
 * real panel over what it produced — nothing here calls `tagProblems` or
 * `tagCompliance` directly.
 *
 * That is the whole point. Before this test existed, `problems` was computed on
 * every resource in the estate and read by one unit test and nothing else; a
 * mutation replacing `tagProblems(tags)` with `[]` in the producer reddened
 * only an assertion about a helper no page called. An operator would have seen
 * exactly the same screen either way, which is the definition of a check that
 * is not being performed.
 *
 * The stand-in returns what the Resource Groups Tagging API returns —
 * `ResourceTagMappingList` with `Tags: [{Key, Value}]` — not a convenient
 * array, because a projection is only proven against the shape it has to read.
 */

const FULLY_TAGGED: Record<string, string> = {
  "tenure:tenant": "simon-ose",
  "tenure:environment": "production",
  "tenure:cell": "cell-us-east-1-a",
  "tenure:account-purpose": "workload",
  "tenure:module": "tenant-cell",
  "tenure:release": "2026.07.31",
  "tenure:stack": "pilot/terraform.tfstate",
  "tenure:data-class": "student-record",
  "tenure:owner-seat": "platform-engineering",
  "tenure:cost-center": "tenant-cells",
  "tenure:retention": "P7Y",
  "tenure:managed-by": "terraform",
}

const COMPLIANT_ARN = "arn:aws:rds:us-east-1:1:db:tenure-prod"
const NO_COST_CENTER_ARN = "arn:aws:ec2:us-east-1:1:natgateway/nat-0a1b"
const UNTAGGED_ARN = "arn:aws:s3:::somebody-clicked-this-into-existence"

const asTags = (map: Record<string, string>) =>
  Object.entries(map).map(([Key, Value]) => ({ Key, Value }))

function gateway(): AwsGateway {
  let page = 0
  const pages = [
    {
      ResourceTagMappingList: [
        { ResourceARN: COMPLIANT_ARN, Tags: asTags(FULLY_TAGGED) },
        {
          // Attributable — it names its tenant — and still non-compliant. The
          // resource a survey filtered to "unattributable" would miss entirely.
          ResourceARN: NO_COST_CENTER_ARN,
          Tags: asTags(
            Object.fromEntries(
              Object.entries(FULLY_TAGGED).filter(([k]) => k !== "tenure:cost-center"),
            ) as Record<string, string>,
          ),
        },
        { ResourceARN: UNTAGGED_ARN, Tags: [{ Key: "Name", Value: "scratch" }] },
      ],
    },
  ]
  return {
    async call(capability) {
      if (capability !== "tag:GetResources") throw new Error(`unexpected ${capability}`)
      return pages[page++] ?? { ResourceTagMappingList: [] }
    },
    async resolvedRegion() {
      return "us-east-1"
    },
  }
}

async function surveyAndRender() {
  const read = await taggedResources(gateway(), { now: () => new Date("2026-08-07T12:00:00Z") })
  if (read.state !== "ACTUAL") throw new Error(`expected ACTUAL, got ${read.state}`)
  return {
    resources: read.value,
    markup: renderToStaticMarkup(<TagCompliancePanel resources={read.value} />),
  }
}

describe("the estate surface reports what the tag contract found", () => {
  it("names the resource and the key it is missing, not just a count", async () => {
    const { markup } = await surveyAndRender()
    expect(markup).toContain(NO_COST_CENTER_ARN)
    expect(markup).toContain("tenure:cost-center")
    // The compliant one is not listed as a problem.
    expect(markup).not.toContain(COMPLIANT_ARN)
  })

  it("counts the non-compliant resources on the badge", async () => {
    const { markup } = await surveyAndRender()
    // Two of three: the one missing a cost center, and the untagged one.
    expect(markup).toContain("2 of 3 non-compliant")
  })

  it("keeps unattributable apart from shared, and says why it is apart", async () => {
    const { markup } = await surveyAndRender()
    expect(markup).toContain("unattributable — missing tenure:tenant")
    expect(markup).toMatch(/nobody decided these belong to the platform/)
  })

  it("refuses to report a survey of nothing as a pass", () => {
    const markup = renderToStaticMarkup(<TagCompliancePanel resources={[]} />)
    expect(markup).toContain("No resources were read, so nothing was checked. This is not a pass.")
  })
})
