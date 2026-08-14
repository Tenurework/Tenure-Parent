import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * TTES-000-004 — the audit is a claim about the tenant product, and this is what
 * makes the claim falsifiable.
 *
 * Five distinct failures, and the third is the one this repository keeps
 * shipping:
 *
 *   1. **Stale.** The document describes a tree that no longer exists. Caught by
 *      re-running the generator with `--check` and comparing bytes.
 *   2. **Fictional.** A row names a file nobody has — the single most likely way
 *      a "derived" document turns out to have been assembled from the Bible's
 *      own wording. Caught by opening every path the document cites.
 *   3. **Empty.** The extractor breaks, produces nothing, writes an empty
 *      document, and `--check` compares empty against empty and passes. A
 *      staleness check ALONE has this shape — it is the guard-that-cannot-fail —
 *      so every section carries a floor pinned to the structure it reads: three
 *      persona enums, the base `:root` block, the two `prefers-contrast` scopes,
 *      one row per tenant page.
 *   4. **Silently narrowed.** A check whose regex stops matching reports zero
 *      hits and reads as a clean bill of health. So the a11y section is asserted
 *      to name every check that exists, and the activation map is asserted to
 *      cover every token scope the stylesheet declares — the two places where
 *      "found nothing" and "looked for nothing" are indistinguishable in the
 *      rendered document.
 *   5. **Checkout-dependent.** A generated artefact that is current here and
 *      stale in CI. Caught by refusing a backslash path or a CR byte in the
 *      output, and by regenerating twice in-process and comparing.
 *
 * Run under `node --test` (`npm run test:platform`): no TypeScript, no jest
 * globals, bare node only.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const DOC = "docs/architecture/ttes-experience-audit.md"
const TOOL = "tools/ttes-experience-audit.mjs"

const doc = () => fs.readFileSync(path.join(ROOT, DOC), "utf8").replace(/\r\n/g, "\n")

const mod = await import(`file://${path.join(ROOT, TOOL).split(path.sep).join("/")}`)

/**
 * Every backticked repository path in the document.
 *
 * A directory separator is required. Without it the prose "an `<img>` with no
 * `alt`" is read as a path, reported missing, and the first thing this guard
 * ever says is a false positive — which is how a guard gets ignored.
 */
export function citedPaths(text) {
  const out = new Set()
  for (const m of text.matchAll(
    /`([\w.[\]()@ -]+(?:\/[\w.[\]()@ -]+)+\.(?:ts|tsx|mjs|css|md|prisma))(?::\d+)?`/g,
  )) {
    out.add(m[1])
  }
  return [...out].sort()
}

test("the committed audit matches what the generator produces now", () => {
  // The subprocess with `--check`, deliberately: a test that regenerated the
  // file would heal the staleness it exists to report, and would pass against a
  // tree whose guards had just been deleted.
  execFileSync("node", [TOOL, "--check"], { cwd: ROOT, stdio: "pipe" })
})

test("every path the audit cites exists", () => {
  const missing = citedPaths(doc()).filter((p) => !fs.existsSync(path.join(ROOT, p)))
  assert.deepEqual(
    missing,
    [],
    "The audit cites a path that is not in the tree. A derived document that names a file " +
      "nobody has was not derived from this tree.",
  )
})

test("the audit is byte-stable and platform-neutral", () => {
  const raw = fs.readFileSync(path.join(ROOT, DOC), "utf8")
  assert.equal(raw.includes("\r"), false, `${DOC} carries a CR byte; it will differ in CI.`)
  assert.equal(
    /`[\w.[\]-]+\\[\w.[\]-]+`/.test(raw),
    false,
    `${DOC} cites a backslash-separated path. Paths must be POSIX-normalised or the document ` +
      `is current on Windows and stale on Linux.`,
  )

  // Twice in-process, so a `readdirSync` order that leaked into the output — the
  // classic checkout-dependent artefact — cannot hide behind a single run.
  assert.equal(mod.render(mod.collect()), mod.render(mod.collect()))
})

test("the persona section reads all three enums and every value in them", () => {
  const a = mod.collect()
  assert.deepEqual(
    [...new Set(a.personas.map((p) => p.enumName))].sort(),
    ["AssignmentStatus", "InstitutionRole", "RoleScope"],
    "A persona in this product is role × seat scope × assignment state. Dropping one enum " +
      "reduces the audit to a partial vocabulary that still renders as a full table.",
  )
  assert.ok(
    a.personas.length >= 9,
    `Only ${a.personas.length} persona values were read from the schema; the three enums declare ` +
      `at least 9 between them. An enum parser that returns a short list produces a table that ` +
      `looks complete.`,
  )
  for (const p of a.personas) {
    const line = fs.readFileSync(path.join(ROOT, mod.SCHEMA), "utf8").replace(/\r\n/g, "\n").split("\n")[
      p.line - 1
    ]
    assert.ok(
      line.includes(p.value),
      `${mod.SCHEMA}:${p.line} does not declare \`${p.value}\`. The cited line is the evidence; a ` +
        `line number that points at the wrong row is a citation nobody can follow.`,
    )
  }
})

test("the theme section finds the scopes the stylesheet actually declares", () => {
  const a = mod.collect()
  const keys = a.themes.map((t) => t.key)

  for (const required of [
    ":root",
    "html.dark",
    ':root[data-density="compact"]',
    ":root @media (prefers-contrast: more)",
    "html.dark @media (prefers-contrast: more)",
  ]) {
    assert.ok(
      keys.includes(required),
      `The audit found no \`${required}\` scope in ${mod.GLOBALS}. Either the stylesheet lost a ` +
        `theme or the scope reader stopped seeing it — and the second failure renders as a ` +
        `shorter table, not as an error.`,
    )
  }

  assert.ok(
    a.baseTokens >= 200,
    `Base \`:root\` reports only ${a.baseTokens} tokens. The orphan column compares every other ` +
      `scope against this set, so a base that reads short reports orphans that are not orphans.`,
  )
})

test("every token scope the stylesheet declares is mapped to something that enters it", () => {
  // The activation column is the one DECLARED table in the generator, so it is
  // the one that can rot. Both directions: a scope with no entry is unmapped,
  // and an entry whose caller no longer matches its probe is a dead reference.
  const a = mod.collect()
  assert.deepEqual(
    a.themes.filter((t) => !t.activation).map((t) => t.key),
    [],
    "A token scope in globals.css has no entry in ACTIVATION. A theme nobody can enter is dead " +
      "CSS; a theme whose caller is unknown is worse, because it looks live.",
  )
  assert.deepEqual(
    a.themes.filter((t) => t.callerLives === false).map((t) => t.key),
    [],
    "An activation caller no longer exists or no longer matches its probe. The audit would keep " +
      "printing the path as though the switch were still wired.",
  )
})

test("the viewport section covers every tenant page", () => {
  const a = mod.collect()
  const pages = new Set(a.viewports.map((v) => v.page))

  // Derived from the filesystem here, not from the generator, so a walk that
  // silently skipped a directory cannot agree with itself.
  const found = []
  const walk = (rel) => {
    const abs = path.join(ROOT, rel)
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next") continue
        walk(`${rel}/${e.name}`)
      } else if (e.name === "page.tsx") found.push(`${rel}/${e.name}`)
    }
  }
  walk(`${mod.SRC}/app`)

  assert.deepEqual(
    found.filter((p) => !pages.has(p)).sort(),
    [],
    "A tenant page is missing from the viewport table. A page in no row of the audit was not " +
      "audited, and the table gives no sign of it.",
  )
  assert.ok(found.length >= 20, `Only ${found.length} tenant pages were found; the walk is broken.`)

  // A closure of one for every page means import resolution returned nothing,
  // which would report every multi-component page as fixed-width.
  assert.ok(
    a.viewports.some((v) => v.closure > 5),
    "No page resolved a transitive closure larger than five files. Import resolution has broken, " +
      "and the responsive measure is now reading page files alone.",
  )
})

test("the accessibility section names every check that ran", () => {
  const a = mod.collect()
  const ids = a.a11y.map((c) => c.id).sort()
  assert.deepEqual(
    ids,
    mod.A11Y_CHECKS.map((c) => c.id).sort(),
    "The rendered audit must name every check. A check that runs and is not printed is a check " +
      "whose zero nobody can distinguish from an absence.",
  )
  const rendered = doc()
  for (const id of ids) {
    assert.ok(
      rendered.includes(`\`${id}\``),
      `The audit does not name the \`${id}\` check. Zero hits and no check look identical to a reader.`,
    )
  }
})

test("the accessibility checks still fire on markup that is wrong", () => {
  // The failure this catches is a check whose regex quietly stops matching: it
  // reports zero, the findings line reads "0 static accessibility hits", and the
  // document is a clean bill of health issued by a detector that is switched
  // off. So each is run against a sample assembled here, which the tree does not
  // contain and cannot heal.
  const byId = new Map(mod.A11Y_CHECKS.map((c) => [c.id, c]))

  assert.equal(byId.get("img-without-alt").find(`<img src={x} className="h-4" />`).length, 1)
  assert.equal(byId.get("img-without-alt").find(`<img src={x} alt="" />`).length, 0)

  assert.equal(byId.get("positive-tabindex").find(`<div tabIndex={3} />`).length, 1)
  assert.equal(byId.get("positive-tabindex").find(`<div tabIndex={0} />`).length, 0)
  assert.equal(byId.get("positive-tabindex").find(`<div tabIndex={-1} />`).length, 0)

  assert.equal(byId.get("click-on-non-interactive").find(`<div onClick={go}>x</div>`).length, 1)
  assert.equal(
    byId.get("click-on-non-interactive").find(`<div role="button" onClick={go}>x</div>`).length,
    0,
  )
  assert.equal(byId.get("click-on-non-interactive").find(`<button onClick={go}>x</button>`).length, 0)

  assert.equal(byId.get("new-tab-without-rel").find(`<a href={h} target="_blank">x</a>`).length, 1)
  assert.equal(
    byId.get("new-tab-without-rel").find(`<a href={h} target="_blank" rel="noopener">x</a>`).length,
    0,
  )

  // The scoped one. Inside a modal, moving focus in is required rather than a
  // defect, and a check that reported it would produce a finding that has to be
  // triaged every time somebody reads the document.
  assert.equal(byId.get("autofocus-outside-a-modal").find(`<input autoFocus />`).length, 1)
  assert.equal(
    byId.get("autofocus-outside-a-modal").find(`<Overlay><input autoFocus /></Overlay>`).length,
    0,
  )
})

test("the audit states what it did not establish", () => {
  const text = doc()
  // Not a style rule. The reason this repository asks for it is that an audit's
  // SILENCE reads as a pass: a document titled "accessibility" with no section
  // saying "no screen reader was run" is read as saying one was.
  for (const claim of [
    "No running system was measured",
    "No focus order",
    "Persona coverage is lexical",
  ]) {
    assert.ok(
      text.includes(claim),
      `The audit no longer states the limit "${claim}". An audit that stops naming what it did ` +
        `not measure is read as having measured it.`,
    )
  }
})
