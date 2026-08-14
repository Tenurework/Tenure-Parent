import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * A tsconfig `include` may not name a build directory that only one machine has.
 *
 * ## Why this keeps happening
 *
 * An agent checking one route builds it into a scratch dist directory —
 * `next build --distDir .next-console-index` — so it does not fight the shared
 * `.next`. Next writes route type shims under `<distDir>/types`, `tsc` then wants
 * them on the include path, and the agent adds the entry. It is a completely
 * reasonable local move, and it leaves behind a permanent reference to a
 * directory that exists on exactly one computer.
 *
 * It has happened three times now. Seventeen such entries were removed from this
 * file at the start of the session — `.next-authz`, `.next-md3`, `.next-sec110`,
 * `.next-studio-120-003` and thirteen more — and two more (`.next-console-index`,
 * `.next-layout-index`) appeared within the hour, from a different wave.
 *
 * ## Why it matters more than tidiness
 *
 * `include` decides which files `tsc --noEmit` compiles. An entry that resolves
 * to nothing is silently skipped, so the local run and the CI run compile
 * DIFFERENT SETS OF FILES while both print "0 errors". The type-check stops being
 * a shared fact about the repository and becomes a fact about whoever ran it.
 * That is the same class of defect as a generated artefact that describes one
 * checkout: it does not fail, it just stops meaning anything.
 *
 * `.next` itself is fine and is required — every Next app has one, and its route
 * shims are how `next build` type-checks a route. It is the only one.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

/** Every app tsconfig. Found by walking, so a new app is covered without an edit. */
function tsconfigs() {
  const apps = path.join(ROOT, "apps")
  const out = []
  for (const name of fs.readdirSync(apps).sort()) {
    const file = path.join(apps, name, "tsconfig.json")
    if (fs.existsSync(file)) out.push(path.posix.join("apps", name, "tsconfig.json"))
  }
  return out
}

/**
 * Parse a tsconfig, tolerating the comments tsconfig allows.
 *
 * String-aware on purpose. A regex that strips `//` to end-of-line also destroys
 * this repository's `"//": "explanation"` documentation keys — which is exactly
 * what the first version of this guard did, reporting a JSON syntax error and
 * looking like a broken tsconfig rather than a broken reader. The same trap the
 * shell-separation guard documents for brace matching: a scanner that does not
 * know it is inside a string is wrong on real input.
 */
function read(rel) {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8")
  let out = ""
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]

    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1
      out += "\n"
      continue
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2)
      i = end === -1 ? text.length : end + 1
      continue
    }
    out += ch
  }

  // Trailing commas are legal in a tsconfig and not in JSON.
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"))
}

test("the survey finds the applications' tsconfigs", () => {
  // An absence over an empty list is not a finding.
  const files = tsconfigs()
  assert.ok(files.length >= 2, `found ${files.length} app tsconfig(s) — the walk is broken, not the code`)
  for (const file of files) {
    const config = read(file)
    assert.ok(Array.isArray(config.include), `${file} has no include array for this guard to check`)
  }
})

test("no tsconfig includes a scratch build directory", () => {
  const offenders = []

  for (const file of tsconfigs()) {
    for (const entry of read(file).include) {
      // `.next/…` is the real one. Anything of the shape `.next-<something>` is
      // a per-agent dist directory.
      if (/^\.next-/.test(entry)) offenders.push(`${file} -> ${entry}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "These tsconfig include entries name a scratch build directory:\n  " +
      offenders.join("\n  ") +
      "\nThey exist on one machine only, so `tsc --noEmit` compiles a different set of " +
      "files locally than in CI while both report success. Build into `.next` — or into a " +
      "scratch dist without adding it here, since `next build` type-checks the route itself.",
  )
})

test("the check reads a real include and rejects a scratch one", () => {
  // Both directions, so a detector that matched everything or nothing would fail
  // here rather than make the assertion above vacuous.
  assert.equal(/^\.next-/.test(".next/types/**/*.ts"), false)
  assert.equal(/^\.next-/.test(".next-console-index/types/**/*.ts"), true)
  assert.equal(/^\.next-/.test("next-env.d.ts"), false)
})
