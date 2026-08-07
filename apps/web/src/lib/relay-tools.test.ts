/**
 * PACK-070-004 — the tool set is a per-tenant, per-principal decision.
 *
 * Nothing is mocked below except the requester's seats. The module catalog, the
 * tenant bindings, the permission catalog, the role templates and `decide()`
 * are all the shipped ones — which is the point, because the claim being tested
 * is that a declaration in `modules/index.ts` reaches an authorization decision
 * without anything in between rewriting it.
 */
import { describe, expect, it } from "@jest/globals"

import { parseTenantContext } from "@tenure/contracts"
import { policyRevisionOf } from "@tenure/authorization"
import { modulesFor, tiersFor } from "@tenure/platform-config"

import { institutionWorld } from "./authz/seat-world"
import { authorizeRelayTools, relayToolsFor, toolOffered } from "./relay-tools"
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
    at: AT,
  })

const staffer = (institutionId: string): UserContext => ({
  userId: "user-1",
  institutionRoles: [{ institutionId, role: "OSE_STAFF" }],
  orgRoles: [],
})

const stranger: UserContext = { userId: "user-1", institutionRoles: [], orgRoles: [] }

/** The same world `authorizeRelayTools` decides against, for one tenant. */
const worldOf = (slug: string) =>
  institutionWorld(staffer(slug), slug, modulesFor(slug).keys, tiersFor(slug))

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
    const set = authorizeRelayTools(staffer("rochester"), context("rochester"), "rochester")

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
    const roch = authorizeRelayTools(staffer("rochester"), context("rochester"), "rochester")
    const again = authorizeRelayTools(staffer("rochester"), context("rochester"), "rochester")
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
    const set = authorizeRelayTools(stranger, context("rochester"), "rochester")

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
    const set = authorizeRelayTools(staffer("rochester"), context("other-tenant"), "rochester")
    expect(toolOffered(set, "search.corpus")).toBe(false)
  })

  it("changes its answer when the seat does, with no session to invalidate", () => {
    // `reauthorizesPerCall: true` on the registration, honoured literally: the
    // same principal, the same tenant, one call apart.
    const before = authorizeRelayTools(staffer("rochester"), context("rochester"), "rochester")
    const after = authorizeRelayTools(stranger, context("rochester"), "rochester")

    expect(toolOffered(before, "search.corpus")).toBe(true)
    expect(toolOffered(after, "search.corpus")).toBe(false)
  })
})
