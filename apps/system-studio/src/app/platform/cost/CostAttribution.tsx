import {
  Badge,
  Card,
  Chip,
  DataTable,
  EmptyState,
  StaleIndicator,
  UnknownState,
  type DataColumn,
} from "@/components/md3"
import {
  INVENTORY_REFRESH_MS,
  SHARED_TAG,
  TENANT_TAG,
  type TaggedResource,
} from "@/lib/aws/tags"
import type { AwsRead } from "@/lib/aws/read"

import { attributionAnswer, unknownArm, type TenantShare } from "./cost-decisions"
import styles from "./cost.module.css"

/**
 * "Who is it costing it for?" — the second question, answered from the estate's
 * own tags rather than from a bill.
 *
 * ## Why this panel exists before a bill does
 *
 * Attribution is not something a Cost and Usage Report does; it is something the
 * `tenure:tenant` tag does, and the CUR merely carries the tag through. So the
 * question "who would this month's bill be charged to" has a real answer today —
 * it is the shape of the estate — and the answer is worth having BEFORE the
 * first bill arrives, because that is the only time the gaps can still be closed
 * cheaply. Every resource in the third column below is spend that will reach no
 * tenant on the day billing is connected.
 *
 * ## Shared is not the same as untagged, here or anywhere
 *
 * Two columns, and they will stay two columns. `tenure:tenant = tenure:shared`
 * is a decision somebody made: this is platform overhead and nobody is billed
 * for it. A resource with no `tenure:tenant` key at all is a gap. Any
 * `tenant ?? "shared"` folds the second into the first, and the fold is how an
 * untagged NAT gateway becomes forty customers' problem.
 *
 * Neither is distributed across tenants. A split nobody chose produces a page
 * whose total reconciles and whose every row is wrong.
 *
 * ## Where the tenant names come from
 *
 * The AWS tag values, and nothing else. This panel does not read the tenant
 * registry, so no configured fixture organisation can appear on it: what is
 * drawn here is what is actually tagged in the account this engine is running
 * in.
 */
export function CostAttribution({
  read,
  now,
}: {
  read: AwsRead<readonly TaggedResource[]>
  now?: number
}) {
  const answer = attributionAnswer(read)
  const unknown = unknownArm(read)
  const asOf = read.state === "ACTUAL" || read.state === "STALE" || read.state === "EMPTY" ? read.asOf : null

  return (
    <Card
      headline="Who it is costing it for"
      headerAside={
        <>
          <Badge tone={answer.tone} title={answer.headline}>
            {answer.badge}
          </Badge>
          <Chip>
            {asOf === null ? (
              // Four of the seven `AwsRead` arms carry no `asOf` at all, because
              // the call never completed. Dating the panel to the moment its read
              // FAILED would be the one dishonest thing a timestamp can do.
              "as of — never read"
            ) : (
              <StaleIndicator
                asOf={asOf}
                cadenceMs={INVENTORY_REFRESH_MS}
                now={now}
                label="the resource tag inventory"
              />
            )}
          </Chip>
        </>
      }
      supportingText={answer.headline}
    >
      {unknown ? (
        <UnknownState what="the resource tag inventory" read={unknown} now={now} />
      ) : answer.total === 0 ? (
        <EmptyState
          headline="Nothing in this account carries a tag this engine can attribute"
          description={
            "The Resource Groups Tagging API returned no resources. No bill read against this account " +
            "could be charged to a tenant, because there is nothing to charge it by."
          }
        />
      ) : (
        <>
          {/*
            No minimum width wrapper here, unlike the budget table: two columns,
            one of them a count, fit at the 320 CSS pixels `layout.spec.ts`
            measures without the shell having to scroll.
          */}
          <DataTable
              caption={`Resources carrying ${TENANT_TAG}, by the tenant they name`}
              columns={TENANT_COLUMNS}
              rows={answer.tenants}
              rowKey={(row) => row.slug}
              empty={
                <EmptyState
                  headline="No resource names a tenant"
                  description={
                    `${answer.total} resources were read and not one of them carries a ${TENANT_TAG} ` +
                    `naming a tenant. Nothing here can be attributed.`
                  }
                />
              }
            />

          {/*
            The remainder, stated as two facts rather than one. It is deliberately
            NOT a share of a total that would let a reader treat it as small.
          */}
          <dl className={`${styles.remainder} md3-body-medium`}>
            <div>
              <dt className="md3-label-large">Shared, by decision</dt>
              <dd>
                {answer.shared} resource(s) are tagged <code>{SHARED_TAG}</code>. Somebody decided
                these are platform overhead and no tenant owns them. They stay shared: this console
                does not distribute them, because a split nobody chose produces a page whose total
                reconciles and whose every row is wrong.
              </dd>
            </div>
            <div>
              <dt className="md3-label-large">Reaching no tenant at all</dt>
              <dd>
                {answer.unattributed} resource(s) carry no <code>{TENANT_TAG}</code> tag. That is
                not the same as shared — it is a gap, and it is exactly the spend that would be
                reported unallocated the day a Cost and Usage Report is connected. Tagging them is
                what closes it.
              </dd>
            </div>
          </dl>
        </>
      )}
    </Card>
  )
}

const TENANT_COLUMNS: readonly DataColumn<TenantShare>[] = [
  { key: "slug", header: "Tenant, as the tag names it", cell: (row) => <code>{row.slug}</code> },
  {
    key: "resources",
    header: "Resources tagged for it",
    align: "end",
    // A count of resources, and it is labelled a count of resources. It is NOT
    // a share of the bill: no bill has been read, and a percentage here would be
    // read as one.
    cell: (row) => row.resources,
  },
]
