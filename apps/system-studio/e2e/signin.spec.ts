import fs from "fs"
import path from "path"

import { test, expect, type Page } from "@playwright/test"

import { operatorFor } from "./operator-identity"
import {
  BASE_LOCK_MS,
  FREE_ATTEMPTS,
  MAX_LOCK_MS,
  MAX_TRACKED,
  WINDOW_MS,
  type AttemptStore,
  clearKey,
  clientKeyFrom,
  lockDurationMs,
  prune,
  recordFailure,
  verdictFor,
} from "../src/app/signin/attempts"
import {
  STALE_AFTER_MS,
  configBlock,
  configFacts,
  isDegraded,
  isRedirectError,
  outcomeOf,
  requiredVariables,
  signInView,
  type ConfigProblem,
} from "../src/app/signin/signin-state"

/**
 * Signing in through the FORM, in a browser — and the ten states around it.
 *
 * ── Why this suite exists at all ────────────────────────────────────────────
 *
 * A specific failure. The credentials were verified by posting directly to
 * `/api/auth/callback/operator`, which returned 302 and a session cookie — and
 * the form was still broken, because the server action wrapping it discarded
 * the success. A correct email and secret were answered with "Those credentials
 * were not accepted". Testing the layer underneath the one people use proves
 * the layer underneath works. These drive the page.
 *
 * ── What was added for STUDIO-030-006 ───────────────────────────────────────
 *
 * The requirement names ten states. Four of them can be reached on the ordinary
 * origin by a URL or a gesture — refused, no-permission, stale, retrying — and
 * three more by a browser condition: skeleton, offline, and the form ageing
 * out. The last three are properties of a DEPLOYMENT rather than of a page, so
 * they are driven against separate origins started with a deliberately
 * different environment:
 *
 *     SIGNIN_EMPTY_ORIGIN      nothing configured
 *     SIGNIN_PARTIAL_ORIGIN    some of it configured
 *     SIGNIN_ERROR_ORIGIN      all of it configured, one value refused
 *     SIGNIN_FEDERATED_ORIGIN  STUDIO_AUTH_MODE=cognito
 *     SIGNIN_STRANDED_ORIGIN   an operator this origin does not know
 *
 * Each test that needs one SKIPS LOUDLY, naming the exact command that starts
 * it, rather than asserting something weaker against the origin it has. A test
 * that quietly tests less is worse than a test that says what it could not do —
 * and the commands are in
 * `docs/implementation/system-studio-aws-control-plane-execution-ledger.md`
 * under STUDIO-030-006.
 *
 * ── The half that needs no browser ──────────────────────────────────────────
 *
 * `signin-state.ts` and `attempts.ts` are pure, so the decisions they make are
 * exercised as functions rather than as pixels. `states-logic.spec.ts` already
 * imports console source into a Playwright file for the same reason. The
 * browser tests then prove the page is WIRED to those decisions, which is the
 * half a unit test cannot see.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

test.beforeAll(() => {
  // Fail loudly rather than silently testing a weaker configuration: without
  // these, every assertion below would pass for the wrong reason.
  expect(OPERATOR, "PLATFORM_OPERATORS must be set for this suite").not.toBe("")
  expect(SECRET, "PLATFORM_OPERATOR_SECRET must be set for this suite").not.toBe("")
})

/**
 * Every test listens for uncaught browser errors.
 *
 * Asserting visible text is not enough: a client-side exception can replace the
 * page a moment after an assertion passes, and Playwright does not fail on
 * console output by default. Four green tests here coexisted with a user seeing
 * "Application error: a client-side exception has occurred".
 */
/** Errors seen in the browser during the current test, keyed by its title. */
const browserErrors = new Map<string, string[]>()

test.beforeEach(async ({ page }, testInfo) => {
  const errors: string[] = []
  browserErrors.set(testInfo.testId, errors)

  page.on("pageerror", (err) => {
    errors.push(`${err.name}: ${err.message}`)
  })
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`)
  })
})

test.afterEach(async ({ page }, testInfo) => {
  const errors = browserErrors.get(testInfo.testId) ?? []
  browserErrors.delete(testInfo.testId)

  const body = await page.locator("body").innerText().catch(() => "")
  expect(body, "Next's client-side exception screen").not.toContain("Application error")
  expect(errors, "uncaught errors in the browser").toEqual([])
})

/**
 * A private lock-out bucket for one test.
 *
 * `attempts.ts` keys the counter on the client as the first proxy reported it,
 * which behind CloudFront is `x-forwarded-for`. Setting it here gives a test
 * that deliberately fails its own budget, so a deliberate refusal in one test
 * cannot spend the budget of the twenty other specs that sign in through this
 * page to reach the surface they actually test.
 *
 * It is also, deliberately, a demonstration of the header comment in
 * `attempts.ts`: the key is spoofable, which is why that module calls itself a
 * brake rather than a gate.
 */
async function ownBucket(page: Page, label: string) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${hashByte(label)}` })
}

/** A stable byte from a label, so a rerun uses the same bucket. */
function hashByte(label: string): number {
  let h = 7
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) % 251
  return h + 2
}

/**
 * The sign-in card, and why every state assertion goes through it.
 *
 * `data-state` is this console's word for "which of the fourteen governed
 * states is this" — `components/states.tsx` owns the vocabulary, and more than
 * one surface uses it. The shell's offline banner renders `data-state="offline"`
 * in the layout, on every route, so a bare `[data-state="offline"]` matches two
 * elements and Playwright's strict mode fails the assertion. Worse, it could
 * PASS on the banner while this page's own state was missing.
 *
 * Every assertion below is therefore scoped to the card, which is the sign-in
 * surface and nothing else.
 *
 * The hook is the card's ACCESSIBLE NAME rather than a `data-testid`, on
 * purpose. A test id can be deleted and nothing but this file notices; the
 * `aria-labelledby` cannot, because without it the card stops announcing what
 * it is. The selector and the accessibility are then the same fact, which is
 * the only kind of selector worth pinning a suite to.
 */
const card = (page: Page) => page.locator('section[aria-labelledby="signin-card-heading"]')

/**
 * Wait for React to take over the form.
 *
 * Not politeness — correctness. Before hydration the form is an ordinary HTML
 * form and submitting it is a full-page navigation, which is Next's
 * progressive enhancement working exactly as designed; after it, the same
 * button posts through `fetch` and `useFormStatus` reports the wait. Those are
 * two different mechanisms, and the pending/offline/stale states only exist in
 * the second. A click raced against hydration tests whichever one happened to
 * win, which is how this suite first reported a missing skeleton on a page that
 * renders one.
 */
async function hydrated(page: Page) {
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("form") ?? {}).some((key) => key.startsWith("__react")),
  )
}

/**
 * Submit, and wait for the ANSWER rather than for the network to fall quiet.
 *
 * `waitForLoadState("networkidle")` is the obvious thing to write here and it
 * is wrong: a hydrated server action is a `fetch`, so there is no navigation
 * and no load state to wait for — the call returns immediately, the next
 * iteration fills fields on a page whose previous submission is still in
 * flight, and the clicks are silently dropped. That is what made the lock-out
 * look broken when it was not; a probe that waited for the POST showed the
 * counter incrementing correctly on every attempt.
 */
async function submitAndBeRefused(page: Page) {
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page.getByRole("button", { name: "Sign in" }).click(),
  ])
  // The response has arrived; React still has to commit the new tree. Waiting
  // for the OUTCOME rather than for a duration is what keeps this deterministic
  // on a slow machine: either the refusal is drawn, or the lock is.
  await expect(
    card(page).locator('[data-state="refused"], [data-state="retrying"]'),
  ).toHaveCount(1)
}

/* ══════════════════════════════════════════════ the decisions, without a browser ══ */

test.describe("@logic what state this page is in", () => {
  const wellFormed: readonly ConfigProblem[] = []
  const oneProblem: readonly ConfigProblem[] = [
    { variable: "PLATFORM_OPERATOR_SECRET", detail: "Too short." },
  ]

  test("@logic the misconfiguration panel is given names and never values", () => {
    /*
     * The property this whole page rests on. `/signin` is served to anyone who
     * can reach the host, and `PLATFORM_OPERATORS` is the list of every Tenure
     * operator's address. A panel that printed what it found would publish that
     * list. So a sentinel goes in, and the ENTIRE serialized view is searched
     * for it — not just the field somebody remembered to check.
     */
    const sentinel = "sentinel-value-that-must-never-be-rendered"
    const facts = configFacts("credentials", oneProblem, {
      PLATFORM_OPERATORS: sentinel,
      PLATFORM_OPERATOR_SECRET: sentinel,
    })

    expect(JSON.stringify(facts)).not.toContain(sentinel)
    expect(facts.present).toEqual(["PLATFORM_OPERATORS", "PLATFORM_OPERATOR_SECRET"])

    const view = signInView({
      mode: "credentials",
      nodeEnv: "production",
      facts,
      errorParam: undefined,
      strandedSession: null,
      lock: { locked: false, retryAt: null, failures: 0 },
    })
    expect(JSON.stringify(view)).not.toContain(sentinel)
  })

  test("@logic nothing set, some set and all set are three different answers", () => {
    const none = configBlock(
      configFacts("credentials", oneProblem, {}),
    )
    expect(none?.kind).toBe("empty")
    expect(none?.missing).toEqual(["PLATFORM_OPERATORS", "PLATFORM_OPERATOR_SECRET"])

    const some = configBlock(
      configFacts("credentials", oneProblem, { PLATFORM_OPERATORS: "a@b:auditor-read-only" }),
    )
    expect(some?.kind).toBe("partial")
    expect(some?.missing).toEqual(["PLATFORM_OPERATOR_SECRET"])

    const all = configBlock(
      configFacts("credentials", oneProblem, {
        PLATFORM_OPERATORS: "a@b:auditor-read-only",
        PLATFORM_OPERATOR_SECRET: "short",
      }),
    )
    expect(all?.kind).toBe("error")
    expect(all?.missing).toEqual([])

    // And a configuration nothing objects to is not a state at all.
    expect(
      configBlock(
        configFacts("credentials", wellFormed, {
          PLATFORM_OPERATORS: "a@b:auditor-read-only",
          PLATFORM_OPERATOR_SECRET: "a-long-enough-operator-value-2026",
        }),
      ),
    ).toBeNull()
  })

  test("@logic the two modes need different variables", () => {
    expect(requiredVariables("credentials")).toEqual([
      "PLATFORM_OPERATORS",
      "PLATFORM_OPERATOR_SECRET",
    ])
    expect(requiredVariables("cognito")).toEqual([
      "PLATFORM_OPERATORS",
      "COGNITO_CLIENT_ID",
      "COGNITO_CLIENT_SECRET",
      "COGNITO_ISSUER",
    ])
    // A blank string is not "set". Whitespace is the way an environment
    // variable is most often present and useless.
    expect(configFacts("credentials", [], { PLATFORM_OPERATORS: "   " }).present).toEqual([])
  })

  test("@logic ?error= is a closed vocabulary, not a message to render", () => {
    expect(outcomeOf("1")).toBe("refused")
    expect(outcomeOf("CredentialsSignin")).toBe("refused")
    expect(outcomeOf("AccessDenied")).toBe("noPermission")
    expect(outcomeOf("SessionRequired")).toBe("stale")
    expect(outcomeOf(undefined)).toBeNull()
    expect(outcomeOf("")).toBeNull()
    // Anything an attacker invents lands on the ordinary refusal rather than
    // being passed through to the page.
    expect(outcomeOf("<script>alert(1)</script>")).toBe("refused")
    expect(outcomeOf("YourAccountIsSuspendedCallThisNumber")).toBe("refused")
  })

  test("@logic a refusal is not shown beside a reason the form could never have worked", () => {
    const blocked = signInView({
      mode: "credentials",
      nodeEnv: "development",
      facts: configFacts("credentials", oneProblem, {}),
      errorParam: "1",
      strandedSession: null,
      lock: { locked: false, retryAt: null, failures: 0 },
    })
    expect(blocked.blocking?.kind).toBe("empty")
    expect(blocked.notices.map((n) => n.kind)).not.toContain("refused")

    const usable = signInView({
      mode: "credentials",
      nodeEnv: "development",
      facts: configFacts("credentials", wellFormed, {
        PLATFORM_OPERATORS: "a@b:auditor-read-only",
        PLATFORM_OPERATOR_SECRET: "a-long-enough-operator-value-2026",
      }),
      errorParam: "1",
      strandedSession: null,
      lock: { locked: false, retryAt: null, failures: 0 },
    })
    expect(usable.blocking).toBeNull()
    expect(usable.notices.map((n) => n.kind)).toEqual(["refused"])
  })

  test("@logic a misconfiguration outranks a lock-out", () => {
    const view = signInView({
      mode: "credentials",
      nodeEnv: "development",
      facts: configFacts("credentials", oneProblem, {}),
      errorParam: undefined,
      strandedSession: null,
      lock: { locked: true, retryAt: 1_000, failures: 9 },
    })
    // Both are true; only one can replace the form, and the one that says the
    // form could never have worked is the one worth reading.
    expect(view.blocking?.kind).toBe("empty")
  })

  test("@logic only an event interrupts a screen reader", () => {
    const view = signInView({
      mode: "credentials",
      nodeEnv: "production",
      facts: configFacts("credentials", [], {
        PLATFORM_OPERATORS: "a@b:auditor-read-only",
        PLATFORM_OPERATOR_SECRET: "a-long-enough-operator-value-2026",
      }),
      errorParam: "AccessDenied",
      strandedSession: "someone@example.test",
      lock: { locked: false, retryAt: null, failures: 0 },
    })
    const assertive = view.notices.filter((n) => n.assertive).map((n) => n.kind)
    const polite = view.notices.filter((n) => !n.assertive).map((n) => n.kind)
    expect(assertive).toEqual(["noPermission"])
    // `conflict` and `degraded` are conditions that are true on every load;
    // interrupting for them every time is how a live region gets ignored.
    expect(polite).toEqual(["conflict", "degraded"])
  })

  test("@logic a shared secret in a production build is a degraded path", () => {
    expect(isDegraded("credentials", "production")).toBe(true)
    expect(isDegraded("credentials", "development")).toBe(false)
    expect(isDegraded("cognito", "production")).toBe(false)
  })

  test("@logic the redirect marker is read off digest, not off message", () => {
    // The exact defect this predicate exists for: Next puts the marker on
    // `digest`. A version of this that read `message` reported every SUCCESSFUL
    // sign-in as a failure.
    expect(isRedirectError({ digest: "NEXT_REDIRECT;replace;/;307;" })).toBe(true)
    expect(isRedirectError({ message: "NEXT_REDIRECT;replace;/;307;" })).toBe(false)
    expect(isRedirectError(new Error("NEXT_REDIRECT"))).toBe(false)
    expect(isRedirectError(null)).toBe(false)
    expect(isRedirectError("NEXT_REDIRECT")).toBe(false)
  })
})

/* ═══════════════════════════════════════════════════════ the lock-out, as arithmetic ══ */

test.describe("@logic the lock-out", () => {
  test("@logic the first refusals are free and then the wait doubles", () => {
    for (let n = 0; n <= FREE_ATTEMPTS; n++) {
      expect(lockDurationMs(n), `${n} refusals`).toBe(0)
    }
    expect(lockDurationMs(FREE_ATTEMPTS + 1)).toBe(BASE_LOCK_MS)
    expect(lockDurationMs(FREE_ATTEMPTS + 2)).toBe(BASE_LOCK_MS * 2)
    expect(lockDurationMs(FREE_ATTEMPTS + 3)).toBe(BASE_LOCK_MS * 4)
    // And it is capped, rather than growing into a self-inflicted outage on
    // whichever corporate NAT happens to be the key that day.
    expect(lockDurationMs(FREE_ATTEMPTS + 40)).toBe(MAX_LOCK_MS)
    expect(lockDurationMs(FREE_ATTEMPTS + 4000)).toBe(MAX_LOCK_MS)
  })

  test("@logic a client is locked only after the free attempts are spent", () => {
    const store: AttemptStore = new Map()
    const now = 1_000_000

    for (let n = 1; n <= FREE_ATTEMPTS; n++) {
      const verdict = recordFailure(store, "k", now)
      expect(verdict.locked, `refusal ${n}`).toBe(false)
      expect(verdict.remaining).toBe(FREE_ATTEMPTS - n)
    }

    const locked = recordFailure(store, "k", now)
    expect(locked.locked).toBe(true)
    expect(locked.retryAt).toBe(now + BASE_LOCK_MS)
    expect(locked.failures).toBe(FREE_ATTEMPTS + 1)

    // It lifts on its own.
    expect(verdictFor(store, "k", now + BASE_LOCK_MS - 1).locked).toBe(true)
    expect(verdictFor(store, "k", now + BASE_LOCK_MS + 1).locked).toBe(false)
  })

  test("@logic the count is against the client and never against an address", () => {
    /*
     * The security property. A lock-out keyed on the submitted address would
     * undo the single refusal message: lock `a@x`, watch it be refused
     * differently, and the allowlist is enumerable one address at a time.
     */
    const store: AttemptStore = new Map()
    const now = 2_000_000
    for (let n = 0; n < FREE_ATTEMPTS + 2; n++) recordFailure(store, "198.51.100.7", now)

    const serialized = JSON.stringify([...store.entries()])
    expect(serialized).not.toContain("@")
    expect([...store.keys()]).toEqual(["198.51.100.7"])
  })

  test("@logic an idle window forgives, and a success forgives immediately", () => {
    const store: AttemptStore = new Map()
    const now = 3_000_000
    for (let n = 0; n < FREE_ATTEMPTS + 1; n++) recordFailure(store, "k", now)
    expect(verdictFor(store, "k", now).locked).toBe(true)

    expect(verdictFor(store, "k", now + WINDOW_MS).locked).toBe(false)
    expect(verdictFor(store, "k", now + WINDOW_MS).failures).toBe(0)

    // And the path a real operator takes: two typos, then the right secret.
    const other: AttemptStore = new Map()
    recordFailure(other, "k", now)
    recordFailure(other, "k", now)
    clearKey(other, "k")
    expect(verdictFor(other, "k", now).failures).toBe(0)
    expect(other.size).toBe(0)
  })

  test("@logic the store is bounded, so the brake is not a memory primitive", () => {
    const store: AttemptStore = new Map()
    const now = 4_000_000
    for (let n = 0; n < MAX_TRACKED + 500; n++) recordFailure(store, `key-${n}`, now)
    expect(store.size).toBeLessThanOrEqual(MAX_TRACKED)

    // Expired records go first, ahead of the cap.
    const aged: AttemptStore = new Map()
    recordFailure(aged, "old", now)
    recordFailure(aged, "new", now + WINDOW_MS)
    prune(aged, now + WINDOW_MS)
    expect([...aged.keys()]).toEqual(["new"])
  })

  test("@logic the client key is the first proxy's answer, then the socket", () => {
    const from = (headers: Record<string, string>) =>
      clientKeyFrom((name) => headers[name] ?? null)

    expect(from({ "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2" })).toBe("203.0.113.9")
    expect(from({ "x-forwarded-for": "  203.0.113.9  " })).toBe("203.0.113.9")
    expect(from({ "x-real-ip": "203.0.113.10" })).toBe("203.0.113.10")
    expect(from({})).toBe("direct")
    // An empty header must not become an empty key that every client shares.
    expect(from({ "x-forwarded-for": "" })).toBe("direct")
  })
})

/* ══════════════════════════════════════════════════ the page has no colour of its own ══ */

test.describe("@logic the surface is built on the token layer", () => {
  const dir = path.join(__dirname, "..", "src", "app", "signin")

  test("@logic no file under app/signin carries a literal colour", () => {
    /*
     * The same rule `components/md3/index.ts` states and
     * `md3-tokens-logic.spec.ts` enforces for the primitives, applied to the
     * route that has its own stylesheet. A hex code here is a pair the contrast
     * audit does not know exists, in the file it is least likely to be pointed
     * at.
     */
    const offenders: string[] = []
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".spec.ts")) continue
      const source = fs.readFileSync(path.join(dir, name), "utf8")
      // Comments are prose and may name a colour; only the code is scanned.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/^\s*\*.*$/gm, "")
      if (/#[0-9a-fA-F]{3,8}\b/.test(code)) offenders.push(`${name}: hex literal`)
      if (/\brgba?\(/.test(code)) offenders.push(`${name}: rgb()`)
      if (/\bhsla?\(/.test(code)) offenders.push(`${name}: hsl()`)
      if (/:\s*(white|black|red|green|blue|grey|gray)\s*;/.test(code)) {
        offenders.push(`${name}: colour keyword`)
      }
    }
    expect(offenders, "colour literals under app/signin").toEqual([])
  })

  test("@logic the page itself is not a client component", () => {
    /*
     * The property that keeps `PLATFORM_OPERATORS` on the server. The page
     * reads the allowlist; a `"use client"` at its top would make its props and
     * its module graph part of the browser payload.
     */
    const page = fs.readFileSync(path.join(dir, "page.tsx"), "utf8")
    expect(page.split("\n").slice(0, 3).join("\n")).not.toContain("use client")
    expect(page).toContain('export const dynamic = "force-dynamic"')

    // And the client components it does use are handed nothing from the
    // environment: their props are a timestamp, a duration, a label and a
    // boolean. Named here so adding a fifth prop is a decision somebody makes
    // on purpose.
    for (const name of ["SignInSubmit.tsx", "RetryCountdown.tsx", "Announce.tsx"]) {
      const source = fs.readFileSync(path.join(dir, name), "utf8")
      expect(source, `${name} must not read the environment`).not.toContain("process.env")
    }
  })

  test("@logic the built client bundle carries no operator address", () => {
    /*
     * The check the brief names by hand: `grep -r "tenure.example"
     * .next/static` finding a match is a leak. Done here so it runs every time
     * rather than once.
     */
    const app = path.join(__dirname, "..")
    const roots = fs
      .readdirSync(app)
      .filter((name) => name === ".next" || name.startsWith(".next-"))
      .map((name) => path.join(app, name, "static"))
      .filter((dirPath) => fs.existsSync(dirPath))

    // A vacuous pass is the failure mode this guard has. With no build to read,
    // it fails and says what to run.
    expect(
      roots.length,
      "no built client output to scan — run `npm run studio:build` first",
    ).toBeGreaterThan(0)

    /*
     * VALUES, not names.
     *
     * The first version of this searched for `PLATFORM_OPERATORS` too, and it
     * went red on four chunks belonging to other agents' builds — every one of
     * them a comment or a diagnostic naming the variable. A variable's NAME is
     * printed on the misconfiguration panel of this very page on purpose; what
     * must never cross into the browser is what it holds. So the needles are
     * the operator address, the domain those addresses live on (the string the
     * brief names by hand), and the shared secret.
     */
    const domain = OPERATOR.split("@")[1] ?? ""
    const needles = [OPERATOR, SECRET]
    if (domain) needles.push(domain)

    const hits: string[] = []
    const walk = (dirPath: string) => {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(js|css|json|map)$/.test(entry.name)) continue
        const text = fs.readFileSync(full, "utf8")
        for (const needle of needles) {
          if (text.includes(needle)) hits.push(`${full}: ${needle}`)
        }
      }
    }
    for (const root of roots) walk(root)

    expect(hits, "operator allowlist reached the browser bundle").toEqual([])
  })
})

/* ════════════════════════════════════════════════════════════ the page, in a browser ══ */

test.describe("operator sign-in", () => {
  test("correct credentials reach the console", async ({ page }) => {
    await page.goto("/signin")
    await expect(page.getByRole("heading", { name: "Tenure staff" })).toBeVisible()

    await page.getByLabel("Email").fill(OPERATOR)
    await page.getByLabel("Operator secret").fill(SECRET)
    await page.getByRole("button", { name: "Sign in" }).click()

    // The regression this pins: this used to land back on /signin showing the
    // failure message, because the handler mistook the success redirect for an
    // error.
    await expect(page.getByText("Those credentials were not accepted.")).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Organization systems" })).toBeVisible()

    // And it shows the systems, which is the point of getting in.
    await expect(page.getByText("Simon Business School — Ainslie OSE")).toBeVisible()

    // `Midtown Arts Collective` used to be asserted VISIBLE here, beside the
    // pilot. It is a FIXTURE binding — an organisation that does not exist —
    // and the console index now maps `CUSTOMER_TENANT_BINDINGS` rather than the
    // whole list, because the index is where an operator decides to advance a
    // lifecycle or publish a configuration, and a fixture drawn as a customer
    // is an invitation to do it to one. That is deliberate and is pinned in two
    // places that both run:
    // `tests/architecture/no-fixture-tenants-on-operator-surfaces.test.mjs` and
    // `e2e/console-index.spec.ts` ("no organisation that does not exist is
    // drawn beside the pilot") — the latter in this very suite, so leaving the
    // line as it was would have this file and that one asserting opposites.
    //
    // So the assertion is INVERTED, not dropped: the same string still carries
    // a check, and the pilot assertion above it is what stops an absence from
    // passing on a page that rendered nothing.
    await expect(page.getByText("Midtown Arts Collective")).toHaveCount(0)
  })

  test("a wrong secret is refused", async ({ page }) => {
    await ownBucket(page, "wrong secret")
    await page.goto("/signin")
    await page.getByLabel("Email").fill(OPERATOR)
    await page.getByLabel("Operator secret").fill("not-the-operator-secret-at-all-x")
    await page.getByRole("button", { name: "Sign in" }).click()

    await expect(page.getByText("Those credentials were not accepted.")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Organization systems" })).toHaveCount(0)
  })

  test("an address that is not an operator is refused, identically", async ({ page }) => {
    // Same message as a wrong secret, deliberately: the page must not confirm
    // which addresses are Tenure staff.
    await ownBucket(page, "not an operator")
    await page.goto("/signin")
    await page.getByLabel("Email").fill("someone-else@example.test")
    await page.getByLabel("Operator secret").fill(SECRET)
    await page.getByRole("button", { name: "Sign in" }).click()

    await expect(page.getByText("Those credentials were not accepted.")).toBeVisible()
  })

  test("the two refusals are the same page, word for word", async ({ page }) => {
    /*
     * The two tests above each assert their own refusal. Neither can see that
     * the OTHER one said something different — and "which half was wrong" is
     * exactly the difference a one-word divergence would leak. So the two
     * refusal pages are captured and compared as text.
     */
    const refusalText = async (email: string, secret: string, label: string) => {
      await ownBucket(page, label)
      await page.goto("/signin")
      await page.getByLabel("Email").fill(email)
      await page.getByLabel("Operator secret").fill(secret)
      await page.getByRole("button", { name: "Sign in" }).click()
      await expect(card(page).locator('[data-state="refused"]')).toBeVisible()
      return (await page.locator("main").innerText()).trim()
    }

    const wrongSecret = await refusalText(OPERATOR, "not-the-operator-secret-at-all-x", "same a")
    const wrongAddress = await refusalText("someone-else@example.test", SECRET, "same b")

    expect(wrongSecret).toBe(wrongAddress)
    // And neither of them echoes what was typed, which would be its own oracle
    // and its own reflected-content problem.
    expect(wrongSecret).not.toContain(OPERATOR)
    expect(wrongSecret).not.toContain("someone-else@example.test")
  })

  test("the refusal takes focus, so a screen reader is told", async ({ page }) => {
    /*
     * A refusal arrives as a whole new document, so `role="alert"` announces
     * nothing — there is no change for the live region to report. Focus is what
     * a new document resets, so focus is what is moved.
     */
    await ownBucket(page, "focus")
    await page.goto("/signin")
    await page.getByLabel("Email").fill(OPERATOR)
    await page.getByLabel("Operator secret").fill("not-the-operator-secret-at-all-x")
    await page.getByRole("button", { name: "Sign in" }).click()

    const refusal = card(page).locator('[data-state="refused"]')
    await expect(refusal).toBeVisible()
    await expect(refusal).toBeFocused()
    await expect(refusal).toHaveAttribute("role", "alert")

    // And the next Tab is the field somebody has to correct.
    await page.keyboard.press("Tab")
    await expect(page.getByLabel("Email")).toBeFocused()
  })

  test("the console is unreachable without signing in", async ({ page }) => {
    await page.context().clearCookies()
    await page.goto("/")
    await expect(page).toHaveURL(/\/signin/)
    await expect(page.getByRole("heading", { name: "Organization systems" })).toHaveCount(0)
  })

  test("the signed-out page names no operator anywhere in its HTML", async ({ page }) => {
    await page.context().clearCookies()
    const response = await page.goto("/signin")
    const html = (await response?.text()) ?? ""
    expect(html.length).toBeGreaterThan(0)
    expect(html).not.toContain(OPERATOR)
    expect(html).not.toContain(SECRET)
  })
})

/* ═══════════════════════════════════════════════════ the states, driven in the browser ══ */

test.describe("STUDIO-030-006 — the states of a sign-in form", () => {
  test("skeleton: the submission is in flight and the button cannot be pressed twice", async ({
    page,
  }) => {
    /*
     * Locally this answer arrives in single-digit milliseconds, which is
     * exactly why a double submit is never seen locally and is seen in
     * production. The action is held open so the state it produces can be
     * measured at all.
     */
    await ownBucket(page, "skeleton")
    await page.goto("/signin")
    // Before hydration the same click is an ordinary form navigation, which
    // has no pending state at all. See `hydrated`.
    await hydrated(page)

    await page.route("**/signin*", async (route) => {
      if (route.request().method() !== "POST") return route.fallback()
      await new Promise((resolve) => setTimeout(resolve, 2500))
      await route.continue()
    })

    await page.getByLabel("Email").fill(OPERATOR)
    await page.getByLabel("Operator secret").fill("not-the-operator-secret-at-all-x")
    const button = page.getByRole("button", { name: "Sign in" })
    await button.click()

    await expect(page.getByTestId("signin-skeleton")).toBeVisible()
    await expect(card(page).locator('[data-state="skeleton"]')).toBeVisible()
    const busy = card(page).locator("button[aria-busy='true']")
    await expect(busy).toBeVisible()
    await expect(busy).toBeDisabled()
  })

  test("offline: the browser has no network, and what was typed survives", async ({
    page,
    context,
  }) => {
    await ownBucket(page, "offline")
    await page.goto("/signin")
    await hydrated(page)
    await page.getByLabel("Email").fill(OPERATOR)

    await context.setOffline(true)
    await expect(card(page).locator('[data-state="offline"]')).toBeVisible()
    await expect(page.getByRole("button", { name: "Sign in" })).toBeDisabled()
    // The reason this state exists rather than letting the submit fail: a
    // submission with no network loses the form.
    await expect(page.getByLabel("Email")).toHaveValue(OPERATOR)

    await context.setOffline(false)
    await expect(card(page).locator('[data-state="offline"]')).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled()
  })

  test("stale: a form left open long enough to have been redeployed under it", async ({
    page,
  }) => {
    await ownBucket(page, "stale")
    await page.clock.install()
    await page.goto("/signin")
    await hydrated(page)
    await expect(card(page).locator('[data-state="stale"]')).toHaveCount(0)

    await page.clock.fastForward(STALE_AFTER_MS + 60_000)

    await expect(card(page).locator('[data-state="stale"]')).toBeVisible()
    await expect(page.getByRole("button", { name: "Sign in" })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Reload the form" })).toBeVisible()
  })

  test("no-permission: authenticated, and not staff", async ({ page }) => {
    /*
     * `AccessDenied` is what next-auth emits when the `signIn` callback refuses
     * an identity the provider already authenticated — a real person, really
     * signed in, who is not on the allowlist. It is a different sentence from a
     * refusal, and it must still name nobody.
     */
    await page.goto("/signin?error=AccessDenied")
    const denied = card(page).locator('[data-state="noPermission"]')
    await expect(denied).toBeVisible()
    await expect(denied).toContainText("Denied")
    await expect(page.getByText("Those credentials were not accepted.")).toHaveCount(0)
    expect(await page.locator("main").innerText()).not.toContain("@example")
  })

  test("stale session: sent back here because the session ended", async ({ page }) => {
    await page.goto("/signin?error=SessionRequired")
    await expect(card(page).locator('[data-state="stale"]')).toContainText("Your session ended")
    // The form is still there — this is a notice, not a wall.
    await expect(page.getByLabel("Email")).toBeVisible()
  })

  test("degraded: a production build authenticating with a shared secret", async ({ page }) => {
    /*
     * True of the harness this runs against, and true of any production image
     * started in credentials mode — which is the deployment this notice exists
     * to make visible.
     *
     * There is deliberately no `test.skip` here. The first draft skipped when
     * the notice was absent, "in case the server is a development build", and
     * that is a test that reports success for the one outcome it exists to
     * catch: a notice that stopped rendering looks exactly like a development
     * server. The suite's own harness is a production build in credentials
     * mode — `STUDIO_AUTH_MODE=credentials node .next/standalone/…/server.js`
     * — so the assertion is unconditional and the failure message says which
     * server would make it true.
     */
    await page.goto("/signin")
    const degraded = card(page).locator('[data-state="degraded"]')
    await expect(
      degraded,
      "no degraded notice: run this against a PRODUCTION build started with " +
        "STUDIO_AUTH_MODE=credentials, which is what the harness in the ledger starts",
    ).toContainText("Degraded")
    await expect(degraded).toContainText("shared secret")
    // A notice, never a wall: refusing to authenticate over this would take the
    // console away from the people who cannot fix it from here.
    await expect(page.getByLabel("Email")).toBeVisible()
  })

  test("retrying: too many refusals, and a next-attempt time that is a time", async ({
    page,
  }) => {
    test.slow()
    await ownBucket(page, "lockout")
    await page.goto("/signin")
    await hydrated(page)

    for (let attempt = 0; attempt <= FREE_ATTEMPTS; attempt++) {
      if ((await card(page).locator('[data-state="retrying"]').count()) > 0) break
      await page.getByLabel("Email").fill(OPERATOR)
      await page.getByLabel("Operator secret").fill(`wrong-secret-attempt-${attempt}-xxxx`)
      await submitAndBeRefused(page)
    }

    const locked = card(page).locator('[data-state="retrying"]')
    await expect(locked).toBeVisible()
    await expect(locked).toContainText("Retrying")
    // `states.tsx`: "Retrying…" with no ceiling and no next-attempt time is a
    // spinner with a different word on it.
    await expect(locked).toContainText(/\d{2}:\d{2}:\d{2} UTC/)
    await expect(page.getByTestId("lock-remaining")).toBeVisible()
    // The form is gone, so there is nothing to press.
    await expect(page.getByLabel("Email")).toHaveCount(0)
    // And it says what it counted, which is the client and not the address.
    await expect(locked).toContainText("not against any address")

    // It lifts by itself. `BASE_LOCK_MS` is the first lock, and the countdown
    // is what an operator watches while it does.
    await page.waitForTimeout(BASE_LOCK_MS + 1_500)
    await page.reload()
    await expect(page.getByLabel("Email")).toBeVisible()
  })

  test("retrying: the lock is enforced by the action, not only by the view", async ({
    context,
  }) => {
    test.slow()
    /*
     * Hiding the form is a courtesy to a person and nothing at all to a script.
     *
     * The first version of this test fetched `/signin` again and checked the
     * HTML said "Retrying" — which measures the VIEW, the very thing that is
     * not the protection. Deleting the check inside the server action would
     * have left it green.
     *
     * So this holds a form that was rendered BEFORE the lock — a second tab,
     * which is also the shape of the real attack, since a script keeps whatever
     * form it scraped — drives the lock in another tab on the same client key,
     * and then submits the CORRECT credentials through the stale form. Only the
     * action can refuse that.
     */
    const bucket = `203.0.113.${hashByte("enforced")}`

    const stale = await context.newPage()
    await stale.setExtraHTTPHeaders({ "x-forwarded-for": bucket })
    await stale.goto("/signin")
    await hydrated(stale)
    await expect(stale.getByLabel("Operator secret")).toBeVisible()

    const spray = await context.newPage()
    await spray.setExtraHTTPHeaders({ "x-forwarded-for": bucket })
    await spray.goto("/signin")
    await hydrated(spray)
    for (let attempt = 0; attempt <= FREE_ATTEMPTS; attempt++) {
      if ((await card(spray).locator('[data-state="retrying"]').count()) > 0) break
      await spray.getByLabel("Email").fill(OPERATOR)
      await spray.getByLabel("Operator secret").fill(`wrong-secret-attempt-${attempt}-xxxx`)
      await submitAndBeRefused(spray)
    }
    await expect(card(spray).locator('[data-state="retrying"]')).toBeVisible()

    // The correct credentials, through the form that is still on screen.
    await stale.getByLabel("Email").fill(OPERATOR)
    await stale.getByLabel("Operator secret").fill(SECRET)
    await Promise.all([
      stale.waitForResponse((response) => response.request().method() === "POST"),
      stale.getByRole("button", { name: "Sign in" }).click(),
    ])

    await expect(card(stale).locator('[data-state="retrying"]')).toBeVisible()
    await expect(stale.getByRole("heading", { name: "Organization systems" })).toHaveCount(0)
    expect(new URL(stale.url()).pathname).toBe("/signin")

    await stale.close()
    await spray.close()
  })
})

/* ═════════════════════════════════════════════ the states that are a deployment, not a page ══ */

/**
 * Five states that no gesture on a correctly configured origin can reach,
 * because they are properties of the environment the server was started with.
 * Each is driven against its own origin, and each SKIPS with the command that
 * starts one rather than asserting something weaker.
 */
function origin(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : undefined
}

const START = "node .next/standalone/apps/system-studio/server.js"

test.describe("STUDIO-030-006 — the states a deployment is in", () => {
  test("empty: nothing is configured, so no address can sign in", async ({ page }) => {
    const base = origin("SIGNIN_EMPTY_ORIGIN")
    test.skip(
      !base,
      `set SIGNIN_EMPTY_ORIGIN to an origin started with PLATFORM_OPERATORS and ` +
        `PLATFORM_OPERATOR_SECRET both unset: \`PORT=<p> AUTH_SECRET=… ${START}\``,
    )
    await page.goto(`${base}/signin`)

    const blocked = card(page).locator('[data-state="empty"]')
    await expect(blocked).toBeVisible()
    await expect(blocked).toContainText("Empty")
    await expect(blocked).toContainText("PLATFORM_OPERATORS")
    await expect(blocked).toContainText("PLATFORM_OPERATOR_SECRET")
    // No form, because there is nothing that could be accepted.
    await expect(page.getByLabel("Email")).toHaveCount(0)
    // And no values, ever.
    expect(await page.locator("main").innerText()).not.toContain(SECRET)
  })

  test("partial: some of it is set, and the remedy is only what is not", async ({ page }) => {
    const base = origin("SIGNIN_PARTIAL_ORIGIN")
    test.skip(
      !base,
      `set SIGNIN_PARTIAL_ORIGIN to an origin started with PLATFORM_OPERATORS set and ` +
        `PLATFORM_OPERATOR_SECRET unset: \`PORT=<p> PLATFORM_OPERATORS=… ${START}\``,
    )
    await page.goto(`${base}/signin`)

    const blocked = card(page).locator('[data-state="partial"]')
    await expect(blocked).toBeVisible()
    await expect(blocked).toContainText("Partial")
    await expect(blocked).toContainText("PLATFORM_OPERATOR_SECRET")
    /*
     * The distinction this state exists for. An operator three-quarters of the
     * way through a setup used to be told the same thing as one who had done
     * nothing, and the variable they had ALREADY set was in the list of what to
     * set — which is how somebody spends twenty minutes re-setting a correct
     * value.
     */
    const missingList = blocked.locator("ul").first()
    await expect(missingList.locator("li")).toHaveCount(1)
    await expect(missingList.locator("li").first()).toHaveText("PLATFORM_OPERATOR_SECRET")
    await expect(page.getByLabel("Email")).toHaveCount(0)
  })

  test("error: all of it is set, and one value is refused", async ({ page }) => {
    const base = origin("SIGNIN_ERROR_ORIGIN")
    test.skip(
      !base,
      `set SIGNIN_ERROR_ORIGIN to an origin started with every variable set and one ` +
        `value invalid — e.g. PLATFORM_OPERATORS='a@b.test:not-a-role': \`PORT=<p> … ${START}\``,
    )
    await page.goto(`${base}/signin`)

    const blocked = card(page).locator('[data-state="error"]')
    await expect(blocked).toBeVisible()
    await expect(blocked).toContainText("Error")
    // The validator's own sentence, because only it knows which value is wrong.
    await expect(blocked).toContainText("PLATFORM_OPERATORS")
    // Nothing is "not set" here, so the page does not tell anybody to set it.
    await expect(blocked).not.toContainText("Not set:")
    await expect(page.getByLabel("Email")).toHaveCount(0)
  })

  test("federated: the Cognito path offers no password field at all", async ({ page }) => {
    const base = origin("SIGNIN_FEDERATED_ORIGIN")
    test.skip(
      !base,
      `set SIGNIN_FEDERATED_ORIGIN to an origin started with STUDIO_AUTH_MODE=cognito and ` +
        `COGNITO_CLIENT_ID / COGNITO_CLIENT_SECRET / COGNITO_ISSUER set: \`PORT=<p> … ${START}\``,
    )
    await page.goto(`${base}/signin`)

    await expect(page.getByRole("button", { name: "Continue with Cognito" })).toBeVisible()
    // The property that matters: in the federated mode this console never sees
    // a password, so there is nowhere to type one.
    await expect(page.getByLabel("Operator secret")).toHaveCount(0)
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    // And the shared-secret notice is correctly absent.
    await expect(card(page).locator('[data-state="degraded"]')).toHaveCount(0)
  })

  test("conflict: this browser holds a session this console will not accept", async ({
    page,
  }) => {
    const base = origin("SIGNIN_STRANDED_ORIGIN")
    test.skip(
      !base,
      `set SIGNIN_STRANDED_ORIGIN to an origin on the SAME HOST started with an extra ` +
        `operator this origin does not know — cookies ignore the port, so signing in there ` +
        `leaves a session here: \`PORT=<p> PLATFORM_OPERATORS=…,stranded@tenure.example:auditor-read-only ${START}\``,
    )

    // Sign in on the other origin. Same host, so the session cookie arrives
    // here too — which is precisely the state a revoked operator is left in.
    await page.goto(`${base}/signin`)
    await page.getByLabel("Email").fill("stranded@tenure.example")
    await page.getByLabel("Operator secret").fill(SECRET)
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      page.getByRole("button", { name: "Sign in" }).click(),
    ])

    await page.goto("/signin")
    const conflict = card(page).locator('[data-state="conflict"]')
    await expect(conflict).toBeVisible()
    await expect(conflict).toContainText("Conflict")
    await expect(conflict).toContainText("stranded@tenure.example")

    // A remedy, not just a diagnosis: before this the only fix was clearing a
    // cookie by hand, which is how the state arises in the first place.
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      page.getByRole("button", { name: "Sign out of that session" }).click(),
    ])
    await expect(card(page).locator('[data-state="conflict"]')).toHaveCount(0)
    await expect(page.getByLabel("Email")).toBeVisible()
  })
})

/* ════════════════════════════════════════════════════════════════ shape and access ══ */

test.describe("the sign-in page at the widths and settings it has to survive", () => {
  for (const width of [1440, 900, 320]) {
    test(`no sideways scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto("/signin")
      const overflow = await page.evaluate(() => {
        const root = document.documentElement
        if (root.scrollWidth <= root.clientWidth) return null
        // Name the offender rather than leaving the next person to guess, the
        // way `layout.spec.ts` now does.
        for (const el of Array.from(document.querySelectorAll("body *"))) {
          const rect = el.getBoundingClientRect()
          if (rect.right > root.clientWidth + 1) {
            return `${el.tagName.toLowerCase()}.${el.className} right=${Math.round(rect.right)}`
          }
        }
        return `documentElement ${root.scrollWidth} > ${root.clientWidth}`
      })
      expect(overflow, `horizontal overflow at ${width}px`).toBeNull()
    })
  }

  test("the whole form is reachable and operable from the keyboard alone", async ({ page }) => {
    await page.goto("/signin")
    await page.getByLabel("Email").focus()
    await page.keyboard.type(OPERATOR)
    await page.keyboard.press("Tab")
    await page.keyboard.type(SECRET)
    await page.keyboard.press("Tab")
    await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { name: "Organization systems" })).toBeVisible()
  })

  test("under reduced motion nothing on this page animates", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await ownBucket(page, "reduced motion")
    await page.goto("/signin")
    await hydrated(page)

    await page.route("**/signin*", async (route) => {
      if (route.request().method() !== "POST") return route.fallback()
      await new Promise((resolve) => setTimeout(resolve, 2500))
      await route.continue()
    })
    await page.getByLabel("Email").fill(OPERATOR)
    await page.getByLabel("Operator secret").fill("not-the-operator-secret-at-all-x")
    await page.getByRole("button", { name: "Sign in" }).click()

    const skeleton = page.getByTestId("signin-skeleton")
    await expect(skeleton).toBeVisible()

    /*
     * A keyframe animation is not a transition: `globals.css` zeroes the motion
     * DURATION tokens under reduced motion, and a `1.6s` written into an
     * `@keyframes` rule survives that untouched. So the animation is checked by
     * name, on the pseudo-elements that carry it.
     */
    const animations = await skeleton.evaluate((el) => [
      getComputedStyle(el, "::before").animationName,
      getComputedStyle(el, "::after").animationName,
    ])
    expect(animations).toEqual(["none", "none"])
    // And the bars are still visible — a reduced-motion skeleton is a still
    // skeleton, not a missing one.
    const opacity = await skeleton.evaluate((el) =>
      Number(getComputedStyle(el, "::before").opacity),
    )
    expect(opacity).toBeGreaterThan(0.5)
  })

  test("the mark is drawn at a real size, with its own box", async ({ page }) => {
    /*
     * "Logo is still not put in there." A mark with no intrinsic size is laid
     * out at 300x150 until the stylesheet lands, which is a layout shift on
     * every load (STUDIO-030-008), so both dimensions are attributes.
     */
    await page.goto("/signin")
    const mark = page.locator("main svg").first()
    await expect(mark).toBeVisible()
    await expect(mark).toHaveAttribute("width", /\d+/)
    await expect(mark).toHaveAttribute("height", /\d+/)

    const box = await mark.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(28)
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(100)

    // It takes its colour from the token layer rather than carrying one, so it
    // is the accent in both themes.
    const fill = await mark.locator("g").first().getAttribute("fill")
    expect(fill).toContain("--md-sys-color-primary")
  })
})
