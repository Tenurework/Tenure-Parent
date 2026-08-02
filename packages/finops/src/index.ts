/**
 * @tenure/finops — cost allocation and reporting for the global engine.
 *
 * STUDIO-120-008/009/010. The FinOps Center's arithmetic lives here, separate
 * from both the AWS adapter that fetches the data and the page that renders it,
 * so the rules that matter — a shared cost is split by a documented driver,
 * unallocated cost is reported rather than spread, and the parts add back to
 * exactly the bill — are testable without an AWS account.
 */
export {
  SCALE,
  CurrencyMismatchError,
  add,
  allocateByWeight,
  compare,
  fromDecimal,
  isZero,
  money,
  subtract,
  sum,
  toDecimal,
  zero,
  type Money,
} from "./money"

export {
  TENANT_TAG,
  allocate,
  reconcile,
  type AllocationDriver,
  type AllocationInput,
  type AllocationResult,
  type CostLine,
  type DriverAttribution,
  type Reconciliation,
  type TenantCost,
  type UnallocatedCost,
} from "./allocation"

export {
  ANOMALY_FLOOR_MINOR_UNITS,
  ANOMALY_RATIO,
  EXECUTIVE_THRESHOLD_MINOR,
  MIN_COMPLETENESS_TO_FORECAST,
  PEER_THRESHOLD_MINOR,
  STALE_AFTER_HOURS,
  TWO_PERSON_THRESHOLD_MINOR,
  approvalFor,
  assessBudget,
  costBy,
  detectAnomalies,
  figure,
  fleetCost,
  forecastPeriod,
  freshness,
  previewPlanCost,
  summarize,
  unitCost,
  type Anomaly,
  type ApprovalLevel,
  type BudgetAssessment,
  type BudgetState,
  type CostSummary,
  type CostThreshold,
  type Figure,
  type FigureKind,
  type Freshness,
  type ThresholdDecision,
  type UnitCost,
} from "./reporting"
