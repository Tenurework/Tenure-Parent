import { Fragment } from "react"

import {
  Badge,
  Card,
  Chip,
  DataTable,
  EmptyState,
  KeyValue,
  SeverityChip,
  StaleIndicator,
  UnknownState,
  type DataColumn,
  type KeyValueItem,
} from "@/components/md3"
import { auth } from "@/lib/auth"
import { networkReadings } from "@/lib/aws/network"
import {
  describeScheme,
  describeServingState,
  describeTargetHealth,
  describeTlsPosture,
  loadBalancerReadings,
  type ListenerReading,
  type LoadBalancerReading,
  type TargetGroupReading,
  type TargetHealthReading,
} from "@/lib/aws/loadbalancer"
import { isOperator, operatorConfigProblems } from "@/lib/operators"

import styles from "./network.module.css"
import {
  asOf,
  hasValue,
  networkAnswer,
  provenanceOf,
  scopeOf,
  scopeSentence,
  statedAsOf,
  unknownArm,
  type OpenPath,
  type PlaintextListenerRow,
  type SubnetRow,
  type UnattachedRow,
  type UnhealthyTargetRow,
  type VpcRow,
} from "./answer"

export const dynamic = "force-dynamic"

/**
 * STUDIO-070-004 — network: what can reach this estate from the internet, and
 * whether traffic is actually getting to the services.
 *
 * ── The question, and why the shape of the page follows from it ────────────
 *
 * That sentence is at the top of the page in words before any apparatus,
 * because it is the only reason an operator opens this route. Everything below
 * it is arranged to answer it and nothing else, in the order an operator needs
 * it:
 *
 *   1. the answer, in words, with the two numbers it rests on;
 *   2. every security group rule that accepts traffic from `0.0.0.0/0` or
 *      `::/0`, ranked worst first, with the port and what this engine read that
 *      carries the group. **This is the finding the estate cannot currently
 *      see** — `infrastructure/terraform/security_groups.tf` can say what was
 *      INTENDED, and nothing in the running product had ever read what is
 *      actually there;
 *   3. each load balancer, its listeners, and each target group with per-target
 *      health — and the reason code, verbatim, for every unhealthy target,
 *      because `Target.Timeout` and `Target.ResponseCodeMismatch` send an
 *      operator to completely different places;
 *   4. the VPC and subnet layout, public-versus-private decided by the ROUTE
 *      TABLE and printing the route table id beside every verdict;
 *   5. security groups nothing this engine read carries, and every HTTP listener
 *      with no redirect to HTTPS.
 *
 * ── The two readers, and the join that needed both ─────────────────────────
 *
 *   * `networkReadings()` — eight EC2 describes: VPCs, subnets, route tables,
 *     internet and NAT gateways, VPC endpoints, network ACLs and security
 *     groups, each degrading on its own.
 *   * `loadBalancerReadings()` — the ELBv2 listing, plus per-load-balancer
 *     listeners and target groups, plus per-target-group health.
 *
 * `lib/aws/network.ts` says at length that it CANNOT answer "what is this
 * security group attached to": `ec2:DescribeNetworkInterfaces` is not in the
 * capability registry. `lib/aws/loadbalancer.ts` reads `SecurityGroups` on every
 * load balancer it lists. `./answer.ts` joins the two, so an open ingress rule
 * on this page names the load balancer carrying it, and the attached-to-nothing
 * list can EXCLUDE the groups an ALB is holding — and refuses to name a single
 * candidate while the load balancer listing is unread, because a group an
 * internet-facing ALB is carrying must never appear on a list an operator might
 * act on by deleting.
 *
 * ── It renders without AWS ─────────────────────────────────────────────────
 *
 * Nothing here throws when STS, EC2 and ELBv2 are unreachable. Every refusal is
 * an arm of `AwsRead`, every arm renders through the shared `UnknownState`
 * carrying the principal, the action and a pasteable minimum IAM statement, and
 * no table on this page is drawn from a read that did not answer. A console that
 * 500s for want of credentials is not a refusal anyone can act on — and a
 * network page that rendered a refused `DescribeSecurityGroups` as "0 paths from
 * the internet" would be worse than one that 500'd, because it would be
 * believed.
 */

/** Where the decisions are. This page renders them and makes none of its own. */
export default async function NetworkPage() {
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

  // Both readers, both live, and neither able to take the page down: every
  // refusal inside them is an arm of `AwsRead` rather than a throw.
  const network = await networkReadings()
  const balancers = await loadBalancerReadings()
  const answer = networkAnswer(network, balancers)

  const identity = network.identity
  const known = identity.state === "ACTUAL" || identity.state === "STALE" ? identity.value : null

  const scope = scopeOf({
    identityState: identity.state,
    accountId: known?.accountId,
    region: known?.region,
    partition: known?.partition,
  })

  const provenance = provenanceOf({
    identityState: identity.state,
    accountId: known?.accountId,
    region: known?.region,
    partition: known?.partition,
    principal: known?.arn,
    networkAsOf: network.asOf,
    loadBalancerAsOf: balancers.asOf,
    securityGroupsState: network.securityGroups.state,
    loadBalancersState: balancers.loadBalancers.state,
    refreshSecurityGroupsMs: network.refreshMs.securityGroups,
    refreshTargetHealthMs: balancers.refreshMs.targetHealth,
  })

  const securityGroupsUnknown = unknownArm(network.securityGroups)
  const subnetsUnknown = unknownArm(network.subnets)
  const routeTablesUnknown = unknownArm(network.routeTables)
  const vpcsUnknown = unknownArm(network.vpcs)
  const loadBalancersUnknown = unknownArm(balancers.loadBalancers)

  /* ── the tables, as data ───────────────────────────────────────────────── */

  /**
   * One path from the internet.
   *
   * The severity chip carries the WORD as well as the tone — colour alone may
   * not be the carrier of a meaning (WCAG 2.2 AA 1.4.1), and on this table in
   * particular, because "open on 3306" and "open on 443" are the two things a
   * reader must never confuse.
   */
  const pathColumns: readonly DataColumn<OpenPath>[] = [
    {
      key: "severity",
      header: "Severity",
      cell: (path) => (
        <div className={styles.cell}>
          <SeverityChip severity={path.severity}>{path.severity}</SeverityChip>
          <span className="md3-body-small">
            {path.beyondWeb
              ? "beyond HTTP and HTTPS"
              : "HTTP/HTTPS only — a path, and an expected one"}
          </span>
        </div>
      ),
    },
    {
      key: "from",
      header: "From",
      cell: (path) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{path.cidr}</span>
          <span className="md3-body-small">the entire internet</span>
        </div>
      ),
    },
    {
      key: "port",
      header: "Protocol and port",
      cell: (path) => (
        <div className={styles.cell}>
          <span>
            {path.protocolLabel} — {path.ports}
          </span>
          {path.sensitive.length > 0 ? (
            <span className="md3-body-small">covers {path.sensitive.join(", ")}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "group",
      header: "Security group",
      cell: (path) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{path.groupId}</span>
          <span className="md3-body-small">{path.groupName ?? "no group name reported"}</span>
          <span className={`md3-body-small ${styles.identifier}`}>
            {path.vpcId ?? "no VPC reported"}
          </span>
        </div>
      ),
    },
    {
      key: "attached",
      header: "Attached to",
      cell: (path) => <div className={styles.cell}>{path.attachedTo}</div>,
    },
    {
      key: "reach",
      header: "What it means",
      cell: (path) => <div className={styles.cell}>{path.reach}</div>,
    },
  ]

  /** One target the load balancer refuses, with AWS's reason code verbatim. */
  const unhealthyColumns: readonly DataColumn<UnhealthyTargetRow>[] = [
    {
      key: "severity",
      header: "Severity",
      cell: (row) => <SeverityChip severity={row.severity}>{row.severity}</SeverityChip>,
    },
    {
      key: "target",
      header: "Target",
      cell: (row) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{row.targetId}</span>
          <span className="md3-body-small">
            {row.port === null ? "no port reported" : `port ${row.port}`}
          </span>
        </div>
      ),
    },
    {
      key: "state",
      header: "State",
      cell: (row) => <div className={styles.cell}>{row.state}</div>,
    },
    {
      key: "reason",
      header: "Reason code",
      cell: (row) => (
        <div className={styles.cell}>
          {/*
            The reason code, exactly as AWS spelled it, or the sentence saying
            AWS gave none. Never an empty cell and never `""` — this is the one
            token that decides where an operator goes next.
          */}
          {row.reasonCode === null ? (
            <span>AWS reported no reason code</span>
          ) : (
            <span className={styles.identifier}>{row.reasonCode}</span>
          )}
          <span className="md3-body-small">{row.description}</span>
        </div>
      ),
    },
    {
      key: "where",
      header: "Where",
      cell: (row) => (
        <div className={styles.cell}>
          <span>{row.targetGroupName}</span>
          <span className="md3-body-small">behind {row.loadBalancerName}</span>
        </div>
      ),
    },
  ]

  const plaintextColumns: readonly DataColumn<PlaintextListenerRow>[] = [
    {
      key: "severity",
      header: "Severity",
      cell: (row) => <SeverityChip severity={row.severity}>{row.severity}</SeverityChip>,
    },
    {
      key: "listener",
      header: "Listener",
      cell: (row) => (
        <div className={styles.cell}>
          <span>
            {row.loadBalancerName} — {row.protocol ?? "protocol unstated"} on{" "}
            {row.port === null ? "an unstated port" : `port ${row.port}`}
          </span>
          <span className={`md3-body-small ${styles.identifier}`}>{row.listenerArn}</span>
        </div>
      ),
    },
    {
      key: "scheme",
      header: "Scheme",
      cell: (row) => <div className={styles.cell}>{row.scheme}</div>,
    },
    {
      key: "why",
      header: "What was established",
      cell: (row) => <div className={styles.cell}>{row.why}</div>,
    },
  ]

  /**
   * One subnet, with the evidence for its verdict beside it.
   *
   * The evidence column is not decoration. Public-versus-private is decided by
   * the ROUTE TABLE in `lib/aws/network.ts`, and printing the route table id and
   * the association that produced each verdict is what lets an operator check
   * the classifier rather than trust it.
   */
  const subnetColumns: readonly DataColumn<SubnetRow>[] = [
    {
      key: "verdict",
      header: "Reachable from the internet",
      cell: (row) => (
        <div className={styles.cell}>
          <Badge tone={row.tone}>{row.verdict}</Badge>
          {row.misnamed ? (
            <span className="md3-body-small">
              MISNAMED — its name says private and its routes say public. The name is wrong, not
              the route.
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "subnet",
      header: "Subnet",
      cell: (row) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{row.subnetId}</span>
          <span className="md3-body-small">{row.name ?? "no Name tag"}</span>
          <span className={`md3-body-small ${styles.identifier}`}>
            {row.vpcId ?? "no VPC reported"}
          </span>
        </div>
      ),
    },
    {
      key: "where",
      header: "CIDR and zone",
      cell: (row) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{row.cidr ?? "no CIDR reported"}</span>
          <span className="md3-body-small">
            {row.availabilityZone ?? "no availability zone reported"}
          </span>
          <span className="md3-body-small">{row.availableIps} addresses free</span>
        </div>
      ),
    },
    {
      key: "evidence",
      header: "Decided by",
      cell: (row) => (
        <div className={styles.cell}>
          <span>{row.evidence}</span>
          <span className="md3-body-small">
            Public IP on launch: {row.autoAssignsPublicIp}. That is what happens to a NEW
            interface, and is evidence rather than the classifier.
          </span>
        </div>
      ),
    },
  ]

  const vpcColumns: readonly DataColumn<VpcRow>[] = [
    {
      key: "vpc",
      header: "VPC",
      cell: (row) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{row.vpcId}</span>
          <span className="md3-body-small">{row.name ?? "no Name tag"}</span>
          {row.isDefault ? (
            <span className="md3-body-small">the account default VPC</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "cidr",
      header: "CIDRs",
      cell: (row) => <div className={`${styles.cell} ${styles.identifier}`}>{row.cidrs}</div>,
    },
    {
      key: "state",
      header: "State",
      cell: (row) => <div className={styles.cell}>{row.state ?? "AWS did not report a state"}</div>,
    },
    {
      key: "subnets",
      header: "Subnets",
      align: "end",
      cell: (row) => (
        <div className={styles.cell}>
          <span>
            {row.publicSubnets} public, {row.privateSubnets} private
          </span>
          <span className="md3-body-small">
            {row.unknownSubnets === 0
              ? "every subnet classified"
              : `${row.unknownSubnets} not classified — the route tables did not answer for them`}
          </span>
        </div>
      ),
    },
  ]

  const unattachedColumns: readonly DataColumn<UnattachedRow>[] = [
    {
      key: "group",
      header: "Security group",
      cell: (row) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{row.groupId}</span>
          <span className="md3-body-small">{row.groupName ?? "no group name reported"}</span>
        </div>
      ),
    },
    {
      key: "vpc",
      header: "VPC",
      cell: (row) => (
        <div className={`${styles.cell} ${styles.identifier}`}>
          {row.vpcId ?? "no VPC reported"}
        </div>
      ),
    },
    {
      key: "open",
      header: "Open to the internet",
      cell: (row) => (
        <Badge tone={row.openToInternet ? "warn" : "neutral"}>
          {row.openToInternet ? "yes" : "no world-reachable rule"}
        </Badge>
      ),
    },
    {
      key: "why",
      header: "What this engine can say",
      cell: (row) => <div className={styles.cell}>{row.why}</div>,
    },
  ]

  const listenerColumns: readonly DataColumn<ListenerReading>[] = [
    {
      key: "port",
      header: "Port",
      cell: (listener) => (
        <div className={styles.cell}>
          <span>{listener.port === null ? "unstated" : listener.port}</span>
          <span className="md3-body-small">{listener.protocol ?? "protocol unstated"}</span>
        </div>
      ),
    },
    {
      key: "tls",
      header: "TLS",
      cell: (listener) => <div className={styles.cell}>{describeTlsPosture(listener.tls)}</div>,
    },
    {
      key: "action",
      header: "Default action",
      cell: (listener) => (
        <div className={styles.cell}>
          <span>
            {listener.defaultActionTypes.length === 0
              ? "AWS reported no default action"
              : listener.defaultActionTypes.join(", ")}
          </span>
          {listener.forwardsTo.length > 0 ? (
            <span className={`md3-body-small ${styles.identifier}`}>
              forwards to {listener.forwardsTo.join(", ")}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "arn",
      header: "Listener",
      cell: (listener) => (
        <div className={`${styles.cell} ${styles.identifier}`}>{listener.arn}</div>
      ),
    },
  ]

  const targetGroupColumns: readonly DataColumn<TargetGroupReading>[] = [
    {
      key: "group",
      header: "Target group",
      cell: (group) => (
        <div className={styles.cell}>
          <span>{group.name ?? "no name reported"}</span>
          <span className="md3-body-small">
            {group.protocol ?? "protocol unstated"} on{" "}
            {group.port === null ? "an unstated port" : `port ${group.port}`} ·{" "}
            {group.targetType ?? "target type unstated"}
          </span>
          <span className={`md3-body-small ${styles.identifier}`}>{group.arn}</span>
        </div>
      ),
    },
    {
      key: "check",
      header: "Health check",
      cell: (group) => (
        <div className={styles.cell}>
          <span>
            {group.healthCheck.protocol ?? "protocol unstated"}{" "}
            {group.healthCheck.path ?? "(no path reported)"}
          </span>
          <span className="md3-body-small">
            {group.healthCheck.intervalSeconds === null
              ? "interval not reported"
              : `every ${group.healthCheck.intervalSeconds}s`}
            {group.healthCheck.matcher === null
              ? ", no matcher reported"
              : `, healthy on ${group.healthCheck.matcher}`}
          </span>
        </div>
      ),
    },
    {
      key: "serving",
      header: "Serving",
      cell: (group) => <div className={styles.cell}>{describeServingState(group.serving)}</div>,
    },
    {
      key: "targets",
      header: "Per target",
      cell: (group) => <TargetHealthCell group={group} />,
    },
  ]

  const loadBalancers = hasValue(balancers.loadBalancers) ? balancers.loadBalancers.value : []

  return (
    <div className={styles.page}>
      <header className={styles.lead}>
        <h1 className="md3-headline-large">Network</h1>
        {/*
          The question, in words, before any apparatus. It is the whole reason
          this route exists and it is the sentence every card below is arranged
          to answer.
        */}
        <p className="md3-title-medium">
          What can reach this estate from the internet, and is traffic actually getting to the
          services?
        </p>
        <p className="md3-body-large">{answer.lead.headline}</p>
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
          <p className="md3-body-medium">{scopeSentence({ identityState: identity.state })}</p>
        )}
      </header>

      {/* 1 — the answer, and the two reads it rests on. */}
      <Card
        headline={answer.lead.verdict}
        headerAside={<Badge tone={answer.lead.tone}>{answer.lead.verdict}</Badge>}
        supportingText={statedAsOf(
          "Read live on every load: eight EC2 describes for the VPC network, and the ELBv2 listing with per-load-balancer listeners, target groups and target health",
          network.asOf,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-medium">{answer.lead.because}</p>

          {answer.paths.kind === "known" ? (
            <div className={styles.row}>
              <Chip>
                <span>Paths from the internet</span>
                <span>{answer.paths.paths.length}</span>
              </Chip>
              <Chip>
                <span>Beyond 80/443</span>
                <span>{answer.paths.beyondWeb}</span>
              </Chip>
              <Chip>
                <span>Security groups read</span>
                <span>{answer.paths.groupsRead}</span>
              </Chip>
              <Chip>
                <span>Targets healthy</span>
                <span>{answer.tally.healthy}</span>
              </Chip>
              <Chip>
                <span>Targets not served</span>
                <span>{answer.tally.notServing}</span>
              </Chip>
            </div>
          ) : (
            /*
              Deliberately not a row of zeroes. A count nobody measured, drawn
              beside counts that were, is read as a measurement.
            */
            <p className="md3-body-medium">
              No count is shown. The security groups were not read, so this console knows of no
              path from the internet and of no absence of one.
            </p>
          )}

          <p className="md3-body-medium">{answer.serving.why}</p>

          {/*
            The governed state of each read, through the shared primitive. It is
            rendered nowhere at all when a read succeeded, and on a denial it
            carries the principal, the action, the error code and the minimum IAM
            statement — which is why it sits with the answer rather than at the
            foot of the page: when the answer is "unknown", the fix is the rest of
            the answer.
          */}
          {securityGroupsUnknown ? (
            <UnknownState what="the security groups" read={securityGroupsUnknown} />
          ) : null}
          {loadBalancersUnknown ? (
            <UnknownState what="the load balancers" read={loadBalancersUnknown} />
          ) : null}
        </div>
      </Card>

      {/* 2 — the finding the estate cannot currently see. First, and hardest. */}
      <Card
        headline="Open to the internet"
        headerAside={
          answer.paths.kind === "known" ? (
            <Badge tone={answer.paths.beyondWeb > 0 ? "bad" : "ok"}>
              {answer.paths.beyondWeb} beyond 80/443
            </Badge>
          ) : (
            <Badge tone="warn">not read</Badge>
          )
        }
        supportingText={statedAsOf(
          "Every security group rule that accepts traffic from 0.0.0.0/0 or ::/0, worst first. A rule spanning 80–443 is listed as open beyond the web ports because it also opens 81 through 442 — the range is what is read, never the two endpoints",
          network.asOf,
        )}
      >
        <div className={styles.stack}>
          {answer.paths.kind === "known" ? (
            <>
              {answer.paths.truncated ? (
                <p className="md3-body-medium">
                  The security-group walk stopped at its page cap. What follows is not every group
                  in this account, and an empty finding list under it would not mean the estate is
                  closed.
                </p>
              ) : null}
              <DataTable
                caption={`Paths from the internet, ranked — ${asOf(network.asOf)}`}
                columns={pathColumns}
                rows={answer.paths.paths}
                rowKey={(path) => path.key}
                empty={
                  <EmptyState
                    headline="Nothing accepts traffic from the whole internet"
                    description={`All ${answer.paths.groupsRead} security group(s) answered and not one of them has an ingress rule whose source is 0.0.0.0/0 or ::/0 — not on 80 or 443 either. This is an absence found by a read that ran.`}
                  />
                }
              />
            </>
          ) : (
            /*
              Not an empty table. An empty table under a heading that says what
              can reach this estate is read as "nothing can", which is the one
              thing this page must never say about groups it could not look at.
            */
            <>
              <p className="md3-body-medium">
                No table is drawn. {answer.paths.why} This console therefore knows of no path from
                the internet into this estate and of no absence of one; the panel below names what
                would have to be granted for that to change.
              </p>
              {securityGroupsUnknown ? (
                <UnknownState what="the security groups" read={securityGroupsUnknown} />
              ) : null}
            </>
          )}
        </div>
      </Card>

      {/* 3 — is traffic getting through: the targets that are refused. */}
      <Card
        headline="Targets not being served"
        headerAside={
          <Badge tone={answer.tally.notServing > 0 ? "bad" : hasValue(balancers.loadBalancers) ? "ok" : "warn"}>
            {answer.tally.notServing} of {answer.tally.healthy + answer.tally.notServing}
          </Badge>
        }
        supportingText={statedAsOf(
          "The reason code is AWS's own string and is printed verbatim: Target.Timeout means the application did not answer at all, Target.ResponseCodeMismatch means it answered with a status the matcher rejects, and those are two different places to go. ECS reporting a task as RUNNING says nothing about this table",
          balancers.asOf,
        )}
        actions={
          <StaleIndicator
            asOf={balancers.asOf}
            cadenceMs={balancers.refreshMs.targetHealth}
            label="Target health"
          />
        }
      >
        <DataTable
          caption={`Targets the load balancer will not route to — ${asOf(balancers.asOf)}`}
          columns={unhealthyColumns}
          rows={answer.unhealthy}
          rowKey={(row) => row.key}
          empty={
            <EmptyState
              headline={
                hasValue(balancers.loadBalancers)
                  ? "No target group that answered has a refused target"
                  : "No table — the load balancers were not read"
              }
              description={answer.serving.why}
            />
          }
        />
      </Card>

      {/* 4 — each load balancer, its listeners and its target groups. */}
      <Card
        headline="Load balancers, listeners and target groups"
        headerAside={
          <Badge tone={hasValue(balancers.loadBalancers) ? "info" : "warn"}>
            {hasValue(balancers.loadBalancers)
              ? `${loadBalancers.length} read`
              : balancers.loadBalancers.state}
          </Badge>
        }
        supportingText={statedAsOf(
          "Listeners and target groups are separate IAM actions from the listing and each degrades on its own — a refused DescribeTargetHealth leaves the load balancer row intact and is never rendered as zero unhealthy targets",
          balancers.asOf,
        )}
      >
        <div className={styles.stack}>
          {loadBalancersUnknown ? (
            <UnknownState what="the load balancers" read={loadBalancersUnknown} />
          ) : null}

          {balancers.loadBalancers.state === "EMPTY" ? (
            <EmptyState
              headline="No v2 load balancer in this account and region"
              description="elasticloadbalancing:DescribeLoadBalancers answered and returned none. This engine does not read Classic load balancers, so this says nothing about those."
            />
          ) : null}

          {loadBalancers.map((lb) => (
            <LoadBalancerPanel
              key={lb.arn}
              lb={lb}
              listenerColumns={listenerColumns}
              targetGroupColumns={targetGroupColumns}
            />
          ))}
        </div>
      </Card>

      {/* 5 — plaintext listeners, split by whether the finding was established. */}
      <Card
        headline="HTTP listeners with no redirect to HTTPS"
        headerAside={
          <Badge tone={answer.plaintext.confirmed.length > 0 ? "bad" : "ok"}>
            {answer.plaintext.confirmed.length} established
          </Badge>
        }
        supportingText={statedAsOf(
          "A redirect can live in the listener's default action OR in a listener rule, and rules are a separate IAM action. A listener whose rules could not be read is in the second table and NOT in the first — reporting a finding this engine did not establish is the same defect as suppressing one it did",
          balancers.asOf,
        )}
      >
        <div className={styles.stack}>
          <DataTable
            caption={`Plaintext listeners, established — ${asOf(balancers.asOf)}`}
            columns={plaintextColumns}
            rows={answer.plaintext.confirmed}
            rowKey={(row) => row.key}
            empty={
              <EmptyState
                headline="No listener was established to serve plaintext without a redirect"
                description="Of the listeners that were read, none speaks HTTP with neither a redirect in its default action nor a redirect in any listener rule. Listeners whose rules could not be read are in the table below rather than here."
              />
            }
          />

          <DataTable
            caption={`Plaintext listeners whose rules were not read — ${asOf(balancers.asOf)}`}
            columns={plaintextColumns}
            rows={answer.plaintext.unknown}
            rowKey={(row) => row.key}
            empty={
              <EmptyState
                headline="No listener is in doubt"
                description="Every plaintext listener that was read had its listener rules read too, so each of them is either established as a finding above or established as redirecting."
              />
            }
          />
        </div>
      </Card>

      {/* 6 — the layout, decided by the route table and printing its evidence. */}
      <Card
        headline="VPC and subnet layout"
        headerAside={
          <Badge tone={answer.subnets.some((row) => row.verdict === "PUBLIC") ? "info" : "neutral"}>
            {answer.subnets.filter((row) => row.verdict === "PUBLIC").length} public
          </Badge>
        }
        supportingText={statedAsOf(
          "Public versus private is decided by the ROUTE TABLE the subnet actually uses — the one explicitly associated with it, or the VPC's main table when nobody associated one — and never by the subnet's name. A route counts only when its state is active: a blackholed route to a detached gateway carries no packet. The route table id that produced each verdict is printed beside it",
          network.asOf,
        )}
      >
        <div className={styles.stack}>
          {vpcsUnknown ? <UnknownState what="the VPCs" read={vpcsUnknown} /> : null}
          {subnetsUnknown ? <UnknownState what="the subnets" read={subnetsUnknown} /> : null}
          {routeTablesUnknown ? (
            <UnknownState what="the route tables" read={routeTablesUnknown} />
          ) : null}

          <DataTable
            caption={`VPCs — ${asOf(network.asOf)}`}
            columns={vpcColumns}
            rows={answer.vpcs}
            rowKey={(row) => row.key}
            empty={
              <EmptyState
                headline="No VPC table"
                description="Either ec2:DescribeVpcs answered with no VPC in this region, or it did not answer at all. The panels above say which, and an unanswered read is never drawn as an empty estate."
              />
            }
          />

          <DataTable
            caption={`Subnets, with the route table that decided each verdict — ${asOf(network.asOf)}`}
            columns={subnetColumns}
            rows={answer.subnets}
            rowKey={(row) => row.key}
            empty={
              <EmptyState
                headline="No subnet table"
                description="Either ec2:DescribeSubnets answered with no subnet in this region, or it did not answer at all. A subnet whose route table could not be read is listed as unknown rather than private — those are two different facts and only one of them is reassuring."
              />
            }
          />

          {network.contradictoryNames.length > 0 ? (
            <div className={styles.stack}>
              <h3 className="md3-title-medium">Subnets whose name contradicts their routes</h3>
              {network.contradictoryNames.map((contradiction) => (
                <p key={contradiction.subnetId} className="md3-body-medium">
                  {contradiction.why}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </Card>

      {/* 7 — groups nothing this engine read carries. Candidates, not findings. */}
      <Card
        headline="Security groups nothing this engine read carries"
        headerAside={
          <Badge tone={answer.unattached.kind === "candidates" ? "info" : "warn"}>
            {answer.unattached.kind === "candidates"
              ? `${answer.unattached.groups.length} candidates`
              : "not established"}
          </Badge>
        }
        supportingText={statedAsOf(
          "Composed from both readers: the security groups that no VPC endpoint and no other group's rule names, minus the ones a load balancer this engine read is carrying. ec2:DescribeNetworkInterfaces is the only call that settles attachment and this engine does not hold it, so every row is a candidate",
          network.asOf,
        )}
      >
        {answer.unattached.kind === "candidates" ? (
          <div className={styles.stack}>
            <p className="md3-body-medium">{answer.unattached.caveat}</p>
            <DataTable
              caption={`Drift candidates — ${asOf(network.asOf)}`}
              columns={unattachedColumns}
              rows={answer.unattached.groups}
              rowKey={(row) => row.key}
              empty={
                <EmptyState
                  headline="Every security group that was read is carried by something that was read"
                  description="A load balancer, a VPC endpoint or another group's rule names each of them. That is not a proof of use for the whole account — it is the strongest claim the eight reads on this page can make."
                />
              }
            />
          </div>
        ) : (
          <p className="md3-body-medium">
            No list is drawn. {answer.unattached.why}
          </p>
        )}
      </Card>

      {/* 8 — the provenance. */}
      <Card
        headline="Where this reading came from"
        supportingText={statedAsOf(
          "Every value below is from a call this page made, or is named as unknown. Region and partition come from the resolved identity and from each resource's own owner — there is no literal region on this page",
          network.asOf,
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
            <summary className="md3-label-large">How this page grades a path</summary>
            <div className={styles.stack}>
              <p className="md3-body-medium">
                A rule from 0.0.0.0/0 or ::/0 with no port concept at all — every protocol, or
                ICMP — is critical: nothing bounds what it reaches. A rule whose port range covers
                a registered sensitive default is critical too, and the row names which service
                that port belongs to; the range is what is checked, so a rule spanning 3000–4000
                is critical for covering 3306 even though neither endpoint is it. Any other rule
                open past 80 and 443 is high. A rule on 80 or 443 alone is low — it is still a
                path from the internet, it is still listed, and on a load balancer it is expected.
              </p>
              <p className="md3-body-medium">
                No arm returns informational. Every row in that table is a rule accepting packets
                from the entire internet, and none of those is informational.
              </p>
            </div>
          </details>

          <details className={styles.disclosure}>
            <summary className="md3-label-large">What this page does not read</summary>
            <div className={styles.stack}>
              <p className="md3-body-medium">
                Network interfaces. ec2:DescribeNetworkInterfaces is the only call that answers
                &ldquo;what is this security group attached to&rdquo; and it is not one this engine
                holds, so this page says which resources it READ that carry a group and never that
                a group is unused.
              </p>
              <p className="md3-body-medium">
                Managed prefix list entries. A rule whose source is a prefix list is shown as that
                list and is not graded: the list can contain public ranges,
                ec2:GetManagedPrefixListEntries would say so, and this engine does not hold it.
                Grading it either way would be a claim nobody made.
              </p>
              <p className="md3-body-medium">
                Classic load balancers, and load balancer attributes — which is where access
                logging lives. Neither is in the capability registry.
              </p>
            </div>
          </details>
        </div>
      </Card>
    </div>
  )
}

/**
 * One load balancer: what it is, its listeners, and its target groups.
 *
 * A component rather than a loop body so that each of the three sub-reads can
 * degrade on its own inside it. A refused `DescribeListeners` renders an
 * `UnknownState` where the listener table would be, and leaves the target groups
 * beside it untouched.
 */
function LoadBalancerPanel({
  lb,
  listenerColumns,
  targetGroupColumns,
}: {
  lb: LoadBalancerReading
  listenerColumns: readonly DataColumn<ListenerReading>[]
  targetGroupColumns: readonly DataColumn<TargetGroupReading>[]
}) {
  const listenersUnknown = unknownArm(lb.listeners)
  const groupsUnknown = unknownArm(lb.targetGroups)
  const facts: readonly KeyValueItem[] = [
    { key: "scheme", term: "Scheme", value: describeScheme(lb.scheme) },
    { key: "type", term: "Type", value: lb.type ?? "AWS did not state a type" },
    { key: "state", term: "State", value: lb.stateCode ?? "AWS did not state one" },
    { key: "dns", term: "DNS name", value: lb.dnsName ?? "AWS did not report one" },
    { key: "vpc", term: "VPC", value: lb.vpcId ?? "AWS did not report one" },
    {
      key: "subnets",
      term: "Subnets",
      value: lb.subnetIds.length > 0 ? lb.subnetIds.join(", ") : "AWS reported none",
    },
    {
      key: "groups",
      term: "Security groups",
      value:
        lb.securityGroupIds.length > 0
          ? lb.securityGroupIds.join(", ")
          : "AWS reported none — which for a network load balancer is expected",
    },
    {
      key: "where",
      term: "Region",
      value:
        lb.region && lb.partition
          ? `${lb.region} (partition ${lb.partition})`
          : "not known — the identity read did not answer and the ARN did not carry one",
    },
  ]

  return (
    <section className={styles.stack}>
      <h3 className="md3-title-medium">{lb.name ?? lb.arn}</h3>
      <p className={`md3-body-small ${styles.identifier}`}>{lb.arn}</p>
      <KeyValue items={facts} ariaLabel={`${lb.name ?? lb.arn} facts`} />

      {listenersUnknown ? (
        <UnknownState what={`${lb.name ?? lb.arn} listeners`} read={listenersUnknown} />
      ) : (
        <DataTable
          caption={`${lb.name ?? lb.arn} listeners — ${asOf(lb.asOf)}`}
          columns={listenerColumns}
          rows={hasValue(lb.listeners) ? lb.listeners.value : []}
          rowKey={(listener) => listener.arn}
          empty={
            <EmptyState
              headline="No listener"
              description="elasticloadbalancing:DescribeListeners answered and this load balancer has none, so it is not serving anything at all."
            />
          }
        />
      )}

      {groupsUnknown ? (
        <UnknownState what={`${lb.name ?? lb.arn} target groups`} read={groupsUnknown} />
      ) : (
        <DataTable
          caption={`${lb.name ?? lb.arn} target groups — ${asOf(lb.asOf)}`}
          columns={targetGroupColumns}
          rows={hasValue(lb.targetGroups) ? lb.targetGroups.value : []}
          rowKey={(group) => group.arn}
          empty={
            <EmptyState
              headline="No target group attached"
              description="elasticloadbalancing:DescribeTargetGroups answered and nothing is attached to this load balancer. A target group that exists but is attached to no load balancer is not read by this engine at all and is not being claimed absent."
            />
          }
        />
      )}
    </section>
  )
}

/**
 * Per-target health inside a target group row.
 *
 * Its own component because the health read is its own `AwsRead`: a refused
 * `DescribeTargetHealth` renders as an unknown in this one cell and does not
 * collapse the target group row, and — the part that matters — is never drawn as
 * an empty target list, which reads as "nothing is registered".
 */
function TargetHealthCell({ group }: { group: TargetGroupReading }) {
  const unknown = unknownArm(group.health)
  if (unknown) {
    return <UnknownState what={`${group.name ?? group.arn} target health`} read={unknown} />
  }
  if (group.health.state === "EMPTY") {
    return (
      <div className={styles.cell}>
        <span>No registered target.</span>
        <span className="md3-body-small">
          The health call answered and this group holds nothing, which serves nothing — and is not
          the same as its targets being unhealthy.
        </span>
      </div>
    )
  }
  const targets: readonly TargetHealthReading[] = hasValue(group.health) ? group.health.value : []
  return (
    <div className={styles.cell}>
      {targets.map((target) => (
        <span key={target.targetId} className={styles.identifier}>
          {describeTargetHealth(target)}
        </span>
      ))}
    </div>
  )
}
