#!/usr/bin/env node
/**
 * Seed the tenant registry with the fleet shapes the Studio's e2e needs.
 *
 * Deliberately not a fixture library: it writes the SAME item shapes
 * `registry.ts` writes, because the properties under test are properties of the
 * data layout — a tenant with no DEPLOYMENT row is `never-deployed` precisely
 * BECAUSE the sort key is absent, and a fake that carried a `hasDeployment`
 * boolean would prove nothing about the code that reads the sort key.
 *
 * Three tenants, each one a case some assertion depends on:
 *
 *   seed-deployed    Has a DEPLOYMENT row — which is the property its name
 *                    states and the only thing that distinguishes it from
 *                    `seed-nodeploy`. Its lifecycle state is `PURGE_PENDING`,
 *                    for the reason below.
 *   seed-nodeploy    ACTIVE, with NO DEPLOYMENT row. The fleet page must say
 *                    `never deployed` for it. This is the case that was
 *                    unreachable while the page passed `hasDeployment: true`.
 *   seed-elsewhere   placed in eu-west-1, which this control plane holds no
 *                    credentials for — so the CSV export must not carry it.
 *
 * ## Why seed-deployed is PURGE_PENDING and not ACTIVE
 *
 * STUDIO-030-004 says an irreversible move must not sit beside an ordinary one,
 * and `layout.spec.ts` asserts the vertical gap between the two groups on
 * `/tenants/seed-deployed`. That assertion needs a tenant whose successors
 * include BOTH kinds, and it was written believing ACTIVE was such a state.
 * It is not, and no amount of styling makes it one: from ACTIVE the graph
 * offers IDLE, SUSPENDING, HIBERNATING, EXPORTING, OFFBOARDING and LEGAL_HOLD,
 * and every one of them can reach a serving state again — `change-class.ts`
 * says so in as many words ("OFFBOARDING moves a tenant toward deletion without
 * performing any"). `PURGE_PENDING` is the ONE state in the whole graph that
 * offers both: PURGING, which is C7 and cannot be undone, alongside LEGAL_HOLD
 * and OFFBOARDING, which can. It is also exactly the state the spec describes —
 * "an operator reaching for an ordinary advance must not be able to hit
 * PURGING" — because PURGING is offered from nowhere else.
 *
 * The registry row's coarser `lifecycle` moves with it. `TenantLifecycle` has
 * no PURGE_PENDING; `DEPROVISIONING` is its member for the one-way door, and
 * leaving it at ACTIVE would seed a fixture that contradicts itself.
 *
 * The endpoint is required, for the same reason `create-registry-table.mjs`
 * requires it: this writes rows, and letting the SDK resolve a region would
 * mean writing them into a real account by accident.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb"

const table = process.env.TENANT_TABLE
const endpoint = process.env.AWS_ENDPOINT_URL_DYNAMODB
if (!table || !endpoint) {
  console.error("TENANT_TABLE and AWS_ENDPOINT_URL_DYNAMODB must both be set.")
  process.exit(1)
}

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint }), {
  marshallOptions: { removeUndefinedValues: true },
})

const AT = "2026-08-01T00:00:00.000Z"

function manifestFor(slug, region) {
  return {
    manifestVersion: 1,
    slug,
    legalName: `${slug} Incorporated`,
    displayName: `Seed ${slug}`,
    blueprintId: "university-student-org",
    modules: [],
    entitlements: [],
    region,
    isolation: "pooled",
    coexistence: "TENURE_CLOUD_PRIMARY",
    systemOfRecord: {},
    configuration: {},
    secretRefs: {},
    initialAdminEmail: `admin@${slug}.example`,
  }
}

function registryFor(slug, region, cellId, lifecycle) {
  return {
    tenantId: `tnt_seed_${slug.replace(/-/g, "")}`,
    slug,
    lifecycle,
    provenance: "composed",
    legalName: `${slug} Incorporated`,
    displayName: `Seed ${slug}`,
    primaryContactEmail: `owner@${slug}.example`,
    plan: "growth",
    entitlements: [],
    residency: [region],
    isolation: "pooled",
    placement: { cellId, region, placedAt: AT },
    release: "seed-release",
    configRevision: 3,
    createdAt: AT,
    updatedAt: AT,
  }
}

async function seed({ slug, region, cellId, withDeployment, state, lifecycle }) {
  // Clear anything a previous run left, so the suite is repeatable. Every item
  // under the partition, not a guessed list of sort keys.
  const existing = await doc.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": `TENANT#${slug}` },
      ProjectionExpression: "pk, sk",
    }),
  )
  for (const item of existing.Items ?? []) {
    await doc.send(new DeleteCommand({ TableName: table, Key: { pk: item.pk, sk: item.sk } }))
  }

  const base = { pk: `TENANT#${slug}`, slug, displayName: `Seed ${slug}`, isolation: "pooled" }
  const manifest = manifestFor(slug, region)

  await doc.send(
    new PutCommand({ TableName: table, Item: { ...base, sk: "MANIFEST", manifest, digest: `seed-${slug}` } }),
  )
  await doc.send(
    new PutCommand({
      TableName: table,
      Item: { ...base, sk: "REGISTRY", registry: registryFor(slug, region, cellId, lifecycle) },
    }),
  )
  await doc.send(
    new PutCommand({
      TableName: table,
      Item: {
        ...base,
        sk: "STATE",
        state,
        digest: `seed-${slug}`,
        createdAt: AT,
        updatedAt: AT,
      },
    }),
  )

  if (withDeployment) {
    await doc.send(
      new PutCommand({
        TableName: table,
        Item: {
          ...base,
          sk: "DEPLOYMENT",
          deployment: {
            digest: `dep-${slug}`,
            configurationChecksum: "seed",
            modules: [],
            schemaVersion: "seed-schema",
            evidenceDigest: "seed",
            createdAt: AT,
            createdBy: "seed",
            serving: true,
          },
        },
      }),
    )
  }

  console.log(`seeded ${slug} (${region}, ${state}, deployment=${!!withDeployment})`)
}

const region = process.env.AWS_REGION ?? "us-east-1"
const cellId = process.env.CELL_ID ?? `cell-${region}-a`

// The lifecycle-engine state and the registry's coarser lifecycle are written
// together, from one place, so a fixture cannot claim two different things
// about the same tenant.
await seed({
  slug: "seed-deployed",
  region,
  cellId,
  withDeployment: true,
  state: "PURGE_PENDING",
  lifecycle: "DEPROVISIONING",
})
await seed({
  slug: "seed-nodeploy",
  region,
  cellId,
  withDeployment: false,
  state: "ACTIVE",
  lifecycle: "ACTIVE",
})
await seed({
  slug: "seed-elsewhere",
  region: "eu-west-1",
  cellId: "cell-eu-west-1-a",
  withDeployment: true,
  state: "ACTIVE",
  lifecycle: "ACTIVE",
})
