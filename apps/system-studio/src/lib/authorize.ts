/**
 * STUDIO-020-006 — the one place the Studio decides whether an operator may do
 * a thing.
 *
 * Before this, the console's entire server-side authorization was
 * `isOperator(email)`: a membership test against an environment allowlist,
 * repeated verbatim at nine call sites. No resource, no action, no environment,
 * no account and no region entered any decision, so every listed operator could
 * advance any tenant's lifecycle and publish any tenant's configuration in any
 * environment — and the surfaces a Support Engineer saw were byte-identical to
 * a Platform Super Admin's.
 *
 * `authorizeOperator` takes all six axes the bible names, denies by default,
 * and returns a decision an audit line can be written from. Every page and
 * every server action in `apps/system-studio` goes through it; `isOperator`
 * remains as the authentication half — "do we know who this is" — which is what
 * the sign-in provider and the approver lookup want.
 *
 * ## The residency check
 *
 * A decision is refused when the account or region it targets is not the one
 * this control plane resolved for itself. That is the cheap, local half of
 * GE-010-007: the Studio holds credentials for exactly one account in one
 * region, so a request naming another is either a bug or an attempt, and in
 * both cases the honest answer is no. It is not a substitute for an IAM
 * boundary — it is the check that fires before the SDK is ever reached, and
 * it is the one that can be tested without an AWS account.
 *
 * ## Why the command table exists
 *
 * A call site that passes a resource and a verb inline is a call site somebody
 * can quietly change from `write` to `read`. `STUDIO_COMMANDS` names each
 * command once, so what a command is allowed to be is reviewable in one screen
 * — and a test that asserts an Auditor cannot publish reds when the table
 * demotes `configuration.publish` to a read.
 */

import {
  OPERATOR_GRANTS,
  TENANT_SCOPED_RESOURCES,
  mayAct,
  operatorConfigProblems,
  roleOf,
  type OperatorPermission,
  type OperatorResource,
  type OperatorRole,
  type OperatorVerb,
} from "./operators"

/**
 * Why a decision went the way it did.
 *
 * Every value is reachable, and the spec beside this file asserts each one is
 * produced by a real request rather than merely declared. A reason nothing can
 * emit is the shape of `MEMBERSHIP_SUSPENDED` in the platform architecture —
 * a deny reason with no code path, shipped for years.
 */
export const AUTHORIZATION_REASONS = [
  "GRANTED",
  "CONFIG_UNUSABLE",
  "NO_PRINCIPAL",
  "NO_ROLE",
  "ESTATE_UNRESOLVED",
  "ACCOUNT_OUT_OF_SCOPE",
  "REGION_OUT_OF_SCOPE",
  "ENVIRONMENT_MISMATCH",
  "TENANT_SCOPE_MISSING",
  "PERMISSION_NOT_GRANTED",
] as const

export type AuthorizationReason = (typeof AUTHORIZATION_REASONS)[number]

/**
 * The account, region and partition this control plane is actually running in,
 * or null where it cannot say.
 *
 * Read from the same environment variables `fleet()` in `./cells` reads, and
 * with NO fallback literal — a `?? "us-east-1"` here would be an estate fact
 * compiled into the product, which `tests/security/no-hardcoded-estate.test.mjs`
 * forbids for exactly the reason that matters here: a console that assumes it is
 * in `us-east-1` would authorize a mutation against a tenant in `eu-west-1` on
 * the grounds that both are "the region we resolved".
 *
 * Null therefore means "this process cannot corroborate a target account", and
 * `authorizeOperator` refuses a request that names one — rather than passing it,
 * which is what a default would silently do.
 *
 * Duplicated from `./cells` rather than imported because that module is
 * `server-only`, and this one has to be callable from a plain Node test and
 * from every server action.
 */
export interface ControlPlaneIdentity {
  accountId: string | null
  region: string | null
  partition: string | null
  /**
   * Never null. An unset deployment environment resolves to `production`,
   * which is the SAFE direction: treating an unlabelled deployment as a sandbox
   * is how a staging-shaped guard ends up in front of a live estate.
   */
  environment: string
}

export function controlPlaneIdentity(env: NodeJS.ProcessEnv = process.env): ControlPlaneIdentity {
  const pick = (name: string): string | null => {
    const value = env[name]
    return value && value.trim() ? value.trim() : null
  }
  return {
    accountId: pick("AWS_ACCOUNT_ID"),
    region: pick("AWS_REGION"),
    partition: pick("AWS_PARTITION"),
    environment: pick("DEPLOY_ENVIRONMENT") ?? "production",
  }
}

/**
 * A revision identifier for the policy a decision was made under.
 *
 * Derived from the grant table itself, never written down. A constant here is
 * exactly the defect this platform has already shipped once: a frozen
 * `policyRevision` left a 3448-test suite green while the policy underneath it
 * changed, and the mutation was reported as caught. Editing `OPERATOR_GRANTS`
 * changes this string, and the spec proves that by recomputing it over a
 * modified table.
 *
 * FNV-1a rather than a cryptographic digest: this identifies a revision in an
 * audit line, it does not authenticate one, and a pure function keeps this
 * module importable from anywhere.
 */
export function policyRevisionOf(
  grants: Readonly<Record<string, readonly string[]>>,
): string {
  const canonical = Object.keys(grants)
    .sort()
    .map((role) => `${role}=${[...grants[role]].sort().join("|")}`)
    .join(";")

  let hash = 0x811c9dc5
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `op-${hash.toString(16).padStart(8, "0")}`
}

export const POLICY_REVISION = policyRevisionOf(OPERATOR_GRANTS)

export interface OperatorAuthorizationRequest {
  /** The signed-in operator's address, or whatever the session had. */
  principalId: string | null | undefined
  resource: OperatorResource
  action: OperatorVerb
  /**
   * The tenant this is about. Required — as in, denied without — for every
   * resource in `TENANT_SCOPED_RESOURCES`.
   */
  tenantId?: string | null
  /**
   * The three axes that are not about the principal at all.
   *
   * REQUIRED fields, and nullable rather than optional. An OPTIONAL axis a
   * caller forgets to set is invisible to `tsc` — it compiles, every test that
   * builds its own fixture passes, and a request nobody scoped is authorized at
   * runtime. Required-and-nullable makes "there is no target account here" a
   * thing the caller had to write down, which is a different statement from
   * having said nothing.
   *
   * `null` means the request names no such target, so the axis does not apply.
   * A non-null value must match what `controlPlaneIdentity()` resolved, and is
   * refused when this process cannot resolve one at all.
   */
  environment: string
  accountId: string | null
  region: string | null
}

export interface OperatorAuthorizationDecision {
  allowed: boolean
  reason: AuthorizationReason
  policyRevision: string
  /** Null when the principal is unknown — which is itself the reason. */
  role: OperatorRole | null
  permission: OperatorPermission
  scope: {
    tenantId: string | null
    environment: string
    accountId: string | null
    region: string | null
  }
}

/**
 * Deny by default. Every `return` below is a refusal except the last one.
 */
export function authorizeOperator(
  request: OperatorAuthorizationRequest,
  env: NodeJS.ProcessEnv = process.env,
): OperatorAuthorizationDecision {
  const permission = `${request.resource}:${request.action}` as OperatorPermission
  const scope = {
    tenantId: request.tenantId ?? null,
    environment: request.environment,
    accountId: request.accountId,
    region: request.region,
  }

  let role: OperatorRole | null = null
  const refuse = (reason: AuthorizationReason): OperatorAuthorizationDecision => ({
    allowed: false,
    reason,
    policyRevision: POLICY_REVISION,
    role,
    permission,
    scope,
  })

  // A console whose allowlist does not parse authorizes nothing. The pages
  // already render "Not configured" for this, but a server action is a POST
  // endpoint reachable by its id and never renders a page at all.
  if (operatorConfigProblems(env).length > 0) return refuse("CONFIG_UNUSABLE")

  if (!request.principalId || !request.principalId.trim()) return refuse("NO_PRINCIPAL")

  role = roleOf(request.principalId, env)
  if (!role) return refuse("NO_ROLE")

  // The residency half, before the permission half: an operator who genuinely
  // holds `tenant.lifecycle:write` still may not exercise it against an account
  // this control plane has no business in.
  //
  // A named target this process cannot corroborate is refused rather than
  // waved through. That is the difference between "we checked and it matches"
  // and "we could not check", and a control plane that cannot tell which
  // account it is in has no basis for acting on one.
  const identity = controlPlaneIdentity(env)
  if (request.accountId !== null) {
    if (identity.accountId === null) return refuse("ESTATE_UNRESOLVED")
    if (request.accountId !== identity.accountId) return refuse("ACCOUNT_OUT_OF_SCOPE")
  }
  if (request.region !== null) {
    if (identity.region === null) return refuse("ESTATE_UNRESOLVED")
    if (request.region !== identity.region) return refuse("REGION_OUT_OF_SCOPE")
  }
  if (request.environment !== identity.environment) return refuse("ENVIRONMENT_MISMATCH")

  if (TENANT_SCOPED_RESOURCES.has(request.resource) && !scope.tenantId) {
    return refuse("TENANT_SCOPE_MISSING")
  }

  if (!mayAct(role, permission)) return refuse("PERMISSION_NOT_GRANTED")

  return {
    allowed: true,
    reason: "GRANTED",
    policyRevision: POLICY_REVISION,
    role,
    permission,
    scope,
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * The commands this console can run, and what each one is.
 *
 * One entry per page read and per server action, so "what is `publish`
 * authorized as" is a table lookup rather than an inline literal at the call
 * site. Every value below has a real caller — the file each is called from is
 * named beside it, and a command with no caller would be a permission nobody
 * checks.
 */
export const STUDIO_COMMANDS = {
  /** `src/app/page.tsx`, `src/app/platform/page.tsx` */
  "platform.read": { resource: "platform", action: "read" },
  /** `src/app/platform/cost/page.tsx` */
  "cost.read": { resource: "cost", action: "read" },
  /** `src/app/tenants/page.tsx` */
  "tenants.read": { resource: "tenant", action: "read" },
  /** `src/app/tenants/new/page.tsx`, `composeTenant` in `src/app/tenants/actions.ts` */
  "tenants.compose": { resource: "tenant", action: "write" },
  /** `adoptTenantAction` in `src/app/tenants/actions.ts` */
  "tenants.adopt": { resource: "tenant", action: "write" },
  /** `src/app/tenants/[slug]/page.tsx` */
  "tenant.lifecycle.read": { resource: "tenant.lifecycle", action: "read" },
  /** `advanceState` in `src/app/tenants/actions.ts`, and the controls that call it */
  "tenant.lifecycle.advance": { resource: "tenant.lifecycle", action: "write" },
  /** Whether a named approver may be the second pair of eyes on a lifecycle move */
  "tenant.lifecycle.approve": { resource: "tenant.lifecycle", action: "approve" },
  /** `src/app/tenants/[slug]/configuration/page.tsx` */
  "configuration.read": { resource: "tenant.configuration", action: "read" },
  /** `review` in `src/app/tenants/[slug]/configuration/actions.ts` — plans, writes nothing */
  "configuration.review": { resource: "tenant.configuration", action: "read" },
  /** `publish` in `src/app/tenants/[slug]/configuration/actions.ts` */
  "configuration.publish": { resource: "tenant.configuration", action: "write" },
  /** `rollback` in `src/app/tenants/[slug]/configuration/actions.ts` — a publication too */
  "configuration.rollback": { resource: "tenant.configuration", action: "write" },
  /** STUDIO-080-003 — the AWS console deep links on `src/app/tenants/[slug]/page.tsx` */
  "aws.console.open": { resource: "aws.console", action: "read" },
} as const satisfies Record<string, { resource: OperatorResource; action: OperatorVerb }>

export type StudioCommand = keyof typeof STUDIO_COMMANDS

export interface CommandScope {
  principalId: string | null | undefined
  tenantId?: string | null
  /**
   * The account, region and environment the command targets. Omitted means
   * this control plane's own — which is the truth for every surface that reads
   * control-plane state, and is stated rather than assumed for the tenant
   * surfaces, which pass the placement the registry recorded.
   */
  accountId?: string
  region?: string
  environment?: string
}

/** Authorize a named command. The form every call site in the app uses. */
export function authorizeCommand(
  command: StudioCommand,
  scope: CommandScope,
  env: NodeJS.ProcessEnv = process.env,
): OperatorAuthorizationDecision {
  const { resource, action } = STUDIO_COMMANDS[command]
  const identity = controlPlaneIdentity(env)
  return authorizeOperator(
    {
      principalId: scope.principalId,
      resource,
      action,
      tenantId: scope.tenantId,
      accountId: scope.accountId ?? identity.accountId,
      region: scope.region ?? identity.region,
      environment: scope.environment ?? identity.environment,
    },
    env,
  )
}

/**
 * A one-line audit record of a decision.
 *
 * STUDIO-020-012 asks for every allow AND every deny to carry actor, effective
 * role, tenant, account, environment, resource/action, policy version and
 * result. This is that line.
 *
 * The append-only store it was written ahead of now exists (STUDIO-110-005):
 * every DENY is additionally appended to the subject's hash chain by the
 * authorization helpers in `app/tenants/actions.ts` and
 * `app/tenants/[slug]/configuration/actions.ts`. This line stays because the two
 * answer different questions — a log line is what an engineer greps while an
 * incident is live, and a chained row is what an investigator can show was not
 * edited afterwards. Neither substitutes for the other.
 */
export function decisionLine(
  principalId: string | null | undefined,
  command: StudioCommand,
  decision: OperatorAuthorizationDecision,
): string {
  return [
    `actor=${principalId ?? "anonymous"}`,
    `role=${decision.role ?? "none"}`,
    `command=${command}`,
    `permission=${decision.permission}`,
    `tenant=${decision.scope.tenantId ?? "-"}`,
    // `-` rather than the string "null": a log line reading `account=null` is
    // read as an account literally called null by whoever greps it at 3am.
    `account=${decision.scope.accountId ?? "-"}`,
    `region=${decision.scope.region ?? "-"}`,
    `environment=${decision.scope.environment}`,
    `policy=${decision.policyRevision}`,
    `result=${decision.allowed ? "allow" : "deny"}`,
    `reason=${decision.reason}`,
  ].join(" ")
}
