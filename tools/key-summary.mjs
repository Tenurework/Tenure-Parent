#!/usr/bin/env node
/**
 * GE-011-006 — the safe-in-the-open half of the key report.
 *
 * Counts go in the workflow summary; key ids do not. An access key ID is not a
 * secret — it is the public half of the pair, and the report needs it to say
 * WHICH key. But a list of every key in the account, printed into a public
 * repository's build log, is a map of what to go after, and build logs are
 * archived and indexed. So the ids stay in the short-retention artifact and
 * only the shape reaches the summary.
 */
import fs from "node:fs"

const REPORT = "docs/architecture/key-last-use.json"
const summaryPath = process.env.GITHUB_STEP_SUMMARY

let report
try {
  report = JSON.parse(fs.readFileSync(REPORT, "utf8"))
} catch (err) {
  // Loud rather than silent. A missing report means the read step did not run
  // or the role lost a permission, and a summary that quietly says nothing
  // reads as "no keys" — the most reassuring possible way to be wrong.
  const message = `::error::${REPORT} is missing or unreadable (${err.message}). The key inventory did not run.`
  console.error(message)
  process.exit(1)
}

const s = report.summary
const lines = [
  "### Long-lived access keys",
  "",
  `${s.total} key(s) across ${report.users} user(s), taken ${report.takenAt}`,
  "",
  `- **${s.active}** active`,
  `- **${s.noRecordedUse}** with no recorded use — AWS has no record, which is not the same as never used`,
  `- **${s.unusedBeyondAttention}** unused for more than ${report.attentionDays} days`,
  "",
  "Key ids are in the `aws-inventory` artifact, not here. Nothing is disabled by",
  "this workflow — see `docs/decisions/KEY-RETIREMENT-CHECKLIST.md` for what a",
  "retirement decision needs first.",
  "",
]

console.log(lines.join("\n"))
if (summaryPath) fs.appendFileSync(summaryPath, lines.join("\n"))
