import { SHARED } from "@tenure/provisioning"

import { __resetIdentity } from "./identity"
import {
  MAX_PAGES,
  listenerCertificates,
  loadBalancerLines,
  loadBalancerReadings,
  type LoadBalancerReadings,
} from "./loadbalancer"
import type { AwsGateway } from "./read"

/**
 * STUDIO-070-004 (LOADBALANCER) — the front-door surface tells four different
 * truths apart, and degrades one sub-read at a time.
 *
 * The assertions are on `loadBalancerReadings`, `loadBalancerLines` and
 * `listenerCertificates` — the functions a route and the certificates reader
 * actually call — rather than on `readAws` or on any parser. A test that drove
 * `readAws` directly would stay green on the day this module stopped calling it,
 * which is precisely the failure this programme has already paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers seven capabilities with the shapes the real SDK returns —
 * `{LoadBalancers, NextMarker}`, `{Listeners, NextMarker}`,
 * `{TargetGroups, NextMarker}`, `{TargetHealthDescriptions}`,
 * `{Rules, NextMarker}`, `{ResourceTagMappingList}` and `{Account, Arn}` — and
 * it can fail each of them INDEPENDENTLY with `AccessDeniedException`, a
 * `ThrottlingException`, an empty-but-successful list, or a populated one. A
 * stand-in that returned `[]` regardless of what was asked would prove nothing
 * about code whose entire job is telling those four apart, and it is the fake
 * this repository has already been burnt by.
 *
 * ## Every identifier here is obviously constructed
 *
 * The account is `123456789012`, which is AWS's own documentation placeholder
 * and is not a real Tenure account. Every ARN, DNS name and certificate id below
 * is assembled from it. Nothing in this file is a real AWS resource, and nothing
 * asserts against one.
 */

/* ------------------------------------------------------------- the estate -- */

/** AWS's documentation placeholder account. Deliberately not a real one. */
const ACCOUNT = "123456789012"
const REGION = "eu-west-2"

const LB_ID = "0123456789abcdef"
const LB_NAME = "tenure-prod-alb"
const TG_NAME = "tenure-prod-tg"

const LB_ARN = `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:loadbalancer/app/${LB_NAME}/${LB_ID}`
const TG_ARN = `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:targetgroup/${TG_NAME}/${LB_ID}`
const HTTP_LISTENER_ARN = `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:listener/app/${LB_NAME}/${LB_ID}/aa00`
const HTTPS_LISTENER_ARN = `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:listener/app/${LB_NAME}/${LB_ID}/bb11`
const CERT_ARN = `arn:aws:acm:${REGION}:${ACCOUNT}:certificate/11111111-2222-3333-4444-555555555555`

/** The host shape ELB returns. A name in a fixture, never an endpoint anything dials. */
const DNS_NAME = `${LB_NAME}-1234567890.${REGION}.elb.amazonaws.com`

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface ListenerFixture {
  arn: string
  port: number
  protocol: string
  sslPolicy?: string
  certificates?: Array<{ CertificateArn?: string; IsDefault?: boolean }>
  defaultActions: Array<{
    Type?: string
    TargetGroupArn?: string
    RedirectConfig?: { Protocol?: string; Port?: string; StatusCode?: string }
  }>
}

interface TargetFixture {
  id: string
  port?: number
  state?: string
  reason?: string
  description?: string
}

interface FakeOptions {
  /** How `DescribeLoadBalancers` behaves. The four cases this suite exists to separate. */
  loadBalancers?: Outcome
  /** How many pages the load-balancer listing hands back. Each page carries a NextMarker. */
  loadBalancerPages?: number
  /**
   * What the listing reports for `Scheme`. `null` models AWS answering without
   * one, which is the case a default to "internal" would hide.
   */
  scheme?: string | null
  /** The listeners, and how the listener read behaves. */
  listeners?: Outcome
  listenerFixtures?: ListenerFixture[]
  /** The target groups, and how the target-group read behaves. */
  targetGroups?: Outcome
  /** Target health, independently failable — this is the sub-read that must degrade alone. */
  targetHealth?: Outcome
  targets?: TargetFixture[]
  /** Listener rules, independently failable — a denied rules read must NOT become a finding. */
  rules?: Outcome
  ruleRedirectsToHttps?: boolean
  /** Which ARNs the Tagging API reports, and with which tags. */
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  /** The partition and region baked into the fixture ARNs, for the residency case. */
  arns?: { loadBalancer: string; targetGroup: string; listener: string }
  /** Set by the fake so a test can assert what was and was not called. */
  calls?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

/** The estate's real listener: HTTP on 80, forwarding, no redirect. See alb.tf. */
function plaintextListener(): ListenerFixture {
  return {
    arn: HTTP_LISTENER_ARN,
    port: 80,
    protocol: "HTTP",
    defaultActions: [{ Type: "forward", TargetGroupArn: TG_ARN }],
  }
}

function httpsListener(): ListenerFixture {
  return {
    arn: HTTPS_LISTENER_ARN,
    port: 443,
    protocol: "HTTPS",
    sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
    certificates: [{ CertificateArn: CERT_ARN }],
    defaultActions: [{ Type: "forward", TargetGroupArn: TG_ARN }],
  }
}

function redirectingListener(): ListenerFixture {
  return {
    arn: HTTP_LISTENER_ARN,
    port: 80,
    protocol: "HTTP",
    defaultActions: [
      { Type: "redirect", RedirectConfig: { Protocol: "HTTPS", Port: "443", StatusCode: "HTTP_301" } },
    ],
  }
}

/**
 * A stand-in that behaves like the SDK: same response shapes, same error names,
 * same pagination marker, and independently failable per capability.
 */
function fakeAws(options: FakeOptions = {}): AwsGateway {
  const identity = options.identity ?? {
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: REGION,
  }
  const calls = options.calls ?? []
  const arns = options.arns ?? {
    loadBalancer: LB_ARN,
    targetGroup: TG_ARN,
    listener: HTTP_LISTENER_ARN,
  }
  const pages = options.loadBalancerPages ?? 1

  return {
    async call(capability, input) {
      calls.push(String(capability))
      const marker = String((input as { Marker?: unknown } | undefined)?.Marker ?? "")

      switch (capability) {
        case "sts:GetCallerIdentity":
          if (identity === "denied") throwing("AccessDenied")
          return { Account: identity.account, Arn: identity.arn, UserId: "AROA:studio" }

        case "tag:GetResources": {
          const outcome = options.tagsOutcome ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { ResourceTagMappingList: [] }
          return {
            ResourceTagMappingList: Object.entries(options.tags ?? {}).map(([arn, Tags]) => ({
              ResourceARN: arn,
              Tags,
            })),
          }
        }

        case "elasticloadbalancing:DescribeLoadBalancers": {
          const outcome = options.loadBalancers ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          // The real API returns an empty ARRAY here rather than omitting the
          // key, which is a different shape from SQS's ListQueues — and the
          // reason the fake models each API's own answer rather than one shape.
          if (outcome === "empty") return { LoadBalancers: [] }

          const page = marker === "" ? 0 : Number(marker)
          const isLast = page >= pages - 1
          return {
            LoadBalancers: [
              {
                // Every page carries a distinct load balancer, so a reader that
                // stopped after page one would return fewer than it should.
                LoadBalancerArn: page === 0 ? arns.loadBalancer : `${arns.loadBalancer}-p${page}`,
                LoadBalancerName: page === 0 ? LB_NAME : `${LB_NAME}-p${page}`,
                DNSName: DNS_NAME,
                Scheme: options.scheme === undefined ? "internet-facing" : (options.scheme ?? undefined),
                VpcId: "vpc-0aa11bb22cc33dd44",
                Type: "application",
                CreatedTime: "2026-07-01T00:00:00.000Z",
                State: { Code: "active" },
                AvailabilityZones: [
                  { ZoneName: `${REGION}a`, SubnetId: "subnet-0aa11bb22cc33dd44" },
                  { ZoneName: `${REGION}b`, SubnetId: "subnet-0aa11bb22cc33dd55" },
                ],
                SecurityGroups: ["sg-0aa11bb22cc33dd44"],
                IpAddressType: "ipv4",
              },
            ],
            NextMarker: isLast ? undefined : String(page + 1),
          }
        }

        case "elasticloadbalancing:DescribeListeners": {
          const outcome = options.listeners ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { Listeners: [] }
          const fixtures = options.listenerFixtures ?? [plaintextListener()]
          return {
            Listeners: fixtures.map((l) => ({
              ListenerArn: l.arn,
              LoadBalancerArn: String(
                (input as { LoadBalancerArn?: unknown } | undefined)?.LoadBalancerArn ?? "",
              ),
              Port: l.port,
              Protocol: l.protocol,
              SslPolicy: l.sslPolicy,
              Certificates: l.certificates,
              DefaultActions: l.defaultActions,
            })),
          }
        }

        case "elasticloadbalancing:DescribeTargetGroups": {
          const outcome = options.targetGroups ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { TargetGroups: [] }
          return {
            TargetGroups: [
              {
                TargetGroupArn: arns.targetGroup,
                TargetGroupName: TG_NAME,
                Protocol: "HTTP",
                Port: 3000,
                VpcId: "vpc-0aa11bb22cc33dd44",
                TargetType: "ip",
                ProtocolVersion: "HTTP1",
                LoadBalancerArns: [arns.loadBalancer],
                HealthCheckEnabled: true,
                HealthCheckProtocol: "HTTP",
                HealthCheckPort: "traffic-port",
                HealthCheckPath: "/api/health",
                HealthCheckIntervalSeconds: 30,
                HealthCheckTimeoutSeconds: 5,
                HealthyThresholdCount: 2,
                UnhealthyThresholdCount: 3,
                Matcher: { HttpCode: "200" },
              },
            ],
          }
        }

        case "elasticloadbalancing:DescribeTargetHealth": {
          const outcome = options.targetHealth ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          // The real API returns an empty array for a group with nothing
          // registered. That is a genuine answer, not a failure.
          if (outcome === "empty") return { TargetHealthDescriptions: [] }
          const targets = options.targets ?? [
            { id: "10.0.1.10", port: 3000, state: "healthy" },
            { id: "10.0.2.11", port: 3000, state: "healthy" },
          ]
          return {
            TargetHealthDescriptions: targets.map((t) => ({
              Target: { Id: t.id, Port: t.port, AvailabilityZone: `${REGION}a` },
              HealthCheckPort: "3000",
              TargetHealth: {
                State: t.state,
                Reason: t.reason,
                Description: t.description,
              },
            })),
          }
        }

        case "elasticloadbalancing:DescribeRules": {
          const outcome = options.rules ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { Rules: [] }
          return {
            Rules: [
              {
                RuleArn: `${arns.listener}/rule/9999`,
                Priority: "default",
                IsDefault: true,
                Actions: options.ruleRedirectsToHttps
                  ? [
                      {
                        Type: "redirect",
                        RedirectConfig: { Protocol: "HTTPS", Port: "443", StatusCode: "HTTP_301" },
                      },
                    ]
                  : [{ Type: "forward", TargetGroupArn: arns.targetGroup }],
              },
            ],
          }
        }

        default:
          throw new Error(
            `the stand-in was asked for ${String(capability)}, which this suite does not exercise`,
          )
      }
    },
    async resolvedRegion() {
      return identity === "denied" ? REGION : identity.region
    },
  }
}

const AT = () => new Date("2026-08-13T09:15:00.000Z")

async function load(options: FakeOptions = {}): Promise<LoadBalancerReadings> {
  return loadBalancerReadings(fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: LoadBalancerReadings): string {
  return loadBalancerLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* -------------------------------------------- the four outcomes, compared -- */

describe("the load balancer surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names the load balancer, its listener and its targets", async () => {
    const readings = await load({ listenerFixtures: [httpsListener()] })
    expect(readings.loadBalancers.state).toBe("ACTUAL")
    if (readings.loadBalancers.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.loadBalancers.value).toHaveLength(1)

    const text = surfaceText(readings)
    expect(text).toContain(LB_NAME)
    expect(text).toContain("internet-facing")
    expect(text).toContain("2 target(s) healthy and being served")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ loadBalancers: "empty" })
    expect(readings.loadBalancers.state).toBe("EMPTY")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ loadBalancers: "denied" })
    expect(readings.loadBalancers.state).toBe("DENIED")
    if (readings.loadBalancers.state !== "DENIED") throw new Error("narrowing")

    expect(readings.loadBalancers.action).toBe("elasticloadbalancing:DescribeLoadBalancers")
    expect(readings.loadBalancers.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.loadBalancers.accountId).toBe(ACCOUNT)
    expect(readings.loadBalancers.region).toBe(REGION)
    expect(readings.loadBalancers.partition).toBe("aws")
    expect(JSON.parse(readings.loadBalancers.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["elasticloadbalancing:DescribeLoadBalancers"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so a
    // caller cannot reach an empty array; the render says "unknown".
    expect("value" in readings.loadBalancers).toBe(false)
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toMatch(/\bnone\b/)
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ loadBalancers: "throttled" })
    expect(readings.loadBalancers.state).toBe("THROTTLED")
    if (readings.loadBalancers.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.loadBalancers.retryAfterMs).toBe(800)
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ loadBalancers: outcome })))
    }
    // Pairwise distinct. A fake that returned [] regardless would collapse at
    // least two of these into one string, and this is the assertion that
    // notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------ target health is the liveness -- */

describe("target health is the liveness signal, and its reason code is load-bearing", () => {
  test("an unhealthy target carries its reason CODE and its description", async () => {
    const readings = await load({
      targets: [
        { id: "10.0.1.10", port: 3000, state: "healthy" },
        {
          id: "10.0.2.11",
          port: 3000,
          state: "unhealthy",
          reason: "Target.ResponseCodeMismatch",
          description: "Health checks failed with these codes: [503]",
        },
      ],
    })

    const text = surfaceText(readings)
    expect(text).toContain("Target.ResponseCodeMismatch")
    expect(text).toContain("Health checks failed with these codes: [503]")
    expect(text).toContain("DEGRADED")

    const finding = readings.findings.find((f) => f.kind === "targets-not-serving")
    expect(finding).toBeDefined()
    if (finding?.kind !== "targets-not-serving") throw new Error("narrowing")
    expect(finding.healthy).toBe(1)
    expect(finding.notServing).toEqual([
      {
        targetId: "10.0.2.11",
        port: 3000,
        state: "unhealthy",
        reasonCode: "Target.ResponseCodeMismatch",
        description: "Health checks failed with these codes: [503]",
      },
    ])
  })

  test("ResponseCodeMismatch and Timeout are two different sentences, not one 'unhealthy'", async () => {
    const mismatch = surfaceText(
      await load({
        targets: [
          {
            id: "10.0.1.10",
            state: "unhealthy",
            reason: "Target.ResponseCodeMismatch",
            description: "Health checks failed with these codes: [503]",
          },
        ],
      }),
    )
    __resetIdentity()
    const timeout = surfaceText(
      await load({
        targets: [
          {
            id: "10.0.1.10",
            state: "unhealthy",
            reason: "Target.Timeout",
            description: "Request timed out",
          },
        ],
      }),
    )

    expect(mismatch).not.toBe(timeout)
    expect(mismatch).toContain("Target.ResponseCodeMismatch")
    expect(timeout).toContain("Target.Timeout")
    expect(timeout).not.toContain("ResponseCodeMismatch")
  })

  test("every target draining is NOTHING SERVED, not a row that reads like a deploy", async () => {
    const readings = await load({
      targets: [
        {
          id: "10.0.1.10",
          state: "draining",
          reason: "Target.DeregistrationInProgress",
          description: "Target deregistration is in progress",
        },
        {
          id: "10.0.2.11",
          state: "draining",
          reason: "Target.DeregistrationInProgress",
          description: "Target deregistration is in progress",
        },
      ],
    })
    expect(readings.findings.some((f) => f.kind === "none-serving")).toBe(true)
    expect(surfaceText(readings)).toContain("NOTHING SERVED")
  })

  test("a target with no reason code says so, and does not print an empty code", async () => {
    const readings = await load({
      targets: [{ id: "10.0.1.10", state: "unhealthy" }],
    })
    const text = surfaceText(readings)
    expect(text).toContain("no reason code")

    const lbs = readings.loadBalancers
    if (lbs.state !== "ACTUAL") throw new Error("narrowing")
    const groups = lbs.value[0].targetGroups
    if (groups.state !== "ACTUAL") throw new Error("narrowing")
    const health = groups.value[0].health
    if (health.state !== "ACTUAL") throw new Error("narrowing")
    const state = health.value[0].health
    if (state.kind !== "not-serving") throw new Error("narrowing")
    // The arm carries NO `code` field, so a surface cannot print an empty one.
    expect(state.reason.known).toBe(false)
    expect("code" in state.reason).toBe(false)
  })

  test("no registered targets is its own state, not 'nothing unhealthy'", async () => {
    const readings = await load({ targetHealth: "empty" })
    const lbs = readings.loadBalancers
    if (lbs.state !== "ACTUAL") throw new Error("narrowing")
    const groups = lbs.value[0].targetGroups
    if (groups.state !== "ACTUAL") throw new Error("narrowing")
    expect(groups.value[0].health.state).toBe("EMPTY")
    expect(groups.value[0].serving.kind).toBe("no-targets")

    expect(readings.findings.some((f) => f.kind === "no-targets")).toBe(true)
    const text = surfaceText(readings)
    expect(text).toContain("NO REGISTERED TARGETS")
    expect(text).not.toContain("healthy and being served")
  })
})

/* --------------------------------------- one denied detail degrades alone -- */

describe("a sub-call that fails degrades on its own", () => {
  test("a denied DescribeTargetHealth does not collapse the row and does not read as healthy", async () => {
    const readings = await load({ targetHealth: "denied" })

    // The row survives, and the listeners beside it are untouched.
    expect(readings.loadBalancers.state).toBe("ACTUAL")
    const lbs = readings.loadBalancers
    if (lbs.state !== "ACTUAL") throw new Error("narrowing")
    expect(lbs.value[0].listeners.state).toBe("ACTUAL")
    const groups = lbs.value[0].targetGroups
    if (groups.state !== "ACTUAL") throw new Error("narrowing")

    const health = groups.value[0].health
    expect(health.state).toBe("DENIED")
    if (health.state !== "DENIED") throw new Error("narrowing")
    // The minimum statement names the action that is ACTUALLY missing, not the
    // one at the top of the call tree.
    expect(health.action).toBe("elasticloadbalancing:DescribeTargetHealth")
    expect("value" in health).toBe(false)

    expect(groups.value[0].serving.kind).toBe("unknown")
    expect(readings.findings.some((f) => f.kind === "health-unreadable")).toBe(true)

    const text = surfaceText(readings)
    expect(text).toContain("serving unknown")
    expect(text).toContain("elasticloadbalancing:DescribeTargetHealth")
    // The reassuring defaults it must never render as.
    expect(text).not.toContain("healthy and being served")
    expect(text).not.toContain("0 target(s)")
  })

  test("a denied DescribeListeners leaves the target groups readable, and vice versa", async () => {
    const listenersDenied = await load({ listeners: "denied" })
    const lbsA = listenersDenied.loadBalancers
    if (lbsA.state !== "ACTUAL") throw new Error("narrowing")
    expect(lbsA.value[0].listeners.state).toBe("DENIED")
    expect(lbsA.value[0].targetGroups.state).toBe("ACTUAL")
    expect(listenersDenied.findings.some((f) => f.kind === "listeners-unreadable")).toBe(true)
    // A refused listener read must not manufacture the plaintext finding either.
    expect(listenersDenied.findings.some((f) => f.kind === "plaintext-listener")).toBe(false)

    __resetIdentity()
    const groupsDenied = await load({ targetGroups: "denied" })
    const lbsB = groupsDenied.loadBalancers
    if (lbsB.state !== "ACTUAL") throw new Error("narrowing")
    expect(lbsB.value[0].listeners.state).toBe("ACTUAL")
    expect(lbsB.value[0].targetGroups.state).toBe("DENIED")
    expect(groupsDenied.findings.some((f) => f.kind === "target-groups-unreadable")).toBe(true)

    expect(surfaceText(listenersDenied)).not.toBe(surfaceText(groupsDenied))
  })
})

/* --------------------------------------------- plaintext listener finding -- */

describe("an HTTP listener with no redirect to HTTPS is a finding", () => {
  test("the estate's own listener — HTTP:80 forwarding, no rule redirect — is the finding", async () => {
    const readings = await load({ listenerFixtures: [plaintextListener()], rules: "populated" })

    const finding = readings.findings.find((f) => f.kind === "plaintext-listener")
    expect(finding).toBeDefined()
    if (finding?.kind !== "plaintext-listener") throw new Error("narrowing")
    expect(finding.listenerArn).toBe(HTTP_LISTENER_ARN)
    expect(finding.port).toBe(80)
    expect(finding.scheme.kind).toBe("internet-facing")

    expect(surfaceText(readings)).toContain("PLAINTEXT LISTENER")
  })

  test("a redirect in the DEFAULT ACTION is not a finding, and spends no rules call", async () => {
    const calls: string[] = []
    const readings = await loadBalancerReadings(
      fakeAws({ listenerFixtures: [redirectingListener()], calls }),
      { now: AT },
    )
    expect(readings.findings.some((f) => f.kind === "plaintext-listener")).toBe(false)
    expect(calls).not.toContain("elasticloadbalancing:DescribeRules")
    expect(surfaceText(readings)).toContain("redirecting to HTTPS via its default-action")
  })

  test("a redirect in a RULE is not a finding either", async () => {
    const readings = await load({
      listenerFixtures: [plaintextListener()],
      rules: "populated",
      ruleRedirectsToHttps: true,
    })
    expect(readings.findings.some((f) => f.kind === "plaintext-listener")).toBe(false)
    expect(surfaceText(readings)).toContain("redirecting to HTTPS via its rule")
  })

  test("a DENIED rules read is 'redirect unknown', NEVER the finding — an unverified claim is not made", async () => {
    const readings = await load({ listenerFixtures: [plaintextListener()], rules: "denied" })

    expect(readings.findings.some((f) => f.kind === "plaintext-listener")).toBe(false)
    const finding = readings.findings.find((f) => f.kind === "redirect-unknown")
    expect(finding).toBeDefined()

    const text = surfaceText(readings)
    expect(text).toContain("redirect unknown")
    expect(text).toContain("elasticloadbalancing:DescribeRules")
    expect(text).not.toContain("PLAINTEXT LISTENER")
  })

  test("an HTTPS listener is not a finding and reports its certificate ARN and policy", async () => {
    const readings = await load({ listenerFixtures: [httpsListener()] })
    expect(readings.findings.some((f) => f.kind === "plaintext-listener")).toBe(false)
    const text = surfaceText(readings)
    expect(text).toContain(CERT_ARN)
    expect(text).toContain("ELBSecurityPolicy-TLS13-1-2-2021-06")
  })
})

/* ------------------------------------------------- the scheme is not guessed -- */

describe("an unstated scheme is unknown, never defaulted to the safe-sounding answer", () => {
  test("AWS answering without a Scheme reports scheme unknown, not 'internal'", async () => {
    const readings = await load({ scheme: null })
    const lbs = readings.loadBalancers
    if (lbs.state !== "ACTUAL") throw new Error("narrowing")
    const scheme = lbs.value[0].scheme
    expect(scheme.kind).toBe("unstated")
    if (scheme.kind !== "unstated") throw new Error("narrowing")
    expect(scheme.raw).toBeNull()

    const text = surfaceText(readings)
    expect(text).toContain("scheme unknown")
    // The reassuring guess. An internet-facing load balancer reported as
    // "internal" is how a plaintext listener gets triaged as harmless.
    expect(text).not.toContain("— internal,")
  })

  test("a Scheme AWS invented tomorrow is unstated and carries the raw value", async () => {
    const readings = await load({ scheme: "edge-optimised" })
    const lbs = readings.loadBalancers
    if (lbs.state !== "ACTUAL") throw new Error("narrowing")
    const scheme = lbs.value[0].scheme
    expect(scheme.kind).toBe("unstated")
    if (scheme.kind !== "unstated") throw new Error("narrowing")
    expect(scheme.raw).toBe("edge-optimised")
    expect(surfaceText(readings)).toContain("edge-optimised")
  })

  test("internet-facing and internal are two different sentences", async () => {
    const facing = surfaceText(await load({ scheme: "internet-facing" }))
    __resetIdentity()
    const internal = surfaceText(await load({ scheme: "internal" }))
    __resetIdentity()
    const unstated = surfaceText(await load({ scheme: null }))
    expect(new Set([facing, internal, unstated]).size).toBe(3)
  })
})

/* ----------------------------------------------- certificates, for joining -- */

describe("the certificate join the certificates reader needs", () => {
  test("listenerCertificates pairs a certificate ARN with the live listener serving it", async () => {
    const readings = await load({ listenerFixtures: [httpsListener(), plaintextListener()] })
    const certificates = listenerCertificates(readings)
    expect(certificates).toHaveLength(1)
    expect(certificates[0]).toEqual({
      certificateArn: CERT_ARN,
      listenerArn: HTTPS_LISTENER_ARN,
      loadBalancerArn: LB_ARN,
      loadBalancerName: LB_NAME,
      port: 443,
      protocol: "HTTPS",
      // AWS omits IsDefault on the certificate DescribeListeners returns, and
      // this engine carries the silence rather than inventing a boolean.
      isDefault: null,
    })
  })

  test("a denied listener read contributes no certificates, and the finding says why", async () => {
    const readings = await load({ listeners: "denied" })
    expect(listenerCertificates(readings)).toHaveLength(0)
    // Which is exactly why an empty list here must not be read as "no TLS".
    expect(readings.findings.some((f) => f.kind === "listeners-unreadable")).toBe(true)
  })
})

/* ------------------------------------------------------------- pagination -- */

describe("the reader pages to completion, with a bound that is not silent", () => {
  test("three pages are all walked — a reader that stopped at page one would return one", async () => {
    const readings = await load({ loadBalancerPages: 3 })
    expect(readings.loadBalancers.state).toBe("ACTUAL")
    if (readings.loadBalancers.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.loadBalancers.value).toHaveLength(3)
    expect(readings.truncation.kind).toBe("complete")
    expect(readings.findings.some((f) => f.kind === "listing-truncated")).toBe(false)
  })

  test("hitting the page bound returns an explicit 'there were more', not a partial list rendered whole", async () => {
    const readings = await load({ loadBalancerPages: MAX_PAGES + 5 })
    expect(readings.truncation.kind).toBe("truncated")
    if (readings.truncation.kind !== "truncated") throw new Error("narrowing")
    expect(readings.truncation.capability).toBe("elasticloadbalancing:DescribeLoadBalancers")
    expect(readings.truncation.pagesRead).toBe(MAX_PAGES)

    const finding = readings.findings.find((f) => f.kind === "listing-truncated")
    expect(finding).toBeDefined()
    expect(surfaceText(readings)).toContain("TRUNCATED")
  })
})

/* --------------------------------------------------- residency and identity -- */

describe("region and partition come from the resolved identity, never a literal", () => {
  test("a GovCloud ARN reports aws-us-gov and its own region, not aws/us-east-1", async () => {
    const govRegion = "us-gov-west-1"
    const govLb = `arn:aws-us-gov:elasticloadbalancing:${govRegion}:${ACCOUNT}:loadbalancer/app/${LB_NAME}/${LB_ID}`
    const readings = await loadBalancerReadings(
      fakeAws({
        arns: {
          loadBalancer: govLb,
          targetGroup: `arn:aws-us-gov:elasticloadbalancing:${govRegion}:${ACCOUNT}:targetgroup/${TG_NAME}/${LB_ID}`,
          listener: `${govLb}/aa00`,
        },
        identity: {
          arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
          account: ACCOUNT,
          region: govRegion,
        },
      }),
      { now: AT },
    )

    const lbs = readings.loadBalancers
    if (lbs.state !== "ACTUAL") throw new Error("narrowing")
    expect(lbs.value[0].partition).toBe("aws-us-gov")
    expect(lbs.value[0].region).toBe(govRegion)
    expect(lbs.value[0].accountId).toBe(ACCOUNT)

    const text = surfaceText(readings)
    expect(text).toContain("aws-us-gov")
    expect(text).not.toContain("us-east-1")
  })
})

/* ----------------------------------------------------------- attribution -- */

describe("attribution comes from a tag, and 'we could not look' is its own answer", () => {
  test("a tenant tag attributes; a shared sentinel is shared; an untagged resource is unattributable", async () => {
    const tenant = await load({
      tags: { [LB_ARN]: [{ Key: "tenure:tenant", Value: "acme-university" }] },
    })
    const lbsA = tenant.loadBalancers
    if (lbsA.state !== "ACTUAL") throw new Error("narrowing")
    expect(lbsA.value[0].attribution).toEqual({ kind: "tenant", tenantSlug: "acme-university" })

    __resetIdentity()
    const shared = await load({ tags: { [LB_ARN]: [{ Key: "tenure:tenant", Value: SHARED }] } })
    const lbsB = shared.loadBalancers
    if (lbsB.state !== "ACTUAL") throw new Error("narrowing")
    expect(lbsB.value[0].attribution).toEqual({ kind: "shared" })

    __resetIdentity()
    const untagged = await load({ tags: {} })
    const lbsC = untagged.loadBalancers
    if (lbsC.state !== "ACTUAL") throw new Error("narrowing")
    expect(lbsC.value[0].attribution).toEqual({ kind: "unattributed" })
  })

  test("a denied tag index is 'attribution unknown', not 'unattributable'", async () => {
    const readings = await load({ tagsOutcome: "denied" })
    const lbs = readings.loadBalancers
    if (lbs.state !== "ACTUAL") throw new Error("narrowing")
    expect(lbs.value[0].attribution.kind).toBe("unknown")

    const text = surfaceText(readings)
    expect(text).toContain("attribution unknown")
    // The sentence that would send an operator to add a tag that is already there.
    expect(text).not.toContain("unattributable — missing tenure:tenant")
  })
})

/* --------------------------------------------------- cadence and as-of --- */

describe("every reading carries an as-of and its capability's own cadence", () => {
  test("the surface states when it was read and how often it refreshes", async () => {
    const readings = await load()
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
    // Read off the registry, not retyped: load balancers every 180s, target
    // health every 10s, which is the whole reason they are separate readings.
    expect(readings.refreshMs.loadBalancers).toBe(180_000)
    expect(readings.refreshMs.targetHealth).toBe(10_000)

    const text = surfaceText(readings)
    expect(text).toContain("2026-08-13T09:15:00.000Z")
    expect(text).toContain("refreshed every 180s")
    expect(text).toContain("target health every 10s")
  })
})
