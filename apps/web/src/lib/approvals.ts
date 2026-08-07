import { createHash } from "node:crypto";

import type { ApprovalStatus, ApprovalType, OrgStatus } from "@prisma/client";
import {
  mayDecide,
  type ControlOutcome,
  type ControlWorld,
  type ISODate,
} from "@tenure/authorization";
import {
  applyAction,
  availableActions as engineActions,
} from "@tenure/workflow";
import {
  APPROVAL_THRESHOLDS_KEY,
  resolveSystemConfig,
} from "@tenure/platform-config";

import { acceptsWrites, canManageRoster, isOse, isOseDirector, type UserContext } from "@/lib/rbac";
import {
  APPROVAL_ROLES,
  APPROVAL_WORKFLOW,
} from "@/lib/workflows/approval-definition";

/**
 * Approval state machine (blueprint §Approvals):
 *
 *   DRAFT ──submit──▶ PENDING_PRESIDENT ──approve──▶ PENDING_OSE ──approve──▶ APPROVED
 *                        │        ▲                     │
 *                        │        └──resubmit── NEEDS_CHANGES ◀──changes──┘
 *                        └──reject──▶ REJECTED  (either gate may reject)
 *
 *   Requester may cancel while DRAFT / PENDING_* / NEEDS_CHANGES.
 *   A president's own request skips their gate: submit → PENDING_OSE.
 *   Neither gate is held by the person who raised the request — see
 *   `decisionControl`. That is what stops the gate-skip above from leaving a
 *   request with no second human on it at all.
 */

export type ApprovalActionName =
  "submit" | "approve" | "request_changes" | "reject" | "resubmit" | "cancel";

export interface ApprovalView {
  id: string;
  status: ApprovalStatus;
  submittedById: string;
  /**
   * PAY-150-003. Who PREPARED this request, when that is somebody other than
   * the submitter — null when it is not.
   *
   * Required rather than optional, and for the reason `amountMinorUnits` below
   * is: `mayDecide`'s SAME_MAKER arm — the maker-checker control this platform
   * claims — reads `preparedByPrincipalId`, and a producer that quietly omitted
   * it would hand the preparer the gate on their own work while `tsc` stayed
   * silent.
   */
  preparedById: string | null;
  organizationId: string;
  institutionId: string;
  /**
   * PAY-150-003. The standing declarations in force for the ACTOR on THIS
   * request, from `standingDeclarationsFor` (src/lib/approvals-world.ts).
   *
   * Carried on the view rather than fetched inside `decisionControl` because
   * `availableActions` is synchronous and is called from render paths that
   * cannot await. Required for the same reason as everything else here: an
   * optional field would default the RECUSED and DECLARED_CONFLICT arms back
   * off, silently, which is the state it replaced. A caller that genuinely has
   * none passes `NO_STANDING_DECLARATIONS`, which is a decision rather than an
   * omission.
   */
  controlWorld: ControlWorld;
  /**
   * The club's lifecycle status, carried on the view because the approval
   * actions are writes and an archived club takes none of them. Required
   * rather than optional so a new producer of this view has to answer the
   * question rather than inherit a default that silently re-opens the hole.
   */
  organizationStatus: OrgStatus;
  /**
   * PAY-150-002 — how much money this request moves, in the minor units of
   * `currency`. `null` when it moves none (an event proposal, a roster change).
   *
   * Required rather than optional, and that is the whole point of the field.
   * Approval authority was role-shaped and blind to money: a $5 request and a
   * $500,000 request took the identical two gates, because the amount was
   * collected into an untyped `metadata` blob and no authority code ever read
   * it back. An OPTIONAL field here would compile at every producer that
   * forgot it and silently resolve to "no money", which is exactly the shape of
   * outage this codebase has already had twice. Declared required, `tsc` makes
   * every producer answer.
   */
  amountMinorUnits: number | null;
  /**
   * ISO 4217, uppercase. Required even when the amount is null, because a
   * threshold is only meaningful against a currency: comparing 1000 minor units
   * of JPY to a USD ladder is comparing ¥1,000 to $5,000 as though they were
   * the same number.
   */
  currency: string;
  /**
   * Does the person who RAISED this hold the club's active president seat?
   *
   * A fact about the submitter, not about whoever is looking, which is why it
   * travels on the view rather than being derived from `ctx`: a page rendering
   * for an OSE reviewer cannot see the requester's seats. It is the condition
   * the submit/resubmit gate-skip is split on, and passing a guessed value into
   * the engine would be asserting something this call site does not know.
   */
  requesterIsPresident: boolean;
}

/** The money a request moves, resolved from what the request actually carries. */
export interface ApprovalMoney {
  amountMinorUnits: number | null;
  currency: string;
}

/**
 * PAY-150-002 — the priced ladder this institution's ordinary gate may pass.
 *
 * Keyed by ISO 4217 code, valued in that currency's minor units. Resolved from
 * `platform.payments.approvalThresholds` through the configuration engine, so
 * an institution that wants a $1,000 ceiling gets one by publishing a tenant
 * layer rather than by anyone editing this file.
 */
export interface ApprovalAuthority {
  thresholds: Readonly<Record<string, number>>;
}

/**
 * The ladder for one institution, by the slug configuration is keyed by.
 *
 * Synchronous, which is what lets `availableActions` stay synchronous and
 * therefore usable from a render as well as from a server action. The id→slug
 * bridge is the caller's (`institutionSlugFor` in lib/config/server.ts); this
 * function does no I/O.
 */
export function approvalAuthorityFor(institutionSlug: string): ApprovalAuthority {
  return {
    thresholds: resolveSystemConfig(institutionSlug).get<Record<string, number>>(
      APPROVAL_THRESHOLDS_KEY,
    ),
  };
}

/**
 * Does this request need more than the ordinary gate?
 *
 * Two deliberate answers that are not "compare the numbers":
 *
 *   * A request with no amount never exceeds anything. An event proposal is
 *     not a large payment.
 *   * A currency the ladder does not price exceeds it. Fail-closed, because
 *     the alternative is that publishing an invoice in a currency nobody has
 *     set a ceiling for is the way around every ceiling. Dropping `currency`
 *     from this comparison — comparing the bare minor-unit integers — makes
 *     ¥1,000 look 100× smaller than $1,000 and lets it through.
 */
export function exceedsApprovalThreshold(
  money: ApprovalMoney,
  authority: ApprovalAuthority,
): boolean {
  if (money.amountMinorUnits === null) return false;
  const ceiling = authority.thresholds[money.currency];
  if (typeof ceiling !== "number") return true;
  return money.amountMinorUnits > ceiling;
}

const CURRENCY_CODE = /^[A-Z]{3}$/;

/** Minor-unit exponent for a currency. JPY has 0, KWD has 3, USD has 2. */
const MINOR_UNIT_DIGITS = new Map<string, number>();
function minorUnitDigits(currency: string): number {
  const cached = MINOR_UNIT_DIGITS.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat("en-US", { style: "currency", currency })
        .resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // An unknown code: two digits is the commonest shape, and the threshold
    // comparison fails closed on an unpriced currency anyway.
    digits = 2;
  }
  MINOR_UNIT_DIGITS.set(currency, digits);
  return digits;
}

/**
 * A written amount ("1,200.50", "$50") as integer minor units of `currency`.
 *
 * Digit arithmetic on the string rather than `Number(text) * 100`, which is
 * where `19.99 * 100 = 1998.9999999999998` comes from — a rounding error that
 * lands one minor unit either side of a threshold is a rounding error that
 * decides who may approve.
 */
export function toMinorUnits(text: string, currency: string): number | null {
  const cleaned = text.trim().replace(/[\s,]/g, "").replace(/^[$£€¥]/, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const digits = minorUnitDigits(currency);
  const negative = cleaned.startsWith("-");
  const [whole, fraction = ""] = cleaned.replace(/^-/, "").split(".");
  const kept = (fraction + "0".repeat(digits)).slice(0, digits);
  const roundUp =
    fraction.length > digits && Number(fraction[digits]) >= 5 ? 1 : 0;
  const minor = Number(whole) * 10 ** digits + Number(kept || "0") + roundUp;
  return negative ? -minor : minor;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The money a request carries, read out of `ApprovalRequest.metadata`.
 *
 * One parser, called by every producer of an `ApprovalView`, rather than each
 * call site casting the Json column to whatever shape it happens to expect.
 * Three shapes are written today and all three are read here: the reimbursement
 * leg (`reimbursement.amountCents`), a typed minor-unit field, and the free-text
 * `amount` a requester types into the general form.
 *
 * `fallbackCurrency` is the institution's configured currency
 * (`platform.localization.currency`), used when the row does not name one —
 * every row written before this parameter existed is in that position.
 */
export function approvalMoney(
  metadata: unknown,
  fallbackCurrency: string,
): ApprovalMoney {
  const meta = asRecord(metadata);
  const declared =
    typeof meta.currency === "string" ? meta.currency.toUpperCase() : "";
  const currency = CURRENCY_CODE.test(declared)
    ? declared
    : fallbackCurrency.toUpperCase();

  const reimbursement = asRecord(meta.reimbursement);
  const cents = reimbursement.amountCents;
  if (typeof cents === "number" && Number.isFinite(cents)) {
    return { amountMinorUnits: Math.round(cents), currency };
  }

  const typed = meta.amountMinorUnits;
  if (typeof typed === "number" && Number.isFinite(typed)) {
    return { amountMinorUnits: Math.round(typed), currency };
  }

  const written = meta.amount;
  if (typeof written === "string" || typeof written === "number") {
    const minor = toMinorUnits(String(written), currency);
    if (minor !== null) return { amountMinorUnits: minor, currency };
  }

  return { amountMinorUnits: null, currency };
}

/**
 * PAY-150-003 — the standing declarations that apply to nobody.
 *
 * Still exported, and still the right answer for a caller that genuinely has
 * none: a list page rendering fifty rows will not run fifty declaration
 * queries, and for a reader who is not deciding anything the world changes no
 * answer. What is no longer true is that it is the ONLY world: a request being
 * DECIDED goes through `standingDeclarationsFor`
 * (src/lib/approvals-world.ts), which reads the ConflictDeclaration and Recusal
 * rows the schema now has.
 */
export const NO_STANDING_DECLARATIONS: ControlWorld = {};

/**
 * May this actor DECIDE this request, rather than merely having raised it?
 *
 * The rule is not re-implemented here. `mayDecide` in `@tenure/authorization`
 * is the platform's decision gate — self-approval, maker-checker, recusal,
 * declared conflicts, four-eyes across gates and the duties matrix, each
 * returning a named refusal instead of a bare boolean. It shipped with zero
 * callers in the app, which is the only reason this hole was open: an OSE
 * member who raised a request was still handed the OSE gate on it, so one
 * person could carry their own request from DRAFT to APPROVED with no second
 * human. (A president's own request already skips the president gate, so the
 * OSE gate was the only remaining pair of eyes.)
 *
 * `at` is a parameter rather than a fixed instant because the conflict arm is
 * time-bounded: a declaration whose window has not opened, or has closed,
 * changes no answer, and `standingDeclarationsFor` filters on the same instant
 * before the world ever gets here.
 *
 * PAY-150-003. Two of `mayDecide`'s arms used to be unreachable for every
 * request in the product, and this is where both were lost:
 * `preparedByPrincipalId` was never supplied, so SAME_MAKER — the actual
 * maker-checker control — could not fire; and the world was a hardcoded `{}`,
 * so RECUSED and DECLARED_CONFLICT could not either.
 */
export function decisionControl(
  ctx: UserContext,
  approval: ApprovalView,
  at: ISODate = new Date().toISOString(),
): ControlOutcome {
  return mayDecide(
    ctx.userId,
    {
      resourceId: approval.id,
      tenantId: approval.institutionId,
      raisedByPrincipalId: approval.submittedById,
      preparedByPrincipalId: approval.preparedById,
      // What this decision TOUCHES, which is what a declared interest is
      // matched against. The club the request belongs to is the subject every
      // request has; the world already holds only this principal's in-force
      // declarations, so naming it here is what turns one of them into a
      // refusal. Passing nothing left the DECLARED_CONFLICT arm unreachable
      // even once the declarations were loaded — `subjects` would be empty and
      // `subjects.has(...)` false for every one of them.
      subjectIds: [approval.organizationId],
    },
    approval.controlWorld,
    at,
  );
}

/**
 * Role the actor plays for THIS request.
 *
 * The two gate roles are per-request standing, not standing facts about the
 * person: holding the president seat, or an institution membership, is what
 * makes you eligible for a gate, and `decisionControl` is what says whether you
 * hold it on THIS request. Deciding it here rather than in `availableActions`
 * puts the answer in the one place every reader of these roles already goes
 * through, so a caller cannot pick up `isOseGate` and act on it without the
 * control having run.
 */
export function actorRoles(ctx: UserContext, approval: ApprovalView) {
  const org = {
    id: approval.organizationId,
    institutionId: approval.institutionId,
    status: approval.organizationStatus,
  };
  // Roles are additive and the workflow engine matches them with `some()`, so
  // a disqualifier cannot be expressed as another role — it has to remove the
  // gate role itself, or being the requester would simply be one more role
  // alongside the one that approves.
  const mayGate = decisionControl(ctx, approval).ok;
  return {
    isRequester: ctx.userId === approval.submittedById,
    // The president gate: the club's ACTIVE president (OSE Director also
    // holds club-admin authority via canManageRoster).
    isPresident:
      mayGate &&
      ctx.orgRoles.some(
        (r) =>
          r.organizationId === approval.organizationId &&
          r.scope === "PRESIDENT" &&
          r.status === "ACTIVE",
      ),
    isOseGate: mayGate && isOse(ctx, approval.institutionId),
    // PAY-150-002 — the extra gate an over-threshold request needs. ANY
    // institution membership holds `isOseGate`, including OSE_ADVISOR; the
    // director's seat is the one that carries policy and override authority
    // (schema.prisma: "Full institution access, policy, override"), so it is
    // the seat a half-million-dollar request has to reach. Still subject to
    // `mayGate`, so a director who raised the request holds neither.
    isOseDirectorGate: mayGate && isOseDirector(ctx, approval.institutionId),
    // Not a gate. Roster administration is a standing capability, and an
    // archived club is what limits it — see canManageRoster.
    canAdmin: canManageRoster(ctx, org),
  };
}

/**
 * All actions the actor may take from the current state.
 *
 * Delegates to the workflow engine rather than switching on status. The gates,
 * their order and the president gate-skip all live in APPROVAL_WORKFLOW now, so
 * a second organization system gets a different flow by pinning a different
 * definition instead of by adding a branch here.
 *
 * approval-definition.test.ts holds the pre-delegation switch as an oracle and
 * compares this against it across the full cross product of statuses and actor
 * roles — with no money on the request, where the two must still agree exactly.
 *
 * PAY-150-002 — `authority` is a required parameter, not a default. The
 * conditions were never passed at all before this: `requesterIsPresident` was
 * the only condition any transition named and even that arrived unevaluated on
 * this path, so the condition channel the engine offers was dead. Both are
 * evaluated here now, from the amount and currency the view is required to
 * carry. A caller that has not resolved the institution's ladder cannot call
 * this, which is deliberate: silently defaulting to "no ceiling" is the same
 * hole with a nicer signature.
 */
export function availableActions(
  ctx: UserContext,
  approval: ApprovalView,
  authority: ApprovalAuthority,
): ApprovalActionName[] {
  return engineActions(APPROVAL_WORKFLOW, {
    state: approval.status,
    roles: workflowRolesFor(ctx, approval),
    conditions: {
      requesterIsPresident: approval.requesterIsPresident,
      exceedsThreshold: exceedsApprovalThreshold(approval, authority),
    },
  }).map((a) => a.action as ApprovalActionName);
}

/**
 * The roles this actor plays for THIS request, as the definition names them.
 *
 * `requester` is pushed unconditionally — submit / resubmit / cancel are the
 * requester's own actions and stay theirs. The two gate roles come from
 * `actorRoles`, which has already run `decisionControl`, so the person who
 * raised the request arrives here holding `requester` and nothing else.
 */
function workflowRolesFor(ctx: UserContext, approval: ApprovalView): string[] {
  const { isRequester, isPresident, isOseGate, isOseDirectorGate } = actorRoles(
    ctx,
    approval,
  );
  const roles: string[] = [];
  if (isRequester) roles.push(APPROVAL_ROLES.requester);
  if (isPresident) roles.push(APPROVAL_ROLES.president);
  if (isOseGate) roles.push(APPROVAL_ROLES.oseGate);
  if (isOseDirectorGate) roles.push(APPROVAL_ROLES.oseDirectorGate);
  return roles;
}

/**
 * Resolve the target status for an action, or null if illegal.
 * `requesterIsPresident` implements the gate-skip for presidents' own requests.
 *
 * Role-agnostic, as it always was: this answers where the flow GOES, and the
 * caller has already established that the actor may take the action (via
 * availableActions). Every role is therefore passed to the engine, so role
 * filtering cannot mask a routing answer.
 */
export function nextStatus(
  action: ApprovalActionName,
  current: ApprovalStatus,
  opts: { requesterIsPresident: boolean; exceedsThreshold: boolean },
): ApprovalStatus | null {
  const result = applyAction(
    APPROVAL_WORKFLOW,
    {
      state: current,
      roles: [
        APPROVAL_ROLES.requester,
        APPROVAL_ROLES.president,
        APPROVAL_ROLES.oseGate,
        APPROVAL_ROLES.oseDirectorGate,
      ],
      // Both conditions, required of the caller. `exceedsThreshold` selects
      // between the two PENDING_OSE `approve` transitions, and while they share
      // a destination today they do NOT share an `allowedRoles` — so an
      // omitted condition would silently return the ordinary gate's transition
      // for an over-threshold request, and the next transition added under the
      // condition would route the money wrongly with nothing to catch it.
      conditions: {
        requesterIsPresident: opts.requesterIsPresident,
        exceedsThreshold: opts.exceedsThreshold,
      },
    },
    action,
  );
  return result.ok ? (result.to as ApprovalStatus) : null;
}

/* ────────────────────────────────────────────────────────────── PAY-150-004 */

/**
 * The money-bearing payload of a request, as a stable hash.
 *
 * ## What this closes
 *
 * The two-gate flow lets the president approve one request and the staff office
 * approve a different one. Nothing captured what was on the request when a gate
 * consented — `ApprovalStep.policySnapshot` carried authorization flags
 * (`requesterIsPresident`), never the payload — and the amount that actually
 * posts money is re-read from the `metadata` Json column at DECISION time. The
 * compare-and-swap on the final write guards `status` and nothing else. So
 * editing the amount, the budget line, the receipt or the date between the two
 * gates changed what the second approver was consenting to, silently.
 *
 * A digest recorded at each gate and recompared at the next one makes that a
 * refusal instead of a posting.
 *
 * ## Why these fields
 *
 * Exactly the ones a decision is ABOUT: how much, to whom, out of which line,
 * against which evidence, when, and for which club. Deliberately not the whole
 * blob — a title correction or a longer description must not invalidate an
 * approval, or people will learn to route around the control.
 *
 * Key-sorted and rendered as `key=value` lines, so the hash is stable across
 * property insertion order (two rows with the same money and different Json key
 * order are the same approval) and cannot be collided by moving a delimiter
 * into a value: `=` and newline are escaped by `stableJson`'s JSON quoting.
 */
export const APPROVAL_DIGEST_FIELDS = [
  "amountMinorUnits",
  "budgetLineId",
  "currency",
  "destination",
  "documentId",
  "endsAt",
  "occursAt",
  "organizationId",
  "recipient",
  "type",
  "vendorId",
] as const;

export interface ApprovalPayloadSubject {
  organizationId: string;
  type: ApprovalType;
  /** From `approvalMoney` — the same number authority was decided on. */
  amountMinorUnits: number | null;
  currency: string;
}

/** JSON with object keys sorted, so serialization order cannot change a hash. */
function stableJson(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function approvalDigest(
  metadata: unknown,
  subject: ApprovalPayloadSubject,
): string {
  const meta = asRecord(metadata);
  const reimbursement = asRecord(meta.reimbursement);

  const fields: Record<(typeof APPROVAL_DIGEST_FIELDS)[number], unknown> = {
    amountMinorUnits: subject.amountMinorUnits,
    budgetLineId: reimbursement.budgetLineId ?? meta.budgetLineId ?? null,
    currency: subject.currency,
    // Where it goes: a venue for an event, a bank/destination for a payment.
    destination: meta.destination ?? meta.venue ?? null,
    documentId: reimbursement.documentId ?? meta.documentId ?? null,
    endsAt: meta.endsAt ?? meta.endAt ?? null,
    occursAt: meta.occursAt ?? meta.startAt ?? null,
    organizationId: subject.organizationId,
    recipient: meta.recipient ?? meta.payeeId ?? null,
    type: subject.type,
    vendorId: meta.vendorId ?? meta.providerId ?? meta.provider ?? null,
  };

  const canonical = APPROVAL_DIGEST_FIELDS.map(
    (key) => `${key}=${stableJson(fields[key])}`,
  ).join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * The digest a gate recorded, or null if it recorded none.
 *
 * Null is NOT a mismatch. `ApprovalStep` is append-only and nothing updates it,
 * so the only way a gate step carries no digest is that it was written before
 * this control existed — refusing those would freeze every request already in
 * flight in the pilot, which is a different outage, not a tightening. Every
 * writer in this application records one now (approvals, finance, calendar), so
 * the absent case shrinks to zero as those requests are decided.
 */
export function recordedPayloadDigest(policySnapshot: unknown): string | null {
  const snapshot = asRecord(policySnapshot);
  const digest = snapshot.payloadDigest;
  return typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest)
    ? digest
    : null;
}

/**
 * The steps that count as a GATE having consented, newest first.
 *
 * A real transition into a pending gate — `fromStatus !== toStatus`. The
 * same-status step `calendar-write.ts` appends when an event is amended is
 * excluded by that test, and excluding it is the entire point: an amendment
 * rewrites `metadata`, so treating its step as a gate would let a reschedule
 * re-bless itself and the invalidation would never fire for the schedule
 * changes it exists to catch.
 */
export function isGateStep(step: {
  fromStatus: ApprovalStatus;
  toStatus: ApprovalStatus;
}): boolean {
  return (
    step.fromStatus !== step.toStatus &&
    (step.toStatus === "PENDING_PRESIDENT" || step.toStatus === "PENDING_OSE")
  );
}

/** Named, because "refused" with no reason is what people escalate about. */
export const APPROVAL_DIGEST_MISMATCH_REASON =
  "The amount, recipient, budget line, receipt or schedule on this request changed " +
  "after an earlier gate approved it, so that approval no longer covers what is on it. " +
  "It has been sent back for changes and needs approving again from the start.";

/* ────────────────────────────────────────────────────────────── PAY-060-007 */

/**
 * The UTC day a submission happened on, as `YYYY-MM-DD`.
 *
 * The window a replay is recognised within. UTC rather than institution-local
 * so the key does not change under a caller in another zone — two clicks either
 * side of local midnight are still one claim, and a key that disagreed with
 * itself across a zone boundary would let the duplicate through on exactly the
 * requests filed late at night.
 */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Hex sha-256 of a canonical `field=value` list. Shared by both keys below. */
function submissionKey(prefix: string, fields: Record<string, string>): string {
  const canonical = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${JSON.stringify(fields[key])}`)
    .join("\n");
  return `${prefix}:${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 40)}`;
}

/**
 * The business identity of a general approval request.
 *
 * Derived from what the request IS, never from anything the client supplies: a
 * client-chosen key is a key an attacker chooses, and `idempotencyKey` is
 * unique per tenant, so a supplied one is a way to collide with somebody else's
 * request. A retry of the same content lands on the same row; a genuinely
 * different request cannot.
 *
 * `intent` is part of the key because saving a draft and submitting the same
 * content are two different acts, and a draft must not swallow the submission
 * that follows it.
 */
export function approvalSubmissionKey(input: {
  organizationId: string;
  submittedById: string;
  type: ApprovalType;
  title: string;
  description: string;
  amount: string;
  intent: "draft" | "submit";
  submittedOn: string;
}): string {
  return submissionKey("approval", {
    organizationId: input.organizationId,
    submittedById: input.submittedById,
    type: input.type,
    title: input.title.trim(),
    description: input.description.trim(),
    amount: input.amount.trim(),
    intent: input.intent,
    submittedOn: input.submittedOn,
  });
}

/**
 * The same, for a reimbursement claim filed from the finance page.
 *
 * A separate prefix rather than a shared one: the two forms collect different
 * fields, and a claim whose key happened to equal a general request's would
 * de-duplicate one against the other.
 */
export function reimbursementSubmissionKey(input: {
  organizationId: string;
  submittedById: string;
  budgetLineId: string;
  amountCents: number;
  description: string;
  submittedOn: string;
}): string {
  return submissionKey("reimbursement", {
    organizationId: input.organizationId,
    submittedById: input.submittedById,
    budgetLineId: input.budgetLineId,
    amountCents: String(input.amountCents),
    description: input.description.trim(),
    submittedOn: input.submittedOn,
  });
}

/**
 * True when a create failed on a unique index — the duplicate being caught.
 *
 * Prisma reports a unique-constraint violation as P2002. At the two call sites
 * that use it, the only unique index in play is
 * `@@unique([institutionId, idempotencyKey])`, so P2002 there means "this claim
 * was already filed" rather than an error to show a member who clicked twice.
 */
export function isDuplicateSubmission(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * True when a write failed because someone else moved the request first.
 *
 * `actOnApproval` names the status it read in the `where` of its status update,
 * so the update matches no row exactly when another approver has already changed
 * it. Prisma reports that as P2025 ("record to update not found") — the same code
 * it uses for a genuinely missing record, which is why this is deliberately
 * narrow: it is only meaningful at a call site that added the status predicate,
 * and callers must not use it to swallow a real not-found.
 */
export function isConcurrentDecision(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}

export const ACTION_LABELS: Record<ApprovalActionName, string> = {
  submit: "Submit for approval",
  approve: "Approve",
  request_changes: "Request changes",
  reject: "Reject",
  resubmit: "Resubmit",
  cancel: "Cancel request",
};
