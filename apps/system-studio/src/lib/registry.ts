import "server-only"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
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

/** Whether the registry is reachable at all, for pages that degrade rather than 500. */
export function registryConfigured(): boolean {
  return !!TABLE
}

/**
 * Every tenant, with its current state.
 *
 * Reads only STATE rows, so the fleet view does not pull every manifest and
 * every step to render a table of names and states.
 */
export async function listTenants(): Promise<
  Array<{ slug: string; state: TenantState; displayName: string; updatedAt: string; isolation: string }>
> {
  // Every projected name is aliased, not just the ones that look risky.
  // DynamoDB reserves several hundred words — `state` and `isolation` are both
  // on the list — and a projection naming one fails the whole request with a
  // validation error, which surfaces as a 500 on a page that renders fine
  // locally against no table. Aliasing everything removes the need to know
  // which words are reserved this year.
  const out = await client().send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: "#sk = :sk",
      ExpressionAttributeValues: { ":sk": "STATE" },
      ProjectionExpression: "#slug, #state, #displayName, #updatedAt, #isolation",
      ExpressionAttributeNames: {
        "#sk": "sk",
        "#slug": "slug",
        "#state": "state",
        "#displayName": "displayName",
        "#updatedAt": "updatedAt",
        "#isolation": "isolation",
      },
    }),
  )

  return ((out.Items ?? []) as Array<Record<string, string>>)
    .map((i) => ({
      slug: i.slug,
      state: i.state as TenantState,
      displayName: i.displayName,
      updatedAt: i.updatedAt,
      isolation: i.isolation,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug))
}

/** Slugs already claimed — the uniqueness input to manifest validation. */
export async function takenSlugs(): Promise<string[]> {
  return (await listTenants()).map((t) => t.slug)
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
      .map((i) => i.evidence as StepEvidence),
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
): Promise<TenantRecord> {
  const current = await getTenant(slug)
  if (!current) throw new RegistryUnavailable(`No tenant "${slug}".`)

  const { state, step } = advance(current.state, to, options, current.history)

  await client().send(
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
    ...current,
    state,
    updatedAt: options.actor.at,
    history: [...current.history, step],
    evidence: evidence ? [...current.evidence, evidence] : current.evidence,
    deployment: deployment ?? current.deployment,
  }
}

/** A single item read, used by the detail page's freshness check. */
export async function currentState(slug: string): Promise<TenantState | null> {
  const out = await client().send(
    new GetCommand({ TableName: TABLE, Key: { pk: pk(slug), sk: "STATE" } }),
  )
  return (out.Item?.state as TenantState) ?? null
}

/** Exported for the seed path in tests; not used by the console. */
export const __internals = { PutCommand, pk }
