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

/**
 * Workflows whose automatic triggers are removed in this repository.
 *
 * The job-level guard alone was the wrong shape, and the evidence was in the
 * Actions tab: every push to main created a Deploy run that immediately skipped
 * both its jobs, and every edit to ops-status.yml created an Ops Status run that
 * did the same. Eight of the first sixteen runs in this repository were
 * `skipped`. A repository where half the runs are neither success nor failure
 * teaches everyone reading it to stop reading it — and the one genuine CI
 * failure in that list is exactly what gets lost.
 *
 * A run that is created and discarded is worse than no run. So the trigger goes
 * too: no push trigger, no schedule, nothing automatic. `workflow_dispatch`
 * stays, so the workflow is still runnable on purpose, and the job guard stays
 * underneath it, so dispatching it here still does nothing.
 *
 * Cutover restores the trigger and flips the guard, in the same reviewed change.
 */
export const AUTOMATIC_TRIGGERS_REMOVED = ['deploy.yml', 'ops-status.yml']

/** Triggers that fire without a human asking. */
export const AUTOMATIC_TRIGGER_KEYS = ['push', 'pull_request', 'schedule', 'pull_request_target']

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

const TRIGGER_NOTE = [
  '  # No automatic trigger in this repository.',
  '  #',
  '  # The job-level guard below is not enough on its own: a guarded job still',
  '  # creates a run, which then reports `skipped`. Eight of the first sixteen runs',
  '  # here were skipped Deploy and Ops Status runs, which buries the one CI failure',
  '  # among them. A run created only to be discarded is worse than no run.',
  '  #',
  '  # Cutover restores the trigger and flips the guard, in the same reviewed change.',
  '  # See docs/decisions/ADR-0005-CANONICAL-MONOREPO.md.',
].join('\n')

/**
 * Strip automatic triggers, keeping `workflow_dispatch`.
 *
 * Operates on the `on:` block's own text: the block runs from the `on:` line to
 * the next top-level key, and a trigger is a two-space-indented key inside it
 * together with everything indented under it.
 */
function stripAutomaticTriggers(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^on:\s*$/.test(l) || /^on:\s+\S/.test(l))
  if (start === -1) throw new Error('no `on:` block found')

  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i]) && lines[i].trim() !== '') {
      end = i
      break
    }
  }

  const kept = []
  let removed = 0
  let i = start + 1
  while (i < end) {
    const m = lines[i].match(/^ {2}([a-z_]+):/)
    if (m && AUTOMATIC_TRIGGER_KEYS.includes(m[1])) {
      removed++
      i++
      while (i < end && (lines[i].trim() === '' || /^ {3,}/.test(lines[i]))) i++
      continue
    }
    kept.push(lines[i])
    i++
  }

  if (removed === 0) return { text, removed: 0 }

  const body = kept.filter((l) => l.trim() !== '')
  const rebuilt = ['on:', TRIGGER_NOTE, ...body, '']
  return { text: [...lines.slice(0, start), ...rebuilt, ...lines.slice(end)].join('\n'), removed }
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

  let stripped = 0
  for (const file of AUTOMATIC_TRIGGERS_REMOVED) {
    const p = path.join(WORKFLOW_DIR, file)
    const text = fs.readFileSync(p, 'utf8')
    const r = stripAutomaticTriggers(text)
    if (r.removed > 0) {
      fs.writeFileSync(p, r.text)
      stripped += r.removed
      console.log(`untriggered  ${file}  (${r.removed} automatic trigger(s) removed)`)
    } else {
      console.log(`already      ${file}  (no automatic triggers)`)
    }
  }

  console.log(
    `\n${added} job(s) newly guarded, ${stripped} trigger(s) removed; production owner = ${PRODUCTION_OWNER}`,
  )
}

// pathToFileURL, not string concatenation: on Windows `file://C:/…` and
// `file:///C:/…` differ by one slash and the naive comparison silently never
// matches, so the script exits 0 having done nothing.
import { pathToFileURL } from 'node:url'
if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
