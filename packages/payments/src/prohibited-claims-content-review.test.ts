import fs from "node:fs"
import path from "node:path"

import { PROHIBITED_CLAIM_RULES, describeFinding, scanProhibitedClaims } from "./prohibited-claims"

/**
 * PAY-000-004 — the content review, run over the real payments surfaces.
 *
 * The rules in `prohibited-claims.ts` are enforced at runtime on the two
 * surfaces that generate prose (a merchant disclosure and a Relay reply). This
 * is the other half: the STATIC surfaces — the payments UI, the payments
 * documents and the Relay copy — where the sentence is written once and read for
 * years. Nothing generates those, so nothing can refuse them; they have to be
 * scanned.
 *
 * ## Why an allowance list, and why it must not go stale
 *
 * A document explaining which copy is prohibited contains the prohibited copy.
 * `docs/payments/payment-authority-and-regulatory-boundary.md` quotes all five
 * of Bible §2's phrases in one paragraph, and it is right to. No pattern can
 * distinguish a citation from a claim, so the exemption is explicit, per file,
 * per rule, with the reason in the table.
 *
 * The second assertion is what keeps that honest: every allowance must still
 * match something. An allowance whose text has been rewritten stops being an
 * exemption for a citation and becomes a blanket permission for that file, and
 * nobody would ever notice — the suite would stay green in exactly the case
 * where the file had started making the claim for real.
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

const ROOT = repoRoot()

/**
 * The surfaces PAY-000-004 names: payments UI, payments docs, Relay responses.
 *
 * Paths, not globs, because a glob that matches nothing looks identical to a
 * glob that matches clean files. Every entry below is asserted to exist.
 */
const REVIEWED = [
  // Payments UI
  "apps/web/src/app/(app)/admin/payments",
  "apps/web/src/components/admin/FundsFlowForm.tsx",
  "apps/web/src/components/finance",
  "apps/web/src/lib/finance.ts",
  "apps/web/src/app/api/payments",
  // The provider-neutral payments code, whose error strings reach the UI
  "packages/payments/src",
  // Payments documents
  "docs/payments",
  "docs/decisions/pay-adr-0001-merchant-of-record-default-and-exception-paths.md",
  "docs/decisions/pay-adr-0002-responsibility-selection-algorithm.md",
  // Relay copy — the words the assistant says when it is not quoting a model
  "apps/web/src/components/ai/relay-reply.ts",
  "apps/web/src/lib/relay-tools.ts",
  "apps/web/src/lib/relay",
  "apps/web/src/app/api/ai/chat/route.ts",
]

/**
 * The two files that define the rules, excluded BY NAME.
 *
 * Not an allowance: a rule table has to contain the phrases it forbids, and its
 * tests have to contain the sentences that must and must not match. Excluding
 * them by exact name rather than by a `prohibited` substring is deliberate — a
 * pattern would quietly exempt any future file somebody named similarly.
 */
const RULE_FILES = [
  "packages/payments/src/prohibited-claims.ts",
  "packages/payments/src/prohibited-claims.test.ts",
  "packages/payments/src/prohibited-claims-content-review.test.ts",
]

/**
 * file → rule id → why the match is a citation rather than a claim.
 *
 * Read every one of these before adding another.
 */
const ALLOWANCES: Record<string, Record<string, string>> = {
  "docs/payments/payment-authority-and-regulatory-boundary.md": {
    "tenure-bank-account": "§7 quotes Bible §2's five prohibited phrases to say they are prohibited.",
    "tenure-holds-funds": "Same paragraph.",
    "tenure-issued-card": "Same paragraph.",
    "insured-by-tenure": "Same paragraph.",
    "payments-available-globally": "Same paragraph.",
  },
  "apps/web/src/lib/finance.ts": {
    "tenure-bank-account":
      "`ledgerDisclosure`'s header quotes the prohibited phrases to explain why the sentence is " +
      "generated from the responsibility matrix instead of written by hand. Only this one rule: " +
      "the second phrase in that comment is broken across a line and does not match, which is " +
      "why the stale-allowance check below exists rather than a list somebody eyeballed.",
  },
  "packages/payments/src/gateway.ts": {
    "tenure-bank-account":
      "`describeMerchant`'s header cites three of Bible §2's phrases to say why the disclosure " +
      "is generated rather than written per surface. It is the module that runs the scan.",
    "tenure-holds-funds": "Same header comment.",
    "tenure-issued-card": "Same header comment.",
  },
}

const TEXT_FILE = /\.(ts|tsx|mjs|cjs|jsx?|md|json)$/

function walk(rel: string, out: string[]): void {
  const abs = path.join(ROOT, rel)
  const stat = fs.statSync(abs)
  if (stat.isFile()) {
    if (TEXT_FILE.test(rel)) out.push(rel.split(path.sep).join("/"))
    return
  }
  for (const entry of fs.readdirSync(abs)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    walk(path.join(rel, entry), out)
  }
}

function reviewedFiles(): string[] {
  const out: string[] = []
  for (const rel of REVIEWED) {
    const abs = path.join(ROOT, rel)
    if (!fs.existsSync(abs)) {
      throw new Error(
        `${rel} is in the reviewed set and does not exist. A path that has moved silently ` +
          `removes a surface from the content review.`,
      )
    }
    walk(rel, out)
  }
  return [...new Set(out)].filter((f) => !RULE_FILES.includes(f)).sort()
}

describe("the content review covers the surfaces PAY-000-004 names", () => {
  it("reads the payments UI, the payments docs and the Relay copy", () => {
    const files = reviewedFiles()
    // Pinned by value first: an enumeration that returned [] would make the
    // scan below pass by scanning nothing.
    expect(files.length).toBeGreaterThanOrEqual(25)
    for (const expected of [
      "apps/web/src/app/(app)/admin/payments/page.tsx",
      "apps/web/src/components/admin/FundsFlowForm.tsx",
      "apps/web/src/components/finance/LedgerDrawer.tsx",
      "apps/web/src/lib/finance.ts",
      "docs/payments/payment-authority-and-regulatory-boundary.md",
      "apps/web/src/components/ai/relay-reply.ts",
      "packages/payments/src/gateway.ts",
    ]) {
      expect(files).toContain(expected)
    }
    for (const excluded of RULE_FILES) expect(files).not.toContain(excluded)
  })

  it("finds no prohibited claim that is not an allowed citation", () => {
    const offenders: string[] = []
    for (const file of reviewedFiles()) {
      const allowed = ALLOWANCES[file] ?? {}
      const text = fs.readFileSync(path.join(ROOT, file), "utf8")
      for (const finding of scanProhibitedClaims(text)) {
        if (finding.ruleId in allowed) continue
        const line = text.slice(0, finding.index).split("\n").length
        offenders.push(`${file}:${line} — ${describeFinding(finding)}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it("has no stale allowance — every exemption still matches its file", () => {
    // MUTATION TARGET, and the important one. An allowance that no longer
    // matches has stopped exempting a citation and started exempting whatever
    // that file says next.
    const stale: string[] = []
    for (const [file, rules] of Object.entries(ALLOWANCES)) {
      const abs = path.join(ROOT, file)
      if (!fs.existsSync(abs)) {
        stale.push(`${file} — allowed, and the file is gone`)
        continue
      }
      const hits = new Set(scanProhibitedClaims(fs.readFileSync(abs, "utf8")).map((f) => f.ruleId))
      for (const ruleId of Object.keys(rules)) {
        if (!hits.has(ruleId)) stale.push(`${file} → ${ruleId} matches nothing`)
      }
    }
    expect(stale).toEqual([])
  })

  it("allows only rule ids that exist", () => {
    const known = new Set(PROHIBITED_CLAIM_RULES.map((r) => r.id))
    const unknown = Object.entries(ALLOWANCES).flatMap(([file, rules]) =>
      Object.keys(rules)
        .filter((id) => !known.has(id))
        .map((id) => `${file} → ${id}`),
    )
    expect(unknown).toEqual([])
  })

  it("proves the scan can fail — a claim inserted into a reviewed file is found", () => {
    // The scan above passing means nothing unless the same scan, over the same
    // enumeration, reds on a real violation. Rather than writing to the tree,
    // this reproduces the exact loop against one reviewed file's text plus one
    // sentence, which is what a careless edit to that file would look like.
    const file = "apps/web/src/app/(app)/admin/payments/page.tsx"
    const text = `${fs.readFileSync(path.join(ROOT, file), "utf8")}\n// Funds settle into your Tenure bank account.\n`
    const found = scanProhibitedClaims(text).filter((f) => !(f.ruleId in (ALLOWANCES[file] ?? {})))
    expect(found.map((f) => f.ruleId)).toEqual(["tenure-bank-account"])
  })
})
