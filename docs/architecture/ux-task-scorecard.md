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

`—` means **declared but never measured**. It is not the same as a missing row:
a missing row fails the journey outright, because a journey nobody wrote down is
a journey nobody can notice getting worse. An unmeasured row still runs, still
records what it cost, and still refuses a `fill()`; it just has no ceiling yet.

### Why the product rows are still unmeasured

Filling them in needs a seeded database, and on 2026-08-07 the repository could
not produce one:

```
DATABASE_URL=postgresql://tenure:tenure@localhost:5460/tenure \
  npx prisma migrate deploy      # succeeds — 9 migrations applied
DATABASE_URL=... node apps/web/scripts/seed.mjs
#   Invalid `prisma.ledgerEntry.create()` invocation:
#   Argument `institutionId` is missing.
```

`prisma/schema.prisma` has gained a required `LedgerEntry.institutionId` and
`scripts/seed.mjs` does not set it, so the seed aborts part-way. Until the seed
and the schema agree, no journey can sign in. `npm run build` is separately
unavailable: `npm run type-check` reports errors in
`src/app/(app)/approvals/[id]/page.tsx` and `src/components/finance/LedgerDrawer.tsx`.

To record a row once that is fixed:

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

What can be done now, and is done above, is the half that does not need them:
Tenure's own per-persona costs, measured the same way every time, so that the
comparison has something true on its left-hand side the day it becomes possible.
