import { blastRadiusLines } from "@/lib/change/blast-radius"
import type { CalendarSource } from "@/lib/change/calendar"
import { scheduleLines } from "@/lib/change/windows"
import { bundleLines } from "@/lib/portability/bundle"
import { cloneLines } from "@/lib/portability/clone"
import type { TenantGovernance } from "@/app/tenants/[slug]/governance"

import { Badge, Card } from "@/components/md3"

/**
 * STUDIO-060-004 / STUDIO-060-008 / STUDIO-040-008 / STUDIO-040-009 — the four
 * calculations, on the page an operator is standing on when they matter.
 *
 * A component for the reason `EvidencePanel` gives: the projection an operator
 * reads is then the one a test can render, and a producer that stops
 * calculating an axis reds a rendered surface rather than passing unnoticed.
 *
 * Every line comes from a `*Lines` function in the library. This file chooses
 * markup and nothing else — there is no sentence here that is not also
 * available to `change-governance-logic.spec.ts` and `portability-logic.spec.ts`
 * without a browser.
 */
export function GovernancePanel({
  governance,
  calendar,
  asOf,
}: {
  governance: TenantGovernance
  calendar: CalendarSource
  /**
   * When these readings were true, as an ISO instant.
   *
   * Required, not optional. Every other card on the tenant route states it, and
   * `tenant-surface.spec.ts` fails any panel whose supporting text does not —
   * "a panel that does not say when it was true". These lines describe what a
   * move would reach and what a copy would carry; both are answers about a
   * moment, and a reader who cannot see which moment cannot tell a current
   * answer from a stale one.
   *
   * Rendered as `As of <iso>.` — the trailing period is part of the format, not
   * punctuation taste. `tenant-surface.spec.ts` matches
   * `/As of \d{4}-\d{2}-\d{2}T[\d:.]+Z\./`, which is how it tells an instant
   * from a word like "recently"; without the period the panel reads as dated to
   * a human and undated to the guard.
   */
  asOf: string
}) {
  return (
    <>
      <Card
        id="blast-radius"
        headline="What the next move reaches"
        supportingText={`Twelve axes. An axis that could not be read says so; it never reads as zero. As of ${asOf}.`}
        headerAside={
          <Badge tone="neutral" title="The change calendar this installation is running under">
            {calendar.state}
          </Badge>
        }
      >
        <p>{calendar.detail}</p>
        {governance.moves.length === 0 && (
          <p>No move is permitted from this state, so there is nothing to assess.</p>
        )}
        {governance.moves.map((move) => (
          <section key={move.to} aria-label={`Consequences of moving to ${move.to}`}>
            <h3>{move.to}</h3>
            <ul>
              {scheduleLines(move.schedule).map((line) => (
                <li key={line} data-schedule-line>
                  {line}
                </li>
              ))}
            </ul>
            <p data-notice-line>{move.notice.detail}</p>
            <ul>
              {blastRadiusLines(move.blast).map((line) => (
                <li key={line} data-blast-line>
                  {line}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Card>

      <Card
        id="portability"
        headline="What leaves, and what a copy would not carry"
        supportingText={`The tenant's desired state as a portable bundle, and the clone that bundle would make. As of ${asOf}.`}
      >
        {governance.bundleRefusal !== null && (
          <ul>
            {governance.bundleRefusal.map((leak) => (
              <li key={`${leak.at}:${leak.kind}`} data-bundle-refusal>
                refused: {leak.detail}
              </li>
            ))}
          </ul>
        )}
        {governance.bundle !== null && (
          <ul>
            {bundleLines(governance.bundle).map((line) => (
              <li key={line} data-bundle-line>
                {line}
              </li>
            ))}
          </ul>
        )}
        <p data-read-back>
          {governance.bundle === null
            ? "No bundle was produced, so nothing was read back."
            : governance.readBack === null
              ? "Read back by this engine's own importer: this bundle is portable, not just exported."
              : `This bundle does NOT read back: ${governance.readBack.map((p) => p.detail).join(" ")}`}
        </p>
        {governance.clone !== null && (
          <ul>
            {cloneLines(governance.clone).map((line) => (
              <li key={line} data-clone-line>
                {line}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
