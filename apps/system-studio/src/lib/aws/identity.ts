/**
 * STUDIO-000-006 / STUDIO-GATE-010 — which account is this, really.
 *
 * Before this the Studio could not answer the question. `/platform` printed
 * `account 1549…97 · us-east-1` out of a JSON file compiled at a commit, and
 * `lib/cells.ts` filled its cell record from `env("AWS_REGION", "us-east-1")`,
 * `env("AWS_ACCOUNT_ID", "<a literal>")` and `env("AWS_PARTITION", "aws")`. A
 * developer who swapped the deploy credentials saw the old account, and a
 * deployment into a region whose variable was unset placed tenants as though it
 * were in us-east-1 — the GE-010-007 residency defect, in the one file the
 * guard against it exempted.
 *
 * Everything here is derived from the answer AWS gives:
 *
 *   accountId  the response's `Account`
 *   arn        the response's `Arn`
 *   partition  the ARN's SECOND segment — `arn:aws-us-gov:…` is `aws-us-gov`
 *   region     the SDK's resolved region, read off the client's own config
 *
 * There is no fallback. A read that fails returns the DENIED / THROTTLED /
 * ERROR arm and the header renders "unknown", because "us-east-1" printed
 * confidently under a role that could not answer is the single most dangerous
 * string this console could show.
 */

import { IDENTITY_REFRESH_MS } from "./capabilities"
import {
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"

export interface Identity {
  accountId: string
  arn: string
  /** `aws`, `aws-us-gov`, `aws-cn` — whatever the ARN says, never assumed. */
  partition: string
  region: string
}

/** The shape of the STS answer this module reads. Declared, not imported: see client.ts. */
interface CallerIdentityResponse {
  Account?: string
  Arn?: string
  UserId?: string
}

/**
 * The partition an ARN belongs to.
 *
 * `arn:PARTITION:service:region:account:resource`. Returns null rather than
 * guessing "aws" for anything that is not an ARN — a guessed partition is how a
 * GovCloud console link ends up pointing at the commercial console.
 */
export function partitionOf(arn: string): string | null {
  const parts = arn.split(":")
  if (parts.length < 6 || parts[0] !== "arn") return null
  return parts[1] || null
}

/**
 * Cached for the process, because identity does not change under a task.
 *
 * Cleared on any denial so a role rotated underneath a running container is
 * picked up on the next read rather than at the next deploy — the case that
 * makes an operator distrust the header.
 */
let cached: { at: number; read: AwsRead<Identity> } | null = null

export function __resetIdentity(): void {
  cached = null
}

export async function resolveIdentity(
  /** Omitted in production — the pages call this with no argument. */
  supplied?: AwsGateway,
  options: { now?: () => Date; useCache?: boolean } = {},
): Promise<AwsRead<Identity>> {
  const now = options.now ?? (() => new Date())
  const gw = supplied ?? liveGateway()
  // A caller that supplied its own gateway is exercising a specific answer;
  // serving it a value another gateway produced would be a test asserting on
  // the wrong thing. So the process cache is used only on the production path.
  const useCache = options.useCache ?? supplied === undefined

  if (useCache && cached && now().getTime() - cached.at < IDENTITY_REFRESH_MS) {
    return cached.read
  }

  const read = await readAws<Identity>(
    "sts:GetCallerIdentity",
    async () => {
      const [response, region] = await Promise.all([
        gw.call("sts:GetCallerIdentity") as Promise<CallerIdentityResponse>,
        gw.resolvedRegion(),
      ])
      const arn = response?.Arn ?? ""
      const accountId = response?.Account ?? ""
      const partition = partitionOf(arn)
      if (!arn || !accountId || !partition) {
        throw new Error(
          `sts:GetCallerIdentity answered without an ARN or account (arn=${JSON.stringify(arn)}, ` +
            `account=${JSON.stringify(accountId)}). The estate cannot be described from this.`,
        )
      }
      return { accountId, arn, partition, region }
    },
    { now, isEmpty: () => false },
  )

  if (useCache) {
    cached = read.state === "ACTUAL" ? { at: now().getTime(), read } : null
  }
  return read
}

/**
 * Who a denial elsewhere should say it was refused as.
 *
 * Every other read in this directory takes this, so a denied `ecs:ListServices`
 * names the same principal the header shows. When identity itself could not be
 * read the context says exactly that rather than going blank — an engine that
 * cannot see itself is a different problem from one that cannot see ECS, and
 * the operator needs to be told which they have.
 */
export function denialContextFrom(identity: AwsRead<Identity>): DenialContext {
  if (identity.state === "ACTUAL" || identity.state === "STALE") {
    return {
      principal: identity.value.arn,
      accountId: identity.value.accountId,
      region: identity.value.region,
      partition: identity.value.partition,
    }
  }
  if (identity.state === "DENIED") {
    return {
      principal: `unknown principal — this role was refused ${identity.action}`,
      accountId: null,
      region: null,
      partition: null,
    }
  }
  return {
    principal: "unknown principal — sts:GetCallerIdentity has not answered",
    accountId: null,
    region: null,
    partition: null,
  }
}

/** The header band: account, principal, region, partition, and how it was learnt. */
export function identityHeadline(identity: AwsRead<Identity>): string {
  switch (identity.state) {
    case "ACTUAL":
    case "STALE":
      return (
        `account ${identity.value.accountId} · region ${identity.value.region} · ` +
        `partition ${identity.value.partition} · as ${identity.value.arn}`
      )
    case "DENIED":
      return (
        `unknown — this role cannot call ${identity.action} (${identity.errorCode}). ` +
        `Minimum statement: ${identity.minimumStatement}`
      )
    case "THROTTLED":
      return `unknown — AWS rate-limited sts:GetCallerIdentity; retrying in ${identity.retryAfterMs}ms`
    case "EMPTY":
      return "unknown — sts:GetCallerIdentity answered with nothing"
    case "UNCONFIGURED":
      return `unknown — ${identity.why}`
    case "ERROR":
      return `unknown — sts:GetCallerIdentity failed (${identity.code}): ${identity.safeDetail}`
  }
}
