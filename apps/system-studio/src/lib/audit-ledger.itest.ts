import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { verifyChain } from "@tenure/audit"

import {
  PLATFORM_PARTITION,
  appendIntent,
  appendOutcome,
  auditedAct,
  dynamoAuditLedger,
  readLedger,
  readRecordsFor,
  safeErrorOf,
} from "./audit-ledger"
import { AuditSequenceTaken, putAuditRow } from "./registry"

/**
 * STUDIO-110-005 / STUDIO-060-010 — the ledger against a real DynamoDB.
 *
 * Needs a container and a table:
 *
 *   docker run -d -p 8001:8000 amazon/dynamodb-local:2.5.2
 *   TENANT_TABLE=… AWS_ENDPOINT_URL_DYNAMODB=http://localhost:8001 \
 *     node tools/create-registry-table.mjs
 *   npm run test:isolation --workspace apps/web
 *
 * ## Why not a fake store
 *
 * Every property here is a property of DynamoDB rather than of TypeScript. That
 * a second writer cannot claim a sequence is `attribute_not_exists(sk)` being
 * evaluated by the database; a fake would agree with whatever this code did. And
 * the hash surviving a round trip is a property of the document client's
 * marshalling — a chain whose hash does not survive being stored is not a chain,
 * and no in-memory test can see that.
 *
 * ## The tamper comes from OUTSIDE the app
 *
 * `tools/dev/tamper-audit-row.mjs`, not a client built here: the Studio's IAM
 * policy denies it UpdateItem on `AUDIT#…` items, and `forbidden-clients` keeps
 * an empty exemption list for AWS clients under `apps/`. The attacker is not the
 * Studio, so the tamper must not be performed by it.
 */

const configured = !!process.env.TENANT_TABLE && !!process.env.AWS_ENDPOINT_URL_DYNAMODB

// A skip that says what is missing. A suite that quietly passes with no database
// is worse than none, because a requirement would cite it.
const describeWithDynamo = configured
  ? describe
  : describe.skip.bind(
      null,
      "SKIPPED — needs TENANT_TABLE and AWS_ENDPOINT_URL_DYNAMODB pointing at a local DynamoDB",
    ) as unknown as typeof describe

// Every case here is several round trips to a container. Jest's 5s default
// times them out on the SDK's first call alone, which reads as a failure of the
// ledger rather than of the budget.
// Two of them additionally spawn a node process to reach past the application
// into the table, and a cold `node` start on a loaded machine is seconds by
// itself.
jest.setTimeout(240_000)

const REPO_ROOT = path.resolve(__dirname, "../../../..")

const tool = (...args: string[]) =>
  execFileSync("node", ["tools/dev/tamper-audit-row.mjs", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
  })

/** A partition of this run's own, so a re-run never meets its own rows. */
const partition = () => `itest-${process.pid}-${Math.random().toString(36).slice(2, 8)}`

const actor = "itest-operator@tenure.example"

describeWithDynamo("the Studio audit ledger, against a real DynamoDB", () => {
  it("chains what it writes, and the chain survives the round trip", async () => {
    const subject = partition()
    const ledger = dynamoAuditLedger()

    for (const n of [1, 2, 3]) {
      await ledger.append({
        tenantId: subject,
        actor: { principalId: actor, role: "platform-super-admin" },
        action: "tenant.compose",
        resourceType: "Tenant",
        resourceId: subject,
        outcome: "ALLOW",
        reason: `record ${n}`,
        correlationId: `corr-${n}`,
        occurredAt: new Date(Date.UTC(2026, 7, n)).toISOString(),
      })
    }

    const records = await readRecordsFor(subject)
    expect(records.map((r) => r.sequence)).toEqual([0, 1, 2])
    expect(records[0].previousHash).toBeNull()
    expect(records[1].previousHash).toBe(records[0].recordHash)
    expect(records[2].previousHash).toBe(records[1].recordHash)

    // Read back out of the table and re-verified. This is the assertion that
    // fails if marshalling changes anything the hash covers.
    const verification = verifyChain(records)
    expect(verification.ok).toBe(true)
    expect(verification.checked).toBe(3)
    expect(verification.unchained).toBe(0)
    expect(verification.firstSequence[subject]).toBe(0)
  })

  it("reports a row edited in the table, at its sequence", async () => {
    const subject = partition()
    const ledger = dynamoAuditLedger()
    for (const n of [1, 2, 3]) {
      await ledger.append({
        tenantId: subject,
        actor: { principalId: actor },
        action: "tenant.advance",
        resourceType: "Tenant",
        outcome: n === 2 ? "DENY" : "ALLOW",
        reason: n === 2 ? "REFUSED_IRREVERSIBLE — the one somebody would want gone" : `step ${n}`,
        correlationId: `corr-${n}`,
        occurredAt: new Date(Date.UTC(2026, 7, n)).toISOString(),
      })
    }

    expect(verifyChain(await readRecordsFor(subject)).ok).toBe(true)

    // Softening the refusal, in the table, behind the application's back.
    //
    // The backup goes to the OS temp directory rather than into the repository:
    // `guards-do-not-write-into-the-tree` exists because a test that drops a
    // file into the source tree makes every tree-scanning guard beside it
    // intermittently wrong.
    const backup = path.join(os.tmpdir(), `tenure-audit-itest-${process.pid}.json`)
    tool("tamper", "--partition", subject, "--sequence", "1", "--backup", backup)

    const tampered = verifyChain(await readRecordsFor(subject))
    expect(tampered.ok).toBe(false)

    const altered = tampered.tampered.find((t) => t.reason === "CONTENT_ALTERED")
    expect(altered?.sequence).toBe(1)
    expect(altered?.expectedHash).not.toBe(altered?.actualHash)
    // The refusal that was softened is what the recomputation no longer matches.
    expect(altered?.detail).toContain("tenant.advance")

    // Nothing was REMOVED, so there is no gap and no broken link: the edited
    // row's recorded hash is untouched, so its successor still links to it
    // correctly. A tamper and a deletion are different findings, and reporting
    // one as the other would send an operator looking for the wrong thing.
    expect(tampered.gaps).toEqual([])
    expect(tampered.duplicates).toEqual([])
    expect(tampered.tampered.filter((t) => t.reason === "BROKEN_LINK")).toEqual([])

    // Restored, so the partition is intact if anything reads it again.
    tool("restore", "--backup", backup)
    fs.rmSync(backup, { force: true })
    expect(verifyChain(await readRecordsFor(subject)).ok).toBe(true)
  })

  it("reports a row DELETED from the table as a gap and a broken link", async () => {
    // The half a per-row hash cannot answer, and the whole reason the records
    // are chained rather than merely hashed. Every surviving row still hashes
    // correctly; only the sequence and the successor's `previousHash` say that
    // anything happened at all.
    const subject = partition()
    const ledger = dynamoAuditLedger()
    for (const n of [1, 2, 3]) {
      await ledger.append({
        tenantId: subject,
        actor: { principalId: actor },
        action: "tenant.advance",
        resourceType: "Tenant",
        outcome: "ALLOW",
        reason: `step ${n}`,
        correlationId: `corr-${n}`,
        occurredAt: new Date(Date.UTC(2026, 7, n)).toISOString(),
      })
    }

    const backup = path.join(os.tmpdir(), `tenure-audit-itest-del-${process.pid}.json`)
    tool("remove", "--partition", subject, "--sequence", "1", "--backup", backup)

    const cut = verifyChain(await readRecordsFor(subject))
    expect(cut.ok).toBe(false)
    expect(cut.gaps).toEqual([{ tenantId: subject, after: 0, before: 2, missing: 1 }])

    const link = cut.tampered.find((t) => t.reason === "BROKEN_LINK")
    expect(link?.sequence).toBe(2)
    expect(link?.detail).toContain("1 record(s) are missing")

    // Every SURVIVING row still hashes correctly — which is exactly why a
    // per-row hash alone would report this log as perfectly intact.
    expect(cut.tampered.filter((t) => t.reason === "CONTENT_ALTERED")).toEqual([])

    tool("restore", "--backup", backup)
    fs.rmSync(backup, { force: true })
    expect(verifyChain(await readRecordsFor(subject)).ok).toBe(true)
  })

  it("refuses a second writer claiming a sequence that is already written", async () => {
    // The condition that makes `previousHash` mean anything. Without it both
    // writers compute n+1, the second silently replaces the first, one act
    // disappears, and the chain still verifies perfectly.
    const subject = partition()
    const ledger = dynamoAuditLedger()
    const first = await ledger.append({
      tenantId: subject,
      actor: { principalId: actor },
      action: "tenant.compose",
      resourceType: "Tenant",
      outcome: "ALLOW",
      correlationId: "corr-1",
      occurredAt: "2026-08-01T00:00:00.000Z",
    })

    await expect(
      putAuditRow(subject, first.sequence as number, { partition: subject, record: { fake: true } }),
    ).rejects.toBeInstanceOf(AuditSequenceTaken)

    // The original survived, unaltered.
    const records = await readRecordsFor(subject)
    expect(records).toHaveLength(1)
    expect(records[0].recordHash).toBe(first.recordHash)
  })

  it("recovers from losing the race rather than dropping the record", async () => {
    // Two appends started against the same tail. Both read sequence 0 as the
    // last row, both build sequence 1, one loses the conditional put and must
    // re-read and take 2 — because a refusal that dropped the record would make
    // the condition a way of LOSING audit rows rather than protecting them.
    const subject = partition()
    const ledger = dynamoAuditLedger()
    await ledger.append({
      tenantId: subject,
      actor: { principalId: actor },
      action: "tenant.compose",
      resourceType: "Tenant",
      outcome: "ALLOW",
      correlationId: "corr-0",
      occurredAt: "2026-08-01T00:00:00.000Z",
    })

    const both = await Promise.all(
      [1, 2].map((n) =>
        ledger.append({
          tenantId: subject,
          actor: { principalId: actor },
          action: "tenant.advance",
          resourceType: "Tenant",
          outcome: "ALLOW",
          reason: `racer ${n}`,
          correlationId: `corr-race-${n}`,
          occurredAt: "2026-08-01T00:00:01.000Z",
        }),
      ),
    )

    expect(new Set(both.map((r) => r.sequence)).size).toBe(2)
    const records = await readRecordsFor(subject)
    expect(records.map((r) => r.sequence)).toEqual([0, 1, 2])
    expect(verifyChain(records).ok).toBe(true)
  })

  it("writes the intent BEFORE the act, and closes it when the act throws", async () => {
    const subject = partition()

    await expect(
      auditedAct(
        {
          subject,
          action: "configuration.publish",
          target: "revision 4",
          actor,
          at: "2026-08-01T00:00:00.000Z",
          detail: "Publishing the term label.",
        },
        async () => {
          // The act fails AFTER the intent must already exist. Asserted from
          // inside, because "the intent was written first" is an ordering claim
          // and checking it afterwards cannot tell first from second.
          const during = await readLedger(subject)
          expect(during).toHaveLength(1)
          expect(during[0].outcome).toBeNull()
          expect(during[0].detail).toBe("Publishing the term label.")
          throw new Error("the store refused the commit")
        },
        () => ({ outcome: "APPLIED", detail: "never reached" }),
      ),
    ).rejects.toThrow("the store refused the commit")

    const rows = await readLedger(subject)
    expect(rows).toHaveLength(2)
    expect(rows[0].outcome).toBeNull()
    expect(rows[1].outcome).toBe("FAILED")
    expect(rows[1].resolves).toBe(rows[0].seq)
    expect(rows[1].detail).toContain("the store refused the commit")

    // Still a chain. A failure path that wrote an unchained row would be the
    // one place the trail could be edited without detection.
    expect(verifyChain(await readRecordsFor(subject)).ok).toBe(true)
  })

  it("records a refusal as a DENY with the reason attached", async () => {
    const subject = partition()
    const intent = await appendIntent({
      subject,
      action: "tenant.advance",
      target: "ACTIVE -> PURGING",
      actor,
      at: "2026-08-01T00:00:00.000Z",
      detail: "Purge requested.",
    })
    await appendOutcome({
      subject,
      resolves: intent.seq,
      action: "tenant.advance",
      target: "ACTIVE -> PURGING",
      actor,
      at: "2026-08-01T00:00:05.000Z",
      outcome: "REFUSED_IRREVERSIBLE",
      detail: "This console does not perform irreversible AWS deletions.",
    })

    const records = await readRecordsFor(subject)
    expect(records[1].outcome).toBe("DENY")
    expect(records[1].reason).toContain("does not perform irreversible")

    const rows = await readLedger(subject)
    expect(rows[1].outcome).toBe("REFUSED_IRREVERSIBLE")
    expect(rows[1].previousDigest).toBe(rows[0].digest)
  })

  it("redacts a credential pasted into a detail, in a store that cannot be rewritten", async () => {
    // The reason redaction matters more here than anywhere else: an audit row
    // is written to storage the writer is denied UpdateItem and DeleteItem on,
    // so a secret that lands in one cannot be taken out again.
    const subject = partition()
    await appendIntent({
      subject,
      action: "tenant.advance",
      target: "DRAFT -> VALIDATING",
      actor,
      at: "2026-08-01T00:00:00.000Z",
      detail: "Rotating with sk_live_9f3kQ2mZpR7xVb0c before the move.",
    })

    const rows = await readLedger(subject)
    expect(rows[0].detail).not.toContain("sk_live_")
    expect(rows[0].detail).toBe("[redacted]")

    const records = await readRecordsFor(subject)
    expect(JSON.stringify(records)).not.toContain("sk_live_")
  })

  it("plans an expiry that a legal hold stops, and performs none of it", async () => {
    const subject = partition()
    const ledger = dynamoAuditLedger()
    for (const n of [1, 2, 3]) {
      await ledger.append({
        tenantId: subject,
        actor: { principalId: actor },
        action: n === 3 ? "configuration.publish" : "tenant.advance",
        resourceType: "Tenant",
        outcome: "ALLOW",
        reason: `record ${n}`,
        correlationId: `corr-${n}`,
        occurredAt: new Date(Date.UTC(2020, 0, n)).toISOString(),
      })
    }

    const previous = process.env.AUDIT_RETENTION_DAYS
    process.env.AUDIT_RETENTION_DAYS = "0"
    try {
      const asOf = "2026-08-07T00:00:00.000Z"

      // With nothing held, everything old is expirable — and the plan still
      // deletes nothing, which is the whole contract of `applyRetention`.
      const open = await ledger.plan(subject, asOf)
      expect(open.expire).toHaveLength(3)
      expect(open.heldBack).toHaveLength(0)
      expect(open.anchors[0].throughSequence).toBe(2)
      expect(await readRecordsFor(subject)).toHaveLength(3)

      // A hold scoped to the publication preserves it AND stops the cut there:
      // anything after a held record would be orphaned by a deletion it is not
      // allowed to have.
      await ledger.placeHold({
        id: `hold-${subject}`,
        tenantId: subject,
        reason: "Preservation order for the configuration change.",
        placedAt: "2026-01-01T00:00:00.000Z",
      })

      const held = await ledger.plan(subject, asOf)
      expect(held.expire).toHaveLength(0)
      expect(held.heldBack).toHaveLength(3)
      expect(held.heldBack[0].holds).toEqual([`hold-${subject}`])

      // Released, and the plan changes back. A hold that could not be lifted
      // would be a retention schedule nobody could ever run.
      await ledger.releaseHold(subject, `hold-${subject}`, "2026-02-01T00:00:00.000Z", actor)
      const lifted = await ledger.plan(subject, asOf)
      expect(lifted.heldBack).toHaveLength(0)
      expect(lifted.expire).toHaveLength(3)
      expect((await ledger.holds(subject))[0].releasedAt).toBe("2026-02-01T00:00:00.000Z")
    } finally {
      if (previous === undefined) delete process.env.AUDIT_RETENTION_DAYS
      else process.env.AUDIT_RETENTION_DAYS = previous
    }
  })

  it("names the platform chain for acts that belong to no tenant", async () => {
    // A denial by someone who is not an operator has no tenant to attribute it
    // to, and dropping it for that reason is how the one refusal an incident is
    // about goes unrecorded.
    expect(PLATFORM_PARTITION).toBe("PLATFORM")
    const before = (await readRecordsFor(PLATFORM_PARTITION)).length
    const intent = await appendIntent({
      subject: PLATFORM_PARTITION,
      action: "audit.hold.place",
      target: "itest",
      actor: "unauthenticated",
      at: new Date().toISOString(),
      detail: "An itest denial, recorded on the platform chain.",
    })
    await appendOutcome({
      subject: PLATFORM_PARTITION,
      resolves: intent.seq,
      action: "audit.hold.place",
      target: "itest",
      actor: "unauthenticated",
      at: new Date().toISOString(),
      outcome: "REFUSED_NOT_AN_OPERATOR",
      detail: "Refused: the caller is not on the operator allowlist.",
    })
    expect((await readRecordsFor(PLATFORM_PARTITION)).length).toBe(before + 2)
  })
})

describe("safe errors", () => {
  it("keeps a credential out of a row that cannot be deleted", () => {
    expect(safeErrorOf(new Error("connect failed for sk_live_9f3kQ2mZpR7xVb0c"))).not.toContain(
      "sk_live_",
    )
    expect(safeErrorOf(new TypeError("x is not a function"))).toBe(
      "TypeError: x is not a function",
    )
  })
})
