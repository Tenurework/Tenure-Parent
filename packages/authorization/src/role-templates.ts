import { INCOMPATIBLE_DUTIES, separationViolations } from "./controls"
import type { RoleDefinition } from "./model"
import { isPermissionKey, lookupPermission, type PermissionDefinition } from "./permission-catalog"

/**
 * GE-051-002 — reusable roles.
 *
 * Bible §9.2: "RBAC for reusable semantic permission bundles." Reusable is the
 * operative word. A role assembled per tenant is a role that means something
 * different at each of them, and "what can a Finance Lead do here?" stops being
 * answerable without opening that customer's configuration.
 *
 * These are templates, not grants. A template says what a bundle *is*; a grant
 * says who holds it, where, and when. Keeping them apart is what lets a tenant
 * rename the role in their own vocabulary without changing what it confers —
 * the same separation the permission catalog makes between a key and a label.
 *
 * ## Why templates are not the whole story
 *
 * A tenant may need a bundle nobody anticipated. That is a configured role, and
 * it belongs in the `platform.permissions.*` configuration domain, which is
 * still `reserved`. What is here is the platform's shipped set: the bundles
 * every system of this kind needs, so that a new tenant is usable before
 * anybody configures anything.
 */

export interface RoleTemplate extends RoleDefinition {
  /** Stable key. Tenant labels rename the display, never this. */
  key: string
  /** What this bundle is for, in a sentence an administrator can act on. */
  description: string
  /**
   * Whether this template may be granted at an org unit rather than the whole
   * tenant.
   *
   * A tenant-only role granted on a club is a role whose scope check silently
   * passes for everything under it. Saying so here means the refusal is a
   * property of the role rather than a check each call site remembers.
   */
  scopable: boolean
}

const template = (
  key: string,
  description: string,
  scopable: boolean,
  permissions: readonly string[],
): RoleTemplate => ({ key, description, scopable, permissions })

/**
 * The shipped bundles.
 *
 * Composed of catalog keys, and validated to be — a template naming a
 * permission nobody declares confers nothing while looking like it confers
 * something, which is the failure mode a bundle is most able to hide, because
 * nobody reads a list of twenty strings.
 */
export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  template(
    "unit.member",
    "Belongs to a unit: can see it, take part, and raise requests.",
    true,
    [
      "org.unit.read",
      "org.roster.read",
      "org.seat.read",
      "approvals.request.create",
      "approvals.request.read",
      "approvals.request.cancel",
      "finance.reimbursement.create",
      "events.event.read",
      "communications.message.read",
      "communications.message.create",
      "communications.thread.create",
      "communications.comment.create",
      "resources.resource.read",
      "memory.note.read",
      "search.index.query",
      "dashboard.summary.read",
    ],
  ),
  template(
    "unit.lead",
    "Runs a unit: everything a member can do, plus deciding its requests, publishing its events, and managing its roster.",
    true,
    [
      "org.unit.read",
      "org.unit.update",
      "org.roster.read",
      "org.roster.update",
      "org.seat.read",
      "org.seat.assign",
      "org.seat.release",
      "org.delegation.grant",
      "org.delegation.revoke",
      "approvals.request.create",
      "approvals.request.read",
      "approvals.request.decide",
      "approvals.request.cancel",
      "finance.reimbursement.create",
      "approvals.request.assign",
      "approvals.policy.read",
      "events.event.create",
      "events.event.read",
      "events.event.update",
      "events.event.publish",
      "events.event.cancel",
      "events.conflict.read",
      "communications.message.read",
      "communications.message.create",
      "communications.thread.create",
      "communications.announcement.create",
      "communications.announcement.publish",
      "communications.comment.create",
      "resources.resource.read",
      "memory.note.read",
      "memory.note.create",
      "search.index.query",
      "dashboard.summary.read",
    ],
  ),
  template(
    "finance.officer",
    "Handles a unit's money: budgets, the ledger behind them, and reimbursement claims.",
    true,
    [
      "org.unit.read",
      "finance.budget.read",
      "finance.budget.propose",
      "finance.budget.update",
      "finance.ledger.read",
      "finance.ledger.post",
      "finance.reimbursement.create",
      "finance.reimbursement.read",
      "finance.report.read",
      "approvals.request.create",
      "approvals.request.read",
      "search.index.query",
      "dashboard.summary.read",
    ],
  ),
  template(
    "finance.approver",
    "Approves money: budgets into force and reimbursement claims for payment. Deliberately cannot file a claim.",
    true,
    [
      "finance.budget.read",
      "finance.budget.approve",
      "finance.ledger.read",
      "finance.reimbursement.read",
      "finance.reimbursement.approve",
      "finance.report.read",
      "finance.report.export",
      "approvals.request.read",
      "approvals.request.decide",
    ],
  ),
  template(
    "oversight.staff",
    "Oversees units on the institution's behalf: sees across them, decides at the second gate, and reads the audit trail.",
    false,
    [
      "org.unit.read",
      "org.unit.create",
      "org.unit.update",
      "org.unit.archive",
      "org.roster.read",
      "org.seat.read",
      "org.seat.assign",
      "org.seat.release",
      "approvals.request.read",
      "approvals.request.decide",
      "approvals.policy.read",
      "events.event.read",
      "events.event.publish",
      "events.event.cancel",
      "events.conflict.read",
      "finance.budget.read",
      "finance.ledger.read",
      "finance.report.read",
      "finance.report.export",
      "finance.reimbursement.read",
      "finance.reimbursement.approve",
      "resources.resource.read",
      "resources.resource.create",
      "resources.resource.update",
      "resources.resource.archive",
      "memory.note.read",
      "admin.console.read",
      "admin.audit.read",
      "identity.membership.read",
      "search.index.query",
      "dashboard.summary.read",
    ],
  ),
  template(
    "oversight.advisor",
    "Advises a unit from outside it: sees its work and its money, decides nothing.",
    true,
    [
      "org.unit.read",
      "org.roster.read",
      "org.seat.read",
      "approvals.request.read",
      "events.event.read",
      "finance.budget.read",
      "finance.ledger.read",
      "resources.resource.read",
      "memory.note.read",
      "dashboard.summary.read",
    ],
  ),
  // ── institution oversight ─────────────────────────────────────────────────
  //
  // GE-051-005. Three templates for the three institution roles, and they are
  // separate from the `oversight.*` pair above on purpose: those are club seats
  // somebody holds inside a unit, these are the office that oversees every unit.
  // Reusing `oversight.advisor` for the institution's Advisor would have been
  // tidier and wrong — a club's advisory seat is read-only, and an institution
  // Advisor may contribute to any club today.
  //
  // Each set is derived from the predicates in `apps/web/src/lib/rbac.ts` rather
  // than from what the roles ought to confer, and
  // `institution-equivalence.test.ts` compares the two answer by answer. This is
  // a refactor: if it changes what anybody may do, it is a bug.
  template(
    "institution.advisor",
    "Advises across the institution: sees every unit, takes part, and sets no policy.",
    false,
    [
      "org.unit.read",
      "org.unit.update",
      "org.roster.read",
      "org.seat.read",
      "approvals.request.create",
      "approvals.request.read",
      "approvals.request.decide",
      "approvals.policy.read",
      "events.event.create",
      "events.event.read",
      "events.conflict.read",
      "communications.message.read",
      "communications.message.create",
      "communications.thread.create",
      "communications.comment.create",
      "finance.budget.read",
      "finance.ledger.read",
      "finance.report.read",
      "resources.resource.read",
      "memory.note.read",
      "memory.note.create",
      "search.index.query",
      "dashboard.summary.read",
    ],
  ),
  template(
    "institution.staff",
    "Runs the oversight office day to day: everything an Advisor does, plus the resource board.",
    false,
    [
      "org.unit.read",
      "org.unit.update",
      "org.roster.read",
      "org.seat.read",
      "approvals.request.create",
      "approvals.request.read",
      "approvals.request.decide",
      "approvals.policy.read",
      "events.event.create",
      "events.event.read",
      "events.conflict.read",
      "communications.message.read",
      "communications.message.create",
      "communications.thread.create",
      "communications.comment.create",
      "finance.budget.read",
      "finance.ledger.read",
      "finance.report.read",
      "resources.resource.read",
      "resources.resource.create",
      "resources.resource.update",
      "resources.resource.archive",
      "memory.note.read",
      "memory.note.create",
      "search.index.query",
      "dashboard.summary.read",
    ],
  ),
  template(
    "institution.director",
    "Accountable for the oversight office: everything Staff does, plus rosters, budgets and the second approval gate.",
    false,
    [
      "org.unit.read",
      "org.unit.create",
      "org.unit.update",
      "org.unit.archive",
      "org.roster.read",
      "org.roster.update",
      "org.seat.read",
      "org.seat.assign",
      "org.seat.release",
      "approvals.request.create",
      "approvals.request.read",
      "approvals.request.decide",
      "approvals.policy.read",
      "events.event.create",
      "events.event.read",
      "events.event.publish",
      "events.event.cancel",
      "events.conflict.read",
      "communications.message.read",
      "communications.message.create",
      "communications.thread.create",
      "communications.comment.create",
      "communications.announcement.create",
      "communications.announcement.publish",
      "finance.budget.read",
      "finance.budget.update",
      "finance.ledger.read",
      "finance.report.read",
      "resources.resource.read",
      "resources.resource.create",
      "resources.resource.update",
      "resources.resource.archive",
      "memory.note.read",
      "memory.note.create",
      "admin.console.read",
      "admin.audit.read",
      "search.index.query",
      "dashboard.summary.read",
    ],
  ),
  template(
    "platform.administrator",
    "Administers the system itself: configuration, releases, memberships, and overrides.",
    false,
    [
      "admin.console.read",
      "admin.override.execute",
      "admin.audit.read",
      "identity.membership.read",
      "identity.membership.invite",
      "identity.membership.suspend",
      "identity.connection.read",
      "config.setting.read",
      "config.setting.update",
      "config.release.promote",
    ],
  ),
  // Split out of the administrator on purpose, by the duties matrix rather than
  // by taste: `sod.configureIdentityAndAdministerMembership` says whoever
  // decides which identity provider is trusted must not also be able to add the
  // accounts it vouches for. The bundle that had both was the first thing the
  // matrix caught, and splitting it is what the control is for — the
  // alternative was an exemption, and an exemption mechanism is how a matrix
  // stops meaning anything.
  template(
    "identity.administrator",
    "Decides how this system federates identity, and nothing about who is in it.",
    false,
    ["identity.connection.read", "identity.connection.configure", "identity.membership.read", "admin.audit.read"],
  ),
]

const BY_KEY: ReadonlyMap<string, RoleTemplate> = new Map(ROLE_TEMPLATES.map((r) => [r.key, r]))

export function lookupRoleTemplate(key: string): RoleTemplate | null {
  return BY_KEY.get(key) ?? null
}

/** Every permission this template confers, resolved. Unknown keys are dropped. */
export function permissionsOfTemplate(key: string): readonly PermissionDefinition[] {
  const found = BY_KEY.get(key)
  if (!found) return []
  return found.permissions
    .map((p) => lookupPermission(p))
    .filter((p): p is PermissionDefinition => p !== null)
}

/**
 * Everything wrong with a set of templates, as sentences.
 *
 * The uncomfortable one is the last: a template that confers nothing another
 * does not already confer, and is not conferred by any other, is a bundle
 * nobody needs a name for. It is left as a problem rather than silently
 * tolerated, because role sprawl is what makes an access review unreadable, and
 * it always arrives one harmless-looking template at a time.
 */
export function validateRoleTemplates(
  templates: readonly RoleTemplate[] = ROLE_TEMPLATES,
): readonly string[] {
  const problems: string[] = []
  const seen = new Set<string>()

  for (const t of templates) {
    const where = `Role template "${t.key}"`
    if (seen.has(t.key)) problems.push(`${where} is declared twice.`)
    seen.add(t.key)

    if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(t.key)) {
      problems.push(`${where} is not a dotted lower-case key.`)
    }
    if (t.description.trim().length < 20 || !t.description.trim().endsWith(".")) {
      problems.push(`${where} has no usable description; an administrator has to act on it.`)
    }
    if (t.permissions.length === 0) {
      problems.push(`${where} confers nothing.`)
    }

    const unknown = t.permissions.filter((p) => !isPermissionKey(p))
    if (unknown.length > 0) {
      problems.push(
        `${where} confers ${unknown.map((u) => `"${u}"`).join(", ")}, which the permission ` +
          `catalog does not declare. A bundle naming a permission nobody declares confers ` +
          `nothing while looking like it confers something.`,
      )
    }
    if (new Set(t.permissions).size !== t.permissions.length) {
      problems.push(`${where} lists a permission twice.`)
    }
  }

  // Separation of duties, read from the shipped matrix rather than restated
  // here. Two lists of incompatible pairs is two answers to "may one person do
  // both", and the second one is always the one nobody remembered to update.
  for (const t of templates) {
    for (const violation of separationViolations(t.permissions, INCOMPATIBLE_DUTIES)) {
      problems.push(`Role template "${t.key}" violates ${violation.id}: ${violation.detail}`)
    }
  }

  return problems
}
