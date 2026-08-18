/**
 * @tenure/generality-fixtures — GE-052.
 *
 * The platform's claim is that a university's student-organization system and a
 * company's purchasing system are the same engine given different
 * configuration. A claim of that shape is only worth what its second instance
 * is worth: one shipped configuration proves the engine runs the shape it was
 * written around.
 *
 * This package is the second instance, in the form the requirement asks for —
 * a corporate spine (company → region → business unit → department → team), the
 * authority ladder that runs it (analyst → manager → director → executive), and
 * the purchase chain that spends its money — built entirely out of shipped
 * platform modules so that GE-052-004's "identical schemas, services,
 * authorization, workflows and deployment paths" is a suite rather than a
 * sentence.
 */

export {
  CORPORATE_EPOCH,
  CORPORATE_BLUEPRINT_ID,
  CORPORATE_SEAT_LADDER,
  CORPORATE_SPINE,
  CORPORATE_UNITS,
  buildCorporateOrg,
  corporateTenantSlugs,
  corporateTopology,
  ladderProblemsAgainst,
  rungByKey,
  rungReaches,
} from "./corporate-org"
export type {
  CorporateLadderProblem,
  CorporateRung,
  CorporateSpineType,
  LadderProblemKind,
} from "./corporate-org"

export {
  CORPORATE_GATES,
  CORPORATE_PURCHASE_LADDER,
  CORPORATE_PURCHASE_WORKFLOW,
  CORPORATE_RUNG_KEYS,
  GATE_MINIMUM_RANK,
  availablePurchaseActions,
  corporateWorkflowRoles,
  decidePurchase,
  delegatedGates,
  gatesForAmount,
  gatesOfRung,
  purchaseConditions,
  purchaseLadderProblems,
  rungForAmount,
} from "./corporate-purchase"
export type {
  CorporateActor,
  CorporateGate,
  CorporatePurchase,
  DelegatedGates,
  PurchaseOutcome,
  PurchaseRefusal,
} from "./corporate-purchase"
