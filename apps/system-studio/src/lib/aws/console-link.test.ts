import {
  consoleCaveat,
  consoleContextForReading,
  consoleLink,
  consoleLinkOutcome,
  linkablePartitions,
  linkableResourceKinds,
  partitionOfRegion,
  resourceConsoleLink,
  resourceConsoleLinkForReading,
  resourceConsoleLinkOutcome,
  type ConsoleContext,
  type ConsoleResource,
  type StatedPlacement,
} from "./console-link"
/*
 * Type-only, and therefore erased before this file runs: no reader is loaded,
 * no AWS client is constructed, and this test still cannot reach the network.
 * They are imported so that `tsc` — not a comment — is what proves the readings
 * these links are built from actually carry the identifiers the links need.
 */
import type { GuardDutyFinding } from "./guardduty"
import type { TableReading } from "./dynamodb-tables"
import type { VpcReading } from "./network"

/**
 * STUDIO-080-003 / STUDIO-080-010 — the console links are built from the
 * resolved identity, and a link that cannot be built correctly is absent.
 *
 * ## What these assertions are about
 *
 * Not "does AWS's console have this route". This module cannot know that and
 * neither can a test; what it CAN prove, and what the whole safety argument
 * rests on, is composition:
 *
 *   * the HOST comes from the partition, and an unnamed partition yields no link
 *   * the REGION comes from the context, and a region belonging to a different
 *     partition yields no link
 *   * a GLOBAL service's URL contains no region at all — the case a `?region=`
 *     leaks into most easily, because every other entry has one
 *   * an ARN in another account, region, partition or service yields no link
 *   * an identifier that does not parse yields no link, never a truncated URL
 *
 * Each of those is a way an operator ends up looking at the wrong account, and
 * each has an assertion below whose failure names it.
 *
 * ## Every identifier here is obviously constructed
 *
 * `123456789012` is AWS's own documentation account and `210987654321` is its
 * digits reversed. The UUIDs are repeated-digit, the domains are RFC 2606
 * reserved names, and nothing in this file corresponds to a real resource, a
 * real account or a real ARN. No AWS call is made from this file: the module
 * under test holds no client and issues none.
 */

/** The context every assertion below builds from unless it is varying one field. */
const COMMERCIAL: ConsoleContext = {
  partition: "aws",
  region: "eu-west-2",
  accountId: "123456789012",
}

const GOVCLOUD: ConsoleContext = {
  partition: "aws-us-gov",
  region: "us-gov-west-1",
  accountId: "123456789012",
}

const CHINA: ConsoleContext = {
  partition: "aws-cn",
  region: "cn-north-1",
  accountId: "123456789012",
}

/* ============================================ 1. the contract that existed == */

/**
 * The four assertions `e2e/aws-unknown-is-not-absent.spec.ts` already makes,
 * restated here.
 *
 * Restated rather than left to the e2e alone because this module was extended
 * under them: a change that broke one would be caught by a Playwright run that
 * nobody makes on a unit-test change. The e2e keeps its copy; these are the
 * ones that run on every `npm run test --workspace apps/web`.
 */
describe("the shape the estate page already depends on", () => {
  test("three partitions produce three different hosts, and a fourth produces null", () => {
    const commercial = consoleLink({ partition: "aws", region: "eu-west-2", service: "ecs" })
    const govcloud = consoleLink({ partition: "aws-us-gov", region: "us-gov-west-1", service: "ecs" })
    const china = consoleLink({ partition: "aws-cn", region: "cn-north-1", service: "ecs" })
    const iso = consoleLink({ partition: "aws-iso-b", region: "us-isob-east-1", service: "ecs" })

    expect(commercial).toBe("https://eu-west-2.console.aws.amazon.com/ecs/home?region=eu-west-2")
    expect(govcloud).toBe(
      "https://us-gov-west-1.console.amazonaws-us-gov.com/ecs/home?region=us-gov-west-1",
    )
    expect(china).toBe("https://cn-north-1.console.amazonaws.cn/ecs/home?region=cn-north-1")
    expect(iso).toBeNull()

    expect(new Set([commercial, govcloud, china]).size).toBe(3)
    expect(linkablePartitions()).toEqual(["aws", "aws-cn", "aws-us-gov"])
  })

  test("the estate page's own call — resource-groups — is unchanged", () => {
    // src/app/platform/estate/page.tsx, line ~183. This exact string is what
    // the break-glass button has always pointed at.
    expect(consoleLink({ partition: "aws", region: "eu-west-2", service: "resource-groups" })).toBe(
      "https://eu-west-2.console.aws.amazon.com/resource-groups/home?region=eu-west-2",
    )
  })

  test("the caveat names the account and says the console is outside the audit", () => {
    const caveat = consoleCaveat("123456789012")
    expect(caveat).toContain("123456789012")
    expect(caveat).toContain("outside Tenure's audit")
  })

  test("a blank region produces no link, and says so", () => {
    expect(consoleLink({ partition: "aws", region: "", service: "ecs" })).toBeNull()
    const outcome = consoleLinkOutcome({ partition: "aws", region: "", service: "ecs" })
    expect(outcome.state).toBe("NO_LINK")
    if (outcome.state === "NO_LINK") expect(outcome.because).toContain("no region")
  })
})

/* ================================================== 2. region ↔ partition == */

describe("a region is placed in a partition, and a mismatch is refused", () => {
  test("each prefix resolves to the partition it names", () => {
    expect(partitionOfRegion("eu-west-2")).toBe("aws")
    expect(partitionOfRegion("us-east-1")).toBe("aws")
    expect(partitionOfRegion("ap-southeast-4")).toBe("aws")
    expect(partitionOfRegion("us-gov-west-1")).toBe("aws-us-gov")
    expect(partitionOfRegion("cn-northwest-1")).toBe("aws-cn")
  })

  test("an air-gapped region is null, NOT commercial", () => {
    // Classifying these as `aws` would build a commercial-console URL for a
    // resource in an isolated partition — a link to an account that is not the
    // one the operator is looking at.
    expect(partitionOfRegion("us-iso-east-1")).toBeNull()
    expect(partitionOfRegion("us-isob-east-1")).toBeNull()
    expect(partitionOfRegion("eu-isoe-west-1")).toBeNull()
  })

  test("something that is not a region name is null", () => {
    expect(partitionOfRegion("")).toBeNull()
    expect(partitionOfRegion("global")).toBeNull()
    expect(partitionOfRegion("EU-WEST-2")).toBeNull()
    expect(partitionOfRegion("../../etc")).toBeNull()
  })

  test("a commercial partition holding a China region builds NO link", () => {
    // This context could only be assembled by combining a partition from one
    // source with a region from another. The link it would produce points at a
    // real console page for an account that is not this one.
    const crossed: ConsoleContext = { partition: "aws", region: "cn-north-1", accountId: "123456789012" }
    const outcome = resourceConsoleLinkOutcome(crossed, { kind: "vpc", vpcId: "vpc-0abc1234" })
    expect(outcome.state).toBe("NO_LINK")
    if (outcome.state === "NO_LINK") {
      expect(outcome.because).toContain("belongs to partition aws-cn")
    }
    expect(resourceConsoleLink(crossed, { kind: "vpc", vpcId: "vpc-0abc1234" })).toBeNull()
  })

  test("a GovCloud region under the commercial partition builds NO link", () => {
    expect(
      resourceConsoleLink(
        { partition: "aws", region: "us-gov-west-1", accountId: "123456789012" },
        { kind: "dynamodb-table", tableName: "tenure-tenants" },
      ),
    ).toBeNull()
  })
})

/* ================================================= 3. global has no region == */

describe("a global service's URL carries no region", () => {
  test("IAM: no region in the host, no region in the query", () => {
    const url = resourceConsoleLink(COMMERCIAL, { kind: "iam-role", roleName: "tenure-studio-read" })
    expect(url).toBe("https://console.aws.amazon.com/iam/home#/roles/details/tenure-studio-read")
    expect(url).not.toContain("eu-west-2")
    expect(url).not.toContain("region=")
  })

  test("Route 53: no region anywhere", () => {
    const url = resourceConsoleLink(COMMERCIAL, { kind: "hosted-zone", hostedZoneId: "Z0123456789ABCDEFGHIJ" })
    expect(url).toBe(
      "https://console.aws.amazon.com/route53/v2/hostedzones#ListRecordSets/Z0123456789ABCDEFGHIJ",
    )
    expect(url).not.toContain("region")
  })

  test("Route 53 accepts the /hostedzone/ prefix the API returns", () => {
    expect(
      resourceConsoleLink(COMMERCIAL, { kind: "hosted-zone", hostedZoneId: "/hostedzone/Z0123456789ABCDEFGHIJ" }),
    ).toBe("https://console.aws.amazon.com/route53/v2/hostedzones#ListRecordSets/Z0123456789ABCDEFGHIJ")
  })

  test("CloudFront: no region anywhere", () => {
    const url = resourceConsoleLink(COMMERCIAL, {
      kind: "cloudfront-distribution",
      distributionId: "E1AAAAAAAAAAAA",
    })
    expect(url).toBe("https://console.aws.amazon.com/cloudfront/v4/home#/distributions/E1AAAAAAAAAAAA")
    expect(url).not.toContain("region")
  })

  test("WAF at CLOUDFRONT scope carries the literal region=global, not the identity's region", () => {
    const url = resourceConsoleLink(COMMERCIAL, {
      kind: "waf-web-acl",
      wafScope: "CLOUDFRONT",
      name: "tenure-edge",
      webAclId: "11111111-2222-3333-4444-555555555555",
    })
    expect(url).toBe(
      "https://console.aws.amazon.com/wafv2/homev2/web-acl/tenure-edge/" +
        "11111111-2222-3333-4444-555555555555/overview?region=global",
    )
    expect(url).not.toContain("eu-west-2")
  })

  test("WAF at REGIONAL scope carries the identity's region, and the host is regional", () => {
    expect(
      resourceConsoleLink(COMMERCIAL, {
        kind: "waf-web-acl",
        wafScope: "REGIONAL",
        name: "tenure-alb",
        webAclId: "11111111-2222-3333-4444-555555555555",
      }),
    ).toBe(
      "https://eu-west-2.console.aws.amazon.com/wafv2/homev2/web-acl/tenure-alb/" +
        "11111111-2222-3333-4444-555555555555/overview?region=eu-west-2",
    )
  })

  test("S3 is the third case: global host, and the bucket's region in the query", () => {
    expect(resourceConsoleLink(COMMERCIAL, { kind: "s3-bucket", bucketName: "tenure-evidence" })).toBe(
      "https://console.aws.amazon.com/s3/buckets/tenure-evidence?region=eu-west-2",
    )
  })

  test("the two edge services are refused outside the commercial partition", () => {
    // Not because linking is impossible but because the page is not there. A
    // link into a console with no CloudFront section is a dead end wearing the
    // right account number.
    const outcome = resourceConsoleLinkOutcome(CHINA, {
      kind: "cloudfront-distribution",
      distributionId: "E1AAAAAAAAAAAA",
    })
    expect(outcome.state).toBe("NO_LINK")
    if (outcome.state === "NO_LINK") expect(outcome.because).toContain("partition aws-cn")
    expect(
      resourceConsoleLink(GOVCLOUD, { kind: "hosted-zone", hostedZoneId: "Z0123456789ABCDEFGHIJ" }),
    ).toBeNull()
  })
})

/* ================================================== 4. the host, per partition == */

describe("every regional link takes its host from the partition", () => {
  test("the same resource in three partitions gives three hosts", () => {
    const table: ConsoleResource = { kind: "dynamodb-table", tableName: "tenure-tenants" }
    expect(resourceConsoleLink(COMMERCIAL, table)).toBe(
      "https://eu-west-2.console.aws.amazon.com/dynamodbv2/home?region=eu-west-2#table?name=tenure-tenants",
    )
    expect(resourceConsoleLink(GOVCLOUD, table)).toBe(
      "https://us-gov-west-1.console.amazonaws-us-gov.com/dynamodbv2/home?region=us-gov-west-1" +
        "#table?name=tenure-tenants",
    )
    expect(resourceConsoleLink(CHINA, table)).toBe(
      "https://cn-north-1.console.amazonaws.cn/dynamodbv2/home?region=cn-north-1#table?name=tenure-tenants",
    )
  })

  test("an unnamed partition produces no link and names the ones it knows", () => {
    const outcome = resourceConsoleLinkOutcome(
      { partition: "aws-iso-b", region: "us-isob-east-1", accountId: "123456789012" },
      { kind: "dynamodb-table", tableName: "tenure-tenants" },
    )
    expect(outcome.state).toBe("NO_LINK")
    if (outcome.state === "NO_LINK") {
      expect(outcome.because).toContain("aws-iso-b")
      expect(outcome.because).toContain("aws-us-gov")
    }
  })

  test("no link contains a hardcoded commercial host when the partition is not commercial", () => {
    // The failure this sweep exists for: one entry in the table written with
    // `console.aws.amazon.com` in its path instead of taking it from `render`.
    const everyKind: readonly ConsoleResource[] = SAMPLE_OF_EVERY_KIND(GOVCLOUD)
    for (const resource of everyKind) {
      const url = resourceConsoleLink(GOVCLOUD, resource)
      if (url === null) continue
      expect(url).not.toContain("console.aws.amazon.com")
      expect(url).toContain("console.amazonaws-us-gov.com")
    }
  })
})

/* ========================================================= 5. ARN safety == */

describe("an ARN that is not this account's produces no link", () => {
  const arnOf = (account: string, region = "eu-west-2", partition = "aws") =>
    `arn:${partition}:acm:${region}:${account}:certificate/11111111-2222-3333-4444-555555555555`

  test("the certificate in this account links", () => {
    expect(
      resourceConsoleLink(COMMERCIAL, { kind: "acm-certificate", certificateArn: arnOf("123456789012") }),
    ).toBe(
      "https://eu-west-2.console.aws.amazon.com/acm/home?region=eu-west-2" +
        "#/certificates/11111111-2222-3333-4444-555555555555",
    )
  })

  test("a certificate in ANOTHER account produces no link", () => {
    const outcome = resourceConsoleLinkOutcome(COMMERCIAL, {
      kind: "acm-certificate",
      certificateArn: arnOf("210987654321"),
    })
    expect(outcome.state).toBe("NO_LINK")
    if (outcome.state === "NO_LINK") {
      expect(outcome.because).toContain("210987654321")
      expect(outcome.because).toContain("worse than no link")
    }
  })

  test("a certificate in another region, or another partition, produces no link", () => {
    expect(
      resourceConsoleLink(COMMERCIAL, {
        kind: "acm-certificate",
        certificateArn: arnOf("123456789012", "us-east-1"),
      }),
    ).toBeNull()
    expect(
      resourceConsoleLink(COMMERCIAL, {
        kind: "acm-certificate",
        certificateArn: arnOf("123456789012", "eu-west-2", "aws-cn"),
      }),
    ).toBeNull()
  })

  test("the WRONG KIND of ARN produces no link, even in the right account", () => {
    // A load balancer ARN handed to the certificate arm would otherwise compose
    // a plausible /acm/ URL to nothing.
    const outcome = resourceConsoleLinkOutcome(COMMERCIAL, {
      kind: "acm-certificate",
      certificateArn:
        "arn:aws:elasticloadbalancing:eu-west-2:123456789012:loadbalancer/app/tenure/1111111111111111",
    })
    expect(outcome.state).toBe("NO_LINK")
    if (outcome.state === "NO_LINK") expect(outcome.because).toContain("elasticloadbalancing ARN")
  })

  test("a string that is not an ARN produces no link", () => {
    expect(
      resourceConsoleLink(COMMERCIAL, { kind: "secret", secretArn: "tenure/database/password" }),
    ).toBeNull()
    expect(resourceConsoleLink(COMMERCIAL, { kind: "cloudtrail-trail", trailArn: "" })).toBeNull()
  })

  test("an ACM ARN naming something other than a certificate produces no link", () => {
    // Same service, same account, same region — and still not a certificate.
    // The resource type is read from `tags.ts`'s parser rather than from a
    // prefix test here, so a fix to its colon/slash rule reaches this arm.
    const outcome = resourceConsoleLinkOutcome(COMMERCIAL, {
      kind: "acm-certificate",
      certificateArn: "arn:aws:acm:eu-west-2:123456789012:certificate-authority/1111",
    })
    expect(outcome.state).toBe("NO_LINK")
    if (outcome.state === "NO_LINK") expect(outcome.because).toContain("does not name a certificate")
  })

  test("a Secrets Manager ARN goes into the query WHOLE, colons and all", () => {
    // The console's `name` parameter takes the entire ARN. Passing a parsed
    // fragment — or one truncated at the `secret:` separator — opens the secret
    // list instead of the secret, which reads as "the secret is not there".
    expect(
      resourceConsoleLink(COMMERCIAL, {
        kind: "secret",
        secretArn: "arn:aws:secretsmanager:eu-west-2:123456789012:secret:tenure/db-AbCdEf",
      }),
    ).toBe(
      "https://eu-west-2.console.aws.amazon.com/secretsmanager/secret" +
        "?name=arn%3Aaws%3Asecretsmanager%3Aeu-west-2%3A123456789012%3Asecret%3Atenure%2Fdb-AbCdEf" +
        "&region=eu-west-2",
    )
  })

  test("an ECR repository in a different registry account produces no link", () => {
    const outcome = resourceConsoleLinkOutcome(COMMERCIAL, {
      kind: "ecr-repository",
      registryId: "210987654321",
      repositoryName: "tenure-web",
    })
    expect(outcome.state).toBe("NO_LINK")
    if (outcome.state === "NO_LINK") expect(outcome.because).toContain("210987654321")
  })
})

/* ============================================== 6. identifiers and encoding == */

describe("an identifier that does not parse produces no link, never a truncated URL", () => {
  test.each([
    ["vpc", { kind: "vpc", vpcId: "not-a-vpc" } as ConsoleResource],
    ["subnet", { kind: "subnet", subnetId: "vpc-0abc1234" } as ConsoleResource],
    ["security group", { kind: "security-group", groupId: "" } as ConsoleResource],
    ["kms key", { kind: "kms-key", keyId: "alias/tenure" } as ConsoleResource],
    ["distribution", { kind: "cloudfront-distribution", distributionId: "e1lowercase" } as ConsoleResource],
    ["bucket", { kind: "s3-bucket", bucketName: "Tenure-Evidence" } as ConsoleResource],
    ["bucket with a slash", { kind: "s3-bucket", bucketName: "tenure/evidence" } as ConsoleResource],
    ["hosted zone", { kind: "hosted-zone", hostedZoneId: "example.test." } as ConsoleResource],
    ["image digest", {
      kind: "ecr-image",
      registryId: "123456789012",
      repositoryName: "tenure-web",
      imageDigest: "latest",
    } as ConsoleResource],
    ["guardduty finding", { kind: "guardduty-finding", findingId: "not hex" } as ConsoleResource],
    ["iam role", { kind: "iam-role", roleName: "tenure/read" } as ConsoleResource],
  ])("%s: a malformed identifier is null", (_label, resource) => {
    expect(resourceConsoleLink(COMMERCIAL, resource)).toBeNull()
  })

  test("a log group name is encoded the way logsV2 reads it — twice, with $", () => {
    // Encoded once, the console resolves the URL to nothing, which for a log
    // group is indistinguishable from a log group with no events.
    expect(resourceConsoleLink(COMMERCIAL, { kind: "log-group", logGroupName: "/aws/ecs/tenure-web" })).toBe(
      "https://eu-west-2.console.aws.amazon.com/cloudwatch/home?region=eu-west-2" +
        "#logsV2:log-groups/log-group/$252Faws$252Fecs$252Ftenure-web",
    )
  })

  test("a log stream is encoded the same way, both segments", () => {
    expect(
      resourceConsoleLink(COMMERCIAL, {
        kind: "log-stream",
        logGroupName: "/aws/ecs/tenure-web",
        logStreamName: "ecs/web/1111111111111111",
      }),
    ).toBe(
      "https://eu-west-2.console.aws.amazon.com/cloudwatch/home?region=eu-west-2" +
        "#logsV2:log-groups/log-group/$252Faws$252Fecs$252Ftenure-web" +
        "/log-events/ecs$252Fweb$252F1111111111111111",
    )
  })

  test("an ECS task link carries the cluster AND the task", () => {
    expect(
      resourceConsoleLink(COMMERCIAL, {
        kind: "ecs-task",
        clusterName: "tenure-prod",
        taskId: "1111111111111111aaaaaaaaaaaaaaaa",
      }),
    ).toBe(
      "https://eu-west-2.console.aws.amazon.com/ecs/v2/clusters/tenure-prod" +
        "/tasks/1111111111111111aaaaaaaaaaaaaaaa?region=eu-west-2",
    )
  })

  test("an ECS service link carries the cluster AND the service", () => {
    expect(
      resourceConsoleLink(COMMERCIAL, {
        kind: "ecs-service",
        clusterName: "tenure-prod",
        serviceName: "tenure-web",
      }),
    ).toBe(
      "https://eu-west-2.console.aws.amazon.com/ecs/v2/clusters/tenure-prod" +
        "/services/tenure-web?region=eu-west-2",
    )
  })

  test("a service quota link carries the service code AND the quota code", () => {
    expect(
      resourceConsoleLink(COMMERCIAL, { kind: "service-quota", serviceCode: "vpc", quotaCode: "L-F678F1CE" }),
    ).toBe(
      "https://eu-west-2.console.aws.amazon.com/servicequotas/home/services/vpc/quotas/L-F678F1CE" +
        "?region=eu-west-2",
    )
  })

  test("an ElastiCache engine with no console route is refused, not guessed", () => {
    const outcome = resourceConsoleLinkOutcome(COMMERCIAL, {
      kind: "elasticache-cluster",
      engine: "an-engine-this-module-does-not-know",
      clusterId: "tenure-sessions-001",
    })
    expect(outcome.state).toBe("NO_LINK")
    if (outcome.state === "NO_LINK") expect(outcome.because).toContain("no console route")

    expect(
      resourceConsoleLink(COMMERCIAL, {
        kind: "elasticache-cluster",
        engine: "Redis",
        clusterId: "tenure-sessions-001",
      }),
    ).toBe(
      "https://eu-west-2.console.aws.amazon.com/elasticache/home?region=eu-west-2" +
        "#/redis/tenure-sessions-001",
    )
  })

  test("a metric graph carries the namespace, the metric, its dimensions and the region", () => {
    const url = resourceConsoleLink(COMMERCIAL, {
      kind: "cloudwatch-metric",
      namespace: "AWS/ECS",
      metricName: "CPUUtilization",
      dimensions: [
        { name: "ClusterName", value: "tenure-prod" },
        { name: "ServiceName", value: "tenure-web" },
      ],
      stat: "Average",
      periodSeconds: 300,
    })
    expect(url).not.toBeNull()
    const graph = JSON.parse(decodeURIComponent(String(url).split("graph=")[1]))
    expect(graph.metrics).toEqual([
      ["AWS/ECS", "CPUUtilization", "ClusterName", "tenure-prod", "ServiceName", "tenure-web"],
    ])
    expect(graph.region).toBe("eu-west-2")
    expect(graph.period).toBe(300)
    expect(graph.stat).toBe("Average")
  })

  test("a metric dimension order is the reader's order, not sorted", () => {
    // Re-sorting would graph a different metric from the one the surface read.
    const url = String(
      resourceConsoleLink(COMMERCIAL, {
        kind: "cloudwatch-metric",
        namespace: "AWS/ECS",
        metricName: "CPUUtilization",
        dimensions: [
          { name: "ServiceName", value: "tenure-web" },
          { name: "ClusterName", value: "tenure-prod" },
        ],
        stat: "Average",
        periodSeconds: 300,
      }),
    )
    const graph = JSON.parse(decodeURIComponent(url.split("graph=")[1]))
    expect(graph.metrics[0].slice(2)).toEqual([
      "ServiceName",
      "tenure-web",
      "ClusterName",
      "tenure-prod",
    ])
  })

  test("a metric with a period of zero produces no link", () => {
    expect(
      resourceConsoleLink(COMMERCIAL, {
        kind: "cloudwatch-metric",
        namespace: "AWS/ECS",
        metricName: "CPUUtilization",
        dimensions: [],
        stat: "Average",
        periodSeconds: 0,
      }),
    ).toBeNull()
  })
})

/* ================================================= 7. nothing goes missing == */

describe("every kind this module advertises actually builds a link", () => {
  test("linkableResourceKinds is exactly the kinds SAMPLE_OF_EVERY_KIND covers", () => {
    const advertised = [...linkableResourceKinds()].sort()
    const sampled = SAMPLE_OF_EVERY_KIND(COMMERCIAL)
      .map((r) => r.kind)
      .sort()
    expect(sampled).toEqual(advertised)
  })

  test("each one produces an absolute https URL in the resolved partition", () => {
    for (const resource of SAMPLE_OF_EVERY_KIND(COMMERCIAL)) {
      const url = resourceConsoleLink(COMMERCIAL, resource)
      expect(url).not.toBeNull()
      const value = String(url)
      expect(value.startsWith("https://")).toBe(true)
      expect(value).toContain("console.aws.amazon.com")
      // No unsubstituted template, no dangling separator, no empty segment.
      expect(value).not.toContain("${")
      expect(value).not.toContain("undefined")
      // An empty path segment is what a missing identifier looks like once it
      // has been concatenated. Checked after the scheme's own `//`.
      expect(value.slice("https://".length)).not.toContain("//")
    }
  })

  test("a URL is never built with the literal string 'null' in a path segment", () => {
    for (const resource of SAMPLE_OF_EVERY_KIND(COMMERCIAL)) {
      expect(String(resourceConsoleLink(COMMERCIAL, resource))).not.toMatch(/\/null(\/|$|\?|#)/)
    }
  })
})

/* ======================================= 8. a reading's own placement == */

describe("a reading's stated placement is reconciled with the resolved identity", () => {
  /** The identity resolved `eu-west-2`. The estate is not only in eu-west-2. */
  const IN_US_EAST: StatedPlacement = {
    partition: "aws",
    region: "us-east-1",
    accountId: "123456789012",
  }

  test("a stated region in the same account wins over the identity's region", () => {
    // A GuardDuty finding genuinely in us-east-1, read by a console whose
    // identity resolved eu-west-2. Building this against eu-west-2 opens a page
    // with no such finding, which reads as "the finding is gone".
    const outcome = resourceConsoleLinkForReading(COMMERCIAL, IN_US_EAST, {
      kind: "guardduty-finding",
      findingId: "1111111111111111aaaaaaaaaaaaaaaa",
    })
    expect(outcome.state).toBe("LINK")
    if (outcome.state === "LINK") {
      expect(outcome.url).toBe(
        "https://us-east-1.console.aws.amazon.com/guardduty/home?region=us-east-1" +
          "#/findings?macros=current&fId=1111111111111111aaaaaaaaaaaaaaaa",
      )
      expect(outcome.url).not.toContain("eu-west-2")
    }
  })

  test("the stated region reaches the ARN check too, not just the host", () => {
    // The ARN is in us-east-1 and the identity resolved eu-west-2. If the
    // reconciled context did not carry the stated region, `arnFits` would refuse
    // an ARN that is perfectly correct.
    const arn = "arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555"
    expect(
      resourceConsoleLinkForReading(COMMERCIAL, IN_US_EAST, { kind: "acm-certificate", certificateArn: arn }),
    ).toEqual({
      state: "LINK",
      url:
        "https://us-east-1.console.aws.amazon.com/acm/home?region=us-east-1" +
        "#/certificates/11111111-2222-3333-4444-555555555555",
    })
    // And the converse: an eu-west-2 ARN under a us-east-1 placement is refused
    // rather than opened in the wrong region.
    const wrong = resourceConsoleLinkForReading(COMMERCIAL, IN_US_EAST, {
      kind: "acm-certificate",
      certificateArn: "arn:aws:acm:eu-west-2:123456789012:certificate/11111111-2222-3333-4444-555555555555",
    })
    expect(wrong.state).toBe("NO_LINK")
  })

  test("a reading in ANOTHER account produces no link, and names both accounts", () => {
    const outcome = resourceConsoleLinkForReading(
      COMMERCIAL,
      { partition: "aws", region: "eu-west-2", accountId: "210987654321" },
      { kind: "dynamodb-table", tableName: "tenure-tenants" },
    )
    expect(outcome.state).toBe("NO_LINK")
    if (outcome.state === "NO_LINK") {
      expect(outcome.because).toContain("210987654321")
      expect(outcome.because).toContain("123456789012")
      expect(outcome.because).toContain("worse than no link")
    }
  })

  test("a reading that states nothing falls back to the identity, whole", () => {
    // The case where AWS returned no ARN. Every reader documents this fallback;
    // this is where it happens, once.
    const nothing: StatedPlacement = { partition: null, region: null, accountId: null }
    expect(consoleContextForReading(COMMERCIAL, nothing)).toEqual({
      state: "CONTEXT",
      context: { partition: "aws", region: "eu-west-2", accountId: "123456789012" },
    })
    expect(
      resourceConsoleLinkForReading(COMMERCIAL, nothing, { kind: "dynamodb-table", tableName: "tenure-tenants" }),
    ).toEqual({
      state: "LINK",
      url:
        "https://eu-west-2.console.aws.amazon.com/dynamodbv2/home?region=eu-west-2#table?name=tenure-tenants",
    })
  })

  test("a blank string is not a placement — it falls back rather than blanking the link", () => {
    expect(
      consoleContextForReading(COMMERCIAL, { partition: "  ", region: "", accountId: "" }),
    ).toEqual({
      state: "CONTEXT",
      context: { partition: "aws", region: "eu-west-2", accountId: "123456789012" },
    })
  })

  test("an identity with no account produces no link at all", () => {
    // `consoleLinkOutcome` synthesises an empty account for a service HOME page,
    // which needs none. A resource link is not that: it is a link into one
    // account, and without knowing which, it is the unsafe path this module
    // replaces.
    const outcome = resourceConsoleLinkForReading(
      { partition: "aws", region: "eu-west-2", accountId: "" },
      { partition: null, region: null, accountId: null },
      { kind: "dynamodb-table", tableName: "tenure-tenants" },
    )
    expect(outcome.state).toBe("NO_LINK")
    if (outcome.state === "NO_LINK") expect(outcome.because).toContain("did not resolve to an account")
  })

  test("a stated partition and a stated region that disagree are refused", () => {
    // Not checked twice: `render` owns this, and the sentence it produces names
    // both. Asserted here because the reconcile is what hands it the pair.
    const outcome = resourceConsoleLinkForReading(
      COMMERCIAL,
      { partition: "aws", region: "cn-north-1", accountId: "123456789012" },
      { kind: "dynamodb-table", tableName: "tenure-tenants" },
    )
    expect(outcome.state).toBe("NO_LINK")
    if (outcome.state === "NO_LINK") expect(outcome.because).toContain("belongs to partition aws-cn")
  })

  test("a stated GovCloud placement builds a GovCloud host under a GovCloud identity", () => {
    expect(
      resourceConsoleLinkForReading(
        GOVCLOUD,
        { partition: "aws-us-gov", region: "us-gov-east-1", accountId: "123456789012" },
        { kind: "dynamodb-table", tableName: "tenure-tenants" },
      ),
    ).toEqual({
      state: "LINK",
      url:
        "https://us-gov-east-1.console.amazonaws-us-gov.com/dynamodbv2/home?region=us-gov-east-1" +
        "#table?name=tenure-tenants",
    })
  })
})

/* ============================ 9. the readings actually carry these fields == */

/**
 * `tsc`, not a comment, proves the readers feed this module.
 *
 * These three functions are never called. They exist so that a reader renaming
 * `TableReading.name`, or dropping `GuardDutyFinding.id`, or turning
 * `VpcReading.ownerId` into something else, fails the type-check on THIS file —
 * the failure mode being a link table that still compiles because its callers
 * pass strings from somewhere else, and quietly stops linking anything.
 *
 * `VpcReading` is the one that earns its place twice: EC2 calls the account
 * `ownerId`, and this is where that mapping is written down and checked.
 */
function linkFromTableReading(identity: ConsoleContext, table: TableReading) {
  return resourceConsoleLinkForReading(
    identity,
    { partition: table.partition, region: table.region, accountId: table.accountId },
    { kind: "dynamodb-table", tableName: table.name },
  )
}

function linkFromGuardDutyFinding(identity: ConsoleContext, finding: GuardDutyFinding) {
  return resourceConsoleLinkForReading(
    identity,
    { partition: finding.partition, region: finding.region, accountId: finding.accountId },
    { kind: "guardduty-finding", findingId: finding.id },
  )
}

function linkFromVpcReading(identity: ConsoleContext, vpc: VpcReading) {
  return resourceConsoleLinkForReading(
    identity,
    { partition: vpc.partition, region: vpc.region, accountId: vpc.ownerId },
    { kind: "vpc", vpcId: vpc.vpcId },
  )
}

test("the reader-shaped bridges are real functions, not declarations", () => {
  // Calling them keeps `noUnusedLocals` honest and proves the composition runs,
  // with readings assembled by hand here — no reader is loaded by this file.
  const table: Pick<TableReading, "name" | "region" | "partition" | "accountId"> = {
    name: "tenure-tenants",
    region: "eu-west-2",
    partition: "aws",
    accountId: "123456789012",
  }
  expect(linkFromTableReading(COMMERCIAL, table as TableReading).state).toBe("LINK")

  const finding: Pick<GuardDutyFinding, "id" | "region" | "partition" | "accountId"> = {
    id: "1111111111111111aaaaaaaaaaaaaaaa",
    region: "us-east-1",
    partition: "aws",
    accountId: "123456789012",
  }
  const findingLink = linkFromGuardDutyFinding(COMMERCIAL, finding as GuardDutyFinding)
  expect(findingLink.state).toBe("LINK")
  if (findingLink.state === "LINK") expect(findingLink.url).toContain("us-east-1")

  const vpc: Pick<VpcReading, "vpcId" | "region" | "partition" | "ownerId"> = {
    vpcId: "vpc-0abc1234",
    region: "eu-west-2",
    partition: "aws",
    ownerId: "210987654321",
  }
  // An operator's own console is account 123456789012; this VPC is shared in
  // from another account. No link, rather than one that opens the wrong estate.
  expect(linkFromVpcReading(COMMERCIAL, vpc as VpcReading).state).toBe("NO_LINK")
})

/**
 * One well-formed instance of every arm of `ConsoleResource`.
 *
 * Exhaustive by construction: it is typed as the union, and the assertion above
 * compares its kinds against `linkableResourceKinds()`. An arm added to the
 * union without an entry here fails that comparison rather than being quietly
 * untested — which is how a link table grows a member nobody ever built.
 *
 * The two commercial-only kinds are included; the GovCloud sweep skips whatever
 * comes back null rather than asserting they link there.
 */
function SAMPLE_OF_EVERY_KIND(context: ConsoleContext): readonly ConsoleResource[] {
  const account = context.accountId
  const partition = context.partition
  const region = context.region
  return [
    { kind: "cognito-user-pool", poolId: `${region}_AAAAAAAAA` },
    { kind: "vpc", vpcId: "vpc-0abc1234" },
    { kind: "subnet", subnetId: "subnet-0abc1234" },
    { kind: "security-group", groupId: "sg-0abc1234" },
    {
      kind: "load-balancer",
      loadBalancerArn: `arn:${partition}:elasticloadbalancing:${region}:${account}:loadbalancer/app/tenure/1111111111111111`,
    },
    {
      kind: "target-group",
      targetGroupArn: `arn:${partition}:elasticloadbalancing:${region}:${account}:targetgroup/tenure-web/1111111111111111`,
    },
    { kind: "ecr-repository", registryId: account, repositoryName: "tenure-web" },
    {
      kind: "ecr-image",
      registryId: account,
      repositoryName: "tenure-web",
      imageDigest: `sha256:${"a".repeat(64)}`,
    },
    { kind: "elasticache-cluster", engine: "redis", clusterId: "tenure-sessions-001" },
    { kind: "dynamodb-table", tableName: "tenure-tenants" },
    {
      kind: "cloudwatch-metric",
      namespace: "AWS/ECS",
      metricName: "CPUUtilization",
      dimensions: [{ name: "ClusterName", value: "tenure-prod" }],
      stat: "Average",
      periodSeconds: 300,
    },
    { kind: "cloudwatch-dashboard", dashboardName: "tenure-platform" },
    { kind: "cloudwatch-alarm", alarmName: "tenure-web-5xx" },
    { kind: "log-group", logGroupName: "/aws/ecs/tenure-web" },
    { kind: "log-stream", logGroupName: "/aws/ecs/tenure-web", logStreamName: "ecs/web/1111" },
    { kind: "s3-bucket", bucketName: "tenure-evidence" },
    { kind: "secret", secretArn: `arn:${partition}:secretsmanager:${region}:${account}:secret:tenure/db-AbCdEf` },
    { kind: "kms-key", keyId: "11111111-2222-3333-4444-555555555555" },
    { kind: "cloudtrail-trail", trailArn: `arn:${partition}:cloudtrail:${region}:${account}:trail/tenure-audit` },
    { kind: "config-rule", ruleName: "tenure-s3-encrypted" },
    { kind: "hosted-zone", hostedZoneId: "Z0123456789ABCDEFGHIJ" },
    { kind: "cloudfront-distribution", distributionId: "E1AAAAAAAAAAAA" },
    { kind: "rds-instance", dbInstanceIdentifier: "tenure-prod" },
    { kind: "ecs-cluster", clusterName: "tenure-prod" },
    { kind: "ecs-service", clusterName: "tenure-prod", serviceName: "tenure-web" },
    { kind: "ecs-task", clusterName: "tenure-prod", taskId: "1111111111111111aaaaaaaaaaaaaaaa" },
    {
      kind: "acm-certificate",
      certificateArn: `arn:${partition}:acm:${region}:${account}:certificate/11111111-2222-3333-4444-555555555555`,
    },
    { kind: "service-quota", serviceCode: "vpc", quotaCode: "L-F678F1CE" },
    {
      kind: "access-analyzer",
      analyzerArn: `arn:${partition}:access-analyzer:${region}:${account}:analyzer/tenure-external`,
    },
    { kind: "guardduty-finding", findingId: "1111111111111111aaaaaaaaaaaaaaaa" },
    {
      kind: "waf-web-acl",
      wafScope: "REGIONAL",
      name: "tenure-alb",
      webAclId: "11111111-2222-3333-4444-555555555555",
    },
    { kind: "iam-role", roleName: "tenure-studio-read" },
  ]
}
