/**
 * STUDIO-010-001 — the account topology, declared as data so a live read has
 * something to be reconciled against.
 *
 * Without a declaration there is nothing to compare: `organizations:ListAccounts`
 * returns a list of names and ids, and "is that the right set of accounts" is a
 * question only a declared intent can answer. The twelve roles below are the
 * ones the control-plane Bible names; each carries the SCALE at which it stops
 * being optional, so a single-account pilot is reported as compliant rather than
 * as eleven findings nobody can act on.
 *
 * `requiredWhen` is a function of the estate's own scale, not a boolean, because
 * "you should have a separate log-archive account" is true of a regulated
 * multi-tenant fleet and false of a pilot with one ECS service — and a checklist
 * that is wrong for the estate in front of you is a checklist people mute.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The second half of this module — everything below the "the wiring graph"
 * banner — answers a different question at a different altitude: STUDIO-080-001,
 * which resource serves which tenant and through what. See the header there.
 */

import { bucketPosture, type S3Readings } from "./buckets"
import type { Capability } from "./capabilities"
import { cdnReadings, type CdnReadings, type DistributionReading } from "./cdn"
import {
  certificateReadings,
  type CertificateReading,
  type CertificateReadings,
} from "./certificates"
import {
  containerReadings,
  serviceOfTaskGroup,
  type ClusterReading,
  type ContainerReadings,
  type ServiceReading,
  type TaskDefinitionReading,
  type TaskReading,
} from "./containers"
import { databaseReadings, type DatabaseReadings } from "./database"
import {
  classifyTarget,
  dnsReadings,
  hostVerdict,
  normaliseDnsName,
  type DnsReadings,
} from "./dns"
import { tableReadings, type DynamoDbReadings } from "./dynamodb-tables"
import { ecrReadings, type EcrReadings } from "./ecr"
import {
  loadBalancerReadings,
  type LoadBalancerReading,
  type LoadBalancerReadings,
  type TargetGroupReading,
} from "./loadbalancer"
import { describeRead, itemsOf, liveGateway, type AwsGateway, type AwsRead } from "./read"
import { secretReadings, type SecretsReadings } from "./secrets"
import { queueReadings, type SqsReadings } from "./sqs"

/** How big the estate is. Drives which account roles are required. */
export type EstateScale = "single-account-pilot" | "multi-account" | "regulated-multi-tenant"

export const ESTATE_SCALES: readonly EstateScale[] = [
  "single-account-pilot",
  "multi-account",
  "regulated-multi-tenant",
]

const ORDER: Record<EstateScale, number> = {
  "single-account-pilot": 0,
  "multi-account": 1,
  "regulated-multi-tenant": 2,
}

export interface AccountRole {
  key: string
  purpose: string
  /** The smallest scale at which this account must exist separately. */
  requiredFrom: EstateScale
}

export const ACCOUNT_ROLES: readonly AccountRole[] = [
  {
    key: "management",
    purpose:
      "Owns the Organization. Holds no day-to-day workload — an account that can attach an SCP must not also run the thing the SCP restrains.",
    requiredFrom: "multi-account",
  },
  {
    key: "log-archive",
    purpose: "Receives CloudTrail and Config delivery. Write-once for everyone else, including platform engineers.",
    requiredFrom: "multi-account",
  },
  {
    key: "security-tooling",
    purpose: "Security Hub, GuardDuty and Access Analyzer delegated administration; the aggregated findings view.",
    requiredFrom: "multi-account",
  },
  {
    key: "shared-services",
    purpose: "The engine itself, its registry, the artifact and image stores every cell pulls from.",
    requiredFrom: "multi-account",
  },
  {
    key: "network",
    purpose: "Transit gateway, resolver rules and the address plan cells attach to.",
    requiredFrom: "regulated-multi-tenant",
  },
  {
    key: "production-cell",
    purpose: "One account per production cell, so a blast radius is an account boundary rather than a tag.",
    requiredFrom: "multi-account",
  },
  {
    key: "staging-cell",
    purpose: "The same shape as a production cell, running the same release one step earlier.",
    requiredFrom: "multi-account",
  },
  {
    key: "development",
    purpose: "Where engineers build. Never holds tenant data, which is why it is a separate account rather than a VPC.",
    requiredFrom: "multi-account",
  },
  {
    key: "sandbox",
    purpose: "Detached experimentation with its own budget and no route to a tenant network.",
    requiredFrom: "regulated-multi-tenant",
  },
  {
    key: "backup-vault",
    purpose: "Holds copies of recovery points under a vault lock nobody in the workload account can release.",
    requiredFrom: "regulated-multi-tenant",
  },
  {
    key: "billing",
    purpose: "Cost and Usage Report delivery and budget ownership, separate from the account that spends.",
    requiredFrom: "regulated-multi-tenant",
  },
  {
    key: "audit-read-only",
    purpose: "The role an external auditor assumes. Read-only across the Organization, and used by nothing else.",
    requiredFrom: "regulated-multi-tenant",
  },
]

export function requiredAt(scale: EstateScale): readonly AccountRole[] {
  return ACCOUNT_ROLES.filter((r) => ORDER[r.requiredFrom] <= ORDER[scale])
}

export type TopologyVerdict =
  /** An account in the live read is tagged or named for this role. */
  | { role: AccountRole; state: "FILLED"; accountId: string; by: string }
  /** The role is required at this scale and nothing fills it. */
  | { role: AccountRole; state: "MISSING" }
  /** Not required at this scale. Reported so the list is complete, not as a finding. */
  | { role: AccountRole; state: "NOT_REQUIRED_AT_THIS_SCALE" }
  /** Single-account estate: this one account fills it, and that is the answer. */
  | { role: AccountRole; state: "SINGLE_ACCOUNT"; accountId: string }
  /** The Organization could not be read, so nothing can be said about the topology. */
  | { role: AccountRole; state: "UNKNOWN"; because: string }

export interface ObservedAccount {
  id: string
  name: string
  /** `tenure:account-role`, when the estate tags its accounts. */
  role?: string
}

/**
 * Reconcile the declared topology against what the Organization actually holds.
 *
 * `unknownBecause` is not an option that can be forgotten: when the caller could
 * not read the Organization it passes the reason, and EVERY row comes back
 * UNKNOWN. Reporting "missing" for an account you were not allowed to look for
 * is how an operator spends a morning creating accounts that already exist.
 */
export function reconcileTopology(input: {
  scale: EstateScale
  accounts: readonly ObservedAccount[]
  /** The account STS resolved, used for the single-account answer. */
  selfAccountId: string | null
  organizationInUse: boolean
  unknownBecause?: string
}): readonly TopologyVerdict[] {
  return ACCOUNT_ROLES.map((role): TopologyVerdict => {
    if (input.unknownBecause) return { role, state: "UNKNOWN", because: input.unknownBecause }

    if (!input.organizationInUse) {
      if (!input.selfAccountId) {
        return { role, state: "UNKNOWN", because: "no account id was resolved from sts:GetCallerIdentity" }
      }
      return { role, state: "SINGLE_ACCOUNT", accountId: input.selfAccountId }
    }

    const match = input.accounts.find(
      (a) => a.role?.trim().toLowerCase() === role.key || a.name.trim().toLowerCase() === role.key,
    )
    if (match) return { role, state: "FILLED", accountId: match.id, by: match.name }

    const required = ORDER[role.requiredFrom] <= ORDER[input.scale]
    return required ? { role, state: "MISSING" } : { role, state: "NOT_REQUIRED_AT_THIS_SCALE" }
  })
}

/* ========================================================================== */
/* ============================ the wiring graph ============================ */
/* ========================================================================== */

/**
 * STUDIO-080-001 — which AWS resource serves which tenant, and through what.
 *
 * ## The question
 *
 * A tenant is a hostname somebody types. Between that hostname and the row in a
 * database there are nine hops — DNS record, CloudFront distribution, load
 * balancer, listener, target group, ECS service, task definition, image digest,
 * ECR repository — and every one of them is a separate AWS API owned by a
 * separate reader in this directory. Each of those readers answers well about
 * its own hop and cannot see the one either side of it. `containers.ts` knows a
 * service registers target group `arn:...:targetgroup/app/abc`; nothing in
 * `containers.ts` can tell you that no load balancer forwards to it any more.
 *
 * That gap is the whole point. **The valuable output of this module is the
 * BROKEN edge, not the intact one.** An estate where every reader is green and
 * the chain is severed in one place is exactly the estate that pages at 3am:
 *
 *   * a DNS alias pointing at a distribution that does not exist — the record
 *     resolves, and whoever is handed that CloudFront domain next receives this
 *     tenant's traffic;
 *   * a target group with no healthy target — the load balancer answers, with
 *     503, and every panel above it is green;
 *   * a service running a digest that is absent from ECR — the image that is
 *     serving production cannot be rebuilt, rolled back to, or rescanned;
 *   * a listener certificate that expires before the next deploy window — which
 *     is a date arithmetic nobody does until the browser does it for them.
 *
 * ## An edge is not a boolean
 *
 * `EdgeState` has three arms and always will. `absent` means an index that
 * ANSWERED does not contain the far side — that is the finding. `unknown` means
 * this engine could not read that side, which is not a finding about the estate,
 * it is a finding about this engine's IAM. Collapsing the two is the same defect
 * `AwsRead` exists against, one level up: a denied `cloudfront:ListDistributions`
 * rendered as "the distribution is gone" sends an operator to recreate a
 * distribution that is serving traffic right now.
 *
 * So every `absent` in this file is reachable ONLY from a read that produced a
 * definite answer, and `why` on every arm names the evidence.
 *
 * ## Attribution, and what "shared" means here
 *
 * Attribution comes from tags and from nothing else — the readers have already
 * applied `tags.ts` to every resource they return, so this module consumes their
 * `attribution` field and never re-derives one from a name. A resource carrying
 * no `tenure:tenant` at all is labelled SHARED — it is not dropped from the
 * graph and it is not silently promoted into the tenant's own list. But
 * `declared: false` travels with it, because "somebody decided this is platform
 * overhead" and "nobody tagged this" are different facts with different
 * remedies, and folding them is how an untagged NAT gateway becomes forty
 * tenants' problem. A resource on the path tagged for a DIFFERENT tenant is its
 * own arm, `other-tenant`, and is a finding in its own right: it is a crossed
 * wire.
 *
 * ## What this module does not do
 *
 * It reads. There is no write path here and there cannot be one — `mutate.ts` is
 * the only place a mutation lives and nothing in this file imports it. A broken
 * edge is made VISIBLE; a human still has to repair it.
 */

/* ------------------------------------------------------------- the edge -- */

/**
 * Whether a hop in the chain is connected.
 *
 * Three arms, never a boolean. See the header: `absent` is a claim about the
 * estate and `unknown` is a claim about this engine's own reach, and a surface
 * that cannot tell them apart will report the second as the first on the worst
 * possible day.
 */
export type EdgeState = "present" | "absent" | "unknown"

/** The word each state renders as. Provably different text, by construction. */
export const EDGE_WORD: Readonly<Record<EdgeState, string>> = {
  present: "connected",
  absent: "NOT CONNECTED",
  unknown: "not readable",
}

/**
 * Who a resource belongs to, as this graph labels it.
 *
 * The readers' four-arm attribution, with the third arm renamed to what it means
 * for a wiring graph: a resource with no `tenure:tenant` still serves whatever
 * it is wired to, so it is SHARED — and `declared` carries whether anyone said
 * so.
 */
export type WiringAttribution =
  | { kind: "tenant"; tenantSlug: string }
  /** `tenure:tenant = tenure:shared`. Somebody decided this is platform overhead. */
  | { kind: "shared"; declared: true }
  /** No `tenure:tenant` at all. Shared in effect, and the missing tag is the finding. */
  | { kind: "shared"; declared: false; problem: string }
  /** The tag index itself was not read. Not "untagged" — see `tags.ts`. */
  | { kind: "unknown"; why: string }

/**
 * The four-arm attribution every reader in this directory returns.
 *
 * Declared structurally rather than imported from one of them, because eleven
 * modules each export their own nominal spelling of the same union
 * (`CdnAttribution`, `LoadBalancerAttribution`, `TableAttribution`, ...) and
 * importing one of the eleven would make the other ten arbitrary. Every one of
 * them is assignable to this.
 */
export type ReaderAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

/** A reader's attribution, in this graph's vocabulary. */
export function wiringAttribution(attribution: ReaderAttribution): WiringAttribution {
  switch (attribution.kind) {
    case "tenant":
      return { kind: "tenant", tenantSlug: attribution.tenantSlug }
    case "shared":
      return { kind: "shared", declared: true }
    case "unattributed":
      return {
        kind: "shared",
        declared: false,
        problem:
          "carries no tenure:tenant, so it is shared by default rather than by decision. " +
          "It cannot be charged to a tenant, and it will not be found when one is deleted.",
      }
    case "unknown":
      return { kind: "unknown", why: attribution.why }
  }
}

/**
 * What a resource is to THIS tenant.
 *
 * Derived from the attribution and the slug together, because the same
 * distribution is "mine" on one tenant's page and "somebody else's" on another,
 * and a node that rendered identically on both would be the crossed wire nobody
 * notices.
 */
export type PathRole =
  | { kind: "tenant" }
  | { kind: "shared"; declared: boolean }
  /** Tagged for a different tenant, and on this tenant's path. A crossed wire. */
  | { kind: "other-tenant"; tenantSlug: string }
  | { kind: "unknown"; why: string }

export function roleFor(attribution: WiringAttribution, slug: string): PathRole {
  switch (attribution.kind) {
    case "tenant":
      return attribution.tenantSlug === slug
        ? { kind: "tenant" }
        : { kind: "other-tenant", tenantSlug: attribution.tenantSlug }
    case "shared":
      return { kind: "shared", declared: attribution.declared }
    case "unknown":
      return { kind: "unknown", why: attribution.why }
  }
}

export function describeRole(role: PathRole): string {
  switch (role.kind) {
    case "tenant":
      return "this tenant's, by tenure:tenant"
    case "shared":
      return role.declared
        ? "shared — tagged tenure:shared, platform overhead by decision"
        : "shared — carries no tenure:tenant, so shared by default rather than by decision"
    case "other-tenant":
      return `tagged for ${role.tenantSlug} — a crossed wire, this is on the wrong tenant's path`
    case "unknown":
      return `attribution unknown — ${role.why}`
  }
}

/** What kind of thing sits at each end of an edge. */
export type WiringNodeKind =
  | "tenant"
  | "tenant-host"
  | "dns-record"
  | "cloudfront-distribution"
  | "load-balancer"
  | "listener"
  | "target-group"
  | "ecs-service"
  | "task-definition"
  | "container-image"
  /**
   * The image reference a task-definition revision DECLARES, as opposed to the
   * digest a running task reports. Two different facts — see `walkDeclaredImages`
   * — and folding them would hide the one that is about the future.
   */
  | "declared-image"
  | "ecr-repository"
  | "acm-certificate"
  | "deploy-window"
  | "rds-instance"
  | "dynamodb-table"
  | "s3-bucket"
  | "sqs-queue"
  | "secret"

export interface WiringNode {
  kind: WiringNodeKind
  /** The ARN when the resource has one, else the natural id AWS answers by. */
  id: string
  /** What an operator calls it. Never used as a join key — see `tags.ts`. */
  label: string
  attribution: WiringAttribution
  /** The attribution, relative to the tenant this graph was built for. */
  role: PathRole
}

/** Which hop of the chain an edge is. A slug, so a surface can group without parsing prose. */
export type WiringEdgeKind =
  | "host->dns-record"
  | "dns-record->cloudfront-distribution"
  | "dns-record->load-balancer"
  | "dns-record->elsewhere"
  | "cloudfront-distribution->load-balancer"
  | "cloudfront-distribution->s3-bucket"
  | "cloudfront-distribution->elsewhere"
  | "load-balancer->listener"
  | "load-balancer->target-group"
  | "listener->acm-certificate"
  | "acm-certificate->deploy-window"
  | "target-group->targets"
  | "target-group->ecs-service"
  | "ecs-service->task-definition"
  | "task-definition->container-image"
  | "container-image->ecr-repository"
  | "task-definition->declared-image"
  | "declared-image->ecr-repository"
  | "tenant->rds-instance"
  | "tenant->dynamodb-table"
  | "tenant->s3-bucket"
  | "tenant->sqs-queue"
  | "tenant->secret"

/**
 * The hops that make up the REQUEST PATH.
 *
 * Everything else — every `tenant->*` kind — is an attribution edge: it says a
 * resource carries this tenant's tag, not that a request travels through it.
 * The distinction is load-bearing. "This tenant has no SQS queue" is an
 * `absent` edge and is a true, useful statement; it is emphatically not a break
 * in the chain, and folding it into the break list is how the one row that
 * means an outage ends up eleventh in a table of eleven.
 */
export const PATH_EDGE_KINDS: ReadonlySet<string> = new Set<WiringEdgeKind>([
  "host->dns-record",
  "dns-record->cloudfront-distribution",
  "dns-record->load-balancer",
  "dns-record->elsewhere",
  "cloudfront-distribution->load-balancer",
  "cloudfront-distribution->s3-bucket",
  "cloudfront-distribution->elsewhere",
  "load-balancer->listener",
  "load-balancer->target-group",
  "listener->acm-certificate",
  "acm-certificate->deploy-window",
  "target-group->targets",
  "target-group->ecs-service",
  "ecs-service->task-definition",
  "task-definition->container-image",
  "container-image->ecr-repository",
])

/**
 * The hops that are about the NEXT task, not the one serving traffic now.
 *
 * A third category, and it is a third category because folding it either way
 * lies. Counted as a break, a tenant whose service is serving every request
 * correctly is reported as down, alongside the tenant that actually is — and the
 * row that means an outage stops being read. Counted as an attribution, "the
 * image this revision declares no longer exists in ECR" sits in a list titled
 * "resources tagged for this tenant", which is not what it is, and it is read as
 * housekeeping.
 *
 * It is neither. It is a break that has not happened yet and will happen at the
 * next task placement — a scale-out under load, an AZ replacement, a deploy —
 * which is to say at the moment when nobody has spare attention. `reachOf`
 * therefore reports it as a count on every arm rather than as the headline.
 */
export const LATENT_EDGE_KINDS: ReadonlySet<string> = new Set<WiringEdgeKind>([
  "task-definition->declared-image",
  "declared-image->ecr-repository",
])

export interface WiringEdge {
  kind: WiringEdgeKind
  from: WiringNode
  /**
   * The far side, or null when there is not one to name.
   *
   * Null is the normal shape of an `absent` edge — there is nothing there to
   * point at, which is the finding — and of an `unknown` edge whose index was
   * refused.
   *
   * One `present` edge is also null-ended, deliberately: `target-group->targets`.
   * Its far side is a set of registered IPs or instance ids, which is a health
   * fact about the group rather than a resource with an ARN, and minting a node
   * for it would put a thing in the graph that AWS does not have. The count and
   * every not-serving target are in `why`.
   */
  to: WiringNode | null
  state: EdgeState
  /**
   * The evidence, on every arm. `present` says which read proved it, `absent`
   * says which complete read failed to contain it, `unknown` says which read did
   * not answer. A surface never composes this sentence, so two surfaces cannot
   * compose different ones.
   */
  why: string
  /** The capability that would turn an `unknown` into an answer, when there is one. */
  needs: Capability | null
}

/* ---------------------------------------------------------- the readings -- */

/**
 * Every reader this graph joins, each whole.
 *
 * Whole readings, not flattened arrays. A flattened `readonly Distribution[]`
 * would turn a refused `cloudfront:ListDistributions` into an empty list, and
 * this module would then report every tenant's DNS alias as dangling — the
 * loudest possible false alarm, and precisely the failure `AwsRead` exists
 * against.
 *
 * Every field is REQUIRED. An optional reader would be invisible to `tsc` at a
 * call site that omits it, and the graph would silently lose a hop rather than
 * failing to compile.
 */
export interface WiringReadings {
  dns: DnsReadings
  cdn: CdnReadings
  loadBalancers: LoadBalancerReadings
  containers: ContainerReadings
  ecr: EcrReadings
  certificates: CertificateReadings
  databases: DatabaseReadings
  tables: DynamoDbReadings
  buckets: S3Readings
  queues: SqsReadings
  secrets: SecretsReadings
  /** When this whole load was assembled, so a surface need not invent one. */
  asOf: string
}

/**
 * When the next deploy is expected, and where that came from.
 *
 * `nextDeployAt` is `string | null` rather than optional on purpose. A
 * certificate horizon computed against an implicit "soon" is a number this
 * engine invented, and `null` — "nobody declared a deploy window" — is a real
 * answer that renders as `unknown`, not as "the certificate is fine".
 */
export interface DeployWindow {
  nextDeployAt: string | null
  /** Where the date came from, or why there is none. Never silent. */
  provenance: string
}

/** No deploy window was declared. A value, so a caller cannot forget the field. */
export const NO_DEPLOY_WINDOW: DeployWindow = {
  nextDeployAt: null,
  provenance:
    "no deploy window was supplied to this graph. This engine holds no capability that " +
    "reads a release calendar, and inventing a date would make the certificate horizon " +
    "an arithmetic on a number nobody set.",
}

/** Everything `tenantWiring` needs. Every field required — see `WiringReadings`. */
export interface WiringInput {
  /** The tenant's slug, exactly as `tenure:tenant` spells it. */
  slug: string
  /**
   * The tenant's hostnames, from the tenant record.
   *
   * Supplied, never derived from the slug: a host guessed as
   * `${slug}.example.com` that happens not to exist would be reported as a broken
   * chain for every tenant whose domain is spelled any other way.
   */
  hosts: readonly string[]
  readings: WiringReadings
  deployWindow: DeployWindow
  /** The clock, explicit, so a certificate horizon is reproducible in a test. */
  now: Date
}

/**
 * Whether the tenant's chain holds end to end.
 *
 * The headline, and every arm is careful about what it claims. `intact` is
 * reachable ONLY when every edge is `present` — one unread index makes it
 * `unverified`, whose entire job is to say that the absence of a break on the
 * screen is not evidence there is none.
 */
/**
 * `latent` is on EVERY arm, including `intact`.
 *
 * Deliberately not optional and deliberately not confined to one arm. A chain
 * that is intact right now and whose next task placement cannot pull its image is
 * both of those things at once, and an `intact` arm with nowhere to carry the
 * second fact would let a surface render "intact" over a service that is one
 * scale-out from an outage. See `LATENT_EDGE_KINDS`.
 */
export type ReachState =
  /** The tenant record names no hostname, so there is no chain to walk. */
  | { kind: "no-hosts"; latent: number; why: string }
  | { kind: "broken"; breaks: number; unreadable: number; latent: number; why: string }
  | { kind: "unverified"; unreadable: number; latent: number; why: string }
  | { kind: "intact"; edges: number; latent: number }

export interface TenantWiring {
  slug: string
  /** The hosts as walked: normalised, deduplicated, sorted. */
  hosts: readonly string[]
  nodes: readonly WiringNode[]
  edges: readonly WiringEdge[]
  /** `state === "absent"` on a REQUEST-PATH hop. The breaks — see `PATH_EDGE_KINDS`. */
  broken: readonly WiringEdge[]
  /**
   * `state === "absent"` on a hop about the NEXT task rather than the running one.
   *
   * Its own list, because it is its own severity: nothing is failing, and the next
   * task placed fails. See `LATENT_EDGE_KINDS`.
   */
  latent: readonly WiringEdge[]
  /**
   * `state === "absent"` on an attribution edge: "no resource of this kind carries
   * this tenant's tag". True, worth showing, and not an outage — which is why it
   * is a separate list from `broken` and from `latent`.
   */
  absentAttributions: readonly WiringEdge[]
  /** `state === "unknown"`. Never counted as intact, never counted as broken. */
  unreadable: readonly WiringEdge[]
  /** Nodes on the path that serve this tenant without being tagged for it. */
  shared: readonly WiringNode[]
  /** Nodes on the path tagged for a DIFFERENT tenant. Crossed wires. */
  foreign: readonly WiringNode[]
  /** Nodes carrying no `tenure:tenant` at all, so a surface can collapse them. */
  undeclaredShared: number
  reach: ReachState
  asOf: string
}

/* --------------------------------------------------------------- helpers -- */

/** The value when the read produced one, else null. Never a default. */
function valueOrNull<T>(read: AwsRead<T>): T | null {
  return read.state === "ACTUAL" || read.state === "STALE" ? read.value : null
}

/**
 * Whether a read produced a definite answer — a value, or a proven nothing.
 *
 * The gate on every `absent` in this file. `EMPTY` counts: it is the one state
 * that means "we looked and there is nothing", which is exactly what a broken
 * edge needs before it may be called broken.
 */
function conclusive(read: AwsRead<unknown>): boolean {
  return read.state === "ACTUAL" || read.state === "STALE" || read.state === "EMPTY"
}

/** An ELB DNS name matches its alias, including the conventional `dualstack.` form. */
function matchesElbName(target: string, dnsName: string | null): boolean {
  if (!dnsName) return false
  const lower = dnsName.toLowerCase()
  return target === lower || target.endsWith(`.${lower}`)
}

/* ------------------------------------------------------ image references -- */

/**
 * A container image reference, split into the parts ECR can be asked about.
 *
 * Parsed here rather than by a regular expression at each call site because the
 * shape has three optional halves — registry host, tag, digest — and getting it
 * wrong in the quiet direction (treating `app:2026.07.31` as a repository called
 * `app:2026.07.31`) reports every running image as absent from ECR.
 */
export interface ImageReference {
  /** The registry host, or null for a bare Docker Hub-style name. */
  registry: string | null
  /** The repository path — `tenure/app`. What `ecr:DescribeRepositories` answers by. */
  repository: string
  tag: string | null
  digest: string | null
  /**
   * Whether the registry host is an ECR one.
   *
   * Matched on the `.dkr.ecr.` segment rather than on a full commercial-partition
   * suffix, for the reason `classifyTarget` gives: `amazonaws.com` is only the
   * commercial spelling and a rule keyed on it stops recognising every GovCloud
   * and China registry, which then reads as "not ours".
   */
  ecr: boolean
}

export function parseImageReference(image: string): ImageReference | null {
  const raw = image.trim()
  if (!raw) return null

  let rest = raw
  let digest: string | null = null
  const at = rest.indexOf("@")
  if (at >= 0) {
    digest = rest.slice(at + 1) || null
    rest = rest.slice(0, at)
  }

  let registry: string | null = null
  const slash = rest.indexOf("/")
  if (slash > 0) {
    const head = rest.slice(0, slash)
    // A registry host is the only first segment that can carry a dot or a port.
    if (head.includes(".") || head.includes(":") || head === "localhost") {
      registry = head
      rest = rest.slice(slash + 1)
    }
  }

  let tag: string | null = null
  const colon = rest.lastIndexOf(":")
  if (colon > 0 && !rest.slice(colon + 1).includes("/")) {
    tag = rest.slice(colon + 1) || null
    rest = rest.slice(0, colon)
  }

  if (!rest) return null
  return {
    registry,
    repository: rest,
    tag,
    digest,
    ecr: registry !== null && /\.dkr\.ecr\./.test(registry),
  }
}

/**
 * The bucket name in an S3 origin domain, or null.
 *
 * Both spellings AWS produces: the REST endpoint `NAME.s3.REGION.amazonaws.com`
 * and the website endpoint `NAME.s3-website-REGION.amazonaws.com`. Matched on the
 * `.s3.`/`.s3-website` segment rather than on a partition suffix, for the reason
 * `classifyTarget` gives.
 */
export function s3BucketFromOrigin(domain: string): string | null {
  const match = /^(.+?)\.s3[.-]/.exec(domain)
  if (!match) return null
  const name = match[1]
  return name && !name.includes("/") ? name : null
}

/* ----------------------------------------------------------- traversal -- */

interface Graph {
  nodes: Map<string, WiringNode>
  edges: WiringEdge[]
  slug: string
}

function nodeKey(kind: WiringNodeKind, id: string): string {
  return `${kind}|${id}`
}

function node(
  graph: Graph,
  kind: WiringNodeKind,
  id: string,
  label: string,
  attribution: WiringAttribution,
): WiringNode {
  const key = nodeKey(kind, id)
  const existing = graph.nodes.get(key)
  if (existing) return existing
  const created: WiringNode = {
    kind,
    id,
    label,
    attribution,
    role: roleFor(attribution, graph.slug),
  }
  graph.nodes.set(key, created)
  return created
}

function edge(
  graph: Graph,
  kind: WiringEdgeKind,
  from: WiringNode,
  to: WiringNode | null,
  state: EdgeState,
  why: string,
  needs: Capability | null = null,
): void {
  graph.edges.push({ kind, from, to, state, why, needs })
}

/** The attribution this graph gives anything AWS does not let anybody tag. */
function notTaggable(why: string): WiringAttribution {
  return { kind: "unknown", why }
}

/** Every service in the estate, with the cluster it runs in and what was not readable. */
interface ServicePlacement {
  cluster: ClusterReading
  service: ServiceReading
}

function placedServices(containers: ContainerReadings): {
  services: readonly ServicePlacement[]
  /** Clusters whose service list did not answer. Named, so nothing is implied. */
  unread: readonly string[]
  /** The listing's own failure, when the cluster list itself did not answer. */
  listingWhy: string | null
} {
  if (!conclusive(containers.clusters)) {
    return {
      services: [],
      unread: [],
      listingWhy: describeRead(containers.clusters, "the ECS cluster listing"),
    }
  }
  const services: ServicePlacement[] = []
  const unread: string[] = []
  for (const cluster of itemsOf(containers.clusters)) {
    if (!conclusive(cluster.services)) {
      unread.push(`${cluster.name}: ${describeRead(cluster.services, "its service list")}`)
      continue
    }
    for (const service of itemsOf(cluster.services)) services.push({ cluster, service })
  }
  return { services, unread, listingWhy: null }
}

/* -------------------------------------------------------------- the walk -- */

/**
 * The whole path, for one tenant.
 *
 * Pure: every AWS answer arrives in `input.readings` and nothing here calls AWS.
 * That is what makes a broken edge reproducible in a test — the interesting
 * cases are all "an index answered and did not contain the far side", which is a
 * shape a live account will not hold on demand.
 */
export function tenantWiring(input: WiringInput): TenantWiring {
  const { slug, readings } = input
  const graph: Graph = { nodes: new Map(), edges: [], slug }

  const tenantNode = node(graph, "tenant", slug, slug, { kind: "tenant", tenantSlug: slug })

  const hosts = [...new Set(input.hosts.map(normaliseDnsName).filter((h) => h.length > 0))].sort()

  for (const host of hosts) walkHost(graph, input, host)
  walkDataPlane(graph, input, tenantNode)

  const nodes = [...graph.nodes.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  )
  const edges = graph.edges
  const absent = edges.filter((e) => e.state === "absent")
  const unreadable = edges.filter((e) => e.state === "unknown")

  return {
    slug,
    hosts,
    nodes,
    edges,
    broken: absent.filter(isPathEdge),
    latent: absent.filter(isLatentEdge),
    // Neither a hop in the request path nor a hop about the next task. Everything
    // left is a tag attribution. Written as an exclusion of BOTH sets rather than
    // of `isPathEdge` alone, so that adding a latent kind cannot quietly file it
    // under "resources tagged for this tenant".
    absentAttributions: absent.filter((e) => !isPathEdge(e) && !isLatentEdge(e)),
    unreadable,
    shared: nodes.filter((n) => n.role.kind === "shared"),
    foreign: nodes.filter((n) => n.role.kind === "other-tenant"),
    undeclaredShared: nodes.filter((n) => n.role.kind === "shared" && !n.role.declared).length,
    reach: reachOf(hosts, edges),
    asOf: readings.asOf,
  }
}

/** Whether an edge is a hop in the request path, rather than a tag attribution. */
export function isPathEdge(edge: WiringEdge): boolean {
  return PATH_EDGE_KINDS.has(edge.kind)
}

/** Whether an edge is about the NEXT task placement rather than the running one. */
export function isLatentEdge(edge: WiringEdge): boolean {
  return LATENT_EDGE_KINDS.has(edge.kind)
}

/**
 * The headline.
 *
 * `breaks` counts PATH edges only: whether a request reaches this tenant is a
 * question about the chain, and "no SQS queue carries this tag" does not stop
 * one. `unreadable` counts BOTH kinds, because an RDS listing this engine was
 * refused is a real limit on what the page may claim, wherever it sits.
 */
function reachOf(hosts: readonly string[], edges: readonly WiringEdge[]): ReachState {
  const latent = edges.filter((e) => e.state === "absent" && isLatentEdge(e)).length
  if (hosts.length === 0) {
    return {
      kind: "no-hosts",
      latent,
      why:
        "this tenant's record names no hostname, so there is no chain to walk. That is not the " +
        "same fact as a chain that is intact.",
    }
  }
  const breaks = edges.filter((e) => e.state === "absent" && isPathEdge(e)).length
  const unreadable = edges.filter((e) => e.state === "unknown").length
  if (breaks > 0) {
    return {
      kind: "broken",
      breaks,
      unreadable,
      latent,
      why:
        `${breaks} hop${breaks === 1 ? "" : "s"} in this tenant's chain point at something an index ` +
        `that ANSWERED does not contain`,
    }
  }
  if (unreadable > 0) {
    return {
      kind: "unverified",
      unreadable,
      latent,
      why:
        `no break was found, and ${unreadable} hop${unreadable === 1 ? " was" : "s were"} not ` +
        `readable. A chain with an unread hop is not a chain that holds.`,
    }
  }
  return { kind: "intact", edges: edges.length, latent }
}

/* ------------------------------------------------------ host -> the edge -- */

function walkHost(graph: Graph, input: WiringInput, host: string): void {
  const { readings } = input
  const hostNode = node(graph, "tenant-host", host, host, {
    kind: "tenant",
    tenantSlug: input.slug,
  })

  // Consumed, not forked: `hostVerdict` already owns zone selection, wildcard
  // decoding, split-horizon ambiguity and the owned/dangling/unverifiable
  // decision. A second implementation here would be a second answer to "where
  // does this host resolve", and the two would disagree the week one changed.
  const verdict = hostVerdict(readings.dns, host)

  const zoneName = "zoneName" in verdict ? verdict.zoneName : null
  const zone = zoneName
    ? ((valueOrNull(readings.dns.zones) ?? []).find((z) => z.name === zoneName) ?? null)
    : null
  const recordAttribution: WiringAttribution = zone
    ? wiringAttribution(zone.attribution)
    : notTaggable(
        "no hosted zone was resolved for this host, so there is no zone whose tags could " +
          "attribute its records",
      )

  if (verdict.kind === "unknown" || verdict.kind === "ambiguous-zone") {
    edge(
      graph,
      "host->dns-record",
      hostNode,
      null,
      "unknown",
      verdict.why,
      "route53:ListResourceRecordSets",
    )
    return
  }
  if (verdict.kind === "no-zone" || verdict.kind === "no-record") {
    edge(graph, "host->dns-record", hostNode, null, "absent", verdict.why)
    return
  }

  const recordId = `${verdict.zoneName}|${host}|${verdict.recordType}`
  const recordNode = node(
    graph,
    "dns-record",
    recordId,
    `${verdict.recordType} ${host} in ${verdict.zoneName}`,
    recordAttribution,
  )
  edge(
    graph,
    "host->dns-record",
    hostNode,
    recordNode,
    "present",
    `route53:ListResourceRecordSets returned a ${verdict.recordType} record set for ${host} in ` +
      `${verdict.zoneName}`,
  )

  if (verdict.kind === "dangling") {
    const kind: WiringEdgeKind =
      verdict.service === "cloudfront"
        ? "dns-record->cloudfront-distribution"
        : verdict.service === "elb"
          ? "dns-record->load-balancer"
          : "dns-record->elsewhere"
    edge(graph, kind, recordNode, null, "absent", verdict.why)
    return
  }

  if (verdict.kind === "points-at-distribution") {
    const distribution = (valueOrNull(readings.cdn.distributions) ?? []).find(
      (d) => d.id === verdict.distributionId,
    )
    if (!distribution) {
      edge(
        graph,
        "dns-record->cloudfront-distribution",
        recordNode,
        null,
        "unknown",
        `${host} resolves to the CloudFront domain ${verdict.distributionDomain}, which Route 53's ` +
          `own ownership index matched — but the CloudFront reading this graph holds does not carry ` +
          `that distribution: ` +
          `${describeRead(readings.cdn.distributions, "cloudfront:ListDistributions")}`,
        "cloudfront:ListDistributions",
      )
      return
    }
    const distributionNode = node(
      graph,
      "cloudfront-distribution",
      distribution.id,
      distribution.domainName ?? distribution.id,
      wiringAttribution(distribution.attribution),
    )
    edge(
      graph,
      "dns-record->cloudfront-distribution",
      recordNode,
      distributionNode,
      "present",
      verdict.why,
    )
    walkDistribution(graph, input, distribution, distributionNode)
    return
  }

  // points-elsewhere: the record resolves at something real that is not a
  // distribution. A load balancer is the one this graph can keep walking.
  if (verdict.service === "elb") {
    const balancer = (valueOrNull(readings.loadBalancers.loadBalancers) ?? []).find((lb) =>
      matchesElbName(verdict.target, lb.dnsName),
    )
    if (!balancer) {
      edge(
        graph,
        "dns-record->load-balancer",
        recordNode,
        null,
        conclusive(readings.loadBalancers.loadBalancers) ? "absent" : "unknown",
        conclusive(readings.loadBalancers.loadBalancers)
          ? `${host} resolves to the load balancer domain ${verdict.target}, and ` +
            `elasticloadbalancing:DescribeLoadBalancers listed every load balancer in this region ` +
            `without returning one that answers to it`
          : `${host} resolves to the load balancer domain ${verdict.target} and the load balancer ` +
            `reading did not answer — ` +
            `${describeRead(readings.loadBalancers.loadBalancers, "elasticloadbalancing:DescribeLoadBalancers")}`,
        "elasticloadbalancing:DescribeLoadBalancers",
      )
      return
    }
    const balancerNode = node(
      graph,
      "load-balancer",
      balancer.arn,
      balancer.name ?? balancer.arn,
      wiringAttribution(balancer.attribution),
    )
    edge(graph, "dns-record->load-balancer", recordNode, balancerNode, "present", verdict.why)
    walkLoadBalancer(graph, input, balancer, balancerNode)
    return
  }

  edge(
    graph,
    "dns-record->elsewhere",
    recordNode,
    null,
    "unknown",
    `${verdict.why} This graph cannot walk past a ${verdict.service} target: no reader in this ` +
      `engine enumerates one, so what is on the other side is not claimed either way.`,
  )
}

/* ------------------------------------------------- distribution -> origin -- */

function walkDistribution(
  graph: Graph,
  input: WiringInput,
  distribution: DistributionReading,
  distributionNode: WiringNode,
): void {
  const { readings } = input
  const config = valueOrNull(distribution.config)
  if (!config) {
    edge(
      graph,
      "cloudfront-distribution->load-balancer",
      distributionNode,
      null,
      "unknown",
      `distribution ${distribution.id}'s configuration was not read, so its origins are not known — ` +
        `${describeRead(distribution.config, "cloudfront:GetDistributionConfig")}`,
      "cloudfront:GetDistributionConfig",
    )
    return
  }

  for (const origin of [...config.origins].sort((a, b) => a.id.localeCompare(b.id))) {
    const domain = origin.domainName?.toLowerCase() ?? null
    if (!domain) {
      edge(
        graph,
        "cloudfront-distribution->elsewhere",
        distributionNode,
        null,
        "unknown",
        `origin ${origin.id} on distribution ${distribution.id} has no domain name in the ` +
          `configuration AWS returned, so there is nothing to resolve it against`,
      )
      continue
    }
    const service = classifyTarget(domain, false)

    if (service === "elb") {
      const balancer = (valueOrNull(readings.loadBalancers.loadBalancers) ?? []).find((lb) =>
        matchesElbName(domain, lb.dnsName),
      )
      if (balancer) {
        const balancerNode = node(
          graph,
          "load-balancer",
          balancer.arn,
          balancer.name ?? balancer.arn,
          wiringAttribution(balancer.attribution),
        )
        edge(
          graph,
          "cloudfront-distribution->load-balancer",
          distributionNode,
          balancerNode,
          "present",
          `origin ${origin.id} on distribution ${distribution.id} is ${domain}, which ` +
            `elasticloadbalancing:DescribeLoadBalancers returned as ${balancer.arn}`,
        )
        walkLoadBalancer(graph, input, balancer, balancerNode)
        continue
      }
      edge(
        graph,
        "cloudfront-distribution->load-balancer",
        distributionNode,
        null,
        conclusive(readings.loadBalancers.loadBalancers) ? "absent" : "unknown",
        conclusive(readings.loadBalancers.loadBalancers)
          ? `origin ${origin.id} on distribution ${distribution.id} is the load balancer domain ` +
            `${domain}, and elasticloadbalancing:DescribeLoadBalancers listed every load balancer ` +
            `in this region without returning one that answers to it. The edge has nowhere to send ` +
            `a request this origin handles.`
          : `origin ${origin.id} on distribution ${distribution.id} is the load balancer domain ` +
            `${domain} and the load balancer reading did not answer — ` +
            `${describeRead(readings.loadBalancers.loadBalancers, "elasticloadbalancing:DescribeLoadBalancers")}`,
        "elasticloadbalancing:DescribeLoadBalancers",
      )
      continue
    }

    const bucketName = s3BucketFromOrigin(domain)
    if (bucketName) {
      const bucket = (valueOrNull(readings.buckets.buckets) ?? []).find((b) => b.name === bucketName)
      if (bucket) {
        const bucketNode = node(
          graph,
          "s3-bucket",
          bucket.arn ?? bucket.name,
          bucket.name,
          wiringAttribution(bucket.attribution),
        )
        edge(
          graph,
          "cloudfront-distribution->s3-bucket",
          distributionNode,
          bucketNode,
          "present",
          `origin ${origin.id} on distribution ${distribution.id} is ${domain}, and s3:ListBuckets ` +
            `returned a bucket named ${bucket.name}`,
        )
        continue
      }
      edge(
        graph,
        "cloudfront-distribution->s3-bucket",
        distributionNode,
        null,
        conclusive(readings.buckets.buckets) ? "absent" : "unknown",
        conclusive(readings.buckets.buckets)
          ? `origin ${origin.id} on distribution ${distribution.id} is ${domain}, and s3:ListBuckets ` +
            `listed every bucket this account owns without returning ${bucketName}. The origin is gone.`
          : `origin ${origin.id} on distribution ${distribution.id} is ${domain} and the bucket ` +
            `listing did not answer — ${describeRead(readings.buckets.buckets, "s3:ListBuckets")}`,
        "s3:ListBuckets",
      )
      continue
    }

    edge(
      graph,
      "cloudfront-distribution->elsewhere",
      distributionNode,
      null,
      "unknown",
      `origin ${origin.id} on distribution ${distribution.id} is ${domain}, which is neither a load ` +
        `balancer domain nor an S3 endpoint. No reader in this engine enumerates it, so whether it ` +
        `still exists is not claimed either way.`,
    )
  }
}

/* ----------------------------------------- load balancer -> target group -- */

function walkLoadBalancer(
  graph: Graph,
  input: WiringInput,
  balancer: LoadBalancerReading,
  balancerNode: WiringNode,
): void {
  walkListeners(graph, input, balancer, balancerNode)

  if (!conclusive(balancer.targetGroups)) {
    edge(
      graph,
      "load-balancer->target-group",
      balancerNode,
      null,
      "unknown",
      `${balancer.name ?? balancer.arn}'s target groups were not read — ` +
        `${describeRead(balancer.targetGroups, "elasticloadbalancing:DescribeTargetGroups")}`,
      "elasticloadbalancing:DescribeTargetGroups",
    )
    return
  }

  const groups = itemsOf(balancer.targetGroups).filter((g) =>
    g.loadBalancerArns.includes(balancer.arn),
  )
  if (groups.length === 0) {
    edge(
      graph,
      "load-balancer->target-group",
      balancerNode,
      null,
      "absent",
      `elasticloadbalancing:DescribeTargetGroups answered for ${balancer.name ?? balancer.arn} and ` +
        `returned no target group attached to it. The load balancer forwards to nothing.`,
    )
    return
  }

  for (const group of [...groups].sort((a, b) => a.arn.localeCompare(b.arn))) {
    const groupNode = node(
      graph,
      "target-group",
      group.arn,
      group.name ?? group.arn,
      wiringAttribution(group.attribution),
    )
    edge(
      graph,
      "load-balancer->target-group",
      balancerNode,
      groupNode,
      "present",
      `elasticloadbalancing:DescribeTargetGroups returned ${group.name ?? group.arn} attached to ` +
        `${balancer.name ?? balancer.arn}`,
    )
    walkTargetGroup(graph, input, group, groupNode)
  }
}

function walkListeners(
  graph: Graph,
  input: WiringInput,
  balancer: LoadBalancerReading,
  balancerNode: WiringNode,
): void {
  if (!conclusive(balancer.listeners)) {
    edge(
      graph,
      "load-balancer->listener",
      balancerNode,
      null,
      "unknown",
      `${balancer.name ?? balancer.arn}'s listeners were not read, so neither the certificates it ` +
        `presents nor the target groups it forwards to are known — ` +
        `${describeRead(balancer.listeners, "elasticloadbalancing:DescribeListeners")}`,
      "elasticloadbalancing:DescribeListeners",
    )
    return
  }

  const known = new Set(itemsOf(balancer.targetGroups).map((g) => g.arn))
  const groupsReadable = conclusive(balancer.targetGroups)

  for (const listener of [...itemsOf(balancer.listeners)].sort((a, b) =>
    a.arn.localeCompare(b.arn),
  )) {
    const listenerNode = node(
      graph,
      "listener",
      listener.arn,
      `${listener.protocol ?? "?"}:${listener.port ?? "?"} on ${balancer.name ?? balancer.arn}`,
      // A listener carries no tags of its own; it inherits the question from the
      // load balancer it belongs to, which is a fact rather than a guess.
      wiringAttribution(balancer.attribution),
    )
    edge(
      graph,
      "load-balancer->listener",
      balancerNode,
      listenerNode,
      "present",
      `elasticloadbalancing:DescribeListeners returned ${listener.arn} on ` +
        `${balancer.name ?? balancer.arn}`,
    )

    // A listener whose default action forwards to a target group the target-group
    // read did not return is a break the target-group walk cannot see, because
    // that walk starts from the groups that DO exist.
    if (groupsReadable) {
      for (const arn of [...listener.forwardsTo].sort()) {
        if (known.has(arn)) continue
        edge(
          graph,
          "load-balancer->target-group",
          listenerNode,
          null,
          "absent",
          `listener ${listener.arn} forwards to ${arn}, and ` +
            `elasticloadbalancing:DescribeTargetGroups answered for this load balancer without ` +
            `returning it. Requests matching this listener's default action reach no target group.`,
        )
      }
    }

    for (const binding of [...listener.certificates].sort((a, b) => a.arn.localeCompare(b.arn))) {
      walkCertificate(graph, input, listenerNode, binding.arn)
    }
  }
}

/* --------------------------------- listener -> certificate -> the horizon -- */

function walkCertificate(
  graph: Graph,
  input: WiringInput,
  listenerNode: WiringNode,
  certificateArn: string,
): void {
  const { readings } = input
  const certificates = readings.certificates.certificates

  const certificate: CertificateReading | undefined = (valueOrNull(certificates) ?? []).find(
    (c) => c.arn === certificateArn,
  )
  if (!certificate) {
    edge(
      graph,
      "listener->acm-certificate",
      listenerNode,
      null,
      conclusive(certificates) ? "absent" : "unknown",
      conclusive(certificates)
        ? `${listenerNode.label} presents ${certificateArn}, and acm:ListCertificates listed every ` +
          `certificate in this region without returning it. The listener is bound to a certificate ` +
          `this engine cannot see — it is in another region or another account — so its expiry is ` +
          `not being watched here.`
        : `${listenerNode.label} presents ${certificateArn} and the certificate listing did not ` +
          `answer — ${describeRead(certificates, "acm:ListCertificates")}`,
      "acm:ListCertificates",
    )
    return
  }

  const certificateNode = node(
    graph,
    "acm-certificate",
    certificate.arn,
    certificate.domainName,
    wiringAttribution(certificate.attribution),
  )
  edge(
    graph,
    "listener->acm-certificate",
    listenerNode,
    certificateNode,
    "present",
    `acm:ListCertificates returned ${certificate.arn} (${certificate.domainName}), which ` +
      `${listenerNode.label} presents`,
  )

  walkDeployWindow(graph, input, certificate, certificateNode)
}

/**
 * Whether the certificate outlives the next deploy.
 *
 * Modelled as an edge rather than as a field on the certificate node because it
 * is a relationship between two things — a certificate and a date — and because
 * the three states are exactly the three an edge has. `absent` is the break: the
 * certificate stops being valid before anybody is next scheduled to touch this
 * service, so nobody will be looking when it does.
 */
function walkDeployWindow(
  graph: Graph,
  input: WiringInput,
  certificate: CertificateReading,
  certificateNode: WiringNode,
): void {
  const { deployWindow } = input
  const windowNode = node(
    graph,
    "deploy-window",
    deployWindow.nextDeployAt ?? "undeclared",
    deployWindow.nextDeployAt ?? "no declared deploy window",
    notTaggable("a deploy window is a declared date, not an AWS resource, so nothing tags it"),
  )

  if (deployWindow.nextDeployAt === null) {
    edge(
      graph,
      "acm-certificate->deploy-window",
      certificateNode,
      windowNode,
      "unknown",
      `whether ${certificate.arn} outlives the next deploy cannot be decided: ` +
        `${deployWindow.provenance}`,
    )
    return
  }

  const detail = valueOrNull(certificate.detail)
  if (!detail) {
    edge(
      graph,
      "acm-certificate->deploy-window",
      certificateNode,
      windowNode,
      "unknown",
      `${certificate.arn}'s expiry was not read, so it cannot be compared with the deploy window at ` +
        `${deployWindow.nextDeployAt} — ${describeRead(certificate.detail, "acm:DescribeCertificate")}`,
      "acm:DescribeCertificate",
    )
    return
  }

  if (detail.expiry.kind === "unknown") {
    edge(
      graph,
      "acm-certificate->deploy-window",
      certificateNode,
      windowNode,
      "unknown",
      `${certificate.arn} has no readable expiry — ${detail.expiry.why}`,
    )
    return
  }

  const notAfter = Date.parse(detail.expiry.notAfter)
  const deployAt = Date.parse(deployWindow.nextDeployAt)
  if (!Number.isFinite(notAfter) || !Number.isFinite(deployAt)) {
    edge(
      graph,
      "acm-certificate->deploy-window",
      certificateNode,
      windowNode,
      "unknown",
      `${certificate.arn} expires at ${detail.expiry.notAfter} and the deploy window is ` +
        `${deployWindow.nextDeployAt}; one of the two is not a date this engine can parse, and it ` +
        `will not guess which.`,
    )
    return
  }

  if (notAfter <= deployAt) {
    edge(
      graph,
      "acm-certificate->deploy-window",
      certificateNode,
      windowNode,
      "absent",
      `${certificate.arn} (${certificate.domainName}) expires at ${detail.expiry.notAfter}, which is ` +
        `BEFORE the next deploy window at ${deployWindow.nextDeployAt} ` +
        `(${deployWindow.provenance}). ` +
        `${detail.expiry.kind === "expired" ? "It has already expired. " : ""}` +
        `Every request to this listener fails at the TLS handshake from that instant, and no deploy ` +
        `is scheduled between now (${input.now.toISOString()}) and then for anybody to notice.`,
    )
    return
  }

  edge(
    graph,
    "acm-certificate->deploy-window",
    certificateNode,
    windowNode,
    "present",
    `${certificate.arn} expires at ${detail.expiry.notAfter}, after the next deploy window at ` +
      `${deployWindow.nextDeployAt} (${deployWindow.provenance})`,
  )
}

/* ---------------------------- target group -> targets, and -> ECS service -- */

function notServingList(
  targets: readonly { targetId: string; port: number | null; state: string; reasonCode: string | null }[],
): string {
  return targets
    .map(
      (t) =>
        `${t.targetId}${t.port === null ? "" : `:${t.port}`} ${t.state}` +
        `${t.reasonCode ? ` (${t.reasonCode})` : ""}`,
    )
    .join("; ")
}

function walkTargetGroup(
  graph: Graph,
  input: WiringInput,
  group: TargetGroupReading,
  groupNode: WiringNode,
): void {
  const name = group.name ?? group.arn

  switch (group.serving.kind) {
    case "unknown":
      edge(
        graph,
        "target-group->targets",
        groupNode,
        null,
        "unknown",
        `${name}'s target health was not read — ${group.serving.why}`,
        "elasticloadbalancing:DescribeTargetHealth",
      )
      break
    case "no-targets":
      edge(
        graph,
        "target-group->targets",
        groupNode,
        null,
        "absent",
        `elasticloadbalancing:DescribeTargetHealth answered for ${name} and returned no target at ` +
          `all. Nothing is registered, so the load balancer has nowhere to send a request. ` +
          `${group.serving.why}`,
      )
      break
    case "none-serving":
      edge(
        graph,
        "target-group->targets",
        groupNode,
        null,
        "absent",
        `${name} has ${group.serving.notServing.length} registered target` +
          `${group.serving.notServing.length === 1 ? "" : "s"} and the load balancer will route to ` +
          `none of them: ${notServingList(group.serving.notServing)}`,
      )
      break
    case "degraded":
      edge(
        graph,
        "target-group->targets",
        groupNode,
        null,
        "present",
        `${name} is serving from ${group.serving.healthy} healthy target` +
          `${group.serving.healthy === 1 ? "" : "s"}, with ${group.serving.notServing.length} not ` +
          `serving: ${notServingList(group.serving.notServing)}`,
      )
      break
    case "all-serving":
      edge(
        graph,
        "target-group->targets",
        groupNode,
        null,
        "present",
        `elasticloadbalancing:DescribeTargetHealth reports ${group.serving.healthy} healthy target` +
          `${group.serving.healthy === 1 ? "" : "s"} in ${name}`,
      )
      break
  }

  const placed = placedServices(input.readings.containers)
  if (placed.listingWhy) {
    edge(
      graph,
      "target-group->ecs-service",
      groupNode,
      null,
      "unknown",
      `which ECS service registers ${name} is unknown: ${placed.listingWhy}`,
      "ecs:ListClusters",
    )
    return
  }

  const registering = placed.services.filter((p) => p.service.targetGroupArns.includes(group.arn))
  if (registering.length === 0) {
    if (placed.unread.length > 0) {
      edge(
        graph,
        "target-group->ecs-service",
        groupNode,
        null,
        "unknown",
        `no ECS service this engine could read registers ${name}, and ${placed.unread.length} ` +
          `cluster${placed.unread.length === 1 ? "'s service list was" : "s' service lists were"} ` +
          `not readable — ${placed.unread.join("; ")}. An absence from a partial list is not an ` +
          `absence.`,
        "ecs:ListServices",
      )
      return
    }
    edge(
      graph,
      "target-group->ecs-service",
      groupNode,
      null,
      "absent",
      `every ECS service in every cluster this account holds was read, and none of them registers ` +
        `${name}. The target group is wired to the load balancer and nothing puts tasks into it.`,
    )
    return
  }

  for (const placement of [...registering].sort((a, b) =>
    a.service.arn.localeCompare(b.service.arn),
  )) {
    const serviceNode = node(
      graph,
      "ecs-service",
      placement.service.arn,
      placement.service.name,
      wiringAttribution(placement.service.attribution),
    )
    edge(
      graph,
      "target-group->ecs-service",
      groupNode,
      serviceNode,
      "present",
      `ecs:DescribeServices reports ${placement.service.name} in ${placement.cluster.name} ` +
        `registering ${name}`,
    )
    walkService(graph, input, placement, serviceNode)
  }
}

/* -------------------- service -> task definition -> digest -> repository -- */

function walkService(
  graph: Graph,
  input: WiringInput,
  placement: ServicePlacement,
  serviceNode: WiringNode,
): void {
  const { service } = placement

  if (service.taskDefinitionArn === null) {
    edge(
      graph,
      "ecs-service->task-definition",
      serviceNode,
      null,
      "absent",
      `ecs:DescribeServices returned ${service.name} with no task definition ARN. There is nothing ` +
        `for the scheduler to place.`,
    )
    return
  }

  const definition = valueOrNull(service.taskDefinition)
  if (!definition) {
    edge(
      graph,
      "ecs-service->task-definition",
      serviceNode,
      null,
      "unknown",
      `${service.name} points at ${service.taskDefinitionArn} and that revision was not read — ` +
        `${describeRead(service.taskDefinition, "ecs:DescribeTaskDefinition")}`,
      "ecs:DescribeTaskDefinition",
    )
    return
  }

  const definitionNode = node(
    graph,
    "task-definition",
    definition.arn,
    `${definition.family}:${definition.revision ?? "?"}`,
    // A revision is read through the service that points at it, so the honest
    // attribution is the service's rather than one this graph invents.
    wiringAttribution(service.attribution),
  )
  edge(
    graph,
    "ecs-service->task-definition",
    serviceNode,
    definitionNode,
    "present",
    `ecs:DescribeTaskDefinition returned ${definition.family}:${definition.revision ?? "?"} for ` +
      `${service.name}`,
  )

  walkDigests(graph, input, placement, definitionNode)
  walkDeclaredImages(graph, input, service, definition, definitionNode)
}

function walkDigests(
  graph: Graph,
  input: WiringInput,
  placement: ServicePlacement,
  definitionNode: WiringNode,
): void {
  const { service, cluster } = placement

  if (!conclusive(cluster.runningTasks)) {
    edge(
      graph,
      "task-definition->container-image",
      definitionNode,
      null,
      "unknown",
      `which image ${service.name} is actually running is unknown: ${cluster.name}'s running tasks ` +
        `were not read — ${describeRead(cluster.runningTasks, "ecs:DescribeTasks")}`,
      "ecs:DescribeTasks",
    )
    return
  }

  const tasks: readonly TaskReading[] = itemsOf(cluster.runningTasks).filter(
    (t) => serviceOfTaskGroup(t.group) === service.name,
  )

  if (tasks.length === 0) {
    edge(
      graph,
      "task-definition->container-image",
      definitionNode,
      null,
      "unknown",
      service.desiredCount === 0
        ? `${service.name} is scaled to zero, so no running task reports a digest. What it WOULD run ` +
          `is the task definition's image TAG, which is mutable — the digest behind it cannot be ` +
          `known until a task starts.`
        : `${service.name} wants ${service.desiredCount ?? "an unstated number of"} task` +
          `${service.desiredCount === 1 ? "" : "s"} and ecs:DescribeTasks returned none running in ` +
          `${cluster.name}, so no digest is reported. The image it would run is named by a mutable ` +
          `tag, and this engine will not resolve one to the other.`,
    )
    return
  }

  const seen = new Set<string>()
  for (const task of [...tasks].sort((a, b) => a.arn.localeCompare(b.arn))) {
    for (const container of [...task.containers].sort((a, b) => a.name.localeCompare(b.name))) {
      if (container.imageDigest === null) {
        const key = `no-digest|${container.name}`
        if (seen.has(key)) continue
        seen.add(key)
        edge(
          graph,
          "task-definition->container-image",
          definitionNode,
          null,
          "unknown",
          `ecs:DescribeTasks returned container ${container.name} of ${service.name} with no ` +
            `imageDigest. Which build is serving traffic cannot be answered from the tag alone.`,
        )
        continue
      }
      if (seen.has(container.imageDigest)) continue
      seen.add(container.imageDigest)

      const imageNode = node(
        graph,
        "container-image",
        container.imageDigest,
        `${container.name} ${container.imageDigest}`,
        notTaggable(
          "an image digest is a content address, not a taggable AWS resource; the repository it " +
            "lives in carries the tags",
        ),
      )
      edge(
        graph,
        "task-definition->container-image",
        definitionNode,
        imageNode,
        "present",
        `task ${task.arn} of ${service.name} is running container ${container.name} at ` +
          `${container.imageDigest}`,
      )
      walkRepository(graph, input, container.image, container.imageDigest, imageNode)
    }
  }
}

function walkRepository(
  graph: Graph,
  input: WiringInput,
  image: string | null,
  digest: string,
  imageNode: WiringNode,
): void {
  const { readings } = input
  const reference = image ? parseImageReference(image) : null

  if (!reference) {
    edge(
      graph,
      "container-image->ecr-repository",
      imageNode,
      null,
      "unknown",
      `ecs:DescribeTasks reported the digest ${digest} with no image reference to resolve it ` +
        `against, so which repository it came from is not known`,
    )
    return
  }

  if (!reference.ecr) {
    edge(
      graph,
      "container-image->ecr-repository",
      imageNode,
      null,
      "unknown",
      `${image} is served from ${reference.registry ?? "an unnamed registry"}, which is not an ECR ` +
        `registry. Whether ${digest} still exists there cannot be answered from AWS, and this engine ` +
        `will not claim it does.`,
    )
    return
  }

  const repositories = readings.ecr.repositories
  const repository = (valueOrNull(repositories) ?? []).find((r) => r.name === reference.repository)
  if (!repository) {
    edge(
      graph,
      "container-image->ecr-repository",
      imageNode,
      null,
      conclusive(repositories) ? "absent" : "unknown",
      conclusive(repositories)
        ? `${image} runs from the ECR repository ${reference.repository}, and ` +
          `ecr:DescribeRepositories listed every repository in this region without returning it. The ` +
          `image serving this tenant cannot be rebuilt, rolled back to, or rescanned.`
        : `${image} runs from the ECR repository ${reference.repository} and the repository listing ` +
          `did not answer — ${describeRead(repositories, "ecr:DescribeRepositories")}`,
      "ecr:DescribeRepositories",
    )
    return
  }

  const repositoryNode = node(
    graph,
    "ecr-repository",
    repository.arn ?? repository.name,
    repository.name,
    wiringAttribution(repository.attribution),
  )

  if (!conclusive(repository.images)) {
    edge(
      graph,
      "container-image->ecr-repository",
      imageNode,
      repositoryNode,
      "unknown",
      `${repository.name} exists, and whether it still holds ${digest} is unknown — ` +
        `${describeRead(repository.images, "ecr:DescribeImages")}`,
      "ecr:DescribeImages",
    )
    return
  }

  const held = itemsOf(repository.images).some((i) => i.digest === digest)
  if (!held) {
    edge(
      graph,
      "container-image->ecr-repository",
      imageNode,
      repositoryNode,
      "absent",
      `ecr:DescribeImages listed ${repository.name} and it does not hold ${digest}, which is the ` +
        `digest a task of this tenant is running right now. The image in production has been ` +
        `expired by a lifecycle policy or deleted: it cannot be rolled back to, cannot be rescanned, ` +
        `and cannot be redeployed to a new task.`,
    )
    return
  }

  edge(
    graph,
    "container-image->ecr-repository",
    imageNode,
    repositoryNode,
    "present",
    `ecr:DescribeImages returned ${digest} in ${repository.name}`,
  )
}

/* ----------------------- task definition -> the image it DECLARES -> ECR -- */

/**
 * The image the NEXT task will pull, and whether ECR still holds it.
 *
 * `walkDigests` above answers a different question — "what is running" — by
 * reading the digest off a RUNNING task, which is the only stable answer to which
 * build is serving traffic. It has one blind spot, and it is a wide one.
 *
 *   * A service scaled to zero has no running task, so that walk stops at
 *     `unknown` and the entire right-hand end of the chain — image, repository —
 *     disappears from the graph. The most likely reason a service is at zero is
 *     that somebody is about to scale it back up.
 *   * A service that IS running is reported connected by that walk even when the
 *     tag its revision names has been expired out of ECR by a lifecycle policy,
 *     because a container that is already up never pulls again. The graph is
 *     green, and the estate is one task placement from an outage.
 *
 * Both are the same fact and it is readable without anything running: the
 * revision names an image, and either ECR holds it or it does not. When it does
 * not, the next task placed fails with `CannotPullContainerError` — at a
 * scale-out under load, at an AZ replacement, at the next deploy, which is to say
 * at the moment nobody has spare attention.
 *
 * These hops are LATENT, not breaks: `PATH_EDGE_KINDS` does not contain them and
 * `reachOf` does not count them among `breaks`. A tenant serving every request
 * correctly is not down, and reporting it beside one that is down is how the row
 * that means an outage stops being read. See `LATENT_EDGE_KINDS`.
 */
function walkDeclaredImages(
  graph: Graph,
  input: WiringInput,
  service: ServiceReading,
  definition: TaskDefinitionReading,
  definitionNode: WiringNode,
): void {
  const revision = `${definition.family}:${definition.revision ?? "?"}`

  if (definition.containers.length === 0) {
    edge(
      graph,
      "task-definition->declared-image",
      definitionNode,
      null,
      "absent",
      `ecs:DescribeTaskDefinition returned ${revision} — the revision ${service.name} points at — ` +
        `with no container definition at all. A revision that declares no container declares no ` +
        `image, and the scheduler has nothing to place from it.`,
    )
    return
  }

  for (const container of [...definition.containers].sort((a, b) => a.name.localeCompare(b.name))) {
    if (container.image === null) {
      edge(
        graph,
        "task-definition->declared-image",
        definitionNode,
        null,
        "unknown",
        `container ${container.name} of ${revision} carries no image in the revision ` +
          `ecs:DescribeTaskDefinition returned, so what the next task placed for ${service.name} ` +
          `would pull is not known`,
      )
      continue
    }

    const reference = parseImageReference(container.image)
    if (!reference) {
      edge(
        graph,
        "task-definition->declared-image",
        definitionNode,
        null,
        "unknown",
        `container ${container.name} of ${revision} declares the image reference ` +
          `${container.image}, which this engine could not split into a registry, a repository and ` +
          `a tag. It will not guess at half of a reference and report the guess as a repository.`,
      )
      continue
    }

    const declaredNode = node(
      graph,
      "declared-image",
      container.image,
      `${container.name} declares ${container.image}`,
      notTaggable(
        "an image reference is a string inside a task-definition revision, not a taggable AWS " +
          "resource; the repository it names carries the tags",
      ),
    )
    edge(
      graph,
      "task-definition->declared-image",
      definitionNode,
      declaredNode,
      "present",
      `${revision} declares container ${container.name} at ${container.image}. This is what the ` +
        `NEXT task placed for ${service.name} pulls; the digest a task is running now is a separate ` +
        `fact, walked above.`,
    )
    walkDeclaredRepository(graph, input, service, reference, container.image, declaredNode)
  }
}

function walkDeclaredRepository(
  graph: Graph,
  input: WiringInput,
  service: ServiceReading,
  reference: ImageReference,
  image: string,
  declaredNode: WiringNode,
): void {
  const { readings } = input

  if (!reference.ecr) {
    edge(
      graph,
      "declared-image->ecr-repository",
      declaredNode,
      null,
      "unknown",
      `${image} is pulled from ${reference.registry ?? "an unnamed registry"}, which is not an ECR ` +
        `registry. Whether that registry still serves this reference is not an AWS read, and this ` +
        `engine will not claim either answer.`,
    )
    return
  }

  const repositories = readings.ecr.repositories
  const repository = (valueOrNull(repositories) ?? []).find((r) => r.name === reference.repository)
  if (!repository) {
    edge(
      graph,
      "declared-image->ecr-repository",
      declaredNode,
      null,
      conclusive(repositories) ? "absent" : "unknown",
      conclusive(repositories)
        ? `${service.name}'s revision declares ${image}, and ecr:DescribeRepositories listed every ` +
          `repository in this region without returning ${reference.repository}. Nothing is failing ` +
          `now — the task that is running already pulled. The next one placed cannot.`
        : `${service.name}'s revision declares ${image} and the repository listing did not answer — ` +
          `${describeRead(repositories, "ecr:DescribeRepositories")}`,
      "ecr:DescribeRepositories",
    )
    return
  }

  const repositoryNode = node(
    graph,
    "ecr-repository",
    repository.arn ?? repository.name,
    repository.name,
    wiringAttribution(repository.attribution),
  )

  // A reference carrying neither tag nor digest is `latest` — Docker's default,
  // which ECS applies. Named in the sentence rather than applied silently, so an
  // operator reading "and it does not hold the tag latest" can see what was
  // looked for and disagree with it.
  const defaulted = reference.digest === null && reference.tag === null
  const tag = reference.tag ?? "latest"
  const what =
    reference.digest !== null
      ? `the digest ${reference.digest}`
      : defaulted
        ? "the tag latest, which is what a reference carrying no tag at all resolves to"
        : `the tag ${tag}`

  if (!conclusive(repository.images)) {
    edge(
      graph,
      "declared-image->ecr-repository",
      declaredNode,
      repositoryNode,
      "unknown",
      `${repository.name} exists, and whether it still holds ${what} that ${image} names is ` +
        `unknown — ${describeRead(repository.images, "ecr:DescribeImages")}`,
      "ecr:DescribeImages",
    )
    return
  }

  const held =
    reference.digest !== null
      ? itemsOf(repository.images).some((i) => i.digest === reference.digest)
      : itemsOf(repository.images).some((i) => i.tags.includes(tag))

  if (!held) {
    edge(
      graph,
      "declared-image->ecr-repository",
      declaredNode,
      repositoryNode,
      "absent",
      `ecr:DescribeImages listed ${repository.name} and it does not hold ${what}, which ` +
        `${service.name}'s revision declares. Nothing is failing now: a task that is already ` +
        `running pulled this image when it started and will not pull it again. The next task placed ` +
        `— a scale-out under load, an AZ replacement, the next deploy — fails with ` +
        `CannotPullContainerError, and the service cannot be scaled back up from zero.`,
    )
    return
  }

  edge(
    graph,
    "declared-image->ecr-repository",
    declaredNode,
    repositoryNode,
    "present",
    `ecr:DescribeImages returned ${what} in ${repository.name}, so the next task placed for ` +
      `${service.name} has something to pull.` +
      (reference.digest === null && repository.tagMutability.kind === "mutable"
        ? ` ${repository.name} allows tags to move (${repository.tagMutability.why}), so this ` +
          `proves a build answers to that tag today — not that it is the same build the running ` +
          `task pulled.`
        : ""),
  )
}

/* -------------------------------------------------------- the data plane -- */

/**
 * The stateful resources this tenant's compute uses.
 *
 * Attributed by tag, and by nothing else, because there is no AWS read that says
 * "this ECS service talks to that RDS instance" — the connection string lives in
 * a secret whose VALUE this engine deliberately never reads. So the edge is
 * honest about what it is: an attribution, not an observed connection, and its
 * `why` says so rather than implying a dependency nobody proved.
 *
 * A resource carrying no `tenure:tenant` appears here as shared rather than being
 * dropped: an untagged database this tenant depends on is exactly the thing an
 * operator must see before deleting a tenant, and a graph that hid it would be
 * the reason it survived the deletion.
 */
function walkDataPlane(graph: Graph, input: WiringInput, tenantNode: WiringNode): void {
  const { readings, slug } = input

  attach(
    graph,
    tenantNode,
    "tenant->rds-instance",
    "rds-instance",
    readings.databases.instances,
    "rds:DescribeDBInstances",
    (i) => ({ id: i.arn ?? i.instanceId, label: i.instanceId, attribution: i.attribution }),
    slug,
  )
  attach(
    graph,
    tenantNode,
    "tenant->dynamodb-table",
    "dynamodb-table",
    readings.tables.tables,
    "dynamodb:ListTables",
    (t) => ({ id: t.arn ?? t.name, label: t.name, attribution: t.attribution }),
    slug,
  )
  attach(
    graph,
    tenantNode,
    "tenant->s3-bucket",
    "s3-bucket",
    readings.buckets.buckets,
    "s3:ListBuckets",
    (b) => ({ id: b.arn ?? b.name, label: b.name, attribution: b.attribution }),
    slug,
  )
  attach(
    graph,
    tenantNode,
    "tenant->sqs-queue",
    "sqs-queue",
    readings.queues.queues,
    "sqs:ListQueues",
    (q) => ({ id: q.arn ?? q.url, label: q.name, attribution: q.attribution }),
    slug,
  )
  attach(
    graph,
    tenantNode,
    "tenant->secret",
    "secret",
    readings.secrets.secrets,
    "secretsmanager:ListSecrets",
    (s) => ({ id: s.arn ?? s.name, label: s.name, attribution: s.attribution }),
    slug,
  )
}

function attach<T>(
  graph: Graph,
  tenantNode: WiringNode,
  edgeKind: WiringEdgeKind,
  nodeKind: WiringNodeKind,
  read: AwsRead<readonly T[]>,
  needs: Capability,
  project: (item: T) => { id: string; label: string; attribution: ReaderAttribution },
  slug: string,
): void {
  const what = nodeKind.replace(/-/g, " ")

  if (!conclusive(read)) {
    edge(
      graph,
      edgeKind,
      tenantNode,
      null,
      "unknown",
      `which ${what} resources belong to ${slug} is unknown — ${describeRead(read, needs)}`,
      needs,
    )
    return
  }

  const projected = itemsOf(read)
    .map(project)
    .map((p) => ({ ...p, attribution: wiringAttribution(p.attribution) }))
    .filter((p) => {
      const role = roleFor(p.attribution, slug)
      // This tenant's, or shared with it. A resource tagged for ANOTHER tenant is
      // not this tenant's data plane; if one turns up on the PATH it is reported
      // there, as a crossed wire.
      return role.kind === "tenant" || role.kind === "shared"
    })
    .sort((a, b) => a.id.localeCompare(b.id))

  if (projected.length === 0) {
    edge(
      graph,
      edgeKind,
      tenantNode,
      null,
      "absent",
      `${needs} answered and returned no ${what} tagged for ${slug}, and none shared. This tenant ` +
        `has no ${what} in this region.`,
    )
    return
  }

  for (const item of projected) {
    const resourceNode = node(graph, nodeKind, item.id, item.label, item.attribution)
    edge(
      graph,
      edgeKind,
      tenantNode,
      resourceNode,
      "present",
      resourceNode.role.kind === "tenant"
        ? `${needs} returned ${item.label} carrying tenure:tenant = ${slug}. This is an ATTRIBUTION, ` +
          `not an observed connection — no AWS read proves the tenant's tasks talk to it.`
        : `${needs} returned ${item.label}, which is ${describeRole(resourceNode.role)}. It is on ` +
          `this tenant's page because it serves the tenant without belonging to it, and a shared ` +
          `resource a tenant depends on is the one nobody accounts for when the tenant is deleted.`,
    )
  }
}

/* -------------------------------------------------------------- rendering -- */

/**
 * The sentence a surface prints for one edge.
 *
 * One renderer, for the reason `describeRead` is one renderer: an `absent` edge
 * must not read as an `unknown` on one page and correctly on another. The three
 * states produce provably different text — `EDGE_WORD` is a table, asserted
 * distinct in the test — and an `unknown` edge names the capability that would
 * answer it, which an `absent` edge never does because no grant fixes it.
 */
export function describeEdge(edge: WiringEdge): string {
  const target = edge.to ? edge.to.label : "nothing"
  return (
    `${edge.from.label} -> ${target}: ${EDGE_WORD[edge.state]} — ${edge.why}` +
    (edge.state === "unknown" && edge.needs ? ` Grant ${edge.needs} to answer it.` : "")
  )
}

/**
 * The latent clause, appended to every arm.
 *
 * One function rather than four copies, because the sentence that must never be
 * dropped is the one a surface would drop: `intact` is the arm where an author
 * feels finished, and it is the arm where "and the next task placed cannot pull
 * its image" matters most.
 */
function latentClause(latent: number): string {
  if (latent === 0) return ""
  return (
    `. ${latent} hop${latent === 1 ? "" : "s"} will break at the NEXT task placement — a scale-out, ` +
    `an AZ replacement or the next deploy — while nothing is failing now`
  )
}

export function describeReach(reach: ReachState): string {
  switch (reach.kind) {
    case "no-hosts":
      return `no chain to walk — ${reach.why}${latentClause(reach.latent)}`
    case "broken":
      return (
        `BROKEN — ${reach.why}` +
        (reach.unreadable > 0
          ? `, and ${reach.unreadable} further hop${reach.unreadable === 1 ? " was" : "s were"} not readable`
          : "") +
        latentClause(reach.latent)
      )
    case "unverified":
      return `unverified — ${reach.why}${latentClause(reach.latent)}`
    case "intact":
      return (
        // "every hop ON THE REQUEST PATH", not "every hop this graph walked": a
        // latent hop is one this graph walked and is NOT connected, and the older
        // wording would have made this arm a false statement the moment the
        // declared-image walk was added.
        `intact — every one of the ${reach.edges} hops this graph walked on the request path is ` +
        `connected${latentClause(reach.latent)}`
      )
  }
}

export interface WiringLine {
  hop: WiringEdgeKind
  state: EdgeState
  /** The rendered sentence. A surface prints exactly this. */
  text: string
  edge: WiringEdge
}

/**
 * What a wiring surface prints, in the order it prints it.
 *
 * Breaks first, then the hops nobody could read, then the intact chain. An
 * operator opening this page is looking for the break; a list in traversal order
 * buries it under forty rows of "connected".
 */
export function wiringLines(wiring: TenantWiring): readonly WiringLine[] {
  const rank: Record<EdgeState, number> = { absent: 0, unknown: 1, present: 2 }
  return [...wiring.edges]
    .map((e) => ({ hop: e.kind, state: e.state, text: describeEdge(e), edge: e }))
    .sort(
      (a, b) =>
        rank[a.state] - rank[b.state] || a.hop.localeCompare(b.hop) || a.text.localeCompare(b.text),
    )
}

/* ---------------------------------------------------------- the loading -- */

/**
 * Every reader this graph needs, in one call.
 *
 * The same entry point a surface uses and a test drives, for the reason
 * `estateInventory` is: a test that drove a helper the page does not call would
 * stay green the day the page stopped calling it.
 *
 * The eleven reads are issued in parallel and each resolves its own identity and
 * its own tag index — that is the readers' contract, not a choice made here, and
 * it costs eleven `tag:GetResources` per load. `identity.ts` caches the STS
 * answer; the tag index does not, and consolidating it would be a change to
 * eleven other modules rather than to this one.
 */
export async function wiringReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<WiringReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const [
    dns,
    cdn,
    loadBalancers,
    containers,
    ecr,
    certificates,
    databases,
    tables,
    buckets,
    queues,
    secrets,
  ] = await Promise.all([
    dnsReadings(gw, { now }),
    cdnReadings(gw, { now }),
    loadBalancerReadings(gw, { now }),
    containerReadings(gw, { now }),
    ecrReadings(gw, { now }),
    certificateReadings(gw, { now }),
    databaseReadings(gw, { now }),
    tableReadings(gw, { now }),
    bucketPosture(gw, { now }),
    queueReadings(gw, { now }),
    secretReadings(gw, { now }),
  ])

  return {
    dns,
    cdn,
    loadBalancers,
    containers,
    ecr,
    certificates,
    databases,
    tables,
    buckets,
    queues,
    secrets,
    asOf: now().toISOString(),
  }
}
