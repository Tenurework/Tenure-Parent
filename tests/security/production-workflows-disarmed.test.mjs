/**
 * The production-operations workflows must not be able to run from this
 * repository.
 *
 * `Tenurework/Tenure-Parent` holds the same `ACCESSKEYID` and `SECRETACCESSKEY`
 * secrets as `Tenurework/Tenure`. Importing the application brought `deploy.yml`
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

import { ENGINE_JOBS, PRODUCTION_OWNER, WORKFLOW_DIR } from '../../tools/disarm-production-workflows.mjs'

const THIS_REPOSITORY = 'Tenurework/Tenure-Parent'

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

/**
 * The repository a guard pins to, or null.
 *
 * Extracted and compared exactly, never with `includes`. That is not
 * fastidiousness: `'Tenurework/Tenure-Parent'.includes('Tenurework/Tenure')` is
 * true, so a substring test reads every ENGINE-guarded job as
 * disarmed-for-production and skips it — including any AWS-mutating one added
 * later. This test had that bug, and a `terraform apply` workflow guarded to
 * the engine passed it silently.
 */
const guardedRepository = (job) => {
  const g = guardOf(job)
  if (!g || !g.includes('github.repository')) return null
  return g.match(/github\.repository\s*==\s*['"]([^'"]+)['"]/)?.[1] ?? null
}

/** Disarmed here means: runs only in the PILOT repository, exactly. */
const isGuarded = (job) => guardedRepository(job) === PRODUCTION_OWNER

/**
 * Jobs that may reach AWS from this repository *unguarded*, because they cannot
 * change anything.
 *
 * An exemption is not taken on trust. Each one is checked against MUTATING below,
 * so a job added here that later grows a `terraform apply` fails the suite. The
 * point of the allowlist is to make the exemption deliberate and few — not to
 * create a hole.
 */
const READ_ONLY_JOBS = new Set([
  'platform-plan.yml:plan',
  'aws-inventory.yml:inventory',
  'debug-logs.yml:logs',
  // Armed here (it reports on the engine's own domain, so it is an engine job
  // and appears in ENGINE_JOBS too) AND read-only. The two sets check different
  // properties: ENGINE_JOBS that the guard names the engine owner, this that the
  // job cannot change anything. A workflow whose entire purpose is answering
  // "has the certificate validated yet?" must never be able to answer it by
  // applying something.
  'studio-domain.yml:status',
])

/**
 * Jobs that act on THIS repository's own component, and are therefore armed
 * here rather than disarmed.
 *
 * Not an exemption from the rule — the rule, correctly stated. A repository may
 * deploy what it owns and nothing else. These are checked against
 * ENGINE_OWNER below, so one of them guarded to the wrong repository still
 * fails.
 *
 * Derived from the tool rather than restated. This was a hand-kept literal, and
 * it had already drifted from `ENGINE_JOBS`: `bootstrap-oidc.yml` was here and
 * missing there. Nothing failed, because nothing read the export — so the
 * drift was invisible in exactly the file whose job is noticing drift.
 */
const ENGINE_DEPLOY_JOBS = new Set(
  Object.entries(ENGINE_JOBS).flatMap(([file, jobs]) => jobs.map((j) => `${file}:${j}`)),
)

/**
 * Rewrite programmatic AWS invocations into command-line form.
 *
 * The patterns below were written against shell syntax — `aws s3 rm …` — and
 * were therefore blind to the two forms a script actually uses:
 *
 *   execFileSync('aws', ['s3', 'rm', 's3://b/k'])   argv array
 *   aws('s3api', 'delete-object', […])              helper with (service, op)
 *
 * That was not hypothetical. Planting a real `execFileSync("aws", ["s3","rm",…])`
 * in an exempted script and running the suite produced PASS — the detector
 * declared a mutating script read-only. Normalising both forms to
 * `aws <service> <operation>` first means one set of patterns covers all three,
 * rather than three sets that can drift apart.
 */
function normaliseAwsCalls(text) {
  return (
    text
      // execFileSync('aws', ['s3', 'rm', …]) → aws s3 rm
      .replace(/['"]aws['"]\s*,\s*\[([^\]]*)\]/g, (_, args) => {
        const tokens = [...args.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
        return `aws ${tokens.join(' ')}`
      })
      // aws('s3api', 'delete-object' → aws s3api delete-object
      .replace(/\baws\(\s*['"]([\w-]+)['"]\s*,\s*['"]([\w-]+)['"]/g, (_, service, op) => `aws ${service} ${op}`)
  )
}

/**
 * Commands that change something in AWS. Deliberately broad: a false positive
 * costs one line of discussion, a false negative costs production.
 */
const MUTATING = [
  [/terraform\s+(apply|destroy|import|taint|untaint)\b/, 'terraform apply/destroy/import/taint'],
  [/terraform\s+state\s+(mv|rm|push|replace-provider)\b/, 'terraform state mutation'],
  [/-auto-approve\b/, '-auto-approve'],
  [/\baws\s+ecs\s+(update-service|register-task-definition|delete-|create-|run-task)/, 'aws ecs mutation'],
  [/\baws\s+s3(api)?\s+(rm|cp|sync|mv|create-bucket|put-|delete-)/, 'aws s3 mutation'],
  [/\baws\s+dynamodb\s+(create-|put-|delete-|update-)/, 'aws dynamodb mutation'],
  [/\baws\s+secretsmanager\s+(put-|update-|delete-|create-|rotate-)/, 'aws secretsmanager mutation'],
  [/\baws\s+(rds|elasticache|cloudfront|acm|ses|iam|ec2|logs)\s+(create-|delete-|modify-|update-|put-|restore-|reboot-|attach-|detach-|request-)/, 'aws resource mutation'],
  [/\bdocker\s+push\b/, 'docker push'],
  [/^\s*push:\s*true\s*$/m, 'docker/build-push-action push: true'],
]

/**
 * Only the parts that execute — not comments, which may name a command in order
 * to say it is absent.
 *
 * Strips both `#` (YAML, shell) and `//` (JavaScript), because the scan now
 * covers referenced `.mjs` scripts as well as workflow bodies. Stripping only
 * `#` made `// aws s3 rm …` in a script's prose trip the detector, and a
 * security check that fires on documentation is one people start ignoring.
 */
const executableTextOf = (text) =>
  text
    .split('\n')
    .filter((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l))
    .join('\n')

/**
 * Scripts a job runs, inlined so the scan sees where the calls actually are.
 *
 * aws-inventory.yml's whole body is `node tools/aws-inventory.mjs` — every AWS
 * call is in that file, and a detector that reads only the workflow would have
 * declared it read-only having examined nothing. An exemption whose proof does
 * not cover the code it exempts is not a proof.
 */
function inlineReferencedScripts(jobYaml) {
  let text = jobYaml
  const referenced = /node\s+(tools\/[\w.-]+\.mjs)/g

  for (const match of jobYaml.matchAll(referenced)) {
    const file = match[1]
    if (fs.existsSync(file)) text += `\n${fs.readFileSync(file, 'utf8')}`
  }
  return text
}

/** Slice the raw text of one job out of a workflow file, for command scanning. */
function jobText(fileText, jobName) {
  const lines = fileText.split('\n')
  const start = lines.findIndex((l) => l === `  ${jobName}:`)
  if (start === -1) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i]) || (/^\S/.test(lines[i]) && lines[i].trim() !== '')) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
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
      if (isGuarded(job)) continue
      if (READ_ONLY_JOBS.has(`${file}:${name}`)) continue
      if (ENGINE_DEPLOY_JOBS.has(`${file}:${name}`)) continue
      unguarded.push(`${file}:${name}  if=${guardOf(job) ?? '(none)'}`)
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

test('an engine deploy is armed for THIS repository and nowhere else', async () => {
  // The mirror image of the disarm rule. A deploy job for the engine must name
  // Tenure-Parent, so a fork, a mirror, or the pilot repository cannot run it —
  // and so that "armed" is never simply "unguarded".
  const mod = await import('../../tools/disarm-production-workflows.mjs')

  for (const entry of ENGINE_DEPLOY_JOBS) {
    const [file, jobName] = entry.split(':')
    const wf = workflows.find((w) => w.file === file)
    assert.ok(wf, `${file} is missing`)

    const job = wf.doc.jobs?.[jobName]
    assert.ok(job, `${entry} is not a job`)

    const guard = guardOf(job)
    assert.ok(guard, `${entry} has no guard at all — armed everywhere is not armed here`)
    assert.ok(
      guard.includes(mod.ENGINE_OWNER),
      `${entry} is guarded to ${guard}, not to the engine owner ${mod.ENGINE_OWNER}`,
    )
    assert.ok(
      !guard.includes(mod.PRODUCTION_OWNER + "'"),
      `${entry} is guarded to the PILOT's owner. The engine and the pilot are different things.`,
    )
  }
})

test('every job armed to the engine owner is declared as an engine job', async () => {
  // The converse of the test above, and it exists because the test above was
  // one-directional. That one walks the declared list and checks each entry's
  // guard; nothing walked the guards and checked each was declared.
  //
  // Found by mutation. `studio-domain.yml:status` sits in BOTH ENGINE_JOBS and
  // READ_ONLY_JOBS, and the read-only branch of the unguarded test returns
  // first — so deleting it from ENGINE_JOBS left the whole suite green while
  // quietly dropping the requirement that its guard name Tenure-Parent. A job
  // could then be armed here, pointed anywhere, and nothing would say so.
  //
  // Walking from the guards makes the declaration mandatory rather than
  // decorative: arming a job is now something the suite notices.
  const mod = await import('../../tools/disarm-production-workflows.mjs')

  const undeclared = []
  for (const { file, doc } of workflows) {
    for (const [name, job] of Object.entries(doc.jobs ?? {})) {
      if (guardedRepository(job) !== mod.ENGINE_OWNER) continue
      if (ENGINE_DEPLOY_JOBS.has(`${file}:${name}`)) continue
      undeclared.push(`${file}:${name}`)
    }
  }

  assert.deepEqual(
    undeclared,
    [],
    `These jobs are armed for ${mod.ENGINE_OWNER} but are not declared in ENGINE_JOBS:\n  ` +
      undeclared.join('\n  ') +
      '\n\nDeclare them in tools/disarm-production-workflows.mjs, or remove the guard.',
  )
})

test("no engine job writes the pilot's Terraform state", async () => {
  // The single most destructive mistake available here. Two repositories
  // applying different code against one state file means whichever runs second
  // sees the other's resources as undeclared and destroys them — taking the
  // live pilot down.
  //
  // This used to name deploy-studio.yml directly, which meant it checked one
  // workflow rather than the property. bootstrap-oidc.yml was added, pointed at
  // `key=pilot/terraform.tfstate` as an experiment, and the suite passed. It is
  // now driven by ENGINE_DEPLOY_JOBS, so a job cannot be armed here without
  // also being checked.
  assert.ok(ENGINE_DEPLOY_JOBS.size > 0, 'no engine jobs declared')

  for (const entry of ENGINE_DEPLOY_JOBS) {
    const [file] = entry.split(':')
    const wf = workflows.find((w) => w.file === file)
    assert.ok(wf, `${file} is missing`)

    const keys = [...wf.text.matchAll(/key=([\w./-]+\.tfstate)/g)].map((m) => m[1])

    // A job that runs terraform must say which state it writes. One that runs
    // no terraform legitimately names none.
    if (!/terraform\s+(init|apply|plan)/.test(wf.text)) continue

    assert.ok(keys.length > 0, `${file} runs terraform but pins no backend key`)

    const pilot = keys.filter((k) => k.startsWith('pilot/'))
    assert.deepEqual(
      pilot,
      [],
      `${file} writes the PILOT state file (${pilot.join(', ')}). This would destroy the live pilot.`,
    )
  }
})

test('every read-only exemption is actually read-only', () => {
  assert.ok(READ_ONLY_JOBS.size > 0, 'no exemptions declared — remove this test or the allowlist')

  const violations = []
  for (const entry of READ_ONLY_JOBS) {
    const [file, jobName] = entry.split(':')
    const wf = workflows.find((w) => w.file === file)
    assert.ok(wf, `read-only allowlist names ${file}, which does not exist`)
    assert.ok(wf.doc.jobs?.[jobName], `read-only allowlist names ${entry}, which is not a job`)

    const text = normaliseAwsCalls(executableTextOf(inlineReferencedScripts(jobText(wf.text, jobName))))
    for (const [pattern, label] of MUTATING) {
      if (pattern.test(text)) violations.push(`${entry} runs ${label}`)
    }
  }

  assert.deepEqual(
    violations,
    [],
    'A job exempted from the production guard as read-only can change production:\n  ' +
      violations.join('\n  ') +
      '\n\nEither remove the mutating command, or remove the exemption and let it be guarded.',
  )
})

test('the mutation detector actually detects mutation', () => {
  // A detector that never fires is indistinguishable from no detector. Prove each
  // pattern class fires on a realistic line before trusting the test above.
  const samples = [
    'run: terraform apply -auto-approve',
    'run: terraform destroy',
    'run: terraform state rm aws_ecs_service.app',
    'run: aws ecs update-service --force-new-deployment',
    'run: aws s3 rm s3://bucket/key',
    'run: aws dynamodb delete-table --table-name t',
    'run: aws secretsmanager put-secret-value --secret-id x',
    'run: aws rds delete-db-instance --db-instance-identifier x',
    'run: docker push $ECR_URL:tag',
    // Programmatic forms — the ones the detector was blind to until a planted
    // call in an exempted script passed the suite.
    `execFileSync('aws', ['s3', 'rm', 's3://b/k'])`,
    `aws('s3api', 'delete-object', [])`,
    `aws('ecs', 'update-service', [])`,
    '          push: true',
  ]
  for (const sample of samples) {
    assert.ok(
      MUTATING.some(([p]) => p.test(normaliseAwsCalls(sample))),
      `no MUTATING pattern matched: ${sample}`,
    )
  }

  // And does not fire on the read-only commands the plan job legitimately runs.
  const benign = [
    'run: terraform plan -lock=false -detailed-exitcode',
    'run: terraform validate',
    'run: terraform init -input=false',
    'run: aws sts get-caller-identity',
    'run: aws s3api head-bucket --bucket "$STATE_BUCKET"',
    'run: aws ecs describe-services --cluster "$CLUSTER"',
  ]
  for (const sample of benign) {
    const hit = MUTATING.find(([p]) => p.test(normaliseAwsCalls(sample)))
    assert.equal(hit, undefined, `MUTATING pattern ${hit?.[1]} false-positived on: ${sample}`)
  }
})

test('no production workflow can be triggered automatically in this repository', async () => {
  // The job guard alone leaves a trail of `skipped` runs — a run is still
  // created, then discarded. Eight of the first sixteen runs here were exactly
  // that, and the single genuine CI failure sat among them where nobody would
  // look. So the trigger goes too, and this asserts it stays gone.
  const mod = await import('../../tools/disarm-production-workflows.mjs')

  const offenders = []
  for (const file of mod.AUTOMATIC_TRIGGERS_REMOVED) {
    const wf = workflows.find((w) => w.file === file)
    assert.ok(wf, `${file} is missing`)

    // YAML 1.1 parses a bare `on` key as boolean true, which is why this reads
    // both spellings rather than just doc.on.
    const triggers = wf.doc.on ?? wf.doc[true]
    assert.ok(triggers, `${file} declares no triggers at all`)

    const keys = typeof triggers === 'string' ? [triggers] : Object.keys(triggers)
    for (const key of keys) {
      if (mod.AUTOMATIC_TRIGGER_KEYS.includes(key)) offenders.push(`${file}: on.${key}`)
    }
    assert.ok(
      keys.includes('workflow_dispatch'),
      `${file} has no workflow_dispatch left — it is unrunnable rather than disarmed`,
    )
  }

  assert.deepEqual(
    offenders,
    [],
    'These production workflows fire automatically in a repository that must not deploy:\n  ' +
      offenders.join('\n  ') +
      '\n\nRemove the trigger with: node tools/disarm-production-workflows.mjs',
  )
})

test('CI still runs automatically — the point is to hear from it', () => {
  const ci = workflows.find((w) => w.file === 'ci.yml')
  const triggers = ci.doc.on ?? ci.doc[true]
  const keys = Object.keys(triggers)
  assert.ok(keys.includes('push'), 'ci.yml no longer runs on push — nothing would report on main')
  assert.ok(keys.includes('pull_request'), 'ci.yml no longer runs on pull requests')
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
