import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "../../tools/document-graph.mjs"

/**
 * The approver on a destructive transition is looked up, not asserted.
 *
 * `advance()` refuses unless the caller passes `approverIsOperator: true`. That
 * makes forgetting to check fail closed — but it does nothing about a caller
 * that passes a literal `true`, which is the shortest path from this guard to
 * no guard at all, and a mutation doing exactly that survived the package's own
 * tests.
 *
 * The transitions this protects are the three that cannot be undone by trying
 * again: provisioning spends money, activating routes real users, and purging
 * deletes a tenant.
 */

const CALL_SITE = "apps/system-studio/src/app/tenants/actions.ts"

test("the call site derives the answer from the operator allowlist", () => {
  const source = fs.readFileSync(path.join(ROOT, CALL_SITE), "utf8")

  assert.match(
    source,
    /approverIsOperator:\s*approvedBy\s*\?\s*isOperator\(approvedBy\)/,
    `${CALL_SITE} must compute approverIsOperator from isOperator(approvedBy). A literal, or a ` +
      `value taken from the request, turns the lifecycle's refusal into a formality.`,
  )
  assert.ok(
    !/approverIsOperator:\s*(true|Boolean\(1\)|1)\b/.test(source),
    `${CALL_SITE} passes a literal for approverIsOperator.`,
  )
  assert.match(source, /import \{[^}]*isOperator[^}]*\} from "@\/lib\/operators"/, "isOperator is imported")
})

test("no other caller of advance() skips the lookup", () => {
  // A second call site that forgot would fail closed at runtime rather than
  // silently pass — but it would fail closed in production, on a purge, which
  // is a worse place to find out than here.
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".next", "dist"].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8")
        if (!/\badvance\(/.test(text)) continue
        if (!/needsApproval|approvedBy/.test(text)) continue
        if (!/approverIsOperator/.test(text)) {
          offenders.push(path.relative(ROOT, full).split(path.sep).join("/"))
        }
      }
    }
  }
  for (const root of ["apps", "packages"]) {
    const abs = path.join(ROOT, root)
    if (fs.existsSync(abs)) walk(abs)
  }
  assert.deepEqual(offenders, [], "A caller passes approvedBy to advance() without a verified lookup.")
})
