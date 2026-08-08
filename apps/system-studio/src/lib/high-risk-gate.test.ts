/**
 * STUDIO-140-006 — the high-risk confirmation refuses, and refuses differently
 * every time, driven through the REAL server action.
 *
 * ## Why this is a jest suite and not only the Playwright one
 *
 * `e2e/high-risk-fails-closed.spec.ts` drives the same five refusals through the
 * real form in a real browser, and it is the better test — it also proves the
 * panel is inside the `<form>` and that the operator can reach it. It is also
 * `test.skip`ped without `TENANT_TABLE` and a reachable DynamoDB, which means
 * that on any machine without one it asserts NOTHING. A fail-closed gate whose
 * only proof is conditional is a gate that can silently stop being one.
 *
 * So every assertion here calls `advanceState(null, form)` — the actual server
 * action, with its actual authorization, its actual audit ledger, the actual
 * command gate, the actual change-class gate and the actual lifecycle engine —
 * and reads back the refusal the operator would be shown.
 *
 * ## The five arms, and where each one is decided
 *
 *   1. the target was not typed          `highRiskVerdict`, in the action
 *   2. the digest is of another risk     `highRiskVerdict`, in the action
 *   3. destructive AWS mutation          `planMutation`, via `highRiskVerdict`
 *   4. actor === approver                `advance()`, in @tenure/provisioning
 *   5. approver not on the allowlist     `advance()`, given `isOperator`
 *
 * Four and five are the lifecycle engine's and are reached only by getting all
 * the way through the gate, the cost band, the idempotency claim, the
 * change-class token and the step executor — which is exactly the point. A test
 * that called `advance()` itself would stay green the day `runAdvance` stopped
 * passing `approverIsOperator`, and passing `true` unconditionally is a
 * one-character edit.
 *
 * The last test asserts the five sentences DIFFER, because "it refused" passing
 * for the wrong reason is how a fail-closed suite goes green against a gate that
 * stopped working.
 *
 * ## The registry stand-in
 *
 * DynamoDB is replaced and nothing else is, in the same shape and for the same
 * reasons as `audit-ledger.test.ts`: a conditional put so the audit chain's
 * `previousHash` means something, zero-padded sort keys so `SEQ#10` sorts after
 * `SEQ#9`, and a JSON round trip because that is what the document client does
 * to an item on the way in.
 *
 * `advanceTenant` is NOT stubbed to a success. It calls the real `advance()`
 * from `@tenure/provisioning` on the fixture's own state and history, so the
 * two refusals that engine owns are the engine's real refusals — a stand-in
 * that returned `{ ok: true }` would prove that this suite can call a function.
 */

/* Read from the environment on first use and cached, so the module body is
 * early enough. Real values of the real shape: `authorizeCommand` parses this
 * allowlist itself, and `operatorConfigProblems` refuses a short or
 * low-entropy secret — a value that failed it would make every decision below
 * CONFIG_UNUSABLE, which is a real refusal and not one of the five. */
process.env.AWS_REGION = "us-east-1"
process.env.AWS_ACCOUNT_ID = "000000000000"
process.env.AWS_PARTITION = "aws"
process.env.DEPLOY_ENVIRONMENT = "production"
process.env.CELL_MAX_TENANTS = "50"
process.env.CELL_TENANT_COUNT = "0"
process.env.PLATFORM_OPERATORS =
  "lead@tenure.example:platform-super-admin,second@tenure.example:cloud-platform-engineer"
process.env.PLATFORM_OPERATOR_SECRET = "kQ7pXm2Zr9Tb4Ns6Wf1Yc8Vd3Hj5Lg0"
process.env.TENANT_TABLE = "tenure-studio-tenants-test"

import type { TenantManifest, TenantState } from "@tenure/provisioning"

/* ─────────────────────────────────────────────── the DynamoDB stand-in ── */

/**
 * Everything lives inside the factory.
 *
 * `jest.mock` is hoisted above the module body and the factory runs while
 * `../app/tenants/actions` is being imported — before any `const` out here has
 * initialised. A factory closing over a module-level object reads it in its
 * temporal dead zone.
 */
jest.mock("./registry", () => {
  // Required inside the factory for the same reason: at hoist time nothing
  // outside it exists yet.
  const { advance } = require("@tenure/provisioning")

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

  class RegistryUnavailable extends Error {}

  const table = new Map<string, Record<string, unknown>>()
  const calls: string[] = []
  /** The tenants `getTenant` answers with. Set per test. */
  const tenants = new Map<string, Record<string, unknown>>()

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

  return {
    AUDIT_SEQUENCE_PREFIX: SEQ,
    AUDIT_HOLD_PREFIX: HOLD,
    AUDIT_HOLD_RELEASE_PREFIX: RELEASE,
    AuditSequenceTaken,
    SlugTaken,
    RegistryUnavailable,

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
        .sort((a, b) => String(a.sk).localeCompare(String(b.sk)))
      const ordered = options.newestFirst ? rows.reverse() : rows
      return marshalled(options.limit ? ordered.slice(0, options.limit) : ordered)
    },

    putAuditHold: async () => {},
    releaseAuditHold: async () => {},

    /* ── the tenant half ── */

    registerTenant: async (manifest: { slug: string }) => {
      calls.push(`registerTenant:${manifest.slug}`)
    },
    adoptBoundTenant: async () => {},
    takenSlugs: async () => [] as string[],

    getTenant: async (slug: string) => marshalled(tenants.get(slug)) ?? undefined,

    /**
     * The real lifecycle rules, with the storage removed.
     *
     * `advance` throws `LifecycleError` for an illegal move, a self-approval and
     * an approver the caller did not verify — the last two being refusals 4 and
     * 5. Returning a canned success here would delete both from this suite while
     * leaving every assertion that "it refused" free to pass on refusal 1.
     */
    advanceTenant: async (
      slug: string,
      to: TenantState,
      options: Record<string, unknown>,
    ) => {
      const current = tenants.get(slug) as { state: TenantState; history: unknown[] } | undefined
      if (!current) throw new RegistryUnavailable(`No tenant "${slug}".`)
      calls.push(`advanceTenant:${slug}->${to}`)
      const moved = advance(current.state, to, options, current.history)
      const next = { ...current, state: moved.state, history: [...current.history, moved.step] }
      tenants.set(slug, next as Record<string, unknown>)
      return { record: next, awsRequestId: "req-advance" }
    },

    startCoolingOff: async () => ({ started: true, elapsedMs: 0 }),

    putOperation: async (op: { operationId: string }) => {
      calls.push(`putOperation:${op.operationId}`)
    },
    getOperation: async () => undefined,
    completeOperation: async () => {},
    settleIdempotency: async () => {},
    listFleet: async () => [],

    /** A real conditional claim: a repeated key must not be claimed twice. */
    claimIdempotency: async (tenantId: string, claim: { key: string }) => {
      const key = `IDEM ${tenantId} ${claim.key}`
      if (table.has(key)) return { claimed: false, existing: table.get(key)!.claim }
      table.set(key, { claim: marshalled(claim) })
      return { claimed: true }
    },
    readIdempotency: async () => undefined,

    /* ── what the test drives ── */
    __table: table,
    __calls: calls,
    __tenants: tenants,
    __reset: () => {
      table.clear()
      calls.length = 0
      tenants.clear()
    },
  }
})

/** Who is signed in. Set per test. */
let signedInAs: string | undefined = "lead@tenure.example"
jest.mock("./auth", () => ({ auth: async () => ({ user: { email: signedInAs } }) }))

jest.mock("next/cache", () => ({ revalidatePath: () => {} }))

const REDIRECT = "NEXT_REDIRECT"
jest.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`${REDIRECT} ${to}`)
  },
}))

import { advanceState, composeTenant } from "../app/tenants/actions"
import { riskDigest } from "../components/states"
import { observedFor, riskOf } from "./tenant-state"

const registry = jest.requireMock("./registry") as {
  __calls: string[]
  __tenants: Map<string, Record<string, unknown>>
  __reset: () => void
  queryAuditRows: (p: string, prefix: string) => Promise<Array<Record<string, unknown>>>
}

const LEAD = "lead@tenure.example"
const SECOND = "second@tenure.example"
/** Deliberately not in `PLATFORM_OPERATORS`. */
const STRANGER = "not-an-operator@example.invalid"

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

let keys = 0
/** The shape `AdvanceControls` mints, unique per submission. */
const idempotencyKey = () => `idem-${String(++keys).padStart(32, "0")}`

/**
 * A real manifest, built by the real composer.
 *
 * Captured from `composeTenant` rather than hand-written, so the fixture cannot
 * drift from what the console actually registers — a hand-built manifest is a
 * second definition of a tenant, and the first thing it does is disagree.
 */
let MANIFEST: TenantManifest

beforeAll(async () => {
  registry.__reset()
  const composed = form({
    slug: "riverside",
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
    "archetype.functional": "community",
  })
  const captured: TenantManifest[] = []
  const real = jest.requireMock("./registry") as {
    registerTenant: (m: TenantManifest) => Promise<void>
  }
  const previous = real.registerTenant
  real.registerTenant = async (m: TenantManifest) => {
    captured.push(m)
    return previous(m)
  }
  await expect(composeTenant(null, composed)).rejects.toThrow(REDIRECT)
  real.registerTenant = previous
  MANIFEST = captured[0]
  expect(MANIFEST?.slug).toBe("riverside")
})

/** A tenant sitting in `state`, with a history long enough to be at that version. */
function seed(slug: string, state: TenantState, steps: number) {
  const history = Array.from({ length: steps }, (_, i) => ({
    from: "DRAFT" as TenantState,
    to: state,
    at: `2026-01-0${i + 1}T00:00:00.000Z`,
    actor: LEAD,
    attempt: 1,
  }))
  registry.__tenants.set(slug, {
    slug,
    awsRequestIds: ["req-seed"],
    manifest: { ...MANIFEST, slug },
    state,
    digest: `digest-${slug}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    history,
    evidence: [],
  })
  return { expectedVersion: String(steps), expectedDigest: `digest-${slug}` }
}

/** The digest the tenant page would have rendered for this move. */
function digestFor(slug: string, from: TenantState, to: TenantState): string {
  return riskDigest(
    riskOf(
      slug,
      from,
      to,
      observedFor({
        isolation: MANIFEST.isolation,
        hasDeployment: false,
        serving: false,
        evidenceRecords: 0,
      }),
    ),
  )
}

beforeEach(() => {
  registry.__reset()
  signedInAs = LEAD
})

/* ═════════════════════════════════════════════════════════════ tests ══ */

/** Every refusal, so the last test can prove they are five and not one. */
const said: Record<string, string> = {}

describe("the high-risk confirmation is a gate, through the real action", () => {
  it("refuses when the target was not typed", async () => {
    const slug = "hr-nottyped"
    const at = seed(slug, "AWAITING_APPROVAL", 3)

    const result = await advanceState(
      null,
      form({
        slug,
        to: "PROVISIONING",
        approvedBy: SECOND,
        reason: "provisioning it",
        idempotencyKey: idempotencyKey(),
        ...at,
        confirmTarget: "",
        riskDigest: digestFor(slug, "AWAITING_APPROVAL", "PROVISIONING"),
      }),
    )

    said.notTyped = result.error!
    expect(said.notTyped).toMatch(/Type hr-nottyped exactly to confirm/)
    // And it refused BEFORE anything moved. A gate that refuses after the work
    // is a log line.
    expect(registry.__calls.filter((c) => c.startsWith("advanceTenant"))).toEqual([])
    expect(registry.__tenants.get(slug)!.state).toBe("AWAITING_APPROVAL")
  })

  it("refuses a digest that is not the consequence that would run", async () => {
    const slug = "hr-staledigest"
    const at = seed(slug, "AWAITING_APPROVAL", 3)

    const result = await advanceState(
      null,
      form({
        slug,
        to: "PROVISIONING",
        approvedBy: SECOND,
        reason: "provisioning it",
        idempotencyKey: idempotencyKey(),
        ...at,
        confirmTarget: slug,
        // What a stale page — or a hand-built POST — presents.
        riskDigest: "00000000000000000000000000000000",
      }),
    )

    said.staleDigest = result.error!
    expect(said.staleDigest).toMatch(/consequence changed while this page was open/)
    expect(registry.__calls.filter((c) => c.startsWith("advanceTenant"))).toEqual([])
  })

  it("refuses to perform the destructive AWS mutation, and hands over the command", async () => {
    const slug = "hr-purge"
    const at = seed(slug, "PURGE_PENDING", 7)

    const result = await advanceState(
      null,
      form({
        slug,
        to: "PURGING",
        approvedBy: SECOND,
        reason: "offboarded",
        idempotencyKey: idempotencyKey(),
        ...at,
        // Everything else correct. The only thing wrong with this request is
        // that the console will not do it.
        confirmTarget: slug,
        riskDigest: digestFor(slug, "PURGE_PENDING", "PURGING"),
      }),
    )

    said.destructive = result.error!
    expect(said.destructive).toContain("REFUSED_IRREVERSIBLE")
    // The remedy travels with the refusal, naming the real table and the real
    // partition. Without it an operator's next move is to find someone with
    // wider credentials, which is worse than the mutation this gate stopped.
    expect(said.destructive).toContain("aws dynamodb")
    expect(said.destructive).toContain(process.env.TENANT_TABLE!)
    expect(said.destructive).toContain(slug)
    expect(registry.__calls.filter((c) => c.startsWith("advanceTenant"))).toEqual([])
  })

  it("refuses an operator approving their own move", async () => {
    const slug = "hr-selfapprove"
    const at = seed(slug, "AWAITING_APPROVAL", 3)

    const result = await advanceState(
      null,
      form({
        slug,
        to: "PROVISIONING",
        // Separation of duties. The person who asked is not the person who agrees.
        approvedBy: LEAD,
        reason: "provisioning it",
        idempotencyKey: idempotencyKey(),
        ...at,
        confirmTarget: slug,
        riskDigest: digestFor(slug, "AWAITING_APPROVAL", "PROVISIONING"),
      }),
    )

    said.selfApproval = result.error!
    // The CHANGE-CLASS gate answers first, and this assertion records that
    // rather than wishing otherwise: `AWAITING_APPROVAL → PROVISIONING` is a C5,
    // C5 demands two approvers, and `gateChange` refuses a request whose
    // requester and approver are one person BEFORE the step executor runs.
    // The lifecycle engine holds the same rule behind it — `advance()` throws
    // "cannot approve their own", covered exhaustively in
    // `packages/provisioning/src/provisioning.test.ts` — so this is two
    // independent refusals, and the one an operator meets is this one.
    expect(said.selfApproval).toMatch(/needs a SECOND identity; lead@tenure\.example cannot be both/)
    // Refused BEFORE the executor, which is the property that matters: a second
    // identity demanded after the work has run is a receipt, not a control.
    expect(registry.__calls.filter((c) => c.startsWith("advanceTenant"))).toEqual([])
    expect(registry.__tenants.get(slug)!.state).toBe("AWAITING_APPROVAL")
  })

  it("refuses an approver the allowlist does not know", async () => {
    const slug = "hr-stranger"
    const at = seed(slug, "AWAITING_APPROVAL", 3)

    const result = await advanceState(
      null,
      form({
        slug,
        to: "PROVISIONING",
        // Not our own address, and not anybody's. Before the lookup existed
        // this satisfied the entire approval check.
        approvedBy: STRANGER,
        reason: "provisioning it",
        idempotencyKey: idempotencyKey(),
        ...at,
        confirmTarget: slug,
        riskDigest: digestFor(slug, "AWAITING_APPROVAL", "PROVISIONING"),
      }),
    )

    said.stranger = result.error!
    expect(said.stranger).toMatch(/was not verified as a platform operator/)
    // This one is the LIFECYCLE ENGINE'S, and it is reached only by passing the
    // authorization decision, the version and digest check, the cost band, the
    // idempotency claim, the change-class token, the second-identity rule and
    // the step executor. That is the assertion: a test that called `advance()`
    // itself would stay green the day `runAdvance` stopped passing
    // `approverIsOperator`, and hardcoding it to `true` is one character.
    expect(registry.__calls).toContain(`advanceTenant:${slug}->PROVISIONING`)
    expect(registry.__tenants.get(slug)!.state).toBe("AWAITING_APPROVAL")
  })

  it("lets a correct submission through this gate", async () => {
    // The assertion the other five need. A `highRiskVerdict` that refused
    // everything would satisfy every test above and make the console unusable,
    // and "it refused" is exactly the shape of green that hides it.
    const slug = "hr-correct"
    const at = seed(slug, "AWAITING_APPROVAL", 3)

    const result = await advanceState(
      null,
      form({
        slug,
        to: "PROVISIONING",
        approvedBy: SECOND,
        reason: "provisioning it",
        idempotencyKey: idempotencyKey(),
        ...at,
        confirmTarget: slug,
        riskDigest: digestFor(slug, "AWAITING_APPROVAL", "PROVISIONING"),
      }),
    )

    expect(result.error).toBeUndefined()
    expect(registry.__calls).toContain(`advanceTenant:${slug}->PROVISIONING`)
    expect(registry.__tenants.get(slug)!.state).toBe("PROVISIONING")
  })

  it("does not share a message between the five", () => {
    // The assertion the other five exist for. A gate whose arms all say "not
    // allowed" is a gate a test cannot tell from a gate that stopped working.
    const messages = Object.values(said)
    // Five recorded, or an earlier case did not run.
    expect(Object.keys(said).sort()).toEqual([
      "destructive",
      "notTyped",
      "selfApproval",
      "staleDigest",
      "stranger",
    ])
    expect(new Set(messages).size).toBe(5)
  })
})

describe("every attempt is on the audit ledger, refusals included", () => {
  it("writes the intent before it decides and the outcome after, carrying the code", async () => {
    const slug = "hr-audited"
    const at = seed(slug, "AWAITING_APPROVAL", 3)

    await advanceState(
      null,
      form({
        slug,
        to: "PROVISIONING",
        approvedBy: SECOND,
        reason: "provisioning it",
        idempotencyKey: idempotencyKey(),
        ...at,
        confirmTarget: "",
        riskDigest: digestFor(slug, "AWAITING_APPROVAL", "PROVISIONING"),
      }),
    )

    // Ordering, as a sequence of events rather than as what exists afterwards:
    // the intent is written before the decision, and the outcome after it.
    // Checking at the end cannot tell first from second.
    expect(registry.__calls).toEqual([`audit:${slug}#0`, `audit:${slug}#1`])

    const rows = await registry.queryAuditRows(slug, "SEQ#")
    const chain = rows.map((r) => r.record as Record<string, unknown>)
    expect(chain).toHaveLength(2)
    expect(chain[0].outcome).toBe("ALLOW")
    // The half a lifecycle STEP# row can never carry: the attempt that did not
    // happen, with the gate that stopped it named in one field.
    expect(chain[1].outcome).toBe("DENY")
    expect((chain[1].metadata as { code?: string }).code).toBe("REFUSED_CONFIRMATION")
    expect(chain[1].previousHash).toBe(chain[0].recordHash)
  })
})
