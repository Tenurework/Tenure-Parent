/**
 * STUDIO-070-004 (DynamoDB) — the tables this estate keeps, read as CONTROL
 * PLANE objects, with the tenant registry ranked first.
 *
 * `infrastructure/studio/dynamodb.tf` provisions `<prefix>-tenants`: one
 * on-demand table holding `TENANT#<slug>` partitions (the composed manifest, the
 * lifecycle state, every step that got it there) and `AUDIT#<subject>`
 * partitions (the hash-chained audit trail). It is the fleet's own record of
 * itself — the only place that says which systems were provisioned and who
 * approved them — and nothing in the running product had ever asked AWS a single
 * question about it. The Terraform declares `point_in_time_recovery { enabled =
 * true }`; whether that is TRUE OF THE LIVE TABLE was, until this file, a thing
 * this console could not see. A declaration is an intention. `Terraform apply`
 * against a drifted table, a console click, a stack replaced by hand — any of
 * them separates the two, and the whole point of an AWS-authoritative control
 * plane is that the answer comes from AWS.
 *
 * PITR being OFF on the registry table is total loss of the fleet's own record
 * of itself, so it is not one column in a table of tables: it is
 * `RegistryProtection`, computed first and rendered first.
 *
 * ## Configuration, never contents
 *
 * Five capabilities, none of which can return an item. `GetItem`, `Query`,
 * `Scan` and every write live in `lib/registry.ts`, which is the only module
 * that may read a tenant's record and which has its own typed reader. These read
 * the TABLE — its billing mode, its size, its encryption, its backups, its TTL,
 * its indexes — and the closest any of them comes to data is an `ItemCount`.
 *
 * ## Five capabilities, five readings, degrading independently
 *
 * `dynamodb:ListTables`, `dynamodb:DescribeTable`,
 * `dynamodb:DescribeContinuousBackups`, `dynamodb:DescribeTimeToLive` and
 * `kms:DescribeKey` are five separate IAM actions, and a role is routinely
 * granted some without the others — `infrastructure/studio/iam.tf` grants
 * `ListTables` at `Resource = "*"` in one statement and the three describes at
 * `arn:*:dynamodb:*:*:table/*` in another, so the two can drift apart with a
 * single edit. Folding them into one reading would make a refused
 * `DescribeContinuousBackups` render as "refused dynamodb:ListTables", and the
 * minimum statement an operator pastes would not contain the action that is
 * actually missing: they would grant it, redeploy, and be refused identically.
 * `retained.ts` paid for that lesson with `backup:ListBackupVaults`.
 *
 * So every table carries FOUR independent `AwsRead`s. A denied
 * `DescribeContinuousBackups` leaves the row's billing mode, size and TTL intact
 * and says, on that one field, that PITR is unknown — which is emphatically not
 * "PITR is off" and emphatically not a reassuring default.
 *
 * ## What is a claim and what is not
 *
 * - An absent `ItemCount` throws, so the reading is ERROR. `0 items` on the
 *   registry table is a claim, and it is the claim that would let somebody
 *   believe the fleet has no tenants.
 * - `ItemCount` and `TableSizeBytes` are updated by DynamoDB approximately every
 *   six hours. They travel with a `freshness` sentence saying so, because a
 *   number rendered beside a live `asOf` reads as live.
 * - An absent `DeletionProtectionEnabled` is `unstated`, not `disabled`.
 *   Reporting a field AWS did not return as a finding is a fabricated finding.
 * - An absent `SSEDescription` is DynamoDB's AWS-OWNED default key, which is a
 *   real and specific fact — no key in this account, no key policy, no grant to
 *   revoke, no CloudTrail on its use — and not "encryption unknown".
 * - A KMS key ARN says a key exists; only `kms:DescribeKey`'s `KeyManager` says
 *   whether it is yours or `alias/aws/dynamodb`. That is a fifth call, and it is
 *   its own `AwsRead` for exactly the reason above.
 *
 * ## Pagination
 *
 * `ListTables` is walked to completion, bounded at {@link MAX_LIST_PAGES} pages
 * of 100. A reader that silently returns the first page is the same lie as an
 * empty list; a reader with no bound is how one page render takes the console
 * down. On hitting the cap the listing does not throw and does not pretend to be
 * whole — it carries `MoreTables`, whose `truncated` arm names the count read,
 * the pages spent and the table name to resume after, and which the surface
 * renders as its own line.
 *
 * ## Region and partition
 *
 * From the resolved identity — `sts:GetCallerIdentity` for the account and the
 * partition, the SDK's own resolved region — and from the `TableArn` AWS
 * returns. There is no region literal and no `"aws"` partition fallback in this
 * file: GE-010-007 was a data-residency defect caused by exactly that fallback.
 * With identity unresolved and the describe refused, no ARN is assembled at all,
 * because half an ARN joins against the tag index and matches nothing, which
 * reads exactly like an untagged table.
 *
 * `ListTables` is per-REGION. A registry table that exists in another region is
 * not in this listing, and `RegistryProtection`'s `missing` arm says so naming
 * the region rather than implying the table was deleted.
 *
 * ## Which table is the registry
 *
 * `process.env.TENANT_TABLE`, which is the same variable `lib/registry.ts` reads
 * and the same one `infrastructure/studio/ecs.tf` sets. It is read here rather
 * than imported from `registry.ts` because that module imports `server-only` and
 * constructs an SDK client at module scope, which would make this file — and
 * every test of it — unloadable outside a server component. `read.ts` keeps
 * `client.ts` behind a dynamic import for the same reason. The coupling is a
 * variable name in two files and is stated here so it is not a surprise; the
 * name is overridable through `options.registryTableName` so a test can drive
 * the ranking without setting process state.
 *
 * When `TENANT_TABLE` is unset the answer is `unnamed`, not "the registry is
 * fine". An engine that does not know which table is its registry cannot report
 * on its protection, and saying so is the honest reading.
 */

import { CAPABILITIES } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  describeRead,
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import { attributionOf, tagIndex, taggedResources, type TaggedResource } from "./tags"
import { READ_ATTEMPTS, backoffMs } from "./throttle"

/* ---------------------------------------------------------------- limits -- */

/**
 * How many `ListTables` pages to walk. `client.ts` sends `Limit: 100`, so this
 * is two thousand tables before the listing declares itself truncated.
 */
export const MAX_LIST_PAGES = 20

/**
 * How many tables get the three-describe treatment in one load.
 *
 * Three calls per table against a control-plane throttle that is shared with
 * every `terraform apply` in the account. The estate has one table; the cap
 * exists so an account that has grown four hundred does not turn one page render
 * into twelve hundred API calls.
 *
 * Tables past the cap are NOT dropped and do NOT render as unprotected: every
 * one of their four readings is UNCONFIGURED, whose `why` says the engine
 * stopped. The registry table is always inside the budget regardless of where it
 * sorts, because the one fact this module exists to rank first must not depend
 * on the alphabet.
 */
export const MAX_TABLE_DETAIL_READS = 100

/** How many distinct KMS keys are described in one load. Deduped by ARN first. */
export const MAX_KEY_DESCRIBE_READS = 20

/** How many tables are described concurrently. Bounded so one load is not a burst. */
const DETAIL_CONCURRENCY = 4

/* ------------------------------------------------------- the API's shapes -- */

/** Declared rather than imported from the SDK — see `client.ts`'s one-owner rule. */
interface ListTablesResponse {
  TableNames?: string[]
  LastEvaluatedTableName?: string
}

interface ProvisionedThroughputShape {
  ReadCapacityUnits?: number
  WriteCapacityUnits?: number
}

interface KeySchemaElement {
  AttributeName?: string
  KeyType?: string
}

interface GlobalSecondaryIndexShape {
  IndexName?: string
  IndexStatus?: string
  Backfilling?: boolean
  ItemCount?: number
  IndexSizeBytes?: number
  KeySchema?: KeySchemaElement[]
  Projection?: { ProjectionType?: string; NonKeyAttributes?: string[] }
  ProvisionedThroughput?: ProvisionedThroughputShape
}

interface DescribeTableResponse {
  Table?: {
    TableName?: string
    TableArn?: string
    TableStatus?: string
    CreationDateTime?: string | number | Date
    ItemCount?: number
    TableSizeBytes?: number
    DeletionProtectionEnabled?: boolean
    BillingModeSummary?: { BillingMode?: string }
    ProvisionedThroughput?: ProvisionedThroughputShape
    SSEDescription?: {
      Status?: string
      SSEType?: string
      KMSMasterKeyArn?: string
      InaccessibleEncryptionDateTime?: string | number | Date
    }
    KeySchema?: KeySchemaElement[]
    GlobalSecondaryIndexes?: GlobalSecondaryIndexShape[]
  }
}

interface DescribeContinuousBackupsResponse {
  ContinuousBackupsDescription?: {
    ContinuousBackupsStatus?: string
    PointInTimeRecoveryDescription?: {
      PointInTimeRecoveryStatus?: string
      EarliestRestorableDateTime?: string | number | Date
      LatestRestorableDateTime?: string | number | Date
      RecoveryPeriodInDays?: number
    }
  }
}

interface DescribeTimeToLiveResponse {
  TimeToLiveDescription?: {
    TimeToLiveStatus?: string
    AttributeName?: string
  }
}

interface DescribeKeyResponse {
  KeyMetadata?: {
    Arn?: string
    KeyId?: string
    KeyManager?: string
    KeyState?: string
    DeletionDate?: string | number | Date
  }
}

/* ----------------------------------------------------------- the readings -- */

/**
 * How a table is billed.
 *
 * `unstated` is separate from `provisioned` because DynamoDB omits
 * `BillingModeSummary` for tables created before the mode existed, which ARE
 * provisioned — so an inferred provisioned reading carries `stated: false` and
 * says where the inference came from, rather than being reported as a choice
 * somebody made. Neither readable at all is `unstated`, which is not a mode.
 */
export type BillingMode =
  | { kind: "on-demand" }
  | {
      kind: "provisioned"
      readCapacityUnits: number
      writeCapacityUnits: number
      /** False when AWS returned no `BillingModeSummary` and this was inferred. */
      stated: boolean
    }
  | { kind: "unstated"; why: string }

/**
 * What is encrypting the table at rest.
 *
 * DynamoDB always encrypts. The question is with WHOSE key, and the four answers
 * have four different consequences:
 *
 * - `aws-owned-default` — no key in this account. Nothing to put a key policy
 *   on, nothing to revoke, no CloudTrail entry when it is used, and no way to
 *   make the data cryptographically unreadable. AWS returns no `SSEDescription`
 *   at all for this, which is why its absence is a fact and not a gap.
 * - `kms` — a key in this account. Whether it is yours or `alias/aws/dynamodb`
 *   is `KeyManager`, which needs the fifth call; see `TableReading.keyManagement`.
 * - `inaccessible` — the key is gone or the grant is revoked. The table cannot
 *   be read at all. This is an incident, not a posture finding.
 * - `unstated` — `SSEDescription` was present and said something this engine
 *   does not recognise. Not a default.
 */
export type TableEncryption =
  | { kind: "aws-owned-default"; why: string }
  | { kind: "kms"; keyArn: string; status: string }
  | { kind: "inaccessible"; keyArn: string | null; since: string | null; why: string }
  | { kind: "unstated"; status: string | null; why: string }

/** Whether `DeleteTable` is refused. `unstated` is not `disabled`. */
export type DeletionProtection =
  | { kind: "enabled" }
  | { kind: "disabled" }
  | { kind: "unstated"; why: string }

/**
 * Item count and stored bytes, with their own staleness attached.
 *
 * DynamoDB refreshes these approximately every six hours. Rendered beside a live
 * `asOf` with nothing said, a six-hour-old number reads as a live one; a fleet
 * that grew by forty tenants this afternoon would show yesterday's count on a
 * page stamped with this minute.
 */
export interface TableSize {
  itemCount: number
  sizeBytes: number
  freshness: string
}

/** One global secondary index, with the fact that decides whether it can be trusted. */
export interface SecondaryIndex {
  name: string
  status: string
  /**
   * Still backfilling: the index does not yet answer for every item in the
   * table. Null when AWS did not say — which is not `false`, because `false`
   * means "this index is complete" and that is the claim a query relies on.
   */
  backfilling: boolean | null
  itemCount: number | null
  sizeBytes: number | null
  /** `ALL`, `KEYS_ONLY` or `INCLUDE(a, b)`. What a query off this index can return. */
  projection: string
  /** `pk (HASH)`, `sk (RANGE)` — the index's own key, in AWS's own words. */
  keySchema: readonly string[]
  provisioned: { readCapacityUnits: number; writeCapacityUnits: number } | null
}

/** What one `DescribeTable` answered. */
export interface TableDetail {
  /** AWS's own `TableArn`, not one this engine assembled. */
  arn: string
  status: string
  createdAt: string | null
  billing: BillingMode
  size: TableSize
  encryption: TableEncryption
  deletionProtection: DeletionProtection
  keySchema: readonly string[]
  indexes: readonly SecondaryIndex[]
}

/**
 * Point-in-time recovery.
 *
 * `disabled` is a finding; `unstated` is an admission. They are separate arms
 * because a table whose `PointInTimeRecoveryDescription` AWS did not return must
 * not be reported as unrecoverable, and a table AWS said is DISABLED must not be
 * softened into "unknown".
 */
export type PointInTimeRecovery =
  | {
      kind: "enabled"
      earliestRestorableAt: string | null
      latestRestorableAt: string | null
      recoveryPeriodInDays: number | null
    }
  | { kind: "disabled"; continuousBackupsStatus: string | null; why: string }
  | { kind: "unstated"; why: string }

/**
 * The TTL attribute, which is a process that deletes rows.
 *
 * On a data table that is housekeeping. On the tenant registry it is the fleet's
 * own record of itself being deleted on a timer, which is why
 * `RegistryProtection` names it.
 */
export type TimeToLive =
  | { kind: "enabled"; attributeName: string; status: string }
  | { kind: "disabled"; status: string }
  | { kind: "unstated"; why: string }

/** Whose key it is. `KeyManager` is AWS's own word, never inferred from the ARN. */
export interface KeyManagement {
  keyArn: string
  /** `CUSTOMER` — yours, with a policy you control. `AWS` — `alias/aws/dynamodb`. */
  manager: "CUSTOMER" | "AWS" | "UNRECOGNISED"
  keyState: string
  /** Set when the key is scheduled for deletion: the table is unreadable after this. */
  pendingDeletionAt: string | null
}

/**
 * Which tenant a table belongs to.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express: the
 * tag index is its own AWS read and it can be denied, throttled or broken. A
 * table whose tags were never read must not render as "unattributable — missing
 * tenure:tenant", because that sentence sends an operator to add a tag that is
 * probably already there.
 */
export type TableAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

/** One table, with four readings that fail independently of each other. */
export interface TableReading {
  name: string
  arn: string | null
  /** Where the ARN came from, or why there is none. Never silent. */
  arnProvenance: string
  region: string | null
  partition: string | null
  accountId: string | null
  /** True for the table `TENANT_TABLE` names. Ranked first by `dynamodbLines`. */
  isTenantRegistry: boolean
  attribution: TableAttribution
  detail: AwsRead<TableDetail>
  backups: AwsRead<PointInTimeRecovery>
  ttl: AwsRead<TimeToLive>
  /**
   * UNCONFIGURED when there is no key in this account to describe — the table
   * uses the AWS-owned default, or its detail was not readable so no key ARN is
   * known. Never silently absent.
   */
  keyManagement: AwsRead<KeyManagement>
  refreshMs: number
  asOf: string
}

/**
 * Whether the listing walked the whole estate.
 *
 * `truncated` exists so a bounded reader is not a quiet one. `unknown` is the
 * answer when the listing itself could not be read — "we do not know whether
 * there were more" is not "there were no more".
 */
export type MoreTables =
  | { kind: "complete" }
  | {
      kind: "truncated"
      pagesRead: number
      namesRead: number
      /** `ExclusiveStartTableName` for the page this engine did not fetch. */
      resumeAfter: string
      why: string
    }
  | { kind: "unknown"; why: string }

/**
 * The state of the fleet's own record of itself.
 *
 * Ranked first, and it is a union rather than a boolean so that every way of not
 * knowing has somewhere to go that is not "protected". `no-point-in-time-recovery`
 * is its own arm because losing PITR on this table is losing the ability to say
 * which systems were provisioned and who approved them.
 */
export type RegistryProtection =
  /** `TENANT_TABLE` is unset: this engine does not know which table is its registry. */
  | { kind: "unnamed"; why: string }
  /** Named, and something between here and AWS stopped the answer arriving. */
  | { kind: "unknown"; tableName: string; why: string }
  /** Named, the listing succeeded, and no such table is in this region. */
  | { kind: "missing"; tableName: string; region: string | null; why: string }
  /** AWS said PITR is off. Total loss of the fleet's own record of itself. */
  | {
      kind: "no-point-in-time-recovery"
      tableName: string
      why: string
      /** Everything else worth saying about it, so one finding is not the whole row. */
      alsoNoted: readonly string[]
    }
  /** AWS said PITR is on. `weaknesses` keeps "recoverable" from meaning "fine". */
  | {
      kind: "protected"
      tableName: string
      earliestRestorableAt: string | null
      latestRestorableAt: string | null
      recoveryPeriodInDays: number | null
      weaknesses: readonly string[]
    }

/** Everything a DynamoDB surface needs, in one load. */
export interface DynamoDbReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The tables. DENIED here is a refused `dynamodb:ListTables` and is NEVER `[]`
   * — an operator reading "no tables" when the truth is "we were not allowed to
   * look" is the single most dangerous thing this surface can say.
   */
  tables: AwsRead<readonly TableReading[]>
  /** Whether the listing above is the whole estate. Explicit, never implied. */
  more: MoreTables
  /** Computed first, rendered first. */
  registry: RegistryProtection
  /** The table name `TENANT_TABLE` holds, or null. Carried so a surface need not re-read env. */
  registryTableName: string | null
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: {
    tables: number
    detail: number
    backups: number
    ttl: number
    keyManagement: number
  }
}

/* --------------------------------------------------------------- parsing -- */

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

/**
 * An AWS timestamp as ISO, whatever the SDK handed over.
 *
 * The v3 clients deserialise these to `Date`; a fixture, a JSON transport or a
 * future protocol change hands over a string or epoch seconds. Returning null
 * for anything unparseable is deliberate — an invalid date rendered as
 * "Invalid Date" is noise, and rendered as `new Date(0)` is 1970.
 */
export function isoOf(value: string | number | Date | undefined | null): string | null {
  if (value === undefined || value === null) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === "number") {
    // DynamoDB's `CreationDateTime` is epoch SECONDS on the wire. Read as
    // milliseconds, a table created in 2024 renders as created in 1970.
    const date = new Date(value * 1000)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * A count AWS must have returned.
 *
 * Throws rather than defaulting to zero, and the throw happens inside `readAws`,
 * so the table's detail becomes ERROR with the reason. Zero is a claim — "this
 * table holds nothing" — and on the tenant registry it is the claim that would
 * let somebody believe the fleet is empty.
 */
function requiredCount(value: unknown, field: string, tableName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `dynamodb:DescribeTable answered for ${tableName} without a usable ${field} ` +
        `(${JSON.stringify(value)}). A count this engine did not read must not render as zero.`,
    )
  }
  return value
}

/** `pk (HASH)`, `sk (RANGE)` — AWS's own words, in AWS's own order. */
export function keySchemaOf(schema: KeySchemaElement[] | undefined): readonly string[] {
  return (schema ?? [])
    .filter((element) => typeof element?.AttributeName === "string" && element.AttributeName)
    .map((element) => `${element.AttributeName} (${element.KeyType ?? "unstated"})`)
}

export function parseBillingMode(table: NonNullable<DescribeTableResponse["Table"]>): BillingMode {
  const declared = table.BillingModeSummary?.BillingMode
  const throughput = table.ProvisionedThroughput
  const read = throughput?.ReadCapacityUnits
  const write = throughput?.WriteCapacityUnits

  if (declared === "PAY_PER_REQUEST") return { kind: "on-demand" }
  if (declared === "PROVISIONED") {
    if (typeof read === "number" && typeof write === "number") {
      return { kind: "provisioned", readCapacityUnits: read, writeCapacityUnits: write, stated: true }
    }
    return {
      kind: "unstated",
      why:
        "dynamodb:DescribeTable said PROVISIONED and returned no ProvisionedThroughput, so the " +
        "capacity this table is billed for is not something this engine read.",
    }
  }
  if (declared !== undefined) {
    return {
      kind: "unstated",
      why: `dynamodb:DescribeTable returned an unrecognised BillingMode ${JSON.stringify(declared)}.`,
    }
  }
  // No BillingModeSummary. DynamoDB omits it for tables created before the mode
  // existed, which are provisioned — an inference, marked as one.
  if (typeof read === "number" && typeof write === "number" && (read > 0 || write > 0)) {
    return { kind: "provisioned", readCapacityUnits: read, writeCapacityUnits: write, stated: false }
  }
  return {
    kind: "unstated",
    why:
      "dynamodb:DescribeTable returned no BillingModeSummary and no non-zero " +
      "ProvisionedThroughput, so this engine cannot say how this table is billed.",
  }
}

export function parseEncryption(
  sse: NonNullable<DescribeTableResponse["Table"]>["SSEDescription"],
): TableEncryption {
  if (!sse) {
    return {
      kind: "aws-owned-default",
      why:
        "dynamodb:DescribeTable returned no SSEDescription, which is how DynamoDB reports its " +
        "AWS-OWNED default key. The data is encrypted, and there is no key in this account: " +
        "nothing to put a key policy on, nothing to revoke, and no CloudTrail entry when it is used.",
    }
  }
  const status = typeof sse.Status === "string" ? sse.Status : null
  const keyArn = typeof sse.KMSMasterKeyArn === "string" && sse.KMSMasterKeyArn ? sse.KMSMasterKeyArn : null

  if (status === "INACCESSIBLE_ENCRYPTION_CREDENTIALS") {
    return {
      kind: "inaccessible",
      keyArn,
      since: isoOf(sse.InaccessibleEncryptionDateTime),
      why:
        "the KMS key encrypting this table is unreachable — deleted, disabled, or its grant " +
        "revoked. The table cannot be read at all until the key is restored. This is an incident.",
    }
  }
  if ((status === "ENABLED" || status === "ENABLING" || status === "UPDATING") && keyArn) {
    return { kind: "kms", keyArn, status }
  }
  return {
    kind: "unstated",
    status,
    why:
      `dynamodb:DescribeTable returned an SSEDescription this engine cannot read as a key ` +
      `(status ${JSON.stringify(status)}, key ARN ${keyArn ? "present" : "absent"}). ` +
      `Not treated as the AWS-owned default, because AWS reports that by returning nothing at all.`,
  }
}

export function parseDeletionProtection(value: boolean | undefined): DeletionProtection {
  if (value === true) return { kind: "enabled" }
  if (value === false) return { kind: "disabled" }
  return {
    kind: "unstated",
    why:
      "dynamodb:DescribeTable returned no DeletionProtectionEnabled. Absent is not false — " +
      "reporting a field AWS did not return as a finding is a fabricated finding.",
  }
}

export function parseIndexes(
  indexes: GlobalSecondaryIndexShape[] | undefined,
): readonly SecondaryIndex[] {
  return (indexes ?? [])
    .filter((index) => typeof index?.IndexName === "string" && index.IndexName)
    .map((index) => {
      const projectionType = index.Projection?.ProjectionType ?? "unstated"
      const nonKey = index.Projection?.NonKeyAttributes ?? []
      const throughput = index.ProvisionedThroughput
      return {
        name: index.IndexName as string,
        status: index.IndexStatus ?? "unstated",
        backfilling: typeof index.Backfilling === "boolean" ? index.Backfilling : null,
        itemCount: typeof index.ItemCount === "number" ? index.ItemCount : null,
        sizeBytes: typeof index.IndexSizeBytes === "number" ? index.IndexSizeBytes : null,
        projection:
          projectionType === "INCLUDE" && nonKey.length > 0
            ? `INCLUDE(${[...nonKey].sort().join(", ")})`
            : projectionType,
        keySchema: keySchemaOf(index.KeySchema),
        provisioned:
          typeof throughput?.ReadCapacityUnits === "number" &&
          typeof throughput?.WriteCapacityUnits === "number"
            ? {
                readCapacityUnits: throughput.ReadCapacityUnits,
                writeCapacityUnits: throughput.WriteCapacityUnits,
              }
            : null,
      }
    })
    // Sorted so two loads of the same table render in the same order. DynamoDB
    // does not promise one, and an order that changes between renders makes a
    // diff of two screenshots unreadable.
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

export function parsePointInTimeRecovery(
  description: DescribeContinuousBackupsResponse["ContinuousBackupsDescription"],
): PointInTimeRecovery {
  if (!description) {
    return {
      kind: "unstated",
      why:
        "dynamodb:DescribeContinuousBackups answered with no ContinuousBackupsDescription. " +
        "Whether this table is recoverable is unknown — which is not the same as its being " +
        "unrecoverable, and not the same as its being safe.",
    }
  }
  const pitr = description.PointInTimeRecoveryDescription
  const status = pitr?.PointInTimeRecoveryStatus
  if (status === "ENABLED") {
    return {
      kind: "enabled",
      earliestRestorableAt: isoOf(pitr?.EarliestRestorableDateTime),
      latestRestorableAt: isoOf(pitr?.LatestRestorableDateTime),
      recoveryPeriodInDays:
        typeof pitr?.RecoveryPeriodInDays === "number" ? pitr.RecoveryPeriodInDays : null,
    }
  }
  if (status === "DISABLED") {
    return {
      kind: "disabled",
      continuousBackupsStatus: description.ContinuousBackupsStatus ?? null,
      why:
        "point-in-time recovery is OFF. Nothing here can be restored to a moment before a bad " +
        "write, a bad migration or a bad script — the only recovery is whatever on-demand backup " +
        "somebody happened to take.",
    }
  }
  return {
    kind: "unstated",
    why:
      `dynamodb:DescribeContinuousBackups returned PointInTimeRecoveryStatus ` +
      `${JSON.stringify(status ?? null)}, which this engine does not read as on or off.`,
  }
}

export function parseTimeToLive(
  description: DescribeTimeToLiveResponse["TimeToLiveDescription"],
): TimeToLive {
  const status = description?.TimeToLiveStatus
  if (status === "ENABLED" || status === "ENABLING") {
    const attributeName = description?.AttributeName
    if (typeof attributeName === "string" && attributeName) {
      return { kind: "enabled", attributeName, status }
    }
    return {
      kind: "unstated",
      why:
        `dynamodb:DescribeTimeToLive said ${status} and named no attribute, so this engine ` +
        `cannot say which attribute is deleting rows.`,
    }
  }
  if (status === "DISABLED" || status === "DISABLING") return { kind: "disabled", status }
  return {
    kind: "unstated",
    why:
      `dynamodb:DescribeTimeToLive returned TimeToLiveStatus ${JSON.stringify(status ?? null)}, ` +
      `which this engine does not read as on or off. Nothing is claimed about row expiry.`,
  }
}

/* --------------------------------------------------------------- reading -- */

interface TableListing {
  names: readonly string[]
  more: MoreTables
}

async function listTables(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<TableListing>> {
  return readAws<TableListing>(
    "dynamodb:ListTables",
    async () => {
      const names: string[] = []
      let token: string | undefined
      let pagesRead = 0
      while (pagesRead < MAX_LIST_PAGES) {
        const response = (await gw.call("dynamodb:ListTables", {
          ExclusiveStartTableName: token,
        })) as ListTablesResponse
        pagesRead += 1
        for (const name of response?.TableNames ?? []) {
          if (typeof name === "string" && name) names.push(name)
        }
        token = response?.LastEvaluatedTableName || undefined
        if (!token) break
      }
      // Sorted and deduplicated so two loads of the same estate produce the same
      // order. `ListTables` sorts within a page and promises nothing across them.
      const sorted = [...new Set(names)].sort()
      if (token) {
        return {
          names: sorted,
          more: {
            kind: "truncated",
            pagesRead,
            namesRead: sorted.length,
            resumeAfter: token,
            why:
              `dynamodb:ListTables still had pages after ${MAX_LIST_PAGES}. These ${sorted.length} ` +
              `table(s) are the ones this engine walked, NOT the estate — resume after ` +
              `${token} to see the rest.`,
          },
        }
      }
      return { names: sorted, more: { kind: "complete" } }
    },
    {
      now: options.now,
      denial: options.denial,
      // A truncated listing is never EMPTY even with no names on the pages read:
      // "we stopped looking" is not "there is nothing".
      isEmpty: (value) => {
        const listing = value as TableListing
        return listing.names.length === 0 && listing.more.kind === "complete"
      },
      ...RETRY,
    },
  )
}

async function readTableDetail(
  gw: AwsGateway,
  name: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<TableDetail>> {
  return readAws<TableDetail>(
    "dynamodb:DescribeTable",
    async () => {
      const response = (await gw.call("dynamodb:DescribeTable", {
        TableName: name,
      })) as DescribeTableResponse
      const table = response?.Table
      if (!table) {
        throw new Error(
          `dynamodb:DescribeTable answered for ${name} with no Table. Nothing about this table ` +
            `can be stated from that.`,
        )
      }
      const arn = table.TableArn
      if (typeof arn !== "string" || !arn) {
        throw new Error(
          `dynamodb:DescribeTable answered for ${name} without a TableArn. The table cannot be ` +
            `attributed or placed in a region from this.`,
        )
      }
      return {
        arn,
        status: table.TableStatus ?? "unstated",
        createdAt: isoOf(table.CreationDateTime),
        billing: parseBillingMode(table),
        size: {
          itemCount: requiredCount(table.ItemCount, "ItemCount", name),
          sizeBytes: requiredCount(table.TableSizeBytes, "TableSizeBytes", name),
          freshness:
            "DynamoDB refreshes ItemCount and TableSizeBytes approximately every six hours, so " +
            "these are up to six hours behind the as-of stamp beside them",
        },
        encryption: parseEncryption(table.SSEDescription),
        deletionProtection: parseDeletionProtection(table.DeletionProtectionEnabled),
        keySchema: keySchemaOf(table.KeySchema),
        indexes: parseIndexes(table.GlobalSecondaryIndexes),
      }
    },
    {
      now: options.now,
      denial: options.denial,
      // A table's description is never meaningfully "empty": an answer with
      // nothing in it is a fault, and it throws above.
      isEmpty: () => false,
      ...RETRY,
    },
  )
}

async function readBackups(
  gw: AwsGateway,
  name: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<PointInTimeRecovery>> {
  return readAws<PointInTimeRecovery>(
    "dynamodb:DescribeContinuousBackups",
    async () => {
      const response = (await gw.call("dynamodb:DescribeContinuousBackups", {
        TableName: name,
      })) as DescribeContinuousBackupsResponse
      return parsePointInTimeRecovery(response?.ContinuousBackupsDescription)
    },
    { now: options.now, denial: options.denial, isEmpty: () => false, ...RETRY },
  )
}

async function readTimeToLive(
  gw: AwsGateway,
  name: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<TimeToLive>> {
  return readAws<TimeToLive>(
    "dynamodb:DescribeTimeToLive",
    async () => {
      const response = (await gw.call("dynamodb:DescribeTimeToLive", {
        TableName: name,
      })) as DescribeTimeToLiveResponse
      return parseTimeToLive(response?.TimeToLiveDescription)
    },
    { now: options.now, denial: options.denial, isEmpty: () => false, ...RETRY },
  )
}

async function readKeyManagement(
  gw: AwsGateway,
  keyArn: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<KeyManagement>> {
  return readAws<KeyManagement>(
    "kms:DescribeKey",
    async () => {
      const response = (await gw.call("kms:DescribeKey", { KeyId: keyArn })) as DescribeKeyResponse
      const metadata = response?.KeyMetadata
      if (!metadata) {
        throw new Error(
          `kms:DescribeKey answered for ${keyArn} with no KeyMetadata, so whether this key is ` +
            `customer-managed cannot be stated.`,
        )
      }
      const declared = metadata.KeyManager
      const manager: KeyManagement["manager"] =
        declared === "CUSTOMER" ? "CUSTOMER" : declared === "AWS" ? "AWS" : "UNRECOGNISED"
      return {
        keyArn: metadata.Arn ?? keyArn,
        manager,
        keyState: metadata.KeyState ?? "unstated",
        pendingDeletionAt: isoOf(metadata.DeletionDate),
      }
    },
    { now: options.now, denial: options.denial, isEmpty: () => false, ...RETRY },
  )
}

/* ----------------------------------------------------------- attribution -- */

/** Attribution from the tag index, with `unknown` when the index was not readable. */
function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): TableAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this table's tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "this table has no ARN this engine can state, so it cannot be joined against the tag " +
        "index. Unattributed would be a claim about its tags; this is a claim about ours.",
    }
  }
  const tags = index.get(arn)
  if (tags === undefined) {
    // The tag index answered and this ARN is not in it. That IS an observation:
    // the Resource Groups Tagging API returns resources that have tags, so an
    // absence means no tags at all, which is what `unattributed` says.
    return { kind: "unattributed" }
  }
  const decided = attributionOf(tags)
  switch (decided.kind) {
    case "tenant":
      return { kind: "tenant", tenantSlug: decided.tenantSlug }
    case "shared":
      return { kind: "shared" }
    case "unattributed":
      return { kind: "unattributed" }
  }
}

/**
 * A table's ARN, assembled from the resolved identity.
 *
 * Only used when `DescribeTable` could not be read — when it can, AWS's own
 * `TableArn` is used instead. The partition and region come from `identity`,
 * never from a literal. Returns null when identity is unresolved, because half
 * an ARN joins against the tag index and matches nothing, which reads exactly
 * like an untagged table.
 */
export function deriveTableArn(name: string, identity: AwsRead<Identity>): string | null {
  if (identity.state !== "ACTUAL" && identity.state !== "STALE") return null
  if (!name) return null
  return `arn:${identity.value.partition}:dynamodb:${identity.value.region}:${identity.value.accountId}:table/${name}`
}

/* --------------------------------------------------------- the registry -- */

/**
 * Which table is the tenant registry.
 *
 * `TENANT_TABLE` — the variable `lib/registry.ts` reads and `ecs.tf` sets. Read
 * here rather than imported because `registry.ts` imports `server-only` and
 * builds an SDK client at module scope; see the module header.
 */
export function registryTableNameFromEnv(): string | null {
  const value = process.env.TENANT_TABLE
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/**
 * The state of the fleet's own record of itself.
 *
 * Exported and pure so the derivation can be reasoned about on its own — but
 * `tableReadings` is the only production caller and the tests drive it through
 * there, not through here.
 */
export function registryProtection(
  tables: AwsRead<readonly TableReading[]>,
  registryTableName: string | null,
  region: string | null,
): RegistryProtection {
  if (!registryTableName) {
    return {
      kind: "unnamed",
      why:
        "TENANT_TABLE is not set, so this engine does not know which of these tables is its own " +
        "registry and cannot report on its protection. An engine that cannot name its registry " +
        "is a different problem from a registry that is unprotected.",
    }
  }
  if (tables.state !== "ACTUAL" && tables.state !== "STALE") {
    return {
      kind: "unknown",
      tableName: registryTableName,
      why: describeRead(tables, "the DynamoDB table listing"),
    }
  }
  const table = tables.value.find((candidate) => candidate.name === registryTableName)
  if (!table) {
    return {
      kind: "missing",
      tableName: registryTableName,
      region,
      why:
        `dynamodb:ListTables answered and ${registryTableName} is not among the tables in ` +
        `${region ?? "the region this engine resolved"}. dynamodb:ListTables is per-region, so ` +
        `this is "not here", which is either a registry in another region or a registry that is gone.`,
    }
  }

  const backups = table.backups
  if (backups.state !== "ACTUAL" && backups.state !== "STALE") {
    return {
      kind: "unknown",
      tableName: registryTableName,
      why: `${describeRead(backups, `${registryTableName} point-in-time recovery`)} — unknown, not off, and not on.`,
    }
  }
  if (backups.value.kind === "unstated") {
    return { kind: "unknown", tableName: registryTableName, why: backups.value.why }
  }

  // Everything else worth saying, gathered once so both outcomes carry it. Each
  // entry is a fact AWS stated; nothing here is inferred from an absent field.
  const notes: string[] = []
  if (table.detail.state === "ACTUAL" || table.detail.state === "STALE") {
    const deletion = table.detail.value.deletionProtection
    if (deletion.kind === "disabled") {
      notes.push(
        "deletion protection is OFF — a single DeleteTable, by anybody holding it, removes the registry",
      )
    }
    if (deletion.kind === "unstated") {
      notes.push("deletion protection was not stated by AWS, so whether DeleteTable is refused is unknown")
    }
    const encryption = table.detail.value.encryption
    if (encryption.kind === "aws-owned-default") {
      notes.push(
        "encrypted with DynamoDB's AWS-owned default key — there is no key in this account to " +
          "put a policy on, to revoke, or to see used in CloudTrail",
      )
    }
    if (encryption.kind === "inaccessible") {
      notes.push(`the encryption key is unreachable — ${encryption.why}`)
    }
  } else {
    notes.push(
      `its configuration was not read — ${describeRead(table.detail, `${registryTableName} configuration`)}`,
    )
  }
  if (table.ttl.state === "ACTUAL" || table.ttl.state === "STALE") {
    if (table.ttl.value.kind === "enabled") {
      notes.push(
        `a TTL on ${table.ttl.value.attributeName} is deleting rows from the registry on a timer`,
      )
    }
  } else {
    notes.push(`whether a TTL is expiring registry rows was not read — ${describeRead(table.ttl, "TTL")}`)
  }
  if (table.keyManagement.state === "ACTUAL" || table.keyManagement.state === "STALE") {
    if (table.keyManagement.value.pendingDeletionAt) {
      notes.push(
        `the KMS key encrypting it is scheduled for deletion on ${table.keyManagement.value.pendingDeletionAt}, ` +
          `after which the registry is unreadable`,
      )
    }
  }

  if (backups.value.kind === "disabled") {
    return {
      kind: "no-point-in-time-recovery",
      tableName: registryTableName,
      why:
        `point-in-time recovery is OFF on ${registryTableName}, the tenant registry. This table ` +
        `is the fleet's own record of itself — which systems were provisioned, what state each ` +
        `is in, and who approved it. Without PITR a bad write, a bad migration or a bad script ` +
        `is unrecoverable and the record is gone.`,
      alsoNoted: notes,
    }
  }
  return {
    kind: "protected",
    tableName: registryTableName,
    earliestRestorableAt: backups.value.earliestRestorableAt,
    latestRestorableAt: backups.value.latestRestorableAt,
    recoveryPeriodInDays: backups.value.recoveryPeriodInDays,
    weaknesses: notes,
  }
}

/* ----------------------------------------------------------- the surface -- */

/** Every reading a table gets when the engine ran out of budget before reaching it. */
function skipped<T>(
  capability:
    | "dynamodb:DescribeTable"
    | "dynamodb:DescribeContinuousBackups"
    | "dynamodb:DescribeTimeToLive",
  name: string,
  position: number,
  total: number,
): AwsRead<T> {
  return {
    state: "UNCONFIGURED",
    capability,
    why:
      `this engine describes at most ${MAX_TABLE_DETAIL_READS} tables per load and ${name} is ` +
      `number ${position + 1} of ${total}. It was not read — which is not the same as its being ` +
      `unprotected, and not the same as its being safe.`,
  }
}

/**
 * Every DynamoDB table in this region, its configuration, its backups, its TTL
 * and its tenant — with the registry's protection ranked first.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function tableReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date; registryTableName?: string | null } = {},
): Promise<DynamoDbReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())
  const registryName =
    options.registryTableName !== undefined ? options.registryTableName : registryTableNameFromEnv()

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [])

  const listed = await listTables(gw, { now, denial })
  const asOf = now().toISOString()
  const refreshMs = {
    tables: CAPABILITIES["dynamodb:ListTables"].refreshMs,
    detail: CAPABILITIES["dynamodb:DescribeTable"].refreshMs,
    backups: CAPABILITIES["dynamodb:DescribeContinuousBackups"].refreshMs,
    ttl: CAPABILITIES["dynamodb:DescribeTimeToLive"].refreshMs,
    keyManagement: CAPABILITIES["kms:DescribeKey"].refreshMs,
  }
  const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"
  const resolvedRegion = identityResolved ? identity.value.region : null

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. In
  // particular there is no branch here that turns any of them into an array.
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // No cast: the arms left after this narrowing are precisely the ones with no
    // `value` field, so they are already an `AwsRead<TableReading[]>`. A cast
    // here would be the place a future empty array could be smuggled in.
    const tables: AwsRead<readonly TableReading[]> = listed
    const more: MoreTables =
      listed.state === "EMPTY"
        ? { kind: "complete" }
        : { kind: "unknown", why: describeRead(listed, "the DynamoDB table listing") }
    return {
      identity,
      tagged,
      tables,
      more,
      registry: registryProtection(tables, registryName, resolvedRegion),
      registryTableName: registryName,
      asOf,
      refreshMs,
    }
  }

  const names = listed.value.names

  // Which tables get described. The registry goes in first regardless of where
  // it sorts: the one fact this module ranks first must not depend on the
  // alphabet, and a registry at position 140 of 400 would otherwise be reported
  // as "not read" on the panel whose entire job is to report on it.
  const budget = new Set<string>()
  if (registryName && names.includes(registryName)) budget.add(registryName)
  for (const name of names) {
    if (budget.size >= MAX_TABLE_DETAIL_READS) break
    budget.add(name)
  }

  const details = new Map<string, AwsRead<TableDetail>>()
  const backups = new Map<string, AwsRead<PointInTimeRecovery>>()
  const ttls = new Map<string, AwsRead<TimeToLive>>()

  for (let start = 0; start < names.length; start += DETAIL_CONCURRENCY) {
    const batch = names.slice(start, start + DETAIL_CONCURRENCY)
    await Promise.all(
      batch.map(async (name, offset) => {
        const position = start + offset
        if (!budget.has(name)) {
          details.set(name, skipped("dynamodb:DescribeTable", name, position, names.length))
          backups.set(
            name,
            skipped("dynamodb:DescribeContinuousBackups", name, position, names.length),
          )
          ttls.set(name, skipped("dynamodb:DescribeTimeToLive", name, position, names.length))
          return
        }
        // Three independent reads. `Promise.all` is not `Promise.allSettled` on
        // purpose: none of these three rejects — `readAws` turns every failure
        // into a state — so a denial on one leaves the other two untouched.
        const [detail, backup, ttl] = await Promise.all([
          readTableDetail(gw, name, { now, denial }),
          readBackups(gw, name, { now, denial }),
          readTimeToLive(gw, name, { now, denial }),
        ])
        details.set(name, detail)
        backups.set(name, backup)
        ttls.set(name, ttl)
      }),
    )
  }

  // One `DescribeKey` per DISTINCT key, not per table: several tables routinely
  // share `alias/aws/dynamodb`, and asking the same question once per table is
  // how a forty-table estate spends forty calls learning one fact.
  const keyArns: string[] = []
  for (const name of names) {
    const detail = details.get(name)
    if (!detail || (detail.state !== "ACTUAL" && detail.state !== "STALE")) continue
    const encryption = detail.value.encryption
    const arn =
      encryption.kind === "kms"
        ? encryption.keyArn
        : encryption.kind === "inaccessible"
          ? encryption.keyArn
          : null
    if (arn && !keyArns.includes(arn)) keyArns.push(arn)
  }
  const keyReads = new Map<string, AwsRead<KeyManagement>>()
  for (const arn of keyArns.slice(0, MAX_KEY_DESCRIBE_READS).sort()) {
    keyReads.set(arn, await readKeyManagement(gw, arn, { now, denial }))
  }
  for (const arn of keyArns.slice(MAX_KEY_DESCRIBE_READS)) {
    keyReads.set(arn, {
      state: "UNCONFIGURED",
      capability: "kms:DescribeKey",
      why:
        `this engine describes at most ${MAX_KEY_DESCRIBE_READS} distinct KMS keys per load and ` +
        `this estate uses more. Whether ${arn} is customer-managed was not read.`,
    })
  }

  const readings: TableReading[] = names.map((name) => {
    const detail = details.get(name) ?? {
      state: "UNCONFIGURED" as const,
      capability: "dynamodb:DescribeTable" as const,
      why: "this table was listed and never described. That is a fault in this engine, not a fact about the table.",
    }
    const fromAws = detail.state === "ACTUAL" || detail.state === "STALE" ? detail.value.arn : null
    const derived = fromAws ? null : deriveTableArn(name, identity)
    const arn = fromAws ?? derived
    const arnProvenance = fromAws
      ? "AWS's own TableArn"
      : derived
        ? "assembled from the resolved identity's partition, region and account — the table's " +
          "own description was not readable"
        : "none — the table's description was not readable and identity is unresolved, so this " +
          "engine will not assemble an ARN it cannot stand behind"

    const parts = arn ? arn.split(":") : []
    const keyArn =
      detail.state === "ACTUAL" || detail.state === "STALE"
        ? detail.value.encryption.kind === "kms"
          ? detail.value.encryption.keyArn
          : detail.value.encryption.kind === "inaccessible"
            ? detail.value.encryption.keyArn
            : null
        : null

    const keyManagement: AwsRead<KeyManagement> =
      keyArn && keyReads.has(keyArn)
        ? (keyReads.get(keyArn) as AwsRead<KeyManagement>)
        : {
            state: "UNCONFIGURED",
            capability: "kms:DescribeKey",
            why:
              detail.state === "ACTUAL" || detail.state === "STALE"
                ? "this table names no KMS key in this account — DynamoDB reports its AWS-owned " +
                  "default key by returning no SSEDescription at all, and there is nothing to describe."
                : `this table's encryption was not read, so no key was named to describe — ` +
                  `${describeRead(detail, `${name} configuration`)}`,
          }

    return {
      name,
      arn,
      arnProvenance,
      // From the ARN when there is one — AWS's answer beats anything assembled —
      // and otherwise from the resolved identity. Never from a literal.
      partition: parts.length >= 6 ? parts[1] : identityResolved ? identity.value.partition : null,
      region: parts.length >= 6 ? parts[3] : identityResolved ? identity.value.region : null,
      accountId: parts.length >= 6 ? parts[4] : identityResolved ? identity.value.accountId : null,
      isTenantRegistry: registryName !== null && name === registryName,
      attribution: attributionFor(arn, tagged, index),
      detail,
      backups: backups.get(name) ?? {
        state: "UNCONFIGURED",
        capability: "dynamodb:DescribeContinuousBackups",
        why: "this table was listed and its backups were never read. Unknown, not off.",
      },
      ttl: ttls.get(name) ?? {
        state: "UNCONFIGURED",
        capability: "dynamodb:DescribeTimeToLive",
        why: "this table was listed and its TTL was never read. Unknown, not off.",
      },
      keyManagement,
      refreshMs: refreshMs.detail,
      asOf,
    }
  })

  const tables: AwsRead<readonly TableReading[]> =
    listed.state === "ACTUAL"
      ? { state: "ACTUAL", capability: listed.capability, value: readings, asOf: listed.asOf, fresh: listed.fresh }
      : { state: "STALE", capability: listed.capability, value: readings, asOf: listed.asOf, ageMs: listed.ageMs }

  return {
    identity,
    tagged,
    tables,
    more: listed.value.more,
    registry: registryProtection(tables, registryName, resolvedRegion),
    registryTableName: registryName,
    asOf,
    refreshMs,
  }
}

/* ------------------------------------------------------------- rendering -- */

export function describeBilling(billing: BillingMode): string {
  switch (billing.kind) {
    case "on-demand":
      return "on-demand (PAY_PER_REQUEST) — no provisioned capacity to exhaust"
    case "provisioned":
      return (
        `provisioned — ${billing.readCapacityUnits} RCU / ${billing.writeCapacityUnits} WCU` +
        `${billing.stated ? "" : " (inferred: AWS returned no BillingModeSummary)"}`
      )
    case "unstated":
      return `billing mode unknown — ${billing.why}`
  }
}

/**
 * The sentence a surface prints for a table's encryption.
 *
 * The key-management reading is folded in here rather than rendered separately,
 * because "encrypted with a KMS key" and "encrypted with a key AWS manages on
 * your behalf" are read as the same sentence unless they are printed as one.
 */
export function describeEncryption(
  encryption: TableEncryption,
  keyManagement: AwsRead<KeyManagement>,
): string {
  switch (encryption.kind) {
    case "aws-owned-default":
      return `AWS-owned default key — ${encryption.why}`
    case "inaccessible":
      return `ENCRYPTION KEY UNREACHABLE — ${encryption.why}`
    case "unstated":
      return `encryption unknown — ${encryption.why}`
    case "kms": {
      if (keyManagement.state === "ACTUAL" || keyManagement.state === "STALE") {
        const managed =
          keyManagement.value.manager === "CUSTOMER"
            ? "a CUSTOMER-MANAGED key"
            : keyManagement.value.manager === "AWS"
              ? "an AWS-managed key (alias/aws/dynamodb) — not the AWS-owned default, and not yours to set a policy on"
              : `a key whose KeyManager AWS returned as something this engine does not recognise`
        const deletion = keyManagement.value.pendingDeletionAt
          ? `, SCHEDULED FOR DELETION on ${keyManagement.value.pendingDeletionAt}`
          : ""
        return `${encryption.keyArn} — ${managed}, state ${keyManagement.value.keyState}${deletion}`
      }
      return (
        `${encryption.keyArn} — whether it is customer-managed is unknown: ` +
        `${describeRead(keyManagement, "kms:DescribeKey")}`
      )
    }
  }
}

export function describeDeletionProtection(protection: DeletionProtection): string {
  switch (protection.kind) {
    case "enabled":
      return "deletion protection ON"
    case "disabled":
      return "deletion protection OFF — one DeleteTable removes this table"
    case "unstated":
      return `deletion protection unknown — ${protection.why}`
  }
}

export function describePointInTimeRecovery(pitr: PointInTimeRecovery): string {
  switch (pitr.kind) {
    case "enabled":
      return (
        `point-in-time recovery ON` +
        `${pitr.recoveryPeriodInDays !== null ? `, ${pitr.recoveryPeriodInDays}-day window` : ""}` +
        `${pitr.earliestRestorableAt ? `, restorable from ${pitr.earliestRestorableAt}` : ""}` +
        `${pitr.latestRestorableAt ? ` to ${pitr.latestRestorableAt}` : ""}`
      )
    case "disabled":
      return `point-in-time recovery OFF — ${pitr.why}`
    case "unstated":
      return `point-in-time recovery unknown — ${pitr.why}`
  }
}

export function describeTimeToLive(ttl: TimeToLive): string {
  switch (ttl.kind) {
    case "enabled":
      return `TTL ${ttl.status} on ${ttl.attributeName} — rows are deleted when that attribute expires`
    case "disabled":
      return `TTL ${ttl.status} — nothing here expires on a timer`
    case "unstated":
      return `TTL unknown — ${ttl.why}`
  }
}

/** The sentence a surface prints for one table's attribution. */
export function describeTableAttribution(attribution: TableAttribution): string {
  switch (attribution.kind) {
    case "tenant":
      return attribution.tenantSlug
    case "shared":
      return "shared — platform overhead, decided"
    case "unattributed":
      return "unattributable — missing tenure:tenant"
    case "unknown":
      return `attribution unknown — ${attribution.why}`
  }
}

/** The sentence a surface prints for a table's global secondary indexes. */
export function describeIndexes(indexes: readonly SecondaryIndex[]): string {
  if (indexes.length === 0) return "no global secondary index"
  return indexes
    .map((index) => {
      const backfill =
        index.backfilling === true
          ? ", BACKFILLING — it does not yet answer for every item"
          : index.backfilling === null
            ? ", backfill state not stated by AWS"
            : ""
      const size =
        index.itemCount !== null
          ? `, ${index.itemCount} item(s)`
          : ", item count not stated by AWS"
      const capacity = index.provisioned
        ? `, ${index.provisioned.readCapacityUnits} RCU / ${index.provisioned.writeCapacityUnits} WCU`
        : ""
      return `${index.name} [${index.keySchema.join(", ")}] ${index.status}, projection ${index.projection}${size}${capacity}${backfill}`
    })
    .join("; ")
}

/** The sentence a surface prints for the fleet's own record of itself. */
export function describeRegistryProtection(registry: RegistryProtection): string {
  switch (registry.kind) {
    case "unnamed":
      return `registry unknown — ${registry.why}`
    case "unknown":
      return `registry ${registry.tableName} — unknown: ${registry.why}`
    case "missing":
      return `registry ${registry.tableName} NOT FOUND — ${registry.why}`
    case "no-point-in-time-recovery": {
      const also =
        registry.alsoNoted.length > 0 ? ` Also: ${registry.alsoNoted.join("; ")}.` : ""
      return `REGISTRY UNRECOVERABLE — ${registry.why}${also}`
    }
    case "protected": {
      const window =
        registry.recoveryPeriodInDays !== null
          ? `${registry.recoveryPeriodInDays}-day window`
          : "window not stated by AWS"
      const range =
        registry.earliestRestorableAt && registry.latestRestorableAt
          ? `, restorable from ${registry.earliestRestorableAt} to ${registry.latestRestorableAt}`
          : ""
      const weak =
        registry.weaknesses.length > 0
          ? ` Not otherwise clean: ${registry.weaknesses.join("; ")}.`
          : ""
      return `registry ${registry.tableName} is recoverable — point-in-time recovery ON, ${window}${range}.${weak}`
    }
  }
}

/** The sentence a surface prints for whether the listing was the whole estate. */
export function describeMore(more: MoreTables): string {
  switch (more.kind) {
    case "complete":
      return "the listing walked to completion — these are every table in this region"
    case "truncated":
      return `TRUNCATED — ${more.why}`
    case "unknown":
      return `whether there are more tables is unknown — ${more.why}`
  }
}

/** The sentence a surface prints for one table. One funnel, so states cannot drift. */
export function describeTable(table: TableReading): string {
  const where =
    table.region && table.partition
      ? `${table.region} (partition ${table.partition})`
      : "region unknown — identity is unresolved"
  const registryMark = table.isTenantRegistry ? " [TENANT REGISTRY]" : ""
  const head = `${table.name}${registryMark} — ${where} — ${describeTableAttribution(table.attribution)}`

  const parts: string[] = [head]

  if (table.detail.state === "ACTUAL" || table.detail.state === "STALE") {
    const d = table.detail.value
    parts.push(
      `${d.status}, key [${d.keySchema.join(", ")}] · ${describeBilling(d.billing)} · ` +
        `${d.size.itemCount} item(s), ${d.size.sizeBytes} byte(s) (${d.size.freshness}) · ` +
        `${describeEncryption(d.encryption, table.keyManagement)} · ` +
        `${describeDeletionProtection(d.deletionProtection)} · ${describeIndexes(d.indexes)}`,
    )
  } else {
    // Every other state goes through the one renderer, so a refused description
    // reads as a refusal here exactly as it does everywhere else — never as
    // "0 items" and never as an absent row.
    parts.push(describeRead(table.detail, `${table.name} configuration`))
  }

  parts.push(
    table.backups.state === "ACTUAL" || table.backups.state === "STALE"
      ? describePointInTimeRecovery(table.backups.value)
      : describeRead(table.backups, `${table.name} point-in-time recovery`),
  )
  parts.push(
    table.ttl.state === "ACTUAL" || table.ttl.state === "STALE"
      ? describeTimeToLive(table.ttl.value)
      : describeRead(table.ttl, `${table.name} TTL`),
  )
  parts.push(`as of ${table.asOf}, refreshed every ${Math.round(table.refreshMs / 1000)}s`)
  return parts.join(" · ")
}

export interface DynamoDbLine {
  label: string
  text: string
}

/**
 * What a DynamoDB surface prints.
 *
 * The registry line is FIRST, before the listing and before any table, because
 * PITR being off on the tenant registry is total loss of the fleet's own record
 * of itself and a finding that renders below forty rows of table configuration
 * is a finding nobody reads.
 *
 * A route agent renders exactly these strings. The tests assert on them, which
 * is what makes the mutation proofs land on the production path rather than on a
 * helper nothing calls.
 */
export function dynamodbLines(readings: DynamoDbReadings): readonly DynamoDbLine[] {
  const lines: DynamoDbLine[] = [
    { label: "Tenant registry", text: describeRegistryProtection(readings.registry) },
    {
      label: "Tables",
      text: describeRead(
        readings.tables,
        `tables read from AWS, refreshed every ${Math.round(readings.refreshMs.tables / 1000)}s`,
      ),
    },
    { label: "Completeness", text: describeMore(readings.more) },
  ]
  if (readings.tables.state === "ACTUAL" || readings.tables.state === "STALE") {
    // The registry first here too, so the table an operator came for is not
    // somewhere in the middle of an alphabetical list.
    const ordered = [...readings.tables.value].sort((a, b) => {
      if (a.isTenantRegistry !== b.isTenantRegistry) return a.isTenantRegistry ? -1 : 1
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    })
    for (const table of ordered) {
      lines.push({ label: table.name, text: describeTable(table) })
    }
  }
  return lines
}
