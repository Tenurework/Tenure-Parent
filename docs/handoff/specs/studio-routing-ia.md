# Studio page routing tree and information architecture

## Summary
The Studio serves 18 pages, 3 route handlers and 8 server actions. Every page is reachable — a build guard (tests/architecture/shell-separation.test.mjs) makes an unreachable page fail CI — so there are zero orphan pages and zero dangling nav entries. The real defect is not orphans: it is that the nav's hierarchy and the URL's hierarchy are two different trees that never agree. The nav has 10 top-level groups for 14 destinations, and 8 of those 10 groups hold exactly one link, so the rail renders 24 always-expanded rows before any sub-item. Meanwhile 11 of 18 pages already live under the /platform/ prefix, and the nav never names "Platform" as their parent — it appears only as a quarantined leaf in the Diagnostics tail. The one page the nav files under "Blueprints" is served at "/", the only route with no section in its URL at all. Two other real gaps: the command palette (src/lib/commands.ts) offers 4 destinations and has never been updated with the 10 /platform/* surfaces, and GET /api/export has no caller anywhere in src/ — it is a genuinely orphaned endpoint exercised only by e2e/export.spec.ts. I give a Phase-1 re-nesting that reaches an admin.google.com-shaped 8 sections with ZERO URL changes and zero e2e edits, and a Phase-2 URL normalization that would move 17 of 18 routes and touch 40 e2e specs, 4 guards and 4 docs — flagged as expensive, not recommended without redirects.

## Findings
# Studio routing tree and information architecture

Read-only audit of `C:\Users\satvi\Tenure-Parent\apps\system-studio` on branch `recover-fanout-wave` (HEAD `faea2de`). Nothing was edited.

---

## 1. The current route tree — complete

`find src/app -name page.tsx | wc -l` → **18**. `find src/app -name route.ts` → **3**. There are **no route groups** (`(name)` directories) anywhere in this app — I checked the full directory listing; the only bracketed segments are the three dynamic ones. There is **no `middleware.ts`**, and `next.config.ts` declares **no `redirects()` and no `rewrites()`** (only an `async headers()` at line 99 applying `securityHeaders` to `/(.*)`). That last fact is load-bearing for §7: today, moving a URL produces a hard 404, not a redirect.

### 1.1 Pages (18)

| URL | File (relative to `apps/system-studio/`) | What it shows |
|---|---|---|
| `/` | `src/app/page.tsx` | h1 "Organization systems". What each configured system is made of and which layer every effective value came from; a fleet-agreement answer line with 5 chips (agreed / declared-not-found / no-artifact / compiled-only / unread); the extension-and-connector catalog with what was refused for this scope. Card ids `summary`, `catalog`. |
| `/tenants` | `src/app/tenants/page.tsx` | h1 "Tenants". The fleet table — every tenant with lifecycle state, cell/region, health, drift, cost, next action. Saved views, `?q=` search, `?signal=` filter. Primary action "Compose a tenant". Carries a CSV download anchor to `/api/aws/fleet?format=csv` (line 1113). |
| `/tenants/new` | `src/app/tenants/new/page.tsx` | h1 "Compose a tenant". The compose form: placement, plan and entitlements, live quote/pricing. 0 `<Card>`s. |
| `/tenants/[slug]` | `src/app/tenants/[slug]/page.tsx` | h1 = tenant display name. State and permitted transitions, AWS footprint (account/cell/region), drift, lifecycle history, next moves, `AdvanceControls`. 13 cards. |
| `/tenants/[slug]/configuration` | `src/app/tenants/[slug]/configuration/page.tsx` | h1 = tenant display name (line 696); h1 = raw slug on the not-found arm (line 489). `ConfigurationEditor`, published revision history, running cost total, module dependencies, what is deliberately not editable here, `RollbackControls`. |
| `/platform` | `src/app/platform/page.tsx` | h1 "Platform". The engine's own build report — 15 declared panels (see `PLATFORM_PANELS`): verdict, build provenance, live STS identity, recorded IAM refusals, ledger progress, open findings, compiled AWS snapshot, orphan queues, snapshot alarms, module adoption, release compatibility, ledger items, test suites, **live** service quotas, **live** AWS Organization. Quarantined. |
| `/platform/estate` | `src/app/platform/estate/page.tsx` | h1 "AWS estate". Account/region/partition this console resolved, live resource inventory service by service, declared-vs-actual, reconcile, where authority lives, account topology. Card ids `identity`, `resources`, `declared`, `reconcile`, `posture`, `topology`. |
| `/platform/network` | `src/app/platform/network/page.tsx` | h1 "Network". Exposure, load balancing, VPC and subnets, security groups, edge and TLS. 8 cards over five EC2/ELBv2 readers. |
| `/platform/compute` | `src/app/platform/compute/page.tsx` | h1 "Compute". Running vs desired, stop reasons verbatim from AWS, what each service runs, Lambda runtimes with deprecation dates. Card ids `running-against-desired`, `why-it-stopped`, `what-each-runs`, `lambda-runtimes`. |
| `/platform/messaging` | `src/app/platform/messaging/page.tsx` | h1 "Messaging". Queues and depths, dead-letter queues, EventBridge rules/schedules and their targets, SES identities/send rate/suppression. Card ids `answer`, `queues`, `failed-deliveries`, `schedules`, `sending`. |
| `/platform/identity` | `src/app/platform/identity/page.tsx` | h1 "Identity". Operator pools, IAM, keys, secrets, access analyzer. 8 cards over five services. |
| `/platform/data` | `src/app/platform/data/page.tsx` | h1 "Data". Tenant registry table and neighbours, S3 buckets with public-access posture and encryption, cache clusters, backup protection, restore points, pending maintenance. Card ids `registry`, `buckets`, `cache`, `protection`, `restore-points`, `interruptions`. |
| `/platform/security` | `src/app/platform/security/page.tsx` | h1 "Security posture". Aggregated findings with severity and SLA, per-source answered/unknown state. 5 cards. |
| `/platform/health` | `src/app/platform/health/page.tsx` | h1 "Health". What is alarming now, needs attention, watching quietly, coverage, unwatched resources, log groups and retention. Card ids `right-now`, `needs-attention`, `watching-quietly`, `coverage`, `unwatched`, `log-groups`. Polls `/api/aws/logs` (line 847). |
| `/platform/cost` | `src/app/platform/cost/page.tsx` | h1 "Cost" (`md3-headline-medium`, the only page not on `headline-large`). Cost attribution, budgets, rates, report view. 3 cards; honest answer today is `NOT_CONFIGURED`. |
| `/platform/audit` | `src/app/platform/audit/page.tsx` | h1 "Audit". The ledger filterable by actor/action/outcome, hash chains and whether each verifies, what could not be read, retention plan, legal holds + `HoldControls`. 9 cards. |
| `/platform/diagnostics` | `src/app/platform/diagnostics/page.tsx` | h1 "Diagnostics". The quarantine register itself — renders `QUARANTINED`, `UNLINKED`, `PLATFORM_PANELS` from `register.ts`. |
| `/signin` | `src/app/signin/page.tsx` | Pre-session. No rail, no breadcrumb, no session chrome. Wordmark + environment chip + one failure message for every failure mode. |

Non-page route files under `src/app/tenants/`: `error.tsx`, `loading.tsx`. Next conventions, no URL of their own.

### 1.2 Route handlers (3)

| URL | File | Methods | What it serves |
|---|---|---|---|
| `/api/auth/[...nextauth]` | `src/app/api/auth/[...nextauth]/route.ts` | GET, POST | Three lines: `export const { GET, POST } = handlers` from `@/lib/auth`. Concrete sub-paths exercised by e2e: `/api/auth/csrf`, `/api/auth/session`, `/api/auth/callback/operator`. |
| `/api/aws/[surface]` | `src/app/api/aws/[surface]/route.ts` | GET, POST | The AWS read control plane. `[surface]` is closed over **14** ids from `SURFACES` in `src/lib/aws/result.ts:171` — `fleet`, `operations`, `cost`, `cdn`, `certificates`, `compliance`, `dashboards`, `dns`, `guardduty`, `logs`, `organization`, `pricing`, `quotas`, `waf`. Authorization per surface via `SURFACE_COMMAND` (route.ts:110): `fleet→tenants.read`, `operations→tenant.lifecycle.read`, `cost`/`pricing→cost.read`, the other ten `→platform.read`. Query params in use: `?limit=`, `?format=csv`, `?slug=` (required on `operations`). An unknown surface is a 404 problem document. |
| `/api/export` | `src/app/api/export/route.ts` | GET | `?surface=<inventory\|coverage\|drift\|posture>&format=<csv\|json>` (`EXPORT_SURFACES`, `src/lib/aws/export.ts:85`). Unknown surface → 404, unknown format → 400. |

### 1.3 Server actions (8 POST endpoints, no URL of their own)

`docs/architecture/entry-points.md` counts these deliberately because "a layout guard does not protect a server action".

| Module | Exported actions |
|---|---|
| `src/app/tenants/actions.ts` | `composeTenant` (196), `advanceState` (666), `adoptTenantAction` (1011) |
| `src/app/tenants/[slug]/configuration/actions.ts` | `review` (195), `publish` (242), `rollback` (373) |
| `src/app/platform/audit/actions.ts` | `placeHold` (53), `releaseHold` (131) |

### 1.4 One directory inside `app/` that is not a route

`src/app/console-index/` holds `answer.ts`, `answer.test.ts`, `console-index.module.css` and **no `page.tsx`**. It contributes no URL; it is colocated support for `/`. It reads as a route in a file listing and is not one — worth a one-line comment in the directory or a move to `src/lib/`, but it is not a routing defect.

---

## 2. The current navigation tree

Declared once as `GROUPS` in `src/components/Nav.tsx:165`, plus `CONTEXTUAL` at line 389. Mounted from `src/app/layout.tsx` inside `<div className="console-rail">`, only when `signedIn`.

**Rendering fact that matters for the IA:** every group header is a plain `<span className={styles.sectionName}>` (Nav.tsx, group map body) — **not a button, not collapsible**. All 10 groups and all 14 entries are in every paint at every width above 900px. Only *sub-items* toggle (`opened` state, defaulting open on the current page). Below 901px a single "Sections" disclosure hides the whole panel.

### 2.1 The 10 groups / 14 entries as they ship

| # | Group (Bible domain) | Entry label | href | Sub-item anchors declared |
|---|---|---|---|---|
| 1 | Fleet | Tenants | `/tenants` | — (0) |
| 2 | Blueprints | Systems | `/` | `summary`, `catalog` (2) |
| 3 | AWS | Estate | `/platform/estate` | `identity`, `resources`, `declared`, `reconcile`, `posture`, `topology` (6) |
| 3 | AWS | Network | `/platform/network` | — (**0**) |
| 3 | AWS | Compute | `/platform/compute` | `running-against-desired`, `why-it-stopped`, `what-each-runs`, `lambda-runtimes` (4) |
| 3 | AWS | Messaging | `/platform/messaging` | `answer`, `queues`, `failed-deliveries`, `schedules`, `sending` (5) |
| 4 | Identity | Identity | `/platform/identity` | — (**0**) |
| 5 | Data | Data | `/platform/data` | `registry`, `buckets`, `cache`, `protection`, `restore-points`, `interruptions` (6) |
| 6 | Security | Findings | `/platform/security` | — (**0**) |
| 7 | Operations | Health | `/platform/health` | `right-now`, `needs-attention`, `watching-quietly`, `coverage`, `unwatched`, `log-groups` (6) |
| 8 | FinOps | Cost | `/platform/cost` | — (0, deliberate) |
| 9 | Evidence | Audit | `/platform/audit` | `entries`, `chains`, `not-known`, `retention`, `holds` (5) |
| 10 | **Diagnostics** (`tail: true`) | Diagnostics | `/platform/diagnostics` | — (0) |
| 10 | Diagnostics (tail) | Platform | `/platform` | — (0) |

**34 sub-item anchors total.** I extracted these by parsing the `GROUPS` literal, not by reading prose.

**A documentation/code disagreement worth fixing while you are in here.** `docs/architecture/studio-information-architecture.md` §4.2 specifies sub-items for **Network** (5: Exposure · Load balancing · VPC and subnets · Security groups · Edge and TLS), **Identity** (5: Operators and pools · IAM · Keys · Secrets · Analyzer) and **Findings** (3: Findings · Sources · SLA). **None of those exist in `Nav.tsx` today** — those three entries ship with zero sub-items. Estate ships 6 where the doc specifies 4, Compute 4 where the doc says 4 (agrees), Health 6 where the doc says 2, Audit 5 where the doc says 3. The doc's §4.2 table is stale by 13 sub-items in one direction and 5 in the other. The anchor guard in `shell-separation.test.mjs` only checks declared→card-id, so a *missing* sub-item is invisible to it.

### 2.2 The contextual sub-tree

`CONTEXTUAL` (Nav.tsx:389) has exactly one branch:

```
parent:   "/tenants"
reserved: ["new"]
leaves:   /tenants/[slug]               "Overview"      5 anchors: state, aws-footprint, drift, history, next
          /tenants/[slug]/configuration "Configuration" 4 anchors: configuration-history, running-total,
                                                                    module-dependencies, not-editable-here
```

Rendered under the Fleet group only when `usePathname()` is inside `/tenants/<slug>`, keyed by the slug from the path. The slug, not the display name — deliberate (`Nav.tsx` is a client component with no registry read).

### 2.3 The second, stale navigation: the command palette

`src/lib/commands.ts` — `STATIC_DESTINATIONS` is **4 entries**:

| id | title | href | group |
|---|---|---|---|
| `tenants` | Tenants | `/tenants` | Section |
| `systems` | Systems | `/` | Section |
| `platform` | Platform | `/platform` | Section |
| `create-tenant` | Compose a tenant | `/tenants/new` | Create |

plus one `Tenant`-group destination per registry tenant (`tenantDestination`, line 53), supplied by `src/components/Launcher.tsx`.

**None of the ten `/platform/*` operator surfaces are in the palette.** The one `/platform` entry it does carry points at the *quarantined build report*. Ctrl/Cmd-K is mounted globally in `layout.tsx` and reachable from every route, and it cannot reach Estate, Network, Compute, Messaging, Identity, Data, Findings, Health, Cost or Audit. `shell-separation.test.mjs`'s reachability guard does not catch this because those routes are reachable *from the rail*. This is the largest single IA gap that no guard covers.

### 2.4 Breadcrumbs

`src/components/Breadcrumbs.tsx` derives the whole trail from `GROUPS` (line 157) — so it follows any regrouping automatically. Two hardcoded maps:

- `TENANTS = "/tenants"` (line 111)
- `TENANT_SIBLINGS = { new: "Compose a tenant" }` (line 121)
- `TENANT_CHILDREN = { configuration: "Configuration" }` (line 131)

Trail shape: `domain crumb` (only when `group.entries[0].href !== matched.href`) → `entry crumb` → one crumb per segment below. `e2e/breadcrumbs.spec.ts:116-117` pins `/platform/network` to exactly `["AWS", "Network"]` with first href `/platform/estate`.

---

## 3. Nav ↔ routes: reachable, unlinked, orphaned, dangling

### 3.1 Reachable from the global rail (14 of 18 pages)

`/`, `/tenants`, `/platform/estate`, `/platform/network`, `/platform/compute`, `/platform/messaging`, `/platform/identity`, `/platform/data`, `/platform/security`, `/platform/health`, `/platform/cost`, `/platform/audit`, `/platform/diagnostics`, `/platform`.

### 3.2 Not a global destination, but linked in-app (4 of 18)

These are the four rows of `UNLINKED` in `src/app/platform/diagnostics/register.ts`. **None of them is an orphan** — I verified each has a real in-app entry point:

| Route | Declared reason (register.ts) | Actual in-app entry point I found |
|---|---|---|
| `/signin` | "Pre-session chrome. The navigation returns null on it" | Redirect target from every shell route; `Nav.tsx` early-returns `null` on `/signin*` |
| `/tenants/new` | "A permission-gated write, not a section… `e2e/operator-roles.spec.ts` asserts an Auditor's markup contains the string nowhere at all" | `tenants/page.tsx:909` and `:1034`, `<ButtonLink variant="filled" href="/tenants/new">`; also `STATIC_DESTINATIONS` id `create-tenant` |
| `/tenants/[slug]` | "Dynamic: there is no one tenant to link to" | The fleet table's per-row link; `tenantDestination()` in the palette; the contextual sub-tree once inside |
| `/tenants/[slug]/configuration` | "Dynamic, and scoped to a tenant that has to be chosen first" | `tenants/[slug]/page.tsx:799`, `<ButtonLink href={\`/tenants/${tenant.slug}/configuration\`}>`; contextual sub-tree leaf |

### 3.3 Nav entries pointing at nothing: **zero**

`tests/architecture/shell-separation.test.mjs` (line ~1385, "every route the console serves is a navigation entry or a declared unlinked route") enforces this in **both** directions: a served route in neither `GROUPS` nor `UNLINKED` fails the build, and a declared route the console does not serve also fails. Its `HREF_LITERAL` reader additionally requires every `href="/…"` / `href: "/…"` literal in `layout.tsx` and every shell component to be a served route. There is nothing dangling to find.

### 3.4 Genuine orphans

**One, and it is an API route.** `GET /api/export` has **no caller anywhere in `src/`**. I grepped the whole tree: the only hits outside its own file are three doc comments (`src/lib/aws/export.ts:10`, `src/lib/aws/export.test.ts:35`, `src/lib/portability/bundle.ts:14`) that *describe* it. There is no download button, no `<a href>`, no `fetch()`. It is exercised only by `e2e/export.spec.ts`. Four surfaces × two formats of estate export exist and no operator can reach any of them.

By contrast `/api/aws/[surface]` **is** reachable from the UI: `src/components/LiveRegion.tsx:150` polls `/api/aws/${surface}`, and `tenants/page.tsx:1113` links `/api/aws/fleet?format=csv` as a download.

---

## 4. Where the IA is flat that should be nested

### 4.1 The measured shape

- **10 top-level groups for 14 destinations** = 1.4 links per section.
- **8 of 10 groups hold exactly one link**: Fleet, Blueprints, Identity, Data, Security, Operations, FinOps, Evidence. Only AWS (4) and Diagnostics (2) hold more than one.
- Every group header is always rendered and never collapsible, so the rail's minimum is **24 rows** (10 headers + 14 links) in a rail of `--rail-inline-size: 17rem` = **272px** at ≥1181px, **15rem = 240px** at ≤1180px (`src/app/globals.css:1028`, `:1042`). Group name font-size is `0.68rem` (`nav.module.css:151`); entry font-size `0.82rem` (`:323`).
- Eight of those 24 rows are a heading whose entire contents is the one link directly beneath it. A section header that names one page is not a section; it is a label printed twice.

### 4.2 The structural defect, stated precisely

**The nav's hierarchy and the URL's hierarchy are two different trees, and neither is visible in the other.**

- **11 of 18 pages already sit under the `/platform/` prefix.** The URL says they are one section. The nav never says so: there is no "Platform" group. `/platform` appears in the rail exactly once, as a *quarantined leaf* in the Diagnostics tail. So the URL asserts a parent that the nav denies, and the nav asserts nine parents (AWS, Identity, Data, Security, Operations, FinOps, Evidence, plus Blueprints and Fleet) that the URL never mentions.
- **`/platform` is simultaneously a section prefix and a leaf page.** It is the parent segment of eleven routes *and* a page in its own right that the console classifies as unfinished. Anything a user learns from the URL `/platform/cost` about the page `/platform` is wrong.
- **`/` is the one route with no section in its URL at all.** The nav files it under "Blueprints"; the URL says it is the root. Every other operator surface carries a prefix.

### 4.3 What admin.google.com does instead — and how I know

I could not fetch `admin.google.com` itself (it requires authentication). What I did verify, from Google's own published help pages, are navigation paths written verbatim in their docs:

- `Menu ▸ Apps ▸ Web and mobile apps` — three levels.
- `Menu ▸ Devices ▸ Chrome ▸ Apps & extensions` — **four** levels.
- `Menu ▸ Devices ▸ Chrome ▸ Settings ▸ Device settings` — **five** levels.
- `Menu ▸ Account ▸ Admin roles`
- `Menu ▸ Billing ▸ Payment accounts`
- `Reporting ▸ Audit and investigation`
- `Menu ▸ Security` (security center)
- The "Navigate the Admin console" page states, verbatim: *"The side navigation menu groups options based on commonly used services"*, and names **Directory** and **Security** as its two examples. It also documents a **Pinned list** holding **up to 5** frequently-used pages.

So the confirmed shape is: a small set of top-level sections (Directory, Devices, Apps, Security, Reporting, Billing, Account are each individually attested), each holding **several** children, nesting **three to five levels deep**, plus a user-pinned shortcut list capped at 5. The Studio today is one level of grouping over a flat list, with 8 sections of size 1.

What I could **not** verify: the complete ordered list of top-level sections as rendered, the exact children of Directory, or admin.google.com's URL scheme. I am not going to invent a pixel value or a URL for a console I could not load.

---

## 5. Proposed tree

Two phases. Phase 1 reaches the admin.google.com *shape* with **zero URL changes**. Phase 2 makes the URL agree with the nav and is expensive; it is specified so somebody can cost it, not because I recommend doing it this week.

### 5.0 The constraint that governs both phases

`tests/architecture/shell-separation.test.mjs:1343`, *"the console's navigation groups are the Bible's domains, in the Bible's order"*, parses this line out of `Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md:235`:

```
- Left navigation: Fleet, Implementations, Blueprints, Modules, Releases, Changes,
  AWS, Identity, Data, Relay, Integrations, Domains, Security, Operations, FinOps,
  Evidence, Marketplace.
```

and asserts, with a failing build: exactly one `tail` group; the tail is last; the tail's name is **not** one of those 17; every non-tail group name **is** one of those 17; and the non-tail groups appear in that order.

**Consequence: you cannot rename the top-level sections to "Directory / Devices / Apps / …".** A group named `Directory` fails CI with *"navigation group(s) named nothing in the Bible"*. The admin.google.com goal must be met by adopting its **shape** (few sections, several children each, real depth) using the Bible's **vocabulary**, or by changing the Bible line and the guard together in one deliberate commit. The proposal below takes the first path.

### 5.1 Phase 1 — the shape, with no URL changed

Eight groups (7 operator + 1 tail), Bible order preserved. **The only edit is to `GROUPS` in `src/components/Nav.tsx`.**

```
FLEET                                                     ← Bible pos 0
  Tenants                       /tenants
    ▸ (contextual, inside a tenant)
        <slug>
          Overview              /tenants/<slug>
          Configuration         /tenants/<slug>/configuration

BLUEPRINTS                                                ← Bible pos 2
  Systems                       /
      Configured systems        #summary
      Extensions and connectors #catalog

AWS                                                       ← Bible pos 6
  Estate                        /platform/estate       (6 sub-items)
  Network                       /platform/network      (0 today — doc specifies 5)
  Compute                       /platform/compute      (4 sub-items)
  Messaging                     /platform/messaging    (5 sub-items)
  Identity                      /platform/identity     (0 today — doc specifies 5)   ← MOVED IN
  Data                          /platform/data         (6 sub-items)                 ← MOVED IN

SECURITY                                                  ← Bible pos 12
  Findings                      /platform/security     (0 today — doc specifies 3)

OPERATIONS                                                ← Bible pos 13
  Health                        /platform/health       (6 sub-items)

FINOPS                                                    ← Bible pos 14
  Cost                          /platform/cost         (0, deliberate)

EVIDENCE                                                  ← Bible pos 15
  Audit                         /platform/audit        (5 sub-items)

──────────────────────────────────────  (tail rule)
DIAGNOSTICS                                               ← tail, not a Bible domain
  Diagnostics                   /platform/diagnostics
  Platform                      /platform
```

Group positions after the change: `0, 2, 6, 12, 13, 14, 15` — strictly ascending, guard passes. 10 groups → **8**; groups-of-one 8 → **5**; rail minimum 24 rows → **22**, and the AWS section now carries 6 of the 14 links, which is the admin.google.com density.

Add the 13 missing sub-items the IA doc already specifies (Network 5, Identity 5, Findings 3) and the tree reaches a real three levels on 9 of 14 destinations: **Section ▸ Page ▸ In-page surface**.

### 5.2 Phase 1 mapping onto admin.google.com's seven sections

Every one of the 18 current routes lands somewhere. Nothing is unplaced.

| admin.google.com section (attested) | Studio section (Bible name) | Routes that land there | Empty? |
|---|---|---|---|
| **Directory** — the managed population | **Fleet** | `/tenants`, `/tenants/new`, `/tenants/[slug]`, `/tenants/[slug]/configuration` | populated (4) |
| **Apps** — what is installed and configured | **Blueprints** | `/` | populated (1) |
| **Devices** — the managed estate | **AWS** | `/platform/estate`, `/network`, `/compute`, `/messaging`, `/identity`, `/data` | populated (6) |
| **Security** | **Security** | `/platform/security` | populated (1) |
| **Reporting** — monitoring half | **Operations** | `/platform/health` | populated (1) |
| **Reporting** — audit half | **Evidence** | `/platform/audit` | populated (1) |
| **Billing** | **FinOps** | `/platform/cost` | populated (1) |
| **Account** | *(no Studio section exists)* | *(none)* | **EMPTY — see 5.3** |
| — | **Diagnostics** (tail) | `/platform/diagnostics`, `/platform` | populated (2) |
| — | pre-session, outside every section | `/signin` | n/a |

### 5.3 Proposed sections that are currently EMPTY

Eight Bible domains have no route today. Seven of them are already enumerated with a reason in `docs/architecture/studio-information-architecture.md` §4.3; I confirmed each against the tree. The eighth is mine.

| Section | Why it is empty | What would fill it |
|---|---|---|
| **Implementations** (Bible pos 1) | The resumable multi-stage workspace with per-stage readiness (`STUDIO-050-001/002`) is not built. `/tenants/new` and `/tenants/[slug]/configuration` are *stage surfaces* reached from Fleet. | A `/implementations` list + per-implementation stage workspace |
| **Modules** (pos 3) | Answered per-system as the `#catalog` anchor on `/`. No standalone catalog route. | A module catalog page |
| **Releases** (pos 4) | No surface. A compatibility fragment sits on the quarantined `/platform` ("Release compatibility" panel). | A releases/compatibility page |
| **Changes** (pos 5) | No surface. Lifecycle advances on `/tenants/[slug]` carry approval requirements; there is no change-request queue, plan diff or approval inbox. | An approval inbox — the single clearest missing operator surface |
| **Relay** (pos 9) | No surface. Explicitly **not** `/platform/messaging`, which is SQS/SNS/EventBridge/SES. Relay is the Bedrock-hosted customer copilot. | — |
| **Integrations** (pos 10) | Answered inside `/` as the same `#catalog` anchor. | — |
| **Domains** (pos 11) | Route 53 / ACM / CloudFront facts appear on `/platform/network` as edge posture; custom-domain *management* (`STUDIO-080-004`) does not exist. | A `/platform/domains` page |
| **Marketplace** (pos 16) | **Deliberately** absent. `STUDIO-130-007` requires it to stay a nonfunctional "Coming soon" until certification, packaging, review, billing and revocation exist; `/` passes `marketplaceEnabled: false`. A nav entry would violate the requirement. | nothing, on purpose |
| **Account** (not a Bible domain) | admin.google.com has one (`Menu ▸ Account ▸ Admin roles`, attested). The Studio's equivalent exists only as **popovers with no route**: `src/components/AccountMenu.tsx` in the TopBar and `src/components/PreferencesMenu.tsx`. Operator roles are a real, tested concept here (`e2e/operator-roles.spec.ts`) and have no page. | `/account/preferences`, `/account/roles`, `/account/session` — but note a group named `Account` fails the Bible guard as written |

### 5.4 Phase 2 — making the URL agree with the nav (specified, not recommended)

The clean form is `/<section>/<page>`, which is what a reader of `admin.google.com`'s nav paths would expect:

| Current URL | Phase-2 URL |
|---|---|
| `/` | `/blueprints/systems` (root becomes a dashboard or a redirect) |
| `/tenants` | `/fleet/tenants` |
| `/tenants/new` | `/fleet/tenants/new` |
| `/tenants/[slug]` | `/fleet/tenants/[slug]` |
| `/tenants/[slug]/configuration` | `/fleet/tenants/[slug]/configuration` |
| `/platform/estate` | `/aws/estate` |
| `/platform/network` | `/aws/network` |
| `/platform/compute` | `/aws/compute` |
| `/platform/messaging` | `/aws/messaging` |
| `/platform/identity` | `/aws/identity` |
| `/platform/data` | `/aws/data` |
| `/platform/security` | `/security/findings` |
| `/platform/health` | `/operations/health` |
| `/platform/cost` | `/finops/cost` |
| `/platform/audit` | `/evidence/audit` |
| `/platform/diagnostics` | `/diagnostics` |
| `/platform` | `/diagnostics/build` |
| `/signin` | `/signin` (unchanged) |

That moves **17 of 18 routes**. See §7 for the blast radius. If you do only one thing from this section, do the last two rows: splitting `/platform` (leaf) from `/platform/*` (prefix) removes the one place where the URL tree is provably self-contradictory, and it touches far less.

---

## 6. The exact diff

### 6.1 Phase 1 — recommended. One file.

`apps/system-studio/src/components/Nav.tsx`, the `GROUPS` literal beginning at line 165:

```
- REMOVE  group { domain: "Identity", entries: [ { href: "/platform/identity", label: "Identity", … } ] }
- REMOVE  group { domain: "Data",     entries: [ { href: "/platform/data",     label: "Data",     … } ] }
+ ADD     both entries, unchanged, to the end of the "AWS" group's `entries` array,
+         after Messaging, in the order Identity, Data
```

Net: `GROUPS.length` 10 → 8. `NAV_ENTRIES` unchanged at 14. No href changes. No `UNLINKED` changes. No `QUARANTINED` changes.

Optionally, in the same commit, add the 13 sub-items `docs/architecture/studio-information-architecture.md` §4.2 already specifies for Network (5), Identity (5) and Findings (3) — but **only after** confirming each anchor is a real top-level `<Card id="…">` on that page, because `shell-separation.test.mjs`'s `cards()` reader fails the build on an anchor that is not a card id in the opening tag.

**Guard impact:** passes. Group positions `0,2,6,12,13,14,15` ascend; every non-tail name is a Bible domain; one tail, last, non-Bible.

**e2e impact:** no `page.goto()` in any spec changes. Two behavioural consequences to check:

1. `e2e/breadcrumbs.spec.ts` — `/platform/identity` and `/platform/data` gain one crumb each. Today their group's `entries[0].href` equals their own href, so `Breadcrumbs.tsx` line 228 suppresses the domain crumb; after the move `entries[0].href` is `/platform/estate`, so the trail becomes `["AWS", "Identity"]` / `["AWS", "Data"]` — exactly the shape line 116 already pins for `/platform/network`. The generic loop at line 218 over that spec's own `ROUTES` (which includes both, lines 176-177) asserts only `trail.length > 0` and last-crumb-href-null, so it stays green; the explicit assertion at line 116 is about Network and is unaffected. Verify, do not assume.
2. `e2e/breadcrumbs.spec.ts:133` asserts `destinations.length >= 14`. Entry count is unchanged at 14. Green.
3. `e2e/cost.spec.ts` asserts exactly one `aria-current="page"` inside `nav.tabs`. Group headers use `aria-current={true}`, not `"page"` — deliberately, per the `owned`/`here` comment in `Nav.tsx` — so the count is unchanged.

**Docs to update in the same commit** (the Nav header says "Change one and change the other"): `docs/architecture/studio-information-architecture.md` §4.1 table (10 groups → 8), §4.2 sub-item table (bring it into line with the code either way), §9 route-map "Position in the shell" column for `/platform/identity` and `/platform/data`.

### 6.2 A second, independent Phase-1 fix: the command palette

`apps/system-studio/src/lib/commands.ts`, `STATIC_DESTINATIONS` (line ~30). Add the ten missing operator surfaces so Ctrl/Cmd-K reaches everything the rail does. Suggested — ids kebab-case, `group: "Section"`, titles matching the rail's entry labels exactly so the two navigations cannot disagree:

```
estate      "Estate"     /platform/estate       keywords: aws, account, inventory, resources, topology
network     "Network"    /platform/network      keywords: vpc, subnet, security group, elb, tls, edge
compute     "Compute"    /platform/compute      keywords: ecs, service, task, lambda, runtime, stopped
messaging   "Messaging"  /platform/messaging    keywords: sqs, sns, eventbridge, ses, queue, dlq
identity    "Identity"   /platform/identity     keywords: iam, cognito, secrets, keys, analyzer
data        "Data"       /platform/data         keywords: dynamodb, rds, s3, cache, backup, restore
findings    "Findings"   /platform/security     keywords: security, severity, sla, guardduty
health      "Health"     /platform/health       keywords: alarms, cloudwatch, coverage, logs
cost        "Cost"       /platform/cost         keywords: finops, budget, spend, allocation
audit       "Audit"      /platform/audit        keywords: evidence, ledger, chain, retention, hold
```

Consider also demoting the existing `platform` destination's title from "Platform" or removing it — it points at the quarantined build report and is the only `/platform*` destination the palette currently offers, which is the worst possible one to be the only one.

While here: admin.google.com documents a **Pinned list capped at 5**. `CommandPalette.tsx` already implements pinning (`togglePin`, `pinned`) with **no cap** that I found. Capping at 5 would match the reference and is a one-line change — but I did not verify Google's cap applies to anything but the Admin console's own left-nav pin list, so treat 5 as a reference point, not a requirement.

### 6.3 A third: give `/api/export` a door

Four estate exports (`inventory`, `coverage`, `drift`, `posture`) × two formats exist and nothing links them. The natural home is a download control on `/platform/estate` — that page already declares cards `resources`, `declared` and `posture`, which are three of the four export surfaces by name. Model it on the existing pattern at `tenants/page.tsx:1113` (`<a href={…} download>`), which is already how `/api/aws/fleet?format=csv` is exposed.

### 6.4 Phase 2 diff, if it is ever taken

Beyond the 17 route-directory renames, you would need, at minimum:

- `next.config.ts`: a `redirects()` block with 17 permanent redirects. There is none today, so without it every existing bookmark, every doc link and every e2e `goto` 404s.
- `src/components/Nav.tsx`: 14 `href` values + 2 `template` values in `CONTEXTUAL` + the `parent: "/tenants"` and `reserved: ["new"]` fields.
- `src/components/Breadcrumbs.tsx`: `TENANTS` (line 111) and the two segment maps.
- `src/lib/commands.ts`: 4 static hrefs + `tenantDestination`'s template (line 55).
- `src/app/tenants/page.tsx:909,1034` and `src/app/tenants/[slug]/page.tsx:799`: the three in-page `ButtonLink` hrefs.
- `src/app/platform/diagnostics/register.ts`: all 4 `UNLINKED.route` values and both `QUARANTINED.route` values, plus every `covered: [...]` array (26 route strings across `QUARANTINED` and `PLATFORM_PANELS`).
- Auth redirect targets in `src/lib/auth.ts` / `signin/page.tsx` (the `/signin` ↔ `/` round trip).

---

## 7. Blast radius of a URL move

### 7.1 e2e specs with hardcoded paths

`apps/system-studio/e2e/` holds **56 spec files**. Distinct path literals and their counts across the directory:

```
61  "/signin"                       12  "/tenants/new"                2  "/api/aws/fleet"
37  "/tenants"                       8  "/tenants/seed-deployed"      2  "/api/aws/cost"
28  "/platform"                      7  "/platform/security"          2  "/api/auth/csrf"
27  "/platform/cost"                 7  "/platform/network"           2  "/api/auth/callback/operator"
14  "/platform/estate"               5  "/platform/health"            2  "/tenants/rochester/configuration"
                                     5  "/api/aws/operations"         2  "/api/aws/nonesuch"
                                     4  "/tenants/seed-deployed/configuration"
                                     4  "/platform/identity", "/platform/data", "/platform/audit"
                                     3  "/platform/messaging", "/platform/diagnostics", "/platform/compute"
```
plus single-use query variants (`/tenants?q=…`, `/tenants?signal=…`, `/signin?error=…`, `/api/export?surface=…&format=…`, `/api/aws/*?limit=…&format=csv`) and template literals of the form `` `/tenants/${SLUG}/configuration` ``.

**Specs that would need editing, by route touched.** Phase-2 moves every one of these; Phase 1 moves none of them.

| Route moved | Specs to edit |
|---|---|
| `/` | `commands.spec.ts`, `console-index.spec.ts`, `preferences-logic.spec.ts`, `preferences.spec.ts`, `signin.spec.ts`, `topbar.spec.ts` |
| `/tenants` | `adoption.spec.ts`, `base-scale.spec.ts`, `breadcrumbs.spec.ts`, `commands.spec.ts`, `density-budget.spec.ts`, `destructive-separation.spec.ts`, `fleet-health-logic.spec.ts`, `fleet-surface.spec.ts`, `layout.spec.ts`, `operator-roles.spec.ts`, `preferences-logic.spec.ts`, `preferences.spec.ts` |
| `/tenants/new` | `base-scale.spec.ts`, `breadcrumbs.spec.ts`, `commands.spec.ts`, `destructive-separation.spec.ts`, `high-risk-fails-closed.spec.ts`, `layout.spec.ts`, `operator-roles.spec.ts` |
| `/tenants/[slug]`, `…/configuration` | `breadcrumbs.spec.ts`, `config-store.spec.ts`, `configuration-surface.spec.ts`, `destructive-separation.spec.ts`, `high-risk-fails-closed.spec.ts`, `layout.spec.ts`, `operator-roles.spec.ts`, `pricing-surface.spec.ts`, `tenant-surface.spec.ts` |
| `/platform` | `base-scale.spec.ts`, `breadcrumbs.spec.ts`, `commands.spec.ts`, `cost.spec.ts`, `destructive-separation.spec.ts`, `layout.spec.ts`, `operator-roles.spec.ts`, `platform.spec.ts`, `preferences-logic.spec.ts`, `preferences.spec.ts` |
| `/platform/estate` | `base-scale.spec.ts`, `breadcrumbs.spec.ts`, `density-budget.spec.ts`, `destructive-separation.spec.ts`, `layout.spec.ts`, `live-refresh.spec.ts` |
| `/platform/network` | `breadcrumbs.spec.ts`, `destructive-separation.spec.ts`, `layout.spec.ts`, `network-surface.spec.ts` |
| `/platform/compute` | `breadcrumbs.spec.ts`, `destructive-separation.spec.ts`, `layout.spec.ts` |
| `/platform/messaging` | `breadcrumbs.spec.ts`, `destructive-separation.spec.ts`, `layout.spec.ts` |
| `/platform/identity` | `breadcrumbs.spec.ts`, `destructive-separation.spec.ts`, `identity-surface.spec.ts`, `layout.spec.ts` |
| `/platform/data` | `breadcrumbs.spec.ts`, `data-surface.spec.ts`, `destructive-separation.spec.ts`, `layout.spec.ts` |
| `/platform/security` | `breadcrumbs.spec.ts`, `density-budget.spec.ts`, `destructive-separation.spec.ts`, `layout.spec.ts`, `security-surface.spec.ts`, `topbar.spec.ts` |
| `/platform/health` | `breadcrumbs.spec.ts`, `destructive-separation.spec.ts`, `layout.spec.ts`, `live-refresh.spec.ts` |
| `/platform/cost` | `breadcrumbs.spec.ts`, `cost.spec.ts`, `destructive-separation.spec.ts`, `layout.spec.ts`, `operator-roles.spec.ts` |
| `/platform/audit` | `audit-chain.spec.ts`, `breadcrumbs.spec.ts`, `destructive-separation.spec.ts`, `layout.spec.ts` |
| `/platform/diagnostics` | `breadcrumbs.spec.ts`, `destructive-separation.spec.ts`, `layout.spec.ts` |
| `/signin` (unchanged) | 32 spec files reference it; none needs editing |

Union of specs that would need at least one edit under Phase 2: **40 of 56**. Four specs carry their own route arrays that must be updated wholesale — `e2e/layout.spec.ts:41` (15 routes), `e2e/breadcrumbs.spec.ts:165` (its own `ROUTES`), `e2e/destructive-separation.spec.ts`, `e2e/density-budget.spec.ts`.

`apps/web/e2e/` contains **no** references to Studio routes — confirmed by grep. The two apps are on different origins (PD-007) and nothing crosses.

### 7.2 Monorepo guards that would red

| Guard | Why it breaks on a move |
|---|---|
| `tests/architecture/shell-separation.test.mjs` | Derives served routes from the filesystem and cross-checks `GROUPS`, `UNLINKED`, `QUARANTINED`, `PLATFORM_PANELS` and every `href` literal in the shell. It hardcodes `/platform/estate` at line 1277 for the card-id assertion. Its Bible-order test forbids renaming groups. |
| `tests/security/entry-points.test.mjs` | Reads `docs/architecture/entry-points.md`, whose Studio table (lines 120-139) lists all 18 routes verbatim with their guards. |
| `tests/security/every-path-authorizes.test.mjs` | Same document. |
| `tests/architecture/authorizing-routes-are-dynamic.test.mjs` | Path-regex over `**/page.tsx`; survives a rename but must be re-run. |

### 7.3 Documents carrying Studio route strings

- `docs/architecture/entry-points.md` — the 20-row Studio table at lines 120-139 (18 pages + the API rows at 74-76). **Guard-checked.**
- `docs/architecture/studio-information-architecture.md` — §4.1 (14 rows), §4.2, §9 (18 rows), §15. This is the source-of-truth doc the Nav header instructs you to keep in sync.
- `docs/architecture/pack-surface-inventory.md` (line 60 et seq) and `.json` — **guard-checked** by `tests/architecture/pack-surface-inventory.test.mjs`.
- `docs/architecture/cfg-configuration-truth.md` (line 36 et seq).
- `docs/architecture/anl-analytics-inventory.md` / `.json` — **guard-checked**.
- `docs/architecture/simon-mapping-matrices.md` / `.json`, `simon-absorption-inventory.json`, `simon-convergence-inventory.json`.
- `Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md:235` — only if the top-level names change.

### 7.4 Recommendation

Do §6.1, §6.2 and §6.3. Together they are three files, no URL change, no e2e edit, no guard change, and they close the two gaps no guard covers (a palette that cannot reach ten of fourteen surfaces, and an export API with no door). They take the rail from 10 sections/14 links to 8 sections/14 links with a 6-link AWS section — the admin.google.com density — without spending a single redirect.

Take Phase 2 only as its own branch, redirects first, and only after somebody decides whether the Bible's §7.2 domain list is a constraint to honour or a line to amend. Do not start it by renaming a directory: `shell-separation.test.mjs` will red before the first spec runs.

## Concrete values
ROUTE TREE — 18 pages
/                                    src/app/page.tsx
/tenants                             src/app/tenants/page.tsx
/tenants/new                         src/app/tenants/new/page.tsx
/tenants/[slug]                      src/app/tenants/[slug]/page.tsx
/tenants/[slug]/configuration        src/app/tenants/[slug]/configuration/page.tsx
/platform                            src/app/platform/page.tsx
/platform/estate                     src/app/platform/estate/page.tsx
/platform/network                    src/app/platform/network/page.tsx
/platform/compute                    src/app/platform/compute/page.tsx
/platform/messaging                  src/app/platform/messaging/page.tsx
/platform/identity                   src/app/platform/identity/page.tsx
/platform/data                       src/app/platform/data/page.tsx
/platform/security                   src/app/platform/security/page.tsx
/platform/health                     src/app/platform/health/page.tsx
/platform/cost                       src/app/platform/cost/page.tsx
/platform/audit                      src/app/platform/audit/page.tsx
/platform/diagnostics                src/app/platform/diagnostics/page.tsx
/signin                              src/app/signin/page.tsx

ROUTE HANDLERS — 3
/api/auth/[...nextauth]   GET, POST
/api/aws/[surface]        GET, POST   surface ∈ {fleet, operations, cost, cdn, certificates,
                                       compliance, dashboards, dns, guardduty, logs,
                                       organization, pricing, quotas, waf}  (14)
/api/export               GET         ?surface ∈ {inventory, coverage, drift, posture}
                                      &format ∈ {csv, json}

SERVER ACTIONS — 8
composeTenant, advanceState, adoptTenantAction      src/app/tenants/actions.ts (196, 666, 1011)
review, publish, rollback                            src/app/tenants/[slug]/configuration/actions.ts (195, 242, 373)
placeHold, releaseHold                               src/app/platform/audit/actions.ts (53, 131)

NAV — 10 groups / 14 entries / 34 sub-item anchors  (src/components/Nav.tsx:165)
Fleet(1) Blueprints(1) AWS(4) Identity(1) Data(1) Security(1) Operations(1)
FinOps(1) Evidence(1) Diagnostics-tail(2)
sub-items per entry: /tenants 0 | / 2 | estate 6 | network 0 | compute 4 | messaging 5 |
identity 0 | data 6 | security 0 | health 6 | cost 0 | audit 5 | diagnostics 0 | platform 0
contextual leaves: /tenants/[slug] (5 anchors), /tenants/[slug]/configuration (4 anchors)

COMMAND PALETTE — 4 static destinations only (src/lib/commands.ts:32-46)
tenants→/tenants | systems→/ | platform→/platform | create-tenant→/tenants/new

BIBLE DOMAIN LIST (guard-enforced, Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md:235)
Fleet, Implementations, Blueprints, Modules, Releases, Changes, AWS, Identity, Data,
Relay, Integrations, Domains, Security, Operations, FinOps, Evidence, Marketplace

PHASE 1 GROUP POSITIONS AFTER RE-NEST (must ascend)
Fleet 0, Blueprints 2, AWS 6, Security 12, Operations 13, FinOps 14, Evidence 15, tail last

SHELL DIMENSIONS (src/app/globals.css)
--rail-inline-size: 17rem = 272px  (line 1028);  15rem = 240px at max-width:1180px (line 1042)
--topbar-block-size: 64px (line 1027)
--space-1..6 = 4, 8, 12, 16, 20, 28px  (lines 704-718); compact mode 2, 6, 8, 10, 14, 18 (724-729)
--tap: 24px (720, 731);  --measure: 72ch (1038)
--console-nav-offset = calc(64px + 2*16px) = 96px  (globals.css:1135)
nav group-name font-size 0.68rem (nav.module.css:151); entry font-size 0.82rem (:323)
nav breakpoint EXPANDED = (min-width: 901px) (Nav.tsx:478)
layout.spec.ts widths measured: 1440, 1180, 900, 320 (e2e/layout.spec.ts, WIDTHS)

E2E PATH-LITERAL COUNTS (apps/system-studio/e2e, 56 spec files)
"/signin" 61 | "/tenants" 37 | "/platform" 28 | "/platform/cost" 27 | "/platform/estate" 14
"/tenants/new" 12 | "/tenants/seed-deployed" 8 | "/platform/security" 7 | "/platform/network" 7
"/platform/health" 5 | "/api/aws/operations" 5 | "/tenants/seed-deployed/configuration" 4
"/platform/identity" 4 | "/platform/data" 4 | "/platform/audit" 4
"/platform/messaging" 3 | "/platform/diagnostics" 3 | "/platform/compute" 3

PHASE 2 URL MOVES (17 of 18)
/                              -> /blueprints/systems
/tenants                       -> /fleet/tenants
/tenants/new                   -> /fleet/tenants/new
/tenants/[slug]                -> /fleet/tenants/[slug]
/tenants/[slug]/configuration  -> /fleet/tenants/[slug]/configuration
/platform/estate               -> /aws/estate
/platform/network              -> /aws/network
/platform/compute              -> /aws/compute
/platform/messaging            -> /aws/messaging
/platform/identity             -> /aws/identity
/platform/data                 -> /aws/data
/platform/security             -> /security/findings
/platform/health               -> /operations/health
/platform/cost                 -> /finops/cost
/platform/audit                -> /evidence/audit
/platform/diagnostics          -> /diagnostics
/platform                      -> /diagnostics/build
/signin                        -> unchanged

ADMIN.GOOGLE.COM NAV PATHS, VERBATIM FROM GOOGLE DOCS
Menu > Apps > Web and mobile apps
Menu > Devices > Chrome > Apps & extensions
Menu > Devices > Chrome > Settings > Device settings
Menu > Account > Admin roles
Menu > Billing > Payment accounts
Reporting > Audit and investigation
Menu > Security
"The side navigation menu groups options based on commonly used services" (Directory, Security given as examples)
Pinned list: up to 5 pages

## Sources
- https://knowledge.workspace.google.com/admin/getting-started/navigate-the-admin-console?hl=en
- https://knowledge.workspace.google.com/admin/getting-started/admin-console-map?hl=en
- https://support.google.com/a/answer/13680626
- https://support.google.com/a/answer/55955
- https://support.google.com/a/answer/6328701?hl=en
- https://support.google.com/chrome/a/answer/6177447?hl=en
- https://support.google.com/chrome/a/answer/1375678?hl=en
- https://knowledge.workspace.google.com/admin/reports/about-the-audit-and-investigation-tool
- https://knowledge.workspace.google.com/admin/billing/access-your-billing-accounts
- https://knowledge.workspace.google.com/admin/users/administrator-privilege-definitions
- https://support.google.com/a/answer/7492003

## Confidence / not asserted
VERIFIED BY READING THE TREE (high confidence):
- 18 page.tsx, 3 route.ts, 8 server actions — counted with find, not from a doc.
- Zero route groups, zero middleware.ts, zero redirects()/rewrites() in next.config.ts — checked directly.
- GROUPS/CONTEXTUAL/UNLINKED/QUARANTINED contents — parsed programmatically out of Nav.tsx and register.ts, not read from prose.
- Sub-item counts per entry — extracted by script; this is how I caught that the IA doc's §4.2 table disagrees with the code for Network, Identity, Findings, Estate, Health and Audit.
- /api/export has no caller in src/ — grepped the whole src tree; the only hits are three doc comments.
- e2e path-literal counts and the per-route spec lists — grep output, reproducible.
- --rail-inline-size, --space-*, --topbar-block-size, --tap, --measure — read from globals.css with line numbers.

NOT VERIFIED — DO NOT TREAT AS FACT:
- I did NOT run any test. Every "the guard passes / would red" claim is read from the guard's source, not observed. Before shipping Phase 1, actually run: node --test tests/architecture/shell-separation.test.mjs. The IA doc claims it was 13 pass / 0 fail at the time that doc was written; I have no evidence about today.
- I did NOT run the e2e suite. The breadcrumb-crumb-count prediction for /platform/identity and /platform/data under Phase 1 is derived from reading Breadcrumbs.tsx line 228 and breadcrumbs.spec.ts lines 116-117 and 218. It is a reasoned prediction. Run e2e/breadcrumbs.spec.ts before believing it.
- I could NOT load admin.google.com — it requires authentication. Everything I assert about it comes from Google's published help pages (fetched, listed in sources), which give navigation paths verbatim inside instruction text. From those I can attest that Apps, Devices, Account, Billing, Reporting, Security and Directory are top-level side-nav sections and that the tree goes at least five levels deep under Devices. I could NOT confirm: the complete ordered list of top-level sections as rendered; the exact children of Directory; any pixel value, row height, font size or color from that console; or its URL scheme. The Phase-2 URL scheme in this spec is derived from the Studio's own nav hierarchy, NOT copied from Google — I have no evidence Google's URLs mirror their nav paths, and the /ac/... URLs I have seen suggest they may not.
- The "Pinned list: up to 5" figure is from Google's "Navigate the Admin console" page as summarised by the fetch. I did not see the raw sentence, only the fetcher's rendering of it. Treat 5 as a reference point to check, not a number to hardcode.
- I did not audit whether the 13 sub-item anchors the IA doc specifies for Network/Identity/Findings correspond to real <Card id="..."> values on those pages. If you add them, read those three page.tsx files first — shell-separation.test.mjs's cards() reader will fail the build on an anchor that is not a card id in the opening tag.
- "40 of 56 specs would need editing" under Phase 2 is a union of grep hits. It is a floor, not a ceiling: template literals and helper functions that build paths from fragments may not have matched my patterns.

## Risks
1. RENAMING TOP-LEVEL SECTIONS TO GOOGLE'S NAMES FAILS CI. tests/architecture/shell-separation.test.mjs:1343 parses the domain list out of Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md:235 and asserts every non-tail group name is in it, in that order. A group named "Directory" or "Devices" reds the build with "navigation group(s) named nothing in the Bible". Adopt the SHAPE, keep the vocabulary — or change the Bible line and the guard in one deliberate commit with a human deciding.

2. THERE ARE NO REDIRECTS. next.config.ts declares only headers(). Any URL move today is a hard 404 for every bookmark, every doc link and every e2e goto. Phase 2 must land redirects() in the same commit as the directory rename, not after.

3. /platform IS BOTH A PREFIX AND A LEAF. It parents eleven routes and is itself a quarantined build-report page. Any tooling that reasons "a route's parent describes it" is wrong here today. This is the one URL contradiction I would fix even if nothing else moves.

4. THE PALETTE AND THE RAIL ARE TWO NAVIGATIONS AND NO GUARD TIES THEM. shell-separation.test.mjs enforces rail-vs-routes in both directions; it says nothing about src/lib/commands.ts. That is how the palette drifted to 4 destinations while the rail grew to 14. If you fix the palette, consider deriving STATIC_DESTINATIONS from GROUPS rather than hand-listing it — but note Nav.tsx carries "use client", so a server importer gets a client reference, which is exactly why UNLINKED lives in register.ts and not in Nav.tsx. The same constraint applies.

5. THE IA DOC IS THE STATED SOURCE OF TRUTH AND IS CURRENTLY WRONG. Nav.tsx's header says "Change one and change the other" about docs/architecture/studio-information-architecture.md. Its §4.2 sub-item table disagrees with the shipped code on six of fourteen entries. Whoever implements this must decide which is right per row, not silently copy one onto the other.

6. FOUR MONOREPO GUARDS AND SIX DOCUMENTS CARRY LITERAL STUDIO ROUTE STRINGS. entry-points.md (guard-checked by tests/security/entry-points.test.mjs and every-path-authorizes.test.mjs), pack-surface-inventory.md/.json (guard-checked), anl-analytics-inventory.md/.json (guard-checked), cfg-configuration-truth.md, plus the simon-* inventories. A Phase-2 move that edits code and specs but not these reds CI in a place nobody will look.

7. OTHER AGENTS ARE EDITING THIS TREE. Everything above is a read of the working tree at HEAD faea2de on recover-fanout-wave. Re-grep before editing; a file that moved under this audit belongs to another lane.
