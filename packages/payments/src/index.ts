/**
 * @tenure/payments — the provider-neutral half of the payments stack.
 *
 * Everything here is pure. The rules that decide whether two provider ids are
 * the same object, and whether a redelivered transaction is a retry or a
 * correction, are the rules a reconciliation stands on, so they are testable
 * without a provider account and identical whatever path the data arrived by.
 */
export {
  UnqualifiedReferenceError,
  qualify,
  refKey,
  tenantScopedIdempotencyKey,
  type ProviderMode,
  type ProviderRefInput,
  type QualifiedProviderRef,
} from "./external-reference"

export {
  balanceTransactionKey,
  ingest,
  type BalanceTransactionInput,
  type IngestConflict,
  type IngestOutcome,
  type StoredBalanceTransaction,
} from "./balance-transactions"

/**
 * PAY-000-008 / PAY-010-004 — what Tenure has approved, and nothing more.
 *
 * `capability-registry.ts` reads the approving ADR off disk, so this entry
 * point is server-only. The client-safe subset is `@tenure/payments/gateway`.
 */
export {
  CAPABILITY_STATES,
  PAYMENT_CAPABILITIES,
  PaymentCapabilityError,
  STATES_REQUIRING_APPROVAL,
  adrExistsOnDisk,
  assertRegistry,
  capability,
  capabilityAvailabilityForModules,
  capabilityState,
  isTransactable,
  providerApiCompatibility,
  settlementCurrencies,
  type ApiCompatibilityVerdict,
  type BusinessType,
  type CapabilityApproval,
  type CapabilityState,
  type LegalEntityType,
  type ModulePaymentCapability,
  type PaymentCapability,
  type ProviderApiCompatibility,
  type RegistryChecks,
} from "./capability-registry"

/** PAY-010-002 — provider, certification, entitlement, activation. All four. */
export {
  CAPABILITY_GATES,
  evaluateCapabilityGates,
  type CapabilityGate,
  type CapabilityGateDecision,
  type CapabilityGateFacts,
  type GateResult,
  type GateVerdict,
  type MerchantActivation,
  type ProviderCapabilityObservation,
} from "./capability-gates"

/** PAY-010-007 — a provider change raises review tasks and mutates nothing. */
export {
  watchProviderApiVersion,
  watchProviderFeatures,
  type ProviderFeatureReviewTask,
  type ProviderVersionReviewTask,
  type ProviderVersionWatchReport,
} from "./version-watch"

/** PAY-010-006 — country/currency/entity/business-type eligibility, explained. */
export {
  simulateCurrencySelection,
  simulateEligibility,
  type Blocker,
  type BlockerSubject,
  type EligibilityRequest,
  type EligibilityResult,
} from "./eligibility"

/** PAY-040-002 — the eight responsibilities, per funds flow, with no default. */
export {
  RESPONSIBILITY_AXES,
  RESPONSIBILITY_PARTIES,
  failingAxes,
  partyFor,
  resolveResponsibility,
  type FundsFlow,
  type ResponsibilityAxis,
  type ResponsibilityConfig,
  type ResponsibilityParty,
  type ResponsibilityResolution,
} from "./responsibility"

/** PAY-070-002 — direct charges by default, where the matrix earns them. */
export {
  FUNDS_FLOWS,
  chooseFundsFlow,
  type FundsFlowChoice,
  type FundsFlowConfig,
  type MerchantProfile,
  type RefusedFlow,
} from "./funds-flow"

/** PAY-040-003 — the charge model, decided from the facts, with its reasons. */
export {
  CHARGE_MODELS,
  decideChargeModel,
  type BuyerParty,
  type ChargeModel,
  type ChargeModelAmounts,
  type ChargeModelDecision,
  type ChargeModelInput,
  type ConnectedAccountConfiguration,
  type PaymentUseCase,
  type SellerParty,
} from "./charge-model"

/** PAY-070-003 — a liability-shifting flow needs an approved, pinned exception. */
export {
  LIABILITY_SHIFTING_MODELS,
  assertLiabilityApproved,
  chargeModelDigest,
  liabilityExceptionRequest,
  requiresLiabilityException,
  type ApprovalRecord,
  type LiabilityExceptionRequest,
  type LiabilityGate,
} from "./liability"

/** PAY-130-002 — posting templates, balanced entries, effective dating. */
export {
  CASH_CLEARING_ACCOUNT,
  MANUAL_RECOVERY_TEMPLATE,
  MANUAL_SPEND_TEMPLATE,
  POSTING_TEMPLATES,
  PROGRAM_EXPENSE_ACCOUNT,
  PostingError,
  RECOVERABLE_TAX_ACCOUNT,
  REIMBURSEMENT_PAYABLE_ACCOUNT,
  REIMBURSEMENT_TEMPLATE,
  buildJournal,
  postingFor,
  type AmountRef,
  type Journal,
  type JournalEntry,
  type JournalOptions,
  type PostingLine,
  type PostingSide,
  type PostingTemplate,
} from "./posting"

/** PAY-180-006 — refusal and escalation for prohibited or ambiguous movement. */
export {
  MONEY_MOVEMENT_KINDS,
  PAYMENTS_OPERATIONS_QUEUE,
  classifyRequest,
  type Beneficiary,
  type MoneyMovementKind,
  type MoneyMovementRequest,
  type RefusalDecision,
  type RefusalVerdict,
} from "./refusal"

/**
 * PAY-200-004 — rate, velocity, amount, recipient, account and tenant limits,
 * and the fail-closed answer when the history behind them cannot be read.
 *
 * Named `movementLimits` rather than exported as a bare `evaluate`: `evaluate`
 * is a word four packages would each want, and a limit decision is not the kind
 * of thing a reader should have to trace an import to identify.
 */
export {
  DEFAULT_MOVEMENT_LIMITS,
  LIMIT_NAMES,
  evaluate as evaluateMovementLimits,
  observationWindows,
  type LimitBreach,
  type LimitDecision,
  type LimitName,
  type LimitObservations,
  type LimitVerdict,
  type LimitedMovement,
  type MovementLimitPolicy,
} from "./limits"

/** PAY-140-002 — the pinned provider API version and the events read under it. */
export {
  ApiVersionError,
  PROVIDER,
  PROVIDER_API_VERSION,
  PROVIDER_MODES,
  SUPPORTED_EVENT_TYPES,
  checkEventApiVersion,
  compareProviderApiVersions,
  normalizeProviderApiVersion,
  parseProviderEvent,
  type ApiVersionVerdict,
  type ParsedProviderEvent,
  type SupportedEventType,
} from "./api-version"

/** PAY-140-008 — signature verification, rotation window, replay and ordering. */
export {
  DEFAULT_TOLERANCE_MS,
  dedupe,
  verifySignature,
  type DedupeVerdict,
  type ProviderEventKey,
  type ReceivedEvent,
  type SignatureFailure,
  type SignatureResult,
} from "./webhook"

/**
 * PAY-000-004 — the product copy Bible §2 forbids, as rules something runs.
 *
 * Also on the client-safe `@tenure/payments/gateway` subpath, which is the one
 * `relay-reply.ts` takes; this export is for server surfaces that already hold
 * the package root.
 */
export {
  APPROVED_DISCLOSURE_PHRASE,
  PROHIBITED_CLAIM_RULES,
  describeFinding,
  scanProhibitedClaims,
  type ProhibitedClaimFinding,
  type ProhibitedClaimRule,
} from "./prohibited-claims"

/** PAY-020-002 — the provider-neutral port. Also at `@tenure/payments/gateway`. */
export {
  GatewayError,
  describeMerchant,
  quotePayment,
  type MerchantDescriptor,
  type MerchantDescriptorInput,
  type PaymentQuote,
  type PaymentQuoteInput,
} from "./gateway"

/**
 * PAY-200-003 / PAY-180-004 — financial identifiers: recognised by checksum,
 * tokenized under a tenant-scoped key, encrypted when they have to come back,
 * and shown only as far as the PURPOSE asking has earned.
 *
 * Server-only, like the rest of this entry point: `node:crypto`. The credential
 * scanner it sits beside is `@tenure/audit`'s `secret-values.ts` — a different
 * class of value with a different answer (refuse, rather than tokenize).
 */
export {
  ACCESS_PURPOSES,
  FINANCIAL_IDENTIFIER_KINDS,
  MIN_TOKEN_KEY_LENGTH,
  PURPOSES_NO_GRANT_CAN_RAISE,
  REVEAL_LEVELS,
  abaPrefixIsAssigned,
  containsFinancialIdentifier,
  decryptIdentifier,
  encryptIdentifier,
  findFinancialIdentifiers,
  grantProblems,
  keyIdOf,
  maskIdentifier,
  normalizeIdentifier,
  passesAbaCheck,
  passesIbanCheck,
  passesLuhn,
  redactFinancialIdentifiers,
  redactFinancialIdentifiersDeep,
  revealFor,
  tokenFor,
  type AccessPurpose,
  type DecryptResult,
  type EncryptResult,
  type EncryptionRefusal,
  type FinancialIdentifierKind,
  type GrantProblem,
  type IdentifierOccurrence,
  type PurposeGrant,
  type RedactionFinding,
  type RedactionOptions,
  type RedactionResult,
  type RevealLevel,
  type TokenResult,
  type TokenizationRefusal,
} from "./financial-identifiers"

/**
 * PAY-200-005 — which actions are high-risk, and what evidence one has to be
 * able to show. Consumed by `apps/web/src/lib/audit-record.ts`, the one door
 * every audit row in the application is written through.
 */
export {
  EVIDENCE_FIELDS,
  EVIDENCE_REQUIREMENTS,
  HIGH_RISK_CLASSES,
  HIGH_RISK_CLASS_PRECEDENCE,
  buildEvidencePackage,
  classifyHighRiskAction,
  evidenceDigestMatches,
  isHighRiskAction,
  type EvidenceField,
  type EvidencePackage,
  type EvidencePackageInput,
  type EvidenceValues,
  type HighRiskClass,
} from "./high-risk-actions"

/**
 * PAY-060-001 — the canonical payment order and attempt machines.
 *
 * Independent of the provider by construction: `observeProviderState` returns
 * what an event is evidence OF and cannot move anything, and `advanceOrder`
 * validates against Tenure's own table with the order's real current state.
 */
export {
  ACCOUNT_SCOPED_EVENTS,
  ATTEMPT_TRANSITIONS,
  EVIDENCE_SOURCES,
  NON_SETTLEMENT_EVIDENCE,
  ORDER_TRANSITIONS,
  PAYMENT_ATTEMPT_STATES,
  PAYMENT_CONTROL_STATES,
  PAYMENT_ORDER_STATES,
  SETTLEMENT_STATES,
  advanceAttempt,
  advanceOrder,
  canonicalProviderReadings,
  isTerminalOrderState,
  observeProviderState,
  type AdvanceOrderInput,
  type EvidenceSource,
  type OrderTransition,
  type PaymentAttemptState,
  type PaymentControlState,
  type PaymentOrderState,
  type PaymentState,
  type ProviderObservation,
  type ProviderReading,
  type TransitionRefusal,
} from "./payment-order-state"

/** PAY-090-001 — five outbound commands, five machines, and no generic verb. */
export {
  PAYOUT_COMMANDS,
  PAYOUT_COMMAND_MACHINES,
  isTerminalPayoutState,
  statesOf as payoutCommandStates,
  transitionPayoutCommand,
  type PayoutCommand,
  type PayoutCommandMachine,
  type PayoutTransition,
} from "./payout-commands"

/** PAY-080-001 — which of Bible §10's four command types a request is. */
export {
  MOVEMENT_COMMAND_TYPES,
  MovementCommandError,
  assertProviderCallPermitted,
  classifyMovementCommand,
  type MovementCommandDecision,
  type MovementCommandFacts,
  type MovementCommandType,
} from "./movement-commands"
