/**
 * TTES-030-005 / WRK-030-004 / WRK-110-001 — the outcomes a capability's
 * connection state can have, the one user-facing path each of them earns, and
 * the single word a person is shown for it.
 *
 * The Bible's rule this encodes, and the reason it is a function rather than a
 * set of booleans read at each call site: a capability that is not certified
 * must NEVER produce a connect action. Offering "Connect" for something the
 * platform has not certified teaches people that the button is the answer, and
 * the button cannot work — it is the same failure as offering a retry for a
 * permission denial. The rule is written down once, here, so a new surface
 * cannot re-derive it wrong.
 *
 * ## Scope, stated honestly
 *
 * This resolves the OBSERVABLE state of a capability. It does not model a
 * provider connection record: `Connection` and `ConnectionOpportunity`
 * (WRK-010-001) exist in no package and no migration in this repository, so
 * anything here claiming a live third-party connection would be a canned
 * value. What it does resolve is real: whether the capability is certified for
 * this deployment at all, whether it is configured, whether the credential
 * behind it has expired, whether the scopes it was granted cover the scopes it
 * needs, and — when it is not usable — whether the person looking at it is the
 * one who can fix it.
 *
 * ## WRK-030-004 names nine paths. Six are here; three are refused, and why
 *
 * Here, and each with a PRODUCER — a live surface that emits it from state this
 * deployment genuinely holds: user connect, ask-admin, unavailable (all three
 * from `app/(app)/settings/page.tsx`), scope upgrade and reauth (the single
 * sign-on row on the same page, from the identity connection's own credential
 * reference and granted scopes), and — as a field on the resolution rather than
 * an outcome — alternative-source.
 *
 * Refused, because an outcome with no producer is worse than an honest gap: it
 * compiles, it appears in the vocabulary, every reader assumes something emits
 * it, and nothing ever does.
 *
 *   * **provider-sign-up** and **request-integration** need a certified
 *     third-party provider to sign up with or to request, and this platform has
 *     certified none — `packages/provisioning/src/catalogs.ts` records every
 *     provider pack as `PLANNED` and the one shipped connector as uncertified.
 *   * **resource-selection** needs a capability that is connected AND has
 *     resources to point at. The only selectable-resource surface this
 *     deployment has is the ICS calendar feed, and that feed is `configured:
 *     false` for every account for a good reason (settings/page.tsx states it):
 *     the URL is stateless and Tenure holds no record that anybody subscribed,
 *     so nothing is connected to be pointed anywhere. It becomes producible the
 *     moment the consent receipt WRK-020-005 writes
 *     (`CalendarFeed.SelectorConsented`) is read back here — the receipt names
 *     the clubs the holder agreed to, and comparing that to the live scope is
 *     exactly "connected, and not everything available is included".
 *
 * ## This module is imported by a client component
 *
 * `src/components/connections/MissingConnectionCard.tsx` is `"use client"`, so
 * nothing here may reach a package that imports `node:` builtins. That is why
 * the credential-expiry VERDICT arrives on the state instead of being computed
 * here from a timestamp — see `CapabilityCredential`.
 *
 * It is also why `rolesGranting` lives in `@/lib/authz/roles-granting` rather
 * than in `relay-tools.ts` where it was written: the rule is needed on both
 * sides of that boundary and `relay-tools.ts` reaches `node:crypto`. One
 * implementation, imported twice — see `CapabilityAdministrators`.
 */

import {
  RELAY_ANTHROPIC_REVIEW,
  RELAY_ANTHROPIC_SCOPES,
  providerActivation,
  type ProviderReview,
} from "@tenure/platform-config/provider-review"

import { rolesGranting } from "@/lib/authz/roles-granting"

export type ConnectionOutcome =
  /** Configured and usable right now. */
  | "CONNECTED"
  /** Not connected, and this person can connect it themselves. */
  | "NEEDS_USER_CONNECT"
  /** Not connected, and only an administrator can change that. */
  | "NEEDS_ADMIN"
  /**
   * Connected, but the grant it holds does not cover the scopes the capability
   * needs. The same subset test `providerActivation`
   * (packages/platform-config/src/provider-review.ts:162-173) applies to the
   * VENDOR's approved scopes, applied here to the grant this tenant made — one
   * rule, asked of two different authorities.
   */
  | "NEEDS_SCOPE_UPGRADE"
  /** Connected, and the credential behind it has expired. */
  | "NEEDS_REAUTH"
  /** The platform has not certified this capability, so there is nothing to connect. */
  | "NOT_CERTIFIED"
  /** Certified and configured, but unreachable from this cell / partition. */
  | "UNAVAILABLE"

/**
 * Bible §13.3's status vocabulary, exactly as written (line 809 of
 * `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`).
 *
 * These are the only words a tenant may be shown for a connection. The
 * Connection Center used to print `outcome === "CONNECTED" ? "Connected" :
 * "Not connected"`, which put "we have not certified this", "an administrator
 * must act" and "you can connect this yourself" behind one phrase — the exact
 * confusion §13.3 exists to remove.
 */
export type ConnectionStatusWord =
  | "Ready"
  | "Needs your attention"
  | "Waiting for admin"
  | "Limited"
  | "Temporarily unavailable"
  | "Disconnected"
  | "Not available yet"

/**
 * The total mapping. A `Record` over the outcome union rather than a `switch`
 * with a default: adding an outcome is then a compile error here, which is how
 * the ternary this replaces went wrong — a new outcome fell into "Not
 * connected" and nobody had to decide anything.
 */
const STATUS_WORDS: Record<ConnectionOutcome, ConnectionStatusWord> = {
  CONNECTED: "Ready",
  // Yours, and not connected. §13.3's "token/subscription revoked; no new
  // access" — from the person's side, a capability they hold that is not
  // currently connected reads the same whether it never was or no longer is.
  NEEDS_USER_CONNECT: "Disconnected",
  NEEDS_ADMIN: "Waiting for admin",
  // "read-only, partial resource, rate, region, or provider limitation" — a
  // grant that covers some of what the capability needs is working, partially.
  NEEDS_SCOPE_UPGRADE: "Limited",
  // "user reauth/resource choice required" — the reauth half; the resource half
  // has no producer here yet (see the header).
  NEEDS_REAUTH: "Needs your attention",
  NOT_CERTIFIED: "Not available yet",
  UNAVAILABLE: "Temporarily unavailable",
}

export function statusWord(outcome: ConnectionOutcome): ConnectionStatusWord {
  return STATUS_WORDS[outcome]
}

/**
 * A credential's expiry, and the verdict on it.
 *
 * `expired` is NEVER derived in this file. It is `connectionHealth`'s answer
 * (`@tenure/provisioning`), produced by `credentialExpiry()` in
 * `src/lib/auth-connections.ts` — the one module in this cell that holds that
 * dependency. Two reasons the verdict travels beside the timestamp rather than
 * being recomputed here:
 *
 *   1. This module is reachable from a client bundle (see the header), and the
 *      package that owns the rule imports `node:crypto`.
 *   2. A second expiry rule is how two surfaces come to disagree about whether
 *      a credential still works — which is the failure `connectionHealth`'s
 *      "unparseable expiry counts as expired" clause exists to prevent.
 *
 * The brand is what makes that structural rather than aspirational: the symbol
 * is not exported, so `credentialExpiry()` is the only function in the tree
 * that can mint one of these. A call site cannot hand-write
 * `{ expiresAt: "2020-01-01", expired: false }`.
 */
declare const CREDENTIAL_VERDICT: unique symbol

export interface CapabilityCredential {
  /** ISO timestamp, or null when the credential genuinely does not expire. */
  readonly expiresAt: string | null
  /** `connectionHealth`'s verdict. Never computed at a call site. */
  readonly expired: boolean
  readonly [CREDENTIAL_VERDICT]: true
}

/**
 * WRK-110-005 — who can actually clear a `NEEDS_ADMIN`, by role.
 *
 * "Ask an administrator" was a control pointing at nobody in particular. The
 * requirement's word for what it has to be is a *destination*, and a
 * destination that names a role has to name one that exists — so this is
 * resolved through `rolesGranting`, exactly as `invokeRelayTool` resolves
 * `grantedByRoles` for a `PERMISSION_NOT_HELD` remedy. One catalog, one rule,
 * two surfaces.
 *
 * Branded for the same reason `CapabilityCredential` is: the symbol is not
 * exported, so `capabilityAdministrators()` is the only function in the tree
 * that can mint one, and a call site cannot hand-write
 * `{ permission: "…", roles: ["the.finance.people"] }`. That is what makes "it
 * can never name a nonexistent role" structural rather than a convention.
 *
 * `roles` MAY be empty, and that is the interesting case rather than an error:
 * a capability whose governing permission no shipped template carries has no
 * administrator to ask, and `resolveCapability` refuses to offer the control
 * instead of pointing somebody at a person who cannot help.
 */
declare const ADMINISTRATOR_ROLES: unique symbol

export interface CapabilityAdministrators {
  /** The permission catalog key that governs connecting this capability. */
  readonly permission: string
  /** Shipped role-template keys carrying it. From `rolesGranting`, never written. */
  readonly roles: readonly string[]
  readonly [ADMINISTRATOR_ROLES]: true
}

export interface CapabilityState {
  /** Stable key, e.g. `ai.model`, `documents.storage`, `calendar.feed`. */
  key: string
  /** Plain-language name of what the capability lets someone do. */
  label: string
  /**
   * Whether the platform has certified this capability for tenant use. A false
   * here can never yield a connect action, whatever the other fields say.
   */
  certified: boolean
  /** Whether it is configured and usable in this deployment right now. */
  configured: boolean
  /**
   * Whether it is reachable from where this cell runs. Certified + configured
   * but not reachable is the partition case (`src/lib/ai.ts` aiConfigured()):
   * a key is set and the endpoint is outside the partition the operator chose.
   */
  reachable?: boolean
  /**
   * Whether connecting it is something the viewer can do from their own seat,
   * or something only an administrator can. Per-user feeds (an ICS
   * subscription) are the former; a tenant-wide model key is the latter.
   */
  connectableBy: "user" | "admin"

  // ── Required, so `tsc` names every construction site ─────────────────────
  //
  // Not optional. An optional field a caller does not set compiles, passes
  // every unit test (tests build their own fixtures), and produces the wrong
  // outcome only in production — which is exactly how a credential that had
  // expired came to render as CONNECTED.

  /** Scopes the grant behind this capability actually carries. */
  requiredScopes: readonly string[]
  /** Scopes the capability needs to do what its label promises. */
  grantedScopes: readonly string[]
  /** The credential behind it, with `connectionHealth`'s verdict. */
  credential: CapabilityCredential | null
  /**
   * Who can connect it when the viewer cannot, from `capabilityAdministrators`.
   * Null for a capability nobody has to be asked about — a per-user feed.
   */
  administrators: CapabilityAdministrators | null
  /**
   * WRK-030-004's alternative-source path: what still works without this, in
   * plain language, or null when nothing does. Carried on the resolution so
   * "there is nothing to connect" names a way forward instead of being a dead
   * end — the prose used to be hand-written beside each card and could
   * therefore contradict the outcome.
   */
  alternative: string | null
}

export interface ConnectionResolution {
  outcome: ConnectionOutcome
  /** The single control this card offers, or null when it must offer none. */
  action: {
    kind:
      | "connect"
      | "ask-admin"
      | "disconnect"
      | "reauthorize"
      | "upgrade-scope"
      | "none"
    label: string
  }
  /** Plain-language sentence: what this gives you, or why it is not available. */
  explanation: string
  /** Who owns it — named so "ask an administrator" is not a dead end. */
  owner: string
  /** §13.3's word for this outcome. The only status text a surface may print. */
  statusWord: ConnectionStatusWord
  /** What still works without it, or null when it is working. */
  alternative: string | null
  /** Scopes the capability needs and the grant does not carry. */
  missingScopes: readonly string[]
}

// ── WRK-030-005: `certified` is DERIVED, never asserted ─────────────────────

/**
 * The provider review that certifies a capability, or null.
 *
 * `certified` used to be the literal `true` at four call sites — three in
 * `app/(app)/settings/page.tsx` and one in `components/ai/TenureAIPanel.tsx` —
 * and for `ai.model` it was false. `RELAY_ANTHROPIC_REVIEW.state` is
 * `NOT_SUBMITTED` with `approvedScopes: []`, and
 * `app/api/ai/chat/route.ts` refuses every vendor call because of it. So with a
 * key set, the Connection Center said "Tenure AI model is connected and
 * working" about a capability the request path will not call. That is the
 * working-looking-but-uncertified surface WRK-030-005 forbids.
 *
 * The same record, read by both. `providerActivation` is the function the chat
 * route calls, imported from the same client-safe entry point, so the console,
 * the request path and this page cannot disagree — the moment somebody records
 * a real provider review, all three change together.
 */
function providerReviewFor(
  key: string,
): { scopes: readonly string[]; review: ProviderReview } | null {
  // A function rather than a module-level table, and that is load-bearing: a
  // `const` object would capture `RELAY_ANTHROPIC_REVIEW` once at import and
  // the verdict would be frozen for the life of the process. Read per call, the
  // record is the record — which is what lets a test flip the review to
  // APPROVED and watch the SURFACE change, rather than proving the resolver in
  // isolation.
  if (key === "ai.model") {
    return { scopes: RELAY_ANTHROPIC_SCOPES, review: RELAY_ANTHROPIC_REVIEW }
  }
  return null
}

/**
 * The capabilities Tenure serves from its own infrastructure.
 *
 * No third party has an opinion about these: the ICS feed is generated inside
 * this process from rows the requester can already read, and document storage
 * is the operator's own bucket. There is no provider review to look up and
 * inventing one would be as false as asserting the flag.
 *
 * A key in NEITHER list resolves to `certified: false`. Fail closed: a
 * capability nobody has classified is one nobody has certified, and the cost of
 * being wrong in the other direction is a Connect button that cannot work.
 */
const FIRST_PARTY: readonly string[] = [
  "documents.storage",
  "calendar.feed",
  // WRK-030-004. The cell's own OIDC connection, described by
  // `src/lib/auth-connections.ts` and validated by the identity registry before
  // `auth.ts` will register the provider. The identity PROVIDER is a third
  // party; this capability is Tenure's implementation of OIDC against whichever
  // one the tenant runs, and no provider review gates it — which is why it
  // belongs here rather than in PROVIDER_REVIEWED.
  "identity.sso",
]

/**
 * Whether this deployment has certified a capability, and the key it belongs to.
 *
 * Returned as a fragment to spread rather than a bare boolean so a call site
 * writes `...certifiedCapabilityState("ai.model")` and cannot pair one
 * capability's key with another's verdict.
 *
 * `at` is a parameter for the reason `providerActivation` takes one: "was this
 * activated when we shipped it" is a question an audit asks, and a gate that
 * reads the clock cannot answer it.
 */
export function certifiedCapabilityState(
  key: string,
  at: string = new Date().toISOString(),
): { key: string; certified: boolean } {
  const reviewed = providerReviewFor(key)
  if (reviewed) {
    return { key, certified: providerActivation(reviewed.scopes, reviewed.review, at).activated }
  }
  return { key, certified: FIRST_PARTY.includes(key) }
}

// ── WRK-110-005: "ask an administrator" names one that exists ───────────────

/**
 * The permission catalog key that governs connecting each capability.
 *
 * Catalog keys, not prose: `identity.connection.configure` is "Change how this
 * system federates identity" and `config.setting.update` is "Change a governed
 * configuration value at a layer you may write"
 * (`packages/authorization/src/permission-catalog.ts`). A capability absent from
 * this table has no administrator to ask, which is the honest answer for the
 * ICS feed — it is the viewer's own to connect and nobody else's to grant.
 */
const ADMIN_PERMISSION: Readonly<Record<string, string>> = {
  // Both are settings on the deployment, changed by whoever may change a
  // governed configuration value — which is what `config.setting.update` IS.
  "ai.model": "config.setting.update",
  "documents.storage": "config.setting.update",
  // Split out by the duties matrix rather than by taste: whoever decides which
  // identity provider is trusted holds `identity.connection.configure` and
  // deliberately NOT membership administration. Naming `config.setting.update`
  // here would send somebody to a role that cannot do it.
  "identity.sso": "identity.connection.configure",
}

/**
 * Whether anybody can be asked about a capability, and who.
 *
 * A fragment to spread beside `certifiedCapabilityState(key)`, for the same
 * reason that one is a fragment: a call site writes the key once per capability
 * and cannot pair one capability's key with another's answer.
 */
export function capabilityAdministrators(
  key: string,
): { administrators: CapabilityAdministrators | null } {
  const permission = ADMIN_PERMISSION[key]
  if (!permission) return { administrators: null }
  // Read per call, never at import: a role template that gains the permission
  // changes the answer on the next render rather than on the next deploy.
  return {
    administrators: {
      permission,
      roles: rolesGranting(permission),
    } as CapabilityAdministrators,
  }
}

/**
 * The owner sentence for something the viewer cannot fix themselves.
 *
 * Names the shipped roles when there are any, so "ask an administrator" has an
 * answer to "which one". `Your institution's administrators` on its own is the
 * dead end WRK-110-005 opened on: true, unactionable, and identical for every
 * capability whoever reads it might have to chase down.
 */
function adminOwner(state: CapabilityState): string {
  const roles = state.administrators?.roles ?? []
  if (roles.length === 0) return "Your Tenure operator"
  return `Your institution's administrators — anyone holding ${roles.join(" or ")}`
}

/** Who owns a fix, given whether the viewer can perform it. */
function ownerOf(state: CapabilityState): string {
  return state.connectableBy === "user" ? "You" : adminOwner(state)
}

/**
 * The scopes a grant is missing.
 *
 * The same shape `providerActivation` uses
 * (`packages/platform-config/src/provider-review.ts`): membership of the
 * granted set, not equality of the two lists, so a grant carrying MORE than is
 * needed is fine and one carrying less is named field by field.
 */
function missingScopesOf(state: CapabilityState): string[] {
  const granted = new Set(state.grantedScopes)
  return state.requiredScopes.filter((scope) => !granted.has(scope))
}

export function resolveCapability(state: CapabilityState): ConnectionResolution {
  const finish = (
    r: Omit<ConnectionResolution, "statusWord" | "alternative" | "missingScopes"> &
      Partial<Pick<ConnectionResolution, "missingScopes">>,
  ): ConnectionResolution => ({
    ...r,
    statusWord: statusWord(r.outcome),
    // Nothing to fall back to when the capability is working. Everywhere else
    // the alternative is the point.
    alternative: r.outcome === "CONNECTED" ? null : state.alternative,
    missingScopes: r.missingScopes ?? [],
  })

  // First, and unconditionally. A non-certified capability yields no connect
  // action regardless of who is asking or how it is configured — WRK-030-005.
  if (!state.certified) {
    return finish({
      outcome: "NOT_CERTIFIED",
      action: { kind: "none", label: "" },
      explanation: `${state.label} is not a certified connection on this platform, so there is nothing to connect. Nothing you do here will enable it.`,
      owner: "Tenure platform team",
    })
  }

  if (state.configured && state.reachable === false) {
    return finish({
      outcome: "UNAVAILABLE",
      // Not "connect": it IS connected. Retrying cannot move an endpoint into
      // a partition, exactly as retrying cannot grant a permission.
      action: { kind: "none", label: "" },
      explanation: `${state.label} is configured but cannot be reached from the region this workspace runs in. This is a deployment boundary, not a setting.`,
      owner: "Your Tenure operator",
    })
  }

  if (state.configured) {
    // Before the scope and resource questions, deliberately: an expired
    // credential cannot be asked for more scopes, and choosing resources under
    // one is choosing what will fail.
    if (state.credential?.expired) {
      return finish({
        outcome: "NEEDS_REAUTH",
        action: { kind: "reauthorize", label: `Reconnect ${state.label}` },
        explanation: `${state.label} was connected, and the credential behind it expired${
          state.credential.expiresAt ? ` on ${state.credential.expiresAt.slice(0, 10)}` : ""
        }. It has to be authorised again before it will work.`,
        owner: ownerOf(state),
      })
    }

    const missingScopes = missingScopesOf(state)
    if (missingScopes.length > 0) {
      return finish({
        outcome: "NEEDS_SCOPE_UPGRADE",
        action: { kind: "upgrade-scope", label: "Grant the missing permissions" },
        explanation: `${state.label} is connected, and the permissions it was granted do not cover ${missingScopes.join(
          ", ",
        )}. Until they are granted it works only for what it already has.`,
        owner: ownerOf(state),
        missingScopes,
      })
    }

    return finish({
      outcome: "CONNECTED",
      action: {
        kind: state.connectableBy === "user" ? "disconnect" : "none",
        label: state.connectableBy === "user" ? "Disconnect" : "",
      },
      explanation: `${state.label} is connected and working.`,
      owner: ownerOf(state),
    })
  }

  if (state.connectableBy === "user") {
    return finish({
      outcome: "NEEDS_USER_CONNECT",
      action: { kind: "connect", label: `Connect ${state.label}` },
      explanation: `${state.label} is not connected yet. You can connect it from your own settings.`,
      owner: "You",
    })
  }

  // WRK-110-005. The control exists only when there is somebody behind it.
  // A capability whose governing permission no shipped role template carries
  // has no administrator to ask, and offering "Ask an administrator" for it
  // teaches the same lesson a Connect button on an uncertified capability does:
  // that the button is the answer, when the button cannot work.
  const askable = (state.administrators?.roles ?? []).length > 0
  if (!askable) {
    return finish({
      outcome: "NEEDS_ADMIN",
      action: { kind: "none", label: "" },
      explanation: `${state.label} is not connected for this workspace, and no role this system grants can connect it. Your Tenure operator configures it directly.`,
      owner: adminOwner(state),
    })
  }

  return finish({
    outcome: "NEEDS_ADMIN",
    action: { kind: "ask-admin", label: "Ask an administrator" },
    explanation: `${state.label} is not connected for this workspace. Only an administrator can connect it.`,
    owner: adminOwner(state),
  })
}
