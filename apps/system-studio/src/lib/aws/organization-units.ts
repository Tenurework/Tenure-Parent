/**
 * STUDIO-010-003 — the organizational-unit hierarchy, the guardrails each unit
 * inherits, and the lifecycle an account travels through on its way out.
 *
 * > *Define OU hierarchy and inherited guardrails for Security, Infrastructure,
 * > Workloads, Suspended, Quarantine, Sandbox, and Closure lifecycle.*
 *
 * ## Why a declaration, and why it is reconciled rather than asserted
 *
 * `topology.ts` answers the sibling question — which ACCOUNTS should exist — and
 * it answers it the same way: declared data, reconciled against a live read,
 * with `UNKNOWN` for every row when the read was refused. The account list on
 * its own cannot say whether an account is *governed*, because in AWS a service
 * control policy is attached to an OU and inherited by everything beneath it. An
 * account in the right Organization and the wrong OU is an account with the
 * wrong guardrails, and nothing in a `ListAccounts` response shows that.
 *
 * So the unit of governance is the OU, and the two facts worth reconciling are
 * (1) does each declared unit exist, and (2) is it where the declaration puts
 * it — because the parent is what decides which guardrails it inherits.
 *
 * ## Inheritance is computed, never restated
 *
 * Every unit declares only the guardrails that FIRST apply at it.
 * `inheritedGuardrails` walks root → unit and unions them in order, so the
 * effective set of a child is a strict superset of its parent's. That direction
 * is the whole point of a hierarchy and it is checked rather than trusted:
 * `guardrailDefects` refuses a tree in which a unit redeclares an ancestor's
 * guardrail id, which is the one edit that can silently weaken an inherited
 * deny — the same id with a shorter `denies` list reads, in a rendered table, as
 * the guardrail still being there.
 *
 * A unit cannot "turn off" an inherited guardrail in this model because there is
 * no field with which to say it. That is deliberate: an SCP exception is a
 * decision that belongs in an ADR and a separate policy-staging unit, not in a
 * boolean on a leaf that nobody re-reads.
 *
 * ## The closure lifecycle is a graph, not a status column
 *
 * `ACCOUNT_MOVES` says which unit an account may be moved to from where, and
 * `CLOSURE` is terminal. The order matters for the reason every lifecycle in
 * this repository is a graph: `Quarantine` must not be reachable from
 * `Closure` (there is nothing left to investigate) and `Workloads` must not be
 * reachable from `Quarantine` without passing back through `Suspended`, because
 * "reinstated straight out of a security incident" is the move that should be
 * hard to make by accident.
 *
 * ## What this module does not do
 *
 * It reads and it compares. There is no `CreateOrganizationalUnit` here and
 * there cannot be: `mutate.ts` is the only place a mutation lives, the task role
 * is granted list/describe verbs only (`infrastructure/studio/iam.tf`), and
 * account vending is STUDIO-010-004's business.
 */

import { minimumStatementText } from "./capabilities"
import { denialContextFrom, resolveIdentity } from "./identity"
import {
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"

/* ---------------------------------------------------------- the declaration -- */

/** The seven units the control-plane bible names, and nothing else. */
export type OrganizationalUnitKey =
  | "security"
  | "infrastructure"
  | "workloads"
  | "sandbox"
  | "suspended"
  | "quarantine"
  | "closure"

/**
 * One guardrail, as the deny it actually is.
 *
 * `denies` holds IAM actions rather than prose because the reconciliation this
 * module is built for compares a declaration against an attached policy, and a
 * sentence cannot be compared with anything. `why` is the half a policy document
 * cannot carry: an SCP in the console is thirty lines of JSON with no record of
 * which incident it exists because of.
 */
export interface Guardrail {
  /** Unique across the whole tree. `guardrailDefects` enforces that. */
  id: string
  denies: readonly string[]
  why: string
}

export interface OrganizationalUnit {
  key: OrganizationalUnitKey
  /** The name the OU carries in AWS. Matched case-insensitively when reconciling. */
  name: string
  /** `null` means attached directly to the Organization root. */
  parent: OrganizationalUnitKey | null
  purpose: string
  /** Declared HERE. Everything above is inherited, never restated. */
  guardrails: readonly Guardrail[]
}

/**
 * The guardrails every unit inherits, because they are attached at the root.
 *
 * These four are the ones whose absence is not recoverable after the fact. An
 * account that has left the Organization cannot be pulled back by the
 * management account; a trail that was deleted has no history to restore; a root
 * user with an access key is a credential outside every session-tag,
 * permission-boundary and break-glass control this console has.
 */
export const ROOT_GUARDRAILS: readonly Guardrail[] = [
  {
    id: "deny-leave-organization",
    denies: ["organizations:LeaveOrganization"],
    why: "An account that leaves takes its resources, its data and its bill with it, and no policy in this Organization applies to it afterwards.",
  },
  {
    id: "deny-disable-evidence",
    denies: [
      "cloudtrail:StopLogging",
      "cloudtrail:DeleteTrail",
      "config:DeleteConfigurationRecorder",
      "config:StopConfigurationRecorder",
      "guardduty:DeleteDetector",
      "guardduty:DisassociateFromMasterAccount",
    ],
    why: "Evidence has to survive the incident it is evidence of. STUDIO-010-008 centralizes these; a member account able to switch them off makes the central copy an opinion.",
  },
  {
    id: "deny-root-user-credentials",
    denies: ["iam:CreateAccessKey", "iam:CreateLoginProfile"],
    why: "Only when the principal is the account root user — the one identity no permission boundary, session tag or break-glass grant in this control plane can constrain.",
  },
  {
    id: "deny-unapproved-regions",
    denies: ["ec2:RunInstances", "rds:CreateDBInstance", "s3:CreateBucket", "lambda:CreateFunction"],
    why: "Outside the regions a cell is declared in. Data residency is a placement decision (STUDIO-010-009), and a resource created in an undeclared region is a residency breach nobody chose.",
  },
]

/**
 * The tree.
 *
 * Three levels, and the third exists because of the lifecycle rather than for
 * tidiness: `Quarantine` and `Closure` are children of `Suspended` so that
 * everything true of a suspended account is automatically true of a quarantined
 * one, and the extra denies each adds are the only thing that has to be read to
 * know the difference.
 */
export const ORGANIZATIONAL_UNITS: readonly OrganizationalUnit[] = [
  {
    key: "security",
    name: "Security",
    parent: null,
    purpose:
      "The log archive and the security-tooling accounts. Read by auditors, written by services, and administered by nobody who also administers a workload.",
    guardrails: [
      {
        id: "deny-log-archive-deletion",
        denies: [
          "s3:DeleteBucket",
          "s3:DeleteBucketPolicy",
          "s3:PutBucketPolicy",
          "s3:DeleteObjectVersion",
          "s3:PutLifecycleConfiguration",
        ],
        why: "The archive is write-once for everybody, including the platform engineer holding this console. A deletable archive is a retention promise with an undo button.",
      },
      {
        id: "deny-security-service-suppression",
        denies: [
          "securityhub:DisableSecurityHub",
          "securityhub:UpdateStandardsControl",
          "guardduty:UpdateDetector",
          "access-analyzer:DeleteAnalyzer",
        ],
        why: "A finding suppressed in the account that aggregates findings disappears from every tenant's posture at once.",
      },
    ],
  },
  {
    key: "infrastructure",
    name: "Infrastructure",
    parent: null,
    purpose:
      "Network, DNS and the shared services every cell pulls from — the image store, the artifact store, the registry.",
    guardrails: [
      {
        id: "deny-network-perimeter-change",
        denies: [
          "ec2:AttachInternetGateway",
          "ec2:CreateInternetGateway",
          "ec2:CreateVpcPeeringConnection",
          "ec2:AcceptVpcPeeringConnection",
          "ec2:DeleteFlowLogs",
        ],
        why: "The address plan and what may reach it are decided once, in IaC. A peering connection made by hand is a route between two tenants that no diagram shows.",
      },
    ],
  },
  {
    key: "workloads",
    name: "Workloads",
    parent: null,
    purpose:
      "One account per production or staging cell, so a blast radius is an account boundary rather than a tag.",
    guardrails: [
      {
        id: "deny-unmanaged-identity",
        denies: ["iam:CreateUser", "iam:CreateAccessKey", "iam:CreateSAMLProvider"],
        why: "Access to a workload account is an Identity Center permission set with a session tag and an expiry. A long-lived IAM user is the credential STUDIO-000-009 exists to find.",
      },
      {
        id: "deny-tenant-data-egress",
        denies: [
          "s3:PutBucketPublicAccessBlock",
          "s3:PutAccountPublicAccessBlock",
          "rds:ModifyDBInstance",
          "backup:DeleteBackupVault",
        ],
        why: "Only the arms that make tenant data public or unrecoverable — a bucket opened to the internet, an instance made publicly accessible, a vault deleted with its recovery points.",
      },
    ],
  },
  {
    key: "sandbox",
    name: "Sandbox",
    parent: null,
    purpose:
      "Detached experimentation with its own budget. No route to a tenant network and no tenant data, which is why it is an account rather than a VPC.",
    guardrails: [
      {
        id: "deny-tenant-data-in-sandbox",
        denies: [
          "ec2:CreateVpcPeeringConnection",
          "ec2:CreateTransitGatewayVpcAttachment",
          "ram:AcceptResourceShareInvitation",
        ],
        why: "A sandbox that can reach a tenant network is a production account with no change control. The isolation is the reason the account is allowed to be permissive at all.",
      },
    ],
  },
  {
    key: "suspended",
    name: "Suspended",
    parent: null,
    purpose:
      "An account that has stopped serving and has not been decided about. Nothing may be created; everything already there is still readable, because the decision that follows needs the evidence.",
    guardrails: [
      {
        id: "deny-new-spend",
        denies: [
          "ec2:RunInstances",
          "ecs:CreateService",
          "rds:CreateDBInstance",
          "lambda:CreateFunction",
          "elasticache:CreateCacheCluster",
        ],
        why: "A suspended account with a running bill is the state operators discover from an invoice. Creation is denied and existing resources are left alone, so the residual charge is a fact somebody can read rather than a surprise.",
      },
    ],
  },
  {
    key: "quarantine",
    name: "Quarantine",
    parent: "suspended",
    purpose:
      "A compromised or suspected-compromised account, isolated for forensics. Everything Suspended denies, plus every path by which an attacker or a well-meaning engineer could destroy the evidence.",
    guardrails: [
      {
        id: "deny-evidence-destruction-in-quarantine",
        denies: [
          "ec2:TerminateInstances",
          "ec2:DeleteSnapshot",
          "rds:DeleteDBInstance",
          "rds:DeleteDBSnapshot",
          "s3:DeleteObject",
          "logs:DeleteLogGroup",
          "kms:ScheduleKeyDeletion",
        ],
        why: "The instance somebody wants to terminate during an incident is the disk image the investigation needs. Deletion is denied until the account leaves Quarantine, not until somebody says the incident is over.",
      },
      {
        id: "deny-quarantine-credential-issue",
        denies: ["sts:AssumeRole", "iam:UpdateAssumeRolePolicy", "iam:AttachRolePolicy"],
        why: "Except for the forensic role named in the incident runbook. Re-entry into a quarantined account is a two-person decision, and an unconstrained AssumeRole is how it becomes a one-person one.",
      },
    ],
  },
  {
    key: "closure",
    name: "Closure",
    parent: "suspended",
    purpose:
      "An account whose data has been exported or purged and whose closure is being executed. It holds nothing a tenant would ask for, and the only remaining actions are billing settlement and the closure itself.",
    guardrails: [
      {
        id: "deny-everything-but-settlement",
        denies: [
          "ec2:*",
          "ecs:*",
          "rds:*",
          "s3:PutObject",
          "lambda:*",
          "dynamodb:*",
          "sts:AssumeRole",
        ],
        why: "Only billing, Cost Explorer and the closure call itself remain permitted. An account being closed that can still start a service is an account whose final invoice nobody can predict, and STUDIO-100-008 has to wait for a settlement window it can trust.",
      },
    ],
  },
]

const BY_KEY: ReadonlyMap<OrganizationalUnitKey, OrganizationalUnit> = new Map(
  ORGANIZATIONAL_UNITS.map((unit) => [unit.key, unit]),
)

export function organizationalUnit(key: OrganizationalUnitKey): OrganizationalUnit {
  const unit = BY_KEY.get(key)
  if (!unit) {
    throw new Error(`No organizational unit is declared for ${JSON.stringify(key)}.`)
  }
  return unit
}

/**
 * Root → unit, inclusive of the unit itself.
 *
 * Throws on a cycle rather than looping. A cycle here is a typo in a `parent`
 * and it would otherwise hang a page render, which is a harder defect to read
 * than an exception naming the two units involved.
 */
export function ancestry(key: OrganizationalUnitKey): readonly OrganizationalUnit[] {
  const chain: OrganizationalUnit[] = []
  const seen = new Set<OrganizationalUnitKey>()
  let cursor: OrganizationalUnitKey | null = key
  while (cursor) {
    if (seen.has(cursor)) {
      throw new Error(
        `The organizational-unit hierarchy has a cycle at ${cursor}: ${[...seen].join(" → ")} → ${cursor}. ` +
          `A cycle means no unit has a defined inherited guardrail set.`,
      )
    }
    seen.add(cursor)
    const unit = organizationalUnit(cursor)
    chain.unshift(unit)
    cursor = unit.parent
  }
  return chain
}

/**
 * Every guardrail in force at a unit, root-first.
 *
 * Root guardrails come first because they are attached highest, and the order is
 * what a rendered table shows — an operator reading the effective policy of
 * `Quarantine` reads it in the order AWS evaluates the attachments.
 */
export function inheritedGuardrails(key: OrganizationalUnitKey): readonly Guardrail[] {
  return [...ROOT_GUARDRAILS, ...ancestry(key).flatMap((unit) => unit.guardrails)]
}

/** How many distinct actions are denied at a unit. Never decreases downward. */
export function deniedActionCount(key: OrganizationalUnitKey): number {
  return new Set(inheritedGuardrails(key).flatMap((g) => g.denies)).size
}

/**
 * Everything wrong with the declaration itself.
 *
 * Not a boolean and not a throw at module load: this runs in a test and on the
 * page, so a tree that has gone wrong is reported as a defect with a sentence
 * rather than a blank console. An empty array is the only passing answer.
 */
export function guardrailDefects(
  units: readonly OrganizationalUnit[] = ORGANIZATIONAL_UNITS,
  rootGuardrails: readonly Guardrail[] = ROOT_GUARDRAILS,
): readonly string[] {
  const defects: string[] = []
  const owner = new Map<string, string>()

  for (const guardrail of rootGuardrails) {
    if (owner.has(guardrail.id)) {
      defects.push(`The root declares ${guardrail.id} twice.`)
      continue
    }
    owner.set(guardrail.id, "root")
  }

  for (const unit of units) {
    for (const guardrail of unit.guardrails) {
      const held = owner.get(guardrail.id)
      if (held) {
        // The redeclaration case, which is the one that can weaken a deny: the
        // id still appears in the effective list, so a table reads as though the
        // guardrail is present while the actions it names have changed.
        defects.push(
          `${unit.key} redeclares guardrail ${guardrail.id}, which ${held} already declares. ` +
            `A child may add a guardrail and may never restate one: the same id with a different ` +
            `deny list renders as the inherited guardrail while no longer being it.`,
        )
        continue
      }
      owner.set(guardrail.id, unit.key)
      if (guardrail.denies.length === 0) {
        defects.push(`${unit.key} declares guardrail ${guardrail.id} with nothing denied.`)
      }
    }
    if (unit.parent !== null && !units.some((u) => u.key === unit.parent)) {
      defects.push(`${unit.key} names parent ${unit.parent}, which is not a declared unit.`)
    }
  }

  return defects
}

/* -------------------------------------------------------- closure lifecycle -- */

/**
 * Where an account in each unit may be moved to.
 *
 * `closure` is terminal, and `quarantine` does not reach `workloads`: an account
 * coming out of an incident goes back to `Suspended`, where reinstatement is a
 * separate decision with its own approval. Collapsing those two moves into one
 * is how an account is reinstated by whoever closed the ticket.
 */
export const ACCOUNT_MOVES: Readonly<
  Record<OrganizationalUnitKey, readonly OrganizationalUnitKey[]>
> = {
  security: ["suspended"],
  infrastructure: ["suspended"],
  workloads: ["suspended", "quarantine"],
  sandbox: ["suspended", "quarantine"],
  suspended: ["workloads", "sandbox", "quarantine", "closure"],
  quarantine: ["suspended"],
  closure: [],
}

export function canMoveAccount(
  from: OrganizationalUnitKey,
  to: OrganizationalUnitKey,
): boolean {
  return ACCOUNT_MOVES[from].includes(to)
}

/** The unit an account cannot leave. */
export const TERMINAL_UNIT: OrganizationalUnitKey = "closure"

/* ------------------------------------------------------------- the live read -- */

/** One OU as the Organizations API returns it. */
export interface ObservedOrganizationalUnit {
  id: string
  name: string
  /** The root id or another OU id. Never blank — the reader drops an OU without one. */
  parentId: string
}

export interface ObservedOrganizationTree {
  rootId: string
  units: readonly ObservedOrganizationalUnit[]
  /** OU id → the service control policies attached AT it, by name. */
  policiesByUnitId: Readonly<Record<string, readonly string[]>>
  /**
   * OU ids whose attached policies could not be listed.
   *
   * Separate from an empty array in `policiesByUnitId`, for the reason the whole
   * `AwsRead` union exists: "no SCP is attached here" is a finding and "this
   * engine may not call `ListPoliciesForTarget`" is not.
   */
  policiesUnreadable: readonly string[]
}

interface ListRootsResponse {
  Roots?: Array<{ Id?: string }>
  NextToken?: string
}

interface ListOusResponse {
  OrganizationalUnits?: Array<{ Id?: string; Name?: string }>
  NextToken?: string
}

interface ListPoliciesResponse {
  Policies?: Array<{ Name?: string; Id?: string }>
  NextToken?: string
}

/**
 * Read the actual OU tree, depth-first from the root.
 *
 * One `AwsRead` for the whole tree rather than one per call: an operator cannot
 * act on "the third `ListOrganizationalUnitsForParent` was throttled", and a
 * partially-walked tree reported as ACTUAL would show real OUs as missing. If
 * any structural call fails the whole read fails, and says which action did it.
 *
 * Per-OU policy listing is the exception and is deliberately non-fatal: a
 * denial there loses one column, not the hierarchy, so those OU ids go into
 * `policiesUnreadable` and the surface reports them as unread.
 */
export async function organizationTree(
  supplied?: AwsGateway,
  options: { now?: () => Date; denial?: DenialContext; maxDepth?: number } = {},
): Promise<AwsRead<ObservedOrganizationTree>> {
  const gw = supplied ?? liveGateway()
  const maxDepth = options.maxDepth ?? 5

  return readAws<ObservedOrganizationTree>(
    "organizations:ListRoots",
    async () => {
      const roots = (await gw.call("organizations:ListRoots")) as ListRootsResponse
      const rootId = roots?.Roots?.[0]?.Id
      if (!rootId) {
        // A successful call with no root in it is not an empty Organization —
        // every Organization has exactly one root — so this is an incomplete
        // response and not a finding about the estate.
        throw new Error("organizations:ListRoots returned no root")
      }

      const units: ObservedOrganizationalUnit[] = []
      const policiesByUnitId: Record<string, readonly string[]> = {}
      const policiesUnreadable: string[] = []

      const walk = async (parentId: string, depth: number): Promise<void> => {
        if (depth > maxDepth) return
        let token: string | undefined
        do {
          const page = (await gw.call("organizations:ListOrganizationalUnitsForParent", {
            ParentId: parentId,
            NextToken: token,
          })) as ListOusResponse
          for (const ou of page?.OrganizationalUnits ?? []) {
            if (!ou.Id) continue
            units.push({ id: ou.Id, name: ou.Name ?? ou.Id, parentId })
          }
          token = page?.NextToken || undefined
        } while (token)

        // Children are walked after the whole page, so a parent's siblings are
        // discovered before its descendants and the order is stable.
        for (const child of units.filter((u) => u.parentId === parentId)) {
          await walk(child.id, depth + 1)
        }
      }

      await walk(rootId, 1)

      for (const unit of units) {
        try {
          const page = (await gw.call("organizations:ListPoliciesForTarget", {
            TargetId: unit.id,
            Filter: "SERVICE_CONTROL_POLICY",
          })) as ListPoliciesResponse
          policiesByUnitId[unit.id] = (page?.Policies ?? [])
            .map((p) => p.Name ?? p.Id ?? "")
            .filter((name) => name !== "")
        } catch {
          // Named, not swallowed. The surface prints "not read" for this unit.
          policiesUnreadable.push(unit.id)
        }
      }

      return { rootId, units, policiesByUnitId, policiesUnreadable }
    },
    { now: options.now, denial: options.denial, isEmpty: () => false },
  )
}

/* ------------------------------------------------------------ reconciliation -- */

/** Whether the declared unit exists, and whether it is where it belongs. */
export type UnitPresence =
  /** Declared, exists, and its parent is the declared one. */
  | { state: "PRESENT"; unitId: string }
  /**
   * Exists, under something else. A finding in its own right: the parent is what
   * decides the inherited guardrails, so a misplaced unit is a governed-looking
   * unit with the wrong policy set.
   */
  | { state: "MISPLACED"; unitId: string; observedParentId: string; expectedParentId: string }
  /** The Organization was read and this unit is not in it. */
  | { state: "MISSING" }
  /** Nothing was read, so nothing is claimed. */
  | { state: "UNREAD"; because: string; minimumStatement: string }

/** Whether any service control policy is attached at the unit. */
export type GuardrailAttachment =
  | { state: "ATTACHED"; policies: readonly string[] }
  /** Read, and nothing is attached here. The guardrails below it are inherited only. */
  | { state: "NONE_ATTACHED" }
  | { state: "UNREAD"; because: string }

export interface UnitVerdict {
  unit: OrganizationalUnit
  presence: UnitPresence
  guardrails: GuardrailAttachment
  /** Every guardrail in force at this unit, inherited ones first. */
  effective: readonly Guardrail[]
  /** Distinct denied actions at this unit. Monotonic down the tree. */
  deniedActions: number
}

/**
 * Compare the declared hierarchy with the one that exists.
 *
 * Every declared unit produces exactly one row, always, including when the read
 * failed — a table that shortens when a permission is missing is a table whose
 * length is a permission report rather than a topology.
 */
export function reconcileOrganizationalUnits(input: {
  tree: AwsRead<ObservedOrganizationTree>
  units?: readonly OrganizationalUnit[]
}): readonly UnitVerdict[] {
  const units = input.units ?? ORGANIZATIONAL_UNITS
  const read = input.tree

  const unread = (because: string): UnitPresence => ({
    state: "UNREAD",
    because,
    minimumStatement: minimumStatementText("organizations:ListRoots"),
  })

  let observed: ObservedOrganizationTree | null = null
  let unreadBecause: string | null = null

  switch (read.state) {
    case "ACTUAL":
    case "STALE":
      observed = read.value
      break
    case "EMPTY":
      // `organizationTree` passes `isEmpty: () => false`, so EMPTY cannot come
      // from it. Handled rather than defaulted, because a future caller passing
      // a different reader must not silently land in the MISSING branch.
      unreadBecause = "the Organization read returned no tree to compare against"
      break
    case "DENIED":
      unreadBecause = `${read.action} was refused (${read.errorCode})`
      break
    case "THROTTLED":
      unreadBecause = "the Organization read was rate-limited after backoff"
      break
    case "UNCONFIGURED":
      unreadBecause = read.why
      break
    case "ERROR":
      unreadBecause = `the Organization read failed (${read.code})`
      break
  }

  return units.map((unit): UnitVerdict => {
    const effective = inheritedGuardrails(unit.key)
    const deniedActions = deniedActionCount(unit.key)

    if (!observed) {
      return {
        unit,
        presence: unread(unreadBecause ?? "the Organization was not read"),
        guardrails: { state: "UNREAD", because: unreadBecause ?? "the Organization was not read" },
        effective,
        deniedActions,
      }
    }

    const match = observed.units.find(
      (o) => o.name.trim().toLowerCase() === unit.name.trim().toLowerCase(),
    )
    if (!match) {
      return {
        unit,
        presence: { state: "MISSING" },
        guardrails: {
          state: "UNREAD",
          because: "the unit does not exist, so nothing is attached to it",
        },
        effective,
        deniedActions,
      }
    }

    const expectedParentId =
      unit.parent === null
        ? observed.rootId
        : (observed.units.find(
            (o) =>
              o.name.trim().toLowerCase() === organizationalUnit(unit.parent!).name.trim().toLowerCase(),
          )?.id ?? "")

    const presence: UnitPresence =
      expectedParentId !== "" && match.parentId === expectedParentId
        ? { state: "PRESENT", unitId: match.id }
        : {
            state: "MISPLACED",
            unitId: match.id,
            observedParentId: match.parentId,
            // Blank when the declared parent does not exist in AWS either. Kept
            // as a distinguishable value rather than invented, so the row says
            // "under the wrong thing" and not "under this specific right thing".
            expectedParentId,
          }

    const guardrails: GuardrailAttachment = observed.policiesUnreadable.includes(match.id)
      ? {
          state: "UNREAD",
          because: `organizations:ListPoliciesForTarget was refused for ${match.id}`,
        }
      : (() => {
          const attached = observed.policiesByUnitId[match.id]
          if (attached === undefined) {
            return {
              state: "UNREAD" as const,
              because: `the attached policies of ${match.id} were not listed`,
            }
          }
          return attached.length === 0
            ? { state: "NONE_ATTACHED" as const }
            : { state: "ATTACHED" as const, policies: attached }
        })()

    return { unit, presence, guardrails, effective, deniedActions }
  })
}

/**
 * One sentence over the whole table.
 *
 * Written here rather than on the page so the summary and the rows cannot
 * disagree, and so the "nothing was read" case says that instead of "7 units
 * missing" — the sentence an operator would act on by creating seven OUs that
 * may already exist.
 */
export function unitSummary(verdicts: readonly UnitVerdict[]): {
  headline: string
  unread: number
  missing: number
  misplaced: number
  present: number
} {
  const count = (state: UnitPresence["state"]) =>
    verdicts.filter((v) => v.presence.state === state).length

  const unread = count("UNREAD")
  const missing = count("MISSING")
  const misplaced = count("MISPLACED")
  const present = count("PRESENT")

  if (verdicts.length === 0) {
    return { headline: "No organizational unit is declared.", unread, missing, misplaced, present }
  }
  if (unread === verdicts.length) {
    const because =
      verdicts[0].presence.state === "UNREAD" ? verdicts[0].presence.because : "it was not read"
    return {
      headline:
        `The organizational-unit hierarchy was not read — ${because}. ` +
        `${verdicts.length} units are declared and none of them is reported missing, because a unit ` +
        `reported missing on a read nobody was allowed to make is how an operator recreates one that exists.`,
      unread,
      missing,
      misplaced,
      present,
    }
  }
  return {
    headline:
      `${present} of ${verdicts.length} declared units exist where the hierarchy puts them` +
      (misplaced > 0 ? `, ${misplaced} under the wrong parent and therefore inheriting the wrong guardrails` : "") +
      (missing > 0 ? `, ${missing} missing` : "") +
      (unread > 0 ? `, ${unread} not read` : "") +
      ".",
    unread,
    missing,
    misplaced,
    present,
  }
}

/** The whole surface: identity resolved for the denial context, then the tree. */
export async function organizationalUnitSurface(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<{ tree: AwsRead<ObservedOrganizationTree>; verdicts: readonly UnitVerdict[] }> {
  const now = options.now ?? (() => new Date())
  const identity = await resolveIdentity(supplied, { now })
  const tree = await organizationTree(supplied, { now, denial: denialContextFrom(identity) })
  return { tree, verdicts: reconcileOrganizationalUnits({ tree }) }
}
