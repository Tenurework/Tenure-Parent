# System Studio information architecture and route map

The Bible's required deliverable list (section 19, "Product and UX") names one:
"System Studio information architecture and route map". This is it. It decides
what the console's navigation is, where each of its routes sits in that
navigation, and — the part that carries the weight — which routes are finished
operator surfaces and which are not.

**Authorities, in precedence order.**

1. `Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`,
   section 7.2 "Global shell", which lists the navigation domains this console
   is for, and section 12, which lists the AWS service families it must expose.
2. `docs/implementation/system-studio-aws-control-plane-execution-ledger.md`,
   which records what has actually been built against those domains, with
   evidence.

Nothing here is a taste argument. Where this document had a choice to make it
says which clause made it, and where it had no clause it says that instead.

---

## 1. The problem this replaces

Eight equal tabs in one flat row — Tenants, Systems, Platform, Cost, Audit,
Estate, Health, Security — ordered by a claim about an operator's workflow
("find or create a tenant, inspect the systems that exist, then check the
platform underneath them"). Three properties of that row:

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
site, all messed up and confusing … put all these mess in one last tab".

## 2. The rule

> Every surface that is unfinished, diagnostic, or exists only to prove
> something to a developer sits behind the **last** group, named **Diagnostics**.
> Everything before Diagnostics is a finished, Bible-defined operator surface.

No route is deleted and no route stops being served. Moving it behind the last
group is the entire mechanism, and it is reversible in one row of the table in
`apps/system-studio/src/components/Nav.tsx` on the day the surface becomes an
operator surface.

The line is drawn in the rendering, not only in the ordering: the Diagnostics
group is pushed to the end of its row and separated by a rule
(`margin-inline-start: auto` and `border-inline-start`), because an ordering
nobody perceives as an ordering is not a signal. Measured at 1440 CSS pixels,
the tail group sits 244px clear of the group before it with a 1px rule between
them; at 320 it is still separated, on the last row.

The last group's **first** entry is `/platform/diagnostics`, the register of
what is behind the line and what is unfinished about each of them. A quarantine
that does not publish what it is holding is a drawer.

## 3. The groups

The group names are the Bible's, from section 7.2's left-navigation list, in
that list's order:

> Fleet, Implementations, Blueprints, Modules, Releases, Changes, AWS, Identity,
> Data, Relay, Integrations, Domains, Security, Operations, FinOps, Evidence,
> Marketplace.

A group holds a **list** of entries, not one. It held exactly one when this
document was first written, which made "group" and "entry" the same row in the
table; then three surfaces landed over three of the Bible's section 12 service
families, all of them the AWS domain. Flattening them back into peers of Fleet
and FinOps is precisely how the flat row was built the first time — one page at
a time, each addition defensible on its own.

Narrowed to the domains with a real surface today, the Bible's order gives:

| # | Group (Bible domain) | Entry | Route | The requirement it serves |
|---|---|---|---|---|
| 1 | **Fleet** | Tenants | `/tenants` | §14. Fleet view with lifecycle, cell/region, health, drift, cost and next action (`STUDIO-100-001`); search, saved filters and comparison (`STUDIO-100-002`). |
| 2 | **Blueprints** | Systems | `/` | §8. Every effective configuration value shown with its source layer and provenance (`STUDIO-040-003`), over the blueprint that produced it. Also answers **Modules** (the enabled module set per system) and **Integrations** (the connector/extension/model catalog with its refusals and setup references). |
| 3 | **AWS** | Estate | `/platform/estate` | §12. Cross-account actual-resource inventory (`STUDIO-080-001`), account topology (`STUDIO-010-002`), and a refused read rendered as unknown rather than as absent (`STUDIO-000-007`). |
| 3 | **AWS** | Network | `/platform/network` | §12 "Network and edge" — VPC, subnets, route tables, security groups, VPC endpoints, ALB/target-group health, TLS posture. `STUDIO-080-001` for the resource facts, `STUDIO-080-002` for the network-flow edges. |
| 3 | **AWS** | Compute | `/platform/compute` | §12 "Compute and orchestration" — ECS clusters and services, the task-definition revision each one actually runs, retained stopped tasks with their stop reason, ECR image posture joined by digest, Lambda runtime deprecation. `STUDIO-080-001`, `STUDIO-080-006`. |
| 3 | **AWS** | Messaging | `/platform/messaging` | §12 "Compute and orchestration" (SQS, SNS, EventBridge, Scheduler) plus SES deliverability. Queue depth, in-flight, redrive and dead-letter state, oldest-message age from CloudWatch, and disabled scheduled rules. `STUDIO-080-001`, `STUDIO-080-007`. |
| 4 | **Identity** | Identity | `/platform/identity` | §12 "Identity and secrets" — Cognito pools and MFA/password posture, IAM wildcards and key rotation, KMS key lifecycle, Secrets Manager rotation, Access Analyzer. §7.2 names **Identity** as a domain of its own, so it takes its own group. |
| 5 | **Data** | Data | `/platform/data` | §12 "Data and content" — DynamoDB (including the tenant registry's own recoverability), RDS and pending maintenance with forced apply dates, S3 public-exposure posture, ElastiCache encryption, AWS Backup vaults. §7.2 names **Data** as a domain of its own. |
| 6 | **Security** | Findings | `/platform/security` | §15. Aggregated findings with severity, SLA and per-source answered/unknown state (`STUDIO-110-006`). |
| 7 | **Operations** | Health | `/platform/health` | §12. Alarms with the verdicts CloudWatch does not return — disabled, stale, missing, unauthorized (`STUDIO-080-008`). |
| 8 | **FinOps** | Cost | `/platform/cost` | §16. Cost allocation with honest unallocated spend (`STUDIO-120-008`), cost display (`STUDIO-120-009`), and approval thresholds before a commitment (`STUDIO-120-010`). |
| 9 | **Evidence** | Audit | `/platform/audit` | §15. Tamper-evident audit with verification tooling and a retention plan (`STUDIO-110-005`). |
| — | **Diagnostics** | Diagnostics | `/platform/diagnostics` | **None.** It is the register of the line itself. See §6. |
| — | **Diagnostics** | Platform | `/platform` | **None.** See §6. |

Ten groups, thirteen destinations.

Entry labels are the page's own `<h1>`, not the domain's, for two reasons. The
domain is already printed above the entry, so repeating it wastes the one line
of hierarchy this navigation has. And four labels are load-bearing in tests
owned by other work: `e2e/cost.spec.ts` asserts the current entry reads exactly
`Cost` on `/platform/cost` and exactly `Platform` on `/platform`;
`e2e/platform.spec.ts` clicks a link named exactly `Systems` and a link named
`Platform`; `e2e/preferences.spec.ts` clicks a link named `Tenants`. Those four
were not changed.

Three labels do repeat their domain — **Identity**, **Data** and
**Diagnostics** — because in those three cases the page's own name *is* the
domain's name. Renaming the entry to avoid the repetition would mean the word an
operator sees in the navigation is not the word at the top of the page they
land on, which costs more than the repetition does.

### Why Network, Compute and Messaging are AWS and not their own groups

§7.2 names seventeen domains and none of them is Network, Compute or Messaging.
§12 does name them — "Network and edge", "Compute and orchestration" — but §12
is the list of *AWS service families the AWS domain must expose*, not a second
navigation. Inventing a group for each would put three names in the left
navigation that no authority uses, which is the taste argument this document
exists to avoid. They are entries under **AWS**.

Messaging is the one that had a plausible second home and does not get it.
§7.2's **Relay** is Relay by Tenure, the Bedrock-hosted customer copilot (§13);
it is not SQS, EventBridge or SES. Filing a queue-depth page under Relay would
mislead an operator about what Relay is, so it does not go there.

## 4. Where each of the eighteen routes falls

Eighteen `page.tsx` routes are served, enumerated from
`apps/system-studio/src/app/**/page.tsx` rather than from any list.

| Route | Side of the line | Navigation position |
|---|---|---|
| `/tenants` | Operator surface | Fleet |
| `/tenants/new` | Operator surface | Not a destination — reached from Fleet |
| `/tenants/[slug]` | Operator surface | Not a destination — reached from Fleet |
| `/tenants/[slug]/configuration` | Operator surface | Not a destination — reached from the tenant |
| `/` | Operator surface | Blueprints |
| `/platform/estate` | Operator surface | AWS |
| `/platform/network` | Operator surface | AWS |
| `/platform/compute` | Operator surface | AWS |
| `/platform/messaging` | Operator surface | AWS |
| `/platform/identity` | Operator surface | Identity |
| `/platform/data` | Operator surface | Data |
| `/platform/security` | Operator surface | Security |
| `/platform/health` | Operator surface | Operations |
| `/platform/cost` | Operator surface | FinOps |
| `/platform/audit` | Operator surface | Evidence |
| `/signin` | Pre-session chrome | Not a destination — the navigation does not render there |
| `/platform/diagnostics` | **Behind Diagnostics** | Diagnostics, last group, first entry |
| `/platform` | **Behind Diagnostics** | Diagnostics, last group |

The four "not a destination" rows are not commentary. They are declared in
`UNLINKED` in `apps/system-studio/src/app/platform/diagnostics/register.ts`,
each with its reason, they are rendered on `/platform/diagnostics` for an
operator to read, and `tests/architecture/shell-separation.test.mjs` fails the
build on a route that is in neither the navigation nor that table. See §8.

`register.ts` is a sibling module rather than the page itself for a reason worth
recording, because the first attempt put the tables in the page and it does not
build: the App Router rejects a route file that exports anything outside its
reserved set, and that constraint lives in the generated `.next/types/**` shim —
so `tsc --noEmit` passes on it and `next build` does not. It is not in
`Nav.tsx` either, which carries `"use client"`: a Server Component importing a
plain constant out of a client module receives a client reference rather than the
value. A sibling `.ts` is neither a route file nor a client module, and being a
`.ts` is also what keeps the JSX — the column definitions and the link cell — in
`page.tsx` where the rest of the markup is.

### The eleven in front of the line, each justified

**`/tenants` — Fleet.** `STUDIO-100-001` requires the fleet view to show tenant,
lifecycle, cell/account/region, release, health, cost, drift, blockers and next
action; `STUDIO-100-002` requires search, saved filters, comparison and export
under semantic authorization. The page renders all of it from the registry and
live observations, pages its table, and states what it is holding back. This is
the console's front door and the first group for the same reason the Bible lists
Fleet first.

**`/tenants/new` — Fleet's action, not a section.** It is the entry to the
§9 implementation journey (intake and identity, organization, module composer,
deployment placement) and it is finished for that scope. It is deliberately
**not** a navigation destination. `e2e/operator-roles.spec.ts` asserts that for
an Auditor the compose control is absent rather than disabled, and that
`href="/tenants/new"` does not appear in an Auditor's markup at all — a global
navigation entry renders for every role on every route and would put the string
there. §6's deny-by-default requirement (`STUDIO-020-006`, `STUDIO-020-007`) is
the reason that assertion exists, and a navigation that advertises a write an
operator does not hold is a frontend-only guard pointed the wrong way. It stays
the primary action on `/tenants`, where the page has the session and can decide.

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
account/region and the minimum IAM statement (`STUDIO-000-007`). §12's whole
point is that an operator understands the estate without receiving general AWS
mutation access, and this page is read-only.

**`/platform/network` — AWS.** §12 "Network and edge". Eight EC2 describes and
the ELBv2 listing, each degrading on its own. It answers one question — what can
reach this estate from the internet, and is traffic actually getting to the
services — and it is the only surface that reads what the security groups
*actually* are rather than what `infrastructure/terraform/security_groups.tf`
intended. Public-versus-private is decided by the route table and prints the
route table id beside the verdict, and every unhealthy target carries its reason
code verbatim. A finished surface.

**`/platform/compute` — AWS.** §12 "Compute and orchestration". ECS services
joined to the task definition revision each one runs, ECR joined by **digest**
rather than tag (both repositories are `MUTABLE`, so a re-pushed tag names one
thing while the running task is another), stopped tasks with `stoppedReason`,
and Lambda runtimes against a deprecation calendar. `stoppedReason` had no other
reader in the console: a crash-looping service and a slow one were
indistinguishable before this route existed.

**`/platform/messaging` — AWS.** §12's SQS/SNS/EventBridge, plus SES. Its
highest-value fact is the SES sandbox arm — a sandboxed account silently refuses
every unverified recipient, so a student never receives their reminder and
nothing in the application hears about it. Queue depth is joined to
`ApproximateAgeOfOldestMessage` from CloudWatch, because without the age a queue
being drained and a queue nothing has consumed since Tuesday are the same
number. Dead-letter state is derived from redrive policies rather than from
queue names.

**`/platform/identity` — Identity.** §12 "Identity and secrets", and §7.2's own
**Identity** domain. Built around one rule: an absence of findings from a
control that is not running is not a pass. Guards that are not protecting
anything get their own card *above* the findings, with the reason printed as a
word rather than as a colour, and the clear verdict is unreachable while any
guard sits in another arm.

**`/platform/data` — Data.** §12 "Data and content", and §7.2's own **Data**
domain. Five readers, and the one ranked first everywhere is DynamoDB, because
the tenant registry lives there and it is the only reader that can say whether
the fleet's own record of itself is recoverable. RDS is the only source of "is
anything about to interrupt it": a pending maintenance action with a
`ForcedApplyDate` is the one fact on the page with a date on which somebody else
acts.

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
`NOT_CONFIGURED` and the page renders that, naming what an operator must
connect. It deliberately has no third arm showing sample figures, because the
Bible's prohibited-shortcut list names "fake cost" and this is the page an
Aurora cluster gets approved from. A finished surface whose data source is
`BLOCKED_EXTERNAL` stays in front of the line; it is telling the operator
something true and actionable. Demoting it would hide a real gap behind a tab
named for unfinished work.

**`/platform/audit` — Evidence.** `verifyChain` and `applyRetention` existed as
code with no caller until this page called them; the verification now runs on
every page load over the rows read back out of DynamoDB and reports a break by
sequence position. The retention plan is a partition of the records and deletes
nothing. §3 is an evidence law and this is the surface that checks the evidence
is intact, which is why it takes **Evidence** rather than sitting under Security.

## 5. The five surfaces that landed after this document was first written

`/platform/network`, `/platform/compute`, `/platform/data`, `/platform/messaging`
and `/platform/identity` were built, tested, and reachable from nothing. They
were in no navigation, and no guard said a word: the only route check that
existed read one direction — every destination must be a route — which catches a
dead link and misses five live surfaces nobody can find. §8 is the guard that
now reads both directions, and the second direction exists because of these five.

Each is placed above by its Bible domain, in the Bible's order: three under
**AWS**, one under **Identity**, one under **Data**. None of them needed a new
group and none was invented for them.

## 6. The Diagnostics line, re-decided

`/platform` is the only pre-existing route behind the line, and it stays there.
It serves no operator requirement. Its own header says what it is — "Compiled
from the execution ledger, the execution prompt and the read-only AWS inventory
at commit `<sha>`" — and its own source comment says why it was built: twelve
commits of Phase 0 and Phase 1 work produced an inventory, an entry-point trace,
a contradictions list and a set of guards, and none of it was visible in the
product. That is a true and good reason to build a page. It is a reason addressed
to a developer.

What has changed is not the verdict but the **evidence for it**. Several of its
panels were behind the line because nothing better existed. Five surfaces later,
most of them are now a compiled duplicate of something that is read live:

| Panel on `/platform` | What it is | Now answered live by |
|---|---|---|
| What this page found | The engine's verdict on itself | — |
| This build, and the figures compiled into it | Build provenance | — |
| The identity this engine is running as | The account/region/partition/principal this process resolved | `/platform/estate`, `/platform/identity` |
| What this engine may read, and what it was refused | Refusals recorded in the **committed inventory** — what a past run was refused, not this render | `/platform/estate`, `/platform/identity` |
| Where the programme stands | Ledger checkbox count per phase. A build report | — |
| Open findings | Architecture-versus-inventory discrepancies. Documentation gaps, no severity, no tenant, no SLA | `/platform/security`, `/platform/identity` |
| AWS estate | A resource snapshot compiled at a commit | `/platform/estate`, `/platform/network`, `/platform/compute`, `/platform/data` |
| Queues with no producer and no consumer | Orphan detection over that snapshot | `/platform/messaging` |
| Alarms in this snapshot | The alarm list as the snapshot recorded it | `/platform/health` |
| Module adoption | A fragment of the **Modules** domain, which has no surface | — |
| Release compatibility | A fragment of the **Releases** domain, which has no surface | — |
| Execution ledger, item by item | A build report | — |
| Test suites | A build report | — |

Eight of the thirteen are now covered by a live surface. Five are build reports
or fragments of a domain that has no surface at all. Neither half is an operator
surface, so the route does not move — but the register above is published on
`/platform/diagnostics` so that the reason is legible rather than asserted, and
`tests/architecture/shell-separation.test.mjs` checks every row of it against
the panels the page actually renders.

**`/platform/diagnostics` is itself behind the line**, and it says so in its own
first row. It reads nothing about the estate and answers no operator question;
it is a fact about this console rather than about the platform it operates.

Nothing is deleted. The programme's visibility is worth keeping, the compiled
snapshot is the only record of some reads, and deleting a route to tidy a
navigation is how work becomes invisible again.

## 7. Bible domains with no surface

Naming these is part of the deliverable. A navigation that shows only what exists
tells an operator nothing about what does not.

| Bible domain | State today |
|---|---|
| Implementations | Partial and not a destination. `/tenants/new` and `/tenants/[slug]/configuration` are stage surfaces; the resumable multi-stage workspace with per-stage readiness and blockers (`STUDIO-050-001`, `STUDIO-050-002`) is not built. Its surfaces are reached from Fleet. |
| Modules | Answered per-system inside Blueprints (`/`). No standalone catalog surface; a fragment sits on `/platform`. |
| Releases | No surface. A compatibility fragment sits on `/platform`. |
| Changes | No surface. Lifecycle advances on `/tenants/[slug]` carry approval requirements, but there is no change-request queue, plan diff or approval inbox (§10). |
| Relay | No surface (§13). Not to be confused with `/platform/messaging`, which is SQS/SNS/EventBridge/SES. |
| Integrations | Answered inside Blueprints (`/`) as the catalog's availability decisions, refusals and setup references. |
| Domains | No surface. Route 53, ACM and CloudFront facts appear on `/platform/network` as edge posture; custom-domain *management* (§12 "Network and edge", `STUDIO-080-004`'s "Enable custom domain") does not exist. |
| Marketplace | Deliberately absent. `STUDIO-130-007` requires it to stay a nonfunctional "Coming soon" until certification, packaging, review, billing and revocation exist; `/` passes `marketplaceEnabled: false` explicitly. A navigation entry would be the opposite of that requirement. |

**Identity** and **Data** were on this list and are not any more. When one of the
rest gets a real surface, it takes its own group, in the Bible's position,
before Diagnostics.

## 8. What the navigation must keep agreeing with

Four guards, and they are the reason the table in `Nav.tsx` is data rather than
markup scattered through pages.

**`tests/architecture/shell-separation.test.mjs`**, which now reads both
directions:

- *Every destination is a route.* Every literal `href: "/…"` and `href="/…"` in
  the console's layout and every component reachable from it must be a route the
  console serves and not a tenant-application destination.
- *Every route is a destination.* Every route under
  `apps/system-studio/src/app/**/page.tsx` must be either a navigation entry or
  a row in `UNLINKED` on `/platform/diagnostics` carrying a reason of at least
  forty characters. A route in neither fails the build. It also refuses a stale
  row (a declared route the console does not serve, which would excuse the next
  route with the same path) and a contradictory one (a route both linked and
  declared unlinked).
- *The groups are the Bible's, in the Bible's order.* The guard parses section
  7.2's own left-navigation line out of the Bible and requires every non-tail
  group name to appear in it, in that list's relative order. Exactly one group
  carries `tail`, it is last, and its name is **not** one of the Bible's
  domains — the quarantine is named for what it holds.
- *The register is the quarantine.* The routes in `QUARANTINED` on
  `/platform/diagnostics` must be exactly the destinations in the tail group,
  and every "now answered by" claim must point at a route the console serves.
- *The register describes the real page.* Every headline in `PLATFORM_PANELS`
  must be a `<Card>` that exists on `/platform`, and every top-level card there
  (bar the "Not configured" refusal state, excluded by name) must be described.

Ten mutations were applied to prove those assertions can fail — a dropped nav
entry, a stale unlinked row, a route declared both ways, the quarantine moved
out of last place, a group renamed off the Bible's list, two groups swapped out
of order, a register row pointed at the wrong route, a panel renamed on
`/platform`, a supersession claim pointed at a route that does not exist, and
the table reader itself broken. All ten reddened; the tree was restored and the
suite returned to 13/13.

**`apps/system-studio/e2e/layout.spec.ts`** measures overlap, container spill,
horizontal page scroll, text-wider-than-its-box and fixed-height clipping on
every route at 1440, 1180, 900 and 320 pixels, and re-runs the overlap detector
with `dir="rtl"`. The navigation's own CSS therefore uses logical properties
only. **Its `ROUTES` array does not yet contain the six routes added since it
was written** — see §10.

**`apps/system-studio/e2e/cost.spec.ts`** requires exactly one element inside
`nav.tabs` to carry `aria-current="page"`. The current **group** is marked
`aria-current="true"` — a location within the console rather than the page
itself — so the section indicator does not join that count. This is now load
bearing rather than a corner: six routes sit under `/platform`, so on
`/platform/network` both `/platform` and `/platform/network` match the subtree
rule and only the longer one may light.

**`apps/system-studio/e2e/preferences.spec.ts`** asserts AA contrast and that no
colour is pure black or white.

## 9. The navigation, measured

The dev server cannot boot in this working tree (§10), so the geometry was put
to the layout engine directly: the console's real `globals.css`, the
navigation's real `NAV_CSS`, and markup generated by parsing the real `GROUPS`
table — nothing hand-copied, because a divergence would make the measurement
meaningless. Chromium, ten groups, thirteen destinations, current entry
`/platform/messaging`:

| Width | Nav height | Rows of groups | Text overlap | Page scrolls sideways | Text clipped |
|---|---|---|---|---|---|
| 1440 | 181px | 1 | 0 | no | none |
| 1180 | 181px | 1 | 0 | no | none |
| 900 | 276px | 2 | 0 | no | none |
| 320 | 397px | 4 | 0 | no | none |
| 320, `dir="rtl"` | 397px | 4 | 0 | no | none |
| 320, compact density | 383px | 4 | 0 | no | none |

320 is the hard case and it costs 397px of chrome — four wrapped rows of
groups. That is the honest price of thirteen destinations plus ten group labels
at that width; it wraps rather than scrolling, which is what WCAG 2.2 AA 1.4.10
asks for, and every link keeps a 32px block size in both densities. Exactly one
`aria-current="page"` and one `aria-current="true"` at every width.

Contrast of everything grouping added, computed in all four theme/contrast
combinations `preferences.spec.ts` exercises:

| | light | dark | light + more | dark + more |
|---|---|---|---|---|
| Group name, inactive (10.9px) | 7.27 | 10.75 | 12.14 | 16.49 |
| Group name, current | 15.84 | 15.25 | 15.84 | 15.25 |
| Current-group accent rule (2px) | 7.85 | 11.48 | 7.85 | 11.48 |

All above the 4.5 text floor and the 3.0 non-text floor. `NAV_CSS` contains no
colour literal at all — every value is an MD3 alias token (`--muted`, `--text`,
`--accent`, `--border`, `--space-*`), each resolving to a `--md-sys-*` role.

One correction, recorded because the first draft of this work claimed otherwise:
a `min-inline-size: auto` override was added to the navigation's link rule with
a written justification that the stylesheet's `min(9rem, 100%)` would otherwise
impose a 144px floor under every group at 320. Measured, it changes nothing —
making the group `flex-direction: column` moves the main axis, so the
stylesheet's `flex-basis` is a height the group has no free space to
distribute, and the percentage in `min(9rem, 100%)` resolves against a
shrink-to-fit containing block. The rule was removed and the comment now says
what was measured.

## 10. What this work did not do

- **It did not add the six new routes to `e2e/layout.spec.ts`'s `ROUTES`.**
  `/platform/network`, `/platform/compute`, `/platform/data`,
  `/platform/messaging`, `/platform/identity` and `/platform/diagnostics` are
  not in that array, so their overlap, spill and horizontal-overflow are never
  measured at any width. That file belongs to other work. Adding six strings to
  it is the whole fix.
- **It did not update the command palette.** `src/lib/commands.ts`
  `STATIC_DESTINATIONS` still offers four destinations — Tenants, Systems,
  Platform and Compose a tenant. Nine operator surfaces are unreachable from
  Ctrl/Cmd-K, including all five that landed most recently, and no guard covers
  it: `shell-separation.test.mjs` walks the layout's component graph, which does
  not reach `lib/`. The bidirectional route check in §8 is deliberately about
  the navigation, not the palette; extending it to the palette is the follow-up.
- **It did not verify the navigation in a running browser against the real
  application.** `@aws-sdk/client-ec2` is installed in this tree and its
  transitive dependency `@aws-sdk/middleware-sdk-ec2` is not, so every route
  that reaches `src/lib/aws/client.ts` returns 500 in `next dev` and the dev
  overlay aborts navigation to the ones that do not. `npm install` at the
  repository root is the unblock, and this session was forbidden to run it.
- It did not change any `page.tsx` other than adding `/platform/diagnostics`.
  The clutter inside `/platform` and the overlap between `/` and `/tenants` are
  real and are not addressed here.
- It did not delete a route, redirect one, or gate one.
- It did not mark anything in the execution ledger. This is an information
  architecture, not evidence that a requirement is met.

## 11. Deviations from the Bible's shell, stated

§7.2 describes a **left** navigation and a header carrying active environment,
scope, region/cell, command/search, notifications, help and operator profile.

- The navigation is a horizontal strip of groups, not a left rail. The console's
  surfaces are wide tables, and `e2e/layout.spec.ts` measures every route at 320
  CSS pixels for WCAG 2.2 AA reflow (1.4.10); a rail costs that budget on every
  route permanently, while a strip wraps. The grouping the section asks for is
  delivered either way. Thirteen destinations is, however, the point at which
  this trade stops being obviously right — §9's 397px is a real cost — and a
  rail should be reconsidered when the fourteenth lands. If one is adopted, the
  group table moves and this paragraph is what gets deleted.
- The header carries the wordmark, the title, the preferences menu and an
  "Internal" marker. Environment, scope, region/cell, notifications, help and
  operator profile are not built. The command palette exists and is reachable
  from every route (Ctrl/Cmd-K), with the gap named in §10.

## 12. Adding a route

1. Decide the Bible domain it serves, from §7.2's list. If §7.2 has no name for
   it but §12 does, it is an entry under **AWS**. If neither does, it goes behind
   Diagnostics and §6 of this document says so in one sentence.
2. Add it to `GROUPS` in `apps/system-studio/src/components/Nav.tsx`, inside its
   domain's group, with the group in the Bible's order and before the
   Diagnostics group. If it is not going to be a destination at all, add it to
   `UNLINKED` in `apps/system-studio/src/app/platform/diagnostics/register.ts`
   with the reason instead. Doing neither fails
   `tests/architecture/shell-separation.test.mjs`.
3. If it goes behind Diagnostics, add its row to `QUARANTINED` in that same
   module: what it is, what is unfinished about it, and which live surfaces now
   answer what it was answering.
4. Add the route to `ROUTES` in `apps/system-studio/e2e/layout.spec.ts` — a
   route that is not in that array is a route whose overlap, spill and
   horizontal overflow are never measured.
5. Add its rows to §3 and §4 here, with the requirement it serves, or with the
   sentence that it serves none yet.
