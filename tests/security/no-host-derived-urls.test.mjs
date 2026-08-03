import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-044-004 — no URL is built from a request header.
 *
 * An application that constructs its own callback or redirect from `Host` or
 * `X-Forwarded-Host` hands the attacker the redirect. They send
 * `Host: evil.test`, the authorization request goes out with
 * `redirect_uri=https://evil.test/callback`, and the code arrives at their
 * server. Nothing looks unusual — that header is exactly what a reverse proxy
 * legitimately sets.
 *
 * The same header poisons anything else built from it: a password-reset link in
 * an email, an absolute URL in a webhook payload, a canonical link. Each one
 * sends somebody to a host the attacker chose, wearing our name.
 *
 * `resolveCallbackUrl` takes no host and cannot be poisoned. This is what stops
 * somebody adding one elsewhere, and it is written while the count is zero —
 * which is the cheap moment.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const SCAN_ROOTS = ["apps", "packages", "modules", "blueprints"]

function sourceFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", ...SCAN_ROOTS],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter((file) => /\.(ts|tsx|mjs|cjs|jsx?)$/.test(file))
}

/** Source with comments stripped, so prose about the rule is not a breach of it. */
function code(file) {
  let text
  try {
    text = fs.readFileSync(path.join(ROOT, file), "utf8")
  } catch (error) {
    // Another guard writes a probe into the source tree while these run in
    // parallel, and a file listed a moment ago can be gone by the read.
    if (error.code === "ENOENT") return ""
    throw error
  }
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/**
 * Reads of a header that names the requesting **host**.
 *
 * `x-forwarded-proto` is deliberately absent. It names a scheme, not a host, and
 * a scheme cannot send anybody to another server — the poisoning this guard
 * exists for is the authority part of the URL. Including it also fired on
 * `internal-headers.test.ts`, which asserts CloudFront's proto header survives
 * sanitising (`infrastructure/terraform/cloudfront.tf:24`), and a guard that
 * fires on correct code gets an exemption added rather than a bug fixed.
 */
const HOST_HEADER =
  /\.get\(\s*["'`](host|x-forwarded-host|x-forwarded-server|forwarded)["'`]\s*\)|headers\s*\[\s*["'`](host|x-forwarded-host)["'`]\s*\]|\breq(uest)?\.headers\.host\b/gi

/** Exported so the sweep and its self-test exercise the same detector. */
export function hostHeaderReads(text) {
  return [...text.matchAll(HOST_HEADER)].map((match) => match[0])
}

test("no module reads a host header", () => {
  // The strong form. Sanitising the header is the fix people reach for and it
  // does not work — a reverse proxy can be told to set anything, and the value
  // that survives sanitising is still the attacker's choice of which registered
  // host to be. Not reading it is what works.
  const offenders = []

  for (const file of sourceFiles()) {
    for (const read of hostHeaderReads(code(file))) {
      offenders.push(`${file} — ${read}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these read a host header:\n  ${offenders.join("\n  ")}\n` +
      `A URL built from one sends somebody to a host the attacker chose, wearing our name. Use a ` +
      `registered absolute URL — resolveCallbackUrl in @tenure/identity takes no host and cannot be poisoned.`,
  )
})

test("the detector finds the shapes people actually write", () => {
  // Asserted because the failure mode is silence: a matcher that finds nothing
  // reports every file as clean.
  const written = [
    `const host = headers().get("host")`,
    `const host = req.headers.get('x-forwarded-host')`,
    "const h = request.headers.get(`x-forwarded-server`)",
    `const h = req.headers.host`,
    `const h = headers["x-forwarded-host"]`,
  ]
  for (const line of written) {
    assert.equal(hostHeaderReads(line).length, 1, `not detected: ${line}`)
  }
})

test("the detector leaves ordinary header reads alone", () => {
  // A guard that fires on correct code gets an exemption added rather than a
  // bug fixed. These are headers a request legitimately reads.
  const fine = [
    // The scheme header, which CloudFront sends on every request.
    `const proto = headers().get("x-forwarded-proto")`,
    `const auth = headers().get("authorization")`,
    `const origin = req.headers.get("origin")`,
    `const referer = req.headers.get("referer")`,
    `const type = headers().get("content-type")`,
    `const hostname = new URL(registered).hostname`,
  ]
  for (const line of fine) {
    assert.deepEqual(hostHeaderReads(line), [], `false positive: ${line}`)
  }
})

test("resolveCallbackUrl takes nothing a request can influence", () => {
  // The positive half. The rule is enforced by the signature: a function with no
  // host parameter cannot be given one, and adding it is a diff a reviewer sees.
  const source = code("packages/identity/src/request-origin.ts")
  const signature = source.slice(
    source.indexOf("export function resolveCallbackUrl"),
    source.indexOf("): CallbackUrlOutcome"),
  )

  assert.ok(signature.length > 0, "resolveCallbackUrl not found — has it been renamed?")
  assert.ok(
    !/\b(host|headers|baseUrl|origin|request)\b/i.test(signature),
    `resolveCallbackUrl now takes something a request controls:\n${signature}`,
  )
  assert.match(signature, /registered/, "it must take the registered set")
})

test("the origin allowlist fails closed", () => {
  // A missing environment variable must not become an open door, and the
  // direction of that default is not something to leave to a code review.
  const source = code("packages/identity/src/request-origin.ts")

  assert.match(source, /NO_ALLOWLIST/, "an empty allowlist must be a named refusal")
  assert.ok(
    /allowed\.length === 0[\s\S]{0,200}ok: false/.test(source),
    "an empty allowlist must refuse rather than allow",
  )
})
