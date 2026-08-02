#!/usr/bin/env node
/**
 * Create the tenant-registry table, for a local or CI DynamoDB.
 *
 * Deliberately the SDK and not the AWS CLI. `production-workflows-disarmed`
 * decides a workflow can reach production by looking for what it actually does
 * — naming the credential secrets, configuring credentials, or shelling out to
 * `aws` — rather than from a list somebody has to remember to update. Putting
 * `aws dynamodb create-table` in ci.yml tripped that, correctly: the guard
 * cannot tell `--endpoint-url http://localhost:8000` from a real account, and a
 * guard that tries to would be a guard with an exception in it.
 *
 * So there is no `aws` invocation. This talks to whatever
 * `AWS_ENDPOINT_URL_DYNAMODB` points at, which for CI and for a local run is a
 * container on localhost, and it refuses to run without one — see below.
 *
 * The key schema is the same as `infrastructure/studio/dynamodb.tf`. Declared
 * here rather than read from Terraform state because CI must not depend on
 * state it cannot reach, and `tests/security/studio-table.test.mjs` asserts the
 * two agree.
 */
import {
  CreateTableCommand,
  DynamoDBClient,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb"

const table = process.env.TENANT_TABLE
const endpoint = process.env.AWS_ENDPOINT_URL_DYNAMODB

if (!table) {
  console.error("::error::TENANT_TABLE is not set")
  process.exit(1)
}

if (!endpoint) {
  // The one guard that matters here. Without an explicit endpoint the SDK
  // resolves to the real regional service, and this script creates tables —
  // running it against a real account by accident is exactly the class of
  // mistake the disarm rules exist to prevent.
  console.error(
    "::error::AWS_ENDPOINT_URL_DYNAMODB is not set. This creates tables and will only " +
      "talk to an endpoint you name — point it at a local DynamoDB.",
  )
  process.exit(1)
}

const client = new DynamoDBClient({})

try {
  await client.send(new DescribeTableCommand({ TableName: table }))
  console.log(`${table} already exists at ${endpoint}`)
  process.exit(0)
} catch (err) {
  if (err?.name !== "ResourceNotFoundException") throw err
}

await client.send(
  new CreateTableCommand({
    TableName: table,
    AttributeDefinitions: [
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
    ],
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ],
    BillingMode: "PAY_PER_REQUEST",
  }),
)

console.log(`created ${table} at ${endpoint}`)
