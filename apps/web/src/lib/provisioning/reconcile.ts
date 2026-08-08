import { recordAuditEvent, txAuditLedger } from "@/lib/audit-record";
// Type-only, so nothing about the concrete client is pulled in here: the
// callback's client is the tenancy-extended one, which is what `txAuditLedger`
// asks for. `Prisma.TransactionClient` describes the UNextended client and
// stopped matching once the extension was attached (see db.ts).
import type { TxClient } from "@/lib/db";

/**
 * The cell side of provisioning.
 *
 * The engine composes a tenant, validates it, and signs a deployment manifest.
 * It does not write into a tenant's database — the Studio can see every
 * tenant's configuration, and a console that could also write their rows would
 * be one credential away from being the worst thing in the estate. So the
 * engine publishes, and this reconciles.
 *
 * ── Idempotency is the whole requirement ───────────────────────────────────
 *
 * GE-102-011: a retry must not duplicate an account, a membership, or an
 * invitation. That is not achieved by checking first and then writing — two
 * concurrent reconciles both pass the check. It is achieved by making the
 * database refuse a duplicate: `Institution.slug`, `User.email` and
 * `InstitutionMembership(userId, institutionId)` are all unique, and every
 * write below is an upsert against one of those keys.
 *
 * So this can be run twice, or fifty times, or twice concurrently, and the
 * result is the same rows. `reconcile` reports what it actually changed rather
 * than what it attempted, which is what makes a second run visibly a no-op
 * instead of indistinguishable from the first.
 */

/** The artifact the engine signed. Structurally identical to @tenure/provisioning's. */
export interface DeploymentManifest {
  slug: string;
  manifestDigest: string;
  configurationChecksum: string;
  modules: readonly string[];
  blueprintId: string;
  schemaVersion: string;
  /**
   * Configuration keys the engine's composed configuration actually sets.
   *
   * Optional, because manifests published before GE-022-005 do not carry it and
   * a cell that refused them would have broken every existing tenant. Absent
   * means "the engine did not say", which is checked as no requirement rather
   * than as an empty one — those are different claims.
   */
  configKeys?: readonly string[];
  /**
   * Whether this cell may serve the tenant to users.
   *
   * Optional for the same reason `configKeys` is: manifests published before
   * this field existed do not carry it, and a cell that read absence as `false`
   * would take every already-live tenant off the air the first time an old
   * artifact was re-delivered.
   *
   * Absent means "the engine did not say", which is not the same as "no". The
   * reconciler leaves an existing tenant's setting untouched and refuses to
   * serve a NEW one — because for a tenant nobody has decided about, not
   * serving is the only safe reading.
   */
  serving?: boolean;
  evidenceDigest: string;
  digest: string;
  /**
   * Who produced the artifact, provably. STUDIO-070-009.
   *
   * Optional for the same reason `configKeys` and `serving` are: manifests
   * published before signing existed do not carry one, and refusing those would
   * break every already-live tenant on the first re-delivery.
   *
   * It is NOT part of what `digest` covers — the engine computes both over the
   * same body, with neither field in it — so `verifyDigest` strips it. Leaving
   * it in the hash would make every signed artifact fail verification here,
   * which is the one bug in this file that would be a total outage rather than a
   * refusal.
   */
  signature?: { keyId: string; algorithm: string; value: string };
  createdAt: string;
  createdBy: string;
}

/** What the cell needs beyond the artifact, because the artifact does not carry it. */
export interface ReconcileInput {
  manifest: DeploymentManifest;
  /** Display name for the institution. Not in the digest-covered artifact. */
  displayName: string;
  /** Who gets director rights. Exactly one. */
  initialAdminEmail: string;
  /** The schema version THIS cell is at. Compared, never assumed. */
  cellSchemaVersion: string;
  /**
   * Configuration keys THIS build implements.
   *
   * Passed in rather than read from the registry here, for the same reason
   * `cellSchemaVersion` is: this function compares what it is given and assumes
   * nothing about its environment, which is what makes it testable without one.
   */
  knownConfigKeys: ReadonlySet<string>;
  /** Supplied so a run is reproducible in a test. */
  at: string;
}

export interface ReconcileReport {
  slug: string;
  applied: boolean;
  /** Only what genuinely changed. A second run reports an empty list. */
  changes: string[];
  institutionId?: string;
  refusal?: string;
}

export class ReconcileRefused extends Error {
  constructor(
    message: string,
    readonly reason: "digest" | "schema" | "input" | "compatibility",
  ) {
    super(message);
    this.name = "ReconcileRefused";
  }
}

/**
 * Recompute the artifact's digest and compare.
 *
 * The engine digests the body over these exact fields; a cell that applied
 * without checking would be trusting the transport rather than the artifact.
 * This is deliberately a separate implementation from the engine's — if the two
 * ever disagree about what is covered, an artifact stops verifying, which is the
 * correct outcome and far better than both drifting together.
 */
export async function verifyDigest(
  manifest: DeploymentManifest,
): Promise<boolean> {
  const { createHash } = await import("node:crypto");
  // BOTH are stripped. `digest` obviously — it cannot cover itself. `signature`
  // because the engine computes the MAC over the same bytes the digest covers,
  // so it is not in the hashed body either; leaving it in here would make every
  // signed artifact fail verification and take provisioning down entirely.
  // `packages/provisioning/src/execute.ts` (`deploymentBytes`) is the other side
  // of this agreement, and the itest below is what keeps the two honest.
  const { digest, signature, ...body } = manifest;
  void signature;

  // Key order must not change the answer. The artifact is stored in DynamoDB
  // between being signed and being delivered, and a DynamoDB map has no order —
  // so hashing `JSON.stringify(body)` directly compared the bytes of two
  // different encodings of the same content, and this refused its own engine's
  // artifact as "altered". Sorting at every level is what makes the digest a
  // property of the meaning rather than of the transport.
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    }
    return value;
  };

  const computed = createHash("sha256")
    .update(JSON.stringify(canonical(body)))
    .digest("hex")
    .slice(0, 32);
  return computed === digest;
}

/**
 * Bring this cell to the state the manifest describes.
 *
 * Refuses rather than partially applying: an artifact that does not verify, or
 * that was built against a schema this cell is not at, is not something to make
 * a best effort with.
 */
/**
 * The client this needs, named by what it does rather than by its type.
 *
 * The application's `db` is a PrismaClient wrapped in the tenancy extension —
 * nominally a different type, structurally a superset. Typing this parameter as
 * `PrismaClient` refused the extended client; typing it as the extended client
 * would refuse a plain one. It needs a transaction, so it asks for a
 * transaction, and the callback's client is the extended `TxClient` either
 * way because that is what both hand it.
 */
export interface ReconcileClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction<T>(fn: (tx: any) => Promise<T>, options?: unknown): Promise<T>;
}

export async function reconcile(
  db: ReconcileClient,
  input: ReconcileInput,
): Promise<ReconcileReport> {
  const { manifest } = input;
  const changes: string[] = [];

  if (!(await verifyDigest(manifest))) {
    throw new ReconcileRefused(
      `Deployment manifest for "${manifest.slug}" does not verify. Its digest covers every other ` +
        `field, so this means the artifact was altered between publication and here.`,
      "digest",
    );
  }

  if (manifest.schemaVersion !== input.cellSchemaVersion) {
    // Forward or backward, both are wrong to guess at. An engine ahead of the
    // cell would reference columns that do not exist; an engine behind would
    // silently omit configuration the cell now requires.
    throw new ReconcileRefused(
      `Manifest was built against schema ${manifest.schemaVersion}; this cell is at ` +
        `${input.cellSchemaVersion}. Migrate the cell, or republish from an engine at the same ` +
        `version — do not apply across a schema boundary.`,
      "schema",
    );
  }

  // GE-022-005. `schemaVersion` above pins the DATABASE and says nothing about
  // the configuration registry, so an engine that has gained a key and a cell
  // that has not been rebuilt can agree on the schema and still disagree about
  // what the configuration means. Ignoring the unknown key is the silent
  // failure: the Studio shows the setting as published and the cell quietly
  // does something else, and nobody finds out until someone asks why it had no
  // effect.
  //
  // Absent `configKeys` is "the engine did not say" — a manifest published
  // before this existed — and is not treated as "it sets nothing".
  if (manifest.configKeys) {
    const unimplemented = manifest.configKeys.filter(
      (key) => !input.knownConfigKeys.has(key),
    );
    if (unimplemented.length > 0) {
      throw new ReconcileRefused(
        `Manifest for "${manifest.slug}" sets configuration this build does not implement: ` +
          `${unimplemented.join(", ")}. Applying it would show the setting as published and ` +
          `have no effect. Rebuild the cell from an engine that has these keys.`,
        "compatibility",
      );
    }
  }

  if (!input.initialAdminEmail.includes("@")) {
    throw new ReconcileRefused(
      "No usable administrator address. A system nobody can sign into is not deployed.",
      "input",
    );
  }

  const email = input.initialAdminEmail.toLowerCase();

  // Everything in one transaction: a cell left with an institution but no
  // administrator is worse than one left with neither, because it looks
  // provisioned.
  const result = await db.$transaction(async (tx: TxClient) => {
    const existing = await tx.institution.findUnique({
      where: { slug: manifest.slug },
    });

    // `serving` comes from the signed artifact, on both create and update.
    //
    // On update as well as create, because activation is exactly the case where
    // the institution already exists: `MIGRATING` delivers one with
    // `serving: false` and `ACTIVATING` delivers a second setting it true. An
    // upsert that only set it on create would make the activation manifest a
    // no-op, which is the defect this replaced.
    const institution = await tx.institution.upsert({
      where: { slug: manifest.slug },
      update: {
        name: input.displayName,
        // Only when the engine said. An older artifact that does not carry the
        // field must not silently withdraw a tenant that is already serving.
        ...(manifest.serving === undefined
          ? {}
          : { serving: manifest.serving }),
      },
      // A tenant nobody has decided about is not served. This is the one place
      // the reading is strict, and it is strict because it is about a tenant
      // that did not exist a moment ago.
      create: {
        slug: manifest.slug,
        name: input.displayName,
        serving: manifest.serving ?? false,
      },
    });
    if (!existing) {
      changes.push(
        `created institution "${manifest.slug}" (${manifest.serving ? "serving" : "not yet serving"})`,
      );
    } else {
      if (existing.name !== input.displayName)
        changes.push("updated institution name");
      if (
        manifest.serving !== undefined &&
        existing.serving !== manifest.serving
      ) {
        changes.push(
          manifest.serving
            ? "activated: now serving"
            : "withdrawn from serving",
        );
      }
    }

    const existingUser = await tx.user.findUnique({ where: { email } });
    const user = await tx.user.upsert({
      where: { email },
      update: {},
      create: { email, name: email.split("@")[0] },
    });

    if (!existingUser) changes.push("created the administrator account");

    const existingMembership = await tx.institutionMembership.findUnique({
      where: {
        userId_institutionId: {
          userId: user.id,
          institutionId: institution.id,
        },
      },
    });

    if (existingUser && !existingMembership) {
      // GE-044-005. Attaching an existing account to a new institution is not
      // silent.
      //
      // The upsert keys on email, and an address is a label rather than a
      // person (GE-040-002). Two institutions provisioned with one address is
      // sometimes right — an IT contractor working with both — and sometimes a
      // typo that has just handed director rights over one tenant to somebody
      // who belongs to another. The upsert cannot tell those apart and neither
      // can this; what it can do is refuse to let the difference pass unseen.
      //
      // Reported with the count of institutions the account already holds,
      // because "reused an existing account" is easy to skim past and "already
      // belongs to 1 other institution" is not.
      //
      // Conditioned on the membership being new, so a re-run of the same
      // manifest still reports nothing — the account was already this
      // institution's director, and nothing was attached.
      // Deliberately NOT filtered to live memberships, and deliberately worded
      // as history rather than as current access.
      //
      // The question is "has this address ever been placed somewhere else",
      // which is what makes an operator stop and check. An account whose
      // membership at another institution was revoked last year still belongs
      // to a person from that institution, and reusing it is still the thing to
      // confirm — a live filter would go quiet on exactly that case. A false
      // alarm costs a moment's thought; a missed one costs a wrong director.
      //
      // No `institutionId: { not: … }` filter either: this runs before the
      // membership upsert below, so the institution being provisioned is not in
      // the count yet. An exclusion would be a clause that decides nothing — a
      // mutation removing it changed no outcome, which is how it was found. The
      // ordering is what makes the number right, and the integration test pins
      // that number at one rather than trusting the reading.
      const priorPlacements = await tx.institutionMembership.count({
        where: { userId: user.id },
      });
      changes.push(
        priorPlacements === 0
          ? `reused the existing account for ${email}`
          : `reused the existing account for ${email}, which has been placed at ${priorPlacements} other institution${priorPlacements === 1 ? "" : "s"} — confirm this is the same person`,
      );
    }
    await tx.institutionMembership.upsert({
      where: {
        userId_institutionId: {
          userId: user.id,
          institutionId: institution.id,
        },
      },
      update: { role: "OSE_DIRECTOR" },
      create: {
        userId: user.id,
        institutionId: institution.id,
        role: "OSE_DIRECTOR",
      },
    });
    if (!existingMembership)
      changes.push("granted director rights to the administrator");

    // The record that a tenant was materialised here, and by which artifact.
    //
    // Written through `recordAuditEvent` on the caller's own `tx`, not through
    // `buildAuditRecord` directly. The builder validates the required fields,
    // refuses a DENY with no reason and redacts sensitive metadata; the
    // chokepoint adds the hash chain, the release stamp and the money-mode on
    // top of that, and a record with no chain position is one `verifyChain`
    // reports as unchained — which was this row's state until PAY-000-007.
    //
    // `txAuditLedger(tx)` rather than the default ledger: `prismaAuditLedger`
    // opens its own `$transaction`, and PostgreSQL has no nested transactions,
    // so the audit row would commit independently of the reconcile it
    // describes. On `tx` it is inside the same transaction, so it cannot exist
    // for a reconcile that rolled back.
    //
    // `mode` is explicit here because this is the one writer that legitimately
    // runs OUTSIDE a tenant scope: it is materialising the tenant, so there is
    // no scope to resolve a mode from yet. A tenant coming into existence is in
    // test mode — nothing has published `platform.payments.mode` for it, and
    // the definition's own default is `test`.
    await recordAuditEvent(
      {
        institutionId: institution.id,
        actor: { principalId: user.id },
        action: "Tenant.Reconciled",
        resourceType: "Institution",
        resourceId: institution.id,
        outcome: "ALLOW",
        mode: "test",
        occurredAt: new Date(input.at),
        metadata: {
          manifestDigest: manifest.manifestDigest,
          deploymentDigest: manifest.digest,
          configurationChecksum: manifest.configurationChecksum,
          modules: [...manifest.modules],
          publishedBy: manifest.createdBy,
          publishedAt: manifest.createdAt,
          changes,
        },
      },
      txAuditLedger(tx),
    );

    return institution.id;
  });

  return { slug: manifest.slug, applied: true, changes, institutionId: result };
}
