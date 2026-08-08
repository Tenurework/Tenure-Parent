/**
 * GE-012-001 — business code does not hard-code where it is running.
 *
 * A region, an account id, a partition or a service endpoint written into a
 * module is a fact about the estate compiled into the product. The failure it
 * produces is the quiet kind: a cell in `eu-west-1` whose `AWS_REGION` is unset
 * does not error, it talks to `us-east-1` — writing objects, invoking models
 * and emitting logs in a region the tenant's residency did not permit.
 * `GE-030-001` made residency a checked constraint on the registry record, and
 * a `?? "us-east-1"` in a client constructor walks straight around it.
 *
 * So the estate is resolved once, in `lib/cell-context.ts`, which fails closed
 * in production. This is the guard that keeps it the only place.
 *
 * Deliberately narrow: it looks for the two things that actually cause the bug
 * — a literal region name and a literal twelve-digit account — in code that
 * runs. A broad "no strings that look like configuration" rule would fire on
 * every ARN in a comment and be turned off within a week.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Where business code lives.
 *
 * `infrastructure/` is excluded because Terraform IS where the estate is
 * described — a region literal there is the point. Tests and fixtures are
 * excluded because naming a region is how you write a test about regions.
 */
const ROOTS = ['apps/web/src', 'apps/system-studio/src', 'packages']

const EXEMPT = [
  // The one module allowed to know: it resolves the estate and fails closed.
  'apps/web/src/lib/cell-context.ts',
  // The cell registry's shape — declaring what a region field IS.
  'packages/provisioning/src/cell-registry.ts',
]

/*
 * `apps/system-studio/src/lib/cells.ts` used to be here, exempted because it
 * "reads its own values from the environment and validates them". It read them
 * from the environment WITH DEFAULTS — `env("AWS_REGION", "us-east-1")`,
 * `env("AWS_ACCOUNT_ID", "<a literal twelve-digit account>")` and
 * `env("AWS_PARTITION", "aws")` — which is precisely the defect this suite
 * exists to find, sitting inside the exemption that stopped it looking.
 *
 * STUDIO-000-006 removed the three defaults: the values come from the
 * environment, then from `sts:GetCallerIdentity`, and then from nowhere —
 * `fleet()` refuses with `FleetMisconfigured` rather than placing a tenant in an
 * estate nobody chose. The exemption is deleted rather than reworded, and this
 * note is here so it is not quietly restored.
 */

const REGION = /["'`](us|eu|ap|sa|ca|me|af|il)-(gov-)?[a-z]+-\d["'`]/
const ACCOUNT = /["'`]\d{12}["'`]/

function sourceFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      out.push(...sourceFiles(full))
      continue
    }
    if (!/\.(ts|tsx|mjs)$/.test(entry.name)) continue
    // A test naming a region is a test about regions.
    if (/\.(test|itest|spec)\.[tm]sx?$/.test(entry.name)) continue
    if (EXEMPT.includes(full)) continue
    out.push(full)
  }
  return out
}

const files = ROOTS.filter((r) => fs.existsSync(r)).flatMap(sourceFiles)

/** Strip comments — a region in prose explaining the rule is not the bug. */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n')
}

test('no module hard-codes an AWS region', () => {
  const offenders = []
  for (const file of files) {
    const text = code(fs.readFileSync(file, 'utf8'))
    text.split('\n').forEach((line, i) => {
      if (REGION.test(line)) offenders.push(`${file}:${i + 1} ${line.trim().slice(0, 90)}`)
    })
  }

  assert.deepEqual(
    offenders,
    [],
    `A region literal in code that runs:\n  ${offenders.join('\n  ')}\n\n` +
      `Resolve it through lib/cell-context.ts, which fails closed in production. ` +
      `A default region does not error — it moves data to a region the tenant's residency did not permit, ` +
      `and the breach is found by an audit rather than by the software.`,
  )
})

test('no module hard-codes an AWS account id', () => {
  const offenders = []
  for (const file of files) {
    const text = code(fs.readFileSync(file, 'utf8'))
    text.split('\n').forEach((line, i) => {
      if (ACCOUNT.test(line)) offenders.push(`${file}:${i + 1} ${line.trim().slice(0, 90)}`)
    })
  }

  assert.deepEqual(
    offenders,
    [],
    `An account id in code that runs:\n  ${offenders.join('\n  ')}\n\n` +
      `Compiling an account number into the product means the product only works in that account, ` +
      `and says so nowhere.`,
  )
})

test('the exemption list only names modules that exist', () => {
  // An exemption for a deleted file is an exemption that silently covers
  // whatever is written at that path next.
  for (const file of EXEMPT) {
    assert.ok(fs.existsSync(file), `${file} is exempt and does not exist — remove the exemption`)
  }
})
