/**
 * WRK-120-004 — the meter, against real Postgres, driven by the real vendor call.
 *
 * The unit tests prove the boundary arithmetic with the database faked. This
 * proves the thing they cannot: that the numbers the VENDOR reported travel all
 * the way from `aiComplete`'s response parser into a row, and that
 * `budgetVerdict` reads that row back and changes its answer because of it.
 *
 * The chain under test, end to end:
 *
 *     stubbed 200 with usage → aiComplete's parser → onUsage → recordModelUsage
 *       → ModelUsageMeter row → modelTokensUsedInPeriod → budgetVerdict
 *
 * Only `global.fetch` is replaced. The parse, the callback, the Prisma write,
 * the SUM, the tenant resolution and the configuration read are all real. That
 * placement is deliberate: this is the file that reds if `ai.ts` stops parsing
 * `usage` and reports a constant instead, because the total stops moving with
 * the fixture's response.
 *
 * Needs a live database, so it is a `.itest.ts` and runs under
 * `npm run test:isolation`, not in the default jest run.
 */

jest.setTimeout(60_000)

import { db } from "@/lib/db"
import { runUnscoped } from "@/lib/tenancy/context"
import { aiComplete } from "@/lib/ai"
import {
  budgetVerdict,
  modelTokensUsedInPeriod,
  periodOf,
  recordModelUsage,
} from "./model-usage"

/** Distinct per run: this suite writes rows and is not idempotent. */
const RUN = Date.now().toString(36)
const institutionId = `inst-meter-${RUN}`

const AT = new Date("2026-08-07T13:00:00.000Z")
/** A different UTC month, to prove the period actually partitions the sum. */
const NEXT_MONTH = new Date("2026-09-01T00:30:00.000Z")

/** What the stubbed vendor reports. The meter must carry exactly these. */
const INPUT_TOKENS = 137
const OUTPUT_TOKENS = 42

const originalFetch = global.fetch
const originalKey = process.env.ANTHROPIC_API_KEY

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-a-real-credential"
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        content: [{ type: "text", text: "an answer [1]" }],
        usage: { input_tokens: INPUT_TOKENS, output_tokens: OUTPUT_TOKENS },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch

  await runUnscoped("seed", "model-usage meter fixture tenant", async () => {
    await db.institution.create({
      data: {
        id: institutionId,
        name: `Meter Fixture ${RUN}`,
        slug: `meter-fixture-${RUN}`,
        // No blueprint binding for this slug, so the configuration resolves to
        // platform defaults — which is the honest state of a tenant nobody has
        // configured, and the case the budget must still have an answer for.
        serving: true,
      },
    })
  })
})

afterAll(async () => {
  global.fetch = originalFetch
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalKey

  await runUnscoped("seed", "remove model-usage meter fixture", async () => {
    // Cascades to ModelUsageMeter through the migration's foreign key, which is
    // itself worth exercising: a meter that outlived its institution would be
    // usage attributed to a tenant that no longer exists.
    await db.institution.deleteMany({ where: { id: institutionId } })
  })
})

/** Rows this tenant has, read back outside any scope so the read is not the thing under test. */
function meterRows() {
  return runUnscoped("seed", "read back the meter", () =>
    db.modelUsageMeter.findMany({ where: { institutionId }, orderBy: { createdAt: "asc" } }),
  )
}

describe("the vendor's numbers become a row", () => {
  it("records what the response said, through aiComplete's own callback", async () => {
    const text = await aiComplete("system", "user", {
      onUsage: (usage) =>
        runUnscoped("seed", "meter one call", () =>
          recordModelUsage({ ...usage, institutionId, at: AT }),
        ),
    })

    expect(text).toBe("an answer [1]")

    const rows = await meterRows()
    expect(rows).toHaveLength(1)
    // The mutation this file exists for: hardcode `{input_tokens: 0,
    // output_tokens: 0}` in ai.ts instead of the parsed usage and these two
    // fail, because the row stops tracking the fixture's response.
    expect(rows[0].inputTokens).toBe(INPUT_TOKENS)
    expect(rows[0].outputTokens).toBe(OUTPUT_TOKENS)
    expect(rows[0].period).toBe(periodOf(AT))
    expect(rows[0].model.length).toBeGreaterThan(0)
  })

  it("sums the period in the database, not in the process", async () => {
    // A second call in the same month. The total has to move by exactly what
    // the vendor reported, which a counter that recorded a constant cannot do.
    await aiComplete("system", "user", {
      onUsage: (usage) =>
        runUnscoped("seed", "meter one call", () =>
          recordModelUsage({ ...usage, institutionId, at: AT }),
        ),
    })

    const total = await runUnscoped("seed", "sum the meter", () =>
      modelTokensUsedInPeriod(institutionId, AT),
    )
    expect(total).toBe((INPUT_TOKENS + OUTPUT_TOKENS) * 2)
  })

  it("keeps a different calendar month out of the sum", async () => {
    await runUnscoped("seed", "meter a September call", () =>
      recordModelUsage({
        institutionId,
        model: "claude-x",
        inputTokens: 1_000_000,
        outputTokens: 0,
        at: NEXT_MONTH,
      }),
    )

    const august = await runUnscoped("seed", "sum August", () =>
      modelTokensUsedInPeriod(institutionId, AT),
    )
    const september = await runUnscoped("seed", "sum September", () =>
      modelTokensUsedInPeriod(institutionId, NEXT_MONTH),
    )

    // August is unchanged by a September row — the allowance is per month, and
    // a sum that ignored the period would carry last month's spend forever.
    expect(august).toBe((INPUT_TOKENS + OUTPUT_TOKENS) * 2)
    expect(september).toBe(1_000_000)
  })
})

describe("the budget reads the rows back", () => {
  it("allows a tenant whose real total is inside its resolved ceiling", async () => {
    const verdict = await runUnscoped("seed", "decide the budget", () =>
      budgetVerdict(institutionId, AT),
    )

    expect(verdict.allowed).toBe(true)
    expect(verdict.period).toBe(periodOf(AT))
    // Not a fixture: the total came out of Postgres and moved with the two
    // metered calls above.
    expect(verdict.usedTokens).toBe((INPUT_TOKENS + OUTPUT_TOKENS) * 2)
    expect(verdict.capTokens).toBeGreaterThan(0)
  })

  it("refuses once the rows in the table exceed the ceiling", async () => {
    const before = await runUnscoped("seed", "decide the budget", () =>
      budgetVerdict(institutionId, AT),
    )
    expect(before.allowed).toBe(true)

    // One row that spends the rest of the allowance and one token more. The
    // verdict flips because of a DATABASE ROW, which is the property a stubbed
    // aggregate cannot establish.
    await runUnscoped("seed", "spend the allowance", () =>
      recordModelUsage({
        institutionId,
        model: "claude-x",
        inputTokens: before.capTokens! - before.usedTokens + 1,
        outputTokens: 0,
        at: AT,
      }),
    )

    const after = await runUnscoped("seed", "decide the budget again", () =>
      budgetVerdict(institutionId, AT),
    )
    expect(after.allowed).toBe(false)
    expect(after.reason).toBe("budget-exhausted")
    expect(after.usedTokens).toBe(after.capTokens! + 1)
  })
})
