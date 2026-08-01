# Duplicate sources, and the plan to consolidate each

GE-020-005. Where the same fact is written in more than one place, which copy is
canonical, and how the others are retired **without deleting history blindly** —
which the item is explicit about, and which is the part that makes these plans
longer than "delete the old one".

Each plan below states the trigger, the steps in order, what is irreversible,
and how it is verified. Every count is reproducible with the command shown, and
was taken on 2026-08-01.

---

## 1. Authorization — three systems, one of which gates nothing

```
$ grep -rl 'admin/capabilities' apps/web/src | wc -l     → 11
$ grep -rl '@tenure/authorization' apps/web/src          → 2
```

| System | Decides | Consumers |
|---|---|---|
| `lib/rbac.ts` | who holds which seat — `UserContext` | app-wide |
| `lib/admin/capabilities.ts` | 16 capability ids, Director ⊇ Staff ⊇ Advisor | 11 files, **authoritative** |
| `@tenure/authorization` | roles, scope, delegation, effective dates, SoD | 2 files, **navigation only** |

`lib/authz/navigation-capabilities.ts` says so itself: *"Hiding a link does not
protect a route."* The engine the Bible describes decides which menu entries
render and nothing else.

### The plan

1. **`rbac.ts` is not a duplicate and stays.** It answers "who holds what seat",
   which is an organization-model question, not an authorization one. Merging it
   into the policy engine would put seat lookup behind a policy decision that
   needs seat lookup to make.
2. **Map all 16 capability ids to `<module>.<action>` permissions**, one commit,
   no behaviour change. `administration.access` and `budgeting.viewReports`
   already exist as the shape.
3. **Run both engines in parallel and compare.** Every `requireCapability` call
   also asks `@tenure/authorization` and records disagreement to the audit trail
   without acting on it. Ship for two weeks.
4. **Read the disagreements.** Any is a bug in the mapping or a behaviour the
   old system had that nobody wrote down. Both must be resolved before step 5.
5. **Switch the decision** to the engine; leave `capabilities.ts` computing and
   comparing for one more release.
6. **Delete `capabilities.ts`.**

**Irreversible:** step 6 only. Steps 3–5 are a flag.

**Verified by:** zero recorded disagreements across a full release cycle, and
`grep -rl 'admin/capabilities' apps/web/src` returning nothing.

**Why parallel-run rather than cut over:** the 16 ids encode years of decisions
about who may do what. A rewrite that is "obviously equivalent" is exactly the
kind that removes one person's access on a Monday.

> Owner: GE-030s.

---

## 2. Audit — 34 of 36 writes bypass the package

```
$ grep -rho 'auditEvent\.create' apps/web/src --include=*.ts --include=*.tsx | wc -l → 36
```

Two go through `buildAuditRecord` (`lib/admin/guard.ts`,
`lib/provisioning/reconcile.ts`). The other 34 hand-build the payload and skip
field validation, the DENY-needs-a-reason rule, and metadata redaction.

### The plan

1. **Ratchet holds the line.** `tests/architecture/audit-writes.test.mjs` already
   fails on a 35th raw write, so the number can only fall. It is already
   working: the reconciler was a new write and went through the package.
2. **Convert in dependency order**, not alphabetically: `lib/` helpers first
   (`clubs.ts`, `calendar-write.ts`, `resources-data.ts`), then server actions,
   then routes. A helper converted after its callers means converting twice.
3. **Lower `RAW_WRITE_CEILING` in the same commit as each conversion.** A ceiling
   lowered separately is a ceiling nobody notices has stopped falling.
4. **At zero, invert the test**: assert every `auditEvent.create` is preceded by
   `buildAuditRecord` in the same file, so the ratchet becomes a prohibition.

**Irreversible:** nothing. Each conversion is independently revertible.

**No historical data is touched.** Existing rows stay exactly as written. They
are unvalidated and unredacted and always will be — rewriting them would be
fabricating evidence, and the honest record is that rows before the conversion
date carry weaker guarantees. That fact belongs in the audit viewer, not in the
rows.

**Verified by:** `RAW_WRITE_CEILING` reaching 0 with the suite green.

> Owner: GE-120s.

---

## 3. Person — `User` and `DirectoryPerson`

**This is not a duplicate and must not be consolidated.**

| Model | Is |
|---|---|
| `User` | someone who can sign in |
| `DirectoryPerson` | someone on the roster |

The schema comments the reason: seeding the roster as login accounts would
create accounts nobody asked for, for people who have never used the product.

Recorded here so a future reader running this same audit does not "fix" it.
The only real defect nearby is that `DirectoryPerson.email` is `@unique` while
the roster carries 18 addresses with two name spellings each, so the upsert
takes the last one and a person's displayed name depends on iteration order
(`docs/architecture/data-provenance.md` §1). That is a name-normalisation bug,
not a modelling one.

---

## 4. Member and role — one source, two shapes

`RoleAssignment` and `SeatHolding` both describe a person occupying a seat.
`RoleAssignment` carries status and the current holder; `SeatHolding` carries
the term-scoped history including predecessors.

### The plan

1. **Establish which is canonical for "who holds this seat now."** Reading both
   in different places is the actual defect; neither model is wrong.
2. **Route every current-holder read through one function** (`lib/org/`), so the
   answer has one implementation before it has one table.
3. **Only then** decide whether the two merge. They may not need to — a
   current-state table and a history table is a normal shape, and merging them
   would make every current-holder query filter on effective dates.

**Irreversible:** nothing in steps 1–2. Step 3 is a separate ADR if it happens.

**Deliberately no data change proposed.** The history in `SeatHolding` is the
handoff record the product exists for.

---

## 5. Approvals — one source, two gate implementations

`lib/approvals.ts` and `packages/workflow` both encode gate progression. The
package is the general engine; the app file is the pilot's approval chain.

### The plan

1. **Express the pilot's chain as a workflow definition** the package can run.
2. **Compare outcomes on live traffic** for one release — same shadow technique
   as authorization, same reason.
3. **Switch, then delete.**

Same shape as §1 because it is the same risk: a rewrite that looks equivalent
and silently changes who can approve what.

---

## 6. Finance — two writers, and the second one is the interesting one

I first wrote "one writer" here and it was wrong. Checking rather than asserting:

```
$ grep -rln 'budgetLine.(create|update|upsert|delete)|ledgerEntry.(create|update)' apps/web/src
app/(app)/orgs/[slug]/finance/actions.ts
app/(app)/approvals/actions.ts
```

`approvals/actions.ts:257` creates a `LedgerEntry` and updates a `BudgetLine`
when an approval is decided — an approval posting to the ledger, which is
correct behaviour and not a duplicate source. The money representation is shared
(`@tenure/platform-config/money`, integer minor units), and it guards against
the double-post: it reads `ledgerEntry.findFirst({ where: { approvalId } })`
first, so deciding the same approval twice does not post twice.

### The plan

1. **Nothing to consolidate.** Two callers of one domain is not two sources of
   truth; it is a module with more than one entry point.
2. **The real risk is the idempotency check being local.** It is a
   read-then-write inside a transaction rather than a uniqueness constraint, so
   it is correct under the current isolation level and not by construction. A
   unique index on `LedgerEntry.approvalId` would make the double-post
   impossible rather than unlikely.
3. That index is a one-line migration and is the only change proposed for
   finance.

**Irreversible:** nothing. Adding a unique index fails loudly if duplicates
already exist, which is itself the audit worth running first.

---

## What consolidation is not

None of the plans above delete a historical row, and three of them explicitly
refuse to. GE-020-005 says *do not delete historical data blindly*, and the
reason is that every one of these tables is the answer to a question someone
will ask later under pressure: who approved this, who held that seat, what did
the system do. A consolidated schema that lost the old answers would be tidier
and worth less.

Where old data carries weaker guarantees — the 34 unvalidated audit rows — the
plan is to say so, not to rewrite them into looking stronger.
