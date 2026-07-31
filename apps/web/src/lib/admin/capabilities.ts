import type { InstitutionRole } from "@prisma/client"
import type { UserContext } from "@/lib/rbac"

/**
 * The administration capability model.
 *
 * The admin side is deliberately a different, more powerful system than the
 * club/student experience: instead of a single "is OSE?" flag, every privileged
 * operation is a named capability with a minimum admin role. Server actions
 * dispatch through `requireCapability` (see admin/guard.ts), which checks this
 * table and writes an audit row for every allow and deny — the same
 * action + permission + audit shape Jira's action framework uses. Adding a new
 * admin power is: add a capability id here, gate the action on it, render it in
 * the console.
 *
 * Roles form a strict hierarchy: Director ⊇ Staff ⊇ Advisor.
 */

export type CapabilityId =
  | "club.create"
  | "club.edit"
  | "club.archive"
  | "club.image"
  | "role.assign"
  | "role.remove"
  | "role.transfer"
  | "seat.manage"
  | "directory.manage"
  | "institution.grantRole"
  | "institution.transferRole"
  | "approval.override"
  | "event.override"
  | "content.override"
  | "budget.override"
  | "audit.view"

export interface Capability {
  id: CapabilityId
  label: string
  description: string
  /** Lowest admin role that holds this capability. */
  minRole: InstitutionRole
}

const RANK: Record<InstitutionRole, number> = {
  OSE_ADVISOR: 1,
  OSE_STAFF: 2,
  OSE_DIRECTOR: 3,
}

export const CAPABILITIES: Record<CapabilityId, Capability> = {
  "club.create": {
    id: "club.create",
    label: "Charter clubs",
    description: "Create a new club with standard board seats.",
    minRole: "OSE_DIRECTOR",
  },
  "club.edit": {
    id: "club.edit",
    label: "Edit club profiles",
    description: "Rename clubs, change category and description.",
    minRole: "OSE_STAFF",
  },
  "club.archive": {
    id: "club.archive",
    label: "Archive / reactivate clubs",
    description: "Move clubs in and out of the active roster.",
    minRole: "OSE_DIRECTOR",
  },
  "club.image": {
    id: "club.image",
    label: "Manage club images",
    description: "Set or remove a club's image.",
    minRole: "OSE_STAFF",
  },
  "role.assign": {
    id: "role.assign",
    label: "Assign roles",
    description: "Place a person from the directory into any board seat.",
    minRole: "OSE_DIRECTOR",
  },
  "role.remove": {
    id: "role.remove",
    label: "Remove roles",
    description: "End a term or revoke a role assignment.",
    minRole: "OSE_DIRECTOR",
  },
  "role.transfer": {
    id: "role.transfer",
    label: "Transfer roles",
    description: "Hand a seat from its current holder to a new person.",
    minRole: "OSE_DIRECTOR",
  },
  "seat.manage": {
    id: "seat.manage",
    label: "Manage board seats",
    description: "Add, rename, or retire the seats a club carries.",
    minRole: "OSE_DIRECTOR",
  },
  "directory.manage": {
    id: "directory.manage",
    label: "Manage the directory",
    description: "Add and edit directory people used for assignments.",
    minRole: "OSE_STAFF",
  },
  "institution.grantRole": {
    id: "institution.grantRole",
    label: "Grant OSE access",
    description: "Grant or revoke Director / Staff / Advisor access.",
    minRole: "OSE_DIRECTOR",
  },
  "institution.transferRole": {
    id: "institution.transferRole",
    label: "Transfer OSE Director role",
    description: "Start an atomic, two-party handoff of the Director role to a successor.",
    minRole: "OSE_DIRECTOR",
  },
  "approval.override": {
    id: "approval.override",
    label: "Override approvals",
    description: "Force-approve or force-reject any request institution-wide, bypassing the gates.",
    minRole: "OSE_DIRECTOR",
  },
  "event.override": {
    id: "event.override",
    label: "Override events",
    description: "Publish or cancel any club event across the institution.",
    minRole: "OSE_DIRECTOR",
  },
  "content.override": {
    id: "content.override",
    label: "Moderate content",
    description: "Archive or restore any memory record or document.",
    minRole: "OSE_STAFF",
  },
  "budget.override": {
    id: "budget.override",
    label: "Adjust budgets",
    description: "Edit any club's budget allocation and notes.",
    minRole: "OSE_DIRECTOR",
  },
  "audit.view": {
    id: "audit.view",
    label: "View the audit log",
    description: "Read the institution-wide audit trail.",
    minRole: "OSE_ADVISOR",
  },
}

/** The highest admin role this user holds at the institution, if any. */
export function adminRoleAt(ctx: UserContext, institutionId: string): InstitutionRole | null {
  const roles = ctx.institutionRoles
    .filter((m) => m.institutionId === institutionId)
    .map((m) => m.role)
  if (roles.length === 0) return null
  return roles.reduce((best, r) => (RANK[r] > RANK[best] ? r : best), roles[0])
}

/** Any admin role at all (across any institution the user belongs to). */
export function isAdmin(ctx: UserContext): boolean {
  return ctx.institutionRoles.length > 0
}

export function hasCapability(
  ctx: UserContext,
  capId: CapabilityId,
  institutionId: string
): boolean {
  const role = adminRoleAt(ctx, institutionId)
  if (!role) return false
  return RANK[role] >= RANK[CAPABILITIES[capId].minRole]
}

/** Capability ids this admin role holds — drives what the console renders. */
export function capabilitiesForRole(role: InstitutionRole): CapabilityId[] {
  return (Object.keys(CAPABILITIES) as CapabilityId[]).filter(
    (id) => RANK[role] >= RANK[CAPABILITIES[id].minRole]
  )
}

export function roleLabel(role: InstitutionRole): string {
  return { OSE_DIRECTOR: "Director", OSE_STAFF: "Staff", OSE_ADVISOR: "Advisor" }[role]
}
