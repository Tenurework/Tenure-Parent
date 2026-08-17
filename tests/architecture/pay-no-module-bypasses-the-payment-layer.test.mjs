/**
 * PAY-000-006 — no tenant module can reach a provider except through the port.
 *
 * ## What was already proved, and what it left open
 *
 * `payments-port-is-the-only-door.test.mjs` (PAY-020-002) greps every source
 * file for a provider SDK import and every manifest for a provider dependency.
 * That is a real property and it is not this one. Its scan is FLAT: it asks
 * whether the string `stripe` appears as an import specifier anywhere. It cannot
 * say which tenant modules exist, whether a module's own surfaces reach the
 * payments package at all, or whether a bypass that is not an import — a raw
 * `fetch` to the provider's REST host, a secret key read out of `process.env`, a
 * dynamic `import()` whose specifier is computed at runtime — exists in the code
 * a module actually serves.
 *
 * Those are the four ways a module gets to a provider without importing an SDK,
 * and the third one needs no dependency at all: `fetch("https://api.stripe.com/v1/charges")`
 * is nine words and reaches production money.
 *
 * ## What this proves
 *
 * It starts from the module catalog — the twelve manifests in `modules/index.ts`
 * — rather than from a directory, walks each module's navigation to the page
 * files `apps/web` actually serves, and resolves the TRANSITIVE import graph of
 * each of those pages across relative, `@/` and `@tenure/*` specifiers. Over that
 * graph, and per module, it refuses:
 *
 *   1. a provider SDK import;
 *   2. a provider API host, in any string, however it would be called;
 *   3. a provider secret read from the environment;
 *   4. a computed `import()`/`require()`, which is how a specifier scan is beaten;
 *   5. any payments import that is not one of the two published entry points.
 *
 * ## Why the positive control is not decoration
 *
 * Every assertion here passes trivially today, because there is no provider
 * integration in this repository at all. A scan that found nothing and a scan
 * that looked nowhere produce identical output, and this file would be worth
 * nothing as the second. So the last test runs all five detectors over synthetic
 * text containing all five bypasses and requires all five to fire, and the
 * enumeration carries floors — twelve modules, a page per module, a graph of
 * more than a hundred files — that fail rather than reporting a clean tree.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { collect } from "../../tools/entry-point-inventory.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const MANIFESTS = "modules/index.ts"

/** Provider SDK package names. Importing one bypasses the port outright. */
const PROVIDER_SDKS = [
  "stripe",
  "@stripe/stripe-js",
  "@stripe/react-stripe-js",
  "adyen",
  "@adyen/api-library",
  "braintree",
  "square",
]

/**
 * Provider hosts, as they appear in a URL.
 *
 * `js.stripe.com` and `checkout.stripe.com` are here beside the REST hosts on
 * purpose: a client-side redirect to a hosted checkout is still a module
 * reaching the provider without the gateway deciding anything.
 */
const PROVIDER_HOSTS = [
  "api.stripe.com",
  "connect.stripe.com",
  "files.stripe.com",
  "js.stripe.com",
  "checkout.stripe.com",
  "m.stripe.network",
  "checkout.adyen.com",
  "api.braintreegateway.com",
]

/** Environment names that would carry provider credentials. */
const PROVIDER_SECRETS =
  /process\.env\.(?:STRIPE|ADYEN|BRAINTREE|SQUARE)_[A-Z0-9_]+|process\.env\[\s*["'](?:STRIPE|ADYEN|BRAINTREE|SQUARE)_[A-Z0-9_]+["']\s*\]/

/** The only two specifiers a module may reach payments through. */
const PAYMENT_ENTRY_POINTS = ["@tenure/payments", "@tenure/payments/gateway"]

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8")
  } catch {
    return ""
  }
}

/**
 * Import specifiers: `import … from "x"`, `export … from "x"`, bare
 * `import "x"`, `require("x")` and a literal `import("x")`.
 *
 * The clause matcher spans newlines, bounded to 600 characters, and that is not
 * a detail. A single-line reader — `import\s[^\n]*?from` — is what the existing
 * PAY-020-002 guard uses, and it misses
 *
 *     import {
 *       describeMerchant,
 *     } from "@tenure/payments/gateway"
 *
 * which is the form `apps/web/src/lib/finance.ts` actually uses, and therefore
 * every multi-line import of a provider SDK too. The first draft of this file
 * inherited that regex and concluded that no module reaches payments at all —
 * a clean result produced by a blind reader, which is the exact failure this
 * suite exists to refuse. `export … from` is included because `index.ts` in
 * every platform package is nothing else, so a re-export chain is otherwise an
 * edge the graph does not have.
 */
function importsOf(text) {
  const found = []
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[\s\S]{0,600}?from\s+["']([^"']+)["']/g)) {
    found.push(m[1])
  }
  for (const m of text.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) found.push(m[1])
  for (const m of text.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) found.push(m[1])
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push(m[1])
  return [...new Set(found)]
}

/** A `require()`/`import()` whose argument is not a literal string. */
function computedDynamicImports(text) {
  return [...text.matchAll(/\b(?:require|import)\(\s*(?!["')])([^)\n]{1,60})/g)].map((m) => m[1].trim())
}

const WORKSPACE_ALIASES = {
  "@tenure/payments": "packages/payments/src/index.ts",
  "@tenure/payments/gateway": "packages/payments/src/gateway.ts",
  "@tenure/blueprints": "blueprints/index.ts",
  "@tenure/modules": "modules/index.ts",
}

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx", "/index.mjs"]

/** Resolve one specifier to a repo-relative file, or null when it is external. */
function resolve(fromFile, spec) {
  let base
  if (spec.startsWith(".")) {
    base = path.posix.join(path.posix.dirname(fromFile.split(path.sep).join("/")), spec)
  } else if (spec.startsWith("@/")) {
    base = `apps/web/src/${spec.slice(2)}`
  } else if (WORKSPACE_ALIASES[spec]) {
    base = WORKSPACE_ALIASES[spec]
  } else if (spec.startsWith("@tenure/")) {
    const [, pkg, ...rest] = spec.split("/")
    base = rest.length > 0 ? `packages/${pkg}/src/${rest.join("/")}` : `packages/${pkg}/src/index`
  } else {
    return null
  }

  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${base}${suffix}`
    const abs = path.join(ROOT, candidate)
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return candidate
  }
  return null
}

/** Every file reachable from `entries`, following imports we can resolve. */
function importGraph(entries) {
  const seen = new Set()
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    for (const spec of importsOf(read(file))) {
      const resolved = resolve(file, spec)
      if (resolved && !seen.has(resolved)) queue.push(resolved)
    }
  }
  return [...seen].sort()
}

/** `{ key, hrefs }` per module, read out of the catalog as text. */
function modulesWithNav() {
  const text = fs.readFileSync(path.join(ROOT, MANIFESTS), "utf8")
  const keys = [...text.matchAll(/\bkey:\s*"([\w-]+)"/g)].map((m) => m[1])
  const byKey = new Map(keys.map((key) => [key, []]))

  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    const body = m[1]
    const id = body.match(/\bid:\s*"([\w.-]+)"/)?.[1]
    const href = body.match(/\bhref:\s*"([^"]*)"/)?.[1]
    if (!id || !href) continue
    const key = id.split(".")[0]
    if (byKey.has(key)) byKey.get(key).push(href)
  }
  return [...byKey].map(([key, hrefs]) => ({ key, hrefs: [...new Set(hrefs)] }))
}

/** Tenant page files by the URL they serve, route groups stripped. */
function pagesByRoute() {
  const out = new Map()
  for (const page of collect().pages.filter((p) => p.experience === "tenant")) {
    const route = page.route.replace(/\/\([^)]+\)/g, "") || "/"
    if (!out.has(route)) out.set(route, [])
    out.get(route).push(page.file)
  }
  return out
}

/**
 * Every page a module's navigation entry leads to — the entry itself and
 * everything beneath it.
 *
 * A nav href is a section root, not a leaf: `organizations.list` points at
 * `/orgs`, and the page that renders a club's finances is `/orgs/[slug]/finance`.
 * Scanning only the exact route was the first draft of this file and it found
 * that NO module reached payments at all, which was true of the entry pages and
 * false of the module — the port's only production consumer,
 * `apps/web/src/lib/finance.ts`, is imported two levels down. Stopping at the
 * root would have made this test's silence a fact about the depth of the scan.
 */
function pagesUnder(href, routes) {
  const files = []
  for (const [route, entries] of routes) {
    if (route === href || route.startsWith(`${href}/`)) files.push(...entries)
  }
  return files
}

test("the enumeration finds the modules, their pages and a real import graph", () => {
  const modules = modulesWithNav()
  assert.ok(
    modules.length >= 12,
    `Parsed ${modules.length} modules out of ${MANIFESTS}; expected at least 12. A broken reader ` +
      `reports every module as clean.`,
  )

  const routes = pagesByRoute()
  const withNav = modules.filter((m) => m.hrefs.length > 0)
  assert.ok(withNav.length >= 8, `only ${withNav.length} modules declare navigation.`)

  const unserved = []
  for (const mod of withNav) {
    for (const href of mod.hrefs) {
      if (!routes.has(href)) unserved.push(`${mod.key} → ${href}`)
    }
  }
  assert.deepEqual(unserved, [], `module navigation points at routes nothing serves: ${unserved}`)

  const graph = importGraph(withNav.flatMap((m) => m.hrefs.flatMap((h) => pagesUnder(h, routes))))
  assert.ok(
    graph.length >= 100,
    `The transitive import graph of every module page is ${graph.length} files; expected more ` +
      `than 100. A resolver that resolves nothing produces a clean scan of the entry points alone.`,
  )
  // The graph reaches the shared library and at least one platform package, or
  // it is not transitive at all.
  assert.ok(graph.some((f) => f.startsWith("apps/web/src/lib/")), "the graph reaches no lib module.")
  assert.ok(graph.some((f) => f.startsWith("packages/")), "the graph reaches no platform package.")
})

test("no tenant module's surfaces reach a provider SDK, host, secret or computed import", () => {
  const routes = pagesByRoute()
  const offenders = []

  for (const mod of modulesWithNav()) {
    if (mod.hrefs.length === 0) continue
    const entries = mod.hrefs.flatMap((h) => pagesUnder(h, routes))
    for (const file of importGraph(entries)) {
      const text = read(file)

      for (const spec of importsOf(text)) {
        const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]
        if (PROVIDER_SDKS.includes(pkg)) offenders.push(`${mod.key}: ${file} imports ${spec}`)
      }
      for (const host of PROVIDER_HOSTS) {
        if (text.includes(host)) offenders.push(`${mod.key}: ${file} names ${host}`)
      }
      if (PROVIDER_SECRETS.test(text)) {
        offenders.push(`${mod.key}: ${file} reads a provider secret from the environment`)
      }
      for (const computed of computedDynamicImports(text)) {
        offenders.push(`${mod.key}: ${file} has a computed import(${computed})`)
      }
    }
  }

  assert.deepEqual(
    [...new Set(offenders)].sort(),
    [],
    `a tenant module reaches a payment provider without the port:\n  ${offenders.join("\n  ")}\n` +
      `Bible §4: every business module calls semantic commands and never constructs provider API ` +
      `requests directly. A module holding provider access is a module no gateway can add ` +
      `idempotency, account context, API-version pinning or audit to later.`,
  )
})

test("a module that reaches payments reaches it through a published entry point", () => {
  const routes = pagesByRoute()
  const wrong = []
  const reached = []

  for (const mod of modulesWithNav()) {
    if (mod.hrefs.length === 0) continue
    for (const file of importGraph(mod.hrefs.flatMap((h) => pagesUnder(h, routes)))) {
      for (const spec of importsOf(read(file))) {
        if (!spec.startsWith("@tenure/payments")) continue
        reached.push(`${mod.key}: ${file} → ${spec}`)
        if (!PAYMENT_ENTRY_POINTS.includes(spec)) wrong.push(`${mod.key}: ${file} → ${spec}`)
      }
    }
  }

  assert.deepEqual(
    wrong,
    [],
    `a module imports a payments INTERNAL module rather than an entry point:\n  ${wrong.join("\n  ")}\n` +
      `Deep-importing past the index is how a module acquires a symbol the port deliberately does ` +
      `not export.`,
  )
  // Not vacuous: at least one module really does reach payments, so the rule
  // above is being applied to something.
  assert.ok(
    reached.length > 0,
    `No module's surfaces reach @tenure/payments at all. Either the resolver is broken or the ` +
      `port has no consumer, and both make this test's silence meaningless.`,
  )
})

test("every detector fires on text that contains the bypass it looks for", () => {
  // The positive control. Nothing above can distinguish "no module bypasses the
  // port" from "the scan looked at nothing", and this repository has shipped
  // that mistake before.
  const sdk = `import Stripe from "stripe"\n`
  assert.deepEqual(importsOf(sdk), ["stripe"], "the import reader misses a plain SDK import.")

  const host = `await fetch("https://api.stripe.com/v1/charges", { method: "POST" })`
  assert.ok(
    PROVIDER_HOSTS.some((h) => host.includes(h)),
    "the host detector misses a raw REST call to the provider.",
  )

  const secret = `const key = process.env.STRIPE_SECRET_KEY`
  assert.ok(PROVIDER_SECRETS.test(secret), "the secret detector misses a direct env read.")
  const bracketed = `const key = process.env["STRIPE_SECRET_KEY"]`
  assert.ok(PROVIDER_SECRETS.test(bracketed), "the secret detector misses the bracket form.")
  assert.ok(
    !PROVIDER_SECRETS.test(`const url = process.env.DATABASE_URL`),
    "the secret detector fires on an unrelated environment variable.",
  )

  const computed = `const sdk = await import(providerName)`
  assert.deepEqual(
    computedDynamicImports(computed),
    ["providerName"],
    "the computed-import detector misses a runtime specifier.",
  )
  assert.deepEqual(
    computedDynamicImports(`const m = await import("./safe")`),
    [],
    "the computed-import detector fires on a literal specifier.",
  )

  const deep = `import { chargeCustomer } from "@tenure/payments/src/internal"`
  assert.ok(
    !PAYMENT_ENTRY_POINTS.includes(importsOf(`\n${deep}`)[0]),
    "the entry-point rule would accept a deep import into the payments package.",
  )
})
