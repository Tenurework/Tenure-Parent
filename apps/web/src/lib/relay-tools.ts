import {
  PERMISSIONS,
  ROLE_TEMPLATES,
  decideCheck,
  type AuthorizationWorld,
} from "@tenure/authorization"
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

const RISK_ORDER: readonly ActionRiskClass[] = [
  "READ",
  "DRAFT",
  "WRITE",
  "BULK",
  "EXTERNAL_SHARE",
  "DELETE",
  "PRIVILEGED",
]

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
 * Derived from `ROLE_TEMPLATES`, which is the same catalog `seat-world.ts:94`
 * hands the authorization engine, so the answer cannot name a role that does
 * not exist or miss one that was added.
 */
export function rolesGranting(permission: string): readonly string[] {
  return ROLE_TEMPLATES.filter((t) => t.permissions.includes(permission)).map((t) => t.key)
}

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
): RelayToolset {
  const offered: OfferedTool[] = []
  const refused: RefusedTool[] = []

  for (const tool of registrations) {
    const riskClass = riskOf(tool)

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

  // (c) A writing tool needs a person to have said yes to this specific thing.
  if (tool.readOnly === false) {
    const token = proposal.args.confirmationToken
    if (typeof token !== "string" || token.trim().length === 0) {
      return proposalRefusal(
        tool.toolKey,
        riskClass,
        tool.requiredPermission,
        "confirmationToken",
        `${tool.toolKey} changes things and the proposal carried no human confirmation`,
        "Someone needs to confirm this before the assistant can do it.",
      )
    }
  }

  // (d) A recipient the caller did not already allow is a new destination, and
  //     a model choosing a destination is how a summary becomes a disclosure.
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
