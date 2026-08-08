/**
 * The one outbound vendor call, on the two things it never used to do.
 *
 * WRK-120-004 — it discarded the vendor's own token counts, so no tenant could
 * be charged and no budget could ever be enforced. WRK-040-005 — it posted
 * whatever text it was handed, so a reusable provider secret sitting in a club's
 * note field crossed to a third party in the prompt.
 *
 * Nothing here is faked except `global.fetch` and the meter's DATABASE WRITE.
 * `aiConfigured`, `resolveModel`, the allowed-model catalog and the value
 * scanner are the real ones, so what these assert is what would have gone to
 * `api.anthropic.com` and what would have been recorded against a tenant.
 *
 * `recordModelUsage` is stubbed rather than the `onUsage` callback: the callback
 * is what production passes, so a test that supplied a different one would prove
 * the plumbing of the test rather than of `summarizeDocument`. The stub records
 * what the real one would have written, and `metering/model-usage.itest.ts`
 * proves the same numbers reach real Postgres.
 */

const mockRecorded: {
  institutionId: string
  model: string
  inputTokens: number
  outputTokens: number
}[] = []

jest.mock("@/lib/metering/model-usage", () => ({
  recordModelUsage: async (event: {
    institutionId: string
    model: string
    inputTokens: number
    outputTokens: number
  }) => {
    mockRecorded.push(event)
  },
}))

import { allowedModelIds } from "@tenure/platform-config"

import { aiComplete, summarizeDocument } from "@/lib/ai"
import { recordModelUsage } from "@/lib/metering/model-usage"

/**
 * A webhook signing secret in the shape `secret-values.ts` publishes.
 *
 * Ten `a`s, because the pattern requires eight or more characters after the
 * prefix — a five-character stand-in would not match and every refusal
 * assertion below would pass for the wrong reason.
 */
const SIGNING_SECRET = "whsec_aaaaaaaaaa"
const LIVE_KEY = "sk_live_aaaaaaaaaaaaaaaa"

const INSTITUTION = "inst_ai_test"

/** Every request `lib/ai.ts` made, and what it carried. */
let posted: { system: string; user: string }[] = []
/** What the stubbed vendor answers with next. */
let responder: () => Response = () => vendorOk()

/**
 * A 200 in the shape this endpoint really returns one, `usage` included.
 *
 * `usage` is a parameter with no default rather than an optional one: passing
 * `undefined` to a defaulted parameter silently reinstates the default, and the
 * "no usage reported" case would then have been asserted against a response
 * that reported usage.
 */
function vendorOk(usage: unknown = { input_tokens: 137, output_tokens: 42 }): Response {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: "an answer [1]" }], usage }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

/** A 200 with no `usage` field at all — the vendor changing its response shape. */
function vendorWithoutUsage(): Response {
  return new Response(JSON.stringify({ content: [{ type: "text", text: "an answer [1]" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

const originalFetch = global.fetch
const originalKey = process.env.ANTHROPIC_API_KEY
const errors: string[] = []
let errorSpy: jest.SpyInstance

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-a-real-credential"
})

afterAll(() => {
  global.fetch = originalFetch
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalKey
})

beforeEach(() => {
  posted = []
  mockRecorded.length = 0
  errors.length = 0
  responder = () => vendorOk()
  global.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      system: string
      messages: { content: string }[]
    }
    posted.push({ system: body.system, user: body.messages[0].content })
    return responder()
  }) as unknown as typeof fetch

  // Captured rather than silenced: two assertions below are ABOUT the log line.
  errorSpy = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
  })
})

afterEach(() => {
  errorSpy.mockRestore()
})

/**
 * The callback every production caller supplies.
 *
 * Identical in shape to `meterFor` inside `lib/ai.ts` and to the closure
 * `/api/ai/chat` passes — it forwards the vendor's usage to `recordModelUsage`,
 * which is the module stubbed above.
 */
const meter =
  (institutionId: string) =>
  (usage: { model: string; inputTokens: number; outputTokens: number }) =>
    recordModelUsage({ ...usage, institutionId, at: new Date() })

/* ─────────────────────────────────────────────────────── WRK-120-004 (measure) */

describe("the vendor's own token counts reach the meter", () => {
  it("reports exactly what the response said, not an estimate of it", async () => {
    const text = await aiComplete("system", "user", { onUsage: meter(INSTITUTION) })

    expect(text).toBe("an answer [1]")
    // The numbers are the fixture's, so a producer that hardcoded zeros — or
    // estimated from string length, or reported `max_tokens` — fails here.
    expect(mockRecorded).toEqual([
      expect.objectContaining({
        institutionId: INSTITUTION,
        inputTokens: 137,
        outputTokens: 42,
      }),
    ])
  })

  it("records WHICH model spent them, because two models do not cost the same", async () => {
    await aiComplete("system", "user", { onUsage: meter(INSTITUTION) })

    // The id `resolveModel` actually chose, from the shipped allowed-model
    // catalog — asserted against the catalog rather than a literal, so a meter
    // that stamped a constant instead of the model that ran fails here.
    expect(mockRecorded[0].model).toBe(allowedModelIds()[0])
  })

  it("meters the call a document summary makes, through its own production wrapper", async () => {
    // `summarizeDocument` is what
    // `src/app/(app)/orgs/[slug]/documents/[id]/summary/page.tsx` calls, and it
    // passes the institution the document belongs to. A meter proven only on
    // `aiComplete` would say nothing about whether a SURFACE charges the right
    // tenant, which is the half that decides whose invoice moves.
    const summary = await summarizeDocument("Catering agreement", "Deposit due 1 May.", "inst_docs")

    expect(summary).toBe("an answer [1]")
    expect(mockRecorded).toEqual([
      expect.objectContaining({ institutionId: "inst_docs", inputTokens: 137, outputTokens: 42 }),
    ])
  })

  it("refuses to return an answer the vendor reported no usage for", async () => {
    // The other direction of the same rule: an unattributable answer is not
    // handed back, so "the meter did not move" can never mean "the call was
    // free".
    responder = () => vendorWithoutUsage()

    expect(await aiComplete("system", "user", { onUsage: meter(INSTITUTION) })).toBeNull()
    expect(mockRecorded).toEqual([])
    expect(errors.join("\n")).toMatch(/returned no usage/)
  })

  it("refuses a usage object whose numbers are not whole", async () => {
    responder = () => vendorOk({ input_tokens: "137", output_tokens: 42 })
    expect(await aiComplete("system", "user", { onUsage: meter(INSTITUTION) })).toBeNull()
    expect(mockRecorded).toEqual([])
  })
})

/* ──────────────────────────────────────────────────── WRK-040-005 (model sink) */

describe("a prompt carrying a reusable provider secret is refused, not posted", () => {
  it("does not reach the vendor at all when the user message carries one", async () => {
    const text = await aiComplete(
      "You are Tenure AI.",
      `The club pasted this into their notes: ${SIGNING_SECRET}`,
      { onUsage: meter(INSTITUTION) },
    )

    expect(text).toBeNull()
    // The assertion that matters: nothing was sent. A redaction would have
    // posted a question with a hole in it and returned an answer built on it.
    expect(posted).toEqual([])
    expect(mockRecorded).toEqual([])
  })

  it("refuses one in the system message too", async () => {
    await aiComplete(`Authenticate with ${LIVE_KEY}`, "hello", { onUsage: meter(INSTITUTION) })
    expect(posted).toEqual([])
  })

  it("names the kind and the path, and never the value", async () => {
    await aiComplete("You are Tenure AI.", `key: ${SIGNING_SECRET}`, {
      onUsage: meter(INSTITUTION),
    })

    const line = errors.join("\n")
    expect(line).toContain("webhook signing secret")
    expect(line).toContain("prompt.user")
    // Logging the credential to say a credential was found would move it from
    // one place it does not belong to another.
    expect(line).not.toContain(SIGNING_SECRET)
  })

  it("refuses through a production wrapper, over an uploaded document's own text", async () => {
    // The production shape of the leak: nobody types a secret into a prompt.
    // Somebody uploads a file with one in it, and the summariser puts it there.
    const summary = await summarizeDocument(
      "Integration runbook",
      `Stripe endpoint secret is ${SIGNING_SECRET}`,
      "inst_docs",
    )

    expect(summary).toBeNull()
    expect(posted).toEqual([])
  })

  it("still posts an ordinary prompt, so the guard is not simply off", async () => {
    // Without this the four assertions above would all pass against a function
    // that had stopped calling the vendor entirely.
    await aiComplete("You are Tenure AI.", "When is the budget due?", {
      onUsage: meter(INSTITUTION),
    })
    expect(posted).toHaveLength(1)
    expect(posted[0].user).toContain("When is the budget due?")
  })
})

/* ────────────────────────────────────────────────────── WRK-040-005 (log sink) */

describe("a provider error body is scanned before it reaches the log", () => {
  it("does not print a secret the vendor echoed back", async () => {
    responder = () =>
      new Response(`{"error":{"message":"invalid x-api-key ${LIVE_KEY}"}}`, { status: 401 })

    expect(await aiComplete("system", "user", { onUsage: meter(INSTITUTION) })).toBeNull()

    const line = errors.join("\n")
    expect(line).toContain("Anthropic API 401")
    expect(line).not.toContain(LIVE_KEY)
    expect(line).toContain("[redacted: this text carried a reusable credential]")
  })

  it("still prints an ordinary error body, so the redaction is not blanket", async () => {
    responder = () => new Response(`{"error":{"message":"model not found"}}`, { status: 404 })

    await aiComplete("system", "user", { onUsage: meter(INSTITUTION) })

    expect(errors.join("\n")).toContain("model not found")
  })

  it("does not print a secret carried by a thrown request failure", async () => {
    global.fetch = (async () => {
      throw new Error(`connect ECONNREFUSED for token ${LIVE_KEY}`)
    }) as unknown as typeof fetch

    expect(await aiComplete("system", "user", { onUsage: meter(INSTITUTION) })).toBeNull()

    const line = errors.join("\n")
    expect(line).not.toContain(LIVE_KEY)
    // An Error's `message` is not an own enumerable property, so a redactor
    // that walked the object rather than flattening it first would have logged
    // `{}` and this assertion is what notices.
    expect(line).toContain("[redacted: this text carried a reusable credential]")
  })
})
