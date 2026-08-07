import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * A caller that builds `ModuleLike` for the rejection engine carries `provides`.
 *
 * `moduleGraphRejections` answers "does every dependency name something that
 * exists". A dependency used to be a module key and is now a module key OR a
 * capability another module supplies through `provides` — `reimbursements`
 * depends on `finance.ledger`, which `budgeting` provides. The satisfier lookup
 * is `byKey.has(target) || modules.some(m => m.provides.includes(target))`, so a
 * caller that omits `provides` leaves the second half of that with nothing to
 * search.
 *
 * The consequence is not a worse message. `apps/system-studio/.../configuration/actions.ts`
 * mapped `MODULES` to `{ key, dependsOn, entitlement }` at three call sites.
 * With `provides` dropped, every plan came back with
 * `invalid-reference: Module "reimbursements" depends on "finance.ledger",
 * which is not in the catalogue`, `planPublication` set `blocked: true` on the
 * strength of it, and the Studio's Publish button never enabled — so **no
 * configuration could be published at all**, for any tenant, for any change.
 *
 * Nothing caught it. `provides` is optional on the interface, so `tsc` was
 * happy and `npm run studio:type-check` passed; every unit test passed because
 * they construct their own module fixtures with whatever fields they need. It
 * took the Studio's own Playwright suite against a real DynamoDB, and it was
 * found only because that suite was run — the one check the previous session
 * recorded as impossible to run locally.
 *
 * Structural, over source. The behavioural version — assert the real catalogue
 * plans cleanly — would need the mapping exported from a `"use server"` module
 * to avoid duplicating it, and a duplicated mapping is what this is guarding.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const SEARCH_ROOTS = ["apps", "packages", "modules", "tools"]
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "generated", "coverage"])

function sourceFiles(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sourceFiles(path.join(dir, entry.name), out)
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|itest|spec)\.tsx?$/.test(entry.name)) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

/**
 * Object literals that PROJECT a module into the rejection engine's shape.
 *
 * Recognised by `dependsOn: <something>.dependsOn` — a projection copying the
 * field across, which is exactly the operation that can drop a sibling field.
 * A `ModuleManifest` in `modules/index.ts` also carries `key` and `dependsOn`,
 * but it DECLARES them (`dependsOn: [needs("organizations")]`) and is the
 * source `provides` is read FROM, so matching on the pair alone reported every
 * real module as an offender. Brace-balanced so a nested literal does not
 * truncate the match.
 */
export function moduleLikeLiterals(source) {
  const found = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "{") continue
    let depth = 0
    let end = -1
    for (let j = i; j < source.length; j++) {
      if (source[j] === "{") depth++
      else if (source[j] === "}") {
        depth--
        if (depth === 0) {
          end = j
          break
        }
      }
    }
    if (end === -1) continue
    const body = source.slice(i, end + 1)
    if (/\bkey\s*:/.test(body) && /\bdependsOn\s*:\s*\w+\.dependsOn\b/.test(body)) {
      found.push({ body, line: source.slice(0, i).split("\n").length, start: i, end })
    }
  }

  // Innermost only. `planPublication({ modules: MODULES.map((m) => ({ … })) })`
  // matches twice — the argument object contains the projection's text, so it
  // satisfies the same patterns. Keeping the wrapper would report the defect at
  // the wrong line and count one mapping as two.
  return found.filter((a) => !found.some((b) => b !== a && b.start > a.start && b.end <= a.end))
}

test("every module mapping built for the rejection engine carries provides", () => {
  const offenders = []

  for (const root of SEARCH_ROOTS) {
    for (const file of sourceFiles(path.join(ROOT, root))) {
      const source = fs.readFileSync(file, "utf8")
      for (const literal of moduleLikeLiterals(source)) {
        if (!/\bprovides\s*:/.test(literal.body)) {
          offenders.push(`${path.relative(ROOT, file).split(path.sep).join("/")}:${literal.line}`)
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these build a module for the rejection engine without \`provides\`:\n  ${offenders.join("\n  ")}\n` +
      `A dependency may name a CAPABILITY another module supplies rather than a module key. Without ` +
      `\`provides\` the satisfier lookup finds nothing, reports a dangling reference, and ` +
      `planPublication blocks the plan — which stops every configuration publication, for every ` +
      `tenant. Add \`provides: m.provides\` to the mapping.`,
  )
})

test("the detector finds the mappings it is auditing", () => {
  // Silence is the failure mode: a regex that matched nothing would report
  // every caller compliant forever.
  let found = 0
  for (const root of SEARCH_ROOTS) {
    for (const file of sourceFiles(path.join(ROOT, root))) {
      found += moduleLikeLiterals(fs.readFileSync(file, "utf8")).length
    }
  }
  assert.ok(found >= 3, `expected the known ModuleLike mappings, found ${found}`)
})

test("the scan takes the projection, not its wrapper and not a declaration", () => {
  const found = moduleLikeLiterals(
    "planPublication({ registry: R, modules: MODULES.map((m) => ({ key: m.key, dependsOn: m.dependsOn })) })",
  )
  assert.equal(found.length, 1, "expected exactly the inner projection")
  assert.match(found[0].body, /^\{ key: m\.key/)

  // A manifest declares its dependencies rather than copying them across, and
  // is where `provides` comes FROM. Reporting it would fire the guard on every
  // module in the catalogue, which is a guard that means nothing.
  assert.deepEqual(
    moduleLikeLiterals('const feed = { key: "feed", dependsOn: [needs("organizations")] }'),
    [],
    "a ModuleManifest declaration is not a projection",
  )
})
