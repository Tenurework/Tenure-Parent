/**
 * @tenure/workflow — approval flows as data, not as a switch statement.
 *
 * The application's approval flow is correct and is also the only flow the
 * product can have: a nonprofit wanting a two-stage programme review needs a
 * code change and a deploy. A definition makes the flow something a release
 * pins, so two organization systems can run different ones from one engine.
 *
 *   const def = publishDefinition({ key: "approval", version: "1.0.0", ... })
 *   availableActions(def, { state: "PENDING_PRESIDENT", roles: ["president"] })
 *   applyAction(def, ctx, "approve")   // { ok: true, to: "PENDING_OSE" }
 *
 * Instances pin the version they started under, because publishing a new flow
 * must not change what the requests already in flight are allowed to do.
 */

export { WorkflowDefinitionError, publishDefinition, validateDefinition } from "./definition"
export type { ActorRole, WorkflowDefinition, WorkflowState, WorkflowTransition } from "./definition"

export {
  WorkflowError,
  advance,
  applyAction,
  availableActions,
  isTerminal,
  startInstance,
} from "./engine"
export type {
  AvailableAction,
  TransitionRefusal,
  TransitionResult,
  WorkflowContext,
  WorkflowInstance,
} from "./engine"
