import type { AwsRead } from "../../lib/aws/read"

import { KeyValue, type KeyValueItem } from "./KeyValue"
import { StaleIndicator } from "./StaleIndicator"
import { Surface } from "./Surface"

/**
 * STUDIO-000-007, as a shape twelve surfaces can share.
 *
 * **A read this engine could not perform must never render as an empty list.**
 * That sentence is the whole reason this file exists. The collector this console
 * replaced turned every failure into `null` and every `null` into `[]`, so a
 * refused `cloudwatch:DescribeAlarms` produced an empty alarm list which a page
 * rendered as four reassuring chips. An operator could not tell an estate with
 * no alarms from a role with no permissions, and nothing on the page was false
 * enough to notice.
 *
 * ## The guarantee is in the type, not in the discipline
 *
 * `read` is `UnknownRead` — the four arms of `AwsRead<T>` that carry NO value.
 * `ACTUAL` and `ERROR`-free readings are not assignable, so:
 *
 *   * a surface cannot hand a successful read to this component and get a
 *     spurious denial, and
 *   * `AwsRead`'s own type does the other half: `DENIED` has no `value` field at
 *     all, so `read.value` on an unnarrowed reading does not compile.
 *
 * The union is imported rather than restated. A second copy of these four arms
 * would be a second thing to update when `read.ts` gains an arm, and the copy
 * that is not updated is the one that renders a new failure mode as a blank
 * panel. The import is `import type`, so nothing from `lib/aws` is pulled into a
 * bundle at runtime — this stays a presentational component with no client, no
 * SDK and no database anywhere in its graph.
 *
 * ## What it must say, for each of the four
 *
 * Every arm answers a different question and gets a different answer, because a
 * surface that says "unavailable" for all four teaches operators to ignore it:
 *
 *   * `DENIED` — the principal, the action as IAM spells it, the error code AWS
 *     returned, the account/region/partition the call was made in, and the
 *     minimum IAM statement, as pasteable JSON. Remedy: grant the statement.
 *   * `THROTTLED` — AWS answered, and answered "not so fast". Nothing is broken
 *     and no policy needs editing. Remedy: wait the stated interval.
 *   * `UNCONFIGURED` — the call was never made, and `why` says what is missing.
 *     Often an account subscription rather than a permission, so showing an IAM
 *     statement here would send an operator to edit a policy that is correct.
 *   * `ERROR` — something else broke; `safeDetail` is the only lead, already
 *     stripped of credential material by `safeDetail()` in `read.ts`.
 *
 * ## It is a `role="status"`, and it is not an EmptyState
 *
 * `EmptyState` is the shape of "we looked and there is nothing". This is the
 * shape of "we were not allowed to look", "we were told to slow down", "we never
 * asked" and "it broke". They are separate components so that no amount of prop
 * juggling can turn one into the other. `components/states.tsx` owns the WORD —
 * fourteen governed state names, of which `unknown` is one — and this owns the
 * MD3 form that word takes. Where a surface already uses `AwsReadPanel` from
 * that file, it is rendering the same facts through the console's older markup;
 * both say the same things because both are driven by the same union.
 */

/**
 * The arms of a reading that carry no value.
 *
 * `Extract` over the real union rather than a hand-written list of four object
 * types: if `read.ts` adds a field to `DENIED`, this follows it, and if it adds
 * a fifth valueless arm, `switch` exhaustiveness below stops compiling until
 * this file says what that arm looks like.
 */
export type UnknownRead = Extract<
  AwsRead<unknown>,
  { state: "DENIED" | "THROTTLED" | "UNCONFIGURED" | "ERROR" }
>

/** The word each arm carries. Distinct, because the remedies are distinct. */
const HEADLINE: Readonly<Record<UnknownRead["state"], string>> = {
  DENIED: "Refused — this engine's role may not read it",
  THROTTLED: "Rate-limited — AWS asked this engine to slow down",
  UNCONFIGURED: "Never asked — this read is not configured",
  ERROR: "Failed — the read did not complete",
}

/** What to do next, in the operator's terms. One sentence, never "try again". */
const REMEDY: Readonly<Record<UnknownRead["state"], string>> = {
  DENIED:
    "Grant the statement below to this engine's task role. Until it is granted, nothing is known here — this is not a report that there is nothing.",
  THROTTLED:
    "Nothing is broken and no policy needs changing. The reader backs off and retries; the interval above is how long it is waiting.",
  UNCONFIGURED:
    "No IAM statement fixes this. What is missing is named above, and it is usually an account setting or a subscription rather than a permission.",
  ERROR:
    "The detail above is the only lead, with anything that looked like a credential removed. It is not a denial and it is not an absence.",
}

export interface UnknownStateProps {
  /**
   * What could not be read, in the operator's language — "the alarm inventory",
   * "this account's SES sending quota". Required: "Unknown" on its own names
   * nothing, and a panel that does not say what is missing is a panel that gets
   * scrolled past.
   */
  what: string
  read: UnknownRead
  /**
   * The clock, for the retry interval's arithmetic. Injected under test.
   */
  now?: number
  id?: string
}

export function UnknownState({ what, read, now, id }: UnknownStateProps) {
  return (
    <Surface
      as="section"
      container="lowest"
      level={0}
      shape="medium"
      outlined
      className="md3-unknown"
      id={id}
      // A report, not a proposal: something the page has concluded and the
      // reader should hear about when it appears. `states.tsx` makes the same
      // choice for the same reason, and reserves `group` for the one panel that
      // is a live form.
      role="status"
      data-reason={read.state}
    >
      <p className="md3-unknown-label md3-label-small">Unknown</p>
      <p className="md3-unknown-headline md3-title-medium">
        {what} — {HEADLINE[read.state]}
      </p>

      <KeyValue items={factsOf(read, what, now)} ariaLabel={`Why ${what} could not be read`} />

      <p className="md3-unknown-remedy md3-body-medium">{REMEDY[read.state]}</p>

      {read.state === "DENIED" ? (
        <>
          <p className="md3-unknown-note md3-body-small">
            The minimum statement, as JSON. It grants exactly the action named above on exactly the
            resource that action needs, and nothing else.
          </p>
          {/*
            `<pre>` rather than a one-line `<code>`: an operator pastes this into
            a policy document, and a statement that has been re-wrapped by the
            layout is one they have to repair by hand. `.md3-unknown-statement`
            scrolls inside itself, so a long statement does not scroll the page
            sideways at 320 CSS pixels.
          */}
          <pre className="md3-unknown-statement">
            <code>{read.minimumStatement}</code>
          </pre>
        </>
      ) : null}
    </Surface>
  )
}

/**
 * The facts, per arm.
 *
 * A `switch` with no `default`, so a fifth valueless arm added to `AwsRead` is a
 * compile error here rather than an arm that silently renders as a heading with
 * an empty list underneath — which would be this component committing the exact
 * defect it exists to prevent.
 */
function factsOf(read: UnknownRead, what: string, now?: number): readonly KeyValueItem[] {
  switch (read.state) {
    case "DENIED":
      return [
        { key: "capability", term: "Capability", value: read.capability },
        { key: "action", term: "Action refused", value: <code>{read.action}</code> },
        { key: "principal", term: "Principal", value: <code>{read.principal}</code> },
        {
          key: "code",
          term: "AWS said",
          value: <code>{read.errorCode}</code>,
        },
        {
          key: "account",
          term: "Account",
          // Never a placeholder account id. What was resolved, or the fact that
          // identity itself has not answered — which is a different and worse
          // problem than a missing grant, and the operator has to be able to
          // see that it is the one they have.
          value: read.accountId ?? "not resolved — sts:GetCallerIdentity has not answered",
        },
        { key: "region", term: "Region", value: read.region ?? "not resolved" },
        { key: "partition", term: "Partition", value: read.partition ?? "not resolved" },
      ]
    case "THROTTLED":
      return [
        { key: "capability", term: "Capability", value: read.capability },
        {
          key: "retry",
          term: "Retrying in",
          value: `${read.retryAfterMs}ms`,
        },
        {
          key: "asOf",
          term: "Last attempt",
          value: (
            <StaleIndicator
              asOf={read.asOf}
              // The retry interval IS the cadence of a throttled read: past it,
              // the reader should already have tried again, and an indicator
              // still saying "fresh" would be describing a retry that did not
              // happen.
              cadenceMs={read.retryAfterMs}
              now={now}
              label={`last attempt to read ${what}`}
            />
          ),
        },
      ]
    case "UNCONFIGURED":
      return [
        { key: "capability", term: "Capability", value: read.capability },
        { key: "why", term: "What is missing", value: read.why },
      ]
    case "ERROR":
      return [
        { key: "capability", term: "Capability", value: read.capability },
        { key: "code", term: "AWS said", value: <code>{read.code}</code> },
        { key: "detail", term: "Detail", value: <code>{read.safeDetail}</code> },
      ]
  }
}
