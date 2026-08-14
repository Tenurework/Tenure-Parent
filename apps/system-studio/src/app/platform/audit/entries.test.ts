import { buildAuditRecord, verifyChain, type AuditRecord } from "@tenure/audit"

import {
  NO_FILTER,
  asOfLabel,
  chainVerdict,
  distinct,
  exclusionSentence,
  filterEntries,
  filterIsActive,
  mergeChains,
  optionsFor,
  parseEntryFilter,
  projectChain,
  shortDigest,
} from "./entries"

/**
 * The Evidence surface's decisions, tested where they can be reached.
 *
 * ## The records are real
 *
 * Nothing here hand-writes a `recordHash`. Every record is built by
 * `buildAuditRecord` and every verdict comes from `verifyChain`, so a tamper in
 * this file is a tamper the production verifier detects rather than a boolean
 * this file set. That matters most for the break-hiding test: the whole claim is
 * "the filter cannot hide a record the verifier flagged", and a flag this test
 * invented would prove nothing about the verifier.
 *
 * ## What is deliberately NOT here
 *
 * There is no fixture tenant, no sample organisation and no illustrative row
 * that could reach a screen. These records exist inside this file for the length
 * of one expectation; the page reads DynamoDB and nothing else. `CHAIN` is the
 * platform partition's real name because that is the chain the page enumerates
 * first, not because it stands in for a customer.
 */

const CHAIN = "PLATFORM"
const ACTOR = "operator@example.invalid"

/** A chain of `n` linked records, each hashed over the one before it. */
function chainOf(
  n: number,
  at: (i: number) => string = (i) => `2026-08-1${i}T09:00:00.000Z`,
  action: (i: number) => string = () => "audit.hold.place",
  actor: (i: number) => string = () => ACTOR,
): AuditRecord[] {
  const records: AuditRecord[] = []
  let previous: AuditRecord | null = null
  for (let i = 0; i < n; i++) {
    const record = buildAuditRecord({
      tenantId: CHAIN,
      actor: { principalId: actor(i) },
      action: action(i),
      resourceType: "Tenant",
      resourceId: `hold-${i}`,
      outcome: "ALLOW",
      reason: `Record ${i}`,
      metadata: {
        _phase: i % 2 === 0 ? "INTENT" : "OUTCOME",
        _target: `hold-${i}`,
        _detail: `Record ${i} detail`,
        // An OUTCOME row names the intent it closes, exactly as
        // `appendOutcome` writes it. Without `_resolves` in the fixture the
        // pairing this file asserts on would be one this file invented.
        ...(i % 2 === 0 ? {} : { _outcomeCode: "APPLIED", _resolves: i - 1 }),
      },
      traceId: `trace-${i}`,
      occurredAt: at(i),
      ...(previous ? { previous } : { sequence: 0, previousHash: null }),
    })
    records.push(record)
    previous = record
  }
  return records
}

/**
 * Edit a stored record behind the writer's back.
 *
 * Exactly what `tools/dev/tamper-audit-row.mjs` does to the real table in
 * `e2e/audit-chain.spec.ts`: change the content, leave the recorded hash alone.
 * The record then no longer hashes to what it says, which is `CONTENT_ALTERED`.
 */
function tamper(records: AuditRecord[], index: number): AuditRecord[] {
  const copy = [...records]
  copy[index] = { ...copy[index], reason: "edited after the fact" }
  return copy
}

describe("projectChain — who, what, against what, and how it ended", () => {
  it("names the actor, the action, the target and the outcome of every record", () => {
    const records = chainOf(2)
    const entries = projectChain(CHAIN, records, verifyChain(records))

    expect(entries).toHaveLength(2)
    const outcome = entries.find((e) => e.sequence === 1)!
    expect(outcome.actor).toBe(ACTOR)
    expect(outcome.action).toBe("audit.hold.place")
    expect(outcome.target).toBe("hold-1")
    expect(outcome.outcome).toBe("APPLIED")
    expect(outcome.outcomeKind).toBe("ALLOW")
    expect(outcome.chain).toBe(CHAIN)
    expect(outcome.digest).toBe(records[1].recordHash)
    expect(outcome.previousDigest).toBe(records[0].recordHash)
  })

  it("reports an intent with no outcome as OPEN, never as a success", () => {
    const records = chainOf(1)
    const [intent] = projectChain(CHAIN, records, verifyChain(records))
    // The record's own `outcome` field is ALLOW — the package will not build a
    // record without one — and reporting that would call every crashed act a
    // success.
    expect(records[0].outcome).toBe("ALLOW")
    expect(intent.outcomeKind).toBe("OPEN")
    expect(intent.outcome).toBe("OPEN")
    expect(intent.closedBy).toBeNull()
  })

  it("does not report a CLOSED intent as open — that would double every completed act", () => {
    const records = chainOf(2)
    const entries = projectChain(CHAIN, records, verifyChain(records))

    const intent = entries.find((e) => e.sequence === 0)!
    const outcome = entries.find((e) => e.sequence === 1)!

    expect(intent.outcomeKind).toBe("BEGUN")
    expect(intent.closedBy).toBe(1)
    expect(outcome.resolves).toBe(0)
    // Exactly one row on the page reports how this act ended.
    expect(entries.filter((e) => e.outcomeKind === "ALLOW")).toHaveLength(1)
    expect(entries.filter((e) => e.outcomeKind === "OPEN")).toHaveLength(0)
  })

  it("distinguishes an act that crashed from acts that completed", () => {
    // Three records: a closed pair, then an intent nothing ever closed.
    const records = chainOf(3)
    const entries = projectChain(CHAIN, records, verifyChain(records))

    expect(entries.find((e) => e.sequence === 0)!.outcomeKind).toBe("BEGUN")
    expect(entries.find((e) => e.sequence === 1)!.outcomeKind).toBe("ALLOW")
    expect(entries.find((e) => e.sequence === 2)!.outcomeKind).toBe("OPEN")
  })

  it("orders entries newest first", () => {
    const records = chainOf(3)
    const entries = projectChain(CHAIN, records, verifyChain(records))
    expect(entries.map((e) => e.sequence)).toEqual([2, 1, 0])
  })

  it("marks the record the verifier flagged, with the verifier's own reason", () => {
    const records = tamper(chainOf(4), 1)
    const verification = verifyChain(records)
    expect(verification.ok).toBe(false)

    const entries = projectChain(CHAIN, records, verification)
    expect(entries.find((e) => e.sequence === 1)!.broken).toBe("CONTENT_ALTERED")
    // Only the edited record. An edit that leaves `recordHash` alone does not
    // disturb the successor's link — which is precisely why per-record hashing
    // and chaining are two different checks, and why the page must not describe
    // one break as though it implicated its neighbours.
    expect(entries.find((e) => e.sequence === 0)!.broken).toBeNull()
    expect(entries.find((e) => e.sequence === 2)!.broken).toBeNull()
    expect(entries.find((e) => e.sequence === 3)!.broken).toBeNull()
  })

  it("marks the successor of a REMOVED record as a broken link", () => {
    // The half a per-record hash cannot answer: every surviving record still
    // hashes correctly, and only the link and the gap say anything happened.
    const full = chainOf(4)
    const records = [full[0], full[2], full[3]]
    const verification = verifyChain(records)
    expect(verification.gaps).toHaveLength(1)

    const entries = projectChain(CHAIN, records, verification)
    expect(entries.find((e) => e.sequence === 2)!.broken).toBe("BROKEN_LINK")
    expect(entries.find((e) => e.sequence === 0)!.broken).toBeNull()
  })

  it("merges chains into one newest-first trail", () => {
    const a = chainOf(2, (i) => `2026-08-0${i + 1}T09:00:00.000Z`)
    const b = chainOf(2, (i) => `2026-08-0${i + 3}T09:00:00.000Z`)
    const merged = mergeChains([
      projectChain("PLATFORM", a, verifyChain(a)),
      projectChain("PLATFORM", b, verifyChain(b)),
    ])
    expect(merged.map((e) => e.at)).toEqual([
      "2026-08-04T09:00:00.000Z",
      "2026-08-03T09:00:00.000Z",
      "2026-08-02T09:00:00.000Z",
      "2026-08-01T09:00:00.000Z",
    ])
  })
})

describe("filterEntries — a filter may never hide a break", () => {
  /** A four-record chain whose middle record was edited in the table. */
  function brokenTrail() {
    const records = tamper(
      chainOf(
        4,
        (i) => `2026-08-1${i}T09:00:00.000Z`,
        (i) => (i === 1 ? "tenant.compose" : "audit.hold.place"),
        (i) => (i === 1 ? "someone.else@example.invalid" : ACTOR),
      ),
      1,
    )
    return projectChain(CHAIN, records, verifyChain(records))
  }

  it("shows a broken entry the filter excludes, and says so", () => {
    const entries = brokenTrail()
    const broken = entries.filter((e) => e.broken !== null)
    expect(broken.length).toBeGreaterThan(0)

    // A filter that matches NONE of the broken entries: they were written by a
    // different actor and under a different action.
    const result = filterEntries(entries, { ...NO_FILTER, actor: ACTOR }, 100)

    expect(result.hiddenBroken).toBe(0)
    expect(result.shown.map((e) => e.key)).toEqual(expect.arrayContaining(broken.map((e) => e.key)))
    expect(result.forced.map((e) => e.sequence)).toContain(1)
    expect(exclusionSentence(result)).toContain("regardless of the filter")
  })

  it("shows a broken entry that a cap would otherwise push off the page", () => {
    const entries = brokenTrail()
    const result = filterEntries(entries, NO_FILTER, 1)

    expect(result.hiddenBroken).toBe(0)
    // The break is at sequence 1 of 4, so a newest-first page of one would not
    // have reached it. The cap gives way to the break, never the reverse.
    expect(result.shown.map((e) => e.sequence)).toContain(1)
    expect(result.shown.filter((e) => e.broken !== null)).toHaveLength(1)
    expect(exclusionSentence(result)).toContain("did not fit on this page")
  })

  it("counts what the filter excluded, split by cause", () => {
    const entries = brokenTrail()
    const result = filterEntries(entries, { ...NO_FILTER, action: "tenant.compose" }, 100)

    expect(result.total).toBe(4)
    expect(result.hiddenByFilter + result.hiddenByLimit + result.shown.length).toBe(result.total)
    expect(result.active).toBe(true)
    expect(exclusionSentence(result)).toContain("Filtered by action = tenant.compose")
  })

  it("says plainly when nothing is filtered", () => {
    const records = chainOf(3)
    const entries = projectChain(CHAIN, records, verifyChain(records))
    const result = filterEntries(entries, NO_FILTER, 100)

    expect(result.active).toBe(false)
    expect(result.hiddenByFilter).toBe(0)
    expect(result.hiddenByLimit).toBe(0)
    expect(exclusionSentence(result)).toBe(
      "No filter is applied. All 3 entries read from the ledger are listed.",
    )
  })

  it("keeps the newest entries when the cap bites and nothing is broken", () => {
    const records = chainOf(5)
    const entries = projectChain(CHAIN, records, verifyChain(records))
    const result = filterEntries(entries, NO_FILTER, 2)

    expect(result.shown.map((e) => e.sequence)).toEqual([4, 3])
    expect(result.hiddenByLimit).toBe(3)
    expect(result.hiddenBroken).toBe(0)
  })
})

describe("parseEntryFilter", () => {
  it("reads the four fields from the query string", () => {
    expect(parseEntryFilter({ chain: "PLATFORM", actor: "a@b.c", action: "x.y", outcome: "DENY" })).toEqual({
      chain: "PLATFORM",
      actor: "a@b.c",
      action: "x.y",
      outcome: "DENY",
    })
  })

  it("treats an unrecognised outcome as no filter, not as a filter matching nothing", () => {
    expect(parseEntryFilter({ outcome: "allowed" }).outcome).toBeNull()
    expect(filterIsActive(parseEntryFilter({ outcome: "allowed" }))).toBe(false)
  })

  it("ignores blank and repeated values", () => {
    expect(parseEntryFilter({ chain: "   ", actor: ["first", "second"] })).toEqual({
      chain: null,
      actor: "first",
      action: null,
      outcome: null,
    })
  })
})

describe("chainVerdict — an unread chain is never an intact one", () => {
  it("answers yes only when every attempted chain was read and verified", () => {
    const verdict = chainVerdict({ attempted: 3, readable: 3, written: 3, broken: 0, records: 42 })
    expect(verdict.proven).toBe(true)
    expect(verdict.tone).toBe("ok")
    expect(verdict.word).toBe("intact")
    expect(verdict.headline).toContain("42 records")
  })

  it("refuses to say intact when a chain could not be read", () => {
    const verdict = chainVerdict({ attempted: 4, readable: 3, written: 3, broken: 0, records: 42 })
    expect(verdict.proven).toBe(false)
    expect(verdict.tone).not.toBe("ok")
    expect(verdict.word).toBe("1 unreadable")
    expect(verdict.headline).toContain("could not be read")
  })

  it("reports a break even when chains are also unreadable — the worse fact wins", () => {
    const verdict = chainVerdict({ attempted: 4, readable: 3, written: 3, broken: 2, records: 42 })
    expect(verdict.tone).toBe("bad")
    expect(verdict.word).toBe("2 broken")
    expect(verdict.proven).toBe(false)
  })

  it("does not claim proof over an estate that has recorded nothing", () => {
    const verdict = chainVerdict({ attempted: 1, readable: 1, written: 0, broken: 0, records: 0 })
    expect(verdict.proven).toBe(false)
    expect(verdict.headline).toContain("Nothing has been recorded")
  })
})

describe("presentation helpers", () => {
  it("renders an instant an operator can quote, machine-independently", () => {
    expect(asOfLabel("2026-08-13T09:07:01.123Z")).toBe("2026-08-13 09:07 UTC")
  })

  it("shortens a digest without pretending to be the whole of it", () => {
    expect(shortDigest("sha256:0123456789abcdefdeadbeef")).toBe("0123456789ab…")
    expect(shortDigest(null)).toBe("none — head of the chain")
  })

  it("lists the distinct values a filter can offer", () => {
    const records = chainOf(3, undefined, (i) => (i === 1 ? "tenant.compose" : "audit.hold.place"))
    const entries = projectChain(CHAIN, records, verifyChain(records))
    expect(distinct(entries, (e) => e.action)).toEqual(["audit.hold.place", "tenant.compose"])
  })

  it("keeps an active filter value among the options even when no entry carries it", () => {
    // Otherwise the native select falls back to its first option and the control
    // reads "Anyone" while the page is filtering by somebody.
    expect(optionsFor(["b", "c"], "a")).toEqual(["a", "b", "c"])
    expect(optionsFor(["b", "c"], "b")).toEqual(["b", "c"])
    expect(optionsFor(["b", "c"], null)).toEqual(["b", "c"])
  })
})
