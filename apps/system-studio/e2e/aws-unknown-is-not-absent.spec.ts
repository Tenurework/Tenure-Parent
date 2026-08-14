import fs from "fs"
import path from "path"

import { test, expect } from "@playwright/test"

import { ALARM_WORDS, alarmSurface, verdictFor } from "../src/lib/aws/alarms"
import { consoleCaveat, consoleLink, linkablePartitions } from "../src/lib/aws/console-link"
import { minimumStatementText, type Capability } from "../src/lib/aws/capabilities"
import { compareDesiredToActual, driftIgnore, IgnoreWithoutExpiry } from "../src/lib/aws/drift"
import { securityFindings } from "../src/lib/aws/findings"
import { identityHeadline, partitionOf, resolveIdentity } from "../src/lib/aws/identity"
import { estateInventory, estateLines } from "../src/lib/aws/inventory"
import { describeOrganization } from "../src/lib/aws/organization"
import { centralizationPosture, managementAccountVerdict } from "../src/lib/aws/posture"
import { retainedObservation, retainedReadingsForTenant } from "../src/lib/aws/retained"
import { reconcileTopology } from "../src/lib/aws/topology"
import type { AwsGateway, AwsRead } from "../src/lib/aws/read"

/**
 * STUDIO-140-007 — read-only ACTUAL state is provably different from
 * access-denied, missing, stale and error, on every AWS surface the Studio has.
 *
 * This item IS the proof, so the test is the deliverable. Three rules govern how
 * it is written, and each of them is a lesson from a suite that stayed green
 * through a real outage:
 *
 *   1. **It drives the PRODUCTION function, not the helper.** Every case below
 *      calls the same exported entry point the page calls — `estateInventory`,
 *      `alarmSurface`, `securityFindings`, `centralizationPosture` — with a
 *      stand-in gateway substituted at the `client.ts` seam. A suite that
 *      exercised `readAws` directly would stay green the day a surface stopped
 *      calling it.
 *   2. **The stand-in behaves like the real client.** It throws errors whose
 *      `name` is the modelled AWS error shape, returns the SDK's own response
 *      field names, and counts its calls. A stand-in that returned a canned
 *      value regardless of the capability asked for would prove nothing.
 *   3. **Different states must render DIFFERENT text.** Not "denied is
 *      truthy" — the actual strings, asserted distinct, because the defect this
 *      exists to prevent is two states that render identically.
 */

/* ------------------------------------------------------------- stand-ins -- */

/** An error shaped the way the AWS SDK shapes one: the `name` carries the code. */
function awsError(name: string): Error {
  const error = new Error(`${name}: simulated by the stand-in gateway`)
  error.name = name
  return error
}

interface StandIn extends AwsGateway {
  /** How many times each capability was asked for. Asserted, not decorative. */
  calls: Map<Capability, number>
}

/**
 * A gateway that answers per capability.
 *
 * Anything not named answers `{}` — an empty-but-successful response — so a case
 * that means to test ECS does not accidentally test an unhandled RDS throw.
 */
function standIn(
  answers: Partial<Record<Capability, () => unknown>>,
  region = "eu-west-2",
): StandIn {
  const calls = new Map<Capability, number>()
  return {
    calls,
    async call(capability, _input) {
      calls.set(capability, (calls.get(capability) ?? 0) + 1)
      const answer = answers[capability]
      if (!answer) return {}
      return answer()
    },
    async resolvedRegion() {
      return region
    },
  }
}

const NOW = () => new Date("2026-08-08T09:00:00.000Z")

/** A commercial-partition identity that every non-identity case can lean on. */
const COMMERCIAL_IDENTITY = () => ({
  Account: "123456789012",
  Arn: "arn:aws:sts::123456789012:assumed-role/tenure-studio-ecs-task/abc",
  UserId: "AROAEXAMPLE:abc",
})

/* =========================================================== 1. identity == */

test.describe("identity is resolved, never assumed", () => {
  test("a GovCloud role renders its own partition and region, not aws/us-east-1", async () => {
    const gw = standIn(
      {
        "sts:GetCallerIdentity": () => ({
          Account: "987654321098",
          Arn: "arn:aws-us-gov:sts::987654321098:assumed-role/tenure-studio/task",
        }),
      },
      "us-gov-west-1",
    )

    const identity = await resolveIdentity(gw, { now: NOW })
    expect(identity.state).toBe("ACTUAL")

    const headline = identityHeadline(identity)
    // The whole GE-010-007 residency class, in one assertion: a partition that
    // is derived rather than defaulted.
    expect(headline).toContain("partition aws-us-gov")
    expect(headline).toContain("us-gov-west-1")
    expect(headline).not.toContain("partition aws ")
    expect(headline).not.toContain("us-east-1")
  })

  test("a denied GetCallerIdentity renders unknown with the statement, not a blank header", async () => {
    const gw = standIn({
      "sts:GetCallerIdentity": () => {
        throw awsError("AccessDeniedException")
      },
    })

    const identity = await resolveIdentity(gw, { now: NOW })
    expect(identity.state).toBe("DENIED")

    const headline = identityHeadline(identity)
    expect(headline).toContain("unknown")
    expect(headline).toContain("sts:GetCallerIdentity")
    expect(headline).toContain(minimumStatementText("sts:GetCallerIdentity"))
    // Not a default, and not empty.
    expect(headline).not.toContain("us-east-1")
    expect(headline.trim().length).toBeGreaterThan(40)
  })

  test("a throttled GetCallerIdentity renders a distinct retrying state", async () => {
    const gw = standIn({
      "sts:GetCallerIdentity": () => {
        throw awsError("ThrottlingException")
      },
    })

    const identity = await resolveIdentity(gw, { now: NOW })
    expect(identity.state).toBe("THROTTLED")

    const headline = identityHeadline(identity)
    expect(headline).toContain("rate-limited")
    // Distinct from the denied wording: an operator must not read a wait as a
    // permissions problem and go editing IAM.
    expect(headline).not.toContain("Minimum statement")
  })

  test("all three identity outcomes render different text", async () => {
    const gov = identityHeadline(
      await resolveIdentity(
        standIn(
          {
            "sts:GetCallerIdentity": () => ({
              Account: "987654321098",
              Arn: "arn:aws-us-gov:sts::987654321098:assumed-role/x/y",
            }),
          },
          "us-gov-west-1",
        ),
        { now: NOW },
      ),
    )
    const denied = identityHeadline(
      await resolveIdentity(
        standIn({
          "sts:GetCallerIdentity": () => {
            throw awsError("AccessDenied")
          },
        }),
        { now: NOW },
      ),
    )
    const throttled = identityHeadline(
      await resolveIdentity(
        standIn({
          "sts:GetCallerIdentity": () => {
            throw awsError("TooManyRequestsException")
          },
        }),
        { now: NOW },
      ),
    )

    expect(new Set([gov, denied, throttled]).size).toBe(3)
  })

  test("the partition comes from the ARN, and a non-ARN gets null rather than a guess", () => {
    expect(partitionOf("arn:aws-cn:ecs:cn-north-1:123456789012:service/x")).toBe("aws-cn")
    expect(partitionOf("arn:aws-us-gov:s3:::bucket/key/a/b")).toBe("aws-us-gov")
    expect(partitionOf("not-an-arn")).toBeNull()
  })
})

/* ========================================================== 2. inventory == */

/** One populated ECS answer set, shaped the way the real SDK shapes it. */
function populatedEcs() {
  return {
    "ecs:ListClusters": () => ({
      clusterArns: ["arn:aws:ecs:eu-west-2:123456789012:cluster/tenure"],
    }),
    "ecs:ListServices": () => ({
      serviceArns: ["arn:aws:ecs:eu-west-2:123456789012:service/tenure/web"],
    }),
    "ecs:DescribeServices": () => ({
      services: [
        {
          serviceArn: "arn:aws:ecs:eu-west-2:123456789012:service/tenure/web",
          serviceName: "web",
          status: "ACTIVE",
          clusterArn: "arn:aws:ecs:eu-west-2:123456789012:cluster/tenure",
          desiredCount: 2,
          runningCount: 2,
          loadBalancers: [
            { targetGroupArn: "arn:aws:elasticloadbalancing:eu-west-2:123456789012:targetgroup/web/1" },
          ],
        },
      ],
    }),
  }
}

async function ecsLine(answers: Partial<Record<Capability, () => unknown>>): Promise<string> {
  const gw = standIn({ "sts:GetCallerIdentity": COMMERCIAL_IDENTITY, ...answers })
  const readings = await estateInventory(gw, { now: NOW })
  const line = estateLines(readings).find((l) => l.surface === "ECS services")
  if (!line) throw new Error("the estate page no longer renders an ECS services line")
  return line.text
}

test.describe("a denied estate read is never an empty list", () => {
  test("AccessDenied, Throttling, empty-but-successful and populated render four different strings", async () => {
    const denied = await ecsLine({
      "ecs:ListClusters": () => {
        throw awsError("AccessDeniedException")
      },
    })
    const throttled = await ecsLine({
      "ecs:ListClusters": () => {
        throw awsError("ThrottlingException")
      },
    })
    const empty = await ecsLine({ "ecs:ListClusters": () => ({ clusterArns: [] }) })
    const populated = await ecsLine(populatedEcs())

    // The assertion the whole item exists for.
    expect(new Set([denied, throttled, empty, populated]).size).toBe(4)

    // And the specific words, because "four different strings" would also be
    // satisfied by four timestamps.
    expect(denied).toContain("unknown")
    expect(denied).toContain("ecs:DescribeServices")
    expect(denied).toContain("AccessDeniedException")
    expect(denied).toContain('"Effect":"Allow"')
    expect(denied).not.toContain("none —")

    expect(empty).toContain("none")
    expect(empty).not.toContain("unknown")
    expect(empty).not.toContain("Effect")

    expect(throttled).toContain("throttled")
    expect(populated).toContain("as of")
  })

  test("a denied tag read is not silently treated as an untagged estate", async () => {
    const gw = standIn({
      "sts:GetCallerIdentity": COMMERCIAL_IDENTITY,
      "tag:GetResources": () => {
        throw awsError("AccessDeniedException")
      },
      ...populatedEcs(),
    })
    const readings = await estateInventory(gw, { now: NOW })

    expect(readings.tagged.state).toBe("DENIED")
    if (readings.tagged.state !== "DENIED") throw new Error("unreachable")
    expect(readings.tagged.action).toBe("tag:GetResources")
    expect(readings.tagged.minimumStatement).toContain("tag:GetResources")
    // The principal on the denial is the one identity resolved, not a placeholder.
    expect(readings.tagged.principal).toContain("assumed-role/tenure-studio-ecs-task")
  })

  test("the stand-in is actually reached — a surface that made no call proves nothing", async () => {
    const gw = standIn({ "sts:GetCallerIdentity": COMMERCIAL_IDENTITY, ...populatedEcs() })
    await estateInventory(gw, { now: NOW })

    expect(gw.calls.get("sts:GetCallerIdentity")).toBe(1)
    expect(gw.calls.get("tag:GetResources")).toBe(1)
    expect(gw.calls.get("ecs:ListClusters")).toBe(1)
    expect(gw.calls.get("rds:DescribeDBInstances")).toBe(1)
    expect(gw.calls.get("cloudfront:ListDistributions")).toBe(1)
    expect(gw.calls.get("acm:ListCertificates")).toBe(1)
  })
})

/* ========================================================== 2b. retained == */

test.describe("retained tenant resources are live AWS reads, not registry prose", () => {
  test("maps tagged snapshots, log groups and recovery points into residual classes", async () => {
    const snapshotArn = "arn:aws:rds:eu-west-2:123456789012:snapshot:acme-archive"
    const logArn = "arn:aws:logs:eu-west-2:123456789012:log-group:/tenure/acme"
    const dbArn = "arn:aws:rds:eu-west-2:123456789012:db:acme"
    const gw = standIn({
      "sts:GetCallerIdentity": COMMERCIAL_IDENTITY,
      "tag:GetResources": () => ({
        ResourceTagMappingList: [
          {
            ResourceARN: snapshotArn,
            Tags: [{ Key: "tenure:tenant", Value: "acme" }],
          },
          {
            ResourceARN: logArn,
            Tags: [{ Key: "tenure:tenant", Value: "acme" }],
          },
          {
            ResourceARN: dbArn,
            Tags: [{ Key: "tenure:tenant", Value: "acme" }],
          },
        ],
      }),
      "rds:DescribeDBSnapshots": () => ({
        DBSnapshots: [
          {
            DBSnapshotArn: snapshotArn,
            DBSnapshotIdentifier: "acme-archive",
            Status: "available",
            AllocatedStorage: 5,
          },
        ],
      }),
      "logs:DescribeLogGroups": () => ({
        logGroups: [{ arn: logArn, logGroupName: "/tenure/acme", storedBytes: 2048 }],
      }),
      "backup:ListBackupVaults": () => ({
        BackupVaultList: [{ BackupVaultName: "tenant-recovery" }],
      }),
      "backup:ListRecoveryPointsByBackupVault": () => ({
        RecoveryPoints: [
          {
            RecoveryPointArn: "arn:aws:backup:eu-west-2:123456789012:recovery-point:rp-1",
            ResourceArn: dbArn,
            Status: "COMPLETED",
            BackupSizeInBytes: 4096,
          },
        ],
      }),
    })

    const observed = retainedObservation(await retainedReadingsForTenant("acme", gw, { now: NOW }))
    expect(observed.classes).toEqual(expect.arrayContaining(["snapshot", "audit-evidence", "database"]))
    expect(observed.sources.join("\n")).toContain("rds-snapshot acme-archive")
    expect(observed.sources.join("\n")).toContain("log-group /tenure/acme")
    expect(observed.sources.join("\n")).toContain("backup-recovery-point")
    expect(observed.unknown).toEqual([])
  })

  test("keeps denied retained reads unknown rather than treating them as no residual cost", async () => {
    const gw = standIn({
      "sts:GetCallerIdentity": COMMERCIAL_IDENTITY,
      "tag:GetResources": () => ({ ResourceTagMappingList: [] }),
      "rds:DescribeDBSnapshots": () => {
        throw awsError("AccessDeniedException")
      },
      "logs:DescribeLogGroups": () => ({ logGroups: [] }),
      "backup:ListBackupVaults": () => ({ BackupVaultList: [] }),
    })

    const observed = retainedObservation(await retainedReadingsForTenant("acme", gw, { now: NOW }))
    expect(observed.classes).toEqual([])
    expect(observed.unknown.join("\n")).toContain("AccessDeniedException")
    expect(observed.unknown.join("\n")).toContain("rds:DescribeDBSnapshots")
    expect(observed.unknown.join("\n")).not.toContain("none")
  })

  test("a denied vault list names ListBackupVaults, not the action it never reached", async () => {
    // Two capabilities, two IAM actions, and a role is routinely granted one
    // without the other. A denial quoting the wrong action hands the operator a
    // minimum statement that does not contain the permission they are missing:
    // they grant it, redeploy, and are refused identically.
    const gw = standIn({
      "sts:GetCallerIdentity": COMMERCIAL_IDENTITY,
      "tag:GetResources": () => ({ ResourceTagMappingList: [] }),
      "rds:DescribeDBSnapshots": () => ({ DBSnapshots: [] }),
      "logs:DescribeLogGroups": () => ({ logGroups: [] }),
      "backup:ListBackupVaults": () => {
        throw awsError("AccessDeniedException")
      },
    })

    const readings = await retainedReadingsForTenant("acme", gw, { now: NOW })
    expect(readings.vaults.state).toBe("DENIED")
    if (readings.vaults.state !== "DENIED") throw new Error("unreachable")
    expect(readings.vaults.action).toBe("backup:ListBackupVaults")
    expect(readings.vaults.minimumStatement).toContain("backup:ListBackupVaults")

    // The recovery-point read was never made, and says so. EMPTY here would
    // have claimed "this tenant retains no recovery points" on the strength of
    // a call that never happened.
    expect(readings.recoveryPoints.state).toBe("UNCONFIGURED")
    expect(gw.calls.get("backup:ListRecoveryPointsByBackupVault")).toBeUndefined()

    const observed = retainedObservation(readings)
    const unknown = observed.unknown.join("\n")
    expect(unknown).toContain("backup:ListBackupVaults")
    expect(unknown).toContain("recovery points")
    expect(unknown).not.toContain("none —")
  })
})

/* ============================================================= 3. alarms == */

const alarm = (over: Record<string, unknown> = {}) => ({
  AlarmName: "tenure-alb-5xx",
  StateValue: "OK",
  ActionsEnabled: true,
  StateUpdatedTimestamp: "2026-08-08T08:55:00.000Z",
  ...over,
})

async function alarms(
  answer: () => unknown,
  expectedNames: readonly string[] = [],
): Promise<{ headline: string; verdicts: string[] }> {
  const gw = standIn({
    "sts:GetCallerIdentity": COMMERCIAL_IDENTITY,
    "cloudwatch:DescribeAlarms": answer,
  })
  const surface = await alarmSurface(gw, { now: NOW, expected: expectedNames })
  return { headline: surface.headline, verdicts: surface.rows.map((r) => r.verdict) }
}

test.describe("alarm semantics: seven verdicts, five behaviours, five different strings", () => {
  test("populated, empty, disabled, stale and denied all render differently", async () => {
    const populated = await alarms(() => ({
      MetricAlarms: [alarm(), alarm({ AlarmName: "tenure-dlq", StateValue: "ALARM" })],
    }))
    const empty = await alarms(() => ({ MetricAlarms: [] }), ["tenure-alb-5xx"])
    const disabled = await alarms(() => ({ MetricAlarms: [alarm({ ActionsEnabled: false })] }))
    const stale = await alarms(() => ({
      MetricAlarms: [alarm({ StateUpdatedTimestamp: "2026-07-31T08:00:00.000Z" })],
    }))
    const denied = await alarms(() => {
      throw awsError("AccessDeniedException")
    })

    const strings = [populated, empty, disabled, stale, denied].map((a) => a.headline)
    expect(new Set(strings).size).toBe(5)

    // An empty-but-successful response with an expectation renders MISSING per
    // expected alarm — never "all clear".
    expect(empty.verdicts).toEqual(["MISSING"])
    expect(empty.headline).not.toContain("Healthy")

    // ActionsEnabled:false with StateValue OK renders DISABLED, not OK.
    expect(disabled.verdicts).toEqual(["DISABLED"])
    expect(disabled.headline).toContain(ALARM_WORDS.DISABLED)
    expect(disabled.headline).not.toContain(ALARM_WORDS.OK)

    // Eight days old: STALE, with the date.
    expect(stale.verdicts).toEqual(["STALE"])

    // Denied: the whole surface, naming the action, and NOT an empty table.
    expect(denied.verdicts).toEqual(["UNAUTHORIZED"])
    expect(denied.headline).toContain("cloudwatch:DescribeAlarms")
    expect(denied.headline).toContain("unknown")
    expect(denied.headline).not.toContain("none")

    expect(populated.verdicts.sort()).toEqual(["ALARM", "OK"])
  })

  test("a composite alarm is read, not silently dropped", async () => {
    const { verdicts } = await alarms(() => ({
      MetricAlarms: [alarm()],
      CompositeAlarms: [alarm({ AlarmName: "tenure-oncall", StateValue: "ALARM" })],
    }))
    expect(verdicts.sort()).toEqual(["ALARM", "OK"])
  })

  test("disabled outranks state, at the level of the verdict function itself", () => {
    // Belt and braces on the ordering rule: an alarm that is BOTH disabled and
    // firing is reported as disabled, because nobody will be told it fired.
    const { verdict } = verdictFor(
      { AlarmName: "x", StateValue: "ALARM", ActionsEnabled: false },
      { now: NOW(), staleAfterMs: 7 * 86_400_000 },
    )
    expect(verdict).toBe("DISABLED")
  })
})

/* =========================================================== 4. findings == */

const finding = (over: Record<string, unknown> = {}) => ({
  Id: "finding-1",
  ProductArn: "arn:aws:securityhub:eu-west-2::product/aws/guardduty",
  ProductName: "GuardDuty",
  Title: "Unusual API call",
  Severity: { Label: "HIGH" },
  FirstObservedAt: "2026-08-01T09:00:00.000Z",
  RecordState: "ACTIVE",
  Resources: [{ Id: "arn:aws:ec2:eu-west-2:123456789012:instance/i-1" }],
  ...over,
})

async function findings(answer: () => unknown) {
  const gw = standIn({
    "sts:GetCallerIdentity": COMMERCIAL_IDENTITY,
    "securityhub:GetFindings": answer,
  })
  return securityFindings(gw, { now: NOW })
}

test.describe("security findings: which of the six products answered", () => {
  test("duplicates collapse, and the count says so", async () => {
    const surface = await findings(() => ({ Findings: [finding(), finding()] }))
    expect(surface.findings).toHaveLength(1)
    expect(surface.duplicatesRemoved).toBe(1)
    expect(surface.headline).toContain("1 open finding")
    expect(surface.headline).toContain("duplicate")
  })

  test("two products emitting the same Id are NOT merged", async () => {
    // The ProductArn component of the dedupe key. Without it a Config rule and a
    // Security Hub control with a shared id collapse into one, and one of two
    // real findings disappears.
    const surface = await findings(() => ({
      Findings: [
        finding(),
        finding({ ProductArn: "arn:aws:securityhub:eu-west-2::product/aws/config", ProductName: "Config" }),
      ],
    }))
    expect(surface.findings).toHaveLength(2)
  })

  test("empty-but-successful says 'no open findings from 6 sources', not a blank panel", async () => {
    const surface = await findings(() => ({ Findings: [] }))
    expect(surface.headline).toContain("no open findings from 6 sources")
    expect(surface.headline).toContain("as of")
    expect(surface.sources.every((s) => s.state === "AGGREGATED")).toBe(true)
  })

  test("Security Hub not enabled names the products it therefore could not read", async () => {
    const surface = await findings(() => {
      throw awsError("InvalidAccessException")
    })
    expect(surface.headline).toContain("not enabled")
    expect(surface.sources.every((s) => s.state === "NOT_ENABLED")).toBe(true)
    expect(surface.sources.find((s) => s.product === "GuardDuty")?.detail).toContain("GuardDuty")
  })

  test("AccessDenied is UNKNOWN for every product, and the table is not rendered empty", async () => {
    const surface = await findings(() => {
      throw awsError("AccessDeniedException")
    })
    expect(surface.headline).toContain("securityhub:GetFindings")
    expect(surface.headline).toContain(minimumStatementText("securityhub:GetFindings"))
    expect(surface.headline).toContain("No findings table is shown")
    expect(surface.sources.every((s) => s.state === "UNKNOWN")).toBe(true)
    expect(surface.findings).toHaveLength(0)
  })

  test("a throttle is a distinct state from a denial", async () => {
    const surface = await findings(() => {
      throw awsError("ThrottlingException")
    })
    expect(surface.headline).toContain("throttled")
    expect(surface.headline).not.toContain("Minimum statement")
  })

  test("all five findings behaviours render different text", async () => {
    const strings = [
      (await findings(() => ({ Findings: [finding(), finding()] }))).headline,
      (await findings(() => ({ Findings: [] }))).headline,
      (
        await findings(() => {
          throw awsError("InvalidAccessException")
        })
      ).headline,
      (
        await findings(() => {
          throw awsError("AccessDeniedException")
        })
      ).headline,
      (
        await findings(() => {
          throw awsError("ThrottlingException")
        })
      ).headline,
    ]
    expect(new Set(strings).size).toBe(5)
  })
})

/* ============================================================ 5. posture == */

const trail = (over: Record<string, unknown> = {}) => ({
  Name: "tenure-trail",
  IsOrganizationTrail: false,
  IsMultiRegionTrail: false,
  LogFileValidationEnabled: false,
  S3BucketName: "tenure-trail-logs",
  HomeRegion: "eu-west-2",
  ...over,
})

async function trailRow(answer: () => unknown) {
  const gw = standIn({
    "sts:GetCallerIdentity": COMMERCIAL_IDENTITY,
    "organizations:DescribeOrganization": () => {
      throw awsError("AWSOrganizationsNotInUseException")
    },
    "cloudtrail:DescribeTrails": answer,
  })
  const posture = await centralizationPosture(gw, { now: NOW })
  const row = posture.rows.find((r) => r.clause === "Organization trail")
  if (!row) throw new Error("the estate page no longer renders an Organization trail clause")
  return row
}

test.describe("centralization clauses are four-valued", () => {
  test("local-only, centralized, absent and denied render four different strings", async () => {
    const local = await trailRow(() => ({ trailList: [trail()] }))
    const centralized = await trailRow(() => ({
      trailList: [trail({ IsOrganizationTrail: true, IsMultiRegionTrail: true, LogFileValidationEnabled: true })],
    }))
    const absent = await trailRow(() => ({ trailList: [] }))
    const denied = await trailRow(() => {
      throw awsError("AccessDeniedException")
    })

    expect(local.verdict).toBe("LOCAL_ONLY")
    expect(centralized.verdict).toBe("CENTRALIZED")
    expect(absent.verdict).toBe("ABSENT")
    expect(denied.verdict).toBe("UNKNOWN")

    const strings = [local, centralized, absent, denied].map((r) => `${r.verdict} ${r.detail}`)
    expect(new Set(strings).size).toBe(4)

    // A denial must carry the statement, and must NOT read as ABSENT.
    expect(denied.detail).toContain("cloudtrail:DescribeTrails")
    expect(denied.minimumStatement).toContain("cloudtrail:DescribeTrails")
    expect(denied.detail).not.toContain("no trails")
  })
})

/* ================================================ 6. management account == */

const identityFor = (accountId: string): AwsRead<{ accountId: string; arn: string; partition: string; region: string }> => ({
  state: "ACTUAL",
  capability: "sts:GetCallerIdentity",
  value: {
    accountId,
    arn: `arn:aws:sts::${accountId}:assumed-role/x/y`,
    partition: "aws",
    region: "eu-west-2",
  },
  asOf: NOW().toISOString(),
  fresh: true,
})

async function org(answer: () => unknown) {
  return describeOrganization(standIn({ "organizations:DescribeOrganization": answer }), { now: NOW })
}

test.describe("workloads versus the management account", () => {
  test("the four verdicts are four different sentences", async () => {
    const inManagement = managementAccountVerdict(
      identityFor("111111111111"),
      await org(() => ({
        Organization: { Id: "o-1", MasterAccountId: "111111111111", FeatureSet: "ALL" },
      })),
    )
    const separated = managementAccountVerdict(
      identityFor("222222222222"),
      await org(() => ({
        Organization: { Id: "o-1", MasterAccountId: "111111111111", FeatureSet: "ALL" },
      })),
    )
    const noOrg = managementAccountVerdict(
      identityFor("333333333333"),
      await org(() => {
        throw awsError("AWSOrganizationsNotInUseException")
      }),
    )
    const unknown = managementAccountVerdict(
      identityFor("444444444444"),
      await org(() => {
        throw awsError("AccessDeniedException")
      }),
    )

    expect(inManagement.verdict).toBe("WORKLOAD_IN_MANAGEMENT_ACCOUNT")
    expect(separated.verdict).toBe("SEPARATED")
    expect(noOrg.verdict).toBe("NO_ORGANIZATION")
    expect(unknown.verdict).toBe("UNKNOWN")

    const strings = [inManagement, separated, noOrg, unknown].map((v) => v.detail)
    expect(new Set(strings).size).toBe(4)

    // The finding names BOTH ids it compared.
    expect(inManagement.detail).toContain("111111111111")
    expect(inManagement.managementAccountId).toBe("111111111111")

    // The refusal is not reassuring, and carries the statement.
    expect(unknown.detail).toContain("organizations:DescribeOrganization")
    expect(unknown.detail).toContain('"Effect":"Allow"')
    expect(unknown.detail).not.toContain("separated")

    // "AWS said there is no organization" is not "we could not look".
    expect(noOrg.detail).toContain("AWSOrganizationsNotInUseException")
    expect(noOrg.detail).not.toContain("refused")
  })

  test("the topology reports UNKNOWN for every role when the organization was refused", () => {
    const rows = reconcileTopology({
      scale: "multi-account",
      accounts: [],
      selfAccountId: "123456789012",
      organizationInUse: false,
      unknownBecause: "organizations:DescribeOrganization was refused (AccessDeniedException)",
    })
    expect(rows.every((r) => r.state === "UNKNOWN")).toBe(true)
    // Not MISSING. Reporting eleven missing accounts because a permission is
    // absent is how an operator spends a morning creating accounts that exist.
    expect(rows.some((r) => r.state === "MISSING")).toBe(false)
  })

  test("a single-account estate reports its one account, not eleven findings", () => {
    const rows = reconcileTopology({
      scale: "single-account-pilot",
      accounts: [],
      selfAccountId: "123456789012",
      organizationInUse: false,
    })
    expect(rows.every((r) => r.state === "SINGLE_ACCOUNT")).toBe(true)
  })
})

/* ======================================================= 7. console links == */

test.describe("console links are built from the resolved partition", () => {
  test("three partitions produce three different hosts, and a fourth produces null", () => {
    const commercial = consoleLink({ partition: "aws", region: "eu-west-2", service: "ecs" })
    const govcloud = consoleLink({ partition: "aws-us-gov", region: "us-gov-west-1", service: "ecs" })
    const china = consoleLink({ partition: "aws-cn", region: "cn-north-1", service: "ecs" })
    const iso = consoleLink({ partition: "aws-iso-b", region: "us-isob-east-1", service: "ecs" })

    expect(commercial).toContain("console.aws.amazon.com")
    expect(govcloud).toContain("console.amazonaws-us-gov.com")
    expect(china).toContain("console.amazonaws.cn")
    // Null, not a guessed URL. A link that sends an operator to the commercial
    // console for a resource that is not there is the residency defect in
    // miniature — they conclude it does not exist.
    expect(iso).toBeNull()

    expect(new Set([commercial, govcloud, china]).size).toBe(3)
    expect(linkablePartitions()).toEqual(["aws", "aws-cn", "aws-us-gov"])
  })

  test("the caveat names the account and says the console is outside the audit", () => {
    const caveat = consoleCaveat("123456789012")
    expect(caveat).toContain("123456789012")
    expect(caveat).toContain("outside Tenure's audit")
  })
})

/* =============================================================== 8. drift == */

test.describe("drift never plans against a blind read", () => {
  const desired = [
    {
      resourceKey: "ecs:service/acme",
      resourceType: "ecs:service",
      owner: "cloud-platform-engineer",
      severityIfMissing: "serving" as const,
      detail: "The artifact says this tenant serves traffic.",
    },
  ]

  test("a denied ECS reading is severity unknown and offers NO remediation", () => {
    const denied: AwsRead<readonly never[]> = {
      state: "DENIED",
      capability: "ecs:DescribeServices",
      action: "ecs:DescribeServices",
      principal: "arn:aws:sts::123456789012:assumed-role/x/y",
      accountId: "123456789012",
      region: "eu-west-2",
      partition: "aws",
      errorCode: "AccessDeniedException",
      minimumStatement: minimumStatementText("ecs:DescribeServices"),
    }

    const report = compareDesiredToActual(desired, [denied], { now: NOW(), slug: "acme" })
    expect(report.partial).toBe(true)
    expect(report.items).toHaveLength(1)
    expect(report.items[0].severity).toBe("unknown")
    // The whole rule: no plan to recreate a resource we were not allowed to see.
    expect(report.items[0].remediation).toBeUndefined()
  })

  test("an EMPTY reading — we looked and it is genuinely gone — DOES produce a plan", () => {
    const empty: AwsRead<readonly never[]> = {
      state: "EMPTY",
      capability: "ecs:DescribeServices",
      asOf: NOW().toISOString(),
    }
    const report = compareDesiredToActual(desired, [empty], { now: NOW(), slug: "acme" })
    expect(report.partial).toBe(false)
    expect(report.items[0].severity).toBe("serving")
    expect(report.items[0].remediation).toBeDefined()
  })

  test("an ignore with no expiry is refused at construction", () => {
    expect(() =>
      driftIgnore({
        resourceKey: "ecs:service/acme",
        justification: "known, tracked in INC-4",
        actor: "operator@tenure.example",
        now: NOW(),
      }),
    ).toThrow(IgnoreWithoutExpiry)

    // And one with an expiry in the past is refused too — an ignore that has
    // already lapsed is the same permanent silence with a date on it.
    expect(() =>
      driftIgnore({
        resourceKey: "ecs:service/acme",
        justification: "known, tracked in INC-4",
        expiresAt: "2026-01-01T00:00:00.000Z",
        actor: "operator@tenure.example",
        now: NOW(),
      }),
    ).toThrow(IgnoreWithoutExpiry)

    const ok = driftIgnore({
      resourceKey: "ecs:service/acme",
      justification: "known, tracked in INC-4",
      expiresAt: "2026-09-01T00:00:00.000Z",
      actor: "operator@tenure.example",
      now: NOW(),
    })
    expect(ok.expiresAt).toBe("2026-09-01T00:00:00.000Z")
  })
})

/* ====================================================== 9. the wiring == */

/**
 * The rule proven in section 8 is only worth anything if a page runs it.
 *
 * `compareDesiredToActual` had no production caller when it was written — the
 * exact "correct code, zero effect" failure. These assertions read the tenant
 * page's source and fail if it stops composing the two halves, in the same shape
 * `states-logic.spec.ts` already uses for the fleet page's retry panel. A
 * behavioural test cannot see a caller disappear; this can.
 */
test.describe("the drift comparison is reached from a page", () => {
  const tenantPage = () =>
    fs.readFileSync(path.join(__dirname, "..", "src", "app", "tenants", "[slug]", "page.tsx"), "utf8")

  test("the tenant page computes the report from the live inventory", () => {
    const source = tenantPage()
    expect(source).toContain("compareDesiredToActual(")
    expect(source).toContain("desiredFromDeployment(")
    /*
     * The same function /platform/estate calls, so the two surfaces cannot
     * disagree about what AWS said.
     *
     * It is no longer `await estateInventory()` on a line of its own: the call
     * constructs AWS clients, and a missing region or an unresolvable endpoint
     * throws before any read is attempted, which is a configuration fault
     * rather than a denial. So the page now awaits it THROUGH `readingAsync`,
     * which turns that throw into a reading the page can render. The property
     * this assertion exists for is unchanged — the tenant page performs the
     * estate read itself, from the same function — and it still fails if the
     * page stops calling it, or calls something else and calls it inventory.
     */
    expect(source).toMatch(/await readingAsync\(\s*\(\)\s*=>\s*estateInventory\(\)/)
  })

  test("it passes the READINGS, not flattened arrays", () => {
    /*
     * Flattening would turn a denied surface into "no resources", and the report
     * would then offer a plan to recreate every desired resource — the failure
     * the union exists to refuse. The four readings must arrive whole.
     *
     * The inventory is now held in a reading rather than in a bare `estate`, so
     * the four are read off `inventory.value`. The name is NOT hardcoded and NOT
     * left free either — it is read back off the estate read itself, so the four
     * fields must come off the object that read produced rather than off any
     * object that happens to carry four fields with the right names. That is the
     * link `estate.ecsServices` carried when the read was
     * `const estate = await estateInventory()`, and it is what stops the report
     * being computed against a second, staler inventory.
     *
     * The rest is pinned exactly as it was and nothing more: the four fields come
     * off ONE expression, in the one order `compareDesiredToActual` documents, and
     * each is passed as it stands. A comma has to follow each name, so `.value`,
     * `?? []`, `.map(...)` or any other unwrapping fails this exactly as
     * `estate.ecsServices.value ?? []` would have failed before.
     */
    const source = tenantPage()
    const bound = source.match(
      /const (\w+) = await readingAsync\(\s*\(\)\s*=>\s*estateInventory\(\)/,
    )
    expect(bound, "the page no longer binds the estate reading to a name").not.toBeNull()
    const inventory = `${bound![1]}(?:\\.\\w+)*`
    expect(source).toMatch(
      new RegExp(
        `\\[\\s*(${inventory})\\.ecsServices,\\s*\\1\\.databases,` +
          `\\s*\\1\\.distributions,\\s*\\1\\.certificates,?\\s*\\]`,
      ),
    )
  })

  test("the estate page renders the identity band and the console escape", () => {
    const estate = fs.readFileSync(
      path.join(__dirname, "..", "src", "app", "platform", "estate", "page.tsx"),
      "utf8",
    )
    expect(estate).toContain("await estateInventory()")
    expect(estate).toContain("await centralizationPosture()")
    expect(estate).toContain("identityHeadline(identity)")
    // Break-glass, not "is an operator".
    expect(estate).toContain('mayAct(role, "aws.console:read")')
    expect(estate).toContain("consoleCaveat(accountId)")
  })

  test("the health and security pages call their surfaces", () => {
    const health = fs.readFileSync(
      path.join(__dirname, "..", "src", "app", "platform", "health", "page.tsx"),
      "utf8",
    )
    expect(health).toContain("await alarmSurface(")
    expect(health).toContain("expectedAlarmNames()")

    const security = fs.readFileSync(
      path.join(__dirname, "..", "src", "app", "platform", "security", "page.tsx"),
      "utf8",
    )
    expect(security).toContain("await securityFindings()")
  })
})
