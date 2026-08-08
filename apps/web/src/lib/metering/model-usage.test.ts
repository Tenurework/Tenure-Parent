/**
 * WRK-120-004 — the meter and the budget, at their boundaries.
 *
 * Two things are faked and everything else is real. The DATABASE is faked,
 * because the sum is what these tests supply; `model-usage.itest.ts` proves the
 * same functions against real Postgres. And `resolveSystemConfig` is wrapped so
 * a test can write a value into the pilot's own TENANT LAYER, exactly as
 * publishing a configuration change would — the registry, the definition, the
 * blueprint bindings and the resolver underneath it are the shipped ones.
 *
 * That second point is what makes the "never a constant" claim testable at all.
 * A cap compiled into this module would satisfy every boundary assertion below
 * and fail the one that publishes a different allowance for one tenant.
 */

import { resolveConfigOrThrow, type ConfigLayer } from "@tenure/configuration"

/** Values folded into the pilot's tenant layer, per test. */
let mockTenantValues: Record<string, unknown> = {}
/** When true, the resolved configuration carries no budget key at all. */
let mockBudgetKeyMissing = false

jest.mock("@tenure/platform-config", () => {
  const actual = jest.requireActual<typeof import("@tenure/platform-config")>(
    "@tenure/platform-config",
  )
  const engine = jest.requireActual<typeof import("@tenure/configuration")>("@tenure/configuration")
  return {
    ...actual,
    resolveSystemConfig: (slug: string) => {
      const layers: ConfigLayer[] = actual
        .layersFor(slug)
        .map((l) =>
          l.scope === "tenant" ? { ...l, values: { ...l.values, ...mockTenantValues } } : l,
        )
      const resolved = engine.resolveConfigOrThrow(actual.REGISTRY, layers)
      if (!mockBudgetKeyMissing) return resolved
      // The only way the key resolves to a non-number: the definition has left
      // the registry. Reproduced by removing it from the resolved values rather
      // than by passing a string, because a string would be refused by the
      // definition's own schema and never reach the reader.
      const values = { ...resolved.values }
      delete values[actual.MODEL_TOKEN_BUDGET_KEY]
      return { ...resolved, values }
    },
  }
})

const findUnique = jest.fn(async (_args: unknown) => ({ slug: "rochester" }))
const aggregate = jest.fn(async (_args: unknown) => ({
  _sum: { inputTokens: 0, outputTokens: 0 } as {
    inputTokens: number | null
    outputTokens: number | null
  },
}))
const create = jest.fn(async (_args: unknown) => ({}))

jest.mock("@/lib/db", () => ({
  db: {
    institution: { findUnique: (a: unknown) => findUnique(a) },
    modelUsageMeter: {
      aggregate: (a: unknown) => aggregate(a),
      create: (a: unknown) => create(a),
    },
  },
}))

import { MODEL_TOKEN_BUDGET_KEY, modelTokenBudgetPerMonth } from "@tenure/platform-config"

import {
  budgetVerdict,
  modelTokensUsedInPeriod,
  periodOf,
  recordModelUsage,
} from "./model-usage"

/** The platform default, read off the definition rather than restated here. */
const DEFAULT_CAP = modelTokenBudgetPerMonth.default as number

const INSTITUTION = "inst_roch"
const AT = new Date("2026-08-07T13:00:00.000Z")

/** Make the aggregate answer with a period total split across the two columns. */
function used(total: number) {
  aggregate.mockImplementation(async () => ({
    _sum: { inputTokens: total, outputTokens: 0 },
  }))
}

beforeEach(() => {
  mockTenantValues = {}
  mockBudgetKeyMissing = false
  findUnique.mockClear()
  aggregate.mockClear()
  create.mockClear()
  findUnique.mockImplementation(async () => ({ slug: "rochester" }))
  used(0)
})

describe("the period a call is billed into", () => {
  it("is the UTC calendar month, zero-padded", () => {
    expect(periodOf(new Date("2026-01-31T23:59:59.999Z"))).toBe("2026-01")
    expect(periodOf(new Date("2026-12-01T00:00:00.000Z"))).toBe("2026-12")
  })

  it("is decided in UTC, not in whatever zone the container runs in", () => {
    // 2026-09-01T00:30Z is still August in New York. A meter that used local
    // time would file the same call in different months on two containers, and
    // the sum over "September" would depend on which one answered.
    expect(periodOf(new Date("2026-09-01T00:30:00.000Z"))).toBe("2026-09")
  })

  it("is what the aggregate filters on, alongside the tenant", () => {
    // The index the migration creates is `[institutionId, period]`. A query that
    // filtered on neither would still return a number, and it would be the
    // whole platform's.
    return modelTokensUsedInPeriod(INSTITUTION, AT).then(() => {
      expect(aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { institutionId: INSTITUTION, period: "2026-08" } }),
      )
    })
  })
})

describe("recording one provider call", () => {
  it("writes the vendor's numbers, the model, and the derived period", async () => {
    await recordModelUsage({
      institutionId: INSTITUTION,
      model: "claude-x",
      inputTokens: 137,
      outputTokens: 42,
      at: AT,
    })

    expect(create).toHaveBeenCalledWith({
      data: {
        institutionId: INSTITUTION,
        model: "claude-x",
        inputTokens: 137,
        outputTokens: 42,
        period: "2026-08",
        occurredAt: AT,
      },
    })
  })

  it("refuses a count that is not a whole non-negative number", async () => {
    // Clamping to zero would report a tenant as having spent nothing on a call
    // that spent something, which is the failure this whole item is about
    // arriving through a different door.
    for (const bad of [-1, 1.5, Number.NaN]) {
      await expect(
        recordModelUsage({
          institutionId: INSTITUTION,
          model: "claude-x",
          inputTokens: bad,
          outputTokens: 1,
          at: AT,
        }),
      ).rejects.toThrow(/inputTokens/)
    }
    expect(create).not.toHaveBeenCalled()
  })
})

describe("the budget boundary", () => {
  it("allows a tenant whose period total is exactly AT the cap", async () => {
    used(DEFAULT_CAP)

    const verdict = await budgetVerdict(INSTITUTION, AT)

    expect(verdict).toEqual({
      allowed: true,
      reason: "within-budget",
      period: "2026-08",
      usedTokens: DEFAULT_CAP,
      capTokens: DEFAULT_CAP,
    })
  })

  it("refuses a tenant one token over it", async () => {
    used(DEFAULT_CAP + 1)

    const verdict = await budgetVerdict(INSTITUTION, AT)

    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe("budget-exhausted")
    expect(verdict.usedTokens).toBe(DEFAULT_CAP + 1)
  })

  it("adds both columns, so output tokens are not free", async () => {
    // Input and output are billed alike. A sum that read one column would
    // under-count every call by its answer.
    aggregate.mockImplementation(async () => ({
      _sum: { inputTokens: DEFAULT_CAP, outputTokens: 1 },
    }))
    expect((await budgetVerdict(INSTITUTION, AT)).allowed).toBe(false)
  })

  it("treats a tenant that has spent nothing as having spent nothing", async () => {
    // `_sum` is null on both columns when no rows match, and `null + null` is 0
    // in JavaScript only if somebody coerced it deliberately.
    aggregate.mockImplementation(async () => ({
      _sum: { inputTokens: null, outputTokens: null },
    }))
    const verdict = await budgetVerdict(INSTITUTION, AT)
    expect(verdict.usedTokens).toBe(0)
    expect(verdict.allowed).toBe(true)
  })
})

describe("the cap comes from the tenant's published configuration", () => {
  it("moves when the tenant publishes a different allowance", async () => {
    // The assertion a constant cannot pass: the SAME usage produces opposite
    // verdicts depending only on configuration.
    //
    // Read in the direction the platform default actually sets. That default is
    // ZERO, because this key is authority-gating and what an institution nobody
    // has configured inherits must grant nothing — see the pinned list in
    // `packages/platform-config/src/resolve.test.ts`. So 1,000 tokens is outside
    // the fallback and inside an allowance this tenant publishes for itself, and
    // both directions are asserted: a reader that ignored configuration entirely
    // would pass either one alone.
    used(1_000)
    expect((await budgetVerdict(INSTITUTION, AT)).allowed).toBe(false)

    mockTenantValues = { [MODEL_TOKEN_BUDGET_KEY]: 5_000 }
    const raised = await budgetVerdict(INSTITUTION, AT)

    expect(raised.capTokens).toBe(5_000)
    expect(raised.allowed).toBe(true)

    mockTenantValues = { [MODEL_TOKEN_BUDGET_KEY]: 500 }
    const verdict = await budgetVerdict(INSTITUTION, AT)

    expect(verdict.capTokens).toBe(500)
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe("budget-exhausted")
  })

  it("resolves the tenant by its own slug, not by a fixed one", async () => {
    // The id→slug bridge is what makes the cap per tenant at all. A reader that
    // skipped it would resolve platform defaults for everybody.
    await budgetVerdict(INSTITUTION, AT)
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: INSTITUTION } }),
    )
  })

  it("refuses, distinctly, when the ceiling cannot be read at all", async () => {
    // Not reported as `budget-exhausted`: one is a tenant at its limit and the
    // other is a platform defect, and an operator told the wrong one goes and
    // raises the wrong allowance.
    mockBudgetKeyMissing = true
    used(0)

    const verdict = await budgetVerdict(INSTITUTION, AT)

    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe("budget-unreadable")
    expect(verdict.capTokens).toBeNull()
  })
})

describe("the configuration this reads is the engine's, not a stub", () => {
  it("resolves the shipped definition through the shipped registry", () => {
    // Guards every assertion above: if the wrapper stopped running the engine,
    // the boundary tests would pass against a hardcoded number.
    const { REGISTRY, layersFor } = jest.requireActual<typeof import("@tenure/platform-config")>(
      "@tenure/platform-config",
    )
    const resolved = resolveConfigOrThrow(REGISTRY, layersFor("rochester"))
    expect(resolved.values[MODEL_TOKEN_BUDGET_KEY]).toBe(DEFAULT_CAP)
    expect(modelTokenBudgetPerMonth.key).toBe(MODEL_TOKEN_BUDGET_KEY)
  })
})
