import { z } from "zod"
import { defineConfig, includedInPlan, type ConfigDefinition } from "@tenure/configuration"
import {
  isPaymentMode,
  LEGAL_ENTITY_CONFIG_KEY,
  PAYMENT_MODES,
  PAYMENT_MODE_CONFIG_KEY,
  type PaymentMode,
} from "@tenure/contracts"

import { BRANDING_DEFINITIONS } from "./branding"
import { FLAG_DEFINITIONS } from "./flags"
import { LOCALIZATION_DEFINITIONS } from "./localization"

/**
 * What the platform lets an organization system change about the words it uses.
 *
 * Every string here is one that used to be a literal in a component. "Ainslie
 * OSE" appears in eight files today; a second institution does not call its
 * staff office that, and there is no acceptable version of
 * `if (slug === "rochester")` to make it say something else.
 *
 * Terminology is the smallest honest first consumer of the configuration engine:
 * it is real (these strings ship to users), it is genuinely per-institution, and
 * getting it wrong is a cosmetic bug rather than a security one — which is the
 * right risk profile for the first thing to route through a new resolver.
 *
 * ## Prices (NEXT-SESSION §7)
 *
 * Every definition here carries a price, per seat and for the whole
 * organisation, because an option without one is incomplete. The terminology
 * keys are all included, and `TERMINOLOGY_INCLUDED` says why once rather than in
 * six sentences that would drift into six different promises.
 */

/** Why the six terminology keys cost nothing. One decision, one statement. */
const TERMINOLOGY_INCLUDED = includedInPlan(
  "Terminology is the product speaking the institution's own words. Putting a per-seat price on " +
    "a noun would price the thing that makes a tenant's system theirs; every plan includes it.",
)

export const staffOfficeName = defineConfig({
  key: "platform.terminology.staffOfficeName",
  owner: "platform",
  type: z.string().min(1).max(80),
  default: "Student Engagement Office",
  allowedScopes: ["blueprint", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  price: TERMINOLOGY_INCLUDED,
  description:
    "The staff office that oversees organizations, as this institution names it. Rochester calls it Ainslie OSE.",
})

export const staffOfficeShortName = defineConfig({
  key: "platform.terminology.staffOfficeShortName",
  owner: "platform",
  type: z.string().min(1).max(24),
  default: "the office",
  allowedScopes: ["blueprint", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  price: TERMINOLOGY_INCLUDED,
  description: "Short form used inline, e.g. in a seat label or a filter chip.",
})

export const organizationTerm = defineConfig({
  key: "platform.terminology.organizationSingular",
  owner: "platform",
  type: z.string().min(1).max(40),
  default: "organization",
  // `archetype` because this word IS the organization axis: selecting
  // `nonprofit-program-operations` is selecting "program". `blueprint` is kept
  // so a blueprint for a shape the axis does not yet name can still supply it;
  // `modules.test.ts` refuses a blueprint that sets it while its axis compiles
  // one, because the archetype layer would silently win.
  allowedScopes: ["blueprint", "archetype", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  price: TERMINOLOGY_INCLUDED,
  description: "What one organization is called: a club, a chapter, a program, an operating unit.",
})

export const organizationTermPlural = defineConfig({
  key: "platform.terminology.organizationPlural",
  owner: "platform",
  type: z.string().min(1).max(40),
  default: "organizations",
  allowedScopes: ["blueprint", "archetype", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  price: TERMINOLOGY_INCLUDED,
  description: "Plural of the above.",
})

export const leadershipBodyTerm = defineConfig({
  key: "platform.terminology.leadershipBody",
  owner: "platform",
  type: z.string().min(1).max(40),
  default: "leadership team",
  allowedScopes: ["blueprint", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  price: TERMINOLOGY_INCLUDED,
  description: "The group that runs one organization: an executive board, a steering committee.",
})

export const seatTerm = defineConfig({
  key: "platform.terminology.seatSingular",
  owner: "platform",
  type: z.string().min(1).max(40),
  default: "role",
  allowedScopes: ["blueprint", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  price: TERMINOLOGY_INCLUDED,
  description: "One position within the leadership body: a seat, an office, a post.",
})

/**
 * PAY-000-007 — which money-mode this tenant is in.
 *
 * The platform had no mode concept at all: `NODE_ENV` was the only environment
 * notion and it is a fact about the container, identical for every tenant it
 * serves. One deployment serves a university still being set up and one running
 * real budgets, and nothing could tell them apart.
 *
 * Configuration rather than an environment variable, deliberately. A mode
 * change has to be an authorised act with a diff, a reason, an approver and a
 * revision to roll back to — `planPublication` gives all five — and an env var
 * has none of them. `requiresCapability` is what makes it authorised: nothing
 * enforced that field before this key existed, so it is now a control instead
 * of a comment.
 *
 * Defaults to `test`. A tenant nobody has decided about is not moving money.
 * `allowedScopes: ["tenant"]` and nothing lower: a blueprint that could pin the
 * mode would put every system built from it into live at once.
 */
export const paymentMode = defineConfig<PaymentMode>({
  key: PAYMENT_MODE_CONFIG_KEY,
  owner: "platform",
  // Validated through the contract's own predicate rather than a second literal
  // union written here. Two spellings of a money-mode is how `"testing"` in one
  // module compares unequal to `"test"` in another and takes the live branch.
  type: z.custom<PaymentMode>(isPaymentMode, {
    message: `must be one of ${PAYMENT_MODES.join(", ")}`,
  }),
  default: "test",
  allowedScopes: ["tenant"],
  mergeStrategy: "replace",
  // Not `confidential`: which mode a tenant is in is something their own staff
  // must be able to read on every screen that moves money. Disclosure of the
  // word "live" grants nothing; the capability is what governs setting it.
  sensitivity: "internal",
  overridable: true,
  price: includedInPlan(
    "Being in live mode is not itself a charge. Money movement is priced by the payments " +
      "contract — per transaction, in the contracted currency — and billing for the switch that " +
      "turns it on would bill a tenant twice for the same thing.",
  ),
  requiresCapability: "payments.mode.publish",
  description:
    "Whether this tenant's money operations are in test or live mode. Test and live share one deployment; this is the only thing that separates them.",
})

/**
 * The legal entity a tenant's money moves under.
 *
 * `legalEntity` has been a declared configuration scope since the engine was
 * written — "the level where jurisdiction lives" — with nothing able to name
 * one. This is the value `TenantContext.legalEntityId` is resolved from, so a
 * command can finally say which entity it acts for rather than implying the
 * tenant.
 *
 * `liveOnly`, because a jurisdiction recorded against a tenant that moves no
 * money governs nothing, and would become effective at the mode flip — the one
 * moment nobody re-reads the configuration. Empty means "the tenant itself".
 */
export const paymentsLegalEntityId = defineConfig({
  key: LEGAL_ENTITY_CONFIG_KEY,
  owner: "platform",
  type: z.string().max(128).regex(/^$|^[A-Za-z0-9][\w.:-]*$/, "must be an identifier, or empty for the tenant itself"),
  default: "",
  allowedScopes: ["tenant"],
  mergeStrategy: "replace",
  sensitivity: "internal",
  overridable: true,
  price: includedInPlan(
    "Naming the legal entity a tenant's money moves under is a compliance fact, not an upsell. " +
      "A jurisdiction nobody can afford to record is a jurisdiction nobody records.",
  ),
  requiresCapability: "payments.legalEntity.publish",
  liveOnly: true,
  description:
    "The legal entity whose jurisdiction this tenant's money moves under. Empty means the tenant itself.",
})

/**
 * PAY-150-002 — the ceiling the ordinary approval gate may pass.
 *
 * Approval authority was purely role-shaped and completely blind to money: a $5
 * request and a $500,000 request took the identical two gates, because the
 * amount was collected into an untyped Json blob and no authority code ever
 * read it back. This is the ladder that makes the second gate amount-aware —
 * above it, final approval needs the staff office's DIRECTOR rather than any
 * staff-office seat.
 *
 * ## A map, not a number
 *
 * Keyed by ISO 4217 code and valued in that currency's MINOR units, because a
 * threshold without a currency is not a threshold. `platform.localization.currency`
 * is already per-institution, and comparing 1000 minor units of JPY against a
 * ceiling meant for USD compares ¥1,000 to $5,000. A currency the ladder does
 * not price fails CLOSED — `exceedsApprovalThreshold` in the application treats
 * it as over the ceiling — so publishing an amount in an unpriced currency is
 * not a way around the gate.
 *
 * ## Who may move it
 *
 * `requiresCapability`, checked in `planPublication`, and the `payments` domain
 * declares `tenantAdminMayWrite: false`. A ceiling any tenant administrator
 * could raise from a settings page is a ceiling that raises itself the first
 * time somebody is in a hurry.
 *
 * The default is $5,000.00. It is a real number rather than a placeholder: an
 * institution that has published nothing gets a gate that fires on a genuinely
 * large student-organization payment and stays quiet on ordinary reimbursements.
 */
export const APPROVAL_THRESHOLDS_KEY = "platform.payments.approvalThresholds"

export const approvalThresholds = defineConfig<Record<string, number>>({
  key: APPROVAL_THRESHOLDS_KEY,
  owner: "platform",
  type: z.record(
    z.string().regex(/^[A-Z]{3}$/, "must be an uppercase ISO 4217 code"),
    z
      .number()
      .int("must be integer minor units — cents for USD, whole yen for JPY")
      .nonnegative(),
  ),
  default: { USD: 500_000 },
  allowedScopes: ["blueprint", "tenant"],
  // `replace`, not `deepMerge`: a tenant publishing a ladder states the whole
  // ladder. Merging entry-by-entry means an institution that removes a currency
  // from its overlay silently keeps the blueprint's ceiling for it, which is a
  // published authority nobody wrote down.
  mergeStrategy: "replace",
  sensitivity: "internal",
  overridable: true,
  price: includedInPlan(
    "Approval authority is governance, not an upsell. A ceiling an institution has to buy is " +
      "a ceiling that gets left at its default, and the default is not their policy.",
  ),
  requiresCapability: "payments.approvalThresholds.publish",
  description:
    "The largest amount, per currency in minor units, that the ordinary staff-office gate may approve. Above it, final approval needs the staff office's director.",
})

/**
 * Every platform-owned definition a running system knows about.
 *
 * Modules extend this at enable time via `ConfigRegistry.with`, which produces a
 * new registry rather than mutating this one.
 */
export const PLATFORM_DEFINITIONS: readonly ConfigDefinition[] = [
  staffOfficeName,
  staffOfficeShortName,
  organizationTerm,
  organizationTermPlural,
  leadershipBodyTerm,
  seatTerm,
  paymentMode,
  paymentsLegalEntityId,
  approvalThresholds,
  ...LOCALIZATION_DEFINITIONS,
  ...BRANDING_DEFINITIONS,
  // Flags sit in the same registry as everything else deliberately: one
  // resolution, one checksum, one provenance trace. A separate flag store would
  // be a second configuration system with its own precedence rules, and the
  // restrict-only law in flags.ts is enforceable precisely because it is written
  // as merge strategies this engine already understands.
  ...FLAG_DEFINITIONS,
] as ConfigDefinition[]
