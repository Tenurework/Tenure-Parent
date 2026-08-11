/**
 * The web app build must not fetch font files from a third-party service.
 *
 * `next/font/google` downloads Google font assets during `next build`. That is
 * a legitimate optimization for some deployments, but it made the Docker image
 * build depend on `fonts.gstatic.com` being reachable from GitHub-hosted
 * runners. A transient fetch failure should not block promotion.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const WEB_SRC = path.join('apps', 'web', 'src')

function sourceFiles(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.next' || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...sourceFiles(full))
      continue
    }
    if (/\.(?:[cm]?[jt]sx?|css)$/.test(entry.name)) files.push(full)
  }
  return files
}

test('web source does not import build-time remote Google fonts', () => {
  const remoteFontImport = /^\s*(?:import|export)\b[\s\S]*?\bfrom\s*['"]next\/font\/google['"]/m
  const offenders = sourceFiles(WEB_SRC)
    .filter((file) => remoteFontImport.test(fs.readFileSync(file, 'utf8')))
    .map((file) => file.replaceAll(path.sep, '/'))

  assert.deepEqual(
    offenders,
    [],
    `Remote build-time font imports make Docker promotion depend on Google font fetches:\n  ${offenders.join('\n  ')}`,
  )
})
