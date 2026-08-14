import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * Nothing deploys from a build its own suite failed.
 *
 * ## What this repository actually did
 *
 * `deploy-studio.yml` triggered on `push` to main. `ci.yml` triggers on the same
 * push. They therefore ran SIDE BY SIDE, and the deploy neither knew nor cared
 * what the tests concluded. The run history is unambiguous — `Deploy Studio
 * success` sits beside `CI failure` on 8c1161d, 4e3d1cf, 5561de0 and a957b39,
 * among others. On 5561de0 the failing job was Studio Playwright reporting text
 * drawn on top of other text at four breakpoints, and the console an operator
 * uses was rolled anyway.
 *
 * That is not a policy anybody chose. It is what two independent `push`
 * triggers mean, and it is invisible until you line the two columns up.
 *
 * ## What the fix has to hold
 *
 * Three properties, and all three are load-bearing:
 *
 *   1. The deploy is triggered by CI COMPLETING, not by a push. A `push:`
 *      trigger anywhere in an armed deploy workflow re-opens the hole.
 *   2. It refuses to run unless CI concluded `success`. `workflow_run` fires on
 *      failure too — that is the whole reason `types: [completed]` exists — so
 *      the trigger alone gates nothing.
 *   3. It deploys the commit CI TESTED. Under `workflow_run`, `github.sha` is
 *      the default branch's head when the event fired, which is a different
 *      commit whenever two pushes land close together. A deploy that checks out
 *      the branch head and tags the image with it would ship an untested tree
 *      while its run reported a green one — a worse failure than the one being
 *      fixed, because it looks correct.
 *
 * `workflow_dispatch` is deliberately still allowed to deploy: a human invoking
 * it by hand is making the judgement this gate makes automatically, and taking
 * that away would leave no way to roll out during an incident.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

/**
 * Deploy workflows that are ARMED in this repository.
 *
 * Kept in step with `production-workflows-disarmed.test.mjs`'s
 * `ENGINE_DEPLOY_JOBS`, which is the list of jobs allowed to touch AWS from
 * here. `bootstrap-oidc.yml` is on that list and is NOT here on purpose: it is
 * `workflow_dispatch` only and creates the deployment identity itself, so there
 * is no CI verdict about the estate for it to wait on.
 */
const ARMED_DEPLOYS = [".github/workflows/deploy-studio.yml"]

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8")

/** The `on:` block, up to the first top-level key that follows it. */
function triggerBlock(yaml) {
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((l) => /^on:\s*$/.test(l))
  assert.ok(start !== -1, "no `on:` block found")
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^[A-Za-z]/.test(l))
  return (end === -1 ? rest : rest.slice(0, end)).join("\n")
}

test("the survey finds the armed deploy workflows", () => {
  // An absence over an empty list is not a finding.
  assert.ok(ARMED_DEPLOYS.length >= 1, "no armed deploy workflow named — this guard measures nothing")
  for (const rel of ARMED_DEPLOYS) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} does not exist`)
  }
})

test("an armed deploy is triggered by CI finishing, never by a push", () => {
  for (const rel of ARMED_DEPLOYS) {
    const on = triggerBlock(read(rel))

    assert.ok(
      /^\s{2}workflow_run:/m.test(on),
      `${rel} does not trigger on \`workflow_run\`, so it does not wait for CI at all.`,
    )
    assert.match(
      on,
      /workflows:\s*\[\s*["']CI["']\s*\]/,
      `${rel}'s workflow_run does not name the CI workflow.`,
    )
    assert.ok(
      !/^\s{2}push:/m.test(on),
      `${rel} still triggers on \`push\`. A push trigger runs beside CI rather than after it, ` +
        `which is exactly how this repository shipped four red builds to production.`,
    )
  }
})

test("an armed deploy refuses a CI run that did not succeed", () => {
  for (const rel of ARMED_DEPLOYS) {
    const yaml = read(rel)
    assert.match(
      yaml,
      /github\.event\.workflow_run\.conclusion\s*==\s*'success'/,
      `${rel} does not check that CI concluded success. \`workflow_run\` fires on FAILURE too — ` +
        `\`types: [completed]\` means completed, not passed — so the trigger on its own gates nothing.`,
    )
  }
})

test("an armed deploy ships the commit CI tested, not the branch head", () => {
  for (const rel of ARMED_DEPLOYS) {
    const yaml = read(rel)

    assert.match(
      yaml,
      /ref:\s*\$\{\{\s*env\.DEPLOY_SHA\s*\}\}/,
      `${rel} does not pin its checkout to the verified commit. \`actions/checkout\` defaults to ` +
        `the branch head, which under workflow_run is not necessarily what CI ran against.`,
    )
    assert.match(
      yaml,
      /DEPLOY_SHA:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\|\|\s*github\.sha\s*\}\}/,
      `${rel}'s DEPLOY_SHA is not the workflow_run head_sha with a dispatch fallback.`,
    )
    assert.match(
      yaml,
      /IMAGE_TAG:\s*sha-\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\|\|\s*github\.sha\s*\}\}/,
      `${rel} tags the image with a sha that is not the one it deploys. The tag IS the deployment's ` +
        `identity — a mismatch means the console reports a commit it is not running.`,
    )
  }
})

test("the detector reads a real trigger block and rejects a push one", () => {
  // Both directions, so a reader that matched everything or nothing would fail
  // here rather than make the assertions above vacuous.
  const gated = "on:\n  workflow_run:\n    workflows: [\"CI\"]\n    types: [completed]\n\njobs:\n"
  const pushed = "on:\n  push:\n    branches: [main]\n\njobs:\n"
  assert.ok(/^\s{2}workflow_run:/m.test(triggerBlock(gated)))
  assert.ok(!/^\s{2}push:/m.test(triggerBlock(gated)))
  assert.ok(/^\s{2}push:/m.test(triggerBlock(pushed)))
})
