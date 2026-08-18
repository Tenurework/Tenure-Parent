import {
  EVIDENCE_REQUIREMENTS,
  HIGH_RISK_CLASSES,
  HIGH_RISK_CLASS_PRECEDENCE,
  buildEvidencePackage,
  classifyHighRiskAction,
  evidenceDigestMatches,
  isHighRiskAction,
} from "./high-risk-actions"

describe("classifying an action", () => {
  it("reads the actions this repository actually writes", () => {
    // Every one of these is a real `action` string from a production call site.
    expect(classifyHighRiskAction("Finance.PostLedger")).toBe("money-movement")
    expect(classifyHighRiskAction("Finance.ReverseLedger")).toBe("money-movement")
    expect(classifyHighRiskAction("Payments.FundsFlowConfigured")).toBe("provider-configuration")
  })

  it("classifies an action nobody has written yet, from its own words", () => {
    expect(classifyHighRiskAction("Payments.PayoutIssued")).toBe("money-movement")
    expect(classifyHighRiskAction("Treasury.WebhookSecretRotated")).toBe("provider-configuration")
    expect(classifyHighRiskAction("Tenant.Purged")).toBe("lifecycle-destructive")
    expect(classifyHighRiskAction("Reports.Exported")).toBe("data-disclosure")
    expect(classifyHighRiskAction("Admin.permission.grant")).toBe("authority-change")
  })

  it("reads a beneficiary change as a beneficiary change even when it also says payout", () => {
    // The fraud review's reading wins: substituting where the money goes is the
    // control this class exists for, and it is the one that gets attacked.
    expect(classifyHighRiskAction("Payments.PayoutDestinationChanged")).toBe("beneficiary-change")
  })

  it("does not care about case or punctuation", () => {
    for (const spelling of ["Finance.PostLedger", "finance.post_ledger", "FINANCE.POST-LEDGER"]) {
      expect(classifyHighRiskAction(spelling)).toBe("money-movement")
    }
  })

  it("leaves an ordinary action alone rather than calling everything high-risk", () => {
    expect(classifyHighRiskAction("Document.Viewed")).toBeNull()
    expect(classifyHighRiskAction("Calendar.EventCreated")).toBeNull()
    expect(isHighRiskAction("Search.Ran")).toBe(false)
    expect(classifyHighRiskAction("")).toBeNull()
  })

  it("tries every class it declares, so a new one cannot be unreachable", () => {
    expect([...HIGH_RISK_CLASS_PRECEDENCE].sort()).toEqual([...HIGH_RISK_CLASSES].sort())
  })

  it("has a requirement for every class it can return", () => {
    for (const klass of HIGH_RISK_CLASSES) {
      expect(EVIDENCE_REQUIREMENTS[klass].length).toBeGreaterThan(0)
      // Bible §22's irreducible core.
      for (const field of ["actor", "tenant", "command", "result", "reason"]) {
        expect(EVIDENCE_REQUIREMENTS[klass]).toContain(field)
      }
    }
  })
})

describe("the evidence package", () => {
  const complete = {
    action: "Finance.PostLedger",
    values: {
      actor: "user_treasurer",
      tenant: "inst_1",
      command: "Finance.PostLedger",
      result: "ALLOW",
      reason: "Reimbursement approved by the OSE office",
      seat: { templateKey: "finance.officer" },
      authority: "finance.ledger.post",
      amountMinorUnits: 4200,
      currency: "USD",
      affectedReferences: ["ledgerEntry:le_1", "budgetLine:bl_1"],
      approvalDigest: "sha256:abc",
    },
  }

  it("returns nothing for an action no class claims", () => {
    expect(buildEvidencePackage({ action: "Document.Viewed", values: {} })).toBeNull()
  })

  it("reports complete when every required field is there", () => {
    const pkg = buildEvidencePackage(complete)!
    expect(pkg.riskClass).toBe("money-movement")
    expect(pkg.missing).toEqual([])
    expect(pkg.complete).toBe(true)
  })

  it("names what is missing rather than leaving the field out", () => {
    const pkg = buildEvidencePackage({
      ...complete,
      values: { ...complete.values, approvalDigest: undefined, currency: undefined },
    })!

    expect(pkg.missing).toEqual(["currency", "approvalDigest"])
    expect(pkg.complete).toBe(false)
    // Present as `null`, not absent: a reader can see the field was required.
    expect(Object.keys(pkg.fields)).toContain("approvalDigest")
    expect(pkg.fields.approvalDigest).toBeNull()
  })

  it("treats an empty string and an empty list as not supplied", () => {
    const pkg = buildEvidencePackage({
      ...complete,
      values: { ...complete.values, reason: "   ", affectedReferences: [] },
    })!
    expect(pkg.missing).toEqual(expect.arrayContaining(["reason", "affectedReferences"]))
  })

  it("accepts a field declared inapplicable with a reason, and not one declared blank", () => {
    const withReason = buildEvidencePackage({
      ...complete,
      values: { ...complete.values, approvalDigest: undefined },
      notApplicable: { approvalDigest: "posted under standing authority; no approval was raised" },
    })!
    expect(withReason.missing).toEqual([])
    expect(withReason.complete).toBe(true)
    expect(withReason.notApplicable.approvalDigest).toContain("standing authority")

    const withoutReason = buildEvidencePackage({
      ...complete,
      values: { ...complete.values, approvalDigest: undefined },
      notApplicable: { approvalDigest: "  " },
    })!
    expect(withoutReason.missing).toEqual(["approvalDigest"])
  })

  it("keeps a supplied field the class did not require", () => {
    const pkg = buildEvidencePackage({
      action: "Reports.Exported",
      values: {
        actor: "user_auditor",
        tenant: "inst_1",
        command: "Reports.Exported",
        result: "ALLOW",
        reason: "Year-end review",
        seat: { templateKey: "institution.director" },
        authority: "reports.export",
        affectedReferences: ["report:r_1"],
        providerRequestRef: "req_123",
      },
    })!
    expect(EVIDENCE_REQUIREMENTS["data-disclosure"]).not.toContain("providerRequestRef")
    expect(pkg.fields.providerRequestRef).toBe("req_123")
  })

  it("seals itself with a digest that survives key reordering", () => {
    const one = buildEvidencePackage(complete)!
    const reordered = buildEvidencePackage({
      action: complete.action,
      values: {
        currency: "USD",
        actor: "user_treasurer",
        approvalDigest: "sha256:abc",
        reason: "Reimbursement approved by the OSE office",
        tenant: "inst_1",
        amountMinorUnits: 4200,
        result: "ALLOW",
        affectedReferences: ["ledgerEntry:le_1", "budgetLine:bl_1"],
        command: "Finance.PostLedger",
        authority: "finance.ledger.post",
        seat: { templateKey: "finance.officer" },
      },
    })!
    expect(one.digest).toBe(reordered.digest)
    expect(evidenceDigestMatches(one)).toBe(true)
  })

  it("moves the digest when a value moves, so an edited package is detectable", () => {
    const one = buildEvidencePackage(complete)!
    const tampered = { ...one, fields: { ...one.fields, amountMinorUnits: 420_000 } }
    expect(evidenceDigestMatches(tampered)).toBe(false)

    const rebuilt = buildEvidencePackage({
      ...complete,
      values: { ...complete.values, amountMinorUnits: 420_000 },
    })!
    expect(rebuilt.digest).not.toBe(one.digest)
  })
})
