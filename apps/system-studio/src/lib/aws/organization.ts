/**
 * STUDIO-010-001 / STUDIO-010-002 — is there an Organization, and who manages it.
 *
 * The console asserted an answer to this from a JSON file: `/platform` rendered
 * `estate.organizationInUse ? "in use" : "not in use — a single-account estate"`,
 * where the boolean came from a CI script whose `describe-organization` call was
 * DENIED and whose helper turned a denial into a falsy value. The page therefore
 * told operators there was no Organization on the strength of not being allowed
 * to ask.
 *
 * Three answers here, and they are genuinely different facts:
 *
 *   IN_USE       an Organization exists, and this is the account that manages it
 *   NOT_IN_USE   AWS itself said so — `AWSOrganizationsNotInUseException` is an
 *                ANSWER, the one case where an error is information
 *   UNKNOWN      the call was refused, so nothing is known either way
 *
 * Collapsing UNKNOWN into NOT_IN_USE is the exact defect above, so the union has
 * no arm that permits it.
 */

import { minimumStatementText } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  errorName,
  isDenial,
  isThrottle,
  liveGateway,
  readAws,
  safeDetail,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"

export type OrganizationRead =
  | {
      state: "IN_USE"
      organizationId: string
      managementAccountId: string
      managementAccountArn: string
      featureSet: string
      asOf: string
    }
  /** AWS answered that no Organization exists. A fact, not a failure. */
  | { state: "NOT_IN_USE"; asOf: string }
  | {
      state: "UNKNOWN"
      principal: string
      action: string
      errorCode: string
      minimumStatement: string
    }

interface DescribeOrganizationResponse {
  Organization?: {
    Id?: string
    MasterAccountId?: string
    MasterAccountArn?: string
    FeatureSet?: string
  }
}

/** The service's own name for "there is no Organization here". */
const NOT_IN_USE = "AWSOrganizationsNotInUseException"

export async function describeOrganization(
  supplied?: AwsGateway,
  options: { now?: () => Date; denial?: DenialContext } = {},
): Promise<OrganizationRead> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())
  const denial = options.denial

  try {
    const response = (await gw.call(
      "organizations:DescribeOrganization",
    )) as DescribeOrganizationResponse
    const org = response?.Organization
    if (!org?.Id || !org.MasterAccountId) {
      // A successful call with no Organization in it is not the same as the
      // NotInUse exception, and pretending it is would invent an answer.
      return {
        state: "UNKNOWN",
        principal: denial?.principal ?? "unknown principal",
        action: "organizations:DescribeOrganization",
        errorCode: "IncompleteResponse",
        minimumStatement: minimumStatementText("organizations:DescribeOrganization"),
      }
    }
    return {
      state: "IN_USE",
      organizationId: org.Id,
      managementAccountId: org.MasterAccountId,
      managementAccountArn: org.MasterAccountArn ?? "",
      featureSet: org.FeatureSet ?? "unknown",
      asOf: now().toISOString(),
    }
  } catch (error) {
    if (errorName(error) === NOT_IN_USE) {
      return { state: "NOT_IN_USE", asOf: now().toISOString() }
    }
    if (isDenial(error) || isThrottle(error)) {
      return {
        state: "UNKNOWN",
        principal: denial?.principal ?? "unknown principal",
        action: "organizations:DescribeOrganization",
        errorCode: errorName(error),
        minimumStatement: minimumStatementText("organizations:DescribeOrganization"),
      }
    }
    return {
      state: "UNKNOWN",
      principal: denial?.principal ?? "unknown principal",
      action: "organizations:DescribeOrganization",
      errorCode: errorName(error),
      minimumStatement: safeDetail(error),
    }
  }
}

export interface OrgAccount {
  id: string
  name: string
  status: string
  email: string
}

interface ListAccountsResponse {
  Accounts?: Array<{ Id?: string; Name?: string; Status?: string; Email?: string }>
  NextToken?: string
}

/**
 * Every account in the Organization.
 *
 * Returned as an `AwsRead` rather than the three-state union above because the
 * "not in use" case is already answered by `describeOrganization` — asking a
 * second time would be a second chance to disagree.
 */
export async function organizationAccounts(
  supplied?: AwsGateway,
  options: { now?: () => Date; denial?: DenialContext } = {},
): Promise<AwsRead<readonly OrgAccount[]>> {
  const gw = supplied ?? liveGateway()
  return readAws<readonly OrgAccount[]>(
    "organizations:ListAccounts",
    async () => {
      const out: OrgAccount[] = []
      let token: string | undefined
      do {
        const response = (await gw.call("organizations:ListAccounts", {
          NextToken: token,
        })) as ListAccountsResponse
        for (const account of response?.Accounts ?? []) {
          if (!account.Id) continue
          out.push({
            id: account.Id,
            name: account.Name ?? account.Id,
            status: account.Status ?? "unknown",
            // Not rendered anywhere: carried so the topology reconciliation can
            // match an account by its registered address when the name is
            // ambiguous, which is common in estates grown by hand.
            email: account.Email ?? "",
          })
        }
        token = response?.NextToken || undefined
      } while (token)
      return out
    },
    { now: options.now, denial: options.denial },
  )
}

/** The whole organization surface, with identity resolved for the denial context. */
export async function organizationSurface(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<{
  identity: AwsRead<Identity>
  organization: OrganizationRead
  accounts: AwsRead<readonly OrgAccount[]>
}> {
  const now = options.now ?? (() => new Date())
  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const organization = await describeOrganization(supplied, { now, denial })
  const accounts =
    organization.state === "IN_USE"
      ? await organizationAccounts(supplied, { now, denial })
      : ({
          state: "UNCONFIGURED",
          capability: "organizations:ListAccounts",
          why:
            organization.state === "NOT_IN_USE"
              ? "there is no Organization to list accounts from"
              : "the Organization itself could not be read, so its accounts were not asked for",
        } satisfies AwsRead<readonly OrgAccount[]>)

  return { identity, organization, accounts }
}
