import { auth } from "@/lib/auth"
import {
  Badge,
  Card,
  Chip,
  DataTable,
  EmptyState,
  KeyValue,
  StaleIndicator,
  UnknownState,
  formatAge,
} from "@/components/md3"
import { bucketPosture, describePublicExposure, describeListing } from "@/lib/aws/buckets"
import { databaseReadings, describeScheduledOutage, describeTruncation } from "@/lib/aws/database"
import {
  describeMore,
  describeRegistryProtection,
  tableReadings,
} from "@/lib/aws/dynamodb-tables"
import {
  describeEncryptionPosture,
  describeScheduledInterruption,
  elastiCacheReadings,
} from "@/lib/aws/elasticache"
import { identityHeadline } from "@/lib/aws/identity"
import { retainedReadingsForTenant } from "@/lib/aws/retained"
import { isOperator, operatorConfigProblems } from "@/lib/operators"
import { CUSTOMER_TENANT_BINDINGS } from "@tenure/blueprints"

import {
  DATA_RISKS,
  RISK_MEANING,
  RISK_TONE,
  RISK_WORD,
  asOf,
  bucketRows,
  cacheChangeRows,
  cacheRows,
  databaseEventRows,
  maintenanceRows,
  mayClaimEmpty,
  provenanceOf,
  recoveryRows,
  statedAsOf,
  tableRows,
  unknownArm,
  unknownSentences,
  verdictOf,
  type ProvenanceRead,
} from "./answer"
import styles from "./data.module.css"

export const dynamic = "force-dynamic"

/**
 * `/platform/data` — "where does this platform keep state, is it protected, and
 * is anything about to interrupt it?"
 *
 * That question is at the top of the page in those words, because it is the one
 * an operator opens this route with, and every card below is an instalment of
 * the answer. Five live readers produce it and none of them answers it alone:
 *
 *   * `lib/aws/dynamodb-tables.ts` — the TENANT REGISTRY lives in DynamoDB, so
 *     this is the only reader that can say whether the fleet's own record of
 *     itself is recoverable. Its answer is ranked first everywhere on this page.
 *   * `lib/aws/database.ts` — RDS, and the only source of "is anything about to
 *     interrupt it": a pending maintenance action with a `ForcedApplyDate` is
 *     the one fact here with a date on which somebody else acts.
 *   * `lib/aws/buckets.ts` — S3 posture, and the only source of "is it open to
 *     the internet", which is ranked hardest of the bucket findings.
 *   * `lib/aws/elasticache.ts` — encryption on both legs, and single-node
 *     clusters that do not survive losing their node.
 *   * `lib/aws/retained.ts` — the AWS Backup vault listing. What this reader can
 *     and cannot say about recovery points is stated on the page rather than
 *     glossed; see "Restore points" below.
 *
 * ── Why the verdict is a module and not a ternary ───────────────────────────
 *
 * Every ordering decision is in `./answer.ts` — pure, no React, no client — so
 * `./answer.test.ts` drives every arm at the node level. Four of them cannot be
 * produced from a browser at all: a registry table with PITR off, a bucket S3
 * reports as public, a forced RDS upgrade date, and an estate where every read
 * was refused. A suite that only drove the browser would leave the wording an
 * operator sees on their worst morning completely untested.
 *
 * The load-bearing line in that module is `verdictOf`'s refusal to return
 * PROTECTED while any read went unanswered. This console must keep booting with
 * no AWS credentials at all, and in that state every read here lands in a
 * valueless arm of `AwsRead` — which is precisely the state a naive page renders
 * as "0 findings, all clear".
 *
 * Every card says what it is AS OF, and every card that does not know something
 * says so in the place the fact would have gone. A refused or throttled read
 * renders through the shared `UnknownState`, which prints the principal, the
 * action, the error code and a pasteable minimum statement — never an empty
 * table, never a zero.
 */
export default async function DataPage() {
  if (operatorConfigProblems().length > 0) {
    return (
      <div className="misconfigured">
        <h1>Not configured</h1>
        <p>The Studio refuses to serve until its access control is set up.</p>
      </div>
    )
  }

  const session = await auth()
  if (!isOperator(session?.user?.email)) {
    const { redirect } = await import("next/navigation")
    redirect("/signin")
  }

  const now = Date.now()

  /*
   * Four independent loads. They are awaited together rather than in sequence
   * because none of them needs another's answer, and a page that takes four
   * round-trip budgets in series is a page an operator stops opening during an
   * incident — which is the only time it matters.
   */
  const [database, dynamo, s3, cache] = await Promise.all([
    databaseReadings(),
    tableReadings(),
    bucketPosture(),
    elastiCacheReadings(),
  ])

  /*
   * The AWS Backup vault listing.
   *
   * `retainedReadingsForTenant` is the only reader in this console that lists
   * vaults, and it takes a tenant slug because its RECOVERY-POINT read filters
   * on `tenure:tenant`. The VAULT listing does not filter — `backup:ListBackupVaults`
   * returns every vault in the account — so the slug decides nothing this page
   * renders. It is a real customer slug rather than a literal so that the reads
   * this page discards are still correct ones, and `CUSTOMER_TENANT_BINDINGS`
   * rather than `TENANT_BINDINGS` so no fixture ever reaches an operator
   * surface. With no customer bound there is nothing to pass and the call is not
   * made at all, which the vault panel says in words.
   *
   * Identity and the tag index are handed over rather than taken again:
   * `resolveIdentity` only caches an ACTUAL answer, so an estate where STS is
   * unreachable — the exact estate this console must keep booting in — would
   * otherwise pay for another failing call, and the two panels could disagree
   * about which account they describe.
   */
  const vaultSlug = CUSTOMER_TENANT_BINDINGS[0]?.slug ?? null
  const retained =
    vaultSlug === null
      ? null
      : await retainedReadingsForTenant(vaultSlug, undefined, {
          identity: s3.identity,
          tagged: s3.tagged,
        })

  /* ── The readings, turned into rows ─────────────────────────────────────── */

  const maintenance = maintenanceRows(database.outage)
  const events = databaseEventRows(database.instances)
  const changes = cacheChangeRows(cache.interruption)
  const tables = tableRows(dynamo)
  const buckets = bucketRows(s3)
  const caches = cacheRows(cache)
  const recovery = recoveryRows(database.instances, dynamo.tables, now)

  /*
   * Every read this page made, in one list, used twice: once to say where the
   * page came from, and once — filtered to the ones that did not answer — to
   * stop the verdict claiming everything is protected. One list, so the two
   * cannot drift.
   */
  const reads: readonly ProvenanceRead[] = [
    { label: "Identity", what: "the account, region and partition", read: database.identity },
    { label: "DynamoDB tables", what: "every table in this region", read: dynamo.tables },
    { label: "RDS instances", what: "every database instance", read: database.instances },
    {
      label: "RDS pending maintenance",
      what: "what AWS has queued against these databases",
      read: database.pendingMaintenance,
    },
    { label: "S3 buckets", what: "every bucket and its posture", read: s3.buckets },
    { label: "ElastiCache clusters", what: "every cache cluster", read: cache.clusters },
    {
      label: "ElastiCache replication groups",
      what: "every replication group",
      read: cache.replicationGroups,
    },
    ...(retained
      ? [
          {
            label: "AWS Backup vaults",
            what: "every backup vault in this account",
            read: retained.vaults,
          },
        ]
      : []),
  ]
  const provenance = provenanceOf(reads)
  const unknowns = unknownSentences(reads)

  const verdict = verdictOf({
    registry: dynamo.registry,
    tables,
    buckets,
    caches,
    maintenance,
    cacheChanges: changes,
    recovery,
    unknowns,
  })

  /* ── The unknown arms, for the panels that must not render a zero ───────── */

  const tablesUnknown = unknownArm(dynamo.tables)
  const instancesUnknown = unknownArm(database.instances)
  const maintenanceUnknown = unknownArm(database.pendingMaintenance)
  const bucketsUnknown = unknownArm(s3.buckets)
  const clustersUnknown = unknownArm(cache.clusters)
  const groupsUnknown = unknownArm(cache.replicationGroups)
  const vaultsUnknown = retained ? unknownArm(retained.vaults) : null

  return (
    <div className={styles.page} data-surface="data">
      <header className={styles.lead}>
        <h1 className="md3-headline-large">Data</h1>
        {/* The question, in the words an operator would use, above every piece
            of apparatus that answers it. */}
        <p className="md3-title-medium" data-testid="page-question">
          Where does this platform keep state, is it protected, and is anything about to interrupt
          it?
        </p>
        <p className="md3-body-medium">
          Every DynamoDB table, RDS instance, S3 bucket and cache in this account, what protects
          each one, and what AWS has queued that will take one of them away.
        </p>
        {/* Which estate this is. Rendered as prose rather than in a chip because
            on a refusal it is a whole IAM statement, and a pill four lines tall
            is a pill that has stopped being a pill. */}
        <p className={`md3-body-small ${styles.identifier}`}>{identityHeadline(database.identity)}</p>
      </header>

      {/* ── The answer ─────────────────────────────────────────────────────── */}
      <Card
        id="protection"
        headline="Protection"
        headerAside={
          <span className={styles.row}>
            <Badge tone={verdict.tone} title={RISK_MEANING[verdict.risk]}>
              {verdict.word}
            </Badge>
            <StaleIndicator
              asOf={dynamo.asOf}
              cadenceMs={dynamo.refreshMs.tables}
              label="the DynamoDB reading"
            />
          </span>
        }
        supportingText={statedAsOf(
          "What an operator should act on first, from one DynamoDB load, one RDS load, one S3 posture load and one ElastiCache load",
          dynamo.asOf,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-large" data-testid="protection-headline">
            {verdict.headline}
          </p>

          {verdict.findings.length > 0 ? (
            <ul className={styles.findings}>
              {verdict.findings.map((finding) => (
                <li key={finding} className="md3-body-medium">
                  {finding}
                </li>
              ))}
            </ul>
          ) : null}

          {/* What each store is, counted. Only counts that came from a read
              that answered — a chip reading "0 buckets" over a refused
              ListAllMyBuckets is the lie this whole console is built against,
              so the chip is simply absent and the unknown below is the answer. */}
          <div className={styles.row}>
            {[
              { label: "DynamoDB table", rows: tables.length, read: dynamo.tables },
              { label: "S3 bucket", rows: buckets.length, read: s3.buckets },
              { label: "cache", rows: caches.length, read: cache.clusters },
              { label: "restore point", rows: recovery.length, read: database.instances },
            ]
              .filter((entry) => entry.read.state === "ACTUAL" || entry.read.state === "STALE")
              .map((entry) => (
                <Chip key={entry.label} title={`${entry.rows} ${entry.label}(s) this page read`}>
                  {entry.rows} {entry.label}
                  {entry.rows === 1 ? "" : "s"}
                </Chip>
              ))}
          </div>

          {/* Every read that did not answer, named. Not a count: the point of
              the list is which one, because each has a different remedy. */}
          {verdict.complete ? null : (
            <div className={styles.tight}>
              <p className="md3-body-medium" data-testid="incomplete">
                {unknowns.length} read(s) on this page did not answer. Nothing below is a claim
                about what they would have said.
              </p>
              <ul className={styles.findings}>
                {unknowns.map((sentence) => (
                  <li key={sentence} className="md3-body-small">
                    {sentence}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>

      {/* ── What is about to interrupt it ──────────────────────────────────── */}
      <Card
        id="interruptions"
        headline="About to interrupt"
        headerAside={
          <Badge
            tone={maintenance.length + changes.length > 0 ? "warn" : "ok"}
            title="Queued actions and changes AWS will apply to a store on this platform"
          >
            {maintenance.length + changes.length}
          </Badge>
        }
        supportingText={statedAsOf(
          "Every maintenance action AWS has queued against a database, the date it stops being optional, and every queued cache change",
          database.asOf,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-medium">{describeScheduledOutage(database.outage)}</p>

          {maintenanceUnknown ? (
            <UnknownState
              read={maintenanceUnknown}
              what="what AWS has queued against these databases"
            />
          ) : (
            <DataTable
              caption="RDS maintenance actions AWS has queued, forced ones first"
              rowKey={(row) => row.key}
              columns={[
                {
                  key: "what",
                  header: "Action",
                  cell: (row) => (
                    <span className={styles.cell}>
                      <span className={styles.identifier}>{row.instanceId}</span>
                      <span className="md3-label-small">{row.action}</span>
                    </span>
                  ),
                },
                {
                  key: "when",
                  header: "When",
                  cell: (row) => (
                    <span className={styles.cell}>
                      <Badge tone={RISK_TONE[row.risk]} title={RISK_MEANING[row.risk]}>
                        {row.forcedOn === null ? RISK_WORD[row.risk] : `Forced ${row.forcedOn}`}
                      </Badge>
                      <span>{row.when}</span>
                    </span>
                  ),
                },
                {
                  key: "detail",
                  header: "What it means",
                  cell: (row) => (
                    <span className={styles.cell}>
                      <span>
                        {row.interrupts
                          ? "INTERRUPTS the database when applied"
                          : "applied without a restart"}
                      </span>
                      {row.description ? (
                        <span className="md3-label-small">{row.description}</span>
                      ) : null}
                      <span className="md3-label-small">
                        Opt-in: {row.optInStatus ?? "nobody has opted in"}
                      </span>
                    </span>
                  ),
                },
              ]}
              rows={maintenance}
              empty={
                <EmptyState
                  headline="AWS has nothing queued against these databases"
                  description="The pending-maintenance read answered and contained no action for any instance this page listed. That is a fact AWS stated, not a gap in this console."
                />
              }
            />
          )}

          {/* The cache half of the same question. A separate table because it is
              a separate read with a separate refusal — folding them would make
              a denied DescribeCacheClusters render as "no cache changes". */}
          <DataTable
            caption="Cache changes AWS will apply, the restarting ones first"
            rowKey={(row) => row.key}
            columns={[
              {
                key: "what",
                header: "Cache",
                cell: (row) => (
                  <span className={styles.cell}>
                    <span className={styles.identifier}>{row.resourceId}</span>
                    <span className="md3-label-small">{row.resourceKind}</span>
                  </span>
                ),
              },
              {
                key: "change",
                header: "Change",
                cell: (row) => (
                  <span className={styles.cell}>
                    <Badge tone={RISK_TONE[row.risk]} title={RISK_MEANING[row.risk]}>
                      {row.restarts ? "Restarts the node" : RISK_WORD[row.risk]}
                    </Badge>
                    <span>
                      {row.field}: {row.from ?? "not stated by AWS"} to {row.to}
                    </span>
                  </span>
                ),
              },
              {
                key: "why",
                header: "What it means",
                cell: (row) => <span className={styles.cell}>{row.why}</span>,
              },
            ]}
            rows={changes}
            /*
             * No rows is only "nothing is queued" when both cache listings
             * answered. `cacheChangeRows` returns `[]` for a refusal too, and
             * the EmptyState below reads as a statement about the estate — so
             * the reads themselves are asked, not the row count.
             */
            empty={
              mayClaimEmpty([cache.clusters, cache.replicationGroups]) ? (
                <EmptyState
                  headline="Nothing is queued against a cache"
                  description={describeScheduledInterruption(cache.interruption)}
                />
              ) : (
                <div className={styles.tight}>
                  {clustersUnknown ? (
                    <UnknownState
                      read={clustersUnknown}
                      what="what AWS has queued against this account's cache clusters"
                    />
                  ) : null}
                  {groupsUnknown ? (
                    <UnknownState
                      read={groupsUnknown}
                      what="what AWS has queued against this account's cache replication groups"
                    />
                  ) : null}
                </div>
              )
            }
          />

          {/* What has already happened. Failovers, restarts and low storage are
              the three RDS event kinds that mean the database went away or is
              about to; every other category is deliberately not listed here. */}
          {instancesUnknown ? (
            <UnknownState read={instancesUnknown} what="this account's database instances" />
          ) : (
            <>
              <DataTable
                caption="Recent RDS failovers, restarts and low-storage events, newest first"
                rowKey={(row) => row.key}
                columns={[
                  {
                    key: "when",
                    header: "When",
                    cell: (row) => <span className={styles.identifier}>{row.at}</span>,
                  },
                  {
                    key: "what",
                    header: "What",
                    cell: (row) => (
                      <span className={styles.cell}>
                        <span className={styles.identifier}>{row.instanceId}</span>
                        <span className="md3-label-small">{row.significance}</span>
                      </span>
                    ),
                  },
                  {
                    key: "message",
                    header: "What AWS said",
                    cell: (row) => (
                      <span className={styles.cell}>
                        {row.message ?? "AWS returned this event with no message"}
                      </span>
                    ),
                  },
                ]}
                rows={events.rows}
                empty={
                  <EmptyState
                    headline="No failover, restart or low-storage event in the window"
                    description="The event read answered for every instance below and contained none of the three kinds this card reports. Other categories — configuration, backup, replication — are not listed here and are not claimed to be absent."
                  />
                }
              />
              {events.unread.length > 0 ? (
                <p className="md3-body-small">
                  The event history could not be read for {events.unread.length} instance(s):{" "}
                  {events.unread.join(", ")}. The table above is not a claim that nothing happened
                  to them.
                </p>
              ) : null}
            </>
          )}
        </div>
      </Card>

      {/* ── The registry, and everything else in DynamoDB ───────────────────── */}
      <Card
        id="registry"
        headline="The tenant registry, and the tables around it"
        headerAside={
          <StaleIndicator
            asOf={dynamo.asOf}
            cadenceMs={dynamo.refreshMs.backups}
            label="the continuous-backup reading"
          />
        }
        supportingText={statedAsOf(
          "Point-in-time recovery, deletion protection and encryption for every DynamoDB table in this region, the registry first",
          dynamo.asOf,
        )}
      >
        <div className={styles.stack}>
          <KeyValue
            ariaLabel="The fleet's own record of itself"
            items={[
              {
                key: "registry",
                term: "Registry",
                value: describeRegistryProtection(dynamo.registry),
              },
              {
                key: "name",
                term: "TENANT_TABLE",
                value: dynamo.registryTableName ?? "unset — this engine has not been told which table is the registry",
              },
              { key: "listing", term: "Listing", value: describeMore(dynamo.more) },
            ]}
          />

          {tablesUnknown ? (
            <UnknownState read={tablesUnknown} what="this region's DynamoDB tables" />
          ) : (
            <DataTable
              caption="Every DynamoDB table, the tenant registry first and the rest worst first"
              rowKey={(row) => row.key}
              columns={[
                {
                  key: "table",
                  header: "Table",
                  cell: (row) => (
                    <span className={styles.cell}>
                      <span className={styles.identifier}>{row.name}</span>
                      {row.isRegistry ? (
                        <span className="md3-label-small">the tenant registry</span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: "verdict",
                  header: "Verdict",
                  cell: (row) => (
                    <span className={styles.cell}>
                      <Badge tone={RISK_TONE[row.risk]} title={RISK_MEANING[row.risk]}>
                        {RISK_WORD[row.risk]}
                      </Badge>
                      {row.concerns.map((concern) => (
                        <span key={concern} className="md3-label-small">
                          {concern}
                        </span>
                      ))}
                    </span>
                  ),
                },
                {
                  key: "protection",
                  header: "What protects it",
                  cell: (row) => (
                    <span className={styles.cell}>
                      <span>{row.pitr}</span>
                      <span className="md3-label-small">{row.deletionProtection}</span>
                      <span className="md3-label-small">{row.encryption}</span>
                    </span>
                  ),
                },
              ]}
              rows={tables}
              empty={
                <EmptyState
                  headline="This region holds no DynamoDB table"
                  description="ListTables answered and returned nothing. If that is a surprise, the registry line above says which table this engine was looking for."
                />
              }
            />
          )}
        </div>
      </Card>

      {/* ── The buckets ────────────────────────────────────────────────────── */}
      <Card
        id="buckets"
        headline="Object storage"
        headerAside={
          <StaleIndicator
            asOf={s3.asOf}
            cadenceMs={s3.refreshMs.posture}
            label="the bucket posture reading"
          />
        }
        supportingText={statedAsOf(
          "Public-access block, policy status, default encryption and versioning for every bucket, open ones first",
          s3.asOf,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-medium">{describePublicExposure(s3.publicExposure)}</p>
          <p className="md3-body-small">{describeListing(s3.listing)}</p>

          {bucketsUnknown ? (
            <UnknownState read={bucketsUnknown} what="this account's S3 buckets" />
          ) : (
            <DataTable
              caption="Every bucket, the ones open to the internet first"
              rowKey={(row) => row.key}
              columns={[
                {
                  key: "bucket",
                  header: "Bucket",
                  cell: (row) => <span className={styles.identifier}>{row.name}</span>,
                },
                {
                  key: "verdict",
                  header: "Verdict",
                  cell: (row) => (
                    <span className={styles.cell}>
                      <Badge tone={RISK_TONE[row.risk]} title={RISK_MEANING[row.risk]}>
                        {RISK_WORD[row.risk]}
                      </Badge>
                      {row.concerns.map((concern) => (
                        <span key={concern} className="md3-label-small">
                          {concern}
                        </span>
                      ))}
                    </span>
                  ),
                },
                {
                  key: "posture",
                  header: "What protects it",
                  cell: (row) => (
                    <span className={styles.cell}>
                      <span>{row.publicAccess}</span>
                      <span className="md3-label-small">{row.policyStatus}</span>
                      <span className="md3-label-small">{row.encryption}</span>
                      <span className="md3-label-small">{row.versioning}</span>
                    </span>
                  ),
                },
              ]}
              rows={buckets}
              empty={
                <EmptyState
                  headline="This account holds no bucket"
                  description="ListAllMyBuckets answered and returned nothing. That is AWS's answer, not this console's inability to ask."
                />
              }
            />
          )}
        </div>
      </Card>

      {/* ── The caches ─────────────────────────────────────────────────────── */}
      <Card
        id="cache"
        headline="Cache"
        headerAside={
          <StaleIndicator
            asOf={cache.asOf}
            cadenceMs={cache.refreshMs.clusters}
            label="the ElastiCache reading"
          />
        }
        supportingText={statedAsOf(
          "Encryption at rest and in transit, and whether each cache survives losing a node",
          cache.asOf,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-medium">{describeEncryptionPosture(cache.encryption)}</p>

          {clustersUnknown ? (
            <UnknownState read={clustersUnknown} what="this account's cache clusters" />
          ) : null}
          {groupsUnknown ? (
            <UnknownState read={groupsUnknown} what="this account's cache replication groups" />
          ) : null}

          {clustersUnknown && groupsUnknown ? null : (
            <DataTable
              caption="Every cache cluster and replication group, worst first"
              rowKey={(row) => row.key}
              columns={[
                {
                  key: "cache",
                  header: "Cache",
                  cell: (row) => (
                    <span className={styles.cell}>
                      <span className={styles.identifier}>{row.id}</span>
                      <span className="md3-label-small">{row.kind}</span>
                    </span>
                  ),
                },
                {
                  key: "verdict",
                  header: "Verdict",
                  cell: (row) => (
                    <span className={styles.cell}>
                      <Badge tone={RISK_TONE[row.risk]} title={RISK_MEANING[row.risk]}>
                        {RISK_WORD[row.risk]}
                      </Badge>
                      {row.concerns.map((concern) => (
                        <span key={concern} className="md3-label-small">
                          {concern}
                        </span>
                      ))}
                    </span>
                  ),
                },
                {
                  key: "posture",
                  header: "What protects it",
                  cell: (row) => (
                    <span className={styles.cell}>
                      <span>{row.atRest}</span>
                      <span className="md3-label-small">{row.inTransit}</span>
                      <span className="md3-label-small">{row.failover}</span>
                    </span>
                  ),
                },
              ]}
              rows={caches}
              empty={
                <EmptyState
                  headline="This account runs no cache"
                  description="Both listings answered and returned nothing. Nothing on this platform is holding state in ElastiCache."
                />
              }
            />
          )}
        </div>
      </Card>

      {/* ── Restore points and vaults ──────────────────────────────────────── */}
      <Card
        id="restore-points"
        headline="Restore points"
        headerAside={
          <Badge
            tone={recovery.some((row) => row.risk === "UNRECOVERABLE") ? "bad" : "neutral"}
            title="Stores whose newest restore point this page could establish"
          >
            {recovery.length}
          </Badge>
        }
        supportingText={statedAsOf(
          "The newest moment each store could be restored to, oldest first, and the backup vaults this account holds",
          database.asOf,
        )}
      >
        <div className={styles.stack}>
          <DataTable
            caption="The newest restore point per store, the ones without one first"
            rowKey={(row) => row.key}
            columns={[
              {
                key: "resource",
                header: "Store",
                cell: (row) => (
                  <span className={styles.cell}>
                    <span className={styles.identifier}>{row.resource}</span>
                    <span className="md3-label-small">{row.source}</span>
                  </span>
                ),
              },
              {
                key: "age",
                header: "Newest restore point",
                cell: (row) => (
                  <span className={styles.cell}>
                    <Badge tone={RISK_TONE[row.risk]} title={RISK_MEANING[row.risk]}>
                      {row.ageMs === null ? RISK_WORD[row.risk] : `${formatAge(row.ageMs)} old`}
                    </Badge>
                    <span className={styles.identifier}>
                      {row.newestAt ?? "AWS stated no restorable time"}
                    </span>
                  </span>
                ),
              },
              {
                key: "detail",
                header: "What it means",
                cell: (row) => <span className={styles.cell}>{row.detail}</span>,
              },
            ]}
            rows={recovery}
            /*
             * Same rule as the cache table above, and the more dangerous of the
             * two: "no store has a restore point" and "we could not find out
             * whether any store has one" are opposite facts, and this table
             * derives from two listings that can each land in a valueless arm.
             */
            empty={
              mayClaimEmpty([database.instances, dynamo.tables]) ? (
                <EmptyState
                  headline="No store on this page has a continuous restore point"
                  description="Neither the RDS listing nor the DynamoDB listing returned a resource whose backups could be established. The cards above say which of those two reads answered."
                />
              ) : (
                <div className={styles.tight}>
                  {instancesUnknown ? (
                    <UnknownState
                      read={instancesUnknown}
                      what="the restore points of this account's database instances"
                    />
                  ) : null}
                  {tablesUnknown ? (
                    <UnknownState
                      read={tablesUnknown}
                      what="the restore points of this region's DynamoDB tables"
                    />
                  ) : null}
                </div>
              )
            }
          />

          {/* The vaults. Their own read and their own refusal — `retained.ts`
              splits ListBackupVaults from ListRecoveryPointsByBackupVault
              precisely so a denial names the action that was actually missing. */}
          {retained === null ? (
            <p className="md3-body-medium">
              No customer tenant is bound in this build, so the vault listing was not read. This is
              not a report that this account holds no backup vault.
            </p>
          ) : vaultsUnknown ? (
            <UnknownState read={vaultsUnknown} what="this account's AWS Backup vaults" />
          ) : (
            <KeyValue
              ariaLabel="AWS Backup vaults"
              items={[
                {
                  key: "vaults",
                  term: "Backup vaults",
                  value:
                    retained.vaults.state === "ACTUAL" || retained.vaults.state === "STALE"
                      ? retained.vaults.value.join(", ")
                      : "none — backup:ListBackupVaults answered and this account holds no vault",
                },
                {
                  key: "vaults-as-of",
                  term: "Read",
                  value: asOf(
                    retained.vaults.state === "ACTUAL" ||
                      retained.vaults.state === "STALE" ||
                      retained.vaults.state === "EMPTY"
                      ? retained.vaults.asOf
                      : null,
                  ),
                },
              ]}
            />
          )}

          {/*
            The honest limit of this card, stated where somebody would otherwise
            assume the opposite. Naming the exact change that would lift it, so
            it is a gap rather than an apology.
          */}
          <p className="md3-body-small">
            The AGE of a recovery point inside those vaults is not on this page. The only reader in
            this console that lists them, <code>lib/aws/retained.ts</code>, filters recovery points
            to one tenant&rsquo;s <code>tenure:tenant</code> tag and does not carry AWS&rsquo;s{" "}
            <code>CreationDate</code> or <code>ResourceArn</code> through into its result, so there
            is no honest way to age them from here. Lifting that needs those two fields added to{" "}
            <code>RetainedResource</code>, which is a change to a module this surface does not own.
            The table above is RDS automated backups and DynamoDB point-in-time recovery only — both
            continuous, both carrying their own latest restorable time — and it is not a claim about
            what is or is not in a vault.
          </p>
        </div>
      </Card>

      {/* ── Where all of it came from ──────────────────────────────────────── */}
      <Card
        id="provenance"
        headline="Where this came from"
        supportingText={statedAsOf(
          "The reads this page made, the principal it made them as, and the estate that answered",
          dynamo.asOf,
        )}
      >
        <div className={styles.stack}>
          <KeyValue
            ariaLabel="What produced this page"
            items={provenance.map((fact) => ({
              key: fact.label,
              term: fact.label,
              value: <code>{fact.value}</code>,
            }))}
          />

          <KeyValue
            ariaLabel="How complete each listing was"
            items={[
              {
                key: "instances",
                term: "RDS listing",
                value: describeTruncation(database.truncation.instances),
              },
              {
                key: "pending",
                term: "RDS maintenance listing",
                value: describeTruncation(database.truncation.pendingMaintenance),
              },
              { key: "tables", term: "DynamoDB listing", value: describeMore(dynamo.more) },
              { key: "buckets", term: "S3 listing", value: describeListing(s3.listing) },
            ]}
          />

          {/* The legend. Collapsed, because it is reference rather than news —
              but on the page rather than in a doc, because a vocabulary an
              operator cannot look up is a vocabulary of guesses. */}
          <details className={styles.disclosure}>
            <summary className="md3-label-large">What each word on this page means</summary>
            <DataTable
              caption="The verdicts this page prints, and what each one is telling you"
              rowKey={(row) => row}
              columns={[
                {
                  key: "word",
                  header: "Word",
                  cell: (risk) => (
                    <Badge tone={RISK_TONE[risk]} title={risk}>
                      {RISK_WORD[risk]}
                    </Badge>
                  ),
                },
                {
                  key: "means",
                  header: "What it means",
                  cell: (risk) => <span className={styles.cell}>{RISK_MEANING[risk]}</span>,
                },
              ]}
              rows={DATA_RISKS as ReadonlyArray<(typeof DATA_RISKS)[number]>}
              empty={
                <EmptyState
                  headline="No verdicts"
                  description="The verdict vocabulary is empty, which cannot happen while answer.ts declares one."
                />
              }
            />
          </details>
        </div>
      </Card>
    </div>
  )
}
