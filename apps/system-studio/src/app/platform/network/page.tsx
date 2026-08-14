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
import { cdnReadings, describeTlsFloor, describeTruncation } from "@/lib/aws/cdn"
import { certificateReadings } from "@/lib/aws/certificates"
import { describePagination, describeZoneAttribution, dnsReadings } from "@/lib/aws/dns"
import { WAF_REMEDY, describeCoverage, wafReadings } from "@/lib/aws/waf"
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
import { PermissionDeniedState } from "@/components/states"
import { operatorConfigProblems } from "@/lib/operators"
import { authorizeCommand } from "@/lib/authorize"

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
  type Fact,
  type OpenPath,
  type PlaintextListenerRow,
  type SubnetRow,
  type UnattachedRow,
  type UnhealthyTargetRow,
  type VpcRow,
} from "./answer"
import {
  edgeAnswer,
  unknownLegs,
  type CertificateRow,
  type EdgeChain,
} from "./edge"

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
  // STUDIO-020-006. A command decision, not a membership test: `isOperator` is
  // exactly `roleOf(...) !== null`, so it carries no resource and no verb and
  // every operator family — auditor-read-only included — decides the same.
  // `platform.read` is what /platform itself decides with, and this is one of
  // its surfaces.
  const decision = authorizeCommand("platform.read", { principalId: session?.user?.email })
  if (decision.reason === "NO_PRINCIPAL") {
    const { redirect } = await import("next/navigation")
    redirect("/signin")
  }
  if (!decision.allowed) return <PermissionDeniedState />

  // Both readers, both live, and neither able to take the page down: every
  // refusal inside them is an arm of `AwsRead` rather than a throw.
  const network = await networkReadings()
  const balancers = await loadBalancerReadings()
  const answer = networkAnswer(network, balancers)

  /*
    The edge, from four more readers that until now reached no screen at all.
    Read in parallel because they share nothing but the identity call, and each
    one degrades on its own: a refused `wafv2:ListWebACLs` leaves the DNS chain
    intact and is never rendered as "no WAF is attached", which would be this
    console inventing a finding.
  */
  const [cdn, dns, certificates, waf] = await Promise.all([
    cdnReadings(),
    dnsReadings(),
    certificateReadings(),
    wafReadings(),
  ])
  const edge = edgeAnswer(cdn, dns, certificates, waf)

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

  const distributionsUnknown = unknownArm(cdn.distributions)
  const zonesUnknown = unknownArm(dns.zones)
  const certificatesUnknown = unknownArm(certificates.certificates)
  const wafRegionalUnknown = unknownArm(waf.regional)
  const wafCloudFrontUnknown = unknownArm(waf.cloudfront)

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

  /* ── the edge chain, as a table whose ROW is the chain ─────────────────── */

  /**
   * One path from a hostname to an origin, with every leg in its own column.
   *
   * This is the whole argument of the edge section: four tables cannot say why a
   * hostname is dark, because the answer lives in the JOIN. A row here reads
   * left to right the way a request travels — DNS record, distribution,
   * certificate, web ACL, origin — and every cell that could not be read says so
   * in words rather than being blank, because a blank cell in a chain is read as
   * a leg that is fine.
   */
  const chainColumns: readonly DataColumn<EdgeChain>[] = [
    {
      key: "severity",
      header: "Severity",
      cell: (chain) => (
        <div className={styles.cell}>
          {chain.severity === null ? (
            <Badge tone={unknownLegs(chain).length > 0 ? "warn" : "ok"}>
              {unknownLegs(chain).length > 0 ? "not established" : "no break"}
            </Badge>
          ) : (
            <SeverityChip severity={chain.severity}>{chain.severity}</SeverityChip>
          )}
          {unknownLegs(chain).length > 0 ? (
            <span className="md3-body-small">
              {unknownLegs(chain).join(", ")} unread — this row is not a clean bill
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "dns",
      header: "1. DNS",
      cell: (chain) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{chain.host ?? "no alternate domain name"}</span>
          <span className="md3-body-small">
            {chain.dns.kind === "resolves"
              ? `${chain.dns.recordType} by ${chain.dns.via} in ${chain.dns.zoneName} — resolves to this distribution`
              : chain.dns.kind === "dangling"
                ? `DANGLING — points at ${chain.dns.target}, which this account does not own`
                : chain.dns.kind === "elsewhere"
                  ? `points at ${chain.dns.target} — ${chain.dns.what}`
                  : chain.dns.kind === "no-record"
                    ? `no address record in ${chain.dns.zoneName}`
                    : chain.dns.kind === "no-zone"
                      ? "no hosted zone here covers it"
                      : chain.dns.kind === "no-alias"
                        ? "reached only at its own CloudFront domain"
                        : `unknown — ${chain.dns.why}`}
          </span>
        </div>
      ),
    },
    {
      key: "distribution",
      header: "2. Distribution",
      cell: (chain) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{chain.distributionId}</span>
          <span className={`md3-body-small ${styles.identifier}`}>
            {chain.distributionDomain ?? "no domain name reported"}
          </span>
          <span className="md3-body-small">
            {chain.enabled === null
              ? "enabled state not reported"
              : chain.enabled
                ? `enabled, ${chain.status ?? "status not reported"}`
                : "DISABLED — it serves nothing"}
          </span>
          {chain.tls === null ? null : (
            <span className="md3-body-small">{describeTlsFloor(chain.tls)}</span>
          )}
        </div>
      ),
    },
    {
      key: "certificate",
      header: "3. Certificate",
      cell: (chain) => (
        <div className={styles.cell}>
          {chain.certificate.kind === "acm" ? (
            <>
              <span className={styles.identifier}>{chain.certificate.domainName}</span>
              <span className="md3-body-small">
                {chain.certificate.status} — {chain.certificate.expiry}
              </span>
              <span className="md3-body-small">{chain.certificate.validation}</span>
            </>
          ) : chain.certificate.kind === "cloudfront-default" ? (
            <span className="md3-body-small">{chain.certificate.why}</span>
          ) : chain.certificate.kind === "iam" ? (
            <span className="md3-body-small">{chain.certificate.why}</span>
          ) : chain.certificate.kind === "not-in-listing" ? (
            <>
              <span className={styles.identifier}>{chain.certificate.arn}</span>
              <span className="md3-body-small">{chain.certificate.why}</span>
            </>
          ) : (
            <span className="md3-body-small">Unknown — {chain.certificate.why}</span>
          )}
        </div>
      ),
    },
    {
      key: "waf",
      header: "4. Web ACL",
      cell: (chain) => (
        <div className={styles.cell}>
          {chain.waf.kind === "attached" ? (
            <>
              <span className={styles.identifier}>
                {chain.waf.name ?? chain.waf.webAclId}
              </span>
              <span className="md3-body-small">
                {chain.waf.blocking === null
                  ? "attached — whether any rule blocks was not readable"
                  : chain.waf.blocking
                    ? "attached, and at least one rule blocks"
                    : "attached, and NOT ONE rule blocks"}
              </span>
            </>
          ) : chain.waf.kind === "none" ? (
            <span className="md3-body-small">NO WEB ACL — {chain.waf.why}</span>
          ) : chain.waf.kind === "classic" ? (
            <span className="md3-body-small">WAF Classic {chain.waf.id} — {chain.waf.why}</span>
          ) : (
            <span className="md3-body-small">Unknown — {chain.waf.why}</span>
          )}
        </div>
      ),
    },
    {
      key: "origin",
      header: "5. Origin",
      cell: (chain) => (
        <div className={styles.cell}>
          {chain.origin.kind === "unknown" ? (
            <span className="md3-body-small">Unknown — {chain.origin.why}</span>
          ) : (
            <>
              <span className={styles.identifier}>{chain.origin.origins.join(", ")}</span>
              <span className="md3-body-small">
                {chain.origin.kind === "encrypted"
                  ? "TLS from the edge to the origin"
                  : chain.origin.why}
              </span>
            </>
          )}
        </div>
      ),
    },
    {
      key: "break",
      header: "Where it breaks",
      cell: (chain) => (
        <div className={styles.cell}>
          {chain.breaks.length === 0 ? (
            <span className="md3-body-small">
              {unknownLegs(chain).length > 0
                ? "No break was established, and this chain has a leg nobody read."
                : "Every leg was read and none of them is broken."}
            </span>
          ) : (
            chain.breaks.map((brk) => (
              <span key={brk.code} className="md3-body-small">
                {brk.leg}: {brk.detail}
              </span>
            ))
          )}
          {chain.invalidationsInFlight.length > 0 ? (
            <span className="md3-body-small">
              Cache purge still running: {chain.invalidationsInFlight.join(", ")} — the edge is
              legitimately still serving the previous objects.
            </span>
          ) : null}
        </div>
      ),
    },
  ]

  /** One certificate, ranked by the NUMBER of days it has left. */
  const certificateColumns: readonly DataColumn<CertificateRow>[] = [
    {
      key: "severity",
      header: "Severity",
      cell: (row) => <SeverityChip severity={row.severity}>{row.severity}</SeverityChip>,
    },
    {
      key: "days",
      header: "Days remaining",
      cell: (row) => (
        <div className={styles.cell}>
          {/*
            The number, on its own, because the table ranks by it. Null is never
            drawn as 0 — a certificate nobody measured must not sort into the
            comfortable end of this table and must not read as "expires today".
          */}
          <span className="md3-title-medium">
            {row.daysRemaining === null ? "not read" : row.daysRemaining}
          </span>
          <span className="md3-body-small">{row.expiry}</span>
        </div>
      ),
    },
    {
      key: "certificate",
      header: "Certificate",
      cell: (row) => (
        <div className={styles.cell}>
          <span>{row.domainName}</span>
          <span className={`md3-body-small ${styles.identifier}`}>{row.arn}</span>
          <span className="md3-body-small">{row.attribution}</span>
        </div>
      ),
    },
    {
      key: "validation",
      header: "Validation",
      cell: (row) => (
        <div className={styles.cell}>
          <span>
            {row.status} — {row.validation}
          </span>
          {/*
            The exact record ACM is waiting for. This is the cell that ends a
            stalled tenant provision, so it is printed verbatim rather than
            summarised, and an absent one says so rather than rendering blank.
          */}
          {row.waiting.map((wait) => (
            <span key={wait.domain} className={`md3-body-small ${styles.identifier}`}>
              {wait.record.kind === "cname"
                ? `${wait.domain}: create ${wait.record.type} ${wait.record.name} → ${wait.record.value}`
                : `${wait.domain}: ${wait.record.why}`}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "renewal",
      header: "Renewal",
      cell: (row) => (
        <div className={styles.cell}>
          <span>{row.renewal}</span>
          <span className="md3-body-small">
            {row.inUseBy.length === 0
              ? "attached to nothing this read returned — which is half of why a renewal goes ineligible"
              : `in use by ${row.inUseBy.length} resource(s)`}
          </span>
        </div>
      ),
    },
  ]

  const takeoverColumns: readonly DataColumn<(typeof edge.takeovers)[number]>[] = [
    {
      key: "severity",
      header: "Severity",
      cell: () => <SeverityChip severity="critical">critical</SeverityChip>,
    },
    {
      key: "record",
      header: "Record",
      cell: (row) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{row.recordName}</span>
          <span className="md3-body-small">
            {row.recordType} in {row.zoneName}
          </span>
        </div>
      ),
    },
    {
      key: "target",
      header: "Points at",
      cell: (row) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{row.target}</span>
          <span className="md3-body-small">this account does not own it</span>
        </div>
      ),
    },
    {
      key: "why",
      header: "What it means",
      cell: (row) => <div className={styles.cell}>{row.why}</div>,
    },
  ]

  const zones = hasValue(dns.zones) ? dns.zones.value : []

  /** What the four edge reads answered, appended to the page's provenance. */
  const edgeProvenance: readonly Fact[] = [
    { label: "Distributions read", value: cdn.distributions.state },
    { label: "Hosted zones read", value: dns.zones.state },
    { label: "Certificates read", value: certificates.certificates.state },
    { label: "Web ACLs read (REGIONAL)", value: waf.regional.state },
    { label: "Web ACLs read (CLOUDFRONT)", value: waf.cloudfront.state },
    { label: "CDN as of", value: cdn.asOf },
    { label: "DNS as of", value: dns.asOf },
    { label: "Certificates as of", value: certificates.asOf },
    { label: "WAF as of", value: waf.asOf },
  ]

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

      {/* 2a — the takeover. First in the edge section, because a record pointing
          at a name somebody else can register outranks everything below it. */}
      <Card
        headline="Records pointing at names this account does not own"
        headerAside={
          <Badge tone={edge.takeovers.length > 0 ? "bad" : hasValue(dns.zones) ? "ok" : "warn"}>
            {edge.takeovers.length > 0
              ? `${edge.takeovers.length} takeover risk`
              : dns.takeover.kind === "unknown"
                ? "not established"
                : "none found"}
          </Badge>
        }
        supportingText={statedAsOf(
          "A record aliasing a resource this account cannot enumerate is a subdomain takeover: the target is re-registrable and the record keeps sending this estate's users at it. Dangling is reachable only from an ownership index that ANSWERED and was walked to the end — a refused cloudfront:ListDistributions is reported as unverifiable, never as dangling",
          dns.asOf,
        )}
      >
        <div className={styles.stack}>
          {zonesUnknown ? <UnknownState what="the hosted zones" read={zonesUnknown} /> : null}

          <DataTable
            caption={`Dangling records — ${asOf(dns.asOf)}`}
            columns={takeoverColumns}
            rows={edge.takeovers}
            rowKey={(row) => row.key}
            empty={
              <EmptyState
                headline={
                  dns.takeover.kind === "clear"
                    ? "Every pointer that could be checked resolves to something this account owns"
                    : "No takeover was established, and none was ruled out"
                }
                description={
                  dns.takeover.kind === "clear"
                    ? `${dns.takeover.pointersChecked} pointer(s) were matched against the CloudFront and load balancer listings and every one of them was found. ${
                        dns.takeover.unverified.length > 0
                          ? `${dns.takeover.unverified.length} pointer(s) could NOT be checked and are named in the zone table below — "clear" here does not cover them.`
                          : "No pointer was left unchecked."
                      }`
                    : dns.takeover.kind === "unknown"
                      ? dns.takeover.why
                      : "The zone records were not read to a point where an absence could be claimed."
                }
              />
            }
          />
        </div>
      </Card>

      {/* 2b — the chain. The join four separate tables cannot make. */}
      <Card
        headline="The edge chain, hostname to origin"
        headerAside={<Badge tone={edge.lead.tone}>{edge.lead.verdict}</Badge>}
        supportingText={statedAsOf(
          "One row per hostname, read left to right the way a request travels: the Route 53 record, the CloudFront distribution it aliases, that distribution's certificate and its expiry, the web ACL in front of it, and how the edge reaches the origin. A broken edge is a chain, and a cell that could not be read says so rather than being blank",
          cdn.asOf,
        )}
        actions={
          <StaleIndicator
            asOf={cdn.asOf}
            cadenceMs={cdn.refreshMs.distributions}
            label="Distributions"
          />
        }
      >
        <div className={styles.stack}>
          <p className="md3-body-medium">{edge.lead.because}</p>

          {/*
            Each of the four reads, through the shared primitive, in the place a
            reassuring default would otherwise have gone. A refused
            wafv2:ListWebACLs and a WAF that genuinely is not in use are opposite
            facts and they must not look the same.
          */}
          {distributionsUnknown ? (
            <UnknownState what="the CloudFront distributions" read={distributionsUnknown} />
          ) : null}
          {zonesUnknown ? <UnknownState what="the Route 53 hosted zones" read={zonesUnknown} /> : null}
          {certificatesUnknown ? (
            <UnknownState what="the ACM certificates" read={certificatesUnknown} />
          ) : null}
          {wafRegionalUnknown ? (
            <UnknownState what="the REGIONAL web ACLs" read={wafRegionalUnknown} />
          ) : null}
          {wafCloudFrontUnknown ? (
            <UnknownState what="the CLOUDFRONT web ACLs" read={wafCloudFrontUnknown} />
          ) : null}

          {cdn.truncation.kind === "truncated" ? (
            <p className="md3-body-medium">
              The distribution walk stopped at its page cap.{describeTruncation(cdn.truncation)} An
              absence of chains below is therefore not an absence of distributions.
            </p>
          ) : null}

          <DataTable
            caption={`Chains from a hostname to an origin, worst first — ${asOf(cdn.asOf)}`}
            columns={chainColumns}
            rows={edge.chains}
            rowKey={(chain) => chain.key}
            empty={
              <EmptyState
                headline={
                  edge.verdict.kind === "no-edge"
                    ? "No CloudFront distribution in this account"
                    : "No chain is drawn"
                }
                description={
                  edge.verdict.kind === "no-edge"
                    ? edge.verdict.why
                    : `${edge.lead.because} No row here is not a chain that holds; it is the absence of a reading. The panels above name what would have to be granted.`
                }
              />
            }
          />
        </div>
      </Card>

      {/* 2c — certificates, ranked by the number of days they have left. */}
      <Card
        headline="Certificates, soonest to expire first"
        headerAside={
          <Badge
            tone={
              certificates.stuckValidation.kind === "stuck"
                ? "bad"
                : hasValue(certificates.certificates)
                  ? certificates.renewalRisk.kind === "at-risk"
                    ? "warn"
                    : "ok"
                  : "warn"
            }
          >
            {certificates.stuckValidation.kind === "stuck"
              ? `${certificates.stuckValidation.stuck.length} stuck`
              : certificates.certificates.state === "EMPTY"
                ? "none issued"
                : hasValue(certificates.certificates)
                  ? `${certificates.certificates.value.length} read`
                  : certificates.certificates.state}
          </Badge>
        }
        supportingText={statedAsOf(
          "Days remaining is a signed NUMBER and is what this table ranks by, so an already-expired certificate sorts ahead of one with a day left and a certificate whose expiry was never read sorts LAST and says so rather than showing a zero. A certificate at PENDING_VALIDATION is the commonest cause of a tenant provision that stalls with no error, and the exact record ACM is waiting for is printed beside it",
          certificates.asOf,
        )}
        actions={
          <StaleIndicator
            asOf={certificates.asOf}
            cadenceMs={certificates.refreshMs.detail}
            label="Certificate detail"
          />
        }
      >
        <div className={styles.stack}>
          {certificatesUnknown ? (
            <UnknownState what="the certificate listing" read={certificatesUnknown} />
          ) : null}

          {certificates.stuckValidation.kind === "stuck" ? (
            <p className="md3-body-medium">
              {certificates.stuckValidation.stuck.length} certificate(s) are waiting for a
              validation record. Until the record exists ACM does not issue, the distribution
              cannot present it, and a provisioning run waiting on it does not finish. Creating the
              CNAME below is the whole remedy.
            </p>
          ) : null}

          <DataTable
            caption={`Certificates, ranked by days remaining — ${asOf(certificates.asOf)}`}
            columns={certificateColumns}
            rows={edge.certificates}
            rowKey={(row) => row.key}
            empty={
              <EmptyState
                headline={
                  certificates.certificates.state === "EMPTY"
                    ? "acm:ListCertificates answered and this account and region hold none"
                    : "No certificate table"
                }
                description={
                  certificates.certificates.state === "EMPTY"
                    ? "That is a successful read returning nothing, which is a fact about the estate. It covers this region only: a certificate a CloudFront distribution presents lives in us-east-1 whatever region this console runs in, and this listing does not reach it."
                    : "The certificate listing did not answer, so this console knows of no expiring certificate and of no absence of one. The panel above names what would have to be granted."
                }
              />
            }
          />
        </div>
      </Card>

      {/* 2d — WAF, where an empty table and a refusal must not look the same. */}
      <Card
        headline="What sits in front of this estate"
        headerAside={
          <Badge
            tone={
              waf.coverage.kind === "unknown"
                ? "warn"
                : waf.coverage.kind === "protected"
                  ? "ok"
                  : waf.coverage.kind === "no-targets"
                    ? "neutral"
                    : "bad"
            }
          >
            {waf.coverage.kind}
          </Badge>
        }
        supportingText={statedAsOf(
          "WAFv2 not being in use and wafv2:ListWebACLs being refused are opposite facts and are rendered differently: the first is a finding with what it would take to close it, the second is an Unknown panel carrying the principal, the action and a pasteable statement. Neither is an empty table",
          waf.asOf,
        )}
      >
        <div className={styles.stack}>
          {/*
            The verdict in the reader's own words. `describeCoverage` is the
            production sentence and the tests assert on it, so rewording it here
            would move the claim off the path anything checks.
          */}
          <p className="md3-body-medium">{describeCoverage(waf.coverage)}</p>

          {waf.coverage.kind === "no-web-acl-exists" ? (
            <>
              <p className="md3-body-medium">
                Both scopes answered. This is not an empty table meaning nothing is wrong — it is a
                finding: no web ACL exists in either the REGIONAL or the CLOUDFRONT catalogue, so
                every request that resolves this estate reaches an origin unfiltered.
              </p>
              <p className="md3-body-medium">{WAF_REMEDY}</p>
            </>
          ) : null}

          {wafRegionalUnknown ? (
            <UnknownState what="the REGIONAL web ACL catalogue" read={wafRegionalUnknown} />
          ) : null}
          {wafCloudFrontUnknown ? (
            <UnknownState what="the CLOUDFRONT web ACL catalogue" read={wafCloudFrontUnknown} />
          ) : null}

          {waf.protection.length > 0 ? (
            <dl className={styles.facts}>
              {waf.protection.map((row) => (
                <Fragment key={row.target.arn}>
                  <dt>{row.target.name}</dt>
                  <dd>
                    {row.association.state === "EMPTY"
                      ? "nothing is attached — a read that answered and found none"
                      : row.association.state === "ACTUAL" || row.association.state === "STALE"
                        ? row.association.value.kind === "web-acl"
                          ? `web ACL ${row.association.value.name ?? row.association.value.arn}`
                          : `WAF Classic ${row.association.value.id}`
                        : `not established — ${row.association.state}`}
                  </dd>
                </Fragment>
              ))}
            </dl>
          ) : null}
        </div>
      </Card>

      {/* 2e — the deploy-visibility answer. */}
      <Card
        headline="Cache purges still running"
        headerAside={
          <Badge tone={edge.invalidations.length > 0 ? "warn" : hasValue(cdn.distributions) ? "ok" : "warn"}>
            {edge.invalidations.length} in flight
          </Badge>
        }
        supportingText={statedAsOf(
          "An invalidation that is still InProgress means the edge is legitimately serving the previous objects, and redeploying does not make it finish sooner. This is the usual reason a change that went out is not visible",
          cdn.asOf,
        )}
      >
        <div className={styles.stack}>
          {edge.invalidations.length === 0 ? (
            <p className="md3-body-medium">
              {hasValue(cdn.distributions)
                ? "No distribution that answered has an invalidation still InProgress. A change that went out and is not visible is not being held by a cache purge."
                : "No purge is listed, and none is ruled out: the distribution listing did not answer, so this console cannot say whether one is running."}
            </p>
          ) : (
            edge.invalidations.map((row) => (
              <p key={row.distributionId} className="md3-body-medium">
                <span className={styles.identifier}>{row.distributionId}</span> — {row.why}
              </p>
            ))
          )}
        </div>
      </Card>

      {/* 2f — the zones the chain was drawn from. */}
      <Card
        headline="Hosted zones"
        headerAside={
          <Badge tone={hasValue(dns.zones) ? "info" : dns.zones.state === "EMPTY" ? "neutral" : "warn"}>
            {hasValue(dns.zones) ? `${zones.length} read` : dns.zones.state}
          </Badge>
        }
        supportingText={statedAsOf(
          "Route 53 is global and no region is printed for a zone. Whether the REGISTRAR delegates to these name servers cannot be read from AWS at all for a domain held elsewhere, so it is stated as not readable rather than assumed to match",
          dns.asOf,
        )}
      >
        <div className={styles.stack}>
          {zonesUnknown ? <UnknownState what="the hosted zones" read={zonesUnknown} /> : null}

          {dns.zones.state === "EMPTY" ? (
            <EmptyState
              headline="route53:ListHostedZones answered and this account holds no zone"
              description="A successful read returning nothing. Every hostname this estate serves therefore has its DNS somewhere else, and nothing on this page can check those records."
            />
          ) : null}

          {zones.map((zone) => (
            <div key={zone.id} className={styles.stack}>
              <h3 className="md3-title-medium">
                {zone.name} <span className={styles.identifier}>{zone.id}</span>
              </h3>
              <p className="md3-body-medium">
                {zone.privateZone ? "Private zone" : "Public zone"} ·{" "}
                {describeZoneAttribution(zone.attribution)} ·{" "}
                {zone.declaredRecordCount === null
                  ? "record count not reported by AWS"
                  : `${zone.declaredRecordCount} record(s) declared by AWS`}{" "}
                · {describePagination(zone.pagination)}
              </p>
              {zone.delegation.kind === "nameservers" ? (
                <p className="md3-body-medium">
                  Name servers: {zone.delegation.nameservers.join(", ")}.{" "}
                  {zone.delegation.registrar.why}
                </p>
              ) : (
                <p className="md3-body-medium">{zone.delegation.why}</p>
              )}
            </div>
          ))}
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
            {[...provenance, ...edgeProvenance].map((fact) => (
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
              <p className="md3-body-medium">
                A web ACL&rsquo;s rules, for any ACL that is not associated with a resource this
                console can read. wafv2:GetWebACL is not in the capability registry, so an ACL that
                is attached is reported as attached and never as &ldquo;protecting&rdquo; — those
                are two different claims and only one of them was read.
              </p>
              <p className="md3-body-medium">
                The registrar&rsquo;s delegation. route53domains:GetDomainDetail is not in the
                capability registry, and it would only answer for a domain registered through Route
                53 Domains in this same account anyway. The name servers on this page are what
                Route 53 assigned, not what the registrar publishes.
              </p>
              <p className="md3-body-medium">
                Certificates in any region but this one. acm:ListCertificates is regional, and a
                CloudFront distribution&rsquo;s certificate lives in us-east-1 whatever region this
                console runs in — so a certificate ARN this listing does not contain is reported as
                not in the listing, with both regions named, and never as a missing certificate.
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
