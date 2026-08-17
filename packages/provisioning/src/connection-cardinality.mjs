/**
 * CAT-010 — how many of each integration a tenant needs, and what a count means.
 *
 * `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`
 * §1.1 names fourteen cardinality modes and sixteen count dimensions, §1 names
 * five different things a "count" can be, and §4.2 lists what the compiler must
 * reject or warn on. Before this module none of those existed anywhere in the
 * tree: `grep -rn cardinality packages apps` found an organisation-graph axis
 * (`one`/`many`) and a metric-cardinality doc string, and nothing about
 * connections at all.
 *
 * ── Why this file is JavaScript in a TypeScript package ────────────────────
 *
 * Two readers must be able to load it on Node 20, which is what CI pins
 * (`.github/workflows/ci.yml` → `node-version: 20`): the platform test suite
 * (`node --test`, via `tools/run-platform-tests.mjs`) and the generator that
 * writes `docs/architecture/cat-connection-count-examples.md`. Neither can load
 * TypeScript there — `--experimental-strip-types` is 22.6+ and this repository
 * has no TS runner in `tools/`. Making it `.ts` would mean either a second
 * toolchain or a copy of the rules in a `.mjs` file, and this repository already
 * carries a note about what having two parsers cost. The package's `main` and
 * `exports` stay TypeScript-only, so nothing about `@tenure/provisioning`'s
 * public surface changes.
 *
 * ── The rule this file exists to hold ──────────────────────────────────────
 *
 * §1 ends: "Do not count one SharePoint site as one Microsoft tenant, one Slack
 * channel as one workspace connection, or one Stripe connected account as one
 * tenant." So `countLedger` never folds selected resources into connection
 * instances, and the five count kinds are five separate readings rather than one
 * number with five names.
 *
 * ── Undeterminable is not unsatisfied ──────────────────────────────────────
 *
 * A requirement whose mode needs an `n` and does not carry one is not "not
 * satisfied": nobody looked. Every verdict here is either
 * `{ determinable: true, satisfied }` or `{ determinable: false, why }`, and the
 * same split appears on every count in the ledger. Collapsing the two is the bug
 * this codebase's central rule exists to catch — "we looked and found nothing"
 * and "we could not look" are different answers.
 */

/** §1.1, verbatim and in the Bible's order. */
export const CARDINALITY_MODES = Object.freeze([
  "EXACTLY_N",
  "AT_LEAST_N",
  "AT_MOST_N",
  "BETWEEN_MIN_MAX",
  "ONE_PER_DIMENSION_VALUE",
  "ZERO_OR_MORE",
  "ONE_OR_MORE",
  "ALL_SELECTED_PROVIDERS",
  "ONE_OF_PROVIDER_SET",
  "N_OF_PROVIDER_SET",
  "PRIMARY_PLUS_BACKUP",
  "PER_USER_OPTIONAL",
  "PER_USER_REQUIRED",
  "DISCOVERED_THEN_APPROVED",
])

/**
 * §1.1's sixteen count dimensions.
 *
 * `phrase` is the Bible's own bullet, kept so the vocabulary can be checked
 * against §1.1 rather than trusted; `id` is the snake_case key a
 * `countBy` carries, following the Bible's own example
 * (`countBy: external_organization`, §1).
 */
export const COUNT_DIMENSIONS = Object.freeze([
  Object.freeze({ id: "tenant", phrase: "tenant" }),
  Object.freeze({ id: "external_organization", phrase: "external organization/tenant/account" }),
  Object.freeze({ id: "legal_entity", phrase: "legal entity" }),
  Object.freeze({ id: "subsidiary", phrase: "subsidiary" }),
  Object.freeze({ id: "division", phrase: "division/business unit/department" }),
  Object.freeze({ id: "country", phrase: "country/region/data-residency zone" }),
  Object.freeze({ id: "environment", phrase: "environment" }),
  Object.freeze({ id: "merchant_entity", phrase: "merchant entity" }),
  Object.freeze({ id: "payroll_population", phrase: "payroll population" }),
  Object.freeze({ id: "bank_account", phrase: "bank account/bank/channel" }),
  Object.freeze({ id: "warehouse", phrase: "warehouse/plant/site/store" }),
  Object.freeze({ id: "project", phrase: "project/program/client" }),
  Object.freeze({ id: "provider_workspace", phrase: "provider workspace/site/channel/folder" }),
  Object.freeze({ id: "partner", phrase: "partner/vendor/customer" }),
  Object.freeze({ id: "user", phrase: "user/seat/group" }),
  Object.freeze({ id: "device", phrase: "device/facility/system endpoint" }),
])

/**
 * §1 — "The Deployer distinguishes". Five kinds, five readings, never one
 * number. `definition` is the Bible's own gloss.
 */
export const COUNT_KINDS = Object.freeze([
  Object.freeze({
    id: "connection_instances",
    name: "Connection instances",
    definition: "authenticated provider accounts/organizations",
  }),
  Object.freeze({
    id: "selected_resources",
    name: "Selected resources",
    definition: "sites, channels, folders, mailboxes, calendars, etc. under a connection",
  }),
  Object.freeze({
    id: "entitled_capacity",
    name: "Entitled capacity",
    definition: "contractual maximum or billable units",
  }),
  Object.freeze({
    id: "provisioned_capacity",
    name: "Provisioned capacity",
    definition: "AWS/runtime resources reserved",
  }),
  Object.freeze({
    id: "active_usage",
    name: "Active usage",
    definition: "current resources/users/objects/events/actions",
  }),
])

/**
 * The §4.2 conditions this module decides, each carrying the Bible bullet it
 * comes from and the checklist item that asked for it.
 *
 * §4.2 lists fourteen. Nine are here — the ones CAT-010-003 ("minimums,
 * maximums, and redundancy") and CAT-010-004 ("duplicate provider identities,
 * missing coverage, unsafe reuse, unsupported mix, and fragmentation") name. The
 * other five need facts this module is not given: a capability consumer graph, a
 * module/pack connector requirement, field-level system-of-record ownership,
 * owner records, and cost/licence/review state. They belong to CAT-030-003's
 * compiler validation and are listed in `DETECTIONS_DEFERRED` rather than left
 * unmentioned, because a detector list that silently stops at nine reads as
 * complete.
 */
export const DETECTIONS = Object.freeze([
  Object.freeze({
    code: "below_minimum",
    bullet: "fewer instances than the capability minimum",
    requirement: "CAT-010-003",
  }),
  Object.freeze({
    code: "above_maximum",
    bullet: "more instances than plan/tenant maximum",
    requirement: "CAT-010-003",
  }),
  Object.freeze({
    code: "unsafe_concentration",
    bullet: "unsafe concentration when primary-plus-backup is required",
    requirement: "CAT-010-003",
  }),
  Object.freeze({
    code: "missing_dimension_coverage",
    bullet: "missing dimension coverage",
    requirement: "CAT-010-004",
  }),
  Object.freeze({
    code: "duplicate_provider_identity",
    bullet: "duplicate provider account/workspace identity",
    requirement: "CAT-010-004",
  }),
  Object.freeze({
    code: "unsupported_provider_mix",
    bullet: "unsupported provider mix",
    requirement: "CAT-010-004",
  }),
  Object.freeze({
    code: "unsafe_reuse_across_boundary",
    bullet: "one connection assigned across incompatible regions/legal entities",
    requirement: "CAT-010-004",
  }),
  Object.freeze({
    code: "personal_grant_for_organization_requirement",
    bullet: "one personal connection satisfying an organization-wide requirement",
    requirement: "CAT-010-004",
  }),
  Object.freeze({
    code: "excessive_fragmentation",
    bullet: "excessive fragmentation that causes avoidable cost or operational load",
    requirement: "CAT-010-004",
  }),
])

/** §4.2 bullets this module does NOT decide, and who has to. */
export const DETECTIONS_DEFERRED = Object.freeze([
  Object.freeze({
    bullet: "a provider instance with no capability consumer",
    needs: "the module/pack capability consumer graph",
    requirement: "CAT-030-003",
  }),
  Object.freeze({
    bullet: "a module/pack requiring a connector not selected",
    needs: "each module/pack's declared connector requirements",
    requirement: "CAT-030-003",
  }),
  Object.freeze({
    bullet: "conflicting field/system-of-record ownership",
    needs: "SystemOfRecordMapping and objectAuthority, which live on the tenant manifest",
    requirement: "CAT-030-003",
  }),
  Object.freeze({
    bullet: "no technical/business owner or owner departing before go-live",
    needs: "owner records with departure dates",
    requirement: "CAT-030-003",
  }),
  Object.freeze({
    bullet: "uncosted, unlicensed, unreviewed, or uncertified go-live dependency",
    needs: "the cost plan, licence state and provider review state",
    requirement: "CAT-030-003",
  }),
])

/**
 * Undeterminable-aware readings. Deliberately the same shape as
 * `apps/system-studio/src/app/tenants/[slug]/summary.ts`'s `Reading<T>`: a
 * console rendering either of them must not be able to tell a zero from a
 * blank by accident.
 */
export function known(value) {
  return { known: true, value }
}

export function unknown(why) {
  return { known: false, why }
}

const MODES = new Set(CARDINALITY_MODES)
const DIMENSION_IDS = new Set(COUNT_DIMENSIONS.map((d) => d.id))

export function dimensionById(id) {
  return COUNT_DIMENSIONS.find((d) => d.id === id) ?? null
}

/** Sorted, deduplicated — every list this module returns is comparable across runs. */
function sortedUnique(values) {
  return [...new Set(values)].sort()
}

/**
 * Sum a per-instance number that may not have been declared.
 *
 * An instance carrying `undefined` or `null` for a capacity has not been
 * measured; an instance carrying `0` has. Summing them together would report a
 * portfolio nobody sized as a portfolio sized at zero, which is the reading that
 * makes an unsized connector look free.
 */
function sumDeclared(instances, field, kind) {
  const missing = instances.filter((i) => i[field] === undefined || i[field] === null)
  if (missing.length > 0) {
    return unknown(
      `${missing.length} of ${instances.length} connection instance(s) declare no ${kind}: ` +
        `${sortedUnique(missing.map((i) => i.id)).join(", ")}. ` +
        `A portfolio total would report unmeasured capacity as zero.`,
    )
  }
  return known(instances.reduce((total, i) => total + i[field], 0))
}

/**
 * §1's five counts, kept apart.
 *
 * `connection_instances` is the only one that is always knowable, because it is
 * the length of the list the caller passed. The other four are declarations, and
 * a portfolio where one instance has not declared its resources is a portfolio
 * whose resource count is unknown — not one whose resource count is the sum of
 * the ones that did.
 */
export function countLedger(instances) {
  const undeclaredResources = instances.filter((i) => !Array.isArray(i.selectedResources))
  return {
    connection_instances: known(instances.length),
    selected_resources:
      undeclaredResources.length > 0
        ? unknown(
            `${undeclaredResources.length} of ${instances.length} connection instance(s) declare no ` +
              `resource selection: ${sortedUnique(undeclaredResources.map((i) => i.id)).join(", ")}. ` +
              `An empty selection and an unmade selection are different facts.`,
          )
        : known(instances.reduce((total, i) => total + i.selectedResources.length, 0)),
    entitled_capacity: sumDeclared(instances, "entitledUnits", "entitled capacity"),
    provisioned_capacity: sumDeclared(instances, "provisionedUnits", "provisioned capacity"),
    active_usage: sumDeclared(instances, "activeUnits", "active usage"),
  }
}

/** Instances that carry this capability. Discovery state is handled per mode. */
export function instancesFor(requirement, instances) {
  return instances.filter((i) => (i.capabilities ?? []).includes(requirement.capability))
}

function determinable(satisfied, observed, required, sentence) {
  return { determinable: true, satisfied, observed, required, sentence }
}

function undeterminable(why) {
  return { determinable: false, satisfied: null, why }
}

function valuesUnder(instance, dimensionId) {
  const declared = instance.dimensionValues?.[dimensionId]
  return Array.isArray(declared) ? declared : []
}

function distinctProducts(instances) {
  return sortedUnique(instances.map((i) => i.providerProduct))
}

/**
 * Does this requirement's cardinality hold against the instances configured for
 * it? One verdict, in the requirement's own mode.
 */
export function cardinalityVerdict(requirement, instances) {
  const mode = requirement.cardinality?.mode
  if (!MODES.has(mode)) {
    return undeterminable(
      `"${mode}" is not one of the fourteen cardinality modes in §1.1 ` +
        `(${CARDINALITY_MODES.join(", ")}), so no count could be checked.`,
    )
  }

  const carried = instancesFor(requirement, instances)
  const approved = carried.filter((i) => i.approved !== false)
  const count = approved.length
  const { n, minimum, maximum, countBy, dimensionValues } = requirement.cardinality
  const eligible = requirement.providerPolicy?.eligibleProviderProducts ?? []

  const needs = (value, name) =>
    value === undefined || value === null
      ? undeterminable(`${mode} needs \`${name}\`; the requirement declares none.`)
      : null

  switch (mode) {
    case "EXACTLY_N": {
      const missing = needs(n, "cardinality.n")
      if (missing) return missing
      return determinable(count === n, count, n, `exactly ${n} required, ${count} configured`)
    }
    case "AT_LEAST_N": {
      const missing = needs(n, "cardinality.n")
      if (missing) return missing
      return determinable(count >= n, count, n, `at least ${n} required, ${count} configured`)
    }
    case "AT_MOST_N": {
      const missing = needs(n, "cardinality.n")
      if (missing) return missing
      return determinable(count <= n, count, n, `at most ${n} allowed, ${count} configured`)
    }
    case "BETWEEN_MIN_MAX": {
      const missing = needs(minimum, "cardinality.minimum") ?? needs(maximum, "cardinality.maximum")
      if (missing) return missing
      return determinable(
        count >= minimum && count <= maximum,
        count,
        `${minimum}–${maximum}`,
        `between ${minimum} and ${maximum} required, ${count} configured`,
      )
    }
    case "ONE_PER_DIMENSION_VALUE": {
      const missing = needs(countBy, "cardinality.countBy") ?? needs(dimensionValues, "cardinality.dimensionValues")
      if (missing) return missing
      if (!DIMENSION_IDS.has(countBy)) {
        return undeterminable(
          `"${countBy}" is not one of the sixteen count dimensions in §1.1, so coverage could not be computed.`,
        )
      }
      const covered = new Set(approved.flatMap((i) => valuesUnder(i, countBy)))
      const uncovered = dimensionValues.filter((v) => !covered.has(v)).sort()
      return {
        ...determinable(
          uncovered.length === 0,
          `${dimensionValues.length - uncovered.length} of ${dimensionValues.length} ${countBy} values covered`,
          `one connection per ${countBy} value`,
          uncovered.length === 0
            ? `every one of the ${dimensionValues.length} declared ${countBy} values has a connection`
            : `${uncovered.length} ${countBy} value(s) have no connection: ${uncovered.join(", ")}`,
        ),
        uncovered,
      }
    }
    case "ZERO_OR_MORE":
      return determinable(true, count, "any", `any number allowed, ${count} configured`)
    case "ONE_OR_MORE":
      return determinable(count >= 1, count, "1 or more", `at least one required, ${count} configured`)
    case "ALL_SELECTED_PROVIDERS": {
      if (eligible.length === 0) {
        return undeterminable(
          "ALL_SELECTED_PROVIDERS needs `providerPolicy.eligibleProviderProducts`; the requirement declares none.",
        )
      }
      const present = new Set(distinctProducts(approved))
      const absent = eligible.filter((p) => !present.has(p)).sort()
      return {
        ...determinable(
          absent.length === 0,
          `${eligible.length - absent.length} of ${eligible.length} selected providers connected`,
          "every selected provider",
          absent.length === 0
            ? "every selected provider has at least one connection"
            : `no connection for ${absent.join(", ")}`,
        ),
        absent,
      }
    }
    case "ONE_OF_PROVIDER_SET": {
      const products = distinctProducts(approved)
      const ineligible = products.filter((p) => !eligible.includes(p))
      return determinable(
        products.length === 1 && ineligible.length === 0,
        products.length === 0 ? "no provider chosen" : products.join(", "),
        `exactly one of ${eligible.join(", ")}`,
        products.length === 1 && ineligible.length === 0
          ? `${products[0]} is the single chosen provider`
          : products.length === 0
            ? "no provider from the eligible set is connected"
            : `${products.length} providers connected (${products.join(", ")}); one of the eligible set is required`,
      )
    }
    case "N_OF_PROVIDER_SET": {
      const missing = needs(n, "cardinality.n")
      if (missing) return missing
      const products = distinctProducts(approved).filter((p) => eligible.includes(p))
      return determinable(
        products.length === n,
        products.length,
        n,
        `${n} of the eligible provider set required, ${products.length} connected (${products.join(", ") || "none"})`,
      )
    }
    case "PRIMARY_PLUS_BACKUP": {
      const primaries = approved.filter((i) => i.role === "primary")
      const backups = approved.filter((i) => i.role === "backup")
      const unroled = approved.filter((i) => i.role !== "primary" && i.role !== "backup")
      if (unroled.length > 0) {
        return undeterminable(
          `PRIMARY_PLUS_BACKUP needs a role on every instance; ` +
            `${sortedUnique(unroled.map((i) => i.id)).join(", ")} declare none.`,
        )
      }
      const identities = new Set(primaries.map((i) => i.providerIdentity))
      const distinctBackups = backups.filter((i) => !identities.has(i.providerIdentity))
      return determinable(
        primaries.length >= 1 && distinctBackups.length >= 1,
        `${primaries.length} primary, ${backups.length} backup (${distinctBackups.length} on a distinct identity)`,
        "one primary and one backup on a different provider identity",
        primaries.length >= 1 && distinctBackups.length >= 1
          ? "a primary and a backup on a different provider identity are configured"
          : primaries.length === 0
            ? "no primary connection is configured"
            : backups.length === 0
              ? "no backup connection is configured"
              : "the backup shares the primary's provider identity, so it is not a second path",
      )
    }
    case "PER_USER_OPTIONAL": {
      const connected = requirement.population?.connectedUsers
      if (connected === undefined || connected === null) {
        return determinable(
          true,
          "not measured",
          "optional per user",
          "optional per user, so nothing is unsatisfied; no connected-user count was declared",
        )
      }
      return determinable(true, connected, "optional per user", `${connected} user(s) have connected; optional`)
    }
    case "PER_USER_REQUIRED": {
      const users = requirement.population?.users
      const connected = requirement.population?.connectedUsers
      const missing =
        needs(users, "population.users") ?? needs(connected, "population.connectedUsers")
      if (missing) return missing
      return determinable(
        connected >= users,
        connected,
        users,
        `${users} user(s) in scope, ${connected} connected`,
      )
    }
    case "DISCOVERED_THEN_APPROVED": {
      const pending = carried.filter((i) => i.approved === false)
      const floor = minimum ?? 1
      return {
        ...determinable(
          approved.length >= floor,
          `${approved.length} approved, ${pending.length} discovered and awaiting approval`,
          `at least ${floor} approved`,
          approved.length >= floor
            ? `${approved.length} approved connection(s); ${pending.length} discovered instance(s) are not counted until approved`
            : `${approved.length} approved of ${floor} required; ${pending.length} discovered instance(s) do not count until approved`,
        ),
        pending: sortedUnique(pending.map((i) => i.id)),
      }
    }
    default:
      /* c8 ignore next */
      return undeterminable(`${mode} is declared in §1.1 but has no evaluator here.`)
  }
}

function finding(code, requirementId, detail, extra = {}) {
  const declared = DETECTIONS.find((d) => d.code === code)
  return {
    code,
    requirement: requirementId,
    bullet: declared?.bullet ?? null,
    closes: declared?.requirement ?? null,
    detail,
    ...extra,
  }
}

/**
 * The §4.2 conditions, for one requirement and the instances configured for it.
 *
 * Separation and grant policy are REQUIRED declarations rather than defaulted.
 * A default here would decide, silently and for every tenant, whether one
 * connection may span two data-residency zones — which is a residency decision,
 * not a code decision. When it is absent the reuse checks report that they could
 * not run, naming the field.
 */
export function requirementFindings(requirement, instances) {
  const out = []
  const carried = instancesFor(requirement, instances)
  const approved = carried.filter((i) => i.approved !== false)
  const verdict = cardinalityVerdict(requirement, carried)

  // ── §4.2: fewer instances than the capability minimum / more than the max ──
  const { minimum, maximum, countBy } = requirement.cardinality ?? {}
  if (typeof minimum === "number" && approved.length < minimum) {
    out.push(
      finding(
        "below_minimum",
        requirement.id,
        `${requirement.capability} declares a minimum of ${minimum} connection instance(s); ${approved.length} configured.`,
        { grain: "capability", key: requirement.capability, observed: approved.length, limit: minimum },
      ),
    )
  }
  if (typeof maximum === "number" && approved.length > maximum) {
    out.push(
      finding(
        "above_maximum",
        requirement.id,
        `${requirement.capability} declares a maximum of ${maximum} connection instance(s); ${approved.length} configured.`,
        { grain: "capability", key: requirement.capability, observed: approved.length, limit: maximum },
      ),
    )
  }

  // ── §4.2: missing dimension coverage ───────────────────────────────────────
  if (verdict.determinable && Array.isArray(verdict.uncovered) && verdict.uncovered.length > 0) {
    out.push(
      finding(
        "missing_dimension_coverage",
        requirement.id,
        `${verdict.uncovered.length} declared ${countBy} value(s) have no connection: ${verdict.uncovered.join(", ")}.`,
        { grain: "dimension", key: countBy, uncovered: verdict.uncovered },
      ),
    )
  }

  // ── §2.3: duplicates are detected by verified provider identity ────────────
  const byIdentity = new Map()
  for (const i of approved) {
    byIdentity.set(i.providerIdentity, [...(byIdentity.get(i.providerIdentity) ?? []), i.id])
  }
  for (const [identity, ids] of [...byIdentity.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (ids.length > 1) {
      out.push(
        finding(
          "duplicate_provider_identity",
          requirement.id,
          `provider identity ${identity} is connected ${ids.length} times for ${requirement.capability}: ${sortedUnique(ids).join(", ")}.`,
          { key: identity, instances: sortedUnique(ids) },
        ),
      )
    }
  }

  // ── §4.2: unsupported provider mix, and providers outside the eligible set ─
  const eligible = requirement.providerPolicy?.eligibleProviderProducts ?? []
  const products = distinctProducts(approved)
  const ineligible = products.filter((p) => !eligible.includes(p))
  if (eligible.length > 0 && ineligible.length > 0) {
    out.push(
      finding(
        "unsupported_provider_mix",
        requirement.id,
        `${ineligible.join(", ")} is not in ${requirement.capability}'s eligible provider set (${eligible.join(", ")}).`,
        { key: ineligible.join(","), products: ineligible },
      ),
    )
  }
  if (requirement.providerPolicy?.mixedProvidersAllowed === false && products.length > 1) {
    out.push(
      finding(
        "unsupported_provider_mix",
        requirement.id,
        `${requirement.capability} does not allow mixed providers; ${products.length} are connected (${products.join(", ")}).`,
        { key: products.join(","), products },
      ),
    )
  }

  // ── §4.2: one connection assigned across incompatible boundaries ───────────
  const separation = requirement.scope?.separation
  if (separation === undefined) {
    out.push(
      finding(
        "unsafe_reuse_across_boundary",
        requirement.id,
        `${requirement.capability} declares no \`scope.separation\`, so whether one connection may span regions, ` +
          `legal entities or environments could not be assessed. This is undeterminable, not safe.`,
        { determinable: false },
      ),
    )
  } else {
    const boundaries = [
      ["byRegion", "regions", "regions"],
      ["byLegalEntity", "legalEntities", "legal entities"],
      ["byEnvironment", "environments", "environments"],
    ]
    for (const [flag, field, label] of boundaries) {
      if (separation[flag] !== true) continue
      for (const i of approved) {
        const spanned = sortedUnique(i[field] ?? [])
        if (spanned.length > 1) {
          out.push(
            finding(
              "unsafe_reuse_across_boundary",
              requirement.id,
              `connection ${i.id} is assigned across ${spanned.length} ${label} (${spanned.join(", ")}) ` +
                `while ${requirement.capability} requires separation by ${label}.`,
              { key: i.id, boundary: label, spanned, determinable: true },
            ),
          )
        }
      }
    }
  }

  // ── §4.2: one personal connection satisfying an organization requirement ───
  const grantRequirement = requirement.grantRequirement
  if (grantRequirement === undefined) {
    out.push(
      finding(
        "personal_grant_for_organization_requirement",
        requirement.id,
        `${requirement.capability} declares no \`grantRequirement\`, so whether a personal grant may satisfy it ` +
          `could not be assessed.`,
        { determinable: false },
      ),
    )
  } else if (grantRequirement === "organization") {
    for (const i of approved.filter((x) => x.grant === "personal")) {
      out.push(
        finding(
          "personal_grant_for_organization_requirement",
          requirement.id,
          `connection ${i.id} is a personal grant, and ${requirement.capability} is an organization-wide requirement. ` +
            `It ends when that person's account does.`,
          { key: i.id, determinable: true },
        ),
      )
    }
  }

  // ── §4.2: unsafe concentration when primary-plus-backup is required ────────
  const wantsRedundancy =
    requirement.cardinality?.mode === "PRIMARY_PLUS_BACKUP" ||
    requirement.redundancy?.primaryPlusBackup === true
  if (wantsRedundancy) {
    const primaries = approved.filter((i) => i.role === "primary")
    const backups = approved.filter((i) => i.role === "backup")
    const primaryIdentities = new Set(primaries.map((i) => i.providerIdentity))
    const sharing = backups.filter((i) => primaryIdentities.has(i.providerIdentity))
    if (primaries.length === 0 || backups.length === 0) {
      out.push(
        finding(
          "unsafe_concentration",
          requirement.id,
          `${requirement.capability} requires primary-plus-backup; ${primaries.length} primary and ` +
            `${backups.length} backup connection(s) are configured.`,
          { observed: `${primaries.length}/${backups.length}`, limit: "1 primary + 1 backup" },
        ),
      )
    }
    for (const i of sharing) {
      out.push(
        finding(
          "unsafe_concentration",
          requirement.id,
          `backup ${i.id} uses provider identity ${i.providerIdentity}, which is also a primary. ` +
            `The same account failing takes both paths with it.`,
          { key: i.id },
        ),
      )
    }
  }

  // ── §4.2: excessive fragmentation ──────────────────────────────────────────
  // Assessed only against a declared count dimension. Two connections to the
  // same product covering the same dimension value are two token renewals, two
  // quota allocations and two workers for one unit of coverage. Without a
  // dimension there is nothing to say a second connection is not doing new work,
  // so this reports that it did not assess rather than guessing a threshold.
  const fragmentation = { assessed: false, reason: "no `cardinality.countBy` is declared" }
  if (countBy !== undefined && DIMENSION_IDS.has(countBy)) {
    fragmentation.assessed = true
    delete fragmentation.reason
    const seen = new Map()
    for (const i of approved) {
      if (i.role === "backup") continue
      for (const value of valuesUnder(i, countBy)) {
        const key = `${i.providerProduct}\u0000${value}`
        seen.set(key, [...(seen.get(key) ?? []), i])
      }
    }
    for (const [key, group] of [...seen.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const identities = sortedUnique(group.map((i) => i.providerIdentity))
      if (identities.length > 1) {
        const [product, value] = key.split("\u0000")
        out.push(
          finding(
            "excessive_fragmentation",
            requirement.id,
            `${identities.length} separate ${product} identities serve the same ${countBy} value "${value}" ` +
              `(${identities.join(", ")}), and none is a declared backup.`,
            { key: `${product}/${value}`, identities },
          ),
        )
      }
    }
  }

  return { verdict, findings: out, fragmentation }
}

const LIMIT_GRAINS = Object.freeze([
  Object.freeze({ key: "byModule", grain: "module", of: (r) => r.module }),
  Object.freeze({ key: "byPack", grain: "pack", of: (r) => r.pack }),
  Object.freeze({ key: "byCapability", grain: "capability", of: (r) => r.capability }),
])

/**
 * CAT-010-003 — minimums and maximums at every grain the checklist names:
 * per tenant, module, pack, capability, provider, and dimension value.
 *
 * The per-requirement minimum/maximum in `requirementFindings` is the capability
 * requirement's own declaration. These are the portfolio's: a plan that allows
 * six connections in total, a module that needs at least one, a provider a
 * tenant may hold at most two accounts with, one connection per legal entity.
 */
export function limitFindings(requirements, instances, limits = {}) {
  const out = []
  const push = (code, detail, extra) => out.push(finding(code, extra.key ?? "portfolio", detail, extra))

  const counted = instances.filter((i) => i.approved !== false)

  if (limits.tenant?.maximum !== undefined && counted.length > limits.tenant.maximum) {
    push("above_maximum", `the tenant may hold at most ${limits.tenant.maximum} connection instance(s); ${counted.length} are configured.`, {
      grain: "tenant",
      key: "tenant",
      observed: counted.length,
      limit: limits.tenant.maximum,
    })
  }
  if (limits.tenant?.minimum !== undefined && counted.length < limits.tenant.minimum) {
    push("below_minimum", `the tenant must hold at least ${limits.tenant.minimum} connection instance(s); ${counted.length} are configured.`, {
      grain: "tenant",
      key: "tenant",
      observed: counted.length,
      limit: limits.tenant.minimum,
    })
  }

  for (const { key, grain, of } of LIMIT_GRAINS) {
    const table = limits[key]
    if (!table) continue
    for (const name of Object.keys(table).sort()) {
      const bound = table[name]
      const caps = new Set(requirements.filter((r) => of(r) === name).map((r) => r.capability))
      const n = counted.filter((i) => (i.capabilities ?? []).some((c) => caps.has(c))).length
      if (bound.minimum !== undefined && n < bound.minimum) {
        push("below_minimum", `${grain} ${name} requires at least ${bound.minimum} connection instance(s); ${n} are configured.`, {
          grain,
          key: name,
          observed: n,
          limit: bound.minimum,
        })
      }
      if (bound.maximum !== undefined && n > bound.maximum) {
        push("above_maximum", `${grain} ${name} allows at most ${bound.maximum} connection instance(s); ${n} are configured.`, {
          grain,
          key: name,
          observed: n,
          limit: bound.maximum,
        })
      }
    }
  }

  if (limits.byProvider) {
    for (const product of Object.keys(limits.byProvider).sort()) {
      const bound = limits.byProvider[product]
      const n = counted.filter((i) => i.providerProduct === product).length
      if (bound.minimum !== undefined && n < bound.minimum) {
        push("below_minimum", `provider ${product} requires at least ${bound.minimum} connection instance(s); ${n} are configured.`, {
          grain: "provider",
          key: product,
          observed: n,
          limit: bound.minimum,
        })
      }
      if (bound.maximum !== undefined && n > bound.maximum) {
        push("above_maximum", `provider ${product} allows at most ${bound.maximum} connection instance(s); ${n} are configured.`, {
          grain: "provider",
          key: product,
          observed: n,
          limit: bound.maximum,
        })
      }
    }
  }

  if (limits.byDimension) {
    for (const dimension of Object.keys(limits.byDimension).sort()) {
      if (!DIMENSION_IDS.has(dimension)) {
        push(
          "above_maximum",
          `a limit is declared for "${dimension}", which is not one of the sixteen count dimensions in §1.1, ` +
            `so it could not be applied.`,
          { grain: "dimension", key: dimension, determinable: false },
        )
        continue
      }
      const bound = limits.byDimension[dimension]
      const perValue = new Map()
      for (const i of counted) {
        for (const value of valuesUnder(i, dimension)) {
          perValue.set(value, (perValue.get(value) ?? 0) + 1)
        }
      }
      for (const value of [...perValue.keys()].sort()) {
        const n = perValue.get(value)
        if (bound.maximumPerValue !== undefined && n > bound.maximumPerValue) {
          push(
            "above_maximum",
            `${dimension} "${value}" allows at most ${bound.maximumPerValue} connection instance(s); ${n} are configured.`,
            { grain: "dimension", key: `${dimension}/${value}`, observed: n, limit: bound.maximumPerValue },
          )
        }
        if (bound.minimumPerValue !== undefined && n < bound.minimumPerValue) {
          push(
            "below_minimum",
            `${dimension} "${value}" requires at least ${bound.minimumPerValue} connection instance(s); ${n} are configured.`,
            { grain: "dimension", key: `${dimension}/${value}`, observed: n, limit: bound.minimumPerValue },
          )
        }
      }
    }
  }

  return out
}

/**
 * The whole portfolio: the five counts, one verdict per requirement, and every
 * §4.2 condition this module decides.
 *
 * Findings are sorted by code, then requirement, then key, so two runs over the
 * same portfolio produce byte-identical output — the property CAT-030-005 will
 * need and the reason nothing here iterates a `Set` or an object in insertion
 * order.
 */
export function assessPortfolio({ requirements = [], instances = [], limits = {} } = {}) {
  const perRequirement = requirements.map((requirement) => {
    const { verdict, findings, fragmentation } = requirementFindings(requirement, instances)
    return {
      id: requirement.id,
      capability: requirement.capability,
      mode: requirement.cardinality?.mode ?? null,
      verdict,
      fragmentation,
      findings,
    }
  })

  const findings = [
    ...perRequirement.flatMap((r) => r.findings),
    ...limitFindings(requirements, instances, limits),
  ].sort(
    (a, b) =>
      a.code.localeCompare(b.code) ||
      a.requirement.localeCompare(b.requirement) ||
      String(a.key ?? "").localeCompare(String(b.key ?? "")) ||
      a.detail.localeCompare(b.detail),
  )

  return {
    ledger: countLedger(instances),
    requirements: perRequirement,
    findings,
    /** Requirements whose cardinality could be decided and holds. */
    satisfied: perRequirement.filter((r) => r.verdict.determinable && r.verdict.satisfied).length,
    /** Requirements nobody could decide. Counted apart from the unsatisfied ones. */
    undeterminable: perRequirement.filter((r) => !r.verdict.determinable).length,
  }
}
