import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  TENANT_SCOPED,
  PLATFORM_GLOBAL,
  UNENFORCEABLE,
  allRegisteredModels,
  isTenantScoped,
  isPlatformGlobal,
} from "./registry"

/**
 * The registry is only worth having if it cannot drift from the schema.
 *
 * These tests read prisma/schema.prisma directly, so adding a model without
 * classifying it is a failing build rather than a silent hole in the
 * chokepoint. That is the whole mechanism — not the lists themselves.
 */

type ParsedModel = { name: string; hasInstitutionId: boolean }

function parseSchemaModels(): ParsedModel[] {
  // Anchored on this file, not on process.cwd(). This is the only filesystem
  // read in src/, and it is the guard that a new Prisma model cannot be added
  // without being classified here — so it must not quietly ENOENT the first
  // time jest is invoked from the monorepo root instead of from apps/web.
  const schema = readFileSync(
    join(__dirname, "..", "..", "..", "prisma", "schema.prisma"),
    "utf8",
  )
  const models: ParsedModel[] = []

  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    models.push({
      name: match[1],
      hasInstitutionId: /^\s*institutionId\s/m.test(match[2]),
    })
  }
  return models
}

describe("the registry matches prisma/schema.prisma", () => {
  const schemaModels = parseSchemaModels()

  it("parses the schema at all", () => {
    // Guards the rest of this file: a broken regex would make every assertion
    // below vacuously pass over an empty list.
    expect(schemaModels.length).toBeGreaterThan(30)
    expect(schemaModels.map((m) => m.name)).toContain("Organization")
  })

  it("classifies every model in the schema", () => {
    const registered = new Set(allRegisteredModels())
    const unclassified = schemaModels.map((m) => m.name).filter((n) => !registered.has(n))

    expect(unclassified).toEqual([])
  })

  it("does not classify models that no longer exist", () => {
    const inSchema = new Set(schemaModels.map((m) => m.name))
    const stale = allRegisteredModels().filter((n) => !inSchema.has(n))

    expect(stale).toEqual([])
  })

  it("puts every model in exactly one bucket", () => {
    const all = allRegisteredModels()
    const duplicates = all.filter((n, i) => all.indexOf(n) !== i)

    expect(duplicates).toEqual([])
  })

  // The load-bearing one. If a model carries institutionId, the query layer can
  // and therefore must filter on it — leaving it out would be a scoped model
  // the chokepoint silently ignores.
  it("treats every model carrying institutionId as tenant-scoped", () => {
    const shouldBeScoped = schemaModels.filter((m) => m.hasInstitutionId).map((m) => m.name)
    const missing = shouldBeScoped.filter((n) => !isTenantScoped(n))

    expect(missing).toEqual([])
  })

  // The inverse: nothing may claim to be enforceable without the column that
  // makes enforcement possible.
  it("does not claim to scope a model that has no institutionId", () => {
    const withColumn = new Set(schemaModels.filter((m) => m.hasInstitutionId).map((m) => m.name))
    const lying = TENANT_SCOPED.filter((n) => !withColumn.has(n))

    expect(lying).toEqual([])
  })

  it("counts what we expect today", () => {
    // A tripwire, not a spec: if these move, the change was intentional and
    // this number should be updated deliberately along with the reasoning.
    //
    // 15 → 16 on 2026-08-01: OutboxEvent (GE-021-006). An outbox row is a
    // tenant's event awaiting delivery, and a dispatcher reading across tenants
    // would be reading every tenant's activity — exactly what the chokepoint
    // exists to prevent. The tripwire fired on the migration, which is the
    // behaviour it was written for.
    //
    // 16 → 17 on 2026-08-07: InboxEvent (PAY-020-005). The acknowledgement side
    // of the same events: a dedupe check that spanned tenants would let one
    // institution's already-consumed event suppress another's, which is a
    // dropped delivery caused by an isolation failure rather than by a bug in
    // the dispatcher. The tripwire fired on the migration, as intended.
    //
    // 17 -> 24 on 2026-08-07: seven rows in one migration
    // (20260807120000_payments_tenant_scoped_ledger_and_provider_references).
    // LedgerEntry MOVED here from UNENFORCEABLE — it gained its own
    // institutionId, backfilled from Organization, so the chokepoint can filter
    // it rather than hoping the caller joined. The other seven are new:
    // ReceiptAllocation (PAY-230-004), ConflictDeclaration and Recusal
    // (PAY-150-003), and ExternalReference, Settlement and
    // ProviderBalanceTransaction (PAY-020-004 / PAY-080-004 / PAY-130-004).
    //
    // The payments three deserve a sentence of their own, because their UNIQUE
    // keys are deliberately NOT tenant-first — (provider, mode, connected
    // account, objectType, externalId) is global by design, since the same
    // provider id under two accounts is two objects whoever owns them. That
    // means the index cannot be what keeps one tenant out of another's reads,
    // and the chokepoint has to be. The tripwire fired on the migration, which
    // is the behaviour it was written for.
    // 24 → 25 and 5 → 6 on 2026-08-07, one model each, and they are the two
    // halves of the same webhook path. `PaymentsFundsFlowConfig` (PAY-270-002)
    // carries institutionId and is scoped: it says who is liable for a charge.
    // `ProviderEventReceipt` (PAY-000-007) carries none and is GLOBAL, which is
    // the interesting one — it is written when an event is received and
    // verified, before attribution, and its (provider, mode, accountId,
    // eventId) uniqueness enforces "the platform saw this once". Scoping it
    // would make one redelivery processable once per tenant, which is the bug
    // the table exists to prevent.
    expect(TENANT_SCOPED).toHaveLength(25)
    expect(PLATFORM_GLOBAL).toHaveLength(6)
    //
    // 19 → 20 on 2026-08-03: Seat (GE-050-002). The durable position left Role
    // so that renaming a seat no longer edits the row authorization reads. It
    // reaches its tenant through Organization, exactly as Role does, so it is
    // unenforceable by column rather than tenant-scoped. The tripwire fired on
    // the migration, which is the behaviour it was written for.
    //
    // 20 -> 19 on 2026-08-07: LedgerEntry left for TENANT_SCOPED, above. This is
    // the one direction this number is supposed to move.
    expect(Object.keys(UNENFORCEABLE)).toHaveLength(19)
    //
    // 41 -> 50 on 2026-08-07. Nine models landed across the payments migrations:
    // ConflictDeclaration, Recusal, ReceiptAllocation, ExternalReference,
    // Settlement and ProviderBalanceTransaction here, plus InboxEvent,
    // ProviderEventReceipt and PaymentsFundsFlowConfig from the sibling
    // requirements. The number is a tripwire on the schema, so it moves only
    // when somebody has looked at what moved it.
    expect(schemaModels).toHaveLength(50)
  })
})

describe("classification helpers", () => {
  it("identifies tenant-scoped models", () => {
    expect(isTenantScoped("Organization")).toBe(true)
    expect(isTenantScoped("User")).toBe(false)
    expect(isTenantScoped(undefined)).toBe(false)
  })

  it("identifies platform-global models", () => {
    expect(isPlatformGlobal("User")).toBe(true)
    expect(isPlatformGlobal("Organization")).toBe(false)
  })

  it("treats an unknown model as neither", () => {
    // Matters because the extension decides what to do from these two answers;
    // an unknown model must not accidentally read as global.
    expect(isTenantScoped("NotAModel")).toBe(false)
    expect(isPlatformGlobal("NotAModel")).toBe(false)
  })

  it("records how each unenforceable model reaches its tenant", () => {
    for (const [model, info] of Object.entries(UNENFORCEABLE)) {
      expect(info.reachableVia).toBeTruthy()
      expect(typeof info.reachableVia).toBe("string")
      expect(model).not.toBe("")
    }
  })
})
