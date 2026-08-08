/**
 * STUDIO-070-002 — the tag contract every provisioned resource must carry.
 *
 * Before this existed the string `tenure:tenant` appeared exactly once in the
 * whole workspace, inside an operator-instruction sentence in
 * `apps/system-studio/src/lib/cost-source.ts` telling somebody to go and tag
 * things. Nothing declared the key, nothing validated against it, and nothing
 * failed when a resource shipped untagged. Cost attribution, blast-radius
 * questions and "who owns this" all resolve against tags, so a tag vocabulary
 * that lives only in prose is a vocabulary the estate does not actually have.
 *
 * ── Why `shared` is a VALUE and not an absence ──────────────────────────────
 *
 * The single most important decision in this file. A control-plane resource —
 * the Studio's own table, its ALB, its ECR repository — genuinely belongs to no
 * tenant. An untagged resource ALSO belongs to no tenant as far as any reader
 * can tell. Those are completely different facts and only one of them is safe:
 *
 *   `tenure:tenant = tenure:shared`   somebody decided this is shared
 *   (no `tenure:tenant` at all)       nobody has looked at this
 *
 * If absence were read as "shared", every resource an engineer forgot to tag
 * would be silently absorbed into platform overhead and spread across every
 * customer's bill. So absence is `unattributable`, it is reported as such, and
 * `SHARED` is the explicit sentinel a stack writes when it means it.
 *
 * ── Where this is enforced ──────────────────────────────────────────────────
 *
 * Two places, deliberately on both sides of the apply:
 *
 *   before   `tests/architecture/resource-tags.test.mjs` reads every .tf file
 *            and fails a `tags = {` block that does not merge `local.tags`
 *   after    `apps/system-studio/src/lib/aws/inventory.ts` calls `tagProblems`
 *            on every resource the Resource Groups Tagging API returns, so a
 *            resource created by hand in the console is caught too
 *
 * Neither substitutes for the other: Terraform cannot see a resource somebody
 * clicked into existence, and the inventory cannot see a stack that has not
 * been applied yet.
 */

/** The value `tenure:tenant` carries when a resource deliberately belongs to no tenant. */
export const SHARED = "tenure:shared"

/**
 * The twelve keys. Order is the order an operator reads them in, not the
 * alphabet: who it is for, where it runs, what it is, and who answers for it.
 */
export const REQUIRED_RESOURCE_TAGS = [
  /** The tenant slug, or `SHARED`. The key every cost and blast-radius question resolves through. */
  "tenure:tenant",
  /** production / staging / development. */
  "tenure:environment",
  /** Which cell the resource lives in, or `SHARED` for a control-plane resource. */
  "tenure:cell",
  /** What the ACCOUNT this lives in is for — control-plane, workload, log-archive, sandbox. */
  "tenure:account-purpose",
  /** The module or component that owns the resource. */
  "tenure:module",
  /** The release or schema version the resource was created for. */
  "tenure:release",
  /** The IaC stack that declares it, named by its state key so two stacks cannot claim one resource. */
  "tenure:stack",
  /** What class of data it may hold. Decides encryption, residency and who may read it. */
  "tenure:data-class",
  /** The named seat that answers for it — a role, never a person who can leave. */
  "tenure:owner-seat",
  /** Where the money lands. */
  "tenure:cost-center",
  /** How long it is kept, as an ISO-8601 duration or `indefinite`. */
  "tenure:retention",
  /** What created it. A resource nothing manages is a resource nobody can change safely. */
  "tenure:managed-by",
] as const

export type RequiredResourceTag = (typeof REQUIRED_RESOURCE_TAGS)[number]

/**
 * Closed vocabularies.
 *
 * Free text here would defeat the point: `data-class` decides who may read a
 * resource, and "PII", "pii", "personal" and "student data" are four spellings
 * of one policy that no query can group. Anything outside the list is refused
 * with the list in the message, so the fix is obvious rather than a guess.
 */
export const DATA_CLASSES = [
  /** Identifiable student or member records. The class the pilot exists to protect. */
  "student-record",
  /** Tenant business data that is not a student record. */
  "operational",
  /** Metrics, logs and traces. */
  "telemetry",
  /** The engine's own state: the registry, its images, its secrets. */
  "control-plane",
  /** Deliberately holds nothing — a security group, a routing rule. */
  "none",
] as const

export const MANAGED_BY = ["terraform", "cloudformation", "console", "sdk"] as const

/** `P30D`, `P7Y`, `PT12H` … or `indefinite` when nothing deletes it. */
const RETENTION = /^(indefinite|P(?!$)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?)$/

const ACCOUNT_PURPOSES = ["control-plane", "workload", "log-archive", "security", "sandbox"] as const

export interface TagProblem {
  key: string
  detail: string
}

/**
 * Every way a tag set fails the contract, with the reason.
 *
 * Returns a list rather than a boolean because an operator fixing one tag and
 * discovering a second is an operator who applies twice. Empty means compliant.
 *
 * Case is not normalised. AWS tag keys are case-sensitive, so `Tenure:Tenant`
 * is genuinely a different key from `tenure:tenant` and reporting it as present
 * would be reporting a tag that no cost query will ever match.
 */
export function tagProblems(tags: Readonly<Record<string, string | undefined>>): readonly TagProblem[] {
  const problems: TagProblem[] = []

  for (const key of REQUIRED_RESOURCE_TAGS) {
    const value = tags[key]
    if (value === undefined) {
      problems.push({
        key,
        detail:
          key === "tenure:tenant"
            ? `Missing ${key}. An untagged resource is unattributable, which is not the same as ` +
              `shared — tag it "${SHARED}" if it genuinely belongs to no tenant.`
            : `Missing ${key}.`,
      })
      continue
    }
    if (value.trim() === "") {
      problems.push({ key, detail: `${key} is present and empty, which reads as "nobody decided".` })
      continue
    }

    switch (key) {
      case "tenure:data-class":
        if (!(DATA_CLASSES as readonly string[]).includes(value)) {
          problems.push({
            key,
            detail: `"${value}" is not a data class. One of: ${DATA_CLASSES.join(", ")}.`,
          })
        }
        break
      case "tenure:managed-by":
        if (!(MANAGED_BY as readonly string[]).includes(value)) {
          problems.push({
            key,
            detail: `"${value}" does not name a manager. One of: ${MANAGED_BY.join(", ")}.`,
          })
        }
        break
      case "tenure:account-purpose":
        if (!(ACCOUNT_PURPOSES as readonly string[]).includes(value)) {
          problems.push({
            key,
            detail: `"${value}" is not an account purpose. One of: ${ACCOUNT_PURPOSES.join(", ")}.`,
          })
        }
        break
      case "tenure:retention":
        if (!RETENTION.test(value)) {
          problems.push({
            key,
            detail:
              `"${value}" is not a retention. Use an ISO-8601 duration (P30D, P7Y) or "indefinite" ` +
              `— "90 days" cannot be compared to anything.`,
          })
        }
        break
      default:
        break
    }
  }

  return problems
}

/**
 * Who a resource belongs to, as a decision rather than a lookup.
 *
 * Three arms, and the third is the one that matters: a resource with no
 * `tenure:tenant` is not bucketed anywhere and not dropped — it is rendered as
 * unattributable with the missing key named, because silently spreading it
 * across every tenant is how an untagged $4,000 NAT gateway becomes forty
 * customers' problem.
 */
export type TenantAttribution =
  | { kind: "tenant"; slug: string }
  | { kind: "shared" }
  | { kind: "unattributable"; detail: string }

export function tenantAttribution(
  tags: Readonly<Record<string, string | undefined>>,
): TenantAttribution {
  const value = tags["tenure:tenant"]
  if (value === undefined || value.trim() === "") {
    return {
      kind: "unattributable",
      detail: `unattributable — missing tenure:tenant`,
    }
  }
  if (value === SHARED) return { kind: "shared" }
  return { kind: "tenant", slug: value }
}
