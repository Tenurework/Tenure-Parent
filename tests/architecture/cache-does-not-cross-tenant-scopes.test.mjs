import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * `docs/architecture/REVIEW-FINDINGS.md:54` — no `cache()`d function may return
 * tenant rows.
 *
 * A `React.cache()` memo lives for one REQUEST. A tenant scope lives for one
 * BLOCK. Nothing lines the two lifetimes up, and a request may legitimately open
 * two scopes: the institution switcher, an OSE staffer who holds seats at two
 * campuses, any page that renders one tenant's rows beside another's. So the
 * first caller inside `runInTenantScope(A)` decides the value every later caller
 * gets, including one running inside `runInTenantScope(B)` — and under
 * `TENANCY_ENFORCE=true` the query inside that memo was filtered to A, so B is
 * served A's rows with nothing below able to tell.
 *
 * The invariant is stated in prose beside `runInTenantScope`
 * (`apps/web/src/lib/tenancy/context.ts`). This is the half a comment cannot do:
 * the defect is invisible to `tsc`, invisible to every unit test that builds its
 * own fixture, and shows up only when two scopes are opened in one request.
 * `viewerTimeZone` was keyed on `userId` alone and read a TENANT_SCOPED
 * `Organization` for eleven months without a single test noticing.
 *
 * The rule enforced here is rule (2) of the three stated in context.ts: every
 * tenant a `cache()`d loader can read from must appear in its argument list, so
 * the memo key changes when the tenant does. Rules (1) and (3) — reads only
 * PLATFORM_GLOBAL models, or runs under a stated `auth-bootstrap` grant — are
 * the exemptions below, and each one says which.
 *
 * The behavioural half is `apps/web/src/lib/tenancy/isolation.itest.ts`
 * ("a cache()d loader answers for the tenant that is open, not the first one"),
 * which puts one user in two institutions with different zones and proves the
 * production loader answers each correctly against a real database.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const REGISTRY = "apps/web/src/lib/tenancy/registry.ts"
const SCANNED = ["apps/web/src"]

/**
 * The tenant-scoped models, read from the registry rather than restated.
 *
 * Restating them here would be a second source of truth that goes stale the
 * first time a model is added — and `registry.test.ts` already forces every
 * model in `schema.prisma` into exactly one bucket, so the registry is the list
 * that cannot drift.
 */
function tenantScopedModels() {
  const source = fs.readFileSync(path.join(ROOT, REGISTRY), "utf8")
  const block = /export const TENANT_SCOPED = \[([\s\S]*?)\] as const/.exec(source)
  assert.ok(block, `${REGISTRY} no longer declares \`export const TENANT_SCOPED = [...] as const\``)

  const models = [...block[1].matchAll(/^\s*"([A-Za-z0-9_]+)",/gm)].map((m) => m[1])
  assert.ok(
    models.length > 5,
    `only ${models.length} tenant-scoped models parsed out of ${REGISTRY} — the parser has drifted ` +
      `from the file, and a guard that reads an empty list passes on everything`,
  )
  return models
}

/** Prisma's client accessor for a model: `OutboxEvent` -> `db.outboxEvent`. */
const accessorFor = (model) => model[0].toLowerCase() + model.slice(1)

const PRISMA_OPERATION = "(?:find|create|update|upsert|delete|count|aggregate|groupBy)"

function sourceFiles() {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", ...SCANNED],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter((file) => /\.tsx?$/.test(file) && !/\.(test|itest)\.tsx?$/.test(file))

  assert.ok(listed.length > 0, `the scanned paths matched no files — ${SCANNED.join(", ")} has moved`)
  return listed
}

/**
 * Source with comments stripped, so prose about a query is not a query.
 *
 * Returns "" for a file that vanished between the listing and the read.
 * `git ls-files --others` lists untracked files and this repository runs guards
 * in parallel with agents editing the tree; the sibling guard
 * `tests/security/authority-is-not-cached.test.mjs` carries the same tolerance
 * and the same reason.
 */
function code(file) {
  let text
  try {
    text = fs.readFileSync(path.join(ROOT, file), "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return ""
    throw error
  }
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/** The index just past the `(` at `open`, scanned to its matching `)`. */
function matchingParen(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1
    else if (text[i] === ")") {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** Parameter names declared by an arrow function's header, in order. */
function parameterNames(header) {
  const open = header.indexOf("(")
  if (open === -1) return []
  const close = matchingParen(header, open)
  if (close === -1) return []

  const inner = header.slice(open + 1, close)
  const params = []
  let depth = 0
  let current = ""
  for (const ch of inner) {
    if ("([{<".includes(ch)) depth += 1
    else if (")]}>".includes(ch)) depth -= 1
    if (ch === "," && depth === 0) {
      params.push(current)
      current = ""
    } else current += ch
  }
  params.push(current)

  return params
    .map((p) => /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)/.exec(p)?.[1])
    .filter(Boolean)
}

/**
 * Every `const NAME = cache(async (params) => body)` in one file.
 *
 * Only files that import `cache` from React are read: `unstable_cache` and any
 * future `cache` from elsewhere have different lifetimes and are not what this
 * invariant is about.
 */
function cachedLoaders(file, text) {
  if (!/import\s*\{[^}]*\bcache\b[^}]*\}\s*from\s*["']react["']/.test(text)) return []

  const found = []
  for (const match of text.matchAll(/(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+)?=\s*cache\(/g)) {
    const open = match.index + match[0].length - 1
    const close = matchingParen(text, open)
    if (close === -1) continue

    const call = text.slice(open + 1, close)
    const arrow = call.indexOf("=>")
    if (arrow === -1) continue

    found.push({
      file,
      name: match[1],
      params: parameterNames(call.slice(0, arrow)),
      body: call.slice(arrow + 2),
    })
  }
  return found
}

/** Tenant-scoped models a loader's body reaches through the Prisma client. */
function tenantModelsRead(body, models) {
  return models.filter((model) =>
    new RegExp(`\\.\\s*${accessorFor(model)}\\s*\\.\\s*${PRISMA_OPERATION}`).test(body),
  )
}

/** A tenant in the memo key. Either spelling; `institutionId` is this app's. */
const TENANT_PARAMETERS = ["institutionId", "tenantId"]

const isTenantKeyed = (loader) => loader.params.some((p) => TENANT_PARAMETERS.includes(p))

/**
 * Loaders that read a tenant-scoped model and are still correct without a
 * tenant in the key, each with the rule from context.ts that makes it so.
 *
 * Deliberately keyed by `file::name` and deliberately short. An exemption that
 * stops being needed is a failure below, not a line nobody deletes: a list that
 * only ever grows is how a guard becomes decoration.
 */
const EXEMPT = {
  "apps/web/src/lib/rbac.ts::getUserContext":
    "Rule (3). Runs inside runUnscoped('auth-bootstrap') and returns the person's WHOLE " +
    "cross-tenant membership set on purpose — that set is how a tenant is chosen in the first " +
    "place, so narrowing it to one tenant would deadlock authentication (ADR-0002). No tenant " +
    "predicate is applied, so the answer cannot vary with which scope is open.",
  "apps/web/src/lib/tenant-scope.ts::institutionCandidates":
    "Rule (3). The same bootstrap read, one layer up: it resolves WHICH institutions a user may " +
    "act for, so it runs before a scope exists and under the same explicit grant. Its own " +
    "comment states this at the call to runUnscoped().",
}

const key = (loader) => `${loader.file}::${loader.name}`

function allLoaders() {
  const models = tenantScopedModels()
  const loaders = []
  for (const file of sourceFiles()) {
    for (const loader of cachedLoaders(file, code(file))) {
      loaders.push({ ...loader, tenantModels: tenantModelsRead(loader.body, models) })
    }
  }
  return loaders
}

test("no React.cache()d loader reads a tenant-scoped model without the tenant in its key", () => {
  const offenders = allLoaders()
    .filter((l) => l.tenantModels.length > 0 && !isTenantKeyed(l) && !(key(l) in EXEMPT))
    .map(
      (l) =>
        `${l.file} — \`${l.name}(${l.params.join(", ")})\` reads ${l.tenantModels.join(", ")} ` +
        `and takes no ${TENANT_PARAMETERS.join("/")}`,
    )

  assert.deepEqual(
    offenders,
    [],
    `these loaders memoise a tenant's rows on a key with no tenant in it:\n  ${offenders.join("\n  ")}\n` +
      `A React.cache() memo lives for the whole request and a tenant scope lives for a block, so ` +
      `the first scope opened answers for every later one (REVIEW-FINDINGS.md:54). Add the acting ` +
      `institution to the signature — required, never optional, because a parameter a caller may ` +
      `omit is invisible to tsc — and pass scope.institutionId at every call site. The invariant ` +
      `and its three escapes are stated beside runInTenantScope in ` +
      `apps/web/src/lib/tenancy/context.ts.`,
  )
})

test("the scanner finds the loaders it is supposed to be checking", () => {
  // Asserted because the failure mode of a static guard is silence: a regex that
  // matches nothing reports every file as clean, and this file's own history is
  // the argument — `grep 'cache(' apps/web/src/**/*.test.ts` returned zero at the
  // moment the defect was live.
  const loaders = allLoaders()
  assert.ok(loaders.length >= 10, `only ${loaders.length} cache()d loaders found in apps/web/src`)

  const viewerTimeZone = loaders.find((l) => l.name === "viewerTimeZone")
  assert.ok(viewerTimeZone, "viewerTimeZone was not found — the scanner or the module has moved")
  assert.ok(
    viewerTimeZone.tenantModels.includes("Organization"),
    `viewerTimeZone no longer reads Organization (found: ${viewerTimeZone.tenantModels.join(", ") || "none"}). ` +
      `If that read is genuinely gone the guard still holds, but this assertion exists so the ` +
      `worked example named in context.ts stays a worked example rather than quietly becoming ` +
      `a loader the scanner never had to judge.`,
  )
  assert.ok(
    isTenantKeyed(viewerTimeZone),
    `viewerTimeZone(${viewerTimeZone.params.join(", ")}) does not take an institutionId`,
  )
})

test("every exemption is still one, and still needed", () => {
  const loaders = allLoaders()
  const stale = []

  for (const [entry, why] of Object.entries(EXEMPT)) {
    assert.ok(why.length > 40, `${entry}'s exemption does not say why`)

    const loader = loaders.find((l) => key(l) === entry)
    if (!loader) {
      stale.push(`${entry} — exempted but no such cache()d loader exists`)
      continue
    }
    if (loader.tenantModels.length === 0) {
      stale.push(`${entry} — exempted but no longer reads any tenant-scoped model`)
      continue
    }
    if (isTenantKeyed(loader)) {
      stale.push(`${entry} — exempted but now takes a tenant key, so the exemption does nothing`)
    }
  }

  assert.deepEqual(
    stale,
    [],
    `the exemption list has rotted:\n  ${stale.join("\n  ")}\n` +
      `Delete the entries that no longer describe anything. An allowlist that only grows stops ` +
      `being a list of considered decisions and becomes a list of things nobody looked at.`,
  )
})

test("the detector can tell a tenant-keyed loader from one that is not", () => {
  // On the detector itself, for the same reason the sibling guard in
  // tests/security asserts on `mutableStores`: both halves have a silent failure
  // — a body matcher that never matches, and a parameter parser that reports
  // every loader as keyed.
  const models = ["Organization", "OutboxEvent"]

  const unkeyed = cachedLoaders(
    "probe.ts",
    `import { cache } from "react"
     export const zoneFor = cache(async (userId: string): Promise<string> => {
       const org = await db.organization.findFirst({ where: { id: userId } })
       return org?.tz ?? "UTC"
     })`,
  )
  assert.equal(unkeyed.length, 1, "a single cache()d loader was not found")
  assert.deepEqual(unkeyed[0].params, ["userId"])
  assert.deepEqual(tenantModelsRead(unkeyed[0].body, models), ["Organization"])
  assert.equal(isTenantKeyed(unkeyed[0]), false)

  const keyed = cachedLoaders(
    "probe.ts",
    `import { cache } from "react"
     export const zoneFor = cache(
       async (userId: string, institutionId: string): Promise<string> => {
         const org = await db.organization.findFirst({ where: { institutionId } })
         return org?.tz ?? "UTC"
       },
     )`,
  )
  assert.deepEqual(keyed[0].params, ["userId", "institutionId"])
  assert.equal(isTenantKeyed(keyed[0]), true)

  // A loader that reads only PLATFORM_GLOBAL models is rule (1) and must not be
  // flagged at all — otherwise every institutionTimeZone-shaped helper acquires
  // an exemption it never needed.
  const global = cachedLoaders(
    "probe.ts",
    `import { cache } from "react"
     export const slugFor = cache(async (id: string) => db.institution.findUnique({ where: { id } }))`,
  )
  assert.deepEqual(tenantModelsRead(global[0].body, models), [])

  // Prose is not a query. The comment stripper is what keeps a docblock that
  // *names* db.organization from being read as a use of it — which is exactly
  // what institution-time.ts's own explanation of this bug does.
  assert.deepEqual(
    tenantModelsRead(code("apps/web/src/lib/tenancy/context.ts"), models),
    [],
    "context.ts's prose about the invariant is being read as a query",
  )
})
