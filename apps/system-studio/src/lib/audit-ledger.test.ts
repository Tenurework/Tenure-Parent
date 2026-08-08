/**
 * STUDIO-110-005 / STUDIO-060-010 — the Studio's mutating actions, and whether
 * they actually reach the ledger.
 *
 * ## Why this asserts on the ACTIONS and not on the ledger
 *
 * `audit-ledger.itest.ts` proves the ledger's own properties against a real
 * DynamoDB: the chain survives a round trip, a tampered row is reported at its
 * sequence, a duplicate sequence is refused. Every one of those stays green on
 * the day `composeTenant` stops calling `appendIntent` — a correct writer with
 * no caller records nothing, which is the state this requirement was opened
 * against and the exact shape the fix can regress to.
 *
 * So every assertion here drives the REAL server action — `composeTenant`,
 * `adoptTenantAction`, and the authorization check in front of both — and reads
 * back the rows those actions actually wrote. The ledger, the record builder,
 * the hash chain, the authorization engine, the manifest validator, the module
 * resolver, the cell registry and the adoption builder are all the real ones.
 *
 * ## The registry stand-in
 *
 * DynamoDB is replaced and nothing else is, and the stand-in reproduces the
 * PROPERTIES the ledger depends on rather than the shape of the API:
 *
 *   - a conditional put on `attribute_not_exists(sk)`, which is the only reason
 *     `previousHash` means anything. A stand-in that overwrote would agree with
 *     whatever this code did and prove nothing.
 *   - the sort key's zero-padding, so `SEQ#10` sorts after `SEQ#9`. Unpadded,
 *     the newest-first read that finds the tail returns the wrong row and every
 *     later record chains onto something that is not its predecessor.
 *   - `removeUndefinedValues: true` and a JSON round trip, because that is what
 *     the real document client does to an item on the way in (registry.ts:71).
 *     A chain whose hash does not survive being stored is not a chain.
 *
 * ## Ordering is recorded, not inferred
 *
 * `__calls` interleaves the audit writes with the registry writes in ONE list,
 * so "the intent was written BEFORE the act" is an assertion about a sequence of
 * events rather than about what exists once everything has finished. Checking
 * afterwards cannot tell first from second.
 */

/* The fleet, the estate and the operator allowlist are all read from the
 * environment on first USE and cached from there, so setting them in the module
 * body is early enough. Real values of the real shape: `authorizeCommand` parses
 * this allowlist itself, and a test that stubbed the decision would not be
 * exercising the denial path at all. */
process.env.AWS_REGION = "us-east-1"
process.env.AWS_ACCOUNT_ID = "000000000000"
process.env.AWS_PARTITION = "aws"
process.env.DEPLOY_ENVIRONMENT = "production"
process.env.CELL_MAX_TENANTS = "50"
process.env.CELL_TENANT_COUNT = "0"
process.env.PLATFORM_OPERATORS =
  "lead@tenure.example:platform-super-admin,reader@tenure.example:auditor-read-only"
// Long enough and varied enough to satisfy `operatorConfigProblems`, which
// refuses a short or low-entropy secret. A value that failed that check made
// every decision below `CONFIG_UNUSABLE`, which is a real refusal and not the
// one these tests are about.
process.env.PLATFORM_OPERATOR_SECRET = "kQ7pXm2Zr9Tb4Ns6Wf1Yc8Vd3Hj5Lg0"
process.env.TENANT_TABLE = "tenure-studio-tenants-test"

import { verifyChain, type AuditRecord } from "@tenure/audit"

/* ─────────────────────────────────────────────── the DynamoDB stand-in ── */

/**
 * Everything lives inside the factory.
 *
 * `jest.mock` is hoisted above the module body, and the factory is called the
 * first time `./registry` is required — which is while `../app/tenants/actions`
 * is being imported, i.e. before any `const` here has initialised. A factory
 * closing over a module-level object reads it in its temporal dead zone.
 */
jest.mock("./registry", () => {
  const SEQ = "SEQ#"
  const HOLD = "HOLD#"
  const RELEASE = "HOLDRELEASE#"

  class AuditSequenceTaken extends Error {
    constructor(
      readonly partition: string,
      readonly sequence: number,
    ) {
      super(`Sequence ${sequence} of the ${partition} audit chain is already written.`)
      this.name = "AuditSequenceTaken"
    }
  }

  class SlugTaken extends Error {
    constructor(readonly slug: string) {
      super(`${slug} is already registered`)
      this.name = "SlugTaken"
    }
  }

  /** Rows by `pk sk`, exactly as a table is keyed. */
  const table = new Map<string, Record<string, unknown>>()
  /** Every write, audit and tenant alike, in the order it happened. */
  const calls: string[] = []

  /** What the real document client does to an item on the way in. */
  const marshalled = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

  const auditPk = (partition: string) => `AUDIT#${partition}`
  const auditSk = (sequence: number) => `${SEQ}${String(sequence).padStart(12, "0")}`

  const putConditional = (
    pk: string,
    sk: string,
    item: Record<string, unknown>,
    onTaken: () => never,
  ) => {
    const key = `${pk} ${sk}`
    if (table.has(key)) onTaken()
    table.set(key, marshalled({ ...item, pk, sk }))
  }

  const registerUnder = (kind: string, slug: string) => {
    calls.push(`${kind}:${slug}`)
    if (table.has(`TENANT#${slug} META`)) throw new SlugTaken(slug)
    table.set(`TENANT#${slug} META`, { slug })
  }

  return {
    AUDIT_SEQUENCE_PREFIX: SEQ,
    AUDIT_HOLD_PREFIX: HOLD,
    AUDIT_HOLD_RELEASE_PREFIX: RELEASE,
    AuditSequenceTaken,
    SlugTaken,

    tableName: () => process.env.TENANT_TABLE!,
    registryConfigured: () => true,

    putAuditRow: async (partition: string, sequence: number, row: Record<string, unknown>) => {
      calls.push(`audit:${partition}#${sequence}`)
      putConditional(auditPk(partition), auditSk(sequence), row, () => {
        throw new AuditSequenceTaken(partition, sequence)
      })
      return { requestId: `req-${table.size}` }
    },

    queryAuditRows: async (
      partition: string,
      prefix: string,
      options: { newestFirst?: boolean; limit?: number } = {},
    ) => {
      const pk = auditPk(partition)
      const rows = [...table.entries()]
        .filter(([key]) => key.startsWith(`${pk} ${prefix}`))
        .map(([, row]) => row)
        // By sort key, which is why the padding matters.
        .sort((a, b) => String(a.sk).localeCompare(String(b.sk)))
      const ordered = options.newestFirst ? rows.reverse() : rows
      return marshalled(options.limit ? ordered.slice(0, options.limit) : ordered)
    },

    putAuditHold: async (partition: string, holdId: string, hold: Record<string, unknown>) => {
      putConditional(auditPk(partition), `${HOLD}${holdId}`, { partition, hold }, () => {
        throw new Error(`hold ${holdId} is already placed`)
      })
    },

    releaseAuditHold: async (
      partition: string,
      holdId: string,
      release: Record<string, unknown>,
    ) => {
      putConditional(auditPk(partition), `${RELEASE}${holdId}`, { partition, release }, () => {
        throw new Error(`hold ${holdId} is already released`)
      })
    },

    /* ── the tenant half, which is what "the act" is ── */

    registerTenant: async (manifest: { slug: string }) => registerUnder("registerTenant", manifest.slug),
    adoptBoundTenant: async (manifest: { slug: string }) =>
      registerUnder("adoptBoundTenant", manifest.slug),

    takenSlugs: async () => [] as string[],
    getTenant: async () => undefined,
    putOperation: async () => {},
    getOperation: async () => undefined,
    completeOperation: async () => {},
    settleIdempotency: async () => {},
    listFleet: async () => [],

    /* ── what the test reads ── */
    __table: table,
    __calls: calls,
    __reset: () => {
      table.clear()
      calls.length = 0
    },
  }
})

/** Who is signed in. Set per test — the session, and nothing about NextAuth's
 * own configuration, is what these actions read. */
let signedInAs: string | undefined = "lead@tenure.example"
jest.mock("./auth", () => ({ auth: async () => ({ user: { email: signedInAs } }) }))

jest.mock("next/cache", () => ({ revalidatePath: () => {} }))

/** `redirect()` works by throwing, and both actions depend on that. */
const REDIRECT = "NEXT_REDIRECT"
jest.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
}))

import { composeTenant, adoptTenantAction } from "../app/tenants/actions"
import { PLATFORM_PARTITION } from "./audit-ledger"

const registry = jest.requireMock("./registry") as {
  __calls: string[]
  __reset: () => void
  putAuditRow: (p: string, s: number, r: Record<string, unknown>) => Promise<unknown>
  queryAuditRows: (p: string, prefix: string) => Promise<Array<Record<string, unknown>>>
  AuditSequenceTaken: new (p: string, s: number) => Error
}

/* ──────────────────────────────────────────────────────────── helpers ── */

/** One subject's chain, as records, read the way `/platform/audit` reads it. */
async function chainOf(subject: string): Promise<AuditRecord[]> {
  const rows = await registry.queryAuditRows(subject, "SEQ#")
  return rows.map((r) => r.record as AuditRecord)
}

/** Only the tenant writes, so an ordering assertion can name them. */
const acts = () => registry.__calls.filter((c) => !c.startsWith("audit:"))

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(key, one)
  }
  return data
}

/** A composition that passes every check, so the SUCCESS path is reachable. */
const validComposition = (slug: string) => ({
  slug,
  legalName: "Riverside Institute of Technology",
  displayName: "Riverside Tech",
  blueprintId: "university-student-organizations",
  planId: "institution",
  region: "us-east-1",
  isolation: "pooled",
  coexistence: "TENURE_CLOUD_PRIMARY",
  initialAdminEmail: "admin@riverside.example",
  "archetype.organization": "university-student-organizations",
  "archetype.operatingModel": "centralized",
  "archetype.functional": ["community"],
})

const adoptForm = (over: Record<string, string> = {}) =>
  form({
    slug: "rochester",
    primaryContactEmail: "ose@rochester.example",
    residency: "us-east-1",
    planId: "institution",
    institutionExists: "on",
    ...over,
  })

beforeEach(() => {
  registry.__reset()
  signedInAs = "lead@tenure.example"
})

/* ═════════════════════════════════════════════════════════════ tests ══ */

describe("adoption, through the real action", () => {
  it("writes the intent BEFORE it adopts, and closes it after", async () => {
    await expect(adoptTenantAction(null, adoptForm())).rejects.toThrow(REDIRECT)

    // The whole claim, as an ordering. An outcome-only trail cannot tell
    // "started and died" from "never attempted"; this is what makes the
    // difference recordable.
    expect(registry.__calls).toEqual([
      "audit:rochester#0",
      "adoptBoundTenant:rochester",
      "audit:rochester#1",
    ])

    const chain = await chainOf("rochester")
    expect(chain).toHaveLength(2)
    expect(chain[0].outcome).toBe("ALLOW")
    expect(chain[0].action).toBe("tenants.adopt")
    expect(chain[0].actorId).toBe("lead@tenure.example")
    expect(chain[1].reason).toContain("Adopted rochester")

    // A chain, not two rows: read back out of the table and re-verified, so a
    // hash that did not survive marshalling fails here.
    expect(verifyChain(chain).ok).toBe(true)
    expect(chain[0].previousHash).toBeNull()
    expect(chain[1].previousHash).toBe(chain[0].recordHash)
  })

  it("records a refusal as a DENY carrying the reason, and adopts nothing", async () => {
    const result = await adoptTenantAction(null, adoptForm({ planId: "no-such-plan" }))
    expect(result.problems[0].reason).toBe("unknown-plan")
    expect(acts()).toEqual([])

    const chain = await chainOf("rochester")
    expect(chain).toHaveLength(2)
    // The half a lifecycle history can never carry: the attempt that did not
    // happen. `buildAuditRecord` refuses a DENY with no reason, so this row
    // cannot exist without one.
    expect(chain[1].outcome).toBe("DENY")
    expect(chain[1].reason).toContain("unknown-plan")
    expect(verifyChain(chain).ok).toBe(true)
  })

  it("records an adoption the builder refuses", async () => {
    const result = await adoptTenantAction(null, adoptForm({ slug: "not-a-bound-tenant" }))
    expect(result.problems[0].reason).toBe("refused")
    expect(acts()).toEqual([])

    const chain = await chainOf("not-a-bound-tenant")
    expect(chain.map((r) => r.outcome)).toEqual(["ALLOW", "DENY"])
  })
})

describe("composition, through the real action", () => {
  it("writes the intent BEFORE it registers, and closes it after", async () => {
    await expect(composeTenant(null, form(validComposition("riverside")))).rejects.toThrow(REDIRECT)

    expect(registry.__calls).toEqual([
      "audit:riverside#0",
      "registerTenant:riverside",
      "audit:riverside#1",
    ])

    const chain = await chainOf("riverside")
    expect(chain).toHaveLength(2)
    expect(chain[1].reason).toContain("Registered riverside in DRAFT")
    expect(verifyChain(chain).ok).toBe(true)
  })

  it("records a refused composition against the slug it named", async () => {
    const result = await composeTenant(
      null,
      form({ ...validComposition("riverside"), blueprintId: "no-such-blueprint" }),
    )
    expect(result.problems.length).toBeGreaterThan(0)
    expect(acts()).toEqual([])

    // On the tenant's chain, not the platform's: an investigator asking "who
    // tried to create this, and why did it not happen" looks at the tenant.
    const chain = await chainOf("riverside")
    expect(chain.map((r) => r.outcome)).toEqual(["ALLOW", "DENY"])
    expect(chain[1].reason).toContain("blueprintId")
    expect(verifyChain(chain).ok).toBe(true)
  })

  it("records a composition that named no tenant on the platform chain", async () => {
    // A composition with no slug belongs to nobody. Dropping it for want of a
    // partition is how the one class of attempt that never registers anything
    // becomes the one class that leaves no trace.
    const result = await composeTenant(null, form({ ...validComposition(""), slug: "" }))
    expect(result.problems.length).toBeGreaterThan(0)

    const chain = await chainOf(PLATFORM_PARTITION)
    expect(chain.map((r) => r.outcome)).toEqual(["ALLOW", "DENY"])
    expect(chain[0].tenantId).toBe("PLATFORM")
  })
})

describe("denials", () => {
  it("records an operator who is refused, on the platform chain", async () => {
    // A real decision from the real engine: `auditor-read-only` holds
    // `tenant:read` and not `tenant:write`, so this is a genuine DENY rather
    // than a stubbed one.
    signedInAs = "reader@tenure.example"

    await expect(composeTenant(null, form(validComposition("riverside")))).rejects.toThrow(
      "Not found",
    )
    expect(acts()).toEqual([])

    const chain = await chainOf(PLATFORM_PARTITION)
    expect(chain).toHaveLength(2)
    expect(chain[1].outcome).toBe("DENY")
    expect(chain[1].actorId).toBe("reader@tenure.example")
    expect(chain[1].action).toBe("tenants.compose")
    expect(verifyChain(chain).ok).toBe(true)
  })

  it("records a caller who is not signed in at all", async () => {
    signedInAs = undefined

    await expect(adoptTenantAction(null, adoptForm())).rejects.toThrow("Not found")

    const chain = await chainOf(PLATFORM_PARTITION)
    expect(chain[1].outcome).toBe("DENY")
    expect(chain[1].actorId).toBe("unauthenticated")
  })
})

describe("the chain the actions build", () => {
  it("keeps one continuous chain across separate attempts on one tenant", async () => {
    // Two attempts against `rochester`, one refused and one applied. The point
    // is that they share ONE chain: a trail split per attempt could lose an
    // entire attempt's worth of records with no gap visible anywhere.
    await adoptTenantAction(null, adoptForm({ planId: "no-such-plan" }))
    await adoptTenantAction(null, adoptForm()).catch(() => {})

    const chain = await chainOf("rochester")
    expect(chain.map((r) => r.sequence)).toEqual([0, 1, 2, 3])
    const verified = verifyChain(chain)
    expect(verified.ok).toBe(true)
    expect(verified.gaps).toEqual([])
    expect(verified.duplicates).toEqual([])
  })

  it("refuses a second writer claiming a position that is already written", async () => {
    // The condition that makes `previousHash` mean anything. Without it two
    // writers compute the same sequence, the loser silently replaces the
    // winner, one act disappears, and the chain still verifies perfectly.
    await adoptTenantAction(null, adoptForm({ planId: "no-such-plan" }))

    await expect(
      registry.putAuditRow("rochester", 0, { record: { forged: true } }),
    ).rejects.toBeInstanceOf(registry.AuditSequenceTaken)

    const chain = await chainOf("rochester")
    expect(chain).toHaveLength(2)
    expect(chain[0].action).toBe("tenants.adopt")
  })
})
