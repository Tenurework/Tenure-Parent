/**
 * STUDIO-010-005 — the eight roles, the invariants of the declaration itself,
 * and the four ways an account can disagree with it.
 *
 * The reconciliation is driven with `IamPosture`-shaped readings rather than a
 * gateway stand-in because `iamPosture` is a five-call sweep with its own suite;
 * what is under test here is the comparison, and the fields it compares —
 * `permissionsBoundaryArn` and `assumeRolePolicy` — are produced by `iam.ts` at
 * one construction site each and typed as required, so a reader that stopped
 * setting them would not compile.
 */

import {
  DEPLOYMENT_ROLES,
  conflictingRoles,
  reconcileDeploymentRoles,
  roleDefects,
  roleSummary,
  type DeploymentRole,
  type DeploymentRoleKey,
} from "./deployment-roles"
import { __resetIdentity } from "./identity"
import { iamPosture, type IamPosture, type IamPrincipal, type PolicyStatement } from "./iam"
import type { AwsGateway, AwsRead } from "./read"

/* -------------------------------------------------------------- fixtures -- */

const statement = (over: Partial<PolicyStatement> = {}): PolicyStatement => ({
  sid: null,
  effect: "Allow",
  actions: ["sts:AssumeRole"],
  notActions: [],
  resources: [],
  notResources: [],
  principals: ["arn:aws:iam::123456789012:root"],
  hasCondition: true,
  ...over,
})

const role = (over: Partial<IamPrincipal> = {}): IamPrincipal => ({
  kind: "role",
  name: "tenure-control-plane-read",
  arn: "arn:aws:iam::123456789012:role/tenure-control-plane-read",
  path: "/",
  createdAt: "2026-01-01T00:00:00.000Z",
  tags: {},
  attribution: { kind: "shared" },
  attributionSource: "iam-resource-tags",
  attributionDetail: "tenure:tenant = shared",
  management: { kind: "terraform", isConsoleOrUnmanaged: false, detail: "tenure:managed-by = terraform" },
  tagProblems: [],
  attachedPolicies: [],
  inlinePolicyNames: [],
  hasPermissionsBoundary: true,
  permissionsBoundaryArn: "arn:aws:iam::123456789012:policy/TenureReadOnlyBoundary",
  assumeRolePolicy: {
    state: "PARSED",
    statements: [statement({ actions: ["sts:AssumeRole", "sts:TagSession"] })],
  },
  wildcards: [],
  lastUsedAt: null,
  accessKeys: null,
  ...over,
})

/** An account holding every declared role, correctly bounded and taggable. */
function compliantPosture(): AwsRead<IamPosture> {
  const roles = DEPLOYMENT_ROLES.map((declared) =>
    role({
      name: declared.roleName,
      arn: `arn:aws:iam::123456789012:role/${declared.roleName}`,
      permissionsBoundaryArn: `arn:aws:iam::123456789012:policy/${declared.permissionsBoundary}`,
    }),
  )
  return {
    state: "ACTUAL",
    capability: "iam:GetAccountAuthorizationDetails",
    asOf: "2026-08-17T00:00:00.000Z",
    fresh: true,
    value: {
      roles,
      users: [],
      wildcards: [],
      longLivedKeys: [],
      accessKeys: [],
      unmanaged: [],
      unswept: [],
      unreadableDocuments: [],
      keyCoverage: { usersAsked: 0, usersAnswered: 0, usersDenied: 0, usersThrottled: 0, usersErrored: 0, complete: true, detail: "" },
      sweepCoverage: { policiesSwept: 0, policiesUnreadable: 0, policiesUnswept: 0, complete: true, detail: "" },
    },
  }
}

function withRole(mutate: (declared: DeploymentRole, principal: IamPrincipal) => IamPrincipal): AwsRead<IamPosture> {
  const base = compliantPosture()
  if (base.state !== "ACTUAL") throw new Error("fixture")
  return {
    ...base,
    value: {
      ...base.value,
      roles: base.value.roles.map((p, i) => mutate(DEPLOYMENT_ROLES[i], p)),
    },
  }
}

/* ------------------------------------ the two fields, from the real reader -- */

/**
 * The reconciliation compares `permissionsBoundaryArn` and `assumeRolePolicy`,
 * and both are produced by `iamPosture` at one construction site. The fixtures
 * above cannot prove that site sets them — a reader that returned `null` for
 * every boundary would still type-check, and every assertion above would stay
 * green while the console reported the whole account as unbounded.
 *
 * So this drives the REAL reader with a stand-in at the `AwsGateway` seam, on a
 * response shaped the way `GetAccountAuthorizationDetails` shapes one.
 */
describe("the fields this reconciliation compares come off the real IAM read", () => {
  const TRUST = encodeURIComponent(
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: "arn:aws:iam::123456789012:root" },
          Action: ["sts:AssumeRole", "sts:TagSession"],
          Condition: { StringEquals: { "aws:PrincipalTag/tenure:operator": "true" } },
        },
      ],
    }),
  )

  const gateway: AwsGateway = {
    async call(capability) {
      switch (capability) {
        case "sts:GetCallerIdentity":
          return {
            Account: "123456789012",
            Arn: "arn:aws:sts::123456789012:assumed-role/studio/session",
            UserId: "AROAEXAMPLE:session",
          }
        case "tag:GetResources":
          return { ResourceTagMappingList: [] }
        case "iam:GetAccountAuthorizationDetails":
          return {
            RoleDetailList: [
              {
                Path: "/",
                RoleName: "tenure-deploy-production",
                Arn: "arn:aws:iam::123456789012:role/tenure-deploy-production",
                AssumeRolePolicyDocument: TRUST,
                PermissionsBoundary: {
                  PermissionsBoundaryArn: "arn:aws:iam::123456789012:policy/TenureDeployBoundary",
                },
                AttachedManagedPolicies: [],
                RolePolicyList: [],
                Tags: [],
              },
            ],
            UserDetailList: [],
            Policies: [],
          }
        default:
          throw new Error(`the fixture was asked for ${capability}`)
      }
    },
    async resolvedRegion() {
      return "us-east-1"
    },
  }

  beforeEach(() => {
    __resetIdentity()
  })

  it("surfaces the boundary ARN and the decoded trust policy, and the reconciliation reads them", async () => {
    const surface = await iamPosture(gateway, { now: () => new Date("2026-08-17T00:00:00.000Z") })
    expect(surface.read.state).toBe("ACTUAL")

    const verdict = reconcileDeploymentRoles({ posture: surface.read }).find(
      (v) => v.role.key === "deploy-production",
    )!
    expect(verdict.presence.state).toBe("PRESENT")
    expect(verdict.boundary).toEqual({
      state: "DECLARED_BOUNDARY",
      arn: "arn:aws:iam::123456789012:policy/TenureDeployBoundary",
    })
    expect(verdict.sessionTags.state).toBe("KEYS_UNVERIFIABLE")
    expect(verdict.trust.state).toBe("CONDITIONED")
  })
})

/* ---------------------------------------------------------- the declaration -- */

describe("the declared role split", () => {
  it("declares exactly the eight roles the requirement names", () => {
    expect(DEPLOYMENT_ROLES.map((r) => r.key)).toEqual([
      "read",
      "plan",
      "deploy-development",
      "deploy-staging",
      "deploy-production",
      "security-remediation",
      "lifecycle",
      "break-glass",
    ])
  })

  it("has no defect in it", () => {
    expect(roleDefects()).toEqual([])
  })

  it("gives every role a permissions boundary and at least one session tag", () => {
    for (const declared of DEPLOYMENT_ROLES) {
      expect(declared.permissionsBoundary).not.toBe("")
      expect(declared.sessionTags.length).toBeGreaterThan(0)
      expect(declared.purpose.length).toBeGreaterThan(60)
    }
  })

  it("demands a proven second factor of every role that can reach production", () => {
    for (const declared of DEPLOYMENT_ROLES) {
      if (declared.environment === "production" || declared.environment === "any") {
        expect(declared.requiresMfa).toBe(true)
      }
    }
  })

  it("gives break-glass the shortest session of all eight", () => {
    const breakGlass = DEPLOYMENT_ROLES.find((r) => r.key === "break-glass")!
    for (const other of DEPLOYMENT_ROLES) {
      if (other.key === "break-glass") continue
      expect(breakGlass.maxSessionSeconds).toBeLessThan(other.maxSessionSeconds)
    }
  })

  it("separates break-glass and production deploy from everything else", () => {
    expect(conflictingRoles("break-glass")).toHaveLength(DEPLOYMENT_ROLES.length - 1)
    expect(conflictingRoles("deploy-production")).toContain("plan")
    expect(conflictingRoles("plan")).toContain("deploy-production")
  })

  it("throws for a role nobody declared rather than returning nothing to conflict with", () => {
    expect(() => conflictingRoles("deploy-everywhere" as DeploymentRoleKey)).toThrow(
      /No deployment role is declared/,
    )
  })
})

describe("roleDefects — the edits it exists to refuse", () => {
  const base: DeploymentRole = {
    key: "read",
    roleName: "r",
    purpose: "p",
    environment: "none",
    permissionsBoundary: "B",
    sessionTags: ["tenure:operator"],
    maxSessionSeconds: 3600,
    requiresMfa: false,
    assumableBy: "workload",
    separationFrom: [],
  }

  it("refuses a role that demands no session tag", () => {
    expect(roleDefects([{ ...base, sessionTags: [] }])).toEqual([
      expect.stringMatching(/demands no session tag/),
    ])
  })

  it("refuses a role with no permissions boundary", () => {
    expect(roleDefects([{ ...base, permissionsBoundary: "  " }])).toEqual([
      expect.stringMatching(/names no permissions boundary/),
    ])
  })

  it("refuses a production role that does not demand a second factor", () => {
    expect(roleDefects([{ ...base, environment: "production", requiresMfa: false }])).toEqual([
      expect.stringMatching(/can reach production without a proven second factor/),
    ])
  })

  it("refuses a separation that holds in one direction only", () => {
    const defects = roleDefects([
      { ...base, key: "read", separationFrom: ["plan"] },
      { ...base, key: "plan", roleName: "r2", separationFrom: [] },
    ])
    expect(defects).toEqual([expect.stringMatching(/A one-way separation/)])
  })

  it("refuses two roles sharing one IAM name", () => {
    expect(roleDefects([base, { ...base, key: "plan" }])).toEqual([
      expect.stringMatching(/Two roles are declared with the IAM name r/),
    ])
  })

  it("refuses a session longer than AWS's own ceiling", () => {
    expect(roleDefects([{ ...base, maxSessionSeconds: 13 * 3600 }])).toEqual([
      expect.stringMatching(/longer than AWS's own twelve-hour ceiling/),
    ])
  })
})

/* ------------------------------------------------------- the reconciliation -- */

describe("reconcileDeploymentRoles against the account", () => {
  it("finds every declared role in a compliant account", () => {
    const verdicts = reconcileDeploymentRoles({ posture: compliantPosture() })
    expect(verdicts).toHaveLength(DEPLOYMENT_ROLES.length)
    expect(verdicts.every((v) => v.presence.state === "PRESENT")).toBe(true)
    expect(verdicts.every((v) => v.boundary.state === "DECLARED_BOUNDARY")).toBe(true)
    expect(roleSummary(verdicts).present).toBe(8)
  })

  it("tells a boundary that is not the declared one from no boundary at all", () => {
    const other = reconcileDeploymentRoles({
      posture: withRole((_, p) => ({
        ...p,
        permissionsBoundaryArn: "arn:aws:iam::123456789012:policy/AdministratorAccessBoundary",
      })),
    })
    expect(other.every((v) => v.boundary.state === "OTHER_BOUNDARY")).toBe(true)
    expect(roleSummary(other).unbounded).toBe(0)

    const none = reconcileDeploymentRoles({
      posture: withRole((_, p) => ({ ...p, permissionsBoundaryArn: null })),
    })
    expect(none.every((v) => v.boundary.state === "NO_BOUNDARY")).toBe(true)
    expect(roleSummary(none).unbounded).toBe(8)
    expect(roleSummary(none).headline).toMatch(/8 with no permissions boundary/)
  })

  it("reports a role whose trust policy cannot be tagged as a finding, not as unverifiable", () => {
    const verdicts = reconcileDeploymentRoles({
      posture: withRole((_, p) => ({
        ...p,
        assumeRolePolicy: { state: "PARSED", statements: [statement({ actions: ["sts:AssumeRole"] })] },
      })),
    })
    expect(verdicts.every((v) => v.sessionTags.state === "CANNOT_BE_TAGGED")).toBe(true)
    expect(roleSummary(verdicts).untaggable).toBe(8)
  })

  it("says which keys it cannot verify when tagging IS permitted", () => {
    const read = reconcileDeploymentRoles({ posture: compliantPosture() })[0]
    expect(read.sessionTags.state).toBe("KEYS_UNVERIFIABLE")
    if (read.sessionTags.state === "KEYS_UNVERIFIABLE") {
      expect(read.sessionTags.declaredKeys).toEqual(DEPLOYMENT_ROLES[0].sessionTags)
      expect(read.sessionTags.because).toMatch(/hasCondition as a boolean/)
    }
  })

  it("tells an unconditional trust from a conditioned one, and a wildcard principal from both", () => {
    const unconditional = reconcileDeploymentRoles({
      posture: withRole((_, p) => ({
        ...p,
        assumeRolePolicy: {
          state: "PARSED",
          statements: [statement({ actions: ["sts:AssumeRole", "sts:TagSession"], hasCondition: false })],
        },
      })),
    })
    expect(unconditional.every((v) => v.trust.state === "UNCONDITIONAL")).toBe(true)

    const everyone = reconcileDeploymentRoles({
      posture: withRole((_, p) => ({
        ...p,
        assumeRolePolicy: {
          state: "PARSED",
          statements: [statement({ actions: ["sts:AssumeRole", "sts:TagSession"], principals: ["*"] })],
        },
      })),
    })
    expect(everyone.every((v) => v.trust.state === "TRUSTS_EVERYONE")).toBe(true)

    expect(reconcileDeploymentRoles({ posture: compliantPosture() })[0].trust.state).toBe(
      "CONDITIONED",
    )
  })

  it("reports a role the account does not hold as MISSING", () => {
    const base = compliantPosture()
    if (base.state !== "ACTUAL") throw new Error("fixture")
    const verdicts = reconcileDeploymentRoles({
      posture: {
        ...base,
        value: { ...base.value, roles: base.value.roles.filter((p) => p.name !== "tenure-break-glass") },
      },
    })
    const breakGlass = verdicts.find((v) => v.role.key === "break-glass")!
    expect(breakGlass.presence.state).toBe("MISSING")
    expect(breakGlass.boundary.state).toBe("UNREAD")
    expect(roleSummary(verdicts).missing).toBe(1)
  })

  it("treats an account with no roles at all as an answer, not as an unread", () => {
    const verdicts = reconcileDeploymentRoles({
      posture: { state: "EMPTY", capability: "iam:GetAccountAuthorizationDetails", asOf: "2026-08-17T00:00:00.000Z" },
    })
    expect(verdicts.every((v) => v.presence.state === "MISSING")).toBe(true)
    expect(roleSummary(verdicts).missing).toBe(8)
  })
})

describe("a read that failed is not an account that is missing roles", () => {
  const denied: AwsRead<IamPosture> = {
    state: "DENIED",
    capability: "iam:GetAccountAuthorizationDetails",
    action: "iam:GetAccountAuthorizationDetails",
    principal: "arn:aws:sts::123456789012:assumed-role/studio/session",
    accountId: "123456789012",
    region: "us-east-1",
    partition: "aws",
    errorCode: "AccessDeniedException",
    minimumStatement: '{"Effect":"Allow","Action":["iam:GetAccountAuthorizationDetails"],"Resource":"*"}',
  }

  it("reports every role UNREAD, and none missing", () => {
    const verdicts = reconcileDeploymentRoles({ posture: denied })
    expect(verdicts).toHaveLength(DEPLOYMENT_ROLES.length)
    expect(verdicts.every((v) => v.presence.state === "UNREAD")).toBe(true)
    expect(verdicts.some((v) => v.presence.state === "MISSING")).toBe(false)

    const summary = roleSummary(verdicts)
    expect(summary.missing).toBe(0)
    expect(summary.unbounded).toBe(0)
    expect(summary.headline).toMatch(/iam:GetAccountAuthorizationDetails was refused/)
    expect(summary.headline).toMatch(/none is reported missing/)
  })

  it("does not claim a boundary, a session tag or a trust for an unread role", () => {
    for (const verdict of reconcileDeploymentRoles({ posture: denied })) {
      expect(verdict.boundary.state).toBe("UNREAD")
      expect(verdict.sessionTags.state).toBe("UNREAD")
      expect(verdict.trust.state).toBe("UNREAD")
    }
  })

  it("reports a trust policy that would not parse as unread rather than as untaggable", () => {
    const verdicts = reconcileDeploymentRoles({
      posture: withRole((_, p) => ({
        ...p,
        assumeRolePolicy: { state: "UNREADABLE", why: "the document did not decode" },
      })),
    })
    expect(verdicts.every((v) => v.sessionTags.state === "UNREAD")).toBe(true)
    expect(verdicts.every((v) => v.trust.state === "UNREAD")).toBe(true)
    expect(roleSummary(verdicts).untaggable).toBe(0)
  })
})
