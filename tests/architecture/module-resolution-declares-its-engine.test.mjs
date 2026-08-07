import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * Every production `resolveModules` call says which engine is running.
 *
 * `resolve.ts` refuses a module declaring `requiresEngine` when the caller does
 * not supply `runningEngineVersion` and `compareVersions` — deliberately, on the
 * stated ground that "an engine that cannot say how old it is cannot claim to be
 * new enough". That is the right default, and it makes omitting the pair a
 * silent, total failure rather than a partial one.
 *
 * It happened. `requiresEngine` was added to all twelve manifests in one change;
 * `apps/system-studio/src/app/tenants/actions.ts` called `resolveModules` twice
 * without the pair, and both calls began refusing EVERY module —
 * `KEYS: []`, five × `engine-too-old` — breaking tenant composition and the
 * provisioning execution context. `ENGINE_VERSION` and `compareVersionStrings`
 * had even been added to that file's imports and left unreferenced, sitting
 * exactly where the wiring belonged.
 *
 * Nothing caught it. Both arguments are optional in the type, so `tsc` is happy;
 * `npm run studio:type-check` passed; the unit tests all passed because they
 * exercise `resolveModules` directly with correct input rather than through the
 * callers. It was found by an adversarial refuter probing the real catalog with
 * the caller's exact argument shape, which is not something that runs on every
 * commit. This is.
 *
 * Asserted over source rather than by executing the callers, because both are
 * Next.js server actions inside a React `"use server"` module — importing them
 * here would drag the framework in for a property that is visible in the text.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

/** Where production code lives. Tests are excluded: they SHOULD probe the refusal. */
const SEARCH_ROOTS = ["apps", "packages", "modules"]
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
 * The argument object of each `resolveModules(catalog, { … })` call in a file.
 *
 * Brace-balanced from the `{`, so a nested object inside the argument does not
 * end the scan early — an argument cut short at the first `}` would hide the
 * fields that follow it, which is the failure this guard exists to detect.
 */
export function resolveModuleCallArgs(source) {
  const calls = []
  const CALL = /resolveModules\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*\{/g
  let match

  while ((match = CALL.exec(source)) !== null) {
    const open = source.indexOf("{", match.index)
    let depth = 0
    let end = open
    for (let i = open; i < source.length; i++) {
      if (source[i] === "{") depth++
      else if (source[i] === "}") {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    calls.push({
      body: source.slice(open, end + 1),
      line: source.slice(0, match.index).split("\n").length,
    })
  }
  return calls
}

const REQUIRED_FIELDS = ["runningEngineVersion", "compareVersions"]

test("every production resolveModules call declares the running engine", () => {
  const offenders = []

  for (const root of SEARCH_ROOTS) {
    for (const file of sourceFiles(path.join(ROOT, root))) {
      const source = fs.readFileSync(file, "utf8")
      for (const call of resolveModuleCallArgs(source)) {
        const missing = REQUIRED_FIELDS.filter((f) => !new RegExp(`\\b${f}\\s*:`).test(call.body))
        if (missing.length > 0) {
          offenders.push(`${path.relative(ROOT, file).split(path.sep).join("/")}:${call.line} — missing ${missing.join(" and ")}`)
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these resolveModules calls do not say which engine is running:\n  ${offenders.join("\n  ")}\n` +
      `resolve.ts refuses every module declaring requiresEngine when the caller cannot say, so ` +
      `such a call returns no modules at all rather than fewer. Pass ` +
      `runningEngineVersion: ENGINE_VERSION and compareVersions: compareVersionStrings, as ` +
      `packages/platform-config/src/modules.ts does.`,
  )
})

test("the detector finds the calls it is auditing", () => {
  // The failure mode is silence: a regex that stopped matching, or a root that
  // resolved to nothing, would report every caller compliant forever.
  let found = 0
  for (const root of SEARCH_ROOTS) {
    for (const file of sourceFiles(path.join(ROOT, root))) {
      found += resolveModuleCallArgs(fs.readFileSync(file, "utf8")).length
    }
  }
  assert.ok(found >= 4, `expected the known resolveModules call sites, found ${found}`)
})

test("the argument scan does not stop at a nested object", () => {
  // The bug that would make this guard useless: reading to the first `}` ends
  // inside a nested option and reports the fields after it as missing — or, with
  // the fields before it present, reports a broken call as fine.
  const [call] = resolveModuleCallArgs(
    "resolveModules(CATALOG, { requested, options: { a: 1 }, runningEngineVersion: V, compareVersions: c })",
  )
  assert.ok(call, "no call parsed")
  assert.match(call.body, /runningEngineVersion/)
  assert.match(call.body, /compareVersions/)
})
