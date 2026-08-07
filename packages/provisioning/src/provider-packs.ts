import type { CatalogLifecycle, ConnectorEntry } from "./catalogs"
import type { CapabilityDirection } from "./connector-capability"

/**
 * WRK-100-003 — "Bind exact provider packs to capability and industry
 * requirements from the catalog; unbuilt packs remain `PLANNED`."
 *
 * Before this, the WRK-080/090/100 requirements named twenty-four providers and
 * not one of them appeared anywhere in the codebase as any kind of declared
 * row. A requirement that names Jira and a catalog that has never heard of Jira
 * are two documents nobody can reconcile, and "we support Jira" was a sentence
 * whose truth value nothing could compute.
 *
 * So each named pack is a row, at `PLANNED`, carrying the exact requirement id
 * that asks for it. Three things become checkable that were not:
 *
 *   * `tests/architecture/provider-packs-bind-requirements.test.mjs` fails if a
 *     pack cites a requirement id the registry does not contain — which is how
 *     a binding to a renamed or invented requirement is caught.
 *   * the same test fails if a pack whose requirement is not `PASS` in the
 *     ledger is anything other than `PLANNED`. Marking `microsoft.outlook-mail`
 *     `PUBLISHED` while WRK-080-001 is `FAIL` reds, which is the exact
 *     overstatement WRK-GATE-000 exists to stop.
 *   * `availabilityDecisions` returns `planned` for every one of them, so the
 *     System Studio lists them under "not available, and why" instead of them
 *     being invisible — and invisible reads exactly like done.
 *
 * ## Why the rows carry no capabilities beyond PLANNED ones
 *
 * Every capability here is `PLANNED` with no evidence, which
 * `capabilityProblems` permits and `AVAILABLE` would not. That is the honest
 * shape: nothing has been built, so nothing is cited. The moment somebody
 * builds one, the status moves and the evidence requirement bites.
 *
 * ## Why `requirementIds` is on this type and not on `CatalogEntry`
 *
 * `MODEL_CATALOG` is constructed in `@tenure/platform-config`, which does not
 * import this package. A required field on `CatalogEntry` would not compile
 * there, and an optional one would be a field most rows silently omit — the
 * shape that makes a binding look present when it is absent.
 */
export interface ProviderPackEntry extends ConnectorEntry {
  /**
   * The exact WRK requirement ids that ask for this pack.
   *
   * Required and non-empty by construction: a pack nobody asked for is a wish
   * list entry, and a wish list that sits in the catalog looks like a roadmap.
   */
  requirementIds: readonly string[]
}

/** Every planned pack is written against the current engine and no older. */
const ENGINE = { minEngine: "2026.1.0", maxEngine: null } as const

/**
 * One row, written with named fields.
 *
 * Named rather than positional because a second reader — 
 * `tests/architecture/provider-packs-bind-requirements.test.mjs` — parses this
 * file as text to check each pack's `lifecycle` against the status its
 * requirement has in the ledger. A positional call hides both facts inside an
 * argument order, and a guard that has to count commas is a guard that breaks
 * the first time somebody reformats.
 *
 * `direction` is per-pack and deliberately not uniform: a signature pack is
 * bidirectional (send an envelope, read its completion) while a meetings pack
 * is read-only, and read and write are separately certifiable.
 */
function pack(p: {
  key: string
  displayName: string
  provider: string
  product: string
  capability: string
  direction: CapabilityDirection
  egressHosts: readonly string[]
  requirementIds: readonly string[]
  /**
   * Overridable so advancing a built pack is a one-line, visible edit — and so
   * the architecture test has something to catch when somebody advances one
   * whose requirement is still FAIL.
   */
  lifecycle?: CatalogLifecycle
}): ProviderPackEntry {
  return {
    kind: "connector",
    key: p.key,
    displayName: p.displayName,
    lifecycle: p.lifecycle ?? "PLANNED",
    publisher: "platform",
    egressHosts: p.egressHosts,
    compatibility: ENGINE,
    // No provider review, because nobody has approached the provider. The gate
    // never reaches that check for a PLANNED entry — `planned` is reported
    // first — and stating an empty review would claim a submission that has not
    // happened.
    requestedScopes: [],
    capabilities: [
      {
        provider: p.provider,
        product: p.product,
        capability: p.capability,
        direction: p.direction,
        status: "PLANNED",
        evidenceRefs: [],
      },
    ],
    restrictions: {
      disclaimer:
        `Planned. No connector code, app registration, scope set, certification or provider ` +
        `review exists for ${p.displayName}. It is listed so the requirement that asks for it ` +
        `has a row, not because any part of it works.`,
    },
    requirementIds: p.requirementIds,
  }
}

/**
 * The twenty-four packs the Bible names, bound to the requirements that name
 * them.
 *
 * Grouped by the requirement, in requirement order, so a reader can check the
 * binding against `docs/architecture/capability-completeness-registry.yaml`
 * without holding twenty-four ids in their head.
 */
export const PROVIDER_PACKS: readonly ProviderPackEntry[] = [
  // WRK-080-001 — Microsoft 365. Outlook Mail is the headline product of the
  // seven the requirement lists; the rest arrive as capabilities on this pack
  // when somebody builds them.
  pack({
    key: "microsoft.outlook-mail",
    displayName: "Microsoft Outlook Mail",
    provider: "microsoft",
    product: "outlook-mail",
    capability: "message.sync",
    direction: "bidirectional",
    egressHosts: ["graph.microsoft.com", "login.microsoftonline.com"],
    requirementIds: ["WRK-080-001"],
  }),

  // WRK-080-003 — Google Workspace.
  pack({
    key: "google.gmail",
    displayName: "Google Gmail",
    provider: "google",
    product: "gmail",
    capability: "message.sync",
    direction: "bidirectional",
    egressHosts: ["gmail.googleapis.com", "oauth2.googleapis.com"],
    requirementIds: ["WRK-080-003"],
  }),

  // WRK-090-001 / 002 / 003 / 004 — the four named collaboration providers.
  pack({
    key: "slack.workspace",
    displayName: "Slack",
    provider: "slack",
    product: "workspace",
    capability: "message.sync",
    direction: "bidirectional",
    egressHosts: ["slack.com"],
    requirementIds: ["WRK-090-001"],
  }),
  pack({
    key: "zoom.meetings",
    displayName: "Zoom Meetings",
    provider: "zoom",
    product: "meetings",
    capability: "meeting.sync",
    direction: "read",
    egressHosts: ["api.zoom.us"],
    requirementIds: ["WRK-090-002"],
  }),
  pack({
    key: "notion.workspace",
    displayName: "Notion",
    provider: "notion",
    product: "workspace",
    capability: "page.sync",
    direction: "bidirectional",
    egressHosts: ["api.notion.com"],
    requirementIds: ["WRK-090-003"],
  }),
  pack({
    key: "box.content",
    displayName: "Box",
    provider: "box",
    product: "content",
    capability: "file.sync",
    direction: "bidirectional",
    egressHosts: ["api.box.com"],
    requirementIds: ["WRK-090-004"],
  }),

  // WRK-100-001 — the first prioritized secondary batch.
  pack({
    key: "dropbox.files",
    displayName: "Dropbox",
    provider: "dropbox",
    product: "files",
    capability: "file.sync",
    direction: "bidirectional",
    egressHosts: ["api.dropboxapi.com"],
    requirementIds: ["WRK-100-001"],
  }),
  pack({
    key: "atlassian.jira",
    displayName: "Jira",
    provider: "atlassian",
    product: "jira",
    capability: "issue.sync",
    direction: "bidirectional",
    egressHosts: ["api.atlassian.com"],
    requirementIds: ["WRK-100-001"],
  }),
  pack({
    key: "atlassian.confluence",
    displayName: "Confluence",
    provider: "atlassian",
    product: "confluence",
    capability: "page.sync",
    direction: "bidirectional",
    egressHosts: ["api.atlassian.com"],
    requirementIds: ["WRK-100-001"],
  }),
  pack({
    key: "asana.work",
    displayName: "Asana",
    provider: "asana",
    product: "work",
    capability: "task.sync",
    direction: "bidirectional",
    egressHosts: ["app.asana.com"],
    requirementIds: ["WRK-100-001"],
  }),
  pack({
    key: "monday.work",
    displayName: "Monday",
    provider: "monday",
    product: "work",
    capability: "item.sync",
    direction: "bidirectional",
    egressHosts: ["api.monday.com"],
    requirementIds: ["WRK-100-001"],
  }),
  pack({
    key: "linear.issues",
    displayName: "Linear",
    provider: "linear",
    product: "issues",
    capability: "issue.sync",
    direction: "bidirectional",
    egressHosts: ["api.linear.app"],
    requirementIds: ["WRK-100-001"],
  }),
  pack({
    key: "clickup.work",
    displayName: "ClickUp",
    provider: "clickup",
    product: "work",
    capability: "task.sync",
    direction: "bidirectional",
    egressHosts: ["api.clickup.com"],
    requirementIds: ["WRK-100-001"],
  }),
  pack({
    key: "trello.boards",
    displayName: "Trello",
    provider: "trello",
    product: "boards",
    capability: "card.sync",
    direction: "bidirectional",
    egressHosts: ["api.trello.com"],
    requirementIds: ["WRK-100-001"],
  }),
  pack({
    key: "smartsheet.sheets",
    displayName: "Smartsheet",
    provider: "smartsheet",
    product: "sheets",
    capability: "row.sync",
    direction: "bidirectional",
    egressHosts: ["api.smartsheet.com"],
    requirementIds: ["WRK-100-001"],
  }),
  pack({
    key: "airtable.bases",
    displayName: "Airtable",
    provider: "airtable",
    product: "bases",
    capability: "record.sync",
    direction: "bidirectional",
    egressHosts: ["api.airtable.com"],
    requirementIds: ["WRK-100-001"],
  }),

  // WRK-100-002 — the second prioritized secondary batch.
  pack({
    key: "coda.docs",
    displayName: "Coda",
    provider: "coda",
    product: "docs",
    capability: "row.sync",
    direction: "bidirectional",
    egressHosts: ["coda.io"],
    requirementIds: ["WRK-100-002"],
  }),
  pack({
    key: "miro.boards",
    displayName: "Miro",
    provider: "miro",
    product: "boards",
    capability: "board.sync",
    direction: "read",
    egressHosts: ["api.miro.com"],
    requirementIds: ["WRK-100-002"],
  }),
  pack({
    key: "cisco.webex",
    displayName: "Webex",
    provider: "cisco",
    product: "webex",
    capability: "meeting.sync",
    direction: "read",
    egressHosts: ["webexapis.com"],
    requirementIds: ["WRK-100-002"],
  }),
  pack({
    key: "ringcentral.messaging",
    displayName: "RingCentral",
    provider: "ringcentral",
    product: "messaging",
    capability: "message.sync",
    direction: "bidirectional",
    egressHosts: ["platform.ringcentral.com"],
    requirementIds: ["WRK-100-002"],
  }),
  pack({
    key: "docusign.esignature",
    displayName: "DocuSign",
    provider: "docusign",
    product: "esignature",
    capability: "envelope.sync",
    direction: "bidirectional",
    egressHosts: ["docusign.net", "account.docusign.com"],
    requirementIds: ["WRK-100-002"],
  }),
  pack({
    key: "adobe.acrobat-sign",
    displayName: "Adobe Sign",
    provider: "adobe",
    product: "acrobat-sign",
    capability: "agreement.sync",
    direction: "bidirectional",
    egressHosts: ["api.adobesign.com"],
    requirementIds: ["WRK-100-002"],
  }),
  pack({
    key: "egnyte.content",
    displayName: "Egnyte",
    provider: "egnyte",
    product: "content",
    capability: "file.sync",
    direction: "bidirectional",
    egressHosts: ["egnyte.com"],
    requirementIds: ["WRK-100-002"],
  }),
  pack({
    key: "sharefile.content",
    displayName: "ShareFile",
    provider: "sharefile",
    product: "content",
    capability: "file.sync",
    direction: "bidirectional",
    egressHosts: ["sharefile.com"],
    requirementIds: ["WRK-100-002"],
  }),
]
