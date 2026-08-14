import fs from "node:fs"
import path from "node:path"

import { auth } from "@/lib/auth"
import { authorizeCommand, decisionLine, type StudioCommand } from "@/lib/authorize"
import { newCorrelationId } from "@/lib/api/envelope"
import { PROBLEM, problemResponse } from "@/lib/api/problem"
import { bucketPosture } from "@/lib/aws/buckets"
import { cognitoReadings } from "@/lib/aws/cognito"
import {
  estateDrift,
  observedBuckets,
  observedSecurityGroups,
  observedTables,
  observedUserPools,
  parseTerraformEstate,
  type ObservedSurface,
  type TerraformSource,
} from "@/lib/aws/drift"
import { tableReadings } from "@/lib/aws/dynamodb-tables"
import {
  EXPORT_COMMANDS,
  EXPORT_FORMATS,
  EXPORT_SURFACES,
  UNRESOLVED_PROVENANCE,
  consumeExportBudget,
  contentDisposition,
  contentTypeFor,
  coverageTable,
  driftTable,
  inventoryTable,
  isExportFormat,
  isExportSurface,
  postureTable,
  toCsv,
  toJson,
  type ExportFormat,
  type ExportProvenance,
  type ExportSurfaceId,
  type ExportTable,
  type StudioCommandName,
} from "@/lib/aws/export"
import { estateInventory, estateSectionLines } from "@/lib/aws/inventory"
import { networkReadings } from "@/lib/aws/network"
import { securityPosture } from "@/lib/aws/posture"
import { putAuditEntry, registryConfigured } from "@/lib/registry"
import { isOperator, operatorConfigProblems } from "@/lib/operators"
import { declaredEstate } from "@/app/platform/estate/declared-estate"
import { coverageRows } from "@/app/platform/estate/estate-coverage"

/*
 * Every route that calls `auth()` or `authorizeCommand` must be dynamic, or
 * Next prerenders it at BUILD time and the authorization check never runs in
 * production. `tests/architecture/authorizing-routes-are-dynamic.test.mjs`
 * holds this; it is not decoration.
 */
export const dynamic = "force-dynamic"

/**
 * STUDIO-100-002 (the `export` clause) — the estate leaves the building as data.
 *
 * The operator's complaint was that live AWS data cannot be exported from this
 * console, and it was accurate: before this route, one `Content-Disposition` in
 * `apps/system-studio/src` served the tenant REGISTRY out of DynamoDB
 * (`api/aws/[surface]/route.ts:472`). Nothing that this console reads out of AWS
 * — the inventory, the coverage table, the drift comparison, the security
 * posture — could be taken away and put in front of anybody who was not sitting
 * at the screen.
 *
 * `GET /api/export?surface=<inventory|coverage|drift|posture>&format=<csv|json>`
 *
 * ## The order of operations, and why it is that order
 *
 *   1. **Misconfiguration.** The Studio refuses to serve at all when its access
 *      control is unset, on the same rule every page carries.
 *   2. **Authentication**, then **request validity**. An unknown surface is a
 *      404 and an unknown format is a 400 — both facts about the request, true
 *      whoever sends it.
 *   3. **Authorization, per command, all of them.** `EXPORT_COMMANDS` lists what
 *      each surface aggregates and this route asks `authorizeCommand` for every
 *      entry, refusing on the first denial. An export is a bulk read of the
 *      pages it summarises and must not be reachable by a family that cannot
 *      read them one at a time.
 *   4. **Budget.** Six per operator per minute. One export is of the order of a
 *      hundred AWS describes; see `EXPORT_BUDGET`.
 *   5. **The audit row, BEFORE the bytes.** An export that cannot be recorded is
 *      an export nobody can answer for, so a console with no registry configured
 *      refuses rather than quietly handing over the estate unlogged.
 *   6. Only then the read, the projection and the file.
 *
 * ## It must answer with no AWS credentials
 *
 * Every reader returns an `AwsRead` union whose failing arms carry no value, and
 * the projection in `lib/aws/export.ts` turns each of those into a ROW — state,
 * refused action, pasteable minimum IAM statement — rather than into a missing
 * row. An export taken from an under-granted role is a file full of `DENIED`
 * rows that says exactly which statements would fix it, which is a useful
 * artefact. A file that was silently short would not be.
 */

/* ------------------------------------------------------- what the file is -- */

type SurfaceCommands = readonly StudioCommandName[]

/**
 * `StudioCommandName` (declared in the pure projection) against `StudioCommand`
 * (declared in the authorization module).
 *
 * This assignment is the proof that the two agree. `lib/aws/export.ts` states
 * the command names structurally so it can stay free of `process.env` and the
 * operator allowlist; if a name there ever stops being a real command, this line
 * stops compiling — which is the whole reason the seam is checked here rather
 * than trusted.
 */
const _commandNamesAreRealCommands: readonly StudioCommand[] = [
  ...EXPORT_COMMANDS.inventory,
  ...EXPORT_COMMANDS.coverage,
  ...EXPORT_COMMANDS.drift,
  ...EXPORT_COMMANDS.posture,
] satisfies readonly StudioCommand[]
void _commandNamesAreRealCommands

interface RequestContext {
  correlationId: string
  instance: string
  principalId: string
  surface: ExportSurfaceId
  format: ExportFormat
}

export async function GET(request: Request): Promise<Response> {
  const correlationId = newCorrelationId()
  const instance = new URL(request.url).pathname

  if (operatorConfigProblems().length > 0) {
    return problemResponse({
      type: PROBLEM.surfaceNotConfigured,
      title: "Not configured",
      status: 501,
      detail: "The Studio refuses to serve until its access control is set up.",
      instance,
      correlationId,
    })
  }

  const session = await auth()
  const principalId = session?.user?.email
  if (!principalId || !isOperator(principalId)) {
    return problemResponse({
      type: PROBLEM.unauthenticated,
      title: "Not signed in",
      status: 401,
      detail: "Exporting the estate requires an operator session.",
      instance,
      correlationId,
    })
  }

  const url = new URL(request.url)
  const surfaceRaw = (url.searchParams.get("surface") ?? "").trim()
  if (!isExportSurface(surfaceRaw)) {
    return problemResponse({
      type: PROBLEM.notFound,
      title: "No such export",
      status: 404,
      detail: `This console exports ${EXPORT_SURFACES.join(", ")}. Pass ?surface=<one of those>.`,
      instance,
      correlationId,
    })
  }

  const formatRaw = (url.searchParams.get("format") ?? "csv").trim()
  if (!isExportFormat(formatRaw)) {
    return problemResponse({
      type: PROBLEM.badRequest,
      title: "No such format",
      status: 400,
      detail: `Pass ?format=${EXPORT_FORMATS.join(" or ?format=")}.`,
      instance,
      correlationId,
    })
  }

  const ctx: RequestContext = {
    correlationId,
    instance,
    principalId,
    surface: surfaceRaw,
    format: formatRaw,
  }

  const refusal = refuseUnauthorized(ctx, EXPORT_COMMANDS[ctx.surface])
  if (refusal) return refusal

  const rate = consumeExportBudget(ctx.principalId)
  if (!rate.allowed) {
    return problemResponse({
      type: PROBLEM.rateLimited,
      title: "Too many requests",
      status: 429,
      detail:
        `An estate export is ${rate.limit} per operator per ` +
        `${Math.round(60_000 / 1000)}s. One export drives the whole inventory, the security ` +
        "posture and the drift comparison — of the order of a hundred AWS describes — which is " +
        "why the budget is what it is.",
      instance,
      correlationId,
      headers: { "retry-after": String(rate.retryAfterSeconds) },
    })
  }

  if (!registryConfigured()) {
    // Deliberately a refusal and not a warning. STUDIO-020-012 requires every
    // allow to be recorded, and the whole estate leaving the building is the
    // single act on this console most in need of a row saying who took it.
    return problemResponse({
      type: PROBLEM.surfaceNotConfigured,
      title: "This export cannot be recorded",
      status: 501,
      detail:
        "TENANT_TABLE is not set, so there is no audit ledger to write the export to. A bulk " +
        "estate export that cannot be recorded is refused rather than served unlogged.",
      instance,
      correlationId,
    })
  }

  const takenAt = new Date().toISOString()

  try {
    const table = await buildTable(ctx.surface)

    // Written BEFORE the bytes are produced. If this throws, no file is served.
    await putAuditEntry({
      actorId: ctx.principalId,
      action: "estate.export",
      resourceType: "Estate",
      resourceId: ctx.surface,
      outcome: "ALLOW",
      reason: null,
      occurredAt: takenAt,
      correlationId: ctx.correlationId,
      detail: {
        surface: ctx.surface,
        format: ctx.format,
        rows: table.rows.length,
        // The number that decides whether this file is a picture of the estate
        // or a picture of our own grants. In the audit row so the question can
        // be answered later without the file.
        unreadableRows: table.unreadableRows,
        accountId: table.provenance.accountId,
        region: table.provenance.region,
      },
    })

    const body =
      ctx.format === "csv"
        ? toCsv(table)
        : toJson(table, { generatedAt: takenAt, correlationId: ctx.correlationId })

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": contentTypeFor(ctx.format),
        "content-disposition": contentDisposition({
          accountId: table.provenance.accountId,
          surface: ctx.surface,
          format: ctx.format,
          at: takenAt,
        }),
        "cache-control": "no-store",
        "x-correlation-id": ctx.correlationId,
        "x-export-rows": String(table.rows.length),
        "x-unreadable-rows": String(table.unreadableRows),
      },
    })
  } catch (error) {
    return problemResponse({
      type: PROBLEM.internal,
      title: "The export failed",
      status: 502,
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      instance: ctx.instance,
      correlationId: ctx.correlationId,
    })
  }
}

/* --------------------------------------------------------- authorization -- */

/**
 * Every command the surface aggregates, refusing on the first denial.
 *
 * Both outcomes are logged, per STUDIO-020-012: an allow that is never written
 * down makes the deny log a record of failures rather than a record of access.
 * The refusal names the permission, the reason and the policy revision — never
 * whether the thing being exported exists.
 */
function refuseUnauthorized(ctx: RequestContext, commands: SurfaceCommands): Response | null {
  for (const command of commands as readonly StudioCommand[]) {
    const decision = authorizeCommand(command, { principalId: ctx.principalId })
    console.info(
      `[authz] ${decisionLine(ctx.principalId, command, decision)} correlation=${ctx.correlationId}`,
    )
    if (!decision.allowed) {
      return problemResponse({
        type: PROBLEM.forbidden,
        title: "Refused",
        status: 403,
        detail:
          `${decision.permission} was refused (${decision.reason}), policy ` +
          `${decision.policyRevision}. Exporting ${ctx.surface} requires ` +
          `${commands.join(" and ")}, because the file carries what each of those pages shows.`,
        instance: ctx.instance,
        correlationId: ctx.correlationId,
      })
    }
  }
  return null
}

/* ------------------------------------------------------------- the reads -- */

async function buildTable(surface: ExportSurfaceId): Promise<ExportTable> {
  if (surface === "posture") {
    const posture = await securityPosture()
    // Posture reads no identity of its own, so the provenance comes from the
    // same STS answer every other surface uses rather than from a guess.
    return postureTable(posture, await provenanceOnly())
  }

  if (surface === "drift") {
    const [buckets, network, cognito, tables, provenance] = await Promise.all([
      bucketPosture(),
      networkReadings(),
      cognitoReadings(),
      tableReadings(),
      provenanceOnly(),
    ])

    const observed: readonly ObservedSurface[] = [
      observedBuckets(buckets),
      observedSecurityGroups(network),
      observedUserPools(cognito),
      observedTables(tables),
    ]

    return driftTable(
      estateDrift({
        declared: parseTerraformEstate(terraformSources()),
        observed,
        now: new Date(),
      }),
      provenance,
    )
  }

  const readings = await estateInventory()
  const provenance = provenanceOf(readings)

  if (surface === "inventory") return inventoryTable(readings, provenance)

  return coverageTable(
    coverageRows({ lines: estateSectionLines(readings), declared: declaredEstate() }),
    provenance,
  )
}

function provenanceOf(readings: { identity: Awaited<ReturnType<typeof estateInventory>>["identity"] }): ExportProvenance {
  const identity = readings.identity
  if (identity.state !== "ACTUAL" && identity.state !== "STALE") return UNRESOLVED_PROVENANCE
  return {
    accountId: identity.value.accountId,
    region: identity.value.region,
    partition: identity.value.partition,
    readAs: identity.value.arn,
  }
}

/**
 * Identity alone, for the two surfaces that do not load the whole inventory.
 *
 * `resolveIdentity` caches for the process, so this is one `sts:GetCallerIdentity`
 * at worst and usually none. Returning `UNRESOLVED_PROVENANCE` when it fails is
 * the point: an export whose account cannot be named must say so in every row
 * and in its own filename, rather than inherit an account id from an
 * environment variable.
 */
async function provenanceOnly(): Promise<ExportProvenance> {
  const { resolveIdentity } = await import("@/lib/aws/identity")
  const identity = await resolveIdentity()
  if (identity.state !== "ACTUAL" && identity.state !== "STALE") return UNRESOLVED_PROVENANCE
  return {
    accountId: identity.value.accountId,
    region: identity.value.region,
    partition: identity.value.partition,
    readAs: identity.value.arn,
  }
}

/* ------------------------------------------------------- the declared side -- */

/** Where the estate is declared. The same two directories `declared-estate.ts` reads. */
const SOURCE_DIRECTORIES = ["infrastructure/terraform", "infrastructure/studio"] as const

/** How far up to look for the repository root before giving up. */
const MAX_ASCENT = 6

let cachedSources: readonly TerraformSource[] | null = null

/**
 * Every `.tf` this process can reach, as source text.
 *
 * `estateDrift` needs the FULL parse — `parseTerraformEstate`, which resolves
 * declared names, multiplicity and per-setting expectations — where the estate
 * page's coverage table needs only `parseTerraformDeclarations`' counts. The
 * two parsers read the same files and `declared-estate.ts` exposes only the
 * parsed counts, so this collects them again rather than re-deriving one from
 * the other.
 *
 * That is a duplicated filesystem walk and it is named as one: the collector
 * belongs in `declared-estate.ts` beside the directory list it shares, and is
 * not moved there because that file is another agent's this hour.
 *
 * An unreachable Terraform tree is the NORMAL case in the deployed image, which
 * ships the application and not the infrastructure. It returns no sources,
 * `parseTerraformEstate` returns `known: false`, `estateDrift` returns
 * `comparable: false`, and `driftTable` emits one row saying so — never zero
 * rows, which would read as agreement.
 */
function terraformSources(from: string = process.cwd()): readonly TerraformSource[] {
  if (cachedSources) return cachedSources

  let directory = path.resolve(from)
  for (let ascent = 0; ascent <= MAX_ASCENT; ascent += 1) {
    const files = collect(directory)
    if (files.length > 0) {
      cachedSources = files
      return files
    }
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }

  cachedSources = []
  return cachedSources
}

function collect(root: string): readonly TerraformSource[] {
  const files: TerraformSource[] = []
  for (const relative of SOURCE_DIRECTORIES) {
    const directory = path.join(root, relative)
    let entries: string[]
    try {
      entries = fs.readdirSync(directory)
    } catch {
      continue
    }
    for (const entry of entries.sort()) {
      if (!entry.endsWith(".tf")) continue
      try {
        files.push({
          path: `${relative}/${entry}`,
          text: fs.readFileSync(path.join(directory, entry), "utf8"),
        })
      } catch {
        // Listed and would not read. One declaration this process cannot see;
        // `EstateDriftReport.filesRead` names what it did read, so the omission
        // is visible in the exported rows rather than silent.
        continue
      }
    }
  }
  return files
}
