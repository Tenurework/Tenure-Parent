import { parseSourceCitation, type SourceCitation } from "@/lib/relay/citation"
import { sanitizeUntrustedText } from "@/lib/relay/untrusted-content"

/**
 * GE-092-007 — the fifth path: a person says the answer or the record is wrong,
 * and the system keeps it.
 *
 * The other four paths this requirement names are decisions the platform makes
 * about its own evidence — insufficient, conflicting, stale, inaccessible — and
 * `evidence-assembly.ts` computes all four. This one is the only path that
 * carries information the platform does not have: the reader knows something
 * the record does not say. Before this there was nowhere to put it. An answer
 * arrived with citations and no way to disagree with one, so the correction
 * that would have fixed the underlying record was a thing somebody said out
 * loud to their laptop.
 *
 * ## What a report has to be bound to
 *
 * A version, not a record. "The budget document is wrong" is unactionable six
 * weeks later when the document has been edited twice; "the budget document as
 * it stood at 2026-03-04T11:02:19.000Z is wrong" is a claim a steward can check
 * against a specific state. So the citation — §9.3's, the same value the answer
 * returned — is REQUIRED and is parsed by `parseSourceCitation` rather than
 * accepted as posted: a report bound to a citation the platform never emitted
 * is a report about a record that may not exist.
 *
 * ## Where a report is kept, and what that is not
 *
 * `recordAuditEvent`. A correction report is an actor asserting something about
 * a resource at a version, which is exactly the shape of an audit row, and the
 * audit table is append-only at the chokepoint (`lib/db.ts`), tenant-scoped,
 * hash-chained and already has a read surface at `/admin/audit`. So the report
 * is durable, attributable and reviewable from the day it is written, with no
 * migration.
 *
 * What it is NOT is a triage workflow. There is no assignee, no status, no
 * resolution and no queue, because those are columns and this repository's
 * schema is not this module's to change. That is stated here rather than
 * implied: a caller who believed a report was ASSIGNED to somebody would be
 * wrong, and the useful lie is the one that reads like a promise.
 */

export class CorrectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CorrectionError"
  }
}

/**
 * Why the reader says the answer is wrong.
 *
 * A closed set, because the point of the field is that a steward can COUNT it:
 * "eleven people said this document is out of date" is a work item, and eleven
 * paragraphs of free text is a reading exercise. The free-text note is beside
 * it, not instead of it.
 *
 * Each member is a genuinely different repair:
 *
 *   * `WRONG_FACT` — the record says something untrue. Someone edits the record.
 *   * `OUT_OF_DATE` — the record was true and is not. Someone refreshes it.
 *   * `SHOULD_NOT_SEE` — the reader believes they were shown something they
 *     should not have been. This is an access-control incident, not a content
 *     complaint, and collapsing it into `WRONG_FACT` would bury the one report
 *     in this list that is urgent.
 *   * `MISSING_SOURCE` — the answer omitted a record the reader knows exists.
 *     Retrieval, not content.
 *   * `UNSUPPORTED_ANSWER` — the cited source does not say what the answer
 *     claimed it says. A grounding failure, and the one that is about the model
 *     rather than about the records.
 */
export const CORRECTION_REASONS = [
  "WRONG_FACT",
  "OUT_OF_DATE",
  "SHOULD_NOT_SEE",
  "MISSING_SOURCE",
  "UNSUPPORTED_ANSWER",
] as const

export type CorrectionReason = (typeof CORRECTION_REASONS)[number]

/** The endpoint a client posts a report to. Named once so the two agree. */
export const CORRECTION_PATH = "/api/ai/correction"

/** The audit action a stored report carries, so `/admin/audit` can filter on it. */
export const CORRECTION_ACTION = "Relay.CorrectionReported"

/** The resource type a stored report is filed against. */
export const CORRECTION_RESOURCE_TYPE = "RelaySource"

/** How much free text a report may carry. */
export const CORRECTION_NOTE_MAX = 600

export interface CorrectionReport {
  reason: CorrectionReason
  /** The cited source this is about, at the exact version the answer showed. */
  citation: SourceCitation
  /** The reader's own words. Empty when they gave none. */
  note: string
}

function isReason(value: unknown): value is CorrectionReason {
  return typeof value === "string" && (CORRECTION_REASONS as readonly string[]).includes(value)
}

/**
 * A posted report, validated into the shape the ledger stores.
 *
 * Throws rather than returning a partial. A report that named no source, or a
 * reason nobody can act on, is not a smaller report — it is a row that will sit
 * in the audit trail forever saying that somebody was unhappy about something.
 *
 * The note goes through `sanitizeUntrustedText`, the same cleaner every other
 * piece of tenant text in this directory goes through, and for the same reason:
 * it is free text a person typed, it will be rendered on an admin page, and it
 * may later be read back to a model as context about a record. A hidden-text
 * payload in a correction note would be an injection into the one channel a
 * reviewer trusts most, because a human wrote it on purpose.
 */
export function parseCorrectionReport(value: unknown): CorrectionReport {
  if (typeof value !== "object" || value === null) {
    throw new CorrectionError("A correction report must be an object.")
  }
  const record = value as Record<string, unknown>
  if (!isReason(record.reason)) {
    throw new CorrectionError(
      `"${String(record.reason)}" is not a correction reason (${CORRECTION_REASONS.join(", ")}). ` +
        `A report nobody can act on is a row, not a repair.`,
    )
  }
  if (record.citation === undefined || record.citation === null) {
    throw new CorrectionError(
      "A correction report must name the source it is about, as the citation the answer returned. " +
        "A report bound to no version cannot be checked against the state that was shown.",
    )
  }
  // Parsed by the producer's own parser: an unparseable citation is a report
  // about a record this platform never cited.
  const citation = parseSourceCitation(record.citation)
  const rawNote = typeof record.note === "string" ? record.note : ""
  return {
    reason: record.reason,
    citation,
    note: sanitizeUntrustedText(rawNote, CORRECTION_NOTE_MAX),
  }
}

/**
 * The audit metadata one report becomes.
 *
 * Every field is either an enum member or a value the platform itself minted
 * (the citation, which came back through `parseSourceCitation`). The note is
 * the one free-text field and it has been cleaned. Nothing here is copied off
 * the request untouched.
 */
export function correctionMetadata(report: CorrectionReport): Record<string, unknown> {
  return {
    reason: report.reason,
    // The version the reader was actually looking at — not the record's current
    // state, which is what a steward would otherwise re-read and find fine.
    citedVersionAt: report.citation.versionAt,
    citedObservedAt: report.citation.observedAt,
    citedState: report.citation.state,
    citedProvider: report.citation.ref.provider,
    // Whether a person wrote anything, recorded separately from the text so a
    // count of "reports with a note" does not require reading the notes.
    hasNote: report.note.length > 0,
    note: report.note,
  }
}

/**
 * Whether a reason is an access-control incident rather than a content complaint.
 *
 * `SHOULD_NOT_SEE` is the one report in the set that says a control failed. It
 * is filed with `outcome: "DENY"` so it sorts with the refusals an auditor is
 * already looking for, rather than with the ordinary traffic — the same row,
 * findable by somebody who does not know this feature exists.
 */
export function isDisclosureIncident(reason: CorrectionReason): boolean {
  return reason === "SHOULD_NOT_SEE"
}
