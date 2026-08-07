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
  ROUNDING_MODES,
  SCALE,
  CurrencyMismatchError,
  add,
  allocateByWeight,
  compare,
  fromDecimal,
  fromMinorUnits,
  isZero,
  minorDigits,
  money,
  negate,
  roundToInteger,
  subtract,
  sum,
  toDecimal,
  toMinorUnits,
  zero,
  type Money,
  type RoundingMode,
} from "./money"

export {
  SplitReversalError,
  netAfterReversal,
  reverseSplit,
  splitAmount,
  splitTotal,
  type RecordedSplit,
  type SplitPart,
  type SplitRule,
} from "./split"

export {
  ConversionError,
  convert,
  netSettlement,
  settlementComponentEntries,
  type ConversionRate,
  type NetSettlement,
  type SettlementComponents,
} from "./settlement-components"

export {
  ReconciliationInputError,
  reconcileToJournal,
  type AccountBalance,
  type AccountVariance,
  type ClearingPosition,
  type UnexplainedVariance,
  type VarianceReport,
} from "./settlement"

export {
  DISCLOSURE_TOPICS,
  PriceError,
  activationPreview,
  includedInPlan,
  priceProblems,
  quoteConfiguration,
  runningTotal,
  type ActivationPreview,
  type ConfigurationQuote,
  type Disclosure,
  type DisclosureTopic,
  type OptionPrice,
  type PricedConfigOption,
  type PricedOption,
  type QuoteLine,
  type RunningTotal,
  type RunningTotalLine,
} from "./pricing"

export {
  TENANT_TAG,
  allocate,
  allocateReceipt,
  reconcile,
  type AllocationDriver,
  type AllocationInput,
  type AllocationResult,
  type CostLine,
  type DriverAttribution,
  type ReceiptSlice,
  type ReceiptTarget,
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
  derivedFrom,
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
  type FigureSource,
  type Freshness,
  type ThresholdDecision,
  type UnitCost,
} from "./reporting"
