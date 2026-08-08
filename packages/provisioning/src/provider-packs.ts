import type {
  CatalogLifecycle,
  ConnectorEntry,
  ProviderAuthorizationProfile,
} from "./catalogs"
import {
  NO_EVIDENCE,
  type CapabilityDirection,
  type ClauseEvidence,
  type ConnectorCapabilityStatus,
} from "./connector-capability"

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
  /**
   * WRK-040-001 — how a tenant would authorize this pack.
   *
   * `ConnectorEntry` declares this `ProviderAuthorizationProfile | null`,
   * because the Relay egress genuinely has no user-delegated flow. A provider
   * pack does not get that exemption: every one of these is an app somebody
   * installs into a workspace, so the field is NARROWED to a required profile
   * here and `tsc` names any row that has not answered. `authorizationRefusal`
   * in `catalogs.ts` then reads it at the gate — the declaration is checked, not
   * merely stored.
   */
  authorization: ProviderAuthorizationProfile
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
  /**
   * WRK-100-004. Overridable for the same reason `lifecycle` is: the day
   * somebody builds one of these, advancing its capability is a one-line edit
   * in this file, and `provider-packs-bind-requirements.test.mjs` reads it back
   * out to check the certification contract was satisfied before it moved.
   *
   * A capability status hidden inside the helper would mean the guard had
   * nothing per-pack to look at, which is how the whole file could advance at
   * once and look like it had never moved.
   */
  capabilityStatus?: ConnectorCapabilityStatus
  /** What proved it, clause by clause. `NO_EVIDENCE` is the honest default. */
  clauseEvidence?: ClauseEvidence
  /**
   * WRK-040-001. Written out per pack rather than defaulted by this helper.
   *
   * A default would make `requiresPkce` and `redirectPath` properties of the
   * helper instead of facts about the provider, and the two clauses that cannot
   * be inherited from the generic flow — the exact redirect and how the
   * returning account is verified — are exactly the two a default would erase.
   */
  authorization: ProviderAuthorizationProfile
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
        status: p.capabilityStatus ?? "PLANNED",
        // WRK-100-004. Nothing cited, for all eight clauses. `NO_EVIDENCE`
        // rather than eight empty arrays per row, and rather than an omission:
        // the clause map has no optional keys, so "nobody ran the volume suite"
        // is a stated fact instead of a shape the compiler let through.
        clauseEvidence: p.clauseEvidence ?? NO_EVIDENCE,
      },
    ],
    restrictions: {
      disclaimer:
        `Planned. No connector code, app registration, scope set, certification or provider ` +
        `review exists for ${p.displayName}. It is listed so the requirement that asks for it ` +
        `has a row, not because any part of it works.`,
    },
    requirementIds: p.requirementIds,
    authorization: p.authorization,
  }
}

/**
 * The three account-verification mechanisms, each written once.
 *
 * `pkce` is a per-pack argument rather than a constant inside these, and that
 * is the point: PKCE is a fact about what the provider's authorization server
 * supports, so a pack that cannot do it has to SAY so and be refused by
 * `authorizationRefusal` — not inherit a `true` from a helper and look
 * compliant. `requiresNonce` is not per-pack, because it is implied by the
 * mechanism: an ID-token claim that was not bound to this request proves
 * nothing about who started it, and there is no ID token in the other two.
 */
interface AuthShape {
  authorize: string
  token: string
  /** The exact path on this site the provider redirects back to. */
  redirectPath: string
  /** The field or claim carrying the account this authorization is for. */
  claim: string
  pkce: boolean
}

/** The provider returns an ID token and the account is a claim inside it. */
function oidc(p: AuthShape): ProviderAuthorizationProfile {
  return {
    authorizeEndpoint: p.authorize,
    tokenEndpoint: p.token,
    redirectPath: p.redirectPath,
    responseType: "code",
    requiresPkce: p.pkce,
    requiresNonce: true,
    accountVerification: "id-token-claim",
    verifiedAccountClaim: p.claim,
  }
}

/**
 * No ID token, so the account is established by calling the provider back and
 * reading the named field off the response.
 *
 * A genuinely different mechanism from the one above, with a different failure
 * mode — the call can be throttled, or answer for a different account than the
 * code was issued to — which is why `accountVerification` is three words rather
 * than a boolean.
 */
function oauth2(p: AuthShape): ProviderAuthorizationProfile {
  return {
    authorizeEndpoint: p.authorize,
    tokenEndpoint: p.token,
    redirectPath: p.redirectPath,
    responseType: "code",
    requiresPkce: p.pkce,
    requiresNonce: false,
    accountVerification: "userinfo-call",
    verifiedAccountClaim: p.claim,
  }
}

/**
 * The grant is made once, by an administrator, for a whole workspace, and the
 * thing verified is which workspace it was.
 */
function adminConsent(p: AuthShape): ProviderAuthorizationProfile {
  return {
    authorizeEndpoint: p.authorize,
    tokenEndpoint: p.token,
    redirectPath: p.redirectPath,
    responseType: "code",
    requiresPkce: p.pkce,
    requiresNonce: false,
    accountVerification: "admin-consent-grant",
    verifiedAccountClaim: p.claim,
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
    // `login.microsoftonline.com` is here because the authorization endpoint
    // below is on it. An authorization host absent from this list is an egress
    // nobody reviewed, and `authorizationRefusal` refuses the pack for it.
    egressHosts: ["graph.microsoft.com", "login.microsoftonline.com"],
    requirementIds: ["WRK-080-001"],
    authorization: oidc({
      authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      redirectPath: "/api/connections/microsoft.outlook-mail/callback",
      // `oid` is the immutable object id of the user in the tenant. `email` is
      // not: it is reassignable, and an account check on a reassignable value
      // is an account check that can be transferred.
      claim: "oid",
      pkce: true,
    }),
  }),

  // WRK-080-003 — Google Workspace.
  pack({
    key: "google.gmail",
    displayName: "Google Gmail",
    provider: "google",
    product: "gmail",
    capability: "message.sync",
    direction: "bidirectional",
    egressHosts: ["gmail.googleapis.com", "oauth2.googleapis.com", "accounts.google.com"],
    requirementIds: ["WRK-080-003"],
    authorization: oidc({
      authorize: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      redirectPath: "/api/connections/google.gmail/callback",
      claim: "sub",
      pkce: true,
    }),
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
    authorization: oauth2({
      authorize: "https://slack.com/oauth/v2/authorize",
      token: "https://slack.com/api/oauth.v2.access",
      redirectPath: "/api/connections/slack.workspace/callback",
      claim: "authed_user.id",
      pkce: true,
    }),
  }),
  pack({
    key: "zoom.meetings",
    displayName: "Zoom Meetings",
    provider: "zoom",
    product: "meetings",
    capability: "meeting.sync",
    direction: "read",
    egressHosts: ["api.zoom.us", "zoom.us"],
    requirementIds: ["WRK-090-002"],
    authorization: oauth2({
      authorize: "https://zoom.us/oauth/authorize",
      token: "https://zoom.us/oauth/token",
      redirectPath: "/api/connections/zoom.meetings/callback",
      claim: "id",
      pkce: true,
    }),
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
    // Notion grants at the workspace, not the person: the install is what is
    // authorized and the token answers for a bot inside one workspace.
    authorization: adminConsent({
      authorize: "https://api.notion.com/v1/oauth/authorize",
      token: "https://api.notion.com/v1/oauth/token",
      redirectPath: "/api/connections/notion.workspace/callback",
      claim: "workspace_id",
      pkce: true,
    }),
  }),
  pack({
    key: "box.content",
    displayName: "Box",
    provider: "box",
    product: "content",
    capability: "file.sync",
    direction: "bidirectional",
    egressHosts: ["api.box.com", "account.box.com"],
    requirementIds: ["WRK-090-004"],
    authorization: oauth2({
      authorize: "https://account.box.com/api/oauth2/authorize",
      token: "https://api.box.com/oauth2/token",
      redirectPath: "/api/connections/box.content/callback",
      claim: "id",
      pkce: true,
    }),
  }),

  // WRK-100-001 — the first prioritized secondary batch.
  pack({
    key: "dropbox.files",
    displayName: "Dropbox",
    provider: "dropbox",
    product: "files",
    capability: "file.sync",
    direction: "bidirectional",
    egressHosts: ["api.dropboxapi.com", "www.dropbox.com"],
    requirementIds: ["WRK-100-001"],
    authorization: oauth2({
      authorize: "https://www.dropbox.com/oauth2/authorize",
      token: "https://api.dropboxapi.com/oauth2/token",
      redirectPath: "/api/connections/dropbox.files/callback",
      claim: "account_id",
      pkce: true,
    }),
  }),
  pack({
    key: "atlassian.jira",
    displayName: "Jira",
    provider: "atlassian",
    product: "jira",
    capability: "issue.sync",
    direction: "bidirectional",
    egressHosts: ["api.atlassian.com", "auth.atlassian.com"],
    requirementIds: ["WRK-100-001"],
    authorization: oauth2({
      authorize: "https://auth.atlassian.com/authorize",
      token: "https://auth.atlassian.com/oauth/token",
      redirectPath: "/api/connections/atlassian.jira/callback",
      claim: "account_id",
      pkce: true,
    }),
  }),
  pack({
    key: "atlassian.confluence",
    displayName: "Confluence",
    provider: "atlassian",
    product: "confluence",
    capability: "page.sync",
    direction: "bidirectional",
    egressHosts: ["api.atlassian.com", "auth.atlassian.com"],
    requirementIds: ["WRK-100-001"],
    authorization: oauth2({
      authorize: "https://auth.atlassian.com/authorize",
      token: "https://auth.atlassian.com/oauth/token",
      redirectPath: "/api/connections/atlassian.confluence/callback",
      claim: "account_id",
      pkce: true,
    }),
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
    authorization: oidc({
      authorize: "https://app.asana.com/-/oauth_authorize",
      token: "https://app.asana.com/-/oauth_token",
      redirectPath: "/api/connections/asana.work/callback",
      claim: "sub",
      pkce: true,
    }),
  }),
  pack({
    key: "monday.work",
    displayName: "Monday",
    provider: "monday",
    product: "work",
    capability: "item.sync",
    direction: "bidirectional",
    egressHosts: ["api.monday.com", "auth.monday.com"],
    requirementIds: ["WRK-100-001"],
    authorization: oauth2({
      authorize: "https://auth.monday.com/oauth2/authorize",
      token: "https://auth.monday.com/oauth2/token",
      redirectPath: "/api/connections/monday.work/callback",
      claim: "user_id",
      pkce: true,
    }),
  }),
  pack({
    key: "linear.issues",
    displayName: "Linear",
    provider: "linear",
    product: "issues",
    capability: "issue.sync",
    direction: "bidirectional",
    egressHosts: ["api.linear.app", "linear.app"],
    requirementIds: ["WRK-100-001"],
    authorization: oauth2({
      authorize: "https://linear.app/oauth/authorize",
      token: "https://api.linear.app/oauth/token",
      redirectPath: "/api/connections/linear.issues/callback",
      claim: "id",
      pkce: true,
    }),
  }),
  pack({
    key: "clickup.work",
    displayName: "ClickUp",
    provider: "clickup",
    product: "work",
    capability: "task.sync",
    direction: "bidirectional",
    egressHosts: ["api.clickup.com", "app.clickup.com"],
    requirementIds: ["WRK-100-001"],
    authorization: oauth2({
      authorize: "https://app.clickup.com/api",
      token: "https://api.clickup.com/api/v2/oauth/token",
      redirectPath: "/api/connections/clickup.work/callback",
      claim: "id",
      pkce: true,
    }),
  }),
  pack({
    key: "trello.boards",
    displayName: "Trello",
    provider: "trello",
    product: "boards",
    capability: "card.sync",
    direction: "bidirectional",
    // Trello authorizes through Atlassian's OAuth 2.0 (3LO) server, not through
    // its own legacy 1.0 token flow — that one has no PKCE at all, and a pack
    // declaring it would be refused `authorization-pkce-required` rather than
    // quietly shipping a code nobody can bind to the client that started it.
    egressHosts: ["api.trello.com", "auth.atlassian.com"],
    requirementIds: ["WRK-100-001"],
    authorization: oauth2({
      authorize: "https://auth.atlassian.com/authorize",
      token: "https://auth.atlassian.com/oauth/token",
      redirectPath: "/api/connections/trello.boards/callback",
      claim: "account_id",
      pkce: true,
    }),
  }),
  pack({
    key: "smartsheet.sheets",
    displayName: "Smartsheet",
    provider: "smartsheet",
    product: "sheets",
    capability: "row.sync",
    direction: "bidirectional",
    egressHosts: ["api.smartsheet.com", "app.smartsheet.com"],
    requirementIds: ["WRK-100-001"],
    authorization: oauth2({
      authorize: "https://app.smartsheet.com/b/authorize",
      token: "https://api.smartsheet.com/2.0/token",
      redirectPath: "/api/connections/smartsheet.sheets/callback",
      claim: "id",
      pkce: true,
    }),
  }),
  pack({
    key: "airtable.bases",
    displayName: "Airtable",
    provider: "airtable",
    product: "bases",
    capability: "record.sync",
    direction: "bidirectional",
    egressHosts: ["api.airtable.com", "airtable.com"],
    requirementIds: ["WRK-100-001"],
    authorization: oauth2({
      authorize: "https://airtable.com/oauth2/v1/authorize",
      token: "https://airtable.com/oauth2/v1/token",
      redirectPath: "/api/connections/airtable.bases/callback",
      claim: "id",
      pkce: true,
    }),
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
    authorization: oauth2({
      authorize: "https://coda.io/oauth2/authorize",
      token: "https://coda.io/apis/v1/oauth2/token",
      redirectPath: "/api/connections/coda.docs/callback",
      claim: "loginId",
      pkce: true,
    }),
  }),
  pack({
    key: "miro.boards",
    displayName: "Miro",
    provider: "miro",
    product: "boards",
    capability: "board.sync",
    direction: "read",
    egressHosts: ["api.miro.com", "miro.com"],
    requirementIds: ["WRK-100-002"],
    authorization: adminConsent({
      authorize: "https://miro.com/oauth/authorize",
      token: "https://api.miro.com/v1/oauth/token",
      redirectPath: "/api/connections/miro.boards/callback",
      claim: "team_id",
      pkce: true,
    }),
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
    authorization: oauth2({
      authorize: "https://webexapis.com/v1/authorize",
      token: "https://webexapis.com/v1/access_token",
      redirectPath: "/api/connections/cisco.webex/callback",
      claim: "id",
      pkce: true,
    }),
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
    authorization: oauth2({
      authorize: "https://platform.ringcentral.com/restapi/oauth/authorize",
      token: "https://platform.ringcentral.com/restapi/oauth/token",
      redirectPath: "/api/connections/ringcentral.messaging/callback",
      claim: "owner_id",
      pkce: true,
    }),
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
    authorization: oidc({
      authorize: "https://account.docusign.com/oauth/auth",
      token: "https://account.docusign.com/oauth/token",
      redirectPath: "/api/connections/docusign.esignature/callback",
      claim: "sub",
      pkce: true,
    }),
  }),
  pack({
    key: "adobe.acrobat-sign",
    displayName: "Adobe Sign",
    provider: "adobe",
    product: "acrobat-sign",
    capability: "agreement.sync",
    direction: "bidirectional",
    egressHosts: ["api.adobesign.com", "secure.adobesign.com"],
    requirementIds: ["WRK-100-002"],
    authorization: oauth2({
      authorize: "https://secure.adobesign.com/public/oauth/v2",
      token: "https://api.adobesign.com/oauth/v2/token",
      redirectPath: "/api/connections/adobe.acrobat-sign/callback",
      claim: "id",
      pkce: true,
    }),
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
    // Egnyte authorizes on the customer's own subdomain of `egnyte.com`, which
    // a pack-level profile cannot pin: the registrable domain is what an egress
    // review can be about, and the tenant's exact host is resolved when the
    // connection is created. Stated here rather than left to be discovered by
    // whoever builds it.
    authorization: oauth2({
      authorize: "https://egnyte.com/puboauth/token",
      token: "https://egnyte.com/puboauth/token",
      redirectPath: "/api/connections/egnyte.content/callback",
      claim: "id",
      pkce: true,
    }),
  }),
  pack({
    key: "sharefile.content",
    displayName: "ShareFile",
    provider: "sharefile",
    product: "content",
    capability: "file.sync",
    direction: "bidirectional",
    egressHosts: ["sharefile.com", "secure.sharefile.com"],
    requirementIds: ["WRK-100-002"],
    authorization: oauth2({
      authorize: "https://secure.sharefile.com/oauth/authorize",
      token: "https://secure.sharefile.com/oauth/token",
      redirectPath: "/api/connections/sharefile.content/callback",
      claim: "Id",
      pkce: true,
    }),
  }),
]
