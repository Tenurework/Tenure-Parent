# System Studio information architecture and route map

The Bible's required deliverable list (section 19, "Product and UX") names one:
"System Studio information architecture and route map". This is it. It decides
what the console's navigation is, where each of its routes sits in that
navigation, and — the part that carries the weight — which routes are finished
operator surfaces and which are not.

**Authorities, in precedence order.**

1. `Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`,
   section 7.2 "Global shell", which lists the navigation domains this console
   is for.
2. `docs/implementation/system-studio-aws-control-plane-execution-ledger.md`,
   which records what has actually been built against those domains, with
   evidence.

Nothing here is a taste argument. Where this document had a choice to make it
says which clause made it, and where it had no clause it says that instead.

---

## 1. The problem this replaces

Eleven routes behind eight equal tabs in one flat row — Tenants, Systems,
Platform, Cost, Audit, Estate, Health, Security — ordered by a claim about an
operator's workflow ("find or create a tenant, inspect the systems that exist,
then check the platform underneath them"). Three properties of that row:

- **No grouping and no hierarchy.** Eight peers. `/platform/cost` and
  `/platform` were siblings in the row while one was inside the other in the
  URL, which is why the active-entry rule needed a most-specific-wins tiebreak
  in the first place.
- **No connection to the document that says what the console is for.** The tab
  names were page names. An operator could not read the row and learn which
  parts of the control plane exist.
- **Finished surfaces sitting beside half-built ones, indistinguishable.**
  `/platform/health` reads CloudWatch live and reports seven verdicts.
  `/platform` prints the execution ledger's own progress bar, a list of the
  repository's test suites, and an AWS estate snapshot compiled at a commit.
  Both were a tab of the same size, in the same row, in the same colour.

The operator's summary: the console "is cluttered and looks like a construction
site, all messed up and confusing".

## 2. The rule

> Every surface that is unfinished, diagnostic, or exists only to prove
> something to a developer sits behind the **last** group, named **Diagnostics**.
> Everything before Diagnostics is a finished, Bible-defined operator surface.

No route is deleted and no route stops being served. Moving it behind the last
group is the entire mechanism, and it is reversible in one line of the table in
`apps/system-studio/src/components/Nav.tsx` on the day the surface becomes an
operator surface.

The line is drawn in the rendering, not only in the ordering: the Diagnostics
group is pushed to the end of its row and separated by a rule
(`margin-inline-start: auto` and `border-inline-start`), because an ordering
nobody perceives as an ordering is not a signal.

## 3. The groups

The group names are the Bible's, from section 7.2's left-navigation list, in
that list's order:

> Fleet, Implementations, Blueprints, Modules, Releases, Changes, AWS, Identity,
> Data, Relay, Integrations, Domains, Security, Operations, FinOps, Evidence,
> Marketplace.

Narrowed to the domains with a real surface today, that order gives:

| # | Group (Bible domain) | Entry | Route | The requirement it serves |
|---|---|---|---|---|
| 1 | **Fleet** | Tenants | `/tenants` | Section 14. Fleet view with lifecycle, cell/region, health, drift, cost and next action (`STUDIO-100-001`); search, saved filters and comparison (`STUDIO-100-002`). |
| 2 | **Blueprints** | Systems | `/` | Section 8. Every effective configuration value shown with its source layer and provenance (`STUDIO-040-003`), over the blueprint that produced it. Also answers **Modules** (the enabled module set per system) and **Integrations** (the connector/extension/model catalog with its refusals and setup references). |
| 3 | **AWS** | Estate | `/platform/estate` | Section 12. Cross-account actual-resource inventory (`STUDIO-080-001`), account topology (`STUDIO-010-002`), and a refused read rendered as unknown rather than as absent (`STUDIO-000-007`). |
| 4 | **Security** | Findings | `/platform/security` | Section 15. Aggregated findings with severity, SLA and per-source answered/unknown state (`STUDIO-110-006`). |
| 5 | **Operations** | Health | `/platform/health` | Section 12. Alarms with the verdicts CloudWatch does not return — disabled, stale, missing, unauthorized (`STUDIO-080-008`). |
| 6 | **FinOps** | Cost | `/platform/cost` | Section 16. Cost allocation with honest unallocated spend (`STUDIO-120-008`), cost display (`STUDIO-120-009`), and approval thresholds before a commitment (`STUDIO-120-010`). |
| 7 | **Evidence** | Audit | `/platform/audit` | Section 15. Tamper-evident audit with verification tooling and a retention plan (`STUDIO-110-005`). |
| — | **Diagnostics** | Platform | `/platform` | **None.** See section 5. |

Entry labels are the page's own name, not the domain's, for two reasons. The
domain is already printed above the entry, so repeating it ("Security /
Security") wastes the one line of hierarchy this navigation has. And four labels
are load-bearing in tests owned by other work: `e2e/cost.spec.ts` asserts the
current entry reads exactly `Cost` on `/platform/cost` and exactly `Platform` on
`/platform`; `e2e/platform.spec.ts` clicks a link named exactly `Systems` and a
link named `Platform`; `e2e/preferences.spec.ts` clicks a link named `Tenants`.
Those four labels are pinned by those assertions and were not changed.

## 4. Where each of the eleven routes falls

Eleven routes serve operators (`/signin` is pre-session chrome and is excluded;
the navigation does not render there at all).

| Route | Side of the line | Navigation position |
|---|---|---|
| `/tenants` | Operator surface | Fleet |
| `/tenants/new` | Operator surface | Not a destination — reached from Fleet |
| `/tenants/[slug]` | Operator surface | Not a destination — reached from Fleet |
| `/tenants/[slug]/configuration` | Operator surface | Not a destination — reached from the tenant |
| `/` | Operator surface | Blueprints |
| `/platform/estate` | Operator surface | AWS |
| `/platform/security` | Operator surface | Security |
| `/platform/health` | Operator surface | Operations |
| `/platform/cost` | Operator surface | FinOps |
| `/platform/audit` | Operator surface | Evidence |
| `/platform` | **Behind Diagnostics** | Diagnostics, last |

### The eight in front of the line, each justified

**`/tenants` — Fleet.** `STUDIO-100-001` requires the fleet view to show tenant,
lifecycle, cell/account/region, release, health, cost, drift, blockers and next
action; `STUDIO-100-002` requires search, saved filters, comparison and export
under semantic authorization. The page renders all of it from the registry and
live observations, pages its table, and states what it is holding back. This is
the console's front door and the first group for the same reason the Bible lists
Fleet first.

**`/tenants/new` — Fleet's action, not a section.** It is the entry to the
section 9 implementation journey (intake and identity, organization, module
composer, deployment placement) and it is finished for that scope. It is
deliberately **not** a navigation destination. `e2e/operator-roles.spec.ts`
asserts that for an Auditor the compose control is absent rather than disabled,
and that `href="/tenants/new"` does not appear in an Auditor's markup at all — a
global navigation entry renders for every role on every route and would put the
string there. Section 6's deny-by-default requirement (`STUDIO-020-006`,
`STUDIO-020-007`) is the reason that assertion exists, and a navigation that
advertises a write an operator does not hold is a frontend-only guard pointed
the wrong way. It stays the primary action on `/tenants`, where the page has the
session and can decide.

**`/tenants/[slug]` — Fleet's detail.** Lifecycle state machine, the successor
moves and which of them need approval (`STUDIO-060-007` typed confirmation and
non-automatable irreversible moves), desired-versus-actual comparison
(`STUDIO-080-006`), retained observations and residual findings for archived and
purged states (`STUDIO-100-005`). A dynamic route cannot be a static navigation
entry; it is reached from the fleet table and from the command palette, and the
Fleet group stays lit while an operator is inside it — the active-entry rule
matches a subtree, not an exact path.

**`/tenants/[slug]/configuration` — the tenant's own configuration.** The
editor over immutable revisions, with the dependency graph, the rollback diff,
and reserved and withheld domains named with the reason rather than hidden. It
serves `STUDIO-040-003` (every effective value with its source layer, author and
previous versions) and `STUDIO-040-007` (expected version, comparison,
conflict). Same reasoning as above: dynamic, so it is reached from its tenant.

**`/` — Blueprints.** Every configured organization system with its blueprint,
its resolved configuration and the layer each value came from, its enabled
module set, and the integration catalog's availability decisions with the
reasons for each refusal and the credential references each connector would
need. That is `STUDIO-040-003` for the blueprint layer, the **Modules** domain's
per-system answer, and the **Integrations** domain's catalog. It is honest about
its own limit in its own words — tenant overlays are files until the
configuration store covers them — which is a stated scope, not an unfinished
surface: the surface renders completely and truthfully for what it covers. It
also holds the Marketplace's correct state: `marketplaceEnabled: false` is
passed explicitly, so the marketplace is closed as a property of the code
(`STUDIO-130-007`).

**`/platform/estate` — AWS.** Every number comes from a call the process just
made. The header band answers "which account am I looking at" without scrolling,
and says so when the answer is not known rather than printing a default. A
denied call renders as UNKNOWN carrying principal, action, error code,
account/region and the minimum IAM statement (`STUDIO-000-007`) — the item the
ledger records as PASS with thirteen producer mutations applied and thirteen
caught. Section 12's whole point is that an operator understands the estate
without receiving general AWS mutation access, and this page is read-only.

**`/platform/security` — Security.** Findings with severity, SLA and attribution
(`STUDIO-110-006`). The sources table is what makes the empty case mean
something: with six products behind one aggregator, "no open findings" is only a
fact if the page can also say which of the six answered, and when the call was
refused all six read UNKNOWN and no findings table is drawn.

**`/platform/health` — Operations.** `STUDIO-080-008` forbids rendering a green
alarm because no data is present, and requires OK, ALARM, INSUFFICIENT_DATA,
disabled, stale, missing and unauthorized to be distinguishable. The page reads
CloudWatch live and the expected set comes from the Terraform, so MISSING is
falsifiable rather than an absence nobody notices.

**`/platform/cost` — FinOps.** The one that needs the distinction stated
explicitly: **an honest empty state is not an unfinished surface.** There is no
Cost and Usage Report to ingest — no AWS Organization exists and no role this
engine could assume to call Cost Explorer — so `lib/cost-source.ts` returns
`NOT_CONFIGURED` and the page renders that, naming what an operator must connect.
It deliberately has no third arm showing sample figures, because the Bible's
prohibited-shortcut list names "fake cost" and this is the page an Aurora cluster
gets approved from. The allocation engine behind it is PASS in the ledger
(reconciliation to the unit, drivers carried with every allocated amount), and
the approval thresholds it renders are live policy. A finished surface whose data
source is `BLOCKED_EXTERNAL` stays in front of the line; it is telling the
operator something true and actionable about the estate. Demoting it would hide
a real gap behind a tab named for unfinished work.

**`/platform/audit` — Evidence.** `verifyChain` and `applyRetention` existed as
code with no caller until this page called them; the verification now runs on
every page load over the rows read back out of DynamoDB and reports a break by
sequence position. The retention plan is a partition of the records and deletes
nothing. Section 3 is an evidence law and this is the surface that checks the
evidence is intact, which is why it takes the Bible's **Evidence** domain rather
than sitting under Security.

### The one behind the line

**`/platform` — Diagnostics.** It serves no operator requirement. Its own header
says what it is: "Compiled from the execution ledger, the execution prompt and
the read-only AWS inventory at commit `<sha>`." Its own source comment says why
it was built: "twelve commits of Phase 0 and Phase 1 work produced an inventory,
an entry-point trace, a contradictions list and a set of guards, and none of it
was visible in the product. Work that cannot be seen is indistinguishable from
work that did not happen." That is a true and good reason to build a page. It is
a reason addressed to a developer.

Its seven sections, and what each is:

| Section | What it is |
|---|---|
| Programme | The execution ledger's own checkbox count, per phase, with `STUDIO-*` ids and a percentage. A build report. |
| Module adoption | A fragment of the **Modules** domain, which has no operator surface yet. |
| Release compatibility | A fragment of the **Releases** domain, which has no operator surface yet. |
| Open findings | Architecture-versus-inventory discrepancies with an owning requirement id, no severity, no affected tenant and no SLA. Documentation gaps, not security findings — the page's own comment says so, and the real ones are on `/platform/security`. |
| AWS estate | A snapshot compiled at a commit. `/platform/estate` is the live read, and the estate page's comment records that the two are kept as separate pages rather than one page that sometimes lies about which it is showing. |
| Queues with no producer and no consumer | Orphan detection over the same compiled snapshot. |
| Alarms | Superseded, in the page's own words, by `/platform/health`, which "reports seven verdicts, including the four this table cannot express". |
| Test suites | A list of the repository's test directories and file counts. A build report. |

Four of the eight are developer reports; three are compiled duplicates of pages
that now read the estate live; one is a fragment of a domain that has no surface.
It also carries the console's largest DOM budget by a factor of four (6,000
elements against 1,400 for `/tenants` and 400 for `/`), which is the shape of
"construction site" measured rather than asserted.

It is not deleted: the programme's visibility is worth keeping, the compiled
snapshot is the only record of some reads, and deleting a route to tidy a
navigation is how work becomes invisible again. It moves to the last group, the
group is named for what it holds, and the rule before it is drawn.

## 5. Bible domains with no surface

Naming these is part of the deliverable. A navigation that shows only what exists
tells an operator nothing about what does not.

| Bible domain | State today |
|---|---|
| Implementations | Partial and not a destination. `/tenants/new` and `/tenants/[slug]/configuration` are stage surfaces; the resumable multi-stage workspace with per-stage readiness and blockers (`STUDIO-050-001`, `STUDIO-050-002`) is not built. Its surfaces are reached from Fleet. |
| Modules | Answered per-system inside Blueprints (`/`). No standalone catalog surface; a fragment sits on `/platform`. |
| Releases | No surface. A compatibility fragment sits on `/platform`. |
| Changes | No surface. Lifecycle advances on `/tenants/[slug]` carry approval requirements, but there is no change-request queue, plan diff or approval inbox (section 10). |
| Identity | No surface. |
| Data | No surface. |
| Relay | No surface (section 13). |
| Integrations | Answered inside Blueprints (`/`) as the catalog's availability decisions, refusals and setup references. |
| Domains | No surface. |
| Marketplace | Deliberately absent. `STUDIO-130-007` requires it to stay a nonfunctional "Coming soon" until certification, packaging, review, billing and revocation exist; `/` passes `marketplaceEnabled: false` explicitly. A navigation entry would be the opposite of that requirement. |

When one of these gets a real surface, it takes its own group, in the Bible's
position, before Diagnostics.

## 6. Deviations from the Bible's shell, stated

Section 7.2 describes a **left** navigation and a header carrying active
environment, scope, region/cell, command/search, notifications, help and
operator profile.

- The navigation is a horizontal strip of groups, not a left rail. The console's
  surfaces are wide tables, and `e2e/layout.spec.ts` measures every route at 320
  CSS pixels for WCAG 2.2 AA reflow (1.4.10); a rail costs that budget on every
  route permanently, while a strip wraps. The grouping the section asks for is
  delivered either way. If a rail is later justified, the group table moves and
  this paragraph is what gets deleted.
- The header carries the wordmark, the title, the preferences menu and an
  "Internal" marker. Environment, scope, region/cell, notifications, help and
  operator profile are not built. The command palette exists and is reachable
  from every route (Ctrl/Cmd-K).

## 7. What the navigation must keep agreeing with

Three guards, and they are the reason the table in `Nav.tsx` is data rather than
markup scattered through pages:

- `tests/architecture/shell-separation.test.mjs` reads every literal
  `href: "/…"` and `href="/…"` out of the console's layout and every component
  reachable from it, and requires each to be a route the console actually serves
  and not a tenant-application destination. Every entry in the table is one of
  the eight static routes the console serves.
- `apps/system-studio/e2e/layout.spec.ts` measures overlap, container spill,
  horizontal page scroll, text-wider-than-its-box and fixed-height clipping on
  every route at 1440, 1180, 900 and 320 pixels, and re-runs the overlap
  detector with `dir="rtl"`. The navigation's own CSS therefore uses logical
  properties only and never lets a group shrink below its own label.
- `apps/system-studio/e2e/cost.spec.ts` requires exactly one element inside
  `nav.tabs` to carry `aria-current="page"`. The current **group** is marked
  `aria-current="true"` — a location within the console rather than the page
  itself — so the section indicator does not join that count. The group also
  carries a visible accent rule under its name, because colour alone is not a
  carrier (`STUDIO-030-007`).

## 8. What this document did not do

- It did not change any `page.tsx`. The clutter inside `/platform` and the
  overlap between `/` and `/tenants` are real and are not addressed here.
- It did not delete a route, redirect one, or gate one.
- It did not mark anything in the execution ledger. This is an information
  architecture, not evidence that a requirement is met.
- It did not evaluate the four ungrouped surfaces that a developer would want
  next: a Changes inbox, a Releases surface, an Identity surface and Relay. They
  are listed in section 5 as absent, which is all this document is entitled to
  say about them.

## 9. Adding a route

1. Decide the Bible domain it serves, from section 7.2's list. If none, it goes
   behind Diagnostics and section 4 of this document says so in one sentence.
2. Add it to the table in `apps/system-studio/src/components/Nav.tsx`, in the
   Bible's order, before the Diagnostics entry.
3. Add the route to `ROUTES` in `apps/system-studio/e2e/layout.spec.ts` — a
   route that is not in that array is a route whose overlap, spill and
   horizontal overflow are never measured.
4. Add its row to section 3 and section 4 here, with the requirement it serves,
   or with the sentence that it serves none yet.
