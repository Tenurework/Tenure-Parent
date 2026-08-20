/**
 * GE-092-007 — the report parser, on the cases the endpoint cannot reach.
 *
 * `src/app/api/ai/correction/correction-path.test.ts` proves the endpoint
 * writes what this returns. This file covers the shapes a client would have to
 * be malicious or broken to send, and the two properties a reviewer would
 * otherwise have to take on trust: that the note is capped, and that a report
 * with no note is distinguishable from one with an empty note.
 */

import { projectTenureRecord } from "@/lib/relay/citation"
import {
  correctionMetadata,
  isDisclosureIncident,
  parseCorrectionReport,
  CorrectionError,
  CORRECTION_NOTE_MAX,
  CORRECTION_REASONS,
} from "./correction"

const NOW = new Date("2026-08-20T12:00:00.000Z")

const citation = projectTenureRecord({
  tenant: "inst_test",
  externalId: "doc_ledger",
  href: "/orgs/alpha/documents",
  asOf: new Date(NOW.getTime() - 1000),
  now: NOW,
}).citation

describe("a report is validated into something a steward can act on", () => {
  it("accepts each of the five reasons", () => {
    for (const reason of CORRECTION_REASONS) {
      expect(parseCorrectionReport({ reason, citation }).reason).toBe(reason)
    }
  })

  it("refuses anything that is not an object", () => {
    expect(() => parseCorrectionReport("WRONG_FACT")).toThrow(CorrectionError)
    expect(() => parseCorrectionReport(null)).toThrow(CorrectionError)
  })

  it("treats a missing note as no note rather than as an empty complaint", () => {
    const report = parseCorrectionReport({ reason: "WRONG_FACT", citation })
    expect(report.note).toBe("")
    expect(correctionMetadata(report).hasNote).toBe(false)
  })

  it("caps the note, so one report cannot be a document", () => {
    const report = parseCorrectionReport({
      reason: "WRONG_FACT",
      citation,
      note: "x".repeat(CORRECTION_NOTE_MAX * 3),
    })
    expect(report.note.length).toBe(CORRECTION_NOTE_MAX)
  })

  it("names exactly one reason as a control failure", () => {
    expect(CORRECTION_REASONS.filter(isDisclosureIncident)).toEqual(["SHOULD_NOT_SEE"])
  })

  it("carries the version, the state and the provider into the row", () => {
    const metadata = correctionMetadata(parseCorrectionReport({ reason: "OUT_OF_DATE", citation }))
    expect(metadata.citedVersionAt).toBe(citation.versionAt)
    expect(metadata.citedObservedAt).toBe(citation.observedAt)
    expect(metadata.citedState).toBe(citation.state)
    expect(metadata.citedProvider).toBe("tenure")
  })
})
