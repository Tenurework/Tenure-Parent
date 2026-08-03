import { ModuleCatalog, type ModuleManifest } from "@tenure/module-runtime"

/**
 * The module catalog.
 *
 * These describe capability the application already has. That is deliberate and
 * is the honest order to do it in: a manifest for a module that does not exist
 * declares nothing anyone can check, whereas a manifest over working code is
 * immediately falsifiable — if `events` claims `/calendar` and there is no
 * calendar route, a test says so.
 *
 * What each manifest currently carries is what something reads: lifecycle,
 * dependencies, incompatibilities, entitlement, permissions, navigation. It does
 * not carry workflow actions, form components or integration hooks, because
 * those engines do not exist yet and a declaration nothing validates is worse
 * than no declaration.
 *
 * `organizations` is the base every other module depends on, because every one
 * of them hangs its records off an organization.
 */

const organizations: ModuleManifest = {
  key: "organizations",
  version: "1.0.0",
  name: "Organizations",
  description: "The organizations themselves, their rosters, and the seats people hold on them.",
  lifecycle: "available",
  permissions: ["org.unit.read", "org.unit.update", "org.roster.read", "org.roster.update"],
  navigation: [
    {
      id: "organizations.list",
      label: "All Clubs",
      href: "/orgs",
      section: "Community",
      sectionOrder: 20,
      order: 20,
      icon: "Building2",
    },
  ],
}

const feed: ModuleManifest = {
  key: "feed",
  version: "1.0.0",
  name: "Community feed",
  description: "Announcements and cross-organization posts.",
  lifecycle: "available",
  dependsOn: ["organizations"],
  permissions: ["communications.announcement.create", "communications.announcement.publish", "communications.comment.create"],
  navigation: [
    {
      id: "feed.home",
      label: "Community Feed",
      href: "/feed",
      section: "Community",
      sectionOrder: 20,
      order: 10,
      icon: "Newspaper",
    },
  ],
}

const messaging: ModuleManifest = {
  key: "messaging",
  version: "1.0.0",
  name: "Messaging",
  description: "Direct and group conversations, scoped to the organizations people belong to.",
  lifecycle: "available",
  dependsOn: ["organizations"],
  permissions: ["communications.message.create", "communications.message.read", "communications.thread.create"],
  navigation: [
    {
      id: "messaging.inbox",
      label: "Messages",
      href: "/messages",
      section: "Community",
      sectionOrder: 20,
      order: 30,
      icon: "MessageSquare",
    },
  ],
}

const approvals: ModuleManifest = {
  key: "approvals",
  version: "1.0.0",
  name: "Requests and approvals",
  description: "Multi-gate approval requests with delegation and an audited decision trail.",
  lifecycle: "available",
  dependsOn: ["organizations"],
  permissions: ["approvals.request.create", "approvals.request.read", "approvals.request.decide", "approvals.request.cancel", "approvals.request.assign", "approvals.policy.read"],
  navigation: [
    {
      id: "approvals.inbox",
      label: "Approvals",
      href: "/approvals",
      section: "Operations",
      sectionOrder: 30,
      order: 10,
      icon: "CheckCircle",
    },
  ],
}

const events: ModuleManifest = {
  key: "events",
  version: "1.0.0",
  name: "Events and calendar",
  description: "Event scheduling, conflict detection and a subscribable calendar.",
  lifecycle: "available",
  dependsOn: ["organizations"],
  permissions: ["events.event.create", "events.event.read", "events.event.update", "events.event.publish", "events.event.cancel", "events.conflict.read"],
  navigation: [
    {
      id: "events.calendar",
      label: "Calendar",
      href: "/calendar",
      section: "Operations",
      sectionOrder: 30,
      order: 20,
      icon: "Calendar",
    },
  ],
}

const resources: ModuleManifest = {
  key: "resources",
  version: "1.0.0",
  name: "Board resources",
  description: "The staff office's published forms, guides and policies, targeted by seat.",
  lifecycle: "available",
  dependsOn: ["organizations"],
  permissions: ["resources.resource.create", "resources.resource.read", "resources.resource.update", "resources.resource.archive"],
  navigation: [
    {
      id: "resources.library",
      label: "Resources",
      href: "/resources",
      section: "Knowledge",
      sectionOrder: 40,
      order: 10,
      icon: "BookOpen",
    },
  ],
}

const search: ModuleManifest = {
  key: "search",
  version: "1.0.0",
  name: "Tenure AI",
  description: "Assisted search and drafting across everything the principal can already see.",
  lifecycle: "available",
  dependsOn: ["organizations"],
  permissions: ["search.index.query"],
  navigation: [
    {
      id: "search.assistant",
      label: "Tenure AI",
      href: "/search",
      section: "Knowledge",
      sectionOrder: 40,
      order: 20,
      icon: "TenureAIMark",
      // Opens the assistant panel rather than navigating. The behaviour lives in
      // the UI; the manifest only names it, so this package renders nothing.
      action: "openAiPanel",
    },
  ],
}

const memory: ModuleManifest = {
  key: "memory",
  version: "1.0.0",
  name: "Organizational memory",
  description: "Knowledge cards and documents that outlive the officers who wrote them.",
  lifecycle: "available",
  dependsOn: ["organizations"],
  permissions: ["memory.note.create", "memory.note.read", "memory.note.read_sensitive"],
}

const budgeting: ModuleManifest = {
  key: "budgeting",
  version: "1.0.0",
  name: "Budgeting",
  description: "Budgets, lines, actuals and the portfolio roll-up across organizations.",
  lifecycle: "available",
  dependsOn: ["organizations"],
  requiresEntitlement: "finance",
  permissions: ["finance.budget.read", "finance.budget.propose", "finance.budget.approve", "finance.budget.update", "finance.ledger.read", "finance.ledger.post", "finance.ledger.export", "finance.report.read", "finance.report.export"],
  navigation: [
    {
      id: "budgeting.reports",
      label: "Reports",
      href: "/reports",
      section: "Overview",
      sectionOrder: 10,
      order: 20,
      icon: "BarChart3",
      requiresCapability: "finance.report.read",
    },
  ],
}

const reimbursements: ModuleManifest = {
  key: "reimbursements",
  version: "1.0.0",
  name: "Reimbursements",
  description: "Three-way matched reimbursement claims that post to the ledger on approval.",
  lifecycle: "available",
  dependsOn: ["organizations", "approvals", "budgeting"],
  requiresEntitlement: "finance",
  permissions: ["finance.reimbursement.create", "finance.reimbursement.read", "finance.reimbursement.approve"],
}

const dashboard: ModuleManifest = {
  key: "dashboard",
  version: "1.0.0",
  name: "Dashboard",
  description: "The landing surface. Always on; every system has a front door.",
  lifecycle: "available",
  navigation: [
    {
      id: "dashboard.home",
      label: "Dashboard",
      href: "/dashboard",
      section: "Overview",
      sectionOrder: 10,
      order: 10,
      icon: "LayoutDashboard",
    },
  ],
}

const administration: ModuleManifest = {
  key: "administration",
  version: "1.0.0",
  name: "Administration",
  description: "The staff office's console: people, organizations, overrides and the audit trail.",
  lifecycle: "available",
  dependsOn: ["organizations"],
  permissions: ["admin.console.read", "admin.override.execute"],
  navigation: [
    {
      id: "administration.console",
      label: "Admin Console",
      href: "/admin",
      section: "Administration",
      sectionOrder: 5,
      order: 10,
      icon: "ShieldCheck",
      requiresCapability: "admin.console.read",
    },
  ],
}

export const MODULES: readonly ModuleManifest[] = [
  dashboard,
  organizations,
  feed,
  messaging,
  approvals,
  events,
  resources,
  search,
  memory,
  budgeting,
  reimbursements,
  administration,
]

/** Built once. Validates every manifest and every cross-reference between them. */
export const MODULE_CATALOG = ModuleCatalog.of(MODULES)
