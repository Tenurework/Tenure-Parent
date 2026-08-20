import { lookupPermission, type AuthorizationWorld } from "@tenure/authorization"

import { NAV_CAPABILITIES } from "@/lib/authz/navigation-capabilities"

import { decideTargetAccess, type TargetAccessDecision } from "./module-scope"
import { COMPILED_TENANT_ENTRY_POLICY, tenantEntryFacts, type TenantEntryInput } from "./tenant-entry"
import type { EligibilityTarget } from "./targets"

/**
 * IER-120-003 / IER-120-004 — the targets behind this deployment's menu, run
 * through the composed gate.
 *
 * §17: "UI navigation derives from current semantic entitlements and
 * authorization hints, but servers independently enforce every action and data
 * query." `navigation-capabilities.ts` already answers the second half for the
 * two entries this product's menu has — it asks `decide()` rather than counting
 * role rows. What it cannot answer is the first half, because a capability is
 * not a target: it says "this principal may read the admin console" and says
 * nothing about whether the tenant bought administration, or whether this
 * person is in the population administration is for.
 *
 * So this file names the two menu entries as `EligibilityTarget`s and sends
 * them through `decideTargetAccess`, which asks all three gates in §2.1's
 * order. It does not replace `navigationCapabilitiesFor` and does not
 * re-implement it: the permission each target authorizes IS
 * `NAV_CAPABILITIES`, imported, so the two cannot drift into different opinions
 * about what the menu is made of.
 *
 * ## Where each target's capability comes from
 *
 * From the permission catalog, via `lookupPermission`, not from a second list
 * written here. `admin.console.read` declares module `administration` and
 * `finance.report.read` declares `budgeting`; if a permission is ever moved
 * between modules, this file follows rather than contradicts. A permission the
 * catalog does not know, or one declared platform-level with no module, throws
 * at module load — a menu entry gated on a capability nobody declared is a menu
 * entry gated on nothing.
 *
 * ## Which eligibility policy decides them, honestly
 *
 * `tenure.tenant-entry.v1`. This deployment holds exactly two roster facts
 * about a person — the state of their affiliation and whether they proved their
 * address — and there is no third fact that would distinguish "the population
 * administration is for" from "the population the workspace is for". Writing a
 * second policy over the same two facts would be a policy that looks specific
 * and decides identically, which is worse than reusing the one that is true.
 * When a source arrives that does distinguish them, the target gets its own
 * compiled policy and nothing else in this file changes.
 */

function moduleBehind(permission: string): string {
  const definition = lookupPermission(permission)
  if (!definition) {
    throw new Error(`navigation target permission "${permission}" is in no permission catalog entry`)
  }
  if (!definition.module) {
    throw new Error(
      `navigation target permission "${permission}" is platform-level; a menu entry must be gated on a module the tenant can be entitled to`,
    )
  }
  return definition.module
}

export interface NavigationTarget {
  target: EligibilityTarget
  /** The action stage 3 authorizes for this entry. */
  permission: string
}

export const NAVIGATION_TARGETS: readonly NavigationTarget[] = [
  {
    target: {
      kind: "module",
      id: "administration",
      capability: moduleBehind(NAV_CAPABILITIES.administer),
    },
    permission: NAV_CAPABILITIES.administer,
  },
  {
    target: {
      kind: "report",
      id: "finance-reporting",
      capability: moduleBehind(NAV_CAPABILITIES.viewReports),
    },
    permission: NAV_CAPABILITIES.viewReports,
  },
]

export interface NavigationTargetInput {
  subjectId: string
  tenantId: string
  /** Gate 1 — what this tenant is entitled to run. */
  tenantCapabilities: readonly string[]
  /** Gate 2's facts, from the same bootstrap read `/api/me` already performs. */
  entry: TenantEntryInput
  /** Gate 3's world — `worldFor(ctx, institutionId, enabledModules)`. */
  world: AuthorizationWorld
}

/**
 * Decide every menu target for one person, in one place.
 *
 * Returns the decisions rather than a filtered list of refs: the caller that
 * wants a menu calls `visibleTargets`, and the caller that wants to tell
 * somebody why a link is missing calls `hiddenTargetReasons`. Handing back only
 * the survivors would throw away the reasons, which is how "the button is not
 * there" becomes the entire explanation a person gets.
 */
export function navigationTargetAccess(
  input: NavigationTargetInput,
): TargetAccessDecision[] {
  const facts = tenantEntryFacts(input.entry)
  return NAVIGATION_TARGETS.map(({ target, permission }) =>
    decideTargetAccess({
      target,
      subjectId: input.subjectId,
      tenantId: input.tenantId,
      permission,
      now: input.entry.now,
      tenantCapabilities: input.tenantCapabilities,
      policy: COMPILED_TENANT_ENTRY_POLICY,
      facts,
      world: input.world,
    }),
  )
}
