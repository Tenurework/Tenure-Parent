/**
 * GE-143-001. The UI-stack inventory is re-derived, not believed.
 *
 * `docs/architecture/tes-ui-stack-inventory.md` is a claim about this repository:
 * these are the implementations of each UI concern, this package is declared and
 * never imported, this much of the surface bypasses the token system. Every one
 * of those claims rots the moment somebody adds a component, removes a
 * dependency or writes a hex colour into a class list — and an inventory nobody
 * re-derives is indistinguishable from a plausible paragraph.
 *
 * So the document is generated, and this asserts what the generator cannot
 * assert about itself:
 *
 *   1. It is current — `--check` re-runs the scan in a subprocess and compares.
 *   2. Every repository path it names exists. A citation to a deleted file is
 *      how an inventory becomes fiction while still looking measured.
 *   3. Every concern the requirement's sentence names has a row.
 *   4. The detectors are not vacuous. This is the case that matters: a probe
 *      that returned false for everything, an accessibility scan that found
 *      nothing and a similarity function that returned 0 would produce a
 *      confident empty document and pass 1, 2 and 3. Each is therefore run
 *      against a fixture that MUST trip it.
 *   5. Zero is reported as a measurement rather than an omission — the a11y and
 *      drift tables carry a row per signal per application whatever the count.
 *
 * Runner: `node --test` over `tests/**` — i.e. `npm run test:platform`. Bare
 * node, no jest globals, no TypeScript.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { test } from "node:test"

import {
  A11Y_SIGNALS,
  APPS,
  CONCERNS,
  DRIFT_SIGNALS,
  NEAR_DUPLICATE,
  OUT,
  ROOT,
  collect,
  copiedComponents,
  importerCounts,
  jaccard,
  render,
  riskBand,
  shingles,
} from "../../tools/tes-ui-stack-inventory.mjs"

const DOC = path.join(ROOT, OUT)
const TOOL = path.join(ROOT, "tools/tes-ui-stack-inventory.mjs")

test("the committed inventory is current", () => {
  execFileSync(process.execPath, [TOOL, "--check"], { cwd: ROOT, stdio: "pipe" })
})

test("every repository path it names exists", () => {
  const text = fs.readFileSync(DOC, "utf8")
  const cited = new Set(
    [...text.matchAll(/`((?:apps|packages|tools|docs)\/[A-Za-z0-9_./[\]()-]+)`/g)].map((m) => m[1]),
  )
  assert.ok(cited.size > 20, `expected the inventory to cite many paths, found ${cited.size}`)
  const missing = [...cited].filter((p) => !fs.existsSync(path.join(ROOT, p)))
  assert.deepEqual(missing, [])
})

test("every concern the requirement names has a row", () => {
  // The requirement's own list, in its own words.
  const named = [
    "UI stack",
    "Component library",
    "CSS strategy",
    "Font",
    "Icon set",
    "Table / grid",
    "Chart library",
    "Editor",
    "Calendar",
    "Dialog",
    "Theme",
    "Breakpoint",
  ]
  assert.deepEqual(
    CONCERNS.map((c) => c.label),
    named,
  )
  const text = fs.readFileSync(DOC, "utf8")
  for (const app of APPS) {
    const section = text.split(`### ${app.label}`)[1] ?? ""
    for (const label of named) {
      assert.ok(section.includes(`| ${label} |`), `${app.label} has no row for ${label}`)
    }
  }
})

test("every concern probe finds at least one implementation somewhere", () => {
  // A probe that matches nothing is a concern reported ABSENT in both
  // applications, which reads as "the product has no dialogs" rather than as
  // "the detector is broken".
  const data = collect()
  const dead = CONCERNS.filter((concern) =>
    data.apps.every((app) => app.concerns.find((c) => c.id === concern.id).implementations.length === 0),
  ).map((c) => c.id)
  assert.deepEqual(dead, [])
})

test("the accessibility scan trips on markup that should trip it", () => {
  const bad = {
    "icon-only-control-without-a-name": '<button className="x"><Trash2 size={14} /></button>',
    "image-without-alt-text": '<img src="/logo.png" className="h-4" />',
    "positive-tabindex": '<input tabIndex={3} />',
    "click-handler-on-a-non-interactive-element": '<div onClick={() => open()}>Open</div>',
  }
  const good = {
    "icon-only-control-without-a-name": '<button aria-label="Delete"><Trash2 size={14} /></button>',
    "image-without-alt-text": '<img src="/logo.png" alt="Tenure" />',
    "positive-tabindex": '<input tabIndex={-1} />',
    "click-handler-on-a-non-interactive-element": '<div role="button" tabIndex={0} onClick={() => open()}>Open</div>',
  }
  for (const signal of A11Y_SIGNALS) {
    assert.equal(signal.find(bad[signal.id]).length, 1, `${signal.id} missed its own defect`)
    assert.equal(signal.find(good[signal.id]).length, 0, `${signal.id} fired on correct markup`)
  }
})

test("the drift scan trips on values that bypass the token system", () => {
  const bad = {
    "literal-colour": 'const c = "#198052"',
    "arbitrary-length-in-a-class": '<p className="text-[13px]" />',
    "inline-style-object": "<p style={{ color: 'red' }} />",
  }
  const good = {
    "literal-colour": 'const c = "var(--primary)"',
    "arbitrary-length-in-a-class": '<p className="text-sm" />',
    "inline-style-object": '<p className="text-sm" />',
  }
  for (const signal of DRIFT_SIGNALS) {
    assert.equal(signal.find(bad[signal.id]).length, 1, `${signal.id} missed its own defect`)
    assert.equal(signal.find(good[signal.id]).length, 0, `${signal.id} fired on a tokenised value`)
  }
})

test("the similarity comparator says a copy is a copy", () => {
  // A component's worth of code, copied and renamed — which is what "copied
  // component" means in practice. Two lines with one identifier changed is a
  // different question and the threshold is not tuned for it.
  const original = `
    export function BudgetPanel({ title, rows, onSelect }) {
      const total = rows.reduce((sum, row) => sum + row.amountCents, 0)
      const sorted = [...rows].sort((a, b) => b.amountCents - a.amountCents)
      if (rows.length === 0) return <EmptyState title={title} />
      return (
        <section className="rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold">{title}</h2>
          <ul>
            {sorted.map((row) => (
              <li key={row.id} onClick={() => onSelect(row.id)}>{row.label}</li>
            ))}
          </ul>
          <p className="tabular-nums">{formatCents(total)}</p>
        </section>
      )
    }
  `
  const copy = original.replace(/BudgetPanel/g, "ForecastPanel")
  const unrelated = `
    export async function loadTenant(slug) {
      const record = await db.institution.findUnique({ where: { slug } })
      if (!record) throw new Error("no tenant")
      return record
    }
  `
  assert.ok(
    jaccard(shingles(original), shingles(copy)) >= NEAR_DUPLICATE,
    "a renamed copy was not recognised as a copy",
  )
  assert.ok(
    jaccard(shingles(original), shingles(unrelated)) < 0.1,
    "two unrelated modules were called similar",
  )
  // And the pair walker reports what the comparator finds, over real paths.
  const files = ["apps/x/src/components/A.tsx", "apps/x/src/components/B.tsx"]
  const texts = new Map([
    [files[0], original],
    [files[1], copy],
  ])
  const { pairs, closest } = copiedComponents(files, texts)
  assert.equal(pairs.length, 1)
  assert.equal(closest.a, files[0])
})

test("importer counts are by use, and a module is never its own importer", () => {
  const files = ["a/src/components/Button.tsx", "a/src/app/page.tsx", "a/src/app/other.tsx"]
  const texts = new Map([
    [files[0], 'export function Button() { return null }\nimport x from "./Button"'],
    [files[1], 'import { Button } from "@/components/ui/Button"'],
    [files[2], 'import "./globals.css"\nimport { Button } from "../components/Button"'],
  ])
  const counts = importerCounts(files, texts)
  assert.equal(counts.get(files[0]), 2)
})

test("the risk band is a stated rule, applied", () => {
  assert.match(riskBand(0, 0), /^NONE/)
  assert.match(riskBand(1, 20), /^LOW/)
  assert.match(riskBand(1, 21), /^MEDIUM/)
  assert.match(riskBand(5, 0), /^MEDIUM/)
  assert.match(riskBand(6, 0), /^HIGH/)
})

test("a signal that found nothing is still reported", () => {
  const text = fs.readFileSync(DOC, "utf8")
  for (const app of APPS) {
    for (const signal of [...A11Y_SIGNALS, ...DRIFT_SIGNALS]) {
      assert.ok(
        text.includes(`| ${app.id} | ${signal.id} |`),
        `${app.id} has no row for ${signal.id} — a zero must be stated, not omitted`,
      )
    }
  }
})

test("GE-143-007 — no icon-only control in either application lacks a name", () => {
  // The semantic-icon-label clause, enforced through the signal that already
  // measures it rather than through a second copy of the same scan in
  // `apps/web/src/components/ui/icon-family.ts`, which cites this assertion.
  // An icon-only control announces itself as "button" and nothing else.
  const data = collect()
  const offenders = data.apps.flatMap((app) => {
    const signal = app.a11y.find((s) => s.id === "icon-only-control-without-a-name")
    return signal.count === 0 ? [] : [`${app.id}: ${signal.count} — first at ${signal.first.file}`]
  })
  assert.deepEqual(offenders, [])
})

test("rendering is deterministic", () => {
  const data = collect()
  assert.equal(render(data), render(collect()))
})
