#!/usr/bin/env node
/**
 * Run the monorepo-level tests under tests/, on any supported Node.
 *
 * Why this is not just `node --test <glob>` in package.json: glob expansion in
 * the test runner is a Node 22 feature. CI pins Node 20 (`.github/workflows/ci.yml`,
 * `setup-node` → `node-version: 20`), where the same string is taken as a literal
 * path and the run fails with
 *
 *     Could not find '/home/runner/work/Tenure-Parent/Tenure-Parent/tests/**\/*.test.mjs'
 *
 * — which is exactly how it first failed. `package.json` declares `engines.node: >=20`,
 * so the runner has to work on 20, not just on whatever is installed locally.
 *
 * Passing a directory is not a portable answer either: on some builds
 * `node --test tests` is resolved as a module to execute and exits 1 with
 * "Cannot find module". Discovering the files here and passing explicit paths
 * avoids both, and needs nothing outside the standard library.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'tests'

/** Recursive, without fs.readdirSync({recursive}) — that is Node 18.17+, and being explicit costs nothing. */
function discover(dir, found = []) {
  if (!fs.existsSync(dir)) return found
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) discover(p, found)
    else if (/\.test\.(mjs|js)$/.test(entry.name)) found.push(p)
  }
  return found
}

const files = discover(ROOT).sort()

if (files.length === 0) {
  // Not "0 tests passed". A test directory that discovers nothing is a broken
  // harness, and reporting it as success is how a suite silently stops running.
  console.error(`No test files found under ${ROOT}/. Expected *.test.mjs.`)
  process.exit(1)
}

console.log(`Running ${files.length} platform test file(s):`)
for (const f of files) console.log(`  ${f}`)
console.log()

const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(res.status ?? 1)
