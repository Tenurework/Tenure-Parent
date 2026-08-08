/**
 * STUDIO-130-001 — the API envelope is the published contract, at the boundary
 * that builds it.
 *
 * Asserted on `envelope()` — the single function `apps/system-studio/src/app/api/aws/[surface]/route.ts`
 * calls for every 2xx body — rather than on `parseApiEnvelope` directly. That
 * distinction is the point of the file: a test that proved the parser refuses a
 * bad `asOf` would stay green on the day the route stopped going through it,
 * which is exactly how a runtime gate becomes decoration.
 *
 * No server and no registry. `envelope()` is arithmetic over values the route
 * has already read, which is why it can be held to the contract without an AWS
 * account or a DynamoDB table.
 */
import { CONTROL_PLANE_SCHEMA_VERSIONS, ContractViolation } from "@tenure/contracts"

import { envelope, etagFor, matchesEtag, newCorrelationId } from "./envelope"

const ASOF = "2026-08-07T10:00:00.000Z"
const CORRELATION = "req-9f3b2a1c4d5e6f708192a3b4c5d6e7f8"

const page = (over: Partial<Parameters<typeof envelope>[0]> = {}) => ({
  items: [{ slug: "acme" }],
  nextCursor: null,
  asOf: ASOF,
  correlationId: CORRELATION,
  ...over,
})

describe("the envelope every control-plane read returns", () => {
  it("stamps the version this build implements", () => {
    // Without it a client can tell that a RESOURCE it received is one it
    // understands and cannot tell whether the paging, the freshness marker or
    // the correlation field still mean what its library thinks.
    expect(envelope(page()).schemaVersion).toBe(CONTROL_PLANE_SCHEMA_VERSIONS.ApiEnvelope)
    expect(envelope(page()).schemaVersion).toMatch(/^\d+\.\d+$/)
  })

  it("keeps null as the answer for 'there is no next page'", () => {
    // Null rather than an absent field. The two are the same JSON to a careless
    // reader and opposite facts to a careful one — "there is no more" versus
    // "this producer does not paginate".
    const built = envelope(page())
    expect(built.nextCursor).toBeNull()
    expect(Object.keys(built)).toContain("nextCursor")
    expect(JSON.parse(JSON.stringify(built))).toHaveProperty("nextCursor", null)
  })

  it("refuses to serve a page whose as-of is not an instant", () => {
    // `asOf` reaches this from four places in the route — a cost report's own
    // timestamp, a fresh ISO string, a source's retrieval time. An endpoint that
    // shipped an unparseable one would look entirely normal to any test that
    // reads `items`.
    expect(() => envelope(page({ asOf: "last tuesday" }))).toThrow(ContractViolation)
  })

  it("refuses to serve a page nobody can trace back to a request", () => {
    expect(() => envelope(page({ correlationId: "" }))).toThrow(ContractViolation)
  })

  it("refuses an empty cursor, which a client would send back as a position", () => {
    expect(() => envelope(page({ nextCursor: "" }))).toThrow(ContractViolation)
  })

  it("never names the value it refused", () => {
    // These land in a log that outlives the request and the items are tenant
    // data. Same discipline as every other contract in the package.
    const SECRET = "tenant-acme-private-9f3b2a"
    let message = ""
    try {
      envelope(page({ asOf: SECRET }))
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).not.toBe("")
    expect(message).not.toContain(SECRET)
  })
})

describe("the ETag over what the envelope carries", () => {
  const body = { items: [{ slug: "acme" }], nextCursor: null, asOf: ASOF }

  it("is stable across requests, so a poller gets its 304", () => {
    // The correlation id changes per request and must not participate — if it
    // did, every ETag would be unique and the whole mechanism a no-op that looks
    // implemented.
    expect(etagFor(body)).toBe(etagFor(body))
    expect(matchesEtag(etagFor(body), etagFor(body))).toBe(true)
    expect(newCorrelationId()).not.toBe(newCorrelationId())
  })

  it("changes when the contract version does, so a 304 cannot serve a stale shape", () => {
    // The version is part of the body. A client holding an ETag minted before a
    // version bump would otherwise be told "nothing changed" and go on reading
    // the old shape out of its cache.
    const withVersion = JSON.stringify({
      schemaVersion: CONTROL_PLANE_SCHEMA_VERSIONS.ApiEnvelope,
      ...body,
    })
    const withoutVersion = JSON.stringify(body)
    expect(withVersion).not.toBe(withoutVersion)

    // Computed the way the production function computes it, then again with a
    // different version: the digests must differ.
    const digest = (canonical: string) =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:crypto").createHash("sha256").update(canonical).digest("hex")
    expect(etagFor(body)).toBe(`"${digest(withVersion)}"`)
    expect(etagFor(body)).not.toBe(`"${digest(withoutVersion)}"`)
  })

  it("changes when the page does", () => {
    expect(etagFor(body)).not.toBe(etagFor({ ...body, items: [{ slug: "other" }] }))
    expect(etagFor(body)).not.toBe(etagFor({ ...body, nextCursor: "abc" }))
    expect(etagFor(body)).not.toBe(etagFor({ ...body, asOf: "2026-08-07T10:00:01.000Z" }))
  })
})
