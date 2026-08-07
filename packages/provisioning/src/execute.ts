import { createHash } from "node:crypto";

import type { TenantManifest } from "./manifest";
import { digestOf } from "./manifest";
import type { TenantState } from "./lifecycle";

/**
 * The work each lifecycle state actually does.
 *
 * Until this existed, advancing a tenant recorded that provisioning had
 * happened without provisioning anything — a lifecycle that is only a lifecycle.
 * The distinction matters more here than almost anywhere else in the platform,
 * because the artifact this produces is what a cell later applies.
 *
 * ── The control-plane split, and why the executor stops where it does ───────
 *
 * The engine must never write into a tenant's database. That is not a
 * preference — the Studio shows every tenant's configuration, and a console
 * that could also write to any tenant's rows is one credential away from being
 * the worst thing in the estate.
 *
 * So provisioning is a control plane. It computes, validates and **digests** a
 * **deployment manifest**: the exact system definition, with a named digest for
 * the release, the configuration, the module set, the reserved resources, the
 * migration target, the verification run and the artifact this one rolls back
 * to. The cell reads that and reconciles itself toward it. The apply is the
 * cell's, and `CELL_APPLY` below says so rather than pretending otherwise.
 *
 * ── What the digest does and does not prove ────────────────────────────────
 *
 * This module used to say it *signed* that artifact. It does not, and saying so
 * was the most dangerous sentence in the package: `digest` is an unkeyed
 * SHA-256 over the body, there is no key anywhere in this package, and the
 * cell's verifier (`verifyDigest`, apps/web/src/lib/provisioning/reconcile.ts)
 * recomputes the same unkeyed hash. That proves the artifact was not altered by
 * an *accident* of encoding or storage between here and there. It proves
 * nothing whatever about who produced it: anyone able to POST to the cell can
 * compute a matching digest over a body of their choosing.
 *
 * Origin is currently established by the shared secret on the reconcile
 * endpoint — the transport, not the artifact — which is exactly the property a
 * self-verifying artifact is supposed to remove the need for. A real signature
 * (asymmetric, so the cell holds only a public key) needs a `signature` field
 * checked in the cell's verifier and a key source in the Studio; neither exists,
 * and until they do nothing here calls this artifact signed.
 *
 * ── Determinism ────────────────────────────────────────────────────────────
 *
 * Nothing here reads a clock or a random source. Timestamps are supplied by the
 * caller. Two runs over the same manifest produce byte-identical evidence,
 * which is what lets "what did we agree to build?" be compared against "what
 * did we build?" rather than merely asserted.
 */

/** What a step produced, or why it could not. */
export interface StepEvidence {
  step: string;
  state: TenantState;
  ok: boolean;
  /** Digest of whatever the step produced, when it produces something citable. */
  digest?: string;
  detail: string;
  /** Sub-checks, each independently pass/fail, for steps that verify. */
  checks?: ReadonlyArray<{ name: string; ok: boolean; detail: string }>;
}

/**
 * Everything the executor needs from the rest of the platform, passed in.
 *
 * Injected rather than imported so this package stays free of the configuration
 * and module engines — which keeps it testable without them, and keeps the
 * dependency arrow pointing one way.
 */
export interface ExecutionContext {
  /** Resolved configuration for this tenant, and its checksum. */
  resolveConfiguration(manifest: TenantManifest): {
    checksum: string;
    values: Readonly<Record<string, unknown>>;
    problems: ReadonlyArray<{ key: string; reason: string; detail: string }>;
  };
  /** Modules that actually resolve, in dependency order, with versions. */
  resolveModules(manifest: TenantManifest): {
    ordered: ReadonlyArray<{ key: string; version: string }>;
    problems: ReadonlyArray<{
      moduleKey: string;
      reason: string;
      detail: string;
    }>;
  };
  /** The blueprint's topology, validated. */
  validateTopology(manifest: TenantManifest): {
    valid: boolean;
    problems: readonly string[];
  };
  /** Schema version the cell is expected to be at. */
  schemaVersion(): string;
}

/**
 * A digest that does not depend on key order.
 *
 * `JSON.stringify` preserves insertion order, and the deployment manifest does
 * not keep it: it is written to DynamoDB, read back to be delivered, and a
 * DynamoDB map has no order at all. The bytes hashed at publication and the
 * bytes hashed at the cell were therefore different objects with identical
 * content, and the cell correctly refused its own engine's artifact —
 * "altered between publication and here", which was true of the encoding and
 * not of the meaning.
 *
 * No unit test could have caught it. Both sides agreed perfectly until a real
 * store sat between them.
 *
 * Keys are sorted at every level before hashing, the same way `digestOf` has
 * always canonicalised the tenant manifest.
 */
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

const sha = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")
    .slice(0, 32);

/**
 * The state at which the engine's work ends and a cell's begins.
 *
 * Named as a constant and exported so the Studio can render the boundary rather
 * than implying the whole lifecycle runs here.
 */
export const CELL_APPLY: TenantState = "MIGRATING";

/**
 * Run the work for one state.
 *
 * Returns evidence whether or not it succeeded — a failed step that produces no
 * record is a failure nobody can diagnose afterwards.
 */
export function executeStep(
  state: TenantState,
  manifest: TenantManifest,
  ctx: ExecutionContext,
): StepEvidence {
  switch (state) {
    case "VALIDATING": {
      // Re-validated here even though the composer already did: the manifest
      // may have been registered days ago, and a module can have left the
      // catalog since.
      const modules = ctx.resolveModules(manifest);
      const config = ctx.resolveConfiguration(manifest);
      const topology = ctx.validateTopology(manifest);

      const checks = [
        {
          name: "modules resolve",
          ok: modules.problems.length === 0,
          detail:
            modules.problems
              .map((p) => `${p.moduleKey}: ${p.detail}`)
              .join("; ") ||
            `${modules.ordered.length} modules resolve in dependency order`,
        },
        {
          name: "configuration resolves",
          ok: config.problems.length === 0,
          detail:
            config.problems.map((p) => `${p.key}: ${p.detail}`).join("; ") ||
            `${Object.keys(config.values).length} values resolved`,
        },
        {
          name: "topology valid",
          ok: topology.valid,
          detail: topology.problems.join("; ") || "org topology validates",
        },
      ];

      return {
        step: "validate",
        state,
        ok: checks.every((c) => c.ok),
        digest: digestOf(manifest),
        detail: checks.every((c) => c.ok)
          ? "The manifest still describes a system that can be built."
          : "The manifest no longer describes a buildable system.",
        checks,
      };
    }

    case "PLANNED":
      return {
        step: "plan",
        state,
        ok: true,
        digest: digestOf(manifest),
        detail:
          "Plan computed from the manifest. Nothing has been created; the plan digest is the " +
          "manifest digest, so what was approved and what gets built are the same object.",
      };

    case "PROVISIONING": {
      // For a pooled tenant this is a reservation, not an allocation: the slug,
      // the routing prefix and the tenant record. Nothing in AWS is created,
      // which is why a pooled tenant's marginal cost is zero.
      const reservation = {
        slug: manifest.slug,
        routing: `/${manifest.slug}`,
        placement: manifest.isolation,
        region: manifest.region,
      };
      return {
        step: "reserve",
        state,
        ok: true,
        digest: sha(reservation),
        detail:
          manifest.isolation === "pooled"
            ? `Reserved "${manifest.slug}" and its routing prefix in the ${manifest.region} cell. ` +
              "No AWS resource is created for a pooled tenant."
            : `Reserved "${manifest.slug}" and requested ${manifest.isolation} resources.`,
      };
    }

    case "CONFIGURING": {
      // The step that actually computes the system. Its output is the artifact
      // the cell applies, so it is digested field by field rather than as one
      // opaque blob — a drifted configuration and a drifted module set are
      // different incidents and should not share one hash.
      const config = ctx.resolveConfiguration(manifest);
      const modules = ctx.resolveModules(manifest);
      const topology = ctx.validateTopology(manifest);

      const ok =
        config.problems.length === 0 &&
        modules.problems.length === 0 &&
        topology.valid;

      const artifact = {
        manifestDigest: digestOf(manifest),
        configurationChecksum: config.checksum,
        modules: modules.ordered.map((m) => `${m.key}@${m.version}`),
        blueprintId: manifest.blueprintId,
        schemaVersion: ctx.schemaVersion(),
      };

      return {
        step: "configure",
        state,
        ok,
        digest: sha(artifact),
        detail: ok
          ? `Resolved ${Object.keys(config.values).length} configuration values and ` +
            `${modules.ordered.length} modules into a deployment artifact.`
          : "Configuration did not resolve; no artifact was produced.",
        checks: [
          { name: "configuration checksum", ok: true, detail: config.checksum },
          {
            name: "modules pinned",
            ok: modules.problems.length === 0,
            detail: artifact.modules.join(", ") || "none",
          },
          { name: "schema version", ok: true, detail: artifact.schemaVersion },
        ],
      };
    }

    case "MIGRATING":
      // The boundary. Said plainly rather than reported as done.
      //
      // The digest is the migration TARGET, not the migrations: the engine has
      // never read a migration file, because they live in the cell's build.
      // What it can honestly publish is the schema version this artifact
      // requires the cell to be at, bound to the tenant and to the manifest —
      // which is precisely what the cell compares before applying anything.
      return {
        step: "cell-apply",
        state,
        ok: true,
        digest: sha({
          slug: manifest.slug,
          manifestDigest: digestOf(manifest),
          schemaVersion: ctx.schemaVersion(),
        }),
        detail:
          "Handed to the cell. The engine does not write to a tenant's database — it publishes a " +
          "deployment manifest whose digest covers every field, and the cell reconciles toward " +
          "it. The reconciler exists and is proven against a real database " +
          "(apps/web/src/lib/provisioning): it verifies the digest with its own implementation, " +
          "refuses across a schema boundary, and four concurrent runs produce exactly one " +
          "institution, one account and one membership. The tenant is created and NOT yet " +
          "served: this artifact carries `serving: false`, and `resolveTenantScope` in the cell " +
          "drops an institution that is not serving, so no user can act in the tenant yet. What " +
          "is NOT wired is the transport that carries the artifact from engine to cell; the " +
          "manifest is produced and digested, and moving it is still an operator step. Nor is " +
          "its origin established: `digest` is an unkeyed digest, not a signature, so it proves " +
          "the artifact arrived unaltered and proves nothing about who produced it.",
      };

    case "VERIFYING": {
      const config = ctx.resolveConfiguration(manifest);
      const modules = ctx.resolveModules(manifest);

      const checks = [
        {
          name: "an administrator exists",
          ok: !!manifest.initialAdminEmail,
          detail: `Exactly one invitation, to ${manifest.initialAdminEmail}.`,
        },
        {
          name: "no secret value in the manifest",
          ok: Object.values(manifest.secretRefs).every((r) =>
            /^(secretsmanager|ssm):/.test(r),
          ),
          detail: "Every secret is a reference; none is a value.",
        },
        {
          name: "configuration is complete",
          ok: config.problems.length === 0,
          detail: `${Object.keys(config.values).length} values, checksum ${config.checksum}.`,
        },
        {
          name: "modules enabled",
          ok: modules.ordered.length > 0,
          detail: modules.ordered.map((m) => m.key).join(", ") || "none",
        },
      ];

      return {
        step: "verify",
        state,
        ok: checks.every((c) => c.ok),
        // Digested over the OUTCOMES, not just the names, so "which checks ran"
        // and "did they pass" are the same fact. A digest over the names alone
        // would hash a clean verification and a failed one identically, and the
        // deployment manifest would then cite a verification run that says
        // nothing — the shape of evidence without the content.
        digest: sha(checks.map((c) => [c.name, c.ok])),
        detail: checks.every((c) => c.ok)
          ? "Every pre-activation check passed."
          : "One or more checks failed; the tenant must not be routed.",
        checks,
      };
    }

    case "ACTIVATING":
      // What this step DOES is publish a second deployment manifest carrying
      // `serving: true`; the cell reads it and starts resolving the slug. Until
      // that existed, this returned the sentence below and did nothing, while
      // the tenant had already been reachable since `MIGRATING`.
      return {
        step: "activate",
        state,
        ok: true,
        digest: sha({ slug: manifest.slug, serving: true }),
        detail:
          `Routing for /${manifest.slug} switched on: this step publishes a second deployment ` +
          "manifest carrying `serving: true`, and the cell's `resolveTenantScope` refuses to " +
          "resolve an institution without one — so this is genuinely the first moment a user " +
          "can reach the system, which is why it is a separate, approved act. Before this the " +
          "sentence was aspirational: nothing read a lifecycle state, and the tenant had been " +
          "reachable since `MIGRATING`, one state and one approval earlier. The engine-to-cell " +
          "transport is still NOT wired, so delivering this artifact remains an operator step.",
      };

    default:
      return {
        step: "none",
        state,
        ok: true,
        detail: "No engine-side work is defined for this state.",
      };
  }
}

/**
 * The artifact a cell reconciles toward. GE-102-009.
 *
 * Not signed. `digest` is an unkeyed SHA-256 over every other field; see the
 * note at the top of this file for what that does and does not establish.
 */
export interface DeploymentManifest {
  slug: string;
  manifestDigest: string;
  configurationChecksum: string;
  modules: readonly string[];
  blueprintId: string;
  schemaVersion: string;
  /**
   * Every configuration key this tenant's resolved configuration actually sets.
   *
   * Declared so a cell can refuse a key it does not implement. `schemaVersion`
   * pins the DATABASE and says nothing about the config registry, so an engine
   * that gains a key and a cell that has not been rebuilt would otherwise agree
   * on the schema and silently disagree about the configuration — the setting
   * shows as published in the Studio and has no effect in the cell.
   *
   * Sorted, so the digest is a property of the content rather than of iteration
   * order (the same lesson the canonical digest already carries).
   */
  configKeys: readonly string[];
  /** Digest of every step's evidence, in order. */
  evidenceDigest: string;

  // ── The named digests ─────────────────────────────────────────────────────
  //
  // `evidenceDigest` is a roll-up: it covers each step's digest, so it detects
  // that *something* about the run changed and cannot say what. The evidence
  // array itself never reaches a cell — the reconcile endpoint is given the
  // manifest, a display name and an admin address, and nothing else — so
  // without these fields a cell holding an artifact cannot answer "which
  // reservation, which migration target, which verification run produced this?"
  // at all. Each is named separately for the same reason CONFIGURING digests
  // the configuration and the module set apart: a drifted configuration and a
  // drifted verification are different incidents and should not share a hash.
  //
  // `null` means the engine did not state it, which is not the same as empty.
  // The artifact published at CONFIGURING legitimately has no migration or
  // verification digest yet — those steps have not run. The one published at
  // ACTIVATING carries all of them.

  /**
   * The system definition this artifact deploys: blueprint, pinned module
   * versions, configuration checksum and schema version, hashed together.
   *
   * Computed here rather than taken from `@tenure/releases`. That package's
   * `checksumOfRelease` covers strictly more (blueprint VERSION, topology,
   * policy ids) and nothing links a `SystemRelease` to a tenant manifest yet —
   * so this is honestly "the release identity of this deployment", not that
   * package's release id under a different name.
   */
  releaseDigest: string;
  /** Digest the PROVISIONING step produced: what was reserved for this tenant. */
  resourceDigest: string | null;
  /** Digest the MIGRATING step produced: the schema target the cell must reach. */
  migrationDigest: string | null;
  /** Digest the VERIFYING step produced: which pre-activation checks ran, and their outcomes. */
  testDigest: string | null;
  /**
   * The digest of the artifact this one supersedes — the one to re-publish to
   * undo this deployment.
   *
   * Rollback is "publish the previous artifact again" (the same model
   * `@tenure/releases` uses), and until this field existed the artifact did not
   * say which artifact that is: a cell holding a manifest could not name what
   * it was rolling back to, and neither could an incident review.
   *
   * `null` for a tenant's first deployment. It is also null whenever the caller
   * does not supply `meta.previousDigest` — which the Studio does not yet do;
   * see the note on `deploymentManifest` below.
   */
  rollbackDigest: string | null;
  /**
   * Whether the cell may serve this tenant to users yet.
   *
   * `ACTIVATING` calls itself "the first moment a user can reach the system,
   * which is why it is a separate, approved act". It was not: the cell had no
   * idea a lifecycle existed, so a tenant became reachable the moment
   * `reconcile` created its Institution row — at `MIGRATING`, one state and one
   * approval earlier. The approval on `READY → ACTIVATING` guarded something
   * that had already happened.
   *
   * Carried on the artifact rather than sent alongside it, so it is covered by
   * `digest` and the cell verifies it with everything else. A serving flag the
   * transport could set is a serving flag an attacker can set.
   */
  serving: boolean;
  /** The whole thing, digested. What a cell verifies before applying anything. */
  digest: string;
  createdAt: string;
  createdBy: string;
}

/**
 * Freeze everything the run produced into one citable artifact.
 *
 * `digest` covers every other field, so a cell can tell that what it received
 * is byte-for-byte what was published. It is unkeyed, so it cannot tell WHO
 * published it — see the note at the top of this file. Nothing here signs.
 *
 * `meta.previousDigest` is the tenant's current artifact, which becomes this
 * one's rollback target. It is optional because the Studio does not yet pass
 * it: `apps/system-studio/src/app/tenants/actions.ts` already holds the value
 * (`tenant.deployment`, read a few lines above the call) and simply does not
 * forward it. Until it does, published artifacts carry `rollbackDigest: null`,
 * which reads as "the engine did not state a rollback target" — true, rather
 * than a chain that claims to exist and does not.
 */
export function deploymentManifest(
  manifest: TenantManifest,
  evidence: readonly StepEvidence[],
  ctx: ExecutionContext,
  meta: {
    createdAt: string;
    createdBy: string;
    serving: boolean;
    previousDigest?: string | null;
  },
): DeploymentManifest {
  const config = ctx.resolveConfiguration(manifest);
  const modules = ctx.resolveModules(manifest);
  const modulePins = modules.ordered.map((m) => `${m.key}@${m.version}`);

  /**
   * The LAST evidence for a state, not the first.
   *
   * A step can be retried — `advance` counts attempts precisely because it is —
   * and the artifact must cite what the run finally produced, not what the
   * attempt that failed produced.
   */
  const producedBy = (state: TenantState): string | null => {
    let found: string | null = null;
    for (const e of evidence) if (e.state === state) found = e.digest ?? null;
    return found;
  };

  const body = {
    slug: manifest.slug,
    manifestDigest: digestOf(manifest),
    configurationChecksum: config.checksum,
    modules: modulePins,
    blueprintId: manifest.blueprintId,
    schemaVersion: ctx.schemaVersion(),
    configKeys: Object.keys(config.values).sort(),
    evidenceDigest: sha(evidence.map((e) => [e.step, e.ok, e.digest ?? null])),
    // Sorted, so the same system assembled in a different order is the same
    // release — the property `@tenure/releases` relies on for the same reason.
    releaseDigest: sha({
      blueprintId: manifest.blueprintId,
      modules: [...modulePins].sort(),
      configurationChecksum: config.checksum,
      schemaVersion: ctx.schemaVersion(),
    }),
    resourceDigest: producedBy("PROVISIONING"),
    migrationDigest: producedBy("MIGRATING"),
    testDigest: producedBy("VERIFYING"),
    rollbackDigest: meta.previousDigest ?? null,
    // Required, not defaulted. A caller that forgets which side of activation
    // this artifact represents would otherwise publish a serving tenant by
    // omission, and the omission is invisible in the diff.
    serving: meta.serving,
    createdAt: meta.createdAt,
    createdBy: meta.createdBy,
  };

  return { ...body, digest: sha(body) };
}
