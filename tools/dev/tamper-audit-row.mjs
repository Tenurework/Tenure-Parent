#!/usr/bin/env node
/**
 * Tamper with an audit row, and put it back.
 *
 * A hash chain is only worth having if the tamper it detects is a tamper
 * somebody has actually performed against it. `verifyChain` has a unit test over
 * hand-built records; what that cannot show is that a row EDITED IN THE TABLE,
 * behind the application's back, comes back through the reader and is reported.
 * So this edits it, and `apps/system-studio/e2e/audit-chain.spec.ts` drives the
 * console before and after.
 *
 * ## Why this is not in the application
 *
 * The attacker is not the Studio. The Studio's IAM policy DENIES UpdateItem and
 * DeleteItem on every `AUDIT#…` item (infrastructure/studio/dynamodb.tf), so the
 * console genuinely cannot do this — which is the property under test. A tamper
 * helper inside `apps/` would also trip `forbidden-clients`, which names
 * `lib/registry.ts` as the only module in that app allowed to hold a DynamoDB
 * client and keeps an EMPTY exemption list. `tools/` is outside that scan and is
 * where the other registry-touching scripts already live.
 *
 * ## The one guard that matters
 *
 * It refuses to run without an explicit `AWS_ENDPOINT_URL_DYNAMODB`. Without one
 * the SDK resolves to the real regional service, and this script rewrites audit
 * rows — running it against a real account by accident is precisely the class of
 * mistake the disarm rules exist to prevent, and this is the sharpest instance
 * of it in the repository.
 *
 *   node tools/dev/tamper-audit-row.mjs tamper  --partition PLATFORM --sequence 2 --backup <file>
 *   node tools/dev/tamper-audit-row.mjs restore --backup <file>
 *   node tools/dev/tamper-audit-row.mjs duplicate --partition PLATFORM --sequence 2
 *
 * `duplicate` is the concurrency proof: it attempts a conditional put at a
 * sequence that is already written and exits 0 only if the DATABASE refused it.
 */
import fs from "node:fs"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb"

const args = process.argv.slice(2)
const mode = args[0]
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}

const table = process.env.TENANT_TABLE
const endpoint = process.env.AWS_ENDPOINT_URL_DYNAMODB

if (!table) {
  console.error("TENANT_TABLE is not set.")
  process.exit(1)
}
if (!endpoint) {
  console.error(
    "AWS_ENDPOINT_URL_DYNAMODB is not set. This REWRITES audit rows and will only talk to an " +
      "endpoint you name — point it at a local DynamoDB.",
  )
  process.exit(1)
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint }), {
  marshallOptions: { removeUndefinedValues: true },
})

/** The same key shape `apps/system-studio/src/lib/registry.ts` writes. */
const keyFor = (partition, sequence) => ({
  pk: `AUDIT#${partition}`,
  sk: `SEQ#${String(sequence).padStart(12, "0")}`,
})

async function tamper() {
  const partition = flag("partition")
  const sequence = Number(flag("sequence"))
  const backup = flag("backup")
  if (!partition || !Number.isInteger(sequence) || !backup) {
    console.error("tamper needs --partition, --sequence and --backup")
    process.exit(1)
  }

  const key = keyFor(partition, sequence)
  const { Item } = await client.send(new GetCommand({ TableName: table, Key: key }))
  if (!Item) {
    console.error(`No row at ${key.pk} / ${key.sk}`)
    process.exit(1)
  }

  fs.writeFileSync(backup, JSON.stringify(Item), "utf8")

  /*
   * Edit the CONTENT and leave `recordHash` alone.
   *
   * That is what a plausible attacker does: soften the reason on a refusal and
   * leave everything else. The recorded hash still describes the record as it
   * was written, so the recomputation no longer matches it — which is exactly
   * the `CONTENT_ALTERED` arm. Rewriting the hash to match would instead break
   * the NEXT record's `previousHash`, which is the other arm and the reason the
   * records are chained rather than merely hashed.
   */
  const tampered = {
    ...Item,
    record: {
      ...Item.record,
      reason: "Nothing to see here.",
      metadata: { ...Item.record.metadata, _detail: "Nothing to see here." },
    },
  }

  await client.send(new PutCommand({ TableName: table, Item: tampered }))
  console.log(
    JSON.stringify({
      tampered: key,
      wasReason: Item.record.reason,
      recordHash: Item.record.recordHash,
    }),
  )
}

/**
 * Remove a row outright.
 *
 * The other half of what a chain detects, and the half a per-row hash cannot:
 * a deleted record leaves every surviving row hashing correctly. Only the
 * SEQUENCE and the `previousHash` of its successor say anything happened.
 *
 * This is what an attacker with `dynamodb:DeleteItem` does, which is why the
 * Studio's own policy denies that action on `AUDIT#…` items.
 */
async function remove() {
  const partition = flag("partition")
  const sequence = Number(flag("sequence"))
  const backup = flag("backup")
  if (!partition || !Number.isInteger(sequence) || !backup) {
    console.error("remove needs --partition, --sequence and --backup")
    process.exit(1)
  }

  const key = keyFor(partition, sequence)
  const { Item } = await client.send(new GetCommand({ TableName: table, Key: key }))
  if (!Item) {
    console.error(`No row at ${key.pk} / ${key.sk}`)
    process.exit(1)
  }
  fs.writeFileSync(backup, JSON.stringify(Item), "utf8")

  const { DeleteCommand } = await import("@aws-sdk/lib-dynamodb")
  await client.send(new DeleteCommand({ TableName: table, Key: key }))
  console.log(JSON.stringify({ removed: key }))
}

async function restore() {
  const backup = flag("backup")
  if (!backup) {
    console.error("restore needs --backup")
    process.exit(1)
  }
  const Item = JSON.parse(fs.readFileSync(backup, "utf8"))
  await client.send(new PutCommand({ TableName: table, Item }))
  console.log(JSON.stringify({ restored: { pk: Item.pk, sk: Item.sk } }))
}

/**
 * Attempt to claim a sequence that is already claimed.
 *
 * This is the condition that makes `previousHash` mean anything: two writers
 * both read the same tail, both compute n+1, and the second must LOSE. Without
 * it the loser's row silently replaces the winner's, one act disappears, and the
 * chain still verifies perfectly.
 */
async function duplicate() {
  const partition = flag("partition")
  const sequence = Number(flag("sequence"))
  if (!partition || !Number.isInteger(sequence)) {
    console.error("duplicate needs --partition and --sequence")
    process.exit(1)
  }

  const key = keyFor(partition, sequence)
  try {
    await client.send(
      new PutCommand({
        TableName: table,
        Item: { ...key, partition, sequence, record: { note: "a second writer's row" } },
        ConditionExpression: "attribute_not_exists(sk)",
      }),
    )
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") {
      console.log(JSON.stringify({ refused: key, by: err.name }))
      process.exit(0)
    }
    throw err
  }

  console.error(
    `The write at ${key.sk} SUCCEEDED. A second writer just replaced an audit row, which means ` +
      "the conditional put is gone and the chain's previousHash proves nothing.",
  )
  process.exit(1)
}

if (mode === "tamper") await tamper()
else if (mode === "remove") await remove()
else if (mode === "restore") await restore()
else if (mode === "duplicate") await duplicate()
else {
  console.error(
    `Unknown mode ${JSON.stringify(mode)}. Use tamper, remove, restore or duplicate.`,
  )
  process.exit(1)
}
