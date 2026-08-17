import fs from "node:fs"
import path from "node:path"

import { describeMerchant } from "./gateway"
import {
  APPROVED_DISCLOSURE_PHRASE,
  PROHIBITED_CLAIM_RULES,
  describeFinding,
  scanProhibitedClaims,
} from "./prohibited-claims"

/**
 * PAY-000-004 — the rules, checked against the authority that states them.
 *
 * Two properties matter more than the rest and are asserted first:
 *
 *   1. Every phrase Bible §2 actually names is caught. The five phrases are READ
 *      OUT OF THE BIBLE rather than copied here, so a rule that stops matching
 *      one of them reds even if this file is never edited — and a sixth phrase
 *      added to the Bible reds too, which is the direction a copied list can
 *      never fail in.
 *   2. The accurate sentences are NOT caught. A lint that refuses "Tenure is not
 *      a bank" makes the boundary document unwritable, and the first fix anybody
 *      reaches for is to delete the rule.
 */

function repoRoot(): string {
  let dir = process.cwd()
  for (;;) {
    if (fs.existsSync(path.join(dir, "docs", "decisions"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`no ancestor of ${process.cwd()} contains docs/decisions`)
    dir = parent
  }
}

const BIBLE = "Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md"

/** Bible §2's "Do not use product copy such as …" sentence, from the Bible. */
function bibleProhibitedCopy(): string[] {
  const text = fs.readFileSync(path.join(repoRoot(), BIBLE), "utf8")
  const sentence = text
    .split(/\r?\n/)
    .find((line) => line.startsWith("Do not use product copy such as"))
  if (!sentence) throw new Error(`Bible §2's product-copy sentence is gone from ${BIBLE}.`)

  // Curly quotes, and the comma sits INSIDE them for the first four. The
  // approved phrasing is quoted in the same sentence, so it is dropped by name
  // rather than by position — position would silently include it if the Bible's
  // wording were reordered.
  return [...sentence.matchAll(/[“]([^”]+)[”]/g)]
    .map((m) => m[1].replace(/,$/, "").trim())
    .filter((phrase) => phrase !== APPROVED_DISCLOSURE_PHRASE)
}

describe("the rules are the Bible's, not a list somebody remembered", () => {
  it("reads five prohibited phrases out of Bible §2", () => {
    // Pinned by value first. A reader that returned [] would make every
    // assertion below vacuously true, which is the shape that has shipped here
    // before.
    expect(bibleProhibitedCopy()).toEqual([
      "Tenure bank account",
      "Tenure holds your funds",
      "Tenure-issued card",
      "insured by Tenure",
      "payments available globally",
    ])
  })

  it("catches every phrase Bible §2 names", () => {
    for (const phrase of bibleProhibitedCopy()) {
      const findings = scanProhibitedClaims(`A sentence containing ${phrase} in the middle.`)
      expect(findings.length).toBeGreaterThan(0)
    }
  })

  it("names the §2 phrase on the rule it came from, spelled the Bible's way", () => {
    const cited = PROHIBITED_CLAIM_RULES.map((r) => r.bibleCopy).filter(
      (copy): copy is string => copy !== null,
    )
    expect(cited.sort()).toEqual(bibleProhibitedCopy().sort())
  })

  it("gives every rule a boundary, a reason and an alternative", () => {
    expect(PROHIBITED_CLAIM_RULES.length).toBeGreaterThanOrEqual(12)
    const ids = PROHIBITED_CLAIM_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const rule of PROHIBITED_CLAIM_RULES) {
      expect(rule.boundary.length).toBeGreaterThan(10)
      expect(rule.why.length).toBeGreaterThan(20)
      expect(rule.insteadSay.length).toBeGreaterThan(10)
      // No `g`: `scanProhibitedClaims` clones with it. A declared `g` would
      // carry lastIndex between scans and lose findings on every second call.
      expect(rule.pattern.flags).not.toContain("g")
      expect(rule.pattern.flags).toContain("i")
    }
  })

  it("covers each Bible §2 'Tenure is not automatically' line with at least one rule", () => {
    const text = fs.readFileSync(path.join(repoRoot(), BIBLE), "utf8")
    const start = text.indexOf("Tenure is not automatically:")
    expect(start).toBeGreaterThan(0)
    // The list, and only the list: collect from the header to the first line
    // that is not a bullet. Filtering the rest of the file for `- ` instead
    // swallows every bullet in the Bible, which is 400-odd requirement lines and
    // makes the assertion below unreadable rather than wrong.
    const lines: string[] = []
    let started = false
    for (const line of text.slice(start).split(/\r?\n/).slice(1)) {
      if (line.startsWith("- ")) {
        started = true
        lines.push(line.slice(2).trim())
        continue
      }
      if (started) break
    }
    expect(lines).toEqual([
      "Merchant of record.",
      "Bank, money transmitter, payment institution, acquirer, issuer or card network.",
      "Custodian or holder of customer funds.",
      "Employer, payroll provider or tax filer.",
      "KYC/KYB decision owner where Stripe owns that obligation.",
      "Guarantor for tenant negative balances.",
      "A replacement for provider, bank, network or regulator records.",
    ])

    const covered = new Set(PROHIBITED_CLAIM_RULES.map((r) => r.boundary))
    for (const line of lines) expect([...covered]).toContain(line)
  })
})

describe("the accurate sentence is not refused along with the false one", () => {
  it("finds nothing in Bible §2's own negations", () => {
    // Every "Tenure is not" line, written as the sentence a boundary document
    // has to be able to publish. If any of these matched, the document could
    // not state its own boundary and the rule would be deleted within a week.
    const accurate = [
      "Tenure is not the merchant of record; the tenant legal entity is.",
      "Tenure is not a bank, money transmitter, acquirer, issuer or card network.",
      "Tenure never holds customer funds and holds no funds of any kind.",
      "Tenure does not hold your funds.",
      "Tenure is not your employer, payroll provider or tax filer.",
      "Tenure does not decide KYC or KYB; the provider does.",
      "Tenure does not guarantee tenant negative balances.",
      "Tenure never replaces provider, bank, network or regulator records.",
      `A ${APPROVED_DISCLOSURE_PHRASE}.`,
      "Card acceptance is available in the thirteen declared countries.",
    ]
    for (const sentence of accurate) {
      expect(scanProhibitedClaims(sentence).map(describeFinding)).toEqual([])
    }
  })

  it("does not fire on Tenure submitting dispute evidence", () => {
    // The tax rule's second alternative requires the tax noun for this reason:
    // "Tenure submits" alone is true of Bible §14's evidence packages.
    expect(scanProhibitedClaims("Tenure submits the evidence package to the provider.")).toEqual([])
    expect(
      scanProhibitedClaims("Tenure files the 1099 for every contractor.").map((f) => f.ruleId),
    ).toEqual(["tenure-is-employer-or-tax-filer"])
  })
})

describe("the scanner reports all of them, in order, repeatably", () => {
  const copy =
    "Open a Tenure bank account and Tenure holds your funds until payout. " +
    "Ask for a Tenure-issued card — insured by Tenure — because payments are available globally."

  it("returns every rule that matched, not the first", () => {
    expect(scanProhibitedClaims(copy).map((f) => f.ruleId)).toEqual([
      "tenure-bank-account",
      "tenure-holds-funds",
      "tenure-issued-card",
      "insured-by-tenure",
      "payments-available-globally",
    ])
  })

  it("gives the same answer twice — the patterns carry no lastIndex", () => {
    // MUTATION TARGET: declaring the rule patterns with `g` and matching them
    // directly reds this and nothing else, because the first scan consumes the
    // regex's position and the second finds nothing.
    const first = scanProhibitedClaims(copy)
    const second = scanProhibitedClaims(copy)
    expect(second).toEqual(first)
    expect(second.length).toBe(5)
  })

  it("reports offsets that point at the text", () => {
    for (const finding of scanProhibitedClaims(copy)) {
      expect(copy.slice(finding.index, finding.index + finding.matched.length)).toBe(finding.matched)
    }
  })

  it("says nothing about clean text, and nothing about no text", () => {
    expect(scanProhibitedClaims("The club's own bank account receives the payout.")).toEqual([])
    expect(scanProhibitedClaims("")).toEqual([])
    expect(scanProhibitedClaims(undefined as unknown as string)).toEqual([])
  })

  it("explains a finding in one line naming the rule, the boundary and the fix", () => {
    const [finding] = scanProhibitedClaims("Your Tenure balance is available now.")
    expect(finding.ruleId).toBe("tenure-balance-is-funds")
    const line = describeFinding(finding)
    expect(line).toContain("tenure-balance-is-funds")
    expect(line).toContain("Custodian or holder of customer funds.")
    expect(line).toContain("internal allocation")
  })
})

describe("the merchant disclosure runs the rules on the sentence it generated", () => {
  const answered = {
    defaults: {
      merchantDisplay: "TENANT",
      feePayer: "TENANT",
      lossPayer: "TENANT",
      refundPayer: "TENANT",
      disputeOwner: "TENANT",
      kycUpdateOwner: "PROVIDER",
      accountCollectionOwner: "PROVIDER",
      supportOwner: "TENANT",
    },
  } as const

  it("shows the disclosure when the generated sentence is clean", () => {
    const described = describeMerchant({
      legalName: "Rochester Robotics Club",
      statementDescriptor: "ROCHESTER ROBOTICS",
      fundsFlow: "direct",
      responsibility: answered,
    })
    expect(described.disclosure).toBe(
      "Rochester Robotics Club is the seller for this payment. Processing fees are borne by the tenant.",
    )
    expect(described.blockers).toEqual([])
  })

  it("refuses to show a disclosure a tenant's own legal name made prohibited", () => {
    // MUTATION TARGET: deleting the `scanProhibitedClaims` call from
    // `describeMerchant` reds this, and nothing else in the suite. The input is
    // data, not code — nobody reviews a club's registered legal name — which is
    // why the check has to run at request time rather than in a lint.
    const described = describeMerchant({
      legalName: "Tenure Bank Account Trust",
      statementDescriptor: "TBA TRUST",
      fundsFlow: "direct",
      responsibility: answered,
    })
    expect(described.disclosure).not.toContain("Tenure Bank Account Trust is the seller")
    expect(described.disclosure).toContain(APPROVED_DISCLOSURE_PHRASE)
    expect(described.blockers.join(" ")).toContain("prohibited-claim-tenure-bank-account")
    // The resolved fact is still reported — the refusal is of the SENTENCE, not
    // of the decision, so a caller can still say who the merchant is.
    expect(described.merchantOfRecord).toBe("TENANT")
  })
})
