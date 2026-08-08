/**
 * STUDIO-010-001 — the account topology, declared as data so a live read has
 * something to be reconciled against.
 *
 * Without a declaration there is nothing to compare: `organizations:ListAccounts`
 * returns a list of names and ids, and "is that the right set of accounts" is a
 * question only a declared intent can answer. The twelve roles below are the
 * ones the control-plane Bible names; each carries the SCALE at which it stops
 * being optional, so a single-account pilot is reported as compliant rather than
 * as eleven findings nobody can act on.
 *
 * `requiredWhen` is a function of the estate's own scale, not a boolean, because
 * "you should have a separate log-archive account" is true of a regulated
 * multi-tenant fleet and false of a pilot with one ECS service — and a checklist
 * that is wrong for the estate in front of you is a checklist people mute.
 */

/** How big the estate is. Drives which account roles are required. */
export type EstateScale = "single-account-pilot" | "multi-account" | "regulated-multi-tenant"

export const ESTATE_SCALES: readonly EstateScale[] = [
  "single-account-pilot",
  "multi-account",
  "regulated-multi-tenant",
]

const ORDER: Record<EstateScale, number> = {
  "single-account-pilot": 0,
  "multi-account": 1,
  "regulated-multi-tenant": 2,
}

export interface AccountRole {
  key: string
  purpose: string
  /** The smallest scale at which this account must exist separately. */
  requiredFrom: EstateScale
}

export const ACCOUNT_ROLES: readonly AccountRole[] = [
  {
    key: "management",
    purpose:
      "Owns the Organization. Holds no day-to-day workload — an account that can attach an SCP must not also run the thing the SCP restrains.",
    requiredFrom: "multi-account",
  },
  {
    key: "log-archive",
    purpose: "Receives CloudTrail and Config delivery. Write-once for everyone else, including platform engineers.",
    requiredFrom: "multi-account",
  },
  {
    key: "security-tooling",
    purpose: "Security Hub, GuardDuty and Access Analyzer delegated administration; the aggregated findings view.",
    requiredFrom: "multi-account",
  },
  {
    key: "shared-services",
    purpose: "The engine itself, its registry, the artifact and image stores every cell pulls from.",
    requiredFrom: "multi-account",
  },
  {
    key: "network",
    purpose: "Transit gateway, resolver rules and the address plan cells attach to.",
    requiredFrom: "regulated-multi-tenant",
  },
  {
    key: "production-cell",
    purpose: "One account per production cell, so a blast radius is an account boundary rather than a tag.",
    requiredFrom: "multi-account",
  },
  {
    key: "staging-cell",
    purpose: "The same shape as a production cell, running the same release one step earlier.",
    requiredFrom: "multi-account",
  },
  {
    key: "development",
    purpose: "Where engineers build. Never holds tenant data, which is why it is a separate account rather than a VPC.",
    requiredFrom: "multi-account",
  },
  {
    key: "sandbox",
    purpose: "Detached experimentation with its own budget and no route to a tenant network.",
    requiredFrom: "regulated-multi-tenant",
  },
  {
    key: "backup-vault",
    purpose: "Holds copies of recovery points under a vault lock nobody in the workload account can release.",
    requiredFrom: "regulated-multi-tenant",
  },
  {
    key: "billing",
    purpose: "Cost and Usage Report delivery and budget ownership, separate from the account that spends.",
    requiredFrom: "regulated-multi-tenant",
  },
  {
    key: "audit-read-only",
    purpose: "The role an external auditor assumes. Read-only across the Organization, and used by nothing else.",
    requiredFrom: "regulated-multi-tenant",
  },
]

export function requiredAt(scale: EstateScale): readonly AccountRole[] {
  return ACCOUNT_ROLES.filter((r) => ORDER[r.requiredFrom] <= ORDER[scale])
}

export type TopologyVerdict =
  /** An account in the live read is tagged or named for this role. */
  | { role: AccountRole; state: "FILLED"; accountId: string; by: string }
  /** The role is required at this scale and nothing fills it. */
  | { role: AccountRole; state: "MISSING" }
  /** Not required at this scale. Reported so the list is complete, not as a finding. */
  | { role: AccountRole; state: "NOT_REQUIRED_AT_THIS_SCALE" }
  /** Single-account estate: this one account fills it, and that is the answer. */
  | { role: AccountRole; state: "SINGLE_ACCOUNT"; accountId: string }
  /** The Organization could not be read, so nothing can be said about the topology. */
  | { role: AccountRole; state: "UNKNOWN"; because: string }

export interface ObservedAccount {
  id: string
  name: string
  /** `tenure:account-role`, when the estate tags its accounts. */
  role?: string
}

/**
 * Reconcile the declared topology against what the Organization actually holds.
 *
 * `unknownBecause` is not an option that can be forgotten: when the caller could
 * not read the Organization it passes the reason, and EVERY row comes back
 * UNKNOWN. Reporting "missing" for an account you were not allowed to look for
 * is how an operator spends a morning creating accounts that already exist.
 */
export function reconcileTopology(input: {
  scale: EstateScale
  accounts: readonly ObservedAccount[]
  /** The account STS resolved, used for the single-account answer. */
  selfAccountId: string | null
  organizationInUse: boolean
  unknownBecause?: string
}): readonly TopologyVerdict[] {
  return ACCOUNT_ROLES.map((role): TopologyVerdict => {
    if (input.unknownBecause) return { role, state: "UNKNOWN", because: input.unknownBecause }

    if (!input.organizationInUse) {
      if (!input.selfAccountId) {
        return { role, state: "UNKNOWN", because: "no account id was resolved from sts:GetCallerIdentity" }
      }
      return { role, state: "SINGLE_ACCOUNT", accountId: input.selfAccountId }
    }

    const match = input.accounts.find(
      (a) => a.role?.trim().toLowerCase() === role.key || a.name.trim().toLowerCase() === role.key,
    )
    if (match) return { role, state: "FILLED", accountId: match.id, by: match.name }

    const required = ORDER[role.requiredFrom] <= ORDER[input.scale]
    return required ? { role, state: "MISSING" } : { role, state: "NOT_REQUIRED_AT_THIS_SCALE" }
  })
}
