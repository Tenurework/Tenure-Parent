# The Intuit Enterprise Suite comparison — Tenure's side of it, measured

ANL-040-002. The Analytics Bible §14 sets out eleven Intuit Enterprise Suite
strengths and, against each, what "Tenure must meet and exceed through
evidence". This file is that comparison. It is deliberately not a marketing
table: **every verdict below is computed from the execution ledgers**, and a row
cannot claim Tenure meets an Intuit strength while the requirements that would
constitute meeting it are unfinished.

§14 states the two rules this document is built to obey, verbatim:

> Do not copy Intuit UI or repeat vendor performance claims as Tenure claims.
> Establish Tenure's own baselines and comparable scenario tests.

So there is no number here about Intuit. Not one. Every figure is Tenure's own
requirement status, and `tests/architecture/anl-intuit-benchmark.test.mjs` fails
the build if a line in this file attributes a performance figure to the
competitor.

## What "meets" is allowed to mean here

| Verdict | The rule, enforced by the guard |
|---|---|
| `not started` | none of the cited requirements is `PASS` |
| `partial` | some are `PASS` and some are not |
| `met` | every cited requirement is `PASS` |
| `exceeds` | forbidden until `ANL-040-001` — the comparable scenario tests §14 asks for — is itself `PASS`. Superiority is a measurement, and the instrument does not exist yet. |

The `Decided` column is recomputed from `docs/implementation/*-execution-ledger.md`
on every run and compared with what is written here — **asymmetrically, and on
purpose**. A number or verdict stronger than the ledgers support is a hard
failure, because that is the claim §14 forbids. A number that LAGS is tolerated,
with one exception: a row every one of whose requirements has passed must say so.

The asymmetry is not fastidiousness. Ten of the eleven rows cite requirements
owned by other domains — that is the point, since analytics cannot claim a
finance capability on finance's behalf — and the first version of the guard
demanded exact equality and went red within the hour, on a `TTES` requirement
another domain closed while this file was being written. A guard whose likeliest
failure is somebody else's good news, in a file only this domain may edit, is a
guard that gets deleted, and deleting it would take the overclaim check with it.
So the ratios below are a **floor**: Tenure is at least this far along, never
further.

    node --test tests/architecture/anl-intuit-benchmark.test.mjs

## The comparison

<!-- comparison -->

| Intuit strength (§14) | Tenure requirements that would constitute meeting it | Decided | Verdict |
|---|---|---|---|
| Multi-entity, multi-dimensional financial management | `FIN-000-002`, `FIN-030-002`, `EXT-030-008` | 0 of 3 | not started |
| Business intelligence and reporting | `ANL-000-002`, `ANL-010-001`, `ANL-020-001`, `ANL-030-001` | 1 of 4 | partial |
| Payments and bill pay | `PAY-000-001`, `PAY-020-002`, `PAY-000-006`, `FIN-030-005` | 2 of 4 | partial |
| Project profitability | `OPS-030-001`, `OPS-030-002`, `GE-420-006` | 0 of 3 | not started |
| Payroll and HR | `EXT-050-001`, `EXT-050-002`, `EXT-050-006`, `HCM-000-003` | 0 of 4 | not started |
| Cash-flow, budgeting and P&L forecasting | `PLN-020-001`, `PLN-020-003`, `PLN-030-002`, `PLN-030-003` | 0 of 4 | not started |
| Intercompany/consolidated or entity statements | `FIN-030-002`, `EXT-030-008`, `ANL-030-002` | 0 of 3 | not started |
| Construction and services tailoring | `CAT-070-005`, `PACK-020-001`, `PACK-030-001`, `GE-400-006` | 1 of 4 | partial |
| Marketing connection | `CAT-060-001`, `INT-090-001` | 0 of 2 | not started |
| AI insights/agents | `ANL-030-004`, `EXT-140-001` | 0 of 2 | not started |
| Fast adoption/easy learning | `CFG-000-001`, `CFG-000-003`, `CFG-050-001`, `TTES-050-004` | 3 of 4 | partial |

<!-- /comparison -->

**Nothing in this table says Tenure exceeds Intuit at anything**, and by the rule
above nothing can until the scenario tests exist. Four rows are `partial` and
seven are `not started`. That is the honest state of the comparison on the date
of the last commit to this file, and it is the answer §14's "through evidence"
demands — the alternative, a table of eleven claims with no ledger behind them,
is precisely the "repeat vendor claims" failure with the vendor changed.

### Why each row cites what it does

- **Multi-entity, multi-dimensional financial management.** `FIN-000-002` is the
  legal entity / chart-of-accounts / ledger / book / period / currency /
  dimension model itself; without it "multi-dimensional" has nothing to be a
  dimension of. It is `BLOCKED_EXTERNAL` on a schema change, which is why this
  row cannot move on analytics work alone.
- **Business intelligence and reporting.** The one `PASS` is `ANL-000-002` —
  shared metrics defined once, false real-time labels removed. The other three
  are the semantic layer, the visual grammar and governed authoring, and
  `docs/architecture/anl-analytics-limitations.md` publishes exactly how far
  short the grammar falls (10 of the 45 marks §7 names).
- **Payments and bill pay.** The two `PASS` rows are the authority boundary
  document and the interfaces that stop a module importing a raw provider
  client. Neither is bill pay; they are the controls that make bill pay
  buildable without a second payment path appearing.
- **Project profitability.** Cited against Operations' project execution rather
  than a report, because profitability without actuals is a spreadsheet.
  `GE-420-006` is the Global Engine's own instruction to prove this exact Intuit
  benchmark, and it is `FAIL` — this document is the comparison, not the proof.
- **Payroll and HR.** `HCM-000-003`, effective-dated workforce structures, is
  `BLOCKED_EXTERNAL`; every payroll requirement above it inherits that.
- **Cash-flow, budgeting and P&L forecasting.** Planning's four, including the
  forecast gateway with baselines and uncertainty. §14's phrasing is
  "forecasting", and a forecast without uncertainty is not one.
- **Intercompany/consolidated or entity statements.** Consolidation and
  elimination, plus `ANL-030-002` — the statement itself is a report family, and
  analytics owns that half.
- **Construction and services tailoring.** The `PASS` is `PACK-030-001`,
  canonical pack objects with versions and signatures. A pack machine exists; a
  construction pack does not.
- **Marketing connection.** Registration of CRM/marketing systems, and connector
  certification — §14 says "certified integrations with consent and attribution",
  and an uncertified connector is not a claim Tenure makes.
- **AI insights/agents.** Cited narrowly and on purpose: §14 requires Relay be
  "cited, permission-aware", so the two requirements are narratives-with-citations
  and permission-aware retrieval with cited versions. An assistant that cannot
  show its source is not this row.
- **Fast adoption/easy learning.** The three `PASS` rows are the configurator's
  repository inspection (`CFG-000-001`), its retain/refactor/migrate/retire map
  (`CFG-000-003`) — the honest base of a migration factory — and the adoption
  dashboards. Adoption dashboards and their ownership
  (`TTES-050-004`) landed in this wave; what is still absent is a measured
  time-to-proficiency, so no adoption speed is claimed.

## The other mandatory competitors

§14 opens by requiring Intuit Enterprise Suite be treated as a mandatory
competitor "in addition to SAP, Oracle, Workday, Salesforce, Rippling, NetSuite
and specialist systems". Those scenarios are `ANL-040-001`, which is `FAIL` and
recorded as such in the analytics ledger: benchmark scenarios need a seeded
database and a runnable end-to-end harness, and no such harness exists for a
competitor comparison. Naming them here without scenarios behind them would make
this document the thing it exists to prevent.
