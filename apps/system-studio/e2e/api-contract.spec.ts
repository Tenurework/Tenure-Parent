import { test, expect, type Page } from "@playwright/test"

/**
 * STUDIO-130-002 — the control-plane API's contract, driven over HTTP.
 *
 * Every assertion here is about a property a CLIENT can rely on, which is the
 * only kind worth having for an API: a cursor it cannot decode, a 304 with no
 * body, a problem document it can branch on by `type`, a retry that replays
 * instead of re-acting, and a denial that is not an empty list.
 *
 * Driven through `page.request` after a real sign-in, so the cookie the routes
 * authenticate with is a cookie the sign-in issued. Constructing a session by
 * hand would test a session shape rather than the endpoint.
 *
 * Skipped without a table, and skipped loudly: a spec that quietly passes when
 * the database is absent is worse than none, because the ledger would cite it.
 */

const OPERATOR = (process.env.PLATFORM_OPERATORS ?? "").split(",")[0]?.split(":")[0]?.trim() ?? ""
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""
const configured = !!process.env.TENANT_TABLE

/** Seeded by `tools/dev/seed-studio-fleet.mjs`. */
const SEEDED = "seed-deployed"

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForLoadState("networkidle")
}

test.describe("the control-plane API", () => {
  test.skip(!configured, "needs TENANT_TABLE and a reachable DynamoDB")

  test("an unauthenticated call is a problem document, not a redirect", async ({ request }) => {
    const response = await request.get("/api/aws/fleet", { maxRedirects: 0 })
    expect(response.status()).toBe(401)
    expect(response.headers()["content-type"]).toContain("application/problem+json")

    const problem = await response.json()
    // Branchable by `type`, which is the whole reason RFC 7807 exists here: a
    // client must be able to tell a denial from a throttle without reading
    // English that somebody will improve next month.
    expect(problem.type).toContain("unauthenticated")
    expect(problem.status).toBe(401)
    expect(problem.correlationId).toMatch(/^req-[0-9a-f]{32}$/)
    expect(problem.instance).toBe("/api/aws/fleet")
  })

  test("an unknown surface is 404 with the surfaces named", async ({ page }) => {
    await signIn(page)
    const response = await page.request.get("/api/aws/nonesuch")
    expect(response.status()).toBe(404)
    const problem = await response.json()
    expect(problem.detail).toContain("fleet")
    expect(problem.detail).toContain("cost")
  })

  test("the cursor is opaque, and the second page is not the first", async ({ page }) => {
    await signIn(page)

    const first = await page.request.get("/api/aws/fleet?limit=1")
    expect(first.status()).toBe(200)
    const one = await first.json()
    expect(one.items.length).toBe(1)
    expect(one.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(one.correlationId).toMatch(/^req-/)
    expect(one.nextCursor, "a fleet of three did not offer a second page").not.toBeNull()

    /*
     * The opacity assertion, and the reason it is written this way.
     *
     * A base64 of the DynamoDB `LastEvaluatedKey` would pass a test that only
     * checked "the cursor is a string". So this DECODES it and asserts the
     * bytes are not a table key: no `pk`, no `sk`, no `TENANT#`, and not valid
     * JSON at all. Mutating the route to return `btoa(JSON.stringify(key))`
     * reds exactly here.
     */
    const decoded = Buffer.from(String(one.nextCursor), "base64url").toString("utf8")
    expect(decoded).not.toContain("pk")
    expect(decoded).not.toContain("sk")
    expect(decoded).not.toContain("TENANT#")
    expect(() => JSON.parse(decoded)).toThrow()

    const second = await page.request.get(
      `/api/aws/fleet?limit=1&cursor=${encodeURIComponent(one.nextCursor)}`,
    )
    expect(second.status()).toBe(200)
    const two = await second.json()
    expect(two.items.length).toBe(1)
    expect(two.items[0].slug).not.toBe(one.items[0].slug)
  })

  test("a forged cursor is refused rather than scanned from", async ({ page }) => {
    await signIn(page)
    const forged = Buffer.from(JSON.stringify({ offset: 0 })).toString("base64url")
    const response = await page.request.get(`/api/aws/fleet?cursor=${encodeURIComponent(forged)}`)
    expect(response.status()).toBe(400)
    const problem = await response.json()
    expect(problem.type).toContain("invalid-request")
  })

  test("If-None-Match replays as 304 with no body", async ({ page }) => {
    await signIn(page)

    const first = await page.request.get("/api/aws/fleet?limit=2")
    const etag = first.headers()["etag"]
    expect(etag, "the read surface shipped no ETag").toBeTruthy()

    const again = await page.request.get("/api/aws/fleet?limit=2", {
      headers: { "if-none-match": etag },
    })
    expect(again.status()).toBe(304)
    expect((await again.body()).length).toBe(0)
  })

  test("a cost surface with no bill connected is 501, never an empty list", async ({ page }) => {
    await signIn(page)
    const response = await page.request.get("/api/aws/cost")

    // The assertion that matters is the negative one: `200 {items: []}` here
    // would read as "this fleet spends nothing", which is the exact failure the
    // three-armed result type exists to prevent.
    expect(response.status()).toBe(501)
    const problem = await response.json()
    expect(problem.type).toContain("surface-not-configured")
    expect(problem.detail).toContain("FINOPS_CUR_BUCKET")
  })

  test("the cost surface is rate-limited well below the others", async ({ page }) => {
    await signIn(page)

    // Cost Explorer is billed per request; its budget is an order of magnitude
    // below the registry surfaces on purpose. Hammering it must produce a 429
    // with a Retry-After a client can honour, not a slow 501.
    let throttled: Awaited<ReturnType<typeof page.request.get>> | null = null
    for (let i = 0; i < 12; i++) {
      const response = await page.request.get("/api/aws/cost")
      if (response.status() === 429) {
        throttled = response
        break
      }
    }

    expect(throttled, "the cost surface never throttled in twelve requests").not.toBeNull()
    expect(Number(throttled!.headers()["retry-after"])).toBeGreaterThan(0)
    const problem = await throttled!.json()
    expect(problem.type).toContain("rate-limited")
    expect(problem.detail).toContain("ce:GetCostAndUsageWithResources")
  })

  test("a write with no Idempotency-Key is refused", async ({ page }) => {
    await signIn(page)
    const response = await page.request.post("/api/aws/operations", {
      data: { slug: SEEDED, to: "SUSPENDING", expectedVersion: 0 },
    })
    expect(response.status()).toBe(400)
    const problem = await response.json()
    expect(problem.type).toContain("idempotency-key-required")
  })

  test("the same key with the same body replays; a different body is a conflict", async ({ page }) => {
    await signIn(page)

    const key = `idem-e2e-${Date.now().toString(36)}`
    // A move that will be refused by the lifecycle is fine here: what is under
    // test is that the SECOND call does not run anything, and the operation
    // record is written either way.
    const body = { slug: SEEDED, to: "SUSPENDING", expectedVersion: 0, reason: "api contract spec" }

    const first = await page.request.post("/api/aws/operations", {
      data: body,
      headers: { "idempotency-key": key },
    })
    const firstBody = await first.json()

    const second = await page.request.post("/api/aws/operations", {
      data: body,
      headers: { "idempotency-key": key },
    })
    const secondBody = await second.json()

    if (firstBody.operationId) {
      // The replay returns the FIRST operation, not a new one. Two ids here
      // would mean two real attempts wearing one key.
      expect(secondBody.replayed).toBe(true)
      expect(secondBody.operationId).toBe(firstBody.operationId)
    } else {
      // The first was refused before it claimed the key — the gate deliberately
      // claims last, so a refused command does not burn a key. Then the second
      // is refused identically rather than replayed.
      expect(second.status()).toBe(first.status())
    }

    // Same key, different command. Never a replay: returning the first result
    // would tell the caller their SECOND request succeeded.
    const conflicting = await page.request.post("/api/aws/operations", {
      data: { ...body, to: "HIBERNATING" },
      headers: { "idempotency-key": key },
    })
    if (firstBody.operationId) {
      expect(conflicting.status()).toBe(409)
      const problem = await conflicting.json()
      expect(problem.type).toContain("idempotency-conflict")
    }
  })

  test("operations are per tenant, paginated, and refuse a fleet-wide read", async ({ page }) => {
    await signIn(page)

    const missing = await page.request.get("/api/aws/operations")
    expect(missing.status()).toBe(400)
    expect((await missing.json()).detail).toContain("?slug=")

    const listed = await page.request.get(`/api/aws/operations?slug=${SEEDED}&limit=1`)
    expect(listed.status()).toBe(200)
    const body = await listed.json()
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.correlationId).toMatch(/^req-/)
  })

  test("the CSV export carries only what this operator may read", async ({ page }) => {
    await signIn(page)

    const response = await page.request.get("/api/aws/fleet?format=csv")
    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toContain("text/csv")

    const csv = await response.text()
    expect(csv.split("\n")[0]).toContain("slug,displayName,state")
    expect(csv).toContain("seed-deployed")

    /*
     * STUDIO-100-002 — the authorization projection.
     *
     * `seed-elsewhere` is placed in eu-west-1, and this control plane holds
     * credentials for one region. `authorizeCommand` refuses it with
     * REGION_OUT_OF_SCOPE, so it must not be in the file. Dropping the
     * projection from the route reds exactly this line, and nothing else — which
     * is what makes it a test of the export rather than of the policy.
     */
    expect(csv).not.toContain("seed-elsewhere")
    expect(Number(response.headers()["x-refused-count"])).toBeGreaterThan(0)
  })
})
