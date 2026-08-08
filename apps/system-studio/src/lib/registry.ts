import "server-only"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"

import {
  advance,
  digestOf,
  type AdvanceOptions,
  type DeploymentManifest,
  type LifecycleStep,
  type StepEvidence,
  type TenantManifest,
  type TenantRegistryRecord,
  type TenantState,
} from "@tenure/provisioning"

/**
 * The tenant registry.
 *
 * One DynamoDB table, keyed so that every access pattern the console has is a
 * single request:
 *
 *   pk = TENANT#<slug>   sk = MANIFEST                 the composed system
 *   pk = TENANT#<slug>   sk = STATE                    where it is now
 *   pk = TENANT#<slug>   sk = STEP#<iso>#<attempt>     how it got there
 *
 * A tenant page is one Query on the partition and returns all three. The fleet
 * is one Scan filtered to STATE rows — bounded by the table being a registry of
 * systems, not a data table.
 *
 * `server-only` is imported at the top on purpose: this module holds the AWS
 * client, and importing it from a client component would be a build error
 * rather than a bundle that ships credentials-adjacent code to a browser.
 */

const TABLE = process.env.TENANT_TABLE

/**
 * Built once per container. The SDK keeps HTTP connections warm between calls,
 * so a per-request client would add a TLS handshake to every page load.
 */
let cached: DynamoDBDocumentClient | null = null

function client(): DynamoDBDocumentClient {
  if (!TABLE) {
    // Fail with the reason rather than an SDK error about an undefined table.
    throw new RegistryUnavailable(
      "TENANT_TABLE is not set. The registry is provisioned by infrastructure/studio/dynamodb.tf; " +
        "locally, set TENANT_TABLE and AWS credentials, or use the read-only views.",
    )
  }
  if (!cached) {
    cached = DynamoDBDocumentClient.from(
      // The endpoint is read here rather than left to the SDK's own resolution
      // of AWS_ENDPOINT_URL_DYNAMODB. CI showed that resolution is not reliable
      // across SDK/runtime combinations — a request meant for a local container
      // reached the real regional service instead — and "which account did that
      // write land in" is not a question to leave to a version.
      //
      // `undefined` in production, which is exactly the default behaviour.
      new DynamoDBClient({ endpoint: process.env.AWS_ENDPOINT_URL_DYNAMODB || undefined }),
      { marshallOptions: { removeUndefinedValues: true } },
    )
  }
  return cached
}

export class RegistryUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RegistryUnavailable"
  }
}

export class SlugTaken extends Error {
  constructor(readonly slug: string) {
    super(`"${slug}" is already registered.`)
    this.name = "SlugTaken"
  }
}

export interface TenantRecord {
  slug: string
  /**
   * STUDIO-070-005 — the AWS request ids of the calls that produced this record.
   *
   * Required, not optional. It is what lets a step's evidence name the reads it
   * ran against, so a reading an operator disputes can be found in CloudTrail
   * rather than taken on the console's word. `[]` is a legal value and means
   * the record was assembled without an AWS call — which is true of one built
   * in memory and false of one read from the table, and the difference has to
   * be stated rather than inferred from an absent field.
   */
  awsRequestIds: readonly string[]
  manifest: TenantManifest
  state: TenantState
  digest: string
  createdAt: string
  updatedAt: string
  history: LifecycleStep[]
  /** What each step actually produced, keyed by the state it ran for. */
  evidence: StepEvidence[]
  /** The signed artifact a cell reconciles toward, once CONFIGURING has run. */
  deployment?: DeploymentManifest
  /**
   * GE-030-001. What is TRUE about the tenant — immutable id, lifecycle,
   * placement, residency, release, config revision — as opposed to the
   * manifest, which is what was asked for.
   *
   * Optional because tenants registered before this existed do not have one,
   * and a console that 500ed on them would be a console nobody could use to
   * fix them.
   */
  registry?: TenantRegistryRecord
}

const pk = (slug: string) => `TENANT#${slug}`

/**
 * A stored STEP# row's evidence, widened to the current `StepEvidence`.
 *
 * STUDIO-060-010 added three REQUIRED fields — `inputDigest`, `correlationId`
 * and `attempt`. Every row written before that has none of them, and the cast
 * this function replaced (`i.evidence as StepEvidence`) said otherwise: the
 * objects satisfied the compiler while three of their fields were `undefined` at
 * runtime, so `evidence.attempt.toFixed()` or a `correlationId` used as a lookup
 * key would have failed on exactly the historical rows nobody tests against.
 *
 * A cast is a claim. This is the check.
 *
 * Old rows are named as unattributable rather than given plausible defaults —
 * `attempt: 1` on a row that might have been the third try is a confident wrong
 * answer, and the whole point of the widening is that an unattributable step is
 * visible as one.
 */
export const EVIDENCE_PREDATES_ATTRIBUTION = "pre-STUDIO-060-010:unattributed"

function evidenceFrom(raw: Record<string, unknown>): StepEvidence {
  const attempt = typeof raw.attempt === "number" ? raw.attempt : 0
  return {
    step: String(raw.step ?? "unknown"),
    state: raw.state as TenantState,
    ok: raw.ok === true,
    inputDigest:
      typeof raw.inputDigest === "string" ? raw.inputDigest : EVIDENCE_PREDATES_ATTRIBUTION,
    correlationId:
      typeof raw.correlationId === "string" ? raw.correlationId : EVIDENCE_PREDATES_ATTRIBUTION,
    // 0 rather than 1: a real attempt is 1-based, so zero cannot be mistaken
    // for a first try that was actually recorded.
    attempt,
    detail: String(raw.detail ?? ""),
    ...(typeof raw.digest === "string" ? { digest: raw.digest } : {}),
    ...(Array.isArray(raw.checks)
      ? { checks: raw.checks as StepEvidence["checks"] }
      : {}),
    ...(typeof raw.safeError === "string" ? { safeError: raw.safeError } : {}),
    ...(typeof raw.approvalRef === "string" ? { approvalRef: raw.approvalRef } : {}),

    /* --------------------------------------------------- STUDIO-070-005 --
     * The execution provenance, widened the same way and for the same reason.
     *
     * Every one of these is REQUIRED on `StepEvidence`, so a historical row has
     * to be given a value here — and the value chosen matters. `awsRequestIds:
     * []` on an old row would read as "this step made no AWS call", which is a
     * claim nobody can support; the sentinel says the row predates the field
     * instead. Confidently wrong beats absent only if you never have to explain
     * a step to somebody.
     */
    awsRequestIds: Array.isArray(raw.awsRequestIds)
      ? (raw.awsRequestIds as string[])
      : [EVIDENCE_PREDATES_ATTRIBUTION],
    outputDigest:
      typeof raw.outputDigest === "string"
        ? raw.outputDigest
        : typeof raw.digest === "string"
          ? // An old row's `digest` IS what the step produced, so it is the
            // honest output digest — this is a rename, not an invention.
            raw.digest
          : EVIDENCE_PREDATES_ATTRIBUTION,
    assumedRoleArn: typeof raw.assumedRoleArn === "string" ? raw.assumedRoleArn : null,
    resourceHandles: Array.isArray(raw.resourceHandles)
      ? (raw.resourceHandles as string[])
      : [],
    nextRetryAt: typeof raw.nextRetryAt === "string" ? raw.nextRetryAt : null,
    compensation:
      raw.compensation && typeof raw.compensation === "object"
        ? (raw.compensation as StepEvidence["compensation"])
        : null,
  }
}

/**
 * The configured table name, or undefined.
 *
 * Exported so the configuration-store adapter (GE-032-001) writes to the same
 * table without duplicating the client setup above — that setup carries a
 * deliberate endpoint decision, and a second copy would drift from it.
 */
export function tableName(): string | undefined {
  return TABLE
}

/**
 * Query the items under one tenant's partition whose sort key has a prefix.
 *
 * Exists so the configuration store (GE-032-001) never constructs a DynamoDB
 * client of its own. `forbidden-clients` refuses that with no exemptions, and
 * it is right to: a client built at a second call site picks its own region and
 * credential chain, and cannot be given encryption, retry or audit behaviour
 * later. This module owns the client; callers get the operations.
 */
export interface TenantItemPage {
  items: Array<Record<string, unknown>>
  /**
   * Where DynamoDB stopped, or null when the query is exhausted.
   *
   * STUDIO-130-002. This used to be dropped on the floor: the function took a
   * `limit` and returned only the items, so the ONE paginated read the Studio
   * had could not be continued — a caller that asked for ten of forty revisions
   * had no way to ask for the next ten, and no way to know there were any. A
   * limit without a cursor is not pagination, it is truncation.
   *
   * Returned as the raw DynamoDB key rather than a token, because this is the
   * database layer. `encodeCursor` in `src/lib/api/envelope.ts` is what makes it
   * opaque before it crosses an HTTP boundary; a caller inside the process is
   * already trusted with the table.
   */
  lastEvaluatedKey: Record<string, unknown> | null
}

export async function queryTenantItems(
  slug: string,
  sortKeyPrefix: string,
  options: {
    newestFirst?: boolean
    limit?: number
    exclusiveStartKey?: Record<string, unknown> | null
  } = {},
): Promise<TenantItemPage> {
  const result = await client().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": pk(slug), ":prefix": sortKeyPrefix },
      ScanIndexForward: !options.newestFirst,
      ...(options.limit ? { Limit: options.limit } : {}),
      ...(options.exclusiveStartKey ? { ExclusiveStartKey: options.exclusiveStartKey } : {}),
    }),
  )
  return {
    items: (result.Items ?? []) as Array<Record<string, unknown>>,
    lastEvaluatedKey: (result.LastEvaluatedKey as Record<string, unknown> | undefined) ?? null,
  }
}

/**
 * Write one item into a tenant's partition, refusing to overwrite.
 *
 * The condition is the database's, not this process's: two publishers racing on
 * the same revision both read the same latest, and only one can win a
 * conditional put.
 */
export async function putTenantItemIfAbsent(item: Record<string, unknown>): Promise<void> {
  await client().send(
    new PutCommand({
      TableName: TABLE,
      Item: item,
      ConditionExpression: "attribute_not_exists(pk)",
    }),
  )
}

/** Whether the registry is reachable at all, for pages that degrade rather than 500. */
export function registryConfigured(): boolean {
  return !!TABLE
}

/**
 * One row of the fleet table — every operational fact the registry holds about
 * a tenant, without reading anything inside it.
 *
 * STUDIO-100-001. The predecessor of this shape returned five fields and the
 * fleet page could therefore render five columns. Eleven of the sixteen the
 * requirement names were missing from the QUERY, not from the markup, and the
 * one derived signal the page did show — health — was fed a hardcoded
 * `hasDeployment: true`, so `never-deployed` was unreachable from production
 * while the helper's own unit test passed on an input it built itself.
 *
 * `hasDeployment` here is READ, from the presence of the DEPLOYMENT sort key.
 * That is the whole point of widening the scan.
 */
export interface FleetRow {
  slug: string
  displayName: string
  state: TenantState
  createdAt: string
  updatedAt: string
  isolation: string
  /** Whether a signed deployment manifest exists. Read, never assumed. */
  hasDeployment: boolean
  /** Whether the published artifact routes traffic at this tenant. */
  serving: boolean
  /** The schema the published artifact pins, when one has been published. */
  schemaVersion: string | null
  /**
   * Who answers for the tenant.
   *
   * The successor named on the most recent lifecycle step that required one
   * (WRK-120-005) when there is one, and otherwise the registry's primary
   * contact. `ownerSource` says which, because "the operator who took the
   * tenant over" and "the customer's administrator" are different people and a
   * column that silently mixes them is a column nobody can act on.
   */
  owner: string | null
  ownerSource: "successor" | "primary-contact" | null
  lifecycle: string | null
  provenance: string | null
  planId: string | null
  cellId: string | null
  region: string | null
  release: string | null
  /** What the registry believes the cell has applied. */
  registryConfigRevision: number | null
  /** The newest revision the configuration store actually holds. */
  storeConfigRevision: number | null
}

/**
 * The whole fleet, in one pass over the table.
 *
 * The `#sk = :sk` filter is gone deliberately. A filtered Scan still reads every
 * row and then discards most of them, so restricting it to STATE bought nothing
 * in cost and cost the page every other fact about a tenant. Grouping by
 * partition instead means one request answers eleven columns that previously
 * had no source at all, and answers `hasDeployment` from the DEPLOYMENT row
 * rather than from a literal.
 *
 * Paginated to exhaustion. A Scan stops at 1 MB and returns a
 * `LastEvaluatedKey`; a fleet view that ignored it would silently drop tenants
 * as the table grew, which is the failure mode where a console reports a fleet
 * smaller than the fleet.
 */
export async function listFleet(): Promise<FleetRow[]> {
  // Every projected name is aliased, not just the ones that look risky.
  // DynamoDB reserves several hundred words — `state` and `isolation` are both
  // on the list — and a projection naming one fails the whole request with a
  // validation error, which surfaces as a 500 on a page that renders fine
  // locally against no table. Aliasing everything removes the need to know
  // which words are reserved this year.
  const byPartition = new Map<string, Array<Record<string, unknown>>>()
  let start: Record<string, unknown> | undefined

  do {
    const out = await client().send(
      new ScanCommand({
        TableName: TABLE,
        ProjectionExpression:
          "#pk, #sk, #slug, #state, #displayName, #createdAt, #updatedAt, #isolation, " +
          "#registry, #step.#ownerPrincipalId, #deployment.#schemaVersion, #deployment.#serving",
        ExpressionAttributeNames: {
          "#pk": "pk",
          "#sk": "sk",
          "#slug": "slug",
          "#state": "state",
          "#displayName": "displayName",
          "#createdAt": "createdAt",
          "#updatedAt": "updatedAt",
          "#isolation": "isolation",
          "#registry": "registry",
          "#step": "step",
          "#ownerPrincipalId": "ownerPrincipalId",
          "#deployment": "deployment",
          "#schemaVersion": "schemaVersion",
          "#serving": "serving",
        },
        ...(start ? { ExclusiveStartKey: start } : {}),
      }),
    )

    for (const item of (out.Items ?? []) as Array<Record<string, unknown>>) {
      const partition = String(item.pk)
      const rows = byPartition.get(partition)
      if (rows) rows.push(item)
      else byPartition.set(partition, [item])
    }
    start = out.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (start)

  const fleet: FleetRow[] = []

  for (const items of byPartition.values()) {
    const state = items.find((i) => i.sk === "STATE")
    // A partition with no STATE row is not a tenant. Audit rows and idempotency
    // claims live in this table too, and a fleet listing that included them
    // would report rows an operator cannot open.
    if (!state) continue

    const deployment = items.find((i) => i.sk === "DEPLOYMENT")
    const registry = items.find((i) => i.sk === "REGISTRY")?.registry as
      | TenantRegistryRecord
      | undefined

    // The newest configuration revision the STORE holds, taken from the sort
    // key rather than from a second query per tenant. `CONFIG#00000012` is
    // zero-padded precisely so this comparison is a string comparison.
    const configKeys = items
      .map((i) => String(i.sk))
      .filter((sk) => sk.startsWith("CONFIG#"))
      .sort()
    const newestConfig = configKeys.at(-1)
    const storeConfigRevision = newestConfig ? Number(newestConfig.slice("CONFIG#".length)) : null

    // The successor owner from the most recent step that named one. Steps sort
    // by their ISO instant inside the sort key, so the last one wins.
    const successor = items
      .filter((i) => String(i.sk).startsWith("STEP#") && i.step)
      .sort((a, b) => String(a.sk).localeCompare(String(b.sk)))
      .map((i) => (i.step as { ownerPrincipalId?: string }).ownerPrincipalId)
      .filter((v): v is string => !!v)
      .at(-1)

    const owner = successor ?? registry?.primaryContactEmail ?? null

    fleet.push({
      slug: String(state.slug),
      displayName: String(state.displayName ?? state.slug),
      state: state.state as TenantState,
      createdAt: String(state.createdAt ?? ""),
      updatedAt: String(state.updatedAt ?? ""),
      isolation: String(state.isolation ?? ""),
      hasDeployment: deployment !== undefined,
      serving: (deployment?.deployment as { serving?: boolean } | undefined)?.serving === true,
      schemaVersion:
        (deployment?.deployment as { schemaVersion?: string } | undefined)?.schemaVersion ?? null,
      owner,
      ownerSource: owner === null ? null : successor ? "successor" : "primary-contact",
      lifecycle: registry?.lifecycle ?? null,
      provenance: registry?.provenance ?? null,
      planId: registry?.plan ?? null,
      cellId: registry?.placement?.cellId ?? null,
      region: registry?.placement?.region ?? null,
      release: registry?.release ?? null,
      registryConfigRevision: registry?.configRevision ?? null,
      storeConfigRevision,
    })
  }

  return fleet.sort((a, b) => a.slug.localeCompare(b.slug))
}

/** Slugs already claimed — the uniqueness input to manifest validation. */
export async function takenSlugs(): Promise<string[]> {
  return (await listFleet()).map((t) => t.slug)
}

/** One tenant, whole: manifest, state and every step, in a single query. */
export async function getTenant(slug: string): Promise<TenantRecord | null> {
  const out = await client().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": pk(slug) },
    }),
  )

  const items = (out.Items ?? []) as Array<Record<string, unknown>>
  const manifest = items.find((i) => i.sk === "MANIFEST")
  const state = items.find((i) => i.sk === "STATE")
  if (!manifest || !state) return null

  return {
    slug,
    // The read that produced everything below. One Query returns the manifest,
    // the state and every step, so one id covers the whole record.
    awsRequestIds: out.$metadata.requestId ? [out.$metadata.requestId] : [],
    manifest: manifest.manifest as TenantManifest,
    state: state.state as TenantState,
    digest: state.digest as string,
    createdAt: state.createdAt as string,
    updatedAt: state.updatedAt as string,
    history: items
      .filter((i) => String(i.sk).startsWith("STEP#"))
      .map((i) => i.step as LifecycleStep)
      .sort((a, b) => a.at.localeCompare(b.at)),
    evidence: items
      .filter((i) => String(i.sk).startsWith("STEP#") && i.evidence)
      .map((i) => evidenceFrom(i.evidence as Record<string, unknown>)),
    deployment: items.find((i) => i.sk === "DEPLOYMENT")?.deployment as DeploymentManifest | undefined,
    registry: items.find((i) => i.sk === "REGISTRY")?.registry as TenantRegistryRecord | undefined,
  }
}

/**
 * Register a composed tenant in DRAFT.
 *
 * The slug is claimed with a condition rather than a read-then-write: two
 * operators composing the same slug at the same moment would both see it free
 * and both write. `attribute_not_exists` makes the second one fail, which is
 * GE-102-003's reservation requirement expressed where the race actually is.
 */
export async function registerTenant(
  manifest: TenantManifest,
  actor: { principalId: string; at: string },
  registry?: TenantRegistryRecord,
): Promise<TenantRecord> {
  const digest = digestOf(manifest)
  const base = {
    pk: pk(manifest.slug),
    slug: manifest.slug,
    displayName: manifest.displayName,
    isolation: manifest.isolation,
  }

  try {
    await client().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE,
              Item: { ...base, sk: "MANIFEST", manifest, digest },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
          {
            // In the SAME transaction as the manifest. A tenant with a manifest
            // and no registry record is one the console can show and the fleet
            // cannot place — worse than one that failed to register at all.
            Put: {
              TableName: TABLE,
              Item: { ...base, sk: "REGISTRY", registry },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
          {
            Put: {
              TableName: TABLE,
              Item: {
                ...base,
                sk: "STATE",
                state: "DRAFT" satisfies TenantState,
                digest,
                createdAt: actor.at,
                updatedAt: actor.at,
              },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
        ],
      }),
    )
  } catch (err) {
    if ((err as { name?: string }).name === "TransactionCanceledException") {
      throw new SlugTaken(manifest.slug)
    }
    throw err
  }

  return {
    slug: manifest.slug,
    // The transaction that created it. One write, one id.
    awsRequestIds: [],
    manifest,
    state: "DRAFT",
    digest,
    createdAt: actor.at,
    updatedAt: actor.at,
    history: [],
    evidence: [],
    registry,
  }
}

/**
 * Bring a file-bound tenant under the registry.
 *
 * The same conditional write as `registerTenant`: the slug is claimed with
 * `attribute_not_exists`, so adopting twice — or adopting something that has
 * since been composed — fails rather than overwriting a record.
 *
 * The lifecycle STATE is written as ACTIVE with no step history. Not DRAFT,
 * because the tenant is serving real users right now; and no fabricated
 * intermediate steps, because nobody ran them. `registry.provenance` is what says how it got here.
 */
export async function adoptBoundTenant(
  manifest: TenantManifest,
  registry: TenantRegistryRecord,
  actor: { principalId: string; at: string },
): Promise<TenantRecord> {
  const digest = digestOf(manifest)
  const base = {
    pk: pk(manifest.slug),
    slug: manifest.slug,
    displayName: manifest.displayName,
    isolation: manifest.isolation,
  }

  try {
    await client().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE,
              Item: { ...base, sk: "MANIFEST", manifest, digest },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
          {
            Put: {
              TableName: TABLE,
              Item: { ...base, sk: "REGISTRY", registry },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
          {
            Put: {
              TableName: TABLE,
              Item: {
                ...base,
                sk: "STATE",
                state: "ACTIVE" satisfies TenantState,
                digest,
                createdAt: actor.at,
                updatedAt: actor.at,
              },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
          {
            // The adoption itself, as the only step there is. An operator
            // asking "how did this tenant get here" gets one honest answer
            // instead of a plausible-looking provisioning trail.
            //
            // Written as a nested `step` because that is the shape `getTenant`
            // reads back — a flat row made the tenant page throw on
            // `a.at.localeCompare`, which Next then rendered as a bare
            // "Application error" with a digest. A write that does not match
            // its reader is a write nobody notices until somebody opens the page.
            Put: {
              TableName: TABLE,
              Item: {
                ...base,
                sk: `STEP#${actor.at}#1`,
                step: {
                  // from === to: nothing transitioned. The tenant was already
                  // ACTIVE; the registry is what changed.
                  from: "ACTIVE" satisfies TenantState,
                  to: "ACTIVE" satisfies TenantState,
                  at: actor.at,
                  actor: actor.principalId,
                  reason:
                    "Adopted from the file binding in blueprints/. Predates the registry; no provisioning steps were run.",
                  attempt: 1,
                } satisfies LifecycleStep,
              },
            },
          },
        ],
      }),
    )
  } catch (err) {
    if ((err as { name?: string }).name === "TransactionCanceledException") {
      throw new SlugTaken(manifest.slug)
    }
    throw err
  }

  return {
    slug: manifest.slug,
    awsRequestIds: [],
    manifest,
    state: "ACTIVE",
    digest,
    createdAt: actor.at,
    updatedAt: actor.at,
    history: [
      {
        from: "ACTIVE",
        to: "ACTIVE",
        at: actor.at,
        actor: actor.principalId,
        reason:
          "Adopted from the file binding in blueprints/. Predates the registry; no provisioning steps were run.",
        attempt: 1,
      },
    ],
    evidence: [],
    registry,
  }
}

/**
 * Move a tenant to the next state, recording the step.
 *
 * The legality of the move is decided by `@tenure/provisioning`, not here, and
 * the write is conditional on the state not having changed underneath — so two
 * operators clicking the same button produce one transition and one refusal
 * rather than two steps that both claim to have happened.
 */
export async function advanceTenant(
  slug: string,
  to: TenantState,
  options: AdvanceOptions,
  /** What the step produced. Stored with the step so evidence cannot drift from it. */
  evidence?: StepEvidence,
  /** Written once, when CONFIGURING succeeds. */
  deployment?: DeploymentManifest,
): Promise<{ record: TenantRecord; awsRequestId: string | null }> {
  const current = await getTenant(slug)
  if (!current) throw new RegistryUnavailable(`No tenant "${slug}".`)

  const { state, step } = advance(current.state, to, options, current.history)

  const out = await client().send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: {
              pk: pk(slug),
              sk: "STATE",
              slug,
              displayName: current.manifest.displayName,
              isolation: current.manifest.isolation,
              state,
              digest: current.digest,
              createdAt: current.createdAt,
              updatedAt: options.actor.at,
            },
            // Optimistic concurrency. Without it the loser of a race silently
            // overwrites the winner and the history shows both.
            ConditionExpression: "#s = :expected",
            ExpressionAttributeNames: { "#s": "state" },
            ExpressionAttributeValues: { ":expected": current.state },
          },
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              pk: pk(slug),
              sk: `STEP#${options.actor.at}#${step.attempt}`,
              slug,
              step,
              ...(evidence ? { evidence } : {}),
            },
          },
        },
        ...(deployment
          ? [
              {
                Put: {
                  TableName: TABLE,
                  Item: { pk: pk(slug), sk: "DEPLOYMENT", slug, deployment },
                },
              },
            ]
          : []),
      ],
    }),
  )

  return {
    record: {
      ...current,
      state,
      updatedAt: options.actor.at,
      history: [...current.history, step],
      evidence: evidence ? [...current.evidence, evidence] : current.evidence,
      deployment: deployment ?? current.deployment,
    },
    // STUDIO-060-010. Returned rather than dropped, so the audit row that
    // records the outcome can name the AWS request that produced it. Without
    // it the row says "the transition was written" and nothing in CloudTrail
    // can be matched to it.
    awsRequestId: out.$metadata.requestId ?? null,
  }
}

/** A single item read, used by the detail page's freshness check. */
export async function currentState(slug: string): Promise<TenantState | null> {
  const out = await client().send(
    new GetCommand({ TableName: TABLE, Key: { pk: pk(slug), sk: "STATE" } }),
  )
  return (out.Item?.state as TenantState) ?? null
}

// ── Operations (STUDIO-130-005) ─────────────────────────────────────────────

/**
 * A long-running operation, as a resource rather than as the shape of a
 * request.
 *
 * Provisioning used to run entirely inside the browser's server-action request:
 * a DynamoDB Query, an outbound HTTP POST to a cell, and a TransactWrite, with
 * nothing persisted that was not the tenant's own STATE row. If the cell was
 * slow the browser held the connection for the whole step, and if it timed out
 * the outcome was UNKNOWABLE — there was no record of the attempt separate from
 * the thing it was attempting to change.
 *
 * This is that record. It is written BEFORE the work starts, so a request that
 * dies leaves a durable, queryable `RUNNING` row instead of silence.
 */
/**
 * Three states, not four.
 *
 * The brief names `RUNNING` as well, and it is deliberately absent: the
 * executor is still synchronous inside the handler, so nothing would ever write
 * it. An arm of a union no producer writes is a state an operator can read
 * about in the type and never see in the data, which is worse than not having
 * it. It goes in with the queue that would set it.
 */
export type OperationState = "ACCEPTED" | "SUCCEEDED" | "FAILED"

export interface TenantOperation {
  operationId: string
  slug: string
  state: OperationState
  /** The semantic command, in `Resource.Action` form. */
  commandType: string
  /** Where the tenant was asked to go. */
  target: string | null
  actor: string
  requestedAt: string
  completedAt: string | null
  idempotencyKey: string
  correlationId: string
  lastError: string | null
  /**
   * What the cost policy said when this command was admitted (STUDIO-120-010).
   *
   * Null when the command committed to no recurring spend. Stored on the
   * operation rather than recomputed for display, because the band an operator
   * was held to is a fact about the past — thresholds move, and a page that
   * re-derives the level would show a different one next quarter.
   */
  approval: { level: string; detail: string; amount: string } | null
}

const OPERATION_PREFIX = "OPERATION#"

/**
 * Write the operation before the work begins.
 *
 * Conditional, so an operation id can never be reused — the id is minted per
 * dispatch and a collision would overwrite the record of a different attempt.
 */
export async function putOperation(operation: TenantOperation): Promise<void> {
  await putTenantItemIfAbsent({
    pk: pk(operation.slug),
    sk: `${OPERATION_PREFIX}${operation.operationId}`,
    slug: operation.slug,
    operation,
  })
}

/**
 * Move an operation to its outcome.
 *
 * An update rather than a put: the row was written by `putOperation` and the
 * fields that identify it must not be re-supplied by a caller that could get
 * one of them wrong. `attribute_exists(pk)` refuses to invent an operation row
 * as a side effect of completing one.
 */
export async function completeOperation(
  slug: string,
  operationId: string,
  outcome: { state: OperationState; completedAt: string; lastError?: string | null },
): Promise<void> {
  await client().send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: pk(slug), sk: `${OPERATION_PREFIX}${operationId}` },
      UpdateExpression:
        "SET #op.#state = :state, #op.#completedAt = :completedAt, #op.#lastError = :lastError",
      ConditionExpression: "attribute_exists(pk)",
      ExpressionAttributeNames: {
        "#op": "operation",
        "#state": "state",
        "#completedAt": "completedAt",
        "#lastError": "lastError",
      },
      ExpressionAttributeValues: {
        ":state": outcome.state,
        ":completedAt": outcome.completedAt,
        ":lastError": outcome.lastError ?? null,
      },
    }),
  )
}

export async function getOperation(
  slug: string,
  operationId: string,
): Promise<TenantOperation | null> {
  const out = await client().send(
    new GetCommand({ TableName: TABLE, Key: { pk: pk(slug), sk: `${OPERATION_PREFIX}${operationId}` } }),
  )
  return (out.Item?.operation as TenantOperation | undefined) ?? null
}

/** A tenant's operations, newest first, with a cursor so a poller can continue. */
export async function listOperations(
  slug: string,
  options: { limit?: number; exclusiveStartKey?: Record<string, unknown> | null } = {},
): Promise<{ operations: TenantOperation[]; lastEvaluatedKey: Record<string, unknown> | null }> {
  const page = await queryTenantItems(slug, OPERATION_PREFIX, {
    newestFirst: true,
    limit: options.limit,
    exclusiveStartKey: options.exclusiveStartKey,
  })
  return {
    operations: page.items.map((i) => i.operation as TenantOperation),
    lastEvaluatedKey: page.lastEvaluatedKey,
  }
}

// ── Idempotency claims (STUDIO-060-002) ─────────────────────────────────────

/**
 * The claim a command writes before it acts, in the shape `@tenure/contracts`
 * already defines (`IdempotencyRecord`, contracts/src/index.ts:573).
 *
 * Stored in the tenant's own partition so the claim and the thing it protects
 * are in one place — and so that a claim is visible to anyone reading the
 * tenant, rather than living in a side table nobody thinks to look in.
 */
const IDEM_PREFIX = "IDEM#"

export interface StoredIdempotencyClaim {
  key: string
  tenantId: string
  requestDigest: string
  status: "in-flight" | "succeeded" | "failed"
  resultRef: string | null
  expiresAt: string
  /** The operation this claim produced, so a replay can return it. */
  operationId: string
}

/**
 * Claim a key, or report the claim that is already there.
 *
 * The conditional write is the whole mechanism: two identical submissions race,
 * both read no claim, and only one can win `attribute_not_exists`. A
 * read-then-write check in JavaScript loses that race, which is exactly the
 * double-submit this exists to stop.
 */
export async function claimIdempotency(
  slug: string,
  claim: StoredIdempotencyClaim,
): Promise<{ claimed: true } | { claimed: false; existing: StoredIdempotencyClaim }> {
  try {
    await putTenantItemIfAbsent({
      pk: pk(slug),
      sk: `${IDEM_PREFIX}${claim.key}`,
      slug,
      claim,
    })
    return { claimed: true }
  } catch (err) {
    if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err
    const existing = await readIdempotency(slug, claim.key)
    if (!existing) throw err
    return { claimed: false, existing }
  }
}

export async function readIdempotency(
  slug: string,
  key: string,
): Promise<StoredIdempotencyClaim | null> {
  const out = await client().send(
    new GetCommand({ TableName: TABLE, Key: { pk: pk(slug), sk: `${IDEM_PREFIX}${key}` } }),
  )
  return (out.Item?.claim as StoredIdempotencyClaim | undefined) ?? null
}

/** Record how the claimed work ended, so a replay returns a real outcome. */
export async function settleIdempotency(
  slug: string,
  key: string,
  status: "succeeded" | "failed",
  resultRef: string | null,
): Promise<void> {
  await client().send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: pk(slug), sk: `${IDEM_PREFIX}${key}` },
      UpdateExpression: "SET #c.#status = :status, #c.#resultRef = :resultRef",
      ConditionExpression: "attribute_exists(pk)",
      ExpressionAttributeNames: { "#c": "claim", "#status": "status", "#resultRef": "resultRef" },
      ExpressionAttributeValues: { ":status": status, ":resultRef": resultRef },
    }),
  )
}

/* ------------------------------------------------------- STUDIO-060-007 -- */

const COOLOFF_PREFIX = "COOLOFF#"

/** When a C7 change was first asked for, and by whom. */
export interface CoolingOffRecord {
  action: string
  requestedAt: string
  requestedBy: string
}

/**
 * Start — or read back — the cooling-off clock for one irreversible action.
 *
 * The write is conditional, and that is the entire mechanism. A caller cannot
 * move the clock: the FIRST request for `(tenant, action)` wins
 * `attribute_not_exists`, every later one loses the condition and gets the
 * stored record back. So "how long have you been waiting" is answered by the
 * database, not by a timestamp the requester supplies.
 *
 * That distinction is not pedantry. A cooling-off period checked against a
 * caller-supplied `requestedAt` is satisfied by sending `requestedAt` an hour
 * ago, which makes the control a formality with a UI.
 *
 * Returns the AUTHORITATIVE record either way, so the caller never has to know
 * whether it started the clock or joined one already running.
 */
export async function startCoolingOff(
  slug: string,
  action: string,
  requestedBy: string,
  at: string,
): Promise<CoolingOffRecord> {
  const record: CoolingOffRecord = { action, requestedAt: at, requestedBy }
  try {
    await putTenantItemIfAbsent({
      pk: pk(slug),
      sk: `${COOLOFF_PREFIX}${action}`,
      slug,
      coolingOff: record,
    })
    return record
  } catch (err) {
    if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err
    const existing = await readCoolingOff(slug, action)
    // Losing the condition means an item is there. If the read comes back empty
    // anyway, something deleted it between the two calls; rethrowing is right,
    // because returning `record` would hand the caller a clock starting now and
    // call it the original.
    if (!existing) throw err
    return existing
  }
}

export async function readCoolingOff(
  slug: string,
  action: string,
): Promise<CoolingOffRecord | null> {
  const out = await client().send(
    new GetCommand({ TableName: TABLE, Key: { pk: pk(slug), sk: `${COOLOFF_PREFIX}${action}` } }),
  )
  return (out.Item?.coolingOff as CoolingOffRecord | undefined) ?? null
}

/**
 * Clear a cooling-off clock.
 *
 * Exported for the mutation proof, which has to be able to run the same refusal
 * twice, and for an operator who abandons a purge and later starts a fresh one
 * — a clock that never resets would let a request made in March authorise a
 * deletion in September.
 */
export async function clearCoolingOff(slug: string, action: string): Promise<void> {
  const { DeleteCommand } = await import("@aws-sdk/lib-dynamodb")
  await client().send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: pk(slug), sk: `${COOLOFF_PREFIX}${action}` } }),
  )
}

/** Deletes a claim. Exported for the mutation proof, which must be able to unclaim. */
export async function __deleteIdempotency(slug: string, key: string): Promise<void> {
  const { DeleteCommand } = await import("@aws-sdk/lib-dynamodb")
  await client().send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: pk(slug), sk: `${IDEM_PREFIX}${key}` } }),
  )
}

// ── Audit (STUDIO-020-012) ──────────────────────────────────────────────────

/**
 * An operator-plane audit row, in the boundary shape `@tenure/contracts`
 * defines (`AuditEntry`, contracts/src/index.ts:804).
 *
 * Partitioned by UTC day rather than by tenant, because the question an audit
 * answers is "what did this console do", and an export that spans forty tenants
 * is one action, not forty. The sort key carries the instant and a nonce so two
 * actions in the same millisecond cannot overwrite each other.
 */
export async function putAuditEntry(entry: {
  actorId: string
  action: string
  resourceType: string
  resourceId: string | null
  outcome: "ALLOW" | "DENY"
  reason: string | null
  occurredAt: string
  correlationId: string
  /** Free-form, but never tenant CONTENT — this console cannot read any. */
  detail?: Readonly<Record<string, unknown>>
}): Promise<void> {
  const day = entry.occurredAt.slice(0, 10)
  await putTenantItemIfAbsent({
    pk: `AUDIT#${day}`,
    sk: `${entry.occurredAt}#${globalThis.crypto.randomUUID()}`,
    entry,
  })
}

/** Audit rows for one UTC day, newest first. Used by the export test and by operators. */
export async function auditForDay(day: string): Promise<Array<Record<string, unknown>>> {
  const out = await client().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": `AUDIT#${day}` },
      ScanIndexForward: false,
    }),
  )
  return ((out.Items ?? []) as Array<Record<string, unknown>>).map(
    (i) => i.entry as Record<string, unknown>,
  )
}

// ── The chained audit ledger's storage (STUDIO-110-005 / STUDIO-060-010) ────

/**
 * Where a chained audit row lives.
 *
 *   pk = AUDIT#<tenant slug | PLATFORM>   sk = SEQ#<12-digit sequence>
 *   pk = AUDIT#<tenant slug | PLATFORM>   sk = HOLD#<hold id>
 *
 * Partitioned by TENANT rather than by day, because the chain `@tenure/audit`
 * verifies is per-tenant: `verifyChain` groups by `tenantId`, sequence numbers
 * are per-tenant, and `applyRetention` cuts a prefix of one tenant's chain. A
 * day partition would scatter one chain across 365 partitions a year and make
 * "is this tenant's trail intact" a fan-out rather than a Query.
 *
 * The sequence is zero-padded to twelve digits so the sort key collates
 * numerically: unpadded, `SEQ#10` sorts before `SEQ#9`, the newest-first read
 * that finds the tail returns the wrong row, and every subsequent record chains
 * onto a predecessor that is not its predecessor. That is the same lesson the
 * configuration store's `CONFIG#00000012` key already carries.
 */
const AUDIT_SEQUENCE_DIGITS = 12
const auditPk = (partition: string) => `AUDIT#${partition}`

export const AUDIT_SEQUENCE_PREFIX = "SEQ#"
export const AUDIT_HOLD_PREFIX = "HOLD#"

export function auditSortKey(sequence: number): string {
  return `${AUDIT_SEQUENCE_PREFIX}${String(sequence).padStart(AUDIT_SEQUENCE_DIGITS, "0")}`
}

/** Two writers reached for the same position in a chain. One of them must lose. */
export class AuditSequenceTaken extends Error {
  constructor(
    readonly partition: string,
    readonly sequence: number,
  ) {
    super(`Sequence ${sequence} of the ${partition} audit chain is already written.`)
    this.name = "AuditSequenceTaken"
  }
}

/**
 * Append one row to a chain, refusing to overwrite the position.
 *
 * `attribute_not_exists(sk)` is what makes `previousHash` mean anything. Without
 * it two concurrent writers both read the same tail, both compute sequence n+1,
 * and the second silently replaces the first — the chain still verifies, and one
 * of the two acts has vanished from it. The condition is the DATABASE's, not
 * this process's: a read-then-write check in JavaScript loses exactly the race
 * it is there to catch.
 *
 * Returns the AWS request id, which is what ties this write to a line in
 * CloudTrail — "the console says it recorded this" becoming something checkable
 * against the account rather than against the console.
 */
export async function putAuditRow(
  partition: string,
  sequence: number,
  row: Record<string, unknown>,
): Promise<{ requestId: string | null }> {
  try {
    const out = await client().send(
      new PutCommand({
        TableName: TABLE,
        Item: { ...row, pk: auditPk(partition), sk: auditSortKey(sequence) },
        ConditionExpression: "attribute_not_exists(sk)",
      }),
    )
    return { requestId: out.$metadata.requestId ?? null }
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      throw new AuditSequenceTaken(partition, sequence)
    }
    throw err
  }
}

/**
 * Every row under one audit partition with a given sort-key prefix, oldest
 * first, paginated to exhaustion.
 *
 * Exhaustion matters here more than anywhere else in this module. A Query stops
 * at 1 MB; a verifier handed the first page only would report the chain as
 * starting at 0 and ending early, and `verifyChain`'s gap detection would be
 * reading a truncation as a deletion. A partial audit read is worse than none.
 */
export async function queryAuditRows(
  partition: string,
  sortKeyPrefix: string,
  options: { newestFirst?: boolean; limit?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = []
  let start: Record<string, unknown> | undefined

  do {
    const out = await client().send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": auditPk(partition), ":prefix": sortKeyPrefix },
        ScanIndexForward: !options.newestFirst,
        ...(options.limit ? { Limit: options.limit } : {}),
        ...(start ? { ExclusiveStartKey: start } : {}),
      }),
    )
    items.push(...((out.Items ?? []) as Array<Record<string, unknown>>))
    if (options.limit && items.length >= options.limit) return items.slice(0, options.limit)
    start = out.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (start)

  return items
}

/**
 * Place a preservation order over some slice of one partition's trail.
 *
 * Conditional, like everything else here: a hold id is how a hold is released,
 * and re-using one would release something nobody meant to release. Holds are
 * never updated in place — releasing writes a second row (`RELEASE#`) that the
 * reader folds in — because a hold record that can be rewritten is a hold record
 * that can be made to look as though it was never placed.
 */
export async function putAuditHold(
  partition: string,
  holdId: string,
  hold: Record<string, unknown>,
): Promise<void> {
  await client().send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: auditPk(partition), sk: `${AUDIT_HOLD_PREFIX}${holdId}`, partition, hold },
      ConditionExpression: "attribute_not_exists(sk)",
    }),
  )
}

export const AUDIT_HOLD_RELEASE_PREFIX = "HOLDRELEASE#"

/**
 * Lift a hold by writing a second, separate row.
 *
 * Not an UpdateItem on the placement row, and not because Update is
 * inconvenient: the Studio's IAM policy DENIES `dynamodb:UpdateItem` on every
 * item whose partition key begins `AUDIT#` (infrastructure/studio/dynamodb.tf).
 * A hold record that could be rewritten in place is one that can be made to look
 * as though it was never placed, which defeats the only thing a hold is for.
 */
export async function releaseAuditHold(
  partition: string,
  holdId: string,
  release: Record<string, unknown>,
): Promise<void> {
  await client().send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: auditPk(partition),
        sk: `${AUDIT_HOLD_RELEASE_PREFIX}${holdId}`,
        partition,
        release,
      },
      ConditionExpression: "attribute_not_exists(sk)",
    }),
  )
}

/** Exported for the seed path in tests; not used by the console. */
export const __internals = { PutCommand, pk }
