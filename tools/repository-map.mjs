#!/usr/bin/env node
/**
 * Generate the repository map required by GE-000-002.
 *
 * Generated from `git ls-files`, not written by hand. A hand-written map is
 * accurate on the day it is written and wrong from the next commit onward, and
 * the item asks for a map of what is here — which is a question only the tree
 * can answer.
 *
 * Emits both forms the item requires: `docs/architecture/repository-map.json`
 * for machines and `docs/implementation/repository-map.md` for people.
 *
 * Usage: node tools/repository-map.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .map((f) => f.trim())
  .filter(Boolean)

const read = (p) => {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}
const json = (p) => {
  try {
    return JSON.parse(read(p))
  } catch {
    return null
  }
}

/** Workspaces declared at the root, expanded to the directories that exist. */
const rootPkg = json('package.json') ?? {}
const workspaceGlobs = rootPkg.workspaces ?? []

const packageDirs = files
  .filter((f) => f.endsWith('package.json') && f !== 'package.json')
  .map((f) => path.dirname(f))
  .filter((d) => !d.includes('node_modules'))
  .sort()

const under = (dir) => files.filter((f) => f.startsWith(dir + '/'))

const workspaces = packageDirs.map((dir) => {
  const pkg = json(path.join(dir, 'package.json')) ?? {}
  const own = under(dir)
  return {
    dir,
    name: pkg.name ?? '(unnamed)',
    private: pkg.private === true,
    description: pkg.description ?? '',
    scripts: Object.keys(pkg.scripts ?? {}).filter((s) => !s.startsWith('//')),
    dependsOnWorkspaces: Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
      .filter((d) => d.startsWith('@tenure/'))
      .sort(),
    fileCount: own.length,
    testFiles: own.filter((f) => /\.(test|itest|spec)\.[cm]?[jt]sx?$/.test(f)).length,
    hasDockerfile: own.some((f) => f.endsWith('Dockerfile')),
  }
})

const workflows = files
  .filter((f) => f.startsWith('.github/workflows/') && /\.ya?ml$/.test(f))
  .map((f) => {
    const text = read(f)
    const name = /^name:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? path.basename(f)
    const triggers = []
    for (const t of ['push', 'pull_request', 'schedule', 'workflow_dispatch', 'workflow_call']) {
      if (new RegExp(`^\\s{2}${t}:`, 'm').test(text)) triggers.push(t)
    }
    return {
      file: f,
      name,
      triggers,
      // "Reaches AWS" is derived from what the file does, not from a list.
      reachesAws:
        /secrets\.(ACCESSKEYID|SECRETACCESSKEY)/.test(text) ||
        /aws-actions\/configure-aws-credentials/.test(text),
      guardedTo: /github\.repository == '([^']+)'/.exec(text)?.[1] ?? null,
    }
  })

const terraformStacks = [...new Set(files.filter((f) => f.endsWith('.tf')).map((f) => path.dirname(f)))]
  .sort()
  .map((dir) => ({
    dir,
    files: under(dir).filter((f) => f.endsWith('.tf')).length,
    stateKey:
      files
        .filter((f) => f.startsWith('.github/workflows/'))
        .map(read)
        .filter((t) => t.includes(dir))
        .map((t) => /key=([^"\s]+)/.exec(t)?.[1])
        .find(Boolean) ?? '(not referenced by any workflow)',
  }))

const prismaSchemas = files.filter((f) => f.endsWith('schema.prisma')).map((f) => {
  const text = read(f)
  return {
    file: f,
    models: (text.match(/^model\s+\w+/gm) ?? []).length,
    enums: (text.match(/^enum\s+\w+/gm) ?? []).length,
    migrations: files.filter((m) => m.startsWith(path.dirname(f) + '/migrations/') && m.endsWith('migration.sql')).length,
  }
})

const testSuites = [
  { name: 'apps/web unit (jest)', match: (f) => f.startsWith('apps/web/') && /\.test\.[cm]?[jt]sx?$/.test(f) },
  { name: 'apps/web isolation (jest, needs Postgres)', match: (f) => /\.itest\.ts$/.test(f) },
  { name: 'apps/web e2e (playwright)', match: (f) => f.startsWith('apps/web/e2e/') && f.endsWith('.spec.ts') },
  { name: 'system-studio e2e (playwright)', match: (f) => f.startsWith('apps/system-studio/e2e/') && f.endsWith('.spec.ts') },
  { name: 'platform (node:test)', match: (f) => f.startsWith('tests/') && f.endsWith('.test.mjs') },
  { name: 'packages (jest, via apps/web roots)', match: (f) => f.startsWith('packages/') && /\.test\.ts$/.test(f) },
].map((s) => ({ name: s.name, files: files.filter(s.match).length }))

const map = {
  generatedFrom: 'git ls-files',
  totalTrackedFiles: files.length,
  workspaceGlobs,
  workspaces,
  workflows,
  terraformStacks,
  prismaSchemas,
  testSuites,
  docs: {
    architecture: under('docs/architecture').length,
    decisions: under('docs/decisions').length,
    migrations: under('docs/migrations').length,
    implementation: under('docs/implementation').length,
  },
}

fs.mkdirSync('docs/architecture', { recursive: true })
fs.writeFileSync('docs/architecture/repository-map.json', JSON.stringify(map, null, 2) + '\n')

const row = (cells) => `| ${cells.join(' | ')} |`
const md = [
  '# Repository map',
  '',
  '**Generated** by `node tools/repository-map.mjs` from `git ls-files`. Do not edit by hand —',
  'a hand-written map is accurate on the day it is written and wrong from the next commit.',
  'Regenerate it instead. `docs/architecture/repository-map.json` is the machine-readable form.',
  '',
  `Tracked files: **${files.length}**. Workspace globs: \`${workspaceGlobs.join('`, `')}\`.`,
  '',
  '## Workspaces',
  '',
  row(['Directory', 'Package', 'Files', 'Tests', 'Depends on', 'Container']),
  row(['---', '---', '---:', '---:', '---', '---']),
  ...workspaces.map((w) =>
    row([
      `\`${w.dir}\``,
      w.name,
      String(w.fileCount),
      String(w.testFiles),
      w.dependsOnWorkspaces.length ? w.dependsOnWorkspaces.map((d) => `\`${d}\``).join(' ') : '—',
      w.hasDockerfile ? 'yes' : '—',
    ]),
  ),
  '',
  '## Workflows',
  '',
  row(['File', 'Name', 'Triggers', 'Reaches AWS', 'Guarded to']),
  row(['---', '---', '---', '---', '---']),
  ...workflows.map((w) =>
    row([
      `\`${path.basename(w.file)}\``,
      w.name,
      w.triggers.join(', ') || '—',
      w.reachesAws ? '**yes**' : '—',
      w.guardedTo ? `\`${w.guardedTo}\`` : '—',
    ]),
  ),
  '',
  '## Infrastructure stacks',
  '',
  row(['Directory', '.tf files', 'State key']),
  row(['---', '---:', '---']),
  ...terraformStacks.map((s) => row([`\`${s.dir}\``, String(s.files), `\`${s.stateKey}\``])),
  '',
  '## Database',
  '',
  row(['Schema', 'Models', 'Enums', 'Migrations']),
  row(['---', '---:', '---:', '---:']),
  ...prismaSchemas.map((p) => row([`\`${p.file}\``, String(p.models), String(p.enums), String(p.migrations)])),
  '',
  '## Test suites',
  '',
  row(['Suite', 'Files']),
  row(['---', '---:']),
  ...testSuites.map((t) => row([t.name, String(t.files)])),
  '',
]

fs.mkdirSync('docs/implementation', { recursive: true })
fs.writeFileSync('docs/implementation/repository-map.md', md.join('\n'))

console.log(`repository-map: ${files.length} files, ${workspaces.length} workspaces, ${workflows.length} workflows`)
