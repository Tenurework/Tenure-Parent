import "server-only"

import {
  archetypeProblems,
  compileArchetype,
  getBlueprint,
  type ArchetypeSelection,
} from "@tenure/blueprints"
import { MODULE_CATALOG } from "@tenure/modules"
import { ENGINE_VERSION, resolveConfig } from "@tenure/configuration"
import { resolveModules } from "@tenure/module-runtime"
import { validateTopology } from "@tenure/organization-model"
import { REGISTRY, compareVersionStrings, layersFor } from "@tenure/platform-config"
import {
  LifecycleError,
  attemptFor,
  classify,
  deploymentManifest,
  executeStep,
  requirementsFor,
  type ChangeClass,
  type ChangeOperation,
  type ExecutionContext,
  type SecretRefResolution,
  type TenantState,
} from "@tenure/provisioning"

import { isOperator } from "./operators"
import { advanceTenant, getTenant, startCoolingOff, tableName } from "./registry"
import { deliverToCell, deploymentSigningKey } from "./deliver"
import { resolveSecretRefs, secretsAreReachable, unresolvedSecretRefs } from "./secret-refs"

/**
 * The work a lifecycle command actually does, separated from the transport that
 * asked for it.
 *
 * STUDIO-130-005. This used to live inside a server action, which meant the
 * ONLY way to advance a tenant was a browser POST with a React form on the other
 * end. There was no second caller, and no way for a poller, an operator's curl
 * or the control-plane API (STUDIO-130-002) to do the same thing without
 * duplicating a hundred lines of executor — and a duplicated executor is two
 * lifecycles that agree until one of them is edited.
 *
 * Both callers exist now and both are in this repository:
 *
 *   * `src/app/tenants/actions.ts` — `advanceState`, the form the operator uses.
 *   * `src/app/api/aws/[surface]/route.ts` — `POST /api/aws/operations`.
 *
 * Neither knows the lifecycle rules. `@tenure/provisioning` decides legality,
 * this decides nothing and runs what it is told, and the gate in front of it
 * (`command-gate.ts`) decides whether it may run at all.
 */

/**
 * The engines the executor runs against.
 *
 * Built from the real catalogs and passed in, so the executor stays free of
 * them and the console cannot accidentally verify a tenant against a different
 * configuration engine than the one that will build it.
 */
export function executionContext(
  /**
   * STUDIO-040-005 — the answer to "do these secrets exist", already resolved.
   *
   * A required parameter, not a default. Resolving a secret reference is an AWS
   * call and `executeStep` is deterministic and synchronous, so the lookup has
   * to happen before the context is built — and a default of `{}` would have
   * meant a caller who forgot silently verified a tenant whose secrets were
   * never checked. Every construction site had to answer, which is the only
   * reason this is safe.
   */
  secretRefs: Readonly<Record<string, SecretRefResolution>>,
): ExecutionContext {
  return {
    resolveSecretRefs: () => secretRefs,
    resolveConfiguration(manifest) {
      // A tenant composed in this console has no file binding, so `layersFor`
      // returns nothing for it and every value would fall back to a platform
      // default — a system that looks configured and is not. The blueprint
      // layer is therefore built from the manifest, and the file binding is
      // used only when one exists (the pilot, which predates the registry).
      const fileLayers = layersFor(manifest.slug)
      const blueprint = getBlueprint(manifest.blueprintId)
      // Falls back to the blueprint's own axes when the manifest carries none,
      // which is what a manifest written before axes existed looks like.
      const selection = manifest.archetype ?? blueprint?.axes
      const compiled =
        selection && archetypeProblems(selection).length === 0
          ? compileArchetype(selection as ArchetypeSelection)
          : undefined
      const layers =
        fileLayers.length > 0
          ? fileLayers
          : blueprint
            ? [
                {
                  scope: "blueprint" as const,
                  id: blueprint.id,
                  label: blueprint.name,
                  values: blueprint.values,
                },
                ...(compiled
                  ? [
                      {
                        scope: "archetype" as const,
                        id: `${selection!.organization}/${selection!.operatingModel}`,
                        label: "Archetype axes",
                        values: compiled.values,
                      },
                    ]
                  : []),
                {
                  scope: "tenant" as const,
                  id: manifest.slug,
                  label: manifest.displayName,
                  values: manifest.configuration,
                },
              ]
            : []

      const { config, problems } = resolveConfig(REGISTRY, layers, { collectProblems: true })
      return {
        checksum: config?.checksum ?? "",
        values: config?.values ?? {},
        problems: problems ?? [],
      }
    },
    resolveModules(manifest) {
      const resolved = resolveModules(MODULE_CATALOG, {
        requested: manifest.modules,
        entitlements: manifest.entitlements,
        // Every manifest declares `requiresEngine`, and resolve.ts refuses a
        // module whose caller cannot say which engine is running. Omitting
        // these two refuses EVERY module with `engine-too-old`.
        runningEngineVersion: ENGINE_VERSION,
        compareVersions: compareVersionStrings,
        operatingModel:
          manifest.archetype?.operatingModel ??
          getBlueprint(manifest.blueprintId)?.axes.operatingModel,
        // PACK-020-004. The executor resolves under the same coexistence
        // declaration the manifest records.
        systemOfRecord: manifest.systemOfRecord,
      })
      return {
        ordered: resolved.ordered.map((m) => ({ key: m.key, version: m.version })),
        problems: resolved.problems,
      }
    },
    validateTopology(manifest) {
      const blueprint = getBlueprint(manifest.blueprintId)
      if (!blueprint) return { valid: false, problems: [`No blueprint "${manifest.blueprintId}".`] }
      try {
        validateTopology(blueprint.topology)
        return { valid: true, problems: [] }
      } catch (err) {
        return { valid: false, problems: [err instanceof Error ? err.message : String(err)] }
      }
    },
    // Pinned to the migration the cell is expected to be at. Read from the
    // build rather than hardcoded so a stale engine cannot publish an artifact
    // claiming a schema it does not know about.
    schemaVersion: () => process.env.SCHEMA_VERSION ?? "unpinned",
  }
}

export interface AdvanceCommandInput {
  slug: string
  to: TenantState
  principalId: string
  at: string
  approvedBy?: string
  ownerPrincipalId?: string
  reason?: string
  /** One id shared by every record this act produces. */
  correlationId?: string
  /**
   * STUDIO-060-007 — what the operator typed into the confirmation field.
   *
   * Compared with `===` against the token `requirementsFor` produces. Undefined
   * is a refusal for any class that requires one, never a pass: a caller that
   * omits the field must not be able to skip the control by omission.
   */
  confirmation?: string
}

export type AdvanceOutcome =
  | { ok: true; state: TenantState; detail: string }
  | { ok: false; error: string; conflict?: boolean; changeClass?: ChangeClass }

/* ------------------------------------------------------- STUDIO-060-007 -- */

/**
 * What this control plane will not do, whatever form is filled in.
 *
 * NEXT-SESSION §0.3 lists these as refusals and, until now, nothing in the code
 * represented that list — a refusal that exists only in a document is a policy
 * the next person to write a handler has never read. `classify` puts each of
 * them in a class, `requirementsFor` marks the class non-automatable, and the
 * dispatcher below refuses with the command a human runs instead.
 *
 * Rendered on the tenant page, so the list is something an operator can see
 * rather than something they discover by being refused.
 */
export const REFUSED_OPERATIONS: readonly ChangeOperation[] = [
  { surface: "tenant-lifecycle", action: "PURGING", target: "<slug>" },
]

export type ChangeRefusal =
  | { allowed: true; changeClass: ChangeClass }
  | { allowed: false; changeClass: ChangeClass; detail: string }

export interface ChangeGateInput {
  operation: ChangeOperation
  requestedBy: string
  /** Second identity, already checked against the operator allowlist by the caller. */
  approvedBy?: string
  confirmation?: string
  /** Now. Compared against the PERSISTED requestedAt, never against another caller value. */
  at: string
  /** Reads the authoritative start of the cooling-off clock, starting it if this is the first ask. */
  coolingOffClock: (
    action: string,
    requestedBy: string,
    at: string,
  ) => Promise<{ requestedAt: string; requestedBy: string }>
}

/**
 * The gate every mutating command passes, in front of the lifecycle engine.
 *
 * Order matters and is deliberate: token, then approvers, then cooling-off,
 * then automatability. A C7 whose token is wrong is told about the token rather
 * than being made to wait fifteen minutes to find out — and, critically, the
 * clock is not started by a request that was going to be refused for a reason
 * the operator can fix in five seconds.
 *
 * This does NOT replace the lifecycle engine's own approval rules. `advance`
 * still refuses a transition with no approver, still refuses self-approval and
 * still refuses an approver who is not an operator. This adds what the engine
 * has no vocabulary for: which class of change this is, and what that class
 * costs before anybody is allowed to make it.
 */
export async function gateChange(input: ChangeGateInput): Promise<ChangeRefusal> {
  const changeClass = classify(input.operation)
  const required = requirementsFor(changeClass, input.operation.target)

  // 1. The typed token. Exact equality, deliberately — see `ChangeRequirements`.
  if (required.typedConfirmation !== null) {
    if (input.confirmation !== required.typedConfirmation) {
      return {
        allowed: false,
        changeClass,
        detail:
          `${changeClass} requires a typed confirmation. Type exactly ` +
          `"${required.typedConfirmation}" to proceed. ` +
          (input.confirmation
            ? `"${input.confirmation}" is not it.`
            : `Nothing was typed, and an empty confirmation is a refusal rather than a default.`),
      }
    }
  }

  // 2. A second person.
  if (required.approvers === 2) {
    if (!input.approvedBy) {
      return {
        allowed: false,
        changeClass,
        detail: `${changeClass} needs a second operator to agree. Record who approved it.`,
      }
    }
    if (input.approvedBy === input.requestedBy) {
      return {
        allowed: false,
        changeClass,
        // "cannot be both" — both WHAT. The sentence named the two roles
        // nowhere, so the refusal an operator actually meets for a
        // self-approval never said what the rule is, and the rule is the only
        // part of it they can act on. The lifecycle engine behind this gate has
        // always said it in words ("cannot approve their own"); this is the
        // gate that answers first saying the same thing.
        detail:
          `${changeClass} needs a SECOND identity; ${input.requestedBy} cannot be both the ` +
          `operator who requested this and the operator who approves it — an operator cannot ` +
          `approve their own change.`,
      }
    }
  }

  // 3. The clock. Read from the store, never from the request.
  if (required.coolingOffMs > 0) {
    const started = await input.coolingOffClock(
      `${input.operation.surface}:${input.operation.action}`,
      input.requestedBy,
      input.at,
    )
    const elapsed = Date.parse(input.at) - Date.parse(started.requestedAt)
    if (!Number.isFinite(elapsed) || elapsed < required.coolingOffMs) {
      const remaining = Math.max(0, required.coolingOffMs - (Number.isFinite(elapsed) ? elapsed : 0))
      return {
        allowed: false,
        changeClass,
        detail:
          `${changeClass} has a cooling-off period. This was first requested at ` +
          `${started.requestedAt} by ${started.requestedBy}; ${Math.ceil(remaining / 60_000)} ` +
          `minute(s) remain. The start time is the one stored when the request was first made — ` +
          `it is not read from this submission, so it cannot be moved.`,
      }
    }
  }

  // 4. Whether this platform may do it at all.
  if (!required.automatable) {
    return {
      allowed: false,
      changeClass,
      detail:
        `${changeClass} is not automatable by this control plane, and every earlier check on this ` +
        `request passed — so this is a refusal on principle, not a missing field. ` +
        `${input.operation.surface}:${input.operation.action} destroys data nothing here can ` +
        `recreate, and a console that will do that because a form was filled in correctly is the ` +
        `wrong shape of tool. A human runs, with their own credentials and their own audit trail: ` +
        `${required.refusedWithCliCommand}`,
    }
  }

  return { allowed: true, changeClass }
}

/**
 * Move a tenant one state along, running the destination state's work first.
 *
 * A step that fails must not leave a tenant claiming to be in a state it never
 * reached — which is precisely what the lifecycle looked like before the
 * executor existed.
 */
export async function runAdvance(input: AdvanceCommandInput): Promise<AdvanceOutcome> {
  try {
    const tenant = await getTenant(input.slug)
    if (!tenant) return { ok: false, error: `No tenant "${input.slug}".` }

    /* ------------------------------------------------- STUDIO-060-007 --
     * The class gate, before anything runs.
     *
     * In front of `executeStep` rather than after it, because a refused change
     * must not have produced a reservation, a resolved configuration or an
     * artifact — and because starting a cooling-off clock is itself a side
     * effect that only a request which passed every other check has earned.
     */
    const operation: ChangeOperation = {
      surface: "tenant-lifecycle",
      action: input.to,
      target: input.slug,
    }
    const gated = await gateChange({
      operation,
      requestedBy: input.principalId,
      approvedBy: input.approvedBy,
      confirmation: input.confirmation,
      at: input.at,
      coolingOffClock: (action, requestedBy, at) =>
        startCoolingOff(input.slug, action, requestedBy, at),
    })
    if (!gated.allowed) {
      return { ok: false, error: gated.detail, changeClass: gated.changeClass }
    }

    /* ------------------------------------------------- STUDIO-040-005 --
     * Do the secrets this manifest names actually exist?
     *
     * Resolved HERE, before the context is built, because the lookup is an AWS
     * call and `executeStep` is deterministic and synchronous. The VERIFYING
     * step then reads the answer out of the context instead of re-testing a
     * regex over the reference string.
     */
    const secretStates = secretsAreReachable()
      ? await resolveSecretRefs(tenant.manifest.secretRefs)
      : unresolvedSecretRefs(
          tenant.manifest.secretRefs,
          "No AWS region is resolved for this process, so no secret reference was checked. " +
            "Set AWS_REGION on the Studio service. This is UNKNOWN, not a pass.",
        )

    const ctx = executionContext(secretStates)
    // STUDIO-060-010. The provenance the executor cannot know: one id shared by
    // every record this act produces, and which try at this destination it is.
    // The attempt is read from the SAME helper `advance` uses, so a retry
    // cannot be numbered one thing in the evidence and another in the step.
    /* ------------------------------------------------- STUDIO-070-005 --
     * The execution provenance, threaded from the caller.
     *
     * Every field here is a fact this process actually has, and none is
     * defaulted into existence:
     *
     *   awsRequestIds    the id DynamoDB returned for the Query that produced
     *                    `tenant`. It is what makes the field real rather than
     *                    an empty array everybody passes — the whole reason the
     *                    requirement calls it out.
     *   assumedRoleArn   null. There is no sts:AssumeRole in this repository
     *                    and this task runs as whatever the environment gives
     *                    it, so a role name copied out of configuration would be
     *                    an identity nobody confirmed.
     *   resourceHandles  the registry partition this act reads and writes. Not
     *                    an ARN, because the table's ARN is not something this
     *                    process is told (STUDIO-080-001).
     *   nextRetryAt      computed below, after the step's outcome is known.
     *   compensation     likewise.
     */
    const attempt = attemptFor(tenant.history, input.to)
    const handle = tableName()
      ? `dynamodb:table/${tableName()}#TENANT#${input.slug}`
      : `registry:TENANT#${input.slug} (no table configured)`

    const evidence = executeStep(input.to, tenant.manifest, ctx, {
      correlationId: input.correlationId ?? `adv-${input.slug}-${input.at}`,
      attempt,
      ...(input.approvedBy ? { approvalRef: input.approvedBy } : {}),
      awsRequestIds: tenant.awsRequestIds,
      assumedRoleArn: null,
      resourceHandles: [handle],
      // Filled in below when the step fails. A step that succeeded has no next
      // retry, and saying so with `null` is different from leaving it out.
      nextRetryAt: null,
      compensation: null,
    })

    // MIGRATING is the hand-off. The artifact is delivered here, and the
    // evidence records what the cell actually did — or that nothing received
    // it, which must not read as success.
    if (input.to === "MIGRATING" && tenant.deployment) {
      const outcome = await deliverToCell(tenant.deployment, tenant.manifest)
      evidence.detail = `${evidence.detail} ${outcome.detail}`
      evidence.checks = [
        ...(evidence.checks ?? []),
        { name: "delivered to the cell", ok: outcome.delivered, detail: outcome.detail },
      ]
      if (!outcome.delivered) evidence.ok = false
    }

    if (!evidence.ok) {
      // STUDIO-070-005. When the next try is DUE, and what was owed after this
      // one. Written onto the evidence that is about to be reported, so a failed
      // step carries both rather than an operator having to guess.
      //
      // Exponential from the attempt count, capped, and nothing polls it — an
      // operator does. Said plainly because a field called `nextRetryAt` invites
      // the reader to assume something is watching it.
      const backoffMs = Math.min(2 ** Math.max(0, attempt - 1) * 30_000, 15 * 60_000)
      evidence.nextRetryAt = new Date(Date.parse(input.at) + backoffMs).toISOString()
      evidence.compensation =
        input.to === "MIGRATING"
          ? {
              // The cell verifies the artifact's digest before it writes a row,
              // so a delivery that did not land wrote nothing to undo. That is a
              // real compensation record, not an absent one.
              attempted: false,
              ok: true,
              detail:
                "Nothing to undo: the cell verifies an artifact before it touches a row, so a " +
                "delivery that did not land left no partial state. The published artifact remains " +
                "in the registry and is re-delivered by retrying this step.",
            }
          : {
              attempted: false,
              ok: true,
              detail:
                `${input.to} computes and validates; it creates nothing outside this registry, so a ` +
                `failure leaves nothing to compensate. The tenant stays where it was.`,
            }
      const failed = (evidence.checks ?? []).filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`)
      return {
        ok: false,
        error: `${input.to} did not complete. ${evidence.detail}${failed.length ? ` — ${failed.join("; ")}` : ""}`,
      }
    }

    // The artifact is written twice, and the second one is what activation
    // actually IS. CONFIGURING publishes with `serving: false` — created and
    // unreachable. ACTIVATING publishes the same system with `serving: true`,
    // and that manifest is the routing switch.
    //
    // STUDIO-070-009. Two things changed here and both were previously false
    // comments rather than behaviour:
    //
    //   `signWith`         until now nothing signed, while three call sites
    //                      described the artifact as signed. `deliverToCell`
    //                      refuses an unsigned one, so an engine with no key
    //                      configured fails at the hand-off with a message
    //                      naming the variables — rather than delivering an
    //                      artifact whose origin nothing establishes.
    //   `previousDigest`   `rollbackDigest` was permanently null because this
    //                      call site held `tenant.deployment` and did not
    //                      forward it. A rollback target the artifact cannot
    //                      name is a rollback nobody can perform.
    const deployment =
      input.to === "CONFIGURING" || input.to === "ACTIVATING"
        ? deploymentManifest(tenant.manifest, [...tenant.evidence, evidence], ctx, {
            createdAt: input.at,
            createdBy: input.principalId,
            serving: input.to === "ACTIVATING",
            previousDigest: tenant.deployment?.digest ?? null,
            signWith: deploymentSigningKey(),
          })
        : undefined

    const moved = await advanceTenant(
      input.slug,
      input.to,
      {
        actor: { principalId: input.principalId, at: input.at },
        approvedBy: input.approvedBy,
        // Looked up against the same allowlist that admitted the requester, so
        // one operator cannot approve their own irreversible purge by typing
        // any address that is not theirs.
        approverIsOperator: input.approvedBy ? isOperator(input.approvedBy) : undefined,
        ownerPrincipalId: input.ownerPrincipalId,
        reason: input.reason,
      },
      evidence,
      deployment,
    )

    return { ok: true, state: moved.record.state, detail: evidence.detail }
  } catch (err) {
    if (err instanceof LifecycleError) return { ok: false, error: err.message }
    if ((err as { name?: string }).name === "TransactionCanceledException") {
      return {
        ok: false,
        conflict: true,
        error:
          "This tenant moved while the page was open — someone else advanced it. Reload to see where it is now.",
      }
    }
    throw err
  }
}
