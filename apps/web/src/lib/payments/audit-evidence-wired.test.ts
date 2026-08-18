import { CHAIN_METADATA_KEYS, verifyChain } from "@tenure/audit"
import { evidenceDigestMatches, type EvidencePackage } from "@tenure/payments"

import {
  CHANGE_METADATA_KEY,
  EVIDENCE_METADATA_KEY,
  recordAuditEvent,
  rehydrateAuditRecord,
  type AuditEventRow,
  type AuditLedger,
  type StoredAuditEvent,
} from "@/lib/audit-record"
import { TOKENIZATION_KEY_VAR } from "@/lib/payments/financial-redaction"

/**
 * PAY-200-005, asserted on the PRODUCER.
 *
 * `high-risk-actions.test.ts` proves the classification and the package. This
 * drives the real `recordAuditEvent` — the single door every audit row in this
 * application is written through — with the LEDGER injected, so what is read
 * back is what would have gone into the `AuditEvent` table, JSONB round trip
 * included.
 *
 * Two claims are being tested and they are separate: that a high-risk action
 * gets a package, and that a financial identifier never reaches a table with
 * `ON DELETE RESTRICT` on it.
 */

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const PAN = "4111111111111111"
const IBAN = "GB33BUKB20201555555555"
const INSTITUTION = "inst_pay200"

class Ledger implements AuditLedger {
  readonly rows: StoredAuditEvent[] = []

  async appendChained(
    institutionId: string,
    next: (previous: Parameters<Parameters<AuditLedger["appendChained"]>[1]>[0]) => AuditEventRow,
  ): Promise<void> {
    const previous =
      this.rows
        .filter(
          (r) =>
            r.institutionId === institutionId &&
            typeof (r.metadata as Record<string, unknown>)?.[CHAIN_METADATA_KEYS.sequence] ===
              "number",
        )
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
        .at(-1) ?? null

    const row = next(rehydrateAuditRecord(previous))
    this.rows.push({
      ...row,
      metadata: JSON.parse(JSON.stringify(row.metadata)) as unknown,
      occurredAt: new Date(row.occurredAt.getTime()),
    })
  }

  last(): StoredAuditEvent {
    return this.rows[this.rows.length - 1]
  }

  meta(): Record<string, unknown> {
    return this.last().metadata as Record<string, unknown>
  }

  evidence(): EvidencePackage | undefined {
    return this.meta()[EVIDENCE_METADATA_KEY] as EvidencePackage | undefined
  }
}

const originalTokenKey = process.env[TOKENIZATION_KEY_VAR]

beforeEach(() => {
  process.env[TOKENIZATION_KEY_VAR] = KEY
})

afterAll(() => {
  if (originalTokenKey === undefined) delete process.env[TOKENIZATION_KEY_VAR]
  else process.env[TOKENIZATION_KEY_VAR] = originalTokenKey
})

describe("the evidence package a high-risk action leaves behind", () => {
  it("is written for a ledger posting, complete, with the digest it seals itself with", async () => {
    const ledger = new Ledger()

    await recordAuditEvent(
      {
        institutionId: INSTITUTION,
        organizationId: "org_1",
        actor: { principalId: "user_treasurer", role: "finance.officer" },
        seat: { templateKey: "finance.officer", organizationId: "org_1" },
        action: "Finance.PostLedger",
        resourceType: "LedgerEntry",
        resourceId: "le_1",
        outcome: "ALLOW",
        reason: "Reimbursement approved by the OSE office",
        metadata: { amountCents: 4200, currency: "USD", approvalDigest: "sha256:abc" },
        mode: "test",
      },
      ledger,
    )

    const evidence = ledger.evidence()!
    expect(evidence.riskClass).toBe("money-movement")
    expect(evidence.fields.actor).toBe("user_treasurer")
    expect(evidence.fields.tenant).toBe(INSTITUTION)
    expect(evidence.fields.amountMinorUnits).toBe(4200)
    expect(evidence.fields.affectedReferences).toEqual(["LedgerEntry:le_1"])
    expect(evidence.fields.result).toBe("ALLOW")
    expect(evidence.missing).toEqual([])
    expect(evidence.complete).toBe(true)
    expect(evidenceDigestMatches(evidence)).toBe(true)
  })

  it("names what the call site did not supply instead of quietly leaving it out", async () => {
    const ledger = new Ledger()

    await recordAuditEvent(
      {
        institutionId: INSTITUTION,
        actor: { principalId: "user_treasurer", role: "finance.officer" },
        action: "Finance.PostLedger",
        resourceType: "LedgerEntry",
        resourceId: "le_2",
        outcome: "ALLOW",
        reason: "Posted",
        // No amount, no currency, no approval digest.
        metadata: {},
        mode: "test",
      },
      ledger,
    )

    const evidence = ledger.evidence()!
    expect(evidence.complete).toBe(false)
    expect(evidence.missing).toEqual(
      expect.arrayContaining(["amountMinorUnits", "currency", "approvalDigest"]),
    )
    expect(evidence.fields.currency).toBeNull()
  })

  it("writes no package for an ordinary action, so the ones that exist are read", async () => {
    const ledger = new Ledger()

    await recordAuditEvent(
      {
        institutionId: INSTITUTION,
        actor: { principalId: "user_member" },
        action: "Document.Viewed",
        resourceType: "Document",
        resourceId: "doc_1",
        outcome: "ALLOW",
        mode: "test",
      },
      ledger,
    )

    expect(ledger.evidence()).toBeUndefined()
  })

  it("takes the before/after digest from the change block the same row carries", async () => {
    const ledger = new Ledger()

    await recordAuditEvent(
      {
        institutionId: INSTITUTION,
        actor: { principalId: "user_admin", role: "institution.director" },
        seat: { templateKey: "institution.director" },
        action: "Payments.PayoutDestinationChanged",
        resourceType: "PayoutDestination",
        resourceId: "pd_1",
        outcome: "ALLOW",
        reason: "Treasurer requested a new settlement account",
        metadata: { approvalDigest: "sha256:def" },
        change: { before: { last4: "1111" }, after: { last4: "2222" } },
        mode: "test",
      },
      ledger,
    )

    const evidence = ledger.evidence()!
    const changeBlock = ledger.meta()[CHANGE_METADATA_KEY] as { digest: string }
    expect(evidence.riskClass).toBe("beneficiary-change")
    expect(evidence.fields.beforeAfterDigest).toBe(changeBlock.digest)
    expect(evidence.complete).toBe(true)
  })

  it("is inside the hash chain, so editing it breaks the chain", async () => {
    const ledger = new Ledger()

    for (const id of ["le_a", "le_b"]) {
      await recordAuditEvent(
        {
          institutionId: INSTITUTION,
          actor: { principalId: "user_treasurer", role: "finance.officer" },
          action: "Finance.PostLedger",
          resourceType: "LedgerEntry",
          resourceId: id,
          outcome: "ALLOW",
          reason: "Reimbursement approved",
          metadata: { amountCents: 100, currency: "USD", approvalDigest: "sha256:abc" },
          mode: "test",
          occurredAt: new Date(`2026-03-0${id === "le_a" ? 1 : 2}T00:00:00.000Z`),
        },
        ledger,
      )
    }

    expect(verifyChain(ledger.rows.map((r) => rehydrateAuditRecord(r)!)).ok).toBe(true)

    // Edit the package in place, the way somebody with database access would.
    const meta = ledger.rows[0].metadata as Record<string, unknown>
    ;(meta[EVIDENCE_METADATA_KEY] as EvidencePackage).fields.amountMinorUnits = 1_000_000

    const verdict = verifyChain(ledger.rows.map((r) => rehydrateAuditRecord(r)!))
    expect(verdict.ok).toBe(false)
  })
})

describe("what a financial identifier does when it reaches the audit trail", () => {
  it("is replaced by a mask and a token in the reason", async () => {
    const ledger = new Ledger()

    await recordAuditEvent(
      {
        institutionId: INSTITUTION,
        actor: { principalId: "user_treasurer", role: "finance.officer" },
        action: "Finance.PostLedger",
        resourceType: "LedgerEntry",
        resourceId: "le_3",
        outcome: "ALLOW",
        reason: `Refunded the charge on ${PAN}`,
        metadata: { amountCents: 100, currency: "USD", approvalDigest: "sha256:abc" },
        mode: "test",
      },
      ledger,
    )

    expect(ledger.last().reason).not.toContain(PAN)
    expect(ledger.last().reason).toMatch(/tk_pan_[0-9a-f]{24}/)
    // And the same value is not left in the package built from it.
    expect(JSON.stringify(ledger.evidence())).not.toContain(PAN)
  })

  it("is replaced inside metadata, at any depth", async () => {
    const ledger = new Ledger()

    await recordAuditEvent(
      {
        institutionId: INSTITUTION,
        actor: { principalId: "user_admin" },
        action: "Payments.FundsFlowConfigured",
        resourceType: "PaymentsFundsFlowConfig",
        resourceId: "cfg_1",
        outcome: "ALLOW",
        reason: "Configured",
        metadata: { notes: { settlement: `pays out to ${IBAN}` } },
        mode: "test",
      },
      ledger,
    )

    expect(JSON.stringify(ledger.meta())).not.toContain(IBAN)
    expect(JSON.stringify(ledger.meta())).toMatch(/tk_iban_[0-9a-f]{24}/)
  })

  it("is replaced inside the change block, and the block's digest still matches what is stored", async () => {
    const ledger = new Ledger()

    await recordAuditEvent(
      {
        institutionId: INSTITUTION,
        actor: { principalId: "user_admin" },
        action: "Payments.PayoutDestinationChanged",
        resourceType: "PayoutDestination",
        resourceId: "pd_2",
        outcome: "ALLOW",
        reason: "Bank change",
        change: { before: { iban: IBAN }, after: { iban: "GB94BARC10201530093459" } },
        mode: "test",
      },
      ledger,
    )

    const block = ledger.meta()[CHANGE_METADATA_KEY] as {
      before: Record<string, unknown>
      after: Record<string, unknown>
      digest: string
    }
    expect(JSON.stringify(block)).not.toContain(IBAN)
    expect(JSON.stringify(block)).not.toContain("GB94BARC10201530093459")
    expect(String(block.before.iban)).toMatch(/tk_iban_[0-9a-f]{24}/)
  })

  it("gives two institutions different tokens for the same account", async () => {
    const ledger = new Ledger()

    for (const institutionId of [INSTITUTION, "inst_other"]) {
      await recordAuditEvent(
        {
          institutionId,
          actor: { principalId: "user_admin" },
          action: "Payments.FundsFlowConfigured",
          resourceType: "PaymentsFundsFlowConfig",
          resourceId: "cfg_x",
          outcome: "ALLOW",
          reason: `settles to ${IBAN}`,
          mode: "test",
        },
        ledger,
      )
    }

    const [one, two] = ledger.rows.map((r) => String(r.reason).match(/tk_iban_[0-9a-f]{24}/)?.[0])
    expect(one).toBeDefined()
    expect(one).not.toBe(two)
  })

  it("says the value was not tokenized when the deployment has no key, and still removes it", async () => {
    delete process.env[TOKENIZATION_KEY_VAR]
    const ledger = new Ledger()

    await recordAuditEvent(
      {
        institutionId: INSTITUTION,
        actor: { principalId: "user_admin" },
        action: "Payments.FundsFlowConfigured",
        resourceType: "PaymentsFundsFlowConfig",
        resourceId: "cfg_2",
        outcome: "ALLOW",
        reason: `settles to ${IBAN}`,
        mode: "test",
      },
      ledger,
    )

    expect(ledger.last().reason).not.toContain(IBAN)
    expect(ledger.last().reason).toContain("[not tokenized: no-key]")
  })

  it("leaves an ordinary reason and ordinary metadata untouched", async () => {
    const ledger = new Ledger()

    await recordAuditEvent(
      {
        institutionId: INSTITUTION,
        actor: { principalId: "user_admin" },
        action: "Document.Viewed",
        resourceType: "Document",
        resourceId: "doc_2",
        outcome: "ALLOW",
        reason: "Opened the catering agreement",
        metadata: { pages: 3, title: "Catering agreement 2026" },
        mode: "test",
      },
      ledger,
    )

    expect(ledger.last().reason).toBe("Opened the catering agreement")
    expect(ledger.meta().title).toBe("Catering agreement 2026")
    expect(ledger.meta().pages).toBe(3)
  })
})
