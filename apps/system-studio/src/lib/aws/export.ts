/**
 * STUDIO-100-002 (the `export` clause) — the estate as data an operator can
 * take away, with its provenance attached and its blind spots named.
 *
 * Nothing in `apps/system-studio/src` set a `Content-Disposition` except the
 * fleet registry's CSV at `api/aws/[surface]/route.ts:472`. Everything this
 * console reads out of AWS — the inventory, the coverage table, the drift
 * comparison, the security posture — could be looked at and could not be taken
 * away. This module is the projection those four surfaces run through on the
 * way out, and `app/api/export/route.ts` is the only thing that calls it.
 *
 * ## Three properties, and each one is the reason the file exists
 *
 * **1. Every row carries its provenance.** Which account, which region, which
 * partition, which AWS service, which capability, which IAM action, and the
 * "as of" of the reading that produced THAT row — not one banner date at the
 * top. A spreadsheet of resource names with a single timestamp in the filename
 * is a screenshot with commas in it: it cannot tell a reader that the ECS
 * section is four seconds old and the certificate section is four hours old,
 * which is exactly the difference that decides whether a row is worth acting
 * on.
 *
 * **2. A read that failed leaves the building as a failed read.** Every builder
 * below emits a row for a section, a service, a resource type or a control that
 * could NOT be read, carrying `state` = `DENIED` / `THROTTLED` / `UNCONFIGURED`
 * / `ERROR` / `UNREADABLE`, the refused action, and the pasteable minimum IAM
 * statement. It is the same discipline `lib/aws/read.ts` puts in the type
 * system and `components/md3/UnknownState` puts on a page, carried into a file:
 * an export that silently omits what it could not read is the same lie as a
 * zero on a screen, and it is worse, because the screen can be refreshed next
 * to the person who knows and the file cannot. `estateDrift` reporting
 * `comparable: false` produces ONE row saying so rather than zero rows, because
 * zero rows in a drift export reads as agreement.
 *
 * **3. `state` and `verdict` are two columns, not one.** `state` answers "could
 * this engine see it". `verdict` answers "and what did the surface make of what
 * it saw" — `PASS` / `FAIL` / `NOT_CHECKED` for a posture control, `absent` /
 * `undeclared` / `divergent` for a drift finding. Folding a refused
 * `kms:ListKeys` into the same column as a failing key-rotation check is the
 * one collapse `lib/aws/posture.ts` exists to prevent, and a CSV is where it
 * would happen unnoticed.
 *
 * ## CSV injection
 *
 * A cell whose first character is `=`, `+`, `-`, `@`, TAB or CR is a formula to
 * Excel, LibreOffice and Google Sheets. `=cmd|'/c calc'!A1` in an AWS tag value
 * — a value an operator with `tag:TagResources` can set and this console
 * faithfully reports — becomes code execution on the workstation of whoever
 * opens the export. `csvCell` prefixes such a value with an apostrophe, which
 * every one of those three treats as "the rest of this is text".
 *
 * Numbers are the exception and it is a deliberate one: `-1` neutralised to
 * `'-1` is a number that no longer sorts or sums, and the danger characters are
 * only dangerous at the head of something a formula parser will keep reading.
 * A cell that parses whole as a finite JavaScript number is passed through.
 *
 * ## What must not leave
 *
 * `redactSecretMaterial` runs over every string cell of both formats. The
 * realistic leak is not an SDK response — none of these readers returns
 * credential material — it is `TerraformDeclaration.attributes`, which holds the
 * RAW right-hand side of a declaration and reaches `declaredValue` on a drift
 * finding. A `.tf` with a hardcoded `secret_key = "…"` in it would otherwise
 * post that string into a spreadsheet. Access key IDs are left intact on
 * purpose: `AKIA…` identifies a key, it does not authenticate as one, and
 * STUDIO-000-009's whole long-lived-key finding is unusable without it.
 *
 * ## Pure, and that is load-bearing
 *
 * Nothing here calls AWS, reads the filesystem, or touches `process.env`. Every
 * builder takes readings that are already `AwsRead` unions, exactly as
 * `estateDrift` does and for the same reason: a denied read has to be a VALUE
 * the projection can see, and every arm has to be provable without an account.
 */

import { CAPABILITIES, type Capability } from "./capabilities"
import type { EstateDriftReport } from "./drift"
import type { EstateReadings, EstateResource, EstateSection } from "./inventory"
import type { SecurityPosture, SecurityPostureItem } from "./posture"
import type { AwsRead } from "./read"

/* ------------------------------------------------------------- vocabulary -- */

/** The four things this console knows that an operator can take away. */
export const EXPORT_SURFACES = ["inventory", "coverage", "drift", "posture"] as const

export type ExportSurfaceId = (typeof EXPORT_SURFACES)[number]

export function isExportSurface(value: string): value is ExportSurfaceId {
  return (EXPORT_SURFACES as readonly string[]).includes(value)
}

export const EXPORT_FORMATS = ["csv", "json"] as const

export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value)
}

/**
 * Whether this engine could see the thing the row is about. One closed union
 * across all four surfaces, so `state` means the same word everywhere.
 *
 * The first three are answers about the ACCOUNT. Everything from `DENIED`
 * onwards is an answer about this CONSOLE, and the split is the whole point:
 * `NONE` is a claim somebody can act on and `DENIED` is a claim about our own
 * grants that says nothing whatsoever about what is out there.
 */
export type ExportRowState =
  /** Read, and there is something. */
  | "READ"
  /** Read, and there is genuinely nothing. The only arm that asserts absence. */
  | "NONE"
  /** Held from an earlier read, past its refresh window, and shown as such. */
  | "STALE"
  /** Refused. `awsAction` and `minimumStatement` carry the remedy. */
  | "DENIED"
  /** AWS rate-limited the read after backoff. Retrying is the remedy. */
  | "THROTTLED"
  /** The call was never made, because what it needs is not set. */
  | "UNCONFIGURED"
  /** The call broke for some other reason. */
  | "ERROR"
  /** Unreadable, and the surface that produced the row did not say which arm. */
  | "UNREADABLE"
  /** A reader exists in this build; this composition deliberately does not drive it. */
  | "NOT_COMPOSED"
  /** No module in this build reads it. A gap in the CONSOLE, not in the account. */
  | "NO_READER"
  /** Read, but the reader could not turn it into a named row. Never dropped. */
  | "OMITTED"
  /** The declared side was not readable, so neither direction can be claimed. */
  | "NOT_DECLARABLE"

/**
 * What the surface made of what it saw, where it makes anything of it.
 *
 * Deliberately a SECOND column. `state` is about visibility and this is about
 * judgement, and the two are independent: a `FAIL` is something this engine saw
 * perfectly well, and an `UNKNOWN` posture control is a question nobody
 * answered. Coverage and inventory rows carry `null` here, because counting
 * resources is not a verdict.
 */
export type ExportRowVerdict =
  | "PASS"
  | "FAIL"
  | "NOT_CHECKED"
  | "UNKNOWN"
  | "absent"
  | "undeclared"
  | "divergent"
  | null

export type ExportValue = string | number | boolean | null

export type ExportRow = Readonly<Record<string, ExportValue>>

/** Where every row of every surface begins. Provenance before payload. */
export const PROVENANCE_COLUMNS = [
  "surface",
  "state",
  "verdict",
  "accountId",
  "region",
  "partition",
  "service",
  "capability",
  "awsAction",
  "asOf",
] as const

/** Where every row of every surface ends. */
export const TRAILING_COLUMNS = ["detail", "minimumStatement"] as const

/** The columns each surface adds between the two. */
const OWN_COLUMNS: Readonly<Record<ExportSurfaceId, readonly string[]>> = {
  inventory: [
    "resourceType",
    "name",
    "resourceState",
    "arn",
    "resourceRegion",
    "resourceAccountId",
    "tenant",
    "dependsOn",
    "tags",
  ],
  coverage: ["resources", "declaredDefinite", "declaredConditional", "reads"],
  drift: [
    "severity",
    "resourceType",
    "declaredAt",
    "declaredIn",
    "observed",
    "observedArn",
    "setting",
    "declaredValue",
    "observedValue",
  ],
  posture: ["key", "question", "control", "severity", "checked", "subjects", "remedy"],
}

export function columnsFor(surface: ExportSurfaceId): readonly string[] {
  return [...PROVENANCE_COLUMNS, ...OWN_COLUMNS[surface], ...TRAILING_COLUMNS]
}

/** The account this export was taken from. Resolved from STS, never guessed. */
export interface ExportProvenance {
  accountId: string | null
  region: string | null
  partition: string | null
  /**
   * The principal ARN the reads were made as.
   *
   * An ARN names a role; it does not authenticate as one. Without it a reader
   * of the file cannot tell whether a page of DENIED rows means "the wrong role
   * is attached" or "the right role is under-granted", which is the first
   * question anybody asks of an export full of denials.
   */
  readAs: string | null
}

export const UNRESOLVED_PROVENANCE: ExportProvenance = {
  accountId: null,
  region: null,
  partition: null,
  readAs: null,
}

export interface ExportTable {
  surface: ExportSurfaceId
  columns: readonly string[]
  rows: readonly ExportRow[]
  provenance: ExportProvenance
  /**
   * Rows whose `state` is one this engine could not read.
   *
   * Counted rather than left to be noticed, and reported in the JSON envelope
   * and in the `x-unreadable-rows` response header, so a pipeline consuming
   * this file can refuse a partial estate without parsing every row.
   */
  unreadableRows: number
}

/** Whether a row state means "this engine could not see it". */
export function isUnreadableState(state: ExportRowState): boolean {
  return (
    state === "DENIED" ||
    state === "THROTTLED" ||
    state === "UNCONFIGURED" ||
    state === "ERROR" ||
    state === "UNREADABLE" ||
    state === "NOT_COMPOSED" ||
    state === "NO_READER" ||
    state === "OMITTED" ||
    state === "NOT_DECLARABLE"
  )
}

/* ------------------------------------------------------------- redaction -- */

const PEM_BLOCK = /-----BEGIN[^-]{0,64}-----[\s\S]*?-----END[^-]{0,64}-----/g

/**
 * Anything that authenticates, wherever it was written down.
 *
 * Two rules, and both are aimed at a real path rather than at a category:
 *
 *   1. A PEM block. `infrastructure/**\/*.tf` is parsed verbatim by
 *      `parseTerraformEstate`, and a `private_key = <<EOT … EOT` heredoc lands
 *      in `TerraformDeclaration.attributes` as source text.
 *   2. A value on the right of something whose NAME says it authenticates —
 *      `secret_access_key`, `session_token`, `password`, `private_key`,
 *      `client_secret`. Keyed on the label rather than on the shape of the
 *      value, because the shape of a password is "anything".
 *
 * There is deliberately no entropy heuristic. A rule that redacted every
 * 40-character mixed-case token would eat S3 bucket names, Lambda function
 * names and CloudFront distribution ids — the substance of the export — to
 * defend against material none of these readers returns. Access key IDs are
 * likewise left alone: `AKIA…` is an identifier, STUDIO-000-009's long-lived-key
 * finding is unreadable without it, and it does not authenticate anything on
 * its own.
 */
export function redactSecretMaterial(text: string): string {
  return text
    .replace(PEM_BLOCK, "[redacted private key]")
    .replace(
      /((?:aws[_-]?)?(?:secret[_-]?access[_-]?key|secret[_-]?key|session[_-]?token|password|passwd|private[_-]?key|client[_-]?secret)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi,
      "$1[redacted]",
    )
}

/* ------------------------------------------------------------------- CSV -- */

/** Characters a spreadsheet treats as the start of a formula. */
const FORMULA_LEADERS = new Set(["=", "+", "-", "@", "\t", "\r"])

/**
 * Whether the cell is a number in its entirety.
 *
 * The one exemption from neutralisation. `-3`, `+1.5e3` and `-0` are numbers a
 * reader will want to sort and sum, and prefixing them with an apostrophe turns
 * a numeric column into text for the sake of a formula that cannot exist —
 * a formula parser stops at the end of `-3` and there is nothing after it.
 */
function isWholeNumber(text: string): boolean {
  if (text.trim() === "") return false
  return Number.isFinite(Number(text))
}

/**
 * One CSV cell: neutralised against formula injection, then quoted per RFC 4180.
 *
 * The apostrophe goes INSIDE the quotes. Excel, LibreOffice Calc and Google
 * Sheets all read a leading apostrophe as "the remainder is literal text", and
 * all three would otherwise evaluate `=cmd|'/c calc'!A1`, `+HYPERLINK(...)`,
 * `-1+1` and `@SUM(A1)`.
 */
export function csvCell(value: ExportValue): string {
  if (value === null || value === undefined) return ""
  const raw = typeof value === "string" ? redactSecretMaterial(value) : String(value)

  const head = raw.charAt(0)
  const neutralised =
    FORMULA_LEADERS.has(head) && !isWholeNumber(raw) ? `'${raw}` : raw

  /*
   * Quote for any character that would otherwise end the field or the record,
   * and for leading or trailing whitespace, which several readers strip.
   *
   * The whitespace test is on `raw` rather than on `neutralised` deliberately:
   * a value beginning with a TAB is neutralised to `'\tcmd`, whose first
   * character is now the apostrophe, so testing the neutralised string would
   * conclude there is no leading whitespace to preserve and silently drop the
   * tab at every reader that trims. The two danger characters that are ALSO
   * whitespace are exactly the ones this would lose.
   */
  if (/[",\r\n]/.test(neutralised) || raw !== raw.trim()) {
    return `"${neutralised.replace(/"/g, '""')}"`
  }
  return neutralised
}

/** CRLF, per RFC 4180. Excel on Windows treats a bare LF record as one long row. */
const CRLF = "\r\n"

export function toCsv(table: ExportTable): string {
  const lines = [table.columns.map((column) => csvCell(column)).join(",")]
  for (const row of table.rows) {
    lines.push(table.columns.map((column) => csvCell(row[column] ?? null)).join(","))
  }
  return lines.join(CRLF) + CRLF
}

/* ------------------------------------------------------------------ JSON -- */

export interface ExportEnvelope {
  surface: ExportSurfaceId
  /** When the file was produced. NOT when any row was read — that is per row. */
  generatedAt: string
  account: ExportProvenance
  correlationId: string
  columns: readonly string[]
  counts: { rows: number; unreadable: number }
  /** Said in the file, so a consumer that reads only the envelope still learns it. */
  note: string
  rows: readonly ExportRow[]
}

const ENVELOPE_NOTE =
  "Every row carries its own state. A row whose state is DENIED, THROTTLED, UNCONFIGURED, " +
  "ERROR, UNREADABLE, NOT_COMPOSED, NO_READER, OMITTED or NOT_DECLARABLE is a read this engine " +
  "could not perform, and says nothing about whether the thing exists. Only NONE asserts an " +
  "absence. `state` is about visibility; `verdict` is the surface's own judgement and is null " +
  "where it has none."

export function toEnvelope(
  table: ExportTable,
  meta: { generatedAt: string; correlationId: string },
): ExportEnvelope {
  return {
    surface: table.surface,
    generatedAt: meta.generatedAt,
    account: table.provenance,
    correlationId: meta.correlationId,
    columns: table.columns,
    counts: { rows: table.rows.length, unreadable: table.unreadableRows },
    note: ENVELOPE_NOTE,
    rows: table.rows.map(redactRow),
  }
}

function redactRow(row: ExportRow): ExportRow {
  const out: Record<string, ExportValue> = {}
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === "string" ? redactSecretMaterial(value) : value
  }
  return out
}

export function toJson(
  table: ExportTable,
  meta: { generatedAt: string; correlationId: string },
): string {
  return JSON.stringify(toEnvelope(table, meta), null, 2)
}

/* ------------------------------------------------------- the file's name -- */

/**
 * The `Content-Disposition` header, naming the account, the surface and the date.
 *
 * All three, because an operator comparing two exports has no other way to tell
 * them apart once they are in a downloads folder — and an estate file whose
 * name does not say which ACCOUNT it came from is the one that gets pasted into
 * the wrong incident.
 *
 * The filename is built from a whitelist rather than escaped. An account id and
 * a surface id are both closed vocabularies here, but the header is a place
 * where a stray quote or newline is a response-splitting bug, and a whitelist
 * cannot be got wrong by a future caller passing something looser.
 */
export function contentDisposition(input: {
  accountId: string | null
  surface: ExportSurfaceId
  format: ExportFormat
  at: string
}): string {
  const account = safeSegment(input.accountId) || "unknown-account"
  const day = input.at.slice(0, 10)
  const name = `tenure-estate-${account}-${input.surface}-${day}.${input.format}`
  return `attachment; filename="${name}"`
}

function safeSegment(value: string | null): string {
  if (!value) return ""
  return value.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64)
}

export function contentTypeFor(format: ExportFormat): string {
  return format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8"
}

/* ------------------------------------------------------ shared row helpers -- */

/** The read state, as this projection words it. One mapping, used by every builder. */
export function stateOfRead(read: AwsRead<unknown>): ExportRowState {
  switch (read.state) {
    case "ACTUAL":
      return "READ"
    case "EMPTY":
      return "NONE"
    case "STALE":
      return "STALE"
    case "DENIED":
      return "DENIED"
    case "THROTTLED":
      return "THROTTLED"
    case "UNCONFIGURED":
      return "UNCONFIGURED"
    case "ERROR":
      return "ERROR"
  }
}

/** The refused action and the pasteable statement, for the arms that carry them. */
function refusalOf(read: AwsRead<unknown>): { awsAction: string; minimumStatement: string } {
  if (read.state === "DENIED") {
    return { awsAction: read.action, minimumStatement: read.minimumStatement }
  }
  return { awsAction: actionOf(read.capability), minimumStatement: "" }
}

function actionOf(capability: Capability | null): string {
  if (!capability) return ""
  const spec = CAPABILITIES[capability]
  return spec ? (spec.iamActions[0] ?? "") : ""
}

/** The `asOf` a reading carries, or null for the arms that carry none. */
function asOfOf(read: AwsRead<unknown>): string | null {
  switch (read.state) {
    case "ACTUAL":
    case "EMPTY":
    case "STALE":
    case "THROTTLED":
      return read.asOf
    default:
      return null
  }
}

function tableOf(
  surface: ExportSurfaceId,
  provenance: ExportProvenance,
  rows: readonly ExportRow[],
): ExportTable {
  const columns = columnsFor(surface)
  let unreadable = 0
  for (const row of rows) {
    if (isUnreadableState(row.state as ExportRowState)) unreadable += 1
  }
  return { surface, columns, rows, provenance, unreadableRows: unreadable }
}

/** Every provenance field, filled once, so no builder can forget one. */
function base(
  surface: ExportSurfaceId,
  provenance: ExportProvenance,
  input: {
    state: ExportRowState
    verdict?: ExportRowVerdict
    service: string
    capability: string
    awsAction: string
    asOf: string | null
    detail: string
    minimumStatement?: string
  },
): Record<string, ExportValue> {
  return {
    surface,
    state: input.state,
    verdict: input.verdict ?? null,
    accountId: provenance.accountId,
    region: provenance.region,
    partition: provenance.partition,
    service: input.service,
    capability: input.capability,
    awsAction: input.awsAction,
    asOf: input.asOf,
    detail: input.detail,
    minimumStatement: input.minimumStatement ?? "",
  }
}

/* -------------------------------------------------------------- inventory -- */

/**
 * Every section of the estate, and every resource in the sections that answered.
 *
 * Driven off `section.coverage` rather than off the resource list, which is
 * what makes the second property at the top of this file structural: a section
 * that produced no resources still produces a row, and that row says WHY. A
 * projection that iterated resources would emit nothing at all for a refused
 * `ecs:ListServices`, and the file would report an estate with no ECS in it.
 */
export function inventoryTable(
  readings: EstateReadings,
  provenance: ExportProvenance,
): ExportTable {
  const rows: ExportRow[] = []

  for (const section of readings.sections) {
    rows.push(...sectionRows(section, provenance))
  }

  return tableOf("inventory", provenance, rows)
}

function sectionRows(
  section: EstateSection,
  provenance: ExportProvenance,
): readonly ExportRow[] {
  const rows: ExportRow[] = []
  const service = section.service
  const capability = section.capability

  if (section.contribution.kind === "resources") {
    const read = section.contribution.read
    const state = stateOfRead(read)

    if (read.state === "ACTUAL" || read.state === "STALE") {
      for (const resource of read.value) {
        rows.push(resourceRow(resource, section, provenance, state))
      }
    } else {
      const refusal = refusalOf(read)
      rows.push({
        ...base("inventory", provenance, {
          state,
          service,
          capability,
          awsAction: refusal.awsAction,
          asOf: asOfOf(read),
          detail: section.text,
          minimumStatement: refusal.minimumStatement,
        }),
        resourceType: null,
        name: null,
        resourceState: null,
        arn: null,
        resourceRegion: null,
        resourceAccountId: null,
        tenant: null,
        dependsOn: null,
        tags: null,
      })
    }

    // What the reader saw and could not name. Emitted, never dropped: an item
    // the reader could not turn into a resource is not an item that is not
    // there, and it is exactly the gap a resource count hides.
    for (const omitted of section.contribution.omitted) {
      rows.push({
        ...base("inventory", provenance, {
          state: "OMITTED",
          service,
          capability,
          awsAction: actionOf(capability),
          asOf: asOfOf(read),
          detail: omitted.why,
        }),
        resourceType: null,
        name: omitted.label,
        resourceState: null,
        arn: null,
        resourceRegion: null,
        resourceAccountId: null,
        tenant: null,
        dependsOn: null,
        tags: null,
      })
    }

    return rows
  }

  // A signal or an uncomposed section: no resources by construction, and one
  // row so the file still says the section exists and what became of it.
  const coverage = section.coverage
  const state: ExportRowState =
    coverage.kind === "VISIBLE"
      ? "READ"
      : coverage.kind === "ABSENT"
        ? "NONE"
        : coverage.kind === "UNKNOWN"
          ? coverage.state
          : coverage.kind === "NOT_COMPOSED"
            ? "NOT_COMPOSED"
            : "NO_READER"

  const read = section.contribution.kind === "signal" ? section.contribution.read : null
  const refusal = read ? refusalOf(read) : { awsAction: actionOf(capability), minimumStatement: "" }

  rows.push({
    ...base("inventory", provenance, {
      state,
      service,
      capability,
      awsAction: refusal.awsAction,
      asOf: read ? asOfOf(read) : null,
      detail: section.text,
      minimumStatement: refusal.minimumStatement,
    }),
    resourceType: null,
    name: section.label,
    resourceState: null,
    arn: null,
    resourceRegion: null,
    resourceAccountId: null,
    tenant: null,
    dependsOn: null,
    tags: null,
  })

  return rows
}

function resourceRow(
  resource: EstateResource,
  section: EstateSection,
  provenance: ExportProvenance,
  state: ExportRowState,
): ExportRow {
  return {
    ...base("inventory", provenance, {
      state,
      service: section.service,
      capability: section.capability,
      awsAction: actionOf(section.capability),
      // The RESOURCE's own stamp, not the section's and not the page's. Two
      // sections of one export are routinely hours apart; see the header.
      asOf: resource.asOf,
      detail: section.label,
    }),
    resourceType: resource.resourceType,
    name: resource.name,
    resourceState: resource.state,
    arn: resource.arn,
    // The resource's own placement, which is not always the reader's: a
    // CloudFront distribution is global and an ACM certificate for it lives in
    // us-east-1 whatever region this console resolved.
    resourceRegion: resource.region,
    resourceAccountId: resource.accountId,
    tenant: tenantOf(resource),
    dependsOn: resource.dependsOn.join(" "),
    tags: Object.entries(resource.tags)
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join(" "),
  }
}

/**
 * The tenant column, and it distinguishes three facts rather than two.
 *
 * `unattributed` is not an empty cell. An untagged resource cannot be charged
 * to anybody and cannot be found when a tenant is deleted (STUDIO-080-007); a
 * blank would make it indistinguishable from a shared control-plane resource,
 * which is a resource somebody DID make a decision about.
 */
function tenantOf(resource: EstateResource): string {
  switch (resource.attribution.kind) {
    case "tenant":
      return resource.attribution.tenantSlug
    case "shared":
      return "tenure:shared"
    case "unattributed":
      return "unattributed"
  }
}

/* --------------------------------------------------------------- coverage -- */

/**
 * The structural shape of `app/platform/estate/estate-coverage.ts`'s
 * `CoverageRow`.
 *
 * Declared here rather than imported, deliberately, and for the reason
 * `lib/aws/posture.ts` gives for `SecurityControlRow`: a library module
 * importing a route's type inverts the dependency. The page's row is the
 * contract this must satisfy, so `coverageTable(coverageRows(...))` type-checks
 * at the route's call site and `tsc` there is what proves the two have not
 * drifted.
 */
export interface CoverageRowLike {
  service: string
  reader: "READ" | "EMPTY" | "UNREADABLE" | "NO_READER"
  count: number | null
  capabilities: readonly string[]
  reads: readonly string[]
  asOf: string | null
  because: string
  declared: { definite: number; conditional: number } | null
}

/**
 * One row per AWS service this build has anything to say about.
 *
 * `count` is `null` — not `0` — for every service that was not read, and that
 * distinction survives into the file: a spreadsheet with a zero in it is a
 * spreadsheet somebody will sum.
 */
export function coverageTable(
  rows: readonly CoverageRowLike[],
  provenance: ExportProvenance,
): ExportTable {
  const out: ExportRow[] = rows.map((row) => {
    const state: ExportRowState =
      row.reader === "READ"
        ? "READ"
        : row.reader === "EMPTY"
          ? "NONE"
          : row.reader === "UNREADABLE"
            ? "UNREADABLE"
            : "NO_READER"

    const capability = row.capabilities[0] ?? ""
    return {
      ...base("coverage", provenance, {
        state,
        service: row.service,
        capability: row.capabilities.join(" "),
        awsAction: isCapability(capability) ? actionOf(capability) : "",
        asOf: row.asOf,
        detail: row.because,
      }),
      resources: row.count,
      declaredDefinite: row.declared ? row.declared.definite : null,
      declaredConditional: row.declared ? row.declared.conditional : null,
      reads: row.reads.join(" · "),
    }
  })

  return tableOf("coverage", provenance, out)
}

function isCapability(value: string): value is Capability {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, value)
}

/* ------------------------------------------------------------------ drift -- */

/**
 * Declared versus actual, as findings an operator can act on.
 *
 * The `comparable: false` arm is the one that matters and it is the reason this
 * cannot be a plain `report.findings.map(...)`. When no Terraform is reachable
 * — the NORMAL case in the deployed image, which ships the application and not
 * the infrastructure — `estateDrift` returns every list empty. Mapped naively
 * that is a drift export with zero rows in it, which reads as "declared and
 * actual agree" and is the loudest false statement this file could make. It
 * produces one `NOT_DECLARABLE` row carrying `because` instead.
 */
export function driftTable(
  report: EstateDriftReport,
  provenance: ExportProvenance,
): ExportTable {
  const rows: ExportRow[] = []
  const asOf = report.asOf

  if (!report.comparable) {
    rows.push({
      ...base("drift", provenance, {
        state: "NOT_DECLARABLE",
        service: "terraform",
        capability: "",
        awsAction: "",
        asOf,
        detail: report.because,
      }),
      severity: null,
      resourceType: null,
      declaredAt: null,
      declaredIn: null,
      observed: null,
      observedArn: null,
      setting: null,
      declaredValue: null,
      observedValue: null,
    })
    return tableOf("drift", provenance, rows)
  }

  for (const finding of report.findings) {
    rows.push({
      ...base("drift", provenance, {
        state: "READ",
        verdict: finding.kind,
        service: serviceOfResourceType(finding.resourceType),
        capability: "",
        awsAction: "",
        asOf,
        detail: finding.detail,
      }),
      severity: finding.severity,
      resourceType: finding.resourceType,
      declaredAt: finding.declaredAt,
      declaredIn: finding.declaredIn,
      observed: finding.observed,
      observedArn: finding.observedArn,
      setting: finding.setting,
      declaredValue: finding.declaredValue,
      observedValue: finding.observedValue,
    })
  }

  // A declaration or a live resource the comparison declines to judge. In the
  // file for the same reason it is on the page: an un-comparable resource that
  // vanished from the export would be indistinguishable from one that matched.
  for (const item of report.uncomparable) {
    rows.push({
      ...base("drift", provenance, {
        state: "OMITTED",
        service: item.resourceType ? serviceOfResourceType(item.resourceType) : "",
        capability: "",
        awsAction: "",
        asOf,
        detail: item.because,
      }),
      severity: null,
      resourceType: item.resourceType,
      declaredAt: item.declaredAt,
      declaredIn: item.declaredIn,
      observed: item.observed,
      observedArn: null,
      setting: null,
      declaredValue: null,
      observedValue: null,
    })
  }

  // A resource type whose OBSERVED side could not be read. No absence is
  // inferred for these, and the file has to say so, or a missing `absent`
  // finding reads as a declaration that is satisfied.
  for (const item of report.blind) {
    rows.push({
      ...base("drift", provenance, {
        state: "UNREADABLE",
        service: serviceOfResourceType(item.resourceType),
        capability: "",
        awsAction: "",
        asOf,
        detail: item.because,
      }),
      severity: null,
      resourceType: item.resourceType,
      declaredAt: null,
      declaredIn: null,
      observed: null,
      observedArn: null,
      setting: null,
      declaredValue: null,
      observedValue: null,
    })
  }

  // Declared types nothing in this build observes. A gap in the CONSOLE.
  for (const item of report.unobserved) {
    rows.push({
      ...base("drift", provenance, {
        state: "NO_READER",
        service: serviceOfResourceType(item.resourceType),
        capability: "",
        awsAction: "",
        asOf,
        detail:
          `${item.declared} declaration(s) of ${item.resourceType} are in the Terraform and ` +
          "nothing in this build observes that type, so neither direction of drift can be " +
          "claimed for it. This is a gap in the console, not a statement about the account.",
      }),
      severity: null,
      resourceType: item.resourceType,
      declaredAt: null,
      declaredIn: null,
      observed: null,
      observedArn: null,
      setting: null,
      declaredValue: null,
      observedValue: null,
    })
  }

  return tableOf("drift", provenance, rows)
}

/** `s3:bucket` → `s3`. The estate resource type's own first segment, never guessed. */
function serviceOfResourceType(resourceType: string): string {
  const colon = resourceType.indexOf(":")
  return colon > 0 ? resourceType.slice(0, colon) : resourceType
}

/* ---------------------------------------------------------------- posture -- */

/**
 * The sixteen security questions this console asks, and what each one answered.
 *
 * `state` and `verdict` split here exactly as the header describes. A `FAIL` is
 * `state: READ` — the control ran and found something — and an `UNKNOWN` is
 * `state: UNREADABLE` with the refused action and the pasteable statement on
 * the row, because those two have opposite remedies and a single column would
 * send half of the readers of this file to do the wrong one.
 *
 * ## The one provenance field this surface cannot fill honestly
 *
 * `capability` is empty on every posture row. A posture item is a FOLD over
 * several capabilities of one service — `foldBucketPublicAccess` reads the
 * bucket listing, the public access block AND the policy status — and naming
 * any one of them as "the capability that produced this row" would be a false
 * attribution in a provenance column. The `service` column carries the IAM
 * service prefix, which is true, and `awsAction` carries the exact refused
 * action on the arm that has one, which is the field a remedy needs.
 *
 * `asOf` is the aggregate `SecurityPosture.asOf` — the newest of the twelve
 * readings — for every row, because `SecurityPostureItem` carries no stamp of
 * its own. That is a per-surface stamp rather than a per-row one, and it is
 * stated here rather than presented as something it is not.
 */
export function postureTable(
  posture: SecurityPosture,
  provenance: ExportProvenance,
): ExportTable {
  const rows: ExportRow[] = posture.items.map((item) => postureRow(item, posture.asOf, provenance))
  return tableOf("posture", provenance, rows)
}

function postureRow(
  item: SecurityPostureItem,
  asOf: string,
  provenance: ExportProvenance,
): ExportRow {
  const common = {
    key: item.key,
    question: item.question,
    control: item.control,
  }

  switch (item.state) {
    case "PASS":
      return {
        ...base("posture", provenance, {
          state: "READ",
          verdict: "PASS",
          service: item.service,
          capability: "",
          awsAction: "",
          asOf,
          detail:
            item.basis +
            (item.limits.length > 0 ? ` Not covered by this pass: ${item.limits.join(" ")}` : ""),
        }),
        ...common,
        severity: null,
        checked: item.checked,
        subjects: "",
        remedy: "",
      }
    case "FAIL":
      return {
        ...base("posture", provenance, {
          state: "READ",
          verdict: "FAIL",
          service: item.service,
          capability: "",
          awsAction: "",
          asOf,
          detail: item.detail,
        }),
        ...common,
        severity: item.severity,
        checked: null,
        subjects: item.subjects.join(" "),
        remedy: item.remedy,
      }
    case "NOT_CHECKED":
      return {
        ...base("posture", provenance, {
          // READ, and this is the distinction the whole union is for: the call
          // succeeded and the answer is that the control is not running. That
          // is a fact about the ESTATE and it belongs in the file as one.
          state: "READ",
          verdict: "NOT_CHECKED",
          service: item.service,
          capability: "",
          awsAction: "",
          asOf,
          detail: item.reason,
        }),
        ...common,
        severity: null,
        checked: null,
        subjects: "",
        remedy: item.remedy,
      }
    case "UNKNOWN":
      return {
        ...base("posture", provenance, {
          state: "UNREADABLE",
          verdict: "UNKNOWN",
          service: item.service,
          capability: "",
          awsAction: item.action,
          asOf,
          detail: item.reason,
          minimumStatement: item.minimumStatement,
        }),
        ...common,
        severity: null,
        checked: null,
        subjects: "",
        remedy:
          "Grant the statement in this row to this engine's task role. Until it is granted " +
          "nothing is known here, and this row is not a report that there is nothing.",
      }
  }
}

/* ----------------------------------------------------------- the budget -- */

/**
 * What one export costs, and why it is rationed harder than a page.
 *
 * `SURFACES` in `./result.ts` is the same mechanism for the polled read-only
 * API, and this budget is deliberately NOT an entry there: `result.ts` belongs
 * to another surface's owner this hour, and a second agent editing that table
 * concurrently is how two limiters end up disagreeing about the same window.
 * It is the same fixed-window shape, and it belongs beside those three the
 * moment one person owns both.
 *
 * The number is small on purpose. One export drives `estateInventory`,
 * `securityPosture` and four drift readers — of the order of a hundred AWS
 * describe calls, several of them paginated. An operator refreshing a download
 * URL in a loop is a denial-of-wallet on this console's own account, which is
 * the cost-side failure STUDIO-110-001 names, and there is no legitimate use
 * that needs the whole estate more than six times a minute.
 */
export const EXPORT_BUDGET = 6
export const EXPORT_WINDOW_MS = 60_000

const counters = new Map<string, { count: number; resetAt: number }>()

export interface ExportRateDecision {
  allowed: boolean
  retryAfterSeconds: number
  limit: number
  remaining: number
}

export function consumeExportBudget(
  principal: string,
  now = Date.now(),
): ExportRateDecision {
  const existing = counters.get(principal)

  if (!existing || existing.resetAt <= now) {
    counters.set(principal, { count: 1, resetAt: now + EXPORT_WINDOW_MS })
    return {
      allowed: true,
      retryAfterSeconds: Math.ceil(EXPORT_WINDOW_MS / 1000),
      limit: EXPORT_BUDGET,
      remaining: EXPORT_BUDGET - 1,
    }
  }

  existing.count += 1
  return {
    allowed: existing.count <= EXPORT_BUDGET,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    limit: EXPORT_BUDGET,
    remaining: Math.max(0, EXPORT_BUDGET - existing.count),
  }
}

/** For tests, which need a clean window rather than whatever the last one left. */
export function __resetExportBudget(): void {
  counters.clear()
}

/* ---------------------------------------------------- what an export needs -- */

/**
 * The commands a caller must hold for each surface, ALL of them.
 *
 * An export is a bulk read of every page it aggregates, so it is authorized as
 * every page it aggregates and not as the cheapest of them. The route calls
 * `authorizeCommand` for each entry and refuses on the first denial, naming the
 * permission and the policy revision — never whether the resource exists.
 *
 * `tenants.read` is on the three surfaces that carry tenant attribution. That is
 * not ceremony: `inventoryTable` writes a tenant slug into every resource row,
 * `coverageTable` carries the declared counts of tenant infrastructure, and
 * `driftTable` names live resources by the tenant that owns them. A family that
 * may not read the tenant register must not receive the register spread across
 * an estate file instead. Posture asks about controls rather than tenants and
 * needs only `platform.read`.
 *
 * Every role in `OPERATOR_GRANTS` currently holds both, so today this refuses
 * only a principal with no operator role at all. It is written as a list rather
 * than as one check because the grant table is the thing that changes: the day
 * `tenant:read` is taken off a family, this endpoint closes for them without
 * anybody remembering that it aggregates the tenant register.
 */
export const EXPORT_COMMANDS: Readonly<Record<ExportSurfaceId, readonly StudioCommandName[]>> = {
  inventory: ["platform.read", "tenants.read"],
  coverage: ["platform.read", "tenants.read"],
  drift: ["platform.read", "tenants.read"],
  posture: ["platform.read"],
}

/**
 * The command names this module names, as a structural type.
 *
 * Not imported from `@/lib/authorize`: this module is pure and importing that
 * one pulls `process.env` and the operator allowlist into every test that wants
 * to check a CSV cell. The route asserts the assignment against
 * `StudioCommand`, which is where the two are proven to agree.
 */
export type StudioCommandName = "platform.read" | "tenants.read" | "cost.read"
