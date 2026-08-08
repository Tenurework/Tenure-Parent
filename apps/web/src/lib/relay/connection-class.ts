import {
  CONNECTION_CLASSES,
  isConnectionClass,
  type ConnectionClass,
} from "@tenure/platform-config"

import type { ActionRiskClass } from "@/lib/relay-tools"

/**
 * WRK-020-001 — what a connection of each Bible §4.1 class may reach, and the
 * refusal when a tool would exceed it.
 *
 * §4.1 names eight classes and requires that "connection class, provider
 * consent, and Tenure authorization must all agree". Two of the three were
 * represented in this codebase: Tenure authorization by `decideCheck` and
 * provider consent by `providerActivation`. The class was not represented at
 * all, so a webhook-only grant and an organization-wide application identity
 * were the same thing to every decision in the tree, and §4.1's "never turn a
 * user token into organization-wide data access" was unenforceable by
 * construction rather than by oversight.
 *
 * ## Why the risk ordering lives here
 *
 * `ActionRiskClass` is derived in `relay-tools.ts` from a registration's own
 * facts — that is where the classification belongs. The ORDER lives here
 * because this is the module that compares a class's ceiling against a risk,
 * and `relay-tools.ts` imports it back for `riskExceeds` so there is exactly one
 * ordering rather than two that drift. The type import above is `import type`
 * and is erased, so the runtime graph runs one way only: relay-tools →
 * connection-class.
 *
 * ## Why a refusal and not a boolean
 *
 * The whole point of a class is that it explains itself. "You may not" tells
 * nobody anything; "this capability is offered under a WEBHOOK_ONLY connection,
 * which reaches READ, and this tool is a WRITE — a WRITE needs at least a
 * SERVICE_ACCOUNT connection" tells an administrator exactly which of the three
 * agreements to go and change.
 */

/** The risk vocabulary's ordering, least to most consequential. */
export const RISK_ORDER = [
  "READ",
  "DRAFT",
  "WRITE",
  "BULK",
  "EXTERNAL_SHARE",
  "DELETE",
  "PRIVILEGED",
] as const

export { CONNECTION_CLASSES, isConnectionClass }
export type { ConnectionClass }

/** What one class may reach, and whether it may serve the tenant at all. */
export interface ClassAuthority {
  /** The most consequential act a connection of this class may reach. */
  maxRisk: ActionRiskClass
  /**
   * Whether this class may serve TENANT-WIDE use.
   *
   * §4.1 says `PERSONAL_PRODUCTIVITY` is "prohibited from tenant-wide use", and
   * every relay tool is tenant-wide by construction — `invokeRelayTool` stamps
   * `tenantId` from the validated context and the tool then reads whatever that
   * tenant's rows contain. So `false` here is a refusal of the class outright on
   * this path, not a narrower ceiling.
   */
  tenantWide: boolean
  /** Why the ceiling is where it is. Shown in the refusal, not only in review. */
  because: string
}

/**
 * The ceiling per class, stated exhaustively.
 *
 * A `Record` over `ConnectionClass` rather than a lookup with a default, so a
 * ninth class added to `@tenure/platform-config` is a compile error here instead
 * of a class that silently inherits somebody else's authority.
 */
export const CLASS_AUTHORITY: Record<ConnectionClass, ClassAuthority> = {
  USER_DELEGATED: {
    maxRisk: "DELETE",
    tenantWide: true,
    because:
      "acts as the consenting user and within their own provider and Tenure permissions, so it " +
      "reaches what that person reaches — but a domain-policy act (money, people, contracts, " +
      "safety) answers to a controller and not to the person holding the token",
  },
  ADMIN_DELEGATED: {
    maxRisk: "PRIVILEGED",
    tenantWide: true,
    because:
      "an administrator consented to selected organization capabilities and calls still act as a " +
      "named user, which is the one arrangement in which a privileged act has both an approver " +
      "and an actor",
  },
  APPLICATION_ORG_WIDE: {
    maxRisk: "DELETE",
    tenantWide: true,
    because:
      "a service or app identity reaching approved organization data may write, share and delete " +
      "inside its approved scope — and may not take a domain-policy act, because there is no " +
      "person in the loop to hold the domain's administrative permission",
  },
  BOT_OR_APP_INSTALLATION: {
    maxRisk: "EXTERNAL_SHARE",
    tenantWide: true,
    because:
      "a provider-native bot installed in selected workspaces posts and shares where it was " +
      "installed; deleting other people's records is not what an installation is for",
  },
  SERVICE_ACCOUNT: {
    maxRisk: "BULK",
    tenantWide: true,
    because:
      "a nonhuman account with documented ownership and rotation moves data in volume, which is " +
      "its purpose — and has no consenting party behind an external send or a deletion",
  },
  WEBHOOK_ONLY: {
    maxRisk: "READ",
    tenantWide: true,
    because:
      "§4.1's own words: inbound signed events WITHOUT general read or write authority. Anything " +
      "that changes state is authority this grant does not carry",
  },
  FILE_OR_FEED: {
    maxRisk: "BULK",
    tenantWide: true,
    because:
      "SFTP, object store, ICS and EDI exchanges are bulk transfers by nature and carry no " +
      "identity that could authorize an external send or a deletion",
  },
  PERSONAL_PRODUCTIVITY: {
    maxRisk: "DRAFT",
    tenantWide: false,
    because:
      "§4.1 prohibits a user-owned connection from tenant-wide use outright; drafting text back " +
      "to its own owner is the most it can do, and a relay tool is tenant-wide by construction",
  },
}

/** Whether a class's ceiling is below `risk`. */
function exceeds(risk: ActionRiskClass, ceiling: ActionRiskClass): boolean {
  return RISK_ORDER.indexOf(risk) > RISK_ORDER.indexOf(ceiling)
}

/**
 * The narrowest tenant-wide class that could reach `risk`, or null when none
 * can.
 *
 * Part of the refusal rather than a separate lookup: telling an administrator
 * that a WEBHOOK_ONLY connection cannot do this is half an answer, and the other
 * half is which class could. Iterated in `CONNECTION_CLASSES` order and filtered
 * to the lowest ceiling that covers, so the answer is deterministic and is the
 * least authority that would work rather than the first that would.
 */
export function leastClassFor(risk: ActionRiskClass): ConnectionClass | null {
  let best: ConnectionClass | null = null
  for (const candidate of CONNECTION_CLASSES) {
    const authority = CLASS_AUTHORITY[candidate]
    // Cannot carry it at all.
    if (!authority.tenantWide || exceeds(risk, authority.maxRisk)) continue
    // Keep the incumbent unless this candidate is STRICTLY narrower, so a tie
    // resolves to the first class §4.1 lists rather than the last.
    if (best !== null && !exceeds(CLASS_AUTHORITY[best].maxRisk, authority.maxRisk)) continue
    best = candidate
  }
  return best
}

export type EscalationVerdict =
  | { ok: true; grantedClass: ConnectionClass; ceiling: ActionRiskClass }
  | {
      ok: false
      /** What the connection is offered under. */
      grantedClass: ConnectionClass
      /** What the tool would do. */
      requestedRisk: ActionRiskClass
      /** The most the granted class reaches. */
      ceiling: ActionRiskClass
      /** The narrowest class that could, or null when the act is tenant-wide-forbidden. */
      requiredClass: ConnectionClass | null
      /** Why, naming both classes. For logs and for the person alike. */
      reason: string
    }

/**
 * Whether a tool of `requested` risk may run on a connection granted at
 * `granted`.
 *
 * Never a boolean: the refusal names the granted class, the risk, the ceiling
 * and the class that would carry it, because the person who has to act on this
 * is an administrator changing a grant and none of those four is optional to
 * that conversation.
 *
 * Its production caller is `authorizeRegistrations` in
 * `apps/web/src/lib/relay-tools.ts`, which consults it for every registration on
 * every `/api/ai/chat` request, before the surface ceiling and before any
 * permission is read — a class refusal is a statement about the connection
 * everywhere, and the surface's is a statement about one route.
 */
export function refuseEscalation(
  granted: ConnectionClass,
  requested: ActionRiskClass,
): EscalationVerdict {
  const authority = CLASS_AUTHORITY[granted]

  if (!authority.tenantWide) {
    return {
      ok: false,
      grantedClass: granted,
      requestedRisk: requested,
      ceiling: authority.maxRisk,
      requiredClass: leastClassFor(requested),
      reason:
        `this capability is offered under a ${granted} connection, and ${authority.because}. ` +
        `A relay tool acts for the whole tenant, so no risk class is reachable on it.`,
    }
  }

  if (exceeds(requested, authority.maxRisk)) {
    const required = leastClassFor(requested)
    return {
      ok: false,
      grantedClass: granted,
      requestedRisk: requested,
      ceiling: authority.maxRisk,
      requiredClass: required,
      reason:
        `this capability is offered under a ${granted} connection, which reaches ${authority.maxRisk} ` +
        `because ${authority.because}; the tool is a ${requested}. ` +
        (required
          ? `A ${requested} needs at least a ${required} connection.`
          : `No connection class this platform grants reaches ${requested}.`),
    }
  }

  return { ok: true, grantedClass: granted, ceiling: authority.maxRisk }
}
