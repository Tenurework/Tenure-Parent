#!/usr/bin/env node
/**
 * Disarm the production-operations workflows in every repository except the one
 * that owns the production deployment.
 *
 * Why this exists: `satvikOS/Tenure-Parent` holds the same `ACCESSKEYID` and
 * `SECRETACCESSKEY` secrets as `satvikOS/Tenure`. Importing the application
 * brought `deploy.yml` — `on: push: branches: [main]` — with it. Without a guard,
 * the merge that makes this repository canonical would itself build a container,
 * push it to ECR, run `terraform apply` and roll production ECS, against a live
 * pilot carrying real student data, as a side effect of reorganising directories.
 *
 * `ops-status.yml` is the same class of problem for a different reason: it fires
 * `on: push: paths: [.github/workflows/ops-status.yml]`, and the import is a
 * change to that path.
 *
 * The guard is a job-level `if` naming the repository that owns production.
 * Cutover is flipping that one string, in a reviewed pull request, per the
 * cutover plan — not deleting the guard.
 *
 * `ci.yml` is deliberately not guarded. CI *should* run here; that is the point.
 *
 * Idempotent. Run it again after importing new workflows.
 * Verified by tests/security/production-workflows-disarmed.test.mjs.
 */
import fs from 'node:fs'
import path from 'node:path'

export const PRODUCTION_OWNER = 'satvikOS/Tenure'

/** Every workflow that reaches AWS with this repository's credentials. */
export const GUARDED_JOBS = {
  'custom-domain.yml': ['status'],
  'db-recovery.yml': ['recover'],
  'debug-logs.yml': ['logs'],
  'deploy.yml': ['ci-check', 'deploy'],
  'force-redeploy.yml': ['redeploy'],
  'ops-status.yml': ['snapshot'],
  'probe-debug.yml': ['probe'],
  'replace-acm-cert.yml': ['replace'],
  'rotate-auth-secret.yml': ['rotate'],
  'seed-reference-data.yml': ['seed'],
  'verify-reminders.yml': ['verify'],
}

export const GUARD_LINE = `    if: github.repository == '${PRODUCTION_OWNER}'`

const GUARD_BLOCK = [
  '    # Disarmed outside the repository that owns the production deployment, so',
  '    # that importing this file cannot deploy as a side effect. Flipping the',
  '    # repository name is the cutover, and is a reviewed change — see',
  '    # docs/decisions/ADR-0005-CANONICAL-MONOREPO.md and the cutover plan.',
  GUARD_LINE,
  '',
].join('\n')

export const WORKFLOW_DIR = '.github/workflows'

function guardOne(text, job) {
  const lines = text.split('\n')
  const at = lines.findIndex((l) => l === `  ${job}:`)
  if (at === -1) throw new Error(`job '${job}' not found`)

  // Already guarded? The guard sits within the job's own block, before the next
  // job key, so only look as far as the following top-level-ish key.
  for (let i = at + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i]) || /^\S/.test(lines[i])) break
    if (lines[i].trim() === GUARD_LINE.trim()) return { text, added: false }
  }

  lines.splice(at + 1, 0, ...GUARD_BLOCK.split('\n'))
  return { text: lines.join('\n'), added: true }
}

function main() {
  let added = 0
  for (const [file, jobs] of Object.entries(GUARDED_JOBS)) {
    const p = path.join(WORKFLOW_DIR, file)
    let text = fs.readFileSync(p, 'utf8')
    for (const job of jobs) {
      const r = guardOne(text, job)
      text = r.text
      if (r.added) {
        added++
        console.log(`guarded  ${file}:${job}`)
      } else {
        console.log(`already  ${file}:${job}`)
      }
    }
    fs.writeFileSync(p, text)
  }
  console.log(`\n${added} job(s) newly guarded; production owner = ${PRODUCTION_OWNER}`)
}

// pathToFileURL, not string concatenation: on Windows `file://C:/…` and
// `file:///C:/…` differ by one slash and the naive comparison silently never
// matches, so the script exits 0 having done nothing.
import { pathToFileURL } from 'node:url'
if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
