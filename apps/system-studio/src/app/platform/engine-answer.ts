/**
 * The answer `/platform` leads with, and the arithmetic behind it.
 *
 * ── Why this is a module and not a run of ternaries in the page ─────────────
 *
 * The page answers one question — *is the engine itself healthy, and what does
 * it currently know* — and the dangerous arm of that answer is the reassuring
 * one. A console that prints "healthy" because every check it happened to run
 * came back clean, while three of its reads were refused and its build is not
 * stamped, is the same defect `states.tsx` and `AwsRead` exist to prevent one
 * level down: an absence of an answer rendered as an answer of "fine".
 *
 * So the verdict is computed here, `HEALTHY` is defined as *nothing was found*
 * rather than as a case in a switch, and `engine-answer.test.ts` asserts that
 * equivalence directly. A page cannot reach the reassuring sentence without
 * every finding being empty, and it cannot get there by a ternary somebody
 * reordered.
 *
 * ── What may be imported here ──────────────────────────────────────────────
 *
 * Two modules, and both are plain data. `capabilities.ts` is the vocabulary —
 * a closed registry of every AWS read this engine declares, with the IAM
 * actions each one needs — and `@tenure/blueprints` supplies the one list an
 * operator-facing surface may draw tenants from. Neither holds an SDK client, a
 * credential path or React, so this module runs under `apps/web`'s jest with no
 * server, no browser and no AWS account, which is what makes the mutation proof
 * in the test beside it possible. Everything else arrives as a plain argument.
 *
 * Nothing here reads the clock, the environment or the filesystem. Same inputs,
 * same output, on any machine.
 */

import { CUSTOMER_TENANT_BINDINGS } from "@tenure/blueprints"

import {
  ALL_CAPABILITIES,
  CAPABILITIES,
  minimumStatementText,
  type Capability,
  type SurfaceKey,
} from "../../lib/aws/capabilities"

/* ---------------------------------------------------------- real tenants -- */

/**
 * The slugs an operator-facing surface is allowed to draw a tenant row from.
 *
 * `TENANT_BINDINGS` is the compiled set INCLUDING the three fixtures that
 * exercise the platform — RTL localisation, external-ERP module resolution, the
 * relay budget — and `@tenure/platform-config`'s `moduleAdoption()` and
 * `fleetCompatibility()` both fold over it. Two panels on this page therefore
 * listed three organisations that do not exist, beside one real pilot,
 * presented identically. An operator decides to deprecate a module or advance a
 * release from those tables.
 *
 * The filter is applied here rather than inside `platform-config`, which has
 * other consumers and whose fixtures must stay resolvable by slug: the suites
 * that prove RTL, external-ERP and the relay budget reach them through
 * `getTenantBinding`, and a filter applied at the source would make those tests
 * invent their own bindings — which is how a test stops testing what ships.
 */
const CUSTOMER_SLUGS: ReadonlySet<string> = new Set(CUSTOMER_TENANT_BINDINGS.map((b) => b.slug))

/**
 * Keep only the rows that belong to a real customer.
 *
 * Generic over anything carrying a `slug`, because the two panels that need it
 * carry different row shapes — a module's adopters and a cell's tenants — and
 * writing the filter twice is how one of them gets fixed and the other does
 * not.
 */
export function customerTenantsOnly<T extends { slug: string }>(
  rows: readonly T[],
): readonly T[] {
  return rows.filter((row) => CUSTOMER_SLUGS.has(row.slug))
}

/** How many configured systems belong to a real customer. Read, never typed. */
export const CUSTOMER_TENANT_COUNT = CUSTOMER_SLUGS.size

/* ------------------------------------------------------------- the build -- */

/**
 * Whether the figures on the page describe the code that is serving them.
 *
 * Three states and not two. `UNSTAMPED` is the one that matters: when the
 * running build does not know its own commit, the console cannot say the
 * snapshot is current AND cannot say it is stale. Folding that into `MATCHED`
 * — which is what "if the commits differ, warn" does — publishes a freshness
 * claim out of an absence of evidence, on every developer machine and in any
 * deployment whose pipeline forgot to stamp it.
 */
export type BuildVerdict = "MATCHED" | "DRIFTED" | "UNSTAMPED"

export interface BuildProvenance {
  verdict: BuildVerdict
  /** What the state means, in the operator's language. */
  sentence: string
  /** What to do about it, or null when there is nothing to do. */
  fix: string | null
}

/**
 * The staleness check for every figure compiled into the snapshot.
 *
 * Keyed on a COMMIT rather than on an age in hours, deliberately. A page whose
 * output changes with the clock cannot be tested deterministically, and a
 * staleness banner that appears on a timer is one operators learn to dismiss.
 * A commit mismatch is a fact about two artifacts, it is stable, and it is
 * exactly the condition under which the numbers are describing another
 * repository.
 */
export function buildProvenance(input: {
  /** `BUILD_COMMIT` from this process's environment. Absent on an unstamped build. */
  runningCommit: string | undefined
  /** `commit` from the generated snapshot the page imports. */
  snapshotCommit: string
}): BuildProvenance {
  const running = input.runningCommit?.trim()
  if (!running) {
    return {
      verdict: "UNSTAMPED",
      sentence:
        "This build does not know which commit it was made from, so the snapshot below cannot be " +
        "confirmed to describe it — and cannot be shown to be stale either.",
      fix: "Set BUILD_COMMIT in the deploy workflow to the commit being built.",
    }
  }
  if (running !== input.snapshotCommit) {
    return {
      verdict: "DRIFTED",
      sentence:
        `This console is running commit ${running}; every figure compiled into the snapshot was ` +
        `taken at ${input.snapshotCommit}. The two describe different repositories.`,
      fix: 'Run "npm run generate" and redeploy.',
    }
  }
  return {
    verdict: "MATCHED",
    sentence: `The snapshot was compiled at ${input.snapshotCommit}, which is the commit this console is running.`,
    fix: null,
  }
}

/* ------------------------------------------------------------ masking ---- */

/**
 * An account id with its middle removed: `154937…97`, never the twelve digits.
 *
 * The convention is the one `tools/aws-inventory.mjs` applies when it writes
 * the committed inventory — first four, ellipsis, last two — and it is applied
 * again here because THIS panel's account id does not come from that artifact.
 * It comes from a live `sts:GetCallerIdentity`, which returns the real thing,
 * and a page that prints a masked account in one card and the unmasked one in
 * the next has not masked anything.
 *
 * `e2e/platform.spec.ts` asserts that no twelve consecutive digits appear
 * anywhere in this page's rendered text, which is the check that fails if this
 * is ever bypassed for "just the header".
 *
 * A short or empty id is returned unchanged rather than padded: inventing
 * characters to reach a shape is how a masked id stops matching the real one an
 * operator is comparing it against.
 */
export function maskAccountId(accountId: string): string {
  if (accountId.length < 8) return accountId
  return `${accountId.slice(0, 4)}…${accountId.slice(-2)}`
}

/**
 * The same mask, applied to every occurrence of the account id inside an ARN.
 *
 * A principal ARN carries the account in its fifth segment, so printing the ARN
 * unmasked beside a masked account id would publish exactly what the mask is
 * for. `split`/`join` rather than a regular expression built from the id, for
 * the reason `aws-inventory.mjs` gives at the same line: an account id is
 * digits, and a hand-built pattern is one escaping mistake from matching
 * nothing at all and reporting success.
 */
export function maskArn(arn: string, accountId: string | null): string {
  if (!accountId || accountId.length < 8) return arn
  return arn.split(accountId).join(maskAccountId(accountId))
}

/* ------------------------------------------------------- refused reads --- */

/**
 * A refusal exactly as the read-only inventory recorded it.
 *
 * Every field after `reason` is optional because the committed artifact is
 * versioned and older rows carry only the first two. Declaring them optional
 * here — rather than widening the inventory's own type, which has other
 * consumers — is what lets this module read a richer row when the generator
 * produces one and stay honest about what it does not have when it does not.
 */
export interface RecordedDenial {
  /** The call as the collector names it: `"organizations describe-organization"`. */
  readonly call: string
  /** Why the collector recorded it as refused, verbatim. */
  readonly reason: string
  readonly errorCode?: string
  readonly principal?: string
  readonly accountId?: string
  readonly region?: string
  readonly partition?: string
  /** The statement the collector derived at the time, as JSON. */
  readonly minimumStatement?: string
}

/** Where the pasteable statement on a refusal row came from. */
export type StatementSource =
  /** The collector recorded one when it made the call. */
  | "recorded"
  /** Derived from this engine's own capability registry. */
  | "registry"
  /** Neither — the call is not one this engine declares, and none is invented. */
  | "none"

export interface RefusedRead {
  /** Stable within the list, and the React key. */
  key: string
  call: string
  reason: string
  /** The capability this call corresponds to, or null when the engine declares none. */
  capability: Capability | null
  /** JSON an operator pastes into a policy, or null when nothing grounds one. */
  minimumStatement: string | null
  statementSource: StatementSource
  /** Who the call was refused as, when the collector recorded it. */
  principal: string | null
  errorCode: string | null
}

/**
 * `"describe-organization"` → `"DescribeOrganization"`.
 *
 * The collector spells a call in the CLI's own notation because it IS the CLI;
 * IAM spells the same call in PascalCase. One transform, here, so the refusal
 * row and the capability registry cannot spell the same action two ways.
 */
function pascalCase(operation: string): string {
  return operation
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
}

/**
 * The capability a recorded call corresponds to, or null.
 *
 * Null rather than a guess, and this is the arm that matters. The CLI's service
 * name is not always IAM's prefix — `aws elbv2 …` authorizes under
 * `elasticloadbalancing:` — so a mapping that assumed they were the same would
 * mint a plausible capability key that is not in the registry, and print a
 * "minimum statement" that grants nothing. A call this engine does not declare
 * is reported as exactly that: the collector makes it, the console does not.
 */
export function capabilityForCall(call: string): Capability | null {
  const parts = call.trim().split(/\s+/)
  if (parts.length !== 2) return null
  const [service, operation] = parts
  if (!service || !operation) return null
  const key = `${service}:${pascalCase(operation)}`
  return (ALL_CAPABILITIES as readonly string[]).includes(key) ? (key as Capability) : null
}

/**
 * The refusals, each with the statement that would fix it.
 *
 * A recorded statement wins over a derived one: the collector made the call, in
 * the partition and account it was refused in, and its statement is evidence
 * where the registry's is a reconstruction. When neither exists the row says so
 * rather than printing a statement nobody can paste.
 */
export function refusedReads(denials: readonly RecordedDenial[]): readonly RefusedRead[] {
  return denials.map((denial, position) => {
    const capability = capabilityForCall(denial.call)
    const recorded = denial.minimumStatement?.trim()
    const minimumStatement = recorded
      ? recorded
      : capability
        ? minimumStatementText(capability)
        : null
    return {
      // The call, disambiguated by position: the collector can record the same
      // call twice — once per region — and two rows with one key is a React
      // duplicate-key warning that `platform.spec.ts` collects as a browser
      // error and fails every test in the file on.
      key: `${denial.call}#${position}`,
      call: denial.call,
      reason: denial.reason,
      capability,
      minimumStatement,
      statementSource: recorded ? "recorded" : capability ? "registry" : "none",
      principal: denial.principal ?? null,
      errorCode: denial.errorCode ?? null,
    }
  })
}

/* --------------------------------------------------- declared capability -- */

export interface SurfaceCapabilities {
  surface: SurfaceKey
  /** How many capabilities in the registry feed this surface. */
  capabilities: number
  /** How many distinct IAM actions those capabilities need. */
  actions: number
  /** The shortest refresh window on the surface, in milliseconds. */
  fastestRefreshMs: number
  /** How many of this surface's capabilities appear in the refusals. */
  refused: number
}

/**
 * What this engine declares it is able to ask AWS for, per surface.
 *
 * Read out of the registry rather than written down. A hand-kept table would
 * say "41 reads over 27 services" on the day it was typed and keep saying it
 * after the twenty-eighth arrived — which is the same defect as a hard-coded
 * count anywhere else on this console, in the one place a reader is least
 * likely to check.
 *
 * Surfaces come out in the order the registry declares them, so the table does
 * not reorder itself when a capability is added, and no locale-dependent
 * comparison decides the rows.
 */
export function declaredBySurface(
  refused: readonly RefusedRead[] = [],
): readonly SurfaceCapabilities[] {
  const refusedCounts = new Map<SurfaceKey, number>()
  for (const row of refused) {
    if (!row.capability) continue
    const surface = CAPABILITIES[row.capability].surface
    refusedCounts.set(surface, (refusedCounts.get(surface) ?? 0) + 1)
  }

  const order: SurfaceKey[] = []
  const bySurface = new Map<SurfaceKey, { actions: Set<string>; capabilities: number; fastest: number }>()
  for (const capability of ALL_CAPABILITIES) {
    const spec = CAPABILITIES[capability]
    let entry = bySurface.get(spec.surface)
    if (!entry) {
      entry = { actions: new Set<string>(), capabilities: 0, fastest: spec.refreshMs }
      bySurface.set(spec.surface, entry)
      order.push(spec.surface)
    }
    entry.capabilities += 1
    entry.fastest = Math.min(entry.fastest, spec.refreshMs)
    for (const action of spec.iamActions) entry.actions.add(action)
  }

  return order.map((surface) => {
    const entry = bySurface.get(surface)!
    return {
      surface,
      capabilities: entry.capabilities,
      actions: entry.actions.size,
      fastestRefreshMs: entry.fastest,
      refused: refusedCounts.get(surface) ?? 0,
    }
  })
}

/** Every distinct IAM action the registry needs, counted once. */
export function declaredActionCount(): number {
  return new Set(ALL_CAPABILITIES.flatMap((c) => [...CAPABILITIES[c].iamActions])).size
}

/* ---------------------------------------------------------- the verdict -- */

/** The seven arms of `AwsRead`, as the page hands them here. */
export type ReadState =
  | "ACTUAL"
  | "EMPTY"
  | "DENIED"
  | "STALE"
  | "THROTTLED"
  | "UNCONFIGURED"
  | "ERROR"

export type EngineVerdict = "BLIND" | "STALE_BUILD" | "UNVERIFIED_BUILD" | "PARTIAL" | "HEALTHY"

export interface EngineAnswer {
  verdict: EngineVerdict
  /** The sentence the page leads with. Answers the question in its first word. */
  headline: string
  /**
   * Every condition that is true right now, worst first.
   *
   * Not "the reason for the verdict" — all of them. A page that printed only
   * the worst would go quiet about two refused reads the moment the build also
   * drifted, and the operator would fix the build and believe they were done.
   */
  findings: readonly string[]
}

export interface EngineAnswerInput {
  /** The state `sts:GetCallerIdentity` came back in, this render. */
  identityState: ReadState
  build: BuildVerdict
  /** How many reads the committed inventory recorded as refused. */
  refusedReads: number
  /** How many service reads the inventory answered. */
  answeredReads: number
}

/**
 * The answer, and the rule that keeps it honest.
 *
 * `HEALTHY` is not a case here — it is what is left when `findings` is empty,
 * and the test beside this file asserts that equivalence over the whole input
 * space it can enumerate. That is the difference between a verdict and a
 * ternary: a ternary can be reordered into reassurance, and this cannot.
 *
 * The order findings are collected in is severity order, because the headline
 * is taken from the first one. Identity comes first for a reason: an engine
 * that cannot name the account it is running as is not describing an estate at
 * all, and every other panel on the page is a statement about an account.
 */
export function engineAnswer(input: EngineAnswerInput): EngineAnswer {
  const findings: string[] = []
  let verdict: EngineVerdict = "HEALTHY"
  let headline =
    `Yes, so far as this page can see. It knows which account and principal it is running as, ` +
    `its build is the commit its figures were compiled at, and all ` +
    `${input.answeredReads} of the service reads behind the estate panels answered.`

  const identityKnown = input.identityState === "ACTUAL" || input.identityState === "STALE"
  if (!identityKnown) {
    verdict = "BLIND"
    headline =
      "No — this engine cannot currently see itself. sts:GetCallerIdentity did not answer, so " +
      "nothing below can name the account, region or partition it is describing."
    findings.push(
      `Identity is unknown: sts:GetCallerIdentity came back ${input.identityState}, not ACTUAL. ` +
        `Until it answers, every account-scoped statement on this page is unattributed.`,
    )
  }

  if (input.build === "DRIFTED") {
    if (verdict === "HEALTHY") {
      verdict = "STALE_BUILD"
      headline =
        "Partly. It is running and knows who it is, but the figures below were compiled at a " +
        "different commit from the build serving them, so they describe an older repository."
    }
    findings.push(
      "The build serving this page and the commit its snapshot was compiled at are different.",
    )
  } else if (input.build === "UNSTAMPED") {
    if (verdict === "HEALTHY") {
      verdict = "UNVERIFIED_BUILD"
      headline =
        "Partly. It is running and knows who it is, but it cannot say which commit it was built " +
        "from, so nothing here can confirm the compiled figures describe this code."
    }
    findings.push(
      "This build carries no commit stamp, so the snapshot's freshness cannot be established either way.",
    )
  }

  if (input.refusedReads > 0) {
    if (verdict === "HEALTHY") {
      verdict = "PARTIAL"
      headline =
        `Mostly. It is running, knows who it is, and its build matches its figures — but ` +
        `${input.refusedReads} of its reads were refused, and those surfaces are unknown rather ` +
        `than empty.`
    }
    findings.push(
      `${input.refusedReads} read${input.refusedReads === 1 ? " was" : "s were"} refused. ` +
        `Each one is named below with the statement that would grant it.`,
    )
  }

  return { verdict, headline, findings }
}

/**
 * The word beside the headline. Never colour alone — this is the carrier.
 *
 * There is deliberately no duration formatter in this module. A refresh window
 * is rendered with `formatAge` from `components/md3/StaleIndicator`, which is
 * the same function every "as of" line on this console already uses. A second
 * one here would be a second set of thresholds, and the first screenshot in
 * which one panel said "1h" and the one below it said "60m" would be a defect
 * nobody could explain.
 */
export const VERDICT_WORD: Readonly<Record<EngineVerdict, string>> = {
  BLIND: "cannot see itself",
  STALE_BUILD: "describing an older commit",
  UNVERIFIED_BUILD: "build not stamped",
  PARTIAL: "reads refused",
  HEALTHY: "nothing found",
}
