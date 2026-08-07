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
  authorizeRegistrations,
  authorizeRelayTools,
  invokeRelayTool,
  owningPolicyPermission,
  relayToolsFor,
  riskOf,
  rolesGranting,
  toolOffered,
} from "./relay-tools"
import type { UserContext } from "./rbac"

const AT = "2026-08-01T12:00:00.000Z"

const context = (tenantId: string) =>
  parseTenantContext({
    tenantId,
    actorId: "user-1",
    actorKind: "user",
    channel: "web",
    correlationId: "corr-1",
    configRevision: "university-student-organizations@1.0.0",
    environment: "test",
    legalEntityId: null,
    at: AT,
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
  const limits = { executableToolKeys: ["search.corpus"] }

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
  const limits = { executableToolKeys: ["search.corpus"] }

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
  const limits = { executableToolKeys: ["search.corpus"] }

  const writingSet = () =>
    authorizeRegistrations(
      worldFor(staffer("rochester"), "rochester"),
      context("rochester"),
      [approvalsRaise],
      "any",
    )

  const refusalOf = (
    proposal: { toolKey: string; args: Record<string, unknown> },
    over: Partial<{
      executableToolKeys: readonly string[]
      allowedRecipients: readonly string[]
    }> = {},
    set = offeredSet,
  ) => {
    const outcome = invokeRelayTool(set, context("rochester"), proposal, { ...limits, ...over })
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

  it("refuses a tool that was not offered", () => {
    const refusal = refusalOf({ toolKey: "finance.ledger", args: {} })
    expect(refusal.remedy).toEqual({ kind: "MODULE_NOT_INSTALLED", module: "finance" })
  })

  it("refuses a tool this surface does not execute, even when it is offered", () => {
    const refusal = refusalOf({ toolKey: "search.corpus", args: {} }, { executableToolKeys: [] })
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

  it("refuses a writing tool with no confirmation a person produced", () => {
    // `approvals.raise` is genuinely offered under `any` — see the policy block
    // above — so this is the door refusing a tool the authorization allowed.
    const writing = writingSet()
    const write = { executableToolKeys: ["approvals.raise"] }

    expect(refusalOf({ toolKey: "approvals.raise", args: {} }, write, writing).remedy).toEqual({
      kind: "PROPOSAL_NOT_ACCEPTED",
      rejected: "confirmationToken",
    })
    // An empty string is not a confirmation.
    expect(
      refusalOf({ toolKey: "approvals.raise", args: { confirmationToken: "  " } }, write, writing)
        .remedy,
    ).toEqual({ kind: "PROPOSAL_NOT_ACCEPTED", rejected: "confirmationToken" })

    const confirmed = invokeRelayTool(
      writing,
      context("rochester"),
      { toolKey: "approvals.raise", args: { confirmationToken: "confirm_9f2" } },
      write,
    )
    expect(confirmed.ok).toBe(true)
  })

  it("refuses a recipient the caller did not already allow", () => {
    const writing = writingSet()
    const base = {
      executableToolKeys: ["approvals.raise"],
      allowedRecipients: ["allowed.recipient@example.com"],
    }
    const args = { confirmationToken: "confirm_9f2" }

    for (const key of ["to", "cc", "bcc", "recipients"]) {
      const refusal = refusalOf(
        { toolKey: "approvals.raise", args: { ...args, [key]: ["other.recipient@example.com"] } },
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
      { toolKey: "approvals.raise", args: { ...args, to: ["allowed.recipient@example.com"] } },
      base,
    )
    expect(allowed.ok).toBe(true)

    // And a lone string is checked the same way an array is.
    const scalar = refusalOf(
      { toolKey: "approvals.raise", args: { ...args, to: "other.recipient@example.com" } },
      base,
      writing,
    )
    expect(scalar.remedy).toEqual({ kind: "PROPOSAL_NOT_ACCEPTED", rejected: "to" })
  })
})
