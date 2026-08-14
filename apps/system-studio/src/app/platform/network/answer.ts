/**
 * STUDIO-070-004 (NETWORK SURFACE) — every decision `/platform/network` makes,
 * lifted out of the page so it can be driven without a browser, a server or an
 * AWS account.
 *
 * ── Why this file exists at all ────────────────────────────────────────────
 *
 * The arms that matter on this page cannot be reached from a browser pointed at
 * a healthy estate. They need a security group open to `0.0.0.0/0` on 3306, a
 * target reporting `Target.ResponseCodeMismatch`, a subnet named `…-private-a`
 * whose route table sends `0.0.0.0/0` to an internet gateway, and — the one this
 * console must never get wrong — a `DescribeSecurityGroups` that was REFUSED.
 * A page that decided those in ternaries inside JSX would have its worst-morning
 * wording asserted by nothing at all.
 *
 * So every verdict below is a named function over plain data, and
 * `answer.test.ts` mutates each one to prove the assertion catches it.
 *
 * ── The two rules everything here is arranged around ───────────────────────
 *
 * **1. A read that did not answer is never rendered as a finding of nothing.**
 * `openPaths` returns `unknown` carrying the read's own sentence when
 * `ec2:DescribeSecurityGroups` did not answer — never `0 paths`. `servingVerdict`
 * cannot reach `all-healthy` while a single target group's health is unreadable.
 * `unattachedCandidates` refuses to name a candidate at all while the load
 * balancer listing is unread, because a group attached to a load balancer this
 * engine never saw is not a group attached to nothing.
 *
 * **2. Public is a property of the route table, never of the name.**
 * `src/lib/aws/network.ts` decides that, and this module does not re-decide it.
 * What it adds is the EVIDENCE column: every subnet row prints the route table
 * id and the association that produced its verdict, so an operator can see the
 * classifier rather than trust it. `misnamed` is carried beside it — the name is
 * the accusation, the route table is still the verdict.
 *
 * ── What this module composes that neither reader can do alone ─────────────
 *
 * `src/lib/aws/network.ts` says, at length and correctly, that it CANNOT tell
 * you what a security group is attached to: `ec2:DescribeNetworkInterfaces` is
 * not in the capability registry, so its `SecurityGroupUsage` has a
 * `no-attachment-visible` arm and no `unused` arm.
 *
 * `src/lib/aws/loadbalancer.ts` reads `SecurityGroups` on every load balancer it
 * lists.
 *
 * Joining the two is the whole reason this surface composes both readers: an
 * open ingress rule can now name the load balancer it is attached to, and the
 * unattached-candidate list can EXCLUDE groups an ALB is carrying. Neither
 * reader may reach into the other, and neither should — the join is a property
 * of the page, and this is the page's module.
 *
 * ── Imports ────────────────────────────────────────────────────────────────
 *
 * Relative, and every one but `describeRead` is `import type`. `apps/web`'s jest
 * maps `@/` at its own `src`, so a `@/`-shaped import here would not resolve in
 * the runner that collects this module's test. `read.ts` imports only
 * `capabilities.ts`, so pulling `describeRead` in costs nothing and keeps the
 * sentence an operator reads identical to the one every other surface prints.
 */

import { describeRead, type AwsRead } from "../../../lib/aws/read"
import type {
  NetworkReadings,
  PagedList,
  SecurityGroupReading,
  SubnetNameContradiction,
  SubnetReading,
  VpcReading,
} from "../../../lib/aws/network"
import type { LoadBalancerReadings } from "../../../lib/aws/loadbalancer"

/* ──────────────────────────────────────────────────────────────── tone ──── */

/** The tone vocabulary `components/md3/Badge.tsx` accepts. */
export type Tone = "neutral" | "info" | "ok" | "warn" | "bad"

/**
 * The severity vocabulary `components/md3/SeverityChip.tsx` accepts.
 *
 * Restated here rather than imported: `@/components/md3` does not resolve in the
 * jest project that collects `answer.test.ts`, and a route module that could not
 * be unit-tested to keep this page's wording honest would defeat the point. The
 * two unions are the same five literals and `page.tsx` passes values from here
 * straight into the chip, so the compiler checks the agreement on every build.
 */
export type Severity = "critical" | "high" | "medium" | "low" | "informational"

/** Worst first. The order every ranked table on this page sorts by. */
export const SEVERITY_RANK: readonly Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "informational",
]

const SEVERITY_INDEX: Readonly<Record<Severity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  informational: 4,
}

/* ─────────────────────────────────────────────────────── read predicates ── */

/**
 * The states of `AwsRead` in which a value was actually produced.
 *
 * `EMPTY` is deliberately NOT in this set. An empty read is a successful read of
 * nothing and every caller here treats it separately, because "AWS answered and
 * there are no load balancers" and "AWS answered and every target is healthy"
 * are different sentences and only one of them is reassuring.
 */
export type ValueRead<T> = Extract<AwsRead<T>, { value: T }>

export function hasValue<T>(read: AwsRead<T>): read is ValueRead<T> {
  return read.state === "ACTUAL" || read.state === "STALE"
}

/**
 * Whether the read answered at all — a value, or a successful nothing.
 *
 * Deliberately NOT a type predicate. It is used to decide whether a claim may be
 * made, never to reach into a value, and a predicate here would tempt a caller
 * into `read.value` on the EMPTY arm, which carries none.
 */
export function answered(read: AwsRead<unknown>): boolean {
  return read.state === "ACTUAL" || read.state === "STALE" || read.state === "EMPTY"
}

/** The four arms of `AwsRead` that carry no value, narrowed for `UnknownState`. */
export type ValuelessRead = Extract<
  AwsRead<unknown>,
  { state: "DENIED" } | { state: "THROTTLED" } | { state: "UNCONFIGURED" } | { state: "ERROR" }
>

/**
 * The unknown arm of a read, or null.
 *
 * `isUnknown` in `lib/aws/read.ts` returns a boolean rather than a type
 * predicate, and `UnknownState` accepts only the four valueless arms — so the
 * narrowing happens here, as a `switch` the compiler can follow. Returning
 * `null` for the value-carrying arms is what makes "render the panel only when
 * there is something to say" a type-level fact rather than a convention.
 */
export function unknownArm(read: AwsRead<unknown>): ValuelessRead | null {
  switch (read.state) {
    case "DENIED":
    case "THROTTLED":
    case "UNCONFIGURED":
    case "ERROR":
      return read
    default:
      return null
  }
}

/* ────────────────────────────────────────────────────────────── as of ──── */

/** When a panel was true. Never a default, and never silently absent. */
export function asOf(at: string | null): string {
  if (at === null || at.trim() === "") {
    return "As of an unknown time — nothing recorded when this was read."
  }
  return `As of ${at}.`
}

/** A panel's supporting line: what it is, then when it was true. */
export function statedAsOf(what: string, at: string | null): string {
  const trimmed = what.trim()
  const sentence = trimmed.endsWith(".") ? trimmed : `${trimmed}.`
  return `${sentence} ${asOf(at)}`
}

/* ────────────────────────────────────────────────────────────── scope ──── */

/** One labelled fact. A value is a string, and an unknown is a sentence. */
export interface Fact {
  label: string
  value: string
}

function identityWhy(identityState: string): string {
  return identityState === "ACTUAL" || identityState === "STALE"
    ? "the identity read answered but did not carry it"
    : `sts:GetCallerIdentity came back ${identityState}, so this console has no estate to name`
}

function orUnknown(value: string | null | undefined, why: string): string {
  return value && value.trim() !== "" ? value : `Not known — ${why}`
}

export interface Scope {
  identityState: string
  accountId?: string | null
  region?: string | null
  partition?: string | null
}

/**
 * Which estate this page is describing, before anything is claimed about it.
 *
 * Region and partition come from the resolved identity and are never a literal
 * — the readers refuse to invent one, and printing a plausible-looking value
 * here would undo that at the last step.
 */
export function scopeOf(scope: Scope): readonly Fact[] {
  const why = identityWhy(scope.identityState)
  return [
    { label: "Account", value: orUnknown(scope.accountId, why) },
    { label: "Region", value: orUnknown(scope.region, why) },
    { label: "Partition", value: orUnknown(scope.partition, why) },
  ]
}

/**
 * The one line the lead prints when the estate itself is not known.
 *
 * Three sentences in three pills is how a 320px viewport draws one over the
 * next, so when every scope value is a sentence the chip row is replaced by
 * this. `e2e/layout.spec.ts` measures that at 320px.
 */
export function scopeSentence(scope: Scope): string {
  return (
    `This console cannot say which estate it is describing — ${identityWhy(scope.identityState)}. ` +
    "Account, region and partition are named as unknown throughout this page rather than " +
    "defaulted to a plausible-looking value."
  )
}

/* ──────────────────────────────────────────────────────── attachment ───── */

/**
 * What this engine READ that carries a security group.
 *
 * `src/lib/aws/network.ts` says at length that it cannot answer "what is this
 * group attached to" — `ec2:DescribeNetworkInterfaces` is not in the capability
 * registry — and its `SecurityGroupUsage` therefore has a `no-attachment-visible`
 * arm and no `unused` arm. `src/lib/aws/loadbalancer.ts` reads `SecurityGroups`
 * on every load balancer, which is a real attachment nobody was joining to
 * anything. This is that join, and it is the reason this surface composes both
 * readers rather than one.
 *
 * `loadBalancersRead` is not a convenience. A refused
 * `elasticloadbalancing:DescribeLoadBalancers` means this index EXCLUDES nothing,
 * and a caller that used it to decide "attached to nothing" would name groups
 * that are attached to a load balancer this engine never saw.
 */
export interface AttachmentIndex {
  /** Group id → the resources this engine read that carry it, sorted. */
  byGroup: ReadonlyMap<string, readonly string[]>
  /** Whether the load balancer listing answered. False means it excludes nothing. */
  loadBalancersRead: boolean
  /** The read's own sentence when it did not answer. Empty when it did. */
  why: string
}

/**
 * Every security group a load balancer this engine read is carrying.
 *
 * EMPTY counts as read: `DescribeLoadBalancers` answering with no load balancers
 * is a fact, and it genuinely does exclude nothing — which is exactly what an
 * empty index expresses.
 */
export function attachmentsFromLoadBalancers(readings: LoadBalancerReadings): AttachmentIndex {
  const byGroup = new Map<string, string[]>()
  const read = readings.loadBalancers

  if (!answered(read)) {
    return {
      byGroup,
      loadBalancersRead: false,
      why: describeRead(read, "the load balancers"),
    }
  }
  if (hasValue(read)) {
    for (const lb of read.value) {
      for (const groupId of lb.securityGroupIds) {
        const existing = byGroup.get(groupId) ?? []
        existing.push(`load balancer ${lb.name ?? lb.arn}`)
        byGroup.set(groupId, existing)
      }
    }
  }
  for (const [groupId, labels] of byGroup) {
    byGroup.set(groupId, [...new Set(labels)].sort())
  }
  return { byGroup, loadBalancersRead: true, why: "" }
}

/**
 * The sentence a row prints for what carries a group.
 *
 * Never the word "unused", and never "unattached". The strongest claim available
 * to this engine is "nothing this engine read carries it", and the sentence says
 * which grant would settle it.
 */
export function describeAttachment(
  group: SecurityGroupReading,
  index: AttachmentIndex,
): string {
  const fromLoadBalancers = index.byGroup.get(group.groupId) ?? []
  const fromReader = group.usage.kind === "referenced" ? group.usage.by : []
  const carried = [...new Set([...fromLoadBalancers, ...fromReader])].sort()

  if (carried.length > 0) return `attached to ${carried.join(", ")}`

  if (!index.loadBalancersRead) {
    return (
      `nothing this engine read carries ${group.groupId}, and the load balancers were not read ` +
      `at all — ${index.why} A load balancer this engine never saw could be carrying it.`
    )
  }
  if (group.usage.kind === "unknown") return `attachment unknown — ${group.usage.why}`
  return (
    `no attachment visible to this engine. No load balancer, VPC endpoint or other security ` +
    `group's rule that was read names ${group.groupId}. That is not proof it is unattached — an ` +
    `ECS task, an RDS instance or a Lambda ENI could hold it, and only ` +
    `ec2:DescribeNetworkInterfaces would show that. This engine does not hold it.`
  )
}

/* ───────────────────────────────────────────────────────── open paths ──── */

/**
 * Ports whose default service being on the public internet is a critical
 * finding rather than a high one.
 *
 * These are the registered defaults for the services this estate and its
 * neighbours actually run — they are not a guess about what is listening. A rule
 * whose range COVERS one of them is critical whether or not anything is bound:
 * the security group is the control, and the control is open.
 */
export const SENSITIVE_PORTS: Readonly<Record<number, string>> = {
  22: "SSH",
  23: "Telnet",
  135: "MSRPC",
  445: "SMB",
  1433: "SQL Server",
  1521: "Oracle",
  2049: "NFS",
  2375: "Docker daemon",
  3306: "MySQL / Aurora MySQL",
  3389: "RDP",
  5432: "PostgreSQL",
  5439: "Redshift",
  5601: "Kibana",
  6379: "Redis",
  9200: "Elasticsearch / OpenSearch",
  11211: "memcached",
  27017: "MongoDB",
}

/**
 * The sensitive services a port range covers, named.
 *
 * Walked over the seventeen keys rather than over the range, because a rule of
 * `0–65535` would otherwise be sixty-five thousand iterations per row on a page
 * render with a person waiting.
 */
export function sensitivePortsCovered(
  fromPort: number | null,
  toPort: number | null,
): readonly string[] {
  if (fromPort === null && toPort === null) return []
  const from = fromPort ?? 0
  const to = toPort ?? 65535
  if (to < from) return []
  const named: string[] = []
  for (const [port, service] of Object.entries(SENSITIVE_PORTS)) {
    const number = Number(port)
    if (number >= from && number <= to) named.push(`${number} (${service})`)
  }
  return named
}

/** How a rule's ports read to a human. Null ports are an absence, never a zero. */
export function portsPhrase(fromPort: number | null, toPort: number | null): string {
  if (fromPort === null && toPort === null) return "no port restriction"
  const from = fromPort ?? 0
  const to = toPort ?? 65535
  if (from === to) return `port ${from}`
  return `ports ${from}–${to} (${to - from + 1} ports)`
}

/**
 * How hard a path from the internet is.
 *
 * `beyondWeb` comes from the reader — `opensBeyondWeb` there is the function
 * that knows a rule spanning 80–443 also opens 81 through 442 — and is not
 * re-derived here.
 *
 *   * a rule with no port concept at all (`every protocol`, ICMP) is CRITICAL:
 *     nothing bounds what it reaches;
 *   * a rule whose range covers a registered sensitive default is CRITICAL, and
 *     the row names which;
 *   * any other rule open past 80 and 443 is HIGH;
 *   * 80 or 443 alone is LOW — it is still a path from the internet, it is
 *     still listed, and on a load balancer it is expected.
 *
 * There is no arm that returns `informational`. Every row this function grades
 * is a rule accepting packets from the entire internet, and none of those is
 * informational.
 */
export function pathSeverity(
  beyondWeb: boolean,
  fromPort: number | null,
  toPort: number | null,
): Severity {
  if (!beyondWeb) return "low"
  if (fromPort === null && toPort === null) return "critical"
  if (sensitivePortsCovered(fromPort, toPort).length > 0) return "critical"
  return "high"
}

/** One security group rule that lets the internet in. */
export interface OpenPath {
  key: string
  groupId: string
  groupName: string | null
  vpcId: string | null
  /** `0.0.0.0/0` or `::/0`, verbatim from AWS. */
  cidr: string
  protocol: string
  protocolLabel: string
  fromPort: number | null
  toPort: number | null
  ports: string
  severity: Severity
  /** True when it opens something other than 80 and 443. The reader decided this. */
  beyondWeb: boolean
  /** The registered services this range covers, named. Empty when none. */
  sensitive: readonly string[]
  /** What this engine read that carries the group. Never says "unused". */
  attachedTo: string
  /** The reader's own sentence naming exactly what the internet can reach. */
  reach: string
}

/**
 * Every path from the internet, or the reason there is no answer.
 *
 * `unknown` is the arm a refused, throttled or broken `DescribeSecurityGroups`
 * lands in, and it carries the read's own sentence. There is no branch in this
 * function that turns a refusal into a count, which is the single most dangerous
 * thing this surface could do: "0 paths from the internet" under a read nobody
 * was allowed to take is a clean bill of health for an estate nobody looked at.
 */
export type PathsReading =
  | { kind: "unknown"; why: string }
  | {
      kind: "known"
      paths: readonly OpenPath[]
      /** How many opened something other than 80/443. The number that matters. */
      beyondWeb: number
      /** How many were 80/443 only — a path, and an expected one. */
      webOnly: number
      groupsRead: number
      /** True when the page walk stopped at its cap. A count that is not the estate. */
      truncated: boolean
    }

export function openPaths(
  securityGroups: AwsRead<PagedList<SecurityGroupReading>>,
  index: AttachmentIndex,
): PathsReading {
  if (securityGroups.state === "EMPTY") {
    return {
      kind: "known",
      paths: [],
      beyondWeb: 0,
      webOnly: 0,
      groupsRead: 0,
      truncated: false,
    }
  }
  if (!hasValue(securityGroups)) {
    return { kind: "unknown", why: describeRead(securityGroups, "the security groups") }
  }

  const paths: OpenPath[] = []
  const groups = securityGroups.value.items

  for (const group of groups) {
    const attachedTo = describeAttachment(group, index)

    for (const finding of group.openIngress) {
      paths.push({
        key: `${group.groupId}|${finding.cidr}|${finding.protocol}|${finding.fromPort}|${finding.toPort}`,
        groupId: group.groupId,
        groupName: group.groupName,
        vpcId: group.vpcId,
        cidr: finding.cidr,
        protocol: finding.protocol,
        protocolLabel: finding.protocolLabel,
        fromPort: finding.fromPort,
        toPort: finding.toPort,
        ports: portsPhrase(finding.fromPort, finding.toPort),
        severity: pathSeverity(true, finding.fromPort, finding.toPort),
        beyondWeb: true,
        sensitive: sensitivePortsCovered(finding.fromPort, finding.toPort),
        attachedTo,
        reach: finding.reach,
      })
    }

    // 80 and 443 from the whole internet are still paths from the internet. They
    // are ranked last and they are listed, because a page that showed only the
    // findings could not answer "what can reach this estate" — it could only
    // answer "what is wrong", and the front door being open on 443 is the
    // answer to the first question and not to the second.
    for (const rule of group.webIngress) {
      paths.push({
        key: `${group.groupId}|${rule.source}|${rule.protocol}|${rule.fromPort}|${rule.toPort}`,
        groupId: group.groupId,
        groupName: group.groupName,
        vpcId: group.vpcId,
        cidr: rule.source,
        protocol: rule.protocol,
        protocolLabel: rule.protocolLabel,
        fromPort: rule.fromPort,
        toPort: rule.toPort,
        ports: portsPhrase(rule.fromPort, rule.toPort),
        severity: pathSeverity(false, rule.fromPort, rule.toPort),
        beyondWeb: false,
        sensitive: [],
        attachedTo,
        reach:
          `${rule.source} can reach this group on ${rule.protocolLabel} ` +
          `${portsPhrase(rule.fromPort, rule.toPort)}`,
      })
    }
  }

  return {
    kind: "known",
    paths: rankPaths(paths),
    beyondWeb: paths.filter((path) => path.beyondWeb).length,
    webOnly: paths.filter((path) => !path.beyondWeb).length,
    groupsRead: groups.length,
    truncated: securityGroups.value.truncated,
  }
}

/**
 * Worst first, then stable.
 *
 * Severity, then anything past 80/443 above anything on them, then group id and
 * port so two loads of the same estate render in the same order and a diff of
 * two screenshots is readable.
 */
export function rankPaths(paths: readonly OpenPath[]): readonly OpenPath[] {
  return [...paths].sort((a, b) => {
    const bySeverity = SEVERITY_INDEX[a.severity] - SEVERITY_INDEX[b.severity]
    if (bySeverity !== 0) return bySeverity
    if (a.beyondWeb !== b.beyondWeb) return a.beyondWeb ? -1 : 1
    const byGroup = a.groupId.localeCompare(b.groupId)
    if (byGroup !== 0) return byGroup
    return (a.fromPort ?? -1) - (b.fromPort ?? -1)
  })
}

/* ─────────────────────────────────────────────────────── target health ─── */

/**
 * One target the load balancer will not route to, with the reason code verbatim.
 *
 * `reasonCode` is `string | null` and the null is never printed as an empty
 * string. `Target.Timeout` (the app did not answer) and
 * `Target.ResponseCodeMismatch` (the app answered, with the wrong status) send
 * an operator to completely different places; a row that showed neither, or
 * showed `""`, sends them to neither.
 */
export interface UnhealthyTargetRow {
  key: string
  loadBalancerName: string
  targetGroupName: string
  targetGroupArn: string
  targetId: string
  port: number | null
  /** AWS's own state string: `unhealthy`, `draining`, `initial`, `unused`, … */
  state: string
  /** AWS's own reason code, or null when AWS gave none. Never `""`. */
  reasonCode: string | null
  /** AWS's description, or the sentence saying no reason code came with it. */
  description: string
  severity: Severity
}

/**
 * How hard one not-serving target is.
 *
 * `draining` is a deploy in progress and is LOW; `initial` is a target that has
 * not finished its first health check and is MEDIUM; everything else — which is
 * `unhealthy`, `unused`, `unavailable` and AWS's own `unstated` — is HIGH,
 * because in steady state each of those is a request that is not being served.
 */
export function targetSeverity(state: string): Severity {
  if (state === "draining") return "low"
  if (state === "initial") return "medium"
  return "high"
}

/** Every target that is not being served, across every load balancer that answered. */
export function unhealthyTargets(readings: LoadBalancerReadings): readonly UnhealthyTargetRow[] {
  const rows: UnhealthyTargetRow[] = []
  const read = readings.loadBalancers
  if (!hasValue(read)) return rows

  for (const lb of read.value) {
    if (!hasValue(lb.targetGroups)) continue
    for (const group of lb.targetGroups.value) {
      const serving = group.serving
      if (serving.kind !== "degraded" && serving.kind !== "none-serving") continue
      for (const target of serving.notServing) {
        rows.push({
          key: `${group.arn}|${target.targetId}|${target.port ?? "none"}`,
          loadBalancerName: lb.name ?? lb.arn,
          targetGroupName: group.name ?? group.arn,
          targetGroupArn: group.arn,
          targetId: target.targetId,
          port: target.port,
          state: target.state,
          // Carried through exactly as the reader produced it, including the
          // null. A `?? ""` here is how the one token an operator needs becomes
          // a blank cell.
          reasonCode: target.reasonCode,
          description: target.description,
          severity: targetSeverity(target.state),
        })
      }
    }
  }

  return rows.sort((a, b) => {
    const bySeverity = SEVERITY_INDEX[a.severity] - SEVERITY_INDEX[b.severity]
    if (bySeverity !== 0) return bySeverity
    const byGroup = a.targetGroupArn.localeCompare(b.targetGroupArn)
    if (byGroup !== 0) return byGroup
    return a.targetId.localeCompare(b.targetId)
  })
}

/** What was counted across every target group, before any verdict is reached. */
export interface TargetTally {
  /** Target groups whose health this engine actually read. */
  groups: number
  healthy: number
  notServing: number
  /** Groups whose health read did not answer. The reason `all-healthy` is barred. */
  groupsUnreadable: number
  /** Groups that answered and hold no registered target at all. */
  groupsWithNoTargets: number
  /** Load balancers whose target-group listing did not answer. */
  loadBalancersUnreadable: number
  loadBalancers: number
}

export function tallyTargets(readings: LoadBalancerReadings): TargetTally {
  const tally: TargetTally = {
    groups: 0,
    healthy: 0,
    notServing: 0,
    groupsUnreadable: 0,
    groupsWithNoTargets: 0,
    loadBalancersUnreadable: 0,
    loadBalancers: 0,
  }
  const read = readings.loadBalancers
  if (!hasValue(read)) return tally

  for (const lb of read.value) {
    tally.loadBalancers += 1
    if (!hasValue(lb.targetGroups)) {
      // EMPTY is a load balancer with no target group, which is a real and
      // readable state; every other valueless arm is a listing that did not
      // answer, and only that one bars a healthy verdict.
      if (lb.targetGroups.state !== "EMPTY") tally.loadBalancersUnreadable += 1
      continue
    }
    for (const group of lb.targetGroups.value) {
      tally.groups += 1
      switch (group.serving.kind) {
        case "unknown":
          tally.groupsUnreadable += 1
          break
        case "no-targets":
          tally.groupsWithNoTargets += 1
          break
        case "all-serving":
          tally.healthy += group.serving.healthy
          break
        case "degraded":
          tally.healthy += group.serving.healthy
          tally.notServing += group.serving.notServing.length
          break
        case "none-serving":
          tally.notServing += group.serving.notServing.length
          break
      }
    }
  }
  return tally
}

/**
 * Whether traffic is actually getting to the services.
 *
 * The second half of the question this page exists to answer, and the arm that
 * must be unreachable by accident is `all-healthy`. It requires, all at once:
 * the listing answered, at least one target group was read, no group's health
 * was unreadable, no load balancer's target-group listing was unreadable, no
 * group answered with zero registered targets, and nothing is not-serving.
 *
 * Drop any one of those conditions and this console tells an operator the estate
 * is serving traffic on the morning it is not. `answer.test.ts` mutates each one
 * out in turn.
 */
export type ServingVerdict =
  | { kind: "unknown"; why: string }
  | { kind: "no-load-balancers"; why: string }
  | { kind: "all-healthy"; healthy: number; groups: number; why: string }
  | {
      kind: "degraded"
      healthy: number
      notServing: number
      groupsUnreadable: number
      groupsWithNoTargets: number
      why: string
    }
  | { kind: "nothing-serving"; notServing: number; why: string }
  | {
      kind: "partly-unknown"
      healthy: number
      groupsUnreadable: number
      loadBalancersUnreadable: number
      why: string
    }

export function servingVerdict(
  readings: LoadBalancerReadings,
  tally: TargetTally = tallyTargets(readings),
): ServingVerdict {
  const read = readings.loadBalancers

  if (read.state === "EMPTY") {
    return {
      kind: "no-load-balancers",
      why:
        "elasticloadbalancing:DescribeLoadBalancers answered and this account has no v2 load " +
        "balancer in this region. Nothing is being served through one — which is not the same as " +
        "the call having been refused, and says nothing about Classic load balancers, which this " +
        "engine does not read.",
    }
  }
  if (!hasValue(read)) {
    return { kind: "unknown", why: describeRead(read, "the load balancers") }
  }

  // Anything not-serving outranks anything unread: a target the load balancer is
  // actively refusing is a fact, and it is worse news than a gap in coverage.
  if (tally.notServing > 0 && tally.healthy === 0) {
    return {
      kind: "nothing-serving",
      notServing: tally.notServing,
      why:
        `every one of the ${tally.notServing} registered target(s) this engine read is refused by ` +
        `its load balancer. ECS may still report these tasks as RUNNING; no request is reaching ` +
        `them. The reason code on each row is where an operator goes next.`,
    }
  }
  if (tally.notServing > 0) {
    return {
      kind: "degraded",
      healthy: tally.healthy,
      notServing: tally.notServing,
      groupsUnreadable: tally.groupsUnreadable,
      groupsWithNoTargets: tally.groupsWithNoTargets,
      why:
        `${tally.notServing} of ${tally.healthy + tally.notServing} registered target(s) are not ` +
        `being served. The load balancer will not route to them whatever ECS reports.`,
    }
  }

  if (
    tally.groupsUnreadable > 0 ||
    tally.loadBalancersUnreadable > 0 ||
    tally.groupsWithNoTargets > 0
  ) {
    const parts: string[] = []
    if (tally.groupsUnreadable > 0) {
      parts.push(
        `${tally.groupsUnreadable} target group(s) did not answer a health call — their targets ` +
          `are neither healthy nor unhealthy here, they are unread`,
      )
    }
    if (tally.loadBalancersUnreadable > 0) {
      parts.push(
        `${tally.loadBalancersUnreadable} load balancer(s) did not answer a target-group listing, ` +
          `so this engine does not know what they route to`,
      )
    }
    if (tally.groupsWithNoTargets > 0) {
      parts.push(
        `${tally.groupsWithNoTargets} target group(s) answered and hold no registered target at ` +
          `all, which serves nothing`,
      )
    }
    return {
      kind: "partly-unknown",
      healthy: tally.healthy,
      groupsUnreadable: tally.groupsUnreadable,
      loadBalancersUnreadable: tally.loadBalancersUnreadable,
      why: `${parts.join("; ")}. This is not a healthy estate; it is a partly-read one.`,
    }
  }

  if (tally.groups === 0) {
    return {
      kind: "partly-unknown",
      healthy: 0,
      groupsUnreadable: 0,
      loadBalancersUnreadable: tally.loadBalancersUnreadable,
      why:
        `${tally.loadBalancers} load balancer(s) were read and not one target group came back with ` +
        `them. Whether anything is being served cannot be said from that.`,
    }
  }

  return {
    kind: "all-healthy",
    healthy: tally.healthy,
    groups: tally.groups,
    why:
      `every one of the ${tally.healthy} registered target(s) across ${tally.groups} target ` +
      `group(s) is healthy, and every health call answered. This is the only condition under ` +
      `which this page says traffic is getting to the services.`,
  }
}

/* ──────────────────────────────────────────────────────────── listeners ── */

/**
 * One HTTP listener with nothing sending its callers to TLS.
 *
 * `confirmed` and `unknown` are two lists and never one. The reader is precise
 * about this: a redirect can live in a listener RULE, rules are a separate IAM
 * action, and a listener whose rules could not be read is
 * `plaintext-redirect-unknown` and not `plaintext-no-redirect`. Reporting a
 * finding this engine did not establish is the same class of defect as
 * suppressing one it did.
 */
export interface PlaintextListenerRow {
  key: string
  loadBalancerName: string
  loadBalancerArn: string
  listenerArn: string
  port: number | null
  protocol: string | null
  /** `internet-facing`, `internal`, or the sentence saying AWS did not state it. */
  scheme: string
  severity: Severity
  why: string
}

export interface PlaintextListeners {
  /** Established: HTTP in, no redirect in the default action AND none in any rule. */
  confirmed: readonly PlaintextListenerRow[]
  /** HTTP in, no redirect in the default action, and the rules were not read. */
  unknown: readonly PlaintextListenerRow[]
}

/**
 * The plaintext listeners, split by whether this engine established the finding.
 *
 * An internet-facing plaintext listener is HIGH and an internal one is MEDIUM:
 * both serve plaintext, and only one of them serves it to anybody who asks.
 */
export function plaintextListeners(readings: LoadBalancerReadings): PlaintextListeners {
  const confirmed: PlaintextListenerRow[] = []
  const unknown: PlaintextListenerRow[] = []
  const read = readings.loadBalancers
  if (!hasValue(read)) return { confirmed, unknown }

  for (const lb of read.value) {
    if (!hasValue(lb.listeners)) continue
    const facing = lb.scheme.kind === "internet-facing"
    const scheme =
      lb.scheme.kind === "unstated" ? `scheme unknown — ${lb.scheme.why}` : lb.scheme.kind

    for (const listener of lb.listeners.value) {
      if (
        listener.tls.kind !== "plaintext-no-redirect" &&
        listener.tls.kind !== "plaintext-redirect-unknown"
      ) {
        continue
      }
      const row: PlaintextListenerRow = {
        key: listener.arn,
        loadBalancerName: lb.name ?? lb.arn,
        loadBalancerArn: lb.arn,
        listenerArn: listener.arn,
        port: listener.port,
        protocol: listener.protocol,
        scheme,
        severity:
          listener.tls.kind === "plaintext-no-redirect"
            ? facing
              ? "high"
              : "medium"
            : "informational",
        why: listener.tls.why,
      }
      if (listener.tls.kind === "plaintext-no-redirect") confirmed.push(row)
      else unknown.push(row)
    }
  }

  const order = (rows: PlaintextListenerRow[]) =>
    rows.sort((a, b) => {
      const bySeverity = SEVERITY_INDEX[a.severity] - SEVERITY_INDEX[b.severity]
      if (bySeverity !== 0) return bySeverity
      return a.listenerArn.localeCompare(b.listenerArn)
    })

  return { confirmed: order(confirmed), unknown: order(unknown) }
}

/* ────────────────────────────────────────────────────────────── subnets ── */

/**
 * One subnet, with the EVIDENCE for its classification beside it.
 *
 * `src/lib/aws/network.ts` decides public-versus-private from the route table
 * and this module does not re-decide it. What this row adds is the route table
 * id and the association that produced the verdict, printed in the table, so an
 * operator can check the classifier rather than trust it — and so that a future
 * edit that classified by name would visibly contradict its own evidence column.
 */
export interface SubnetRow {
  key: string
  subnetId: string
  vpcId: string | null
  name: string | null
  cidr: string | null
  availabilityZone: string | null
  /** `PUBLIC`, `private` or `unknown`. Never derived from the name. */
  verdict: "PUBLIC" | "private" | "unknown"
  tone: Tone
  /** The route table and association the verdict came from, or why there is none. */
  evidence: string
  /** True when the name says private and the routes say public. */
  misnamed: boolean
  /** What happens to a NEW interface. Evidence, never the classifier. */
  autoAssignsPublicIp: string
  availableIps: string
}

/**
 * One subnet's verdict, and the evidence sentence that produced it.
 *
 * Reads `subnet.reachability` and NOTHING else — emphatically not
 * `subnet.name`, which `lib/aws/network.ts` uses for exactly one thing and this
 * module for none. `answer.test.ts` mutates this to classify by name and proves
 * the assertion catches it.
 */
export function classifySubnet(subnet: SubnetReading): {
  verdict: SubnetRow["verdict"]
  tone: Tone
  evidence: string
} {
  const reachability = subnet.reachability
  switch (reachability.kind) {
    case "public":
      return {
        verdict: "PUBLIC",
        tone: "bad",
        evidence:
          `route table ${reachability.routeTableId} (${reachability.association} association) ` +
          `sends ${reachability.destination} to ${reachability.via}`,
      }
    case "private":
      return {
        verdict: "private",
        tone: "ok",
        evidence:
          `route table ${reachability.routeTableId} (${reachability.association} association) ` +
          `carries no active internet-gateway route; egress ` +
          (reachability.egress === "none"
            ? "is not available at all"
            : `via ${reachability.egressVia.join(", ")}`),
      }
    case "unknown":
      return { verdict: "unknown", tone: "warn", evidence: reachability.why }
  }
}

export function subnetRows(
  subnets: AwsRead<PagedList<SubnetReading>>,
  contradictions: readonly SubnetNameContradiction[],
): readonly SubnetRow[] {
  if (!hasValue(subnets)) return []
  const misnamed = new Set(contradictions.map((c) => c.subnetId))

  return subnets.value.items.map((subnet) => {
    const { verdict, tone, evidence } = classifySubnet(subnet)
    return {
      key: subnet.subnetId,
      subnetId: subnet.subnetId,
      vpcId: subnet.vpcId,
      name: subnet.name,
      cidr: subnet.cidrBlock,
      availabilityZone: subnet.availabilityZone,
      verdict,
      tone,
      evidence,
      misnamed: misnamed.has(subnet.subnetId),
      autoAssignsPublicIp:
        subnet.mapPublicIpOnLaunch === null
          ? "AWS did not report it"
          : subnet.mapPublicIpOnLaunch
            ? "yes — a new interface here gets a public IP"
            : "no",
      availableIps:
        subnet.availableIpAddressCount === null
          ? "not reported"
          : String(subnet.availableIpAddressCount),
    }
  })
}

/** One VPC, with how much of it this engine could classify. */
export interface VpcRow {
  key: string
  vpcId: string
  name: string | null
  cidrs: string
  isDefault: boolean
  state: string | null
  publicSubnets: number
  privateSubnets: number
  unknownSubnets: number
}

export function vpcRows(
  vpcs: AwsRead<PagedList<VpcReading>>,
  rows: readonly SubnetRow[],
): readonly VpcRow[] {
  if (!hasValue(vpcs)) return []
  return vpcs.value.items.map((vpc) => {
    const mine = rows.filter((row) => row.vpcId === vpc.vpcId)
    return {
      key: vpc.vpcId,
      vpcId: vpc.vpcId,
      name: vpc.name,
      cidrs:
        vpc.cidrBlocks.length > 0
          ? [...vpc.cidrBlocks, ...vpc.ipv6CidrBlocks].join(", ")
          : (vpc.cidrBlock ?? "AWS did not report a CIDR"),
      isDefault: vpc.isDefault,
      state: vpc.state,
      publicSubnets: mine.filter((row) => row.verdict === "PUBLIC").length,
      privateSubnets: mine.filter((row) => row.verdict === "private").length,
      unknownSubnets: mine.filter((row) => row.verdict === "unknown").length,
    }
  })
}

/* ────────────────────────────────────────────── attached-to-nothing ────── */

/** One security group nothing this engine read carries. A candidate, not a finding. */
export interface UnattachedRow {
  key: string
  groupId: string
  groupName: string | null
  vpcId: string | null
  description: string | null
  /** Whether it is one of the groups that is also open to the internet. */
  openToInternet: boolean
  why: string
}

/**
 * Security groups nothing this engine read carries.
 *
 * `unknown` while the load balancer listing is unread, and that arm is the point
 * of the function. The network reader alone cannot see an ALB's security groups;
 * naming a candidate from its answer while the load balancers were refused would
 * put a group that an internet-facing ALB is carrying on a list headed "attached
 * to nothing", which is a deletion an operator might act on.
 *
 * Even with both reads in hand the word is CANDIDATE. `ec2:DescribeNetworkInterfaces`
 * is the only call that settles attachment and this engine does not hold it.
 */
export type UnattachedReading =
  | { kind: "unknown"; why: string }
  | { kind: "candidates"; groups: readonly UnattachedRow[]; caveat: string }

export function unattachedCandidates(
  securityGroups: AwsRead<PagedList<SecurityGroupReading>>,
  index: AttachmentIndex,
): UnattachedReading {
  if (!index.loadBalancersRead) {
    return {
      kind: "unknown",
      why:
        `no group can be called a candidate while the load balancers are unread — ${index.why} ` +
        `A security group an internet-facing load balancer is carrying would appear on this list ` +
        `as attached to nothing.`,
    }
  }
  if (securityGroups.state === "EMPTY") {
    return {
      kind: "candidates",
      groups: [],
      caveat: "ec2:DescribeSecurityGroups answered and this account has no security group at all.",
    }
  }
  if (!hasValue(securityGroups)) {
    return { kind: "unknown", why: describeRead(securityGroups, "the security groups") }
  }

  const groups = securityGroups.value.items
    .filter((group) => group.usage.kind === "no-attachment-visible")
    .filter((group) => (index.byGroup.get(group.groupId) ?? []).length === 0)
    .map((group) => ({
      key: group.groupId,
      groupId: group.groupId,
      groupName: group.groupName,
      vpcId: group.vpcId,
      description: group.description,
      openToInternet: group.openIngress.length > 0 || group.webIngress.length > 0,
      why: describeAttachment(group, index),
    }))
    .sort((a, b) => a.groupId.localeCompare(b.groupId))

  return {
    kind: "candidates",
    groups,
    caveat:
      "These are candidates, not findings. Nothing this engine read carries them — no load " +
      "balancer, no VPC endpoint, no other group's rule — and ec2:DescribeNetworkInterfaces, " +
      "which is the only call that would settle it, is not one this engine holds. An ECS task, " +
      "an RDS instance or a Lambda ENI could be holding any row below.",
  }
}

/* ─────────────────────────────────────────────────────────── the answer ── */

/** The one thing an operator opened this page to learn. */
export interface LeadAnswer {
  /** The word in the badge. Never the only carrier of the meaning. */
  verdict: string
  tone: Tone
  /** The answer, in words, before any apparatus. */
  headline: string
  /** Why the verdict is what it is. Never empty — every arm has a because. */
  because: string
}

/**
 * How many paths from the internet exist, and whether traffic is getting through.
 *
 * The order of the arms is the ranking the page is built on: an open path is
 * reported before a serving problem, because a database on the public internet
 * is worse news than a target failing its health check, and because the open
 * path is the finding this estate cannot currently see at all.
 *
 * `ok` is guarded four ways and every guard is mutated in `answer.test.ts`: the
 * paths read must have answered, it must have found nothing beyond 80/443, it
 * must not have stopped at its page cap, and the serving verdict must be
 * `all-healthy`. A truncated security-group walk that found nothing is not a
 * closed estate; it is the first four thousand groups of one.
 */
export function leadAnswer(paths: PathsReading, serving: ServingVerdict): LeadAnswer {
  if (paths.kind === "unknown") {
    return {
      verdict: "Unknown",
      tone: "warn",
      headline:
        "This console cannot say what can reach this estate from the internet. The security " +
        "groups were not read, and no number is being shown in place of that.",
      because: paths.why,
    }
  }

  const pathCount =
    `${paths.paths.length} path(s) from the internet were read across ${paths.groupsRead} ` +
    `security group(s): ${paths.beyondWeb} open something other than HTTP or HTTPS, ` +
    `${paths.webOnly} are on 80 or 443 only`
  const capped = paths.truncated
    ? " The security-group walk stopped at its page cap, so this is not every group in the account."
    : ""

  if (paths.beyondWeb > 0) {
    return {
      verdict: "Open to the internet",
      tone: "bad",
      headline:
        `${paths.beyondWeb} security group rule(s) accept traffic from the whole internet on ` +
        `something other than HTTP or HTTPS. ${servingSentence(serving)}`,
      because: `${pathCount}.${capped} The ranked table below names the port, the protocol and what this engine read that carries each group.`,
    }
  }

  if (serving.kind === "unknown" || serving.kind === "partly-unknown") {
    return {
      verdict: "Partly unknown",
      tone: "warn",
      headline:
        `Nothing beyond HTTP and HTTPS is reachable from the internet in what was read. Whether ` +
        `traffic is getting to the services cannot be said. ${servingSentence(serving)}`,
      because: `${pathCount}.${capped} ${serving.why}`,
    }
  }

  if (serving.kind === "nothing-serving" || serving.kind === "degraded") {
    return {
      verdict: "Not serving",
      tone: "bad",
      headline:
        `Nothing beyond HTTP and HTTPS is reachable from the internet in what was read, and ` +
        `traffic is not getting to the services. ${servingSentence(serving)}`,
      because: `${pathCount}.${capped} ${serving.why}`,
    }
  }

  if (paths.truncated) {
    return {
      verdict: "Partly read",
      tone: "warn",
      headline:
        "Nothing beyond HTTP and HTTPS was found in the security groups that were read, but the " +
        "walk stopped before the end of the account. That is not a closed estate.",
      because: `${pathCount}.${capped} ${serving.why}`,
    }
  }

  return {
    verdict: serving.kind === "no-load-balancers" ? "Closed" : "Closed and serving",
    tone: "ok",
    headline:
      `Nothing beyond HTTP and HTTPS is reachable from the internet. ${servingSentence(serving)}`,
    because: `${pathCount}. ${serving.why}`,
  }
}

/** The serving half of the lead, in one sentence, so both halves read as one. */
export function servingSentence(serving: ServingVerdict): string {
  switch (serving.kind) {
    case "unknown":
      return "Whether any load-balancer target is healthy is unknown — the load balancers were not read."
    case "no-load-balancers":
      return "There is no v2 load balancer in this account and region, so no target health to report."
    case "all-healthy":
      return `Every one of the ${serving.healthy} target(s) across ${serving.groups} target group(s) is healthy.`
    case "degraded":
      return `${serving.notServing} target(s) are not being served; ${serving.healthy} are.`
    case "nothing-serving":
      return `Not one of the ${serving.notServing} registered target(s) is being served.`
    case "partly-unknown":
      return "Target health is only partly known, so no claim is made that the estate is serving."
  }
}

/* ────────────────────────────────────────────────────────── provenance ─── */

export interface Provenance {
  identityState: string
  accountId?: string | null
  region?: string | null
  partition?: string | null
  principal?: string | null
  networkAsOf: string
  loadBalancerAsOf: string
  securityGroupsState: string
  loadBalancersState: string
  refreshSecurityGroupsMs: number
  refreshTargetHealthMs: number
}

/** Every value on this page, and which call produced it. Unknowns are spelled out. */
export function provenanceOf(provenance: Provenance): readonly Fact[] {
  const why = identityWhy(provenance.identityState)
  const seconds = (ms: number) => `${Math.round(ms / 1000)}s`
  return [
    { label: "Account", value: orUnknown(provenance.accountId, why) },
    { label: "Region", value: orUnknown(provenance.region, why) },
    { label: "Partition", value: orUnknown(provenance.partition, why) },
    { label: "Read as", value: orUnknown(provenance.principal, why) },
    { label: "Network read", value: provenance.securityGroupsState },
    { label: "Load balancer read", value: provenance.loadBalancersState },
    { label: "Network as of", value: provenance.networkAsOf },
    { label: "Load balancers as of", value: provenance.loadBalancerAsOf },
    {
      label: "Security groups refresh",
      value: `every ${seconds(provenance.refreshSecurityGroupsMs)}`,
    },
    {
      label: "Target health refresh",
      value: `every ${seconds(provenance.refreshTargetHealthMs)}`,
    },
  ]
}

/**
 * Everything the page needs, composed from the two readers in one place.
 *
 * `page.tsx` calls exactly this and renders what it returns. The composition
 * lives here rather than in the component so that `answer.test.ts` drives the
 * same function the route does — a test that assembled its own tally would stay
 * green on the day the page stopped calling one of these.
 */
export interface NetworkAnswer {
  attachments: AttachmentIndex
  paths: PathsReading
  tally: TargetTally
  serving: ServingVerdict
  lead: LeadAnswer
  unhealthy: readonly UnhealthyTargetRow[]
  plaintext: PlaintextListeners
  subnets: readonly SubnetRow[]
  vpcs: readonly VpcRow[]
  unattached: UnattachedReading
}

export function networkAnswer(
  network: NetworkReadings,
  loadBalancers: LoadBalancerReadings,
): NetworkAnswer {
  const attachments = attachmentsFromLoadBalancers(loadBalancers)
  const paths = openPaths(network.securityGroups, attachments)
  const tally = tallyTargets(loadBalancers)
  const serving = servingVerdict(loadBalancers, tally)
  const subnets = subnetRows(network.subnets, network.contradictoryNames)

  return {
    attachments,
    paths,
    tally,
    serving,
    lead: leadAnswer(paths, serving),
    unhealthy: unhealthyTargets(loadBalancers),
    plaintext: plaintextListeners(loadBalancers),
    subnets,
    vpcs: vpcRows(network.vpcs, subnets),
    unattached: unattachedCandidates(network.securityGroups, attachments),
  }
}
