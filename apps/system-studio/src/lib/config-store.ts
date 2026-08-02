import "server-only"

import type { ConfigRecord, ConfigStore } from "@tenure/configuration"
import { ConfigStoreError } from "@tenure/configuration"

import { putTenantItemIfAbsent, queryTenantItems, tableName } from "./registry"
import { CONFIG_SORT_PREFIX, configSortKey } from "./config-sort-key"

/**
 * GE-032-001 — the DynamoDB adapter for the configuration store.
 *
 * `@tenure/configuration` defines the port and refuses to know where records
 * live (GE-031-007). This is the implementation, and it lives in the Studio
 * because the table is the Studio's — a configuration package that imported a
 * DynamoDB client would be untestable without one and undeployable outside the
 * cell that has it.
 *
 * ## It builds no client of its own
 *
 * The operations come from `registry.ts`, which owns the client. The
 * `forbidden-clients` guard refuses a second AWS client anywhere, with no
 * exemptions, and it caught the first version of this file doing exactly that.
 * The reason is not tidiness: a client constructed at a second call site picks
 * its own region and credential chain, and cannot be given encryption, retry or
 * audit behaviour later without finding every place one was built.
 *
 * ## Same table, same partition
 *
 * The registry already keys on `pk = TENANT#<slug>` with a sorted `sk`, and a
 * configuration revision is a fact about the same tenant:
 *
 *     pk = TENANT#<slug>   sk = CONFIG#00000001
 *
 * ## Append-only is enforced by the database, not by this code
 *
 * `putTenantItemIfAbsent` carries a conditional write, so a duplicate revision
 * is a conditional-check failure inside DynamoDB. A read-then-write check in
 * JavaScript loses to two concurrent publishers; the condition does not.
 */
export class DynamoConfigStore implements ConfigStore {
  async history(tenantId: string): Promise<readonly ConfigRecord[]> {
    if (!tableName()) return []
    const items = await queryTenantItems(tenantId, CONFIG_SORT_PREFIX)
    // Ascending, which with the zero-padded sort key is oldest first.
    return items.map((item) => item.record as ConfigRecord)
  }

  async latest(tenantId: string): Promise<ConfigRecord | null> {
    if (!tableName()) return null
    // One item, newest first. Reading the whole history to take the last of it
    // costs more every time a tenant publishes.
    const items = await queryTenantItems(tenantId, CONFIG_SORT_PREFIX, { newestFirst: true, limit: 1 })
    return items.length === 0 ? null : (items[0].record as ConfigRecord)
  }

  async append(record: ConfigRecord): Promise<void> {
    if (!tableName()) {
      throw new ConfigStoreError(
        "No tenant table is configured, so configuration cannot be published. Set TENANT_TABLE.",
      )
    }

    try {
      await putTenantItemIfAbsent({
        pk: `TENANT#${record.tenantId}`,
        sk: configSortKey(record.revision),
        record,
      })
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        throw new ConfigStoreError(
          `Revision ${record.revision} already exists for "${record.tenantId}". ` +
            `Another publisher got there first; re-plan against the current revision.`,
        )
      }
      throw error
    }
  }
}
