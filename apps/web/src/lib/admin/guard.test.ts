/**
 * PAY-000-007 — the administration gate writes evidence that names its mode.
 *
 * `requireCapability` is the single door every privileged administration
 * command goes through, and it is one of the two writers moved onto
 * `recordAuditEvent`. That move is the point of these tests: NEXT-SESSION §5
 * recorded `audit-record.ts` as having zero importers, so every property it
 * provides — the hash chain, the release stamp, the money-mode — was worth
 * nothing until a real writer went through it.
 *
 * So the assertions are on the ROW THE PRODUCTION PATH EMITS, through the real
 * `recordAuditEvent` and the real `prismaAuditLedger`. Only the database and
 * the session are stood in for. A test that called `recordAuditEvent` itself
 * and checked its output would stay green the day `requireCapability` went back
 * to `db.auditEvent.create`, which is exactly the regression worth catching.
 */

type Row = Record<string, unknown>

/** Rows the stand-in database has accepted, in order. */
const mockRows: Row[] = []

/**
 * A database that behaves like the one in production for the two operations the
 * audit chokepoint uses: an interactive `$transaction`, and an `auditEvent`
 * delegate that can find the latest chained row and append.
 *
 * Not a spy returning a canned value — `findFirst` genuinely searches what was
 * written, so the chain the writer builds is the chain that comes back.
 */
jest.mock("@/lib/db", () => {
  const tx = {
    auditEvent: {
      // Filters by institution AND by "carries a chain position", exactly as
      // the real query does. Ignoring the tenant predicate would let one
      // tenant's record become another's predecessor, which the builder
      // correctly refuses — a stand-in that skipped it would be testing a
      // different query from the one production runs.
      findFirst: async ({ where }: { where: { institutionId: string } }) =>
        mockRows
          .filter(
            (r) =>
              r.institutionId === where.institutionId &&
              typeof (r.metadata as Row)?.["_sequence"] === "number",
          )
          .at(-1) ?? null,
      create: async ({ data }: { data: Row }) => {
        mockRows.push(data)
        return data
      },
    },
  }
  return {
    db: {
      $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx),
      auditEvent: tx.auditEvent,
    },
  }
})

let mockSession: { user: { id: string } } | null = { user: { id: "user_admin" } }
jest.mock("@/lib/auth", () => ({ auth: async () => mockSession }))

let mockInstitutionRoles: { institutionId: string; role: string }[] = [
  { institutionId: "inst_1", role: "OSE_DIRECTOR" },
]
jest.mock("@/lib/rbac", () => ({
  getUserContext: async (userId: string) => ({
    userId,
    institutionRoles: mockInstitutionRoles,
    orgRoles: [],
  }),
}))

import { runInTenantScope } from "@/lib/tenancy/context"
import { requireCapability } from "./guard"

const inScope = <T>(environment: "test" | "live", fn: () => Promise<T>) =>
  runInTenantScope(
    {
      institutionId: "inst_1",
      environment,
      purpose: "interactive",
      actor: { principalId: "user_admin", principalType: "user" },
    },
    fn,
  )

beforeEach(() => {
  mockRows.length = 0
  mockSession = { user: { id: "user_admin" } }
  mockInstitutionRoles = [{ institutionId: "inst_1", role: "OSE_DIRECTOR" }]
})

describe("the administration gate records what it allowed", () => {
  it("writes a chained, mode-stamped row for an allowed capability", async () => {
    await inScope("live", () => requireCapability("club.create"))

    expect(mockRows).toHaveLength(1)
    expect(mockRows[0]).toMatchObject({
      institutionId: "inst_1",
      actorId: "user_admin",
      action: "Admin.club.create",
      outcome: "ALLOW",
      // The column PAY-000-007 adds, written from the ambient tenant scope.
      mode: "live",
    })

    const metadata = mockRows[0].metadata as Row
    // The chain — the property that was worth nothing while nothing went
    // through the chokepoint. A record with no sequence is one `verifyChain`
    // reports as unchained.
    expect(metadata._sequence).toBe(0)
    expect(typeof metadata._recordHash).toBe("string")
    // And the mode inside the hash-covered blob, so the column cannot be
    // rewritten around the application without breaking a link.
    expect(metadata._mode).toBe("live")
  })

  it("records a denial, with its reason, in the same mode", async () => {
    mockInstitutionRoles = [{ institutionId: "inst_1", role: "OSE_ADVISOR" }]

    await expect(inScope("test", () => requireCapability("club.create"))).rejects.toThrow(
      /do not have permission/,
    )

    expect(mockRows).toHaveLength(1)
    expect(mockRows[0]).toMatchObject({ outcome: "DENY", mode: "test" })
    expect(mockRows[0].reason).toMatch(/club\.create/)
  })

  it("chains the second privileged action off the first", async () => {
    await inScope("live", () => requireCapability("club.create"))
    await inScope("live", () => requireCapability("club.edit"))

    const first = mockRows[0].metadata as Row
    const second = mockRows[1].metadata as Row
    expect(second._sequence).toBe(1)
    expect(second._previousHash).toBe(first._recordHash)
  })

  it("keeps two tenants' modes apart across consecutive administrations", async () => {
    // One process, one gate, two tenants in different modes. Nothing derived
    // from NODE_ENV could produce two different answers here.
    await inScope("live", () => requireCapability("club.create"))
    mockInstitutionRoles = [{ institutionId: "inst_2", role: "OSE_DIRECTOR" }]
    await runInTenantScope(
      {
        institutionId: "inst_2",
        environment: "test",
        purpose: "interactive",
        actor: { principalId: "user_admin", principalType: "user" },
      },
      () => requireCapability("club.create", { institutionId: "inst_2" }),
    )

    expect(mockRows.map((r) => [r.institutionId, r.mode])).toEqual([
      ["inst_1", "live"],
      ["inst_2", "test"],
    ])
  })
})
