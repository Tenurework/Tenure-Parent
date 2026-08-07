import { decideCheck } from "@tenure/authorization"
import { modulesFor, tiersFor } from "@tenure/platform-config"
import {
  parseToolRegistration,
  type PermissionDecision,
  type TenantContext,
  type ToolRegistration,
} from "@tenure/contracts"

import { institutionWorld } from "@/lib/authz/seat-world"
import type { UserContext } from "@/lib/rbac"

/**
 * PACK-070-004 — the tools Relay may use on this system, for this person.
 *
 * Two facts, decided in this order and never collapsed:
 *
 *   1. **Which tools exist here.** A tool belongs to a module, and a module is
 *      either in this tenant's system or it is not. A tenant that does not run
 *      `search` has no search tool — not a search tool that returns nothing,
 *      which is what a hardcoded tool list degrades to.
 *   2. **Which of those this principal may invoke.** Every registration names a
 *      `requiredPermission`, and that is the whole reason `ToolRegistration`
 *      makes it mandatory: a tool offered without one is a capability an
 *      assistant can point at any row the process can reach.
 *
 * Both are refusals with reasons rather than a filtered list, because "the
 * assistant did not use the tool" and "the assistant was not allowed to" are
 * different answers to give someone, and a boolean cannot tell them apart.
 *
 * ## Why the decision is per call
 *
 * `reauthorizesPerCall` on the registration is not decoration and this is where
 * it is honoured: the world is rebuilt from the requester's current seats on
 * every request. A seat that ended between two questions stops answering on the
 * second one, without a session to invalidate or a cache to bust.
 */

export interface OfferedTool {
  tool: ToolRegistration
  decision: PermissionDecision
}

export interface RefusedTool {
  toolKey: string
  /** The permission that was not held. Safe to log: it is a catalog key. */
  requiredPermission: string
  /** Why, in the authorization engine's words. */
  reason: string
}

export interface RelayToolset {
  offered: readonly OfferedTool[]
  refused: readonly RefusedTool[]
}

/**
 * The registrations the enabled modules contribute, in a stable order.
 *
 * Re-parsed here even though `validateManifest` already did it at catalog
 * construction. That is not belt-and-braces: this is the value about to be
 * offered to a model, and it arrives across a package boundary the compiler
 * checked and the runtime did not. The cost is a few microseconds on a request
 * that is about to make a network call to a model vendor.
 */
export function relayToolsFor(institutionSlug: string): readonly ToolRegistration[] {
  return modulesFor(institutionSlug)
    .enabled.flatMap((m) => m.tools ?? [])
    .map((t) => parseToolRegistration(t))
    .sort((a, b) => (a.toolKey < b.toolKey ? -1 : a.toolKey > b.toolKey ? 1 : 0))
}

/**
 * Which of this system's tools this principal may invoke right now.
 *
 * `context` is the kernel's `TenantContext`, which is what makes the check a
 * `PermissionCheck` rather than four loose arguments: the tenant, the actor and
 * the instant all come from one validated value, so a check cannot be made for
 * one tenant's actor against another tenant's world.
 */
export function authorizeRelayTools(
  ctx: UserContext,
  context: TenantContext,
  institutionSlug: string,
): RelayToolset {
  const tools = relayToolsFor(institutionSlug)
  if (tools.length === 0) return { offered: [], refused: [] }

  const world = institutionWorld(
    ctx,
    context.tenantId,
    modulesFor(institutionSlug).keys,
    // The tier facts. A tool gated on a permission whose role carries a
    // `minTier` cannot be decided without them — the gate silently passes.
    tiersFor(institutionSlug),
  )

  const offered: OfferedTool[] = []
  const refused: RefusedTool[] = []

  for (const tool of tools) {
    const { decision, permission } = decideCheck(world, {
      context,
      permission: tool.requiredPermission,
      // The tool itself is what is being authorized. There is no row yet — the
      // tool is what would go and find them — so the check is tenant-scoped and
      // whatever the tool then reads is authorized again by the query that
      // reads it. A tool check that pretended to name a resource would be
      // asserting an authorization it has not made.
      resourceType: "RelayTool",
      resourceId: null,
    })

    if (permission.allowed) {
      offered.push({ tool, decision: permission })
    } else {
      refused.push({
        toolKey: tool.toolKey,
        requiredPermission: tool.requiredPermission,
        reason: decision.detail,
      })
    }
  }

  return { offered, refused }
}

/** Whether a named tool survived authorization. The question a route asks. */
export function toolOffered(set: RelayToolset, toolKey: string): boolean {
  return set.offered.some((o) => o.tool.toolKey === toolKey)
}
