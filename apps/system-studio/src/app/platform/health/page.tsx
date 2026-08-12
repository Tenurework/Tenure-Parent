import { auth } from "@/lib/auth"
import { AwsReadPanel } from "@/components/states"
import { ALARM_WORDS, alarmSurface } from "@/lib/aws/alarms"
import { expectedAlarmNames } from "@/lib/aws/expected-alarms"
import { identityHeadline } from "@/lib/aws/identity"
import { isOperator, operatorConfigProblems } from "@/lib/operators"

export const dynamic = "force-dynamic"

/**
 * STUDIO-080-008 — alarms, with the four verdicts CloudWatch does not return.
 *
 * `/platform` printed four green chips out of a compiled JSON file, and told the
 * operator in prose that one of them "is green because nothing can write to the
 * queue it watches". This page replaces that with a live read where the word
 * beside each alarm is a verdict rather than a state: a disabled alarm reads
 * DISABLED even while CloudWatch calls it OK, and an alarm that has not moved in
 * a week reads STALE with the date.
 *
 * The expected set comes from the Terraform, so MISSING is falsifiable — an
 * alarm the estate is supposed to have and does not is a row here rather than an
 * absence nobody notices.
 */
export default async function HealthPage() {
  if (operatorConfigProblems().length > 0) {
    return (
      <div className="misconfigured">
        <h1>Not configured</h1>
        <p>The Studio refuses to serve until its access control is set up.</p>
      </div>
    )
  }

  const session = await auth()
  if (!isOperator(session?.user?.email)) {
    const { redirect } = await import("next/navigation")
    redirect("/signin")
  }

  const surface = await alarmSurface(undefined, { expected: expectedAlarmNames() })

  return (
    <>
      <h1>Health</h1>
      <p className="slug">{identityHeadline(surface.identity)}</p>

      <section className="system" data-surface="alarms">
        <header>
          <h2>Alarms</h2>
          <span className="slug">refreshed every {Math.round(surface.refreshMs / 1000)}s</span>
        </header>

        <p data-testid="alarm-headline">{surface.headline}</p>
        <p>
          Seven verdicts, not three.{" "}
          <span className="inline-verdict">{ALARM_WORDS.DISABLED}</span> outranks{" "}
          <span className="inline-verdict">{ALARM_WORDS.OK}</span>: an alarm whose actions are
          switched off protects nothing, whatever its metric says.{" "}
          <span className="inline-verdict">{ALARM_WORDS.MISSING}</span> is only ever produced from
          a successful response, so it can never describe an estate this engine was refused.
        </p>

        <div className="scroll-x">
          <table className="grid">
            <thead>
              <tr>
                <th>Alarm</th>
                <th>Verdict</th>
                <th>Type</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {surface.rows.map((row) => (
                <tr key={`${row.type}:${row.name}`} data-verdict={row.verdict}>
                  <td className="id">{row.name}</td>
                  <td className="alarm-verdict">
                    <b>{ALARM_WORDS[row.verdict]}</b> <span className="slug">{row.verdict}</span>
                  </td>
                  <td className="slug">{row.type}</td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <AwsReadPanel read={surface.read} what="the alarm inventory" />
      </section>
    </>
  )
}
