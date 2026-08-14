import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

/**
 * STUDIO-000-002 / STUDIO-000-008 — the ratchet that makes a dark AWS service
 * impossible to ship.
 *
 * -002 asks for every infrastructure stack relevant to System Studio to be
 * mapped; -008 asks for a resource graph carrying owner, stack and dependencies.
 * Both are satisfiable by a document, and a document is what was there. This is
 * the half that can refuse: the map, expressed as an assertion.
 *
 * The defect, in the operator's words: "Wiring of AWS to Tenure global system is
 * not at all fully completed (this is critical)." It was true for months, it was
 * invisible, and the only way anybody found it was by counting SDK clients by
 * hand against the Terraform. A service that is provisioned but never read does
 * not fail anything — it renders as an absence, and an absence reads exactly
 * like a clean estate.
 *
 * This file makes the count automatic and makes it a build gate. It runs under
 * `npm run test:platform` (`tools/run-platform-tests.mjs` discovers every
 * `tests/**\/*.test.mjs`), which `.github/workflows/ci.yml` runs on every push.
 * That is the production caller: no human has to remember to count.
 *
 * THE TABLE IS EXPLICIT, ON PURPOSE. A regex over the resource type would get
 * `aws_cloudwatch_event_rule` (EventBridge, `events:*`) and
 * `aws_cloudwatch_log_group` (CloudWatch Logs, `logs:*`) both wrong, and would
 * do it silently — it would map them to `cloudwatch`, find a capability, find
 * `alarms.ts`, and report GREEN over two services nothing reads. Every mapping
 * below is a decision somebody made and can be argued with.
 *
 * BYTE-STABILITY. Five red builds in this repository came from a guard that
 * held on one platform and not the other. Everything here reads directories in
 * sorted order, converts every path to forward slashes before it is compared or
 * printed, splits on `/\r?\n/` so a CRLF checkout produces the same tokens as an
 * LF one, and hashes nothing. The output of a failure is identical on Linux and
 * Windows.
 *
 * NOTHING IS INFERRED FROM AWS. This test never opens a socket and needs no
 * credentials: it compares three committed artefacts — the Terraform, the
 * capability catalogue, and the reader modules — against one another.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const STUDIO_SRC = "apps/system-studio/src"
const READER_DIR = `${STUDIO_SRC}/lib/aws`
const CAPABILITIES = `${READER_DIR}/capabilities.ts`
const WIRING_MAP = "docs/architecture/aws-wiring-map.md"

/** Read a repo-relative POSIX path. Callers never build a native path. */
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split("/")), "utf8")
const exists = (rel) => fs.existsSync(path.join(ROOT, ...rel.split("/")))

/** Lines, with the checkout's line endings normalised away. */
const lines = (text) => text.split(/\r?\n/)

/* ------------------------------------------------------------ the table -- */

/**
 * Every AWS service the estate provisions, and how it reaches an operator.
 *
 * One record per SERVICE, keyed by the IAM service prefix — the same token the
 * capability catalogue is keyed on, which is what lets the two be compared
 * without a translation layer that could itself be wrong.
 *
 *   * `resources` — the `aws_*` Terraform resource types that provision it.
 *     Asserted to be exactly the set declared under `infrastructure/`, in both
 *     directions: a new resource type nobody classified is a red build, and a
 *     type listed here that no longer exists is also a red build.
 *   * `readers` — modules under `apps/system-studio/src/lib/aws/`. Readers are
 *     the ONLY path to the SDK; a surface that reaches AWS directly is a
 *     separate guard's problem, and this one asserts the module exists.
 *   * `surfaces` — route directories under `apps/system-studio/src/`. Named as
 *     DIRECTORIES rather than files so that renaming `answer.ts` inside a route
 *     does not red this test, while deleting the last import in that route
 *     does. At least one file in the directory must import one of the readers.
 */
const ESTATE = [
  {
    service: "acm",
    name: "Certificate Manager",
    resources: ["aws_acm_certificate"],
    readers: ["certificates"],
    surfaces: [],
  },
  {
    service: "cloudfront",
    name: "CloudFront",
    resources: ["aws_cloudfront_distribution", "aws_cloudfront_function"],
    readers: ["cdn"],
    surfaces: [],
  },
  {
    // Alarms, metrics and dashboards. NOT log groups and NOT event rules,
    // which share the `aws_cloudwatch_*` Terraform prefix and are separate
    // services with separate IAM prefixes. This is the mapping a regex ruins.
    service: "cloudwatch",
    name: "CloudWatch (alarms, metrics, dashboards)",
    resources: ["aws_cloudwatch_dashboard", "aws_cloudwatch_metric_alarm"],
    readers: ["alarms", "metrics", "dashboards"],
    surfaces: ["app/platform/health", "app/platform/messaging"],
  },
  {
    // EventBridge. Terraform still calls these `aws_cloudwatch_event_*` for
    // historical reasons; IAM has called them `events:*` since the rename.
    service: "events",
    name: "EventBridge",
    resources: [
      "aws_cloudwatch_event_api_destination",
      "aws_cloudwatch_event_connection",
      "aws_cloudwatch_event_rule",
      "aws_cloudwatch_event_target",
    ],
    readers: ["eventbridge"],
    surfaces: ["app/platform/messaging"],
  },
  {
    // CloudWatch Logs. `logs:*`, not `cloudwatch:*` — a role granted
    // `cloudwatch:DescribeLogGroups` is granted nothing at all.
    service: "logs",
    name: "CloudWatch Logs",
    resources: ["aws_cloudwatch_log_group"],
    readers: ["logs"],
    surfaces: [],
  },
  {
    service: "cognito-idp",
    name: "Cognito user pools",
    resources: [
      "aws_cognito_user",
      "aws_cognito_user_pool",
      "aws_cognito_user_pool_client",
      "aws_cognito_user_pool_domain",
    ],
    readers: ["cognito"],
    surfaces: ["app/platform/identity"],
  },
  {
    service: "rds",
    name: "RDS",
    resources: ["aws_db_instance", "aws_db_parameter_group", "aws_db_subnet_group"],
    readers: ["database"],
    surfaces: ["app/platform/data"],
  },
  {
    service: "dynamodb",
    name: "DynamoDB",
    resources: ["aws_dynamodb_table"],
    readers: ["dynamodb-tables"],
    surfaces: ["app/platform/data", "app/platform/audit"],
  },
  {
    service: "ecr",
    name: "ECR",
    resources: ["aws_ecr_lifecycle_policy", "aws_ecr_repository"],
    readers: ["ecr"],
    surfaces: ["app/platform/compute"],
  },
  {
    service: "ecs",
    name: "ECS",
    resources: [
      "aws_ecs_cluster",
      "aws_ecs_cluster_capacity_providers",
      "aws_ecs_service",
      "aws_ecs_task_definition",
    ],
    readers: ["containers"],
    surfaces: ["app/platform/compute"],
  },
  {
    service: "elasticache",
    name: "ElastiCache",
    resources: [
      "aws_elasticache_cluster",
      "aws_elasticache_parameter_group",
      "aws_elasticache_subnet_group",
    ],
    readers: ["elasticache"],
    surfaces: ["app/platform/data"],
  },
  {
    service: "iam",
    name: "IAM",
    resources: [
      "aws_iam_openid_connect_provider",
      "aws_iam_policy",
      "aws_iam_role",
      "aws_iam_role_policy",
      "aws_iam_role_policy_attachment",
    ],
    readers: ["iam"],
    surfaces: ["app/platform/identity", "app/platform/security"],
  },
  {
    // VPC, subnets, route tables, gateways and security groups are all EC2 in
    // IAM's vocabulary, however many Terraform resource names they wear.
    service: "ec2",
    name: "EC2 / VPC",
    resources: [
      "aws_internet_gateway",
      "aws_route_table",
      "aws_route_table_association",
      "aws_security_group",
      "aws_subnet",
      "aws_vpc",
      "aws_vpc_security_group_egress_rule",
      "aws_vpc_security_group_ingress_rule",
    ],
    readers: ["network"],
    surfaces: ["app/platform/network"],
  },
  {
    service: "elasticloadbalancing",
    name: "Elastic Load Balancing v2",
    resources: ["aws_lb", "aws_lb_listener", "aws_lb_target_group"],
    readers: ["loadbalancer"],
    surfaces: ["app/platform/network"],
  },
  {
    service: "s3",
    name: "S3",
    resources: [
      "aws_s3_bucket",
      "aws_s3_bucket_cors_configuration",
      "aws_s3_bucket_lifecycle_configuration",
      "aws_s3_bucket_public_access_block",
      "aws_s3_bucket_server_side_encryption_configuration",
      "aws_s3_bucket_versioning",
    ],
    readers: ["buckets"],
    surfaces: ["app/platform/data"],
  },
  {
    service: "secretsmanager",
    name: "Secrets Manager",
    resources: ["aws_secretsmanager_secret", "aws_secretsmanager_secret_version"],
    readers: ["secrets"],
    surfaces: ["app/platform/identity"],
  },
  {
    // SES v1 and SES v2 resource names both map to the `ses:*` prefix; the v2
    // API actions are `ses:` too, which is why `aws_sesv2_*` is not a service
    // of its own here.
    service: "ses",
    name: "SES",
    resources: [
      "aws_ses_configuration_set",
      "aws_ses_domain_dkim",
      "aws_ses_domain_identity",
      "aws_ses_email_identity",
      "aws_sesv2_account_suppression_attributes",
    ],
    readers: ["ses"],
    surfaces: ["app/platform/messaging"],
  },
  {
    service: "sqs",
    name: "SQS",
    resources: ["aws_sqs_queue"],
    readers: ["sqs"],
    surfaces: ["app/platform/messaging"],
  },
]

/* --------------------------------------------------------- the ratchets -- */

/**
 * Provisioned services with a reader module that NO surface imports yet.
 *
 * A reader nothing imports is dead code. The service is still dark to the
 * operator: the SDK call exists, the page does not make it. These three are
 * knowingly unrendered, each for a stated reason, and the list MAY ONLY GET
 * SHORTER.
 *
 * When you wire one of these into a route, DELETE ITS ENTRY AND LOWER
 * `AWAITING_A_SURFACE_CEILING` BY ONE in the same commit. The equality
 * assertion below will red until you do — deliberately. That red is the moment
 * somebody notices progress, or its absence; it is the same shape as
 * `RAW_WRITE_CEILING` in `tests/security/audit-writes.test.mjs`.
 *
 * Do NOT raise the ceiling to admit a new dark service. A provisioned service
 * whose reader nothing renders is the exact defect this file was opened
 * against, and widening the guard to let one through is how it shipped the
 * first time.
 */
const AWAITING_A_SURFACE = [
  {
    service: "acm",
    reason:
      "certificates.ts reads ACM detail (expiry, validation records, renewal state) " +
      "but no route imports it yet; certificate expiry currently reaches the operator " +
      "only through the load-balancer listener view, which shows the ARN and not the clock.",
  },
  {
    service: "cloudfront",
    reason:
      "cdn.ts reads distribution config and invalidation backlog; the edge surface that " +
      "renders origin protocol, TLS floor and WAF association has no route yet, so a " +
      "misconfigured distribution is invisible to the console.",
  },
  {
    service: "logs",
    reason:
      "logs.ts reads log-group retention, encryption and metric filters. No route renders " +
      "it, so a log group provisioned with no retention (unbounded storage, unbounded " +
      "spend) shows up nowhere.",
  },
]

/** MAY ONLY FALL. See the note above before you touch this number. */
const AWAITING_A_SURFACE_CEILING = 3

/**
 * Provisioned services with NO reader module at all.
 *
 * Zero, and it stays zero. This is an equality, not a ceiling, because there is
 * no defensible reason to provision a service the control plane cannot read:
 * the module is a day's work and the alternative is an estate the operator
 * cannot see. If you add Terraform for a new service, add its reader in the
 * same change.
 */
const WITHOUT_A_READER = []

/* -------------------------------------------------------- the Terraform -- */

/**
 * Every `.tf` file under `infrastructure/`, as forward-slash repo-relative
 * paths, in sorted order.
 *
 * Sorted at every level and joined with `/` rather than `path.join`, because
 * `path.join` yields backslashes on Windows and `readdirSync` yields whatever
 * order the filesystem feels like. Both of those turn a deterministic failure
 * message into a platform-dependent one.
 */
function terraformFiles(dir = "infrastructure", found = []) {
  const abs = path.join(ROOT, ...dir.split("/"))
  if (!fs.existsSync(abs)) return found
  const entries = fs
    .readdirSync(abs, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) terraformFiles(rel, found)
    else if (entry.name.endsWith(".tf")) found.push(rel)
  }
  return found
}

/**
 * Declared `aws_*` resource types, mapped to the files that declare them.
 *
 * Matches `resource "aws_x" "name"` at the start of a line — a `resource` block
 * opener. Not anchored to column zero, because a module could indent, but
 * anchored to line start so the word `resource` inside a heredoc or a comment
 * body cannot masquerade as a declaration.
 */
function declaredResourceTypes() {
  const byType = new Map()
  for (const file of terraformFiles()) {
    for (const line of lines(read(file))) {
      const m = line.match(/^\s*resource\s+"(aws_[a-z0-9_]+)"/)
      if (!m) continue
      if (!byType.has(m[1])) byType.set(m[1], new Set())
      byType.get(m[1]).add(file)
    }
  }
  return byType
}

/* ------------------------------------------------------- the capability -- */

/**
 * The keys of `CAPABILITIES`, read out of the source rather than repeated here.
 *
 * Repeating them would produce a test that stays green while the two lists
 * disagree, which is the failure mode this whole requirement exists against.
 * The module is TypeScript and this runner is plain `node --test`, so it is
 * parsed as text: two-space indentation, a quoted `service:Action` key, an open
 * brace. That is the shape every one of the entries has.
 */
function capabilityKeys() {
  const source = read(CAPABILITIES)
  const start = source.indexOf("export const CAPABILITIES = {")
  assert.notEqual(
    start,
    -1,
    `${CAPABILITIES} no longer declares \`export const CAPABILITIES = {\`. This test reads the ` +
      `catalogue out of the source; if the declaration was renamed, update the parse — do not ` +
      `delete the assertion.`,
  )
  const keys = [...source.slice(start).matchAll(/^ {2}"([a-z0-9-]+):([A-Za-z0-9]+)": \{/gm)].map(
    (m) => ({ service: m[1], action: m[2] }),
  )
  assert.ok(
    keys.length > 0,
    `Parsed zero capabilities out of ${CAPABILITIES}. A parse that finds nothing would pass every ` +
      `"is this service named" assertion below by vacuity, so it fails here instead.`,
  )
  return keys
}

/* ----------------------------------------------------------- the reader -- */

/** Files under a studio route directory, sorted, forward-slash relative. */
function filesUnder(rel, found = []) {
  const abs = path.join(ROOT, ...rel.split("/"))
  if (!fs.existsSync(abs)) return found
  const entries = fs
    .readdirSync(abs, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    const child = `${rel}/${entry.name}`
    if (entry.isDirectory()) filesUnder(child, found)
    else if (/\.tsx?$/.test(entry.name)) found.push(child)
  }
  return found
}

/**
 * Whether any non-test file in `surfaceDir` imports one of `readers`.
 *
 * `.test.ts` files are excluded: a reader imported only by its own unit test is
 * still dead code from the operator's point of view, and counting the test as a
 * caller is precisely how a module "has a caller" while rendering nothing.
 *
 * Both import spellings in this app are matched — the `@/lib/aws/x` alias and
 * the relative `../../../lib/aws/x` — and the match requires a `from` clause
 * with the specifier CLOSED by its quote. A prose mention of the module in a
 * comment does not count as a caller, and `dynamodb-tables` is never satisfied
 * by an import of a hypothetical `dynamodb-tables-extra`.
 */
function importersIn(surfaceDir, readers) {
  const hits = []
  for (const file of filesUnder(`${STUDIO_SRC}/${surfaceDir}`)) {
    if (/\.test\.tsx?$/.test(file)) continue
    const text = read(file)
    for (const reader of readers) {
      // Reader names are `[a-z-]+`; nothing in them is a regex metacharacter.
      const spec = new RegExp(`from\\s+(["'])[^"']*lib/aws/${reader}\\1`)
      if (spec.test(text)) hits.push(`${file.slice(STUDIO_SRC.length + 1)} -> ${reader}`)
    }
  }
  return hits.sort()
}

/* -------------------------------------------------------------- checks -- */

test("the table classifies exactly the resource types the Terraform declares", () => {
  const declared = declaredResourceTypes()
  const classified = new Map()
  for (const record of ESTATE) {
    for (const type of record.resources) {
      assert.ok(
        !classified.has(type),
        `${type} is claimed by both ${classified.get(type)} and ${record.service}. A resource type ` +
          `owned by two services makes the coverage count meaningless.`,
      )
      classified.set(type, record.service)
    }
  }

  const unclassified = [...declared.keys()].filter((t) => !classified.has(t)).sort()
  assert.deepEqual(
    unclassified,
    [],
    `Terraform declares ${unclassified.length} resource type(s) this table does not classify:\n  ` +
      unclassified
        .map((t) => `${t} (${[...declared.get(t)].sort().join(", ")})`)
        .join("\n  ") +
      `\nAdd each to ESTATE under the service that OWNS it — the IAM prefix, not the Terraform ` +
      `name prefix. A new service provisioned with nothing reading it is the defect this file exists ` +
      `to catch, so do not classify it under a neighbouring service to make this pass.`,
  )

  const stale = [...classified.keys()].filter((t) => !declared.has(t)).sort()
  assert.deepEqual(
    stale,
    [],
    `ESTATE lists ${stale.length} resource type(s) no longer declared under infrastructure/: ` +
      `${stale.join(", ")}. Remove them, so the wiring map describes the estate that exists.`,
  )
})

test("every provisioned service is named by at least one capability", () => {
  const keys = capabilityKeys()
  const named = new Set(keys.map((k) => k.service))
  const excused = new Set(WITHOUT_A_READER.map((e) => e.service))

  const unnamed = ESTATE.filter((r) => !named.has(r.service) && !excused.has(r.service))
    .map((r) => `${r.service} (${r.name}) — provisioned by ${r.resources.join(", ")}`)
    .sort()

  assert.deepEqual(
    unnamed,
    [],
    `${unnamed.length} provisioned service(s) are named by NO capability in ${CAPABILITIES}:\n  ` +
      unnamed.join("\n  ") +
      `\nA service with no capability cannot be read at all: there is no IAM action declared, so ` +
      `no grant, no denial message and no reader. Add the capability rather than removing the ` +
      `service from this table.`,
  )
})

test("every provisioned service has a reader module under src/lib/aws", () => {
  const missing = []
  for (const record of ESTATE) {
    for (const reader of record.readers) {
      if (!exists(`${READER_DIR}/${reader}.ts`)) {
        missing.push(`${record.service} -> ${READER_DIR}/${reader}.ts`)
      }
    }
  }
  assert.deepEqual(
    missing.sort(),
    [],
    `ESTATE names ${missing.length} reader module(s) that do not exist:\n  ` +
      missing.join("\n  ") +
      `\nReaders are the only path to the SDK. Do not point the table at a module that is not there, ` +
      `and do not stub one to satisfy this — an empty reader renders an empty list, which is the ` +
      `outcome STUDIO-000-007 forbids.`,
  )
})

test("every provisioned service is rendered by a surface that imports its reader", () => {
  const awaiting = new Set(AWAITING_A_SURFACE.map((e) => e.service))
  const excused = new Set(WITHOUT_A_READER.map((e) => e.service))
  const dark = []

  for (const record of ESTATE) {
    if (awaiting.has(record.service) || excused.has(record.service)) continue
    const hits = record.surfaces.flatMap((dir) => importersIn(dir, record.readers))
    if (hits.length === 0) {
      dark.push(
        `${record.service} (${record.name}) — readers ${record.readers.join(", ")} imported by ` +
          `no non-test file under ${record.surfaces.join(", ") || "(no surface listed)"}`,
      )
    }
  }

  assert.deepEqual(
    dark.sort(),
    [],
    `${dark.length} provisioned service(s) are DARK — provisioned, with a reader, rendered nowhere:\n  ` +
      dark.join("\n  ") +
      `\nThis is the defect the requirement was opened against. Wire the reader into the surface. ` +
      `Moving the service into AWAITING_A_SURFACE to make this pass is raising the ceiling, which ` +
      `the next assertion refuses.`,
  )
})

test("the awaiting-a-surface allowlist only shrinks", () => {
  assert.ok(
    AWAITING_A_SURFACE.length <= AWAITING_A_SURFACE_CEILING,
    `${AWAITING_A_SURFACE.length} services await a surface; the ceiling is ` +
      `${AWAITING_A_SURFACE_CEILING}. Raising the ceiling to admit a newly-dark service is exactly ` +
      `the move that let the estate ship half-read. Wire the service instead.`,
  )

  for (const entry of AWAITING_A_SURFACE) {
    assert.ok(
      ESTATE.some((r) => r.service === entry.service),
      `AWAITING_A_SURFACE names ${entry.service}, which ESTATE does not provision. An allowlist ` +
        `entry for a service that is not in the estate excuses nothing and hides the count.`,
    )
    assert.ok(
      entry.reason && entry.reason.length >= 40,
      `AWAITING_A_SURFACE entry ${entry.service} has no written reason. "Knowingly not read" means ` +
        `somebody wrote down what the operator cannot see because of it.`,
    )
  }
})

test("the awaiting-a-surface ceiling is not set above the real count", () => {
  // A ceiling with slack stops being a ratchet: it silently permits the next
  // dark service. If you wired one of these up, delete its entry AND lower the
  // ceiling in the same commit — this failing is the notification that you did.
  const stillDark = AWAITING_A_SURFACE.filter((entry) => {
    const record = ESTATE.find((r) => r.service === entry.service)
    return record.surfaces.flatMap((dir) => importersIn(dir, record.readers)).length === 0
  })

  assert.equal(
    stillDark.length,
    AWAITING_A_SURFACE.length,
    `${AWAITING_A_SURFACE.length - stillDark.length} allowlisted service(s) are now rendered: ` +
      `${AWAITING_A_SURFACE.filter((e) => !stillDark.includes(e))
        .map((e) => e.service)
        .join(", ")}. Delete the entry from AWAITING_A_SURFACE and lower ` +
      `AWAITING_A_SURFACE_CEILING to ${AWAITING_A_SURFACE.length - 1}.`,
  )

  assert.equal(
    AWAITING_A_SURFACE.length,
    AWAITING_A_SURFACE_CEILING,
    `The ceiling is ${AWAITING_A_SURFACE_CEILING} but only ${AWAITING_A_SURFACE.length} services ` +
      `are listed. Lower the ceiling to ${AWAITING_A_SURFACE.length}; the slack would admit that ` +
      `many new dark services without a single test turning red.`,
  )
})

test("no provisioned service is without a reader", () => {
  assert.deepEqual(
    WITHOUT_A_READER,
    [],
    `WITHOUT_A_READER is an equality, not a ceiling: ${WITHOUT_A_READER.length} service(s) are ` +
      `provisioned with no reader module at all. Write the reader. An estate the control plane ` +
      `cannot read is the state the operator called critical.`,
  )
})

/* ---------------------------------------------------------- the document -- */

/**
 * `docs/architecture/aws-wiring-map.md` is generated from THIS table, so it
 * cannot drift from the check. The row is asserted cell for cell.
 *
 * A document that describes the wiring and a test that enforces it are two
 * statements of the same fact, and two statements of the same fact disagree
 * eventually. Here the document is checked, so the disagreement is a build
 * failure on the commit that causes it rather than a paragraph somebody
 * believes a year later.
 */
function expectedRow(record) {
  const surfaces = record.surfaces.length
    ? record.surfaces.join(", ")
    : "— awaiting a surface"
  const cells = [
    record.service,
    record.name,
    record.resources.join(", "),
    `${record.service}:*`,
    record.readers.map((r) => `${r}.ts`).join(", "),
    surfaces,
  ]
  return `| ${cells.join(" | ")} |`
}

test("the wiring map states exactly what this table states", () => {
  assert.ok(
    exists(WIRING_MAP),
    `${WIRING_MAP} does not exist. The map is the human-readable half of this check; without it the ` +
      `estate's wiring is only knowable by running a test.`,
  )
  const doc = lines(read(WIRING_MAP)).map((l) => l.trimEnd())

  const missing = ESTATE.map(expectedRow).filter((row) => !doc.includes(row))
  assert.deepEqual(
    missing,
    [],
    `${missing.length} row(s) in ${WIRING_MAP} do not match ESTATE. Expected, verbatim:\n  ` +
      missing.join("\n  ") +
      `\nThe map is generated from the table; regenerate the row rather than editing the table to ` +
      `match the prose.`,
  )

  // Every row in the map's service table must correspond to a record — a row
  // for a service the estate does not provision is a claim about AWS that
  // nothing verifies.
  // A service row's first cell is an IAM prefix: lowercase, letter-initial.
  // The `| --- | --- |` separators the other tables in the document carry would
  // match a looser pattern — `-` is a word character to a character class —
  // and a row count inflated by three separators is a check that fails for a
  // reason that has nothing to do with the estate.
  const serviceRows = doc.filter((l) => /^\| [a-z][a-z0-9-]* \| /.test(l))
  assert.equal(
    serviceRows.length,
    ESTATE.length,
    `${WIRING_MAP} has ${serviceRows.length} service rows for ${ESTATE.length} services. An extra ` +
      `row describes wiring that does not exist; a missing one hides a service.`,
  )

  for (const entry of AWAITING_A_SURFACE) {
    assert.ok(
      doc.some((l) => l.includes(entry.service) && l.includes("awaiting")),
      `${WIRING_MAP} does not record that ${entry.service} is awaiting a surface. The unrendered ` +
        `services are the part of this document a reader most needs.`,
    )
  }
})

test("every surface named in the table is a real directory", () => {
  const bad = []
  for (const record of ESTATE) {
    for (const dir of record.surfaces) {
      if (!exists(`${STUDIO_SRC}/${dir}`)) bad.push(`${record.service} -> ${STUDIO_SRC}/${dir}`)
    }
  }
  assert.deepEqual(
    bad.sort(),
    [],
    `ESTATE names ${bad.length} surface director(ies) that do not exist:\n  ` +
      bad.join("\n  ") +
      `\nA surface path that does not resolve makes "rendered by" unfalsifiable.`,
  )
})
