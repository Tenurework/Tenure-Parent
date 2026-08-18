import crypto from "node:crypto"

/**
 * PAY-200-005 — which actions are high-risk, and what an evidence package for
 * one has to contain.
 *
 * Bible §22 enumerates what an audit event carries: "actor/service, tenant,
 * legal entity, seat, authority, session/step-up, command, amount/currency,
 * affected references, before/after state, policy/config version, approval
 * digest, provider request/event references, result, reason and evidence".
 * That is a long list, and the reason it is long is that each entry is the one
 * a different review asks for first.
 *
 * Two things this module refuses to do, both of which look like helpfulness:
 *
 *   1. **It does not omit an absent field.** A package that simply leaves out
 *      what it was not given is indistinguishable from one where the field did
 *      not apply, and the two are different answers. Every field of the class's
 *      requirement appears, and one that was not supplied appears as `null`
 *      with its name in `missing`. "We looked and there was none" and "nobody
 *      told us" are separated by `notApplicable`, which a caller states
 *      explicitly.
 *   2. **It does not classify from a list of the actions that exist today.**
 *      The classifier reads the action's own words, so `Payments.PayoutIssued`
 *      is money movement the day it is written rather than the day somebody
 *      remembers to add it to a constant. An action nobody can classify is
 *      `null` — not high-risk by default, because treating every routine read
 *      as high-risk produces a package on every row and teaches readers to
 *      ignore them.
 */

export const HIGH_RISK_CLASSES = [
  /** Money leaves, moves or is restated. */
  "money-movement",
  /** Where money goes changes: bank details, destination, recipient. */
  "beneficiary-change",
  /** Who may do any of the above changes. */
  "authority-change",
  /** The provider relationship: funds flow, capability, keys, webhooks. */
  "provider-configuration",
  /** Data leaves the tenant: an export, a filing, a support disclosure. */
  "data-disclosure",
  /** Something ends: a closure, an offboarding, a purge. */
  "lifecycle-destructive",
] as const

export type HighRiskClass = (typeof HIGH_RISK_CLASSES)[number]

/**
 * The words each class is recognised by, lower-cased and matched as substrings
 * of the action string.
 *
 * Substrings rather than exact names because the vocabulary in this repository
 * is `Domain.VerbNoun` — `Finance.PostLedger`, `Payments.FundsFlowConfigured`,
 * `Admin.member.remove` — and a rule keyed on the whole string would need one
 * entry per action, which is the list this comment says not to keep.
 *
 * Order matters: the first class whose words match wins, so the most consequential
 * reading of an ambiguous action is the one recorded. `Payments.PayoutDestinationChanged`
 * is a beneficiary change AND mentions a payout; the beneficiary reading is the
 * one a fraud review needs, so it is checked first.
 */
const CLASS_WORDS: Readonly<Record<HighRiskClass, readonly string[]>> = {
  "beneficiary-change": [
    "beneficiary",
    "bankaccount",
    "bankdetail",
    "destination",
    "payoutaccount",
    "recipientchanged",
  ],
  "money-movement": [
    "payout",
    "disburse",
    "refund",
    "transfer",
    "charge",
    "capture",
    "postledger",
    "reverseledger",
    "reimburs",
    "settlement",
    "topup",
    "adjustment",
  ],
  "authority-change": [
    "grant",
    "revoke",
    "delegat",
    "roleassign",
    "seatassign",
    "permission",
    "approvalthreshold",
    "impersonat",
  ],
  "provider-configuration": [
    "fundsflow",
    "capability",
    "connectedaccount",
    "webhook",
    "apikey",
    "keyrotat",
    "provider",
    "merchant",
  ],
  "data-disclosure": ["export", "download", "taxform", "disclos", "share", "supportaccess"],
  "lifecycle-destructive": ["purge", "delete", "close", "offboard", "terminate", "destroy"],
}

/**
 * The order the classes are tried in, which is not their declaration order.
 *
 * `HIGH_RISK_CLASSES` reads as a list for a person; this is the tie-break for
 * an action whose words belong to two classes. Separate constants because
 * reordering a documentation list must not silently change how an action is
 * classified — and because a class added to one and forgotten in the other is
 * caught by `high-risk-actions.test.ts`, which asserts they hold the same set.
 */
export const HIGH_RISK_CLASS_PRECEDENCE: readonly HighRiskClass[] = [
  "beneficiary-change",
  "money-movement",
  "authority-change",
  "provider-configuration",
  "data-disclosure",
  "lifecycle-destructive",
]

/**
 * Which class of high-risk this action is, or null.
 *
 * Case and punctuation are removed before matching so `Finance.PostLedger`,
 * `finance.post_ledger` and `FINANCE.POST-LEDGER` classify identically — three
 * spellings of one action must not produce three different audit behaviours.
 */
export function classifyHighRiskAction(action: string): HighRiskClass | null {
  if (typeof action !== "string") return null
  const normalized = action.toLowerCase().replace(/[^a-z]/g, "")
  if (!normalized) return null
  for (const klass of HIGH_RISK_CLASS_PRECEDENCE) {
    for (const word of CLASS_WORDS[klass]) {
      if (normalized.includes(word)) return klass
    }
  }
  return null
}

/** Whether this action needs an evidence package at all. */
export function isHighRiskAction(action: string): boolean {
  return classifyHighRiskAction(action) !== null
}

/** Bible §22's list, as field names. */
export const EVIDENCE_FIELDS = [
  "actor",
  "tenant",
  "legalEntity",
  "seat",
  "authority",
  "session",
  "command",
  "amountMinorUnits",
  "currency",
  "affectedReferences",
  "beforeAfterDigest",
  "policyRevision",
  "configRevision",
  "approvalDigest",
  "providerRequestRef",
  "providerEventRef",
  "result",
  "reason",
] as const

export type EvidenceField = (typeof EVIDENCE_FIELDS)[number]

/**
 * What each class must be able to show.
 *
 * Everything names its actor, its tenant, its command, its result and its
 * reason — a package that cannot say who did what, to which tenant, and how it
 * came out is not evidence of anything. Beyond that, each class adds what its
 * own review asks for, and nothing more: demanding a provider event reference
 * on an authority change would produce a `missing` entry on every one of them,
 * and a warning that is always on is a warning nobody reads.
 */
const ALWAYS: readonly EvidenceField[] = ["actor", "tenant", "command", "result", "reason"]

export const EVIDENCE_REQUIREMENTS: Readonly<Record<HighRiskClass, readonly EvidenceField[]>> = {
  "money-movement": [
    ...ALWAYS,
    "seat",
    "authority",
    "amountMinorUnits",
    "currency",
    "affectedReferences",
    "approvalDigest",
  ],
  "beneficiary-change": [
    ...ALWAYS,
    "seat",
    "authority",
    "beforeAfterDigest",
    "affectedReferences",
    "approvalDigest",
  ],
  "authority-change": [...ALWAYS, "seat", "authority", "beforeAfterDigest", "policyRevision"],
  "provider-configuration": [
    ...ALWAYS,
    "seat",
    "authority",
    "beforeAfterDigest",
    "configRevision",
    "approvalDigest",
  ],
  "data-disclosure": [...ALWAYS, "seat", "authority", "affectedReferences"],
  "lifecycle-destructive": [
    ...ALWAYS,
    "seat",
    "authority",
    "affectedReferences",
    "approvalDigest",
  ],
}

export type EvidenceValues = Partial<Record<EvidenceField, unknown>>

export interface EvidencePackageInput {
  action: string
  values: EvidenceValues
  /**
   * Fields this action has established do not apply, each with the sentence
   * saying why.
   *
   * Deliberately not a bare list of names: "no provider call was made" and "the
   * caller did not know" are the two answers this whole module exists to keep
   * apart, and only one of them is worth writing down.
   */
  notApplicable?: Readonly<Partial<Record<EvidenceField, string>>>
}

export interface EvidencePackage {
  version: 1
  action: string
  riskClass: HighRiskClass
  /** Every field of the class's requirement, present or `null`. */
  fields: Record<string, unknown>
  /** Fields that were required, not supplied, and not declared inapplicable. */
  missing: readonly EvidenceField[]
  /** Fields declared inapplicable, with the reason given. */
  notApplicable: Readonly<Record<string, string>>
  /** Whether every required field is either present or accounted for. */
  complete: boolean
  digest: string
}

/** Insertion-order-independent JSON, so a digest is a property of the values. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`
}

/**
 * Assemble the package, or refuse because the action is not high-risk.
 *
 * Returns `null` for an action no class claims. A package on a routine read
 * would be noise, and noise in an evidence trail is how the packages that
 * matter stop being looked at.
 *
 * A value that is present but empty — `""`, `[]`, `null` — counts as MISSING.
 * A caller that passes `reason: ""` has not given a reason, and a package that
 * recorded it as supplied would report itself complete on the strength of an
 * empty string.
 */
export function buildEvidencePackage(input: EvidencePackageInput): EvidencePackage | null {
  const riskClass = classifyHighRiskAction(input.action)
  if (!riskClass) return null

  const required = EVIDENCE_REQUIREMENTS[riskClass]
  const notApplicable: Record<string, string> = {}
  for (const [field, why] of Object.entries(input.notApplicable ?? {})) {
    if (typeof why === "string" && why.trim().length > 0) notApplicable[field] = why
  }

  const fields: Record<string, unknown> = {}
  const missing: EvidenceField[] = []

  for (const field of required) {
    const value = input.values[field]
    const supplied =
      value !== undefined &&
      value !== null &&
      !(typeof value === "string" && value.trim() === "") &&
      !(Array.isArray(value) && value.length === 0)

    fields[field] = supplied ? value : null
    if (!supplied && !(field in notApplicable)) missing.push(field)
  }

  // Fields outside the requirement that the caller supplied anyway are kept:
  // an approval digest on a data disclosure is not required, and throwing it
  // away because a table did not ask for it loses evidence somebody chose to
  // record.
  for (const field of EVIDENCE_FIELDS) {
    if (field in fields) continue
    const value = input.values[field]
    if (value !== undefined && value !== null) fields[field] = value
  }

  const body = { version: 1, action: input.action, riskClass, fields, missing, notApplicable }
  return {
    ...body,
    version: 1,
    complete: missing.length === 0,
    digest: `sha256:${crypto.createHash("sha256").update(canonical(body)).digest("hex")}`,
  }
}

/**
 * Recompute a package's digest from its own contents.
 *
 * The audit chain already makes the row immutable; this is the narrower check a
 * reader can run on the package alone — after an export, after a copy into an
 * incident document — without the chain beside it.
 */
export function evidenceDigestMatches(pkg: EvidencePackage): boolean {
  const body = {
    version: pkg.version,
    action: pkg.action,
    riskClass: pkg.riskClass,
    fields: pkg.fields,
    missing: pkg.missing,
    notApplicable: pkg.notApplicable,
  }
  return pkg.digest === `sha256:${crypto.createHash("sha256").update(canonical(body)).digest("hex")}`
}
