import fs from "node:fs"
import path from "node:path"

import {
  ALL_CAPABILITIES,
  CAPABILITIES,
  minimumStatement,
  type Capability,
} from "./capabilities"
import * as capabilityModule from "./capabilities"
import { readAws, type AwsGateway } from "./read"

/**
 * STUDIO-070-004 — the registry's own properties, asserted rather than reviewed.
 *
 * Three claims are made about `capabilities.ts` and `client.ts` in their
 * headers, and a claim in a header is a claim nobody re-checks:
 *
 *   1. Every capability names the IAM actions it needs. A capability with an
 *      empty `iamActions` still renders a DENIED panel — with an undefined
 *      action and a `{"Action":[]}` statement an operator can paste into a
 *      policy and change nothing.
 *   2. Every cadence is an argument about a resource, so no two capabilities
 *      share one by accident. Sharing IS allowed — three ECS reads genuinely
 *      move on one deployment — but only through the SAME named constant, and
 *      only with the sharers written down HERE. A number typed at the call site
 *      is the accident this catches, and so is a second constant quietly
 *      collecting readers it was not named for.
 *   3. `call()` reaches AWS only through the closed union. There must be no
 *      service/action/parameter path, so the console's whole reach is
 *      `Object.keys(CAPABILITIES)` and a reviewer can enumerate it.
 *
 * Two of the three are proven against the SOURCE as well as against the module,
 * because the property is about what is written, not only about what evaluates:
 * a `refreshMs: 60_000` typed inline and a `refreshMs: INVENTORY_REFRESH_MS`
 * are the same number and a different decision.
 */

const HERE = __dirname

/** Source with line endings normalised, so a CRLF checkout parses identically. */
function source(file: string): string {
  return fs.readFileSync(path.join(HERE, file), "utf8").replace(/\r\n/g, "\n")
}

const CAPABILITIES_SRC = source("capabilities.ts")
const CLIENT_SRC = source("client.ts")

/* ------------------------------------------------------------ IAM actions -- */

describe("every capability names the IAM actions it needs", () => {
  test("the registry is non-empty and its key list matches the object", () => {
    // A survey that finds nothing reports no violations. This is the assertion
    // that makes the rest of the file mean something.
    expect(ALL_CAPABILITIES.length).toBeGreaterThan(20)
    expect([...ALL_CAPABILITIES].sort()).toEqual(Object.keys(CAPABILITIES).sort())
  })

  test.each([...ALL_CAPABILITIES])("%s names at least one IAM action", (capability) => {
    const spec = CAPABILITIES[capability]
    expect(spec.iamActions.length).toBeGreaterThan(0)
    for (const action of spec.iamActions) {
      expect(action).toMatch(/^[a-z0-9-]+:[A-Za-z0-9]+$/)
    }
  })

  test.each([...ALL_CAPABILITIES])("%s names an action in its own service", (capability) => {
    // `budgets:DescribeBudgets` is granted by `budgets:ViewBudget` — the verbs
    // differ legitimately, the SERVICE may not. An action in another service's
    // namespace is a typo that grants nothing and denies quietly.
    const service = capability.slice(0, capability.indexOf(":"))
    const services = CAPABILITIES[capability].iamActions.map((a) => a.slice(0, a.indexOf(":")))
    expect(services).toContain(service)
  })

  test.each([...ALL_CAPABILITIES])("%s states the resource its actions need", (capability) => {
    const { resource } = CAPABILITIES[capability]
    expect(typeof resource).toBe("string")
    expect(resource.length).toBeGreaterThan(0)
    // "*" is written out where the API has no resource-level scoping. Anything
    // else must be an ARN pattern, and must not compile a partition in: this
    // engine refuses to invent an estate, and a policy is not the exception.
    if (resource !== "*") {
      expect(resource.startsWith("arn:")).toBe(true)
      expect(resource.startsWith("arn:aws:")).toBe(false)
    }
  })

  test.each([...ALL_CAPABILITIES])("%s names no action that could change anything", (capability) => {
    // A write capability in a read-only console is the defect this exists to
    // stop, and it would arrive as one plausible line in a diff of eighty.
    // Both halves are checked: the KEY, because that is what a caller writes,
    // and the ACTIONS, because that is what the IAM grant will carry.
    for (const name of [capability, ...CAPABILITIES[capability].iamActions]) {
      expect(name).not.toMatch(/Create|Put|Delete|Update|Terminate|Send|Invoke/)
      // The stronger form: the verb must be one of the ones that only read.
      // `View` is here for `budgets:ViewBudget` and `Filter` for
      // `logs:FilterLogEvents` — two reads AWS did not spell as reads.
      expect(name.slice(name.indexOf(":") + 1)).toMatch(
        /^(List|Describe|Get|BatchGet|Lookup|Filter|Search|Select|Query|Scan|View)/,
      )
    }
  })

  test("no command this file can dispatch is a write", () => {
    // One level below the registry: every `…Command` identifier that appears
    // in client.ts, imported or constructed. A capability could be spelled as
    // a read and dispatch `PutBucketPolicyCommand`, and the switch is the last
    // place that would be noticed.
    // Comments stripped first: client.ts states, in prose, that
    // `SendEmailCommand` and `GetSecretValueCommand` are deliberately NOT
    // imported. Naming the command you refuse to hold is the clearest way to
    // write that rule down, and it must not trip the rule.
    const dispatchable = CLIENT_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    const commands = [...new Set([...dispatchable.matchAll(/\b([A-Za-z0-9_]+Command)\b/g)].map((m) => m[1]))]
    expect(commands.length).toBeGreaterThan(40)
    for (const command of commands) {
      expect(command).not.toMatch(/Create|Put|Delete|Update|Terminate|Send|Invoke/)
      expect(command).toMatch(/^(List|Describe|Get|BatchGet|Lookup|Filter|Search|Select|Query|Scan|View)/)
    }
  })

  test("only two actions need the task-role guard's not-spelled-as-a-read exemption", () => {
    // The regex here is `READ_VERB` from
    // `tests/security/studio-task-role-is-narrow.test.mjs`, copied verbatim.
    // That guard refuses any granted action whose verb is not one of these,
    // and exempts named ones through its READS_NOT_SPELLED_AS_READS set.
    //
    // So this case answers, from THIS side, the question the sibling writing
    // the IAM grant has to ask: which of these actions will that guard refuse?
    // Exactly two. `budgets:ViewBudget` is already exempt there;
    // `logs:FilterLogEvents` is the one this registry adds, and it needs the
    // same one-line exemption or the platform suite reds when the grant lands.
    const roleGuardReadVerb = /^[a-z0-9-]+:(List|Describe|Get|BatchGet|Search|Lookup|Select|Query|Scan)/
    const refused = ALL_CAPABILITIES.flatMap((c) => [...CAPABILITIES[c].iamActions]).filter(
      (action) => !roleGuardReadVerb.test(action),
    )
    expect([...new Set(refused)].sort()).toEqual(["budgets:ViewBudget", "logs:FilterLogEvents"])
  })

  test("the minimum statement a denial prints is pasteable for every capability", () => {
    for (const capability of ALL_CAPABILITIES) {
      const statement = minimumStatement(capability)
      expect(statement.Effect).toBe("Allow")
      expect(statement.Action.length).toBeGreaterThan(0)
      expect(statement.Resource.length).toBeGreaterThan(0)
      // It is JSON an operator pastes, so it has to survive a round trip.
      expect(JSON.parse(JSON.stringify(statement))).toEqual(statement)
    }
  })
})

/* --------------------------------------------------------------- cadences -- */

/**
 * The cadence constants more than one capability may use, and exactly which.
 *
 * Every entry is an argument that the listed reads move together. Two ECS reads
 * cannot disagree about when a deployment happened. An IAM role and its access
 * keys change when the same human runs the same Terraform.
 *
 * Adding a capability to one of these lists is a line in a file called
 * `capabilities.test.ts`; reusing a constant WITHOUT adding it here fails, which
 * is the difference between deciding to share a cadence and inheriting one.
 */
const DELIBERATELY_SHARED: Readonly<Record<string, readonly Capability[]>> = {
  /**
   * One deployment moves the cluster list, the service list, the counts, the
   * task list and every task's status. `ecs:DescribeTaskDefinition` is NOT
   * here: a revision is immutable, so it has a cadence of its own.
   */
  ECS_TTL_MS: [
    "ecs:ListClusters",
    "ecs:ListServices",
    "ecs:DescribeServices",
    "ecs:DescribeClusters",
    "ecs:ListTasks",
    "ecs:DescribeTasks",
  ],
  /** A certificate's summary and its detail renew on the same 60-day horizon. */
  ACM_TTL_MS: ["acm:ListCertificates", "acm:DescribeCertificate"],
  /**
   * The operator pool's configuration, all of it written by one Terraform
   * apply. `cognito-idp:ListUsers` is deliberately absent: membership changes
   * when a person joins or leaves, which is a different clock.
   */
  COGNITO_POOL_TTL_MS: [
    "cognito-idp:ListUserPools",
    "cognito-idp:DescribeUserPool",
    "cognito-idp:ListUserPoolClients",
    "cognito-idp:DescribeUserPoolClient",
    "cognito-idp:DescribeUserPoolDomain",
    "cognito-idp:GetUserPoolMfaConfig",
  ],
  /** The shape of the network. One apply moves all six together. */
  NETWORK_TOPOLOGY_TTL_MS: [
    "ec2:DescribeVpcs",
    "ec2:DescribeSubnets",
    "ec2:DescribeRouteTables",
    "ec2:DescribeInternetGateways",
    "ec2:DescribeNatGateways",
    "ec2:DescribeVpcEndpoints",
  ],
  /** The RULES on that network — faster, because this is where an estate opens. */
  SECURITY_GROUP_TTL_MS: ["ec2:DescribeSecurityGroups", "ec2:DescribeNetworkAcls"],
  /** The front door's shape. Target HEALTH is separate and much faster. */
  LOAD_BALANCER_TTL_MS: [
    "elasticloadbalancing:DescribeLoadBalancers",
    "elasticloadbalancing:DescribeListeners",
    "elasticloadbalancing:DescribeTargetGroups",
    "elasticloadbalancing:DescribeRules",
  ],
  /** A repository and its expiry rules are one Terraform declaration. */
  ECR_REPO_TTL_MS: ["ecr:DescribeRepositories", "ecr:GetLifecyclePolicy"],
  /** Cluster and replication-group status are the same cache, asked two ways. */
  ELASTICACHE_TTL_MS: [
    "elasticache:DescribeCacheClusters",
    "elasticache:DescribeReplicationGroups",
  ],
  /** The registry table's control-plane facts all move on one apply. */
  DYNAMODB_TABLE_TTL_MS: [
    "dynamodb:ListTables",
    "dynamodb:DescribeTable",
    "dynamodb:DescribeContinuousBackups",
    "dynamodb:DescribeTimeToLive",
  ],
  /** A dashboard's existence and its widgets are one document. */
  DASHBOARD_TTL_MS: ["cloudwatch:ListDashboards", "cloudwatch:GetDashboard"],
  /** Seven bucket-level posture reads, all set by the same Terraform apply. */
  S3_POSTURE_TTL_MS: [
    "s3:GetBucketPublicAccessBlock",
    "s3:GetBucketEncryption",
    "s3:GetBucketVersioning",
    "s3:GetBucketLifecycleConfiguration",
    "s3:GetBucketPolicyStatus",
    "s3:GetBucketTagging",
    "s3:GetBucketCors",
  ],
  /** A key's state and its rotation setting are one key, described twice. */
  KMS_KEY_TTL_MS: ["kms:DescribeKey", "kms:GetKeyRotationStatus"],
  /** The analyzer and its findings are one evaluation, on the analyzer's clock. */
  ACCESS_ANALYZER_TTL_MS: ["access-analyzer:ListAnalyzers", "access-analyzer:ListFindingsV2"],
  /** Finding ids and finding bodies are one page of the same list. */
  GUARDDUTY_FINDINGS_TTL_MS: ["guardduty:ListFindings", "guardduty:GetFindings"],
  /** Both price reads change when AWS publishes a price change, and not before. */
  PRICING_TTL_MS: ["pricing:ListPriceLists", "pricing:GetProducts"],
  /** Which web ACLs exist and which one is attached: one WAF configuration. */
  WAF_TTL_MS: ["wafv2:ListWebACLs", "wafv2:GetWebACLForResource"],
  /** A quota list and one quota's value are the same AWS-side grant. */
  QUOTA_TTL_MS: ["servicequotas:ListServiceQuotas", "servicequotas:GetServiceQuota"],
  /**
   * Storage that outlives its tenant: instances, their snapshots, the log
   * groups left behind, the recovery points and the object versions. All of it
   * changes on a maintenance window or a retention job, none of it per request.
   */
  RDS_TTL_MS: [
    "rds:DescribeDBInstances",
    "rds:DescribeDBSnapshots",
    "logs:DescribeLogGroups",
    "backup:ListRecoveryPointsByBackupVault",
    "s3:ListObjectVersions",
  ],
  /** Configuration, not telemetry: it changes when somebody changes it. */
  POSTURE_REFRESH_MS: [
    "cloudtrail:DescribeTrails",
    "config:DescribeConfigurationAggregators",
    "cur:DescribeReportDefinitions",
    "backup:ListBackupVaults",
    "kms:ListKeys",
    "route53:ListHostedZones",
  ],
  /**
   * The organization, its accounts, its unit hierarchy and the policies attached
   * to that hierarchy are one structure read five ways. They move together
   * because they move for one reason: somebody vends, moves or closes an
   * account, which changes the account list and the unit an account sits under
   * in the same act. Reading the units on a faster clock than the accounts would
   * produce a page that shows a unit an account has already left.
   */
  ORGANIZATION_REFRESH_MS: [
    "organizations:DescribeOrganization",
    "organizations:ListAccounts",
    "organizations:ListRoots",
    "organizations:ListOrganizationalUnitsForParent",
    "organizations:ListPoliciesForTarget",
  ],
  /** Both answer "does this reference still name something", and gate a run. */
  SECRET_REF_REFRESH_MS: ["secretsmanager:DescribeSecret", "ssm:DescribeParameters"],
  /** SES provisioning-time configuration: it changes when Terraform runs. */
  SES_CONFIG_TTL_MS: [
    "ses:ListEmailIdentities",
    "ses:ListConfigurationSets",
    "ses:GetConfigurationSet",
  ],
  /** A function's shape and its reserved concurrency both change on deploy. */
  LAMBDA_TTL_MS: ["lambda:ListFunctions", "lambda:GetFunctionConcurrency"],
  /** Roles, policies and keys are all changed by the same human, rarely. */
  IAM_POSTURE_TTL_MS: ["iam:GetAccountAuthorizationDetails", "iam:ListAccessKeys"],
  /** An event and the entities it affects are one incident read twice. */
  AWS_HEALTH_TTL_MS: ["health:DescribeEvents", "health:DescribeAffectedEntities"],
  /** A rule and its targets are the same job description. */
  EVENTBRIDGE_TTL_MS: ["events:ListRules", "events:ListTargetsByRule"],
}

/** `EXPORTED_NAME` for every `export const …_MS` the registry declares. */
function declaredCadenceNames(): string[] {
  return [...CAPABILITIES_SRC.matchAll(/export const ([A-Z][A-Z0-9_]*_MS)\s*=/g)].map((m) => m[1])
}

/**
 * capability → the identifier written after `refreshMs:`, from the source.
 *
 * `undefined` where the value is not a bare identifier, which is exactly the
 * case the first assertion below fails on.
 */
function cadenceIdentifiers(): Map<Capability, string | undefined> {
  const found = new Map<Capability, string | undefined>()
  for (const capability of ALL_CAPABILITIES) {
    const at = CAPABILITIES_SRC.indexOf(`"${capability}": {`)
    expect(at).toBeGreaterThan(-1)
    const body = CAPABILITIES_SRC.slice(at, CAPABILITIES_SRC.indexOf("\n  },", at))
    const written = /refreshMs:\s*([^,\n]+),/.exec(body)?.[1]?.trim()
    found.set(capability, written && /^[A-Za-z_][A-Za-z0-9_]*$/.test(written) ? written : undefined)
  }
  return found
}

describe("no two capabilities share a cadence by accident", () => {
  test("every cadence is a named constant, never a number typed at the entry", () => {
    const offenders = [...cadenceIdentifiers()]
      .filter(([, identifier]) => identifier === undefined)
      .map(([capability]) => capability)

    expect(offenders).toEqual([])
  })

  test("the identifier each entry names resolves to the value the entry carries", () => {
    // Ties the source parse to the module. Without this the rest of these
    // assertions are about text that might not be the text that runs.
    const exported = capabilityModule as unknown as Record<string, unknown>
    for (const [capability, identifier] of cadenceIdentifiers()) {
      expect(identifier).toBeDefined()
      expect(exported[identifier as string]).toBe(CAPABILITIES[capability].refreshMs)
    }
  })

  test("every cadence is a positive whole number of milliseconds", () => {
    const exported = capabilityModule as unknown as Record<string, unknown>
    for (const name of declaredCadenceNames()) {
      const value = exported[name]
      expect(typeof value).toBe("number")
      expect(Number.isInteger(value as number)).toBe(true)
      expect(value as number).toBeGreaterThan(0)
    }
  })

  test("a cadence used by more than one capability is one this file declares shared", () => {
    const users = new Map<string, Capability[]>()
    for (const [capability, identifier] of cadenceIdentifiers()) {
      const list = users.get(identifier as string) ?? []
      list.push(capability)
      users.set(identifier as string, list)
    }

    const undeclared: string[] = []
    const wrongMembers: string[] = []

    for (const [identifier, sharers] of users) {
      if (sharers.length === 1) {
        // A constant declared as shared but used once is a stale argument.
        if (identifier in DELIBERATELY_SHARED) {
          wrongMembers.push(`${identifier} is declared shared but only ${sharers[0]} uses it`)
        }
        continue
      }
      const declared = DELIBERATELY_SHARED[identifier]
      if (!declared) {
        undeclared.push(`${identifier} — used by ${sharers.sort().join(", ")}`)
        continue
      }
      // Not "is a subset": the exact set, so a capability that quietly joins an
      // existing cadence fails until somebody writes down why it belongs.
      expect([...sharers].sort()).toEqual([...declared].sort())
    }

    expect(undeclared).toEqual([])
    expect(wrongMembers).toEqual([])
  })

  test("every declared cadence constant is used by a capability", () => {
    const used = new Set([...cadenceIdentifiers().values()])
    const unused = declaredCadenceNames().filter((name) => !used.has(name))
    expect(unused).toEqual([])
  })

  test("the shared-cadence declaration only names capabilities that exist", () => {
    const known = new Set<string>(ALL_CAPABILITIES)
    for (const [identifier, sharers] of Object.entries(DELIBERATELY_SHARED)) {
      for (const capability of sharers) {
        expect(known.has(capability)).toBe(true)
      }
      expect(declaredCadenceNames()).toContain(identifier)
    }
  })
})

/* ------------------------------------------------------------------ call() -- */

/** `case "…":` labels inside client.ts's `call()` switch. */
function switchArms(): string[] {
  return [...CLIENT_SRC.matchAll(/case\s+"([^"]+)":/g)].map((m) => m[1])
}

/* -------------------------------------------- capability → its own client -- */

/**
 * The IAM service each client variable in `client.ts` authorizes against.
 *
 * The mapping is not derivable from the names, and that is exactly why it is
 * worth asserting: the SDK package is `client-cognito-identity-provider`, the
 * client is `CognitoIdentityProviderClient`, the variable is `cognito` and the
 * IAM prefix is `cognito-idp`. Four spellings for one service, and a policy
 * carrying any of the other three grants nothing and denies quietly — which on
 * a login page reads as an outage rather than as a typo.
 *
 * `elasticloadbalancing`, `access-analyzer`, `servicequotas` and `tag` are the
 * same trap.
 *
 * The two ends this ties together are the capability's declared `iamActions`
 * and the client its switch arm actually dispatches to. A capability keyed
 * `ec2:DescribeVpcs` whose arm sends through the ELB client would grant the
 * wrong action and call the wrong API, and both halves would look right in
 * isolation.
 */
const CLIENT_SERVICE: Readonly<Record<string, string>> = {
  stsClient: "sts",
  organizations: "organizations",
  tagging: "tag",
  ecs: "ecs",
  rds: "rds",
  cloudfront: "cloudfront",
  acm: "acm",
  cloudwatch: "cloudwatch",
  securityhub: "securityhub",
  cloudtrail: "cloudtrail",
  secretsManager: "secretsmanager",
  ssm: "ssm",
  configService: "config",
  costExplorer: "ce",
  cur: "cur",
  logs: "logs",
  backup: "backup",
  kms: "kms",
  route53: "route53",
  s3: "s3",
  sesv2: "ses",
  sqs: "sqs",
  lambda: "lambda",
  iam: "iam",
  budgets: "budgets",
  awsHealth: "health",
  eventbridge: "events",
  cognito: "cognito-idp",
  ec2: "ec2",
  elbv2: "elasticloadbalancing",
  ecr: "ecr",
  elasticache: "elasticache",
  dynamodb: "dynamodb",
  servicequotas: "servicequotas",
  accessAnalyzer: "access-analyzer",
  guardduty: "guardduty",
  pricing: "pricing",
  // Two clients for one service: a CLOUDFRONT-scoped web ACL is only served
  // from the partition's global endpoint. Same IAM prefix, different region.
  wafv2: "wafv2",
  wafv2Global: "wafv2",
}

/** capability → every client variable its arm calls `.send()` on. */
function dispatchClients(): Map<Capability, string[]> {
  const labels = [...CLIENT_SRC.matchAll(/case\s+"([^"]+)":/g)]
  const found = new Map<Capability, string[]>()
  labels.forEach((label, index) => {
    const start = label.index ?? 0
    const end = index + 1 < labels.length ? (labels[index + 1].index ?? CLIENT_SRC.length) : CLIENT_SRC.length
    const body = CLIENT_SRC.slice(start, end)
    // `x.send(` and `xClient().send(` both, so the STS accessor is not a
    // special case that quietly escapes the rule.
    const receivers = [...body.matchAll(/\b([A-Za-z0-9_]+)(?:\(\))?\.send\(/g)].map((m) => m[1])
    found.set(label[1] as Capability, [...new Set(receivers)])
  })
  return found
}

/** `let name: XClient | null = null` — every client slot the module declares. */
function declaredClientSlots(): string[] {
  return [...CLIENT_SRC.matchAll(/^let\s+([A-Za-z0-9_]+):\s*[A-Za-z0-9_]+\s*\|\s*null\s*=\s*null$/gm)].map(
    (m) => m[1],
  )
}

describe("every capability dispatches to a client in its own service", () => {
  test("the mapping this file asserts against covers every client the module holds", () => {
    // Otherwise the cheapest way to pass the next case is to add a client and
    // not add it here, and the rule stops covering the thing that was added.
    const slots = declaredClientSlots()
    expect(slots.length).toBeGreaterThan(20)
    for (const slot of slots) {
      const named = slot in CLIENT_SERVICE || `${slot}Client` in CLIENT_SERVICE
      expect(named).toBe(true)
      // And the slot is really a client, not a cache of something else.
      expect(CLIENT_SRC).toMatch(new RegExp(`${slot}\\s*=\\s*new\\s+[A-Za-z0-9_]+Client\\(`))
    }
  })

  test("every entry in the mapping is used by at least one arm", () => {
    const used = new Set([...dispatchClients().values()].flat())
    const stale = Object.keys(CLIENT_SERVICE).filter((name) => !used.has(name))
    expect(stale).toEqual([])
  })

  test.each([...ALL_CAPABILITIES])("%s sends through its own service's client", (capability) => {
    const receivers = dispatchClients().get(capability)
    expect(receivers).toBeDefined()
    expect((receivers ?? []).length).toBeGreaterThan(0)

    const service = capability.slice(0, capability.indexOf(":"))
    for (const receiver of receivers ?? []) {
      expect(CLIENT_SERVICE[receiver]).toBeDefined()
      expect(CLIENT_SERVICE[receiver]).toBe(service)
    }
    // And the actions the capability declares are in that same service, so the
    // grant the sibling Terraform writes matches the API that is called.
    for (const action of CAPABILITIES[capability].iamActions) {
      expect(action.slice(0, action.indexOf(":"))).toBe(CLIENT_SERVICE[(receivers ?? [])[0]])
    }
  })
})

describe("call() cannot be reached with an unknown capability", () => {
  test("the switch has exactly one arm per capability, and no arm without one", () => {
    const arms = switchArms()
    expect(arms.length).toBeGreaterThan(20)
    // Both directions. Missing arm: a declared capability that returns
    // `undefined` from a call the surface believes it made. Extra arm: a reach
    // into AWS that `Object.keys(CAPABILITIES)` does not disclose.
    expect([...arms].sort()).toEqual([...ALL_CAPABILITIES].sort())
    expect(new Set(arms).size).toBe(arms.length)
  })

  test("the seam's signature takes a Capability, not a service and an action", () => {
    expect(CLIENT_SRC).toMatch(/async call\(capability: Capability, input: Record<string, unknown>/)
    // Whole-word: `input.services` is the ECS DescribeServices argument and is
    // fine; `input.service` would be half of a service/action endpoint.
    expect(CLIENT_SRC).not.toMatch(/\binput\.(service|action|command)(?![A-Za-z0-9_])/i)
  })

  test("no arm builds a command from data", () => {
    // The whole property in one assertion: a constructor chosen at runtime, or
    // a command looked up in a table, is the arbitrary-command endpoint wearing
    // a switch statement. Comments are stripped first so prose about the rule
    // does not trip the rule.
    const code = CLIENT_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    for (const forbidden of [
      /\bnew\s+[A-Za-z0-9_$]*\[/, //   new Commands[…]
      /\bnew\s*\(/, //                 new (…)()
      /\beval\s*\(/,
      /\bnew\s+Function\s*\(/,
      /capability\s*\.\s*split/,
      /globalThis\s*\[/,
    ]) {
      expect(code).not.toMatch(forbidden)
    }
  })

  test("the seam's type refuses an arbitrary service:action at compile time", () => {
    // This case runs green under jest either way — the load-bearing half is the
    // `@ts-expect-error`, which `npm run studio:type-check` fails on if the
    // union ever widens to `string`. `AwsGateway` is declared in read.ts, which
    // holds no SDK import, so naming the type here costs no credential path.
    const probe: AwsGateway = {
      async call() {
        throw new Error("the probe never dispatches; it exists to be type-checked")
      },
      async resolvedRegion() {
        return "resolved-by-the-sdk"
      },
    }
    // @ts-expect-error — the capability union is closed; an arbitrary AWS action is not a member.
    expect(() => probe.call("ec2:TerminateInstances")).toBeDefined()
  })

  test("an unknown capability has no entry to fall back on", () => {
    // There is no default arm and no permissive lookup: asking about something
    // that is not in the union throws rather than producing a statement.
    expect(() => minimumStatement("ec2:TerminateInstances" as Capability)).toThrow()
    expect(CAPABILITIES["ec2:TerminateInstances" as Capability]).toBeUndefined()
  })
})

/* ------------------------------------------- the seven services' failures -- */

/**
 * The read that is refused for a reason no IAM statement fixes.
 *
 * AWS Health is only callable on Business or Enterprise Support. The stand-in
 * below returns four genuinely different outcomes — a populated list, an
 * empty-but-successful list, AccessDenied, and SubscriptionRequiredException —
 * and the assertion is that the surface says something different for each. A
 * fake that could only fail one way would prove nothing about the mapping.
 */
describe("health:DescribeEvents distinguishes its four outcomes", () => {
  const failing = (name: string) => async () => {
    const error = new Error(`${name} raised by the stand-in`)
    error.name = name
    throw error
  }

  test("a populated response is ACTUAL", async () => {
    const read = await readAws("health:DescribeEvents", async () => ({
      events: [{ arn: "arn:aws:health:global::event/EC2/AWS_EC2_OPERATIONAL_ISSUE/1" }],
    }))
    expect(read.state).toBe("ACTUAL")
  })

  test("an empty-but-successful response is EMPTY, not an error", async () => {
    const read = await readAws("health:DescribeEvents", async () => [])
    expect(read.state).toBe("EMPTY")
  })

  test("AccessDenied is DENIED and names the action and the statement", async () => {
    const read = await readAws("health:DescribeEvents", failing("AccessDeniedException"))
    expect(read.state).toBe("DENIED")
    if (read.state !== "DENIED") throw new Error("narrowing")
    expect(read.action).toBe("health:DescribeEvents")
    expect(read.minimumStatement).toContain("health:DescribeEvents")
  })

  test("SubscriptionRequiredException is UNCONFIGURED and names the support plan", async () => {
    // Not DENIED: no policy edit fixes it, and printing a pasteable IAM
    // statement would send an operator to change a policy that is correct.
    // Not EMPTY: "we cannot ask whether AWS is having an incident" is not
    // "AWS is not having an incident".
    const read = await readAws("health:DescribeEvents", failing("SubscriptionRequiredException"))
    expect(read.state).toBe("UNCONFIGURED")
    if (read.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(read.why).toMatch(/Business/)
    expect(read.why).not.toMatch(/Action/)
  })

  test("a throttle is still THROTTLED, not swallowed by the new branch", async () => {
    const read = await readAws("health:DescribeEvents", failing("ThrottlingException"), {
      attempts: 2,
      backoffMs: 1,
      sleep: async () => undefined,
    })
    expect(read.state).toBe("THROTTLED")
  })
})
