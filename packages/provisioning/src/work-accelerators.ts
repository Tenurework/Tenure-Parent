import { capabilityKey, type ClassifiedCapability } from "./connector-capability"

/**
 * WRK-130-001 — the ten work accelerators, and the set "selected for release".
 *
 * The Bible enumerates them at
 * `Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md`
 * §11, and before this `grep -rn accelerator` across the repository — outside
 * that Bible and the execution ledger — returned nothing. No type, no list, no
 * gate. Ten named end-to-end workflows with no representation anywhere, which
 * is the state that reads exactly like done.
 *
 * ## The clause that makes it checkable
 *
 * The requirement is not "build ten workflows". It is "implement all ten work
 * accelerators FOR THE EXACT CONNECTOR CAPABILITIES SELECTED FOR RELEASE", and
 * nothing computed that set. Every row in `provider-packs.ts` is `PLANNED` with
 * `PLANNED` capabilities and `availabilityDecisions` returns `planned` for all
 * of them, so the set selected for release is EMPTY — and an empty set nobody
 * states is a set a console, a doc or a marketing page will happily contradict.
 *
 * So each accelerator declares the capability keys it rests on, and
 * `acceleratorAvailability` computes the verdict rather than asserting it. With
 * the catalog as it stands the honest answer is ten `unavailable` verdicts, and
 * `catalogs.test.ts` plus
 * `tests/architecture/provider-packs-bind-requirements.test.mjs` assert exactly
 * that — which is the honest state of the platform written somewhere it can go
 * red the moment somebody overstates it.
 *
 * ## Why a capability may be `AVAILABLE` and still not count
 *
 * A verdict reads `problems.length === 0` as well as the status. That is what
 * makes the two gates compose in the right order: advancing a pack to
 * `AVAILABLE` without evidence trips WRK-100-004's clause contract in
 * `connector-capability.ts` FIRST, so the accelerator stays unavailable until
 * the citations are real. Reading the status alone would let an accelerator go
 * green on a claim the capability gate had already refused, which is the
 * failure `provider-packs.ts`'s own doc block describes for lifecycle rows.
 *
 * ## What is deliberately NOT claimed
 *
 * Accelerator 1 is not "done because `/api/ai/chat` exists". That route
 * retrieves Tenure's own records; the accelerator names email, chat, docs,
 * meetings, tasks and knowledge, none of which any connector reaches. Marking
 * it satisfied would be exactly the false claim WRK-GATE-000 and WRK-130-005
 * exist to prevent.
 */

export interface WorkAccelerator {
  /** Stable key. The identity of a row on an operator console. */
  key: string
  /** The Bible's own sentence, so the declaration and the source agree. */
  title: string
  /**
   * The capability keys this accelerator cannot work without, each in
   * `capabilityKey` form — `provider/product/capability/direction`.
   *
   * Non-empty by construction: an accelerator that requires no capability is
   * one nothing can make unavailable, and a verdict that is always `available`
   * is not a verdict. `catalogs.test.ts` asserts every key here is one the
   * catalog actually declares, so a typo cannot quietly make an accelerator
   * permanently unavailable for a reason nobody can see.
   */
  requiresCapabilities: readonly string[]
}

/** Every capability key the packs declare, spelled once so the ten agree. */
const MS_MAIL = "microsoft/outlook-mail/message.sync/bidirectional"
const GMAIL = "google/gmail/message.sync/bidirectional"
const SLACK = "slack/workspace/message.sync/bidirectional"
const ZOOM = "zoom/meetings/meeting.sync/read"
const NOTION = "notion/workspace/page.sync/bidirectional"
const BOX = "box/content/file.sync/bidirectional"
const JIRA = "atlassian/jira/issue.sync/bidirectional"
const CONFLUENCE = "atlassian/confluence/page.sync/bidirectional"
const ASANA = "asana/work/task.sync/bidirectional"
const LINEAR = "linear/issues/issue.sync/bidirectional"
const MONDAY = "monday/work/item.sync/bidirectional"
const DOCUSIGN = "docusign/esignature/envelope.sync/bidirectional"
const WEBEX = "cisco/webex/meeting.sync/read"

/**
 * The ten, transcribed from Bible §11 in the order it lists them.
 *
 * Each `requiresCapabilities` is the smallest set the accelerator's own
 * sentence names — not every connector that could plausibly contribute. An
 * inflated list makes an accelerator unavailable for reasons its description
 * never claimed, and a reader comparing the two would find the declaration
 * arguing with the Bible.
 */
export const WORK_ACCELERATORS: readonly WorkAccelerator[] = [
  {
    key: "cross-app-answer-with-citations",
    title:
      "Cross-app answer with citations: search allowed Tenure records, email, chat, docs, " +
      "meetings, tasks and knowledge; return a synthesized answer with source/freshness and " +
      "access-safe deep links",
    requiresCapabilities: [MS_MAIL, GMAIL, SLACK, BOX, ZOOM, JIRA, NOTION],
  },
  {
    key: "inbox-to-governed-work",
    title:
      "Inbox to governed work: identify a relevant email/message, draft a response, propose a " +
      "Tenure task/approval/request, require confirmation, send/create and link receipts",
    requiresCapabilities: [MS_MAIL, GMAIL, SLACK],
  },
  {
    key: "meeting-lifecycle",
    title:
      "Meeting lifecycle: find availability, propose time, create the meeting only after " +
      "confirmation, attach agenda/context, ingest the approved transcript, extract " +
      "decisions/actions, route review and update Tenure work",
    requiresCapabilities: [ZOOM, WEBEX, MS_MAIL],
  },
  {
    key: "approval-notification",
    title:
      "Approval notification: a Tenure workflow emits a concise Slack/Teams/email " +
      "notification; recipients act through an authenticated Tenure route and the external " +
      "app is not the authorization authority",
    requiresCapabilities: [SLACK, MS_MAIL],
  },
  {
    key: "document-to-process",
    title:
      "Document-to-process: find the current document version, extract structured candidate " +
      "data, show citations/confidence, let a human validate, then create a Tenure " +
      "request/record without inventing missing fields",
    requiresCapabilities: [BOX, CONFLUENCE, DOCUSIGN],
  },
  {
    key: "work-tracking-synchronization",
    title:
      "Work tracking synchronization: an approved Tenure commitment creates/updates a " +
      "Jira/Asana/Linear/Monday task with field ownership, loop prevention, " +
      "comments/attachments policy, status mapping and reconciliation",
    requiresCapabilities: [JIRA, ASANA, LINEAR, MONDAY],
  },
  {
    key: "customer-service-continuity",
    title:
      "Customer/service continuity: gather permitted email/meeting/CRM/ticket history, propose " +
      "the next response, update the external system only after confirmation and preserve " +
      "role-owned account context",
    requiresCapabilities: [MS_MAIL, GMAIL, ZOOM],
  },
  {
    key: "transition-briefing",
    title:
      "Transition briefing: build a new seat-holder briefing from approved Tenure memory plus " +
      "currently accessible external sources; exclude private predecessor material and show " +
      "unresolved access gaps",
    requiresCapabilities: [MS_MAIL, BOX, NOTION, CONFLUENCE],
  },
  {
    key: "exception-command-center",
    title:
      "Exception command center: correlate provider outage, failed sync, missing scope, stale " +
      "index and partial cross-app saga; propose precise remediation without retry storms or " +
      "duplicate writes",
    requiresCapabilities: [MS_MAIL, SLACK, BOX, JIRA],
  },
  {
    key: "connection-on-demand",
    title:
      "Connection-on-demand: a user asks for an unconnected task, receives the correct " +
      "connect/admin/request card, completes the authorized flow, and resumes the exact task " +
      "without retyping",
    // The only one of the ten whose sentence names no provider, because it is
    // the recovery path FOR the other nine: the task a person is blocked on is
    // whichever one they asked for. So the honest declaration is the union of
    // what the nine rest on, and it is not an inflated list — a subset would let
    // this accelerator read `available` while the very capability somebody was
    // blocked on is still unreachable, which is the overstatement the whole file
    // exists to prevent. The same reasoning `acceleratorAvailability` applies to
    // DEGRADED: a round trip that resumes some tasks and silently drops the rest
    // is worse than one that says it cannot run yet.
    //
    // What DOES exist today is the Tenure half — `ConnectionLaunchToken`
    // (WRK-030-002) persists the pending intent across the round trip, which is
    // step 2 of Bible §5.3. That is not this accelerator: with no certified
    // connector there is no authorized flow to complete and nothing to resume
    // into, and claiming it on the strength of the token would be the same false
    // PASS as claiming accelerator 1 because `/api/ai/chat` exists.
    requiresCapabilities: [
      MS_MAIL,
      GMAIL,
      SLACK,
      ZOOM,
      WEBEX,
      BOX,
      NOTION,
      CONFLUENCE,
      DOCUSIGN,
      JIRA,
      ASANA,
      LINEAR,
      MONDAY,
    ],
  },
]

export interface AcceleratorVerdict {
  accelerator: WorkAccelerator
  available: boolean
  /**
   * EVERY required capability that is not usable today, not just the first.
   *
   * All of them, because "unavailable — Microsoft mail is planned" reads as one
   * missing pack when seven are missing, and an operator planning a release
   * needs the whole list rather than the head of it.
   */
  missing: readonly string[]
}

/**
 * Which accelerators the capabilities actually selected for release support.
 *
 * A capability counts only when it is `AVAILABLE` **and** its classification
 * holds up. `DEGRADED` does not count: an accelerator resting on partial
 * coverage or stale data is a workflow that silently returns less than it
 * claims, which for "cross-app answer with citations" means an answer that omits
 * the source that mattered without saying so.
 */
export function acceleratorAvailability(
  accelerators: readonly WorkAccelerator[],
  capabilities: readonly ClassifiedCapability[],
): readonly AcceleratorVerdict[] {
  // `capabilityKey`, not a template literal spelling the same four fields. The
  // keys above are written in that function's format and a second formatter
  // here would be a second answer to what a capability is called — the copy
  // that drifts being whichever nobody is looking at.
  const usable = new Set(
    capabilities
      .filter((c) => c.status === "AVAILABLE" && c.problems.length === 0)
      .map(capabilityKey),
  )

  return accelerators.map((accelerator) => {
    const missing = accelerator.requiresCapabilities.filter((key) => !usable.has(key))
    return { accelerator, available: missing.length === 0, missing }
  })
}
