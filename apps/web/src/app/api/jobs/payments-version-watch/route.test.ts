import { PROVIDER_API_VERSION, PAYMENT_CAPABILITIES } from "@tenure/payments"

import { POST } from "./route"

/**
 * PAY-010-007 — the watch route, driven.
 *
 * This is the production caller for `watchProviderApiVersion` /
 * `watchProviderFeatures`, so it is exercised as a caller: a real `Request`,
 * the bearer check, the four refusals and the report. Nothing is mocked — the
 * route touches no database and opens no tenant scope, which is itself one of
 * the assertions below.
 */

const SECRET = "job-secret-for-this-test"

function post(body: unknown, auth: string | null = `Bearer ${SECRET}`): Promise<Response> {
  return POST(
    new Request("https://tenure.test/api/jobs/payments-version-watch", {
      method: "POST",
      headers: auth ? { authorization: auth, "content-type": "application/json" } : {},
      body: JSON.stringify(body),
    }),
  )
}

const originalSecret = process.env.JOB_SECRET

beforeEach(() => {
  process.env.JOB_SECRET = SECRET
})

afterAll(() => {
  if (originalSecret === undefined) delete process.env.JOB_SECRET
  else process.env.JOB_SECRET = originalSecret
})

describe("the endpoint is a job endpoint", () => {
  it("refuses when no job secret is configured", async () => {
    delete process.env.JOB_SECRET
    const response = await post({ announcedApiVersion: "2027-02-28" })
    expect(response.status).toBe(503)
  })

  it("refuses a wrong bearer", async () => {
    const response = await post({ announcedApiVersion: "2027-02-28" }, "Bearer wrong")
    expect(response.status).toBe(401)
  })
})

describe("an unfed watcher is not a quiet one", () => {
  it("refuses a request with no announced version rather than defaulting to the pin", async () => {
    // MUTATION TARGET: default `announced` to `PROVIDER_API_VERSION` and this
    // reds. The default would return 200 with zero tasks, which is exactly what
    // a provider that changed nothing looks like.
    const response = await post({})
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe("announced_api_version_required")
    expect(body.pinnedVersion).toBe(PROVIDER_API_VERSION)
  })

  it("refuses an announced version that is not a provider date version", async () => {
    const response = await post({ announcedApiVersion: "latest" })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe("announced_api_version_unreadable")
  })

  it("refuses a malformed feature list rather than reading it as empty", async () => {
    const response = await post({
      announcedApiVersion: "2027-02-28",
      announcedEventTypes: [{ type: "payout.paid" }],
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe("announced_features_unreadable")
  })
})

describe("a provider change comes back as review tasks and no mutation", () => {
  it("returns one task per provider-backed leaf, addressed to a queue", async () => {
    const before = JSON.stringify(PAYMENT_CAPABILITIES)

    const response = await post({
      announcedApiVersion: "2027-02-28",
      announcedEventTypes: ["treasury.outbound_payment.posted"],
      announcedCapabilityIds: ["cards.unlimited-spending"],
    })
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.pinnedVersion).toBe(PROVIDER_API_VERSION)
    expect(body.candidateVersion).toBe("2027-02-28")
    expect(body.mutatesProduction).toBe(false)
    expect(body.reviewRequired).toBe(true)
    expect(body.versionReviewTasks).toHaveLength(PAYMENT_CAPABILITIES.length - 1)
    expect(body.featureReviewTasks).toHaveLength(2)
    for (const task of body.versionReviewTasks) {
      expect(task.queue).toBe("payments-operations")
    }

    // The registry is untouched by having been asked.
    expect(JSON.stringify(PAYMENT_CAPABILITIES)).toBe(before)
  })

  it("reports no work for the version production already runs", async () => {
    const response = await post({ announcedApiVersion: PROVIDER_API_VERSION })
    const body = await response.json()
    expect(body.versionReviewTasks).toEqual([])
    expect(body.featureReviewTasks).toEqual([])
    expect(body.reviewRequired).toBe(false)
    expect(body.alreadyReviewed).toBe(PAYMENT_CAPABILITIES.length - 1)
    expect(body.notApplicable).toBe(1)
  })
})
