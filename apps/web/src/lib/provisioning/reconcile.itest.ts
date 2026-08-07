import { PrismaClient } from "@prisma/client";
import { REGISTRY } from "@tenure/platform-config";
import { createHash } from "node:crypto";

import {
  ReconcileRefused,
  reconcile,
  verifyDigest,
  type DeploymentManifest,
} from "./reconcile";

/**
 * The reconciler, against a real database.
 *
 * Idempotency cannot be tested with a mock. The property under test is that the
 * DATABASE refuses a duplicate — unique constraints on the slug, the email and
 * the (user, institution) pair — and a fake client would happily accept two of
 * everything and report success.
 *
 * Needs Postgres:
 *   DATABASE_URL=postgresql://tenure:tenure@localhost:5433/tenure
 */
const db = new PrismaClient({ log: ["error"] });

const SLUG = `itest-recon-${process.pid}`;
/** A second tenant, provisioned with the SAME administrator address. */
const SLUG_B = `itest-recon-b-${process.pid}`;
const ADMIN = `admin-${process.pid}@example.invalid`;

/** Build a manifest whose digest actually verifies, the way the engine does. */
function signed(over: Partial<DeploymentManifest> = {}): DeploymentManifest {
  const body = {
    slug: SLUG,
    manifestDigest: "manifest-digest-abc",
    configurationChecksum: "cfg-abc123",
    modules: ["organizations@1.0.0", "administration@1.0.0"],
    blueprintId: "university-student-organizations",
    schemaVersion: "2026.07.31",
    evidenceDigest: "evidence-abc",
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: "operator@tenure.example",
    ...over,
  };
  // Signed exactly as the engine signs: canonically, so key order cannot
  // change the answer.
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  const digest = createHash("sha256")
    .update(JSON.stringify(canonical(body)))
    .digest("hex")
    .slice(0, 32);
  return { ...body, digest };
}

const input = (manifest: DeploymentManifest) => ({
  manifest,
  displayName: "Reconcile Integration Test",
  initialAdminEmail: ADMIN,
  cellSchemaVersion: "2026.07.31",
  knownConfigKeys: new Set(REGISTRY.keys()),
  at: "2026-08-01T00:00:00.000Z",
});

async function cleanup() {
  for (const slug of [SLUG, SLUG_B]) {
    const inst = await db.institution.findUnique({ where: { slug } });
    if (inst) {
      await db.auditEvent.deleteMany({ where: { institutionId: inst.id } });
      await db.institutionMembership.deleteMany({
        where: { institutionId: inst.id },
      });
      await db.institution.delete({ where: { id: inst.id } });
    }
  }
  await db.user.deleteMany({ where: { email: ADMIN } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("reconcile", () => {
  it("materialises the tenant on first run", async () => {
    const report = await reconcile(db, input(signed()));

    expect(report.applied).toBe(true);
    expect(report.changes).toEqual([
      // The manifest under test carries `serving: false` — a tenant is created
      // unreachable and only activation publishes the artifact that turns it
      // on — and the change log says which, because "created a tenant" and
      // "created a tenant users can reach" are different events to an operator.
      `created institution "${SLUG}" (not yet serving)`,
      "created the administrator account",
      "granted director rights to the administrator",
    ]);

    const inst = await db.institution.findUnique({ where: { slug: SLUG } });
    expect(inst).not.toBeNull();

    const membership = await db.institutionMembership.findFirst({
      where: { institutionId: inst!.id },
      include: { user: true },
    });
    expect(membership!.role).toBe("OSE_DIRECTOR");
    expect(membership!.user.email).toBe(ADMIN);
  });

  it("is idempotent — a second run changes nothing and duplicates nothing", async () => {
    // GE-102-011. This is the requirement; everything else in the module exists
    // to make it true.
    const before = {
      institutions: await db.institution.count({ where: { slug: SLUG } }),
      users: await db.user.count({ where: { email: ADMIN } }),
    };

    const report = await reconcile(db, input(signed()));

    expect(report.changes).toEqual([]);
    expect(await db.institution.count({ where: { slug: SLUG } })).toBe(
      before.institutions,
    );
    expect(await db.user.count({ where: { email: ADMIN } })).toBe(before.users);

    const inst = await db.institution.findUnique({ where: { slug: SLUG } });
    expect(
      await db.institutionMembership.count({
        where: { institutionId: inst!.id },
      }),
    ).toBe(1);
  });

  it("survives concurrent reconciles without duplicating anything", async () => {
    // The case a check-then-write cannot handle: both callers see nothing and
    // both write. Only the database can arbitrate.
    await cleanup();

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => reconcile(db, input(signed()))),
    );
    // At least one must succeed; losers of a write race may throw, which is
    // correct — what must NOT happen is two of anything.
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);

    expect(await db.institution.count({ where: { slug: SLUG } })).toBe(1);
    expect(await db.user.count({ where: { email: ADMIN } })).toBe(1);
    const inst = await db.institution.findUnique({ where: { slug: SLUG } });
    expect(
      await db.institutionMembership.count({
        where: { institutionId: inst!.id },
      }),
    ).toBe(1);
  });

  it("refuses an artifact that does not verify", async () => {
    // Altered in transit: the field changes, the digest does not.
    const tampered = { ...signed(), configurationChecksum: "cfg-tampered" };
    expect(await verifyDigest(tampered)).toBe(false);

    await expect(reconcile(db, input(tampered))).rejects.toThrow(
      ReconcileRefused,
    );
    await expect(reconcile(db, input(tampered))).rejects.toThrow(
      /altered between publication/,
    );
  });

  it("refuses to apply across a schema boundary", async () => {
    // An engine ahead references columns the cell lacks; one behind omits
    // configuration the cell now requires. Both are wrong to guess at.
    const ahead = signed({ schemaVersion: "2026.12.01" });
    await expect(reconcile(db, input(ahead))).rejects.toThrow(
      /do not apply across a schema boundary/,
    );
  });

  it("refuses configuration this build does not implement", async () => {
    // GE-022-005. The schema check above pins the DATABASE and says nothing
    // about the config registry, so an engine that has gained a key and a cell
    // that has not been rebuilt agree on the schema and still disagree about
    // what the configuration means. Ignoring it is the silent failure: the
    // Studio shows the setting as published and the cell quietly does something
    // else.
    await cleanup();
    const future = signed({
      configKeys: [
        "platform.localization.locale",
        "platform.some.key.from.a.later.engine",
      ],
    });
    await expect(reconcile(db, input(future))).rejects.toThrow(
      ReconcileRefused,
    );
    await expect(reconcile(db, input(future))).rejects.toThrow(
      /platform\.some\.key\.from\.a\.later\.engine/,
    );
    // And nothing was written — a refusal is not a partial apply.
    expect(await db.institution.count({ where: { slug: SLUG } })).toBe(0);
  });

  it("applies a manifest whose keys this build does implement", async () => {
    await cleanup();
    const known = signed({ configKeys: ["platform.localization.locale"] });
    const report = await reconcile(db, input(known));
    expect(report.applied).toBe(true);
  });

  it("applies a manifest published before configKeys existed", async () => {
    // Absent is "the engine did not say", not "it sets nothing". A cell that
    // refused these would have broken every tenant deployed before this check.
    await cleanup();
    const old = signed();
    expect(old.configKeys).toBeUndefined();
    expect((await reconcile(db, input(old))).applied).toBe(true);
  });

  it("refuses without a usable administrator", async () => {
    await expect(
      reconcile(db, {
        ...input(signed()),
        initialAdminEmail: "not-an-address",
      }),
    ).rejects.toThrow(/nobody can sign into/);
  });

  it("records which artifact materialised the tenant", async () => {
    await cleanup();
    await reconcile(db, input(signed()));

    const inst = await db.institution.findUnique({ where: { slug: SLUG } });
    const audit = await db.auditEvent.findFirst({
      where: { institutionId: inst!.id, action: "Tenant.Reconciled" },
    });

    // Without this, "which manifest produced this tenant?" has no answer after
    // the fact — and that is the question asked first in an incident.
    expect(audit).not.toBeNull();
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta.deploymentDigest).toBe(signed().digest);
    expect(meta.configurationChecksum).toBe("cfg-abc123");

    // PAY-000-007. The row round-trips through the real column: a tenant coming
    // into existence has published no `platform.payments.mode`, so it is in
    // test mode, and the evidence says so rather than leaving it to be guessed
    // from the timestamp.
    expect(audit!.mode).toBe("test");
    expect(meta._mode).toBe("test");

    // And the row is CHAINED, which it was not before this writer moved onto
    // `recordAuditEvent`: it was built by `buildAuditRecord` directly, which
    // produces a record with no chain position — the state `verifyChain`
    // reports as unchained.
    expect(meta._sequence).toBe(0);
    expect(typeof meta._recordHash).toBe("string");
  });
});

describe("engine and cell agree on what a digest covers", () => {
  it("an artifact the ENGINE signs verifies with the CELL's independent verifier", async () => {
    // The one assertion that ties the two halves together.
    //
    // `deploymentManifest` (packages/provisioning) and `verifyDigest`
    // (apps/web) compute the digest separately, on purpose — a shared helper
    // would let both drift together and still agree. This test is what makes
    // that separation safe rather than merely principled: if either side ever
    // changes which fields are covered, an artifact stops verifying HERE,
    // loudly, instead of in production against a real tenant.
    const { deploymentManifest, executeStep, MANIFEST_VERSION } =
      await import("@tenure/provisioning");

    const tenantManifest = {
      manifestVersion: MANIFEST_VERSION,
      slug: SLUG,
      legalName: "Reconcile Integration Test",
      displayName: "Reconcile Integration Test",
      blueprintId: "university-student-organizations",
      modules: ["organizations"],
      entitlements: [],
      region: "us-east-1",
      isolation: "pooled" as const,
      coexistence: "TENURE_CLOUD_PRIMARY" as const,
      systemOfRecord: { org: "tenure" as const },
      configuration: {},
      secretRefs: {},
      initialAdminEmail: ADMIN,
    };

    const ctx = {
      // Real registry keys, not { a: 1 }. The manifest now declares which
      // configuration it sets, and a stub that invents a key produces an
      // artifact no engine would publish — which the cell then rightly refuses.
      resolveConfiguration: () => ({
        checksum: "cfg-cross-check",
        values: {
          "platform.localization.locale": "en-US",
          "platform.localization.currency": "USD",
        },
        problems: [],
      }),
      resolveModules: () => ({
        ordered: [{ key: "organizations", version: "1.0.0" }],
        problems: [],
      }),
      validateTopology: () => ({ valid: true, problems: [] }),
      schemaVersion: () => "2026.07.31",
    };

    const evidence = [executeStep("CONFIGURING", tenantManifest, ctx)];
    const produced = deploymentManifest(tenantManifest, evidence, ctx, {
      createdAt: "2026-08-01T00:00:00.000Z",
      createdBy: "operator@tenure.example",
      // CONFIGURING publishes the tenant created and unreachable; ACTIVATING
      // publishes the same system with serving: true, and that is the switch.
      serving: false,
    });

    expect(await verifyDigest(produced)).toBe(true);

    // And the cell applies it end to end — the full round trip, engine to rows.
    await cleanup();
    const report = await reconcile(db, {
      manifest: produced,
      displayName: "Reconcile Integration Test",
      initialAdminEmail: ADMIN,
      cellSchemaVersion: "2026.07.31",
      knownConfigKeys: new Set(REGISTRY.keys()),
      at: "2026-08-01T00:00:00.000Z",
    });

    expect(report.applied).toBe(true);
    expect(report.changes).toContain(
      `created institution "${SLUG}" (not yet serving)`,
    );
    expect(await db.institution.count({ where: { slug: SLUG } })).toBe(1);
  });
});

describe("the digest survives a round trip through a store", () => {
  it("verifies after the artifact's keys are reordered", async () => {
    // The bug this exists for. The engine signs the manifest, writes it to
    // DynamoDB, reads it back to deliver it — and a DynamoDB map has no key
    // order, so what came back was a different ENCODING of identical content.
    // Hashing `JSON.stringify(body)` compared bytes rather than meaning, and
    // the cell refused its own engine's artifact as "altered between
    // publication and here".
    //
    // No unit test could have found it: both sides agreed perfectly until a
    // real store sat between them. This simulates the store by shuffling the
    // keys, which is the only property of DynamoDB that mattered.
    const original = signed();
    expect(await verifyDigest(original)).toBe(true);

    const shuffled = Object.fromEntries(
      Object.entries(original).sort(() => -1),
    ) as unknown as DeploymentManifest;

    expect(Object.keys(shuffled)).not.toEqual(Object.keys(original));
    expect(await verifyDigest(shuffled)).toBe(true);
  });

  it("still refuses an artifact whose content actually changed", async () => {
    // Canonicalising must not make the digest indifferent to the thing it
    // exists to protect.
    const tampered = { ...signed(), configurationChecksum: "cfg-tampered" };
    expect(await verifyDigest(tampered)).toBe(false);

    const reordered = Object.fromEntries(
      Object.entries(tampered).reverse(),
    ) as unknown as DeploymentManifest;
    expect(await verifyDigest(reordered)).toBe(false);
  });
});

/**
 * GE-044-005 — an address is a label, and reusing an account is not silent.
 *
 * `reconcile` upserts the administrator by email, because a person genuinely
 * does hold seats at more than one institution and `User` is platform-global by
 * design. That is right, and it is also how a typo hands director rights over
 * one tenant to somebody who belongs to another.
 *
 * The upsert cannot tell those apart. Nothing can, from an address alone —
 * which is GE-040-002's whole point. What the operator gets instead is the fact
 * stated plainly, at the moment it happens, with the number of institutions that
 * account has ever been placed at. History, not live access: an account revoked
 * elsewhere last year still belongs to a person from elsewhere.
 */
describe("provisioning a second tenant with an existing administrator's address", () => {
  it("says the account was reused, and how many institutions it already holds", async () => {
    // The first tenant already exists from the tests above, with ADMIN as its
    // director. This provisions a second one with the same address.
    const report = await reconcile(db, {
      ...input(signed({ slug: SLUG_B })),
      displayName: "Reconcile Integration Test B",
    });

    expect(report.applied).toBe(true);
    const reuse = report.changes.find((change) =>
      change.startsWith("reused the existing account"),
    );

    expect(reuse).toBeDefined();
    expect(reuse).toContain(ADMIN);
    expect(reuse).toContain("placed at 1 other institution");
    expect(reuse).toContain("confirm this is the same person");
  });

  it("does not report creating an account it did not create", async () => {
    const report = await reconcile(db, {
      ...input(signed({ slug: SLUG_B })),
      displayName: "Reconcile Integration Test B",
    });
    expect(report.changes).not.toContain("created the administrator account");
  });

  it("attaches to the same person rather than making a second one", async () => {
    // The behaviour is deliberate — one human, two institutions — and the
    // reporting exists because it is indistinguishable from the mistake.
    expect(await db.user.count({ where: { email: ADMIN } })).toBe(1);

    const user = await db.user.findUniqueOrThrow({ where: { email: ADMIN } });
    const memberships = await db.institutionMembership.findMany({
      where: { userId: user.id },
      include: { institution: true },
    });

    expect(memberships.map((m) => m.institution.slug).sort()).toEqual(
      [SLUG, SLUG_B].sort(),
    );
    for (const membership of memberships)
      expect(membership.role).toBe("OSE_DIRECTOR");
  });

  it("stays quiet on a re-run, because nothing is attached the second time", async () => {
    // Reuse is news when an account is attached to an institution it did not
    // belong to. Re-running the same manifest attaches nothing, so a report
    // that still announced a reuse would be noise — and a report that is noise
    // is one nobody reads.
    const report = await reconcile(db, {
      ...input(signed({ slug: SLUG_B })),
      displayName: "Reconcile Integration Test B",
    });
    expect(report.changes).toEqual([]);
  });
});
