import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

/**
 * STUDIO-070-002 — the tag contract, checked against the Terraform that has to
 * carry it.
 *
 * The declaration lives in `packages/provisioning/src/resource-tags.ts`. This
 * file is the half that reaches infrastructure: a contract only the application
 * knows about is a contract the estate does not have, and a resource ships
 * untagged with nothing failing.
 *
 * The required key list is READ OUT of the TypeScript source rather than
 * repeated here. Repeating it would produce a test that passes while the two
 * lists disagree, which is the failure mode this whole requirement was opened
 * against: a tag key that exists in prose and nowhere that can refuse anything.
 */

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const TAG_SOURCE = path.join(ROOT, 'packages', 'provisioning', 'src', 'resource-tags.ts')

/** The twelve keys, parsed from the array that declares them. */
function requiredTagKeys() {
  const source = fs.readFileSync(TAG_SOURCE, 'utf8')
  const block = source.match(
    /export const REQUIRED_RESOURCE_TAGS = \[([\s\S]*?)\] as const/,
  )
  assert.ok(block, `REQUIRED_RESOURCE_TAGS is not declared in ${TAG_SOURCE}`)
  const keys = [...block[1].matchAll(/"(tenure:[a-z-]+)"/g)].map((m) => m[1])
  assert.equal(
    keys.length,
    12,
    `The requirement names twelve tags; ${keys.length} are declared. If the vocabulary genuinely ` +
      `changed, change it here too — do not widen the count to make this pass.`,
  )
  return keys
}

function tfFiles(dir) {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return []
  // Forward slashes, always. `path.join` produces backslashes on Windows and
  // the recorded baseline below is written with `/`, so joining natively made
  // every site look unrecorded on one platform and recorded on the other — a
  // ratchet that only holds on CI is not a ratchet.
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith('.tf'))
    .map((f) => `${dir}/${f}`)
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/**
 * Every place a `tags` attribute is assigned a literal object.
 *
 * `tags = local.tags` and `tags = merge(local.tags, …)` are the compliant
 * forms — the contract is in `local.tags` and merging carries it. A literal
 * `tags = {` is a resource writing its own tag set, which is exactly how the
 * fourteen bare `Name`-only resources in the pilot stack came to exist.
 */
function literalTagBlocks(rel) {
  const found = []
  read(rel)
    .split('\n')
    .forEach((line, i) => {
      const m = line.match(/^\s*tags\s*=\s*\{/)
      if (m) found.push(`${rel}:${i + 1}`)
    })
  return found
}

/** Whether a `locals`/`default_tags` block in this file declares every required key. */
function keysMissingFrom(rel, keys, anchor) {
  const source = read(rel)
  const start = source.indexOf(anchor)
  assert.ok(start >= 0, `${rel} no longer contains ${anchor}`)
  // Presence over the whole file rather than a brace-matched slice: matching
  // HCL braces with a regex is the kind of parser that is wrong on the day it
  // matters, and these keys appear nowhere else in a .tf file.
  return keys.filter((k) => !source.includes(`"${k}"`))
}

test('the studio stack tags every resource with all twelve required keys', () => {
  const keys = requiredTagKeys()
  const missing = keysMissingFrom('infrastructure/studio/main.tf', keys, 'locals {')
  assert.deepEqual(
    missing,
    [],
    `infrastructure/studio/main.tf declares local.tags, which is merged into every resource in the ` +
      `stack. These required keys are not in it: ${missing.join(', ')}.`,
  )
})

test('the pilot stack carries all twelve required keys in default_tags', () => {
  const keys = requiredTagKeys()
  const missing = keysMissingFrom('infrastructure/terraform/main.tf', keys, 'default_tags {')
  assert.deepEqual(
    missing,
    [],
    `infrastructure/terraform has no local.tags; the contract reaches its resources through the ` +
      `provider's default_tags. Missing: ${missing.join(', ')}.`,
  )
})

test('the tenant tag is set to the shared sentinel, not left off', () => {
  // The distinction the whole file turns on. A control-plane resource that is
  // merely untagged and one that says "shared" are indistinguishable to any
  // reader, and only one of them was a decision.
  const sentinel = read('packages/provisioning/src/resource-tags.ts').match(
    /export const SHARED = "([^"]+)"/,
  )
  assert.ok(sentinel, 'SHARED is no longer declared in resource-tags.ts')

  for (const rel of ['infrastructure/studio/main.tf', 'infrastructure/terraform/main.tf']) {
    const source = read(rel)
    const line = source
      .split('\n')
      .find((l) => l.includes('"tenure:tenant"'))
    assert.ok(line, `${rel} does not set "tenure:tenant" at all.`)
    assert.match(
      line,
      new RegExp(sentinel[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${rel} sets "tenure:tenant" to something other than the shared sentinel "${sentinel[1]}". ` +
        `A control-plane or pooled resource belongs to no tenant, and saying so explicitly is what ` +
        `stops it being spread across every customer's bill.`,
    )
  }
})

/**
 * The bare-`Name` resources that already existed, recorded exactly.
 *
 * These are NOT exceptions to the contract — every one of them is covered by
 * `default_tags` in `infrastructure/terraform/main.tf`, which the test above
 * proves carries all twelve keys. They are recorded because a resource writing
 * its own `tags` block is the shape that CAN drop the contract (a literal
 * `tags` block wins over `default_tags` for any key it repeats), and a new one
 * appearing should be a decision somebody makes on purpose.
 *
 * The rule is deliberately not widened to "a literal tags block is fine". That
 * would make the check pass forever and prove nothing.
 */
const RECORDED_LITERAL_TAG_BLOCKS = [
  // Pilot stack — covered by provider default_tags.
  'infrastructure/terraform/acm.tf:20',
  'infrastructure/terraform/cloudfront.tf:134',
  'infrastructure/terraform/elasticache.tf:31',
  'infrastructure/terraform/rds.tf:5',
  'infrastructure/terraform/rds.tf:61',
  'infrastructure/terraform/security_groups.tf:37',
  'infrastructure/terraform/security_groups.tf:62',
  'infrastructure/terraform/security_groups.tf:79',
  'infrastructure/terraform/security_groups.tf:96',
  'infrastructure/terraform/vpc.tf:6',
  'infrastructure/terraform/vpc.tf:18',
  'infrastructure/terraform/vpc.tf:29',
  'infrastructure/terraform/vpc.tf:35',
  'infrastructure/terraform/vpc.tf:47',
  'infrastructure/terraform/vpc.tf:59',
]

/**
 * Stacks whose resources are not part of the tenant-attribution surface.
 *
 * `infrastructure/oidc` provisions GitHub Actions' IAM roles and an OIDC
 * provider in the deploy account. They hold no data, serve no tenant and cost
 * nothing, so the twelve keys would be twelve constants nobody reads. Named
 * here rather than silently skipped: the day that stack creates something that
 * costs money, this list is where somebody has to argue for it.
 */
const OUT_OF_ATTRIBUTION_SCOPE = ['infrastructure/oidc']

test('no resource writes its own tag block outside the recorded baseline', () => {
  const dirs = ['infrastructure/studio', 'infrastructure/terraform', 'infrastructure/oidc']
  const found = []
  for (const dir of dirs) {
    if (OUT_OF_ATTRIBUTION_SCOPE.includes(dir)) continue
    for (const file of tfFiles(dir)) found.push(...literalTagBlocks(file))
  }

  // The two `locals`/provider blocks are where the contract is DECLARED, not a
  // resource writing its own.
  const declarations = new Set([
    ...literalTagBlocks('infrastructure/studio/main.tf'),
    ...literalTagBlocks('infrastructure/terraform/main.tf'),
  ])

  const unrecorded = found
    .filter((site) => !declarations.has(site))
    .filter((site) => !RECORDED_LITERAL_TAG_BLOCKS.includes(site))

  assert.deepEqual(
    unrecorded,
    [],
    `These resources write their own tags instead of merging the stack's contract:\n  ` +
      unrecorded.join('\n  ') +
      `\nUse merge(local.tags, { Name = … }) — or, if this is the pilot stack where the contract ` +
      `lives in provider default_tags, add the site to RECORDED_LITERAL_TAG_BLOCKS with a reason. ` +
      `Do not delete this assertion.`,
  )
})

test('the recorded baseline still describes real lines, and has not grown', () => {
  // A baseline nobody re-checks becomes a list of line numbers that drifted off
  // the resources they named. Each recorded site is re-read and must still be a
  // literal tags block.
  for (const site of RECORDED_LITERAL_TAG_BLOCKS) {
    const [rel, lineNo] = site.split(':')
    const line = read(rel).split('\n')[Number(lineNo) - 1]
    assert.match(
      line ?? '',
      /^\s*tags\s*=\s*\{/,
      `${site} is recorded as a bare tags block and is not one any more. Re-derive the baseline ` +
        `rather than leaving a stale exemption in place.`,
    )
  }

  assert.equal(
    RECORDED_LITERAL_TAG_BLOCKS.length,
    15,
    'The baseline is a ratchet. It may shrink; growing it is a decision, not a fix for a red test.',
  )
})
