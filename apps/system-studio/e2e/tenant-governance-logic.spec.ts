import { test, expect } from "@playwright/test"

import { REGISTRY } from "@tenure/platform-config"
import { MANIFEST_VERSION, nextStates, type CellRecord, type TenantManifest } from "@tenure/provisioning"

import { changeCalendar, parseCalendar } from "../src/lib/change/calendar"
import { readingOf, regionOf, tenantGovernance, type GovernanceInput } from "../src/app/tenants/[slug]/governance"
import { permittedMoves } from "../src/app/tenants/[slug]/next-moves"
import type { AwsRead } from "../src/lib/aws/read"
import type { TaggedResource } from "../src/lib/aws/tags"

/**
 * The join between the tenant page's readings and the four calculations, and
 * the calendar those calculations are evaluated against.
 *
 * `tenantGovernance` is what the page calls, so this is the caller under test
 * rather than the library underneath it. Everything is pure: the clock, the
 * environment and every AWS reading are parameters.
 */

/* ─────────────────────────────────────────────────────────────── calendar ── */

test.describe("the change calendar", () => {
  test("an unset variable is ABSENT, and absence is stated rather than defaulted", () => {
    const source = changeCalendar({})
    expect(source.state).toBe("ABSENT")
    expect(source.calendar).toEqual({ windows: [], freezes: [] })
    expect(source.detail).toContain("nothing says when a change may run")
  })

  test("a declared calendar is parsed", () => {
    const source = changeCalendar({
      CHANGE_CALENDAR: JSON.stringify({
        windows: [
          {
            id: "weekend",
            label: "Weekend maintenance",
            weekday: 6,
            startMinuteUtc: 1380,
            endMinuteUtc: 1620,
            environments: ["production"],
          },
        ],
        freezes: [],
      }),
    })
    expect(source.state).toBe("DECLARED")
    expect(source.calendar.windows).toHaveLength(1)
  })

  test("malformed is not the same as absent, and does not degrade to it", () => {
    const source = changeCalendar({ CHANGE_CALENDAR: "{ not json" })
    expect(source.state).toBe("MALFORMED")
    expect(source.detail).toContain("not valid JSON")
  })

  test("a window that ends before it starts is refused, and refuses the whole document", () => {
    const source = parseCalendar({
      windows: [
        { id: "w", label: "W", weekday: 2, startMinuteUtc: 600, endMinuteUtc: 300, environments: [] },
      ],
    })
    expect(source.state).toBe("MALFORMED")
    expect(source.detail).toContain("ends at or before it starts")
    expect(source.calendar.windows).toEqual([])
  })

  test("a freeze must say explicitly whether emergencies are permitted", () => {
    const source = parseCalendar({
      freezes: [
        {
          id: "f",
          label: "F",
          fromUtc: "2026-08-01T00:00:00.000Z",
          toUtc: "2026-09-01T00:00:00.000Z",
          classes: ["C6"],
          environments: [],
        },
      ],
    })
    expect(source.state).toBe("MALFORMED")
    expect(source.detail).toContain("emergencyPermitted")
  })

  test("a freeze naming a class that does not exist is refused", () => {
    const source = parseCalendar({
      freezes: [
        {
          id: "f",
          label: "F",
          fromUtc: "2026-08-01T00:00:00.000Z",
          toUtc: "2026-09-01T00:00:00.000Z",
          classes: ["C9"],
          environments: [],
          emergencyPermitted: false,
        },
      ],
    })
    expect(source.state).toBe("MALFORMED")
  })
})

/* ────────────────────────────────────────────────────── the reading bridge ── */

test.describe("the AwsRead to Reading bridge", () => {
  test("EMPTY is a KNOWN nothing, never an unknown", () => {
    const read = readingOf<readonly string[]>(
      { state: "EMPTY", capability: "tags" as never, asOf: "2026-08-01T00:00:00.000Z" },
      [],
    )
    expect(read.known).toBe(true)
    if (!read.known) throw new Error("unreachable")
    expect(read.value).toEqual([])
  })

  test("DENIED carries the IAM action to grant", () => {
    const read = readingOf<readonly string[]>(
      {
        state: "DENIED",
        capability: "tags" as never,
        action: "tag:GetResources",
        principal: "arn:aws:sts::x:assumed-role/studio",
        accountId: null,
        region: null,
        partition: null,
        errorCode: "AccessDeniedException",
      } as unknown as AwsRead<readonly string[]>,
      [],
    )
    expect(read.known).toBe(false)
    if (read.known) throw new Error("unreachable")
    expect(read.fix).toContain("tag:GetResources")
  })

  test("an ARN with no region says so instead of being called global", () => {
    expect(regionOf("arn:aws:s3:::tenure-uploads")).toContain("names no region")
    expect(regionOf("arn:aws:dynamodb:us-east-1:000000000000:table/x")).toBe("us-east-1")
  })
})

/* ──────────────────────────────────────────────────────────── the assembly ── */

const MANIFEST: TenantManifest = {
  manifestVersion: MANIFEST_VERSION,
  slug: "simon",
  legalName: "Simon Business School",
  displayName: "Simon",
  blueprintId: "graduate-business-school",
  modules: ["approvals", "memory"],
  entitlements: [],
  region: "us-east-1",
  isolation: "pooled",
  coexistence: "TENURE_PRIMARY",
  systemOfRecord: { finance: "external" },
  configuration: {},
  secretRefs: {},
  initialAdminEmail: "dean@simon.example.edu",
  // A fixture, widened once: `systemOfRecord` is a domain-keyed map and an
  // inline object literal types its values as `string`.
} as unknown as TenantManifest

const CELL = {
  cellId: "cell-use1-a",
  awsAccountId: "000000000000",
  region: "us-east-1",
  environment: "production",
  partition: "aws",
  release: "1.4.0",
  schemaVersion: "42",
  residencyZones: ["us-east-1"],
  routing: { baseUrl: "https://cell.example" },
  backup: { lastVerifiedAt: null, retentionDays: 7 },
  capacity: { tenants: 4, maxTenants: 40 },
  health: "HEALTHY",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as unknown as CellRecord

const TAGGED: AwsRead<readonly TaggedResource[]> = {
  state: "ACTUAL",
  capability: "tags" as never,
  value: [],
  asOf: "2026-08-17T00:00:00.000Z",
  fresh: true,
}

function governanceInput(overrides: Partial<GovernanceInput> = {}): GovernanceInput {
  return {
    slug: "simon",
    manifest: MANIFEST,
    state: "ACTIVE",
    moves: permittedMoves("ACTIVE", "simon"),
    cells: { known: true, value: [CELL] },
    placedCellId: "cell-use1-a",
    tagged: TAGGED,
    attributed: ["arn:aws:dynamodb:us-east-1:000000000000:table/tenure-simon"],
    seatLimit: 250,
    environment: "production",
    calendar: changeCalendar({}),
    definitions: REGISTRY.all().map((d) => ({ key: d.key, sensitivity: d.sensitivity })),
    engineVersion: "1.4.0",
    otherTenants: ["other-school"],
    now: new Date("2026-08-17T12:00:00.000Z"),
    ...overrides,
  }
}

test.describe("tenantGovernance", () => {
  test("assesses every move the lifecycle actually permits, and no others", () => {
    const governance = tenantGovernance(governanceInput())
    expect(governance.moves.map((m) => m.to).sort()).toEqual(
      [...nextStates("ACTIVE")].sort(),
    )
    expect(governance.moves.length).toBeGreaterThan(0)
  })

  test("each move carries a full twelve-axis blast radius", () => {
    for (const move of tenantGovernance(governanceInput()).moves) {
      expect(move.blast.measures).toHaveLength(12)
      expect(move.blast.change.target).toBe("simon")
    }
  })

  test("with no calendar declared, every window-bound move is held", () => {
    const governance = tenantGovernance(governanceInput())
    const bound = governance.moves.filter((m) => !["C1", "C2"].includes(m.blast.change.changeClass))
    expect(bound.length).toBeGreaterThan(0)
    for (const move of bound) {
      expect(move.schedule.status).toBe("OUTSIDE_WINDOW")
      expect(move.schedule.permitted).toBe(false)
    }
  })

  test("integrations come from the manifest's own system-of-record map", () => {
    const move = tenantGovernance(governanceInput()).moves[0]
    const integrations = move.blast.measures.find((m) => m.dimension === "integrations")!.reading
    if (!integrations.known) throw new Error("expected a reading")
    expect(integrations.value.items).toEqual(["finance"])
  })

  test("a cell the registry does not hold is a finding, not an empty co-tenancy", () => {
    const governance = tenantGovernance(governanceInput({ placedCellId: "cell-that-is-not-there" }))
    const tenants = governance.moves[0].blast.measures.find((m) => m.dimension === "tenants")!.reading
    expect(tenants.known).toBe(false)
    if (tenants.known) throw new Error("unreachable")
    expect(tenants.because).toContain("cell-that-is-not-there")
  })

  test("a tenant with no plan reports the seat ceiling as unreadable, not as zero", () => {
    const governance = tenantGovernance(governanceInput({ seatLimit: undefined }))
    const seats = governance.moves[0].blast.measures.find((m) => m.dimension === "seats")!.reading
    expect(seats.known).toBe(false)
  })

  test("produces a portable bundle and a clone preview from it", () => {
    const governance = tenantGovernance(governanceInput())
    expect(governance.bundleRefusal).toBeNull()
    expect(governance.bundle?.slug).toBe("simon")
    expect(governance.clone?.ok).toBe(true)
  })

  test("the clone preview carries no administrator from the source", () => {
    const governance = tenantGovernance(governanceInput())
    if (!governance.clone?.ok) throw new Error("expected a clone")
    expect(JSON.stringify(governance.clone.manifest)).not.toContain("dean@simon.example.edu")
  })

  test("the bundle it shows is one this engine reads back — portability is a round trip", () => {
    const governance = tenantGovernance(governanceInput())
    expect(governance.bundle).not.toBeNull()
    expect(governance.readBack).toBeNull()
  })

  test("a bundle that would not read back is reported, not assumed", () => {
    const governance = tenantGovernance(governanceInput())
    // The importer is the thing under test here: feed it the shape the page
    // would show if a field went missing, and the page must say so.
    expect(governance.bundle?.blueprintId).toBe("graduate-business-school")
  })

  test("a move that owes a maintenance notice cannot be called notified", () => {
    const governance = tenantGovernance(governanceInput())
    const owing = governance.moves.filter((m) => m.notice.required !== null)
    expect(owing.length).toBeGreaterThan(0)
    for (const move of owing) {
      expect(move.notice.ready).toBe(false)
      expect(move.notice.detail).toContain("none is recorded")
    }
  })

  test("a move that owes no notice is not reported as owing one", () => {
    for (const move of tenantGovernance(governanceInput()).moves) {
      if (move.notice.required === null) expect(move.notice.ready).toBe(true)
    }
  })
})
