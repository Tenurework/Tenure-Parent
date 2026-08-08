import { test, expect } from "@playwright/test"

import {
  AUTHORIZATION_REASONS,
  POLICY_REVISION,
  STUDIO_COMMANDS,
  authorizeCommand,
  authorizeOperator,
  controlPlaneIdentity,
  decisionLine,
  policyRevisionOf,
  type AuthorizationReason,
  type StudioCommand,
} from "../src/lib/authorize"
import {
  OPERATOR_GRANTS,
  OPERATOR_RESOURCES,
  OPERATOR_ROLES,
  isOperator,
  mayAct,
  mayView,
  operatorConfigProblems,
  roleOf,
  type OperatorPermission,
  type OperatorResource,
  type OperatorRole,
} from "../src/lib/operators"

/**
 * STUDIO-020-005 and STUDIO-020-006, without a browser.
 *
 * The role families, the grammar that carries them, and the decision every page
 * and every server action in this console now makes. Pure, so it runs against
 * an environment this file constructs rather than whatever the machine happens
 * to export — which matters more here than anywhere else in the suite, because
 * the thing under test IS the environment parser.
 *
 * The browser half is `operator-roles.spec.ts`, which drives two different
 * operators through the real sign-in form and asserts the mutating controls are
 * ABSENT from one of their pages.
 */

/** A secret that passes every rule in `operatorConfigProblems`. */
const SECRET = "spec-operator-secret-9f3b2c71d4"

const ACCOUNT = "111122223333"
const REGION = "eu-west-2"
const ENVIRONMENT = "staging"

function env(operators: string, over: Record<string, string> = {}): NodeJS.ProcessEnv {
  // A constructed environment, not the process's. The thing under test IS the
  // environment parser, so reading `process.env` here would make every
  // assertion depend on how the machine running it was configured.
  return {
    NODE_ENV: "test",
    PLATFORM_OPERATORS: operators,
    PLATFORM_OPERATOR_SECRET: SECRET,
    AWS_ACCOUNT_ID: ACCOUNT,
    AWS_REGION: REGION,
    DEPLOY_ENVIRONMENT: ENVIRONMENT,
    ...over,
  } as unknown as NodeJS.ProcessEnv
}

/** One address per family, so any role can be asked for by name. */
const EVERY_ROLE = OPERATOR_ROLES.map((role) => `${role}@tenure.example:${role}`).join(",")
const FLEET = env(EVERY_ROLE)
const address = (role: OperatorRole) => `${role}@tenure.example`

/** The control-plane scope, so a request is denied for the reason under test. */
const HERE = { environment: ENVIRONMENT, accountId: ACCOUNT, region: REGION }

test.describe("the nine role families", () => {
  test("are exactly the families the bible names", () => {
    // Named one by one rather than counted. A count passes for nine of anything,
    // including nine copies of the same family, and this list is the whole
    // vocabulary the rest of the console gates on.
    expect([...OPERATOR_ROLES]).toEqual([
      "platform-super-admin",
      "tenant-implementation-lead",
      "cloud-platform-engineer",
      "security-administrator",
      "release-manager",
      "support-engineer",
      "finops-analyst",
      "auditor-read-only",
      "emergency-responder",
    ])
  })

  test("every family has a grant list, and every grant names a real resource", () => {
    for (const role of OPERATOR_ROLES) {
      const grants: readonly string[] = OPERATOR_GRANTS[role]
      expect(grants.length, `${role} holds nothing at all`).toBeGreaterThan(0)
      for (const grant of grants) {
        const [resource, verb] = grant.split(":")
        expect(OPERATOR_RESOURCES as readonly string[]).toContain(resource)
        expect(["read", "write", "approve", "break-glass"]).toContain(verb)
      }
    }
  })
})

test.describe("the PLATFORM_OPERATORS grammar", () => {
  test("resolves each address to its own family", () => {
    for (const role of OPERATOR_ROLES) {
      expect(roleOf(address(role), FLEET)).toBe(role)
    }
  })

  test("an entry with no role is refused, not defaulted", () => {
    // The whole point of STUDIO-020-005. A silent default is how everybody ends
    // up an administrator, so a bare address is a configuration PROBLEM and
    // grants nothing — including the Super Admin it would have been most
    // convenient to assume.
    const legacy = env("someone@tenure.example")
    const problems = operatorConfigProblems(legacy)
    expect(problems.map((p) => p.variable)).toContain("PLATFORM_OPERATORS")
    expect(problems.map((p) => p.detail).join(" ")).toMatch(/names no role/)

    expect(roleOf("someone@tenure.example", legacy)).toBeNull()
    expect(isOperator("someone@tenure.example", legacy)).toBe(false)
  })

  test("a role that is not one of the nine is refused", () => {
    const invented = env("someone@tenure.example:god-mode")
    expect(operatorConfigProblems(invented).map((p) => p.detail).join(" ")).toMatch(/god-mode/)
    expect(roleOf("someone@tenure.example", invented)).toBeNull()
  })

  test("one address listed twice is refused rather than resolved", () => {
    // First-wins, last-wins and union are three different answers and nobody
    // decided between them.
    const ambiguous = env(
      "someone@tenure.example:support-engineer,someone@tenure.example:platform-super-admin",
    )
    expect(operatorConfigProblems(ambiguous).map((p) => p.detail).join(" ")).toMatch(/listed twice/)
  })

  test("isOperator is exactly `roleOf(...) !== null`, so no call site changed meaning", () => {
    expect(isOperator(address("auditor-read-only"), FLEET)).toBe(true)
    expect(isOperator("stranger@example.invalid", FLEET)).toBe(false)
    expect(isOperator(undefined, FLEET)).toBe(false)
    expect(isOperator("", FLEET)).toBe(false)
    // Case and whitespace, because a sign-in form is where both arrive.
    expect(isOperator("  AUDITOR-READ-ONLY@Tenure.Example ", FLEET)).toBe(true)
  })

  test("a usable fleet has no configuration problems at all", () => {
    // Every assertion above about a REFUSAL passes trivially if the parser
    // refuses everything.
    expect(operatorConfigProblems(FLEET)).toEqual([])
  })
})

test.describe("what the families may see and do", () => {
  const rolesHolding = (permission: OperatorPermission) =>
    OPERATOR_ROLES.filter((role) => mayAct(role, permission)).sort()

  test("only FinOps, the Auditor and the Super Admin may read what the fleet costs", () => {
    expect(rolesHolding("cost:read")).toEqual(
      ["auditor-read-only", "finops-analyst", "platform-super-admin"].sort(),
    )
    // Named individually too, because this is the separation the Cost page
    // depends on and a set comparison that drifts is easy to re-baseline.
    expect(mayView("cloud-platform-engineer", "cost")).toBe(false)
    expect(mayView("support-engineer", "cost")).toBe(false)
    expect(mayView("release-manager", "cost")).toBe(false)
  })

  test("only the Cloud Platform Engineer, the Emergency Responder and the Super Admin reach the AWS console", () => {
    expect(rolesHolding("aws.console:read")).toEqual(
      ["cloud-platform-engineer", "emergency-responder", "platform-super-admin"].sort(),
    )
    // And break-glass is narrower still: opening a console link and assuming an
    // emergency permission set are not the same act.
    expect(rolesHolding("aws.console:break-glass")).toEqual(["emergency-responder"])
  })

  test("the Auditor holds reads and nothing else", () => {
    const grants: readonly string[] = OPERATOR_GRANTS["auditor-read-only"]
    expect(grants.length).toBeGreaterThan(0)
    for (const grant of grants) expect(grant.endsWith(":read")).toBe(true)

    for (const resource of OPERATOR_RESOURCES) {
      for (const verb of ["write", "approve", "break-glass"] as const) {
        expect(
          mayAct("auditor-read-only", `${resource}:${verb}` as OperatorPermission),
          `an Auditor must not hold ${resource}:${verb}`,
        ).toBe(false)
      }
    }
  })

  test("an unknown role holds nothing", () => {
    for (const resource of OPERATOR_RESOURCES) {
      expect(mayView(null, resource)).toBe(false)
      expect(mayAct(null, `${resource}:write` as OperatorPermission)).toBe(false)
    }
  })
})

test.describe("authorizeOperator denies by default", () => {
  const ask = (
    over: Partial<Parameters<typeof authorizeOperator>[0]>,
    e: NodeJS.ProcessEnv = FLEET,
  ) =>
    authorizeOperator(
      {
        principalId: address("platform-super-admin"),
        resource: "tenant",
        action: "read",
        ...HERE,
        ...over,
      },
      e,
    )

  test("a request with no principal is NO_PRINCIPAL", () => {
    expect(ask({ principalId: null }).reason).toBe("NO_PRINCIPAL")
    expect(ask({ principalId: "   " }).allowed).toBe(false)
  })

  test("an address nobody listed is NO_ROLE", () => {
    const decision = ask({ principalId: "stranger@example.invalid" })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("NO_ROLE")
    expect(decision.role).toBeNull()
  })

  test("an allowlist that does not parse authorizes nobody", () => {
    // Including the addresses in it that ARE well formed. A console whose access
    // control is half-readable is a console with no access control.
    const broken = env(`${EVERY_ROLE},oops-no-role@tenure.example`)
    expect(ask({}, broken).reason).toBe("CONFIG_UNUSABLE")
  })

  test("an account this control plane did not resolve is refused", () => {
    const decision = ask({ accountId: "999988887777" })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("ACCOUNT_OUT_OF_SCOPE")
    // Even for the Super Admin: residency is not a permission somebody can hold.
    expect(decision.role).toBe("platform-super-admin")
  })

  test("a region this control plane did not resolve is refused", () => {
    expect(ask({ region: "ap-south-1" }).reason).toBe("REGION_OUT_OF_SCOPE")
  })

  test("a named account this process cannot corroborate is refused, not waved through", () => {
    // `controlPlaneIdentity` has no fallback literal — a `?? "us-east-1"` would
    // be an estate fact compiled into the product, and it would make "we could
    // not check" indistinguishable from "we checked and it matched". So a
    // process that cannot say where it is refuses a request that names a target.
    const nowhere = env(EVERY_ROLE, { AWS_ACCOUNT_ID: "", AWS_REGION: "" })
    expect(ask({}, nowhere).reason).toBe("ESTATE_UNRESOLVED")
    expect(ask({ accountId: null, region: "eu-west-2" }, nowhere).reason).toBe("ESTATE_UNRESOLVED")
  })

  test("a request that names no account or region is decided on the other axes", () => {
    // `null` is the caller stating there is no target, which is a different
    // thing from an optional field nobody set. The permission still decides.
    const nowhere = env(EVERY_ROLE, { AWS_ACCOUNT_ID: "", AWS_REGION: "" })
    const allowed = ask({ accountId: null, region: null }, nowhere)
    expect(allowed.allowed).toBe(true)
    expect(allowed.scope.accountId).toBeNull()

    const refused = ask(
      { accountId: null, region: null, principalId: address("auditor-read-only"), action: "write" },
      nowhere,
    )
    expect(refused.reason).toBe("PERMISSION_NOT_GRANTED")
  })

  test("an environment other than the running one is refused", () => {
    expect(ask({ environment: "production" }).reason).toBe("ENVIRONMENT_MISMATCH")
  })

  test("a tenant-scoped resource with no tenant is refused", () => {
    expect(
      ask({ resource: "tenant.configuration", action: "read", tenantId: null }).reason,
    ).toBe("TENANT_SCOPE_MISSING")
    // And is granted once the tenant is named, so the refusal above is about the
    // scope rather than about the permission.
    expect(ask({ resource: "tenant.configuration", action: "read", tenantId: "rochester" }).allowed).toBe(
      true,
    )
  })

  test("a permission the family does not hold is refused", () => {
    const decision = ask({
      principalId: address("auditor-read-only"),
      resource: "tenant",
      action: "write",
    })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("PERMISSION_NOT_GRANTED")
    expect(decision.role).toBe("auditor-read-only")
    expect(decision.permission).toBe("tenant:write")
  })

  test("a granted request carries the scope it was decided in", () => {
    const decision = ask({ resource: "tenant.lifecycle", action: "write", tenantId: "rochester" })
    expect(decision.allowed).toBe(true)
    expect(decision.reason).toBe("GRANTED")
    expect(decision.scope).toEqual({
      tenantId: "rochester",
      environment: ENVIRONMENT,
      accountId: ACCOUNT,
      region: REGION,
    })
  })

  test("every declared reason is one a real request can produce", () => {
    // A deny reason with no code path is what the platform architecture shipped
    // as MEMBERSHIP_SUSPENDED, and this is the assertion that stops a second.
    const produced = new Set<AuthorizationReason>([
      ask({}).reason,
      ask({ principalId: null }).reason,
      ask({ principalId: "stranger@example.invalid" }).reason,
      ask({}, env("oops@tenure.example")).reason,
      ask({}, env(EVERY_ROLE, { AWS_ACCOUNT_ID: "", AWS_REGION: "" })).reason,
      ask({ accountId: "999988887777" }).reason,
      ask({ region: "ap-south-1" }).reason,
      ask({ environment: "production" }).reason,
      ask({ resource: "tenant.lifecycle", action: "read", tenantId: null }).reason,
      ask({ principalId: address("auditor-read-only"), resource: "tenant", action: "write" }).reason,
    ])
    expect([...produced].sort()).toEqual([...AUTHORIZATION_REASONS].sort())
  })
})

test.describe("the commands this console runs", () => {
  const decide = (command: StudioCommand, role: OperatorRole, tenantId = "rochester") =>
    authorizeCommand(command, { principalId: address(role), tenantId }, FLEET)

  test("every command names a resource and a verb the model knows", () => {
    for (const [command, { resource, action }] of Object.entries(STUDIO_COMMANDS)) {
      expect(OPERATOR_RESOURCES as readonly string[], command).toContain(resource)
      expect(["read", "write", "approve", "break-glass"], command).toContain(action)
    }
  })

  test("an Auditor may read the fleet and may change nothing in it", () => {
    expect(decide("tenants.read", "auditor-read-only").allowed).toBe(true)
    expect(decide("configuration.read", "auditor-read-only").allowed).toBe(true)
    expect(decide("cost.read", "auditor-read-only").allowed).toBe(true)

    for (const command of [
      "tenants.compose",
      "tenants.adopt",
      "tenant.lifecycle.advance",
      "configuration.publish",
      "configuration.rollback",
    ] as const) {
      const decision = decide(command, "auditor-read-only")
      expect(decision.allowed, `an Auditor must not be allowed ${command}`).toBe(false)
      expect(decision.reason).toBe("PERMISSION_NOT_GRANTED")
    }
  })

  test("a Cloud Platform Engineer holds the mutating commands the Auditor does not", () => {
    // The foil. Without this the Auditor assertions above would pass against a
    // decision function that refuses everybody.
    expect(decide("tenants.compose", "cloud-platform-engineer").allowed).toBe(true)
    expect(decide("tenants.adopt", "cloud-platform-engineer").allowed).toBe(true)
    expect(decide("tenant.lifecycle.advance", "cloud-platform-engineer").allowed).toBe(true)
    expect(decide("aws.console.open", "cloud-platform-engineer").allowed).toBe(true)
    // And still may not read the bill, which is the other half of the split.
    expect(decide("cost.read", "cloud-platform-engineer").allowed).toBe(false)
  })

  test("a Support Engineer may review a configuration change and not publish it", () => {
    // `review` plans and writes nothing, so it is a read. `publish` and
    // `rollback` both commit, so both are writes — a rollback republishes
    // forward through the same path.
    expect(decide("configuration.review", "support-engineer").allowed).toBe(true)
    expect(decide("configuration.publish", "support-engineer").allowed).toBe(false)
    expect(decide("configuration.rollback", "support-engineer").allowed).toBe(false)
  })

  test("a FinOps Analyst reads the bill and cannot touch a tenant", () => {
    expect(decide("cost.read", "finops-analyst").allowed).toBe(true)
    expect(decide("tenants.compose", "finops-analyst").allowed).toBe(false)
    expect(decide("configuration.publish", "finops-analyst").allowed).toBe(false)
  })

  test("a command aimed at another region is refused however senior the caller", () => {
    const decision = authorizeCommand(
      "tenant.lifecycle.advance",
      {
        principalId: address("platform-super-admin"),
        tenantId: "rochester",
        region: "ap-south-1",
      },
      FLEET,
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("REGION_OUT_OF_SCOPE")
  })

  test("an omitted scope means this control plane's own, and it is stated on the decision", () => {
    const identity = controlPlaneIdentity(FLEET)
    expect(identity).toEqual({
      accountId: ACCOUNT,
      region: REGION,
      environment: ENVIRONMENT,
      // Not set in this fixture, and not defaulted to "aws" — the estate is
      // read, never assumed.
      partition: null,
    })
    // An unset deployment environment resolves to `production`, which is the
    // safe direction: an unlabelled deployment must not be treated as a sandbox.
    expect(controlPlaneIdentity({} as NodeJS.ProcessEnv).environment).toBe("production")
    expect(controlPlaneIdentity({} as NodeJS.ProcessEnv).region).toBeNull()
    const decision = authorizeCommand(
      "platform.read",
      { principalId: address("support-engineer") },
      FLEET,
    )
    expect(decision.scope.accountId).toBe(ACCOUNT)
    expect(decision.scope.region).toBe(REGION)
    expect(decision.scope.environment).toBe(ENVIRONMENT)
  })
})

test.describe("the policy revision a decision is stamped with", () => {
  test("is derived from the grant table, not written down", () => {
    // A constant here is the defect this platform has already shipped: a frozen
    // revision left a suite green while the policy underneath it changed.
    expect(policyRevisionOf(OPERATOR_GRANTS)).toBe(POLICY_REVISION)

    const changed = {
      ...(OPERATOR_GRANTS as Readonly<Record<string, readonly string[]>>),
      "auditor-read-only": ["platform:read", "tenant:write"],
    }
    expect(policyRevisionOf(changed)).not.toBe(POLICY_REVISION)
  })

  test("is what the production decision actually emits", () => {
    // Asserted on the value the decision carries, not on the helper: a test that
    // only calls `policyRevisionOf` stays green when the decision stops using it.
    const decision = authorizeCommand(
      "tenants.read",
      { principalId: address("finops-analyst") },
      FLEET,
    )
    expect(decision.policyRevision).toBe(policyRevisionOf(OPERATOR_GRANTS))
    expect(decision.policyRevision).toMatch(/^op-[0-9a-f]{8}$/)
  })
})

test.describe("the audit line every command writes", () => {
  test("carries actor, effective role, tenant, account, region, environment, policy and result", () => {
    const principalId = address("auditor-read-only")
    const decision = authorizeCommand(
      "configuration.publish",
      { principalId, tenantId: "rochester" },
      FLEET,
    )
    const line = decisionLine(principalId, "configuration.publish", decision)

    expect(line).toContain(`actor=${principalId}`)
    expect(line).toContain("role=auditor-read-only")
    expect(line).toContain("command=configuration.publish")
    expect(line).toContain("permission=tenant.configuration:write")
    expect(line).toContain("tenant=rochester")
    expect(line).toContain(`account=${ACCOUNT}`)
    expect(line).toContain(`region=${REGION}`)
    expect(line).toContain(`environment=${ENVIRONMENT}`)
    expect(line).toContain(`policy=${POLICY_REVISION}`)
    expect(line).toContain("result=deny")
    expect(line).toContain("reason=PERMISSION_NOT_GRANTED")
  })

  test("says allow when it was one", () => {
    const principalId = address("platform-super-admin")
    const decision = authorizeCommand(
      "configuration.publish",
      { principalId, tenantId: "rochester" },
      FLEET,
    )
    expect(decisionLine(principalId, "configuration.publish", decision)).toContain("result=allow")
  })
})

test.describe("the resource vocabulary", () => {
  test("every resource is reachable through at least one command", () => {
    // A resource nothing names is a permission nobody can be granted or refused
    // — the shape of an authorization model that looks complete and gates
    // nothing.
    const named = new Set<OperatorResource>(
      Object.values(STUDIO_COMMANDS).map((c) => c.resource as OperatorResource),
    )
    expect([...named].sort()).toEqual([...OPERATOR_RESOURCES].sort())
  })
})
