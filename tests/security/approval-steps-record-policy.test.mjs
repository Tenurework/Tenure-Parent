/**
 * PAY-030-005. Every state transition records the policy it was decided under.
 *
 * `ApprovalStep` is the platform's ONLY state-transition history. It carried an
 * actor, a reason, and a `policySnapshot` of ad-hoc booleans — `{ action,
 * requesterIsPresident, onBehalfOf }` — and nothing that said WHICH definition
 * or WHICH resolved values were in force. `configSnapshotForInstitution`
 * produced exactly that (`revision` + `checksum`) and its only caller in the
 * whole tree was the AI chat route.
 *
 * The columns are NOT NULL, so a writer that forgets them fails at runtime
 * rather than silently. This test covers the other half, the one `tsc` cannot:
 * a writer that SATISFIES the column with a frozen literal. That compiles, every
 * unit test passes, and the trail then records a revision the decision was never
 * checked against — which is worse than the missing column, because it looks
 * like evidence.
 *
 * It is a source assertion for a reason worth stating: the failure is somebody
 * adding a seventh `approvalStep.create` that hardcodes `"v1"`, and no test of
 * the six existing writers would notice.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

import { ROOT } from "../../tools/document-graph.mjs"

const listFiles = () =>
  ["apps/web/src/**/*.ts", "apps/web/src/**/*.tsx"].flatMap((glob) =>
    execFileSync("git", ["ls-files", glob], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean),
  )

/** Comments stripped: this file's own header names the calls it is about. */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

/** The `data: { … }` object of every `approvalStep.create` in a source file. */
function stepCreates(source) {
  const out = []
  const marker = /\w*\.?approvalStep\.create\(/g
  let match
  while ((match = marker.exec(source)) !== null) {
    // Walk braces from the call's opening paren to its close, so a nested
    // object cannot end the slice early.
    let depth = 0
    let i = match.index + match[0].length - 1
    const start = i
    for (; i < source.length; i += 1) {
      if (source[i] === "(") depth += 1
      else if (source[i] === ")") {
        depth -= 1
        if (depth === 0) break
      }
    }
    out.push(source.slice(start, i + 1))
  }
  return out
}

const REQUIRED_KEYS = ["configRevision", "configChecksum", "authority"]

test("every ApprovalStep writer records the configuration revision and the authority", () => {
  const writers = []

  for (const file of listFiles()) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx") || file.includes(".itest.")) continue
    const source = stripComments(fs.readFileSync(path.join(ROOT, file), "utf8"))
    for (const call of stepCreates(source)) {
      writers.push({ file, call })
      for (const key of REQUIRED_KEYS) {
        assert.ok(
          call.includes(`${key}:`),
          `${file} writes an ApprovalStep without \`${key}\`. A transition history that cannot ` +
            `say which policy was in force answers "was this allowed at the time" with a shrug.`,
        )
      }
    }
  }

  // Six writers when this landed: approvals/actions.ts (create + decide),
  // admin/actions.ts (override), calendar/actions.ts, orgs/[slug]/finance/
  // actions.ts (reimbursement) and lib/calendar-write.ts (amendment). A
  // seventh is fine; ZERO means the sweep above stopped matching and the
  // assertions became vacuous, which is the failure mode of every source test.
  assert.ok(
    writers.length >= 6,
    `Expected at least 6 ApprovalStep writers, found ${writers.length}. If the call shape ` +
      `changed, fix this matcher — a sweep that matches nothing passes every assertion.`,
  )
})

test("the revision is READ from the snapshot, never frozen to a literal", () => {
  for (const file of listFiles()) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx") || file.includes(".itest.")) continue
    const source = stripComments(fs.readFileSync(path.join(ROOT, file), "utf8"))

    for (const call of stepCreates(source)) {
      for (const key of ["configRevision", "configChecksum"]) {
        const value = new RegExp(`${key}:\\s*([^,\\n]+)`).exec(call)?.[1]?.trim()
        assert.ok(value, `${file}: could not read the ${key} value out of an ApprovalStep write.`)
        assert.doesNotMatch(
          value,
          /^["'`]/,
          `${file} freezes ${key} to the literal ${value}. A frozen revision is worse than a ` +
            `missing one: it renders as evidence of a policy check that never happened. Read it ` +
            `from configSnapshotForInstitution(institutionId).`,
        )
        assert.match(
          value,
          /\.(revision|checksum)\b/,
          `${file} must set ${key} from a ConfigSnapshot's .revision / .checksum, got ${value}.`,
        )
      }
    }
  }
})

test("configSnapshotForInstitution has real callers beyond the AI route", () => {
  // The gap this requirement names: the function produced `revision` and
  // `checksum` and exactly one route read it. If that regresses, the writers
  // above are setting the columns from something else.
  const callers = listFiles().filter((file) => {
    if (file.includes(".test.") || file.includes(".itest.")) return false
    const source = stripComments(fs.readFileSync(path.join(ROOT, file), "utf8"))
    return /configSnapshotForInstitution\(/.test(source) && !file.endsWith("lib/config/server.ts")
  })

  assert.ok(
    callers.length >= 5,
    `configSnapshotForInstitution has ${callers.length} caller(s): ${callers.join(", ")}. ` +
      `Every ApprovalStep writer must resolve it.`,
  )
})
