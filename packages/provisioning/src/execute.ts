import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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
 * ── What the digest proves, and what the signature proves ──────────────────
 *
 * `digest` is an unkeyed SHA-256 over the body. It proves the artifact was not
 * altered by an *accident* of encoding or storage between here and the cell,
 * and it proves nothing whatever about who produced it: anyone able to POST to
 * the cell can compute a matching digest over a body of their choosing.
 *
 * `signature` (STUDIO-070-009) is what establishes origin. It is an HMAC-SHA256
 * over the SAME canonical bytes the digest covers, reusing the key shape and the
 * refuse-an-empty-key rule from `@tenure/releases` rather than inventing a
 * second scheme. Until it existed, three call sites carried comments claiming
 * this artifact was signed while this file's own header said it was not — and
 * origin rested entirely on the shared secret on the reconcile endpoint, which
 * is the transport, not the artifact.
 *
 * It is a MAC and not an asymmetric signature, which is a real limitation and
 * is stated rather than glossed: the cell must hold the same secret to verify,
 * so a compromised cell could forge an artifact for another cell. What it
 * removes is the class of attack the transport cannot see — an artifact altered
 * in the store between publication and delivery, or one injected by anything
 * that has the bearer token but not the signing key. An asymmetric scheme is a
 * key-management change, not a change to this shape: `signature.algorithm` is a
 * discriminant and `verifyDeployment` gains a branch.
 *
 * ── Determinism ────────────────────────────────────────────────────────────
 *
 * Nothing here reads a clock or a random source. Timestamps are supplied by the
 * caller. Two runs over the same manifest produce byte-identical evidence,
 * which is what lets "what did we agree to build?" be compared against "what
 * did we build?" rather than merely asserted.
 */

/**
 * What one run of a step consumed, beyond the manifest.
 *
 * STUDIO-060-010. Required, all three of them, and that is the point: an
 * OPTIONAL `correlationId` is one a caller can forget, and a caller that forgets
 * it compiles cleanly and produces a row nobody can tie to the act that caused
 * it. Making it part of the signature means every call site had to answer.
 */
export interface StepRun {
  /** One id shared by every record produced by one operator act. */
  correlationId: string;
  /**
   * Which try at this destination this is. `advance` counts the same way
   * (`attemptFor`), and both read it from the same helper so a retry cannot be
   * numbered one thing in the evidence and another in the step.
   */
  attempt: number;
  /** The approval this run was authorised by, when the transition needed one. */
  approvalRef?: string;

  /* ----------------------------------------------------- STUDIO-070-005 --
   * What only the caller can know, because the executor makes no calls.
   *
   * All four are required for the same reason `correlationId` is. A default of
   * `[]` for `awsRequestIds` would have made the field permanently empty and
   * invisibly so — which is the state it was already in, dressed as a feature.
   */

  /** Request ids of the AWS calls this act made. `[]` means it made none. */
  awsRequestIds: readonly string[];
  /** The principal the calls were made as, or null when identity is unreadable. */
  assumedRoleArn: string | null;
  /** Handles for the resources the act touched. */
  resourceHandles: readonly string[];
  /** When a retry is due, or null. Nothing polls it; an operator does. */
  nextRetryAt: string | null;
  /** What was undone after a partial failure, or null when nothing was owed. */
  compensation: { attempted: boolean; ok: boolean; detail: string } | null;
}

/**
 * What a step produced, or why it could not.
 *
 * STUDIO-060-010 widened this from `{ step, state, ok, digest?, detail, checks? }`.
 * That shape carried an OUTPUT digest and nothing else: no record of what the
 * step ran against, no safe error, and no way to tie the row to the act, the
 * attempt or the approval that caused it. An operator reading a failed
 * PROVISIONING row could not answer "what was the input?", "which try was
 * this?", "who approved it?" or "what else happened in the same request?".
 */
export interface StepEvidence {
  step: string;
  state: TenantState;
  ok: boolean;
  /**
   * Digest of the INPUT this step ran against — the destination state, the
   * manifest as it stood, and the schema version the context pins.
   *
   * Deliberately not a digest of the catalogs: those are pinned by the module
   * versions inside `digest`, and hashing a whole catalog here would make two
   * identical runs differ because an unrelated module gained a patch version.
   */
  inputDigest: string;
  /** Digest of whatever the step produced, when it produces something citable. */
  digest?: string;
  detail: string;
  /** Sub-checks, each independently pass/fail, for steps that verify. */
  checks?: ReadonlyArray<{ name: string; ok: boolean; detail: string }>;
  /**
   * A short, stable reason a step did not succeed.
   *
   * "Safe" is load-bearing: it is a classification and never a raw exception
   * message, because an exception message is where a connection string, a
   * bearer token or a row of tenant content ends up in a store that must not be
   * rewritten. `detail` and `checks` carry the human explanation.
   */
  safeError?: string;
  /** The id every record from this act shares. Never optional — see `StepRun`. */
  correlationId: string;
  /**
   * AWS request ids for the mutating calls made while this step ran.
   *
   * The executor itself calls nothing — it is pure — so this is populated by the
   * caller with the ids of the writes it made around the step. An id here is a
   * line in an AWS CloudTrail record, which is what turns "the console says it
   * did this" into something checkable against the account.
   *
   * STUDIO-070-005 made this REQUIRED. It was optional, and an optional
   * provenance field is one a caller forgets: the code compiles, every unit
   * test that builds its own fixture passes, and an operator is shown a step
   * with no provenance at all. `readonly []` is a legal value and means "this
   * step made no AWS call", which VALIDATING and PLANNED genuinely do not — but
   * it has to be SAID.
   */
  awsRequestIds: readonly string[];
  /** Which try at this transition produced it. */
  attempt: number;
  /** The approval this step ran under, when the transition required one. */
  approvalRef?: string;
  /**
   * What was undone — or could not be — after the step made a change and the
   * work around it then failed.
   *
   * `attempted: false` with a detail is a real answer and the common one: the
   * Studio publishes artifacts to a cell and cannot reach into it to withdraw
   * one, so what it can honestly record is that a compensating act is owed and
   * what it would be.
   *
   * Required, `null` when there was nothing to compensate. See `awsRequestIds`.
   */
  compensation: { attempted: boolean; ok: boolean; detail: string } | null;

  /* ----------------------------------------------------- STUDIO-070-005 --
   * The rest of the execution record.
   *
   * The requirement names twelve things an execution record must carry; the
   * shape before this had three (step, attempt, result) and, after
   * STUDIO-060-010, an input digest, a correlation id and an approval ref. What
   * follows is the remainder, and every one of them is REQUIRED for the reason
   * `awsRequestIds` gives above.
   *
   * There is deliberately no scheduler behind `nextRetryAt`. It is the time a
   * retry is DUE, computed from the attempt count, and an operator is the thing
   * that honours it — said here rather than implied, because a field named
   * `nextRetryAt` invites the reader to assume something is watching it.
   */

  /**
   * Digest of what the step produced.
   *
   * `digest` above is optional and absent for a step that produces nothing
   * citable, which makes "this step produced nothing" and "nobody recorded what
   * it produced" the same value. This is never absent: for a step with a
   * `digest` it IS that digest, and for one without it covers the step's own
   * outcome, so an input/output PAIR always exists and a run can be compared to
   * the run before it.
   */
  outputDigest: string;
  /**
   * The role session the step ran as, or null when identity could not be read.
   *
   * Null is honest and common: with no credentials resolved, this engine cannot
   * see itself. It is not defaulted to a role name from configuration — a
   * recorded identity that was never confirmed is worse than a blank, because
   * an incident review would believe it.
   */
  assumedRoleArn: string | null;
  /**
   * The resources this step touched, as handles an operator can act on.
   *
   * Not necessarily ARNs. This control plane's writes land in one DynamoDB
   * table under one partition, and `dynamodb:table/<name>#TENANT#<slug>` is the
   * handle that identifies them; the table's ARN is not something this process
   * is told (STUDIO-080-001 is the item that would change that). Saying what is
   * true beats an `arn:aws:` string assembled from guesses about the account.
   */
  resourceHandles: readonly string[];
  /**
   * When a failed step is due to be tried again, or null.
   *
   * Null for a step that succeeded, and null for one whose retries are
   * exhausted — those are the same value and different sentences, so `detail`
   * carries the difference. Nothing polls this; an operator does.
   */
  nextRetryAt: string | null;
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
  /**
   * STUDIO-040-005 — whether each declared secret reference actually EXISTS.
   *
   * Required, not optional. The half of this that already worked is the shape
   * check: `SECRET_REF_SHAPE` in manifest.ts refuses a credential-looking VALUE
   * and insists on a `secretsmanager:` / `ssm:` reference, and the VERIFYING
   * check below re-tested the same regex. A regex over a string cannot tell
   * `secretsmanager:tenure/prod/stripe` from
   * `secretsmanager:tenure/prod/does-not-exist`, so a manifest naming a secret
   * nobody ever created passed verification and failed at ACTIVATING, inside the
   * cell, in front of the tenant.
   *
   * Injected rather than imported so this package stays AWS-free: the resolver
   * lives in `apps/system-studio/src/lib/secret-refs.ts` and calls only
   * `DescribeSecret` / `DescribeParameters`. Existence is establishable without
   * ever reading a value, and reading one would put a live credential in a
   * process whose whole job is to render other people's configuration.
   *
   * Synchronous by design. The caller resolves the references before building
   * the context and closes over the answer — which keeps `executeStep`
   * deterministic and free of I/O, the property the determinism note above
   * depends on.
   */
  resolveSecretRefs(
    refs: Readonly<Record<string, string>>,
  ): Readonly<Record<string, SecretRefResolution>>;
}

/**
 * What could be established about one secret reference, without reading it.
 *
 * Three arms, and the third is the one that must never be rounded to a pass.
 * `UNKNOWN` means the engine was refused permission to look — an answer that is
 * neither "it is there" nor "it is missing", and reporting it as either is how a
 * verification step comes to mean nothing.
 */
export type SecretRefResolution =
  | {
      state: "PRESENT";
      /** When the value last changed. Never the value. */
      lastChanged: string | null;
      rotationEnabled: boolean;
    }
  | { state: "MISSING" }
  | {
      state: "UNKNOWN";
      /** The IAM action that was refused, spelled as IAM spells it. */
      action: string;
      /** JSON an operator pastes into a policy to fix it. */
      minimumStatement: string;
    };

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
  /**
   * Required, deliberately. See `StepRun`: an optional correlation id is one a
   * caller can omit without the compiler noticing, and the row it produces
   * cannot be tied back to the act that caused it.
   */
  run: StepRun,
): StepEvidence {
  // Computed once and stamped on every return below, so a new case cannot be
  // added without one. What the step ran against: the destination asked for,
  // the manifest as it stood, and the schema version the context pins.
  const inputDigest = sha({
    state,
    manifestDigest: digestOf(manifest),
    schemaVersion: ctx.schemaVersion(),
  });

  /** The fields every case carries, so none of them can be forgotten. */
  const attribution = {
    inputDigest,
    correlationId: run.correlationId,
    attempt: run.attempt,
    ...(run.approvalRef ? { approvalRef: run.approvalRef } : {}),
    // STUDIO-070-005. Threaded from the caller rather than defaulted, and
    // stamped here so a new `case` below cannot be added without them.
    awsRequestIds: run.awsRequestIds,
    assumedRoleArn: run.assumedRoleArn,
    resourceHandles: run.resourceHandles,
    nextRetryAt: run.nextRetryAt,
    compensation: run.compensation,
  };

  /**
   * The step's own work, before the output digest is derived from it.
   *
   * Wrapped rather than returned directly so `outputDigest` is computed in ONE
   * place from whatever the case produced. Computing it per case would be eight
   * opportunities to compute it differently, and the seventh would be the one
   * that mattered.
   */
  const built: Omit<StepEvidence, "outputDigest"> = ((): Omit<StepEvidence, "outputDigest"> => {
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
        ...attribution,
        step: "validate",
        state,
        ok: checks.every((c) => c.ok),
        digest: digestOf(manifest),
        detail: checks.every((c) => c.ok)
          ? "The manifest still describes a system that can be built."
          : "The manifest no longer describes a buildable system.",
        ...(checks.every((c) => c.ok) ? {} : { safeError: "manifest-not-buildable" }),
        checks,
      };
    }

    case "PLANNED":
      return {
        ...attribution,
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
        ...attribution,
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
        ...attribution,
        step: "configure",
        state,
        ok,
        digest: sha(artifact),
        detail: ok
          ? `Resolved ${Object.keys(config.values).length} configuration values and ` +
            `${modules.ordered.length} modules into a deployment artifact.`
          : "Configuration did not resolve; no artifact was produced.",
        ...(ok ? {} : { safeError: "configuration-unresolved" }),
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
        ...attribution,
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

      /* ------------------------------------------------- STUDIO-040-005 --
       * Every declared reference, looked up.
       *
       * Two checks rather than one, because MISSING and UNKNOWN are different
       * facts with different remedies and a single boolean cannot carry both.
       * A reference nobody created is the author's mistake; a reference the
       * engine was refused permission to read is the platform's, and telling an
       * operator "the secret is missing" when the truth is "we were not allowed
       * to look" sends them to delete and recreate a secret that was fine.
       *
       * Neither is rounded to a pass. That is the whole point of the second
       * check existing at all — an UNKNOWN folded into `ok: true` would make
       * `testDigest` cite a verification run that verified nothing.
       */
      const resolved = ctx.resolveSecretRefs(manifest.secretRefs);
      const refNames = Object.keys(manifest.secretRefs);
      const missing = refNames.filter(
        (name) => resolved[name] === undefined || resolved[name].state === "MISSING",
      );
      const unknown = refNames.filter((name) => resolved[name]?.state === "UNKNOWN");

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
          name: "every secret reference exists",
          ok: missing.length === 0,
          detail:
            missing.length === 0
              ? refNames.length === 0
                ? "No secret references are declared, so there is nothing to resolve."
                : `${refNames.length} reference(s) resolved against Secrets Manager / Parameter ` +
                  `Store. Existence only — no value was read.`
              : `Named and not found: ${missing
                  .map((n) => `${n} → ${manifest.secretRefs[n]}`)
                  .join("; ")}. This would have failed inside the cell at ACTIVATING.`,
        },
        {
          name: "every secret reference was checkable",
          ok: unknown.length === 0,
          detail:
            unknown.length === 0
              ? "Every reference returned a definite answer."
              : `Could not establish: ${unknown
                  .map((n) => {
                    const r = resolved[n];
                    return r?.state === "UNKNOWN" ? `${n} (refused ${r.action})` : n;
                  })
                  .join(
                    "; ",
                  )}. This is UNKNOWN, not a pass — the engine was not permitted to look. ` +
                `Minimum statement: ${unknown
                  .map((n) => {
                    const r = resolved[n];
                    return r?.state === "UNKNOWN" ? r.minimumStatement : "";
                  })
                  .filter(Boolean)
                  .join(" ")}`,
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
        ...attribution,
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
        ...(checks.every((c) => c.ok) ? {} : { safeError: "pre-activation-checks-failed" }),
        checks,
      };
    }

    case "ACTIVATING":
      // What this step DOES is publish a second deployment manifest carrying
      // `serving: true`; the cell reads it and starts resolving the slug. Until
      // that existed, this returned the sentence below and did nothing, while
      // the tenant had already been reachable since `MIGRATING`.
      return {
        ...attribution,
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
        ...attribution,
        step: "none",
        state,
        ok: true,
        detail: "No engine-side work is defined for this state.",
      };
  }
  })();

  return {
    ...built,
    // The step's own digest when it has one, and the step's OUTCOME when it does
    // not — never absent. An absent output digest makes "produced nothing" and
    // "nobody recorded it" the same value, and only one of those is a fact.
    outputDigest:
      built.digest ??
      sha({ step: built.step, state: built.state, ok: built.ok, detail: built.detail }),
  };
}

/* ------------------------------------------------------- STUDIO-070-009 -- */

/**
 * The key that signs a deployment artifact.
 *
 * The same shape `@tenure/releases` uses, deliberately: one signing vocabulary
 * across the platform, and a Studio that already knows how to hold a release
 * key does not need a second concept to hold this one.
 */
export interface SigningKey {
  keyId: string;
  /** Never stored on the artifact, never logged. Only its MAC is published. */
  secret: string;
}

export interface ManifestSignature {
  keyId: string;
  algorithm: "hmac-sha256";
  value: string;
}

export class DeploymentSigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentSigningError";
  }
}

/**
 * The exact bytes both `digest` and `signature` are taken over.
 *
 * One function, so the two can never end up attesting to different objects —
 * the property `packages/releases/src/release.ts:223` establishes for a release
 * and this establishes for a deployment. Note what is NOT in here: `digest` and
 * `signature` themselves. The cell's independent verifier
 * (`apps/web/src/lib/provisioning/reconcile.ts`) strips exactly those two before
 * recomputing, and if either side ever strips a different set the artifact stops
 * verifying — loudly, at the cell, which is the correct outcome.
 */
function deploymentBytes(body: Record<string, unknown>): string {
  return JSON.stringify(canonical(body));
}

/**
 * Sign a manifest body.
 *
 * Refuses an empty key for the same reason `signRelease` does: a signature
 * anyone can reproduce proves nothing and is worse than being visibly unsigned,
 * because it teaches an operator to trust a property the artifact does not have.
 */
function signBody(body: Record<string, unknown>, key: SigningKey): ManifestSignature {
  if (!key.keyId) {
    throw new DeploymentSigningError("A signature must name the key that produced it.");
  }
  if (!key.secret) {
    throw new DeploymentSigningError(
      "Refusing to sign a deployment manifest with an empty key. A signature anyone can " +
        "reproduce proves nothing, and would be worse than being visibly unsigned.",
    );
  }
  return {
    keyId: key.keyId,
    algorithm: "hmac-sha256",
    value: createHmac("sha256", key.secret).update(deploymentBytes(body)).digest("hex"),
  };
}

export type DeploymentVerification =
  | { valid: true; keyId: string }
  | { valid: false; reason: "unsigned" | "unknown-key" | "content-altered"; detail: string };

/**
 * Check a manifest's signature against the key that claims to have produced it.
 *
 * `resolveKey` is supplied rather than a key, exactly as `verifyRelease` does
 * it: this package must not hold a secret store, and the key that signed
 * yesterday's artifact is not necessarily the one signing today's. Fails closed
 * at every branch — an unresolvable key id is not "no requirement", it is an
 * artifact nobody can attribute.
 */
export function verifyDeployment(
  deployment: DeploymentManifest,
  resolveKey: (keyId: string) => string | undefined,
): DeploymentVerification {
  const signature = deployment.signature;
  if (!signature) {
    return {
      valid: false,
      reason: "unsigned",
      detail:
        `The artifact for "${deployment.slug}" carries no signature, so its digest establishes ` +
        `only that it arrived unaltered — nothing about who produced it.`,
    };
  }

  const secret = resolveKey(signature.keyId);
  if (!secret) {
    return {
      valid: false,
      reason: "unknown-key",
      detail: `Signed by "${signature.keyId}", which this engine cannot resolve.`,
    };
  }

  // Everything the digest covers: the body, without `digest` or `signature`.
  const { digest: _digest, signature: _signature, ...body } = deployment;
  void _digest;
  void _signature;
  const expected = createHmac("sha256", secret)
    .update(deploymentBytes(body as Record<string, unknown>))
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature.value, "hex");
  // Length-checked first: timingSafeEqual throws on a mismatch, and a thrown
  // error is a verification that neither passed nor failed.
  const ok = a.length === b.length && a.length > 0 && timingSafeEqual(a, b);

  if (!ok) {
    return {
      valid: false,
      reason: "content-altered",
      detail:
        `The artifact for "${deployment.slug}" does not verify under key "${signature.keyId}". ` +
        `Either the content changed after signing or the signature is not this engine's.`,
    };
  }
  return { valid: true, keyId: signature.keyId };
}

/**
 * The artifact a cell reconciles toward. GE-102-009 / STUDIO-070-009.
 *
 * `digest` is an unkeyed SHA-256 over every other field except `signature`: it
 * establishes that the artifact arrived unaltered and nothing about its origin.
 * `signature` is what establishes origin, and it is what `deliverToCell`
 * refuses to send without.
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
   * The infrastructure-as-code revision this deployment expects the cell to
   * have been built from.
   *
   * `null` when the engine did not state it, matching the convention the three
   * digests above already use. It is null today for a real reason and not as a
   * placeholder: nothing in this repository links a Terraform plan to a tenant
   * artifact, so a value here would be a number somebody made up. When the
   * studio stack starts publishing its state serial, this is where it lands and
   * the cell can refuse an artifact built against infrastructure it is not on.
   */
  iacDigest: string | null;
  /**
   * The model set this deployment pins — the entries from the catalog's
   * `ModelEntry` list that this tenant's modules may call.
   *
   * `null` when the engine did not state it. A tenant whose AI features are
   * pinned to one model version and a tenant that will take whatever the relay
   * offers are different systems, and until this field existed the artifact
   * could not tell them apart.
   */
  modelDigest: string | null;
  /**
   * The policy set in force for this deployment — the authorization and
   * retention policies whose ids `@tenure/releases` already carries as
   * `policyIds`.
   *
   * `null` when the engine did not state it.
   */
  policyDigest: string | null;
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
  /**
   * Who produced it, provably.
   *
   * Optional in the type, because a manifest published before signing existed
   * does not carry one and a cell that refused those would take every live
   * tenant off the air. It is NOT optional in practice: `deliverToCell` refuses
   * to send an unsigned artifact, mirroring `transition(_, "approved")` refusing
   * an unsigned release — so the only unsigned manifests that can exist are ones
   * nobody delivered.
   *
   * Not covered by `digest` (it is computed over the same bytes the digest is),
   * which is why the cell's verifier strips both before recomputing.
   */
  signature?: ManifestSignature;
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
 * one's rollback target. `runAdvance` in the Studio passes
 * `tenant.deployment?.digest`, so a tenant's second and later artifacts carry a
 * real rollback target and only the first is null. It stays optional in the
 * signature because a caller publishing a tenant's FIRST artifact has nothing
 * to pass, and `undefined` there is the truth.
 *
 * `meta.signWith` is what makes the artifact attributable. Omit it and the
 * manifest is published unsigned, which is honest and undeliverable —
 * `deliverToCell` refuses it. Pass a key with an empty secret and this throws,
 * because a signature anyone can reproduce is worse than a visibly missing one.
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
    /** The key to sign with. Absent means the artifact is published unsigned. */
    signWith?: SigningKey | null;
    /**
     * The three digests the engine can only be TOLD.
     *
     * Absent means "the engine did not state it", which is why they are null on
     * the artifact rather than empty strings — see the field comments. Nothing
     * in this repository can derive them yet, and deriving a plausible value
     * would be the exact failure `rollbackDigest` spent a requirement on.
     */
    iacDigest?: string | null;
    modelDigest?: string | null;
    policyDigest?: string | null;
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
    iacDigest: meta.iacDigest ?? null,
    modelDigest: meta.modelDigest ?? null,
    policyDigest: meta.policyDigest ?? null,
    // Required, not defaulted. A caller that forgets which side of activation
    // this artifact represents would otherwise publish a serving tenant by
    // omission, and the omission is invisible in the diff.
    serving: meta.serving,
    createdAt: meta.createdAt,
    createdBy: meta.createdBy,
  };

  // The digest and the signature cover the SAME bytes. Computing them from one
  // `body` object rather than two is what makes that true by construction; two
  // separate serialisations would agree until somebody added a field to one.
  const signature = meta.signWith ? signBody(body, meta.signWith) : undefined;

  return {
    ...body,
    digest: sha(body),
    ...(signature ? { signature } : {}),
  };
}
