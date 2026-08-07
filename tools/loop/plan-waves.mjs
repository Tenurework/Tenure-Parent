/**
 * Turns the harvested survey queue into waves of work that cannot collide.
 *
 * Two agents editing one file in a shared working tree is how a parallel run
 * produces a tree nobody can verify, so ownership is decided here, before any
 * agent starts, rather than hoped for afterwards. An item whose files are
 * already claimed is deferred to a later wave — never dropped silently, because
 * a queue that quietly shrinks reads as "finished".
 */
import { readFileSync, writeFileSync } from 'node:fs'

const QUEUE = JSON.parse(readFileSync('tools/loop/harvested-queue.json', 'utf8'))
/**
 * Repo-relative, always.
 *
 * Some surveyors returned absolute paths, which made "C:/Users" the single
 * largest owned area — a bucket that would have handed one agent files from
 * every corner of the tree. Ownership is decided by path prefix, so a path
 * that does not start at the repo root silently defeats it.
 */
const ROOT = process.cwd().split('\\').join('/').replace(/\/+$/, '')
function norm(f) {
  let s = String(f).split('\\').join('/')
  if (s.toLowerCase().startsWith(ROOT.toLowerCase() + '/')) s = s.slice(ROOT.length + 1)
  return s.replace(/^\.\//, '')
}

/** Directory that owns a file, at the depth where areas stop overlapping. */
function areaOf(file) {
  const p = norm(file).split('/')
  if (p[0] === 'packages') return `packages/${p[1]}`
  if (p[0] === 'apps' && p[1] === 'system-studio') return 'apps/system-studio'
  if (p[0] === 'apps' && p[1] === 'web') {
    // apps/web/src/lib/<x> is where the queue concentrates, so it splits there.
    if (p[2] === 'src' && p[3] === 'lib') return p[5] ? `apps/web/src/lib/${p[4]}` : 'apps/web/src/lib'
    if (p[2] === 'src' && p[3] === 'app') return 'apps/web/src/app'
    return 'apps/web/other'
  }
  return p.slice(0, 2).join('/')
}

const histogram = new Map()
for (const it of QUEUE) {
  for (const f of it.files || []) histogram.set(areaOf(f), (histogram.get(areaOf(f)) || 0) + 1)
}

if (process.argv.includes('--histogram')) {
  for (const [k, v] of [...histogram].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(String(v).padStart(4), k)
  }
  process.exit(0)
}

const PER_WAVE = Number(process.env.PER_WAVE || 8)
const MAX_AREAS = Number(process.env.MAX_AREAS || 4)

// An item belongs to a single area only if every file it touches is in it.
// Anything spanning areas is left out: it needs a decision, not a race.
const byArea = new Map()
const spanning = []
for (const it of QUEUE) {
  const files = (it.files || []).map(norm)
  if (files.length === 0) continue
  const areas = new Set(files.map(areaOf))
  if (areas.size !== 1) {
    spanning.push(it.id)
    continue
  }
  const a = [...areas][0]
  if (!byArea.has(a)) byArea.set(a, [])
  byArea.get(a).push(it)
}

const ranked = [...byArea.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_AREAS)

const waves = ranked.map(([area, items]) => {
  const claimed = new Set()
  const picked = []
  for (const it of items) {
    const files = (it.files || []).map(norm)
    if (files.some((f) => claimed.has(f))) continue
    files.forEach((f) => claimed.add(f))
    picked.push({
      id: it.id,
      title: it.title,
      why_open: it.why_open,
      smallest_real_change: it.smallest_real_change,
      files,
    })
    if (picked.length >= PER_WAVE) break
  }
  return { area, owns: [`${area}/**`], items: picked, deferred: items.length - picked.length }
})

writeFileSync('tools/loop/wave-plan.json', JSON.stringify(waves, null, 1))
for (const w of waves) {
  console.log(`${w.area}  picked=${w.items.length}  deferred_for_file_overlap=${w.deferred}`)
  console.log('   ' + w.items.map((i) => i.id).join(' '))
}
console.log(`spanning-areas (left for a human decision): ${spanning.length}`)
