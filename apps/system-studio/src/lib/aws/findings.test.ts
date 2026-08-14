import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"
import {
  PIPELINE_SOURCES,
  assemblePipeline,
  dedupeKey,
  describeNormalisedFinding,
  ecrSeverity,
  hubSeverity,
  mergeSeverity,
  pipelineLines,
  securityFindings,
  type FindingContribution,
  type FindingsPipeline,
  type NormalisedFinding,
  type PipelineSourceId,
} from "./findings"

/**
 * STUDIO-110-006 (extension) — one findings pipeline over five sources.
 *
 * Every assertion drives `securityFindings`, which is what
 * `src/app/platform/security/page.tsx:154` calls, rather than a private helper.
 * A test that drove a normaliser directly would stay green on the day the
 * production entry point stopped calling it, which is a failure this programme
 * has already paid for. The two pure exports that ARE asserted directly —
 * `assemblePipeline` and `mergeSeverity` — are also reached through
 * `securityFindings` in the tests above them.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers eleven capabilities with the shapes the real SDK returns and
 * can fail each of them INDEPENDENTLY. A stand-in that returned `[]` regardless
 * of what was asked would prove nothing about code whose entire job is telling
 * "checked and clean" from "not checked", and it is the fake this repository has
 * already been burnt by.
 *
 * ## Nothing here is a real AWS identifier
 *
 * `123456789012` is AWS's own documentation placeholder account. Every ARN,
 * digest, detector id and rule name below is obviously constructed. No real
 * account, resource or finding from any live estate appears in this file.
 */

/* ------------------------------------------------------------- the estate -- */

const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
const ROLE_ARN = `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`

const DETECTOR = "0123456789abcdef0123456789abcdef"
const INSTANCE_ID = "i-0abc0abc0abc0abc0"
const INSTANCE_ARN = `arn:aws:ec2:${REGION}:${ACCOUNT}:instance/${INSTANCE_ID}`
const BUCKET_ARN = "arn:aws:s3:::tenure-prod-uploads"
const REPO = "tenure-web"
const REPO_ARN = `arn:aws:ecr:${REGION}:${ACCOUNT}:repository/${REPO}`
const DIGEST = "sha256:0000000000000000000000000000000000000000000000000000000000000001"
const ANALYZER_ARN = `arn:aws:access-analyzer:${REGION}:${ACCOUNT}:analyzer/tenure-external`
const FAILING_RULE = "rds-storage-encrypted"
const RULE_ARN = `arn:aws:config:${REGION}:${ACCOUNT}:config-rule/config-rule-${FAILING_RULE}`

/** The GuardDuty type both GuardDuty and Security Hub report on the instance. */
const SHARED_TYPE = "UnauthorizedAccess:EC2/SSHBruteForce"

const AT = () => new Date("2026-08-13T10:00:00.000Z")

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FakeOptions {
  securityhub?: Outcome | "not-enabled"
  hubFindings?: Record<string, unknown>[]
  guardduty?: Outcome
  guardDutyFindings?: Record<string, unknown>[]
  analyzer?: Outcome
  analyzerFindings?: Record<string, unknown>[]
  ecr?: Outcome
  ecrScanOnPush?: boolean
  ecrFindings?: Array<{ name: string; severity: string; packageName?: string }>
  config?: Outcome
  configVerdict?: string
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  calls?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

function gate(outcome: Outcome): void {
  if (outcome === "denied") throwing("AccessDeniedException")
  if (outcome === "throttled") throwing("ThrottlingException")
}

/** The Security Hub record for the SAME threat GuardDuty reports on the instance. */
function hubBruteForce(): Record<string, unknown> {
  return {
    Id: "hub-ssh-brute-force",
    ProductArn: `arn:aws:securityhub:${REGION}::product/aws/guardduty`,
    ProductName: "GuardDuty",
    Title: "SSH brute force attacks against i-0abc0abc0abc0abc0",
    Types: [SHARED_TYPE],
    Severity: { Label: "HIGH", Normalized: 70 },
    FirstObservedAt: "2026-08-12T22:04:11.000Z",
    LastObservedAt: "2026-08-13T08:41:02.000Z",
    RecordState: "ACTIVE",
    AwsAccountId: ACCOUNT,
    Region: REGION,
    Workflow: { Status: "NEW" },
    Remediation: {
      Recommendation: { Text: "Restrict inbound SSH to the bastion security group." },
    },
    Resources: [{ Id: INSTANCE_ARN, Type: "AwsEc2Instance", Region: REGION, Partition: "aws" }],
  }
}

/** A hub finding no direct reader can corroborate: a Config-standard control. */
function hubBucketControl(): Record<string, unknown> {
  return {
    Id: "hub-s3-public-read",
    ProductArn: `arn:aws:securityhub:${REGION}::product/aws/securityhub`,
    ProductName: "Security Hub",
    Title: "S3.2 S3 buckets should prohibit public read access",
    Types: ["Software and Configuration Checks/Industry and Regulatory Standards"],
    Severity: { Label: "CRITICAL", Normalized: 90 },
    FirstObservedAt: "2026-08-01T00:00:00.000Z",
    LastObservedAt: "2026-08-13T09:00:00.000Z",
    RecordState: "ACTIVE",
    AwsAccountId: ACCOUNT,
    Region: REGION,
    Resources: [{ Id: BUCKET_ARN, Type: "AwsS3Bucket", Region: REGION, Partition: "aws" }],
  }
}

function gdBruteForce(): Record<string, unknown> {
  return {
    Id: "gd-ssh-brute-force",
    Arn: `arn:aws:guardduty:${REGION}:${ACCOUNT}:detector/${DETECTOR}/finding/gd-ssh-brute-force`,
    Type: SHARED_TYPE,
    Title: "SSH brute force attacks against i-0abc0abc0abc0abc0",
    Description: "EC2 instance has been involved in SSH brute force attacks.",
    Severity: 8,
    AccountId: ACCOUNT,
    Region: REGION,
    Partition: "aws",
    CreatedAt: "2026-08-12T22:04:11.000Z",
    UpdatedAt: "2026-08-13T08:41:02.000Z",
    Resource: { ResourceType: "Instance", InstanceDetails: { InstanceId: INSTANCE_ID } },
    Service: {
      DetectorId: DETECTOR,
      ServiceName: "guardduty",
      FeatureName: "FlowLogs",
      Archived: false,
      Count: 42,
      EventFirstSeen: "2026-08-11T20:00:00.000Z",
      EventLastSeen: "2026-08-13T08:40:00.000Z",
    },
  }
}

/** A credential finding: no ARN at all, so it can never be joined on. */
function gdCredential(): Record<string, unknown> {
  return {
    Id: "gd-anomalous-credential",
    Type: "UnauthorizedAccess:IAMUser/AnomalousBehavior",
    Title: "Anomalous API calls",
    Severity: 5,
    AccountId: ACCOUNT,
    Region: REGION,
    Partition: "aws",
    Resource: {
      ResourceType: "AccessKey",
      AccessKeyDetails: { UserName: "deploy", UserType: "AssumedRole" },
    },
    Service: {
      DetectorId: DETECTOR,
      ServiceName: "guardduty",
      Archived: false,
      EventFirstSeen: "2026-08-13T05:00:00.000Z",
      EventLastSeen: "2026-08-13T06:00:00.000Z",
    },
  }
}

function analyzerExposure(): Record<string, unknown> {
  return {
    id: "aa-bucket-shared",
    resource: BUCKET_ARN,
    resourceType: "AWS::S3::Bucket",
    resourceOwnerAccount: ACCOUNT,
    status: "ACTIVE",
    findingType: "ExternalAccess",
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    analyzedAt: new Date("2026-08-13T07:00:00.000Z"),
    updatedAt: new Date("2026-08-13T07:00:00.000Z"),
  }
}

function fakeAws(options: FakeOptions = {}): AwsGateway {
  const calls = options.calls ?? []
  const hub = options.securityhub ?? "populated"
  const gd = options.guardduty ?? "populated"
  const aa = options.analyzer ?? "populated"
  const ecr = options.ecr ?? "populated"
  const cfg = options.config ?? "populated"

  return {
    async call(capability, input) {
      calls.push(String(capability))
      const arg = (input ?? {}) as Record<string, unknown>

      switch (capability) {
        case "sts:GetCallerIdentity":
          return { Account: ACCOUNT, Arn: ROLE_ARN, UserId: "AROA:studio" }

        case "tag:GetResources":
          return {
            ResourceTagMappingList: Object.entries(options.tags ?? {}).map(([arn, Tags]) => ({
              ResourceARN: arn,
              Tags,
            })),
          }

        /* ---------------------------------------------------- Security Hub -- */
        case "securityhub:GetFindings": {
          if (hub === "not-enabled") throwing("InvalidAccessException")
          gate(hub)
          if (hub === "empty") return { Findings: [] }
          return { Findings: options.hubFindings ?? [hubBruteForce(), hubBucketControl()] }
        }

        /* ------------------------------------------------------- GuardDuty -- */
        case "guardduty:ListDetectors": {
          gate(gd)
          // The real API OMITS DetectorIds entirely when there are none.
          if (gd === "empty") return {}
          return { DetectorIds: [DETECTOR] }
        }
        case "guardduty:ListFindings": {
          const findings = options.guardDutyFindings ?? [gdBruteForce(), gdCredential()]
          if (findings.length === 0) return {}
          return { FindingIds: findings.map((f) => String(f.Id)) }
        }
        case "guardduty:GetFindings":
          return { Findings: options.guardDutyFindings ?? [gdBruteForce(), gdCredential()] }

        /* -------------------------------------------------- Access Analyzer -- */
        case "access-analyzer:ListAnalyzers": {
          gate(aa)
          // The real API returns an EMPTY ARRAY for an account with no analyzer.
          if (aa === "empty") return { analyzers: [] }
          return {
            analyzers: [
              {
                arn: ANALYZER_ARN,
                name: "tenure-external",
                type: "ACCOUNT",
                status: "ACTIVE",
                createdAt: new Date("2026-07-01T00:00:00.000Z"),
              },
            ],
          }
        }
        case "access-analyzer:ListFindingsV2":
          return { findings: options.analyzerFindings ?? [analyzerExposure()] }

        /* -------------------------------------------------------------- ECR -- */
        case "ecr:DescribeRepositories": {
          gate(ecr)
          // The real API OMITS `repositories` entirely when there are none.
          if (ecr === "empty") return {}
          return {
            repositories: [
              {
                repositoryName: REPO,
                repositoryArn: REPO_ARN,
                registryId: ACCOUNT,
                repositoryUri: `${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${REPO}`,
                createdAt: new Date("2026-01-04T00:00:00.000Z"),
                imageTagMutability: "IMMUTABLE",
                imageScanningConfiguration: { scanOnPush: options.ecrScanOnPush ?? true },
                encryptionConfiguration: { encryptionType: "KMS" },
              },
            ],
          }
        }
        case "ecr:DescribeImages":
          return {
            imageDetails: [
              {
                registryId: ACCOUNT,
                repositoryName: REPO,
                imageDigest: DIGEST,
                imageTags: ["sha-9f2c1a"],
                imageSizeInBytes: 268_435_456,
                imagePushedAt: new Date("2026-08-12T18:04:00.000Z"),
                imageScanStatus: { status: "COMPLETE" },
                imageScanFindingsSummary: {
                  imageScanCompletedAt: new Date("2026-08-12T18:09:00.000Z"),
                  findingSeverityCounts: { HIGH: 1 },
                },
              },
            ],
          }
        case "ecr:DescribeImageScanFindings": {
          if (String(arg.imageDigest ?? "") !== DIGEST) throwing("ImageNotFoundException")
          return {
            imageScanStatus: { status: "COMPLETE" },
            imageScanFindings: {
              imageScanCompletedAt: new Date("2026-08-12T18:09:00.000Z"),
              findingSeverityCounts: { HIGH: 1 },
              findings: (
                options.ecrFindings ?? [
                  { name: "CVE-2026-0001", severity: "HIGH", packageName: "openssl" },
                ]
              ).map((f) => ({
                name: f.name,
                severity: f.severity,
                attributes: f.packageName
                  ? [{ key: "package_name", value: f.packageName }]
                  : [],
              })),
            },
          }
        }
        case "ecr:GetLifecyclePolicy":
          throwing("LifecyclePolicyNotFoundException")

        /* ----------------------------------------------------------- Config -- */
        case "config:DescribeConfigRules": {
          gate(cfg)
          // The real API returns `ConfigRules: []` where Config was never set up.
          if (cfg === "empty") return { ConfigRules: [] }
          return {
            ConfigRules: [
              {
                ConfigRuleName: FAILING_RULE,
                ConfigRuleArn: RULE_ARN,
                ConfigRuleId: `config-rule-${FAILING_RULE}`,
                ConfigRuleState: "ACTIVE",
                Description: "RDS storage must be encrypted",
                Source: { Owner: "AWS", SourceIdentifier: "RDS_STORAGE_ENCRYPTED" },
                EvaluationModes: [{ Mode: "DETECTIVE" }],
                Scope: { ComplianceResourceTypes: ["AWS::RDS::DBInstance"] },
              },
            ],
          }
        }
        case "config:DescribeComplianceByConfigRule":
          return {
            ComplianceByConfigRules: [
              {
                ConfigRuleName: FAILING_RULE,
                Compliance: {
                  ComplianceType: options.configVerdict ?? "NON_COMPLIANT",
                  ComplianceContributorCount: { CappedCount: 3, CapExceeded: false },
                },
              },
            ],
          }
        case "config:DescribeConfigurationAggregators":
          return { ConfigurationAggregators: [] }

        default:
          throw new Error(
            `the stand-in was asked for ${String(capability)}, which this suite does not exercise`,
          )
      }
    },
    async resolvedRegion() {
      return REGION
    },
  }
}

/* ---------------------------------------------------------------- helpers -- */

async function load(options: FakeOptions = {}): Promise<FindingsPipeline> {
  const surface = await securityFindings(fakeAws(options), { now: AT })
  return surface.pipeline
}

function sourceOf(pipeline: FindingsPipeline, id: PipelineSourceId) {
  const found = pipeline.sources.find((s) => s.source === id)
  if (!found) throw new Error(`the pipeline dropped ${id} entirely`)
  return found
}

function rowFor(pipeline: FindingsPipeline, key: string): NormalisedFinding {
  const found = pipeline.findings.find((f) => f.key === key)
  if (!found) {
    throw new Error(
      `no row keyed ${key}. Rows present: ${pipeline.findings.map((f) => f.key).join(" | ")}`,
    )
  }
  return found
}

beforeEach(() => {
  // Identity is memoised across calls; without this, one test's resolved
  // identity leaks into the next and a denial case silently passes.
  __resetIdentity()
})

/* ═══════════════════════════════ the tests ══════════════════════════════ */

describe("every source now readable reaches one pipeline", () => {
  it("carries all five sources, in a fixed order, whether or not they answered", async () => {
    const pipeline = await load()
    expect(pipeline.sources.map((s) => s.source)).toEqual([...PIPELINE_SOURCES])
  })

  it("normalises a finding from each of the five sources into one shape", async () => {
    const pipeline = await load()
    const sources = new Set(pipeline.findings.flatMap((f) => f.seenBy))
    expect([...sources].sort()).toEqual([
      "access-analyzer",
      "config",
      "ecr-image-scan",
      "guardduty",
      "securityhub",
    ])
    // Every row has the seven fields the requirement names, and none is a stub.
    for (const finding of pipeline.findings) {
      expect(typeof finding.title).toBe("string")
      expect(finding.remedy.length).toBeGreaterThan(20)
      expect(finding.native.scale.length).toBeGreaterThan(0)
      expect(finding.resourceProvenance.length).toBeGreaterThan(0)
    }
  })
})

describe("deduplication across sources, and corroboration", () => {
  it("collapses the same threat reported by Security Hub and GuardDuty into one row", async () => {
    const pipeline = await load()
    const row = rowFor(pipeline, `${INSTANCE_ARN}::${SHARED_TYPE}`)

    expect(row.seenBy).toEqual(["guardduty", "securityhub"])
    expect(row.corroborated).toBe(true)
    expect(row.contributions).toHaveLength(2)
    // Exactly one row for this threat, not two.
    expect(pipeline.findings.filter((f) => f.type === SHARED_TYPE)).toHaveLength(1)
    expect(pipeline.duplicatesCollapsed).toBe(1)
    expect(pipeline.corroborated.map((f) => f.key)).toEqual([`${INSTANCE_ARN}::${SHARED_TYPE}`])
  })

  it("says out loud that more than one source saw it", async () => {
    const pipeline = await load()
    const row = rowFor(pipeline, `${INSTANCE_ARN}::${SHARED_TYPE}`)
    expect(row.corroboration).toContain("CORROBORATED")
    expect(row.corroboration).toContain("GuardDuty")
    expect(row.corroboration).toContain("Security Hub")
    // And the sentence reaches the surface, not just the object.
    const line = pipelineLines(pipeline).find((l) => l.label === row.key)
    expect(line?.text).toContain("CORROBORATED")
  })

  it("keeps the direct reader's record as the primary and never loses the aggregator's", async () => {
    const pipeline = await load()
    const row = rowFor(pipeline, `${INSTANCE_ARN}::${SHARED_TYPE}`)
    // GuardDuty is primary: its record carries the detector id and the count.
    expect(row.source).toBe("guardduty")
    expect(row.detail.source === "guardduty" ? row.detail.detectorId : null).toBe(DETECTOR)
    expect(row.detail.source === "guardduty" ? row.detail.occurrences : null).toBe(42)
    // And Security Hub's own record survives whole beside it.
    const hub = row.contributions.find((c) => c.source === "securityhub")
    expect(hub?.id).toBe("hub-ssh-brute-force")
    expect(hub?.native.value).toBe("HIGH")
    expect(hub?.remedy).toContain("Restrict inbound SSH")
  })

  it("does NOT collapse two sources whose type strings differ", async () => {
    // Security Hub's ASFF taxonomy is not always the product's own type string.
    // When it differs, the two rows stay apart — visibly, each naming its source
    // — rather than being merged on a guess.
    const pipeline = await load()
    const bucketRows = pipeline.findings.filter((f) => f.resourceArn === BUCKET_ARN)
    expect(bucketRows).toHaveLength(2)
    expect(bucketRows.every((r) => r.corroborated)).toBe(false)
    expect(new Set(bucketRows.flatMap((r) => r.seenBy))).toEqual(
      new Set(["securityhub", "access-analyzer"]),
    )
  })

  it("never merges two findings that name no resource ARN", async () => {
    const pipeline = await load({
      hubFindings: [
        {
          ...hubBruteForce(),
          Id: "hub-anomalous-credential",
          Types: ["UnauthorizedAccess:IAMUser/AnomalousBehavior"],
          Resources: [{ Id: "access-key/deploy" }],
        },
      ],
      guardDutyFindings: [gdCredential()],
      analyzerFindings: [],
      ecrFindings: [],
      config: "empty",
    })
    const credentialRows = pipeline.findings.filter(
      (f) => f.type === "UnauthorizedAccess:IAMUser/AnomalousBehavior",
    )
    expect(credentialRows).toHaveLength(2)
    expect(pipeline.duplicatesCollapsed).toBe(0)
    expect(credentialRows.map((r) => r.key).sort()).toEqual([
      "unjoinable::guardduty::gd-anomalous-credential",
      "unjoinable::securityhub::hub-anomalous-credential",
    ])
  })
})

describe("one normalised severity scale, with the native value beside it", () => {
  it("carries each source's own scale and value onto every row", async () => {
    const pipeline = await load()
    // Keyed off the ONE corroborated row for the brute-force finding plus the
    // first row from each remaining source, rather than a source-keyed map over
    // every contribution — which would silently assert on whichever record
    // happened to come last.
    const instance = rowFor(pipeline, `${INSTANCE_ARN}::${SHARED_TYPE}`)
    const byScale = new Map<PipelineSourceId, FindingContribution["native"]>()
    for (const contribution of instance.contributions) {
      byScale.set(contribution.source, contribution.native)
    }
    for (const source of ["ecr-image-scan", "access-analyzer", "config"] as const) {
      const row = pipeline.findings.find((f) => f.source === source)
      if (row) byScale.set(source, row.native)
    }
    expect(byScale.get("guardduty")).toMatchObject({
      scale: "GuardDuty Severity, 0.0-10.0",
      value: "8",
      numeric: 8,
    })
    expect(byScale.get("securityhub")).toMatchObject({ value: "HIGH", numeric: 70 })
    expect(byScale.get("ecr-image-scan")).toMatchObject({ value: "HIGH" })
    expect(byScale.get("access-analyzer")).toMatchObject({ value: "ACTIVE", numeric: null })
    expect(byScale.get("config")).toMatchObject({ value: "NON_COMPLIANT", numeric: 3 })
    // The mapping is stated on every row, so nobody has to trust it blindly.
    for (const contribution of pipeline.findings.flatMap((f) => f.contributions)) {
      expect(contribution.native.mapping.length).toBeGreaterThan(30)
    }
  })

  it("ranks a source that publishes NO severity above critical rather than below informational", async () => {
    const pipeline = await load()
    // Access Analyzer and Config publish no severity at all.
    const unranked = pipeline.findings.filter((f) => f.severity === "UNRANKED")
    expect(unranked.map((f) => f.source).sort()).toEqual(["access-analyzer", "config"])
    // They sort ABOVE the CRITICAL hub finding, not below the informational ones.
    const positions = pipeline.findings.map((f) => f.severity)
    expect(positions.indexOf("UNRANKED")).toBeLessThan(positions.indexOf("CRITICAL"))
  })

  it("takes the worst RANKED band when sources disagree, and keeps the unranked record", () => {
    const gd: FindingContribution = {
      ...stubContribution("guardduty"),
      severity: "UNRANKED",
    }
    const hub: FindingContribution = { ...stubContribution("securityhub"), severity: "HIGH" }
    expect(mergeSeverity([gd, hub])).toBe("HIGH")
    expect(mergeSeverity([gd])).toBe("UNRANKED")
    expect(mergeSeverity([hub, { ...hub, severity: "CRITICAL" }])).toBe("CRITICAL")
  })

  it("does not read an unlabelled Security Hub finding as informational", () => {
    expect(hubSeverity(null)).toBe("UNRANKED")
    expect(hubSeverity("HIGH")).toBe("HIGH")
    expect(hubSeverity("INFORMATIONAL")).toBe("INFORMATIONAL")
    // ECR's own word for an unscored CVE is not a low one either.
    expect(ecrSeverity("UNDEFINED")).toBe("UNRANKED")
    expect(ecrSeverity("CRITICAL")).toBe("CRITICAL")
  })
})

describe("a source that is not enabled contributes a marker, never zero findings", () => {
  it("marks all five when nothing in the account is switched on", async () => {
    const pipeline = await load({
      securityhub: "not-enabled",
      guardduty: "empty",
      analyzer: "empty",
      ecr: "denied",
      config: "empty",
    })

    expect(pipeline.notChecked).toHaveLength(5)
    expect(sourceOf(pipeline, "securityhub").state).toBe("NOT_CHECKED")
    expect(sourceOf(pipeline, "securityhub").caveats[0].reason).toBe("NOT_ENABLED")
    expect(sourceOf(pipeline, "guardduty").caveats[0].reason).toBe("NOT_ENABLED")
    expect(sourceOf(pipeline, "access-analyzer").caveats[0].reason).toBe("NOT_ENABLED")
    expect(sourceOf(pipeline, "config").caveats[0].reason).toBe("NOT_ENABLED")
    expect(sourceOf(pipeline, "ecr-image-scan").caveats[0].reason).toBe("UNREADABLE")

    // Never zero findings: every marker carries a reason and no rows.
    for (const marker of pipeline.notChecked) {
      expect(marker.findings).toHaveLength(0)
      expect(marker.caveats.length).toBeGreaterThan(0)
      expect(marker.remedy).not.toBeNull()
    }
    expect(pipeline.findings).toHaveLength(0)
  })

  it("refuses to word an all-markers load as a clean estate", async () => {
    const pipeline = await load({
      securityhub: "not-enabled",
      guardduty: "empty",
      analyzer: "empty",
      ecr: "denied",
      config: "empty",
    })
    expect(pipeline.headline).toContain("NOTHING IS CHECKING")
    expect(pipeline.headline).not.toContain("no open findings")
    expect(pipeline.headline).toContain("absence of checking rather than an absence of findings")
  })

  it("hands a denied source its own action and pasteable minimum statement", async () => {
    const pipeline = await load({ guardduty: "denied" })
    const marker = sourceOf(pipeline, "guardduty")
    expect(marker.state).toBe("NOT_CHECKED")
    expect(marker.caveats[0].reason).toBe("UNREADABLE")
    expect(marker.action).toBe("guardduty:ListDetectors")
    expect(marker.minimumStatement).toContain("guardduty:ListDetectors")
    expect(marker.minimumStatement).toContain("Effect")
    // And the OTHER four sources still contributed.
    expect(sourceOf(pipeline, "securityhub").state).toBe("REPORTED")
    expect(pipeline.findings.length).toBeGreaterThan(0)
  })

  it("reports a repository that does not scan as a caveat, not as a clean repository", async () => {
    const pipeline = await load({ ecrScanOnPush: false })
    const ecr = sourceOf(pipeline, "ecr-image-scan")
    expect(ecr.state).toBe("REPORTED")
    expect(ecr.caveats.some((c) => c.reason === "NOT_ENABLED" && c.detail.includes(REPO))).toBe(
      true,
    )
    expect(pipeline.partial.map((s) => s.source)).toContain("ecr-image-scan")
  })

  it("treats a source nobody supplied as not-checked rather than dropping it", () => {
    const pipeline = assemblePipeline([], "2026-08-13T10:00:00.000Z")
    expect(pipeline.sources).toHaveLength(PIPELINE_SOURCES.length)
    expect(pipeline.notChecked).toHaveLength(PIPELINE_SOURCES.length)
    expect(pipeline.findings).toHaveLength(0)
  })
})

describe("what each source contributes without flattening away its meaning", () => {
  it("keeps the ECR digest, package and repository on the row", async () => {
    const pipeline = await load()
    const row = rowFor(pipeline, `${REPO_ARN}::CVE-2026-0001`)
    expect(row.severity).toBe("HIGH")
    expect(row.resourceLabel).toBe(`${REPO}@${DIGEST}`)
    expect(row.detail.source === "ecr-image-scan" ? row.detail.imageDigest : null).toBe(DIGEST)
    expect(row.detail.source === "ecr-image-scan" ? row.detail.packageName : null).toBe("openssl")
    expect(row.resourceProvenance).toContain("An image has no ARN of its own")
  })

  it("attaches a Config finding to the RULE and says the failing resources were not read", async () => {
    const pipeline = await load()
    const row = rowFor(pipeline, `${RULE_ARN}::${FAILING_RULE}`)
    expect(row.type).toBe(FAILING_RULE)
    expect(row.detail.source === "config" ? row.detail.nonCompliantResources : null).toBe(3)
    expect(row.resourceProvenance).toContain("config:GetComplianceDetailsByConfigRule")
    // Config states no timestamps, and none is invented.
    expect(row.firstSeen).toBeNull()
    expect(row.lastSeen).toBeNull()
  })

  it("says the Access Analyzer external principal is not readable rather than defaulting it", async () => {
    const pipeline = await load()
    const row = pipeline.findings.find((f) => f.source === "access-analyzer")
    expect(row?.detail.source === "access-analyzer" ? row?.detail.externalPrincipal : "").toContain(
      "access-analyzer:GetFindingV2",
    )
    expect(row?.remedy).toContain("access-analyzer:GetFindingV2")
  })

  it("takes the earliest first-seen and the latest last-seen across sources", async () => {
    const pipeline = await load()
    const row = rowFor(pipeline, `${INSTANCE_ARN}::${SHARED_TYPE}`)
    // GuardDuty saw the behaviour first; Security Hub observed it last.
    expect(row.firstSeen).toBe("2026-08-11T20:00:00.000Z")
    expect(row.lastSeen).toBe("2026-08-13T08:41:02.000Z")
  })
})

describe("what the surface prints", () => {
  it("prints one line per source, and the not-checked ones say so", async () => {
    const pipeline = await load({ guardduty: "empty" })
    const lines = pipelineLines(pipeline)
    const guardduty = lines.find((l) => l.label === "GuardDuty")
    expect(guardduty?.text).toContain("NOT CHECKED")
    expect(guardduty?.text).toContain("Remedy:")
    const hub = lines.find((l) => l.label === "Security Hub")
    expect(hub?.text).toContain("REPORTED")
  })

  it("prints the type verbatim, first", async () => {
    const pipeline = await load()
    const row = rowFor(pipeline, `${INSTANCE_ARN}::${SHARED_TYPE}`)
    expect(describeNormalisedFinding(row).startsWith(SHARED_TYPE)).toBe(true)
  })

  it("states how many records collapsed and how many were corroborated", async () => {
    const pipeline = await load()
    const readAt = pipelineLines(pipeline).find((l) => l.label === "Read at")
    expect(readAt?.text).toContain("1 duplicate record(s) collapsed on resource ARN + finding type")
    expect(readAt?.text).toContain("1 finding(s) corroborated by more than one source")
  })
})

describe("the production entry point", () => {
  it("runs the pipeline from the same load the Security Hub table is drawn from", async () => {
    const calls: string[] = []
    const surface = await securityFindings(fakeAws({ calls }), { now: AT })
    // securityhub:GetFindings is called ONCE, not once per consumer.
    expect(calls.filter((c) => c === "securityhub:GetFindings")).toHaveLength(1)
    // The legacy Security Hub surface is unchanged beside the new pipeline.
    expect(surface.findings).toHaveLength(2)
    expect(surface.pipeline.sources).toHaveLength(5)
    expect(surface.pipeline.findings.length).toBeGreaterThan(0)
  })

  it("keeps rendering when every AWS call is refused", async () => {
    const surface = await securityFindings(
      fakeAws({
        securityhub: "denied",
        guardduty: "denied",
        analyzer: "denied",
        ecr: "denied",
        config: "denied",
      }),
      { now: AT },
    )
    expect(surface.pipeline.notChecked).toHaveLength(5)
    expect(surface.pipeline.findings).toHaveLength(0)
    for (const marker of surface.pipeline.notChecked) {
      expect(marker.minimumStatement).not.toBeNull()
    }
  })
})

describe("the dedupe key", () => {
  it("needs both the ARN and the type, and never merges when either is missing", () => {
    const base = stubContribution("guardduty")
    expect(dedupeKey({ ...base, resourceArn: INSTANCE_ARN, type: SHARED_TYPE })).toBe(
      `${INSTANCE_ARN}::${SHARED_TYPE}`,
    )
    expect(dedupeKey({ ...base, resourceArn: null, type: SHARED_TYPE })).toBe(
      "unjoinable::guardduty::stub-id",
    )
    expect(dedupeKey({ ...base, resourceArn: INSTANCE_ARN, type: null })).toBe(
      "unjoinable::guardduty::stub-id",
    )
  })
})

/** A minimal contribution for the pure-function cases. Never used as a fixture row. */
function stubContribution(source: PipelineSourceId): FindingContribution {
  return {
    source,
    id: "stub-id",
    type: SHARED_TYPE,
    typeProvenance: "supplied by the test",
    title: "stub",
    severity: "HIGH",
    native: { scale: "test", value: null, numeric: null, mapping: "test" },
    resourceArn: INSTANCE_ARN,
    resourceProvenance: "supplied by the test",
    resourceLabel: INSTANCE_ID,
    attribution: { kind: "unattributed" },
    firstSeen: null,
    lastSeen: null,
    remedy: "supplied by the test",
    accountId: ACCOUNT,
    region: REGION,
    partition: "aws",
    detail: {
      source: "guardduty",
      detectorId: DETECTOR,
      description: null,
      occurrences: null,
      archived: null,
      serviceName: null,
      featureName: null,
      statusCaveat: "supplied by the test",
    },
  }
}
