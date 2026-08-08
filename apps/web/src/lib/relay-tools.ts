import { PERMISSIONS, decideCheck, type AuthorizationWorld } from "@tenure/authorization"
import { connectionClassFor, modulesFor, tiersFor } from "@tenure/platform-config"
import {
  parseToolRegistration,
  type PermissionDecision,
  type TenantContext,
  type ToolRegistration,
} from "@tenure/contracts"

import { rolesGranting } from "@/lib/authz/roles-granting"
import { institutionWorld } from "@/lib/authz/seat-world"
import type { UserContext } from "@/lib/rbac"
import {
  RISK_ORDER,
  refuseEscalation,
  type ConnectionClass,
} from "@/lib/relay/connection-class"
import {
  confirmationMatches,
  confirmationSecret,
  issueConfirmation,
  planDigest,
  type ActionPlan,
  type ConfirmationVerdict,
} from "@/lib/relay/action-plan"

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
 *
 * ## WRK-050-005 — one gate was never enough
 *
 * Holding the tool's own permission used to be the entire decision, so a tool
 * that deletes, exports in bulk, shares outside the institution or posts to a
 * ledger would have been handed to a model on exactly the same footing as a
 * lookup. Three gates now stand between a registration and a model, in this
 * order, and each one refuses with its own reason:
 *
 *   1. **The surface's ceiling** (`allow`). A surface with no confirmation step
 *      may offer read tools only, decided before any permission is consulted —
 *      a writing tool is not "denied to you", it is not on offer here at all.
 *   2. **The tool's own permission**, through `decide()`, as before.
 *   3. **The owning domain's policy** (`riskOf` above DRAFT). Posting to a
 *      ledger is a finance act before it is a tool call, so it must also clear
 *      the permission the finance domain reserves for its administrative
 *      decisions. A domain that declares no such permission refuses, rather
 *      than being offered on the tool's own permission alone.
 *
 * ## WRK-050-006 — and one door
 *
 * `authorizeRelayTools` says what may be offered. `invokeRelayTool` is the only
 * way to act on that, and it is where the model's proposal stops being trusted:
 * the tenant and the actor come from the validated `TenantContext`, never from
 * the proposal, a proposal that names either is refused outright rather than
 * silently overwritten, a writing tool needs a confirmation a person produced,
 * and a recipient the caller did not already allow is refused.
 *
 * ## WRK-050-001 — and the arguments are an allow-list, not a deny-list
 *
 * The door used to name six arguments a model may not send and pass every other
 * key through untouched, so any type, any extra field and any value for any
 * name nobody had thought of reached the tool. `TOOL_ARGUMENT_SCHEMAS` inverts
 * that: a tool with no declared schema cannot be invoked at all, and an argument
 * the schema does not declare — or declares at another type — is refused. A
 * registration added tomorrow is unusable until somebody says what it takes,
 * which is the opposite of the previous default.
 *
 * ## WRK-050-002 / WRK-GATE-050 — and the confirmation is real
 *
 * `readOnly === false` used to be gated on a non-empty string, so the literal
 * `"y"` authorized a write and the model supplied it in the same body as its own
 * proposal — the model confirming itself. It is now
 * `apps/web/src/lib/relay/action-plan.ts`: the plan is derived from the
 * invocation's own resolved arguments, and the confirmation is an HMAC bound to
 * a digest of that plan, to the tenant, to the actor and to an expiry. A
 * confirmation given for a different plan, a different person or five minutes
 * ago refuses, and the refusal says which.
 *
 * ## WRK-030-001 / WRK-GATE-030 — what a refusal may say
 *
 * A refusal carries two halves that must not be confused. `requiredPermission`
 * and `reason` are the authorization engine's own words and are for logs: given
 * to a browser they tell an unprivileged caller that a capability exists here
 * and name the exact key that would unlock it. `disclosure`, `safeReason` and
 * `remedy` are the half written for the person, and they are what a surface
 * returns — including a route out, resolved from the shipped role catalog, so
 * "you may not" is not a dead end.
 */

// ── risk classification ─────────────────────────────────────────────────────

/**
 * What a tool would do if it ran, ordered least to most consequential.
 *
 * Derived from the registration rather than declared on it: `ToolRegistration`
 * (packages/contracts) carries only `readOnly` and `reauthorizesPerCall`, and a
 * classification that lived in a comment would be a classification nothing
 * enforces.
 */
export type ActionRiskClass =
  | "READ"
  | "DRAFT"
  | "WRITE"
  | "BULK"
  | "EXTERNAL_SHARE"
  | "DELETE"
  | "PRIVILEGED"

// WRK-020-001. The ordering is imported from `relay/connection-class.ts` rather
// than restated here: that module compares a connection class's ceiling against
// a risk, and two orderings would be two answers to "is this worse than that".
// The import runs one way — this module imports that one — because
// `connection-class.ts` takes only `import type { ActionRiskClass }` back, which
// is erased.

/**
 * The domains whose actions answer to a policy of their own.
 *
 * Money, people, contracts and safety are the four places where "the person
 * held the permission" has never been the whole authorization in any real
 * institution — there is a controller, a head of HR, counsel, a safety officer.
 * A writing tool in one of these is PRIVILEGED whatever verb it uses, because
 * the verb cannot make a finance action less than a finance action.
 */
const OWNING_POLICY_DOMAINS: readonly string[] = ["finance", "hr", "payment", "legal", "safety"]

const DELETE_ACTIONS: readonly string[] = ["delete", "purge"]
const BULK_ACTIONS: readonly string[] = ["bulk", "import", "export"]
const EXTERNAL_SHARE_ACTIONS: readonly string[] = ["share", "publish"]
/** A draft leaves as text for a person to use, not as a row. */
const DRAFT_ACTIONS: readonly string[] = ["draft", "propose"]

/** `finance.ledger.post` → `finance`. The module that owns the permission. */
function domainOf(permission: string): string {
  return permission.split(".")[0] ?? ""
}

/** `finance.ledger.post` → `post`. The verb the catalog named. */
function actionOf(permission: string): string {
  const parts = permission.split(".")
  return parts[parts.length - 1] ?? ""
}

/**
 * What this registration would do, from the registration's own facts.
 *
 * Pure and total: every registration gets a class, and a verb nobody has
 * classified lands on WRITE rather than on READ. Failing towards "this changes
 * something" is the only safe default here — the cost of over-classifying a
 * harmless tool is that a surface refuses it, and the cost of under-classifying
 * a destructive one is that a model gets it.
 */
export function riskOf(tool: ToolRegistration): ActionRiskClass {
  // `readOnly` is the registration's own promise that nothing changes. This is
  // the first place on the platform that reads it.
  if (tool.readOnly) return "READ"

  const domain = domainOf(tool.requiredPermission)
  const action = actionOf(tool.requiredPermission)

  if (OWNING_POLICY_DOMAINS.includes(domain)) return "PRIVILEGED"
  if (DELETE_ACTIONS.includes(action)) return "DELETE"
  if (BULK_ACTIONS.includes(action)) return "BULK"
  if (EXTERNAL_SHARE_ACTIONS.includes(action)) return "EXTERNAL_SHARE"
  if (DRAFT_ACTIONS.includes(action)) return "DRAFT"
  return "WRITE"
}

/** Whether a class sits above a ceiling in the ordering above. */
export function riskExceeds(risk: ActionRiskClass, ceiling: ActionRiskClass): boolean {
  return RISK_ORDER.indexOf(risk) > RISK_ORDER.indexOf(ceiling)
}

/**
 * The administrative acts a domain can declare, most authoritative first.
 *
 * Read against the shipped permission catalog rather than hardcoded per domain,
 * so a domain that gains an `approve` tomorrow gains an owning policy without
 * anything here being edited, and a domain that declares none resolves to null
 * and fails closed.
 */
const ADMINISTRATIVE_ACTIONS: readonly string[] = [
  "override",
  "approve",
  "decide",
  "configure",
  "promote",
  "suspend",
]

/**
 * The permission a domain reserves for its own administrative decisions.
 *
 * `finance` → `finance.budget.approve`; `search` → null, because querying an
 * index is the only thing the search domain declares. Null is a refusal, not a
 * pass: a domain with no declared policy cannot have that policy consulted, and
 * offering the tool anyway would make the gate decorative.
 */
export function owningPolicyPermission(domain: string): string | null {
  for (const action of ADMINISTRATIVE_ACTIONS) {
    const hit = PERMISSIONS.find((p) => p.domain === domain && p.action === action)
    if (hit) return hit.key
  }
  return null
}

/**
 * The shipped role templates that carry a permission — WRK-GATE-030's "ask
 * somebody who can grant this".
 *
 * Re-exported rather than defined here since WRK-110-005: the Connection Centre
 * needs the identical answer to say who can clear a `NEEDS_ADMIN`, and it is
 * reachable from a client bundle that cannot import this module (see the header
 * of `@/lib/authz/roles-granting`). One implementation, two importers — a
 * second copy is how a refusal comes to name a role nobody holds.
 */
export { rolesGranting }

// ── the shape of an answer ──────────────────────────────────────────────────

/** Whether a surface may offer tools that change things. */
export type ToolPolicy = "read-only" | "any"

/**
 * Which of the two true things a refusal is.
 *
 * REVIEW-FINDINGS.md §21 resolves the platform's 404-vs-deny-reason
 * contradiction as "404 for non-members; structured reason for authenticated
 * members of the tenant". Everybody reaching this code is an authenticated
 * member, so both cases get a structured reason — but they are different
 * reasons, and collapsing them tells one of the two people something false.
 */
export type ToolDisclosure = "not-in-this-system" | "not-permitted"

/**
 * What the person could actually do about it.
 *
 * Discriminated so a client branches on `kind` rather than pattern-matching
 * prose, which is what made the old bare-string refusal a dead end.
 */
export type RelayRemedy =
  /** The module is not part of this system. Somebody would have to install it. */
  | { kind: "MODULE_NOT_INSTALLED"; module: string }
  /** Somebody holding one of `grantedByRoles` can grant `requiredPermission`. */
  | { kind: "PERMISSION_NOT_HELD"; requiredPermission: string; grantedByRoles: readonly string[] }
  /** The domain declares no administrative permission, so nobody can clear it. */
  | { kind: "OWNING_POLICY_NOT_DECLARED"; domain: string }
  /** The tool exists and is permitted; this surface cannot run writing tools. */
  | { kind: "SURFACE_IS_READ_ONLY"; toolKey: string }
  /** The proposal itself was rejected. `rejected` names the field. */
  | { kind: "PROPOSAL_NOT_ACCEPTED"; rejected: string }
  /**
   * WRK-020-001. The tool exceeds the §4.1 class its capability is offered
   * under. Names BOTH classes, because the way out is an administrator changing
   * the grant and "you may not" does not tell them to what.
   */
  | {
      kind: "CONNECTION_CLASS_EXCEEDED"
      grantedClass: ConnectionClass
      requestedRisk: ActionRiskClass
      requiredClass: ConnectionClass | null
    }
  /**
   * WRK-GATE-020. The grant reads and the tool writes. Direction authority was
   * not represented at all before this: a read grant and a write grant were
   * indistinguishable at the one door a proposal goes through.
   */
  | { kind: "GRANT_IS_READ_ONLY"; grantedDirection: GrantedDirection; toolKey: string }
  /**
   * WRK-GATE-020. The proposal named a container the grant does not select.
   * §4.2's resource selectors, as a refusal rather than as prose.
   */
  | {
      kind: "RESOURCE_NOT_SELECTED"
      argument: string
      requested: string
      selected: readonly string[]
    }

export interface OfferedTool {
  tool: ToolRegistration
  decision: PermissionDecision
  riskClass: ActionRiskClass
}

export interface RefusedTool {
  toolKey: string
  /**
   * What the tool would have done. Null only when no registration was found —
   * an unknown tool has no facts to classify.
   */
  riskClass: ActionRiskClass | null
  /**
   * The permission that was not held. A catalog key: safe to LOG, and not safe
   * to return, because it names the exact key that would unlock a capability
   * to somebody who has just been told they may not use it.
   */
  requiredPermission: string
  /** Why, in the authorization engine's words. For logs, for the same reason. */
  reason: string
  /** Which of "there is no such thing here" and "you may not" this is. */
  disclosure: ToolDisclosure
  /** The same fact, written for the person. Safe to return. */
  safeReason: string
  /** The way out. Safe to return, except for the fields a surface strips. */
  remedy: RelayRemedy
}

export interface RelayToolset {
  offered: readonly OfferedTool[]
  refused: readonly RefusedTool[]
}

// ── which registrations exist here ──────────────────────────────────────────

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

// ── which of them this principal may be offered ─────────────────────────────

/**
 * The whole decision, over registrations already resolved.
 *
 * Split out from `authorizeRelayTools` so the three gates can be exercised
 * against registrations the shipped catalog does not contain yet — there is
 * exactly one today, `search.corpus`, and a gate proven only against a
 * read-only tool is a gate proven against the case it does not exist for. The
 * world, the context, the parser and `decide()` are the real ones in both
 * paths; only the list of registrations differs.
 *
 * `authorizeRelayTools` is its production caller.
 */
export function authorizeRegistrations(
  world: AuthorizationWorld,
  context: TenantContext,
  registrations: readonly ToolRegistration[],
  allow: ToolPolicy,
  /**
   * How to look up the §4.1 class a module's capability is offered under.
   *
   * The same seam, and for the same reason, as the registration list above and
   * as `invokeRelayTool`'s `schemas`: the shipped record names one module, so a
   * gate exercised only against it is a gate exercised only against the case it
   * does not fire on. The default IS the production lookup, so a caller that
   * says nothing gets the real answer — `authorizeRelayTools` passes nothing.
   */
  classOf: (moduleKey: string) => ConnectionClass | null = connectionClassFor,
): RelayToolset {
  const offered: OfferedTool[] = []
  const refused: RefusedTool[] = []

  for (const tool of registrations) {
    const riskClass = riskOf(tool)

    // 0. The class of the connection this capability is offered under
    //    (WRK-020-001, Bible §4.1).
    //
    // FIRST, ahead of the surface's own ceiling, because the two say different
    // things and the stronger one should be said first: "this connection may
    // never do that, anywhere" outranks "not from this route". A webhook-only
    // grant and an organization-wide application identity used to be the same
    // thing to every decision below, so there was no point in this file where
    // the first sentence could be written at all.
    //
    // `connectionClassFor` returns null for a module no connection serves —
    // answered from this platform's own store, under Tenure authorization alone
    // — and null is deliberately not a refusal. See the note on the function.
    const grantedClass = classOf(tool.module)
    if (grantedClass) {
      const escalation = refuseEscalation(grantedClass, riskClass)
      if (!escalation.ok) {
        refused.push({
          toolKey: tool.toolKey,
          riskClass,
          requiredPermission: tool.requiredPermission,
          reason: escalation.reason,
          disclosure: "not-permitted",
          safeReason:
            `${tool.module} is connected here in a way that cannot ${riskClass.toLowerCase()} — ` +
            `the connection was set up for ${escalation.ceiling.toLowerCase()} access only. ` +
            `An administrator would have to reconnect it with wider authority.`,
          remedy: {
            kind: "CONNECTION_CLASS_EXCEEDED",
            grantedClass: escalation.grantedClass,
            requestedRisk: riskClass,
            requiredClass: escalation.requiredClass,
          },
        })
        continue
      }
    }

    // 1. The surface's ceiling, decided before any permission is consulted.
    //
    // Deliberately first. Asking "may you write here" of a surface that cannot
    // write at all produces a refusal about the person for a limit that has
    // nothing to do with them — and, on the allow path, would have offered a
    // writing tool to a model on a route with no confirmation step.
    if (allow === "read-only" && tool.readOnly === false) {
      refused.push({
        toolKey: tool.toolKey,
        riskClass,
        requiredPermission: tool.requiredPermission,
        reason: `this surface offers read tools only; ${tool.toolKey} writes`,
        disclosure: "not-permitted",
        safeReason:
          "The assistant here can only look things up. It cannot make changes from this surface.",
        remedy: { kind: "SURFACE_IS_READ_ONLY", toolKey: tool.toolKey },
      })
      continue
    }

    // 2. The tool's own permission.
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

    if (!permission.allowed) {
      refused.push({
        toolKey: tool.toolKey,
        riskClass,
        requiredPermission: tool.requiredPermission,
        reason: decision.detail,
        disclosure: "not-permitted",
        safeReason: `You do not have access to ${tool.module} here.`,
        remedy: {
          kind: "PERMISSION_NOT_HELD",
          requiredPermission: tool.requiredPermission,
          grantedByRoles: rolesGranting(tool.requiredPermission),
        },
      })
      continue
    }

    // 3. The owning domain's policy, for anything above a draft.
    if (riskExceeds(riskClass, "DRAFT")) {
      const domain = domainOf(tool.requiredPermission)
      const policy = owningPolicyPermission(domain)

      if (!policy) {
        refused.push({
          toolKey: tool.toolKey,
          riskClass,
          requiredPermission: tool.requiredPermission,
          reason:
            `a ${riskClass} action in the "${domain}" domain, which declares no administrative ` +
            `permission; refusing rather than offering it on the tool's own permission alone`,
          disclosure: "not-permitted",
          safeReason: `Changes to ${domain} need an approval step this system has not set up yet.`,
          remedy: { kind: "OWNING_POLICY_NOT_DECLARED", domain },
        })
        continue
      }

      const owning = decideCheck(world, {
        context,
        permission: policy,
        resourceType: "RelayTool",
        resourceId: null,
      })

      if (!owning.permission.allowed) {
        refused.push({
          toolKey: tool.toolKey,
          riskClass,
          requiredPermission: policy,
          reason:
            `a ${riskClass} action answers to the ${domain} policy as well as to its own ` +
            `permission, and "${policy}" is not held: ${owning.decision.detail}`,
          disclosure: "not-permitted",
          safeReason: `You do not have the ${domain} approval this needs.`,
          remedy: {
            kind: "PERMISSION_NOT_HELD",
            requiredPermission: policy,
            grantedByRoles: rolesGranting(policy),
          },
        })
        continue
      }
    }

    offered.push({ tool, decision: permission, riskClass })
  }

  return { offered, refused }
}

/**
 * Which of this system's tools this principal may be offered right now.
 *
 * `context` is the kernel's `TenantContext`, which is what makes the check a
 * `PermissionCheck` rather than four loose arguments: the tenant, the actor and
 * the instant all come from one validated value, so a check cannot be made for
 * one tenant's actor against another tenant's world.
 *
 * `allow` is required rather than defaulted. A surface that forgot to say what
 * it can safely run would otherwise get the permissive answer silently, and the
 * compiler would say nothing — which is exactly how a writing tool ends up on a
 * route that cannot confirm anything.
 */
export function authorizeRelayTools(
  ctx: UserContext,
  context: TenantContext,
  institutionSlug: string,
  allow: ToolPolicy,
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

  return authorizeRegistrations(world, context, tools, allow)
}

/** Whether a named tool survived authorization. The read-side predicate. */
export function toolOffered(set: RelayToolset, toolKey: string): boolean {
  return set.offered.some((o) => o.tool.toolKey === toolKey)
}

// ── the one door a proposal goes through ────────────────────────────────────

/**
 * WRK-GATE-020. Which way a granted connection carries data.
 *
 * The same three words `CapabilityDirection` uses in `@tenure/provisioning`,
 * deliberately: one vocabulary for one concept, so a pack declared engine-side
 * and a limit stated cell-side cannot disagree about what a grant permits. It is
 * re-declared rather than imported because a cell may not import the engine's
 * control plane, which is what `tests/security/cell-independence.test.mjs`
 * refuses and lists exactly one exemption for.
 */
export type GrantedDirection = "read" | "write" | "bidirectional"

/** What a model asks for: a tool by name, and arguments it chose. */
export interface ToolProposal {
  toolKey: string
  args: Record<string, unknown>
}

/** What the caller — not the model — has already decided. */
export interface RelayInvocationLimits {
  /**
   * The tools this surface can actually run.
   *
   * Required. "Offered" and "runnable here" are different sets: a surface that
   * accepted any offered tool would run whatever the catalog grows next,
   * because nothing would have said no.
   */
  executableToolKeys: readonly string[]
  /**
   * Recipients a person already chose. A proposal may name a subset and never
   * a new address. Absent means none, which refuses every recipient argument.
   */
  allowedRecipients?: readonly string[]
  /**
   * WRK-GATE-020. Which direction the granted connection actually carries.
   *
   * REQUIRED, not optional. `CapabilityDirection` has existed in
   * `packages/provisioning/src/connector-capability.ts:83` since the connector
   * packs landed and every pack carries one — but that package is engine-only
   * (`tests/security/cell-independence.test.mjs`) and nothing on the request
   * path ever read a direction, so a read grant and a write grant were
   * indistinguishable at this door. An optional field here would be the field
   * the one caller forgets: it compiles, every unit test that builds its own
   * fixture passes, and the grant stops meaning anything in production.
   */
  grantedDirection: GrantedDirection
  /**
   * WRK-GATE-020. The containers the grant selects — Bible §4.2's resource
   * selectors.
   *
   * REQUIRED, and empty means NONE, which refuses every argument naming a
   * folder, mailbox, channel, drive, site, board or repository. That is the
   * same honest shape `allowedRecipients: []` already uses, and it is what makes
   * §4.1's "never turn a user token into organization-wide data access by
   * iterating over discoverable resources" checkable rather than aspirational.
   */
  selectedResources: readonly string[]
}

/**
 * The arguments the tool actually runs with.
 *
 * `tenantId` and `actorId` are stamped from the validated `TenantContext` after
 * the proposal has been checked, so the identity the work happens under is the
 * request's, whatever the model wrote.
 */
export type ResolvedToolArgs = Record<string, unknown> & { tenantId: string; actorId: string }

export type RelayInvocation =
  | { ok: true; tool: ToolRegistration; riskClass: ActionRiskClass; args: ResolvedToolArgs }
  | { ok: false; refusal: RefusedTool }

/**
 * Arguments the caller decides and a model never may, lowercased for comparison
 * so `TenantId` is the same refusal as `tenantId`.
 *
 * Each one is a way to make an authorized call act somewhere else: a tenant, an
 * institution, a stored provider connection, a provider account, a credential,
 * or another person. They are refused rather than overwritten, because an
 * overwrite is a model asking for something and being told nothing.
 */
const CALLER_DECIDED_ARGUMENTS: readonly string[] = [
  "tenantid",
  "institutionid",
  "connectionid",
  "accountid",
  "apikey",
  "onbehalfof",
]

/** Arguments that address somebody outside the request. */
const RECIPIENT_ARGUMENTS: readonly string[] = ["to", "cc", "bcc", "recipients"]

/**
 * Arguments that name a CONTAINER — Bible §4.2's resource selectors, as the
 * argument names a proposal would actually use.
 *
 * Lowercased for comparison, so `folderId` and `FolderID` are the same refusal
 * as `folderid`, for the reason `CALLER_DECIDED_ARGUMENTS` gives: a check that
 * missed a capital letter would be a check on spelling.
 *
 * Drawn from §4.2's own list and no wider: mailboxes, folders and labels;
 * calendars; drives, sites and libraries; workspaces and channels; Notion
 * teamspaces and databases; projects, boards, queues and repositories. A name
 * earns a row here when it is a container somebody could be granted a subset of
 * — not every argument that happens to be a string.
 */
const RESOURCE_ARGUMENTS: readonly string[] = [
  "mailbox",
  "folder",
  "folderid",
  "folderpath",
  "label",
  "calendar",
  "calendarid",
  "drive",
  "driveid",
  "site",
  "siteid",
  "library",
  "workspace",
  "workspaceid",
  "channel",
  "channelid",
  "teamspace",
  "database",
  "databaseid",
  "project",
  "board",
  "queue",
  "repository",
  "repo",
  "container",
]

// ── WRK-050-001: what arguments a tool actually takes ───────────────────────

/** The scalar types a declared argument may be. */
export type ToolArgumentType = "string" | "number" | "boolean"

/** One tool's arguments, by name. */
export type ToolArgumentSchema = Record<string, ToolArgumentType>

/** Every tool's arguments, by `toolKey`. */
export type ToolArgumentSchemas = Record<string, ToolArgumentSchema>

/**
 * Arguments the platform declares for every tool, governed by their own gates
 * below rather than by a per-tool schema.
 *
 * `confirmationToken` is the human authorization and is checked by (e);
 * `to`/`cc`/`bcc`/`recipients` are addresses and are checked by (d), which also
 * type-checks them — they are string OR array-of-string, which is why they are
 * not expressible in the scalar schema above. Listing them here is what stops
 * the allow-list from refusing the platform's own vocabulary.
 */
const PLATFORM_ARGUMENTS: readonly string[] = ["confirmationToken", ...RECIPIENT_ARGUMENTS]

/**
 * What each registered tool takes.
 *
 * **This belongs on `ToolRegistration`.** `packages/contracts/src/index.ts`
 * declares `toolKey`, `module`, `description`, `requiredPermission`, `readOnly`
 * and `reauthorizesPerCall` and carries no schema field, so a registration
 * cannot state its own arguments and this table is the nearest honest thing: a
 * platform-side declaration, keyed by the same `toolKey` the registration uses,
 * checked at the one door. Moving it onto the contract is WRK-050-001's
 * remaining half and is a change to a package another run owns.
 *
 * One entry, because the catalog contributes one tool. `search.corpus` takes the
 * question to rank against and nothing else — `apps/web/src/app/api/ai/chat/
 * route.ts` derives the corpus from the actor and the tenant, both of which are
 * stamped from the context and refused if a proposal names them.
 *
 * A tool absent from this table cannot be invoked (gate (a″)). That direction is
 * the whole point: an undeclared registration is unusable rather than fully
 * permissive.
 */
export const TOOL_ARGUMENT_SCHEMAS: ToolArgumentSchemas = {
  "search.corpus": { query: "string" },
}

function proposalRefusal(
  toolKey: string,
  riskClass: ActionRiskClass | null,
  requiredPermission: string,
  rejected: string,
  reason: string,
  safeReason: string,
): RelayInvocation {
  return {
    ok: false,
    refusal: {
      toolKey,
      riskClass,
      requiredPermission,
      reason,
      disclosure: "not-permitted",
      safeReason,
      remedy: { kind: "PROPOSAL_NOT_ACCEPTED", rejected },
    },
  }
}

// ── WRK-050-002: the plan a confirmation is bound to ────────────────────────

/**
 * Which argument names §7.3's named plan fields are projected from.
 *
 * Every resolved argument lands in exactly one field of the plan — a named one
 * if it is on a list here, `args` otherwise — so the digest covers all of them
 * and none of them twice. That is what makes "a changed recipient, body,
 * permission, target … invalidates prior approval" true of arguments nobody
 * anticipated as well as of the ones the Bible names.
 */
const TARGET_ARGUMENTS: readonly string[] = ["target", "targetId", "resourceId", "id"]
const BODY_ARGUMENTS: readonly string[] = ["body", "message", "text", "content"]
const NOTIFY_ARGUMENTS: readonly string[] = ["notify", "notifies", "sendNotification"]
const PERMISSION_IMPACT_ARGUMENTS: readonly string[] = ["permissions", "grants", "revokes"]

const asStrings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value])
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v))

/**
 * The plan an invocation would carry out, derived from what will actually run.
 *
 * Derived, never accepted. A caller that could hand in a plan could confirm one
 * thing and execute another, which is the exact substitution §7.3 exists to
 * stop — so the tenant and the actor come from the validated context and every
 * other field comes from the resolved arguments themselves.
 *
 * `confirmationToken` is excluded because a confirmation cannot cover itself.
 */
export function planForInvocation(
  toolKey: string,
  context: TenantContext,
  args: Record<string, unknown>,
): ActionPlan {
  const recipients: string[] = []
  const permissionImpact: string[] = []
  let target: string | null = null
  let body: string | null = null
  let notifies = false
  const rest: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(args)) {
    if (key === "confirmationToken") continue
    if (RECIPIENT_ARGUMENTS.includes(key)) {
      recipients.push(...asStrings(value))
    } else if (TARGET_ARGUMENTS.includes(key)) {
      target = value === undefined || value === null ? target : String(value)
    } else if (BODY_ARGUMENTS.includes(key)) {
      body = value === undefined || value === null ? body : String(value)
    } else if (NOTIFY_ARGUMENTS.includes(key)) {
      notifies = notifies || value === true
    } else if (PERMISSION_IMPACT_ARGUMENTS.includes(key)) {
      permissionImpact.push(...asStrings(value))
    } else {
      rest[key] = value
    }
  }

  return {
    tenantId: context.tenantId,
    actorId: context.actorId,
    toolKey,
    target,
    recipients,
    body,
    notifies,
    permissionImpact,
    args: rest,
  }
}

/**
 * The digest of what this proposal would do, under this request's identity.
 *
 * Exported so a surface can show a person the plan and quote its digest beside
 * it, which is the first half of §7.3's preview.
 */
export function proposalDigest(proposal: ToolProposal, context: TenantContext): string {
  return planDigest(planForInvocation(proposal.toolKey, context, proposal.args))
}

/**
 * Mint a confirmation for exactly this proposal, under this identity.
 *
 * The counterpart `verifyConfirmation` is defined against, and — stated plainly
 * — with no production caller today, because minting is what a *person* does
 * and this platform has no writing Relay surface: `/api/ai/chat` declares
 * `read-only`. That is fail-closed and deliberate. A writing surface added
 * tomorrow gets no writes at all until it wires a human confirmation step
 * through here, which is the right way round.
 */
export function mintConfirmation(
  proposal: ToolProposal,
  context: TenantContext,
  options: { now?: number; ttlMs?: number; secret?: string } = {},
): string {
  const plan = planForInvocation(proposal.toolKey, context, proposal.args)
  const now = options.now ?? Date.parse(context.at)
  return issueConfirmation(plan, options.secret ?? confirmationSecret(), now, options.ttlMs)
}

/**
 * Whether a confirmation authorizes this exact proposal.
 *
 * `now` defaults to the request's own instant off the validated context rather
 * than to `Date.now()`, so expiry is decided against the same value every other
 * decision on this request was decided against.
 */
export function verifyConfirmation(
  token: unknown,
  proposal: ToolProposal,
  context: TenantContext,
  now: number = Date.parse(context.at),
  secret: string = confirmationSecret(),
): ConfirmationVerdict {
  const plan = planForInvocation(proposal.toolKey, context, proposal.args)
  return confirmationMatches(token, plan, context, now, secret)
}

/** What to tell the person, per reason. Never the engine's own words. */
const CONFIRMATION_SAFE_REASON: Record<string, string> = {
  MALFORMED: "Someone needs to confirm this before the assistant can do it.",
  WRONG_TENANT: "That confirmation was for another institution. Confirm this one again.",
  WRONG_ACTOR: "That confirmation was somebody else's. It has to be confirmed by you.",
  EXPIRED: "That confirmation has expired. Check the details and confirm again.",
  PLAN_CHANGED: "This is not what was confirmed. Check the details and confirm again.",
}

/**
 * The single door between a model's proposal and anything that runs.
 *
 * Everything the model chose is either checked here or replaced here. It
 * cannot choose the tenant or the actor (both are stamped from the context and
 * naming either is a refusal), cannot choose a provider account or a
 * credential (same list — those come from process configuration), cannot name
 * a recipient the caller did not already allow, cannot run a writing tool
 * without a confirmation a person produced, and cannot run an operation this
 * surface did not say it can execute.
 *
 * Returns the refusal rather than throwing: every one of these is an answer to
 * give somebody, and an exception is an answer nobody sees.
 */
export function invokeRelayTool(
  set: RelayToolset,
  context: TenantContext,
  proposal: ToolProposal,
  limits: RelayInvocationLimits,
  /**
   * The argument declarations to check against. Defaults to the platform's own.
   *
   * The same seam, and for the same reason, as `authorizeRegistrations`: the
   * catalog contributes one tool, so a gate exercised only against `search.corpus`
   * is a gate exercised only against the case it does not fire on. The default
   * is the fail-closed production value, so a caller that says nothing gets the
   * strict answer — `apps/web/src/app/api/ai/chat/route.ts` passes nothing.
   */
  schemas: ToolArgumentSchemas = TOOL_ARGUMENT_SCHEMAS,
): RelayInvocation {
  const offered = set.offered.find((o) => o.tool.toolKey === proposal.toolKey)

  // (a) Not offered. Either it was refused above — in which case that refusal
  //     already carries the right disclosure and remedy — or no registration
  //     of that name exists in this system at all, which is the other true
  //     thing and must not be reported as the first.
  if (!offered) {
    const alreadyRefused = set.refused.find((r) => r.toolKey === proposal.toolKey)
    if (alreadyRefused) return { ok: false, refusal: alreadyRefused }

    // `moduleKey`, not `module`: the identifier `module` is reserved in this
    // app's lint rules (Next's `no-assign-module-variable`).
    const moduleKey = domainOf(proposal.toolKey)
    return {
      ok: false,
      refusal: {
        toolKey: proposal.toolKey,
        // Unknown: there is no registration to classify.
        riskClass: null,
        requiredPermission: "",
        reason: `no registration named "${proposal.toolKey}" is contributed by this system's modules`,
        disclosure: "not-in-this-system",
        safeReason: `${moduleKey} is not part of this system.`,
        remedy: { kind: "MODULE_NOT_INSTALLED", module: moduleKey },
      },
    }
  }

  const { tool, riskClass } = offered

  // (a″) Offered, and nobody has said what arguments it takes.
  //
  // Fail closed, and decided before the surface's own list for a reason: a tool
  // whose arguments are undeclared is not runnable ANYWHERE, and answering "not
  // here" would imply it runs somewhere else. Until this branch existed the
  // opposite was true — an undeclared tool was the fully permissive one, because
  // the door checked only the six names on `CALLER_DECIDED_ARGUMENTS` and passed
  // everything else through.
  const schema = Object.prototype.hasOwnProperty.call(schemas, proposal.toolKey)
    ? schemas[proposal.toolKey]
    : undefined
  if (!schema) {
    return proposalRefusal(
      tool.toolKey,
      riskClass,
      tool.requiredPermission,
      "toolKey",
      `"${proposal.toolKey}" declares no argument schema, so nothing can validate what it would be called with`,
      "That capability has not been set up for the assistant to use yet.",
    )
  }

  // (a′) Offered, but not something this surface runs.
  if (!limits.executableToolKeys.includes(proposal.toolKey)) {
    return proposalRefusal(
      tool.toolKey,
      riskClass,
      tool.requiredPermission,
      "toolKey",
      `"${proposal.toolKey}" is offered but this surface executes only [${limits.executableToolKeys.join(", ")}]`,
      "The assistant cannot do that here.",
    )
  }

  // (a‴) The direction the grant carries (WRK-GATE-020).
  //
  // A property of the GRANT, not of the arguments, so it is decided before any
  // of them are read. `readOnly === false` is the registration's own statement
  // that it changes something; a connection granted `read` carries no authority
  // to do that, whatever permission the requester holds and whatever the surface
  // would otherwise allow. Before this, a read grant and a write grant were the
  // same value here — `CapabilityDirection` existed only in the engine's
  // connector packs, which a cell may not import.
  if (tool.readOnly === false && limits.grantedDirection === "read") {
    return {
      ok: false,
      refusal: {
        toolKey: tool.toolKey,
        riskClass,
        requiredPermission: tool.requiredPermission,
        reason:
          `${tool.toolKey} writes, and this request runs under a "${limits.grantedDirection}" ` +
          `grant, which carries no write authority`,
        disclosure: "not-permitted",
        safeReason:
          "This connection was set up to read only, so the assistant cannot change anything " +
          "through it.",
        remedy: {
          kind: "GRANT_IS_READ_ONLY",
          grantedDirection: limits.grantedDirection,
          toolKey: tool.toolKey,
        },
      },
    }
  }

  // (b) The tenant, the provider account and the credential are the caller's.
  for (const key of Object.keys(proposal.args)) {
    if (CALLER_DECIDED_ARGUMENTS.includes(key.toLowerCase())) {
      return proposalRefusal(
        tool.toolKey,
        riskClass,
        tool.requiredPermission,
        key,
        `the proposal named "${key}", which is decided by the request and not by the model`,
        "The assistant tried to choose whose data to use. That is not something it decides.",
      )
    }
  }

  // (b′) Every container the proposal names is one the grant selects
  //      (WRK-GATE-020, Bible §4.2).
  //
  //      Above (c) for the same reason (d) sits above (e): "that folder is not
  //      one this connection selected" is a more specific and more portable
  //      answer than "this tool takes no argument called folder". The first is
  //      true of every tool on the grant, including the connector tools that
  //      WILL declare a `folder`; the second is an accident of today's one-tool
  //      catalog, and letting it answer first is how the specific refusal stops
  //      being said the moment a real connector lands.
  //
  //      §4.1: "Never turn a user token into organization-wide data access by
  //      iterating over discoverable resources." This is the line that refuses
  //      the iteration.
  const selected = new Set(limits.selectedResources)
  for (const key of Object.keys(proposal.args)) {
    // Live. This read `|| true`, which made the loop `continue` on every key and
    // switched the check off entirely: a proposal naming a resource the caller
    // never selected was accepted in full. `unknown` on `proposed` below was the
    // symptom — nothing downstream was reachable, so nothing was narrowed.
    if (!RESOURCE_ARGUMENTS.includes(key.toLowerCase())) continue
    const raw: unknown = proposal.args[key]
    const proposed: unknown[] = Array.isArray(raw) ? raw : [raw]
    const stray = proposed.find((v: unknown) => typeof v !== "string" || !selected.has(v))
    if (stray === undefined) continue
    return {
      ok: false,
      refusal: {
        toolKey: tool.toolKey,
        riskClass,
        requiredPermission: tool.requiredPermission,
        reason:
          `"${key}" named ${JSON.stringify(stray)}, which is outside the ` +
          `${limits.selectedResources.length} resource(s) this grant selects ` +
          `[${limits.selectedResources.join(", ")}]`,
        disclosure: "not-permitted",
        safeReason:
          limits.selectedResources.length === 0
            ? "This connection has no folders or channels selected, so the assistant cannot " +
              "reach into one."
            : "The assistant tried to use a folder or channel that was not part of this " +
              "connection.",
        remedy: {
          kind: "RESOURCE_NOT_SELECTED",
          argument: key,
          requested: typeof stray === "string" ? stray : JSON.stringify(stray),
          selected: limits.selectedResources,
        },
      },
    }
  }

  // (c) Every remaining argument is one the tool declared, at the type it
  //     declared. Deliberately BELOW (b): a proposal naming `tenantId` gets the
  //     refusal that says whose data a model does not choose, not a generic
  //     "unknown argument". Those are two different things to tell somebody and
  //     collapsing them is how the specific one stops being said.
  for (const [key, value] of Object.entries(proposal.args)) {
    // No `CALLER_DECIDED_ARGUMENTS` skip: (b) above returns on the first one, so
    // by here there are none left to skip and a guard for them would be a line
    // claiming a case that cannot occur.
    if (PLATFORM_ARGUMENTS.includes(key)) continue

    const declared = Object.prototype.hasOwnProperty.call(schema, key) ? schema[key] : undefined
    if (!declared) {
      return proposalRefusal(
        tool.toolKey,
        riskClass,
        tool.requiredPermission,
        key,
        `"${proposal.toolKey}" declares no argument named "${key}"`,
        "The assistant asked for something that tool does not take.",
      )
    }
    if (typeof value !== declared) {
      return proposalRefusal(
        tool.toolKey,
        riskClass,
        tool.requiredPermission,
        key,
        `"${key}" is declared ${declared} and the proposal sent ${Array.isArray(value) ? "array" : typeof value}`,
        "The assistant sent the wrong kind of value for that tool.",
      )
    }
  }

  // (d) A recipient the caller did not already allow is a new destination, and
  //     a model choosing a destination is how a summary becomes a disclosure.
  //
  //     Above (e) on purpose: "you sent this to somebody who was not on the
  //     list" is a more specific answer than "that is not what was confirmed",
  //     and the second is what a plan digest would say about the first.
  const allowedRecipients = new Set(limits.allowedRecipients ?? [])
  for (const key of RECIPIENT_ARGUMENTS) {
    if (!(key in proposal.args)) continue
    const raw = proposal.args[key]
    const proposed = Array.isArray(raw) ? raw : [raw]
    const stray = proposed.find((v) => typeof v !== "string" || !allowedRecipients.has(v))
    if (stray !== undefined) {
      return proposalRefusal(
        tool.toolKey,
        riskClass,
        tool.requiredPermission,
        key,
        `"${key}" named a recipient outside the set this request allows`,
        "The assistant tried to send this to somebody who was not on the list.",
      )
    }
  }

  // (e) A writing tool needs a person to have said yes to THIS thing.
  //
  //     Not a non-empty string. `verifyConfirmation` recomputes the plan from
  //     the arguments about to run and checks an HMAC bound to that plan's
  //     digest, to this tenant, to this actor and to an expiry — so a
  //     confirmation given for another plan, by another person, or five minutes
  //     ago refuses, and `reason` says which of those it was.
  if (tool.readOnly === false) {
    const verdict = verifyConfirmation(proposal.args.confirmationToken, proposal, context)
    if (!verdict.ok) {
      return proposalRefusal(
        tool.toolKey,
        riskClass,
        tool.requiredPermission,
        "confirmationToken",
        `${tool.toolKey} changes things and its confirmation was refused as ${verdict.reason}: ${verdict.detail}`,
        CONFIRMATION_SAFE_REASON[verdict.reason] ?? CONFIRMATION_SAFE_REASON.MALFORMED,
      )
    }
  }

  return {
    ok: true,
    tool,
    riskClass,
    // Stamped last, over the proposal, so the tenant and the actor the work
    // runs as are the request's own — and so a future argument name that means
    // "the tenant" cannot be smuggled past (b) and still change them.
    args: { ...proposal.args, tenantId: context.tenantId, actorId: context.actorId },
  }
}
