import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * PAY-020-002 — a business module reaches payments through the port, or not at all.
 *
 * Bible §4: "Every business module calls semantic commands… It never constructs
 * provider API requests directly." The rule was previously unenforceable
 * because there was nothing to point a module AT — `packages/payments` did not
 * exist, and `apps/web/src/lib/commands/bus.ts`, the other candidate, had zero
 * production callers.
 *
 * Three properties, and the third is the one that keeps the port a port:
 *
 *   1. No source file imports a provider SDK, and no `package.json` depends on
 *      one. `forbidden-clients.test.mjs` does this for the database, AWS and
 *      the model vendor; this is the same shape for the payment provider.
 *   2. `@tenure/payments` declares no dependencies at all, so nothing can
 *      arrive transitively.
 *   3. The port carries no write verb. Not "not implemented yet" — absent, so a
 *      module cannot call one and a reviewer cannot miss one being added.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const GATEWAY = "packages/payments/src/gateway.ts"

/** Provider SDK package names. Importing any of them bypasses the port. */
const PROVIDER_SDKS = ["stripe", "@stripe/stripe-js", "@stripe/react-stripe-js", "adyen", "@adyen/api-library", "braintree", "square"]

function read(file) {
  try {
    return fs.readFileSync(path.join(ROOT, file), "utf8")
  } catch {
    return ""
  }
}

function sourceFiles() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "apps", "packages", "modules", "blueprints"],
    { encoding: "utf8", cwd: ROOT },
  )
    .split("\n")
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|mjs|cjs|jsx?)$/.test(f))

  assert.ok(files.length > 100, `only ${files.length} source files found — the scan is broken.`)
  return files
}

/** Import specifiers, from `import … from "x"` and `require("x")`. */
function importsOf(text) {
  const found = []
  for (const m of text.matchAll(/(?:^|\n)\s*import\s[^\n]*?from\s+["']([^"']+)["']/g)) found.push(m[1])
  for (const m of text.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) found.push(m[1])
  for (const m of text.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) found.push(m[1])
  return found
}

test("no source file imports a provider SDK", () => {
  const offenders = []
  for (const file of sourceFiles()) {
    for (const spec of importsOf(read(file))) {
      const base = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]
      if (PROVIDER_SDKS.includes(base)) offenders.push(`${file} → ${spec}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these files construct a payment provider client directly:\n  ${offenders.join("\n  ")}\n` +
      `Go through @tenure/payments. A module holding a provider client is a module no gateway can ` +
      `add idempotency, account context, API-version pinning or audit to later (Bible §4).`,
  )
})

test("no workspace declares a dependency on a provider SDK", () => {
  const manifests = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "*package.json"],
    { encoding: "utf8", cwd: ROOT },
  )
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.includes("node_modules"))

  assert.ok(manifests.length >= 4, `only ${manifests.length} manifests found — the scan is broken.`)

  const offenders = []
  for (const file of manifests) {
    let json
    try {
      json = JSON.parse(read(file))
    } catch {
      continue
    }
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const name of Object.keys(json[field] ?? {})) {
        if (PROVIDER_SDKS.includes(name)) offenders.push(`${file} → ${field}.${name}`)
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a workspace depends on a provider SDK:\n  ${offenders.join("\n  ")}\n` +
      `The port is provider-neutral by construction; a dependency is how it stops being.`,
  )
})

test("@tenure/payments declares no dependencies at all", () => {
  const manifest = JSON.parse(read("packages/payments/package.json"))
  for (const field of ["dependencies", "peerDependencies"]) {
    assert.deepEqual(
      Object.keys(manifest[field] ?? {}),
      [],
      `@tenure/payments declares ${field}. Nothing may arrive transitively into the one package ` +
        `every business module is told to go through.`,
    )
  }
})

test("the client-safe subpath reaches no node builtin", () => {
  // `apps/web/src/lib/finance.ts` imports `@tenure/payments/gateway` and is
  // imported by client components. A node builtin anywhere in that import graph
  // fails the Next build with UnhandledSchemeError — which is discovered at
  // build time, in CI, after the change has been merged.
  const manifest = JSON.parse(read("packages/payments/package.json"))
  assert.equal(
    manifest.exports?.["./gateway"],
    "./src/gateway.ts",
    "the ./gateway subpath is gone, so finance.ts has nothing client-safe to import.",
  )

  const seen = new Set()
  const queue = [GATEWAY]
  const builtins = []
  while (queue.length > 0) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    for (const spec of importsOf(read(file))) {
      if (spec.startsWith("node:") || ["fs", "path", "crypto", "os"].includes(spec)) {
        builtins.push(`${file} → ${spec}`)
        continue
      }
      if (!spec.startsWith(".")) continue
      const resolved = path.posix.join(path.posix.dirname(file), `${spec}.ts`)
      queue.push(resolved)
    }
  }

  assert.deepEqual(
    builtins,
    [],
    `the client-safe payments subpath reaches a node builtin:\n  ${builtins.join("\n  ")}\n` +
      `Move whatever needs it behind the package root, which is server-only.`,
  )
  assert.ok(seen.size >= 3, `only ${seen.size} files walked from ${GATEWAY} — the walk is broken.`)
})

test("the port carries no write verb", () => {
  // Absent, not unimplemented. A `charge` that throws is still a symbol a
  // module can reach for, and the next person implements it.
  const source = read(GATEWAY)
  assert.ok(source.length > 0, `${GATEWAY} is missing.`)

  const exported = [...source.matchAll(/export function (\w+)/g)].map((m) => m[1])
  assert.ok(exported.length > 0, "no exported functions found — this guard is not reading the port.")

  const WRITE_VERBS = /^(charge|capture|refund|payout|transfer|disburse|issue|void|cancel|create|update|delete|send|submit|execute|pay)/i
  const offenders = exported.filter((name) => WRITE_VERBS.test(name))

  assert.deepEqual(
    offenders,
    [],
    `the payments port exports write verbs: ${offenders.join(", ")}. Every export must answer a ` +
      `question. NEXT-SESSION §0.3 forbids executing money movement outright, and a surface that ` +
      `can express one is a surface somebody will call.`,
  )
})

test("the port's real consumer is wired, not merely available", () => {
  // A port nothing imports is a package. `apps/web/src/lib/finance.ts` is the
  // consumer this session wired; asserting it here is what turns "the type
  // exists" into "a production caller uses it".
  const finance = read("apps/web/src/lib/finance.ts")
  assert.match(
    finance,
    /from "@tenure\/payments\/gateway"/,
    "apps/web/src/lib/finance.ts no longer imports the payments port. The port would then have no " +
      "production consumer, which is the exact state PAY-020-002 was opened for.",
  )
  assert.match(
    finance,
    /describeMerchant\(/,
    "finance.ts imports the port but calls nothing from it.",
  )
})
