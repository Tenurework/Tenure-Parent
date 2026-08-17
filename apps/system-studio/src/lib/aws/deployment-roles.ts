/**
 * STUDIO-010-005 — the eight AWS roles this control plane splits its authority
 * across, the permissions boundary each is held inside, and the session tags
 * each assumption has to carry.
 *
 * > *Define separate read, plan, deploy-development, deploy-staging,
 * > deploy-production, security-remediation, lifecycle, and break-glass roles
 * > with permissions boundaries and session tags.*
 *
 * ## What the split is for
 *
 * One role that can read the estate, plan a change and apply it to production is
 * one credential whose theft is the whole platform. Eight roles is not
 * bureaucracy: it is the difference between "the plan job's token leaked" and
 * "production was rolled". Every property below exists because it changes what a
 * leaked or misused session can do —
 *
 *   * the **boundary** caps the role's effective permissions no matter what a
 *     future policy attachment says, which is the only control that survives
 *     somebody attaching `AdministratorAccess` to it;
 *   * the **session tags** are what make an action attributable to a change and
 *     a requester rather than to a role that forty jobs share;
 *   * the **session length** is how long a stolen token is worth stealing;
 *   * **separation** is the pairs one principal must not hold at once.
 *
 * ## Declared here, reconciled against the account
 *
 * The same shape as `topology.ts` (accounts) and `organization-units.ts` (units):
 * a declaration is what makes a live read mean something, because
 * `GetAccountAuthorizationDetails` returns a list of role names and "is that the
 * right set of roles" is a question only a declared intent can answer.
 *
 * ## What the current read can and cannot corroborate
 *
 * It reads the account's roles through `iamPosture`, which already returns the
 * permissions-boundary ARN and the decoded trust policy for every role — so
 * presence, the boundary, unconditional trust and whether the role can receive a
 * session tag at all are checked against AWS.
 *
 * It cannot check WHICH tag keys a trust policy demands: `PolicyStatement`
 * carries `hasCondition` as a boolean and not the condition body, so the
 * required-key half is reported as `unverifiable` with that reason rather than
 * as a pass. A role whose trust policy does not permit `sts:TagSession` at all,
 * on the other hand, provably cannot carry a session tag — that one IS a
 * finding, and it is the one that matters, because a role nobody can tag is a
 * role whose every action is attributed to the role.
 */

import type { IamPosture, IamPrincipal, PolicyStatement } from "./iam"
import type { AwsRead } from "./read"

/* ---------------------------------------------------------- the declaration -- */

export type DeploymentRoleKey =
  | "read"
  | "plan"
  | "deploy-development"
  | "deploy-staging"
  | "deploy-production"
  | "security-remediation"
  | "lifecycle"
  | "break-glass"

/** Which environment a role is allowed to touch. `none` is a read-only role. */
export type RoleEnvironment = "none" | "development" | "staging" | "production" | "any"

export interface DeploymentRole {
  key: DeploymentRoleKey
  /** The IAM role name this declaration expects, and matches on. */
  roleName: string
  purpose: string
  environment: RoleEnvironment
  /** The boundary policy name. Every role has one; there is no arm for "none". */
  permissionsBoundary: string
  /**
   * The session-tag keys an assumption must carry.
   *
   * Never empty. A session with no tag is an action attributable to a role
   * rather than to a change and a person, which is the attribution STUDIO-060-010
   * needs and the one an incident review asks for first.
   */
  sessionTags: readonly string[]
  /** How long a token from this role is worth stealing. */
  maxSessionSeconds: number
  /** Whether the trust policy must demand a proven second factor. */
  requiresMfa: boolean
  /** Whether a human may assume it directly, or only a CI workload identity may. */
  assumableBy: "workload" | "human" | "human-with-approval"
  /** Keys one principal must not hold at the same time as this one. */
  separationFrom: readonly DeploymentRoleKey[]
}

const HOUR = 3600

export const DEPLOYMENT_ROLES: readonly DeploymentRole[] = [
  {
    key: "read",
    roleName: "tenure-control-plane-read",
    purpose:
      "Reads the estate for every console surface. It is the role this engine runs as, and it is the reason a compromise of the console is not a compromise of the estate.",
    environment: "none",
    permissionsBoundary: "TenureReadOnlyBoundary",
    sessionTags: ["tenure:operator", "tenure:correlation-id"],
    maxSessionSeconds: HOUR,
    requiresMfa: false,
    assumableBy: "workload",
    separationFrom: ["deploy-production", "break-glass"],
  },
  {
    key: "plan",
    roleName: "tenure-control-plane-plan",
    purpose:
      "Produces a change plan and writes nothing. Separate from every deploy role so the plan an approver reads cannot have been produced by the credential that will apply it.",
    environment: "none",
    permissionsBoundary: "TenureReadOnlyBoundary",
    sessionTags: ["tenure:operator", "tenure:change-id", "tenure:correlation-id"],
    maxSessionSeconds: HOUR,
    requiresMfa: false,
    assumableBy: "workload",
    separationFrom: ["deploy-production", "break-glass"],
  },
  {
    key: "deploy-development",
    roleName: "tenure-deploy-development",
    purpose:
      "Applies a change to the development cell. Holds no tenant data and is the only deploy role a change reaches without an approval.",
    environment: "development",
    permissionsBoundary: "TenureDeployBoundary",
    sessionTags: ["tenure:operator", "tenure:change-id", "tenure:environment"],
    maxSessionSeconds: HOUR,
    requiresMfa: false,
    assumableBy: "workload",
    separationFrom: ["deploy-production", "break-glass"],
  },
  {
    key: "deploy-staging",
    roleName: "tenure-deploy-staging",
    purpose:
      "Applies a change to the staging cell, which runs the same release one step ahead of production and is where a rollback is proved before it is needed.",
    environment: "staging",
    permissionsBoundary: "TenureDeployBoundary",
    sessionTags: ["tenure:operator", "tenure:change-id", "tenure:environment"],
    maxSessionSeconds: HOUR,
    requiresMfa: false,
    assumableBy: "workload",
    separationFrom: ["deploy-production", "break-glass"],
  },
  {
    key: "deploy-production",
    roleName: "tenure-deploy-production",
    purpose:
      "Applies an approved change to a production cell. The one role whose session can affect a paying tenant, and therefore the one with a proven second factor, the shortest life and the most separation.",
    environment: "production",
    permissionsBoundary: "TenureDeployBoundary",
    sessionTags: ["tenure:operator", "tenure:change-id", "tenure:approval-id", "tenure:environment"],
    maxSessionSeconds: HOUR,
    requiresMfa: true,
    assumableBy: "human-with-approval",
    separationFrom: [
      "read",
      "plan",
      "deploy-development",
      "deploy-staging",
      "security-remediation",
      "lifecycle",
      "break-glass",
    ],
  },
  {
    key: "security-remediation",
    roleName: "tenure-security-remediation",
    purpose:
      "Closes a finding — revokes a key, removes a public grant, re-encrypts a bucket. Deliberately not a deploy role: remediation runs during an incident, when the change process is the thing that is too slow.",
    environment: "any",
    permissionsBoundary: "TenureSecurityRemediationBoundary",
    sessionTags: ["tenure:operator", "tenure:finding-id", "tenure:ticket"],
    maxSessionSeconds: HOUR,
    requiresMfa: true,
    assumableBy: "human-with-approval",
    separationFrom: ["deploy-production", "break-glass"],
  },
  {
    key: "lifecycle",
    roleName: "tenure-tenant-lifecycle",
    purpose:
      "Suspends, hibernates, purges and reactivates a tenant's own resources. Scoped by the tenant tag on the session, so a lifecycle session names the tenant it may act on before it acts.",
    environment: "any",
    permissionsBoundary: "TenureLifecycleBoundary",
    sessionTags: ["tenure:operator", "tenure:tenant", "tenure:change-id", "tenure:approval-id"],
    maxSessionSeconds: HOUR,
    requiresMfa: true,
    assumableBy: "human-with-approval",
    separationFrom: ["deploy-production", "break-glass"],
  },
  {
    key: "break-glass",
    roleName: "tenure-break-glass",
    purpose:
      "Recovery when every other path is down. Two-person, time-bound, alerted in real time, reviewed afterwards, and revoked automatically — STUDIO-010-010 and STUDIO-020-011 are the process this role is the credential for.",
    environment: "any",
    permissionsBoundary: "TenureBreakGlassBoundary",
    sessionTags: ["tenure:operator", "tenure:approver", "tenure:incident", "tenure:ticket"],
    // Deliberately the shortest. A break-glass session that outlives the
    // incident is an administrator credential with no process in front of it.
    maxSessionSeconds: 1800,
    requiresMfa: true,
    assumableBy: "human-with-approval",
    separationFrom: [
      "read",
      "plan",
      "deploy-development",
      "deploy-staging",
      "deploy-production",
      "security-remediation",
      "lifecycle",
    ],
  },
]

/**
 * Everything wrong with the declaration itself.
 *
 * Runs in a test and can run on a page. An empty array is the only passing
 * answer; a defect is a sentence rather than a thrown error, so a declaration
 * that has gone wrong is reported instead of blanking a console.
 */
export function roleDefects(
  roles: readonly DeploymentRole[] = DEPLOYMENT_ROLES,
): readonly string[] {
  const defects: string[] = []
  const keys = new Set(roles.map((r) => r.key))
  const names = new Set<string>()

  for (const role of roles) {
    if (names.has(role.roleName)) {
      defects.push(`Two roles are declared with the IAM name ${role.roleName}.`)
    }
    names.add(role.roleName)

    if (role.sessionTags.length === 0) {
      defects.push(
        `${role.key} demands no session tag, so every action it takes is attributable to the role and to nobody.`,
      )
    }
    if (role.permissionsBoundary.trim() === "") {
      defects.push(`${role.key} names no permissions boundary.`)
    }
    if (role.maxSessionSeconds > 12 * HOUR) {
      defects.push(`${role.key} may hold a session for longer than AWS's own twelve-hour ceiling.`)
    }
    if (role.environment === "production" && !role.requiresMfa) {
      defects.push(`${role.key} can reach production without a proven second factor.`)
    }
    for (const other of role.separationFrom) {
      if (!keys.has(other)) {
        defects.push(`${role.key} is separated from ${other}, which is not a declared role.`)
        continue
      }
      if (other === role.key) {
        defects.push(`${role.key} is separated from itself.`)
        continue
      }
      // Separation that holds in one direction only is separation that is not
      // enforced: whichever table a check reads decides the answer.
      const back = roles.find((r) => r.key === other)
      if (back && !back.separationFrom.includes(role.key)) {
        defects.push(
          `${role.key} is separated from ${other} and ${other} is not separated from ${role.key}. ` +
            `A one-way separation is decided by whichever of the two a check happens to read.`,
        )
      }
    }
  }

  return defects
}

/** Which declared roles a principal must not also hold. */
export function conflictingRoles(key: DeploymentRoleKey): readonly DeploymentRoleKey[] {
  const role = DEPLOYMENT_ROLES.find((r) => r.key === key)
  if (!role) throw new Error(`No deployment role is declared for ${JSON.stringify(key)}.`)
  return role.separationFrom
}

/* ------------------------------------------------------------ reconciliation -- */

/** Whether the declared role exists in the account. */
export type RolePresence =
  | { state: "PRESENT"; arn: string }
  | { state: "MISSING" }
  | { state: "UNREAD"; because: string }

/** Whether the boundary that caps the role is the declared one. */
export type BoundaryVerdict =
  | { state: "DECLARED_BOUNDARY"; arn: string }
  /** A boundary is attached and it is not the one declared. */
  | { state: "OTHER_BOUNDARY"; arn: string }
  /** Read, and nothing caps this role. */
  | { state: "NO_BOUNDARY" }
  | { state: "UNREAD"; because: string }

/**
 * Whether the role can carry a session tag, as far as its trust policy shows.
 *
 * Three arms and not two. `CANNOT_BE_TAGGED` is a proven finding — the trust
 * policy was read and it does not permit `sts:TagSession`, so no assumption of
 * this role can carry one. `KEYS_UNVERIFIABLE` is the honest answer to the other
 * half: tagging is permitted, and which keys are demanded is not something the
 * decoded statement carries.
 */
export type SessionTagVerdict =
  | { state: "CANNOT_BE_TAGGED"; because: string }
  | { state: "KEYS_UNVERIFIABLE"; because: string; declaredKeys: readonly string[] }
  | { state: "UNREAD"; because: string }

/** Whether anyone at all may assume it, and whether the trust is conditioned. */
export type TrustVerdict =
  | { state: "CONDITIONED"; principals: readonly string[] }
  /** Assumable with no condition whatsoever — the finding, not a nuance. */
  | { state: "UNCONDITIONAL"; principals: readonly string[] }
  /** The trust policy names `*` as a principal. Worse than unconditional. */
  | { state: "TRUSTS_EVERYONE" }
  | { state: "UNREAD"; because: string }

export interface RoleVerdict {
  role: DeploymentRole
  presence: RolePresence
  boundary: BoundaryVerdict
  sessionTags: SessionTagVerdict
  trust: TrustVerdict
  /** Wildcard statements found on the role's own policies, by the IAM sweep. */
  wildcards: number
}

const ASSUME_ACTIONS = new Set(["sts:assumerole", "sts:assumerolewithwebidentity", "sts:assumerolewithsaml"])
const TAG_SESSION = "sts:tagsession"

function actionsOf(statement: PolicyStatement): readonly string[] {
  return statement.actions.map((a) => a.trim().toLowerCase())
}

function permitsTagSession(statements: readonly PolicyStatement[]): boolean {
  return statements.some(
    (s) =>
      s.effect.toLowerCase() === "allow" &&
      actionsOf(s).some((a) => a === TAG_SESSION || a === "sts:*" || a === "*"),
  )
}

function assumeStatements(statements: readonly PolicyStatement[]): readonly PolicyStatement[] {
  return statements.filter(
    (s) =>
      s.effect.toLowerCase() === "allow" &&
      actionsOf(s).some((a) => ASSUME_ACTIONS.has(a) || a === "sts:*" || a === "*"),
  )
}

/**
 * Compare the declared role split with the roles the account actually holds.
 *
 * Every declared role produces exactly one row, always — including when the read
 * failed. A table that shortens when a permission is missing is a permission
 * report wearing a topology's clothes.
 */
export function reconcileDeploymentRoles(input: {
  posture: AwsRead<IamPosture>
  roles?: readonly DeploymentRole[]
}): readonly RoleVerdict[] {
  const roles = input.roles ?? DEPLOYMENT_ROLES
  const read = input.posture

  let observed: readonly IamPrincipal[] | null = null
  let because: string | null = null

  switch (read.state) {
    case "ACTUAL":
    case "STALE":
      observed = read.value.roles
      break
    case "EMPTY":
      // An account with no roles at all is a real answer, and every declared
      // role is genuinely missing from it.
      observed = []
      break
    case "DENIED":
      because = `${read.action} was refused (${read.errorCode})`
      break
    case "THROTTLED":
      because = "the IAM read was rate-limited after backoff"
      break
    case "UNCONFIGURED":
      because = read.why
      break
    case "ERROR":
      because = `the IAM read failed (${read.code})`
      break
  }

  return roles.map((role): RoleVerdict => {
    if (!observed) {
      const why = because ?? "the account's roles were not read"
      return {
        role,
        presence: { state: "UNREAD", because: why },
        boundary: { state: "UNREAD", because: why },
        sessionTags: { state: "UNREAD", because: why },
        trust: { state: "UNREAD", because: why },
        wildcards: 0,
      }
    }

    const match = observed.find(
      (p) => p.name.trim().toLowerCase() === role.roleName.trim().toLowerCase(),
    )
    if (!match) {
      const why = "the role does not exist, so it has no boundary and no trust policy"
      return {
        role,
        presence: { state: "MISSING" },
        boundary: { state: "UNREAD", because: why },
        sessionTags: { state: "UNREAD", because: why },
        trust: { state: "UNREAD", because: why },
        wildcards: 0,
      }
    }

    const boundary: BoundaryVerdict =
      match.permissionsBoundaryArn === null
        ? { state: "NO_BOUNDARY" }
        : match.permissionsBoundaryArn.endsWith(`/${role.permissionsBoundary}`) ||
            match.permissionsBoundaryArn.endsWith(`:policy/${role.permissionsBoundary}`)
          ? { state: "DECLARED_BOUNDARY", arn: match.permissionsBoundaryArn }
          : { state: "OTHER_BOUNDARY", arn: match.permissionsBoundaryArn }

    const document = match.assumeRolePolicy
    let sessionTags: SessionTagVerdict
    let trust: TrustVerdict

    if (document === null) {
      const why = "this principal is a user and has no trust policy"
      sessionTags = { state: "UNREAD", because: why }
      trust = { state: "UNREAD", because: why }
    } else if (document.state === "UNREADABLE") {
      sessionTags = { state: "UNREAD", because: document.why }
      trust = { state: "UNREAD", because: document.why }
    } else {
      sessionTags = permitsTagSession(document.statements)
        ? {
            state: "KEYS_UNVERIFIABLE",
            because:
              "the trust policy permits sts:TagSession, and the decoded statement carries hasCondition as a boolean rather than the condition body — so which tag keys it demands cannot be read from this call",
            declaredKeys: role.sessionTags,
          }
        : {
            state: "CANNOT_BE_TAGGED",
            because:
              "the trust policy does not permit sts:TagSession, so no assumption of this role can carry a session tag and every action it takes is attributable to the role rather than to a change and a person",
          }

      const assumes = assumeStatements(document.statements)
      const principals = assumes.flatMap((s) => s.principals)
      trust = principals.some((p) => p.trim() === "*")
        ? { state: "TRUSTS_EVERYONE" }
        : assumes.length > 0 && assumes.every((s) => s.hasCondition)
          ? { state: "CONDITIONED", principals }
          : { state: "UNCONDITIONAL", principals }
    }

    return {
      role,
      presence: { state: "PRESENT", arn: match.arn },
      boundary,
      sessionTags,
      trust,
      wildcards: match.wildcards.length,
    }
  })
}

/**
 * One sentence over the whole table.
 *
 * Written here rather than on a page so the summary and the rows cannot
 * disagree, and so an unread account says that rather than "eight roles
 * missing" — the sentence an operator acts on by creating eight roles that may
 * already exist.
 */
export function roleSummary(verdicts: readonly RoleVerdict[]): {
  headline: string
  present: number
  missing: number
  unread: number
  unbounded: number
  untaggable: number
} {
  const present = verdicts.filter((v) => v.presence.state === "PRESENT").length
  const missing = verdicts.filter((v) => v.presence.state === "MISSING").length
  const unread = verdicts.filter((v) => v.presence.state === "UNREAD").length
  const unbounded = verdicts.filter((v) => v.boundary.state === "NO_BOUNDARY").length
  const untaggable = verdicts.filter((v) => v.sessionTags.state === "CANNOT_BE_TAGGED").length

  if (verdicts.length === 0) {
    return { headline: "No control-plane role is declared.", present, missing, unread, unbounded, untaggable }
  }
  if (unread === verdicts.length) {
    const first = verdicts[0].presence
    return {
      headline:
        `The account's roles were not read — ${first.state === "UNREAD" ? first.because : "no reason given"}. ` +
        `${verdicts.length} roles are declared and none is reported missing, because a role reported ` +
        `missing on a read nobody was allowed to make is how an operator creates one that exists.`,
      present,
      missing,
      unread,
      unbounded,
      untaggable,
    }
  }
  return {
    headline:
      `${present} of ${verdicts.length} declared control-plane roles exist` +
      (missing > 0 ? `, ${missing} missing` : "") +
      (unbounded > 0 ? `, ${unbounded} with no permissions boundary` : "") +
      (untaggable > 0 ? `, ${untaggable} that cannot carry a session tag` : "") +
      (unread > 0 ? `, ${unread} not read` : "") +
      ".",
    present,
    missing,
    unread,
    unbounded,
    untaggable,
  }
}
