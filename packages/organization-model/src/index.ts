/**
 * @tenure/organization-model — configurable organization hierarchies.
 *
 * The directive's list of things Tenure must be able to represent — universities,
 * schools, student organizations, associations, nonprofits, corporations,
 * holding companies, subsidiaries, franchises, government programs, committees,
 * chapters, departments, operating units — is not a list of features. It is one
 * feature: a hierarchy whose node types and containment rules are declared
 * rather than compiled in.
 *
 * What the application has today is a fixed two-level model, Institution →
 * Organization, with no representation at all for a holding company that owns
 * subsidiaries that contain business units that contain teams.
 *
 *   const topology = { rootType: "institution", types: [...], containment: [...] }
 *   const graph = buildOrgGraph(topology, units)
 *   const now = graph.asOf("2026-07-31T00:00:00Z")
 *   now.ancestors(clubId)      // school, institution
 *   now.descendants(schoolId)  // every club and board beneath it
 *
 * Structure is always asked of a snapshot, never of the graph, because "the
 * parent of this club" has no answer without a date — clubs move between
 * schools, and an approval routed last March has to be explicable against the
 * structure that existed in March.
 */

export {
  TopologyError,
  mayContain,
  typeHoldsSeats,
  typeOf,
  validateTopology,
} from "./topology"
export type {
  ContainmentRule,
  OrgRelationType,
  OrgTopology,
  OrgUnitType,
} from "./topology"

export { OrgGraph, OrgGraphError, OrgSnapshot, buildOrgGraph } from "./graph"
export type { OrgRelationInput, OrgUnitInput, Parentage, ResolvedUnit } from "./graph"

export {
  attachmentSurvivesTurnover,
  delegationAllows,
  inTeam,
  mayRedelegate,
  redelegate,
  seatIsOpen,
  succeedsTo,
  teamConfers,
  type Dated,
  type Delegation,
  type DelegationRefusal,
  type DelegationVerdict,
  type InheritanceClass,
  type ResourceOwnerKind,
  type ResourceRelationship,
  type Seat,
  type SeatOwnedResource,
  type SuccessionOutcome,
  type Team,
  type TeamMembership,
} from "./continuity"

export {
  PLATFORM_ASSIGNMENT_STATES,
  assignmentProblems,
  findAssignmentState,
  seatIsVacant,
  stateAuthorityAt,
  validateAssignmentCatalog,
  type AssignmentState,
  type AssignmentStateCatalog,
  type CatalogProblem,
  type StateAuthority,
} from "./assignment-states"

export {
  correct,
  decisionDrifted,
  factHistory,
  resolveAsOf,
  type BitemporalVersion,
  type CorrectionOutcome,
  type CorrectionRefusal,
  type HistoryEntry,
  type RecordPeriod,
  type Resolution,
  type ResolutionRefusal,
  type TemporalQuery,
  type ValidPeriod,
} from "./bitemporal"

export {
  archivePosition,
  freezePosition,
  mergePositions,
  planTermTransition,
  positionMayBeFilled,
  splitPosition,
  transferPosition,
  unfreezePosition,
  type LivePosition,
  type OperationContext,
  type PositionOperation,
  type PositionRefusal,
  type PositionRefused,
  type SplitPart,
  type TermTransition,
  type TransitionPlan,
} from "./position-lifecycle"

export {
  endAssignment,
  planHandover,
  releaseToSuccessor,
  type Classification,
  type ClassifiedResource,
  type EndOutcome,
  type EndRefusal,
  type EndableAssignment,
  type HandoverSummary,
  type ReleaseAction,
  type ReleaseDecision,
  type ReleasePolicy,
  type SuccessionContext,
} from "./succession-release"
