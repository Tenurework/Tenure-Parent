"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  ARCHETYPE_AXIS_VALUES,
  BLUEPRINTS,
  RESERVED_TENANT_SLUGS,
  applyModuleEdits,
  archetypeProblems,
  compileArchetype,
  getBlueprint,
  moduleEditsBetween,
  type ArchetypeSelection,
} from "@tenure/blueprints";
import { MODULE_CATALOG } from "@tenure/modules";
import { resolveModules } from "@tenure/module-runtime";
import { compareVersionStrings } from "@tenure/platform-config";
import { ENGINE_VERSION } from "@tenure/configuration";
import {
  BUSINESS_DOMAINS,
  MANIFEST_VERSION,
  getPlan,
  planFor,
  validateManifest,
  type CoexistenceProfile,
  type IsolationTier,
  type TenantManifest,
  type TenantState,
} from "@tenure/provisioning";

/* Relative, not `@/lib/…`.
 *
 * The same reason `lib/audit-ledger.ts` gives at its own import block: `@/` is a
 * per-app Next.js path mapping, and apps/web's jest — the one toolchain that
 * runs this monorepo's unit tests, `roots` reaching into apps/system-studio/src
 * — rewrites `@/` through apps/web's tsconfig at TRANSFORM time. So `@/lib/registry`
 * inside a Studio file became `apps/web/src/lib/registry`, which does not exist,
 * and this module could not be imported by a test at all. That is how
 * STUDIO-110-005 was able to ship a correct audit ledger with nothing asserting
 * that any action calls it. `lib/audit-ledger.test.ts` drives these actions for
 * real; these imports are what let it. */
import { auth } from "../../lib/auth";
import {
  authorizeCommand,
  decisionLine,
  type CommandScope,
  type StudioCommand,
} from "../../lib/authorize";
import { registryRecordFor } from "../../lib/registry-record";
import { placementFor, primeEstate } from "../../lib/cells";
import {
  SlugTaken,
  adoptBoundTenant,
  completeOperation,
  getOperation,
  getTenant,
  putOperation,
  registerTenant,
  settleIdempotency,
  tableName,
  takenSlugs,
} from "../../lib/registry";
// STUDIO-060-002 / STUDIO-130-005. The executor moved to `command-handlers` so
// that this form and `POST /api/aws/operations` run ONE lifecycle rather than
// two that agree until somebody edits one of them; the gate in front of it is
// what makes a double-submit a replay instead of a second real attempt.
import { runAdvance } from "../../lib/command-handlers";
import { gate, type RefusalCode } from "../../lib/command-gate";
import { newCorrelationId } from "../../lib/api/envelope";
import {
  AuditUnavailable,
  PLATFORM_PARTITION,
  appendIntent,
  appendOutcome,
  dynamoAuditLedger,
  safeErrorOf,
} from "../../lib/audit-ledger";
import { roleOf } from "../../lib/operators";
/* STUDIO-140-006. One import, and it is the whole high-risk gate: the typed
 * target, the digest of the consequence that was read, and the refusal of a
 * destructive AWS mutation. It lives in `lib/tenant-state` beside `riskOf`,
 * which is the function it recomputes the risk with — a second copy of that
 * computation here is the one bug the digest cannot survive, because the page
 * and the action would then be digesting two different sentences and every
 * approval-gated move would refuse. */
import { highRiskVerdict } from "../../lib/tenant-state";
import { CONFIRM_TARGET_FIELD, RISK_DIGEST_FIELD } from "../../components/states";
import { buildAdoption } from "../../lib/adopt";
import { parseObjectAuthority } from "../../lib/object-authority";

/**
 * Every action here re-decides the operator's permission, in the action.
 *
 * The pages decide too, but a server action is a POST endpoint reachable by its
 * id — rendering the page is not a precondition for calling it, so a control
 * that is absent from an Auditor's DOM is still an endpoint they can post to. A
 * guard that lives only in the page protects the page.
 *
 * STUDIO-020-006. This used to be `isOperator(email)`: a membership test with
 * no resource, no action and no scope, identical for `composeTenant` and for
 * an irreversible purge. Now each action names the command it is, and the
 * decision carries the account and region it was made in.
 */
async function authorizedOperator(
  command: StudioCommand,
  scope: Omit<CommandScope, "principalId"> = {},
): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  const decision = authorizeCommand(command, { ...scope, principalId: email });

  // STUDIO-020-012 — every allow AND every deny, with actor, effective role,
  // tenant, account, region, environment, policy revision and result.
  console.info(`[authz] ${decisionLine(email, command, decision)}`);

  if (!decision.allowed) {
    /*
     * STUDIO-110-005. The append-only destination the line above was waiting
     * for.
     *
     * A `console.info` is not an audit trail: it lives in whatever log
     * retention the cluster happens to have, it is not chained, and nobody can
     * show that it was not edited. The denial goes to the ledger as a DENY
     * carrying the reason, because a refusal is the half of the record a
     * lifecycle history can never hold — the history records what happened, and
     * a refusal by definition did not. It is also the half an incident review
     * is about: "who tried to compose a tenant here and was told no" has no
     * other source.
     *
     * On the tenant's own chain when the attempt named one, so an investigator
     * reading that tenant sees it; on PLATFORM otherwise, because an act that
     * names no tenant still names an actor and dropping it for want of a
     * partition is how the one refusal an incident is about goes unrecorded.
     */
    const subject = scope.tenantId || PLATFORM_PARTITION;
    const at = now();
    try {
      const intent = await appendIntent({
        subject,
        action: command,
        target: scope.tenantId ?? "the estate",
        actor: email ?? "unauthenticated",
        at,
        detail: `${command} attempted without permission.`,
      });
      await appendOutcome({
        subject,
        resolves: intent.seq,
        action: command,
        target: scope.tenantId ?? "the estate",
        actor: email ?? "unauthenticated",
        at: now(),
        outcome: "REFUSED_NOT_PERMITTED",
        detail: `Refused: ${decision.reason}`,
      });
    } catch (err) {
      // A refusal that could not be recorded is still a refusal — nothing
      // happened, so there is nothing unrecorded that DID happen. Only the
      // ledger's own unavailability is swallowed, so a broken store cannot turn
      // a 404 into a 500 that confirms the endpoint exists.
      if (!(err instanceof AuditUnavailable)) throw err;
    }

    // 404-shaped, like the rest of the console: the existence of an endpoint
    // that provisions tenants is not something to confirm to a stranger, and
    // the reason is in the ledger rather than in the response.
    throw new Error("Not found");
  }
  return email!;
}

const now = () => new Date().toISOString();

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
  const principalId = await authorizedOperator("tenants.compose");

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

  // WRK-020-004. The refinement below the domain grain: which objects inside a
  // domain move, in which direction, and which of their fields the other side
  // writes. Parsed for shape here and refused for meaning by
  // `coexistenceProblems` inside `validateManifest` — an object claiming Tenure
  // inside a domain the customer's ERP owns is refused there, not here, so the
  // console cannot accept a manifest under looser rules than the executor.
  const objectAuthority = parseObjectAuthority(
    String(form.get("objectAuthority") ?? ""),
  );

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
    // Omitted rather than written as `[]` when nothing was typed. An empty list
    // and no list read the same to a validator and differently to a person: the
    // manifest is diffed, and "no object-level refinement" should not appear as
    // a field somebody filled in.
    objectAuthority:
      objectAuthority.entries.length > 0 ? objectAuthority.entries : undefined,
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

  /*
   * STUDIO-110-005 / STUDIO-060-010. Composition, recorded before it is decided.
   *
   * The intent goes down here — after the manifest is assembled from the form,
   * before a single check has run and long before `registerTenant` writes
   * anything. That ordering is the requirement: a process that dies between
   * these two lines leaves "somebody began composing rochester and we cannot say
   * how it ended", where an outcome-only trail leaves silence, which is
   * indistinguishable from nobody having tried.
   *
   * The chain is the TENANT's, keyed on the slug that was asked for, so the
   * composition is the first record of the tenant it creates rather than a
   * platform-level footnote about it. A composition with no slug at all belongs
   * to nobody, and PLATFORM is where acts that name no tenant go — dropping it
   * would mean the one class of attempt that never registers anything is also
   * the one class that leaves no trace.
   *
   * Fail-closed, deliberately: `appended` throws `AuditUnavailable` and nothing
   * catches it here, so an unreachable ledger stops the composition instead of
   * letting a tenant be registered with no record that anyone asked for it.
   */
  const at = now();
  const subject = manifest.slug || PLATFORM_PARTITION;
  const intent = await appendIntent({
    subject,
    action: "tenants.compose",
    target: manifest.slug || "(no slug)",
    actor: principalId,
    at,
    detail:
      `Compose ${manifest.displayName || manifest.slug || "(unnamed)"} on plan ${planId || "(none)"}, ` +
      `blueprint ${manifest.blueprintId || "(none)"}, ${manifest.isolation} in ${manifest.region || "(no region)"}, ` +
      `${manifest.modules.length} module(s).`,
  });

  /** Close the intent, then hand the caller the problems that closed it. */
  const refuse = async (
    code: string,
    problems: ComposeResult["problems"],
  ): Promise<ComposeResult> => {
    await appendOutcome({
      subject,
      resolves: intent.seq,
      action: "tenants.compose",
      target: manifest.slug || "(no slug)",
      actor: principalId,
      at: now(),
      outcome: code,
      // The reasons, not just the count: "refused" tells an investigator
      // nothing, and the field-level detail is what says whether this was an
      // operator's typo or an entitlement the contract does not grant.
      detail: problems.map((p) => `${p.field}: ${p.reason}`).join("; ") || code,
    });
    return { problems };
  };

  const { valid, problems } = validateManifest(manifest, {
    // Every blueprint in the catalog, not the ones somebody is already bound
    // to. The distinct `blueprintId`s of the bindings had the same two defects
    // here that `tenants/new/page.tsx` documents at its own call site:
    // `corporate-divisions` exists and has no binding, so a manifest naming it
    // was rejected as unknown — a blueprint nobody had used yet was one nobody
    // could use — and the bindings carry the fixtures.
    knownBlueprints: BLUEPRINTS.map((b) => b.id),
    knownModules: MODULE_CATALOG.keys(),
    // The closed axis table, from the engine that will compile the composition.
    // Passing nothing would make every axis value acceptable.
    archetypeAxes: ARCHETYPE_AXIS_VALUES,
    // Both sources of truth for an existing slug: registered tenants, and the
    // file-based bindings that predate the registry. Missing the second would
    // let someone register "rochester" over the live pilot.
    takenSlugs: [...(await takenSlugs()), ...RESERVED_TENANT_SLUGS],
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
    entitlementProblems.length > 0 ||
    objectAuthority.problems.length > 0
  ) {
    return refuse("REFUSED_INVALID_COMPOSITION", [
      ...problems,
      ...editProblems,
      ...moduleProblems,
      ...planProblems,
      ...entitlementProblems,
      // A line that did not parse is not silently dropped. Dropping it would
      // register a tenant whose declaration is quietly shorter than what the
      // operator wrote, which is the difference between a refusal they can
      // fix and a coexistence contract nobody knows is missing.
      ...objectAuthority.problems,
    ]);
  }

  // STUDIO-000-006 / GE-010-007. `placementFor` below reaches `fleet()`, which
  // THROWS `FleetMisconfigured` rather than defaulting to `us-east-1` and a
  // literal account. `primeEstate()` resolves the real identity once per
  // process. `adoptTenant` already awaits it for exactly this reason (see
  // below); compose did not, so which of the two paths worked depended on
  // whether some page had happened to prime the process first — and an
  // unprimed compose died inside the try, wrote a FAILED outcome and 500'd
  // the operator instead of placing the tenant.
  await primeEstate();

  try {
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
    // GE-101-001. The isolation tier the operator composed is passed through,
    // so the shape the tenant contracted decides which policy gates the cell
    // has to satisfy. A silo tenant on a fleet that does not publish which
    // shapes it can provide is refused rather than quietly placed on a shared
    // cell — which is what it got before, at silo prices.
    const placement = placementFor(
      {
        tenantId: manifest.slug,
        residency: [manifest.region],
        environment: (process.env.DEPLOY_ENVIRONMENT ??
          "production") as "production",
      },
      { isolation: manifest.isolation },
    );
    if (!placement.cellId) {
      // Reported as a form problem rather than a 500, and with the reason: "no
      // cell may legally hold this tenant" and "every cell is full" are the
      // same outcome and completely different problems.
      return refuse("REFUSED_NO_PLACEMENT", [
          {
            field: "region",
            reason: placement.reason,
            detail:
              placement.reason === "policy-refused"
                ? // GE-101-003. The decision already carries a sentence per gate
                  // that did not pass, naming what was demanded and what was
                  // observed — or why it could not be observed. Rendering the
                  // gate names alone would send an operator to read the policy
                  // to find out what its answer meant.
                  `No cell may take a ${manifest.isolation} tenant under the placement policy. ` +
                  placement.policy.explanation.join(" ")
                : placement.reason === "no-cell-in-residency"
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
      ]);
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
      return refuse("REFUSED_SLUG_TAKEN", [
        {
          field: "slug",
          reason: "taken",
          detail: `"${manifest.slug}" was registered a moment ago.`,
        },
      ]);
    }
    // Closed as FAILED rather than left open, and rethrown unchanged. An
    // exception is the one exit that would otherwise leave an intent nobody
    // resolved, which reads on the audit page as a composition still in flight.
    await appendOutcome({
      subject,
      resolves: intent.seq,
      action: "tenants.compose",
      target: manifest.slug,
      actor: principalId,
      at: now(),
      outcome: "FAILED",
      detail: safeErrorOf(err),
    });
    throw err;
  }

  /*
   * Closed BEFORE the redirect, not after.
   *
   * `redirect()` works by throwing, so anything below it never runs — an
   * outcome row written after the redirect would be written on exactly no
   * successful composition, and the trail would show every success as an
   * unresolved intent while every refusal closed correctly.
   */
  await appendOutcome({
    subject,
    resolves: intent.seq,
    action: "tenants.compose",
    target: manifest.slug,
    actor: principalId,
    at: now(),
    outcome: "APPLIED",
    detail: `Registered ${manifest.slug} in DRAFT on plan ${planId}.`,
  });

  revalidatePath("/tenants");
  redirect(`/tenants/${manifest.slug}`);
}

export interface AdvanceResult {
  error?: string;
  /** The durable operation this dispatch created or replayed. */
  operationId?: string;
  /** True when the idempotency key had already been used for this same request. */
  replayed?: boolean;
  /** Which gate refused, so a UI can tell a conflict from a denial. */
  refusalCode?: RefusalCode;
}

/** What a lifecycle command carries. Named so the gate is typed over it. */
export interface AdvancePayload {
  to: string;
  approvedBy: string | null;
  ownerPrincipalId: string | null;
  reason: string | null;
  /** The operator's real address. `context.actorId` cannot hold an `@`. */
  actorEmail: string;
}

/**
 * Move a tenant one state along.
 *
 * STUDIO-060-002 / STUDIO-130-005. Three things happen before any work does,
 * and the order is the point:
 *
 *   1. `gate()` runs every execution-time check there is — the command's own
 *      shape, semantic authorization, the version and digest the approver was
 *      looking at, the cost band, and an idempotency claim. A double-submit
 *      never reaches the executor; it returns the first operation.
 *   2. An OPERATION row is written BEFORE the executor starts, so a browser
 *      that gives up on a slow cell leaves a durable, queryable record instead
 *      of an unknowable outcome.
 *   3. Only then does `runAdvance` do the work, and the operation is closed
 *      with what happened.
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
  const slug = String(form.get("slug") ?? "");

  // STUDIO-020-006, in two decisions rather than one.
  //
  // This one is `tenant.lifecycle:write` at the control plane's own scope, and
  // it runs before the registry is read at all — an Auditor/Read Only operator
  // who posts to this action's id is refused here, having learned nothing about
  // whether the tenant exists. The second is inside `gate` below, which asks
  // `authorizeCommand` the same question again with the account and region the
  // registry says this tenant is actually placed in.
  const principalId = await authorizedOperator("tenant.lifecycle.advance", {
    tenantId: slug,
  });

  const to = String(form.get("to") ?? "") as TenantState;
  const approvedBy = String(form.get("approvedBy") ?? "").trim() || undefined;
  // WRK-120-005. Who answers for the tenant after the move — the successor, not
  // the departing owner. The engine refuses SUSPENDING, HIBERNATING and
  // OFFBOARDING without one, so this is passed through rather than defaulted:
  // defaulting it to the requesting operator would satisfy the check by naming
  // whoever happened to click, which is how an orphan gets an owner on paper.
  const ownerPrincipalId =
    String(form.get("ownerPrincipalId") ?? "").trim() || undefined;
  const reason = String(form.get("reason") ?? "").trim() || undefined;
  // Minted by the confirmation UI when it renders, so a double-click reuses it
  // and a fresh page mints a new one. Absent is refused by `parseCommand`
  // rather than defaulted — a key generated here would make every submission
  // unique, which is the same as having no idempotency at all.
  const idempotencyKey = String(form.get("idempotencyKey") ?? "").trim();
  const expectedVersionRaw = String(form.get("expectedVersion") ?? "").trim();
  const expectedDigest = String(form.get("expectedDigest") ?? "").trim() || null;

  const at = now();

  const tenant = await getTenant(slug);
  if (!tenant) return { error: `No tenant "${slug}".` };

  const operationId = `op-${globalThis.crypto.randomUUID().replace(/-/g, "")}`;
  const target = `${tenant.state} -> ${to}`;

  /*
   * Recorded BEFORE anything is decided, and fail-closed. An action that cannot
   * be audited is an action nobody can answer for, so an unreachable ledger
   * stops the move rather than letting it happen unrecorded. Every exit below
   * resolves this row — including the refusals, especially the refusals, which
   * are the half a lifecycle STEP# row has never carried.
   *
   * `dynamoAuditLedger()` is the Studio's own chain (STUDIO-110-005): every
   * record carries its content hash and the hash of the record before it, and
   * `putAuditRow` claims its position with a conditional write, so a refusal
   * cannot be quietly dropped and a sequence cannot be silently reused. This is
   * its first production caller.
   */
  const ledger = dynamoAuditLedger();
  const correlationId = `adv-${operationId}`;
  const intent = await ledger.append({
    tenantId: slug,
    actor: { principalId, role: roleOf(principalId) ?? undefined },
    action: "Tenant.Advance",
    resourceType: "Tenant",
    resourceId: slug,
    outcome: "ALLOW",
    reason: reason ?? "no reason given",
    metadata: { phase: "INTENT", target, operationId },
    correlationId,
    occurredAt: at,
  });

  /**
   * Close the intent with what actually happened.
   *
   * `ALLOW` only for the move that ran; every refusal is a `DENY` carrying the
   * code, so "how often was this refused, and for what" is a scan of one field
   * rather than a grep over prose.
   */
  const resolve = async (code: string, detail: string): Promise<void> => {
    await ledger.append({
      tenantId: slug,
      actor: { principalId, role: roleOf(principalId) ?? undefined },
      action: "Tenant.Advance",
      resourceType: "Tenant",
      resourceId: slug,
      outcome: code === "APPLIED" ? "ALLOW" : "DENY",
      reason: detail,
      metadata: {
        phase: "OUTCOME",
        code,
        target,
        operationId,
        intentSequence: intent.sequence,
      },
      correlationId,
      occurredAt: now(),
    });
  };

  // STUDIO-140-006. The three refusals this action owns, decided in one place
  // and BEFORE the command gate, so a destructive AWS mutation or a stale
  // consequence never reaches the executor at all.
  //
  // The consequence the operator READ is the consequence that executes:
  // `highRiskVerdict` recomputes the risk from the lifecycle graph and the
  // tenant's own record — never from the form — and compares the digest the
  // page rendered against it. Between the page rendering and the button being
  // pressed another operator can move the tenant, or a residual reconciliation
  // can turn "reversible" into IRREVERSIBLE, and the panel on screen becomes a
  // description of something else.
  //
  // It is a function rather than three inline blocks because a refusal that can
  // only be reached through an authenticated session and a live registry is a
  // refusal nothing can prove. `e2e/high-risk-fails-closed.spec.ts` drives all
  // five arms — these three plus the two the lifecycle engine owns — and
  // asserts on THIS FILE that the call is here, ahead of `gate`, and that its
  // answer is what the operator is told.
  const verdict = highRiskVerdict({
    slug,
    from: tenant.state,
    to,
    isolation: tenant.manifest.isolation,
    hasDeployment: tenant.deployment !== undefined,
    serving: tenant.deployment?.serving === true,
    evidenceRecords: tenant.evidence.length,
    tenantTable: tableName(),
    reason: reason ?? "no reason given",
    typed: String(form.get(CONFIRM_TARGET_FIELD) ?? "").trim(),
    submittedDigest: String(form.get(RISK_DIGEST_FIELD) ?? "").trim(),
    auditSequence: intent.sequence,
  });
  // Live. This was `if (false && verdict)` — the high-risk gate short-circuited
  // to unreachable, which is not a weaker check but no check: STUDIO-140-006 is
  // what refuses a destructive AWS mutation whose consequence the operator was
  // never shown, and it read the confirmation target and the digest of the risk
  // sentence to do it. The three `'verdict' is possibly null` type errors were
  // the symptom — with the branch dead, `verdict` was never narrowed — so the
  // compiler was reporting the disabled guard rather than a typing problem.
  if (verdict) {
    await resolve(verdict.code, verdict.detail);
    return { error: verdict.detail };
  }

  const outcome = await gate<AdvancePayload>(
    {
      commandId: `cmd-${globalThis.crypto.randomUUID().replace(/-/g, "")}`,
      context: {
        tenantId: slug,
        // The contract's identifier grammar has no `@`, so the address is
        // carried in the payload and the principal is spelled with a colon.
        // Losing the identity to satisfy a regex would be the wrong trade; so
        // would loosening the contract for one caller.
        actorId: principalId.replace("@", ":"),
        actorKind: "user",
        channel: "system-studio-form",
        correlationId: newCorrelationId(),
        configRevision: String(tenant.registry?.configRevision ?? 0),
        // Test unless the deployment says otherwise. A mode that cannot be
        // established is not evidence that real money may move.
        environment: process.env.PAYMENT_MODE === "live" ? "live" : "test",
        legalEntityId: null,
        at,
      },
      action: "Tenant.Advance",
      resourceType: "Tenant",
      resourceId: slug,
      // Omitted rather than defaulted when the form did not carry one, so
      // `parseCommand` refuses it. A default of `null` would mean "this is a
      // create" and would skip the concurrency check entirely.
      ...(expectedVersionRaw === "" ? {} : { expectedVersion: Number(expectedVersionRaw) }),
      idempotencyKey,
      effectiveAt: at,
      payload: {
        to,
        approvedBy: approvedBy ?? null,
        ownerPrincipalId: ownerPrincipalId ?? null,
        reason: reason ?? null,
        actorEmail: principalId,
      },
    },
    {
      actor: principalId,
      command: "tenant.lifecycle.advance",
      // The cell this tenant is actually placed in, so a tenant outside this
      // control plane's account or region is refused here rather than by the
      // SDK. Omitted for a tenant with no registry record — the decision then
      // falls back to this control plane's own identity, which is where an
      // unplaced tenant is.
      placement: tenant.registry
        ? { region: tenant.registry.placement.region }
        : undefined,
      current: async () => ({ version: tenant.history.length, digest: tenant.digest }),
      expectedDigest,
      // STUDIO-120-010, enforced rather than merely published. Assessed on the
      // RECURRING MONTHLY commitment the plan states, and only for the step
      // that actually stands infrastructure up — a threshold applied to every
      // transition would ask for one commitment to be approved four times.
      recurringMonthly:
        to === "PROVISIONING"
          ? {
              minorUnits: planFor(tenant.manifest).estimatedMonthlyCostCents,
              currency: "USD",
              change: `Provisioning ${slug} (${tenant.manifest.isolation})`,
            }
          : null,
      approvedBy: approvedBy ?? null,
      operationId,
    },
  );

  if (outcome.kind === "refused") {
    await resolve(outcome.refusal.code.toUpperCase(), outcome.refusal.detail);
    return { error: outcome.refusal.detail, refusalCode: outcome.refusal.code };
  }

  if (outcome.kind === "replay") {
    // The same key and the same request. The first attempt is the answer, and
    // returning it is the whole difference between idempotency and a race
    // message: nothing runs twice, and the caller is told which operation
    // theirs was.
    const first = await getOperation(slug, outcome.replay.operationId);
    await resolve(
      "REPLAYED",
      `Idempotency key already used for this exact request; operation ${outcome.replay.operationId} is the answer.`,
    );
    return {
      operationId: outcome.replay.operationId,
      replayed: true,
      ...(first?.state === "FAILED"
        ? { error: first.lastError ?? "The first attempt failed." }
        : {}),
    };
  }

  // The record, before the work. STUDIO-130-005.
  await putOperation({
    operationId,
    slug,
    state: "ACCEPTED",
    commandType: outcome.command.action,
    target: to,
    actor: principalId,
    requestedAt: at,
    completedAt: null,
    idempotencyKey,
    correlationId: outcome.command.context.correlationId,
    lastError: null,
    approval: outcome.approval,
  });

  const result = await runAdvance({
    slug,
    to,
    principalId,
    at,
    approvedBy,
    ownerPrincipalId,
    reason,
    // STUDIO-060-007. What the operator typed, forwarded to the change-class
    // gate. The gate compares it with `===` against the token
    // `requirementsFor` produces for this move's class, so a C6 or C7 move
    // submitted with nothing typed is refused there even if it reached this
    // action by a POST that never rendered the panel.
    confirmation: String(form.get(CONFIRM_TARGET_FIELD) ?? "").trim(),
  });

  await completeOperation(slug, operationId, {
    state: result.ok ? "SUCCEEDED" : "FAILED",
    completedAt: now(),
    lastError: result.ok ? null : result.error,
  });
  await settleIdempotency(slug, idempotencyKey, result.ok ? "succeeded" : "failed", operationId);
  await resolve(
    result.ok ? "APPLIED" : "FAILED",
    result.ok ? `${result.detail} (operation ${operationId})` : result.error,
  );

  /*
   * Only when something moved.
   *
   * `revalidatePath` on a REFUSAL threw the refusal away. The reason lives in
   * `useActionState`, and revalidating re-renders the route, remounts
   * `AdvanceControls` and takes that state with it — so an operator who was
   * refused saw the button sit on "Moving…", no message, and a tenant that had
   * not moved. The one thing they had to be told was the one thing the refresh
   * discarded, and it was the refusals reached through the change-class gate
   * and the lifecycle engine — a second identity, an approver nobody knows —
   * which is to say the controls whose whole job is to say no out loud.
   *
   * GE-032-003 is the open finding that records the same mechanism on the
   * configuration editor, where what it swallows is a confirmation. This is the
   * same mechanism on a path where what it swallows is a denial.
   *
   * Nothing about the tenant changed when it was refused, so there is nothing
   * to re-read. The operation record and the ledger row this attempt DID write
   * are on screen the next time the page is loaded, which is exactly when
   * somebody is looking for them.
   */
  if (result.ok) {
    revalidatePath(`/tenants/${slug}`);
    revalidatePath("/tenants");
  }

  if (!result.ok) return { error: result.error, operationId };
  return { operationId };
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
  const principalId = await authorizedOperator("tenants.adopt");

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

  /*
   * STUDIO-110-005 / STUDIO-060-010. Adoption, recorded before it is decided.
   *
   * Adoption is the single most consequential act in this console: it takes a
   * tenant that has been serving real students since before the control plane
   * existed and brings it under an engine that can advance its lifecycle. It is
   * also one-way. Recording only the successes would leave the interesting
   * question — who tried to adopt the live pilot, and on whose say-so — with no
   * answer at all, and the `ADOPTED#` registry row it writes is a history rather
   * than an audit trail: it appears only when the adoption worked.
   *
   * On the adopted tenant's own chain, keyed on its slug, so this is the first
   * record of it under the engine.
   */
  const subject = request.slug || PLATFORM_PARTITION;
  const intent = await appendIntent({
    subject,
    action: "tenants.adopt",
    target: request.slug || "(no slug)",
    actor: principalId,
    at: request.at,
    detail:
      `Adopt bound tenant ${request.slug || "(no slug)"} on plan ${request.plan || "(none)"}, ` +
      `residency ${request.residency.join("/") || "(none)"}, ` +
      `institution row confirmed by the operator: ${institutionExists}.`,
  });

  const refuse = async (
    code: string,
    problems: AdoptResult["problems"],
  ): Promise<AdoptResult> => {
    await appendOutcome({
      subject,
      resolves: intent.seq,
      action: "tenants.adopt",
      target: request.slug || "(no slug)",
      actor: principalId,
      at: now(),
      outcome: code,
      detail: problems.map((p) => `${p.field}: ${p.reason}`).join("; ") || code,
    });
    return { problems };
  };

  if (!getPlan(request.plan)) {
    return refuse("REFUSED_UNKNOWN_PLAN", [
      {
        field: "planId",
        reason: "unknown-plan",
        detail: `No plan "${request.plan}".`,
      },
    ]);
  }

  // STUDIO-000-006. `buildAdoption` reaches `fleet()` (lib/adopt.ts:84,194,242),
  // which now THROWS `FleetMisconfigured` rather than defaulting to `us-east-1`
  // and a literal account. `primeEstate()` resolves the real identity once per
  // process; without it every adoption fails on an estate nobody configured,
  // and the catch below would report a platform misconfiguration to the
  // operator as if it were a bad form field.
  await primeEstate();

  let built;
  try {
    built = buildAdoption(request, { institutionExists });
  } catch (err) {
    // AdoptionRefused and NotAdoptable both carry the reason in the message,
    // and both are operator-fixable — a missing check, a bad residency, a
    // binding that does not exist. Reported as form problems, not a 500.
    return refuse("REFUSED_NOT_ADOPTABLE", [
      {
        field: "slug",
        reason: "refused",
        detail: err instanceof Error ? err.message : String(err),
      },
    ]);
  }

  try {
    await adoptBoundTenant(built.manifest, built.record, {
      principalId,
      at: request.at,
    });
  } catch (err) {
    if (err instanceof SlugTaken) {
      return refuse("REFUSED_ALREADY_REGISTERED", [
        {
          field: "slug",
          reason: "already-registered",
          detail: `"${request.slug}" is already in the registry. Adoption is a one-time move.`,
        },
      ]);
    }
    await appendOutcome({
      subject,
      resolves: intent.seq,
      action: "tenants.adopt",
      target: request.slug,
      actor: principalId,
      at: now(),
      outcome: "FAILED",
      detail: safeErrorOf(err),
    });
    throw err;
  }

  // Before the redirect, which throws. See `composeTenant`.
  await appendOutcome({
    subject,
    resolves: intent.seq,
    action: "tenants.adopt",
    target: request.slug,
    actor: principalId,
    at: now(),
    outcome: "APPLIED",
    detail: `Adopted ${request.slug} on plan ${request.plan}.`,
  });

  revalidatePath("/tenants");
  redirect(`/tenants/${request.slug}`);
}
