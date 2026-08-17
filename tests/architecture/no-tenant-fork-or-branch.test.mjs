import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { test } from "node:test"

import { ROOT } from "../../tools/pack-surface-inventory.mjs"

/**
 * PACK-010-004 — no tenant fork, and no hard-coded tenant branch.
 *
 * The pack Bible's §23 states the property this defends: "Tenant systems are
 * compiled from multi-axis profiles and packs, never source forks." There are
 * three ways a codebase loses it, and they are different failures with
 * different guards:
 *
 *   1. **A branch.** `if (slug === "rochester")`. One line, always defensible,
 *      and the reason `packages/configuration/src/index.ts:6` opens by saying
 *      there is somewhere else to put it.
 *   2. **A fork in the tree.** A directory or file named for a customer, which
 *      is where per-tenant behaviour goes once branching feels shameful.
 *   3. **A configured value, hard-coded anyway.** The subtlest and the only one
 *      of the three this repository currently has. `rochester`'s binding sets
 *      `platform.terminology.staffOfficeName` to "Ainslie OSE" — and the
 *      comment beside it says the value "was a literal in eight components".
 *      Seven shipped files still contain it. A platform with a configuration
 *      key AND a literal for the same word is a platform where the second
 *      customer's answer is a code change.
 *
 * Nothing here is authored: the slugs and the words come from
 * `blueprints/index.ts`, so adding a tenant extends the check, and renaming one
 * cannot leave a stale rule behind.
 *
 * The third claim carries a NAMED allowlist and PACK-010-004 is recorded FAIL
 * in `docs/implementation/erp-pack-factory-execution-ledger.md` because of it.
 * The allowlist is not an exemption: a file on it that no longer holds the
 * literal fails this test too, so the list can only shrink, and it names the
 * configuration key each site should be resolving instead.
 */

const IS_TEST = /\.(test|itest|spec)\.(tsx?|mjs)$/

/**
 * Shipped source.
 *
 * `blueprints/` is excluded: it DECLARES the bindings, so a tenant's slug and
 * its words are what that package is for. `tools/` is excluded because it is
 * not the product — `tools/dev/show-config-history.mjs` defaults its CLI
 * argument to `rochester`, which is a developer convenience and ships to
 * nobody. Tests are excluded, and only tests: fixtures must stay resolvable by
 * slug or nothing could prove a per-tenant resolution at all.
 */
const SHIPPED_ROOTS = ["apps/web/src", "apps/system-studio/src", "packages", "modules"]

function tracked(dir, extensions = /\.(tsx?|mjs)$/) {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", dir], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .filter((f) => extensions.test(f))
    .filter((f) => !IS_TEST.test(f))
}

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n")

/** Comments stripped: a slug discussed in prose is not a slug branched on. */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n")

const BINDINGS = "blueprints/index.ts"

/**
 * Every slug a binding claims, read from the bindings.
 *
 * Parsed rather than imported because this suite runs under `node --test` with
 * no TypeScript transform. `RESERVED_TENANT_SLUGS` is the same list at runtime,
 * derived from the same array.
 */
function tenantSlugs() {
  const source = read(BINDINGS)
  const slugs = [...source.matchAll(/^\s*slug:\s*"([^"]+)",/gm)].map((m) => m[1])
  assert.ok(slugs.length >= 4, `read only ${slugs.length} slugs from ${BINDINGS} — the parse is broken`)
  assert.ok(slugs.includes("rochester"), `${BINDINGS} no longer binds the pilot — check this parser`)
  return slugs
}

/**
 * Every word a binding CONFIGURES, and therefore every word no component may
 * spell out.
 *
 * Only `platform.terminology.*`, and only values of six characters or more.
 * `"OSE"`, `"MPO"`, `"AED"` are short enough to occur inside unrelated
 * identifiers, and a guard with false positives is a guard somebody switches
 * off.
 */
function configuredWords() {
  const source = read(BINDINGS)
  const words = [...source.matchAll(/"platform\.terminology\.[A-Za-z.]+":\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((w) => w.length >= 6)
  assert.ok(words.length >= 4, `read only ${words.length} configured terminology words from ${BINDINGS}`)
  assert.ok(
    words.includes("Ainslie OSE"),
    `${BINDINGS} no longer configures the pilot's office name — check this parser`,
  )
  return [...new Set(words)]
}

/**
 * The seven files that hold a configured word as a literal, and what each
 * should resolve instead.
 *
 * Written out rather than counted, because a count tells whoever fixes one
 * nothing about the other six.
 */
const HARD_CODED_TENANT_WORDS = {
  "apps/web/src/app/(app)/admin/people/page.tsx":
    "an input placeholder; should use platform.terminology.staffOfficeName",
  "apps/web/src/app/(app)/calendar/page.tsx":
    "the source label on every calendar row; should use platform.terminology.staffOfficeName",
  "apps/web/src/app/(app)/error.tsx": "the tenant error boundary's support sentence",
  "apps/web/src/app/error.tsx": "the root error boundary's support sentence",
  "apps/web/src/lib/policies.ts":
    "the pilot's own policy documents, transcribed into source; needs a tenant content store, not a config key",
  "apps/web/src/lib/resources.ts": "an audience label map; should use platform.terminology.staffOfficeName",
  "packages/platform-config/src/definitions.ts":
    "the configuration key's own description names the pilot's answer as an example",
}

test("no shipped file branches on a tenant", () => {
  const files = SHIPPED_ROOTS.flatMap((r) => tracked(r))
  assert.ok(files.length > 400, `scanned ${files.length} shipped files — the listing is broken, not the code`)

  const offences = []
  for (const slug of tenantSlugs()) {
    // A decision, not a mention: compared, switched on, used as a key, or
    // tested for membership. Every one of these makes the platform behave
    // differently for one customer from inside the code that serves all of them.
    const decisions = [
      new RegExp(`[=!]==?\\s*["'\`]${slug}["'\`]`),
      new RegExp(`["'\`]${slug}["'\`]\\s*[=!]==?`),
      new RegExp(`case\\s+["'\`]${slug}["'\`]`),
      new RegExp(`["'\`]${slug}["'\`]\\s*:`),
      new RegExp(`\\[\\s*["'\`]${slug}["'\`]\\s*\\]`),
      new RegExp(`\\.(includes|has|startsWith|endsWith)\\(\\s*["'\`]${slug}["'\`]`),
    ]
    for (const f of files) {
      const text = code(read(f))
      const hit = decisions.find((re) => re.test(text))
      if (hit) offences.push(`${f} — ${slug} (${hit})`)
    }
  }
  assert.deepEqual(offences, [], `these files decide something from a tenant's identity:\n${offences.join("\n")}`)
})

test("a tenant's slug is not a value in shipped source either", () => {
  const files = SHIPPED_ROOTS.flatMap((r) => tracked(r))
  // One known site, named. `ComposeForm` uses a fixture's slug as the example
  // text in the slug field — not a decision, and not a claim about that tenant,
  // but it is still a customer's name in a shared component and `my-institution`
  // would do the same job.
  const ALLOWED = { "apps/system-studio/src/app/tenants/new/ComposeForm.tsx": "placeholder text in the slug field" }

  const found = []
  for (const slug of tenantSlugs()) {
    const re = new RegExp(`["'\`]${slug}["'\`]`)
    for (const f of files) if (re.test(code(read(f)))) found.push(f)
  }
  const unexpected = [...new Set(found)].filter((f) => !(f in ALLOWED)).sort()
  assert.deepEqual(unexpected, [], `these files name a tenant: ${unexpected.join(", ")}`)

  // And the exemption has to still be true, or it is just a hole.
  for (const f of Object.keys(ALLOWED)) {
    assert.ok(found.includes(f), `${f} is exempted for "${ALLOWED[f]}" and no longer names a tenant — drop it`)
  }
})

test("no path in the tree is named for a tenant", () => {
  // A fork does not announce itself as one. It arrives as a directory with a
  // customer's name in it, and every file inside is then obviously fine.
  const everything = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
  assert.ok(everything.length > 500, `listed ${everything.length} files — the listing is broken`)

  const forks = []
  for (const slug of tenantSlugs()) {
    const re = new RegExp(`(^|[/_.-])${slug}([/_.-]|$)`, "i")
    for (const f of everything) if (re.test(f)) forks.push(`${f} — named for ${slug}`)
  }
  assert.deepEqual(forks, [], `these paths are named for one tenant:\n${forks.join("\n")}`)
})

test("PACK-010-004 is FAIL — a configured tenant word is still a literal in seven shipped files", () => {
  const files = SHIPPED_ROOTS.flatMap((r) => tracked(r))
  const words = configuredWords()

  const holders = new Set()
  for (const word of words) {
    for (const f of files) if (code(read(f)).includes(word)) holders.add(f)
  }

  // Nothing new. This is the half of the requirement that is not met, and the
  // guard's job until it is met is to stop it spreading.
  const unlisted = [...holders].filter((f) => !(f in HARD_CODED_TENANT_WORDS)).sort()
  assert.deepEqual(
    unlisted,
    [],
    `these files spell out a word a tenant configures, and are not on the list of known sites: ` +
      `${unlisted.join(", ")}. The value belongs to platform.terminology.staffOfficeName in ` +
      `${BINDINGS}; resolve it rather than writing it.`,
  )

  // And nothing stale: a site that has been fixed must leave the list, so the
  // number in the ledger is the number that is really left.
  const fixed = Object.keys(HARD_CODED_TENANT_WORDS).filter((f) => !holders.has(f))
  assert.deepEqual(
    fixed,
    [],
    `these files are listed as holding a configured tenant word and no longer do — remove them from ` +
      `HARD_CODED_TENANT_WORDS and update the PACK-010-004 count: ${fixed.join(", ")}`,
  )
  assert.equal(holders.size, 7, "the ledger's PACK-010-004 row states seven sites")
})
