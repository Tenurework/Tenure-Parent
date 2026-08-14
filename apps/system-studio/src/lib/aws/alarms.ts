/**
 * STUDIO-080-008 — an alarm has seven states, and only three of them are the
 * ones CloudWatch returns.
 *
 * `/platform` rendered `estate.alarms.map(a => <chip><b>{a.state}</b>…)` out of a
 * generated JSON file holding four entries, all `"OK"`. The collector that made
 * it — `tools/aws-inventory.mjs:214` — kept `AlarmName` and `StateValue` and
 * discarded `ActionsEnabled` and `StateUpdatedTimestamp`, so a disabled alarm
 * and a live one were indistinguishable, and a stale one looked current. And
 * because its `aws()` helper returns null on failure and `list()` turns null
 * into `[]`, a denied `cloudwatch:DescribeAlarms` rendered as "no alarms".
 *
 * The four states that were missing are the four that matter:
 *
 *   DISABLED      `ActionsEnabled === false`. It OUTRANKS OK: an alarm in OK
 *                 whose actions are off protects nothing, and printing OK for it
 *                 is the most reassuring lie this page can tell.
 *   STALE         it has not moved in longer than the surface allows. A metric
 *                 that stopped being published leaves its alarm in OK forever.
 *   MISSING       an alarm the estate is SUPPOSED to have is not in a successful
 *                 response. Falsifiable because the expected set comes from the
 *                 Terraform, not from a list somebody typed.
 *   UNAUTHORIZED  the call was refused. The whole surface, never a short list.
 */

import { ALARM_REFRESH_MS } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
} from "./read"

export const ALARM_VERDICTS = [
  "OK",
  "ALARM",
  "INSUFFICIENT_DATA",
  "DISABLED",
  "STALE",
  "MISSING",
  "UNAUTHORIZED",
  "UNREADABLE",
] as const

export type AlarmVerdict = (typeof ALARM_VERDICTS)[number]

/** A word per verdict. Bible §26.3.2: never colour alone. */
export const ALARM_WORDS: Readonly<Record<AlarmVerdict, string>> = {
  OK: "Healthy",
  ALARM: "Firing",
  INSUFFICIENT_DATA: "No data",
  DISABLED: "Actions off",
  STALE: "Not moved",
  MISSING: "Not created",
  UNAUTHORIZED: "Unknown",
  // Not "Unknown" a second time. The word is the carrier — the tone repeats on
  // purpose (both are `warn`), so two verdicts sharing a word leaves a badge an
  // operator cannot read: UNAUTHORIZED is a refusal, which an IAM statement
  // fixes and which this surface prints one for, and UNREADABLE is a throttle,
  // an unconfigured account or a failed call, which it does not. Both mean
  // "nothing was learnt"; only one of them names something to grant.
  UNREADABLE: "Not read",
}

export interface AlarmRow {
  name: string
  verdict: AlarmVerdict
  /** The sentence the table prints; carries the timestamp for STALE. */
  detail: string
  /** `MetricAlarm` or `CompositeAlarm`, so a composite rota alarm is visible. */
  type: string
}

interface DescribeAlarmsResponse {
  MetricAlarms?: RawAlarm[]
  CompositeAlarms?: RawAlarm[]
  NextToken?: string
}

interface RawAlarm {
  AlarmName?: string
  StateValue?: string
  ActionsEnabled?: boolean
  StateUpdatedTimestamp?: string | Date
}

function asMillis(value: string | Date | undefined): number | null {
  if (!value) return null
  const time = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(time) ? time : null
}

/**
 * One alarm's verdict.
 *
 * Order is the argument: disabled is checked BEFORE state, because an alarm
 * whose actions are off is not OK regardless of what its metric says. Staleness
 * is checked before state for the same reason — an alarm that has not moved in
 * eight days is reporting the past.
 */
export function verdictFor(
  alarm: RawAlarm,
  options: { now: Date; staleAfterMs: number },
): { verdict: AlarmVerdict; detail: string } {
  if (alarm.ActionsEnabled === false) {
    return {
      verdict: "DISABLED",
      detail: `actions are disabled — this alarm cannot notify anybody, whatever its state says (currently ${alarm.StateValue ?? "unknown"}).`,
    }
  }

  const updated = asMillis(alarm.StateUpdatedTimestamp)
  if (updated !== null && options.now.getTime() - updated > options.staleAfterMs) {
    const age = options.now.getTime() - updated
    return {
      verdict: "STALE",
      detail: `has not changed state since ${new Date(updated).toISOString()} — ${Math.round(age / 86_400_000)} day(s) ago. A metric that stopped being published leaves its alarm here forever.`,
    }
  }

  switch (alarm.StateValue) {
    case "ALARM":
      return { verdict: "ALARM", detail: `firing since ${updated ? new Date(updated).toISOString() : "an unknown time"}.` }
    case "INSUFFICIENT_DATA":
      return { verdict: "INSUFFICIENT_DATA", detail: "not enough data points to evaluate — this is not the same as healthy." }
    case "OK":
      return { verdict: "OK", detail: `in OK, last evaluated ${updated ? new Date(updated).toISOString() : "at an unknown time"}.` }
    default:
      return { verdict: "INSUFFICIENT_DATA", detail: `CloudWatch reported state ${JSON.stringify(alarm.StateValue)}, which is not one of OK/ALARM/INSUFFICIENT_DATA.` }
  }
}

export interface AlarmSurface {
  identity: AwsRead<Identity>
  read: AwsRead<readonly AlarmRow[]>
  rows: readonly AlarmRow[]
  /** The sentence the page leads with. One funnel, so denial cannot read as absence. */
  headline: string
  asOf: string
  refreshMs: number
}

/**
 * Every alarm, verdicted.
 *
 * `expected` is the set of alarms this estate is supposed to have. Passing it
 * makes MISSING falsifiable; passing `[]` makes MISSING unreachable, which is
 * why the production caller reads it from the Terraform rather than defaulting.
 */
export async function alarmSurface(
  supplied?: AwsGateway,
  options: { now?: () => Date; staleAfterMs?: number; expected?: readonly string[] } = {},
): Promise<AlarmSurface> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())
  const staleAfterMs = options.staleAfterMs ?? 7 * 86_400_000
  const expected = options.expected ?? []

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)

  const read = await readAws<readonly AlarmRow[]>(
    "cloudwatch:DescribeAlarms",
    async () => {
      const rows: AlarmRow[] = []
      const seen = new Set<string>()
      let token: string | undefined
      do {
        const response = (await gw.call("cloudwatch:DescribeAlarms", {
          NextToken: token,
        })) as DescribeAlarmsResponse

        for (const [type, list] of [
          ["MetricAlarm", response?.MetricAlarms ?? []],
          ["CompositeAlarm", response?.CompositeAlarms ?? []],
        ] as const) {
          for (const alarm of list) {
            if (!alarm.AlarmName) continue
            seen.add(alarm.AlarmName)
            const { verdict, detail } = verdictFor(alarm, { now: now(), staleAfterMs })
            rows.push({ name: alarm.AlarmName, verdict, detail, type })
          }
        }
        token = response?.NextToken || undefined
      } while (token)

      // MISSING is produced ONLY here — after a successful response. A denied
      // call never reaches this line, so "not created" can never be printed
      // about an estate nobody was allowed to look at.
      for (const name of expected) {
        if (seen.has(name)) continue
        rows.push({
          name,
          verdict: "MISSING",
          detail: "declared in infrastructure/terraform and absent from a successful DescribeAlarms response.",
          type: "expected",
        })
      }
      return rows
    },
    { now, denial, isEmpty: () => false },
  )

  const asOf = now().toISOString()

  if (read.state === "DENIED") {
    return {
      identity,
      read,
      // Deliberately NOT []. The surface is unauthorized as a whole, and the
      // page renders that one row rather than an empty table.
      rows: [
        {
          name: "every alarm in this account",
          verdict: "UNAUTHORIZED",
          detail:
            `this engine's role was refused ${read.action} (${read.errorCode}) as ${read.principal}. ` +
            `Minimum statement: ${read.minimumStatement}`,
          type: "surface",
        },
      ],
      headline:
        `unknown — alarms could not be read: ${read.action} was refused (${read.errorCode}). ` +
        `Minimum statement: ${read.minimumStatement}`,
      asOf,
      refreshMs: ALARM_REFRESH_MS,
    }
  }

  /**
   * A non-answer gets a ROW, not an empty list.
   *
   * Denial already did — the early return above synthesises an UNAUTHORIZED
   * row, and its comment on `AlarmSurface.headline` says why: "one funnel, so
   * denial cannot read as absence". Three states were left out of that funnel.
   * A throttle, an unconfigured account and a failed call each produced
   * `rows: []`, and an empty array is the same value `EMPTY` produces — so a
   * caller iterating `rows`, or counting them, rendered "no alarms" for an
   * estate that had not been looked at.
   *
   * The headline was already correct for all three. That is exactly what made
   * it dangerous: the sentence said "throttled" while the table beside it drew
   * nothing, and a table drawing nothing is how an operator concludes there is
   * nothing wrong.
   *
   * `EMPTY` keeps its empty list, because there the emptiness is the answer.
   * This read passes `isEmpty: () => false`, so that arm is unreachable from
   * here today — it is written out rather than folded into the default because
   * the distinction is the entire subject of this function, and a reader who
   * finds `EMPTY` missing from the list has to go and work out whether that was
   * a decision or an omission.
   */
  const unreadable = (detail: string): readonly AlarmRow[] => [
    { name: "every alarm in this account", verdict: "UNREADABLE", detail, type: "surface" },
  ]

  const rows: readonly AlarmRow[] =
    read.state === "ACTUAL" || read.state === "STALE"
      ? read.value
      : read.state === "EMPTY"
        ? []
        : read.state === "THROTTLED"
          ? unreadable(
              `AWS rate-limited cloudwatch:DescribeAlarms, so no alarm was read. ` +
                `Retrying in ${read.retryAfterMs}ms.`,
            )
          : read.state === "UNCONFIGURED"
            ? unreadable(`alarms were not read because this account is not configured for it: ${read.why}`)
            : unreadable(
                `cloudwatch:DescribeAlarms failed, so no alarm was read — ${read.code}: ${read.safeDetail}`,
              )
  const counts = ALARM_VERDICTS.map((v) => [v, rows.filter((r) => r.verdict === v).length] as const).filter(
    ([, n]) => n > 0,
  )

  const headline =
    read.state === "ACTUAL" || read.state === "STALE"
      ? `${rows.length} alarm(s), as of ${asOf} — ${counts.map(([v, n]) => `${n} ${ALARM_WORDS[v]}`).join(", ")}`
      : read.state === "EMPTY"
        ? `none — cloudwatch:DescribeAlarms answered with no alarms and none is expected, as of ${asOf}`
        : read.state === "THROTTLED"
          ? `throttled — AWS rate-limited cloudwatch:DescribeAlarms; retrying in ${read.retryAfterMs}ms`
          : read.state === "UNCONFIGURED"
            ? `not configured — ${read.why}`
            : `error — ${read.code}: ${read.safeDetail}`

  return { identity, read, rows, headline, asOf, refreshMs: ALARM_REFRESH_MS }
}
