import { createHash } from "node:crypto"

import type { DecisionReceipt, Fact, SourceRevision } from "./evaluate"

/**
 * IER-070-011 — "Produce decision receipts with policy and source revisions but
 * no unnecessary raw PII."
 *
 * Bible §12.3: "'Why allowed?' and 'Why denied?' must be answerable without
 * exposing another person, hidden resource existence, protected attributes, or
 * raw source records." A receipt is the artefact that outlives the request: it
 * is stored, exported, attached to a ticket and read by somebody who was not
 * there. Every one of those is a place a raw source value should not arrive.
 *
 * The receipt `evaluate` produces is already built out of revisions rather than
 * values — `SourceRevision` carries which source said something and when, never
 * what it said. This module is the part that does not take that on trust:
 *
 *  - the subject is replaced by a **pseudonym bound to the policy version**, so
 *    two receipts about the same person under two policies cannot be joined by
 *    reading them, and one receipt cannot be reversed into an id;
 *  - the sealed structure is **scanned against the facts the decision actually
 *    read**, and any raw value that turns up anywhere in it is replaced and the
 *    path recorded.
 *
 * ## Why the scan reports what it could not check
 *
 * A scan that returns "no redactions" for a receipt sealed with no facts to
 * compare against is claiming a clean result it never looked for. `scanned`
 * therefore reports how many values were compared and how many were too short
 * to compare safely — a two-character status code appears inside unrelated
 * words, so matching on it would redact the receipt into uselessness and
 * "matched everything" is not a privacy guarantee either. An empty
 * `redactions` list next to `scanned.valuesCompared: 0` says "we could not
 * look"; next to a positive count it says "we looked and found nothing".
 */

/** Shorter than this and a value is a substring of ordinary text, not evidence of a leak. */
export const MIN_SCANNABLE_VALUE_LENGTH = 4

export const REDACTED = "[REDACTED]"

export interface ReceiptScanReport {
  /** Raw fact values long enough to be searched for. */
  valuesCompared: number
  /** Values that were present but too short to search for without matching noise. */
  valuesTooShortToCompare: number
  /** Whether the subject id was searched for. False only when it is empty. */
  subjectIdCompared: boolean
}

export interface SealedReceipt {
  policyId: string
  policyVersion: string
  policyDigest: string
  /** A pseudonym, not an id. See `subjectPseudonym`. */
  subjectRef: string
  evaluatedAt: string
  outcome: string
  reasonCodes: readonly string[]
  sourceRevisions: readonly SourceRevision[]
  /** Field paths whose text contained a raw value and was replaced. */
  redactions: readonly string[]
  scanned: ReceiptScanReport
}

/**
 * A stable, non-reversible reference to the subject, scoped to one policy version.
 *
 * Scoped deliberately: the same person under two policies gets two different
 * refs, so a pile of receipts cannot be correlated into a profile by anybody
 * who only has the receipts. Within one policy version the ref is stable, which
 * is what makes "this is the same subject as that other decision" answerable
 * for the case an operator actually needs — repeated denials of one person by
 * one policy.
 */
export function subjectPseudonym(policyDigest: string, subjectId: string): string {
  const hash = createHash("sha256").update(`${policyDigest} ${subjectId}`).digest("hex")
  return `prs_${hash.slice(0, 24)}`
}

/** The raw strings a decision's facts could have leaked into a receipt. */
function scannableValues(facts: readonly Fact[]): { long: string[]; short: number } {
  const long: string[] = []
  let short = 0
  for (const fact of facts) {
    if (fact.presence !== "PRESENT") continue
    const value = fact.value
    const texts =
      typeof value === "string"
        ? [value]
        : value !== null && typeof value === "object"
          ? [value.from, value.until ?? ""]
          : []
    for (const text of texts) {
      if (text.length === 0) continue
      if (text.length < MIN_SCANNABLE_VALUE_LENGTH) {
        short += 1
        continue
      }
      long.push(text)
    }
  }
  return { long, short }
}

function redactText(
  text: string,
  needles: readonly string[],
  path: string,
  redactions: string[],
): string {
  let out = text
  for (const needle of needles) {
    if (!out.includes(needle)) continue
    out = out.split(needle).join(REDACTED)
    redactions.push(path)
  }
  return out
}

/**
 * Turn a decision receipt into the form that may be stored, exported or shown.
 *
 * `facts` is required rather than optional because the scan is the point: a
 * caller that has the facts and does not pass them gets a report saying nothing
 * was compared, which is a visible gap rather than a silent pass.
 */
export function sealReceipt(receipt: DecisionReceipt, facts: readonly Fact[]): SealedReceipt {
  const { long: needles, short } = scannableValues(facts)
  const subjectNeedles =
    receipt.subjectId.length >= MIN_SCANNABLE_VALUE_LENGTH ? [receipt.subjectId] : []
  const all = [...needles, ...subjectNeedles]
  const redactions: string[] = []

  const reasonCodes = receipt.reasonCodes.map((code, index) =>
    redactText(code, all, `reasonCodes[${index}]`, redactions),
  )
  const sourceRevisions = receipt.sourceRevisions.map((revision, index) => ({
    attribute: redactText(revision.attribute, all, `sourceRevisions[${index}].attribute`, redactions),
    sourceId: redactText(revision.sourceId, all, `sourceRevisions[${index}].sourceId`, redactions),
    sourceRole: revision.sourceRole,
    observedAt: revision.observedAt,
    stale: revision.stale,
  }))

  return {
    policyId: receipt.policyId,
    policyVersion: receipt.policyVersion,
    policyDigest: receipt.policyDigest,
    subjectRef: subjectPseudonym(receipt.policyDigest, receipt.subjectId),
    evaluatedAt: receipt.evaluatedAt,
    outcome: receipt.outcome,
    reasonCodes,
    sourceRevisions,
    redactions,
    scanned: {
      valuesCompared: needles.length,
      valuesTooShortToCompare: short,
      subjectIdCompared: subjectNeedles.length > 0,
    },
  }
}

/**
 * Every raw value from `facts` that still appears in `value`, with its path.
 *
 * Exported so a test — or a caller that assembles a receipt some other way —
 * can assert the absence rather than assume it. It walks the structure instead
 * of stringifying it, because a JSON scan cannot say WHERE a leak is and the
 * path is the only part of the answer anybody can act on.
 */
export function findRawValues(
  value: unknown,
  facts: readonly Fact[],
  path = "$",
): readonly { path: string; value: string }[] {
  const { long: needles } = scannableValues(facts)
  const found: { path: string; value: string }[] = []
  const walk = (node: unknown, at: string): void => {
    if (typeof node === "string") {
      for (const needle of needles) {
        if (node.includes(needle)) found.push({ path: at, value: needle })
      }
      return
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${at}[${index}]`))
      return
    }
    if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        walk(child, `${at}.${key}`)
      }
    }
  }
  walk(value, path)
  return found
}
