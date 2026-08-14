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
 * Three modules, and none of them holds an SDK client, a credential path or
 * React. `capabilities.ts` is the vocabulary — a closed registry of every AWS
 * read this engine declares, with the IAM actions each one needs —
 * `@tenure/blueprints` supplies the one list an operator-facing surface may
 * draw tenants from, and `lib/aws/quotas.ts` is imported for its four pure
 * describers and its types.
 *
 * That third one is the one worth defending. `quotas.ts` is a reader, and a
 * reader's job is to talk to AWS; what is imported here is only the part of it
 * that turns a reading into a sentence, and no function in this file calls a
 * gateway. Nothing from `@aws-sdk` enters this module's graph either:
 * `read.ts`'s `liveGateway` reaches `client.ts` — the only file that imports
 * `server-only` and the SDK — through a dynamic `import()` inside the call, so
 * the static graph stops at `capabilities.ts`. `quotas.test.ts` already runs
 * under `apps/web`'s jest for the same reason.
 *
 * The alternative was to re-implement `describeHeadroom` and
 * `describeQuotaUsage` here, and that is exactly the defect the reader's own
 * header warns about: two implementations of "how much is left", one of which
 * would eventually print a bound as though it were a count.
 *
 * Everything else arrives as a plain argument. Nothing here reads the clock,
 * the environment or the filesystem. Same inputs, same output, on any machine.
 */

import { CUSTOMER_TENANT_BINDINGS } from "@tenure/blueprints"

import type { UnknownRead } from "../../components/md3/UnknownState"
import {
  ALL_CAPABILITIES,
  CAPABILITIES,
  minimumStatementText,
  type Capability,
  type SurfaceKey,
} from "../../lib/aws/capabilities"
import type { OrgAccount, OrganizationRead } from "../../lib/aws/organization"
import {
  DEFAULT_QUOTA_NOT_READABLE,
  describeCompleteness,
  describeHeadroom,
  describeQuotaAttribution,
  describeQuotaUsage,
  type AppliedQuota,
  type QuotaPressure,
  type QuotaReading,
  type QuotaReadings,
} from "../../lib/aws/quotas"
import type { AwsRead } from "../../lib/aws/read"

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

/* ═══════════════════════════════════════════════════════════════════════════
 * The two facts about the engine's own room to grow.
 *
 * `/platform` answers "is the engine healthy, and what does it currently know".
 * Two things it did not know were the ceilings it provisions into and whether
 * this estate is one account or many. Both readers existed, were tested, held a
 * capability and an IAM grant, and were reached by NO page — `quotas.ts` fed
 * `estateInventory` only as a coverage *signal* (a section state, not a single
 * applied value), and `organizationSurface` was reached from nothing at all.
 * Work an operator cannot see is indistinguishable from work that did not
 * happen, which is this page's own founding sentence.
 *
 * Everything below is pure: readings in, strings and row objects out. The two
 * awaits live in `page.tsx`.
 * ══════════════════════════════════════════════════════════════════════════ */

/* --------------------------------------------------------- masking, again -- */

/**
 * The four valueless arms of a reading, or null.
 *
 * The narrowing every consumer of this file would otherwise write inline, in
 * one place, so `UnknownState` is reached through a `switch` the compiler
 * checks rather than through a cast. A fifth valueless arm added to `AwsRead`
 * makes `UnknownRead` wider and this function stops returning it — which is a
 * compile error here rather than an arm rendered as a blank.
 */
export function unknownArm<T>(read: AwsRead<T>): UnknownRead | null {
  switch (read.state) {
    case "DENIED":
    case "THROTTLED":
    case "UNCONFIGURED":
    case "ERROR":
      return read
    default:
      return null
  }
}

/**
 * The same mask this page applies to its identity card, applied to a REFUSAL.
 *
 * A `DENIED` reading carries the account it was refused in and the principal
 * ARN it was refused as, both resolved live from STS and both carrying the real
 * twelve digits. `UnknownState` renders them verbatim — correctly; it is not
 * that component's business to decide what a page may publish — so a page that
 * masks its identity card and hands an unmasked refusal to the same screen has
 * masked nothing. `e2e/platform.spec.ts` fails the whole page on twelve
 * consecutive digits anywhere in its text, and before this existed the first
 * denial in production would have tripped it.
 *
 * The account the mask is built from is the reading's OWN, falling back to the
 * page's resolved identity: a denial recorded before identity answered carries
 * `accountId: null`, and there is then nothing to mask against but the number
 * the page itself resolved.
 *
 * The minimum statement is masked too. It is usually `"Resource":"*"`, but a
 * capability whose resource is account-scoped puts the account in the JSON, and
 * a statement is the one thing on that panel an operator copies whole.
 */
export function maskUnknownRead(read: UnknownRead, fallbackAccountId: string | null): UnknownRead {
  switch (read.state) {
    case "DENIED": {
      const account = read.accountId ?? fallbackAccountId
      if (!account) return read
      return {
        ...read,
        accountId: maskAccountId(account),
        principal: maskArn(read.principal, account),
        minimumStatement: maskArn(read.minimumStatement, account),
      }
    }
    case "ERROR":
      // `safeDetail` has had credential material stripped by `read.ts`; an
      // account id is not credential material and survives it, so an ARN in an
      // error message is the other way twelve digits reach this page.
      return fallbackAccountId
        ? { ...read, safeDetail: maskArn(read.safeDetail, fallbackAccountId) }
        : read
    case "THROTTLED":
    case "UNCONFIGURED":
      // Neither arm carries an account, a principal or a statement. Returned
      // unchanged rather than spread, so this cannot quietly become a copy that
      // drops a field the union gains later.
      return read
  }
}

/* ------------------------------------------------------------- the ceilings -- */

/** One quota whose applied value AWS actually answered with. */
export interface QuotaRow {
  /** `QUOTA_TARGETS` key. Stable, and the React key. */
  key: string
  quotaName: string
  serviceCode: string
  quotaCode: string
  /** What running out of it does to a provisioning run, in the reader's words. */
  bounds: string
  /** The applied value, its unit and its period — exactly as AWS answered. */
  applied: string
  /** Account-wide or per region, and whether an increase can even be requested. */
  scope: string
  /**
   * Whether this value has been RAISED from the AWS default.
   *
   * Never a "no". The default is not in any response this engine may fetch —
   * see `DEFAULT_QUOTA_NOT_READABLE` — so this is the short form of "not known"
   * and it sits in the same cell as the applied value on purpose. An applied
   * value printed alone reads as the default, and for a quota somebody raised
   * eighteen months ago that is exactly backwards.
   */
  raised: string
  usage: string
  headroom: string
  attribution: string
  /** Which route resolved it, by code or by name. Never silent. */
  provenance: string
  /** Set only when this quota's SERVICE listing was cut short. */
  truncated: string | null
  /** Held from an older reading, so the row can say so. */
  stale: boolean
  asOf: string
  refreshMs: number
}

/** The applied value with its unit and period. Nothing derived, nothing rounded. */
export function appliedValueText(quota: AppliedQuota): string {
  const unit = quota.unit ? ` ${quota.unit}` : ""
  const period = quota.period ? ` per ${quota.period.value} ${quota.period.unit}` : ""
  return `${quota.value}${unit}${period}`
}

/** The short form of "we do not know whether this was raised". */
export const RAISED_NOT_KNOWN = `against the AWS default: not known — ${DEFAULT_QUOTA_NOT_READABLE.iamAction} is not held`

/**
 * The quotas that answered, as rows.
 *
 * Only the readings carrying a value. A target whose read failed is NOT a row
 * with blanks in it and is not dropped either — `unreadableQuotas` below
 * returns it, and the page renders it through `UnknownState` with the statement
 * that would grant it. The two functions partition the same list, and
 * `quotaCoverage` asserts the partition adds up.
 */
export function quotaRows(readings: QuotaReadings): readonly QuotaRow[] {
  const rows: QuotaRow[] = []
  for (const reading of readings.quotas) {
    if (reading.quota.state !== "ACTUAL" && reading.quota.state !== "STALE") continue
    const quota = reading.quota.value
    rows.push({
      key: reading.key,
      quotaName: reading.quotaName,
      serviceCode: reading.serviceCode,
      quotaCode: reading.quotaCode,
      bounds: reading.bounds,
      applied: appliedValueText(quota),
      scope: `${quota.scope === "ACCOUNT" ? "account-wide" : "per region"} · ${
        quota.adjustable
          ? "an increase can be requested"
          : "NOT adjustable — an increase cannot be requested"
      }`,
      raised: RAISED_NOT_KNOWN,
      // The reader's own sentences, not this file's. One funnel, so a bound
      // cannot be printed here as a count while the reader calls it a bound.
      usage: describeQuotaUsage(reading.usage),
      headroom: describeHeadroom(reading.headroom),
      attribution: describeQuotaAttribution(reading.attribution),
      provenance: quota.provenance,
      truncated:
        reading.listingCompleteness.kind === "truncated"
          ? describeCompleteness(reading.listingCompleteness)
          : null,
      stale: reading.quota.state === "STALE",
      asOf: reading.asOf,
      refreshMs: reading.refreshMs,
    })
  }
  return rows
}

/** A group of targets that failed the same way, for one `UnknownState`. */
export interface UnreadableQuota {
  /** Stable within the list, and the React key. */
  key: string
  /** What could not be read, in the operator's language. */
  what: string
  serviceCode: string
  quotaNames: readonly string[]
  read: UnknownRead
}

/**
 * The targets whose applied value was not read, grouped by how they failed.
 *
 * Grouped, because a denied `servicequotas:ListServiceQuotas` for `vpc` is ONE
 * refusal that answers for every `vpc` target: the reader hands the same
 * reading to each of them. Rendering it three times would say "three problems"
 * about one missing grant. The group key carries the state and the capability
 * as well as the service, so a service whose listing was denied AND whose
 * individual fallback errored is two groups with two different remedies — which
 * is the case a key of `serviceCode` alone silently merges.
 *
 * Order is the reader's own target order, which is the order a provisioning run
 * meets them, so this list does not reshuffle between renders.
 */
export function unreadableQuotas(
  readings: QuotaReadings,
  fallbackAccountId: string | null = null,
): readonly UnreadableQuota[] {
  const groups = new Map<string, { serviceCode: string; names: string[]; read: UnknownRead }>()
  const order: string[] = []

  for (const reading of readings.quotas) {
    const read = unknownArm(reading.quota)
    if (!read) continue
    const key = `${reading.serviceCode}|${read.state}|${read.capability}`
    let group = groups.get(key)
    if (!group) {
      group = {
        serviceCode: reading.serviceCode,
        names: [],
        read: maskUnknownRead(read, fallbackAccountId),
      }
      groups.set(key, group)
      order.push(key)
    }
    group.names.push(reading.quotaName)
  }

  return order.map((key) => {
    const group = groups.get(key)!
    return {
      key,
      what: `the applied value of ${group.names.join(", ")} [${group.serviceCode}]`,
      serviceCode: group.serviceCode,
      quotaNames: group.names,
      read: group.read,
    }
  })
}

/**
 * How much of the ceiling question was actually answered.
 *
 * Every number here is counted off the readings. The sentence exists because
 * the honest state of this engine today is "twelve ceilings read and almost
 * none of them has a usage number", and a card that printed twelve applied
 * values with no such sentence would read as twelve measured headrooms.
 */
export interface QuotaCoverage {
  /** How many quotas were asked for at all. */
  targets: number
  /** How many carry an applied value. */
  read: number
  /** How many do not, and are named below with the statement that would grant them. */
  unreadable: number
  /** How many have a usage number — exact or a lower bound — to compare against. */
  withUsage: number
  /** How many were read and have no usage number at all. */
  usageUnknown: number
  sentence: string
}

export function quotaCoverage(readings: QuotaReadings): QuotaCoverage {
  const targets = readings.quotas.length
  let read = 0
  let withUsage = 0
  let usageUnknown = 0

  for (const reading of readings.quotas) {
    if (reading.quota.state !== "ACTUAL" && reading.quota.state !== "STALE") continue
    read += 1
    // Keyed on the HEADROOM, not on the usage state, because headroom is what
    // the row prints. `usage.kind === "at-least"` with an unread applied value
    // cannot produce a headroom, and counting it as compared would overstate
    // what this card established.
    if (reading.headroom.kind === "not-known") usageUnknown += 1
    else withUsage += 1
  }

  const unreadable = targets - read
  const sentence =
    `${read} of ${targets} ceilings answered with an applied value` +
    (unreadable > 0
      ? `, and ${unreadable} did not — each of those is named below with the statement that would grant it`
      : "") +
    `. Of the ${read} that answered, ${withUsage} have a usage number to compare against and ` +
    `${usageUnknown} have none, so headroom is established for ${withUsage} of them and for no ` +
    `others. A quota with no usage number is not a quota with room.`

  return { targets, read, unreadable, withUsage, usageUnknown, sentence }
}

/**
 * The word beside the pressure badge. Never colour alone, exactly as the
 * verdict badge above.
 */
export const PRESSURE_WORD: Readonly<Record<QuotaPressure["kind"], string>> = {
  unknown: "no ceiling read",
  "no-usage-known": "headroom not established",
  clear: "no quota pressure",
  "at-risk": "near a ceiling",
}

/* ------------------------------------------------------- the organization -- */

/**
 * Whether this estate has an AWS Organization — three answers, kept apart.
 *
 * The console asserted this from a JSON file once: `/platform`'s estate table
 * still renders `estate.organizationInUse ? "in use" : "not in use"`, where the
 * boolean came from a CI script whose `describe-organization` call was DENIED
 * and whose helper turned a denial into a falsy value. The page therefore told
 * operators there was no Organization on the strength of not being allowed to
 * ask. This union has no arm that permits that collapse, which is the same
 * guarantee `organization.ts` states one level down.
 */
export type OrganizationAnswer =
  | {
      kind: "in-use"
      organizationId: string
      /** Masked here, never the twelve digits. */
      managementAccountId: string
      managementAccountArn: string
      featureSet: string
      sentence: string
      asOf: string
    }
  | {
      kind: "none"
      /** AWS itself said so. The one case where an error is information. */
      sentence: string
      /** What that answer means for the requirements that assume an Organization. */
      consequences: readonly string[]
      asOf: string
    }
  | {
      kind: "unknown"
      sentence: string
      read: UnknownRead
    }

/**
 * Does this string parse as the minimum IAM statement, or is it an error detail?
 *
 * `organization.ts` puts `minimumStatementText(...)` in `minimumStatement` when
 * the call was denied or throttled, and `safeDetail(error)` in the SAME field
 * for every other failure. Both are strings and the union does not separate
 * them, so a surface that trusted the field name would print a stack-shaped
 * error message inside a box labelled "paste this into a policy". That is worse
 * than printing nothing: an operator pastes it, IAM rejects it, and the console
 * has cost them the twenty minutes it exists to save.
 *
 * Parsed rather than pattern-matched. A statement is JSON with an `Effect` and
 * an `Action`; an error detail is not, and a regex over `"Effect"` would be
 * satisfied by an error message that happened to quote one.
 */
export function looksLikeStatement(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== "object" || parsed === null) return false
    const record = parsed as Record<string, unknown>
    return record.Effect === "Allow" && record.Action !== undefined
  } catch {
    return false
  }
}

/**
 * `OrganizationRead`'s UNKNOWN arm, as something `UnknownState` can render.
 *
 * `describeOrganization` predates `AwsRead` and returns its own three-state
 * union, so this is the adapter — and it is the place the distinction above is
 * made. A refusal becomes `DENIED`, carrying the pasteable statement, the
 * principal and the account the call was made in. Anything else becomes
 * `ERROR`, carrying the detail as a detail. Nothing invents a statement.
 */
export function organizationUnknownRead(
  organization: Extract<OrganizationRead, { state: "UNKNOWN" }>,
  identity: { accountId: string | null; region: string | null; partition: string | null } | null,
): UnknownRead {
  const capability: Capability = "organizations:DescribeOrganization"
  if (looksLikeStatement(organization.minimumStatement)) {
    return maskUnknownRead(
      {
        state: "DENIED",
        capability,
        action: organization.action,
        principal: organization.principal,
        accountId: identity?.accountId ?? null,
        region: identity?.region ?? null,
        partition: identity?.partition ?? null,
        errorCode: organization.errorCode,
        minimumStatement: organization.minimumStatement,
      },
      identity?.accountId ?? null,
    )
  }
  return maskUnknownRead(
    {
      state: "ERROR",
      capability,
      code: organization.errorCode,
      safeDetail: organization.minimumStatement,
    },
    identity?.accountId ?? null,
  )
}

/**
 * What this estate's Organization answer is, and what it costs the programme.
 *
 * The `none` arm carries `consequences` rather than leaving the page to write
 * them, because "there is no Organization" is not a neutral fact here: two
 * decided requirements rest on it and a third read cannot be made at all. A
 * page that printed "not in use" and moved on would be technically correct and
 * would tell an operator nothing they could act on.
 */
export function organizationAnswer(
  organization: OrganizationRead,
  identity: { accountId: string | null; region: string | null; partition: string | null } | null,
): OrganizationAnswer {
  switch (organization.state) {
    case "IN_USE":
      return {
        kind: "in-use",
        organizationId: organization.organizationId,
        managementAccountId: maskAccountId(organization.managementAccountId),
        managementAccountArn: maskArn(
          organization.managementAccountArn,
          organization.managementAccountId,
        ),
        featureSet: organization.featureSet,
        sentence:
          `This estate is governed by an AWS Organization, and this account is the one that ` +
          `manages it. Every account below is inside that Organization.`,
        asOf: organization.asOf,
      }
    case "NOT_IN_USE":
      return {
        kind: "none",
        sentence:
          "AWS answered that there is no Organization here. That is a read, not a refusal and " +
          "not an absence of one: AWSOrganizationsNotInUseException is the one case where an " +
          "error is information, and this estate is a single AWS account.",
        consequences: [
          "STUDIO-010-001 asks for twelve separated account roles — management, log archive, " +
            "security, identity, network, control-plane production and nonproduction, tooling, " +
            "regional cells, dedicated tenants, backup and sandbox. None of them can be FILLED " +
            "in a single-account estate, and the requirement's own clause — as justified by " +
            "actual scale — is what makes that a legitimate answer rather than a failure.",
          "STUDIO-010-002 asks that day-to-day workloads stay out of the Organizations " +
            "management account. There is no management account here, so the separation is " +
            "vacuous rather than achieved: nothing is being kept out of anything.",
          "The account list was never asked for. organizations:ListAccounts is a capability " +
            "this engine holds and did not spend, because there is no Organization to list " +
            "accounts from — which is different from an Organization that returned none.",
          "The roots and the OU hierarchy STUDIO-010-003 asks for are not read at all. This " +
            "engine declares no organizations:ListRoots capability, so an empty root list here " +
            "would be the absence of a read rather than a reading of an absence.",
        ],
        asOf: organization.asOf,
      }
    case "UNKNOWN":
      return {
        kind: "unknown",
        sentence:
          "Whether this estate has an Organization is not known. The call did not answer, so " +
          "nothing here says there is one and nothing here says there is not — and in " +
          "particular the four consequences a single-account estate would carry are NOT being " +
          "claimed.",
        read: organizationUnknownRead(organization, identity),
      }
  }
}

/**
 * The word beside the Organization badge.
 *
 * "not known" is a word, not an absence of one. A badge that went blank on the
 * arm where the read failed would be the same defect as an empty table, wearing
 * a pill.
 */
export const ORGANIZATION_WORD: Readonly<Record<OrganizationAnswer["kind"], string>> = {
  "in-use": "an Organization, managed here",
  none: "no Organization — one account",
  unknown: "not known — the read did not answer",
}

/** One account in the Organization, with the account id masked. */
export interface OrgAccountRow {
  key: string
  /** Masked. `e2e/platform.spec.ts` fails the page on twelve consecutive digits. */
  id: string
  name: string
  status: string
}

/**
 * The accounts, masked, in the order Organizations returned them.
 *
 * The registered email each account carries is deliberately NOT rendered:
 * `organization.ts` says it is carried for matching an account whose name is
 * ambiguous, and a root account's address on a console panel is a credential
 * reset target rather than an operational fact.
 */
export function orgAccountRows(accounts: readonly OrgAccount[]): readonly OrgAccountRow[] {
  return accounts.map((account, position) => ({
    /*
     * The MASKED id, disambiguated by position.
     *
     * Position for the reason every other list on this page carries one: two
     * rows with one key is a React duplicate-key warning, which
     * `platform.spec.ts` collects as a browser error and fails the whole file
     * on. Masked because the raw id is twelve digits and a React key is a
     * string this row hands to the renderer — it is not drawn today, and
     * "not drawn today" is the assumption that ends with an account id in a
     * `data-` attribute the next time somebody needs one. Uniqueness comes
     * from the position, so masking costs nothing.
     */
    key: `${maskAccountId(account.id)}#${position}`,
    id: maskAccountId(account.id),
    name: account.name,
    status: account.status,
  }))
}
