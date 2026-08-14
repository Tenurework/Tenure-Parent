/**
 * COVERAGE, and the two directions of drift — the half of `/platform/estate`
 * that answers the second clause of its own question.
 *
 * The page asks: *what is actually running in this AWS account, and does it
 * match what we declared?* `estate-answer.ts` composes the first clause from
 * the readings that succeeded. This module composes the second, and it exists
 * because both of the honest answers to it are ABSENCES, which a table of rows
 * cannot express:
 *
 *   1. **A service with no reader.** The build names 90-odd capabilities and
 *      wires four of them into this page. Before this module, an estate holding
 *      five S3 buckets, a load balancer, two ECR repositories and a DynamoDB
 *      table rendered as "8 resources across 4 surfaces, and every surface
 *      answered" — a sentence that is true about the surfaces and false about
 *      the account. A service nothing reads must appear as a GAP, sitting in
 *      the same list as the services that answered, or the page quietly reports
 *      the part of the estate it happens to be able to see as the whole of it.
 *
 *   2. **A resource nobody declared.** Terraform declaring something the estate
 *      does not have is a deployment that did not finish. The estate holding
 *      something Terraform never declared is the dangerous one: nothing will
 *      ever change it, nothing will ever delete it, and no review ever saw it.
 *      It is the shape of a hand-made security group, an orphaned NAT gateway,
 *      and a database somebody created "temporarily".
 *
 * ── Nothing here calls AWS, touches a filesystem, or imports React ──────────
 *
 * `capabilities.ts` is the one runtime import, and it holds no client, no SDK
 * and no I/O — it is the vocabulary. Everything else arrives as an argument.
 * That is what lets the whole of this module be driven from `apps/web`'s jest
 * without a server, a browser or a credential, and it is why the fs half lives
 * next door in `declared-estate.ts` behind a `server-only` import: a decision
 * that can only be tested through a filesystem is a decision that gets tested
 * once, by hand, on the day it is written.
 *
 * The relative import is deliberate rather than `@/lib/aws/capabilities`. The
 * Studio has no jest of its own; its unit tests run through `apps/web`'s, whose
 * `moduleNameMapper` maps `^@/` at that app's `src`. A runtime `@/` import here
 * would resolve to a different application's tree. Type-only `@/` imports are
 * erased before jest sees them and are safe, which is why the `BadgeTone`
 * import below keeps the alias and this one does not.
 */

import type { BadgeTone } from "@/components/md3"

import { CAPABILITIES, capabilitiesFor } from "../../../lib/aws/capabilities"
import type { EstateLine, EstateResource } from "../../../lib/aws/inventory"

import { readAsOf } from "./estate-answer"

/* ================================================== resources by service == */

/**
 * One AWS service's worth of the estate.
 *
 * Grouped by SERVICE rather than by the reader that produced it, because the
 * operator's question is about the account. Two capabilities feeding one
 * service — as `ecs:ListServices` and `ecs:DescribeServices` do — is an
 * implementation detail of this console and not a fact about what is running.
 */
export interface ServiceGroup {
  /** The IAM service prefix: `ecs`, `rds`, `cloudfront`, `acm`. */
  service: string
  /** The `estateLines` surfaces that fed it, in the words the page prints. */
  surfaces: readonly string[]
  resources: readonly EstateResource[]
  /**
   * The OLDEST `asOf` of the readings behind this group, or null.
   *
   * Oldest rather than newest, and null rather than "now": a group compiled
   * from two readings is only as current as the staler of them, and a group
   * whose readings all failed is as of nothing at all. Dating it to the moment
   * of render would put a fresh timestamp on a panel whose call did not
   * complete, which is the exact substitution this console exists to refuse.
   */
  asOf: string | null
}

/** The service a capability belongs to. `ecs:DescribeServices` → `ecs`. */
export function serviceOf(capability: string): string {
  const [service] = capability.split(":")
  return service
}

/**
 * The estate, grouped by service.
 *
 * Only the ACTUAL arm contributes resources — `estateLines` has already
 * narrowed that — so a group can be present with an empty `resources` array,
 * which is a service that answered and holds nothing. That is different from a
 * service that could not be read, and `coverageRows` below is where the
 * difference is rendered.
 */
export function groupByService(lines: readonly EstateLine[]): readonly ServiceGroup[] {
  const groups = new Map<string, { surfaces: string[]; resources: EstateResource[]; asOf: string | null }>()

  for (const line of lines) {
    const service = serviceOf(line.read.capability)
    const group = groups.get(service) ?? { surfaces: [], resources: [], asOf: null }
    group.surfaces.push(line.surface)
    group.resources.push(...line.resources)

    const asOf = readAsOf(line.read)
    if (asOf !== null && (group.asOf === null || asOf < group.asOf)) group.asOf = asOf

    groups.set(service, group)
  }

  return [...groups.entries()]
    .map(([service, group]) => ({
      service,
      surfaces: group.surfaces,
      resources: group.resources,
      asOf: group.asOf,
    }))
    .sort((a, b) => a.service.localeCompare(b.service))
}

/* ============================================ what Terraform declares ===== */

/**
 * How many instances of one Terraform resource type are declared.
 *
 * Two numbers rather than one, and the second is the point. A block carrying
 * `count = var.custom_domain != "" ? 1 : 0` declares between zero and one
 * certificate depending on a variable this parser cannot resolve, and counting
 * it as one produces a MISSING verdict on every estate that does not set the
 * variable — the loudest possible false alarm, on the surface whose whole job
 * is to be trusted about absences.
 */
export interface DeclaredCount {
  /** Blocks with no `count` and no `for_each`: exactly this many, always. */
  definite: number
  /** Blocks whose instance count depends on a variable. Never asserted as present. */
  conditional: number
}

export interface DeclaredEstate {
  /**
   * Whether any Terraform was readable at all.
   *
   * False is the NORMAL production case — the container image ships the app and
   * not the infrastructure — and it must render as "this cannot be compared
   * here", never as "nothing is declared", which would report every live
   * resource as undeclared drift.
   */
  known: boolean
  /** AWS service prefix → what Terraform declares of it. */
  byService: ReadonlyMap<string, DeclaredCount>
  /** Estate resource type (`ecs:service`) → what Terraform declares of it. */
  byResourceType: ReadonlyMap<string, DeclaredCount>
  /**
   * `aws_*` Terraform types this build cannot map to an AWS service.
   *
   * Reported rather than dropped. A silently unmapped type is a declaration
   * that vanishes from the comparison, and the comparison then reports the
   * estate as matching because half the declaration was thrown away.
   */
  unmapped: readonly string[]
  /** The files that were read, so the panel can say what it looked at. */
  files: readonly string[]
  /** Why nothing is known, when nothing is. Empty when `known`. */
  because: string
}

export function unknownDeclaration(because: string): DeclaredEstate {
  return {
    known: false,
    byService: new Map(),
    byResourceType: new Map(),
    unmapped: [],
    files: [],
    because,
  }
}

/**
 * Terraform provider type → the IAM service prefix its resources authorize
 * under.
 *
 * A translation table, not data: `aws_lb` authorizes under
 * `elasticloadbalancing`, `aws_cognito_user_pool` under `cognito-idp`, and
 * `aws_cloudwatch_event_rule` under `events` — three names no rule derives from
 * the Terraform type, and each of which has already been the subject of a note
 * in `capabilities.ts` about a policy that grants nothing because it named the
 * SDK's spelling instead of IAM's.
 *
 * Matched longest-prefix-first, so `aws_cloudwatch_event_` wins over
 * `aws_cloudwatch_`.
 */
const TERRAFORM_SERVICE_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["aws_ecs_", "ecs"],
  ["aws_db_", "rds"],
  ["aws_rds_", "rds"],
  ["aws_cloudfront_", "cloudfront"],
  ["aws_acm_", "acm"],
  ["aws_lb", "elasticloadbalancing"],
  ["aws_alb", "elasticloadbalancing"],
  ["aws_s3_", "s3"],
  ["aws_sqs_", "sqs"],
  ["aws_sesv2_", "ses"],
  ["aws_ses_", "ses"],
  ["aws_cognito_", "cognito-idp"],
  ["aws_dynamodb_", "dynamodb"],
  ["aws_elasticache_", "elasticache"],
  ["aws_ecr_", "ecr"],
  ["aws_cloudwatch_event_", "events"],
  ["aws_cloudwatch_log_", "logs"],
  ["aws_cloudwatch_", "cloudwatch"],
  ["aws_vpc", "ec2"],
  ["aws_subnet", "ec2"],
  ["aws_security_group", "ec2"],
  ["aws_route_table", "ec2"],
  ["aws_internet_gateway", "ec2"],
  ["aws_nat_gateway", "ec2"],
  ["aws_network_acl", "ec2"],
  ["aws_network_interface", "ec2"],
  ["aws_eip", "ec2"],
  ["aws_secretsmanager_", "secretsmanager"],
  ["aws_ssm_", "ssm"],
  ["aws_iam_", "iam"],
  ["aws_kms_", "kms"],
  ["aws_route53_", "route53"],
  ["aws_lambda_", "lambda"],
  ["aws_wafv2_", "wafv2"],
  ["aws_backup_", "backup"],
  ["aws_budgets_", "budgets"],
  ["aws_cloudtrail", "cloudtrail"],
  ["aws_config_", "config"],
  ["aws_guardduty_", "guardduty"],
  ["aws_servicequotas_", "servicequotas"],
  ["aws_accessanalyzer_", "access-analyzer"],
]

/**
 * The four Terraform types that map onto a resource type THIS PAGE'S readers
 * actually produce.
 *
 * Deliberately only four. A type-level comparison is only honest where both
 * sides exist: `aws_s3_bucket` is declared and this build has no bucket reader,
 * so comparing them would produce "3 declared, 0 present" — which reads as
 * three deleted buckets and is really three buckets nobody looked for. Those
 * land in the COVERAGE table as a gap instead, which is where an absence with
 * no reader belongs.
 */
const TERRAFORM_RESOURCE_TYPES: Readonly<Record<string, string>> = {
  aws_ecs_service: "ecs:service",
  aws_db_instance: "rds:db",
  aws_cloudfront_distribution: "cloudfront:distribution",
  aws_acm_certificate: "acm:certificate",
}

/** Providers that are not AWS. Skipped, and not counted as unmappable. */
const NON_AWS_PREFIXES = ["random_", "null_", "tls_", "local_", "time_", "archive_", "external_"]

export interface TerraformFile {
  /** Repository-relative, so the panel can name what it read. */
  path: string
  text: string
}

/**
 * Parse `resource "type" "name" { … }` blocks out of Terraform source.
 *
 * A block runs from its opening line to the next line that is exactly `}` in
 * column zero. That is a property of `terraform fmt`, which every file in
 * `infrastructure/` is formatted with, and it is chosen over brace counting
 * because brace counting is wrong inside heredocs — and every one of these
 * files contains an IAM policy heredoc full of braces.
 */
export function parseTerraformDeclarations(files: readonly TerraformFile[]): DeclaredEstate {
  if (files.length === 0) {
    return unknownDeclaration(
      "No Terraform source was readable from this process, so nothing on this page can be compared " +
        "against what was declared. This is the normal case in the deployed container, which ships " +
        "the application and not the infrastructure that provisions it.",
    )
  }

  const byService = new Map<string, DeclaredCount>()
  const byResourceType = new Map<string, DeclaredCount>()
  const unmapped = new Set<string>()

  for (const file of files) {
    const lines = file.text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const opened = /^resource\s+"([A-Za-z0-9_]+)"\s+"[^"]*"\s*\{/.exec(lines[i])
      if (!opened) continue
      const type = opened[1]

      let conditional = false
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j] === "}") break
        if (/^\s{2}(count|for_each)\s*=/.test(lines[j])) conditional = true
      }

      if (NON_AWS_PREFIXES.some((prefix) => type.startsWith(prefix))) continue

      const service = serviceFor(type)
      if (service === null) {
        unmapped.add(type)
        continue
      }
      bump(byService, service, conditional)

      const resourceType = TERRAFORM_RESOURCE_TYPES[type]
      if (resourceType) bump(byResourceType, resourceType, conditional)
    }
  }

  return {
    known: true,
    byService,
    byResourceType,
    unmapped: [...unmapped].sort(),
    files: files.map((file) => file.path),
    because: "",
  }
}

function bump(into: Map<string, DeclaredCount>, key: string, conditional: boolean): void {
  const current = into.get(key) ?? { definite: 0, conditional: 0 }
  if (conditional) current.conditional += 1
  else current.definite += 1
  into.set(key, current)
}

/** Longest matching provider prefix wins; null when this build cannot map it. */
export function serviceFor(terraformType: string): string | null {
  let best: readonly [string, string] | null = null
  for (const entry of TERRAFORM_SERVICE_PREFIXES) {
    if (!terraformType.startsWith(entry[0])) continue
    if (best === null || entry[0].length > best[0].length) best = entry
  }
  return best === null ? null : best[1]
}

/* ================================================================ coverage = */

/**
 * What this engine can see of one AWS service.
 *
 * `NO_READER` is the value the whole module was written for. It is not an
 * error, not a denial and not an absence: the capability is declared, the IAM
 * action would be granted, and no code in this build calls it. Rendering it is
 * the difference between "this account has 8 resources" and "this account has
 * at least 8 resources and eleven services nobody has looked at".
 */
export type ReaderState =
  /** A reader is wired and it returned resources. */
  | "READ"
  /** A reader is wired, the call succeeded, and there is genuinely nothing. */
  | "EMPTY"
  /** A reader is wired and the call did not complete. Nothing is known. */
  | "UNREADABLE"
  /** No reader in this build. The service is invisible here, not absent there. */
  | "NO_READER"

export interface CoverageRow {
  /** The IAM service prefix. The identity, in the vocabulary IAM uses. */
  service: string
  reader: ReaderState
  /** Resources this page can show, or null when that is not known. Never zero for a gap. */
  count: number | null
  /** Estate capabilities this build declares against the service. */
  capabilities: readonly string[]
  /** What those capabilities would read, in the operator's language. */
  reads: readonly string[]
  asOf: string | null
  /** Why nothing is known, when nothing is. Empty when the service was read. */
  because: string
  /** What Terraform declares of it, or null when the declaration is not readable. */
  declared: DeclaredCount | null
}

/**
 * Every AWS service this page has anything to say about, and what it can say.
 *
 * The row set is a UNION of three sources, and it has to be all three:
 *
 *   * the services a reader actually produced — what is on the page;
 *   * every service named by a capability whose `surface` is `estate` — what
 *     the build claims it could read;
 *   * every service Terraform declares — what this platform provisions.
 *
 * A service in the second or third and not the first is exactly the gap. Taking
 * only the first is how the surface table this replaces managed to report "4 of
 * 4 surfaces answered" on an account holding buckets, queues, a load balancer
 * and a cache.
 */
export function coverageRows(input: {
  lines: readonly EstateLine[]
  declared: DeclaredEstate
}): readonly CoverageRow[] {
  const groups = new Map(groupByService(input.lines).map((group) => [group.service, group]))

  /** Whether every reading behind a service completed, and why if not. */
  const outcome = new Map<string, { readable: boolean; because: string }>()
  for (const line of input.lines) {
    const service = serviceOf(line.read.capability)
    const current = outcome.get(service) ?? { readable: true, because: "" }
    if (line.read.state !== "ACTUAL" && line.read.state !== "EMPTY") {
      current.readable = false
      current.because = current.because ? `${current.because} ${line.text}` : line.text
    }
    outcome.set(service, current)
  }

  const services = new Set<string>([
    ...groups.keys(),
    ...capabilitiesFor("estate").map(serviceOf),
    ...input.declared.byService.keys(),
  ])

  const rows: CoverageRow[] = []
  for (const service of services) {
    // Kept as `Capability` for the lookup and widened to `string` only on the
    // way into the row. Indexing `CAPABILITIES` with a `string` would need a
    // cast, and a cast here is how a renamed capability becomes `undefined.reads`
    // at render time instead of a compile error now.
    const named = capabilitiesFor("estate").filter((capability) => serviceOf(capability) === service)
    const capabilities: readonly string[] = named
    const reads = named.map((capability) => CAPABILITIES[capability].reads)
    const group = groups.get(service)
    const declared = input.declared.known ? (input.declared.byService.get(service) ?? { definite: 0, conditional: 0 }) : null

    if (!group) {
      rows.push({
        service,
        reader: "NO_READER",
        // Never a zero. A zero here is the substitution the whole read plane
        // exists to end, one level up: "no reader" would render as "no
        // resources" and the gap would read as a clean account.
        count: null,
        capabilities,
        reads,
        asOf: null,
        // Precise about WHOSE blind spot this is. "No reader in this build"
        // would be a claim about the whole console, and a dedicated surface may
        // well read the service in depth; what is true, and all that is true, is
        // that nothing feeds THIS inventory, so nothing here counts it.
        because:
          capabilities.length > 0
            ? `This build declares ${capabilities.length} estate capability(ies) for ${service} and wires none of them into this page's inventory, so nothing ${service} holds is counted above. Another surface may read it in depth; this one does not, and cannot tell you whether it is empty.`
            : `Terraform declares ${service} resources and no capability in this build names ${service} at all — neither a reader nor an IAM grant. It cannot be read from here even in principle.`,
        declared,
      })
      continue
    }

    const state = outcome.get(service)
    if (state && !state.readable) {
      rows.push({
        service,
        reader: "UNREADABLE",
        count: null,
        capabilities,
        reads,
        asOf: group.asOf,
        because: state.because,
        declared,
      })
      continue
    }

    rows.push({
      service,
      reader: group.resources.length === 0 ? "EMPTY" : "READ",
      count: group.resources.length,
      capabilities,
      reads,
      asOf: group.asOf,
      because: "",
      declared,
    })
  }

  // Gaps first, then unreadable, then the services that answered. The rows an
  // operator has to act on are the ones at the top of the table, and the rows
  // that answered are the ones they can skim.
  const ORDER: Record<ReaderState, number> = { NO_READER: 0, UNREADABLE: 1, EMPTY: 2, READ: 3 }
  return rows.sort(
    (a, b) => ORDER[a.reader] - ORDER[b.reader] || a.service.localeCompare(b.service),
  )
}

/** How many services this page can actually see, and how many it cannot. */
export interface CoverageTally {
  total: number
  read: number
  unreadable: number
  noReader: number
}

export function coverageTally(rows: readonly CoverageRow[]): CoverageTally {
  return {
    total: rows.length,
    read: rows.filter((row) => row.reader === "READ" || row.reader === "EMPTY").length,
    unreadable: rows.filter((row) => row.reader === "UNREADABLE").length,
    noReader: rows.filter((row) => row.reader === "NO_READER").length,
  }
}

/**
 * The coverage sentence, above the table.
 *
 * Its job is to make the page's own blind spot the first thing said about the
 * inventory, rather than a caveat under it. There is no arm that reads as
 * reassurance while a service is unreadable or unwired.
 */
export function coverageAnswer(rows: readonly CoverageRow[]): string {
  const tally = coverageTally(rows)
  if (tally.total === 0) {
    return (
      "This build names no AWS service for the estate at all, so there is no coverage to report and " +
      "nothing above is an inventory of anything."
    )
  }

  const seen = `${tally.read} of ${tally.total} AWS service(s) on this page were read.`
  if (tally.noReader === 0 && tally.unreadable === 0) {
    return `${seen} Every service this build names or this platform declares has a reader, and every reader answered.`
  }

  const parts: string[] = []
  if (tally.noReader > 0) {
    parts.push(
      `${tally.noReader} have NO READER in this build — whatever they hold is invisible here, which is not the same as absent`,
    )
  }
  if (tally.unreadable > 0) {
    parts.push(`${tally.unreadable} have a reader whose call did not complete`)
  }
  return `${seen} ${parts.join(", and ")}. The inventory above is a floor, not a total.`
}

/* ============================================== declared against actual === */

export type DeclarationVerdict =
  /** Declared and present, in at least the declared number. */
  | "MATCHED"
  /** Declared, the reader answered, and fewer are there. A deployment that did not finish. */
  | "DECLARED_NOT_PRESENT"
  /** Present, and Terraform declares none. Nothing will ever change or remove it. */
  | "PRESENT_NOT_DECLARED"
  /** The reader did not complete, so neither direction can be claimed. */
  | "UNREADABLE"
  /** No Terraform was readable from this process. Not a finding either way. */
  | "NOT_DECLARABLE"

export interface DeclarationRow {
  /** The estate resource type, as `inventory.ts` spells it. */
  resourceType: string
  declared: DeclaredCount | null
  /** How many are running, or null when the reader did not complete. */
  present: number | null
  verdict: DeclarationVerdict
  detail: string
}

/**
 * The two directions of drift, per resource type.
 *
 * Only the types where BOTH sides exist are compared. That is the rule that
 * keeps this table honest: a declared type with no reader would compare as
 * "declared, zero present" and read as a deleted resource, when it is really a
 * resource nobody looked for — the coverage table above is where that belongs,
 * and it says so there in those words.
 */
export function declarationRows(input: {
  lines: readonly EstateLine[]
  declared: DeclaredEstate
}): readonly DeclarationRow[] {
  const present = new Map<string, number>()
  const unreadable = new Map<string, string>()

  for (const line of input.lines) {
    const readable = line.read.state === "ACTUAL" || line.read.state === "EMPTY"
    for (const resource of line.resources) {
      present.set(resource.resourceType, (present.get(resource.resourceType) ?? 0) + 1)
    }
    if (!readable) {
      // A surface that did not answer blinds every resource type it would have
      // produced. `estateLines` cannot say which those are once the call
      // failed, so the surface's own capability names the service and the
      // declared types of that service are the ones that go unknown.
      for (const [type] of input.declared.byResourceType) {
        if (type.startsWith(`${serviceOf(line.read.capability)}:`)) unreadable.set(type, line.text)
      }
    }
  }

  const types = new Set<string>([...present.keys(), ...input.declared.byResourceType.keys()])
  const rows: DeclarationRow[] = []

  for (const resourceType of types) {
    const live = present.get(resourceType) ?? 0
    const blind = unreadable.get(resourceType)

    if (!input.declared.known) {
      rows.push({
        resourceType,
        declared: null,
        present: blind ? null : live,
        verdict: "NOT_DECLARABLE",
        detail: input.declared.because,
      })
      continue
    }

    if (blind) {
      rows.push({
        resourceType,
        declared: input.declared.byResourceType.get(resourceType) ?? { definite: 0, conditional: 0 },
        present: null,
        verdict: "UNREADABLE",
        detail: `${blind} Neither direction of drift can be claimed for ${resourceType} while that read is failing.`,
      })
      continue
    }

    const want = input.declared.byResourceType.get(resourceType) ?? { definite: 0, conditional: 0 }

    if (want.definite === 0 && want.conditional === 0 && live > 0) {
      rows.push({
        resourceType,
        declared: want,
        present: live,
        verdict: "PRESENT_NOT_DECLARED",
        detail:
          `${live} ${resourceType} resource(s) are running and the Terraform read from this process declares none. ` +
          `Nothing will ever update or remove them, and no review has seen them — this is the more dangerous direction of drift.`,
      })
      continue
    }

    if (live < want.definite) {
      rows.push({
        resourceType,
        declared: want,
        present: live,
        verdict: "DECLARED_NOT_PRESENT",
        detail:
          `Terraform declares ${want.definite} unconditionally and ${live} are running. ` +
          `Either an apply did not finish or something was removed outside it.`,
      })
      continue
    }

    rows.push({
      resourceType,
      declared: want,
      present: live,
      verdict: "MATCHED",
      detail:
        want.conditional > 0
          ? `${live} running against ${want.definite} declared unconditionally, plus ${want.conditional} block(s) whose instance count depends on a variable this parser does not resolve — those are not asserted either way.`
          : `${live} running against ${want.definite} declared.`,
    })
  }

  // The dangerous direction first, then the missing one, then the noise.
  const ORDER: Record<DeclarationVerdict, number> = {
    PRESENT_NOT_DECLARED: 0,
    DECLARED_NOT_PRESENT: 1,
    UNREADABLE: 2,
    NOT_DECLARABLE: 3,
    MATCHED: 4,
  }
  return rows.sort(
    (a, b) => ORDER[a.verdict] - ORDER[b.verdict] || a.resourceType.localeCompare(b.resourceType),
  )
}

/**
 * The sentence above the drift table.
 *
 * The arm that matters is the first: when the Terraform is not readable there
 * is no comparison, and saying "no drift" would be reporting a match on the
 * strength of never having looked at the declaration.
 */
export function declarationAnswer(input: {
  rows: readonly DeclarationRow[]
  declared: DeclaredEstate
}): string {
  if (!input.declared.known) {
    return `Declared against actual could not be computed. ${input.declared.because}`
  }

  const undeclared = input.rows.filter((row) => row.verdict === "PRESENT_NOT_DECLARED")
  const missing = input.rows.filter((row) => row.verdict === "DECLARED_NOT_PRESENT")
  const blind = input.rows.filter((row) => row.verdict === "UNREADABLE")

  const source = `Compared against ${input.declared.files.length} Terraform file(s) read from this checkout.`

  const parts: string[] = []
  if (undeclared.length > 0) {
    parts.push(
      `${undeclared.length} resource type(s) are running that Terraform never declared — the dangerous direction`,
    )
  }
  if (missing.length > 0) parts.push(`${missing.length} declared and not present`)
  if (blind.length > 0) parts.push(`${blind.length} could not be compared because the read failed`)

  if (parts.length === 0) {
    return (
      `${source} Every resource type with both a declaration and a reader matches. This is a statement about ` +
      `the ${input.rows.length} type(s) below and about nothing else — the coverage table above lists the ` +
      `services that have no reader, and none of them is included here.`
    )
  }
  return `${source} ${parts.join(", ")}.`
}

/**
 * Terraform types this build could not map to an AWS service, as a sentence.
 *
 * Rendered whenever it is non-empty, because an unmapped type is a declaration
 * that silently left the comparison — and a comparison missing half its input
 * reports a match.
 */
export function unmappedSentence(declared: DeclaredEstate): string | null {
  if (!declared.known || declared.unmapped.length === 0) return null
  return (
    `${declared.unmapped.length} declared Terraform type(s) could not be mapped to an AWS service by this ` +
    `build and are therefore counted nowhere above: ${declared.unmapped.join(", ")}.`
  )
}

/* =================================================================== tones = */

/**
 * Badge tones. The word carries the meaning; the tone must not contradict it.
 *
 * `NO_READER` is `warn` and never `neutral`, for the same reason every UNKNOWN
 * in this console is: a service nobody reads is a thing to act on — wire a
 * reader — rather than a shrug.
 */
export function coverageTone(reader: ReaderState): BadgeTone {
  switch (reader) {
    case "READ":
      return "ok"
    case "EMPTY":
      return "info"
    case "UNREADABLE":
    case "NO_READER":
      return "warn"
  }
}

export function declarationTone(verdict: DeclarationVerdict): BadgeTone {
  switch (verdict) {
    case "MATCHED":
      return "ok"
    // Present and undeclared is the worst verdict on this page. Nothing governs
    // it, nothing will remove it, and no review has ever seen it.
    case "PRESENT_NOT_DECLARED":
      return "bad"
    case "DECLARED_NOT_PRESENT":
      return "bad"
    case "UNREADABLE":
    case "NOT_DECLARABLE":
      return "warn"
  }
}

/** The words a badge prints, so the table and the sentence cannot disagree. */
export function readerWord(reader: ReaderState): string {
  switch (reader) {
    case "READ":
      return "read"
    case "EMPTY":
      return "read — nothing there"
    case "UNREADABLE":
      return "not read"
    case "NO_READER":
      return "no reader in this build"
  }
}

export function verdictWord(verdict: DeclarationVerdict): string {
  switch (verdict) {
    case "MATCHED":
      return "matches"
    case "DECLARED_NOT_PRESENT":
      return "declared, not present"
    case "PRESENT_NOT_DECLARED":
      return "present, never declared"
    case "UNREADABLE":
      return "not readable"
    case "NOT_DECLARABLE":
      return "no declaration to compare"
  }
}

/** A declared count, in words, including the arm that is not a number. */
export function declaredWord(declared: DeclaredCount | null): string {
  if (declared === null) return "not known"
  if (declared.conditional === 0) return String(declared.definite)
  return `${declared.definite} + ${declared.conditional} conditional`
}
