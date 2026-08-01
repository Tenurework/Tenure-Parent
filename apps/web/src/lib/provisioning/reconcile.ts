import { buildAuditRecord } from "@tenure/audit"
import type { Prisma } from "@prisma/client"

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
  slug: string
  manifestDigest: string
  configurationChecksum: string
  modules: readonly string[]
  blueprintId: string
  schemaVersion: string
  evidenceDigest: string
  digest: string
  createdAt: string
  createdBy: string
}

/** What the cell needs beyond the artifact, because the artifact does not carry it. */
export interface ReconcileInput {
  manifest: DeploymentManifest
  /** Display name for the institution. Not in the digest-covered artifact. */
  displayName: string
  /** Who gets director rights. Exactly one. */
  initialAdminEmail: string
  /** The schema version THIS cell is at. Compared, never assumed. */
  cellSchemaVersion: string
  /** Supplied so a run is reproducible in a test. */
  at: string
}

export interface ReconcileReport {
  slug: string
  applied: boolean
  /** Only what genuinely changed. A second run reports an empty list. */
  changes: string[]
  institutionId?: string
  refusal?: string
}

export class ReconcileRefused extends Error {
  constructor(
    message: string,
    readonly reason: "digest" | "schema" | "input",
  ) {
    super(message)
    this.name = "ReconcileRefused"
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
export async function verifyDigest(manifest: DeploymentManifest): Promise<boolean> {
  const { createHash } = await import("node:crypto")
  const { digest, ...body } = manifest
  const computed = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32)
  return computed === digest
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
 * transaction, and the callback's client is `Prisma.TransactionClient` either
 * way because that is what both hand it.
 */
export interface ReconcileClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction<T>(fn: (tx: any) => Promise<T>, options?: unknown): Promise<T>
}

export async function reconcile(db: ReconcileClient, input: ReconcileInput): Promise<ReconcileReport> {
  const { manifest } = input
  const changes: string[] = []

  if (!(await verifyDigest(manifest))) {
    throw new ReconcileRefused(
      `Deployment manifest for "${manifest.slug}" does not verify. Its digest covers every other ` +
        `field, so this means the artifact was altered between publication and here.`,
      "digest",
    )
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
    )
  }

  if (!input.initialAdminEmail.includes("@")) {
    throw new ReconcileRefused(
      "No usable administrator address. A system nobody can sign into is not deployed.",
      "input",
    )
  }

  const email = input.initialAdminEmail.toLowerCase()

  // Everything in one transaction: a cell left with an institution but no
  // administrator is worse than one left with neither, because it looks
  // provisioned.
  const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.institution.findUnique({ where: { slug: manifest.slug } })

    const institution = await tx.institution.upsert({
      where: { slug: manifest.slug },
      update: { name: input.displayName },
      create: { slug: manifest.slug, name: input.displayName },
    })
    if (!existing) changes.push(`created institution "${manifest.slug}"`)
    else if (existing.name !== input.displayName) changes.push("updated institution name")

    const existingUser = await tx.user.findUnique({ where: { email } })
    const user = await tx.user.upsert({
      where: { email },
      update: {},
      create: { email, name: email.split("@")[0] },
    })
    if (!existingUser) changes.push("created the administrator account")

    const existingMembership = await tx.institutionMembership.findUnique({
      where: { userId_institutionId: { userId: user.id, institutionId: institution.id } },
    })
    await tx.institutionMembership.upsert({
      where: { userId_institutionId: { userId: user.id, institutionId: institution.id } },
      update: { role: "OSE_DIRECTOR" },
      create: { userId: user.id, institutionId: institution.id, role: "OSE_DIRECTOR" },
    })
    if (!existingMembership) changes.push("granted director rights to the administrator")

    // The record that a tenant was materialised here, and by which artifact.
    //
    // Built through @tenure/audit rather than hand-assembled: that validates the
    // required fields, refuses a DENY with no reason, and redacts sensitive
    // metadata. 34 of 35 audit writes in this application skip all of it
    // (subsystem-paths.md §3) and a ratchet stops a 35th being added — this is
    // a new write, so it goes through the package, which is where they are all
    // heading anyway.
    //
    // Inside the transaction, so it cannot exist for a reconcile that rolled back.
    const record = buildAuditRecord({
      tenantId: institution.id,
      actor: { principalId: user.id },
      action: "Tenant.Reconciled",
      resourceType: "Institution",
      resourceId: institution.id,
      outcome: "ALLOW",
      occurredAt: input.at,
      metadata: {
        manifestDigest: manifest.manifestDigest,
        deploymentDigest: manifest.digest,
        configurationChecksum: manifest.configurationChecksum,
        modules: [...manifest.modules],
        publishedBy: manifest.createdBy,
        publishedAt: manifest.createdAt,
        changes,
      },
    })

    await tx.auditEvent.create({
      data: {
        institutionId: record.tenantId,
        actorId: record.actorId,
        action: record.action,
        resourceType: record.resourceType,
        resourceId: record.resourceId ?? undefined,
        outcome: record.outcome,
        reason: record.reason ?? undefined,
        metadata: record.metadata as Prisma.InputJsonValue,
      },
    })

    return institution.id
  })

  return { slug: manifest.slug, applied: true, changes, institutionId: result }
}
