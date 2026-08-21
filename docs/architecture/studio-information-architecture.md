# System Studio information architecture and route map

The Bible's required-deliverable list (§19, "Product and UX") names one:
"System Studio information architecture and route map". This is it.

It decides three things and it is the only place any of them is decided:

1. **The shell** — what frames every route: a persistent full-height left
   navigation, a persistent top bar, and a content region that uses the
   viewport instead of a 1280px column in the middle of a 1920px monitor.
2. **The navigation tree** — the Bible's domains as groups, the routes inside
   them, and a second level of sub-items inside the routes that have real
   sub-surfaces.
3. **The route map** — every route the console serves, which side of the
   Diagnostics line it falls on, and how an operator reaches it.

**This document is a specification that build agents implement from.** Sections
1–2 record what exists today, measured. Sections 3–11 are normative: they say
what must be built. Section 12 says which lane owns which file, so three agents
can work at once without touching each other's files. Section 13 records the
deliberate deviations. Section 14 is what this document does not do.

**Authorities, in precedence order.**

1. `Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`
   — §7.1 (experience objectives), §7.2 (global shell), §12 (AWS service
   families), §19 (this deliverable), §20 (prohibited shortcuts).
2. The product owner's direct instruction, where it overrides a clause. Every
   such override is named in §13 with the clause it overrides.
3. `docs/implementation/system-studio-aws-control-plane-execution-ledger.md`,
   which records what has actually been built, with evidence.

Where this document is *choosing* rather than *following*, it says
**CHOICE** and gives the reason. A document that dresses taste as a citation is
worse than one that admits the taste.

---

## 1. What is wrong today, measured

Every line below was read out of the tree, not remembered.

**A note on citations.** This tree is being edited by several agents at once.
`apps/system-studio/src/app/globals.css` moved 56 lines during the writing of
this document, so every reference to it here is by **selector or symbol**, which
`grep` finds whatever the line number has become. Line numbers are given only
for files that were not under edit in this run (`Nav.tsx`, `layout.tsx`,
`e2e/layout.spec.ts`, `lib/*`, the `tests/architecture/*` guards) and are true
as of it.

| # | Defect | Where it lives |
|---|---|---|
| 1 | **The content is a centred column.** `main { inline-size: min(100%, 1280px); margin-inline: auto }`. On a 1920px operator monitor that is 320px of empty page on each side, permanently. `.masthead` and `.tabs` pad themselves to match with `padding-inline: max(var(--space-5), calc((100vw - 1280px) / 2 + var(--space-5)))`, so the whole console is pinned to that column. | `globals.css`, rules `main`, `.masthead`, `.tabs` |
| 2 | **The top bar holds four things.** A text `Tenure` wordmark, the words "System Studio", the preferences menu, an "Internal" badge. No sign-out, no account, no search, no breadcrumb, no environment or account indicator. | `src/app/layout.tsx:37-42` |
| 3 | **There is no way to sign out.** `signOut` is exported from `src/lib/auth.ts:49` and has **zero callers** anywhere under `src/`. An operator ends a session by clearing a cookie. | `grep -rn "signOut" apps/system-studio/src` → one hit, the export itself |
| 4 | **The navigation has one level.** `GROUPS` is 8 groups and 14 entries rendered as a horizontal wrapping strip. A group is a label above a list; there is nothing below an entry. | `src/components/Nav.tsx:87-209`; `grep -c '^        href: "' src/components/Nav.tsx` → 14, `grep -c '^    domain: "'` → 8 |
| 5 | **The command palette is invisible.** `components/CommandPalette.tsx` returns `null` until Ctrl/Cmd-K is pressed (`if (!open) return null`, line 149) and nothing on any screen mentions it. The string "Ctrl" appears once in the whole UI — inside a code comment. | `src/components/CommandPalette.tsx:149`, `:103` |
| 6 | **The mark is a word in a pill.** The masthead renders `<span className="mark">Tenure</span>` with a 10px square pseudo-element beside it. `components/brand/TenureLogo.tsx` has held the real rosette and a `TenureStudioWordmark` since before this run, and `grep -rn TenureLogo` returned hits in that file only — nothing rendered it. A design lane is landing `components/md3/Logo.tsx` over the same `PETAL` geometry while this is being written; §5 points the shell at it rather than at a third mark. | `grep -rn "TenureLogo"`; `git status --porcelain` |
| 7 | **18 routes are served, not 17.** `find src/app -name page.tsx` → 18. The 17 in `tests/architecture/authorizing-routes-are-dynamic.test.mjs`'s comment predates `/platform/diagnostics`. | `href-probe`, §11 |

Two claims in the previous revision of this document were wrong and are
corrected here rather than quietly dropped:

- It said "**Ten groups, thirteen destinations**". It is fourteen. Counted:
  `grep -c 'href: "' src/components/Nav.tsx` → 14.
- It said "**Entry labels are the page's own `<h1>`**". Three are not:
  `/` is labelled *Systems* and its `<h1>` is "Organization systems";
  `/platform/estate` is *Estate* / "AWS estate"; `/platform/security` is
  *Findings* / "Security posture". §5 decides what to do about that.

The operator's own words for the result: "very weak, cluttered, and isolated in
the centre of the screen with no logout, back and forth, global search and
interactions within this. Logo is still not put in there."

## 2. What the Bible asks for, and what we are allowed to take

§7.2, verbatim:

> - Left navigation: Fleet, Implementations, Blueprints, Modules, Releases,
>   Changes, AWS, Identity, Data, Relay, Integrations, Domains, Security,
>   Operations, FinOps, Evidence, Marketplace.
> - Header: active environment, global/tenant scope, region/cell,
>   command/search, notifications/incidents, help, operator profile.
> - Context rail or inspector: selected object identity, provenance,
>   dependencies, current vs desired state, health, cost, risks, change
>   history, and actions.
> - Command palette: navigation and safe draft creation only; high-risk action
>   still uses full review/approval flow.

§20 forbids, in these words: "Copy Monarch, Vercel, Perplexity, AWS Console,
SAP, Workday, or Jira trade dress."

**The line this document draws.** What those consoles get right is *structural*
and is not their property: a navigation that is always there and has more than
one level; a bar that never scrolls away; one keystroke to anything; an account
menu that can end the session; a trail that says where you are and is clickable
back. What is theirs is their *identity* — their palette, their type, their icon
set, their spacing rhythm, their chrome. We take the first and none of the
second. Every colour, radius, shadow and step in this shell comes from the
Studio's own `--md-sys-*` layer, documented in `docs/architecture/studio-design-system.md`.

## 3. The shell

### 3.1 The frame

Three regions, in this arrangement, on every route except `/signin`:

```
┌──────────────────────────────────────────────────────────────────────┐
│ TOP BAR   mark · env/account · search · account menu       (sticky)  │  56px
├───────────────┬──────────────────────────────────────────────────────┤
│               │ BREADCRUMB  Fleet › Tenants › seed-deployed          │
│  LEFT RAIL    ├──────────────────────────────────────────────────────┤
│  (sticky,     │                                                      │
│   own scroll) │ MAIN — fluid width, no centred column                │
│               │                                                      │
└───────────────┴──────────────────────────────────────────────────────┘
```

Normative properties:

- **The top bar is `position: sticky; inset-block-start: 0`** and stays for the
  life of the session. `.masthead` is already sticky; what changes is what it
  carries (§5).
- **The rail is `position: sticky`, not `position: fixed`.** Sticky participates
  in the grid, so nothing has to reserve a margin for it, and — the reason that
  decides it — `e2e/layout.spec.ts`'s overlap detector measures boxes in *page*
  coordinates (`x: r.x + window.scrollX`, `y: r.y + window.scrollY`, lines
  90-91). A fixed rail's rect stops corresponding to the page the moment
  anything scrolls. At scroll 0 the two are identical, so this costs nothing and
  removes a category of false positive nobody would enjoy diagnosing.
- **The rail scrolls itself**: `block-size: calc(100dvh - var(--topbar-block-size));
  overflow-y: auto`. `auto`, never `hidden` — `layout.spec.ts`'s "text is never
  clipped by a fixed height" test (line 293) fires on `overflow`/`overflow-y`
  computing to `hidden` with `scrollHeight > clientHeight` (line 308), and a
  rail of fourteen entries plus sub-items will exceed 100dvh at 900px.
- **`main` becomes fluid**: `inline-size: 100%`, `margin-inline` removed,
  `padding-inline: var(--space-6)`. The `calc((100vw - 1280px) / 2 …)` padding
  hacks in `.masthead` and `.tabs` go with it.
- **`dvh`, not `vh`**, and every direction logical (`inline-size`,
  `padding-inline`, `inset-inline-start`). `layout.spec.ts`'s "layout survives
  RTL" test (line 463) flips `dir="rtl"` on the live document and re-runs the
  whole overlap detector plus the sideways-scroll assertion; one `margin-left`
  reds it.

### 3.2 Reading measure — how full width does not become 1600px paragraphs

A 1600px-wide paragraph is its own defect. Removing the centred column without
answering this trades one bad layout for another. The answer has two parts and
neither of them re-centres the application:

**(a) Prose is capped where prose lives, not where the page lives.** A token
`--measure: 72ch`, applied to the elements that carry sentences — `p`, `li`,
`dd`, `.supporting-text`, `figcaption` — as `max-inline-size: var(--measure)`.
A table cell, a `<code>`, a chip, a data row and a `<th>` are **excluded**: they
are not prose and capping them re-introduces truncation. This mirrors the rule
already in `globals.css` (`grep -n "overflow-wrap: anywhere"`), which gives it to
`p, li, dt, dd, code, .slug, .chip, legend` and deliberately not to `span` or
`td` — a wide table must scroll, not collapse.

**(b) Width is spent on columns, not on stretch.** The card region becomes
`display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 34rem), 1fr));
gap: var(--space-5)`. At 1280 that is one column and nothing changes. At 1920
with the rail it is two, and at an ultrawide three. Pages carry between 3 and 14
top-level cards today (`/platform/page.tsx` 14, `/tenants/[slug]` 13,
`/platform/estate` 10) — measured by `grep -c "<Card"` per route — so the
columns have something to hold on every route.

**CHOICE.** `34rem` as the column floor, and `72ch` as the measure. Neither
number is in any authority. 34rem is roughly twice the `min-inline-size:
min(18rem, 100%)` the console's own `.md3-card-header` already reserves for the
headline before its `headerAside` wraps to a second line — i.e. the width at
which a card header still fits its two parts side by side; 72ch is the upper end
of the usual 45–75ch typographic
range, chosen at the wide end because this console's paragraphs are dense
technical sentences with ARNs in them. Both are tokens so a measurement can
change them in one place.

**What full width must not become.** A table is still a table: wide tables keep
their own `overflow-x: auto` container. `layout.spec.ts`'s spill check
(lines 268-288) only looks at elements whose `overflow-x` computes to `visible`,
which is exactly the licence a scrolling container has and a stretched
paragraph does not.

## 4. The navigation tree

### 4.1 Level one: the groups are the Bible's domains, in the Bible's order

Not a choice — §7.2, and `tests/architecture/shell-separation.test.mjs`
("the console's navigation groups are the Bible's domains, in the Bible's
order", lines 1089-1129) parses the Bible's own left-navigation line and fails
the build on a group named anything else, on a group out of order, on more or
fewer than one `tail` group, on the tail not being last, and on the tail being
named after one of the Bible's domains.

The eight groups and fourteen entries below are what ships today. Identity and
Data were top-level groups of their own until the shell was re-nested onto the
Google Admin console's shape; they are now the fifth and sixth surfaces of
**AWS**, which is where §12 puts them and where an operator looks for them.

| # | Group (Bible domain) | Entry | Route | The requirement it serves |
|---|---|---|---|---|
| 1 | **Fleet** | Tenants | `/tenants` | §14. Fleet view with lifecycle, cell/region, health, drift, cost and next action (`STUDIO-100-001`); search, saved filters and comparison (`STUDIO-100-002`). |
| 2 | **Blueprints** | Systems | `/` | §8. Every effective configuration value with its source layer and provenance (`STUDIO-040-003`). Also answers **Modules** and **Integrations** — see §4.3. |
| 3 | **AWS** | Estate | `/platform/estate` | §12. Cross-account actual-resource inventory (`STUDIO-080-001`), account topology (`STUDIO-010-002`), refused reads rendered as unknown (`STUDIO-000-007`). |
| 3 | **AWS** | Network | `/platform/network` | §12 "Network and edge". `STUDIO-080-001`, `STUDIO-080-002`. |
| 3 | **AWS** | Compute | `/platform/compute` | §12 "Compute and orchestration". `STUDIO-080-001`, `STUDIO-080-006`. |
| 3 | **AWS** | Messaging | `/platform/messaging` | §12 "Compute and orchestration" (SQS/SNS/EventBridge/Scheduler) plus SES deliverability. `STUDIO-080-001`, `STUDIO-080-007`. |
| 3 | **AWS** | Identity | `/platform/identity` | §12 "Identity and secrets". §7.2 names **Identity** as a domain of its own; it is rendered inside AWS because a group holding one entry is a heading with nothing under it, and eight of ten groups were that. |
| 3 | **AWS** | Data | `/platform/data` | §12 "Data and content". §7.2 names **Data** as a domain of its own; rendered inside AWS for the same reason. |
| 6 | **Security** | Findings | `/platform/security` | §15. Aggregated findings with severity, SLA and per-source answered/unknown state (`STUDIO-110-006`). |
| 7 | **Operations** | Health | `/platform/health` | §12. Alarms with the verdicts CloudWatch does not return (`STUDIO-080-008`). |
| 8 | **FinOps** | Cost | `/platform/cost` | §16. Cost allocation with honest unallocated spend (`STUDIO-120-008`), display (`-009`), approval thresholds (`-010`). |
| 9 | **Evidence** | Audit | `/platform/audit` | §15. Tamper-evident audit with verification tooling and a retention plan (`STUDIO-110-005`). |
| — | **Diagnostics** (tail) | Diagnostics | `/platform/diagnostics` | **None.** The register of what is behind the line. §8. |
| — | **Diagnostics** (tail) | Platform | `/platform` | **None.** §8. |

Eight groups, **fourteen** destinations.

Why Network, Compute and Messaging are AWS entries rather than groups: §7.2
names seventeen domains and none of them is Network, Compute or Messaging. §12
names them, but §12 is the list of *AWS service families the AWS domain must
expose*, not a second navigation. Messaging had one plausible second home and
does not get it: §7.2's **Relay** is Relay by Tenure, the Bedrock-hosted
customer copilot (§13), not SQS or SES.

### 4.2 Level two: sub-items, and which routes get them

The operator asked for "menued, sub-menued, dropdowns … across and within and
within". Level two is **sub-items inside an entry**, rendered under the current
entry in the rail and reachable as anchors.

**The rule for who gets them.** A route gets sub-items when both hold:

1. It renders **four or more top-level surfaces** that are separately readable —
   different AWS readers, different questions, different failure arms; and
2. an operator arrives at it **wanting one of them specifically**, often enough
   that scrolling past three others is a cost.

Measured card counts (`grep -c "<Card"`, which over-counts because empty-state
cards are included, so the build agent trims to the page's real top-level
sections): `/platform/page.tsx` 14, `/tenants/[slug]` 13, `/platform/estate` 10,
`/platform/audit` 9, `/platform/identity` 8, `/platform/network` 8, `/` 7,
`/platform/data` 7, `/platform/compute` 6, `/platform/health` 6,
`/platform/messaging` 6, `/platform/security` 5, `/platform/cost` 3,
`/tenants` 3, `/platform/diagnostics` 3, `/tenants/new` 0.

| Entry | Sub-items | Why, or why not |
|---|---|---|
| **Tenants** `/tenants` | none static; a **contextual sub-tree** when inside a tenant (§4.4) | One table answering one question. Its second level is per-tenant and is therefore contextual, not static. |
| **Systems** `/` | Systems · **Modules** · **Integrations** | The one place sub-items pay twice: §7.2's **Modules** and **Integrations** domains have no route and are answered inside this page (module set per system; catalog availability, refusals, credential references). Today an operator reading the navigation cannot learn that. A sub-item makes a Bible domain visible without inventing a group the guard would refuse. |
| **Estate** `/platform/estate` | This account · Inventory · Declared vs actual · Reconcile | Ten cards, four distinct questions, and "which account am I in" is the one people arrive for. |
| **Network** `/platform/network` | Exposure · Load balancing · VPC and subnets · Security groups · Edge and TLS | Eight cards over five EC2/ELBv2 readers that degrade independently. |
| **Compute** `/platform/compute` | Services · Stops · Images · Lambda runtimes | "Why did it stop" is a distinct arrival from "what is running". |
| **Messaging** `/platform/messaging` | Queues · Dead letters · Schedules · Email | SES sits under the same route as SQS and is a different job. |
| **Identity** `/platform/identity` | Operators and pools · IAM · Keys · Secrets · Analyzer | Eight cards, five services. |
| **Data** `/platform/data` | DynamoDB · RDS · S3 · Cache · Backups | Five readers; DynamoDB is ranked first everywhere because the tenant registry lives there. |
| **Findings** `/platform/security` | Findings · Sources · SLA | Five cards; the sources table is what makes an empty findings list mean anything. |
| **Health** `/platform/health` | Alarms · Coverage | Six cards, two questions. |
| **Cost** `/platform/cost` | **none** | Three cards and one question, whose honest answer today is `NOT_CONFIGURED`. Sub-items on a page with one section is furniture. |
| **Audit** `/platform/audit` | Chain · Retention · Records | Nine cards; verification and retention are separate operator jobs. |
| **Diagnostics**, **Platform** | **none, deliberately** | §8. Unfinished work does not get an expanded tree — an expanded tree reads as a finished area. |

**Labels are provisional and the page wins.** The labels above are short
operator words. The build agent maps each to the page's real top-level card,
and where the page's own wording is clearer, **the page's wording wins and this
table is edited** — the labels must be the words on the page, or a sub-item
becomes a promise the destination does not keep.

**How a sub-item is addressed, and the trap in it.** A sub-item is
`{ label, anchor }` where `anchor` is the `id` of a top-level `<Card>`
(`Card` already accepts `id`, `src/components/md3/Card.tsx:49`). The href is
**composed at render** — `` href={`${entry.href}#${sub.anchor}`} `` — and never
written as a literal.

That is not a style preference. `shell-separation.test.mjs`'s `HREF_LITERAL`
(line 492) reads every `href="/…"` and `href: "/…"` in the layout and every
shell component, and requires each to be a route the console serves. Measured
with the guard's own reader, read-only:

```
WOULD RED THE GUARD  href="/platform/network#security-groups"   (sub-item as a literal)
PASSES               href: "/platform/network"                  (the entry itself)
INVISIBLE to guard   href={`${entry.href}#${sub.anchor}`}        (composed from data)
```

So the fragment must be composed, and because a composed href is invisible to
that guard, the anchors need their own check — §10 specifies it: every declared
`anchor` must appear as an `id="…"` in that route's `page.tsx`, or the build
fails. Without it the sub-item table is prose, and prose is wrong within a month.

### 4.3 Bible domains with no surface

Naming these is part of the deliverable. A navigation that shows only what
exists tells an operator nothing about what does not.

| Bible domain | State today |
|---|---|
| Implementations | Partial, not a destination. `/tenants/new` and `/tenants/[slug]/configuration` are stage surfaces; the resumable multi-stage workspace with per-stage readiness (`STUDIO-050-001/002`) is not built. Reached from Fleet. |
| Modules | Answered per-system inside Blueprints (`/`), and now **visible** as a sub-item there (§4.2). No standalone catalog. |
| Releases | No surface. A compatibility fragment sits on `/platform`. |
| Changes | No surface. Lifecycle advances on `/tenants/[slug]` carry approval requirements; there is no change-request queue, plan diff or approval inbox (§10 of the Bible). |
| Relay | No surface (§13). Not `/platform/messaging`, which is SQS/SNS/EventBridge/SES. |
| Integrations | Answered inside Blueprints (`/`), now visible as a sub-item. |
| Domains | No surface. Route 53/ACM/CloudFront facts appear on `/platform/network` as edge posture; custom-domain *management* (`STUDIO-080-004`) does not exist. |
| Marketplace | Deliberately absent. `STUDIO-130-007` requires it to stay a nonfunctional "Coming soon" until certification, packaging, review, billing and revocation exist; `/` passes `marketplaceEnabled: false` explicitly. A navigation entry would be the opposite of that requirement. |

When one of these gets a real surface it takes its own group, in the Bible's
position, before Diagnostics.

### 4.4 The contextual sub-tree, inside a tenant

§7.2's third bullet asks for a "context rail or inspector … selected object
identity, provenance, dependencies, current vs desired state, health, cost,
risks, change history, and actions". That is a large deliverable and it is not
this one. What this document commits to is the navigational half of it:

When the path is under `/tenants/<slug>`, the **Fleet** group renders a
contextual sub-tree beneath *Tenants*:

```
FLEET
  Tenants                     ← still the entry, still linked
    seed-deployed             ← the slug, from the path
      Overview                /tenants/seed-deployed
      Configuration           /tenants/seed-deployed/configuration
```

Derived from `usePathname()`, not from a table: the slug is a value, and a
table of tenants in the navigation would be a second fleet list that goes stale.
Two dynamic routes exist under a tenant today, so the sub-tree has exactly two
leaves; it grows when a third route lands.

**The tenant is named by its slug, not its display name.** The rail is a client
component with no session and no registry read, and adding a `getTenant(slug)`
call to the shell would put a DynamoDB read on every navigation. The slug is
also what the fleet table itself links by — `e2e/fleet-surface.spec.ts:62`
matches `getByRole("link", { name: "seed-deployed" })` — so an operator sees the
same identifier in the table, the rail, the breadcrumb and the URL. The display
name is on the page, in the `<h1>` (`tenants/[slug]/page.tsx:660`).

## 5. The top bar

Left to right (in `dir=ltr`; all logical properties, so it mirrors):

| Slot | Content | When it is unknown |
|---|---|---|
| **Mark** | The rosette plus the wordmark, from the console's **one** mark component — `components/md3/Logo.tsx` (`Logo`, landing from the design lane during this run, over the same `PETAL` geometry) or, if that lands differently, `TenureStudioWordmark` in `components/brand/TenureLogo.tsx`. **The shell lane must not author a third mark**: `tests/architecture/brand-mark-is-one-mark.test.mjs` exists precisely because the tenant app carries the same geometry, and a third copy is a third thing to drift. It links to `/`, a served route, so the shell guard passes. | n/a |
| **Environment** | The value of `DEPLOY_ENVIRONMENT`, read directly from `process.env`. | **`environment unknown`**, in the same type as a value, never blank. |
| **Account · region** | `resolveIdentity()` (`src/lib/aws/identity.ts:76`) → `accountId`, `region`, and the partition when it is not `aws`. Process-cached for `IDENTITY_REFRESH_MS` = 15 minutes (`lib/aws/capabilities.ts:40`), so this is not an STS call per navigation. | The `DENIED` / `THROTTLED` / `ERROR` arms render **`account unknown`** with the capability name in the title, matching what `/platform/estate` already does. Never a default account id. |
| **Global search** | A **button**, not an input: `Search  ⌘K` / `Ctrl K`, which opens the existing `CommandPalette`. Focus moves into the palette's own input. | n/a |
| **Account menu** | A disclosure holding: the signed-in email; the operator role from `roleOf(email)`; the preferences controls that live in `PreferencesMenu` today; and **Sign out**. | Signed-out state does not occur — the shell does not render on `/signin`. If `auth()` returns no session on a shell route, the account menu shows **`no session`** and only the sign-out control, because a shell that cannot name its operator must not imply one. |

Five properties of that table are load-bearing:

**The environment chip must not read `fleet()`.** `lib/cells.ts:122` is
`env("DEPLOY_ENVIRONMENT", "production")` — an unset variable becomes the string
`production`. A chip that prints "production" because nobody set a variable is
the single most dangerous string this console could show, and it is the same
defect `estateFact()` in that very file refuses to commit for region, account
and partition ("A default here would place tenants in an estate nobody chose").
So the chip reads `process.env.DEPLOY_ENVIRONMENT` itself and prints
`environment unknown` when it is empty. §20: "Report access denied as absent" is
the prohibited shape; so is reporting an unset variable as a fact.

**Sign-out is a form, never a link.** `href="/api/auth/signout"` and
`href="/signout"` both **red `shell-separation.test.mjs`** — measured with the
guard's own reader; neither is a page route the console serves. The correct
shape is a `<form>` with a server action calling the `signOut` from
`src/lib/auth.ts:49`, which today has no caller at all. A POST is also the
right thing on its own merits: a GET that ends a session can be triggered by a
prefetch or an image.

**Search must not put destinations in the markup.** `e2e/operator-roles.spec.ts:79`
asserts that an auditor's page markup does **not contain** `href="/tenants/new"`
— on `/tenants`, over `page.content()`, which includes the shell. The palette
survives that today only because it renders `null` when closed and its rows are
buttons, not links. Therefore: **the top bar's search control is a button**, the
palette stays closed-by-default, and no shell surface may render a create
destination as an `href` literal. `href="/tenants/new"` passes the
shell-separation guard (it *is* a served route) and reds the roles guard — two
guards pointing opposite ways, and only one of them is about security.

**The palette's destinations must be filtered by role.** `Launcher` is a server
component (`src/components/Launcher.tsx`) that already has the session available
and today hands the palette `STATIC_DESTINATIONS` unfiltered — including
"Compose a tenant" for an auditor, who is then refused by the page. The page
refusing is the security property and it works (`operator-roles.spec.ts:87`).
Offering it anyway is a navigation that advertises a write the operator does not
hold, which §6 of the Bible (`STUDIO-020-006/007`, deny by default) is written
against. Filter in `Launcher`, server-side, on `roleOf`.

**No notifications bell and no help icon, yet.** §7.2 lists both. Neither has a
source of truth in this console: there is no incident feed and no help corpus. A
bell that never lights teaches operators to ignore bells, and §20 forbids
placeholders that make a surface look complete. **CHOICE, and a deferral, not a
refusal**: they are added when `/platform/health` and the change queue can feed
them. This paragraph is the record that the clause was read and consciously not
met.

## 6. Breadcrumbs

**The model.** A crumb per path segment, built from `usePathname()` plus one
label resolver. Every crumb except the last is a link. The last carries
`aria-current="page"`.

**Where they render.** In the content region, immediately above the page's
`<h1>`, inside `<nav aria-label="Breadcrumb">` — **not in the top bar and not
inside `nav.tabs`**. Two reasons, both mechanical:

- `e2e/cost.spec.ts:87` asserts `nav.tabs [aria-current="page"]` has count
  **exactly 1** and text exactly `Cost`. A breadcrumb inside that nav adds a
  second `aria-current="page"` and reds it. Outside, both are correct
  simultaneously: the rail marks the current section, the trail marks the
  current page.
- A trail in a sticky bar competes with the page title for the same line at 900
  and 320px. Above the `<h1>` it wraps into the content flow like any other text.

**Labels.** Static segments use the navigation's own entry label, so the word in
the rail and the word in the trail are one word. The root crumb is the group's
domain name and links to the group's first entry.

**A dynamic route: `/tenants/seed-deployed/configuration`.**

```
Fleet  ›  Tenants  ›  seed-deployed  ›  Configuration
 │         │            │                 └ aria-current="page", not a link
 │         │            └ /tenants/seed-deployed
 │         └ /tenants
 └ /tenants   (the domain crumb resolves to its group's first entry)
```

`seed-deployed` is the slug, for the reason in §4.4. `Configuration` is the
segment name title-cased through an explicit map — not a generic
`capitalize(segment)`, which would render `New` for `/tenants/new` where the
page says "Compose a tenant".

**"Back and forth", explicitly.** The operator named it. Three mechanisms, and
they are different things:

1. **Up** — every ancestor crumb is a link. Reaching the fleet from a tenant's
   configuration is one click, not the browser's Back pressed twice.
2. **Back** — at 320px the trail collapses to a single `‹ Tenants` link (the
   *parent*, not `history.back()`, which after a redirect goes somewhere the
   operator did not come from).
3. **Return** — the palette's recents already exist and are already ranked
   (`lib/commands.ts:97-124`, recents first when the query is empty). Surfacing
   the palette (§5) is what makes them reachable.

## 7. Collapse behaviour at the four widths `layout.spec.ts` measures

`e2e/layout.spec.ts` runs every listed route at **1440, 1180, 900 and 320**
(line 66) and asserts: no text overlaps other text, no element's text is wider
than its box, nothing is clipped by a fixed height, the page never scrolls
sideways, and the whole overlap pass again under `dir="rtl"`. Playwright's own
default viewport is **1280** (`devices["Desktop Chrome"]`), which is the width
every *other* spec runs at — so 1280 is a fifth width with contracts on it.

| Width | Rail | Top bar | Breadcrumb |
|---|---|---|---|
| **1440+** | Expanded, `inline-size: 17rem`. Group labels, entry labels, and the **current entry's** sub-items expanded; other entries' sub-items collapsed. | One row: mark, environment/account, search, account menu. | Full trail. |
| **1280** (default viewport) | Same as 1440. **Entry labels must be text at this width** — `cost.spec.ts` asserts the current entry's text is exactly `Cost`, and `platform.spec.ts:78,85` and `preferences.spec.ts:159` click links named `Platform`, `Systems` and `Tenants`. An icon-only rail here breaks four specs. | One row. | Full trail. |
| **1180** | Expanded, `inline-size: 15rem`. | One row; the environment/account chip drops the partition when it is `aws`. | Full trail. |
| **900** | **Off-canvas.** The rail leaves the flow; a `Sections` disclosure button in the top bar opens it as an overlay. Content takes the full width. | One row: mark, sections button, search (icon + accessible name), account menu. | Full trail, wrapping. |
| **320** | Off-canvas. | Two rows: (mark, sections, account) / (search, environment). | Collapses to `‹ Parent`. |

**The closed off-canvas rail must be `display: none` or unmounted.** Not
`transform: translateX(-100%)`, not `visibility: visible` with a negative
offset. `layout.spec.ts`'s `textBoxes()` skips elements whose computed style is
`display:none`, `visibility:hidden` or `opacity:"0"` (line 84) and measures
everything else *in page coordinates* — so a translated-off-screen rail is
measured, its fourteen labels sit on top of the content's boxes, and the overlap
detector reds. Under `dir="rtl"` the same translation lands on the positive side
and reds the sideways-scroll assertion as well.

**Every route must be in `ROUTES`.** That array (line 41-54) lists nine routes.
Six served routes are missing: `/platform/network`, `/platform/compute`,
`/platform/data`, `/platform/messaging`, `/platform/identity`,
`/platform/diagnostics`. A shell change is measured on nine routes and shipped
on eighteen unless they are added. Adding six strings is the whole fix, and it
belongs to the lane that owns `e2e/` (§12).

## 8. What does not change

- **The Diagnostics group stays last, and keeps everything unfinished behind
  it.** `/platform/diagnostics` and `/platform` stay there, with `tail: true`,
  after every operator group. The rule is unchanged: *everything before
  Diagnostics is a finished, Bible-defined operator surface; everything
  unfinished, diagnostic, or built to prove something to a developer sits behind
  the last group.* Four guards in `shell-separation.test.mjs` hold it (§10).
- **The rule is drawn, not implied.** In the strip it was `margin-inline-start:
  auto` plus a `border-inline-start`. In the rail it becomes a top margin plus a
  `border-block-start` above the group, and it is still drawn **from `tail`**,
  from data, so the line cannot drift from the table.
- **The register keeps publishing what the quarantine holds.**
  `/platform/diagnostics` is the first entry of the last group and lists, per
  route, what it is, what is unfinished about it, and which live surface now
  answers what it used to. It is itself behind the line and says so.
- **The four entry labels with test contracts**: `Tenants`, `Systems`,
  `Platform`, `Cost`. Do not rename them in this work.
- **`nav.tabs` keeps its `tabs` class.** The class is now a poor name for a
  vertical rail. It is retained as a **test contract anchor**
  (`cost.spec.ts:87,92`), and the new CSS hangs off an added `console-nav`
  class. Renaming it means editing a passing spec for cosmetic reasons, which is
  not a trade this work should make; the compensating cost is one comment in
  `Nav.tsx` saying why the class is called that.
- **`aria-current="page"` goes on the entry's own label element**, with
  sub-items, counts and badges as **siblings**, never descendants. `cost.spec`
  asserts `toHaveText("Cost")` on that element; a count inside it makes the text
  `Cost 3`.
- **Nothing is deleted, redirected or gated.** No route stops being served.

## 9. The route map — all 18 routes

Enumerated from `apps/system-studio/src/app/**/page.tsx`, not from a list:
`find src/app -name page.tsx | wc -l` → **18**.

| Route | Side of the line | Position in the shell | Sub-items |
|---|---|---|---|
| `/` | Operator surface | Blueprints › Systems | Systems · Modules · Integrations |
| `/tenants` | Operator surface | Fleet › Tenants | contextual (§4.4) |
| `/tenants/new` | Operator surface | **Not a destination** — the primary action on `/tenants`, role-gated there | — |
| `/tenants/[slug]` | Operator surface | **Not a destination** — reached from the fleet table; Fleet stays lit | contextual leaf |
| `/tenants/[slug]/configuration` | Operator surface | **Not a destination** — reached from the tenant | contextual leaf |
| `/platform/estate` | Operator surface | AWS › Estate | 4 |
| `/platform/network` | Operator surface | AWS › Network | 5 |
| `/platform/compute` | Operator surface | AWS › Compute | 4 |
| `/platform/messaging` | Operator surface | AWS › Messaging | 4 |
| `/platform/identity` | Operator surface | AWS › Identity | 5 |
| `/platform/data` | Operator surface | AWS › Data | 5 |
| `/platform/security` | Operator surface | Security › Findings | 3 |
| `/platform/health` | Operator surface | Operations › Health | 2 |
| `/platform/cost` | Operator surface | FinOps › Cost | none, deliberately |
| `/platform/audit` | Operator surface | Evidence › Audit | 3 |
| `/platform/diagnostics` | **Behind Diagnostics** | Diagnostics, first entry | none |
| `/platform` | **Behind Diagnostics** | Diagnostics | none |
| `/signin` | Pre-session | **No shell at all** — §9.1 | — |

The four "not a destination" rows are declared in `UNLINKED` in
`src/app/platform/diagnostics/register.ts`, each with a reason of at least forty
characters, rendered on `/platform/diagnostics`, and enforced in both directions
by `shell-separation.test.mjs` (a route in neither the navigation nor that table
fails the build; a declared route the console does not serve also fails).

`/tenants/new` stays out of the navigation on purpose, and the reason is a
security assertion rather than a preference: `operator-roles.spec.ts:79` requires
`href="/tenants/new"` to be absent from an auditor's *markup*, and a global
navigation entry renders on every route for every role.

### 9.1 The sign-in page

`/signin` renders **no rail, no top bar chrome, no breadcrumb** — there are no
sections to navigate between and no session to name. What it does render:

- the `TenureStudioWordmark` (the same mark, the only piece of chrome shared
  with the shell), and
- the environment chip, with the same unknown arm as §5 — an operator about to
  sign in should know which estate they are signing in to.

It keeps `export const dynamic = "force-dynamic"` (`signin/page.tsx:9`) and its
single failure message for every way sign-in can fail; distinguishing "not an
operator" from "wrong secret" turns the page into an oracle for which Tenure
staff exist. The visual work on this page belongs to the design lane (§12); its
*information architecture* is this paragraph, and it is deliberately almost
nothing.

## 10. The guards this shell must satisfy, and the one it must add

Existing, and green today — `node --test tests/architecture/shell-separation.test.mjs`
→ **13 pass, 0 fail**:

| Guard | What it will refuse |
|---|---|
| `shell-separation.test.mjs` — *every destination is a route* | Any `href="/…"` or `href: "/…"` literal in `layout.tsx` or any component reachable from it that is not a served route. **Measured**: `/api/auth/signout`, `/signout`, `/search` and `/platform/network#security-groups` all red it. |
| — *every route is a destination* | A new route that is neither a nav entry nor a declared `UNLINKED` row with a ≥40-character reason. |
| — *groups are the Bible's, in the Bible's order* | A renamed group, a reordered group, a second `tail`, a tail that is not last, a tail named after a Bible domain. |
| — *the register is the quarantine* | The Diagnostics group and `QUARANTINED` disagreeing. |
| — *the register describes the real page* | A `/platform` card renamed without its register row. |
| `authorizing-routes-are-dynamic.test.mjs` | A `page.tsx` calling `auth()` / `isOperator` / `authorizeCommand` / `operatorConfigProblems` without `export const dynamic = "force-dynamic"`. |
| `cost.spec.ts:87-93` | More or fewer than one `aria-current="page"` inside `nav.tabs`; current-entry text that is not exactly `Cost` / `Platform`. |
| `platform.spec.ts:78,85`, `preferences.spec.ts:159` | Renaming `Platform`, `Systems`, `Tenants`. |
| `operator-roles.spec.ts:79` | `href="/tenants/new"` anywhere in an auditor's markup, shell included. |
| `layout.spec.ts` | Overlap, spill, clipping, sideways scroll, at four widths, LTR and RTL. |

**Two guards this shell needs and does not have.** Both are specified here and
built by the lane that owns `tests/architecture/` (§12):

**(a) Declared sub-item anchors must exist.** For every `{ label, anchor }` in
the navigation table, `id="<anchor>"` must appear in that entry's `page.tsx`.
Direction matters and one direction is enough here: an anchor with no `id` is a
sub-item that scrolls nowhere, while an `id` with no sub-item is just a card.
The floor: the reader must parse at least fifteen sub-items across at least
eight entries, or a reader that has stopped reading reports a clean navigation.
This is the check that keeps §4.2 honest, because the composed href form the
guard cannot see is exactly what makes it necessary.

**(b) A layout that decides a permission must be dynamic.**
`authorizing-routes-are-dynamic.test.mjs` filters `routeFiles()` on
`/\/page\.tsx$/` (line 69). The shell puts `auth()` in `layout.tsx` for the
first time — a file that guard does not look at. Next would be free to
prerender the layout at build time, in a container with no operator
environment, and serve every visitor an account menu rendered from a build-time
session. That is the identical defect the guard exists for, one file to the
left. **The fix is one character in a regex** (`/\/(page|layout)\.tsx$/`) plus
`export const dynamic = "force-dynamic"` in the root layout, and it must land in
the same change as the account menu, not after it.

## 11. Verification performed for this document

| Claim | Command | Result |
|---|---|---|
| The navigation and the routes still agree | `node --test tests/architecture/shell-separation.test.mjs` | 13 pass, 0 fail |
| 18 routes are served | `find apps/system-studio/src/app -name page.tsx \| wc -l` | 18 |
| 8 groups, 14 entries | `grep -c '^    domain: "' src/components/Nav.tsx`; `grep -c '^        href: "' src/components/Nav.tsx` | 8; 14 |
| 6 register rows | `grep -c 'route: "' src/app/platform/diagnostics/register.ts` | 6 (2 quarantined, 4 unlinked) |
| `signOut` has no caller | `grep -rn "signOut" apps/system-studio/src` | 1 hit — the export in `lib/auth.ts` |
| The logo is unused | `grep -rn "TenureLogo" apps/system-studio/src apps/system-studio/e2e` | 3 hits, all inside `TenureLogo.tsx` |
| `.brand-wordmark` is unstyled | `grep -n "brand-wordmark" src/app/globals.css` | 0 |
| Which shell hrefs the guard refuses | read-only probe replicating `routesOf()` + `HREF_LITERAL` | table in §4.2 and §5 |
| Card counts per route | `grep -c "<Card"` per `page.tsx` | table in §4.2 |

The href probe is a **prediction using the guard's own two readers**, run
read-only against the working tree; it is not a mutation of the tree, because
every file it concerns belongs to another agent in this run. The prediction is
falsifiable the moment a build agent writes one of those literals: the guard
either reds or this document is wrong.

## 12. Implementation lanes — disjoint files

Three agents can build this at once only if no two touch the same file.

| Lane | Owns, exclusively | Builds |
|---|---|---|
| **A — shell frame** | `src/app/layout.tsx`, `src/components/TopBar.tsx` (new), `src/components/AccountMenu.tsx` (new), `src/components/EnvironmentChip.tsx` (new), `src/app/actions/session.ts` (new) | §3.1 frame, §5 top bar, sign-out server action, the root layout's `force-dynamic` |
| **B — navigation** | `src/components/Nav.tsx`, `src/components/Breadcrumbs.tsx` (new), `src/components/Launcher.tsx`, `src/lib/commands.ts` | §4 tree and sub-items, §4.4 contextual sub-tree, §6 breadcrumbs, role-filtered palette destinations, the visible search affordance's data |
| **C — proof** | `e2e/layout.spec.ts`, `tests/architecture/shell-separation.test.mjs`, `tests/architecture/authorizing-routes-are-dynamic.test.mjs` | The six missing routes in `ROUTES`, both new guards in §10, the collapse assertions for §7 |

**`src/app/globals.css` is not in any of the three lanes, and that is a
measurement, not a preference.** `git status --porcelain` during this run shows
it modified by a theme/design lane that is also holding
`src/components/md3/**`, `apps/system-studio/public/`, and
`e2e/md3-tokens-logic.spec.ts`. Three edits to that file are needed for this
shell and they are small, named and separable — **de-centre `main`**, **drop the
`calc((100vw - 1280px) / 2 …)` padding from `.masthead` and `.tabs`**, and **add
`--measure` with the prose rule of §3.2**. They must be handed to whichever
agent holds `globals.css`, as three hunks, rather than raced for.

Everything else A and B need ships as component-scoped
`<style href precedence>` blocks, which is the pattern `Nav.tsx` already uses
(`NAV_CSS`, line 250) and which React 19 hoists into `<head>` and deduplicates
on `href`. Every value in those blocks is an alias token
(`--space-*`, `--muted`, `--text`, `--accent`, `--border`) resolving to a
`--md-sys-*` role; a colour literal in a component style block is a colour pair
`e2e/md3-tokens-logic.spec.ts` does not know exists, in the file it is least
likely to be pointed at.

Before staging, each lane runs `git status --porcelain` and stages only its own
paths.

## 13. Deliberate deviations, recorded

### 13.1 OLED black, against `STUDIO-030-002`

`STUDIO-030-002` says, in these words: "Implement forest-green light/dark
palettes with measured contrast, no muddy brown/gold legacy theme, **no
pure-black glare**, and no low-contrast gray-on-gray critical text."

The product owner has directed: "The dark theme should be OLED black not green —
only logo and accent should be green (much richer deep forest velvety green)."

**The clause is overridden by that instruction.** The dark theme's base becomes
`#000`. This is recorded rather than reconciled, because pretending the clause
says something else would be worse than the deviation.

**What answers the concern behind the clause.** Pure black causes two real
problems, and the requirement was written against them:

1. **Glare** — maximum contrast between a black field and light text. Answered
   by holding foregrounds *below* pure white: the dark theme's `on-surface` is a
   high-luminance grey, never `#fff`, so the contrast ratio lands in the
   comfortable band rather than at the maximum the display can produce.
2. **Smearing between adjacent surfaces** — at `#000` a shadow has nothing to
   fall on, so elevation stops being perceptible and two stacked panels become
   one field. Answered structurally: **elevation comes from
   surface-container steps that are visibly distinct at `#000`, not from shadow
   alone.** Every `--md-sys-color-surface-container-*` step must be measurably
   lighter than the one below it, and the step must survive both density modes
   and the increased-contrast preference. Shadow remains, but it is decoration
   on top of a step, never the step itself.

That makes the deviation checkable rather than asserted: a step that collapses
is a failing measurement, not a matter of opinion. The palette itself, the step
values and the contrast measurements belong to
`docs/architecture/studio-design-system.md` and to the theme lane — **this
document does not set colour values and does not claim to have measured any.**

The accent stays a rich deep forest green, on the logo and on accent surfaces
only, which is `STUDIO-030-002`'s "protected brand/accent … not as decoration on
every surface" and §7.1 unchanged.

### 13.2 Two tests that are correct about the old palette and wrong about the new one

- `apps/system-studio/e2e/preferences.spec.ts` (~line 402) —
  `` `${theme} uses neither pure black nor pure white` ``.
- `apps/system-studio/e2e/md3-tokens-logic.spec.ts` — the test named "the scrim
  is translucent, dark enough to separate, and is not pure black", whose failure
  message says in as many words: *"which preferences.spec.ts fails on"*. (Cited
  by name, not by line: that file is being edited in this same run.)

Under the directed palette the first assertion is false by construction. It must
be **changed, not deleted, and not weakened**: the replacement asserts the new
rule — the dark theme's base **is** `#000`; what must never happen is a
**pure-white foreground**, an **invisible elevation step** between adjacent
surface containers, or a **contrast pair below AA**. That is a strictly larger
set of failures than "no pure black" caught, because it checks the two things
pure black actually endangers rather than the colour that endangers them.

**Ownership.** Both files belong to the theme/design lane, not to any lane in
§12, and **this document did not edit either of them**. This section exists so
the lane that does has the rule written down before it starts, and so that the
change is on the record as deliberate rather than discovered later in a diff.

## 14. What this document does not do

- **It writes no component code.** No `.tsx`, no `.css`, no test was changed by
  the work that produced it. The only file it touches is itself, plus its row in
  the execution ledger.
- **It does not close a `STUDIO-030-*` requirement.** It is §19's "Product and
  UX" deliverable — an architecture — and a document is not a shipped surface.
  The ledger row says so explicitly. `STUDIO-030-001` and `-030-003` are closed
  by the token layer and the primitives; `-030-007` by the accessibility
  evidence; `-030-012` by visual regression. This plan is written to make those
  reachable and closes none of them.
- **It does not measure the new shell.** No geometry claim here has been
  observed in a browser, because the shell does not exist yet. §7 is a
  specification with the assertion that will judge it named beside each row;
  §11 is the list of what *was* measured, all of it about the tree as it stands.
- **It does not design the context inspector.** §7.2's third bullet (selected
  object identity, provenance, dependencies, current vs desired, health, cost,
  risks, change history, actions) gets only its navigational half here (§4.4).
  The inspector is a separate deliverable and should not be smuggled in as a
  side effect of a shell change.
- **It does not add notifications or help.** §5 records the deferral and why.
- **It does not touch the Diagnostics line.** Nothing moves across it in this
  work; a surface moving in front of it is a claim that it became finished, and
  that claim needs its own evidence.

## 15. Adding a route

1. Decide the Bible domain it serves, from §7.2's list. If §7.2 has no name for
   it but §12 does, it is an entry under **AWS**. If neither does, it goes behind
   Diagnostics and §8 of this document says so in one sentence.
2. Add it to `GROUPS` in `src/components/Nav.tsx`, inside its domain's group,
   with the group in the Bible's order and before the Diagnostics group. If it
   is not going to be a destination, add it to `UNLINKED` in
   `src/app/platform/diagnostics/register.ts` with a reason instead. Doing
   neither fails `tests/architecture/shell-separation.test.mjs`.
3. If it goes behind Diagnostics, add its row to `QUARANTINED` in that same
   module: what it is, what is unfinished about it, and which live surfaces now
   answer what it was answering.
4. Decide whether it earns sub-items by §4.2's two-part rule. If it does, declare
   them as `{ label, anchor }` and put `id={anchor}` on the matching top-level
   `<Card>` — the anchor guard (§10a) fails the build otherwise. Never write the
   fragment as an href literal.
5. Add the route to `ROUTES` in `e2e/layout.spec.ts`. A route that is not in that
   array is a route whose overlap, spill and horizontal overflow are never
   measured at any width.
6. If the route calls `auth()`, `isOperator`, `authorizeCommand` or
   `operatorConfigProblems`, declare `export const dynamic = "force-dynamic"`.
7. Add its rows to §4 and §9 here, with the requirement it serves — or with the
   sentence that it serves none yet.
