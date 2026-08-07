/**
 * TTES-030-005 — the five outcomes a capability's connection state can have,
 * and the one user-facing path each of them earns.
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
 * provider connection record: `Connection`, `ConnectionOpportunity`,
 * `PendingActionIntent` and `ConnectionLaunchToken` (WRK-010-001 /
 * WRK-030-002) exist in no package and no migration in this repository, so
 * anything here claiming a live third-party connection would be a canned
 * value. What it does resolve is real: whether the capability is certified for
 * this deployment at all, whether it is configured, and — when it is not —
 * whether the person looking at it is the one who can fix it.
 */

export type ConnectionOutcome =
  /** Configured and usable right now. */
  | "CONNECTED"
  /** Not connected, and this person can connect it themselves. */
  | "NEEDS_USER_CONNECT"
  /** Not connected, and only an administrator can change that. */
  | "NEEDS_ADMIN"
  /** The platform has not certified this capability, so there is nothing to connect. */
  | "NOT_CERTIFIED"
  /** Certified and configured, but unreachable from this cell / partition. */
  | "UNAVAILABLE"

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
}

export interface ConnectionResolution {
  outcome: ConnectionOutcome
  /** The single control this card offers, or null when it must offer none. */
  action: { kind: "connect" | "ask-admin" | "disconnect" | "none"; label: string }
  /** Plain-language sentence: what this gives you, or why it is not available. */
  explanation: string
  /** Who owns it — named so "ask an administrator" is not a dead end. */
  owner: string
}

export function resolveCapability(state: CapabilityState): ConnectionResolution {
  // First, and unconditionally. A non-certified capability yields no connect
  // action regardless of who is asking or how it is configured — WRK-030-005.
  if (!state.certified) {
    return {
      outcome: "NOT_CERTIFIED",
      action: { kind: "none", label: "" },
      explanation: `${state.label} is not a certified connection on this platform, so there is nothing to connect. Nothing you do here will enable it.`,
      owner: "Tenure platform team",
    }
  }

  if (state.configured && state.reachable === false) {
    return {
      outcome: "UNAVAILABLE",
      // Not "connect": it IS connected. Retrying cannot move an endpoint into
      // a partition, exactly as retrying cannot grant a permission.
      action: { kind: "none", label: "" },
      explanation: `${state.label} is configured but cannot be reached from the region this workspace runs in. This is a deployment boundary, not a setting.`,
      owner: "Your Tenure operator",
    }
  }

  if (state.configured) {
    return {
      outcome: "CONNECTED",
      action: {
        kind: state.connectableBy === "user" ? "disconnect" : "none",
        label: state.connectableBy === "user" ? "Disconnect" : "",
      },
      explanation: `${state.label} is connected and working.`,
      owner: state.connectableBy === "user" ? "You" : "Your institution's administrators",
    }
  }

  if (state.connectableBy === "user") {
    return {
      outcome: "NEEDS_USER_CONNECT",
      action: { kind: "connect", label: `Connect ${state.label}` },
      explanation: `${state.label} is not connected yet. You can connect it from your own settings.`,
      owner: "You",
    }
  }

  return {
    outcome: "NEEDS_ADMIN",
    action: { kind: "ask-admin", label: "Ask an administrator" },
    explanation: `${state.label} is not connected for this workspace. Only an administrator can connect it.`,
    owner: "Your institution's administrators",
  }
}
