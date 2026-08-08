import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-031-007 — configuration has one writer, and no parallel settings store.
 *
 * Bible §7.1 requires the admin UI to write "the same canonical configuration
 * used by config-as-code" with "no parallel hidden settings store". Today the
 * console has no configuration editor, so the requirement is satisfied by
 * having nothing — the least durable way to satisfy anything. The moment
 * somebody builds one, the cheapest implementation is a `Setting` table with a
 * key and a value, and then there are two sources of truth, a reconciliation
 * problem nobody chose, and a tenant whose console shows one thing while the
 * engine resolves another.
 *
 * This is what makes the path exist before the editor does.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8")

/**
 * `--untracked`, deliberately.
 *
 * A plain `git grep` searches only what is committed, so a brand-new file
 * introducing a second writer is invisible until after it has been pushed —
 * which is exactly when a guard is no longer useful. This repository has been
 * bitten by that before: `no-personal-data` scanned tracked files only, and a
 * plausible address in a new fixture passed locally and failed in CI after it
 * was already in a public commit.
 */
function grep(pattern, ...paths) {
  try {
    return execFileSync("git", ["grep", "-lE", "--untracked", pattern, "--", ...paths], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .filter((f) => !/\.(test|itest|spec)\.[cm]?[jt]sx?$/.test(f))
  } catch (err) {
    if (err.status !== 1) throw err
    return []
  }
}

test("the database schema has no settings table", () => {
  // The specific shape this guard exists to prevent. A model whose whole
  // content is a key and a value is a configuration store by another name, and
  // it will not go through the registry, the layer precedence, the rejections
  // or the publication gate.
  const schema = read("apps/web/prisma/schema.prisma")
  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1])

  const suspicious = models.filter((name) => /^(Setting|Settings|Config|Configuration|Preference|Preferences)$/i.test(name))
  assert.deepEqual(
    suspicious,
    [],
    `these models look like a parallel configuration store: ${suspicious.join(", ")}.\n` +
      `Configuration belongs in layers resolved by @tenure/configuration and published ` +
      `through commit() — not in a table that bypasses the registry, precedence, ` +
      `rejections and the publication gate.`,
  )
})

test("commit is the only thing that appends a configuration revision", () => {
  /*
   * `append` is the store's write. Anything calling it outside the engine is a
   * second writer, whatever it is named — but `append` is a verb, and this
   * repository now has two append-only stores that have nothing to do with each
   * other. `apps/system-studio/src/lib/audit-ledger.ts` (STUDIO-110-005) is a
   * hash-chained audit ledger whose write is also called `append`, and
   * `apps/system-studio/src/app/tenants/actions.ts` calls it once per lifecycle
   * attempt. Reading `\.append\(` alone reported both as parallel configuration
   * stores, which is a guard failing on the wrong subject: neither holds a
   * `ConfigStore`, neither constructs a `ConfigRecord`, and neither writes a
   * configuration revision.
   *
   * So the scan is intersected with the files that touch the configuration
   * store at all. That is not a narrowing of what counts as a second writer: to
   * append a revision a module must hold the store and pass a record, and both
   * arrive spelled `ConfigStore` / `ConfigRecord` — as the interface, as the
   * record type, as an implementation (`InMemoryConfigStore`,
   * `DynamoConfigStore`), or as the module they are imported from
   * (`@/lib/config-store`, `./config-store`). The intersection today is exactly
   * `packages/configuration/src/store.ts`, and the vacuity assertion below is
   * what stops that being a way to check nothing.
   */
  const touchesStore = new Set(grep("[Cc]onfig[-_]?([Ss]tore|[Rr]ecord)", "packages/*", "apps/*/src/*"))
  const callers = grep("\\.append\\(", "packages/*", "apps/*/src/*").filter((f) => touchesStore.has(f))
  const allowed = ["packages/configuration/src/store.ts"]
  const strangers = callers.filter((f) => !allowed.includes(f))

  assert.deepEqual(
    strangers,
    [],
    `configuration revisions are appended outside commit():\n` +
      strangers.map((f) => `  ${f}`).join("\n") +
      `\n\ncommit() enforces the publication gate, immutability against real history, ` +
      `and the audit record. A direct append skips all three.`,
  )

  // The allowlist must not be vacuous. A guard whose only entry has stopped
  // calling `append` is a guard that would pass with no writer at all — and
  // would keep passing while somebody built a second one somewhere it does not
  // look.
  assert.ok(
    callers.includes(allowed[0]),
    `${allowed[0]} no longer appends anything, so this guard is checking nothing. ` +
      `Either the write path moved — update the allowlist — or it was removed.`,
  )
})

test("the store interface offers no way to change a published revision", () => {
  // Asserted on the source rather than on an instance: an adapter that added
  // `update` would still satisfy the TypeScript interface, because a wider
  // object is assignable to a narrower one.
  const source = read("packages/configuration/src/store.ts")
  const interfaceBody = /export interface ConfigStore \{([\s\S]*?)\n\}/.exec(source)
  assert.ok(interfaceBody, "ConfigStore interface not found")

  for (const forbidden of ["update", "delete", "remove", "set", "put"]) {
    assert.ok(
      !new RegExp(`^\\s*${forbidden}\\s*[(<]`, "m").test(interfaceBody[1]),
      `ConfigStore declares "${forbidden}". A published revision that can be changed is not a ` +
        `record of what was live, and every claim built on it — an incident reconstruction, a ` +
        `rollback target, an audit trail — becomes a guess.`,
    )
  }
})

test("no module writes a platform configuration key to the database", () => {
  // A write of a `platform.*` key through Prisma would be configuration living
  // somewhere the resolver never looks.
  const writers = grep("\\bdb\\.\\w+\\.(create|update|upsert)\\([^)]*platform\\.", "apps/*/src/*")
  assert.deepEqual(
    writers,
    [],
    `these write a platform configuration key through the database: ${writers.join(", ")}`,
  )
})
