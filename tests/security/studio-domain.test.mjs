/**
 * The Studio's public hostname, and the four places a rename has to reach.
 *
 * This is a security test rather than an infrastructure one because the failure
 * it guards is an authentication failure. The console's hostname is not
 * cosmetic: NextAuth compares the incoming Host against `AUTH_URL`, and Cognito
 * refuses a `redirect_uri` that is not in `callback_urls`. So the name appears
 * in four load-bearing places —
 *
 *   infrastructure/studio/cognito.tf  callback_urls
 *   infrastructure/studio/cognito.tf  logout_urls
 *   infrastructure/studio/ecs.tf      AUTH_URL
 *   infrastructure/studio/ecs.tf      NEXTAUTH_URL
 *
 * — and a rename that reaches three of them produces a console that loads,
 * shows a sign-in button, and cannot sign anybody in. The error surfaces at the
 * identity provider ("redirect_mismatch"), not in the Terraform diff, which is
 * why a human reviewing the change does not catch it. These tests do.
 *
 * The other half is the certificate. CloudFront reads an ACM certificate only
 * from us-east-1 and refuses an alias it has no certificate for, so the alias,
 * the viewer certificate and the auth URLs are one atomic move.
 *
 * Run: node --test tests/security/studio-domain.test.mjs
 *      npm run test:platform
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const STUDIO = "infrastructure/studio"

const read = (rel) => fs.readFileSync(path.join(STUDIO, rel), "utf8")

const acm = read("acm.tf")
const cloudfront = read("cloudfront.tf")
const cognito = read("cognito.tf")
const ecs = read("ecs.tf")
const variables = read("variables.tf")

/**
 * A top-level block's body. `terraform fmt` puts the closing brace of a
 * top-level block at column 0 and nothing else there, so this needs no brace
 * counting — which matters, because several descriptions here are heredocs
 * containing braces of their own.
 */
function block(src, header) {
  const start = src.indexOf(`${header} {`)
  assert.ok(start >= 0, `${header} is not declared`)
  const end = src.indexOf("\n}\n", start)
  assert.ok(end > start, `${header} has no closing brace at column 0`)
  return src.slice(start, end)
}

test("the studio hostname is a variable with a working default, not a literal", () => {
  const v = block(variables, 'variable "studio_domain"')
  assert.match(v, /type\s*=\s*string/)
  assert.match(
    v,
    /default\s*=\s*"[^"]+"/,
    "studio_domain must carry a default; an unset hostname must not break the stack",
  )

  // The hostname must not be written into any resource directly. If it is, the
  // next rename is a find-replace across four files and the one it misses is
  // the one that breaks sign-in.
  for (const [name, src] of [
    ["cloudfront.tf", cloudfront],
    ["cognito.tf", cognito],
    ["ecs.tf", ecs],
  ]) {
    assert.ok(
      !/["'][a-z0-9.-]*tenurework\.com/i.test(src),
      `${name} writes a tenurework.com hostname as a literal; it must read var.studio_domain`,
    )
    assert.ok(
      !/["'][a-z0-9.-]*cloudfront\.net/i.test(src),
      `${name} writes a cloudfront.net hostname as a literal; it must read the distribution's attribute`,
    )
  }
})

test("the custom name is not attached until the certificate is issued", () => {
  const v = block(variables, 'variable "attach_studio_domain"')
  assert.match(v, /type\s*=\s*bool/)
  assert.match(
    v,
    /default\s*=\s*false/,
    "attach_studio_domain must default false. Attaching an unvalidated certificate fails the apply, " +
      "and a default of true means the first apply on a fresh account fails.",
  )
})

test("the certificate is requested where CloudFront can read it — us-east-1 only", () => {
  // The certificate uses the default provider, so the default provider's region
  // IS the certificate's region. Two things therefore have to hold together.
  assert.ok(
    !/provider\s*=/.test(block(acm, 'resource "aws_acm_certificate" "studio"')),
    "the certificate uses the default provider; if that changes, the region assertion below stops meaning anything",
  )
  assert.match(
    block(variables, 'variable "aws_region"'),
    /default\s*=\s*"us-east-1"/,
    "CloudFront accepts a viewer certificate only from us-east-1. This stack's default provider region " +
      "is the certificate's region, so moving the default off us-east-1 silently requests the certificate " +
      "somewhere CloudFront will not read it.",
  )
  assert.match(
    acm,
    /us-east-1/,
    "acm.tf must state the us-east-1 constraint in a comment — the next person to move the region reads the file, not this test",
  )
})

test("the alias and the viewer certificate move together", () => {
  const dist = block(cloudfront, 'resource "aws_cloudfront_distribution" "studio"')

  assert.match(
    dist,
    /aliases\s*=\s*var\.attach_studio_domain\s*\?\s*\[var\.studio_domain\]\s*:\s*\[\]/,
    "the alias must be the studio_domain variable, gated on attach_studio_domain",
  )

  // CloudFront rejects an alias with no certificate covering it, and rejects a
  // certificate with no alias using it. Both sides of the switch, or the apply
  // fails — which is the safe direction, but it fails after the plan looked fine.
  assert.match(dist, /cloudfront_default_certificate\s*=\s*var\.attach_studio_domain\s*\?\s*null\s*:\s*true/)
  assert.match(dist, /acm_certificate_arn\s*=\s*var\.attach_studio_domain\s*\?\s*aws_acm_certificate\.studio\[0\]\.arn\s*:\s*null/)
  assert.match(dist, /ssl_support_method\s*=\s*var\.attach_studio_domain\s*\?\s*"sni-only"\s*:\s*null/)
})

test("all four auth URLs read the one hostname, and none is written twice", () => {
  assert.match(
    cognito,
    /callback_urls\s*=\s*\[for h in local\.studio_auth_hosts\s*:\s*"https:\/\/\$\{h\}\/api\/auth\/callback\/cognito"\]/,
    "Cognito callback_urls must derive from local.studio_auth_hosts",
  )
  assert.match(
    cognito,
    /logout_urls\s*=\s*\[for h in local\.studio_auth_hosts\s*:\s*"https:\/\/\$\{h\}\/signin"\]/,
    "Cognito logout_urls must derive from local.studio_auth_hosts",
  )
  assert.match(
    ecs,
    /name\s*=\s*"AUTH_URL",\s*value\s*=\s*local\.studio_origin/,
    "the task's AUTH_URL must derive from local.studio_origin",
  )
  assert.match(
    ecs,
    /name\s*=\s*"NEXTAUTH_URL",\s*value\s*=\s*local\.studio_origin/,
    "the task's NEXTAUTH_URL must derive from local.studio_origin",
  )

  // The point of the locals is that these two files never name a host. A direct
  // reference to the distribution here is how three of the four move and the
  // fourth does not.
  for (const [name, src] of [
    ["cognito.tf", cognito],
    ["ecs.tf", ecs],
  ]) {
    assert.ok(
      !/aws_cloudfront_distribution\.studio\.domain_name/.test(src),
      `${name} reads the CloudFront domain directly. Every auth URL must go through local.studio_host, ` +
        `or a rename reaches some of them and not others.`,
    )
    assert.ok(
      !/var\.studio_domain/.test(src),
      `${name} reads var.studio_domain directly, bypassing the attach_studio_domain gate — ` +
        `it would point auth at a hostname that does not resolve yet.`,
    )
  }
})

test("the CloudFront domain is the fallback, so an unset name breaks nothing", () => {
  assert.match(
    acm,
    /studio_host\s*=\s*var\.attach_studio_domain\s*\?\s*var\.studio_domain\s*:\s*aws_cloudfront_distribution\.studio\.domain_name/,
    "local.studio_host must fall back to the CloudFront domain",
  )
  assert.match(acm, /studio_origin\s*=\s*"https:\/\/\$\{local\.studio_host\}"/)

  // Cognito keeps BOTH hosts while the custom name is attached. Flipping the
  // variable and moving the DNS are separate events; an operator who arrives on
  // the old hostname in between must not be locked out by the change that was
  // meant to improve things.
  const authHosts = acm.slice(acm.indexOf("studio_auth_hosts"))
  assert.match(authHosts, /local\.studio_host/)
  assert.match(
    authHosts,
    /aws_cloudfront_distribution\.studio\.domain_name/,
    "the CloudFront domain must stay an accepted callback host, or attaching the custom name locks the operator out mid-cutover",
  )
})

test("no hosted zone id is invented anywhere in the stack", () => {
  // A literal zone id anywhere in the infrastructure tree is the shape of the
  // failure: somebody pasted one from a console rather than reading it from a
  // variable. Route 53 accepts any well-formed id this account can write, so a
  // guessed one publishes a CNAME into the wrong domain and the apply SUCCEEDS
  // while the certificate never validates — a wrong answer that reads green.
  // Route 53 ids are conventionally Z-prefixed and 13-32 chars.
  const files = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".tf")) files.push(p)
    }
  }
  walk("infrastructure")

  const offenders = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    for (const line of src.split("\n")) {
      if (line.trimStart().startsWith("#")) continue // prose may give an example
      const m = line.match(/"(Z[A-Z0-9]{12,31})"/)
      if (m) offenders.push(`${f}: ${m[1]}`)
    }
  }
  assert.deepEqual(offenders, [], `hard-coded Route 53 hosted zone id(s): ${offenders.join(", ")}`)
})

test("nothing in this stack waits on a DNS record it does not write", () => {
  const studioTf = fs
    .readdirSync(STUDIO)
    .filter((f) => f.endsWith(".tf"))
    .map((f) => [f, read(f)])

  for (const [name, src] of studioTf) {
    // `aws_acm_certificate_validation` polls ACM until the certificate is
    // ISSUED. That is correct ONLY when Terraform also writes the validation
    // record. Here it does not — the CNAME is published by a person at whoever
    // holds tenurework.com — so this resource would hold the apply open for its
    // full timeout and then fail. An apply that hangs 45 minutes and fails is
    // worse than one that prints the CNAME and stops.
    assert.ok(
      !/resource\s+"aws_acm_certificate_validation"/.test(src),
      `${name} declares aws_acm_certificate_validation. Nothing here writes the validation record, ` +
        `so it would block the apply until it timed out. Add the Route 53 record first, or leave the wait out.`,
    )

    // Route 53 is not in this stack, and adding it is not a one-file change.
    // tests/architecture/every-provisioned-service-has-a-reader.test.mjs goes
    // RED on an unclassified resource type, and its ESTATE has no `route53`
    // service at all — so DNS here would be a service the console cannot show,
    // which is the defect that guard exists to catch. Landing it needs an
    // ESTATE entry, a reader module, a surface director and a wiring-map row.
    assert.ok(
      !/resource\s+"aws_route53_/.test(src),
      `${name} provisions Route 53. That service has no ESTATE entry and no reader; ` +
        `see every-provisioned-service-has-a-reader.test.mjs before adding one.`,
    )
  }

  // The blocker is external, so the file has to name the command that clears
  // it. "Somebody needs to check DNS" is how this sits untouched for a month.
  assert.match(
    acm,
    /aws route53 list-hosted-zones/,
    "acm.tf must name the exact command that would confirm the hosted zone",
  )
})

test("the human path is printed, not left in the console", () => {
  // On the registrar path the apply cannot finish the job, so it has to hand the
  // next step to a person. An output is the hand-off; "go and look it up in ACM"
  // is how a certificate sits PENDING_VALIDATION for a week.
  for (const output of [
    'output "studio_acm_validation_records"',
    'output "studio_acm_certificate_arn"',
    'output "studio_domain_cname_target"',
  ]) {
    assert.ok(acm.includes(output), `missing ${output}`)
  }
  assert.match(
    block(acm, 'output "studio_domain_cname_target"'),
    /value\s*=\s*aws_cloudfront_distribution\.studio\.domain_name/,
    "the CNAME target must be the distribution's real domain, never a remembered one",
  )
})
