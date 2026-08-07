"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  ARCHETYPE_AXIS_VALUES,
  TENANT_BINDINGS,
  applyModuleEdits,
  archetypeProblems,
  compileArchetype,
  getBlueprint,
  moduleEditsBetween,
  type ArchetypeSelection,
} from "@tenure/blueprints";
import { MODULE_CATALOG } from "@tenure/modules";
import { resolveConfig } from "@tenure/configuration";
import { resolveModules } from "@tenure/module-runtime";
import { validateTopology } from "@tenure/organization-model";
import {
  REGISTRY,
  compareVersionStrings,
  layersFor,
} from "@tenure/platform-config";
import { ENGINE_VERSION } from "@tenure/configuration";
import {
  BUSINESS_DOMAINS,
  MANIFEST_VERSION,
  LifecycleError,
  deploymentManifest,
  executeStep,
  getPlan,
  validateManifest,
  type CoexistenceProfile,
  type ExecutionContext,
  type IsolationTier,
  type TenantManifest,
  type TenantState,
} from "@tenure/provisioning";

import { auth } from "@/lib/auth";
import { registryRecordFor } from "@/lib/registry-record";
import { placementFor } from "@/lib/cells";
import { isOperator } from "@/lib/operators";
import {
  SlugTaken,
  adoptBoundTenant,
  advanceTenant,
  getTenant,
  registerTenant,
  takenSlugs,
} from "@/lib/registry";
import { buildAdoption } from "@/lib/adopt";
import { deliverToCell } from "@/lib/deliver";

/**
 * Every action here re-checks the operator, in the action.
 *
 * The pages check too, but a server action is a POST endpoint reachable by its
 * id — rendering the page is not a precondition for calling it. A guard that
 * lives only in the page protects the page.
 */
async function operator(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  if (!isOperator(email)) {
    // 404-shaped, like the rest of the console: the existence of an endpoint
    // that provisions tenants is not something to confirm to a stranger.
    throw new Error("Not found");
  }
  return email!;
}

const now = () => new Date().toISOString();

/**
 * The engines the executor runs against.
 *
 * Built here, from the real catalogs, and passed in — so the executor stays
 * free of them and the console cannot accidentally verify a tenant against a
 * different configuration engine than the one that will build it.
 */
function executionContext(): ExecutionContext {
  return {
    resolveConfiguration(manifest) {
      // A tenant composed in this console has no file binding, so `layersFor`
      // returns nothing for it and every value would fall back to a platform
      // default — a system that looks configured and is not. The blueprint
      // layer is therefore built from the manifest, and the file binding is
      // used only when one exists (the pilot, which predates the registry).
      const fileLayers = layersFor(manifest.slug);
      const blueprint = getBlueprint(manifest.blueprintId);
      // The composition, compiled into the layer stack between `blueprint` and
      // `tenant` — the same position `layersFor` puts it in for a file-bound
      // tenant, because a tenant composed here and a tenant bound in a file must
      // resolve through one stack or the console is previewing a system the
      // engine will not build (PACK-020-003).
      //
      // Falls back to the blueprint's own axes when the manifest carries none,
      // which is what a manifest written before axes existed looks like.
      const selection = manifest.archetype ?? blueprint?.axes;
      const compiled =
        selection && archetypeProblems(selection).length === 0
          ? compileArchetype(selection as ArchetypeSelection)
          : undefined;
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
            : [];

      const { config, problems } = resolveConfig(REGISTRY, layers, {
        collectProblems: true,
      });
      return {
        checksum: config?.checksum ?? "",
        values: config?.values ?? {},
        problems: problems ?? [],
      };
    },
    resolveModules(manifest) {
      const resolved = resolveModules(MODULE_CATALOG, {
        requested: manifest.modules,
        entitlements: manifest.entitlements,
        // Every manifest now declares `requiresEngine`, and resolve.ts refuses a
        // module whose caller cannot say which engine is running — "an engine
        // that cannot say how old it is cannot claim to be new enough". Omitting
        // these two refuses EVERY module with `engine-too-old`, which is not a
        // missing test but a broken execution context.
        runningEngineVersion: ENGINE_VERSION,
        compareVersions: compareVersionStrings,
        // From the manifest's own composition, falling back to the blueprint's
        // default. Omitting it would refuse every operating-model-gated module
        // at VALIDATING for a tenant whose axis actually accepts it.
        operatingModel:
          manifest.archetype?.operatingModel ??
          getBlueprint(manifest.blueprintId)?.axes.operatingModel,
        // PACK-020-004. The executor resolves under the same coexistence
        // declaration the manifest records, so a tenant cannot be verified as
        // buildable with modules its own system-of-record forbids.
        systemOfRecord: manifest.systemOfRecord,
      });
      return {
        ordered: resolved.ordered.map((m) => ({
          key: m.key,
          version: m.version,
        })),
        problems: resolved.problems,
      };
    },
    validateTopology(manifest) {
      const blueprint = getBlueprint(manifest.blueprintId);
      if (!blueprint)
        return {
          valid: false,
          problems: [`No blueprint "${manifest.blueprintId}".`],
        };
      try {
        validateTopology(blueprint.topology);
        return { valid: true, problems: [] };
      } catch (err) {
        return {
          valid: false,
          problems: [err instanceof Error ? err.message : String(err)],
        };
      }
    },
    // Pinned to the migration the cell is expected to be at. Read from the
    // build rather than hardcoded so a stale engine cannot publish an artifact
    // claiming a schema it does not know about.
    schemaVersion: () => process.env.SCHEMA_VERSION ?? "unpinned",
  };
}

export interface ComposeResult {
  problems: Array<{ field: string; reason: string; detail: string }>;
}

/**
 * Compose a tenant from the form and register it in DRAFT.
 *
 * Validation happens here rather than only in the browser, because the browser
 * is not where trust lives — and because the same function is what the plan
 * preview calls, so what an operator was shown is what gets written.
 */
export async function composeTenant(
  _prev: ComposeResult | null,
  form: FormData,
): Promise<ComposeResult> {
  const principalId = await operator();

  const planId = String(form.get("planId") ?? "");

  // The composition, off the form and unvalidated — every axis value is a
  // string until `validateManifest` checks it against `ARCHETYPE_AXIS_VALUES`,
  // exactly as `blueprintId` is a string until it is checked against the
  // blueprints that exist (PACK-GATE-020).
  const archetype = {
    organization: String(form.get("archetype.organization") ?? ""),
    operatingModel: String(form.get("archetype.operatingModel") ?? ""),
    functional: form.getAll("archetype.functional").map(String),
  };

  // Every domain the operator marked as owned by an external system. A checkbox
  // group rather than a free-text list: the domain vocabulary is closed, and a
  // typo in it would silently mean "no external owner" for the domain meant.
  const externalOwned = new Set(form.getAll("externalDomains").map(String));

  /* --------------------------------------------------------- PACK-020-002 --
   * The preset, and the operator's edit over it.
   *
   * The form submits a DIFF — which modules were added to the composition and
   * which were taken out of it — rather than an absolute list. The preset is
   * recompiled HERE from the submitted axes, so the browser cannot be the
   * authority on it: a form that sent the wrong absolute set would have been
   * registered verbatim, and a form that sends the wrong diff produces a
   * refusal an operator can read.
   *
   * `applyModuleEdits` refuses an edit that cannot be applied at all — a module
   * both added and removed, or a removal of something the preset never listed.
   * Both are reported against the `modules` field rather than thrown, because
   * they are things the person at the form can fix.
   */
  const moduleEdits = {
    add: form.getAll("moduleAdd").map(String),
    remove: form.getAll("moduleRemove").map(String),
  };
  // Compiled only when the axes are valid; when they are not, the axis problems
  // below are the answer and a module set derived from a broken selection would
  // be a second, misleading message about the same mistake.
  const compiled =
    archetypeProblems(archetype).length === 0
      ? compileArchetype(archetype as ArchetypeSelection)
      : null;

  let composedModules: readonly string[] = [];
  const editProblems: Array<{ field: string; reason: string; detail: string }> = [];
  if (compiled) {
    try {
      composedModules = applyModuleEdits(compiled.modules, moduleEdits);
    } catch (err) {
      composedModules = compiled.modules;
      editProblems.push({
        field: "modules",
        reason: "invalid-module-edit",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // What the operator changed, recorded on the artifact an approver reads.
  // Without it the plan shows a module list and nothing says whether it is the
  // preset or a departure from it — which is the whole difference between a
  // starting point and a locked type.
  // Derived from the two sets rather than echoed from the form, so it describes
  // what was actually composed even if the browser sent a diff the server
  // refused part of.
  const applied = moduleEditsBetween(compiled?.modules ?? [], composedModules);
  const divergence = [
    ...applied.add.map((k) => `+${k}`),
    ...applied.remove.map((k) => `-${k}`),
  ];
  const operatorNotes = String(form.get("notes") ?? "").trim();

  const manifest: TenantManifest = {
    manifestVersion: MANIFEST_VERSION,
    slug: String(form.get("slug") ?? "")
      .trim()
      .toLowerCase(),
    legalName: String(form.get("legalName") ?? "").trim(),
    displayName: String(form.get("displayName") ?? "").trim(),
    blueprintId: String(form.get("blueprintId") ?? ""),
    archetype,
    // The preset the axes compile to, with the operator's per-module edit
    // applied — not an absolute list off the form. See above.
    modules: [...composedModules],
    // From the contracted plan, not from a text box. A typed entitlement list
    // makes every tenant's commercial state a typing exercise — a typo is a
    // silently missing feature, and nothing reconciles against an invoice.
    entitlements: getPlan(planId)?.entitlements ?? [],
    // No literal fallback. The form offers only regions the fleet serves, so
    // an empty value means the form was bypassed — and placement refusing is
    // the right answer to that, not a guess at which region was meant.
    region: String(form.get("region") ?? ""),
    isolation: String(form.get("isolation") ?? "pooled") as IsolationTier,
    // PACK-020-004. Both come off the form, because both are decisions about a
    // customer's estate that nothing in the engine could derive. The default in
    // the markup is TENURE_CLOUD_PRIMARY with no external domain, which is the
    // arrangement every tenant today has — but it is a value somebody left
    // selected rather than a field that did not exist.
    coexistence: String(form.get("coexistence") ?? "") as CoexistenceProfile,
    systemOfRecord: Object.fromEntries(
      BUSINESS_DOMAINS.map((domain) => [
        domain,
        externalOwned.has(domain) ? ("external" as const) : ("tenure" as const),
      ]),
    ),
    configuration: {},
    secretRefs: {},
    initialAdminEmail: String(form.get("initialAdminEmail") ?? "").trim(),
    // The operator's own note, plus what they changed about the preset. The
    // second half is derived, never typed: a plan that lists twelve modules and
    // does not say which of them were the archetype's choice and which were the
    // operator's is a plan an approver cannot review (PACK-020-002).
    notes:
      [operatorNotes, divergence.length > 0 ? `Preset edited: ${divergence.join(" ")}.` : ""]
        .filter(Boolean)
        .join(" ") || undefined,
  };

  const { valid, problems } = validateManifest(manifest, {
    knownBlueprints: [...new Set(TENANT_BINDINGS.map((b) => b.blueprintId))],
    knownModules: MODULE_CATALOG.keys(),
    // The closed axis table, from the engine that will compile the composition.
    // Passing nothing would make every axis value acceptable.
    archetypeAxes: ARCHETYPE_AXIS_VALUES,
    // Both sources of truth for an existing slug: registered tenants, and the
    // file-based bindings that predate the registry. Missing the second would
    // let someone register "rochester" over the live pilot.
    takenSlugs: [
      ...(await takenSlugs()),
      ...TENANT_BINDINGS.map((b) => b.slug),
    ],
  });

  // Module dependencies are resolved here, not only at VALIDATING. A manifest
  // that cannot build should not be registrable: catching it at composition
  // puts the message in front of the checkbox that caused it, rather than in
  // front of an operator wondering why a registered tenant will not advance.
  const moduleProblems = resolveModules(MODULE_CATALOG, {
    requested: manifest.modules,
    entitlements: manifest.entitlements,
    // As above: without these, composition refuses every module rather than
    // reporting the ones that genuinely do not fit.
    runningEngineVersion: ENGINE_VERSION,
    compareVersions: compareVersionStrings,
    operatingModel: archetype.operatingModel,
    // Same declaration the manifest carries, so an operator who marks finance
    // as externally owned and then ticks budgeting is told at composition
    // rather than discovering the module missing after provisioning.
    systemOfRecord: manifest.systemOfRecord,
  }).problems.map((p) => ({
    field: "modules",
    reason: p.reason,
    detail: `${p.moduleKey}: ${p.detail}`,
  }));

  // What the composition needs from the contract, against what the contract
  // grants.
  //
  // Distinct from the module refusal above, and not a second copy of it: that
  // one names a module and sends an operator to the checkbox, this one names
  // the SUITE and the PLAN and sends them to the contract. Dropping the suite
  // and buying the plan are different remedies, and an operator who is only
  // told "budgeting: requires entitlement finance" cannot tell which one they
  // are being asked for.
  const composition =
    archetypeProblems(archetype).length === 0
      ? compileArchetype(archetype as ArchetypeSelection)
      : undefined;
  const granted = new Set(manifest.entitlements);
  const entitlementProblems = (composition?.entitlements ?? [])
    .filter((entitlement) => !granted.has(entitlement))
    .map((entitlement) => ({
      field: "planId",
      reason: "entitlement-not-in-plan",
      detail:
        `This composition needs the "${entitlement}" entitlement and plan "${planId}" does not ` +
        `grant it. Contract a plan that does, or drop the suites that need it.`,
    }));

  // An unknown plan yields no entitlements, which is the right failure but a
  // silent one — the tenant registers, every gated module is refused, and the
  // operator is left wondering why. Said out loud instead (GE-030-004).
  const planProblems = getPlan(planId)
    ? []
    : [
        {
          field: "planId",
          reason: "unknown-plan",
          detail: `No plan "${planId}". Entitlements and quotas come from the plan, so an unknown one entitles nothing.`,
        },
      ];

  if (
    !valid ||
    editProblems.length > 0 ||
    moduleProblems.length > 0 ||
    planProblems.length > 0 ||
    entitlementProblems.length > 0
  ) {
    return {
      problems: [
        ...problems,
        ...editProblems,
        ...moduleProblems,
        ...planProblems,
        ...entitlementProblems,
      ],
    };
  }

  try {
    const at = now();
    // GE-030-001. The registry record is what is TRUE about the tenant —
    // immutable id, lifecycle, placement, residency, release, config revision —
    // as distinct from the manifest, which is what was asked for. Built here and
    // written in the same transaction, because a tenant the console can show and
    // the fleet cannot place is worse than one that failed to register.
    // GE-030-002. Placement is decided against the cell registry, not derived
    // from a naming convention. `cell-${region}` was correct exactly while
    // there is one cell per region, and silently wrong the day there are two —
    // wrong in the direction of registering a tenant against a cell that is
    // full, draining, or in another environment.
    const placement = placementFor({
      residency: [manifest.region],
      environment: (process.env.DEPLOY_ENVIRONMENT ??
        "production") as "production",
    });
    if (!placement.cellId) {
      // Reported as a form problem rather than a 500, and with the reason: "no
      // cell may legally hold this tenant" and "every cell is full" are the
      // same outcome and completely different problems.
      return {
        problems: [
          {
            field: "region",
            reason: placement.reason,
            detail:
              placement.reason === "no-cell-in-residency"
                ? `No cell serves ${manifest.region} in this environment.`
                : placement.reason === "no-healthy-cell"
                  ? `Every cell in ${manifest.region} is degraded, upgrading or draining. Nothing to fix here — try again once the fleet is healthy.`
                  : placement.reason === "no-headroom"
                    ? // Not the same problem as being full, and saying "at
                      // capacity" for it would be a lie an operator can check:
                      // they open the console, see 49 of 50, and stop believing
                      // the next message too. The decision already carries the
                      // accurate sentence and what to do about it.
                      placement.admission.detail
                    : `Every cell in ${manifest.region} is at capacity.`,
          },
        ],
      };
    }

    await registerTenant(
      manifest,
      { principalId, at },
      registryRecordFor(manifest, {
        cellId: placement.cellId,
        release: process.env.SCHEMA_VERSION ?? "unpinned",
        primaryContactEmail: manifest.initialAdminEmail,
        // The plan the operator contracted, not one inferred back out of the
        // entitlements it produced. Inferring it was a placeholder that would
        // have named the wrong plan the moment two plans shared an entitlement.
        plan: planId,
        at,
      }),
    );
  } catch (err) {
    if (err instanceof SlugTaken) {
      // Lost the race between validation and the conditional write. Reported as
      // the same problem shape rather than a 500, because it is a form error.
      return {
        problems: [
          {
            field: "slug",
            reason: "taken",
            detail: `"${manifest.slug}" was registered a moment ago.`,
          },
        ],
      };
    }
    throw err;
  }

  revalidatePath("/tenants");
  redirect(`/tenants/${manifest.slug}`);
}

export interface AdvanceResult {
  error?: string;
}

/**
 * Move a tenant one state along.
 *
 * The button an operator clicks names the destination; whether that move is
 * legal, and whether it needs a second person, is decided by the lifecycle
 * engine. This action does not know the rules and must not — a UI that encodes
 * them separately is a UI that will disagree with them.
 */
export async function advanceState(
  _prev: AdvanceResult | null,
  form: FormData,
): Promise<AdvanceResult> {
  const principalId = await operator();

  const slug = String(form.get("slug") ?? "");
  const to = String(form.get("to") ?? "") as TenantState;
  const approvedBy = String(form.get("approvedBy") ?? "").trim() || undefined;
  const reason = String(form.get("reason") ?? "").trim() || undefined;

  const at = now();

  try {
    // Run the work for the destination state BEFORE recording the move. A step
    // that fails must not leave a tenant claiming to be in a state it never
    // reached — which is precisely what the lifecycle looked like before the
    // executor existed.
    const tenant = await getTenant(slug);
    if (!tenant) return { error: `No tenant "${slug}".` };

    const ctx = executionContext();
    const evidence = executeStep(to, tenant.manifest, ctx);

    // MIGRATING is the hand-off. The artifact is delivered here, and the
    // evidence records what the cell actually did — or that nothing received
    // it, which must not read as success.
    if (to === "MIGRATING" && tenant.deployment) {
      const outcome = await deliverToCell(tenant.deployment, tenant.manifest);
      evidence.detail = `${evidence.detail} ${outcome.detail}`;
      evidence.checks = [
        ...(evidence.checks ?? []),
        {
          name: "delivered to the cell",
          ok: outcome.delivered,
          detail: outcome.detail,
        },
      ];
      if (!outcome.delivered) evidence.ok = false;
    }

    if (!evidence.ok) {
      const failed = (evidence.checks ?? [])
        .filter((c) => !c.ok)
        .map((c) => `${c.name}: ${c.detail}`);
      return {
        error: `${to} did not complete. ${evidence.detail}${failed.length ? ` — ${failed.join("; ")}` : ""}`,
      };
    }

    // A signed artifact is written twice, and the second one is what activation
    // actually IS.
    //
    // CONFIGURING computes what a cell reconciles toward, and publishes it with
    // `serving: false` — the tenant is created and unreachable. ACTIVATING
    // publishes the same system with `serving: true`, and that manifest is the
    // routing switch: `resolveTenantScope` in the cell drops institutions that
    // are not serving, so until this arrives nobody can act in the tenant.
    //
    // Before this, ACTIVATING returned a sentence saying routing had been
    // switched on and did nothing. The tenant had been reachable since
    // MIGRATING, one state and one approval earlier.
    const deployment =
      to === "CONFIGURING" || to === "ACTIVATING"
        ? deploymentManifest(
            tenant.manifest,
            [...tenant.evidence, evidence],
            ctx,
            {
              createdAt: at,
              createdBy: principalId,
              serving: to === "ACTIVATING",
            },
          )
        : undefined;

    await advanceTenant(
      slug,
      to,
      {
        actor: { principalId, at },
        approvedBy,
        // Looked up against the same allowlist that admitted the requester.
        // Before this, `approvedBy` was a free-text field checked only for
        // being non-empty and not the requester's own id — so one operator
        // could approve their own irreversible purge by typing any address
        // that was not theirs.
        approverIsOperator: approvedBy ? isOperator(approvedBy) : undefined,
        reason,
      },
      evidence,
      deployment,
    );
  } catch (err) {
    if (err instanceof LifecycleError) return { error: err.message };
    if ((err as { name?: string }).name === "TransactionCanceledException") {
      return {
        error:
          "This tenant moved while the page was open — someone else advanced it. Reload to see where it is now.",
      };
    }
    throw err;
  }

  revalidatePath(`/tenants/${slug}`);
  revalidatePath("/tenants");
  return {};
}

export interface AdoptResult {
  problems: Array<{ field: string; reason: string; detail: string }>;
}

/**
 * Bring a file-bound tenant under the engine.
 *
 * Simon OSE has been serving real students since before this control plane
 * existed. It is bound in `blueprints/` and the console lists it separately
 * because showing it beside composed tenants would imply a lifecycle it never
 * went through. This is how that stops being permanent — and the record it
 * writes says `adopted`, permanently, rather than pretending otherwise.
 */
export async function adoptTenantAction(
  _prev: AdoptResult | null,
  form: FormData,
): Promise<AdoptResult> {
  const principalId = await operator();

  const request = {
    slug: String(form.get("slug") ?? "").trim(),
    primaryContactEmail: String(form.get("primaryContactEmail") ?? "").trim(),
    residency: String(form.get("residency") ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean),
    plan: String(form.get("planId") ?? ""),
    at: now(),
  };

  // The operator confirms the institution row exists, because the engine does
  // not read tenant databases and must not claim to have checked.
  const institutionExists = form.get("institutionExists") === "on";

  if (!getPlan(request.plan)) {
    return {
      problems: [
        {
          field: "planId",
          reason: "unknown-plan",
          detail: `No plan "${request.plan}".`,
        },
      ],
    };
  }

  let built;
  try {
    built = buildAdoption(request, { institutionExists });
  } catch (err) {
    // AdoptionRefused and NotAdoptable both carry the reason in the message,
    // and both are operator-fixable — a missing check, a bad residency, a
    // binding that does not exist. Reported as form problems, not a 500.
    return {
      problems: [
        {
          field: "slug",
          reason: "refused",
          detail: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  try {
    await adoptBoundTenant(built.manifest, built.record, {
      principalId,
      at: request.at,
    });
  } catch (err) {
    if (err instanceof SlugTaken) {
      return {
        problems: [
          {
            field: "slug",
            reason: "already-registered",
            detail: `"${request.slug}" is already in the registry. Adoption is a one-time move.`,
          },
        ],
      };
    }
    throw err;
  }

  revalidatePath("/tenants");
  redirect(`/tenants/${request.slug}`);
}
