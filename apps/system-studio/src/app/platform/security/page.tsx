import { Fragment } from "react"

import { auth } from "@/lib/auth"
import { AwsReadPanel } from "@/components/states"
import { Badge, Card, Chip, DataTable, EmptyState, type DataColumn } from "@/components/md3"
import {
  securityFindings,
  SEVERITY_SLA_HOURS,
  type FindingSource,
  type SecurityFinding,
} from "@/lib/aws/findings"
import { describeAttribution } from "@/lib/aws/tags"
import { isOperator, operatorConfigProblems } from "@/lib/operators"

import styles from "./security.module.css"
import {
  answeredSources,
  asOf,
  countBySeverity,
  leadAnswer,
  provenanceOf,
  readAnswered,
  scopeOf,
  scopeSentence,
  slaRows,
  sortFindings,
  statedAsOf,
  SEVERITY_RANK,
  SEVERITY_TONE,
  SOURCE_TONE,
} from "./answer"

export const dynamic = "force-dynamic"

/**
 * STUDIO-110-006 — security findings, and the per-source table that makes an
 * empty list mean something.
 *
 * The only "findings" this console had were architecture-versus-inventory
 * discrepancies compiled out of `docs/architecture` — documentation gaps with an
 * owning requirement id, no severity, no affected tenant and no SLA. Those are
 * still on `/platform`, correctly, under "Open findings". These are different
 * findings and belong on their own page rather than in the same table.
 *
 * ── What this page is, read top to bottom ──────────────────────────────────
 *
 * Four cards, in the order an operator needs them:
 *
 *   1. **the answer** — one sentence saying what is true of this account right
 *      now, a word for it, and, when the read was refused, the panel carrying
 *      the principal, the action and the IAM statement that would fix it. The
 *      decision behind the sentence is `leadAnswer` in `./answer.ts`, which is
 *      pure and is driven through all six of its arms by
 *      `e2e/security-page-logic.spec.ts`.
 *   2. **the findings** — worst first, with the age beside the hours that
 *      severity is allowed.
 *   3. **the sources** — which of the six products answered. Not decoration:
 *      with six products behind one aggregator, "no open findings" is only a
 *      fact if the page can also say which of the six answered, and when the
 *      call was refused all six read UNKNOWN and no findings table is drawn at
 *      all.
 *   4. **the provenance** — account, region, partition, principal, the read,
 *      its answer, and when this reading was taken.
 *
 * Every card states what it is AS OF in its supporting line, and every unknown
 * is a sentence rather than a blank: this console refuses to boot without
 * `AWS_ACCOUNT_ID` and `AWS_PARTITION` so that it never invents an estate, and
 * printing a plausible-looking default here would undo that at the last step.
 *
 * ── It renders without AWS ─────────────────────────────────────────────────
 *
 * Nothing below throws when STS and Security Hub are unreachable. `AwsRead`
 * turns every refusal into an arm, `scopeOf` turns a missing account id into a
 * named unknown, and the findings table is not drawn at all when the read did
 * not answer. A console that 500s because it has no credentials is not a
 * refusal an operator can act on.
 */
export default async function SecurityPage() {
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

  const surface = await securityFindings()
  const identity = surface.identity
  const known = identity.state === "ACTUAL" || identity.state === "STALE" ? identity.value : null

  const answered = readAnswered(surface.read.state)
  const lead = leadAnswer(surface.read.state, surface.findings, surface.sources)
  const counts = countBySeverity(surface.findings)
  const rows = sortFindings(surface.findings)
  const reporting = answeredSources(surface.sources)

  const scope = scopeOf({
    identityState: identity.state,
    accountId: known?.accountId,
    region: known?.region,
    partition: known?.partition,
    principal: known?.arn,
  })

  const provenance = provenanceOf({
    identityState: identity.state,
    accountId: known?.accountId,
    region: known?.region,
    partition: known?.partition,
    principal: known?.arn,
    readState: surface.read.state,
    refreshMs: surface.refreshMs,
    asOf: surface.asOf,
    duplicatesRemoved: surface.duplicatesRemoved,
  })

  /**
   * The findings table, as data.
   *
   * Declared here rather than at module scope because `SEVERITY_SLA_HOURS` is
   * read inside the age cell — the age and the allowance belong in one cell, so
   * "104h" is never a number an operator has to hold against a table somewhere
   * else on the page.
   */
  const findingColumns: readonly DataColumn<SecurityFinding>[] = [
    {
      key: "severity",
      header: "Severity",
      cell: (finding) => (
        <div className={styles.cell}>
          <Badge tone={SEVERITY_TONE[finding.severity]}>{finding.severity}</Badge>
          {/* The word, not the tone. Bible §26.3.2 — colour is never the carrier. */}
          {finding.pastSla ? <span className="md3-body-small">past SLA</span> : null}
        </div>
      ),
    },
    {
      key: "finding",
      header: "Finding",
      cell: (finding) => (
        <div className={styles.cell}>
          <span>{finding.title}</span>
          <span className="md3-body-small">
            {finding.product} · first observed{" "}
            <span className={styles.identifier}>{finding.firstObservedAt}</span> · record{" "}
            {finding.recordState}
          </span>
        </div>
      ),
    },
    {
      key: "affects",
      header: "Affects",
      cell: (finding) => (
        <div className={styles.cell}>
          <span>{describeAttribution(finding.affects)}</span>
          {finding.resourceIds.length === 0 ? (
            <span className="md3-body-small">
              the finding carried no resource id, so nothing can be attributed from it
            </span>
          ) : (
            <span className={`md3-body-small ${styles.identifier}`}>
              {finding.resourceIds[0]}
              {finding.resourceIds.length > 1
                ? ` (+${finding.resourceIds.length - 1} more resource${finding.resourceIds.length === 2 ? "" : "s"})`
                : ""}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "age",
      header: "Age",
      align: "end",
      cell: (finding) => (
        <div className={styles.cell}>
          <span>{Math.round(finding.ageHours)}h</span>
          <span className="md3-body-small">
            {Number.isFinite(SEVERITY_SLA_HOURS[finding.severity])
              ? `of ${SEVERITY_SLA_HOURS[finding.severity]}h allowed`
              : "no limit"}
          </span>
        </div>
      ),
    },
  ]

  const sourceColumns: readonly DataColumn<FindingSource>[] = [
    { key: "product", header: "Product", cell: (source) => <span>{source.product}</span> },
    {
      key: "state",
      header: "State",
      cell: (source) => <Badge tone={SOURCE_TONE[source.state]}>{source.state}</Badge>,
    },
    {
      key: "detail",
      header: "What that means",
      cell: (source) => (
        <div className={styles.cell}>
          <span>{source.detail}</span>
          {source.minimumStatement ? (
            <code className={`md3-body-small ${styles.identifier}`}>{source.minimumStatement}</code>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div className={styles.page}>
      <header className={styles.lead}>
        <h1>Security findings</h1>
        {/*
          Which estate this is, before anything is claimed about it.

          Three chips when the identity read answered. When it did not, each of
          the three values is a SENTENCE, and three sentences in three pills is
          how a 320px viewport draws one over the next — so the row is replaced
          by the one line that says the estate is not known and why.
        */}
        {known ? (
          <div className={styles.row}>
            {scope.map((fact) => (
              <Chip key={fact.label}>
                <span>{fact.label}</span>
                <span className={styles.identifier}>{fact.value}</span>
              </Chip>
            ))}
          </div>
        ) : (
          <p className="md3-body-medium">
            {scopeSentence({ identityState: identity.state })}
          </p>
        )}
      </header>

      {/* 1 — the answer. */}
      <Card
        headline={lead.headline}
        headerAside={<Badge tone={lead.tone}>{lead.verdict}</Badge>}
        supportingText={statedAsOf(
          "Read live from Security Hub on every load, across every page of the response",
          surface.asOf,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-medium">{lead.because}</p>

          {/*
            The severity breakdown, and only when the read answered. A row of
            zeroes under a refused read is a set of counts nobody measured.
          */}
          {answered ? (
            <div className={styles.row}>
              {SEVERITY_RANK.map((severity) => (
                <Chip key={severity}>
                  <span>{severity}</span>
                  <span>{counts[severity]}</span>
                </Chip>
              ))}
            </div>
          ) : null}

          {/*
            The governed state, from the one component every AWS-backed surface
            uses. It renders nothing when the read succeeded, and on a denial it
            carries the principal, the action, the error code and the minimum
            IAM statement — which is why it sits with the answer rather than at
            the foot of the page: when the answer is "unknown", the fix is the
            rest of the answer.
          */}
          <AwsReadPanel read={surface.read} what="the security findings" />
        </div>
      </Card>

      {/* 2 — the findings. */}
      <Card
        headline="Open findings"
        headerAside={
          <Badge tone={answered ? (rows.length === 0 ? "ok" : "warn") : "warn"}>
            {answered ? `${rows.length} open` : "not read"}
          </Badge>
        }
        supportingText={statedAsOf(
          answered
            ? "Worst severity first, then whatever is past its allowance, then oldest. Severity is the product's own label and never a guess from a numeric score"
            : "Not shown, because nothing was read",
          surface.asOf,
        )}
      >
        <div className={styles.stack}>
          {answered ? (
            <>
              <DataTable
                caption={`Open security findings — ${asOf(surface.asOf)}`}
                columns={findingColumns}
                rows={rows}
                rowKey={(finding) => finding.key}
                empty={
                  <EmptyState
                    headline="No open findings"
                    description={`Security Hub answered and returned nothing for this account, from ${reporting.length} of ${surface.sources.length} sources. This is a real absence and not a refusal — the sources card below is what makes that difference checkable.`}
                  />
                }
              />

              <details className={styles.disclosure}>
                <summary className="md3-label-large">
                  How long a finding of each severity may stay open
                </summary>
                <dl className={styles.facts}>
                  {slaRows(SEVERITY_SLA_HOURS).map((row) => (
                    <Fragment key={row.severity}>
                      <dt>{row.severity}</dt>
                      <dd>{row.limit}</dd>
                    </Fragment>
                  ))}
                </dl>
              </details>
            </>
          ) : (
            /*
              Deliberately not an empty table. An empty table under a heading
              that says "Open findings" is read as "there are none", which is
              the one thing this page must never say about an estate it could
              not look at.
            */
            <p className="md3-body-medium">
              No findings table is drawn. The read did not answer, so this console knows of no
              finding and of no absence of one; the panel in the card above names what would have
              to be granted for that to change.
            </p>
          )}
        </div>
      </Card>

      {/* 3 — the sources. */}
      <Card
        headline="Which products reported"
        headerAside={
          <Badge tone={reporting.length === surface.sources.length ? "ok" : "warn"}>
            {reporting.length} of {surface.sources.length}
          </Badge>
        }
        supportingText={statedAsOf(
          "Six products publish through Security Hub. An empty findings list means nothing without this table: it could be a clean estate, five products switched off, or a role that cannot call securityhub:GetFindings",
          surface.asOf,
        )}
      >
        <DataTable
          caption={`Finding sources — ${asOf(surface.asOf)}`}
          columns={sourceColumns}
          rows={surface.sources}
          rowKey={(source) => source.product}
          empty={
            <EmptyState
              headline="No sources declared"
              description="This console holds no list of the products that should be reporting, so it cannot tell a complete estate from an unmonitored one. That list is FINDING_PRODUCTS in lib/aws/findings.ts and is never empty in a built image; an empty one here means the module was replaced rather than that the estate has no products."
            />
          }
        />
      </Card>

      {/* 4 — the provenance. */}
      <Card
        headline="Where this reading came from"
        supportingText={statedAsOf(
          "Every value below is from a call this page made, or is named as unknown",
          surface.asOf,
        )}
      >
        <div className={styles.stack}>
          <dl className={styles.facts}>
            {provenance.map((fact) => (
              <Fragment key={fact.label}>
                <dt>{fact.label}</dt>
                <dd className={styles.identifier}>{fact.value}</dd>
              </Fragment>
            ))}
          </dl>

          <details className={styles.disclosure}>
            <summary className="md3-label-large">How this console counts a finding</summary>
            <p className="md3-body-medium">
              Findings are deduplicated on the finding id, the product ARN and the sorted resource
              ids together. Security Hub re-emits a finding on every update and the same GuardDuty
              finding arrives again through the aggregator, so keying on the id alone would merge
              two genuinely different findings that share an id across products, and keying on the
              whole record would merge nothing at all.
            </p>
          </details>
        </div>
      </Card>
    </div>
  )
}
