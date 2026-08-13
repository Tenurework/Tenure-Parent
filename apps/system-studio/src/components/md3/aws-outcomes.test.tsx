import { renderToStaticMarkup } from "react-dom/server"

import { describeRead, readAws, type AwsRead } from "../../lib/aws/read"
import { DataTable } from "./DataTable"
import { Dialog } from "./Dialog"
import { EmptyState } from "./EmptyState"
import { IndeterminateProgress, ProgressIndicator } from "./ProgressIndicator"
import { KeyValue } from "./KeyValue"
import { Select } from "./Select"
import { SeverityChip, SEVERITIES } from "./SeverityChip"
import { Snackbar } from "./Snackbar"
import { StaleIndicator, staleness } from "./StaleIndicator"
import { Switch } from "./Switch"
import { TextField } from "./TextField"
import { UnknownState, type UnknownRead } from "./UnknownState"

/**
 * The four things an AWS read can come back as, driven through the REAL reader
 * and rendered through the REAL primitives.
 *
 * ## Why this file exists at all
 *
 * `e2e/md3-tokens-logic.spec.ts` audits the tokens and the source of these
 * components. It cannot render one: Playwright transforms JSX with its own
 * component-locator pragma, so a React tree built inside a Playwright spec is
 * not a React tree. Jest's roots include `apps/system-studio/src` for exactly
 * this reason (see the comment in `apps/web/jest.config.js`), so the Studio's
 * rendering assertions live beside the components, and this is one of them.
 *
 * ## What it proves, and why a weaker version proves nothing
 *
 * The stand-in for AWS below distinguishes four outcomes — refused, throttled,
 * successful-and-empty, successful-and-populated — and every one of them goes
 * through `readAws`, the one function in the Studio that turns an exception into
 * a rendered state. A fake that returned a canned answer regardless of the input
 * would let all four render identically and still pass.
 *
 * The assertion that matters is the LAST one: the four surfaces must differ, and
 * a refused read must not contain the vocabulary of an absence. That is
 * STUDIO-000-007 stated as a test rather than as a comment. The collector this
 * console replaced turned every failure into `null` and every `null` into `[]`,
 * so a refused `cloudwatch:DescribeAlarms` produced an empty alarm list which a
 * page rendered as reassuring chips — a page that was, in the only sense that
 * matters, lying, and no test at the time could tell.
 */

/**
 * A principal that is obviously constructed.
 *
 * `123456789012` is AWS's own documentation placeholder and it is used here so
 * that nothing in this file can be mistaken for a real account. No test in this
 * repository may invent a plausible account id, ARN or region and let it read as
 * evidence about the estate.
 *
 * It is a FIXTURE, not a default: in production `DenialContext` is resolved from
 * `sts:GetCallerIdentity`, and a literal region or partition anywhere in the
 * reading path is the data-residency defect GE-010-007 recorded.
 */
const DENIAL_FIXTURE = {
  principal: "arn:aws:iam::123456789012:role/example-studio-task-role",
  accountId: "123456789012",
  region: "us-east-1",
  partition: "aws",
}

interface Alarm {
  name: string
  state: string
}

const ALARMS: Alarm[] = [
  { name: "tenure-prod-ecs-cpu", state: "OK" },
  { name: "tenure-prod-rds-storage", state: "ALARM" },
]

/** An AWS error with a modelled `name`, which is what `readAws` classifies on. */
function awsError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name })
}

/**
 * The stand-in. One argument, four genuinely different behaviours.
 *
 * `denied` and `throttled` THROW, the way the SDK does, rather than returning a
 * sentinel — the classification under test is the one that reads an exception's
 * modelled `name`, and a stand-in that returned `{ error: "AccessDenied" }`
 * would be testing a code path that does not exist.
 */
function awsCall(outcome: "denied" | "throttled" | "empty" | "populated") {
  return async (): Promise<Alarm[]> => {
    switch (outcome) {
      case "denied":
        throw awsError("AccessDenied", "User is not authorized to perform: cloudwatch:DescribeAlarms")
      case "throttled":
        throw awsError("ThrottlingException", "Rate exceeded")
      case "empty":
        return []
      case "populated":
        return ALARMS
    }
  }
}

const CAPABILITY = "cloudwatch:DescribeAlarms" as const
const WHAT = "the alarm inventory"

async function read(outcome: "denied" | "throttled" | "empty" | "populated") {
  return readAws<Alarm[]>(CAPABILITY, awsCall(outcome), {
    denial: DENIAL_FIXTURE,
    // Deterministic: a fixed clock so `asOf` is the same string on every run and
    // on every machine, and an instant, counted backoff so the throttled case
    // does not spend a real second waiting.
    now: () => new Date("2026-08-13T09:00:00.000Z"),
    attempts: 2,
    backoffMs: 250,
    sleep: async () => {},
  })
}

/** How each state is put on screen, which is the thing actually being asserted. */
function surfaceFor(reading: AwsRead<Alarm[]>): string {
  switch (reading.state) {
    case "ACTUAL":
    case "STALE":
      return renderToStaticMarkup(
        <DataTable
          caption={`Alarms — ${describeRead(reading, WHAT)}`}
          columns={[
            { key: "name", header: "Alarm", cell: (row: Alarm) => row.name },
            { key: "state", header: "State", cell: (row: Alarm) => row.state },
          ]}
          rows={reading.value}
          rowKey={(row) => row.name}
          empty={<EmptyState headline="No alarms" description="unreachable in this case" />}
        />,
      )
    case "EMPTY":
      return renderToStaticMarkup(
        <EmptyState
          headline="No alarms in this account"
          // The description comes from `describeRead`, the production renderer,
          // so the wording of an absence is not invented by this test.
          description={describeRead(reading, WHAT)}
        />,
      )
    default:
      return renderToStaticMarkup(<UnknownState what={WHAT} read={reading} now={Date.parse("2026-08-13T09:00:00.000Z")} />)
  }
}

describe("a read that could not be performed never renders as an absence", () => {
  test("AccessDenied becomes DENIED, and the surface carries principal, action and statement", async () => {
    const reading = await read("denied")
    expect(reading.state).toBe("DENIED")
    if (reading.state !== "DENIED") throw new Error("unreachable")

    expect(reading.action).toBe("cloudwatch:DescribeAlarms")
    expect(reading.errorCode).toBe("AccessDenied")

    const html = surfaceFor(reading)
    // The three things STUDIO-000-007 requires a denial to carry.
    expect(html).toContain(DENIAL_FIXTURE.principal)
    expect(html).toContain("cloudwatch:DescribeAlarms")
    expect(html).toContain("&quot;Effect&quot;:&quot;Allow&quot;")
    // And the account it was refused in, which is what tells an operator whether
    // they are looking at the account they think they are.
    expect(html).toContain("123456789012")
    // Not an absence, in any wording.
    expect(html).not.toContain("returned nothing")
    expect(html).not.toContain("No alarms")
  })

  test("a throttle is NOT a denial: no IAM statement, and a retry interval instead", async () => {
    const reading = await read("throttled")
    expect(reading.state).toBe("THROTTLED")
    if (reading.state !== "THROTTLED") throw new Error("unreachable")
    /*
     * 500, not the 250 the call was configured with. `readAws` doubles the
     * backoff after each waited attempt, so what it reports is the delay the
     * NEXT attempt would use — which is the number an operator wants, and the
     * one this surface prints. Asserted exactly, because a retry interval that
     * silently reset to its first value would make a long backoff look short.
     */
    expect(reading.retryAfterMs).toBe(500)

    const html = surfaceFor(reading)
    expect(html).toContain("Rate-limited")
    expect(html).toContain("500ms")
    // The remedy is a wait, so sending the operator to edit a policy would be
    // wrong — and a policy edit that "fixes" a throttle is a permission granted
    // for no reason.
    expect(html).not.toContain("Effect")
    expect(html).not.toContain("Refused")
  })

  test("an empty-but-successful read says nothing was found, and claims nothing else", async () => {
    const reading = await read("empty")
    expect(reading.state).toBe("EMPTY")

    const html = surfaceFor(reading)
    expect(html).toContain("No alarms in this account")
    expect(html).toContain("returned nothing")
    // The four words that would make this indistinguishable from a failure.
    expect(html).not.toContain("Refused")
    expect(html).not.toContain("Rate-limited")
    expect(html).not.toContain("Effect")
    expect(html).not.toContain("Unknown")
  })

  test("a populated read renders the rows", async () => {
    const reading = await read("populated")
    expect(reading.state).toBe("ACTUAL")
    if (reading.state !== "ACTUAL") throw new Error("unreachable")
    expect(reading.value).toHaveLength(2)

    const html = surfaceFor(reading)
    expect(html).toContain("tenure-prod-ecs-cpu")
    expect(html).toContain("tenure-prod-rds-storage")
    expect(html).not.toContain("Unknown")
    expect(html).not.toContain("returned nothing")
  })

  test("the four outcomes produce four different surfaces", async () => {
    const surfaces = await Promise.all(
      (["denied", "throttled", "empty", "populated"] as const).map(async (outcome) => ({
        outcome,
        html: surfaceFor(await read(outcome)),
      })),
    )

    // Pairwise, because "they are not all identical" is satisfied by three of
    // four being the same — which is exactly the shape of the defect this
    // guards: denied and empty rendering alike while the other two differ. The
    // collisions are collected rather than asserted one at a time so the failure
    // message names which two.
    const collisions: string[] = []
    for (let i = 0; i < surfaces.length; i++) {
      for (let j = i + 1; j < surfaces.length; j++) {
        if (surfaces[i].html === surfaces[j].html) {
          collisions.push(`${surfaces[i].outcome} and ${surfaces[j].outcome} render identically`)
        }
      }
    }
    expect(collisions).toEqual([])

    // And the production sentence for each differs too, so an API consumer and a
    // reader of the page cannot be told different stories.
    const sentences = await Promise.all(
      (["denied", "throttled", "empty", "populated"] as const).map(async (outcome) =>
        describeRead(await read(outcome), WHAT),
      ),
    )
    expect(new Set(sentences).size).toBe(4)
  })
})

describe("the type refuses a successful read", () => {
  test("an ACTUAL reading is not an UnknownRead", async () => {
    const reading = await read("populated")
    // Narrowed FIRST, so the suppression below is about the ACTUAL arm alone.
    // Without this the assignment would fail merely because the un-narrowed
    // union also contains EMPTY and STALE, and the directive would stay "used"
    // however wide `UnknownRead` grew — a compile-time assertion that could not
    // fail is the same defect as a runtime one that cannot.
    if (reading.state !== "ACTUAL") throw new Error("unreachable")
    // @ts-expect-error An ACTUAL reading carries a value and is not one of the
    // four valueless arms. This directive is the assertion: if `UnknownRead`
    // ever widened to admit a successful read, `tsc` would report this
    // suppression as unused and `npm run studio:type-check` would red. It is
    // checked by the compiler, not by jest, which is the point — the guarantee
    // is in the type rather than in everyone remembering.
    const notAllowed: UnknownRead = reading
    expect(notAllowed).toBeDefined()
  })
})

describe("StaleIndicator says how old, against what cadence", () => {
  const CADENCE = 20_000
  const AT = "2026-08-13T09:00:00.000Z"
  const now = Date.parse(AT)

  test("fresh and overdue are different markup, and overdue says the word", () => {
    const fresh = renderToStaticMarkup(
      <StaleIndicator asOf={AT} cadenceMs={CADENCE} now={now + 5_000} />,
    )
    const overdue = renderToStaticMarkup(
      <StaleIndicator asOf={AT} cadenceMs={CADENCE} now={now + 600_000} />,
    )

    expect(fresh).toContain('data-degraded="false"')
    expect(fresh).not.toContain("overdue")
    expect(fresh).toContain("5s old")

    expect(overdue).toContain('data-degraded="true"')
    // The word, not only the tint. Meaning carried by colour alone is forbidden.
    expect(overdue).toContain("overdue")
    expect(overdue).toContain("10m old")
    expect(fresh).not.toBe(overdue)
  })

  test("the cadence is always shown, so the age can be judged", () => {
    const html = renderToStaticMarkup(<StaleIndicator asOf={AT} cadenceMs={CADENCE} now={now} />)
    expect(html).toContain("refreshes every 20s")
    expect(html).toContain(AT)
  })

  test("an unreadable timestamp is degraded, not fresh", () => {
    const verdict = staleness("not a date", CADENCE, now)
    expect(verdict.unparseable).toBe(true)
    expect(verdict.degraded).toBe(true)
    const html = renderToStaticMarkup(
      <StaleIndicator asOf="not a date" cadenceMs={CADENCE} now={now} />,
    )
    expect(html).toContain("an unreadable timestamp")
    expect(html).toContain('data-degraded="true"')
  })

  test("a reading dated in the future is a clock disagreement, not a fresh read", () => {
    const verdict = staleness(AT, CADENCE, now - 3_600_000)
    expect(verdict.ahead).toBe(true)
    expect(verdict.degraded).toBe(false)
    const html = renderToStaticMarkup(
      <StaleIndicator asOf={AT} cadenceMs={CADENCE} now={now - 3_600_000} />,
    )
    expect(html).toContain("ahead of this clock")
  })
})

describe("the form primitives describe themselves correctly", () => {
  test("a text field links its hint and its error, and is invalid only when it has one", () => {
    const clean = renderToStaticMarkup(
      <TextField id="slug" name="slug" label="Tenant slug" supportingText="Lower case, no spaces." />,
    )
    expect(clean).toContain('aria-describedby="slug-support"')
    expect(clean).not.toContain("aria-invalid")

    const broken = renderToStaticMarkup(
      <TextField
        id="slug"
        name="slug"
        label="Tenant slug"
        supportingText="Lower case, no spaces."
        errorText="That slug is already registered."
      />,
    )
    expect(broken).toContain('aria-describedby="slug-support slug-error"')
    expect(broken).toContain('aria-invalid="true"')
    expect(broken).toContain('data-invalid="true"')
    // The word, so the message is not carried by the border's colour alone.
    expect(broken).toContain("Error")
  })

  test("a select's placeholder is disabled, so an empty value cannot be submitted as a choice", () => {
    const html = renderToStaticMarkup(
      <Select
        id="region"
        name="region"
        label="Region"
        placeholder="Choose a region"
        options={[{ value: "us-east-1", label: "us-east-1" }]}
      />,
    )
    expect(html).toContain('<option value="" disabled')
    expect(html).toContain('value="us-east-1"')
  })

  test("a switch is a checkbox that announces itself as a switch", () => {
    const html = renderToStaticMarkup(
      <Switch id="enforce" name="enforce" label="Enforce tag policy" stateText="Off" />,
    )
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('role="switch"')
    expect(html).toContain('for="enforce"')
  })
})

describe("the reporting primitives", () => {
  test("a determinate progress clamps rather than turning indeterminate", () => {
    // A ratio of two AWS readings can exceed its own maximum, and a <progress>
    // whose value is above max renders as INDETERMINATE — a bar that starts
    // sliding as though nothing were known, for the case where more is done
    // than was expected.
    const html = renderToStaticMarkup(
      <ProgressIndicator label="Cells provisioned" value={12} max={11} valueText="12 of 11" />,
    )
    expect(html).toContain('value="11"')
    expect(html).toContain('max="11"')
    expect(html).toContain("12 of 11")
  })

  test("an indeterminate progress has no value for a screen reader to read", () => {
    const html = renderToStaticMarkup(<IndeterminateProgress label="Resolving identity" />)
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-busy="true"')
    // The presence of a value is what would make it determinate.
    expect(html).not.toContain("aria-valuenow")
  })

  test("a closed dialog renders nothing at all, not a hidden box", () => {
    const closed = renderToStaticMarkup(
      <Dialog open={false} id="confirm" headline="Move to PROVISIONING" dismiss={<a href="/">Cancel</a>}>
        <p>body</p>
      </Dialog>,
    )
    expect(closed).toBe("")

    const open = renderToStaticMarkup(
      <Dialog open id="confirm" headline="Move to PROVISIONING" dismiss={<a href="/">Cancel</a>}>
        <p>body</p>
      </Dialog>,
    )
    expect(open).toContain('role="dialog"')
    expect(open).toContain('aria-labelledby="confirm-headline"')
    // It does not claim modality, because nothing here traps focus.
    expect(open).not.toContain("aria-modal")
    expect(open).toContain("Cancel")
  })

  test("a snackbar is polite, and does not remove itself", () => {
    const html = renderToStaticMarkup(<Snackbar message="Tenant moved to PROVISIONING." />)
    expect(html).toContain('role="status"')
    expect(html).not.toContain("alert")
  })

  test("every severity draws its word, and the five are distinct", () => {
    const rendered = SEVERITIES.map((severity) =>
      renderToStaticMarkup(<SeverityChip severity={severity}>4</SeverityChip>),
    )
    expect(new Set(rendered).size).toBe(5)
    for (const html of rendered) {
      // A count in a slightly different pill is not a severity anybody can read.
      expect(html).toContain("md3-severity-word")
    }
    expect(rendered[0]).toContain("Critical")
    expect(rendered[4]).toContain("Informational")
  })

  test("a key/value row carries its own staleness", () => {
    const html = renderToStaticMarkup(
      <KeyValue
        items={[
          {
            key: "account",
            term: "Account",
            value: "123456789012",
            asOf: {
              at: "2026-08-13T09:00:00.000Z",
              cadenceMs: 900_000,
              now: Date.parse("2026-08-13T09:01:00.000Z"),
            },
          },
        ]}
      />,
    )
    expect(html).toContain("<dt")
    expect(html).toContain("<dd")
    expect(html).toContain("123456789012")
    // "60s", not "1m": the unit steps up at 90 seconds, so an age never reads
    // "1m" while a reader watching the seconds tick would still say 60.
    expect(html).toContain("60s old")
    expect(html).toContain("refreshes every 15m")
  })
})
