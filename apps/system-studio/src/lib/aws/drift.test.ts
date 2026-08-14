import fs from "node:fs"
import path from "node:path"

import {
  DRIFT_SETTINGS,
  MIN_PATTERN_LITERAL,
  declaredNameOf,
  estateDrift,
  findingsOfKind,
  ingressSettingKey,
  observedBuckets,
  observedSecurityGroups,
  observedTables,
  observedUserPools,
  parseTerraformEstate,
  publishedDrift,
  referencedAddress,
  unreadableBecause,
  type TerraformEstate,
  type ObservedResource,
  type ObservedSetting,
  type ObservedSurface,
  type TerraformSource,
} from "./drift"
import type { AwsRead } from "./read"

/**
 * STUDIO-000-009 — declared versus observed, in three kinds.
 *
 * Two halves, and the first is what makes the second worth anything:
 *
 *   1. The declared side is parsed from the REAL `.tf` files in
 *      `infrastructure/`, read off disk. A parser proven only against strings
 *      written in this file proves that the parser agrees with the fixture, and
 *      the fixture is the thing most likely to be wrong. `s3.tf` really does
 *      interpolate the bucket name, `security_groups.tf` really does admit the
 *      CloudFront prefix list on port 80, `cognito.tf` really does say
 *      `mfa_configuration = "ON"`, and `iam.tf` really is 878 lines of
 *      `jsonencode` whose braces would wreck a naive parser.
 *
 *   2. The comparison is driven with reader shapes that carry the `AwsRead`
 *      union verbatim, including its refusal arms, because "we were not allowed
 *      to look" is the input the whole module exists to handle.
 *
 * Every assertion here has been mutation-proven: the behaviour was broken in
 * the module, the test was watched to fail, and the break was reverted.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..")

function terraformSources(relative: string): readonly TerraformSource[] {
  const directory = path.join(REPO_ROOT, relative)
  return fs
    .readdirSync(directory)
    .filter((entry) => entry.endsWith(".tf"))
    .sort()
    .map((entry) => ({
      path: `${relative}/${entry}`,
      text: fs.readFileSync(path.join(directory, entry), "utf8"),
    }))
}

const PILOT = terraformSources("infrastructure/terraform")
const STUDIO = terraformSources("infrastructure/studio")

/* ------------------------------------------------------- the real sources -- */

describe("parseTerraformEstate, against the repository's own Terraform", () => {
  it("reads every .tf in both stacks without a parse gap", () => {
    const declared = parseTerraformEstate([...PILOT, ...STUDIO])
    expect(declared.known).toBe(true)
    expect(declared.files.length).toBe(PILOT.length + STUDIO.length)
    // A parser that fell over on the first heredoc would return a handful.
    expect(declared.resources.length).toBeGreaterThan(50)
  })

  it("reports the documents bucket's interpolated name as a pattern, not a literal", () => {
    const declared = parseTerraformEstate(PILOT)
    const bucket = declared.resources.find((r) => r.address === "aws_s3_bucket.documents")
    expect(bucket).toBeDefined()
    expect(bucket?.resourceType).toBe("s3:bucket")
    expect(bucket?.name.kind).toBe("pattern")
    if (bucket?.name.kind !== "pattern") throw new Error("unreachable")
    expect(bucket.name.segments).toContain("-documents-")
    expect(new RegExp(bucket.name.pattern).test("tenure-pilot-documents-012345678901")).toBe(true)
    expect(new RegExp(bucket.name.pattern).test("tenure-pilot-exports-012345678901")).toBe(false)
  })

  it("attaches the sidecar posture resources to the bucket they configure", () => {
    const declared = parseTerraformEstate(PILOT)
    const bucket = declared.resources.find((r) => r.address === "aws_s3_bucket.documents")
    expect(bucket?.expected.get(DRIFT_SETTINGS.blockPublicAcls)).toBe("true")
    expect(bucket?.expected.get(DRIFT_SETTINGS.restrictPublicBuckets)).toBe("true")
    expect(bucket?.expected.get(DRIFT_SETTINGS.bucketEncryption)).toBe("aws:kms")
    expect(bucket?.expected.get(DRIFT_SETTINGS.bucketVersioning)).toBe("Enabled")
    // The exports bucket declares a public-access block and NO encryption rule.
    // Terraform saying nothing is not Terraform saying "unencrypted", so no
    // encryption expectation may be invented for it.
    const exports = declared.resources.find((r) => r.address === "aws_s3_bucket.exports")
    expect(exports?.expected.get(DRIFT_SETTINGS.blockPublicPolicy)).toBe("true")
    expect(exports?.expected.has(DRIFT_SETTINGS.bucketEncryption)).toBe(false)
    expect(declared.danglingSidecars).toEqual([])
  })

  it("reads the ALB ingress as the CloudFront prefix list, by kind and not by id", () => {
    const declared = parseTerraformEstate(PILOT)
    const alb = declared.resources.find((r) => r.address === "aws_security_group.alb")
    expect(alb?.resourceType).toBe("ec2:security-group")
    expect(alb?.expected.get(ingressSettingKey("tcp", 80, 80))).toBe("prefix-list")
    const rds = declared.resources.find((r) => r.address === "aws_security_group.rds")
    expect(rds?.expected.get(ingressSettingKey("tcp", 5432, 5432))).toBe("security-group")
  })

  it("reads the Studio pool's MFA posture and the registry table's protections", () => {
    const declared = parseTerraformEstate(STUDIO)
    const pool = declared.resources.find((r) => r.address === "aws_cognito_user_pool.studio")
    expect(pool?.expected.get(DRIFT_SETTINGS.mfaConfiguration)).toBe("ON")
    expect(pool?.expected.get(DRIFT_SETTINGS.softwareTokenMfa)).toBe("true")
    expect(pool?.expected.get(DRIFT_SETTINGS.adminCreateUserOnly)).toBe("true")

    const table = declared.resources.find((r) => r.address === "aws_dynamodb_table.tenants")
    expect(table?.expected.get(DRIFT_SETTINGS.tableEncryption)).toBe("true")
    expect(table?.expected.get(DRIFT_SETTINGS.tablePointInTimeRecovery)).toBe("true")
    expect(table?.expected.get(DRIFT_SETTINGS.tableDeletionProtection)).toBe("true")
    expect(table?.expected.get(DRIFT_SETTINGS.tableBillingMode)).toBe("PAY_PER_REQUEST")
  })

  it("does not mistake attributes inside a jsonencode or a heredoc for the resource's own", () => {
    const declared = parseTerraformEstate([...PILOT, ...STUDIO])
    // `aws_ecs_task_definition.app` holds a jsonencode whose container carries
    // `name = "app"`, and iam.tf holds 878 lines of policy documents. A parser
    // that walked into either would attribute those to the enclosing resource
    // and would also lose its place, ending the block early.
    const taskDefinition = declared.resources.find(
      (r) => r.address === "aws_ecs_task_definition.app",
    )
    expect(taskDefinition).toBeDefined()
    expect(taskDefinition?.attributes.get("name")).toBeUndefined()
    // The last resource in the biggest heredoc-and-jsonencode file must still
    // have been reached.
    const studioRoles = declared.resources.filter((r) => r.file.endsWith("/iam.tf"))
    expect(studioRoles.length).toBeGreaterThan(3)
  })

  it("marks count and for_each declarations as meta, never as one certain instance", () => {
    const declared = parseTerraformEstate([...PILOT, ...STUDIO])
    const certificate = declared.resources.find((r) => r.terraformType === "aws_acm_certificate")
    expect(certificate?.multiplicity).toEqual({
      kind: "meta",
      meta: "count",
      expression: 'var.custom_domain != "" ? 1 : 0',
    })
    const operators = declared.resources.find((r) => r.address === "aws_cognito_user.operators")
    expect(operators?.multiplicity.kind).toBe("meta")
  })
})

describe("declaredNameOf", () => {
  it("refuses to build a pattern from a name that is almost entirely interpolated", () => {
    const name = declaredNameOf('"${var.prefix}-${var.suffix}"', "x")
    expect(name.kind).toBe("unresolvable")
    expect("-".length).toBeLessThan(MIN_PATTERN_LITERAL)
  })

  it("treats an unquoted expression as unresolvable rather than as the literal text", () => {
    expect(declaredNameOf("local.name_prefix", "x").kind).toBe("unresolvable")
  })

  it("resolves a fully literal name", () => {
    expect(declaredNameOf('"tenure-pilot-documents"', "x")).toEqual({
      kind: "literal",
      value: "tenure-pilot-documents",
    })
  })
})

describe("referencedAddress", () => {
  it("resolves a sidecar's target and refuses a non-reference", () => {
    expect(referencedAddress("aws_s3_bucket.documents.id")).toBe("aws_s3_bucket.documents")
    expect(referencedAddress('"a-literal-bucket-name"')).toBeNull()
  })
})

/* ------------------------------------------------------- the comparison -- */

const NOW = new Date("2026-08-14T09:00:00.000Z")

function sources(text: string, file = "infrastructure/terraform/test.tf"): TerraformSource[] {
  return [{ path: file, text }]
}

function live(
  overrides: Partial<ObservedResource> & Pick<ObservedResource, "resourceType" | "name">,
): ObservedResource {
  return {
    nameKnown: true,
    arn: null,
    managedBy: { kind: "none" },
    settings: new Map<string, ObservedSetting>(),
    ...overrides,
  }
}

function surface(
  resourceType: string,
  resources: readonly ObservedResource[],
  complete = true,
  incompleteWhy = "",
): ObservedSurface {
  return { kind: "read", resourceType, resources, complete, incompleteWhy }
}

const LITERAL_BUCKET = `resource "aws_s3_bucket" "docs" {
  bucket = "tenure-pilot-documents"
}

resource "aws_s3_bucket_public_access_block" "docs" {
  bucket                  = aws_s3_bucket.docs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
`

describe("estateDrift — declared but absent", () => {
  it("reports a literal declaration nothing answered to, once the listing completed", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(sources(LITERAL_BUCKET)),
      observed: [surface("s3:bucket", [])],
      now: NOW,
    })
    const absent = findingsOfKind(report, "absent")
    expect(absent).toHaveLength(1)
    expect(absent[0].declaredAt).toBe("aws_s3_bucket.docs")
    expect(absent[0].declaredValue).toBe("tenure-pilot-documents")
    expect(absent[0].declaredIn).toBe("infrastructure/terraform/test.tf:1")
  })

  it("reports NOTHING absent when the observed side could not be read", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(sources(LITERAL_BUCKET)),
      observed: [
        {
          kind: "blind",
          resourceType: "s3:bucket",
          because: "s3:ListAllMyBuckets was refused (AccessDenied)",
        },
      ],
      now: NOW,
    })
    expect(findingsOfKind(report, "absent")).toEqual([])
    expect(report.blind).toEqual([
      { resourceType: "s3:bucket", because: "s3:ListAllMyBuckets was refused (AccessDenied)" },
    ])
  })

  it("reports NOTHING absent when the listing was truncated, and says so", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(sources(LITERAL_BUCKET)),
      observed: [surface("s3:bucket", [], false, "stopped at the 20-page bound")],
      now: NOW,
    })
    expect(findingsOfKind(report, "absent")).toEqual([])
    expect(report.uncomparable).toHaveLength(1)
    expect(report.uncomparable[0].because).toContain("stopped at the 20-page bound")
  })

  it("reports a count declaration as un-comparable, never as absent", () => {
    const declared = parseTerraformEstate(
      sources(`resource "aws_acm_certificate" "main" {
  count       = var.custom_domain != "" ? 1 : 0
  domain_name = "console.tenure.example"
}
`),
    )
    const report = estateDrift({
      declared,
      observed: [surface("acm:certificate", [])],
      now: NOW,
    })
    expect(findingsOfKind(report, "absent")).toEqual([])
    expect(report.uncomparable[0].because).toContain("count = var.custom_domain")
  })

  it("reports an interpolated declaration that matched nothing as un-comparable, never as absent", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(
        sources(`resource "aws_dynamodb_table" "tenants" {
  name = "\${local.name_prefix}-tenants"
}
`),
      ),
      observed: [surface("dynamodb:table", [])],
      now: NOW,
    })
    expect(findingsOfKind(report, "absent")).toEqual([])
    expect(report.uncomparable[0].because).toContain("not evidence of absence")
  })
})

describe("estateDrift — present but never declared", () => {
  it("reports a live resource no declaration names", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(sources(LITERAL_BUCKET)),
      observed: [
        surface("s3:bucket", [
          live({ resourceType: "s3:bucket", name: "tenure-pilot-documents" }),
          live({ resourceType: "s3:bucket", name: "someones-scratch-bucket" }),
        ]),
      ],
      now: NOW,
    })
    const undeclared = findingsOfKind(report, "undeclared")
    expect(undeclared).toHaveLength(1)
    expect(undeclared[0].observed).toBe("someones-scratch-bucket")
    expect(undeclared[0].severity).toBe("costly")
  })

  it("does NOT report it when an unresolvable declaration of the same type exists", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(
        sources(`resource "aws_s3_bucket" "docs" {
  bucket = "\${local.name_prefix}-documents-\${local.account_id}"
}
`),
      ),
      observed: [surface("s3:bucket", [live({ resourceType: "s3:bucket", name: "unrelated" })])],
      now: NOW,
    })
    expect(findingsOfKind(report, "undeclared")).toEqual([])
    expect(report.uncomparable[0].because).toContain("resolve only after an apply")
  })

  it("does NOT report it when the resource says Terraform manages it", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(sources(LITERAL_BUCKET)),
      observed: [
        surface("s3:bucket", [
          live({
            resourceType: "s3:bucket",
            name: "from-another-stack",
            managedBy: { kind: "declared", by: "terraform" },
          }),
        ]),
      ],
      now: NOW,
    })
    expect(findingsOfKind(report, "undeclared")).toEqual([])
    expect(report.uncomparable[0].because).toContain("another stack almost certainly does")
  })

  it("does NOT report a live resource whose name the reader could not obtain", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(sources(LITERAL_BUCKET)),
      observed: [
        surface("ec2:security-group", [
          live({ resourceType: "ec2:security-group", name: "sg-0abc", nameKnown: false }),
        ]),
      ],
      now: NOW,
    })
    expect(findingsOfKind(report, "undeclared")).toEqual([])
    expect(report.uncomparable[0].because).toContain("manufactured by our own blind spot")
  })

  it("says the finding rests on the source alone when the management tag was not read", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(sources(LITERAL_BUCKET)),
      observed: [
        surface("s3:bucket", [
          live({
            resourceType: "s3:bucket",
            name: "console-made",
            managedBy: { kind: "unread", why: "s3:GetBucketTagging was refused (AccessDenied)" },
          }),
        ]),
      ],
      now: NOW,
    })
    const undeclared = findingsOfKind(report, "undeclared")
    expect(undeclared).toHaveLength(1)
    expect(undeclared[0].detail).toContain("s3:GetBucketTagging was refused (AccessDenied)")
  })
})

describe("estateDrift — declared and present but different", () => {
  it("reports a public-access flag that was turned off underneath the declaration", () => {
    const settings = new Map<string, ObservedSetting>([
      [DRIFT_SETTINGS.blockPublicAcls, { kind: "value", value: "true" }],
      [DRIFT_SETTINGS.blockPublicPolicy, { kind: "value", value: "true" }],
      [DRIFT_SETTINGS.ignorePublicAcls, { kind: "value", value: "true" }],
      [DRIFT_SETTINGS.restrictPublicBuckets, { kind: "value", value: "false" }],
    ])
    const report = estateDrift({
      declared: parseTerraformEstate(sources(LITERAL_BUCKET)),
      observed: [
        surface("s3:bucket", [
          live({ resourceType: "s3:bucket", name: "tenure-pilot-documents", settings }),
        ]),
      ],
      now: NOW,
    })
    const divergent = findingsOfKind(report, "divergent")
    expect(divergent).toHaveLength(1)
    expect(divergent[0].setting).toBe(DRIFT_SETTINGS.restrictPublicBuckets)
    expect(divergent[0].declaredValue).toBe("true")
    expect(divergent[0].observedValue).toBe("false")
    expect(divergent[0].severity).toBe("posture")
  })

  it("compares a resource matched by its interpolated name's literal segments", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(
        sources(`resource "aws_cognito_user_pool" "studio" {
  name              = "\${local.name_prefix}-operators"
  mfa_configuration = "ON"
}
`),
      ),
      observed: [
        surface("cognito-idp:userpool", [
          live({
            resourceType: "cognito-idp:userpool",
            name: "tenure-studio-operators",
            settings: new Map([
              [DRIFT_SETTINGS.mfaConfiguration, { kind: "value", value: "OPTIONAL" }],
            ]),
          }),
        ]),
      ],
      now: NOW,
    })
    const divergent = findingsOfKind(report, "divergent")
    expect(divergent).toHaveLength(1)
    expect(divergent[0].observedValue).toBe("OPTIONAL")
    expect(findingsOfKind(report, "undeclared")).toEqual([])
  })

  it("declines to compare when two interpolated declarations match one live resource", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(
        sources(`resource "aws_dynamodb_table" "a" {
  name = "\${local.prefix}-tenants"
}

resource "aws_dynamodb_table" "b" {
  name = "\${local.other}-tenants"
}
`),
      ),
      observed: [
        surface("dynamodb:table", [live({ resourceType: "dynamodb:table", name: "x-tenants" })]),
      ],
      now: NOW,
    })
    expect(report.findings).toEqual([])
    expect(report.uncomparable.some((item) => item.because.includes("2 interpolated declarations"))).toBe(
      true,
    )
  })

  it("reports a security-group source that changed from the prefix list to the world", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(
        sources(`resource "aws_security_group" "alb" {
  name = "tenure-pilot-alb"

  ingress {
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cf.id]
  }
}
`),
      ),
      observed: [
        surface("ec2:security-group", [
          live({
            resourceType: "ec2:security-group",
            name: "tenure-pilot-alb",
            settings: new Map([
              [ingressSettingKey("tcp", 80, 80), { kind: "value", value: "cidr:0.0.0.0/0" }],
            ]),
          }),
        ]),
      ],
      now: NOW,
    })
    const divergent = findingsOfKind(report, "divergent")
    expect(divergent).toHaveLength(1)
    expect(divergent[0].setting).toBe(ingressSettingKey("tcp", 80, 80))
    expect(divergent[0].observedValue).toBe("cidr:0.0.0.0/0")
    expect(divergent[0].severity).toBe("posture")
  })

  it("reports an ingress rule that exists in AWS and in no declaration", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(
        sources(`resource "aws_security_group" "rds" {
  name = "tenure-pilot-rds"

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }
}
`),
      ),
      observed: [
        surface("ec2:security-group", [
          live({
            resourceType: "ec2:security-group",
            name: "tenure-pilot-rds",
            settings: new Map<string, ObservedSetting>([
              [ingressSettingKey("tcp", 5432, 5432), { kind: "value", value: "security-group" }],
              [ingressSettingKey("tcp", 22, 22), { kind: "value", value: "cidr:0.0.0.0/0" }],
            ]),
          }),
        ]),
      ],
      now: NOW,
    })
    const divergent = findingsOfKind(report, "divergent")
    expect(divergent).toHaveLength(1)
    expect(divergent[0].setting).toBe(ingressSettingKey("tcp", 22, 22))
    expect(divergent[0].declaredValue).toBeNull()
    expect(divergent[0].detail).toContain("Somebody opened it outside the declaration")
  })

  it("does not report an added ingress rule on a group whose ingress is not declared here", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(
        sources(`resource "aws_security_group" "rds" {
  name = "tenure-pilot-rds"
}
`),
      ),
      observed: [
        surface("ec2:security-group", [
          live({
            resourceType: "ec2:security-group",
            name: "tenure-pilot-rds",
            settings: new Map<string, ObservedSetting>([
              [ingressSettingKey("tcp", 22, 22), { kind: "value", value: "cidr:0.0.0.0/0" }],
            ]),
          }),
        ]),
      ],
      now: NOW,
    })
    expect(report.findings).toEqual([])
  })

  it("ranks a billing-mode change as cosmetic and a protection change as posture", () => {
    const declared = parseTerraformEstate(
      sources(`resource "aws_dynamodb_table" "tenants" {
  name         = "tenure-studio-tenants"
  billing_mode = "PAY_PER_REQUEST"

  point_in_time_recovery {
    enabled = true
  }
}
`),
    )
    const report = estateDrift({
      declared,
      observed: [
        surface("dynamodb:table", [
          live({
            resourceType: "dynamodb:table",
            name: "tenure-studio-tenants",
            settings: new Map<string, ObservedSetting>([
              [DRIFT_SETTINGS.tableBillingMode, { kind: "value", value: "PROVISIONED" }],
              [DRIFT_SETTINGS.tablePointInTimeRecovery, { kind: "value", value: "false" }],
            ]),
          }),
        ]),
      ],
      now: NOW,
    })
    const divergent = findingsOfKind(report, "divergent")
    expect(divergent).toHaveLength(2)
    // Sorted: the one that decides whether the fleet's own record survives is
    // the row an operator must read first.
    expect(divergent[0].setting).toBe(DRIFT_SETTINGS.tablePointInTimeRecovery)
    expect(divergent[0].severity).toBe("posture")
    expect(divergent[1].setting).toBe(DRIFT_SETTINGS.tableBillingMode)
    expect(divergent[1].severity).toBe("cosmetic")
  })

  it("reports an unreadable setting as un-comparable, carrying the refusal's own words", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(sources(LITERAL_BUCKET)),
      observed: [
        surface("s3:bucket", [
          live({
            resourceType: "s3:bucket",
            name: "tenure-pilot-documents",
            settings: new Map<string, ObservedSetting>([
              [DRIFT_SETTINGS.blockPublicAcls, { kind: "value", value: "true" }],
              [DRIFT_SETTINGS.blockPublicPolicy, { kind: "value", value: "true" }],
              [DRIFT_SETTINGS.ignorePublicAcls, { kind: "value", value: "true" }],
              [
                DRIFT_SETTINGS.restrictPublicBuckets,
                {
                  kind: "unreadable",
                  why: "s3:GetBucketPublicAccessBlock was refused (AccessDenied)",
                },
              ],
            ]),
          }),
        ]),
      ],
      now: NOW,
    })
    expect(report.findings).toEqual([])
    expect(report.uncomparable[0].because).toContain(
      "s3:GetBucketPublicAccessBlock was refused (AccessDenied)",
    )
  })
})

describe("estateDrift — when the declaration itself is not readable", () => {
  it("compares nothing and says why, rather than reporting the whole account undeclared", () => {
    const nothing: TerraformEstate = parseTerraformEstate([])
    const report = estateDrift({
      declared: nothing,
      observed: [
        surface("s3:bucket", [
          live({ resourceType: "s3:bucket", name: "a" }),
          live({ resourceType: "s3:bucket", name: "b" }),
        ]),
      ],
      now: NOW,
    })
    expect(report.comparable).toBe(false)
    expect(report.findings).toEqual([])
    expect(report.because).toContain("not a statement that nothing is declared")
  })

  it("lists declared types nothing observes rather than calling them absent", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(sources(LITERAL_BUCKET)),
      observed: [surface("dynamodb:table", [])],
      now: NOW,
    })
    expect(findingsOfKind(report, "absent")).toEqual([])
    expect(report.unobserved).toEqual([{ resourceType: "s3:bucket", declared: 1 }])
  })
})

/* ---------------------------------------------------------- the adapters -- */

const DENIED_BUCKETS: AwsRead<never> = {
  state: "DENIED",
  capability: "s3:ListBuckets",
  action: "s3:ListAllMyBuckets",
  principal: "arn:aws:sts::012345678901:assumed-role/studio/task",
  accountId: "012345678901",
  region: "us-east-1",
  partition: "aws",
  errorCode: "AccessDenied",
  minimumStatement: '{"Effect":"Allow","Action":["s3:ListAllMyBuckets"],"Resource":"*"}',
}

const EMPTY_IDENTITY = { state: "EMPTY", capability: "sts:GetCallerIdentity", asOf: "" } as const

describe("the reader adapters", () => {
  it("turns a refused bucket listing into a blind surface, not an empty one", () => {
    const observed = observedBuckets({
      identity: EMPTY_IDENTITY,
      tagged: { state: "EMPTY", capability: "tag:GetResources", asOf: "" },
      buckets: DENIED_BUCKETS,
      publicExposure: { kind: "unknown", why: "not read" },
      listing: { kind: "not-listed", why: "not read" },
      asOf: NOW.toISOString(),
      refreshMs: { buckets: 1, posture: 1 },
    } as unknown as Parameters<typeof observedBuckets>[0])
    expect(observed.kind).toBe("blind")
    if (observed.kind !== "blind") throw new Error("unreachable")
    expect(observed.because).toBe("s3:ListAllMyBuckets was refused (AccessDenied)")
  })

  it("reads an absent public-access block as four flags off, which is what it is", () => {
    const observed = observedBuckets({
      identity: EMPTY_IDENTITY,
      tagged: { state: "EMPTY", capability: "tag:GetResources", asOf: "" },
      buckets: {
        state: "ACTUAL",
        capability: "s3:ListBuckets",
        asOf: NOW.toISOString(),
        fresh: true,
        value: [
          {
            name: "open-bucket",
            arn: "arn:aws:s3:::open-bucket",
            partition: "aws",
            region: { kind: "stated", region: "us-east-1" },
            createdAt: null,
            attribution: { kind: "unattributed" },
            attributionSource: "tag index",
            publicAccessBlock: {
              state: "ACTUAL",
              capability: "s3:GetBucketPublicAccessBlock",
              asOf: NOW.toISOString(),
              fresh: true,
              value: { kind: "absent", why: "NoSuchPublicAccessBlockConfiguration" },
            },
            policyStatus: {
              state: "ACTUAL",
              capability: "s3:GetBucketPolicyStatus",
              asOf: "",
              fresh: true,
              value: { kind: "not-public" },
            },
            encryption: {
              state: "ACTUAL",
              capability: "s3:GetBucketEncryption",
              asOf: "",
              fresh: true,
              value: { kind: "sse-s3" },
            },
            versioning: {
              state: "ACTUAL",
              capability: "s3:GetBucketVersioning",
              asOf: "",
              fresh: true,
              value: { status: "never-enabled", mfaDelete: "not-stated" },
            },
            lifecycle: {
              state: "ACTUAL",
              capability: "s3:GetBucketLifecycleConfiguration",
              asOf: "",
              fresh: true,
              value: { kind: "none", why: "NoSuchLifecycleConfiguration" },
            },
            tags: {
              state: "ACTUAL",
              capability: "s3:GetBucketTagging",
              asOf: "",
              fresh: true,
              value: { kind: "tags", tags: { "tenure:managed-by": "terraform" } },
            },
            cors: {
              state: "ACTUAL",
              capability: "s3:GetBucketCors",
              asOf: "",
              fresh: true,
              value: { kind: "none", why: "NoSuchCORSConfiguration" },
            },
            refreshMs: 1,
            asOf: NOW.toISOString(),
          },
        ],
      },
      publicExposure: { kind: "none-observed", bucketsRead: 1, partiallyUnread: [] },
      listing: { kind: "complete", bucketsListed: 1, pagesRead: 1 },
      asOf: NOW.toISOString(),
      refreshMs: { buckets: 1, posture: 1 },
    } as unknown as Parameters<typeof observedBuckets>[0])

    expect(observed.kind).toBe("read")
    if (observed.kind !== "read") throw new Error("unreachable")
    const bucket = observed.resources[0]
    expect(bucket.settings.get(DRIFT_SETTINGS.blockPublicAcls)).toEqual({
      kind: "value",
      value: "false",
    })
    expect(bucket.settings.get(DRIFT_SETTINGS.bucketEncryption)).toEqual({
      kind: "value",
      value: "AES256",
    })
    expect(bucket.settings.get(DRIFT_SETTINGS.bucketVersioning)).toEqual({
      kind: "value",
      value: "Disabled",
    })
    expect(bucket.managedBy).toEqual({ kind: "declared", by: "terraform" })
  })

  it("carries a refused sub-read through as unreadable rather than as a default", () => {
    const observed = observedBuckets({
      identity: EMPTY_IDENTITY,
      tagged: { state: "EMPTY", capability: "tag:GetResources", asOf: "" },
      buckets: {
        state: "ACTUAL",
        capability: "s3:ListBuckets",
        asOf: "",
        fresh: true,
        value: [
          {
            name: "quiet-bucket",
            arn: null,
            partition: "aws",
            region: { kind: "unstated", why: "not read" },
            createdAt: null,
            attribution: { kind: "unattributed" },
            attributionSource: "tag index",
            publicAccessBlock: {
              state: "DENIED",
              capability: "s3:GetBucketPublicAccessBlock",
              action: "s3:GetBucketPublicAccessBlock",
              principal: "p",
              accountId: null,
              region: null,
              partition: null,
              errorCode: "AccessDenied",
              minimumStatement: "{}",
            },
            policyStatus: {
              state: "ACTUAL",
              capability: "s3:GetBucketPolicyStatus",
              asOf: "",
              fresh: true,
              value: { kind: "not-public" },
            },
            encryption: {
              state: "THROTTLED",
              capability: "s3:GetBucketEncryption",
              retryAfterMs: 100,
              asOf: "",
            },
            versioning: {
              state: "ACTUAL",
              capability: "s3:GetBucketVersioning",
              asOf: "",
              fresh: true,
              value: { status: "Enabled", mfaDelete: "not-stated" },
            },
            lifecycle: {
              state: "ACTUAL",
              capability: "s3:GetBucketLifecycleConfiguration",
              asOf: "",
              fresh: true,
              value: { kind: "none", why: "x" },
            },
            tags: {
              state: "ERROR",
              capability: "s3:GetBucketTagging",
              code: "Broken",
              safeDetail: "x",
            },
            cors: {
              state: "ACTUAL",
              capability: "s3:GetBucketCors",
              asOf: "",
              fresh: true,
              value: { kind: "none", why: "x" },
            },
            refreshMs: 1,
            asOf: "",
          },
        ],
      },
      publicExposure: { kind: "none-observed", bucketsRead: 1, partiallyUnread: [] },
      listing: { kind: "complete", bucketsListed: 1, pagesRead: 1 },
      asOf: "",
      refreshMs: { buckets: 1, posture: 1 },
    } as unknown as Parameters<typeof observedBuckets>[0])

    if (observed.kind !== "read") throw new Error("unreachable")
    const bucket = observed.resources[0]
    expect(bucket.settings.get(DRIFT_SETTINGS.blockPublicAcls)).toEqual({
      kind: "unreadable",
      why: "s3:GetBucketPublicAccessBlock was refused (AccessDenied)",
    })
    expect(bucket.settings.get(DRIFT_SETTINGS.bucketEncryption)).toEqual({
      kind: "unreadable",
      why: "AWS rate-limited s3:GetBucketEncryption",
    })
    expect(bucket.managedBy.kind).toBe("unread")
  })

  it("flattens security-group ingress by port and canonicalises the sources", () => {
    const observed = observedSecurityGroups({
      securityGroups: {
        state: "ACTUAL",
        capability: "ec2:DescribeSecurityGroups",
        asOf: "",
        fresh: true,
        value: {
          items: [
            {
              groupId: "sg-1",
              groupName: "tenure-pilot-alb",
              description: null,
              vpcId: "vpc-1",
              arn: "arn:aws:ec2:us-east-1:012345678901:security-group/sg-1",
              ownerId: "012345678901",
              region: "us-east-1",
              partition: "aws",
              ingress: [
                {
                  direction: "ingress",
                  protocol: "tcp",
                  protocolLabel: "TCP",
                  fromPort: 80,
                  toPort: 80,
                  source: "pl-1",
                  sourceKind: "prefix-list",
                  description: null,
                  world: false,
                },
                {
                  direction: "ingress",
                  protocol: "tcp",
                  protocolLabel: "TCP",
                  fromPort: 80,
                  toPort: 80,
                  source: "0.0.0.0/0",
                  sourceKind: "ipv4",
                  description: null,
                  world: true,
                },
              ],
              egress: [],
              openIngress: [],
              webIngress: [],
              usage: { kind: "unknown", why: "x" },
              name: "tenure-pilot-alb",
              attribution: { kind: "unattributed", source: "describe-response" },
              tags: { "tenure:managed-by": "terraform" },
            },
          ],
          truncated: false,
          pages: 1,
          cap: 40,
        },
      },
    } as unknown as Parameters<typeof observedSecurityGroups>[0])

    if (observed.kind !== "read") throw new Error("unreachable")
    expect(observed.resources[0].settings.get(ingressSettingKey("tcp", 80, 80))).toEqual({
      kind: "value",
      value: "cidr:0.0.0.0/0,prefix-list",
    })
  })

  it("turns a pool's MFA posture into the value Terraform declares", () => {
    const observed = observedUserPools({
      pools: {
        state: "ACTUAL",
        capability: "cognito-idp:ListUserPools",
        asOf: "",
        fresh: true,
        value: {
          pools: [
            {
              poolId: "us-east-1_abc",
              listedName: "tenure-studio-operators",
              arn: null,
              arnProvenance: "x",
              region: null,
              partition: null,
              accountId: null,
              locationProvenance: "x",
              attribution: { kind: "unattributed", provenance: "x" },
              detail: {
                state: "DENIED",
                capability: "cognito-idp:DescribeUserPool",
                action: "cognito-idp:DescribeUserPool",
                principal: "p",
                accountId: null,
                region: null,
                partition: null,
                errorCode: "AccessDenied",
                minimumStatement: "{}",
              },
              mfa: {
                state: "ACTUAL",
                capability: "cognito-idp:GetUserPoolMfaConfig",
                asOf: "",
                fresh: true,
                value: {
                  mfaConfigurationRaw: "OPTIONAL",
                  softwareTokenEnabled: true,
                  smsConfigured: false,
                  emailConfigured: false,
                },
              },
              mfaPosture: {
                kind: "optional",
                factors: ["SOFTWARE_TOKEN_MFA"],
                provenance: "GetUserPoolMfaConfig",
                why: "a second factor nobody enrolled",
              },
              clients: { state: "EMPTY", capability: "cognito-idp:ListUserPoolClients", asOf: "" },
              domain: { state: "EMPTY", capability: "cognito-idp:DescribeUserPoolDomain", asOf: "" },
              operators: { state: "EMPTY", capability: "cognito-idp:ListUsers", asOf: "" },
              guardsThisConsole: null,
              asOf: "",
            },
          ],
          completeness: { kind: "complete", pagesWalked: 1 },
          scope: "us-east-1",
        },
      },
    } as unknown as Parameters<typeof observedUserPools>[0])

    if (observed.kind !== "read") throw new Error("unreachable")
    const pool = observed.resources[0]
    expect(pool.name).toBe("tenure-studio-operators")
    expect(pool.settings.get(DRIFT_SETTINGS.mfaConfiguration)).toEqual({
      kind: "value",
      value: "OPTIONAL",
    })
    expect(pool.settings.get(DRIFT_SETTINGS.softwareTokenMfa)).toEqual({
      kind: "value",
      value: "true",
    })
    // The describe was refused, so whether self-signup is closed is UNREADABLE.
    expect(pool.settings.get(DRIFT_SETTINGS.adminCreateUserOnly)).toEqual({
      kind: "unreadable",
      why: "cognito-idp:DescribeUserPool was refused (AccessDenied)",
    })
    expect(pool.managedBy.kind).toBe("unread")
  })

  it("reads a table's protections and never claims to know its tags", () => {
    const observed = observedTables({
      tables: {
        state: "ACTUAL",
        capability: "dynamodb:ListTables",
        asOf: "",
        fresh: true,
        value: [
          {
            name: "tenure-studio-tenants",
            arn: "arn:aws:dynamodb:us-east-1:012345678901:table/tenure-studio-tenants",
            arnProvenance: "DescribeTable",
            region: "us-east-1",
            partition: "aws",
            accountId: "012345678901",
            isTenantRegistry: true,
            attribution: { kind: "shared" },
            detail: {
              state: "ACTUAL",
              capability: "dynamodb:DescribeTable",
              asOf: "",
              fresh: true,
              value: {
                arn: "arn:aws:dynamodb:us-east-1:012345678901:table/tenure-studio-tenants",
                status: "ACTIVE",
                createdAt: null,
                billing: { kind: "on-demand" },
                size: { itemCount: 0, sizeBytes: 0, freshness: "x" },
                encryption: { kind: "aws-owned-default", why: "no SSEDescription" },
                deletionProtection: { kind: "disabled" },
                keySchema: ["pk (HASH)"],
                indexes: [],
              },
            },
            backups: {
              state: "ACTUAL",
              capability: "dynamodb:DescribeContinuousBackups",
              asOf: "",
              fresh: true,
              value: { kind: "disabled", continuousBackupsStatus: "DISABLED", why: "off" },
            },
            ttl: {
              state: "ACTUAL",
              capability: "dynamodb:DescribeTimeToLive",
              asOf: "",
              fresh: true,
              value: { kind: "disabled", status: "DISABLED" },
            },
            keyManagement: {
              state: "UNCONFIGURED",
              capability: "kms:DescribeKey",
              why: "no key",
            },
            refreshMs: 1,
            asOf: "",
          },
        ],
      },
      more: { kind: "complete" },
    } as unknown as Parameters<typeof observedTables>[0])

    if (observed.kind !== "read") throw new Error("unreachable")
    const table = observed.resources[0]
    expect(table.settings.get(DRIFT_SETTINGS.tableEncryption)).toEqual({
      kind: "value",
      value: "false",
    })
    expect(table.settings.get(DRIFT_SETTINGS.tablePointInTimeRecovery)).toEqual({
      kind: "value",
      value: "false",
    })
    expect(table.settings.get(DRIFT_SETTINGS.tableDeletionProtection)).toEqual({
      kind: "value",
      value: "false",
    })
    expect(table.managedBy.kind).toBe("unread")
  })
})

/* ------------------------------------------------------- end to end, real -- */

describe("the Studio stack against a console that changed three things", () => {
  it("produces one finding of each kind and no noise from the interpolated names", () => {
    const declared = parseTerraformEstate(STUDIO)

    const report = estateDrift({
      declared,
      observed: [
        // The registry table is there, matched by `-tenants`, with deletion
        // protection turned off in the console.
        surface("dynamodb:table", [
          live({
            resourceType: "dynamodb:table",
            name: "tenure-studio-tenants",
            settings: new Map<string, ObservedSetting>([
              [DRIFT_SETTINGS.tableEncryption, { kind: "value", value: "true" }],
              [DRIFT_SETTINGS.tablePointInTimeRecovery, { kind: "value", value: "true" }],
              [DRIFT_SETTINGS.tableDeletionProtection, { kind: "value", value: "false" }],
              [DRIFT_SETTINGS.tableBillingMode, { kind: "value", value: "PAY_PER_REQUEST" }],
            ]),
          }),
        ]),
        // A bucket nobody declared, in a stack that declares no bucket at all.
        surface("s3:bucket", [live({ resourceType: "s3:bucket", name: "operator-scratch" })]),
        // The security groups the Studio declares literally-named-by-pattern,
        // with the console-facing one simply gone.
        surface("cognito-idp:userpool", []),
      ],
      now: NOW,
    })

    expect(report.comparable).toBe(true)
    const divergent = findingsOfKind(report, "divergent")
    expect(divergent.map((f) => f.setting)).toEqual([DRIFT_SETTINGS.tableDeletionProtection])

    const undeclared = findingsOfKind(report, "undeclared")
    expect(undeclared.map((f) => f.observed)).toEqual(["operator-scratch"])

    // The pool's name is `"${local.name_prefix}-operators"`. Nothing was read,
    // and the correct answer is un-comparable — NOT an absent user pool, which
    // would tell an operator their console's front door had been deleted.
    expect(findingsOfKind(report, "absent")).toEqual([])
    expect(
      report.uncomparable.some(
        (item) => item.declaredAt === "aws_cognito_user_pool.studio" && item.observed === null,
      ),
    ).toBe(true)

    // Posture findings sort above cost findings, because that is the order an
    // operator has to act in.
    expect(report.findings[0].severity).toBe("posture")
  })
})

describe("publishedDrift — the versioned arm", () => {
  const STATEFUL = new Set(["s3:bucket", "dynamodb:table"])

  function reportWithAllThree() {
    return estateDrift({
      declared: parseTerraformEstate(
        sources(`resource "aws_s3_bucket" "docs" {
  bucket = "tenure-pilot-documents"
}

resource "aws_s3_bucket" "gone" {
  bucket = "tenure-pilot-gone"
}

resource "aws_s3_bucket_public_access_block" "docs" {
  bucket                  = aws_s3_bucket.docs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
`),
      ),
      observed: [
        surface("s3:bucket", [
          live({
            resourceType: "s3:bucket",
            name: "tenure-pilot-documents",
            arn: "arn:aws:s3:::tenure-pilot-documents",
            settings: new Map<string, ObservedSetting>([
              [DRIFT_SETTINGS.blockPublicAcls, { kind: "value", value: "false" }],
              [DRIFT_SETTINGS.blockPublicPolicy, { kind: "value", value: "true" }],
              [DRIFT_SETTINGS.ignorePublicAcls, { kind: "value", value: "true" }],
              [DRIFT_SETTINGS.restrictPublicBuckets, { kind: "value", value: "true" }],
            ]),
          }),
          live({
            resourceType: "s3:bucket",
            name: "console-scratch",
            arn: "arn:aws:s3:::console-scratch",
          }),
        ]),
      ],
      now: NOW,
    })
  }

  it("publishes the contract's own three kinds, parsed rather than asserted", () => {
    const published = publishedDrift({ report: reportWithAllThree(), stateful: STATEFUL })
    expect(published.findings.map((f) => f.kind).sort()).toEqual(["modified", "unmanaged"])
    const modified = published.findings.find((f) => f.kind === "modified")
    expect(modified?.field).toBe(DRIFT_SETTINGS.blockPublicAcls)
    expect(modified?.severity).toBe("critical")
    expect(modified?.arn).toBe("arn:aws:s3:::tenure-pilot-documents")
    expect(modified?.schemaVersion).toBe("1.0")
    const unmanaged = published.findings.find((f) => f.kind === "unmanaged")
    expect(unmanaged?.field).toBeNull()
    // A bucket is stateful, so the delete that reconciling implies is NOT
    // reversible. That fact comes from the caller's set, not from this module.
    expect(unmanaged?.reversible).toBe(false)
  })

  it("withholds the absent finding rather than assembling an ARN AWS never issued", () => {
    const published = publishedDrift({ report: reportWithAllThree(), stateful: STATEFUL })
    expect(published.withheld).toHaveLength(1)
    expect(published.withheld[0].kind).toBe("absent")
    expect(published.withheld[0].declaredAt).toBe("aws_s3_bucket.gone")
    expect(published.withheld[0].because).toContain("AWS never issued")
    // The finding is NOT lost — it is still in the report this console renders.
    expect(findingsOfKind(reportWithAllThree(), "absent")).toHaveLength(1)
  })

  it("withholds a finding whose reader returned no ARN", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(sources(LITERAL_BUCKET)),
      observed: [
        surface("s3:bucket", [live({ resourceType: "s3:bucket", name: "no-arn", arn: null })]),
      ],
      now: NOW,
    })
    const published = publishedDrift({ report, stateful: STATEFUL })
    expect(published.findings).toEqual([])
    expect(published.withheld[0].because).toContain("gap in what was read")
  })

  it("marks an unmanaged stateless resource as reversible", () => {
    const report = estateDrift({
      declared: parseTerraformEstate(sources(LITERAL_BUCKET)),
      observed: [
        surface("ec2:security-group", [
          live({
            resourceType: "ec2:security-group",
            name: "orphan",
            arn: "arn:aws:ec2:us-east-1:012345678901:security-group/sg-9",
          }),
        ]),
      ],
      now: NOW,
    })
    const published = publishedDrift({ report, stateful: STATEFUL })
    expect(published.findings[0].kind).toBe("unmanaged")
    expect(published.findings[0].reversible).toBe(true)
  })
})

describe("unreadableBecause", () => {
  it("names the IAM action and the error code for a denial", () => {
    expect(unreadableBecause(DENIED_BUCKETS)).toBe("s3:ListAllMyBuckets was refused (AccessDenied)")
  })

  it("uses the UNCONFIGURED reason verbatim rather than inventing one", () => {
    expect(
      unreadableBecause({
        state: "UNCONFIGURED",
        capability: "pricing:GetProducts",
        why: "AWS_GLOBAL_ENDPOINT_REGION is not set",
      }),
    ).toBe("AWS_GLOBAL_ENDPOINT_REGION is not set")
  })
})
