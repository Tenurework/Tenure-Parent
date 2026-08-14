import {
  EXPORT_BUDGET,
  EXPORT_COMMANDS,
  __resetExportBudget,
  columnsFor,
  consumeExportBudget,
  contentDisposition,
  coverageTable,
  csvCell,
  driftTable,
  inventoryTable,
  isExportFormat,
  isExportSurface,
  postureTable,
  redactSecretMaterial,
  toCsv,
  toEnvelope,
  type CoverageRowLike,
  type ExportProvenance,
  type ExportRow,
} from "./export"

import type { EstateDriftReport } from "./drift"
import type { EstateReadings, EstateResource, EstateSection } from "./inventory"
import type { SecurityPosture, SecurityPostureItem } from "./posture"
import type { AwsRead } from "./read"

/**
 * STUDIO-100-002 (the `export` clause) — what leaves the building, and what it
 * is not allowed to leave out.
 *
 * Every assertion below is on `inventoryTable`, `coverageTable`, `driftTable`,
 * `postureTable`, `csvCell`, `toCsv`, `toEnvelope`, `contentDisposition`,
 * `redactSecretMaterial` and `consumeExportBudget` — the ten functions
 * `app/api/export/route.ts` actually calls to produce a file. Nothing here
 * drives a private helper, because a test on a helper stays green on the day
 * the route stops calling it.
 *
 * The four properties under test are the four an export can silently fail:
 *
 *   1. a read that failed leaves as a row saying it failed, never as no row;
 *   2. every row carries the account, the region, the capability and its own
 *      `as of`;
 *   3. a cell that a spreadsheet would EXECUTE comes out inert;
 *   4. nothing that authenticates is in the file.
 */

/* -------------------------------------------------------------- fixtures -- */

const PROVENANCE: ExportProvenance = {
  accountId: "123456789012",
  region: "us-east-1",
  partition: "aws",
  readAs: "arn:aws:sts::123456789012:assumed-role/tenure-studio/console",
}

const T0 = "2026-08-14T09:00:00.000Z"
const T1 = "2026-08-14T05:30:00.000Z"

function resource(overrides: Partial<EstateResource> = {}): EstateResource {
  return {
    arn: "arn:aws:ecs:us-east-1:123456789012:service/tenure/api",
    resourceType: "ecs:service",
    name: "api",
    state: "ACTIVE",
    region: "us-east-1",
    accountId: "123456789012",
    partition: "aws",
    tags: { "tenure:tenant": "northwind" },
    attribution: { kind: "tenant", tenantSlug: "northwind" },
    dependsOn: ["arn:aws:ecs:us-east-1:123456789012:cluster/tenure"],
    asOf: T0,
    ...overrides,
  } as EstateResource
}

function resourceSection(
  read: AwsRead<readonly EstateResource[]>,
  overrides: Partial<EstateSection> = {},
): EstateSection {
  return {
    capability: "ecs:ListServices",
    service: "ecs",
    label: "ECS services",
    refreshMs: 60_000,
    covers: ["ecs:ListServices"],
    contribution: { kind: "resources", read, omitted: [] },
    coverage: { kind: "VISIBLE", resources: 1, asOf: T0 },
    text: "ECS services read from AWS",
    ...overrides,
  } as EstateSection
}

const DENIED: AwsRead<readonly EstateResource[]> = {
  state: "DENIED",
  capability: "rds:DescribeDBInstances",
  action: "rds:DescribeDBInstances",
  principal: PROVENANCE.readAs as string,
  accountId: "123456789012",
  region: "us-east-1",
  partition: "aws",
  errorCode: "AccessDeniedException",
  minimumStatement:
    '{"Effect":"Allow","Action":["rds:DescribeDBInstances"],"Resource":"*"}',
}

function readings(sections: readonly EstateSection[]): EstateReadings {
  return { sections } as unknown as EstateReadings
}

function rowsOf(table: { rows: readonly ExportRow[] }): readonly ExportRow[] {
  return table.rows
}

/* ------------------------------------------------- 1. a denial is a row -- */

describe("a read this engine could not perform leaves the building as a read it could not perform", () => {
  it("emits a DENIED row for a refused section, carrying the action and the pasteable statement", () => {
    const table = inventoryTable(
      readings([
        resourceSection(DENIED, {
          capability: "rds:DescribeDBInstances",
          service: "rds",
          label: "Databases",
          covers: ["rds:DescribeDBInstances"],
          coverage: {
            kind: "UNKNOWN",
            state: "DENIED",
            why: "rds:DescribeDBInstances was refused",
          },
          text: "unknown — this engine's role was refused rds:DescribeDBInstances",
        }),
      ]),
      PROVENANCE,
    )

    const rows = rowsOf(table)
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe("DENIED")
    expect(rows[0].service).toBe("rds")
    expect(rows[0].awsAction).toBe("rds:DescribeDBInstances")
    expect(String(rows[0].minimumStatement)).toContain("rds:DescribeDBInstances")
    expect(table.unreadableRows).toBe(1)
  })

  it("never emits an empty table for a refused section — the count of rows is not zero", () => {
    const table = inventoryTable(readings([resourceSection(DENIED)]), PROVENANCE)
    expect(rowsOf(table).length).toBeGreaterThan(0)
  })

  it("tells a refused section apart from a section that genuinely holds nothing", () => {
    const empty = inventoryTable(
      readings([
        resourceSection({ state: "EMPTY", capability: "ecs:ListServices", asOf: T0 }),
      ]),
      PROVENANCE,
    )
    expect(rowsOf(empty)[0].state).toBe("NONE")
    expect(empty.unreadableRows).toBe(0)

    const denied = inventoryTable(readings([resourceSection(DENIED)]), PROVENANCE)
    expect(rowsOf(denied)[0].state).toBe("DENIED")
    expect(denied.unreadableRows).toBe(1)
  })

  it("keeps THROTTLED, UNCONFIGURED and ERROR as their own states rather than folding them", () => {
    const states: Array<[AwsRead<readonly EstateResource[]>, string]> = [
      [
        { state: "THROTTLED", capability: "ecs:ListServices", retryAfterMs: 400, asOf: T0 },
        "THROTTLED",
      ],
      [
        { state: "UNCONFIGURED", capability: "ecs:ListServices", why: "no region is set" },
        "UNCONFIGURED",
      ],
      [
        { state: "ERROR", capability: "ecs:ListServices", code: "TimeoutError", safeDetail: "…" },
        "ERROR",
      ],
    ]
    for (const [read, expected] of states) {
      const table = inventoryTable(readings([resourceSection(read)]), PROVENANCE)
      expect(rowsOf(table)[0].state).toBe(expected)
      expect(table.unreadableRows).toBe(1)
    }
  })

  it("emits a row for what a reader saw and could not name, rather than dropping it", () => {
    const table = inventoryTable(
      readings([
        resourceSection(
          { state: "ACTUAL", capability: "ecs:ListServices", value: [resource()], asOf: T0, fresh: true },
          {
            contribution: {
              kind: "resources",
              read: {
                state: "ACTUAL",
                capability: "ecs:ListServices",
                value: [resource()],
                asOf: T0,
                fresh: true,
              },
              omitted: [{ service: "ecs", label: "a service with no ARN", why: "the describe returned no ARN" }],
            },
          },
        ),
      ]),
      PROVENANCE,
    )

    const omitted = rowsOf(table).filter((row) => row.state === "OMITTED")
    expect(omitted).toHaveLength(1)
    expect(omitted[0].name).toBe("a service with no ARN")
    expect(table.unreadableRows).toBe(1)
  })

  it("emits NO_READER and NOT_COMPOSED rows, which are claims about this build and not about the account", () => {
    const noReader = inventoryTable(
      readings([
        resourceSection(DENIED, {
          contribution: { kind: "not-composed", why: "this page does not drive it", holdsResources: true },
          coverage: { kind: "NOT_COMPOSED", why: "this page does not drive it" },
        }),
      ]),
      PROVENANCE,
    )
    expect(rowsOf(noReader)[0].state).toBe("NOT_COMPOSED")
    expect(noReader.unreadableRows).toBe(1)
  })

  it("a drift comparison with no readable Terraform is ONE row saying so, never zero rows", () => {
    const report: EstateDriftReport = {
      comparable: false,
      because: "No Terraform source was reachable from this process.",
      findings: [],
      uncomparable: [],
      blind: [],
      unobserved: [],
      filesRead: [],
      asOf: T0,
    }

    const table = driftTable(report, PROVENANCE)
    expect(rowsOf(table)).toHaveLength(1)
    expect(rowsOf(table)[0].state).toBe("NOT_DECLARABLE")
    expect(String(rowsOf(table)[0].detail)).toContain("No Terraform source")
    expect(table.unreadableRows).toBe(1)
  })

  it("a resource type whose live side could not be read is UNREADABLE, not an absent declaration", () => {
    const report: EstateDriftReport = {
      comparable: true,
      because: "",
      findings: [],
      uncomparable: [],
      blind: [{ resourceType: "s3:bucket", because: "s3:ListBuckets was refused" }],
      unobserved: [],
      filesRead: ["infrastructure/terraform/s3.tf"],
      asOf: T0,
    }
    const rows = rowsOf(driftTable(report, PROVENANCE))
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe("UNREADABLE")
    expect(rows[0].verdict).toBeNull()
  })

  it("a posture control this engine may not read is UNREADABLE with its own action and statement", () => {
    const unknown: SecurityPostureItem = {
      key: "kms::rotation",
      service: "kms",
      question: "unrotated",
      control: "KMS key rotation",
      answers: "whether every customer-managed key rotates",
      state: "UNKNOWN",
      reason: "kms:ListKeys was refused",
      action: "kms:ListKeys",
      minimumStatement: '{"Effect":"Allow","Action":["kms:ListKeys"],"Resource":"*"}',
    }
    const rows = rowsOf(postureTable({ items: [unknown], score: {} as never, asOf: T0 }, PROVENANCE))
    expect(rows[0].state).toBe("UNREADABLE")
    expect(rows[0].verdict).toBe("UNKNOWN")
    expect(rows[0].awsAction).toBe("kms:ListKeys")
    expect(String(rows[0].minimumStatement)).toContain("kms:ListKeys")
  })

  it("keeps a control that FAILED apart from a control nobody could read", () => {
    const posture: SecurityPosture = {
      items: [
        {
          key: "s3::public-access",
          service: "s3",
          question: "exposed",
          control: "S3 public access block",
          answers: "which buckets are public",
          state: "FAIL",
          severity: "CRITICAL",
          detail: "docs: the policy is public",
          remedy: "Set all four flags.",
          subjects: ["docs"],
        },
        {
          key: "kms::rotation",
          service: "kms",
          question: "unrotated",
          control: "KMS key rotation",
          answers: "whether keys rotate",
          state: "UNKNOWN",
          reason: "refused",
          action: "kms:ListKeys",
          minimumStatement: "{}",
        },
      ],
      score: {} as never,
      asOf: T0,
    }
    const rows = rowsOf(postureTable(posture, PROVENANCE))
    const fail = rows.find((row) => row.key === "s3::public-access")
    const unknown = rows.find((row) => row.key === "kms::rotation")

    // A failure is something this engine SAW. Only the refusal is unreadable.
    expect(fail?.state).toBe("READ")
    expect(fail?.verdict).toBe("FAIL")
    expect(unknown?.state).toBe("UNREADABLE")
    expect(postureTable(posture, PROVENANCE).unreadableRows).toBe(1)
  })

  it("a control that is not running is READ / NOT_CHECKED — a fact about the estate, not about our grants", () => {
    const rows = rowsOf(
      postureTable(
        {
          items: [
            {
              key: "guardduty::detector",
              service: "guardduty",
              question: "unwatched",
              control: "GuardDuty",
              answers: "whether the account is watched",
              state: "NOT_CHECKED",
              reason: "no detector exists in this region",
              remedy: "Enable GuardDuty.",
            },
          ],
          score: {} as never,
          asOf: T0,
        },
        PROVENANCE,
      ),
    )
    expect(rows[0].state).toBe("READ")
    expect(rows[0].verdict).toBe("NOT_CHECKED")
  })

  it("a service with no reader in this build is NO_READER on the coverage table, never a zero", () => {
    const coverage: readonly CoverageRowLike[] = [
      {
        service: "sns",
        reader: "NO_READER",
        count: null,
        capabilities: [],
        reads: [],
        asOf: null,
        because: "no module in this build reads sns",
        declared: { definite: 2, conditional: 0 },
      },
    ]
    const rows = rowsOf(coverageTable(coverage, PROVENANCE))
    expect(rows[0].state).toBe("NO_READER")
    // Not 0. A zero in a spreadsheet is a number somebody will sum.
    expect(rows[0].resources).toBeNull()
    expect(rows[0].declaredDefinite).toBe(2)
  })
})

/* --------------------------------------------------------- 2. provenance -- */

describe("every row carries where it came from and when", () => {
  it("stamps the account, region, partition, service, capability and IAM action on every row", () => {
    const table = inventoryTable(
      readings([
        resourceSection({
          state: "ACTUAL",
          capability: "ecs:ListServices",
          value: [resource()],
          asOf: T0,
          fresh: true,
        }),
        resourceSection(DENIED, { capability: "rds:DescribeDBInstances", service: "rds" }),
      ]),
      PROVENANCE,
    )

    for (const row of rowsOf(table)) {
      expect(row.accountId).toBe("123456789012")
      expect(row.region).toBe("us-east-1")
      expect(row.partition).toBe("aws")
      expect(row.service).not.toBe("")
      expect(row.awsAction).not.toBe("")
    }
  })

  it("carries the RESOURCE's own asOf, not one banner stamp for the whole file", () => {
    const table = inventoryTable(
      readings([
        resourceSection({
          state: "ACTUAL",
          capability: "ecs:ListServices",
          value: [resource({ asOf: T0 }), resource({ name: "worker", asOf: T1 })],
          asOf: T0,
          fresh: true,
        }),
      ]),
      PROVENANCE,
    )
    const stamps = rowsOf(table).map((row) => row.asOf)
    expect(stamps).toEqual([T0, T1])
  })

  it("records the account and the principal in the JSON envelope, and never a credential", () => {
    const table = inventoryTable(
      readings([
        resourceSection({
          state: "ACTUAL",
          capability: "ecs:ListServices",
          value: [resource()],
          asOf: T0,
          fresh: true,
        }),
      ]),
      PROVENANCE,
    )
    const envelope = toEnvelope(table, { generatedAt: T0, correlationId: "req-1" })
    expect(envelope.account.accountId).toBe("123456789012")
    expect(envelope.account.readAs).toBe(PROVENANCE.readAs)
    expect(envelope.counts.rows).toBe(1)
    expect(envelope.note).toContain("Only NONE asserts an absence")
  })

  it("names the account, the surface and the date in the Content-Disposition", () => {
    const header = contentDisposition({
      accountId: "123456789012",
      surface: "inventory",
      format: "csv",
      at: "2026-08-14T09:00:00.000Z",
    })
    expect(header).toBe(
      'attachment; filename="tenure-estate-123456789012-inventory-2026-08-14.csv"',
    )
  })

  it("says the account is unknown in the filename rather than inventing one", () => {
    const header = contentDisposition({
      accountId: null,
      surface: "posture",
      format: "json",
      at: T0,
    })
    expect(header).toContain("unknown-account")
  })

  it("cannot be made to split the response header by a hostile account id", () => {
    const header = contentDisposition({
      accountId: '1234"\r\nX-Injected: yes',
      surface: "drift",
      format: "csv",
      at: T0,
    })
    expect(header).not.toContain("\r")
    expect(header).not.toContain("\n")
    expect(header).toBe(
      'attachment; filename="tenure-estate-1234X-Injectedyes-drift-2026-08-14.csv"',
    )
  })

  it("keeps the tenant attribution's three answers apart", () => {
    const table = inventoryTable(
      readings([
        resourceSection({
          state: "ACTUAL",
          capability: "ecs:ListServices",
          value: [
            resource({ attribution: { kind: "tenant", tenantSlug: "northwind" } }),
            resource({ name: "b", attribution: { kind: "shared" } }),
            resource({ name: "c", attribution: { kind: "unattributed" } }),
          ],
          asOf: T0,
          fresh: true,
        }),
      ]),
      PROVENANCE,
    )
    expect(rowsOf(table).map((row) => row.tenant)).toEqual([
      "northwind",
      "tenure:shared",
      // Never a blank: an untagged resource is a finding, not a missing cell.
      "unattributed",
    ])
  })
})

/* ------------------------------------------------------ 3. CSV injection -- */

describe("a cell a spreadsheet would execute comes out inert", () => {
  it("neutralises =cmd", () => {
    expect(csvCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1")
  })

  it("neutralises every formula leader a spreadsheet honours", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)")
    expect(csvCell("+HYPERLINK(\"http://x\")")).toBe(`"'+HYPERLINK(""http://x"")"`)
    expect(csvCell("-2+3+cmd|' /c calc'!A0")).toBe("'-2+3+cmd|' /c calc'!A0")
    expect(csvCell("@SUM(1+9)*cmd")).toBe("'@SUM(1+9)*cmd")
    // Quoted as well as neutralised: both begin with whitespace a reader strips.
    expect(csvCell("\tcmd")).toBe(`"'\tcmd"`)
    expect(csvCell("\rcmd")).toBe(`"'\rcmd"`)
  })

  it("lets a real number through, so a numeric column still sorts and sums", () => {
    expect(csvCell(-1)).toBe("-1")
    expect(csvCell("-12.5")).toBe("-12.5")
    expect(csvCell("+1.5e3")).toBe("+1.5e3")
    expect(csvCell(0)).toBe("0")
  })

  it("escapes quotes, commas and newlines per RFC 4180", () => {
    expect(csvCell('he said "no"')).toBe('"he said ""no"""')
    expect(csvCell("a,b")).toBe('"a,b"')
    expect(csvCell("a\nb")).toBe('"a\nb"')
    expect(csvCell(" padded ")).toBe('" padded "')
  })

  it("neutralises a hostile AWS resource name and a hostile tag KEY on the way into the real CSV", () => {
    /*
     * Both payloads are things an AWS principal with `ecs:CreateService` or
     * `tag:TagResources` can set, and this console reports them faithfully. An
     * AWS tag key may begin with `=`, `+`, `-` or `@` — the tag grammar allows
     * all four — so the `key=value` cell can begin with a formula leader even
     * though the tag VALUE is quoted inside it.
     */
    const table = inventoryTable(
      readings([
        resourceSection({
          state: "ACTUAL",
          capability: "ecs:ListServices",
          value: [
            resource({
              name: "=cmd|'/c calc'!A1",
              tags: { "=HYPERLINK": "http://evil" },
            }),
          ],
          asOf: T0,
          fresh: true,
        }),
      ]),
      PROVENANCE,
    )
    const csv = toCsv(table)
    // No cell in the file begins with a formula leader: every field is either
    // at the start of a record, after a comma, or after an opening quote.
    expect(csv).not.toMatch(/(^|[,"])[=+@]/m)
    expect(csv).toContain("'=cmd|'/c calc'!A1")
    expect(csv).toContain("'=HYPERLINK=http://evil")
  })

  it("writes CRLF records and a header row of exactly the declared columns", () => {
    const table = inventoryTable(
      readings([
        resourceSection({
          state: "ACTUAL",
          capability: "ecs:ListServices",
          value: [resource()],
          asOf: T0,
          fresh: true,
        }),
      ]),
      PROVENANCE,
    )
    const csv = toCsv(table)
    expect(csv.split("\r\n")[0]).toBe(columnsFor("inventory").join(","))
    expect(csv.endsWith("\r\n")).toBe(true)
  })
})

/* ------------------------------------------------------- 4. what may not -- */

describe("nothing that authenticates leaves the building", () => {
  it("redacts a value whose own name says it authenticates", () => {
    expect(redactSecretMaterial('secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"')).toBe(
      "secret_access_key = [redacted]",
    )
    expect(redactSecretMaterial("aws_secret_access_key: abc123")).toBe(
      "aws_secret_access_key: [redacted]",
    )
    expect(redactSecretMaterial("client_secret = topsecret")).toBe("client_secret = [redacted]")
    expect(redactSecretMaterial("session_token=IQoJb3JpZ2luX2VjEA")).toBe(
      "session_token=[redacted]",
    )
  })

  it("redacts a PEM block, which is how a key reaches a .tf attribute", () => {
    const pem =
      "private_key = -----BEGIN RSA PRIVATE KEY-----\nMIIEpAIB\nAQ==\n-----END RSA PRIVATE KEY-----"
    expect(redactSecretMaterial(pem)).not.toContain("MIIEpAIB")
  })

  it("leaves an access key ID intact — an id is not a credential, and the finding needs it", () => {
    const text = "AKIAIOSFODNN7EXAMPLE has not been rotated in 412 days"
    expect(redactSecretMaterial(text)).toBe(text)
  })

  it("leaves long resource names intact rather than eating the substance of the export", () => {
    const bucket = "tenure-northwind-documents-eu-west-1-0123456789abcdef0123456"
    expect(redactSecretMaterial(bucket)).toBe(bucket)
    expect(csvCell(bucket)).toBe(bucket)
  })

  it("redacts through the CSV and through the JSON envelope, not only in the helper", () => {
    const report: EstateDriftReport = {
      comparable: true,
      because: "",
      findings: [
        {
          kind: "divergent",
          resourceType: "s3:bucket",
          severity: "posture",
          declaredAt: "aws_s3_bucket.documents",
          declaredIn: "infrastructure/terraform/s3.tf:2",
          observed: "documents",
          observedArn: "arn:aws:s3:::documents",
          setting: "provider_credentials",
          declaredValue: 'secret_access_key = "wJalrXUtnFEMI/K7MDENG"',
          observedValue: "unset",
          detail: "the declaration hardcodes a credential",
        },
      ],
      uncomparable: [],
      blind: [],
      unobserved: [],
      filesRead: ["infrastructure/terraform/s3.tf"],
      asOf: T0,
    }
    const table = driftTable(report, PROVENANCE)
    expect(toCsv(table)).not.toContain("wJalrXUtnFEMI")
    expect(JSON.stringify(toEnvelope(table, { generatedAt: T0, correlationId: "req-1" }))).not.toContain(
      "wJalrXUtnFEMI",
    )
  })
})

/* --------------------------------------------------- 5. reachability plumbing -- */

describe("the request the route is allowed to serve", () => {
  it("recognises exactly four surfaces and two formats", () => {
    expect(isExportSurface("inventory")).toBe(true)
    expect(isExportSurface("coverage")).toBe(true)
    expect(isExportSurface("drift")).toBe(true)
    expect(isExportSurface("posture")).toBe(true)
    expect(isExportSurface("everything")).toBe(false)
    expect(isExportFormat("csv")).toBe(true)
    expect(isExportFormat("json")).toBe(true)
    expect(isExportFormat("xlsx")).toBe(false)
  })

  it("requires the tenant register's own permission from the three surfaces that carry tenant rows", () => {
    // The inventory writes a tenant slug onto every resource row. A family that
    // may not read the register must not receive it spread across an estate file.
    for (const surface of ["inventory", "coverage", "drift"] as const) {
      expect(EXPORT_COMMANDS[surface]).toContain("tenants.read")
      expect(EXPORT_COMMANDS[surface]).toContain("platform.read")
    }
    // Posture asks about controls, not about tenants.
    expect(EXPORT_COMMANDS.posture).toEqual(["platform.read"])
  })

  it("rations the export per operator, because one export is a hundred AWS describes", () => {
    __resetExportBudget()
    for (let i = 0; i < EXPORT_BUDGET; i += 1) {
      expect(consumeExportBudget("ops@tenure.dev", 1_000).allowed).toBe(true)
    }
    const refused = consumeExportBudget("ops@tenure.dev", 1_000)
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfterSeconds).toBeGreaterThan(0)

    // Per operator, not global: one operator's polling loop must not lock the
    // estate away from whoever is running the incident.
    expect(consumeExportBudget("other@tenure.dev", 1_000).allowed).toBe(true)

    // And the window rolls.
    expect(consumeExportBudget("ops@tenure.dev", 1_000 + 60_001).allowed).toBe(true)
  })

  it("gives every surface the provenance columns first and the remedy columns last", () => {
    for (const surface of ["inventory", "coverage", "drift", "posture"] as const) {
      const columns = columnsFor(surface)
      expect(columns.slice(0, 3)).toEqual(["surface", "state", "verdict"])
      expect(columns.slice(-2)).toEqual(["detail", "minimumStatement"])
    }
  })
})
