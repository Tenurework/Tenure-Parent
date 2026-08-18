/**
 * PAY-180-004 — asserted on the PRODUCER, not on the helper.
 *
 * `financial-identifiers.test.ts` proves the rules. This proves the WIRING: it
 * drives the real `aiComplete` — the one function in this application that
 * posts text to a model vendor — with `global.fetch` stubbed, and reads what
 * would actually have gone on the wire. A test that called `scrubForModel`
 * directly would pass just as well against an `ai.ts` that never calls it,
 * which is the exact failure this repository has recorded before.
 *
 * Everything except `fetch` and the meter's database write is the real thing:
 * the tenant scope, the key read, the detectors, the purpose table.
 */

const mockRecorded: unknown[] = []

jest.mock("@/lib/metering/model-usage", () => ({
  recordModelUsage: async (event: unknown) => {
    mockRecorded.push(event)
  },
}))

import { aiComplete } from "@/lib/ai"
import { runInTenantScope, type TenantScope } from "@/lib/tenancy/context"
import { TOKENIZATION_KEY_VAR, describeScrub, scrubForModel } from "@/lib/payments/financial-redaction"

const PAN = "4111111111111111"
const IBAN = "GB33BUKB20201555555555"
const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

const SCOPE: TenantScope = {
  institutionId: "inst_pay180",
  purpose: "interactive",
  environment: "test",
  actor: { principalId: "user_treasurer", principalType: "user" },
}

/** What the stubbed vendor was sent, and what it answers with. */
let posted: { system: string; user: string }[] = []
let vendorText = "an answer [1]"

const originalFetch = global.fetch
const originalKey = process.env.ANTHROPIC_API_KEY
const originalTokenKey = process.env[TOKENIZATION_KEY_VAR]
const logged: string[] = []
let errorSpy: jest.SpyInstance
let warnSpy: jest.SpyInstance

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-a-real-credential"
})

afterAll(() => {
  global.fetch = originalFetch
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalKey
  if (originalTokenKey === undefined) delete process.env[TOKENIZATION_KEY_VAR]
  else process.env[TOKENIZATION_KEY_VAR] = originalTokenKey
})

beforeEach(() => {
  posted = []
  logged.length = 0
  mockRecorded.length = 0
  vendorText = "an answer [1]"
  process.env[TOKENIZATION_KEY_VAR] = KEY
  global.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      system: string
      messages: { content: string }[]
    }
    posted.push({ system: body.system, user: body.messages[0].content })
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: vendorText }],
        usage: { input_tokens: 11, output_tokens: 7 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }) as unknown as typeof fetch

  const capture = (...args: unknown[]) => {
    logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
  }
  errorSpy = jest.spyOn(console, "error").mockImplementation(capture)
  warnSpy = jest.spyOn(console, "warn").mockImplementation(capture)
})

afterEach(() => {
  errorSpy.mockRestore()
  warnSpy.mockRestore()
})

const onUsage = () => {}

describe("the prompt that leaves the account", () => {
  it("does not carry a card number pasted into a reimbursement note", async () => {
    await runInTenantScope(SCOPE, () =>
      aiComplete("You answer questions about club finance.", `Refund the charge on ${PAN}.`, {
        onUsage,
      }),
    )

    expect(posted).toHaveLength(1)
    expect(posted[0].user).not.toContain(PAN)
    expect(posted[0].user).toMatch(/tk_pan_[0-9a-f]{24}/)
  })

  it("scrubs the system prompt as well as the user turn", async () => {
    await runInTenantScope(SCOPE, () =>
      aiComplete(`Settlement lands on ${IBAN}.`, "Where did the money go?", { onUsage }),
    )

    expect(posted[0].system).not.toContain(IBAN)
    expect(posted[0].system).toMatch(/tk_iban_[0-9a-f]{24}/)
  })

  it("still answers rather than refusing, which is the difference from a credential", async () => {
    const answer = await runInTenantScope(SCOPE, () =>
      aiComplete("system", `Refund the charge on ${PAN}.`, { onUsage }),
    )

    // A credential refuses (`whsec_…` → nothing sent, null returned). A card
    // number is redacted and the question is still asked.
    expect(posted).toHaveLength(1)
    expect(answer).toBe("an answer [1]")
  })

  it("gives the same card the same token across two calls, so the model can still correlate", async () => {
    await runInTenantScope(SCOPE, () =>
      aiComplete("system", `charge ${PAN}`, { onUsage }),
    )
    await runInTenantScope(SCOPE, () =>
      aiComplete("system", `refund ${PAN}`, { onUsage }),
    )

    const first = posted[0].user.match(/tk_pan_[0-9a-f]{24}/)?.[0]
    const second = posted[1].user.match(/tk_pan_[0-9a-f]{24}/)?.[0]
    expect(first).toBeDefined()
    expect(first).toBe(second)
  })

  it("gives two tenants different tokens for the same card", async () => {
    await runInTenantScope(SCOPE, () => aiComplete("system", `charge ${PAN}`, { onUsage }))
    await runInTenantScope({ ...SCOPE, institutionId: "inst_other" }, () =>
      aiComplete("system", `charge ${PAN}`, { onUsage }),
    )

    const first = posted[0].user.match(/tk_pan_[0-9a-f]{24}/)?.[0]
    const second = posted[1].user.match(/tk_pan_[0-9a-f]{24}/)?.[0]
    expect(first).not.toBe(second)
  })

  it("still removes the value when the deployment has no tokenization key, and says so", async () => {
    delete process.env[TOKENIZATION_KEY_VAR]

    await runInTenantScope(SCOPE, () => aiComplete("system", `charge ${PAN}`, { onUsage }))

    expect(posted[0].user).not.toContain(PAN)
    expect(posted[0].user).toContain("[not tokenized: no-key]")
  })

  it("refuses to token-scope outside a tenant rather than tokenizing into a shared namespace", async () => {
    await aiComplete("system", `charge ${PAN}`, { onUsage })

    expect(posted[0].user).not.toContain(PAN)
    expect(posted[0].user).toContain("[not tokenized: no-tenant]")
  })

  it("leaves a prompt with no financial identifier in it byte-for-byte alone", async () => {
    const user = "How much of the catering budget is left?"
    await runInTenantScope(SCOPE, () => aiComplete("system", user, { onUsage }))

    expect(posted[0].user).toBe(user)
    expect(posted[0].system).toBe("system")
  })

  it("logs that it redacted, in counts and kinds, carrying no value", async () => {
    await runInTenantScope(SCOPE, () =>
      aiComplete("system", `card ${PAN} and iban ${IBAN}`, { onUsage }),
    )

    const line = logged.find((l) => l.includes("redacted financial identifiers"))
    expect(line).toBeDefined()
    expect(line).toContain("1×PAN")
    expect(line).toContain("1×IBAN")
    expect(line).not.toContain(PAN)
    expect(line).not.toContain(IBAN)
  })
})

describe("the model's own output", () => {
  it("does not hand back a card number the model produced", async () => {
    vendorText = `We refunded the charge on ${PAN}.`

    const answer = await runInTenantScope(SCOPE, () =>
      aiComplete("system", "what happened?", { onUsage }),
    )

    expect(answer).not.toContain(PAN)
    expect(answer).toMatch(/tk_pan_[0-9a-f]{24}/)
  })

  it("returns an ordinary answer unchanged", async () => {
    vendorText = "The catering line has $420.00 left [1]."

    const answer = await runInTenantScope(SCOPE, () =>
      aiComplete("system", "how much is left?", { onUsage }),
    )

    expect(answer).toBe("The catering line has $420.00 left [1].")
  })
})

describe("the log sink", () => {
  it("keeps a provider error body carrying a card number out of the log line", async () => {
    global.fetch = (async () =>
      new Response(`invalid request: card ${PAN} was rejected`, { status: 400 })) as unknown as typeof fetch

    await runInTenantScope(SCOPE, () => aiComplete("system", "user", { onUsage }))

    const line = logged.find((l) => l.includes("Anthropic API 400"))
    expect(line).toBeDefined()
    expect(line).not.toContain(PAN)
  })
})

describe("describeScrub", () => {
  it("counts by kind and names the refusal when nothing could be tokenized", () => {
    const result = scrubForModel(`card ${PAN} and iban ${IBAN}`, {
      tenantId: "inst_x",
      env: {},
    })
    expect(describeScrub(result.findings)).toBe("1×IBAN, 1×PAN, 2 not tokenized (no-key)")
  })

  it("says none for nothing found", () => {
    expect(describeScrub([])).toBe("none")
  })
})
