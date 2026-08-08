/**
 * PACK-070-004 — the tool set is a per-tenant, per-principal decision.
 *
 * Nothing is mocked below except the requester's seats. The module catalog, the
 * tenant bindings, the permission catalog, the role templates and `decide()`
 * are all the shipped ones — which is the point, because the claim being tested
 * is that a declaration in `modules/index.ts` reaches an authorization decision
 * without anything in between rewriting it.
 *
 * ## The registrations that are not in the catalog yet
 *
 * `modules/index.ts` contributes exactly one tool, `search.corpus`, and it is
 * read-only. Gates on writes, on bulk exports, on deletes and on the owning
 * domain's policy exercised only against that one registration would be gates
 * proven against the case they do not exist for. So the fixture registrations
 * below go through the real `parseToolRegistration`, name real catalog
 * permissions, and are decided by the real `decide()` against a real world
 * built by `institutionWorld` — only the list of registrations differs from the
 * shipped one, which is exactly the thing that changes when a second tool is
 * declared.
 */
import { describe, expect, it } from "@jest/globals"

import { parseTenantContext, parseToolRegistration } from "@tenure/contracts"
import { decideCheck, policyRevisionOf } from "@tenure/authorization"
import { modulesFor, tiersFor } from "@tenure/platform-config"

import { institutionWorld } from "./authz/seat-world"
import {
  TOOL_ARGUMENT_SCHEMAS,
  authorizeRegistrations,
  authorizeRelayTools,
  invokeRelayTool,
  mintConfirmation,
  owningPolicyPermission,
  planForInvocation,
  proposalDigest,
  relayToolsFor,
  riskOf,
  rolesGranting,
  toolOffered,
  type RelayInvocationLimits,
  type ToolArgumentSchemas,
} from "./relay-tools"
import { planDigest } from "./relay/action-plan"
import type { UserContext } from "./rbac"

const AT = "2026-08-01T12:00:00.000Z"

/**
 * The signing key the door reads through `confirmationSecret()`.
 *
 * Set on the real environment rather than injected, because that is where
 * `invokeRelayTool` reads it from in production — a test that passed a secret in
 * by hand would leave the "unconfigured process refuses everything" path
 * unexercised on the production call path. Restored afterwards so it cannot
 * leak into another file sharing this worker.
 */
const SECRET_VAR = "RELAY_CONFIRMATION_SECRET"
const previousSecret = process.env[SECRET_VAR]
beforeAll(() => {
  process.env[SECRET_VAR] = "relay-tools-test-confirmation-secret"
})
afterAll(() => {
  if (previousSecret === undefined) delete process.env[SECRET_VAR]
  else process.env[SECRET_VAR] = previousSecret
})

/**
 * WRK-GATE-020's half of `RelayInvocationLimits`, for the tests that are not
 * about the grant.
 *
 * Stated once rather than defaulted: the two fields are REQUIRED on the type
 * precisely so a surface cannot forget them, and a test helper that made them
 * optional again would be the fixture that hides exactly what `tsc` was made to
 * catch. `bidirectional` and no selected resources keeps every gate BELOW the
 * grant reachable; the grant's own gates have their own tests.
 */
const GRANT = { grantedDirection: "bidirectional" as const, selectedResources: [] as string[] }

const context = (tenantId: string, at: string = AT) =>
  parseTenantContext({
    tenantId,
    actorId: "user-1",
    actorKind: "user",
    channel: "web",
    correlationId: "corr-1",
    configRevision: "university-student-organizations@1.0.0",
    environment: "test",
    legalEntityId: null,
    at,
  })

const staffer = (institutionId: string): UserContext => ({
  userId: "user-1",
  institutionRoles: [{ institutionId, role: "OSE_STAFF" }],
  orgRoles: [],
})

/**
 * The Director, who holds `finance.ledger.post` and does NOT hold
 * `finance.budget.approve` — see `packages/authorization/src/role-templates.ts`,
 * `institution.director`. That gap is the whole subject of the owning-policy
 * gate: the tool's own permission passes and the domain's policy does not.
 */
const director = (institutionId: string): UserContext => ({
  userId: "user-1",
  institutionRoles: [{ institutionId, role: "OSE_DIRECTOR" }],
  orgRoles: [],
})

const stranger: UserContext = { userId: "user-1", institutionRoles: [], orgRoles: [] }

/**
 * A club member: a member of the tenant, with a seat that carries
 * `search.index.query` at one org unit and nowhere else.
 *
 * A tool check names no resource, so an org-scoped grant cannot cover it — and
 * the engine's refusal for this person QUOTES the permission, which is what
 * makes them the right subject for "the safe half must not repeat it". The
 * stranger's refusal is `Not a member of tenant`, which would have made that
 * assertion pass without proving anything.
 */
const seatHolder: UserContext = {
  userId: "user-1",
  institutionRoles: [],
  orgRoles: [
    {
      organizationId: "club-1",
      roleId: "role-1",
      roleName: "Member",
      scope: "MEMBER",
      status: "ACTIVE",
      templateKey: "unit.member",
    },
  ],
}

/** The same world `authorizeRelayTools` decides against, for one principal. */
const worldFor = (ctx: UserContext, slug: string) =>
  institutionWorld(ctx, slug, modulesFor(slug).keys, tiersFor(slug))

/** The same world, for the OSE staffer the older assertions below use. */
const worldOf = (slug: string) => worldFor(staffer(slug), slug)

// ── fixture registrations ───────────────────────────────────────────────────

const reg = (over: Record<string, unknown>) =>
  parseToolRegistration({
    module: "search",
    description: "A registration used to exercise the classification and the gates around it.",
    readOnly: false,
    reauthorizesPerCall: true,
    ...over,
  })

/** The shipped one. Read-only, gated on `search.index.query`. */
const searchCorpus = relayToolsFor("rochester")[0]

/** Money. `finance` owns a policy, so this is PRIVILEGED whatever the verb is. */
const financeLedger = reg({
  toolKey: "finance.ledger",
  module: "budgeting",
  requiredPermission: "finance.ledger.post",
})

/** A write in a domain that declares no administrative permission at all. */
const resourcesWrite = reg({
  toolKey: "resources.publish",
  module: "resources",
  requiredPermission: "resources.resource.create",
})

/**
 * A write whose domain DOES declare one — `approvals.request.decide` — and
 * which an OSE staffer holds tenant-scoped. The gate has to be able to pass, or
 * "refuse every write" would satisfy every assertion made about it.
 */
const approvalsRaise = reg({
  toolKey: "approvals.raise",
  module: "approvals",
  requiredPermission: "approvals.request.create",
})

describe("which tools a system offers at all", () => {
  it("gives the pilot the search module's registration", () => {
    expect(relayToolsFor("rochester").map((t) => t.toolKey)).toEqual(["search.corpus"])
  })

  it("gives a system without the search module no tool of any kind", () => {
    // `midtown-arts` runs the nonprofit blueprint, which does not select
    // `search`. The assistant there has no retrieval capability — not a
    // retrieval capability that returns nothing, which is what a hardcoded tool
    // list degrades to and is a different thing to tell somebody.
    expect(relayToolsFor("midtown-arts")).toEqual([])
  })

  it("gives an unconfigured institution nothing", () => {
    expect(relayToolsFor("not-a-tenant-yet")).toEqual([])
  })
})

describe("which of them a principal may invoke", () => {
  it("offers the tool to someone holding the permission it names", () => {
    const set = authorizeRelayTools(
      staffer("rochester"),
      context("rochester"),
      "rochester",
      "read-only",
    )

    expect(toolOffered(set, "search.corpus")).toBe(true)
    expect(set.refused).toEqual([])
    // The decision is the kernel's `PermissionDecision`, carrying the revision
    // of the policy that decided it — which is what makes an answer given in
    // March still explainable in June.
    expect(set.offered[0].decision.allowed).toBe(true)
    expect(set.offered[0].decision.policyRevision).toMatch(/^pol-[0-9a-f]{8}$/)
  })

  it("moves the policy revision when the policy moves, and not otherwise", () => {
    // A revision that never changes says every decision was made under the same
    // policy, which is the lie the field exists to prevent. Two systems that
    // differ in which modules they run are two different policies, and a
    // decision made under one must not be explained by the other.
    const roch = authorizeRelayTools(
      staffer("rochester"),
      context("rochester"),
      "rochester",
      "read-only",
    )
    const again = authorizeRelayTools(
      staffer("rochester"),
      context("rochester"),
      "rochester",
      "read-only",
    )
    expect(again.offered[0].decision.policyRevision).toBe(roch.offered[0].decision.policyRevision)

    // Asserted on the value the PRODUCER emits, tied to the function that must
    // have produced it.
    //
    // Everything else here proved the property of `policyRevisionOf` called
    // directly, and the only assertion on the emitted value was the shape
    // `/^pol-[0-9a-f]{8}$/` — which a frozen constant satisfies. So replacing
    // `policyRevision: policyRevisionOf(world)` in decide.ts with
    // `"pol-00000000"` left this file 8/8 green and the whole apps/web suite
    // green: a revision stuck forever, which is the exact lie the field's own
    // doc comment says it exists to prevent, would have shipped. `decideCheck`
    // is the sole production caller of `policyRevisionOf`, so nothing else was
    // watching either.
    expect(roch.offered[0].decision.policyRevision).toBe(policyRevisionOf(worldOf("rochester")))

    // `midtown-arts` runs a smaller module set, so its world is a different
    // policy. It offers no tool, so the revision is read from `policyRevisionOf`
    // over its own world.
    expect(policyRevisionOf(worldOf("midtown-arts"))).not.toBe(
      policyRevisionOf(worldOf("rochester")),
    )
  })

  it("refuses it to someone with no standing, and says why", () => {
    const set = authorizeRelayTools(stranger, context("rochester"), "rochester", "read-only")

    expect(toolOffered(set, "search.corpus")).toBe(false)
    expect(set.offered).toEqual([])
    expect(set.refused).toHaveLength(1)
    expect(set.refused[0]).toMatchObject({
      toolKey: "search.corpus",
      requiredPermission: "search.index.query",
    })
    // A reason a support conversation can start from, not a bare false.
    expect(set.refused[0].reason.length).toBeGreaterThan(0)
  })

  it("decides against the tenant in the context, not the slug alone", () => {
    // The seats are held at `rochester`; the context says the actor is acting
    // in another tenant. Sharing a slug's module set must not carry a
    // membership across, or a tool would be offered on the strength of standing
    // somewhere else.
    const set = authorizeRelayTools(
      staffer("rochester"),
      context("other-tenant"),
      "rochester",
      "read-only",
    )
    expect(toolOffered(set, "search.corpus")).toBe(false)
  })

  it("changes its answer when the seat does, with no session to invalidate", () => {
    // `reauthorizesPerCall: true` on the registration, honoured literally: the
    // same principal, the same tenant, one call apart.
    const before = authorizeRelayTools(
      staffer("rochester"),
      context("rochester"),
      "rochester",
      "read-only",
    )
    const after = authorizeRelayTools(stranger, context("rochester"), "rochester", "read-only")

    expect(toolOffered(before, "search.corpus")).toBe(true)
    expect(toolOffered(after, "search.corpus")).toBe(false)
  })
})

/** WRK-050-005 — a read is not a delete, and the registration says which. */
describe("what a tool would do if it ran", () => {
  it("calls the platform's only registration a read, because it says it is", () => {
    // `readOnly` had no reader anywhere on the platform before this. It has one
    // now, and this is it.
    expect(searchCorpus.readOnly).toBe(true)
    expect(riskOf(searchCorpus)).toBe("READ")
  })

  it("classifies a write by the verb the catalog named", () => {
    expect(riskOf(resourcesWrite)).toBe("WRITE")
    expect(riskOf(reg({ toolKey: "r.d", requiredPermission: "resources.resource.delete" }))).toBe(
      "DELETE",
    )
    expect(riskOf(reg({ toolKey: "r.g", requiredPermission: "resources.resource.purge" }))).toBe(
      "DELETE",
    )
    expect(riskOf(reg({ toolKey: "r.x", requiredPermission: "resources.resource.export" }))).toBe(
      "BULK",
    )
    expect(riskOf(reg({ toolKey: "r.i", requiredPermission: "resources.resource.import" }))).toBe(
      "BULK",
    )
    expect(riskOf(reg({ toolKey: "e.p", requiredPermission: "events.event.publish" }))).toBe(
      "EXTERNAL_SHARE",
    )
    expect(riskOf(reg({ toolKey: "c.d", requiredPermission: "communications.note.draft" }))).toBe(
      "DRAFT",
    )
  })

  it("calls anything in a domain that owns a policy privileged, whatever the verb", () => {
    // A finance action is a finance action. `post` is on no suffix list, and
    // classifying it WRITE would have let it past the gate below on the
    // strength of one permission.
    expect(riskOf(financeLedger)).toBe("PRIVILEGED")
    expect(riskOf(reg({ toolKey: "f.x", requiredPermission: "finance.report.export" }))).toBe(
      "PRIVILEGED",
    )
  })
})

/** WRK-050-005 — the owning domain's policy, not merely the tool's permission. */
describe("a privileged tool must clear its domain's policy too", () => {
  const world = worldFor(director("rochester"), "rochester")

  it("reads the owning policy out of the shipped catalog, not a private string", () => {
    expect(owningPolicyPermission("finance")).toBe("finance.budget.approve")
    expect(owningPolicyPermission("approvals")).toBe("approvals.request.decide")
    // `search` declares one action, `query`, and no administrative act at all.
    expect(owningPolicyPermission("search")).toBeNull()
  })

  it("refuses a finance tool to a Director who holds the tool's own permission", () => {
    // The premise, asserted rather than assumed: the Director DOES hold
    // `finance.ledger.post`, so the refusal below is the second gate firing and
    // not the first. Without this the test would pass for the wrong reason.
    const own = decideCheck(world, {
      context: context("rochester"),
      permission: "finance.ledger.post",
      resourceType: "RelayTool",
      resourceId: null,
    })
    expect(own.permission.allowed).toBe(true)

    const set = authorizeRegistrations(world, context("rochester"), [financeLedger], "any")

    expect(set.offered).toEqual([])
    expect(set.refused).toHaveLength(1)
    expect(set.refused[0].riskClass).toBe("PRIVILEGED")
    // The reason names the owning policy; the remedy names who could grant it,
    // resolved from ROLE_TEMPLATES so it cannot name a role that does not exist.
    expect(set.refused[0].reason).toContain("finance policy")
    expect(set.refused[0].reason).toContain("finance.budget.approve")
    expect(set.refused[0].remedy).toEqual({
      kind: "PERMISSION_NOT_HELD",
      requiredPermission: "finance.budget.approve",
      grantedByRoles: ["finance.approver"],
    })
  })

  it("refuses a write whose domain declares no administrative permission at all", () => {
    // `resources` declares read/create/update/archive and nothing that decides
    // anything, so there is no policy to clear. Offering the tool on its own
    // permission would make the gate decorative; the refusal says which.
    const staff = worldFor(staffer("rochester"), "rochester")
    const set = authorizeRegistrations(staff, context("rochester"), [resourcesWrite], "any")

    expect(set.offered).toEqual([])
    expect(set.refused[0].riskClass).toBe("WRITE")
    expect(set.refused[0].remedy).toEqual({
      kind: "OWNING_POLICY_NOT_DECLARED",
      domain: "resources",
    })
  })

  it("offers a write when the domain's policy IS declared and IS held", () => {
    // `approvals.request.decide` is the approvals domain's administrative act
    // and an OSE staffer holds it tenant-wide. A gate that refused this too
    // would be "refuse every write" wearing a classification's clothes.
    const staff = worldFor(staffer("rochester"), "rochester")
    const set = authorizeRegistrations(staff, context("rochester"), [approvalsRaise], "any")

    expect(set.refused).toEqual([])
    expect(set.offered.map((o) => o.tool.toolKey)).toEqual(["approvals.raise"])
    expect(set.offered[0].riskClass).toBe("WRITE")
  })
})

/**
 * WRK-020-001 — the class the capability is offered under, ahead of everything
 * else.
 *
 * Before this, `grep -rn 'USER_DELEGATED|APPLICATION_ORG_WIDE|WEBHOOK_ONLY'
 * apps packages` returned nothing outside the Bible: a webhook-only grant and an
 * organization-wide application identity were the same thing to every decision
 * in this file, so §4.1's "connection class, provider consent, and Tenure
 * authorization must all agree" had only two of its three terms represented.
 */
describe("a tool may not exceed the class its capability is offered under", () => {
  const world = worldFor(staffer("rochester"), "rochester")

  it("refuses a WRITE offered under a webhook-only connection, naming both classes", () => {
    // The premise, asserted rather than assumed: under `any`, with no class
    // declared, this exact registration IS offered (see the owning-policy block
    // above). So the refusal below is the class gate and not the permission.
    const withoutClass = authorizeRegistrations(
      world,
      context("rochester"),
      [approvalsRaise],
      "any",
      () => null,
    )
    expect(withoutClass.offered.map((o) => o.tool.toolKey)).toEqual(["approvals.raise"])

    const set = authorizeRegistrations(
      world,
      context("rochester"),
      [approvalsRaise],
      "any",
      () => "WEBHOOK_ONLY",
    )

    expect(set.offered).toEqual([])
    expect(set.refused).toHaveLength(1)
    expect(set.refused[0].riskClass).toBe("WRITE")
    expect(set.refused[0].remedy).toEqual({
      kind: "CONNECTION_CLASS_EXCEEDED",
      grantedClass: "WEBHOOK_ONLY",
      requestedRisk: "WRITE",
      requiredClass: "SERVICE_ACCOUNT",
    })
    // Both class names survive to the log line, and the safe half says what an
    // administrator would have to do without naming a permission key.
    expect(set.refused[0].reason).toContain("WEBHOOK_ONLY")
    expect(set.refused[0].reason).toContain("SERVICE_ACCOUNT")
    expect(set.refused[0].safeReason).toContain("reconnect it with wider authority")
    expect(set.refused[0].safeReason).not.toContain("approvals.request.create")
  })

  it("still offers a READ under the same webhook-only connection", () => {
    // A gate that refused everything would be indistinguishable from a broken
    // one. WEBHOOK_ONLY reaches READ and `search.corpus` is a READ.
    const set = authorizeRegistrations(
      world,
      context("rochester"),
      [searchCorpus],
      "read-only",
      () => "WEBHOOK_ONLY",
    )
    expect(set.refused).toEqual([])
    expect(toolOffered(set, "search.corpus")).toBe(true)
  })

  it("is decided before the surface's ceiling, because it is the wider statement", () => {
    // The same registration, the same read-only surface. With no class it is
    // SURFACE_IS_READ_ONLY — "not from this route". With a webhook-only class it
    // is CONNECTION_CLASS_EXCEEDED — "not on this connection, anywhere". The
    // second outranks the first, and collapsing them would send an administrator
    // to change a route setting that is not the problem.
    const surfaceOnly = authorizeRegistrations(
      world,
      context("rochester"),
      [approvalsRaise],
      "read-only",
      () => null,
    )
    expect(surfaceOnly.refused[0].remedy.kind).toBe("SURFACE_IS_READ_ONLY")

    const classFirst = authorizeRegistrations(
      world,
      context("rochester"),
      [approvalsRaise],
      "read-only",
      () => "WEBHOOK_ONLY",
    )
    expect(classFirst.refused[0].remedy.kind).toBe("CONNECTION_CLASS_EXCEEDED")
  })

  it("uses the shipped record when no lookup is passed, which is what the route does", () => {
    // `authorizeRelayTools` passes nothing, so this is the production answer:
    // `search` is offered under APPLICATION_ORG_WIDE and `search.corpus` is a
    // READ, so the gate passes and retrieval works.
    const set = authorizeRelayTools(
      staffer("rochester"),
      context("rochester"),
      "rochester",
      "read-only",
    )
    expect(toolOffered(set, "search.corpus")).toBe(true)
  })
})

/** WRK-050-001 — `readOnly` decides something. */
describe("a surface with no confirmation step offers read tools only", () => {
  const world = worldFor(staffer("rochester"), "rochester")

  it("refuses a writing registration before its permission is even consulted", () => {
    const set = authorizeRegistrations(
      world,
      context("rochester"),
      [searchCorpus, approvalsRaise],
      "read-only",
    )

    expect(set.offered.map((o) => o.tool.toolKey)).toEqual(["search.corpus"])
    const refused = set.refused.find((r) => r.toolKey === "approvals.raise")!
    expect(refused.reason).toContain("read tools only")
    expect(refused.remedy).toEqual({ kind: "SURFACE_IS_READ_ONLY", toolKey: "approvals.raise" })
  })

  it("is decided before the permission and before the policy, not after", () => {
    // The same principal, the same registration, one flag apart. Under `any`
    // this tool is offered, so the read-only refusal cannot be the permission
    // or the policy answering — it is the surface's own ceiling, and it fires
    // first.
    const readOnly = authorizeRegistrations(
      world,
      context("rochester"),
      [approvalsRaise],
      "read-only",
    )
    const any = authorizeRegistrations(world, context("rochester"), [approvalsRaise], "any")

    expect(readOnly.offered).toEqual([])
    expect(readOnly.refused[0].remedy.kind).toBe("SURFACE_IS_READ_ONLY")
    expect(any.offered).toHaveLength(1)
  })
})

/**
 * WRK-030-001 — "there is no such thing here" and "you may not" are different
 * answers, and only one half of a refusal may name the key.
 */
describe("a refusal says which of the two true things it is", () => {
  const proposal = { toolKey: "search.corpus", args: {} }
  const limits: RelayInvocationLimits = {
    executableToolKeys: ["search.corpus"],
    // WRK-GATE-020. Stated, not defaulted: the fixture has to answer the same
    // two questions the route answers. `bidirectional` here so that the WRITING
    // assertions below are about the gate under test rather than about a read
    // grant refusing everything; the read-grant case has its own describe block.
    grantedDirection: "bidirectional",
    selectedResources: [],
  }

  it("tells a principal without the permission that they may not, in a system that has it", () => {
    const set = authorizeRelayTools(stranger, context("rochester"), "rochester", "read-only")
    const outcome = invokeRelayTool(set, context("rochester"), proposal, limits)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.refusal.disclosure).toBe("not-permitted")
    expect(outcome.refusal.safeReason).toBe("You do not have access to search here.")
  })

  it("tells the same principal, in a system without the module, that it is not here", () => {
    const set = authorizeRelayTools(stranger, context("midtown-arts"), "midtown-arts", "read-only")
    const outcome = invokeRelayTool(set, context("midtown-arts"), proposal, limits)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.refusal.disclosure).toBe("not-in-this-system")
    expect(outcome.refusal.safeReason).toBe("search is not part of this system.")
    // Unknown, because there is no registration to classify. Not "READ".
    expect(outcome.refusal.riskClass).toBeNull()
  })

  it("keeps the permission key and the engine's words off the safe half", () => {
    const set = authorizeRelayTools(seatHolder, context("rochester"), "rochester", "read-only")
    const refused = set.refused[0]

    // Present, for logs — and the engine's own words genuinely name the key
    // here, which is exactly what must not reach a browser.
    expect(refused.requiredPermission).toBe("search.index.query")
    expect(refused.reason).toContain("search.index.query")
    // Absent, for the person.
    expect(refused.safeReason).not.toContain("search.index.query")
    expect(refused.safeReason).not.toContain(refused.reason)
  })
})

/** WRK-GATE-030 — a refusal that names a way out. */
describe("a refusal carries a route to access, not a dead end", () => {
  const proposal = { toolKey: "search.corpus", args: {} }
  const limits: RelayInvocationLimits = {
    executableToolKeys: ["search.corpus"],
    // WRK-GATE-020. Stated, not defaulted: the fixture has to answer the same
    // two questions the route answers. `bidirectional` here so that the WRITING
    // assertions below are about the gate under test rather than about a read
    // grant refusing everything; the read-grant case has its own describe block.
    grantedDirection: "bidirectional",
    selectedResources: [],
  }

  it("distinguishes the tenant's missing module from the principal's missing permission", () => {
    const here = invokeRelayTool(
      authorizeRelayTools(stranger, context("rochester"), "rochester", "read-only"),
      context("rochester"),
      proposal,
      limits,
    )
    const elsewhere = invokeRelayTool(
      authorizeRelayTools(stranger, context("midtown-arts"), "midtown-arts", "read-only"),
      context("midtown-arts"),
      proposal,
      limits,
    )

    expect(here.ok).toBe(false)
    expect(elsewhere.ok).toBe(false)
    if (here.ok || elsewhere.ok) return

    // The two kinds are the whole point: the same person, the same tool, two
    // systems, and two different things somebody has to do about it.
    expect(here.refusal.remedy.kind).toBe("PERMISSION_NOT_HELD")
    expect(elsewhere.refusal.remedy).toEqual({ kind: "MODULE_NOT_INSTALLED", module: "search" })
    expect(here.refusal.remedy.kind).not.toBe(elsewhere.refusal.remedy.kind)
  })

  it("names roles the shipped catalog actually defines", () => {
    const set = authorizeRelayTools(stranger, context("rochester"), "rochester", "read-only")
    const remedy = set.refused[0].remedy

    expect(remedy.kind).toBe("PERMISSION_NOT_HELD")
    if (remedy.kind !== "PERMISSION_NOT_HELD") return
    // Derived from ROLE_TEMPLATES rather than written here, so a template that
    // gains or loses the permission changes the answer.
    expect(remedy.grantedByRoles).toEqual(rolesGranting("search.index.query"))
    expect(remedy.grantedByRoles).toContain("institution.staff")
    expect(remedy.grantedByRoles).not.toContain("identity.administrator")
  })
})

/**
 * WRK-050-006 — the model chooses a tool and some arguments. It chooses nothing
 * else, and this is where that stops being an accident of the current shape.
 */
describe("the one door a proposal goes through", () => {
  const offeredSet = authorizeRelayTools(
    staffer("rochester"),
    context("rochester"),
    "rochester",
    "read-only",
  )
  const limits: RelayInvocationLimits = {
    executableToolKeys: ["search.corpus"],
    // WRK-GATE-020. Stated, not defaulted: the fixture has to answer the same
    // two questions the route answers. `bidirectional` here so that the WRITING
    // assertions below are about the gate under test rather than about a read
    // grant refusing everything; the read-grant case has its own describe block.
    grantedDirection: "bidirectional",
    selectedResources: [],
  }

  /**
   * The argument declarations for the fixture registrations.
   *
   * The same seam, and the same reason, as `authorizeRegistrations` taking a
   * registration list: `approvals.raise` is not in the shipped catalog, so it is
   * not in the shipped schema table either, and a gate exercised only against
   * `search.corpus` is a gate exercised only against a read-only tool. The
   * SHIPPED table is what the route uses and is asserted on directly below.
   */
  const schemas: ToolArgumentSchemas = {
    ...TOOL_ARGUMENT_SCHEMAS,
    "approvals.raise": { note: "string" },
  }

  const writingSet = () =>
    authorizeRegistrations(
      worldFor(staffer("rochester"), "rochester"),
      context("rochester"),
      [approvalsRaise],
      "any",
    )

  /** A proposal carrying a confirmation minted for its own exact arguments. */
  const confirming = (
    toolKey: string,
    args: Record<string, unknown>,
    ctx = context("rochester"),
  ) => ({
    toolKey,
    args: { ...args, confirmationToken: mintConfirmation({ toolKey, args }, ctx) },
  })

  const refusalOf = (
    proposal: { toolKey: string; args: Record<string, unknown> },
    over: Partial<RelayInvocationLimits> = {},
    set = offeredSet,
  ) => {
    const outcome = invokeRelayTool(
      set,
      context("rochester"),
      proposal,
      { ...limits, ...over },
      schemas,
    )
    if (outcome.ok) {
      throw new Error(`expected a refusal, got an invocation of ${outcome.tool.toolKey}`)
    }
    return outcome.refusal
  }

  it("lets an offered, executable, argument-clean proposal through", () => {
    const outcome = invokeRelayTool(
      offeredSet,
      context("rochester"),
      { toolKey: "search.corpus", args: { query: "budget" } },
      limits,
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.tool.toolKey).toBe("search.corpus")
    expect(outcome.riskClass).toBe("READ")
    // The tenant and the actor come out of the validated context, not the
    // proposal — this is the value the caller then acts on.
    expect(outcome.args.tenantId).toBe("rochester")
    expect(outcome.args.actorId).toBe("user-1")
    expect(outcome.args.query).toBe("budget")
  })

  // ── WRK-050-001: the arguments are an allow-list ──────────────────────────

  it("refuses an argument the tool never declared", () => {
    // `limit` is plausible, harmless-looking, and undeclared. Under the old
    // deny-list it went through untouched to whatever ran the tool, along with
    // any type and any value for any name nobody had thought of.
    const refusal = refusalOf({ toolKey: "search.corpus", args: { query: "b", limit: 5000 } })

    expect(refusal.remedy).toEqual({ kind: "PROPOSAL_NOT_ACCEPTED", rejected: "limit" })
    expect(refusal.reason).toContain("declares no argument named")
  })

  it("refuses a declared argument sent at the wrong type", () => {
    for (const wrong of [12, true, ["budget"], { q: "budget" }, null]) {
      const refusal = refusalOf({ toolKey: "search.corpus", args: { query: wrong } })
      expect(refusal.remedy).toEqual({ kind: "PROPOSAL_NOT_ACCEPTED", rejected: "query" })
    }
  })

  it("refuses a registration nobody declared a schema for, even when it is offered", () => {
    // Fail closed, and this is the direction that matters: before the schema
    // table existed, a registration nobody had declared arguments for was the
    // FULLY PERMISSIVE one. `approvals.raise` is genuinely offered and genuinely
    // executable here; the only thing missing is a declaration.
    const outcome = invokeRelayTool(
      writingSet(),
      context("rochester"),
      { toolKey: "approvals.raise", args: {} },
      { ...limits, executableToolKeys: ["approvals.raise"] },
      // The SHIPPED table, which is what the route passes by omitting the
      // argument entirely.
      TOOL_ARGUMENT_SCHEMAS,
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.refusal.remedy).toEqual({ kind: "PROPOSAL_NOT_ACCEPTED", rejected: "toolKey" })
    expect(outcome.refusal.reason).toContain("declares no argument schema")
  })

  it("keeps 'you may not choose the tenant' above 'that argument is unknown'", () => {
    // `tenantId` is not in `search.corpus`'s schema either, so both branches
    // would fire. They are two different things to tell somebody and the
    // specific one has to win, or the disclosure-shaped refusal stops being
    // said at all.
    const refusal = refusalOf({ toolKey: "search.corpus", args: { tenantId: "midtown-arts" } })
    expect(refusal.remedy).toEqual({ kind: "PROPOSAL_NOT_ACCEPTED", rejected: "tenantId" })
    expect(refusal.safeReason).toContain("whose data")
  })

  it("refuses a tool that was not offered", () => {
    const refusal = refusalOf({ toolKey: "finance.ledger", args: {} })
    expect(refusal.remedy).toEqual({ kind: "MODULE_NOT_INSTALLED", module: "finance" })
  })

  /**
   * WRK-GATE-020 — the two authorities a granted connection has that nothing in
   * this codebase could previously represent.
   *
   * Identity, tenant and purpose were already enforced (`relay-tools.ts` refuses
   * a proposal naming `tenantId`/`onBehalfOf` and stamps both from the validated
   * context; `search-data.ts` splits the model-bound read from the render-bound
   * one). Direction and resource were not represented at all: a read grant and a
   * write grant were the same value here, and `RelayInvocationLimits` named no
   * container, mailbox, folder or channel.
   */
  describe("a granted connection has a direction and a set of resources", () => {
    it("refuses a writing tool under a read-only grant, naming the direction", () => {
      // `approvals.raise` is genuinely OFFERED here — the requester holds its
      // permission and the approvals domain's own policy, and the writing set is
      // authorized under `any`. So this is the GRANT refusing a tool the
      // authorization allowed, which is the whole distinction.
      const writing = writingSet()
      const outcome = invokeRelayTool(
        writing,
        context("rochester"),
        confirming("approvals.raise", { note: "please" }),
        {
          executableToolKeys: ["approvals.raise"],
          grantedDirection: "read",
          selectedResources: [],
        },
        schemas,
      )

      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.refusal.remedy).toEqual({
        kind: "GRANT_IS_READ_ONLY",
        grantedDirection: "read",
        toolKey: "approvals.raise",
      })
      expect(outcome.refusal.reason).toContain("carries no write authority")
    })

    it("lets the same proposal through on a write grant, so the gate is the direction", () => {
      // Same tool, same principal, same confirmation, one field apart. Without
      // this the direction gate would be indistinguishable from "refuse every
      // write", which is what the surface ceiling already does.
      const writing = writingSet()
      const outcome = invokeRelayTool(
        writing,
        context("rochester"),
        confirming("approvals.raise", { note: "please" }),
        {
          executableToolKeys: ["approvals.raise"],
          grantedDirection: "write",
          selectedResources: [],
        },
        schemas,
      )
      expect(outcome.ok).toBe(true)
    })

    it("refuses every container argument when the grant selects none", () => {
      // §4.2's selectors, and §4.1's "never turn a user token into
      // organization-wide data access by iterating over discoverable
      // resources". An empty selection is the honest way to say "none".
      for (const key of ["folder", "mailbox", "channel", "drive", "repository"]) {
        const refusal = refusalOf({
          toolKey: "search.corpus",
          args: { [key]: "Shared/Finance" },
        })
        expect(refusal.remedy).toEqual({
          kind: "RESOURCE_NOT_SELECTED",
          argument: key,
          requested: "Shared/Finance",
          selected: [],
        })
        expect(refusal.safeReason).toContain("no folders or channels selected")
      }
    })

    it("admits a container the grant does select, and refuses its siblings", () => {
      // The subset case: the refusal is about resources the grant did not
      // select, not about naming a resource at all.
      const inside = refusalOf(
        { toolKey: "search.corpus", args: { folder: "Clubs/Alpha" } },
        { ...GRANT, selectedResources: ["Clubs/Alpha"] },
      )
      // Past (b′) — and refused by the SCHEMA gate instead, because
      // `search.corpus` declares no `folder`. Two true things, and the more
      // specific one is the grant's.
      expect(inside.remedy).toEqual({ kind: "PROPOSAL_NOT_ACCEPTED", rejected: "folder" })

      const sibling = refusalOf(
        { toolKey: "search.corpus", args: { folder: "Clubs/Beta" } },
        { ...GRANT, selectedResources: ["Clubs/Alpha"] },
      )
      expect(sibling.remedy).toEqual({
        kind: "RESOURCE_NOT_SELECTED",
        argument: "folder",
        requested: "Clubs/Beta",
        selected: ["Clubs/Alpha"],
      })
    })

    it("checks an array of containers the same way a lone string is checked", () => {
      const refusal = refusalOf(
        { toolKey: "search.corpus", args: { channel: ["Clubs/Alpha", "Clubs/Beta"] } },
        { ...GRANT, selectedResources: ["Clubs/Alpha"] },
      )
      expect(refusal.remedy).toMatchObject({
        kind: "RESOURCE_NOT_SELECTED",
        requested: "Clubs/Beta",
      })
    })

    it("refuses a container named in a different case, not only the exact spelling", () => {
      // A model that writes `folderId` is proposing the same thing, and a check
      // that missed it would be a check on spelling.
      const refusal = refusalOf({ toolKey: "search.corpus", args: { FolderId: "Shared" } })
      expect(refusal.remedy).toMatchObject({ kind: "RESOURCE_NOT_SELECTED", argument: "FolderId" })
    })
  })

  it("refuses a tool this surface does not execute, even when it is offered", () => {
    const refusal = refusalOf({ toolKey: "search.corpus", args: {} }, { ...GRANT, executableToolKeys: [] })
    expect(refusal.remedy).toEqual({ kind: "PROPOSAL_NOT_ACCEPTED", rejected: "toolKey" })
  })

  it("refuses a proposal that names the tenant, the account or the credential", () => {
    for (const key of [
      "tenantId",
      "institutionId",
      "connectionId",
      "accountId",
      "apiKey",
      "onBehalfOf",
    ]) {
      const refusal = refusalOf({ toolKey: "search.corpus", args: { [key]: "midtown-arts" } })
      expect(refusal.remedy).toEqual({ kind: "PROPOSAL_NOT_ACCEPTED", rejected: key })
    }
  })

  it("refuses it whatever case the model wrote it in", () => {
    // A model that writes `TenantId` is proposing the same thing, and a check
    // that missed it would be a check on spelling.
    const refusal = refusalOf({ toolKey: "search.corpus", args: { TenantId: "midtown-arts" } })
    expect(refusal.remedy).toEqual({ kind: "PROPOSAL_NOT_ACCEPTED", rejected: "TenantId" })
  })

  it("refuses a recipient the caller did not already allow", () => {
    const writing = writingSet()
    const base: RelayInvocationLimits = {
      ...limits,
      executableToolKeys: ["approvals.raise"],
      allowedRecipients: ["allowed.recipient@example.com"],
    }

    for (const key of ["to", "cc", "bcc", "recipients"]) {
      const refusal = refusalOf(
        confirming("approvals.raise", { [key]: ["other.recipient@example.com"] }),
        base,
        writing,
      )
      expect(refusal.remedy).toEqual({ kind: "PROPOSAL_NOT_ACCEPTED", rejected: key })
    }

    // A subset of the allowed set is fine — the refusal is about new
    // destinations, not about naming anybody at all.
    const allowed = invokeRelayTool(
      writing,
      context("rochester"),
      confirming("approvals.raise", { to: ["allowed.recipient@example.com"] }),
      base,
      schemas,
    )
    expect(allowed.ok).toBe(true)

    // And a lone string is checked the same way an array is.
    const scalar = refusalOf(
      confirming("approvals.raise", { to: "other.recipient@example.com" }),
      base,
      writing,
    )
    expect(scalar.remedy).toEqual({ kind: "PROPOSAL_NOT_ACCEPTED", rejected: "to" })
  })
})

/**
 * WRK-050-002 / WRK-GATE-050 — the confirmation on the one door writes go
 * through, at the door.
 *
 * `action-plan.test.ts` proves the primitive. These prove that `invokeRelayTool`
 * — the single production door, called by `apps/web/src/app/api/ai/chat/
 * route.ts` — actually consults it, because a bound confirmation nothing calls
 * is the shape check it replaced.
 */
describe("a writing tool needs a confirmation bound to this exact plan", () => {
  const writing = () =>
    authorizeRegistrations(
      worldFor(staffer("rochester"), "rochester"),
      context("rochester"),
      [approvalsRaise],
      "any",
    )
  const write: RelayInvocationLimits = {
    executableToolKeys: ["approvals.raise"],
    grantedDirection: "bidirectional",
    selectedResources: [],
  }
  const schemas: ToolArgumentSchemas = {
    ...TOOL_ARGUMENT_SCHEMAS,
    "approvals.raise": { note: "string" },
  }

  const invoke = (
    args: Record<string, unknown>,
    ctx = context("rochester"),
    set = writing(),
  ) => invokeRelayTool(set, ctx, { toolKey: "approvals.raise", args }, write, schemas)

  const refusalFor = (args: Record<string, unknown>, ctx = context("rochester")) => {
    const outcome = invoke(args, ctx)
    if (outcome.ok) throw new Error("expected a refusal")
    return outcome.refusal
  }

  it("runs when the confirmation was minted for these exact arguments", () => {
    const args = { note: "catering", to: [] as string[] }
    const token = mintConfirmation({ toolKey: "approvals.raise", args }, context("rochester"))

    const outcome = invoke({ ...args, confirmationToken: token })
    expect(outcome.ok).toBe(true)
  })

  it("refuses the strings the old shape check accepted", () => {
    // The behaviour being replaced, named: `typeof token === "string" &&
    // token.trim().length > 0`. Every one of these passed it.
    for (const forged of ["y", "confirm_9f2", "true", " "]) {
      expect(refusalFor({ note: "catering", confirmationToken: forged }).remedy).toEqual({
        kind: "PROPOSAL_NOT_ACCEPTED",
        rejected: "confirmationToken",
      })
    }
    // And no token at all.
    expect(refusalFor({ note: "catering" }).remedy).toEqual({
      kind: "PROPOSAL_NOT_ACCEPTED",
      rejected: "confirmationToken",
    })
  })

  it("refuses a confirmation minted for a different plan", () => {
    // §7.3: "A changed recipient, body, permission, attachment, target, or
    // provider account invalidates prior approval." One argument moves; the
    // token is otherwise genuine, current, and this person's.
    const approved = { note: "catering" }
    const token = mintConfirmation({ toolKey: "approvals.raise", args: approved }, context("rochester"))

    const refusal = refusalFor({ note: "catering and a bus", confirmationToken: token })
    expect(refusal.remedy).toEqual({ kind: "PROPOSAL_NOT_ACCEPTED", rejected: "confirmationToken" })
    expect(refusal.reason).toContain("PLAN_CHANGED")
    // The person is told to check and confirm again, and is NOT told the
    // engine's word for it.
    expect(refusal.safeReason).toBe("This is not what was confirmed. Check the details and confirm again.")
    expect(refusal.safeReason).not.toContain("PLAN_CHANGED")
  })

  it("refuses a confirmation minted for a different recipient list", () => {
    const approved = { note: "catering", to: ["treasurer@example.com"] }
    const token = mintConfirmation({ toolKey: "approvals.raise", args: approved }, context("rochester"))

    // The same everything, one recipient added — and the recipients are allowed
    // by the caller, so (d) passes and this is (e) refusing.
    const outcome = invokeRelayTool(
      writing(),
      context("rochester"),
      {
        toolKey: "approvals.raise",
        args: {
          note: "catering",
          to: ["treasurer@example.com", "everyone@example.com"],
          confirmationToken: token,
        },
      },
      {
        ...write,
        allowedRecipients: ["treasurer@example.com", "everyone@example.com"],
      },
      schemas,
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.refusal.reason).toContain("PLAN_CHANGED")
  })

  it("refuses a confirmation minted for a different tool", () => {
    // The tool key lives only in the plan digest, so this is the digest
    // refusing rather than a duplicated field agreeing with itself.
    const token = mintConfirmation(
      { toolKey: "search.corpus", args: { note: "catering" } },
      context("rochester"),
    )
    expect(refusalFor({ note: "catering", confirmationToken: token }).reason).toContain(
      "PLAN_CHANGED",
    )
  })

  it("refuses a confirmation minted for another person, and another tenant", () => {
    const args = { note: "catering" }

    // Another actor: mint under a context whose actor differs, present it here.
    const otherActor = parseTenantContext({
      ...context("rochester"),
      actorId: "user-2",
    })
    const theirs = mintConfirmation({ toolKey: "approvals.raise", args }, otherActor)
    expect(refusalFor({ ...args, confirmationToken: theirs }).reason).toContain("WRONG_ACTOR")

    // Another tenant.
    const elsewhere = mintConfirmation({ toolKey: "approvals.raise", args }, context("midtown-arts"))
    expect(refusalFor({ ...args, confirmationToken: elsewhere }).reason).toContain("WRONG_TENANT")
  })

  it("expires, decided against the request's own instant", () => {
    const args = { note: "catering" }
    const token = mintConfirmation({ toolKey: "approvals.raise", args }, context("rochester"))

    // Six minutes later — past CONFIRMATION_TTL_MS — presented on a request
    // whose context says so. `Date.now()` would have made this untestable
    // without faking the clock, and untestable is how an expiry goes unchecked.
    const later = context("rochester", "2026-08-01T12:06:00.000Z")
    const outcome = invokeRelayTool(
      writing(),
      later,
      { toolKey: "approvals.raise", args: { ...args, confirmationToken: token } },
      write,
      schemas,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.refusal.reason).toContain("EXPIRED")
    expect(outcome.refusal.safeReason).toBe(
      "That confirmation has expired. Check the details and confirm again.",
    )

    // Still good one minute in, so "EXPIRED" is the expiry and not a constant.
    const soon = context("rochester", "2026-08-01T12:01:00.000Z")
    expect(
      invokeRelayTool(
        writing(),
        soon,
        { toolKey: "approvals.raise", args: { ...args, confirmationToken: token } },
        write,
        schemas,
      ).ok,
    ).toBe(true)
  })

  it("refuses everything when the process has no signing key", () => {
    const args = { note: "catering" }
    const token = mintConfirmation({ toolKey: "approvals.raise", args }, context("rochester"))
    const secret = process.env[SECRET_VAR]
    const auth = process.env.AUTH_SECRET
    delete process.env[SECRET_VAR]
    delete process.env.AUTH_SECRET
    try {
      expect(refusalFor({ ...args, confirmationToken: token }).reason).toContain("MALFORMED")
    } finally {
      process.env[SECRET_VAR] = secret
      if (auth !== undefined) process.env.AUTH_SECRET = auth
    }
  })

  it("keeps the read tool unaffected: no confirmation is asked of a read", () => {
    // The gate is `readOnly === false` and nothing else. A read that needed a
    // confirmation would have made every assertion above pass for free.
    const reads = authorizeRelayTools(
      staffer("rochester"),
      context("rochester"),
      "rochester",
      "read-only",
    )
    const outcome = invokeRelayTool(
      reads,
      context("rochester"),
      { toolKey: "search.corpus", args: { query: "budget" } },
      { executableToolKeys: ["search.corpus"], grantedDirection: "read", selectedResources: [] },
    )
    expect(outcome.ok).toBe(true)
  })
})

/**
 * WRK-050-002 — the plan is derived from what will run, never handed in.
 */
describe("the plan a confirmation is bound to", () => {
  it("puts every resolved argument into exactly one field of the plan", () => {
    const plan = planForInvocation("approvals.raise", context("rochester"), {
      to: ["a@example.com"],
      cc: "b@example.com",
      targetId: "req_7",
      body: "please approve",
      notify: true,
      permissions: ["finance.budget.approve"],
      note: "catering",
      confirmationToken: "ignored",
    })

    expect(plan).toEqual({
      tenantId: "rochester",
      actorId: "user-1",
      toolKey: "approvals.raise",
      target: "req_7",
      recipients: ["a@example.com", "b@example.com"],
      body: "please approve",
      notifies: true,
      permissionImpact: ["finance.budget.approve"],
      // Everything the named projections did not claim — so an argument nobody
      // anticipated is still covered by the digest.
      args: { note: "catering" },
    })
  })

  it("takes the tenant and the actor from the context, never from the arguments", () => {
    // Belt and braces with (b), which refuses these outright: even if a future
    // gate let one through, the plan a confirmation covers is the request's.
    const plan = planForInvocation("approvals.raise", context("rochester"), {
      note: "catering",
    })
    expect(plan.tenantId).toBe("rochester")
    expect(plan.actorId).toBe("user-1")
  })

  it("exposes the same digest the door checks against", () => {
    // `proposalDigest` is what the route writes into the audit row. If it
    // computed a different plan from the one `verifyConfirmation` recomputes,
    // the trail would name something that never ran.
    const proposal = { toolKey: "approvals.raise", args: { note: "catering" } }
    expect(proposalDigest(proposal, context("rochester"))).toBe(
      planDigest(planForInvocation(proposal.toolKey, context("rochester"), proposal.args)),
    )
  })
})

/**
 * WRK-050-001 — the shipped schema table covers the shipped registrations.
 *
 * The fail-closed branch means an undeclared registration cannot be invoked,
 * which is the safe failure. This is the one that notices it happened: a tool
 * added to `modules/index.ts` without an argument declaration reds here rather
 * than being discovered by somebody whose assistant quietly stopped working.
 */
describe("every registration this platform ships declares its arguments", () => {
  it("covers each tenant's registrations", () => {
    for (const slug of ["rochester", "midtown-arts"]) {
      for (const tool of relayToolsFor(slug)) {
        expect(Object.keys(TOOL_ARGUMENT_SCHEMAS)).toContain(tool.toolKey)
      }
    }
  })

  it("declares nothing for a tool that does not exist", () => {
    // The other direction: a schema for a registration nobody contributes is
    // dead data that reads like a capability.
    const shipped = new Set(relayToolsFor("rochester").map((t) => t.toolKey))
    expect(Object.keys(TOOL_ARGUMENT_SCHEMAS).filter((k) => !shipped.has(k))).toEqual([])
  })
})
