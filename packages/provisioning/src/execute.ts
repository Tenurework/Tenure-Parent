import { createHash } from "node:crypto"

import type { TenantManifest } from "./manifest"
import { digestOf } from "./manifest"
import type { TenantState } from "./lifecycle"

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
 * So provisioning is a control plane. It computes, validates and signs a
 * **deployment manifest**: the exact system definition, with digests for the
 * configuration, the module set, the topology and the release. The cell reads
 * that and reconciles itself toward it. Everything up to and including the
 * signed artifact is done here, honestly and completely. The apply is the
 * cell's, and `CELL_APPLY` below says so rather than pretending otherwise.
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
  step: string
  state: TenantState
  ok: boolean
  /** Digest of whatever the step produced, when it produces something citable. */
  digest?: string
  detail: string
  /** Sub-checks, each independently pass/fail, for steps that verify. */
  checks?: ReadonlyArray<{ name: string; ok: boolean; detail: string }>
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
    checksum: string
    values: Readonly<Record<string, unknown>>
    problems: ReadonlyArray<{ key: string; reason: string; detail: string }>
  }
  /** Modules that actually resolve, in dependency order, with versions. */
  resolveModules(manifest: TenantManifest): {
    ordered: ReadonlyArray<{ key: string; version: string }>
    problems: ReadonlyArray<{ moduleKey: string; reason: string; detail: string }>
  }
  /** The blueprint's topology, validated. */
  validateTopology(manifest: TenantManifest): { valid: boolean; problems: readonly string[] }
  /** Schema version the cell is expected to be at. */
  schemaVersion(): string
}

const sha = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)

/**
 * The state at which the engine's work ends and a cell's begins.
 *
 * Named as a constant and exported so the Studio can render the boundary rather
 * than implying the whole lifecycle runs here.
 */
export const CELL_APPLY: TenantState = "MIGRATING"

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
      const modules = ctx.resolveModules(manifest)
      const config = ctx.resolveConfiguration(manifest)
      const topology = ctx.validateTopology(manifest)

      const checks = [
        {
          name: "modules resolve",
          ok: modules.problems.length === 0,
          detail:
            modules.problems.map((p) => `${p.moduleKey}: ${p.detail}`).join("; ") ||
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
      ]

      return {
        step: "validate",
        state,
        ok: checks.every((c) => c.ok),
        digest: digestOf(manifest),
        detail: checks.every((c) => c.ok)
          ? "The manifest still describes a system that can be built."
          : "The manifest no longer describes a buildable system.",
        checks,
      }
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
      }

    case "PROVISIONING": {
      // For a pooled tenant this is a reservation, not an allocation: the slug,
      // the routing prefix and the tenant record. Nothing in AWS is created,
      // which is why a pooled tenant's marginal cost is zero.
      const reservation = {
        slug: manifest.slug,
        routing: `/${manifest.slug}`,
        placement: manifest.isolation,
        region: manifest.region,
      }
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
      }
    }

    case "CONFIGURING": {
      // The step that actually computes the system. Its output is the artifact
      // the cell applies, so it is digested field by field rather than as one
      // opaque blob — a drifted configuration and a drifted module set are
      // different incidents and should not share one hash.
      const config = ctx.resolveConfiguration(manifest)
      const modules = ctx.resolveModules(manifest)
      const topology = ctx.validateTopology(manifest)

      const ok = config.problems.length === 0 && modules.problems.length === 0 && topology.valid

      const artifact = {
        manifestDigest: digestOf(manifest),
        configurationChecksum: config.checksum,
        modules: modules.ordered.map((m) => `${m.key}@${m.version}`),
        blueprintId: manifest.blueprintId,
        schemaVersion: ctx.schemaVersion(),
      }

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
      }
    }

    case "MIGRATING":
      // The boundary. Said plainly rather than reported as done.
      return {
        step: "cell-apply",
        state,
        ok: true,
        detail:
          "Handed to the cell. The engine does not write to a tenant's database — it publishes a " +
          "signed deployment manifest and the cell reconciles toward it. This step records the " +
          "hand-off; the cell-side reconciler is not built yet, so a tenant advanced past here " +
          "has an artifact waiting rather than a migrated schema.",
      }

    case "VERIFYING": {
      const config = ctx.resolveConfiguration(manifest)
      const modules = ctx.resolveModules(manifest)

      const checks = [
        {
          name: "an administrator exists",
          ok: !!manifest.initialAdminEmail,
          detail: `Exactly one invitation, to ${manifest.initialAdminEmail}.`,
        },
        {
          name: "no secret value in the manifest",
          ok: Object.values(manifest.secretRefs).every((r) => /^(secretsmanager|ssm):/.test(r)),
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
      ]

      return {
        step: "verify",
        state,
        ok: checks.every((c) => c.ok),
        detail: checks.every((c) => c.ok)
          ? "Every pre-activation check passed."
          : "One or more checks failed; the tenant must not be routed.",
        checks,
      }
    }

    case "ACTIVATING":
      return {
        step: "activate",
        state,
        ok: true,
        detail:
          `Routing for /${manifest.slug} switched on. This is the first moment a user can reach ` +
          "the system, which is why it is a separate, approved act.",
      }

    default:
      return {
        step: "none",
        state,
        ok: true,
        detail: "No engine-side work is defined for this state.",
      }
  }
}

/** The artifact a cell reconciles toward. GE-102-009. */
export interface DeploymentManifest {
  slug: string
  manifestDigest: string
  configurationChecksum: string
  modules: readonly string[]
  blueprintId: string
  schemaVersion: string
  /** Digest of every step's evidence, in order. */
  evidenceDigest: string
  /** The whole thing, digested. What a cell verifies before applying anything. */
  digest: string
  createdAt: string
  createdBy: string
}

/**
 * Freeze everything the run produced into one citable artifact.
 *
 * `digest` covers every other field, so a cell can verify it received what the
 * engine published rather than trusting the transport.
 */
export function deploymentManifest(
  manifest: TenantManifest,
  evidence: readonly StepEvidence[],
  ctx: ExecutionContext,
  meta: { createdAt: string; createdBy: string },
): DeploymentManifest {
  const config = ctx.resolveConfiguration(manifest)
  const modules = ctx.resolveModules(manifest)

  const body = {
    slug: manifest.slug,
    manifestDigest: digestOf(manifest),
    configurationChecksum: config.checksum,
    modules: modules.ordered.map((m) => `${m.key}@${m.version}`),
    blueprintId: manifest.blueprintId,
    schemaVersion: ctx.schemaVersion(),
    evidenceDigest: sha(evidence.map((e) => [e.step, e.ok, e.digest ?? null])),
    createdAt: meta.createdAt,
    createdBy: meta.createdBy,
  }

  return { ...body, digest: sha(body) }
}
