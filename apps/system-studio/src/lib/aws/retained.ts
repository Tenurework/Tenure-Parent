import type { ResourceClass } from "@tenure/provisioning"

import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  describeRead,
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import { attributionOf, tagIndex, taggedResources, type TaggedResource } from "./tags"
import type { RetainedAwsObservation } from "../tenant-state"

interface DescribeDBSnapshotsResponse {
  DBSnapshots?: Array<{
    DBSnapshotArn?: string
    DBSnapshotIdentifier?: string
    DBInstanceIdentifier?: string
    Status?: string
    AllocatedStorage?: number
    SnapshotCreateTime?: Date | string
    TagList?: Array<{ Key?: string; Value?: string }>
  }>
  Marker?: string
}

interface DescribeLogGroupsResponse {
  logGroups?: Array<{
    arn?: string
    logGroupName?: string
    storedBytes?: number
    retentionInDays?: number
  }>
  nextToken?: string
}

interface ListBackupVaultsResponse {
  BackupVaultList?: Array<{ BackupVaultName?: string }>
  NextToken?: string
}

interface ListRecoveryPointsResponse {
  RecoveryPoints?: Array<{
    RecoveryPointArn?: string
    ResourceArn?: string
    Status?: string
    BackupSizeInBytes?: number
    CreationDate?: Date | string
  }>
  NextToken?: string
}

type RetainedKind = "tag-index" | "rds-snapshot" | "log-group" | "backup-recovery-point"

export interface RetainedResource {
  kind: RetainedKind
  className: ResourceClass
  id: string
  detail: string
  bytes: number | null
}

export interface RetainedReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  taggedRetained: readonly RetainedResource[]
  snapshots: AwsRead<readonly RetainedResource[]>
  logGroups: AwsRead<readonly RetainedResource[]>
  /**
   * The vault list, read and reported in its own right.
   *
   * `backup:ListBackupVaults` and `backup:ListRecoveryPointsByBackupVault` are
   * two capabilities with two IAM actions, and a role is routinely granted one
   * without the other. Folding the vault listing into the recovery-point read
   * made a denied `ListBackupVaults` render as "refused
   * backup:ListRecoveryPointsByBackupVault", so the minimum statement an
   * operator pasted into a policy did not contain the action that was actually
   * missing — they would grant it, redeploy, and be refused identically.
   */
  vaults: AwsRead<readonly string[]>
  recoveryPoints: AwsRead<readonly RetainedResource[]>
}

interface ReadContext {
  slug: string
  now: () => Date
  denial: DenialContext
  tags: Map<string, Readonly<Record<string, string>>>
}

function tagsFrom(list: Array<{ Key?: string; Value?: string }> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const tag of list ?? []) {
    if (tag.Key) out[tag.Key] = tag.Value ?? ""
  }
  return out
}

function ownedByTenant(tags: Readonly<Record<string, string>>, slug: string): boolean {
  const attribution = attributionOf(tags)
  return attribution.kind === "tenant" && attribution.tenantSlug === slug
}

function classForTaggedArn(arn: string): ResourceClass | null {
  const [, , service, , , ...rest] = arn.split(":")
  const resource = rest.join(":")
  if (service === "ecs") return "compute"
  if (service === "rds" && resource.startsWith("snapshot")) return "snapshot"
  if (service === "rds") return "database"
  if (service === "s3") return "object-storage"
  if (service === "logs") return "audit-evidence"
  if (service === "backup") return "snapshot"
  if (service === "cloudfront" || service === "acm" || service === "route53") return "edge"
  if (service === "elasticloadbalancing") return "edge"
  return null
}

function sourceLine(resource: RetainedResource): string {
  const bytes = resource.bytes === null ? "" : `, ${resource.bytes} byte(s)`
  return `${resource.className}: ${resource.kind} ${resource.id}${bytes} (${resource.detail})`
}

async function readTaggedRetained(ctx: ReadContext): Promise<readonly RetainedResource[]> {
  const out: RetainedResource[] = []
  for (const [arn, tags] of ctx.tags) {
    if (!ownedByTenant(tags, ctx.slug)) continue
    const className = classForTaggedArn(arn)
    if (!className) continue
    out.push({
      kind: "tag-index",
      className,
      id: arn,
      detail: "tenant-attributed by Resource Groups Tagging API",
      bytes: null,
    })
  }
  return out
}

async function readSnapshots(
  gw: AwsGateway,
  ctx: ReadContext,
): Promise<AwsRead<readonly RetainedResource[]>> {
  return readAws<readonly RetainedResource[]>(
    "rds:DescribeDBSnapshots",
    async () => {
      const out: RetainedResource[] = []
      let marker: string | undefined
      do {
        const response = (await gw.call("rds:DescribeDBSnapshots", {
          Marker: marker,
        })) as DescribeDBSnapshotsResponse
        for (const snapshot of response?.DBSnapshots ?? []) {
          if (!snapshot.DBSnapshotArn) continue
          const tags = { ...tagsFrom(snapshot.TagList), ...(ctx.tags.get(snapshot.DBSnapshotArn) ?? {}) }
          if (!ownedByTenant(tags, ctx.slug)) continue
          out.push({
            kind: "rds-snapshot",
            className: "snapshot",
            id: snapshot.DBSnapshotIdentifier ?? snapshot.DBSnapshotArn,
            detail: snapshot.Status ?? "unknown status",
            bytes:
              typeof snapshot.AllocatedStorage === "number"
                ? snapshot.AllocatedStorage * 1024 * 1024 * 1024
                : null,
          })
        }
        marker = response?.Marker || undefined
      } while (marker)
      return out
    },
    { now: ctx.now, denial: ctx.denial },
  )
}

async function readLogGroups(
  gw: AwsGateway,
  ctx: ReadContext,
): Promise<AwsRead<readonly RetainedResource[]>> {
  return readAws<readonly RetainedResource[]>(
    "logs:DescribeLogGroups",
    async () => {
      const out: RetainedResource[] = []
      let nextToken: string | undefined
      do {
        const response = (await gw.call("logs:DescribeLogGroups", {
          nextToken,
        })) as DescribeLogGroupsResponse
        for (const group of response?.logGroups ?? []) {
          const arn = group.arn
          if (!arn) continue
          const tags = ctx.tags.get(arn) ?? {}
          if (!ownedByTenant(tags, ctx.slug)) continue
          out.push({
            kind: "log-group",
            className: "audit-evidence",
            id: group.logGroupName ?? arn,
            detail:
              typeof group.retentionInDays === "number"
                ? `${group.retentionInDays} day retention`
                : "retention unset",
            bytes: typeof group.storedBytes === "number" ? group.storedBytes : null,
          })
        }
        nextToken = response?.nextToken || undefined
      } while (nextToken)
      return out
    },
    { now: ctx.now, denial: ctx.denial },
  )
}

async function readBackupVaults(
  gw: AwsGateway,
  ctx: ReadContext,
): Promise<AwsRead<readonly string[]>> {
  return readAws<readonly string[]>(
    "backup:ListBackupVaults",
    async () => {
      const out: string[] = []
      let vaultToken: string | undefined
      do {
        const vaults = (await gw.call("backup:ListBackupVaults", {
          NextToken: vaultToken,
        })) as ListBackupVaultsResponse
        for (const vault of vaults?.BackupVaultList ?? []) {
          if (vault.BackupVaultName) out.push(vault.BackupVaultName)
        }
        vaultToken = vaults?.NextToken || undefined
      } while (vaultToken)
      return out
    },
    { now: ctx.now, denial: ctx.denial },
  )
}

async function readRecoveryPoints(
  gw: AwsGateway,
  ctx: ReadContext,
  vaults: AwsRead<readonly string[]>,
): Promise<AwsRead<readonly RetainedResource[]>> {
  // No vault names, and not because there are none: the call below is never
  // made, and saying so is the only honest answer. UNCONFIGURED is `isUnknown`,
  // so this reaches the surface as an unknown rather than as "no recovery
  // points" — which is what an EMPTY here would have claimed.
  if (vaults.state !== "ACTUAL" && vaults.state !== "STALE" && vaults.state !== "EMPTY") {
    return {
      state: "UNCONFIGURED",
      capability: "backup:ListRecoveryPointsByBackupVault",
      // The subject is spelled inside `why` because `describeRead` renders
      // UNCONFIGURED as "not configured — <why>" and drops its label, so a
      // reason that did not name itself would reach the page unattributed.
      why:
        `retained AWS Backup recovery points were not read — the vault list they are ` +
        `enumerated from could not be read. ` +
        describeRead(vaults, "AWS Backup vaults"),
    }
  }

  const vaultNames = vaults.state === "EMPTY" ? [] : vaults.value

  return readAws<readonly RetainedResource[]>(
    "backup:ListRecoveryPointsByBackupVault",
    async () => {
      const out: RetainedResource[] = []
      for (const vaultName of vaultNames) {
        let pointToken: string | undefined
        do {
          const response = (await gw.call("backup:ListRecoveryPointsByBackupVault", {
            BackupVaultName: vaultName,
            NextToken: pointToken,
          })) as ListRecoveryPointsResponse
          for (const point of response?.RecoveryPoints ?? []) {
            if (!point.RecoveryPointArn) continue
            const resourceTags = point.ResourceArn ? (ctx.tags.get(point.ResourceArn) ?? {}) : {}
            const pointTags = ctx.tags.get(point.RecoveryPointArn) ?? {}
            if (!ownedByTenant({ ...resourceTags, ...pointTags }, ctx.slug)) continue
            out.push({
              kind: "backup-recovery-point",
              className: "snapshot",
              id: point.RecoveryPointArn,
              detail: `${vaultName}: ${point.Status ?? "unknown status"}`,
              bytes: typeof point.BackupSizeInBytes === "number" ? point.BackupSizeInBytes : null,
            })
          }
          pointToken = response?.NextToken || undefined
        } while (pointToken)
      }
      return out
    },
    { now: ctx.now, denial: ctx.denial },
  )
}

export async function retainedReadingsForTenant(
  slug: string,
  supplied?: AwsGateway,
  options: {
    now?: () => Date
    identity?: AwsRead<Identity>
    tagged?: AwsRead<readonly TaggedResource[]>
  } = {},
): Promise<RetainedReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())
  const identity = options.identity ?? (await resolveIdentity(supplied, { now }))
  const denial = denialContextFrom(identity)
  const tagged = options.tagged ?? (await taggedResources(supplied, { now, denial }))
  const ctx: ReadContext = {
    slug,
    now,
    denial,
    tags: tagIndex(tagged.state === "ACTUAL" ? tagged.value : []),
  }

  const [taggedRetained, snapshots, logGroups, vaults] = await Promise.all([
    readTaggedRetained(ctx),
    readSnapshots(gw, ctx),
    readLogGroups(gw, ctx),
    readBackupVaults(gw, ctx),
  ])
  // Sequential after the vault list, because the recovery-point read is keyed
  // by vault name and there is nothing to ask for until that answer exists.
  const recoveryPoints = await readRecoveryPoints(gw, ctx, vaults)

  return {
    identity,
    tagged,
    taggedRetained,
    snapshots,
    logGroups,
    vaults,
    recoveryPoints,
  }
}

function retainedItems(read: AwsRead<readonly RetainedResource[]>): readonly RetainedResource[] {
  if (read.state === "ACTUAL" || read.state === "STALE") return read.value
  return []
}

function unknownLine(read: AwsRead<unknown>, label: string): string | null {
  if (read.state === "ACTUAL" || read.state === "STALE" || read.state === "EMPTY") return null
  return describeRead(read, label)
}

export function retainedObservation(readings: RetainedReadings): RetainedAwsObservation {
  const reads = [readings.snapshots, readings.logGroups, readings.recoveryPoints]
  const resources = [...readings.taggedRetained, ...reads.flatMap((read) => retainedItems(read))]
  return {
    classes: [...new Set<ResourceClass>(resources.map((resource) => resource.className))],
    sources: resources.map(sourceLine),
    unknown: [
      readings.tagged.state === "ACTUAL" || readings.tagged.state === "EMPTY"
        ? null
        : describeRead(readings.tagged, "tenant tag index"),
      unknownLine(readings.snapshots, "retained RDS snapshots"),
      unknownLine(readings.logGroups, "retained CloudWatch log groups"),
      // Named separately from the recovery points, because they are separate
      // IAM actions: a denial here must quote ListBackupVaults, not the action
      // that was never reached.
      unknownLine(readings.vaults, "AWS Backup vaults"),
      unknownLine(readings.recoveryPoints, "retained AWS Backup recovery points"),
    ].filter((line): line is string => line !== null),
  }
}
