import { MODULES, PROCESS_CHAINS } from "@tenure/modules"
import type { Sensitivity } from "@tenure/configuration"
import { externalDomains } from "@tenure/provisioning"
import type { CellRecord, ChangeOperation, TenantManifest, TenantState } from "@tenure/provisioning"

import { parseArn } from "../../../lib/aws/inventory"
import type { AwsRead } from "../../../lib/aws/read"
import type { TaggedResource } from "../../../lib/aws/tags"
import {
  blastRadius,
  type BlastInput,
  type BlastRadius,
} from "../../../lib/change/blast-radius"
import { tenantUsers, type PoolUserReading } from "../../../lib/change/tenant-users"
import type { CalendarSource } from "../../../lib/change/calendar"
import {
  notificationReadiness,
  scheduleVerdict,
  type NotificationReadiness,
  type ScheduleVerdict,
} from "../../../lib/change/windows"
import {
  PortabilityRefused,
  exportBundle,
  importBundle,
  type ImportProblem,
  type Leak,
  type PortableBundle,
} from "../../../lib/portability/bundle"
import { cloneTenant, type CloneOutcome } from "../../../lib/portability/clone"
import type { Reading } from "./summary"
import type { PermittedMove } from "./next-moves"

/**
 * STUDIO-060-004 / STUDIO-060-008 / STUDIO-040-008 / STUDIO-040-009 — the
 * tenant page's own assembly of the four, from facts it has already read.
 *
 * Route-local for the same reason `footprint.ts` and `summary.ts` are: the
 * calculations belong to the library (`lib/change`, `lib/portability`) and the
 * decision about which of THIS page's readings feed them belongs to the page.
 * Keeping the join here means the join is a function a test can call rather
 * than thirty lines inside a server component nothing can run without a build.
 *
 * No `server-only` and no `@/` alias, so a plain logic spec can drive it.
 */

/** Everything the page has already read, in the shape the calculations want. */
export interface GovernanceInput {
  slug: string
  manifest: TenantManifest
  state: TenantState
  /** The moves the lifecycle currently permits, from `permittedMoves`. */
  moves: readonly PermittedMove[]
  /** The cell registry, as the page read it. */
  cells: Reading<readonly CellRecord[]>
  /** The cell this tenant is placed on, or null when it has no placement. */
  placedCellId: string | null
  /** The tagging read, exactly as `lib/aws/tags` produced it. `null` when the estate was never read. */
  tagged: AwsRead<readonly TaggedResource[]> | null
  /** The ARNs the page attributed to this tenant, or null when it attributed none. */
  attributed: readonly string[] | null
  /**
   * STUDIO-060-004. What `cognito-idp:DescribeUserPool` answered for each user
   * pool among those ARNs, or `null` when the page made no such read.
   *
   * `null` and `[]` are different and the calculation treats them so: an empty
   * array means the attribution named no user pool, and `null` means nothing
   * was asked.
   */
  userPools: readonly { poolId: string; detail: AwsRead<{ estimatedUsers: number | null }> }[] | null
  /** The seat ceiling this tenant's plan sets: a number, `null` for unlimited, `undefined` when no plan is known. */
  seatLimit: number | null | undefined
  /** The environment this tenant runs in. */
  environment: string
  calendar: CalendarSource
  /** The configuration registry's definitions, for export sensitivity. */
  definitions: readonly { key: string; sensitivity: Sensitivity }[]
  engineVersion: string
  /** Every other tenant slug this installation knows. */
  otherTenants: readonly string[]
  /** The clock, passed in so the page and a test agree. */
  now: Date
}

export interface MoveGovernance {
  to: TenantState
  blast: BlastRadius
  schedule: ScheduleVerdict
  /**
   * Whether the maintenance notice this move owes has been given.
   *
   * Always "none recorded" today, and that is the honest answer rather than a
   * missing panel: nothing in this repository persists a change record with
   * notifications on it, so no move can be called notified. The reading exists
   * so an operator sees the notice a purge owes BEFORE pressing anything, and
   * so a persisted change record has a reader waiting for it.
   */
  notice: NotificationReadiness
}

export interface TenantGovernance {
  moves: readonly MoveGovernance[]
  /** The portable bundle, or the leaks that stopped it being produced. */
  bundle: PortableBundle | null
  bundleRefusal: readonly Leak[] | null
  /**
   * Whether the bundle this page shows can be READ BACK by this engine.
   *
   * Portability is a round trip, not an export. A bundle that leaves and cannot
   * be imported is a file, and the only way to know which one this is, is to
   * put it through the importer. `null` means it read back cleanly.
   */
  readBack: readonly ImportProblem[] | null
  /** What a clone of this tenant would and would not copy. */
  clone: CloneOutcome | null
}

/**
 * The AWS reading, as the console's `Reading` union.
 *
 * A bridge and not a second union: `AwsRead` is the shape at the AWS boundary
 * and `Reading` is the shape a panel renders, and every unreadable arm of the
 * first has to arrive at the second carrying both a reason and a remedy —
 * `summary.ts` states why both fields are required. `EMPTY` becomes a KNOWN
 * empty list, which is the whole point of `EMPTY` existing separately from a
 * refusal.
 */
export function readingOf<T>(read: AwsRead<T>, empty: T): Reading<T> {
  switch (read.state) {
    case "ACTUAL":
    case "STALE":
      return { known: true, value: read.value }
    case "EMPTY":
      return { known: true, value: empty }
    case "DENIED":
      return {
        known: false,
        because: `${read.action} was denied for ${read.principal} (${read.errorCode})`,
        fix: `Grant this engine's task role ${read.action}.`,
      }
    case "THROTTLED":
      return {
        known: false,
        because: "the call was rate-limited after backoff",
        fix: `Look again in about ${Math.ceil(read.retryAfterMs / 1000)}s; nothing needs changing.`,
      }
    case "UNCONFIGURED":
      return { known: false, because: read.why, fix: "Set what the reading above names, then reload." }
    case "ERROR":
      return {
        known: false,
        because: `${read.code}: ${read.safeDetail}`,
        fix: "This is not a permission problem; the error above is the only lead.",
      }
  }
}

/** The region an ARN names, or a statement that it names none. */
export function regionOf(arn: string): string {
  const parsed = parseArn(arn)
  const region = parsed?.region ?? ""
  // S3 and IAM both leave the field empty and only one of them means "not
  // regional", so neither is called global here. `footprint.ts` makes the same
  // refusal for the same reason.
  return region === "" ? "(the ARN names no region)" : region
}

function cellReading(input: GovernanceInput): BlastInput["cell"] {
  if (!input.cells.known) return input.cells
  if (input.placedCellId === null) return { known: true, value: null }
  const cell = input.cells.value.find((c) => c.cellId === input.placedCellId)
  if (!cell) {
    return {
      known: false,
      because: `the registry places this tenant on ${input.placedCellId} and the cell registry has no such cell`,
      fix: "Reconcile the tenant's placement with the cell registry; one of the two is describing a cell that is not there.",
    }
  }
  return {
    known: true,
    value: {
      cellId: cell.cellId,
      region: cell.region,
      release: cell.release,
      capacity: { tenants: cell.capacity.tenants },
    },
  }
}

function resourceReading(input: GovernanceInput): BlastInput["resources"] {
  if (input.tagged === null) {
    return {
      known: false,
      because: "the estate was not read on this request",
      fix: "Set the tagging reader's environment (AWS_ACCOUNT_ID, AWS_REGION) so the resource survey runs.",
    }
  }
  const read = readingOf<readonly TaggedResource[]>(input.tagged, [])
  if (!read.known) return read
  const arns = input.attributed ?? read.value.map((resource) => resource.arn)
  return {
    known: true,
    value: arns.map((arn) => ({ handle: arn, region: regionOf(arn) })),
  }
}

/**
 * The `users` axis, from the pools the page read.
 *
 * The bridge from `AwsRead<PoolDetail>` to a `Reading<number | null>` is here
 * rather than in `lib/change/tenant-users` for the same reason `readingOf` is
 * here: `AwsRead` is the shape at the AWS boundary and the calculation should
 * not know about it. `readingOf` is reused rather than a second switch being
 * written over the same seven states.
 */
function userReading(input: GovernanceInput): BlastInput["users"] {
  const pools: PoolUserReading[] = (input.userPools ?? []).map(({ poolId, detail }) => {
    const read = readingOf<{ estimatedUsers: number | null } | null>(detail, null)
    return {
      poolId,
      users: read.known
        ? { known: true as const, value: read.value?.estimatedUsers ?? null }
        : read,
    }
  })
  return tenantUsers(input.attributed, pools)
}

function seatReading(input: GovernanceInput): BlastInput["seats"] {
  if (input.seatLimit === undefined) {
    return {
      known: false,
      because: "this tenant has no registry record, so no commercial plan says what it is entitled to",
      fix: "Register the tenant, or bind it to a plan; a tenant with no plan has no seat ceiling to report.",
    }
  }
  return { known: true, value: input.seatLimit }
}

export function tenantGovernance(input: GovernanceInput): TenantGovernance {
  const cell = cellReading(input)
  const resources = resourceReading(input)
  const seats = seatReading(input)
  const users = userReading(input)

  const moves = input.moves.map((move): MoveGovernance => {
    const operation: ChangeOperation = {
      surface: "tenant-lifecycle",
      action: move.to,
      target: input.slug,
    }
    return {
      to: move.to,
      blast: blastRadius({
        slug: input.slug,
        currentState: input.state,
        operation,
        changeClass: move.changeClass,
        // A lifecycle move changes no module; what it reaches through the
        // module graph is the tenant's whole enabled set, because stopping a
        // tenant stops all of them.
        changedModules: input.manifest.modules,
        modules: MODULES,
        chains: PROCESS_CHAINS,
        cell,
        users,
        seats,
        resources,
        externalDomains: externalDomains(input.manifest.systemOfRecord),
        region: input.manifest.region,
      }),
      notice: notificationReadiness(
        {
          changeId: `${input.slug}:${move.to}`,
          resource: `tenant:${input.slug}`,
          changeClass: move.changeClass,
          environment: input.environment,
          scheduledFor: input.now.toISOString(),
          status: "SCHEDULED",
          emergency: null,
        },
        input.now,
      ),
      schedule: scheduleVerdict(
        {
          changeId: `${input.slug}:${move.to}`,
          changeClass: move.changeClass,
          environment: input.environment,
          scheduledFor: input.now.toISOString(),
          emergency: null,
        },
        input.calendar.calendar,
        input.now,
      ),
    }
  })

  let bundle: PortableBundle | null = null
  let bundleRefusal: readonly Leak[] | null = null
  try {
    bundle = exportBundle({
      manifest: input.manifest,
      definitions: input.definitions,
      engineVersion: input.engineVersion,
      otherTenants: input.otherTenants,
    })
  } catch (error) {
    if (!(error instanceof PortabilityRefused)) throw error
    bundleRefusal = error.leaks
  }

  // The round trip. Serialised and re-parsed rather than handed over as an
  // object, because what leaves this console is JSON and an object that happens
  // to satisfy the type is not evidence that its serialisation does.
  let readBack: readonly ImportProblem[] | null = null
  if (bundle !== null) {
    const parsed = importBundle(JSON.parse(JSON.stringify(bundle)), input.otherTenants)
    readBack = parsed.ok ? null : parsed.problems
  }

  // The clone is shown as a PREVIEW against a placeholder slug: the operator is
  // being told what a clone would carry, not making one. Creating a tenant
  // still goes through `composeTenant`, which is the only writer.
  const clone =
    bundle === null
      ? null
      : cloneTenant(
          bundle,
          {
            slug: CLONE_PREVIEW_SLUG,
            displayName: `${input.manifest.displayName} (clone)`,
            legalName: input.manifest.legalName,
            initialAdminEmail: CLONE_PREVIEW_ADMIN,
          },
          { existingSlugs: [input.slug, ...input.otherTenants] },
        )

  return { moves, bundle, bundleRefusal, readBack, clone }
}

/**
 * The slug and administrator the PREVIEW uses.
 *
 * Named constants rather than inline literals so the surface can say plainly
 * that neither is a decision anybody made: a clone that is actually created
 * takes both from the operator, and a preview that quietly reused the source's
 * administrator would be showing personal data it had just claimed not to copy.
 */
export const CLONE_PREVIEW_SLUG = "clone-preview"
export const CLONE_PREVIEW_ADMIN = "not-yet-chosen@invalid"
