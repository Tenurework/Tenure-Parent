# Data provenance, and what the product's numbers actually mean

GE-000-006. Reconciles the figures quoted about the pilot to the code and data
that produce them, and states which rows are seeded.

---

## 1. The quoted figures, reconciled

Seven documents in this repository quote some combination of "26 clubs,
235 seats, 172 people". Two of the three are not what a reader would assume.

| Quoted | Canonical source | Verdict |
|---|---|---|
| 26 clubs | `ROSTER.length` | **correct** |
| 235 seats | `db.role.count()` | **conflates two things** |
| 172 people | `db.directoryPerson.count()` | **correct, and not 172 names** |

### "235 seats" is 209 board seats plus 26 advisor roles

```
roster seats across 26 clubs   209
one advisor role per club     + 26
                              ----
Role rows                      235
```

`seed.mjs` reports `seats: await db.role.count()`, and a `Role` row is created
both for a board seat and for each club's advisor. An advisor is not a board
seat — they are not elected, not termed, and not part of the handoff the product
is built around. **The pilot has 209 seats.** Anywhere "235 seats" appears, the
true statement is "235 role records, of which 209 are board seats".

### "172 people" is right, and "191 names" is not a contradiction

The real roster contains 278 person entries carrying an email address:

```
entries with an email    278
distinct emails          172   ← DirectoryPerson rows
distinct names           191
```

191 > 172 looks like 19 people being lost. It is not. **18 email addresses each
carry two spellings of the same name** — a middle name present in one row and
absent in the other, or a lowercase particle (`von`, `van`) capitalised in one:

```
A.P.M.  vs  A.M.          middle name dropped
F.V.T.  vs  F.v.T.        particle capitalisation
K.K.M.  vs  K.M.          middle initial dropped
```

`DirectoryPerson.email` is `@unique`, so the seed's upsert collapses each pair
to one row. **172 is the correct count of people.**

There is a real, small defect underneath: the upsert takes the last spelling it
encounters, so which version of a person's name is displayed depends on roster
iteration order. It is not a data-loss bug and it is not urgent, but a student
seeing their name inconsistently spelled is a product defect, and nothing
currently detects it.

## 2. What is seeded, and the fact that nothing marks it

`apps/web/scripts/seed.mjs` creates rows in 15 models:

```
Institution · InstitutionMembership · User · Organization · OrganizationAdvisor
Role · RoleAssignment · SeatHolding · DirectoryPerson · Deliverable
Resource · BudgetLine · LedgerEntry · Vendor · Document
```

**No column anywhere in the 40-model schema records that a row was seeded.**
There is no `source`, no `provenance`, no `isSeed`. A seeded club and a club an
operator created in the UI are the same shape, and after the first operator edit
they are not distinguishable even by inspection.

Three consequences worth naming:

1. "Is this real data?" cannot be answered by a query. It is answered by knowing
   which script ran, which is knowledge held by a person.
2. A tenant cannot be reset to "as provisioned" — there is no predicate that
   selects what provisioning created.
3. `seed-reference-data.yml`'s own description says the seed "archives clubs
   absent from the roster and clears rows it treats as test state". It decides
   what is test state by heuristic, because there is no marker to read.

> Owned by GE-060. Tenant provisioning has to record what it provisioned; that
> record is what makes (1), (2) and (3) answerable instead of remembered.

## 3. Seeded vs synthetic — a distinction the code enforces

Two different things are easy to conflate, and `roster-source.mjs` keeps them
apart:

| | Real roster | Synthetic fixture |
|---|---|---|
| File | supplied via `ROSTER_FILE` | `scripts/roster-data.sample.mjs` |
| Committed | **no** — gitignored | yes |
| Clubs / seats / advisors | 26 / 209 / 19 | 26 / 209 / 19 |
| Distinct people | 172 | 160 |
| Addresses | real university domains | all `@example.invalid` (RFC 2606) |

The fixture has 160 people rather than 172 because anonymisation assigns one
invented identity per real person, collapsing the 18 spelling variants that the
real file carries. **The shapes the product depends on — club count, seat count,
seat codes, vacancies, predecessor links — are identical**, which is what makes
it a valid CI substrate.

`roster-source.mjs` **refuses** to seed a production institution from the
synthetic fixture unless `ALLOW_SYNTHETIC_ROSTER=true`. That is the right
failure direction: putting invented names on real board seats would be
discovered by a student finding a stranger on their own seat.

## 4. Placeholder data still present in shipped code

Not seeded — compiled in.

| Location | What | Status |
|---|---|---|
| `lib/policies.ts` | 471 lines of Simon-specific policy text, 37 pilot-specific strings, and two named staff contacts | tenant content in engine source — **GE-060** |
| `(app)/admin/people/page.tsx` | example rows using `staff@rochester.edu`, `jlee@rochester.edu` | UI copy |
| `components/admin/RoleTransferPanel.tsx` | `successor@rochester.edu` | UI copy |

The `lib/policies.ts` entry is the one that matters. It is not a placeholder —
it is one customer's governing content compiled into the global engine, which
the platform directive prohibits outright. It is listed here because it was
found while auditing data provenance, and because it is the clearest single
example of the thing blueprints and modules exist to replace.

## 5. The exposure this audit found

`apps/web/scripts/roster-data.mjs` — 328 real university email addresses for 172
named students and advisors — was committed to **two public repositories** and
served by `raw.githubusercontent.com` with HTTP 200. It also shipped inside the
production container image, since the Dockerfile copies `apps/web/scripts`
wholesale.

It is now untracked and gitignored here, and a pull request does the same for
`satvikOS/Tenure` (which cannot be pushed to directly). `tests/security/no-personal-data.test.mjs`
fails the build if a real-domain address is committed again.

**Removal is not remediation.** The blob remains reachable by commit SHA in both
repositories' histories, and those addresses should be treated as disclosed.
What remains is a decision for a person, recorded at GE-GATE-0:

- purge the blob from both histories and force-push
- ask GitHub Support to drop cached views of the affected SHAs
- decide whether the affected people are notified

The mechanism to prevent this had been built — `roster-source.mjs` with its
three-source fallback — and was never used, because nothing failed while the
file sat there. That is the general lesson, and it is why the fix landed as a
failing test rather than as a deletion.
