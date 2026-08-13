/**
 * STUDIO-070-004 (EventBridge) — a scheduled job that stopped running, seen.
 *
 * `infrastructure/terraform/scheduler.tf` creates ONE rule,
 * `<prefix>-deliverable-reminders`, on `cron(0 13 * * ? *)`, pointing at an API
 * destination that POSTs `/api/jobs/reminders`. It is the only thing that makes
 * a club's 24-hour deliverable warning fire. Nothing in this console could read
 * it back, so "the reminders stopped" and "the rule is DISABLED" were the same
 * blank screen — and a disabled EventBridge rule raises no alarm, fails no
 * health check and appears in no error log. It simply does not run.
 *
 * That is the same defect shape as an alarm whose actions are switched off, and
 * `alarms.ts` already decided how to render it: DISABLED **outranks** OK,
 * because a rule reported as healthy while it is switched off is the most
 * reassuring lie the surface can tell. This module follows that precedent
 * literally — `ruleVerdict` checks `State === "DISABLED"` before it looks at
 * anything else, exactly as `verdictFor` checks `ActionsEnabled === false`
 * before it looks at `StateValue`.
 *
 * Three further states earn their own verdict for the same reason:
 *
 *   NO_TARGET        the rule is ENABLED, its schedule is live, and
 *                    `ListTargetsByRule` returned — successfully — nothing. It
 *                    fires into empty space. Terraform can produce this: delete
 *                    the `aws_cloudwatch_event_target` and the rule survives.
 *   TARGETS_UNKNOWN  `ListTargetsByRule` was refused, throttled or broke. This
 *                    is NOT NO_TARGET and the distinction is the whole point:
 *                    "this rule invokes nothing" and "we were not allowed to
 *                    ask what it invokes" are opposite facts, and only one of
 *                    them is a defect the operator should go and fix.
 *   UNTRIGGERED      ENABLED with neither a schedule expression nor an event
 *                    pattern. It cannot fire whatever its targets say.
 *
 * ## Nothing here is ever an empty list because a call failed
 *
 * Every read returns `AwsRead<T>` from `read.ts`. A denied `events:ListRules`
 * arrives as DENIED carrying the principal, the action and a pasteable minimum
 * IAM statement, and this module renders it as ONE row whose verdict is
 * UNAUTHORIZED — never as `rows: []`. A throttle is its own state, distinct
 * from both. An operator reading "no scheduled jobs" when the truth is "we were
 * not allowed to look" is the failure this whole directory exists to prevent.
 *
 * ## No region literal anywhere
 *
 * EventBridge rules are REGIONAL. Which region these rules are in is therefore a
 * fact the surface has to state, and it comes from the resolved identity —
 * `sts:GetCallerIdentity` plus the SDK's own resolved region — or it is `null`
 * and the surface says the region is unknown. It is never `"us-east-1"`. That
 * literal, written confidently under an unresolved identity, is GE-010-007: a
 * data-residency defect that tells an operator a job runs in a jurisdiction it
 * does not run in.
 *
 * ## No `@aws-sdk` import
 *
 * Every call goes through the `AwsGateway` seam declared in `read.ts`, so this
 * module loads — and is proven — outside a server component, and
 * `tests/architecture/forbidden-clients.test.mjs` keeps the one client where it
 * is. Response shapes are declared here rather than imported, as `identity.ts`
 * and `tags.ts` declare theirs.
 */

import { EVENTBRIDGE_TTL_MS } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  describeRead,
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import { attributionOf, tagIndex, taggedResources, type Attribution, type TaggedResource } from "./tags"
import { READ_ATTEMPTS, backoffMs, isTransient } from "./throttle"

/* ------------------------------------------------------------- verdicts -- */

export const RULE_VERDICTS = [
  "SCHEDULED",
  "EVENT_DRIVEN",
  "UNTRIGGERED",
  "NO_TARGET",
  "TARGETS_UNKNOWN",
  "STATE_UNKNOWN",
  "DISABLED",
  "UNAUTHORIZED",
  "UNREADABLE",
] as const

export type RuleVerdict = (typeof RULE_VERDICTS)[number]

/**
 * A word per verdict. Bible §26.3.2: never colour alone.
 *
 * UNAUTHORIZED and UNREADABLE are two words rather than one because they are two
 * remedies. The first is fixed by pasting an IAM statement; the second is fixed
 * by waiting, or by reading the error. Collapsing them into "unknown" sends half
 * of the readers to the wrong console.
 */
export const RULE_WORDS: Readonly<Record<RuleVerdict, string>> = {
  SCHEDULED: "On schedule",
  EVENT_DRIVEN: "On a pattern",
  UNTRIGGERED: "Cannot fire",
  NO_TARGET: "Enabled and inert",
  TARGETS_UNKNOWN: "Targets unknown",
  STATE_UNKNOWN: "State unrecognised",
  DISABLED: "Switched off",
  UNAUTHORIZED: "Unknown — refused",
  UNREADABLE: "Unknown — not read",
}

/* ------------------------------------------------------- response shapes -- */

/** The fields of an EventBridge rule summary this module reads. */
interface RawRule {
  Name?: string
  Arn?: string
  EventPattern?: string
  State?: string
  Description?: string
  ScheduleExpression?: string
  /** Set when another AWS service owns the rule; such a rule must not be edited. */
  ManagedBy?: string
  EventBusName?: string
}

interface ListRulesResponse {
  Rules?: RawRule[]
  NextToken?: string
}

interface RawTarget {
  Id?: string
  Arn?: string
  RoleArn?: string
  Input?: string
  InputPath?: string
  RetryPolicy?: { MaximumRetryAttempts?: number; MaximumEventAgeInSeconds?: number }
  DeadLetterConfig?: { Arn?: string }
}

interface ListTargetsResponse {
  Targets?: RawTarget[]
  NextToken?: string
}

/* ----------------------------------------------------------------- rows -- */

/**
 * One thing a rule invokes.
 *
 * `Input` is deliberately NOT carried, only whether one is present. A target
 * input is arbitrary caller-supplied JSON — `scheduler.tf` sends `{}`, but the
 * field is where a payload with a bearer token or a tenant identifier would sit,
 * and a console that renders every rule in the account has no use for the body
 * of any of them. `hasInput` answers the only question this surface asks of it,
 * which is whether EventBridge forwards its own event envelope or a fixed body.
 */
export interface RuleTarget {
  id: string
  arn: string
  /** The service segment of the target ARN — `lambda`, `sqs`, `events`, … */
  service: string | null
  /** The role EventBridge assumes to invoke it. Null means it needs none. */
  roleArn: string | null
  hasInput: boolean
  /** Null means the target inherits EventBridge's default retry policy. */
  retryAttempts: number | null
  /**
   * Where failed invocations go. Null is a finding in its own right: a target
   * with no dead-letter queue drops an event that could not be delivered, and
   * nothing records that it happened.
   */
  deadLetterArn: string | null
}

/**
 * Who a rule belongs to.
 *
 * `Attribution` from `tags.ts` — tenant, shared, unattributed — plus a fourth
 * arm this surface needs and that one does not have: the tag index itself may be
 * unreadable. When `tag:GetResources` is refused, EVERY rule would come back
 * with no tags, and folding that into "shared" would attribute the whole estate
 * to platform overhead on the strength of a call nobody was allowed to make.
 *
 * The three arms of `Attribution` are kept exactly as `tags.ts` defines them, so
 * `unattributed` is NOT folded into `shared`. That fold is a bug this repository
 * has already paid for once — see `attributionOf` — because "somebody decided
 * this is platform overhead" and "nobody tagged it" are different facts, and
 * only the second is something to go and fix.
 */
export type RuleAttribution = Attribution | { kind: "unknown"; why: string }

export interface RuleRow {
  name: string
  /** From the API. Null when EventBridge answered without one — never invented. */
  arn: string | null
  busName: string
  verdict: RuleVerdict
  /** The sentence the table prints. Carries the remedy for every unknown state. */
  detail: string
  /** `cron(…)` or `rate(…)` exactly as EventBridge holds it, or null. */
  schedule: string | null
  /** Whether the rule carries an event pattern. The pattern text is not carried. */
  eventDriven: boolean
  /** The raw state string, so an unrecognised one is visible rather than mapped away. */
  state: string | null
  /** Set when an AWS service owns this rule rather than this estate's Terraform. */
  managedBy: string | null
  description: string | null
  /**
   * The per-rule targets read, as a union.
   *
   * Carried rather than flattened so a caller cannot render "0 targets" for a
   * refused `events:ListTargetsByRule`. `targetCount` is `null` for exactly the
   * states where the count is not known, which is the same discipline expressed
   * as a number a template can check.
   */
  targetsRead: AwsRead<readonly RuleTarget[]>
  targetCount: number | null
  attribution: RuleAttribution
}

/* -------------------------------------------------------------- helpers -- */

/** The service segment of an ARN, or null for anything that is not one. */
export function serviceOf(arn: string): string | null {
  const parts = arn.split(":")
  if (parts.length < 6 || parts[0] !== "arn") return null
  return parts[2] || null
}

function targetsFrom(raw: readonly RawTarget[]): RuleTarget[] {
  const out: RuleTarget[] = []
  for (const target of raw) {
    if (!target.Id || !target.Arn) continue
    out.push({
      id: target.Id,
      arn: target.Arn,
      service: serviceOf(target.Arn),
      roleArn: target.RoleArn ?? null,
      hasInput: typeof target.Input === "string" || typeof target.InputPath === "string",
      retryAttempts:
        typeof target.RetryPolicy?.MaximumRetryAttempts === "number"
          ? target.RetryPolicy.MaximumRetryAttempts
          : null,
      deadLetterArn: target.DeadLetterConfig?.Arn ?? null,
    })
  }
  return out
}

/**
 * How many targets, or null when that is not known.
 *
 * STALE counts, because a held reading is a reading. DENIED, THROTTLED, ERROR
 * and UNCONFIGURED are null, because zero would be a claim none of them made.
 */
function countOf(read: AwsRead<readonly RuleTarget[]>): number | null {
  if (read.state === "ACTUAL" || read.state === "STALE") return read.value.length
  if (read.state === "EMPTY") return 0
  return null
}

/** What a rule fires on, in words, for the detail sentences to share. */
function triggerOf(rule: { schedule: string | null; eventDriven: boolean }): string {
  if (rule.schedule) return `its schedule ${rule.schedule}`
  if (rule.eventDriven) return "its event pattern"
  return "nothing — it has neither a schedule nor an event pattern"
}

/* ------------------------------------------------------------- the verdict -- */

/**
 * One rule's verdict.
 *
 * Order is the argument, and it is `alarms.ts`'s order:
 *
 *   1. DISABLED first, before anything else is consulted. A switched-off rule is
 *      not "scheduled" whatever its cron expression says — the expression is
 *      still there, still correct, and still not running.
 *   2. An unrecognised state next. EventBridge's enum grew a third member
 *      (`ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS`), so anything beginning
 *      `ENABLED` is enabled and anything else is reported rather than assumed.
 *   3. UNTRIGGERED before the target states, because it is the CERTAIN defect:
 *      a rule with no schedule and no pattern cannot fire, and that is known
 *      without asking about targets at all.
 *   4. TARGETS_UNKNOWN before NO_TARGET, so an unreadable target list can never
 *      be printed as an empty one.
 */
export function ruleVerdict(
  rule: {
    schedule: string | null
    eventDriven: boolean
    state: string | null
    managedBy: string | null
  },
  targetsRead: AwsRead<readonly RuleTarget[]>,
): { verdict: RuleVerdict; detail: string } {
  const managed = rule.managedBy ? ` Managed by ${rule.managedBy}, not by this estate's Terraform.` : ""

  if (rule.state === "DISABLED") {
    return {
      verdict: "DISABLED",
      detail:
        `switched off — ${triggerOf(rule)} has not fired since somebody disabled this rule, and a disabled rule ` +
        `raises no alarm, logs no error and appears in no failure count. It simply stops.${managed}`,
    }
  }

  if (!rule.state || !rule.state.startsWith("ENABLED")) {
    return {
      verdict: "STATE_UNKNOWN",
      detail:
        `EventBridge reported state ${JSON.stringify(rule.state)}, which is neither DISABLED nor an ENABLED ` +
        `variant. Whether ${triggerOf(rule)} fires cannot be decided from it.${managed}`,
    }
  }

  if (!rule.schedule && !rule.eventDriven) {
    return {
      verdict: "UNTRIGGERED",
      detail:
        `enabled, and nothing can trigger it — it carries neither a schedule expression nor an event pattern, ` +
        `so no target of it will ever be invoked.${managed}`,
    }
  }

  if (targetsRead.state === "EMPTY") {
    return {
      verdict: "NO_TARGET",
      detail:
        `enabled and inert — ${triggerOf(rule)} is live and events:ListTargetsByRule answered, successfully, ` +
        `with no targets. It fires into nothing.${managed}`,
    }
  }

  if (targetsRead.state !== "ACTUAL" && targetsRead.state !== "STALE") {
    return {
      verdict: "TARGETS_UNKNOWN",
      detail:
        `enabled on ${triggerOf(rule)}, and what it invokes could not be read. This is NOT "no targets": ` +
        `${describeRead(targetsRead, "targets of this rule")}${managed}`,
    }
  }

  const count = targetsRead.value.length
  const dlqless = targetsRead.value.filter((t) => t.deadLetterArn === null).length
  const dlqNote = dlqless
    ? ` ${dlqless} of them has no dead-letter queue, so an invocation that fails is dropped without record.`
    : ""

  if (rule.schedule) {
    return {
      verdict: "SCHEDULED",
      detail: `enabled on ${rule.schedule}, invoking ${count} target(s).${dlqNote}${managed}`,
    }
  }
  return {
    verdict: "EVENT_DRIVEN",
    detail: `enabled on an event pattern, invoking ${count} target(s).${dlqNote}${managed}`,
  }
}

/* --------------------------------------------------------- attribution -- */

/**
 * Which tenant a rule belongs to, from the tag index and from nothing else.
 *
 * Two things produce `unknown` rather than a guess: a tag index that could not
 * be read, and a rule EventBridge returned without an ARN — there is no join key
 * for the second, and constructing one out of the account id and the rule name
 * would be inventing the very fact being looked up.
 */
export function ruleAttribution(
  arn: string | null,
  tags: Map<string, Readonly<Record<string, string>>>,
  tagged: AwsRead<readonly TaggedResource[]>,
): RuleAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: describeRead(tagged, "the tenant tag index"),
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why: "events:ListRules returned this rule without an ARN, so there is no key to join it to the tag index on.",
    }
  }
  return attributionOf(tags.get(arn) ?? {})
}

/** The sentence a surface prints for one rule's attribution. One renderer. */
export function describeRuleAttribution(attribution: RuleAttribution): string {
  switch (attribution.kind) {
    case "tenant":
      return attribution.tenantSlug
    case "shared":
      return "shared — platform overhead, decided"
    case "unattributed":
      return "unattributable — missing tenure:tenant"
    case "unknown":
      return `unknown — ${attribution.why}`
  }
}

/* -------------------------------------------------------------- reading -- */

/** How many pages of rules to walk per bus before giving up. A runaway loop is an outage. */
const MAX_PAGES = 20

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * One gateway call, retried on the schedule `throttle.ts` owns.
 *
 * The division of labour is deliberate. `throttle.ts` decides WHEN to try again
 * — `isTransient`, `READ_ATTEMPTS`, `backoffMs` — and it knows about four
 * transient names `read.ts` does not (`LimitExceededException`,
 * `ServiceUnavailable`, `InternalServerError`, `TransactionInProgressException`),
 * which would otherwise arrive at the page as a red ERROR box for a condition
 * that clears itself. `read.ts` decides WHAT HAPPENED once the budget is spent.
 *
 * `readWithBackoff` is not used directly because it converts the error to a
 * string, and a string cannot be classified: `isDenial` needs the error object
 * to produce DENIED with a pasteable statement rather than ERROR with a message.
 * So the schedule is reused and the error is rethrown intact.
 */
async function callRetrying(
  gw: AwsGateway,
  capability: "events:ListRules" | "events:ListTargetsByRule",
  input: Record<string, unknown>,
  wait: (ms: number) => Promise<void>,
): Promise<unknown> {
  let last: unknown = null
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await wait(backoffMs(attempt))
    try {
      return await gw.call(capability, input)
    } catch (error) {
      last = error
      // A denial does not get a second attempt. Retrying it makes the page
      // slower and the answer no better.
      if (!isTransient(error)) throw error
    }
  }
  throw last
}

/**
 * `readAws` options shared by both capabilities.
 *
 * `attempts: 1` because `callRetrying` has already spent the budget; retrying
 * again here would double the wait an operator sits through. The backoff figure
 * handed to `readAws` is what THROTTLED reports as `retryAfterMs`, and it is
 * `backoffMs(READ_ATTEMPTS + 1)` — the moment the next attempt would run if the
 * schedule had one more in it. Same number `throttle.ts` puts in `nextAttemptAt`,
 * from the same function, so the console cannot quote two different waits.
 */
function readPolicy(now: () => Date, denial: DenialContext) {
  return {
    now,
    denial,
    attempts: 1,
    backoffMs: backoffMs(READ_ATTEMPTS + 1),
  }
}

async function readTargets(
  gw: AwsGateway,
  ruleName: string,
  busName: string,
  now: () => Date,
  denial: DenialContext,
  wait: (ms: number) => Promise<void>,
): Promise<AwsRead<readonly RuleTarget[]>> {
  return readAws<readonly RuleTarget[]>(
    "events:ListTargetsByRule",
    async () => {
      const out: RuleTarget[] = []
      let token: string | undefined
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = (await callRetrying(
          gw,
          "events:ListTargetsByRule",
          { Rule: ruleName, EventBusName: busName, NextToken: token },
          wait,
        )) as ListTargetsResponse
        out.push(...targetsFrom(response?.Targets ?? []))
        token = response?.NextToken || undefined
        if (!token) break
      }
      return out
    },
    // The default emptiness test is kept ON purpose: a rule with no targets is
    // genuinely EMPTY, and EMPTY is what `ruleVerdict` turns into NO_TARGET.
    // Overriding it to `() => false` here would erase the difference between a
    // rule that invokes nothing and one whose targets could not be read, which
    // is the exact distinction this module exists to keep.
    readPolicy(now, denial),
  )
}

/* -------------------------------------------------------------- surface -- */

export interface EventBridgeSurface {
  identity: AwsRead<Identity>
  /** The rules read, as a union. A denial is DENIED here, never `rows: []`. */
  read: AwsRead<readonly RuleRow[]>
  /**
   * The rows a table renders.
   *
   * Never empty for a read that failed: a refused, throttled or broken read
   * produces exactly one row carrying the reason, so a surface that renders only
   * `rows` still cannot print a denial as an absence.
   */
  rows: readonly RuleRow[]
  /** The sentence the page leads with. One funnel, as `alarms.ts` has one. */
  headline: string
  /** From the resolved identity. Null when it could not be resolved. Never a literal. */
  accountId: string | null
  region: string | null
  partition: string | null
  /** Which buses were asked. A rule on a bus not in this list was not looked at. */
  busesRead: readonly string[]
  /** That scope limit, stated, so silence about other buses is not read as absence. */
  scopeNote: string
  /** Explicit, and the same instant every row was verdicted against. */
  asOf: string
  /** This capability's own cadence, not a global one. */
  refreshMs: number
  /** The tag index this attribution was drawn from, so its own state is visible. */
  tagged: AwsRead<readonly TaggedResource[]>
}

export interface EventBridgeOptions {
  now?: () => Date
  /**
   * Which event buses to read. `default` is where `scheduler.tf` puts its rule.
   *
   * Explicit rather than discovered: `events:ListEventBuses` is not in the
   * capability registry, so this surface reads the buses it is told to and
   * SAYS SO in `scopeNote`. A stated scope is not the same as a silent absence.
   */
  buses?: readonly string[]
  /** Injected so a throttle test spends no real time. Defaults to a real sleep. */
  wait?: (ms: number) => Promise<void>
  identity?: AwsRead<Identity>
  tagged?: AwsRead<readonly TaggedResource[]>
}

/**
 * Every EventBridge rule this engine can see, verdicted.
 *
 * Rules are read per bus, then each rule's targets are read one at a time rather
 * than in parallel. `ListTargetsByRule` is a per-rule call against a low-TPS
 * account-wide API, and firing N of them at once is how a console asking whether
 * anything is throttled becomes the thing doing the throttling.
 */
export async function eventBridgeSurface(
  supplied?: AwsGateway,
  options: EventBridgeOptions = {},
): Promise<EventBridgeSurface> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())
  const wait = options.wait ?? defaultWait
  const buses = options.buses && options.buses.length ? options.buses : ["default"]

  const identity = options.identity ?? (await resolveIdentity(supplied, { now }))
  const denial = denialContextFrom(identity)
  const resolved =
    identity.state === "ACTUAL" || identity.state === "STALE"
      ? { accountId: identity.value.accountId, region: identity.value.region, partition: identity.value.partition }
      : { accountId: null, region: null, partition: null }

  const tagged = options.tagged ?? (await taggedResources(supplied, { now, denial }))
  const tags = tagIndex(tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [])

  const read = await readAws<readonly RuleRow[]>(
    "events:ListRules",
    async () => {
      const rows: RuleRow[] = []
      for (const busName of buses) {
        let token: string | undefined
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const response = (await callRetrying(
            gw,
            "events:ListRules",
            { EventBusName: busName, NextToken: token },
            wait,
          )) as ListRulesResponse

          for (const rule of response?.Rules ?? []) {
            if (!rule.Name) continue
            const shape = {
              schedule: rule.ScheduleExpression || null,
              eventDriven: typeof rule.EventPattern === "string" && rule.EventPattern.length > 0,
              state: rule.State ?? null,
              managedBy: rule.ManagedBy || null,
            }
            const targetsRead = await readTargets(gw, rule.Name, busName, now, denial, wait)
            const { verdict, detail } = ruleVerdict(shape, targetsRead)
            rows.push({
              name: rule.Name,
              arn: rule.Arn || null,
              busName: rule.EventBusName || busName,
              verdict,
              detail,
              schedule: shape.schedule,
              eventDriven: shape.eventDriven,
              state: shape.state,
              managedBy: shape.managedBy,
              description: rule.Description || null,
              targetsRead,
              targetCount: countOf(targetsRead),
              attribution: ruleAttribution(rule.Arn || null, tags, tagged),
            })
          }

          token = response?.NextToken || undefined
          if (!token) break
        }
      }
      // Codepoint order, not `localeCompare`: a locale-dependent sort puts the
      // same two rule names in a different order on a Linux runner and a Windows
      // developer's machine, and any artefact derived from this ordering would
      // then be "current here, stale in CI".
      rows.sort((a, b) => cmp(a.busName, b.busName) || cmp(a.name, b.name))
      return rows
    },
    readPolicy(now, denial),
  )

  const asOf = now().toISOString()
  const scopeNote = scopeSentence(buses, resolved.region, identity)

  if (read.state === "DENIED") {
    return {
      identity,
      read,
      // Deliberately NOT []. The surface is unauthorized as a whole, and a page
      // that renders `rows` gets that sentence rather than an empty table.
      rows: [
        {
          name: `every EventBridge rule on ${buses.join(", ")}`,
          arn: null,
          busName: buses.join(", "),
          verdict: "UNAUTHORIZED",
          detail:
            `this engine's role was refused ${read.action} (${read.errorCode}) as ${read.principal}. ` +
            `Minimum statement: ${read.minimumStatement}`,
          schedule: null,
          eventDriven: false,
          state: null,
          managedBy: null,
          description: null,
          // No cast. The DENIED arm of `AwsRead<T>` carries no `value` at all —
          // that is the design in read.ts — so once `read` is narrowed to it the
          // same object IS an `AwsRead<readonly RuleTarget[]>`, and the compiler
          // says so. A cast here would be the one place a caller could be handed
          // rows typed as targets.
          targetsRead: read,
          targetCount: null,
          attribution: { kind: "unknown", why: "the rules themselves could not be listed." },
        },
      ],
      headline:
        `unknown — EventBridge rules could not be read: ${read.action} was refused (${read.errorCode}). ` +
        `Minimum statement: ${read.minimumStatement}`,
      accountId: resolved.accountId,
      region: resolved.region,
      partition: resolved.partition,
      busesRead: buses,
      scopeNote,
      asOf,
      refreshMs: EVENTBRIDGE_TTL_MS,
      tagged,
    }
  }

  if (read.state === "THROTTLED" || read.state === "ERROR" || read.state === "UNCONFIGURED") {
    return {
      identity,
      read,
      rows: [
        {
          name: `every EventBridge rule on ${buses.join(", ")}`,
          arn: null,
          busName: buses.join(", "),
          verdict: "UNREADABLE",
          detail: describeRead(read, "EventBridge rules"),
          schedule: null,
          eventDriven: false,
          state: null,
          managedBy: null,
          description: null,
          // Same as the DENIED arm above: none of THROTTLED, ERROR or
          // UNCONFIGURED carries a `value`, so no cast is needed to say that
          // this row's targets are unknown for the same reason its rule is.
          targetsRead: read,
          targetCount: null,
          attribution: { kind: "unknown", why: "the rules themselves could not be listed." },
        },
      ],
      headline: headlineFor(read, [], asOf, buses),
      accountId: resolved.accountId,
      region: resolved.region,
      partition: resolved.partition,
      busesRead: buses,
      scopeNote,
      asOf,
      refreshMs: EVENTBRIDGE_TTL_MS,
      tagged,
    }
  }

  const rows = read.state === "ACTUAL" || read.state === "STALE" ? read.value : []

  return {
    identity,
    read,
    rows,
    headline: headlineFor(read, rows, asOf, buses),
    accountId: resolved.accountId,
    region: resolved.region,
    partition: resolved.partition,
    busesRead: buses,
    scopeNote,
    asOf,
    refreshMs: EVENTBRIDGE_TTL_MS,
    tagged,
  }
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * What this surface did and did not look at.
 *
 * EventBridge is regional, so "no rules" is only ever true OF A REGION, and the
 * region comes from the resolved identity. When identity is unresolved the
 * sentence says the region is unknown rather than naming one — the alternative
 * is the GE-010-007 residency defect, which is a console telling an operator a
 * job runs somewhere it does not.
 */
export function scopeSentence(
  buses: readonly string[],
  region: string | null,
  identity: AwsRead<Identity>,
): string {
  const where = region
    ? `in region ${region}`
    : `in a region this engine cannot name — ${describeRead(identity, "the resolved identity")}`
  return (
    `Read on bus(es) ${buses.join(", ")} ${where}. EventBridge rules are regional and per-bus: ` +
    `a rule on another bus, or in another region, was not looked at and is not claimed to be absent.`
  )
}

/**
 * The one sentence every EventBridge surface leads with.
 *
 * Every state gets its own wording and the wordings share no prefix, so a
 * denial, a throttle and a genuinely empty account cannot be mistaken for one
 * another by a reader skimming the first four words.
 */
export function headlineFor(
  read: AwsRead<readonly RuleRow[]>,
  rows: readonly RuleRow[],
  asOf: string,
  buses: readonly string[],
): string {
  switch (read.state) {
    case "ACTUAL":
    case "STALE": {
      const counts = RULE_VERDICTS.map(
        (v) => [v, rows.filter((r) => r.verdict === v).length] as const,
      ).filter(([, n]) => n > 0)
      const stopped = rows.filter(
        (r) => r.verdict === "DISABLED" || r.verdict === "NO_TARGET" || r.verdict === "UNTRIGGERED",
      ).length
      const lead = stopped
        ? `${stopped} of ${rows.length} rule(s) are not running work`
        : `${rows.length} rule(s)`
      return `${lead}, as of ${asOf} — ${counts.map(([v, n]) => `${n} ${RULE_WORDS[v]}`).join(", ")}`
    }
    case "EMPTY":
      return `none — events:ListRules answered with no rules on bus(es) ${buses.join(", ")}, as of ${asOf}`
    case "DENIED":
      return (
        `unknown — EventBridge rules could not be read: ${read.action} was refused (${read.errorCode}). ` +
        `Minimum statement: ${read.minimumStatement}`
      )
    case "THROTTLED":
      return `throttled — AWS rate-limited events:ListRules; retrying in ${read.retryAfterMs}ms, as of ${read.asOf}`
    case "UNCONFIGURED":
      return `not configured — ${read.why}`
    case "ERROR":
      return `error — events:ListRules failed (${read.code}): ${read.safeDetail}`
  }
}

/**
 * The rules that are not doing the work they were created to do.
 *
 * Deliberately excludes TARGETS_UNKNOWN and the two surface-level unknowns: this
 * list is for acting on, and "we could not read it" is not something to act on
 * by editing a rule. Those are counted in the headline instead, where they read
 * as uncertainty rather than as a defect.
 */
export function stoppedRules(rows: readonly RuleRow[]): readonly RuleRow[] {
  return rows.filter(
    (r) => r.verdict === "DISABLED" || r.verdict === "NO_TARGET" || r.verdict === "UNTRIGGERED",
  )
}

export { EVENTBRIDGE_TTL_MS }
