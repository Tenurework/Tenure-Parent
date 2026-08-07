import { renderToStaticMarkup } from "react-dom/server"

import { fromDecimal, type AllocationDriver, type CostLine } from "@tenure/finops"

import { CUR_ROUNDING, buildCostReport } from "../../../lib/cost-report"
import { CostReportView } from "./CostReportView"

/**
 * PAY-180-003 — the FinOps Center says which system each number came from.
 * PAY-070-004 — and what reversing a shared-cost split returns, per recipient.
 *
 * Asserted on the MARKUP THE PAGE EMITS, not on `figure()` called directly.
 * That distinction is the whole point of this file. `figure()` refuses a blank
 * system, and a test proving only that stays green if the one production
 * construction site — `buildCostReport` in `src/lib/cost-report.ts` — stops
 * passing a real one. So the report is built by the production function and
 * rendered by the production component, and blanking the citation there is what
 * this reds on.
 *
 * No browser and no CUR. `costSource()` cannot reach its CONNECTED arm until an
 * AWS Organization exists (STUDIO-120-008 is BLOCKED_EXTERNAL on it), which is
 * exactly why the figure-building half is a separate, `server-only`-free module:
 * a citation nothing can render is a citation nobody has checked.
 */

const USD = "USD"
const usd = (decimal: string) => fromDecimal(decimal, USD)
const NOW = new Date("2026-08-16T12:00:00Z")

const line = (over: Partial<CostLine> & { id: string }): CostLine => ({
  service: "AmazonEC2",
  accountId: "111122223333",
  region: "us-east-1",
  resourceId: "i-abc",
  tags: {},
  unblendedCost: usd("10.00"),
  amortizedCost: usd("10.00"),
  periodStart: "2026-08-01T00:00:00Z",
  periodEnd: "2026-08-31T23:59:59Z",
  ...over,
})

const nat: AllocationDriver = {
  id: "nat-bytes",
  measure: "share of NAT gateway bytes processed, from VPC flow logs",
  weights: { acme: 1, beta: 1, gamma: 1 },
}

function render() {
  const report = buildCostReport({
    lines: [
      line({
        id: "acme-ec2",
        tags: { "tenure:tenant": "acme" },
        unblendedCost: usd("30.00"),
        amortizedCost: usd("30.00"),
      }),
      // $10.00 across three equal weights: the classic case where the leftover
      // units decide who pays what.
      line({ id: "nat", service: "AmazonVPC", unblendedCost: usd("10.00"), amortizedCost: usd("10.00") }),
    ],
    drivers: { AmazonVPC: nat },
    tenantIds: ["acme", "beta", "gamma"],
    bucket: "tenure-billing",
    prefix: "fleet/cur2",
    now: NOW,
  })
  return { report, html: renderToStaticMarkup(<CostReportView report={report} />) }
}

describe("the FinOps Center cites the system every figure came from", () => {
  it("renders a non-empty citation beside the as-of badge", () => {
    const { html } = render()

    // The as-of half, which already existed.
    expect(html).toContain("as of 2026-08-16T12:00:00.000Z")

    // The citation half — what PAY-180-003 asks for. Non-empty AND naming the
    // system and the place, because a badge reading "source: · ·" is worse than
    // no badge: it looks like a claim.
    const citation = /data-testid="figure-source"[^>]*>([^<]*)</.exec(html)?.[1] ?? ""
    expect(citation.trim().length).toBeGreaterThan(20)
    expect(citation).toContain("aws-cur")
    expect(citation).toContain("s3://tenure-billing/fleet/cur2")
    expect(citation).toContain("read 2026-08-16T12:00:00.000Z")
  })

  it("marks the forecast's citation derived, so nothing reads it as a billed line", () => {
    const { html } = render()
    expect(html).toMatch(/derived: straight-line to end of period/)
  })

  it("renders every figure at its own currency's precision", () => {
    // $40.00 ingested. Before PAY-030-002 the formatter took a `minorDigits`
    // parameter defaulting to 2 regardless of the Money's currency.
    const { html } = render()
    expect(html).toContain("$40.00")
  })
})

describe("the shared-cost split table shows the reversal, per recipient", () => {
  it("splits the whole exactly and reverses to the negation of each share", () => {
    const { report, html } = render()

    expect(report.splits).toHaveLength(1)
    const parts = report.splits[0].split.parts
    expect(parts.map((p) => p.recipientId)).toEqual(["acme", "beta", "gamma"])
    expect(parts.reduce((running, p) => running + p.amount.units, 0)).toBe(usd("10.00").units)

    const reversal = report.splits[0].reversal
    expect(reversal.map((p) => p.amount.units)).toEqual(parts.map((p) => -p.amount.units))

    expect(html).toContain("Shared-cost splits")
    expect(html).toContain("reversal replays, never re-derives")
    for (const recipient of ["acme", "beta", "gamma"]) expect(html).toContain(recipient)
  })
})

describe("the CUR ingest states its rounding rather than defaulting", () => {
  it("truncates toward zero on a billed line", () => {
    // PAY-030-002. The CUR is authoritative to more places than are kept, and
    // rounding a million lines up invents money the bill does not contain.
    expect(CUR_ROUNDING).toBe("down")
  })
})
