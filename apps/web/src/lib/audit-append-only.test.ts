import { PrismaClient } from "@prisma/client"

import {
  APPEND_ONLY_ALLOWED_OPERATIONS,
  AuditAppendOnlyError,
  appendOnlyRefusal,
  auditAppendOnlyExtension,
} from "@/lib/audit-append-only"
import { clearRecordedViolations, recordedViolations } from "@/lib/tenancy/extension"

/**
 * Two layers, because a guard has two ways to be useless: the rule can be wrong,
 * and the rule can be right but never reached.
 *
 * The first block asserts the rule. The second and third drive a real
 * `PrismaClient` — the actual generated client, with the actual extension, and
 * with the actual client the application imports — so what is proven is that a
 * caller writing `db.auditEvent.deleteMany({})` is refused, not that a function
 * would have refused if someone had called it.
 *
 * No database is involved and none is needed: the extension refuses before the
 * query reaches the driver, and the operations it *permits* fail on the missing
 * connection instead — which is itself the evidence that they got past it.
 */

/** Every operation Prisma can issue against a model, as of 6.19. */
const MUTATING_OPERATIONS = [
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]

const READ_OPERATIONS = [
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]

const APPEND_OPERATIONS = ["create", "createMany", "createManyAndReturn"]

describe("the rule", () => {
  it.each(MUTATING_OPERATIONS)("refuses %s on AuditEvent", (operation) => {
    const refusal = appendOnlyRefusal("AuditEvent", operation)

    expect(refusal).toBeInstanceOf(AuditAppendOnlyError)
    expect(refusal!.model).toBe("AuditEvent")
    expect(refusal!.operation).toBe(operation)
  })

  it.each([...READ_OPERATIONS, ...APPEND_OPERATIONS])("permits %s on AuditEvent", (operation) => {
    expect(appendOnlyRefusal("AuditEvent", operation)).toBeNull()
  })

  it.each(MUTATING_OPERATIONS)("leaves %s alone on every other model", (operation) => {
    expect(appendOnlyRefusal("Organization", operation)).toBeNull()
    expect(appendOnlyRefusal("Event", operation)).toBeNull()
  })

  it("ignores model-less operations, which are raw queries it cannot see anyway", () => {
    expect(appendOnlyRefusal(undefined, "deleteMany")).toBeNull()
  })

  // The reason the permitted set is an allow-list. A deny-list would have
  // silently permitted `updateManyAndReturn` on the day Prisma introduced it.
  it("fails closed on an operation nobody has classified", () => {
    expect(appendOnlyRefusal("AuditEvent", "obliterateMany")).toBeInstanceOf(AuditAppendOnlyError)
  })

  it("does not permit upsert, whose update half would rewrite a record", () => {
    expect(APPEND_ONLY_ALLOWED_OPERATIONS.has("upsert")).toBe(false)
  })
})

describe("through a real Prisma client carrying the extension", () => {
  const client = new PrismaClient().$extends(auditAppendOnlyExtension())

  it.each([
    ["deleteMany", () => client.auditEvent.deleteMany({})],
    ["updateMany", () => client.auditEvent.updateMany({ data: { reason: "tidied up" } })],
    ["delete", () => client.auditEvent.delete({ where: { id: "evt_1" } })],
    [
      "update",
      () => client.auditEvent.update({ where: { id: "evt_1" }, data: { outcome: "ALLOW" } }),
    ],
  ])("refuses %s", async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(AuditAppendOnlyError)
  })

  it("refuses before the query reaches the database", async () => {
    // The refusal is an AuditAppendOnlyError and not a connection failure, which
    // is only possible if the extension short-circuited: there is no
    // DATABASE_URL in this environment, so anything that reached the driver
    // would come back as a Prisma initialization error instead.
    await expect(client.auditEvent.deleteMany({})).rejects.toThrow(/append-only/)
  })

  it("lets a read through — it is a guard, not a wall", async () => {
    // Reaching the driver with no DATABASE_URL is the observable proof of
    // pass-through. What matters is the *kind* of failure.
    await expect(client.auditEvent.findMany({})).rejects.not.toBeInstanceOf(AuditAppendOnlyError)
  })

  it("lets an append through", async () => {
    await expect(
      client.auditEvent.create({
        data: {
          institutionId: "inst_1",
          action: "Event.Rescheduled",
          resourceType: "Event",
          outcome: "ALLOW",
        },
      }),
    ).rejects.not.toBeInstanceOf(AuditAppendOnlyError)
  })

  it("leaves other models mutable", async () => {
    await expect(client.organization.deleteMany({})).rejects.not.toBeInstanceOf(
      AuditAppendOnlyError,
    )
  })
})

describe("the client the application actually imports", () => {
  // The wiring test. Everything above would pass with the extension defined and
  // never attached, which is the failure this requirement is about: the rule
  // existing somewhere is what the audit trail already had.
  it("refuses an audit deletion issued through @/lib/db", async () => {
    const { db } = await import("@/lib/db")

    await expect(db.auditEvent.deleteMany({})).rejects.toBeInstanceOf(AuditAppendOnlyError)
  })

  it("refuses before the tenancy extension scopes it", async () => {
    const { db } = await import("@/lib/db")
    clearRecordedViolations()

    await expect(db.auditEvent.updateMany({ data: { reason: "x" } })).rejects.toBeInstanceOf(
      AuditAppendOnlyError,
    )

    // Prisma runs query extensions in attachment order, so db.ts attaches
    // append-only first to make it outermost. If tenancy ran first it would
    // have recorded this unscoped call before the refusal — an erasure attempt
    // would appear in the coverage report as an ordinary uncovered call site,
    // and someone would go and "fix" it by opening a scope.
    expect(recordedViolations()).toHaveLength(0)
  })
})

// ── PAY-030-005: ApprovalStep is append-only too, and now actually is ────────
//
// schema.prisma has commented this model "append-only" since it existed, and
// `actOnApproval` told its reader it appended to "a trail the schema declares
// immutable". Both were false — the set below had one member. ApprovalStep is
// the platform's ONLY state-transition history, so it is the one place where a
// silent rewrite loses the answer to "who decided this, when, and under what
// policy".

describe("ApprovalStep is append-only", () => {
  it.each(MUTATING_OPERATIONS)("refuses %s on ApprovalStep", (operation) => {
    const refusal = appendOnlyRefusal("ApprovalStep", operation)

    expect(refusal).toBeInstanceOf(AuditAppendOnlyError)
    expect(refusal!.model).toBe("ApprovalStep")
  })

  it.each([...READ_OPERATIONS, ...APPEND_OPERATIONS])(
    "permits %s on ApprovalStep",
    (operation) => {
      expect(appendOnlyRefusal("ApprovalStep", operation)).toBeNull()
    },
  )

  it("refuses a step rewrite issued through the client the application imports", async () => {
    const { db } = await import("@/lib/db")

    // The wiring half. The rule above would pass with "ApprovalStep" in the set
    // and the extension never attached — which is exactly the state the model's
    // own comment described.
    await expect(
      db.approvalStep.updateMany({ where: {}, data: { reason: "rewritten" } }),
    ).rejects.toBeInstanceOf(AuditAppendOnlyError)
    await expect(db.approvalStep.deleteMany({})).rejects.toBeInstanceOf(AuditAppendOnlyError)
  })
})
