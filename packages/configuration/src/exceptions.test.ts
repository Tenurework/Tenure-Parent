import { z } from "zod"

import type { AuthorityViolation } from "./authority"
import { ConfigRegistry, defineConfig } from "./definition"
import {
  EXCEPTABLE,
  NEVER_EXCEPTABLE,
  applyExceptions,
  covers,
  validateException,
  type GuardrailException,
} from "./exceptions"
import { requiresApproval, type VersionedLayer } from "./layer-schema"
import { planPublication } from "./publication"

/**
 * GE-032-004 — the reviewed path, and everything it must refuse.
 *
 * An exception mechanism that can excuse anything is not a guardrail with a
 * review process, it is a guardrail with a switch. Most of these tests are
 * about the switch not existing.
 */

const NOW = new Date("2026-08-02T00:00:00Z")
const LATER = new Date("2026-08-03T00:00:00Z")

const valid = (over: Partial<GuardrailException> = {}): GuardrailException => ({
  id: "exc-1",
  tenantId: "acme",
  invariant: "physical-placement",
  keys: ["platform.deployment.region"],
  reason: "Contract amendment requires EU residency from the first of the month.",
  scope: "The region key only, for this tenant, until the migration completes.",
  requestedBy: "admin@acme.example",
  approvedBy: "operator@tenure.example",
  approvedAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2026-09-01T00:00:00.000Z",
  ...over,
})

const violation = (over: Partial<AuthorityViolation> = {}): AuthorityViolation => ({
  invariant: "physical-placement",
  key: "platform.deployment.region",
  layerId: "acme",
  detail: "not yours",
  ...over,
})

describe("only physical placement may be excepted, and the Bible says so", () => {
  it("permits physical placement", () => {
    // §2.1 lists five prohibitions and qualifies exactly one with "outside
    // approved requests". That qualifier is the whole mechanism.
    expect(EXCEPTABLE.has("physical-placement")).toBe(true)
    expect(validateException(valid(), NOW)).toEqual([])
  })

  it("refuses the other four, each with the clause that refuses it", () => {
    for (const invariant of [
      "operator-access",
      "audit-integrity",
      "core-schemas",
      "unrestricted-code-execution",
    ] as const) {
      const problems = validateException(valid({ invariant }), NOW)
      expect(problems.map((p) => p.field)).toContain("invariant")
      // The refusal quotes the text, so a future argument for a sixth exception
      // has to be made against the requirement rather than against a habit.
      expect(NEVER_EXCEPTABLE[invariant]).toMatch(/§2\.1/)
    }
  })

  it("names exactly one exceptable invariant", () => {
    // If this ever grows, it should be because someone changed the Bible.
    expect([...EXCEPTABLE]).toEqual(["physical-placement"])
    expect(Object.keys(NEVER_EXCEPTABLE).sort()).toEqual([
      "audit-integrity",
      "core-schemas",
      "operator-access",
      "unrestricted-code-execution",
    ])
  })
})

describe("what makes an exception unusable", () => {
  it("refuses one nobody approved", () => {
    expect(validateException(valid({ approvedBy: null }), NOW).map((p) => p.field)).toContain("approvedBy")
  })

  it("refuses one the requester approved", () => {
    // The same rule as publication: an approval by the requester records a
    // second signature nobody gave.
    const problems = validateException(
      valid({ approvedBy: "admin@acme.example", requestedBy: "admin@acme.example" }),
      NOW,
    )
    expect(problems.map((p) => p.detail).join(" ")).toMatch(/needs a second identity/)
  })

  it("refuses one with no expiry", () => {
    expect(validateException(valid({ expiresAt: "not a date" }), NOW).map((p) => p.field)).toContain(
      "expiresAt",
    )
  })

  it("refuses one that has expired", () => {
    const problems = validateException(valid({ expiresAt: "2026-01-01T00:00:00.000Z" }), NOW)
    expect(problems.map((p) => p.detail).join(" ")).toMatch(/Expired at/)
  })

  it("refuses a blanket scope", () => {
    // An exception that covered everything would be a switch rather than a
    // review.
    expect(validateException(valid({ keys: [] }), NOW).map((p) => p.field)).toContain("keys")
    expect(validateException(valid({ keys: ["platform.deployment.*"] }), NOW).map((p) => p.field)).toContain(
      "keys",
    )
    expect(validateException(valid({ keys: ["platform.deployment."] }), NOW).map((p) => p.field)).toContain(
      "keys",
    )
  })

  it("refuses a placeholder reason or scope", () => {
    expect(validateException(valid({ reason: "wip" }), NOW).map((p) => p.field)).toContain("reason")
    expect(validateException(valid({ scope: "all" }), NOW).map((p) => p.field)).toContain("scope")
  })

  it("reports every problem, not the first", () => {
    const problems = validateException(
      valid({ approvedBy: null, keys: [], reason: "x", scope: "y", expiresAt: "nope" }),
      NOW,
    )
    expect(problems.length).toBeGreaterThanOrEqual(5)
  })
})

describe("what an exception covers", () => {
  it("covers the key it names", () => {
    expect(covers(valid(), violation(), NOW)).toBe(true)
  })

  it("does not cover a key it does not name", () => {
    expect(covers(valid(), violation({ key: "platform.deployment.cell" }), NOW)).toBe(false)
  })

  it("does not cover a different invariant", () => {
    expect(covers(valid(), violation({ invariant: "audit-integrity" }), NOW)).toBe(false)
  })

  it("covers nothing once expired", () => {
    const expired = valid({ expiresAt: "2026-01-01T00:00:00.000Z" })
    expect(covers(expired, violation(), NOW)).toBe(false)
  })

  it("covers nothing while unapproved", () => {
    expect(covers(valid({ approvedBy: null }), violation(), NOW)).toBe(false)
  })

  it("does not cover a whole-layer violation, which names no key", () => {
    // A mechanism that silently covered "everything without a key" would be the
    // switch again.
    //
    // The invariant MUST match the exception's for this to test anything. My
    // first version used an `entitlement` violation, so `covers` returned false
    // at the invariant check and never reached the key check — a mutation
    // excusing every keyless violation passed. It passed for a reason other
    // than the one the test names.
    expect(covers(valid(), violation({ invariant: "physical-placement", key: undefined }), NOW)).toBe(false)
  })
})

describe("applying exceptions records what was excused", () => {
  it("removes the covered violation and says which exception did it", () => {
    // Recorded, not merely removed: an audit trail that says a change was clean
    // when it was permitted is worse than one that says nothing.
    const outcome = applyExceptions([violation()], [valid()], NOW)
    expect(outcome.remaining).toEqual([])
    expect(outcome.relied).toEqual([
      { exceptionId: "exc-1", invariant: "physical-placement", key: "platform.deployment.region" },
    ])
  })

  it("leaves an uncovered violation in place", () => {
    const outcome = applyExceptions(
      [violation(), violation({ invariant: "audit-integrity", key: "platform.observability.logRetentionDays" })],
      [valid()],
      NOW,
    )
    expect(outcome.remaining).toHaveLength(1)
    expect(outcome.remaining[0].invariant).toBe("audit-integrity")
  })

  it("excuses nothing when there are no exceptions", () => {
    expect(applyExceptions([violation()], [], NOW).remaining).toHaveLength(1)
  })
})

describe("the plan honours an approved exception", () => {
  const registry = ConfigRegistry.of([
    defineConfig({
  price: { perSeatMinor: 0, perOrgMinor: 0, currency: "USD", rounding: "half-up", includedBecause: "A test fixture, priced at nothing so the arithmetic under test is the test's own." },
      key: "platform.localization.currency",
      owner: "platform",
      type: z.string(),
      default: "USD",
      allowedScopes: ["blueprint", "tenant"],
      mergeStrategy: "replace",
      sensitivity: "public",
      overridable: true,
      description: "Currency.",
    }),
  ])

  const layer = (values: Record<string, unknown>): VersionedLayer => ({
    kind: "tenantOverlay",
    id: "acme",
    values,
    metadata: {
      version: 1,
      schemaVersion: "1.0.0",
      signer: "arn:aws:kms:us-east-1:000000000000:key/test",
      origin: "exceptions.test.ts",
      compatibility: { minEngine: "2026.7.0", maxEngine: null },
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveUntil: null,
      changeReason: "a reason long enough to be a reason",
      approvedBy: requiresApproval("tenantOverlay") ? "operator:approver" : null,
    },
  })

  const plan = (exceptions: GuardrailException[]) =>
    planPublication({
      registry,
      current: null,
      proposed: [layer({ "platform.deployment.region": "eu-west-1" })],
      publishedBy: "operator:publisher",
      activateAt: LATER,
      now: NOW,
      exceptions,
    })

  it("still blocks with no exception", () => {
    const result = plan([])
    expect(result.blocked).toBe(true)
    expect(result.violations.map((v) => v.invariant)).toContain("physical-placement")
  })

  it("permits the change with one, and records what it relied on", () => {
    const result = plan([valid()])

    // The placement violation is gone and the reliance is recorded.
    expect(result.violations.map((v) => v.invariant)).not.toContain("physical-placement")
    expect(result.excused).toEqual([
      { exceptionId: "exc-1", invariant: "physical-placement", key: "platform.deployment.region" },
    ])

    // `violations` is NOT empty, and that is correct: `core-schemas` still
    // fires because this minimal registry has no definition for the key, and
    // core-schemas is never exceptable. My first version of this test asserted
    // an empty array while the comment below it said the opposite — the code
    // was right and the assertion contradicted its own explanation.
    expect(result.violations.map((v) => v.invariant)).toContain("core-schemas")
  })

  it("is not permitted by an expired exception", () => {
    const result = plan([valid({ expiresAt: "2026-01-01T00:00:00.000Z" })])
    expect(result.violations.map((v) => v.invariant)).toContain("physical-placement")
    expect(result.excused).toEqual([])
  })

  it("cannot be used to excuse an invariant that is never exceptable", () => {
    // The load-bearing one. An operator with a signed exception still cannot
    // grant operator access or weaken audit.
    const result = planPublication({
      registry,
      current: null,
      proposed: [layer({ "platform.observability.logRetentionDays": 1 })],
      publishedBy: "operator:publisher",
      activateAt: LATER,
      now: NOW,
      exceptions: [
        valid({
          invariant: "audit-integrity",
          keys: ["platform.observability.logRetentionDays"],
        }),
      ],
    })
    expect(result.blocked).toBe(true)
    expect(result.violations.map((v) => v.invariant)).toContain("audit-integrity")
    expect(result.excused).toEqual([])
  })
})
