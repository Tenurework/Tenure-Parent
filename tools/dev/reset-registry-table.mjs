#!/usr/bin/env node
/**
 * Drop and recreate the Studio's registry table in DynamoDB Local.
 *
 * `AUTONOMOUS-LOOP.md` requires the e2e suites to run on a freshly recreated
 * database, because neither suite is idempotent — both mutate state they later
 * assert on. There was no way to do that for the Studio: `create-registry-table.mjs`
 * is a create-if-absent used by CI, where the table is new every run because the
 * container is. Locally the table survives, so a second run measures the first
 * run's leftovers and fails while the engine is behaving correctly.
 *
 * Refuses to run without an explicit local endpoint. The whole point is that
 * this deletes a table, and a script that deletes tables must not be one
 * ambient credentials can aim at an account.
 *
 *   node tools/dev/reset-registry-table.mjs
 */
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb"

const table = process.env.TENANT_TABLE
const endpoint = process.env.AWS_ENDPOINT_URL_DYNAMODB

if (!table) {
  console.error("TENANT_TABLE is not set.")
  process.exit(2)
}
if (!endpoint) {
  console.error("AWS_ENDPOINT_URL_DYNAMODB is not set. This script drops a table; it will not do that against a real account.")
  process.exit(2)
}
if (!/^https?:\/\/(localhost|127\.0\.0\.1|dynamodb):/.test(endpoint)) {
  console.error(`Refusing to run against ${endpoint} — this drops a table and only local endpoints are allowed.`)
  process.exit(2)
}

const client = new DynamoDBClient({ endpoint })

const { TableNames = [] } = await client.send(new ListTablesCommand({}))
if (TableNames.includes(table)) {
  await client.send(new DeleteTableCommand({ TableName: table }))
  // Deletion is not instant; creating into a deleting table is a ResourceInUse.
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await client.send(new DescribeTableCommand({ TableName: table }))
      await new Promise((resolve) => setTimeout(resolve, 200))
    } catch {
      break
    }
  }
  console.log(`dropped ${table}`)
}

await client.send(
  new CreateTableCommand({
    TableName: table,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
    ],
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ],
  }),
)
console.log(`created ${table} at ${endpoint} — empty`)
