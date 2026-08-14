import fs from "fs"
import path from "path"

import { test, expect, type Page } from "@playwright/test"

import { CAPABILITIES, PRICING_TTL_MS, SQS_DEPTH_TTL_MS } from "../src/lib/aws/capabilities"
import {
  MAX_POLL_WINDOW_MS,
  MIN_POLL_WINDOW_MS,
  POLL_BURST,
  SURFACES,
  isLiveSurface,
  pollBudgetFor,
  type SurfaceId,
} from "../src/lib/aws/result"

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

/**
 * The surfaces backed by a capability read, taken from the registry rather than
 * listed here — a twelfth reader wired in is covered by every test below
 * without this file being edited, and one dropped stops being asserted about.
 */
const LIVE = (Object.keys(SURFACES) as SurfaceId[]).filter(isLiveSurface)

/* ════════════════════════════════════════════════════════════════════════════
 * STUDIO-140-007 — the polling budget, derived rather than picked.
 *
 * Pure, so no browser and no skip: what is under test is decided before a
 * request is made. These are the assertions a hand-typed number cannot pass —
 * each one reads the capability registry and re-derives what `SURFACES` claims,
 * so a literal pasted into the table reds here even when it looks reasonable.
 * ════════════════════════════════════════════════════════════════════════════ */

test.describe("the live surfaces' poll budgets", () => {
  test("every live surface names a real capability and quotes its cadence", () => {
    expect(LIVE.length, "no live surface is registered at all").toBeGreaterThanOrEqual(11)

    for (const id of LIVE) {
      const entry = SURFACES[id]
      const capability = entry.capability
      expect(capability, `${id} is live and names no capability`).not.toBeNull()

      const declared = CAPABILITIES[capability!]
      expect(declared, `${id} names ${capability}, which is not in the registry`).toBeTruthy()

      // The cadence is the capability's own, not a second opinion about the
      // same resource. Retyping it is the drift this asserts against.
      expect(entry.refreshMs, `${id} quotes a cadence the registry does not`).toBe(declared.refreshMs)
      // And the action is the one a denial renders and Terraform is compared
      // against, so the 429 message and the IAM grant cannot disagree.
      expect(entry.awsAction, `${id} names an action its capability does not`).toBe(
        declared.iamActions[0],
      )
    }
  })

  test("the window and the budget are the cadence run through the derivation", () => {
    for (const id of LIVE) {
      const entry = SURFACES[id]
      const derived = pollBudgetFor(entry.refreshMs!)

      // The whole point of the item. A number typed into the table — even a
      // sensible one — fails here, because it is not what the cadence yields.
      expect(entry.windowMs, `${id}'s window is not derived from its cadence`).toBe(derived.windowMs)
      expect(entry.budget, `${id}'s budget is not derived from its cadence`).toBe(derived.budget)
    }
  })

  test("surfaces that move at different speeds get different windows", () => {
    /*
     * The refutation of "one global TTL".
     *
     * Log groups refresh every two minutes, distributions every five, and a
     * certificate inventory on an hourly horizon. If a single window were
     * applied to all three these would be equal, and this test is the only
     * thing standing between that and a console that throttles the account
     * while showing stale numbers.
     */
    expect(SURFACES.logs.windowMs).toBeLessThan(SURFACES.cdn.windowMs)
    expect(SURFACES.cdn.windowMs).toBeLessThan(SURFACES.certificates.windowMs)

    const windows = new Set(LIVE.map((id) => SURFACES[id].windowMs))
    expect(windows.size, "every live surface was given the same window").toBeGreaterThan(1)
  })

  test("a cadence faster than the floor earns a bigger budget, not a shorter window", () => {
    /*
     * SQS queue depth is the fastest thing in the registry — ten seconds,
     * because a dead-letter queue that filled thirty seconds ago is a delivery
     * that already failed. A limiter that gave it a ten-second window would
     * hand out `Retry-After: 3`, which invites the hot loop it exists to stop.
     * So the window holds at the floor and the budget rises to match the
     * cadence: three refreshes fit, so three bursts are admitted.
     */
    const fast = pollBudgetFor(SQS_DEPTH_TTL_MS)
    expect(fast.windowMs).toBe(MIN_POLL_WINDOW_MS)
    expect(fast.budget).toBe(POLL_BURST * Math.floor(MIN_POLL_WINDOW_MS / SQS_DEPTH_TTL_MS))
    expect(fast.budget).toBeGreaterThan(POLL_BURST)
  })

  test("a cadence slower than the ceiling is capped, and never earns less than the burst", () => {
    // A price list refreshes daily. Windowing it at a day would answer an
    // operator's fifth page load with `Retry-After: 80000`, which is a console
    // that appears broken.
    const slow = pollBudgetFor(PRICING_TTL_MS)
    expect(slow.windowMs).toBe(MAX_POLL_WINDOW_MS)
    expect(slow.budget).toBe(POLL_BURST)
    expect(SURFACES.pricing.windowMs).toBe(MAX_POLL_WINDOW_MS)
  })
})

/* ════════════════════════════════════════════════════════════════════════════
 * Bible §20 — there is still no way to say "call this arbitrary AWS action".
 * ════════════════════════════════════════════════════════════════════════════ */

const ROUTE_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "src", "app", "api", "aws", "[surface]", "route.ts"),
  "utf8",
)

test.describe("the read route is not a generic runner", () => {
  test("the live dispatch is a closed switch over exactly the registered surfaces", () => {
    const body = /async function readLiveSurface\([\s\S]*?\n\}\n/.exec(ROUTE_SOURCE)
    expect(body, "readLiveSurface no longer exists in the expected shape").toBeTruthy()

    const cases = [...body![0].matchAll(/case "([a-z]+)":/g)].map((m) => m[1]).sort()

    /*
     * Every branch is a literal, and the set of literals is exactly the set of
     * live surfaces. Replacing the switch with a lookup keyed by a request
     * value — the shape a generic runner takes — empties this list and reds
     * here; adding a twelfth reader without registering it reds too.
     */
    expect(cases).toEqual([...LIVE].sort())
  })

  test("no request value reaches a capability name", () => {
    // `call(` is the gateway's door. The route never opens it: it names
    // modules, and each module names its own capabilities. A `call(` here at
    // all would mean a capability chosen at this layer, which is one refactor
    // away from a capability chosen by the caller.
    expect(ROUTE_SOURCE).not.toMatch(/gateway\(\)/)
    expect(ROUTE_SOURCE).not.toMatch(/\.call\(/)
    for (const forbidden of ["searchParams.get(\"action\")", "searchParams.get(\"capability\")", "searchParams.get(\"service\")"]) {
      expect(ROUTE_SOURCE, `${forbidden} would be an action runner`).not.toContain(forbidden)
    }
  })

  test("only the operations surface accepts a write", () => {
    // A live surface is a READ. The POST handler refuses everything that is not
    // `operations` before it parses a body, so no live surface can be pushed to.
    expect(ROUTE_SOURCE).toContain('if (ctx.surface !== "operations") {')
    expect(ROUTE_SOURCE).toContain("Only /api/aws/operations accepts a write.")
  })
})

/**
 * A real operator session, obtained the way an operator obtains one.
 *
 * The form first, always — the cookie these tests authenticate with should be a
 * cookie the console's own sign-in issued, and constructing a session by hand
 * would test a session shape rather than the endpoint.
 *
 * The fallback exists because the form and the API contract are two different
 * defects and this file must be able to fail for its own reasons. When the
 * `/signin` server action issues no cookie — which it does not, in this tree, as
 * `e2e/signin.spec.ts` "correct credentials reach the console" independently
 * reds — every assertion below would otherwise degrade to `401`, and a suite
 * that reports fourteen API failures for one broken page tells nobody anything.
 *
 * So it falls back to next-auth's OWN credentials callback: the same provider,
 * the same `authorize`, the same signed `authjs.session-token`. That is not a
 * hand-made session; it is the same issuance without the page in front of it.
 * And it is loud — the warning names the page defect, and the page itself stays
 * covered by `signin.spec.ts`, which is where a regression in it belongs.
 */
async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForLoadState("networkidle")

  const hasSession = (await page.context().cookies()).some((c) => c.name.endsWith("session-token"))
  if (hasSession) return

  console.warn(
    "[api-contract] /signin issued no session cookie — falling back to the credentials " +
      "callback. The sign-in PAGE is broken; see e2e/signin.spec.ts.",
  )
  const csrf = (await (await page.request.get("/api/auth/csrf")).json()).csrfToken as string
  await page.request.post("/api/auth/callback/operator", {
    form: { csrfToken: csrf, email: OPERATOR, secret: SECRET, callbackUrl: "/" },
  })
  const now = await page.context().cookies()
  expect(
    now.some((c) => c.name.endsWith("session-token")),
    "neither the sign-in page nor the credentials callback issued a session",
  ).toBe(true)
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

/* ════════════════════════════════════════════════════════════════════════════
 * STUDIO-140-007 — the live surfaces, polled over HTTP.
 *
 * These need the Studio serving. They do NOT need working AWS credentials, and
 * that is deliberate: the property under test is what a poll says when the read
 * did not answer, and an estate this console cannot reach is the cheapest place
 * to observe it. With credentials the same assertions hold on the ACTUAL arm.
 * ════════════════════════════════════════════════════════════════════════════ */

/** The arms that carry a value, or a claim that there is none. */
const ANSWERED = ["ACTUAL", "EMPTY", "STALE"]
/** The arms that carry neither. Each one is a problem document, never a list. */
const VALUELESS = ["DENIED", "THROTTLED", "UNCONFIGURED", "ERROR"]

test.describe("a live surface poll is honest about what it could not read", () => {
  test.skip(!configured, "needs TENANT_TABLE and a reachable DynamoDB")

  test("an unauthenticated poll of a live surface is a problem document, not a list", async ({
    request,
  }) => {
    const response = await request.get("/api/aws/cdn", { maxRedirects: 0 })
    expect(response.status()).toBe(401)
    const problem = await response.json()
    expect(problem.type).toContain("unauthenticated")
    // The negative that matters everywhere in this block: no `items`, so a
    // client rendering the response cannot paint an empty estate with it.
    expect(problem.items).toBeUndefined()
  })

  test("the 404 names every surface this control plane serves", async ({ page }) => {
    await signIn(page)
    const problem = await (await page.request.get("/api/aws/nonesuch")).json()
    for (const id of LIVE) {
      expect(problem.detail, `${id} is registered and not named in the 404`).toContain(id)
    }
  })

  for (const id of LIVE) {
    test(`${id} answers with a read state, and never a reassuring zero`, async ({ page }) => {
      await signIn(page)
      const response = await page.request.get(`/api/aws/${id}?limit=5`)
      const headers = response.headers()

      // The cadence travels on every response, whichever way it went. A client
      // that cannot see the cadence has to guess a poll interval, and the guess
      // is always "as fast as it can".
      expect(headers["x-aws-capability"], `${id} shipped no capability header`).toBe(
        String(SURFACES[id].capability),
      )
      expect(Number(headers["x-aws-refresh-ms"])).toBe(SURFACES[id].refreshMs)
      expect(Number(headers["x-poll-after-ms"])).toBeGreaterThan(0)
      expect(Number(headers["x-ratelimit-limit"])).toBe(SURFACES[id].budget)
      expect(Number(headers["x-ratelimit-window-ms"])).toBe(SURFACES[id].windowMs)

      const state = headers["x-aws-read-state"]
      const body = await response.json()

      if (response.status() === 429 && headers["x-throttle-origin"] === "control-plane") {
        /*
         * OUR limiter, not AWS's, and it is a legitimate answer: this operator
         * has spent this surface's budget. It still carries no rows, still says
         * which limiter refused, and still publishes the cadence — which is the
         * only thing that stops the client guessing an interval again.
         *
         * `NOT_READ` because no call was made. It is not an arm of `AwsRead`
         * on purpose: there is no reading here to be actual, empty or denied.
         */
        expect(state).toBe("NOT_READ")
        expect(body.type).toContain("rate-limited")
        expect(body.items).toBeUndefined()
        expect(Number(headers["retry-after"])).toBeGreaterThan(0)
        return
      }

      if (response.status() === 200) {
        /*
         * A 200 is a CLAIM, and it has to name which claim.
         *
         * `items: []` with no state is the exact shape this whole vocabulary
         * exists to prevent — it is what a denied read looks like once the
         * narrowing has been dropped one layer up, and it reads on screen as
         * "this estate has none of those".
         */
        expect(ANSWERED, `${id} returned 200 in state ${state}`).toContain(state)
        expect(Array.isArray(body.items)).toBe(true)
        expect(body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(headers["x-aws-as-of"]).toBe(body.asOf)
        if (body.items.length === 0) {
          // Zero rows is allowed only when the read said there are none.
          expect(state, `${id} served an empty list without claiming EMPTY`).toBe("EMPTY")
        }
      } else {
        expect(VALUELESS, `${id} failed in state ${state}`).toContain(state)
        // RFC 7807, and the status the console's own renderer branches on.
        expect(response.headers()["content-type"]).toContain("application/problem+json")
        expect(body.correlationId).toMatch(/^req-/)
        expect(body.items, `${id} shipped items alongside a failure`).toBeUndefined()
        expect(body.status).toBe(response.status())

        if (state === "DENIED") {
          expect(response.status()).toBe(403)
          expect(body.type).toContain("aws-access-denied")
          // Principal, action and a pasteable minimum statement — the three
          // things an operator needs to fix it without leaving the client.
          expect(body.detail).toContain("Minimum statement:")
          expect(body.detail).toContain(SURFACES[id].awsAction)
          expect(body.detail).toMatch(/Principal /)
        }
        if (state === "THROTTLED") {
          expect(response.status()).toBe(429)
          // Told apart from OUR limiter, because the remedies differ: wait,
          // versus poll at the cadence you were given.
          expect(headers["x-throttle-origin"]).toBe("aws")
          expect(Number(headers["retry-after"])).toBeGreaterThan(0)
        }
        if (state === "UNCONFIGURED") expect(response.status()).toBe(501)
        if (state === "ERROR") expect(response.status()).toBe(502)
      }
    })
  }

  test("a failed poll carries no rows, so it cannot overwrite a good value", async ({ page }) => {
    await signIn(page)

    // Whatever this estate answers, the invariant is the same one: a response
    // either carries rows and says they are real, or carries none at all.
    const responses = await Promise.all(LIVE.map((id) => page.request.get(`/api/aws/${id}?limit=1`)))
    for (let i = 0; i < LIVE.length; i++) {
      const response = responses[i]
      const body = await response.json()
      const ok = response.status() === 200
      expect(
        ok ? Array.isArray(body.items) : body.items === undefined,
        `${LIVE[i]} answered ${response.status()} with items=${JSON.stringify(body.items)}`,
      ).toBe(true)
    }
  })

  test("the rate limiter is per operator PER SURFACE, and several at once do not share it", async ({
    page,
  }) => {
    await signIn(page)

    /*
     * This test SPENDS a budget, so it needs a fresh window.
     *
     * A fixed-window counter is per process and resets on its own schedule —
     * five minutes for `cdn`. Two runs of this file inside one window therefore
     * see the second one start with the budget already gone, and that is the
     * limiter being correct rather than the test being flaky. Skipped loudly
     * with the remedy named, never quietly passed on a spent window.
     */
    const opening = await page.request.get("/api/aws/cdn?limit=1")
    test.skip(
      opening.status() === 429,
      "cdn's window is already spent by an earlier run — restart the server, or wait it out",
    )

    /*
     * A page that polls six surfaces must not spend one budget six times.
     *
     * Six concurrent polls of six different surfaces, each well inside its own
     * budget. A limiter keyed on the operator alone — or one whose counter is
     * clobbered by interleaved requests — produces a 429 here.
     */
    // Six that are NOT the victim: this test is about budgets not being shared,
    // and including the surface it is about to exhaust would confound the two.
    const together = LIVE.filter((id) => id !== "cdn").slice(0, 6)
    const concurrent = await Promise.all(
      together.map((id) => page.request.get(`/api/aws/${id}?limit=1`)),
    )
    for (let i = 0; i < together.length; i++) {
      expect(
        concurrent[i].status(),
        `${together[i]} was throttled by another surface's traffic`,
      ).not.toBe(429)
      expect(Number(concurrent[i].headers()["x-ratelimit-remaining"])).toBeLessThan(
        SURFACES[together[i]].budget,
      )
    }

    /*
     * Now exhaust ONE surface and show the others still answer. `cdn` is the
     * cheapest to exhaust: four requests per five minutes.
     */
    const victim = "cdn" as const
    let throttled: Awaited<ReturnType<typeof page.request.get>> | null = null
    for (let i = 0; i < SURFACES[victim].budget + 3; i++) {
      const response = await page.request.get(`/api/aws/${victim}?limit=1`)
      if (response.status() === 429) {
        throttled = response
        break
      }
    }
    expect(throttled, `${victim} never throttled inside ${SURFACES[victim].budget + 3} requests`).not.toBeNull()

    const problem = await throttled!.json()
    expect(problem.type).toContain("rate-limited")
    // Ours, not AWS's — and it says which, on the same status code.
    expect(throttled!.headers()["x-throttle-origin"]).toBe("control-plane")
    expect(Number(throttled!.headers()["retry-after"])).toBeGreaterThan(0)
    expect(problem.detail).toContain(SURFACES[victim].awsAction)
    expect(Number(throttled!.headers()["x-ratelimit-remaining"])).toBe(0)

    // The neighbour is untouched. This is the assertion that fails if the
    // counter key stops carrying the surface. `pricing` on purpose: it is not
    // in the concurrent set above, so its budget is barely touched and a 429
    // here can only mean one operator's surfaces are sharing a counter.
    const neighbour = await page.request.get("/api/aws/pricing?limit=1")
    expect(neighbour.status(), "exhausting cdn also throttled pricing").not.toBe(429)
  })

  test("a live surface is read-only over HTTP", async ({ page }) => {
    await signIn(page)
    /*
     * `waf`, not `cdn`, and the reason is worth recording: the test above
     * deliberately exhausts cdn's budget, and a POST to it answered 429 rather
     * than 405 — because `admit` runs BEFORE the method is looked at. That is
     * the correct order (an operator who may not read a surface should not be
     * told its shape), so the fix is to ask a surface whose budget is intact
     * rather than to move the limiter.
     */
    const response = await page.request.post("/api/aws/waf", {
      data: { anything: true },
      headers: { "idempotency-key": "not-a-write" },
    })
    // 405, and the body says where writes live. There is no branch that would
    // turn a POST body into an AWS call.
    expect(response.status()).toBe(405)
    expect((await response.json()).detail).toContain("Only /api/aws/operations accepts a write.")
  })
})
