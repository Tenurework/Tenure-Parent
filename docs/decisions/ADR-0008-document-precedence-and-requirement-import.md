# ADR-0008 — Document precedence, and what counts as an imported requirement

**Status:** Accepted · 2026-08-06

## Context

Twenty-three Bible-like authorities were uploaded to the repository root. They
state 1,696 requirements. The execution system — four prompts and three ledgers
under `docs/implementation/` — could see 970 of them.

Twelve whole domains had no representation anywhere: payments, the universal
work graph, the declarative configurator, the connector catalog, the pack
factory, financial management, tenant experience, HCM, operations, analytics and
planning. Not a ledger row, not a checkbox, not a failing test.

**Nothing was red.** `next-batch.mjs` reported "1219 items, 123 decided", and
that denominator was computed from the documents somebody had remembered to wire
up. An unimported requirement is not queued, not counted and not failing. It is
invisible, and invisible reads exactly like done.

This is the failure the Constitution calls a document-wiring defect, and it is
not permission to skip anything.

## Decision

### 1. Discovery is dynamic and repo-wide

`tools/document-graph.mjs` walks the repository and classifies any Markdown file
whose name or opening carries an authority marker — Bible, Constitution, Master
Prompt, Implementation Extension, Control Plane, Document Graph, Completeness
Audit, or a `BEGIN … PROMPT` banner. A document is never skipped because an
older Constitution's list predates it.

Over-inclusion costs a classification line. Under-inclusion is how 726
requirements went missing, so the markers are deliberately broad and the graph
records a `role`: an **authority** states requirements, a **reference** informs
without stating any. Only an authority can have unimported requirements.

### 2. A byte-identical copy is one document with two paths

Six of the uploads are `Name (1).md` duplicates, byte-identical to their
originals. They are registered once, by SHA-256, with every physical path
recorded as an alias. Registering both would double-count every requirement they
state and inflate the denominator of every completeness claim.

The original wins the canonical slot. Alphabetical order puts `(1)` first, so
without an explicit rule the *copy* becomes authoritative and the real document
becomes its alias — which reads as though somebody had chosen that deliberately.

The duplicates are **not deleted**. Tidiness is not a reason to remove a file
somebody uploaded.

### 3. Precedence: version families are derived, cross-family supersession is declared

Documents whose filenames differ only by version are one family, and the highest
version is current. That is mechanical and needs no judgement.

`GE-022-002` needed judgement. The standalone `Global_Engine_Execution_Prompt_v1.0`
states it as design tokens for dense ERP states; the Unified Master Prompts v2.0
and v3.0 both state it as the versioned Tenure Experience System package and
token pipeline. Different families, so no version rule reaches it.

v3.0 settles it in its own text: *"It supersedes the Version 2.0 execution prompt
but does not replace any owning domain Bible."* The Unified line is the successor
to the standalone Execution Prompt, so **the Unified Master Prompt v3.0 governs**
and the v1.0 Execution Prompt is superseded.

Recorded as a short explicit map in the compiler rather than parsed out of
English. A regex over prose is a guess about what a sentence meant, and this one
decides which of two documents governs a requirement. The map is reviewable; a
supersession naming a document that does not exist throws rather than silently
doing nothing.

**A domain Bible is never superseded by a prompt.** v3.0 says so, and the
compiler has no rule that could do it.

### 4. Status comes from ledgers, never from a Bible's own checkbox

Every Bible states its requirements as `- [ ] <PREFIX>-000-001 — text`. Those
checkboxes are the document's record of *intent*. (The placeholder is written
`<PREFIX>` rather than bare, because a bare one is a well-formed requirement id
and the compiler read this ADR as declaring a requirement family nothing owns —
which the orphan-prefix check duly reported.) Reading them as status would
let a document mark its own homework.

`capability-completeness-registry.yaml` therefore derives status from the
execution ledgers — the record of work and evidence — and defaults to `FAIL`.

### 5. `imported` and `decided` are different facts

A requirement in an execution prompt but not yet in a ledger is **imported and
undecided**: the queue can reach it. A requirement mentioned in no execution
document is **unimported**: nothing can reach it.

Both are unproven. Only the second is a wiring defect, so the registry says
which, and `tests/architecture/document-graph.test.mjs` ratchets the unimported
count downward. It may only shrink.

### 6. `BLOCKED_ARCHITECTURE` joins the status vocabulary

For requirements whose owning documents genuinely conflict and where precedence
cannot be settled. None are in that state today — GE-022-002 was settled above —
but the status must exist before it is needed, or the next conflict gets
recorded as `FAIL` and looks like ordinary undone work.

## Consequences

The honest denominator is **1,865 requirements**, of which **108 are PASS** and
**895 are in no execution document at all**. The previously reported "123 of
1219" measured a subset of the documents against a subset of the requirements.

This is a larger number and a smaller percentage than the repository claimed
yesterday. That is the point of measuring it.

## What this ADR does not decide

* **Where the uploaded Bibles should live.** They are at the repository root;
  every other architecture document is under `docs/architecture/`. Relocating 23
  files is a reversible cleanup that changes no requirement, and doing it in the
  same change as the import would have made the diff unreadable.
* **Which requirements are actually applicable.** Everything defaults to `FAIL`,
  including requirements that may turn out to be `NOT_APPLICABLE`. Marking one
  not-applicable is a decision with a reason, and 895 of them cannot be made
  honestly in one pass.
