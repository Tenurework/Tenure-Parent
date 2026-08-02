#!/usr/bin/env node
/**
 * What configuration revisions a tenant actually has, read straight from the table.
 *
 * For checking a publish end to end without trusting the page that claims it
 * happened. `node tools/dev/show-config-history.mjs <slug>`.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb"

const slug = process.argv[2] ?? "rochester"
const table = process.env.TENANT_TABLE
if (!table) {
  console.error("TENANT_TABLE is not set.")
  process.exit(2)
}

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ endpoint: process.env.AWS_ENDPOINT_URL_DYNAMODB || undefined }),
)

const { Items = [] } = await client.send(
  new QueryCommand({
    TableName: table,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
    ExpressionAttributeValues: { ":pk": `TENANT#${slug}`, ":sk": "CONFIG#" },
  }),
)

console.log(`${slug}: ${Items.length} configuration revision(s)`)
for (const item of Items) {
  const r = item.record ?? {}
  console.log(
    `  ${item.sk}  revision=${r.revision}  by=${r.publishedBy}  at=${r.publishedAt}` +
      `  staffOfficeName=${JSON.stringify(r.values?.["platform.terminology.staffOfficeName"])}`,
  )
}
