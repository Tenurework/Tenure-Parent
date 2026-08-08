# UX task scorecard — what a job costs a person

`Tenure_Tenant_Experience_System_and_Product_UIUX_Claude_Bible_v1.0.md` §18 asks
for a scorecard measured **by persona and task**, and §20 turns it into two
requirements: `TTES-050-001` (baselines and targets by persona) and
`TTES-050-002` (lawful competitor workflow comparisons). This file is the
left-hand side of both — Tenure's own numbers. It is read by code, not only by
people: `apps/web/e2e/support/journey-metrics.ts` parses the tables below and
holds each journey to its row.

## What is measured, and what is deliberately not

A journey runs through the real UI in `apps/web/e2e/journeys.spec.ts`, and the
**browser** counts the cost — not the spec's own bookkeeping. Only clicks and
key presses with `isTrusted` are counted, so a journey cannot flatter itself by
dispatching synthetic events.

`locator.fill()` is rejected outright, because filling a field is not typing it
and a keystroke count that skipped the keystrokes is not a measurement. Catching
it takes two rules, and the second is the one that matters: Playwright's `fill`
drives the browser's own text insertion, so the resulting `input` event is
**trusted** and arrives with no `keydown` at all. What gives it away is that its
`data` carries the whole string — a single key press can insert one character,
so anything longer did not come from one. (The other rule, an untrusted `input`,
catches the older implementation that assigned `.value` directly.) Deleting the
`data` rule leaves `journey-metrics.spec.ts`'s "refuses a journey that fills a
field" test failing, which is how that sentence is known to be true rather than
assumed.

| Column | Meaning | Gated? |
| --- | --- | --- |
| Clicks | Trusted pointer clicks | yes |
| Keystrokes | Trusted key presses | yes |
| Navigations | Route commits, including `pushState` — the App Router never unloads a document, so counting document loads would report every journey as one step | yes |
| Routes | Distinct pathnames entered — the Bible's "context loss" | yes |
| Wall clock | Elapsed milliseconds | **no** |

Wall clock is recorded into `apps/web/test-results/journey-metrics.json` on
every run and is **not** a gate. It is a property of the machine the suite
happened to run on: the same journey on the same commit varies by more than a
factor of ten between an idle laptop and a CI runner sharing a box with three
other builds. A budget on it would fail for reasons that have nothing to do
with the product, and a budget loose enough not to would catch nothing. Route,
click and keystroke counts have neither problem — they are properties of the
interface.

Sign-in is outside every measured window. The persona buttons are the dev-login
stand-in for institutional SSO, so their cost belongs to the fixture.

## Harness self-check

These rows are **not product evidence**. They are a fixture site served by
request interception inside `apps/web/e2e/support/journey-metrics.spec.ts`, and
they exist so that the gate below is demonstrably switched on: a counter that
silently reported zero would sit inside every budget ever written, and every
product journey would stay green while measuring nothing.

| Journey | Persona | Task | Clicks | Keystrokes | Navigations | Routes |
| --- | --- | --- | --- | --- | --- | --- |
| `J00-harness` | Harness fixture | Open the roster, search it, filter it and come back | 3 | 4 | 3 | 3 |
| `J00-harness-tight` | Harness fixture | One click against a zero-click budget | 0 | 0 | 1 | 1 |
| `J00-harness-fill` | Harness fixture | Fill a field rather than type it | 0 | 0 | 0 | 0 |

`J00-harness-tight` and `J00-harness-fill` are recorded at budgets their
journeys deliberately break, which is how the failure path is exercised rather
than assumed.

## Persona journeys

| Journey | Persona | Task | Clicks | Keystrokes | Navigations | Routes |
| --- | --- | --- | --- | --- | --- | --- |
| `J01-first-day` | Club member | From the dashboard, find my club and open its roster | — | — | — | — |
| `J02-executive-metrics` | OSE director | From the dashboard, reach institution-wide reporting | — | — | — | — |
| `J03-handoff-packet` | Club board member | From the dashboard, reach the handoff packet for my club | — | — | — | — |
| `J04-find-a-record` | Club board member | From anywhere in the shell, search for a record by name | — | — | — | — |
| `J05-connect-calendar` | Club member | From the dashboard, find the calendar subscription and connect it | — | — | — | — |
| `J06-ask-admin-storage` | Club member | From the dashboard, ask an administrator about a connection only they can make | — | — | — | — |
| `J07-disconnect-backup-approver` | OSE director | From settings, disconnect the backup approver who can act on my gate | — | — | — | — |
| `J08-confirm-relay-action` | Club board member | Ask Tenure AI a question and confirm from the reply what it was allowed to do | — | — | — | — |

`—` means **declared but never measured**. It is not the same as a missing row:
a missing row fails the journey outright, because a journey nobody wrote down is
a journey nobody can notice getting worse. An unmeasured row still runs, still
records what it cost, and still refuses a `fill()`; it just has no ceiling yet.

### The connection journeys — `WRK-110-005`

`J05`–`J08` are the connect / ask-admin / fix / disconnect / confirm paths, and
they exist because the decision behind them did and the surface did not.
`resolveCapability` (`apps/web/src/lib/connections/capability-resolution.ts`) has
returned exactly one control per capability since it was written, and
`settings/page.tsx` printed the label, the explanation, the owner and the badge
and never `resolved.action` — so `connect`, `ask-admin` and `disconnect` were
decisions no test could reach because nothing rendered them.

Each journey asserts two things beyond its counts, and they are the "without
provider-console knowledge" half of the requirement rather than a proxy for it:

- every URL the path visited is on the Tenure origin, and
- the visible text along the path names none of `portal.azure.com`,
  `admin center`, `API key`, `client secret`, `developer console`.

**Two ids differ from the ones the requirement drafted, because the state they
named does not exist.**

- `J07-disconnect-backup-approver`, not `J07-disconnect-calendar`. The calendar
  feed is a stateless signed URL that expires 180 days after it is issued and
  Tenure stores no record that anybody pasted one into a calendar app — so it
  cannot be disconnected from this side, and a Disconnect control on that row
  would be a button that does nothing. The backup approver IS a per-user
  connection with real persistence, a real `setDelegation` and a real
  `revokeDelegation`, so the disconnect path is measured where it is genuine.
- `J06-ask-admin-storage`, not `J06-ask-admin-ai`. After WRK-030-005 `ai.model`
  derives `certified` from `RELAY_ANTHROPIC_REVIEW`, which is `NOT_SUBMITTED`,
  so it resolves NOT_CERTIFIED and correctly offers **no control at all**.
  Document storage is the row that genuinely resolves NEEDS_ADMIN.

`fix` is not a journey of its own: it is the `whereToFix` sentence, promoted out
from under the row and rendered beside the control, and every one of J05–J07
reads it on the way past.

### Why the product rows are still unmeasured

**The seed blocker this section used to record is gone.** It said
`node apps/web/scripts/seed.mjs` aborted with "Argument `institutionId` is
missing" because `LedgerEntry` had become tenant-scoped and the seed did not
know. `scripts/seed.mjs:476` now sets it, and on 2026-08-07 the whole setup ran
clean end to end:

```
export DATABASE_URL="postgresql://tenure:tenure@localhost:5462/tenure"
npm exec --workspace apps/web -- prisma migrate deploy
#   All migrations have been successfully applied.
node apps/web/scripts/seed.mjs
#   Seed complete — 26 clubs, 235 seats, 172 directory people,
#   259 seat holdings, 34 deliverables, 15 board resources
npm run type-check      # 0 errors
```

That sentence had been false for some time with nothing watching it, on rows
nobody could fill in for as long as it stood. It is the reason
`tests/architecture/pass-requires-evidence.test.mjs` now re-checks the one part
of a blocker a machine can: a path an entry claims is absent.

**The build blocker is gone too, and it went the same way.** This section then
said the measurement was stopped by `npm run build` failing to compile on
`src/app/(app)/orgs/[slug]/finance/page.tsx` (`'OrgRecordHeader' is not
defined`) and `src/components/ClubImageEditor.tsx` (a restricted
`react-aria-components` import) — another slice's work caught half-applied, with
`J01` and `J03` both ending on those pages. That slice has landed. Re-run on
2026-08-07 from the repository root:

```
npm run build
#   ✓ Compiled successfully
#   ✓ Generating static pages (10/10)
#   exit 0 — warnings only, no errors
```

Two blockers have now been written into this document and both became false
without anybody noticing. That is the pattern worth naming rather than the two
incidents: a blocker decides that a requirement is not startable, and
`tools/loop/next-batch.mjs` stops offering an item for exactly as long as one
stands, so the sentence keeps working long after it stops being true. Re-run the
command before believing a paragraph in this section.

To record the rows:

```
docker run -d --name tenure-ux-pg -e POSTGRES_USER=tenure -e POSTGRES_PASSWORD=tenure \
  -e POSTGRES_DB=tenure -p 5460:5432 postgres:16
export DATABASE_URL="postgresql://tenure:tenure@localhost:5460/tenure"
npm exec --workspace apps/web -- prisma migrate deploy
node apps/web/scripts/seed.mjs
npm run build && npm run e2e -- e2e/journeys.spec.ts
```

Every journey prints the row to paste, and the run leaves the same rows in
`apps/web/test-results/journey-metrics.json`. Paste the observed numbers in as
the budget **after reading them** — a harness that writes its own baseline
records whatever regression it just measured and calls it the new normal.

## Competitor comparison — `TTES-050-002`, not measured

The Bible names Granola, Vercel, Brex, Monarch, Perplexity, ChatGPT, Intuit
Enterprise Suite, SAP, Workday, Oracle and Rippling as lawful public workflow
benchmarks, and requires the comparison be run "without copied trade dress".

**No competitor number appears anywhere in this document, and none should be
added from anybody's recollection of those products.** A task-time comparison is
a measurement of two systems, and the other one is not in this repository. To
produce the right-hand side of these tables somebody has to:

1. hold lawful, licensed access to each product being compared — several are
   enterprise suites whose terms govern benchmarking and publication;
2. run a human-subjects protocol: the same job, the same personas, the same
   definition of "complete", with enough participants that the difference means
   something;
3. record what was tested rather than what looked better, per §18.

None of those exist here, and none of them are code. A number invented for this
table would be indistinguishable from a measured one to every reader and to
every test in this repository — which is precisely why the requirement says
"lawful" and "without copied trade dress", and precisely why it is recorded as
`BLOCKED_EXTERNAL` in
`docs/implementation/tenant-experience-execution-ledger.md` rather than as
anything else.

Two guards hold that position rather than trusting it:

- `tests/architecture/ux-task-scorecard.test.mjs` — "no competitor task time has
  been written down that nobody measured" fails on any row here that names one
  of those products beside a number. Prose naming them is fine; the requirement
  names them itself.
- `tests/architecture/pass-requires-evidence.test.mjs` — "an entry that says a
  file is absent is still right about it" re-runs the ledger's own
  `ls docs/decisions/ADR-0009-competitive-benchmarking.md   # absent` check on
  every CI run. A blocked item is one the loop skips for as long as it stays
  blocked, so a blocker that quietly comes true is the most expensive stale
  sentence there is — as the seed paragraph above was.

What can be done now, and is done above, is the half that does not need them:
Tenure's own per-persona costs, measured the same way every time, so that the
comparison has something true on its left-hand side the day it becomes possible.
