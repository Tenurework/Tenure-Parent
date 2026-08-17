import fs from "node:fs"
import path from "node:path"

import { secretKindOf } from "@tenure/audit"

/**
 * EXT-000-002, third clause — the baseline inventories expose no secrets.
 *
 * `tools/ext-baseline-truth.mjs` binds the seven truths to the artifacts that
 * hold them and proves the programs that write those artifacts only read. This
 * is the other half: what they wrote down carries no credential VALUE.
 *
 * ── Why this test is here and not beside that one ──────────────────────────
 *
 * The credential formats are already declared once, in
 * `packages/audit/src/secret-values.ts`, recognised by the prefix their issuer
 * publishes rather than by entropy. A second copy inside a `tests/architecture`
 * `.mjs` — which cannot import TypeScript — would be two answers to "what is a
 * secret", and the one that fell behind would be the one nobody was watching.
 * So the scan runs under Jest, which already transforms that module for every
 * other caller.
 *
 * ── Why whole directories rather than the seven truths' artifact list ──────
 *
 * A list would only ever prove the files somebody remembered. `github-current-state.md`
 * states in its own header that it records secret NAMES and no values; the risk
 * is the next such record, written by someone who did not read that line. Walking
 * the directories means a new committed document is covered on the day it lands.
 */

const ROOT = path.resolve(__dirname, "../../../../..")

/** Where committed truth about the platform lives. */
const SCANNED = ["docs", "infrastructure/oidc", "apps/system-studio/src/generated"]

/** Artefact directories, not sources of truth. */
const SKIP = new Set(["node_modules", ".git", ".next"])

function filesUnder(dir: string, out: string[] = []): string[] {
  const full = path.join(ROOT, dir)
  if (!fs.existsSync(full)) return out
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) filesUnder(rel, out)
    else if (/\.(md|json|ya?ml|txt)$/.test(entry.name)) out.push(rel)
  }
  return out
}

describe("EXT-000-002 — committed inventories carry no credential value", () => {
  const files = SCANNED.flatMap((d) => filesUnder(d))

  it("scans a real corpus, so an empty walk cannot pass", () => {
    // A directory walk that finds nothing asserts nothing, and would go green
    // the day one of these paths is renamed.
    expect(files.length).toBeGreaterThan(50)
  })

  it("finds a credential when one is present", () => {
    // The positive control. Without it, "no findings" could mean the scanner is
    // not wired rather than the corpus is clean — the difference between "we
    // looked and found nothing" and "we could not look".
    expect(secretKindOf("AKIAIOSFODNN7EXAMPLE")).toBe("AWS access key id")
    expect(secretKindOf("whsec_abcdefgh12345678")).toBe("webhook signing secret")
    expect(secretKindOf("docs/architecture/aws-current-state.md")).toBeNull()
  })

  it("finds none in any committed baseline record", () => {
    const findings: string[] = []
    for (const file of files) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8")
      text.split(/\r?\n/).forEach((line, i) => {
        // Word-ish chunks rather than whole lines: `secretKindOf` answers about
        // one value, and a whole line of prose can contain a token inside it.
        for (const token of line.split(/[\s"'`,;(){}[\]<>|]+/)) {
          if (token.length < 12) continue
          const kind = secretKindOf(token)
          if (kind) findings.push(`${file}:${i + 1} — ${kind}`)
        }
      })
    }
    expect(findings).toEqual([])
  })
})
