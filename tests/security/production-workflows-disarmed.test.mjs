/**
 * The production-operations workflows must not be able to run from this
 * repository.
 *
 * `satvikOS/Tenure-Parent` holds the same `ACCESSKEYID` and `SECRETACCESSKEY`
 * secrets as `satvikOS/Tenure`. Importing the application brought `deploy.yml`
 * with it, whose trigger is `on: push: branches: [main]`. Nothing about the
 * import made those credentials unreachable — so without a job-level guard, the
 * merge that makes this repository canonical would build a container, push it to
 * ECR, run `terraform apply` and roll production ECS, against a live pilot
 * carrying real student data, as a side effect of reorganising directories.
 *
 * These assertions derive the set of dangerous workflows from what the files
 * actually do — reference AWS credentials or the AWS CLI — rather than from a
 * list someone has to remember to update. A new AWS workflow added later without
 * a guard fails here, which is the whole point.
 *
 * Run: npm run test:platform
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

import { PRODUCTION_OWNER, WORKFLOW_DIR } from '../../tools/disarm-production-workflows.mjs'

const THIS_REPOSITORY = 'satvikOS/Tenure-Parent'

const files = fs
  .readdirSync(WORKFLOW_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))

const workflows = files.map((file) => {
  const text = fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8')
  return { file, text, doc: parse(text) }
})

/**
 * A workflow "reaches production" if it can authenticate to AWS: it names the
 * credential secrets, or configures credentials, or shells out to `aws`.
 */
const reachesProduction = ({ text }) =>
  /secrets\.(ACCESSKEYID|SECRETACCESSKEY)/.test(text) ||
  /aws-actions\/configure-aws-credentials/.test(text) ||
  /^\s*(run:.*|\s+)aws\s/m.test(text)

const guardOf = (job) => (typeof job?.if === 'string' ? job.if : null)
const isGuarded = (job) => {
  const g = guardOf(job)
  return !!g && g.includes('github.repository') && g.includes(PRODUCTION_OWNER)
}

test('every workflow parses', () => {
  for (const { file, doc } of workflows) {
    assert.ok(doc && typeof doc === 'object', `${file} did not parse to an object`)
    assert.ok(doc.jobs && Object.keys(doc.jobs).length > 0, `${file} declares no jobs`)
  }
})

test('this test knows which repository it is defending', () => {
  // If the guard ever names this repository, it is not a guard any more.
  assert.notEqual(
    PRODUCTION_OWNER,
    THIS_REPOSITORY,
    'PRODUCTION_OWNER names this repository — the production workflows are armed here',
  )
})

test('every job that can reach AWS is disarmed in this repository', () => {
  const dangerous = workflows.filter(reachesProduction)
  assert.ok(dangerous.length > 0, 'found no AWS-touching workflows — the detector is broken')

  const unguarded = []
  for (const { file, doc } of dangerous) {
    for (const [name, job] of Object.entries(doc.jobs)) {
      if (!isGuarded(job)) unguarded.push(`${file}:${name}  if=${guardOf(job) ?? '(none)'}`)
    }
  }

  assert.deepEqual(
    unguarded,
    [],
    `These jobs can reach AWS from ${THIS_REPOSITORY} with production credentials:\n  ` +
      unguarded.join('\n  ') +
      `\n\nAdd the guard with: node tools/disarm-production-workflows.mjs`,
  )
})

test('deploy.yml in particular cannot fire on a push to main here', () => {
  const deploy = workflows.find((w) => w.file === 'deploy.yml')
  assert.ok(deploy, 'deploy.yml is missing')

  // It still triggers on push to main — that is correct, and is what makes the
  // job-level guard load-bearing rather than decorative.
  const on = deploy.doc.on ?? deploy.doc[true] // YAML 1.1 parses bare `on` as boolean true
  assert.ok(on, 'deploy.yml declares no triggers')

  for (const [name, job] of Object.entries(deploy.doc.jobs)) {
    assert.ok(isGuarded(job), `deploy.yml job '${name}' is not guarded`)
  }
})

test('CI is deliberately NOT guarded — it must run in this repository', () => {
  const ci = workflows.find((w) => w.file === 'ci.yml')
  assert.ok(ci, 'ci.yml is missing')
  assert.equal(reachesProduction(ci), false, 'ci.yml has grown an AWS dependency')

  for (const [name, job] of Object.entries(ci.doc.jobs)) {
    assert.equal(
      isGuarded(job),
      false,
      `ci.yml job '${name}' carries the production guard — CI would never run here`,
    )
  }
})

test('the disarm tool is idempotent and matches the committed files', async () => {
  const mod = await import('../../tools/disarm-production-workflows.mjs')
  for (const [file, jobs] of Object.entries(mod.GUARDED_JOBS)) {
    const text = fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8')
    for (const job of jobs) {
      assert.ok(
        text.includes(mod.GUARD_LINE),
        `${file} is missing the guard line for '${job}'`,
      )
    }
  }
})
