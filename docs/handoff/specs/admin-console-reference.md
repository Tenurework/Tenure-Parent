# Reference spec: Google Admin console (admin.google.com) shell — anatomy, IA, density, type, color

## Summary
Built a reference spec from three grounded source classes. (1) The **information architecture** is not estimated — I crawled all 1,890 Google Workspace Admin Help articles on `knowledge.workspace.google.com` and extracted the 2,191 literal `go to Menu ▸ A ▸ B ▸ C` console navigation strings they contain, yielding a real 10-top-level, 3–4-deep nav tree (Directory, Devices, Apps, Security, Reporting, Billing, Account, Rules, Data, Storage, Generative AI, Chrome browser). (2) The **numeric design values** come from Google's own machine-generated Material 3 token files (`material-components/material-web` @ `tokens/versions/v0_192/`), which are the M3 spec in typed form — full type scale, color-role→tonal-tone map for light and dark, elevation shadow geometry, state-layer opacities, shape scale, and component tokens for navigation drawer, navigation rail, list, data table, top app bar, cards, divider, search bar. (3) **Shell behavior** comes from Google-published prose (help pages + Workspace Updates blog posts). Two honest limits, stated in full below: `admin.google.com` is not fetchable (302 to a bot check) so **no number here is a measurement of the live console**, and I could **not** verify that the shipped console uses M3 tokens — its nav redesign shipped July 2021, before M3's web rollout.

## Findings
to# Reference spec — Google Admin console shell

## 0. Provenance and what I am NOT asserting

Read this first; it determines how much weight each later number carries.

| Tag | Meaning | Source |
|---|---|---|
| `[M3]` | Exact value from Google's machine-generated Material 3 token files. Header reads `THIS FILE WAS AUTOMATICALLY GENERATED … Design system display name: Google Material 3 … version: v0.192 … Platform: "Web"`. | `raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/*.scss` |
| `[GOOG]` | Stated in Google-published prose I fetched. | `knowledge.workspace.google.com/admin/*`, `workspaceupdates.googleblog.com` |
| `[HARVEST]` | Derived by me from 2,191 literal console nav strings across 1,890 official help articles. | crawl described in §2 |
| `[TENURE]` | Read from this repo. | `apps/web/src/app/globals.css` |
| `[UNVERIFIED]` | I could not confirm it. Treat as a reasoned default, not a fact. | — |

### Three things I must correct or flag

**(a) I could not measure the live console.** `curl https://admin.google.com/` returns `302 → https://www.google.com/sorry/index?continue=...` — a bot interstitial. The Chrome browser tool is not connected in this environment (`Browser extension is not connected`). So **there is not a single measured pixel of admin.google.com in this document.** Every dp/px value below is either the Material 3 specification's value or explicitly marked `[UNVERIFIED]`.

**(b) The brief says "the console is built on [M3]". I could not verify that, and there is public evidence against the strong form of it.** The current left-hand navigation shipped **July 13, 2021** ([GOOG], Workspace Updates), which predates Material 3's web rollout. The console's product logo asset is still versioned `admin_2020q4` (seen in the help-page `<img>` src). The console's visible chrome is Google Sans + Google blue, not a dynamic-color M3 theme. What I can defend: M3 is Google's current published design system, the console is unmistakably Material-family, and M3 is the correct *specification to build against* — but the M3 numbers in §3–§5 are the spec's, **not** measurements of the console. Do not tell anyone "this is what admin.google.com does" on the strength of §3–§5. §1, §2 and §6 are the parts that genuinely describe the console.

**(c) The M3 pages the brief asked me to fetch are not fetchable.** `m3.material.io` is an Angular SPA (`/static/angular/main.4dfe169d936f254a.js`, 509 KB; the HTML body carries no content, only `<meta name="description">`). `m2.material.io` is the same. WebFetch returns "the content section shows only a title". **I therefore substituted the token files that the M3 site is generated from**, which are strictly better for this purpose: they are the same values in a form you can paste into code. The one thing I lost by this substitution is M3's *layout* guidance (pane margins, gutters, max content width) — that lives only in prose on the SPA. It is marked `[UNVERIFIED]` in §3.4 and is the single largest gap in this spec.

---

## 1. Shell anatomy

### 1.1 What is confirmed about the console's shell

- **The left navigation is a persistent, collapsible drawer — not a rail.** "You can use the side navigation menu to quickly find your way to key pages in the Admin console without losing your place." "As you browse, the side menu remains visible, allowing you to keep track of where you are." `[GOOG]` — `knowledge.workspace.google.com/admin/getting-started/navigate-the-admin-console`
- **Collapse control is a Menu (hamburger) icon at the top-left of the section.** "You can collapse and expand the navigation menu by clicking Menu ▸ in the top left of the section." `[GOOG]` — same page. Confirmed independently by the launch post: "You can easily collapse the navigation bar by selecting the menu icon at the top left when you need more space on the page." `[GOOG]` — Workspace Updates, 2021-07-13.
- **Nesting is in-place accordion disclosure, not flyout.** "The side navigation menu groups options based on commonly used services, such as Directory and Security. You can quickly browse the Admin console by clicking these names in the navigation menu to reveal further options and pages." `[GOOG]` — navigate-the-admin-console.
- **A pinned section sits at the top of the nav, capacity 5.** "You can pin your most frequently used pages and tasks to the navigation menu for quick access. You can pin up to 5 pages and access them from the **Pinned** list. To pin a page, point to the page name in the navigation menu and click Pin. To remove a page, point to the page in the Pinned list and click Remove." `[GOOG]` — navigate-the-admin-console; launch post 2023-07.
- **Each top-level category has its own icon**, aligned to the wider Google icon set: "You'll also notice updated icons for each category, bringing the Admin console design inline with other Google products." `[GOOG]` — Workspace Updates 2021-07-13.
- **Top bar carries a unified search box** over Users, Groups, Features, Settings, Devices, Meetings, and Meeting room hardware. Results are narrowed by **filter chips** at the top of the result list ("click a search filter chip, such as **Users** or **Settings**"), carry a trailing **Help articles** section, and may include an **AI overview**. `[GOOG]` — `knowledge.workspace.google.com/admin/getting-started/search-in-the-admin-console`
- **Top bar carries alert-center notifications**: the security launch post links "View Alert Center notifications directly from the Admin console **toolbar**". `[GOOG]` — Workspace Updates 2021-10-28.
- **Search results include "Features" = deep links into the nav tree.** "if you want to review daily activity of managed devices, enter *Mobile device reports*, and you'll get a direct link to **Reporting ▸ Apps Reports ▸ Devices ▸ Mobile**." `[GOOG]` — search-in-the-admin-console. This is a real product requirement: search must resolve to nav coordinates, not just pages.

`[UNVERIFIED]`: exact top-bar height; presence/position of the Google apps launcher and account avatar (near-certain from One Google convention, but I did not confirm it for this console); whether the search box is centered or left-aligned; nav width in px.

### 1.2 M3 values to build the shell from `[M3]`

Navigation drawer — `tokens/versions/v0_192/_md-comp-navigation-drawer.scss`:

| Token | Value |
|---|---|
| `container-width` | **360px** |
| `container-height` | 100% |
| `container-shape` | `corner-large-end` = `0px 16px 16px 0px` |
| `standard-container-color` | `surface` |
| `standard-container-elevation` | `level0` (flat — a standard drawer casts no shadow) |
| `modal-container-color` | `surface-container-low` |
| `modal-container-elevation` | `level1` |
| `active-indicator-width` | **336px** (= 360 − 12 − 12 inset) |
| `active-indicator-height` | **56px** |
| `active-indicator-shape` | `corner-full` = 9999px (full pill) |
| `active-indicator-color` | **`secondary-container`** |
| `active-icon-color` / `active-label-text-color` | **`on-secondary-container`** |
| `active-label-text-weight` | `label-large-weight-prominent` = **700** |
| `inactive-icon-color` / `inactive-label-text-color` | `on-surface-variant` |
| `inactive-hover-*` / `inactive-pressed-*` text+icon | `on-surface` |
| `label-text-size` / `-weight` | `label-large` = **14px / 500** |
| `icon-size` | **24px** |
| `headline-*` (section header) | `title-small` = **14px / 20px / 500**, color `on-surface-variant` |
| `bottom-container-shape` | `corner-large-top` |

**This is the single most important paragraph in the spec.** The selected item in M3 is *not* a left border, a tinted row, or a background-color change on a square row. It is a **56px-tall, fully-rounded pill, 336px wide, filled `secondary-container`, with 700-weight `on-secondary-container` label.** Getting this one shape right is most of what makes a nav read as Google's.

Navigation **rail** (the collapsed form, if you choose a rail rather than an icon-only drawer) — `_md-comp-navigation-rail.scss`:

| Token | Value |
|---|---|
| `container-width` | **80px** |
| `container-color` | `surface`, `container-elevation` `level0`, `container-shape` `corner-none` |
| `active-indicator-width × height` | **56 × 32px**, `corner-full` |
| `icon-size` | 24px |
| `label-text-*` | `label-medium` = **12px / 16px / 500** |

Note the rail's indicator (56×32 pill around the icon only) is a *different shape* from the drawer's (336×56 pill around icon+label). If you collapse a drawer to a rail you must swap the indicator geometry, not just hide the labels.

Top app bar, small — `_md-comp-top-app-bar-small.scss`:

| Token | Value |
|---|---|
| `container-height` | **64px** |
| `container-color` | `surface` |
| `container-elevation` | `level0` — **flat at rest** |
| `on-scroll-container-color` | **`surface-container`** |
| `on-scroll-container-elevation` | **`level2`** |
| `headline-*` | `title-large` = **22px / 28px / 400** |
| `headline-color` | `on-surface` |
| `leading-icon-color` | `on-surface`; `leading-icon-size` 24px |
| `trailing-icon-color` | `on-surface-variant` |
| `container-shape` | `corner-none` |

Medium variant = **112px**, headline `headline-small` (24px). Large variant = **152px**, headline `headline-medium` (28px). Both `level0`, `surface`.

The scroll behavior is the notable bit: the bar is **invisible until you scroll**, then gains `surface-container` fill and a level-2 shadow. Implement it as a scroll listener toggling a class, not as a permanent border.

Search bar — `_md-comp-search-bar.scss`: `container-height` **56px**, `container-shape` `corner-full`, `container-color` **`surface-container-high`**, `container-elevation` **`level3`**, `leading-icon-color` `on-surface`, `avatar-size` 30px. So a Google search field is a **56px fully-round pill on an elevated tonal surface** — not an outlined rectangle.

---

## 2. The navigation tree — the IA model to copy

### 2.1 How this was obtained (this is the load-bearing part of the spec)

`support.google.com/a/answer/*` now 301-redirects to `knowledge.workspace.google.com`, which — unlike `m3.material.io` — is **server-rendered devsite HTML**. Every procedural help article writes console paths in a fixed form:

> "In the Google Admin console, go to Menu `<img …/menu.svg>` **Directory** `<img …/and-then.svg>` **Users**."

Method: harvested article URLs from the 13 admin section indexes (`/admin/users`, `/admin/services`, `/admin/apps`, `/admin/billing`, `/admin/migrate`, `/admin/sync`, `/admin/devices`, `/admin/domains`, `/admin/generative-ai`, `/admin/reports`, `/admin/security`, `/admin/support`, `/admin/getting-started`) → **1,890 unique URLs**; fetched all of them; newline-flattened each and matched `go to Menu.{0,900}`; stripped `<img>`/tag separators; truncated each chain at the first non-title token. Result: **2,191 path instances → 191 distinct paths**, merged into the tree below.

**Caveat you must respect when implementing:** levels 1–3 are reliably left-nav nodes. **Level 4 is frequently an in-page tab or settings card, not a nav node** — e.g. `Apps ▸ Google Workspace ▸ Gmail ▸ Routing` — "Routing" is a section of the Gmail settings page. Google's help prose uses one separator glyph for both, so I cannot mechanically tell them apart. Treat depth-4 entries as *candidate* leaves.

Two entries in the harvest are **not** Admin console and should be dropped: `APIs & Services ▸ Credentials` and `IAM & Admin ▸ Manage resources` are Google **Cloud** console paths that appear in Workspace help articles about service accounts.

### 2.2 The tree `[HARVEST]`

Top level — **12 categories** (10 core + 2 conditional):

`Home` · `Directory` · `Devices` · `Apps` · `Chrome browser` · `Generative AI` · `Security` · `Reporting` · `Billing` · `Account` · `Rules` · `Data` · `Storage`

(`Home` is the landing page, evidenced separately in §2.3; `Chrome browser` was promoted to top level 2023-10-03 `[GOOG]`; `Generative AI` is recent and edition-gated.)

```
Directory
  Users
  Groups
  Target audiences
  Guests
  External directories
  Directory settings
  Buildings and resources
    Overview · Manage resources · Room settings · Room insights

Devices
  Overview
  Mobile & endpoints
    Devices · Device approvals · Company owned inventory
    Enrollment          → Android zero-touch enrollment
    Settings            → Universal · Android · iOS · Windows · Third-party integrations
  Networks
  Google Meet hardware
    Devices · Settings → Device settings

Apps
  Overview
  Google Workspace
    Calendar · Cloud Search · Drive and Docs · Gmail · Google Chat · Google Meet
    Google Voice · Groups for Business · Keep · Sites · Tasks · AppSheet
    Google Vids · Work Insights · Workspace Studio · Google Workspace LTI · Service status
      Drive and Docs → Features and Applications · Templates · Google Drive for desktop
                       Google Forms · Google Vids
      Gmail          → Setup · User settings · Routing · Default routing · Hosts
                       Compliance · Safety · Spam, Phishing and Malware
                       Manage quarantines · End User Access
  Additional Google services
    YouTube · Classroom · Chrome Web Store · Google Alerts · Google Books · Google Home
    Merchant Center · Campaign Manager · Google Ad Manager · Search Ads 360
    Programmable Search Engine · Scholar Profiles · Socratic · Applied Digital Skills
    Play Books Partner Center · Studio · Google Flow · Data Studio
  Web and mobile apps
  Google Workspace Marketplace apps
    Apps list

Chrome browser
  Connectors            (top-level since 2023-10-03; previously Devices ▸ Chrome ▸ Managed browsers)

Generative AI
  AI control center
  Gemini app · Gemini Notebook · Gemini for Workspace
  Gemini Enterprise     → Business edition
  Gemini reports        → Org-level usage · User-level usage

Security
  Overview                                  (renamed from "Security Settings" 2021-10-28)
  Alert center
  Security advisor
  Authentication                            (subcategory added 2021-10-28)
    2-step verification · Account recovery · Advanced Protection Program
    Login challenges · Password management · Passwordless
    SSO with SAML applications · SSO with third party IdP
    Multi-party approval requests · Multi-party approval settings
  Access and data control                   (subcategory added 2021-10-28)
    API controls → Manage App Access · Manage Third-Party App Access
                   Manage Domain Wide Delegation
    Context-Aware Access · Data protection · Data classification · Label manager
    Client-side encryption · Google Session control · Google Cloud session control
  Security center                           (subcategory added 2021-10-28)
    Dashboard · Investigation tool · Security health

Reporting
  Overview
  Apps reports         → User activity · Devices ▸ Mobile
  User Reports         → Accounts · Apps usage · Security
  Audit and investigation
    ~35 log-event streams: Admin · Admin data action · Access Evaluation · Calendar
    Chat · Chrome · Chrome Sync · Classroom · Cloud Search · Contacts
    Context Aware Access · Data Migration · Data Studio · Device · Directory Sync
    Drive · Gemini for Workspace · Gmail · Google Workspace Quota · Graduation
    Groups · Groups Enterprise · Keep · Meet · OAuth · Policy compliance · Profile
    Rule · SAML · Takeout · Tasks · User · Vault · Voice
  Email Log Search
  Carbon footprint
  Google Workspace Apps Monthly Uptime
  Data integrations    → BigQuery export

Billing
  Subscriptions · Buy or upgrade · Payment accounts
  License settings · User upgrade settings

Account
  Admin roles
  Domains              → Manage domains · Allowlisted domains
  Account settings     → Profile · Preferences · Personalization
                         Legal and compliance · Account management · Custom URLs
                         Conflicting accounts management
                         Smart features for Google Workspace
  Reseller management

Rules
  Create rule → Data protection
  Templates

Data
  Compliance           → Access Management · Client-side encryption
  Data import & export → Data import (→ Advanced) · Data export · Google Takeout

Storage
```

### 2.3 Home page `[GOOG]`

`knowledge.workspace.google.com/admin/getting-started/admin-console-map` lists Home as a **grid of feature cards**, each card = title + one-sentence description + link. The published set:

`Users` · `Billing` · `Discover` · `Product updates` · `Domains` · `Alerts` · `Chrome Enterprise Core` · `Groups` · `Devices` · `Organizational units` · `Reporting` · `Directory Sync` · `Apps` · `Admin roles` · `Account settings` · `Support` · `Security` · `Buildings and resources` · `Rules` · `Storage`

Two IA lessons worth copying:

1. **Home is a shortcut surface, not a mirror of the nav.** `Organizational units`, `Discover`, `Product updates`, `Alerts`, `Support`, `Directory Sync` are Home cards that are *not* top-level nav categories. Home surfaces the 20 most-common destinations regardless of where they sit in the tree.
2. **The tree is permission-filtered, not permission-disabled.** "Your administrator privileges determine which features are available to you… an admin with the Users privilege can only perform actions on users, so they don't see all the features, such as Billing." `[GOOG]` Items the user cannot access are **absent**, not greyed. Design the nav data model so nodes are filtered server-side by entitlement.

---

## 3. Density and breathing room

### 3.1 Lists `[M3]` — `_md-comp-list.scss`

| Token | Value |
|---|---|
| `list-item-one-line-container-height` | **56px** |
| `list-item-two-line-container-height` | **72px** |
| `list-item-three-line-container-height` | **88px** |
| `list-item-leading-space` | **16px** |
| `list-item-trailing-space` | **16px** |
| `divider-leading-space` / `divider-trailing-space` | **16px** / 16px |
| `list-item-leading-icon-size` / `trailing-icon-size` | 24px / 24px |
| `list-item-leading-avatar-size` | 40px, `corner-full`, fill `primary-container`, label `on-primary-container` @ `title-medium` |
| `list-item-leading-image-width × height` | 56 × 56px |
| `list-item-label-text` | `body-large` = **16px / 24px / 400**, color `on-surface` |
| `list-item-supporting-text` | `body-medium` = **14px / 20px / 400**, color `on-surface-variant` |
| `list-item-overline` | `label-small` = 11px / 16px / 500, color `on-surface-variant` |
| `list-item-container-color` | `surface`, elevation `level0`, shape `corner-none` |
| `list-item-selected-trailing-icon-color` | `primary` |
| disabled label opacity / icon opacity | 0.3 / 0.38 |

So: **a Google list row is 56px, with 16px horizontal padding on both sides, and its dividers are inset 16px from each edge.** The primary text is 16px, the supporting text 14px in `on-surface-variant`.

### 3.2 Tables `[M3]` — `_md-comp-data-table.scss`

| Token | Value |
|---|---|
| `header-container-height` | **56px** |
| `row-item-container-height` | **52px** |
| `footer-container-height` | **52px** |
| `container-shape` | `corner-extra-small` = **4px** |
| `header-container-color` / `row-item-unselected-container-color` / `footer-container-color` | `surface` |
| `header-headline` | **`title-small`** = 14px / 20px / **500**, color **`on-surface-variant`** |
| `header-hover-headline-color` | `on-surface` |
| `row-item-label-text` | **`body-medium`** = 14px / 20px / 400, color `on-surface` |
| `row-item-outline-color` / `outline-color` | **`outline-variant`** |
| `row-item-outline-width` / `outline-width` | **1px** |
| `row-item-selected-container-color` | **`surface-container-highest`** |
| `row-item-selected-hover-state-layer` | `on-surface` @ `hover-state-layer-opacity` (0.08) |
| `footer-supporting-text` | `body-medium`, `on-surface-variant` |
| `row-item-disabled-label-text-opacity` | 0.38 |

Note the asymmetry, which is deliberate and worth copying exactly: **header 56px, body rows 52px.** The header is *not* bolder-and-bigger; it is `title-small` at 500 weight in the *dimmer* `on-surface-variant`, while body cells are 400 weight in the *brighter* `on-surface`. The data outranks its own column labels. Row separation is a 1px `outline-variant` rule, not zebra striping.

`[UNVERIFIED]`: M3 does not expose a data-table **cell horizontal padding** token in v0.192. 16px (matching `list-item-leading-space`) is the consistent choice; 24px for the first column is the common Google pattern. I could not confirm either.

### 3.3 The 4dp grid `[M3]`, inferred but strongly

M3 does not ship a `spacing` token set, so I cannot quote one. But **every** size token I extracted is a multiple of 4: 24, 32, 40, 52, 56, 64, 72, 80, 88, 112, 152, 336, 360. The only exceptions are the 1px hairlines, the 11px `label-small`, and the 30px search avatar. The 4dp grid is real; it is expressed through component tokens rather than a named scale.

Minimum touch target = **48px**, confirmed in implementation source: `checkbox/internal/_checkbox.scss` L74/79 `height: 48px; width: 48px;` and `margin: max(0px, ((48px - container-size) / 2))`; same construction in `radio/` and `switch/`. `[M3]`

Shape scale `[M3]` — `_md-sys-shape.scss`:

```
corner-none        0px
corner-extra-small 4px      corner-extra-small-top 4px 4px 0 0
corner-small       8px
corner-medium      12px
corner-large       16px     corner-large-top 16px 16px 0 0
                            corner-large-start 16px 0 0 16px
                            corner-large-end   0 16px 16px 0
corner-extra-large 28px     corner-extra-large-top 28px 28px 0 0
corner-full        9999px
```

Cards are `corner-medium` (**12px**). Tables are `corner-extra-small` (**4px**). Nav pills and search are `corner-full`.

### 3.4 Page gutters, max content width, title→description→card rhythm

**`[UNVERIFIED]` — this is the gap.** These values live only in M3's layout prose on the un-fetchable SPA. I will not invent them.

What I can offer as a defensible default, clearly marked as *my* recommendation and not Google's:

- Page gutter: **24px** at ≥840px viewport, **16px** below it. Rationale: these are the two gutter values M3's predecessor (Material 2 responsive grid) used, and 16/24 are the only 4-grid values that fall out of the 16px list inset and 24px `body-large` line height. I could not verify M3 restates them.
- Max content width: **no cap, or 1440px.** Rationale: the console's primary surface is tables (§6), and capping a table's width wastes the columns admins came for. I could not verify a Google value.
- Title → description → first card: title `headline-small` (24px/32px) → **8px** → description `body-medium` (14px/20px) in `on-surface-variant` → **24px** → first card. Rationale: 8px is the sub-4-grid step that reads as "same block"; 24px is the step that reads as "new block". Unverified.

Window size class breakpoints `[GOOG]` — from `developer.android.com/develop/ui/compose/layouts/adaptive/window-size-classes`, which *is* server-rendered:

| Class | Width |
|---|---|
| Compact | < 600dp |
| Medium | 600 – 839dp |
| Expanded | 840 – 1199dp |
| Large | 1200 – 1599dp |
| Extra-large | ≥ 1600dp |

For an admin console: drawer permanently open at Expanded and up; collapsed to rail at Medium; modal drawer over a scrim at Compact.

---

## 4. Type scale `[M3]`

Complete, from `_md-sys-typescale.scss` + `_md-ref-typeface.scss`. Rem→px at 16px root. Tracking converted to px.

| Role | Size | Line height | Weight | Tracking | Face |
|---|---|---|---|---|---|
| `display-large` | 57px (3.5625rem) | 64px | 400 | −0.25px | brand |
| `display-medium` | 45px (2.8125rem) | 52px | 400 | 0 | brand |
| `display-small` | 36px (2.25rem) | 44px | 400 | 0 | brand |
| `headline-large` | 32px (2rem) | 40px | 400 | 0 | brand |
| `headline-medium` | 28px (1.75rem) | 36px | 400 | 0 | brand |
| `headline-small` | 24px (1.5rem) | 32px | 400 | 0 | brand |
| `title-large` | 22px (1.375rem) | 28px | 400 | 0 | brand |
| `title-medium` | 16px (1rem) | 24px | **500** | 0.15px | plain |
| `title-small` | 14px (0.875rem) | 20px | **500** | 0.1px | plain |
| `body-large` | 16px (1rem) | 24px | 400 | 0.5px | plain |
| `body-medium` | 14px (0.875rem) | 20px | 400 | 0.25px | plain |
| `body-small` | 12px (0.75rem) | 16px | 400 | 0.4px | plain |
| `label-large` | 14px (0.875rem) | 20px | **500** | 0.1px | plain |
| `label-medium` | 12px (0.75rem) | 16px | **500** | 0.5px | plain |
| `label-small` | **11px** (0.6875rem) | 16px | **500** | 0.5px | plain |

`weight-regular: 400`, `weight-medium: 500`, `weight-bold: 700`. `brand` and `plain` both resolve to **Roboto** in the open-source token set; Google's first-party products substitute **Google Sans** for `brand` and Roboto for `plain`. `label-large-weight-prominent` and `label-medium-weight-prominent` = **700** (used by the drawer's active item).

**Roles actually used by the shell components in this spec:**

- `title-large` (22/28/400) — top app bar headline
- `title-small` (14/20/500) — nav drawer **section headers**, table **column headers**
- `label-large` (14/20/500; **700** when active) — nav drawer **item labels**
- `label-medium` (12/16/500) — nav rail item labels
- `label-small` (11/16/500) — list overline, table trailing supporting text
- `body-large` (16/24/400) — list item primary text
- `body-medium` (14/20/400) — **table cell text**, list supporting text, table footer
- `title-medium` (16/24/500) — avatar initials
- `headline-small` (24/32/400) — medium top-app-bar headline; the natural page-title role

Note what is *absent*: no `display-*` role appears anywhere in a shell component. A 57px number has no place in an admin console.

---

## 5. Color and mode `[M3]`

### 5.1 The role names — exhaustive, from `_md-sys-color.scss`

```
primary  on-primary  primary-container  on-primary-container
         primary-fixed  primary-fixed-dim  on-primary-fixed  on-primary-fixed-variant
secondary  on-secondary  secondary-container  on-secondary-container
         secondary-fixed  secondary-fixed-dim  on-secondary-fixed  on-secondary-fixed-variant
tertiary   on-tertiary   tertiary-container   on-tertiary-container
         tertiary-fixed  tertiary-fixed-dim  on-tertiary-fixed  on-tertiary-fixed-variant
error      on-error      error-container      on-error-container
surface  on-surface  surface-variant  on-surface-variant
surface-dim  surface-bright
surface-container-lowest  surface-container-low  surface-container
surface-container-high    surface-container-highest
background  on-background
outline  outline-variant
inverse-surface  inverse-on-surface  inverse-primary
surface-tint  shadow  scrim
```

### 5.2 Role → tonal-palette tone, light and dark `[M3]`

This table is the whole of §5. It is what lets you generate a Tenure-green theme mechanically instead of hand-picking hexes.

| Role | Light | Dark |
|---|---|---|
| `primary` | primary**40** | primary**80** |
| `on-primary` | primary100 | primary20 |
| `primary-container` | primary90 | primary30 |
| `on-primary-container` | primary10 | primary90 |
| `secondary` | secondary40 | secondary80 |
| `on-secondary` | secondary100 | secondary20 |
| **`secondary-container`** | **secondary90** | **secondary30** |
| **`on-secondary-container`** | **secondary10** | **secondary90** |
| `tertiary` | tertiary40 | tertiary80 |
| `tertiary-container` | tertiary90 | tertiary30 |
| `on-tertiary-container` | tertiary10 | tertiary90 |
| `error` | error40 | error80 |
| `error-container` | error90 | error30 |
| `on-error-container` | error10 | error90 |
| **`surface`** | **neutral98** | **neutral6** |
| `surface-dim` | neutral87 | neutral6 |
| `surface-bright` | neutral98 | neutral24 |
| `surface-container-lowest` | neutral100 | neutral4 |
| `surface-container-low` | neutral96 | neutral10 |
| `surface-container` | neutral94 | neutral12 |
| `surface-container-high` | neutral92 | neutral17 |
| `surface-container-highest` | neutral90 | neutral22 |
| `surface-variant` | neutral-variant90 | neutral-variant30 |
| **`on-surface`** | **neutral10** | **neutral90** |
| **`on-surface-variant`** | **neutral-variant30** | **neutral-variant80** |
| `background` / `on-background` | neutral98 / neutral10 | neutral6 / neutral90 |
| **`outline`** | **neutral-variant50** | **neutral-variant60** |
| **`outline-variant`** | **neutral-variant80** | **neutral-variant30** |
| `inverse-surface` / `inverse-on-surface` | neutral20 / neutral95 | neutral90 / neutral20 |
| `inverse-primary` | primary80 | primary40 |
| `surface-tint` | primary40 | primary80 |
| `shadow` / `scrim` | neutral0 | neutral0 |

Baseline neutral hexes `[M3]` (`_md-ref-palette.scss`) — use these to sanity-check your generated ramp:

```
neutral0  #000000   neutral4  #0f0d13   neutral6  #141218   neutral10 #1d1b20
neutral12 #211f26   neutral17 #2b2930   neutral20 #322f35   neutral22 #36343b
neutral24 #3b383e   neutral30 #48464c   neutral40 #605d64   neutral50 #79767d
neutral60 #938f96   neutral70 #aea9b1   neutral80 #cac5cd   neutral87 #ded8e1
neutral90 #e6e0e9   neutral92 #ece6f0   neutral94 #f3edf7   neutral95 #f5eff7
neutral96 #f7f2fa   neutral98 #fef7ff   neutral99 #fffbff   neutral100 #ffffff

neutral-variant30 #49454f   neutral-variant50 #79747e
neutral-variant60 #938f99   neutral-variant80 #cac4d0   neutral-variant90 #e7e0ec
```

**How dark mode works in M3 — the thing implementers get wrong.** Dark mode is *not* "swap black and white." Two structural inversions:

1. **`surface-container-*` is a ladder of real fills, and its direction reverses.** Light: lowest=100 → highest=90, i.e. the elevated container gets *darker*. Dark: lowest=4 → highest=22, the elevated container gets *lighter*. The gaps in dark are tiny (4→10→12→17→22 = 6, 2, 5, 5 tones); do not "improve" them by widening.
2. **`outline-variant` crosses the middle**: neutral-variant**80** in light (a pale hairline on a bright ground) → neutral-variant**30** in dark (a dark hairline on a dark ground). If you invert it naively your table rules will glow.

Also note `surface` light = neutral98 = `#fef7ff`, **not** `#ffffff`, and dark = neutral6 = `#141218`, **not** `#000`. M3 surfaces are tinted toward the primary hue. With Tenure green as the seed, your light surface will be very faintly green-tinted, and that is correct M3 behavior.

### 5.3 Elevation `[M3]`

Level → dp: `level0: 0`, `level1: 1`, `level2: 3`, `level3: 6`, `level4: 8`, `level5: 12` (`_md-sys-elevation.scss`).

The rendered shadow is **two stacked box-shadows** with fixed opacities, from `elevation/internal/_elevation.scss` (the comments in that file enumerate every level exactly):

- **Key shadow** — `opacity: 0.3`, color = `shadow` (neutral0 = `#000`)
- **Ambient shadow** — `opacity: 0.15`, same color

| Level | Key `x y blur spread` | Ambient `x y blur spread` |
|---|---|---|
| 0 | `0 0 0 0` | `0 0 0 0` |
| 1 | `0 1px 2px 0` | `0 1px 3px 1px` |
| 2 | `0 1px 2px 0` | `0 2px 6px 2px` |
| 3 | `0 1px 3px 0` | `0 4px 8px 3px` |
| 4 | `0 2px 3px 0` | `0 6px 10px 4px` |
| 5 | `0 4px 4px 0` | `0 8px 12px 6px` |

Directly usable:
```css
--elev-1: 0 1px 2px 0 rgba(0,0,0,.3), 0 1px 3px 1px rgba(0,0,0,.15);
--elev-2: 0 1px 2px 0 rgba(0,0,0,.3), 0 2px 6px 2px rgba(0,0,0,.15);
--elev-3: 0 1px 3px 0 rgba(0,0,0,.3), 0 4px 8px 3px rgba(0,0,0,.15);
--elev-4: 0 2px 3px 0 rgba(0,0,0,.3), 0 6px 10px 4px rgba(0,0,0,.15);
--elev-5: 0 4px 4px 0 rgba(0,0,0,.3), 0 8px 12px 6px rgba(0,0,0,.15);
```

**In dark mode M3 conveys elevation by tonal fill (`surface-container-*`), not by shadow** — the shadow is nearly invisible against a dark ground. Both mechanisms exist; the container ladder is the one that carries meaning.

### 5.4 State layers `[M3]` — `_md-sys-state.scss`

```
hover-state-layer-opacity   0.08
focus-state-layer-opacity   0.12
pressed-state-layer-opacity 0.12
dragged-state-layer-opacity 0.16
```

A state layer is an **overlay of the element's own `on-*` role at these opacities** — never a separate hover color. Concretely, in the nav drawer: an inactive item hovers with `on-surface` @ 0.08; an **active** item hovers with `on-secondary-container` @ 0.08 *on top of* its `secondary-container` pill (`active-hover-state-layer-color: on-secondary-container`). Two different hover colors depending on selection state. This is why hand-rolled Material clones feel wrong.

### 5.5 Cards `[M3]`

| Variant | Container | Elevation | Hover elev | Outline |
|---|---|---|---|---|
| Elevated | `surface-container-low` | `level1` | `level2` | — |
| Filled | `surface-container-highest` | `level0` | `level1` | — |
| **Outlined** | **`surface`** | **`level0`** | `level1` | **1px `outline-variant`** |

All three: `container-shape: corner-medium` = **12px**, `icon-color: primary`, `icon-size: 24px`. Divider color = `outline-variant`.

**For an admin console, use Outlined.** It is the only variant that is flat and neutral at rest — see §6.

---

## 6. What makes it read "administrative" rather than consumer

Six rules. Each is backed by a token or a Google statement above, not by taste.

**1. Exactly one accent, and it is not the accent you'd expect.** The nav's active pill is `secondary-container` / `on-secondary-container` — **secondary**, not primary. `primary` is reserved for the affirmative action in a page (the "Add new user" button) and for `list-item-selected-trailing-icon-color`. `tertiary` appears in *no* shell component in this spec. An admin console that tints its nav with `primary` has spent its loudest color on furniture.

**2. Neutrals do the structural work.** Count the neutral roles among the shell tokens: `surface`, `surface-container`, `surface-container-low/high/highest`, `on-surface`, `on-surface-variant`, `outline-variant`. The entire hierarchy — bar vs. page vs. card vs. row vs. selected row — is built from **tones of one neutral ramp separated by as little as 2 tones** (dark `surface-container` 12 → `surface-container-high` 17). Restraint here is not minimalism; it is what lets the one accent mean something.

**3. Chrome is flat until it has to prove it's floating.** Top app bar: `level0` at rest, `level2` + `surface-container` fill **only on scroll**. Standard nav drawer: `level0`. Outlined card: `level0`, 1px `outline-variant`. The only level-3 in the whole shell is the search bar. A console that ships with drop shadows on its bar and its cards at rest reads as a consumer app.

**4. Separation is a 1px `outline-variant` hairline, never a fill.** Table: `outline-width: 1px`, `row-item-outline-color: outline-variant`. Divider: `outline-variant`. There is no zebra-stripe token in M3. Selected table rows use `surface-container-highest` — a *tonal step*, not the accent.

**5. Tables are the primary surface, and the data outranks its own labels.** From §3.2: header row 56px in `title-small`/500/**`on-surface-variant`** (dimmer); body rows 52px in `body-medium`/400/**`on-surface`** (brighter). Google reinforced this in product: the 2021-06 launch added an **"Action" column** and a richer **"Status" column** to *Domains ▸ Manage domains*, with actions invocable from inside the cell `[GOOG]`. Bulk operations happen in the table, not in a detail page.

**6. The IA is deep, flat-labelled, and permission-filtered.** 12 top-level items, 3–4 levels, ~35 log-event leaves under one node (§2.2). No dashboard-first framing — `Home` is a card grid of 20 shortcuts and nothing else. Labels are nouns of the domain (`Directory`, `Rules`, `Storage`), never verbs or marketing. And items you lack privilege for are **absent**, not disabled `[GOOG]`.

A seventh, procedural: **heavy tasks open a full-screen dialog, not a new route.** "when selecting 'Add a user', you'll see a new, streamlined fullscreen dialog, which displays the most essential fields first" `[GOOG]`. M3 has a `full-screen-dialog` component token set for exactly this.

---

## 7. Mapping onto what Tenure has today `[TENURE]` + `[M3]`

From `apps/web/src/app/globals.css` (read-only; I changed nothing). This is the delta an implementer faces.

| Concern | Tenure now | M3 spec | Delta |
|---|---|---|---|
| Top bar height | `--shell-height: 52px` | 64px | **+12px** |
| Side nav width | `--sidenav-width: 224px` | 360px drawer / 80px rail | **−136px**; Tenure's is much tighter |
| Collapsed nav | `--sidenav-width-collapsed: 60px` | 80px rail | −20px |
| Spacing scale | `--space-1..16` = 4,8,12,16,20,24,32,40,48,64 | 4dp grid, same multiples | **already aligned** |
| Radius | `--radius-sm/md/lg/xl` = 7/9/13/18px | 4/8/12/16/28px | off-grid by 1–3px throughout |
| Nav active state | `--shell-item-active: rgba(23,24,26,.075)` (neutral tint) | 336×56 `corner-full` pill, `secondary-container`, 700-weight label | **structural rewrite, not a recolor** |
| Hover | `--shell-item-hover: rgba(23,24,26,.045)` | `on-surface` @ **0.08** | Tenure hover is ~half M3's |
| Green | `--tenure-forest-700: #198052` is `--primary` | `primary` = tone **40** of the seed ramp | Tenure already has a 25→950 forest ramp; feed `#2bb673` or `#198052` to an HCT generator, then map tones per §5.2 |
| Surfaces | warm paper ramp (`#faf9f5`, `#f1f0ea`, `#e6e4dd`) | cool `neutral98/96/94/92/90` | Tenure's warm paper is a **deliberate identity choice**, documented in the file's own comments. Adopting M3's *structure* (a 5-step container ladder) matters more than adopting its hues |
| Elevation | 4 hand-tuned shadows, single+double layer | 6 levels, fixed key(0.3)/ambient(0.15) pairs | see §5.3 for drop-ins |
| Dark mode | not read in this pass | full role inversion incl. `outline-variant` crossing the midpoint | verify against §5.2 |

The file also carries a documented WCAG rationale (three border tokens, status hues held to 3:1 fill / 4.5:1 text) and a z-layer contract asserted by `src/app/design-contracts.test.ts`. **Do not discard those when adopting M3 roles** — M3's baseline pairs are contrast-checked for its own palette, not for Tenure green on warm paper.

## Concrete values
SHELL (M3 tokens, v0.192)
- top app bar small: height 64px, color surface, elevation level0, headline title-large 22/28/400 on-surface, leading icon 24px on-surface, trailing icon on-surface-variant; on scroll: surface-container + level2. medium 112px (headline-small 24px), large 152px (headline-medium 28px).
- navigation drawer: container-width 360px, height 100%, shape corner-large-end (0 16px 16px 0), standard color surface / elevation level0, modal color surface-container-low / elevation level1.
- drawer ACTIVE item: indicator 336x56px, corner-full (9999px), fill secondary-container, icon+label on-secondary-container, label weight 700 (label-large-weight-prominent), size 14px.
- drawer INACTIVE item: icon+label on-surface-variant; hover/pressed text+icon on-surface. label-large 14px/500. icon-size 24px.
- drawer section header: title-small 14/20/500, color on-surface-variant.
- navigation rail: width 80px, indicator 56x32 corner-full, icon 24px, label label-medium 12/16/500, color surface, elevation level0.
- search bar: height 56px, corner-full, fill surface-container-high, elevation level3, leading icon on-surface, avatar 30px.

LISTS
one-line 56px / two-line 72px / three-line 88px; leading-space 16px; trailing-space 16px; divider inset 16px/16px; leading icon 24px; avatar 40px corner-full (primary-container / on-primary-container, title-medium); leading image 56x56; label body-large 16/24/400 on-surface; supporting body-medium 14/20/400 on-surface-variant; overline label-small 11/16/500; container surface, level0, corner-none; selected trailing icon primary; disabled label opacity .3, icon .38.

TABLES
header height 56px; row height 52px; footer height 52px; container shape corner-extra-small 4px; header/row/footer fill surface; header text title-small 14/20/500 on-surface-variant (hover -> on-surface); cell text body-medium 14/20/400 on-surface; outline + row outline 1px outline-variant; selected row surface-container-highest; selected-row hover on-surface @0.08; disabled label opacity .38.

TYPE SCALE (px @16px root; tracking in px)
display-large 57/64/400/-0.25 brand; display-medium 45/52/400/0 brand; display-small 36/44/400/0 brand
headline-large 32/40/400/0 brand; headline-medium 28/36/400/0 brand; headline-small 24/32/400/0 brand
title-large 22/28/400/0 brand; title-medium 16/24/500/0.15 plain; title-small 14/20/500/0.1 plain
body-large 16/24/400/0.5 plain; body-medium 14/20/400/0.25 plain; body-small 12/16/400/0.4 plain
label-large 14/20/500/0.1 plain (prominent 700); label-medium 12/16/500/0.5 plain (prominent 700); label-small 11/16/500/0.5 plain
weights: regular 400, medium 500, bold 700. brand/plain = Roboto in OSS tokens (Google Sans for brand in 1P).

SHAPE
corner-none 0; extra-small 4px; small 8px; medium 12px; large 16px; extra-large 28px; full 9999px
corner-large-end 0 16 16 0; corner-large-top 16 16 0 0; corner-large-start 16 0 0 16; corner-extra-small-top 4 4 0 0; corner-extra-large-top 28 28 0 0

ELEVATION dp: level0 0, level1 1, level2 3, level3 6, level4 8, level5 12
box-shadow (key opacity .3 + ambient opacity .15, color #000):
L1: 0 1px 2px 0 / 0 1px 3px 1px
L2: 0 1px 2px 0 / 0 2px 6px 2px
L3: 0 1px 3px 0 / 0 4px 8px 3px
L4: 0 2px 3px 0 / 0 6px 10px 4px
L5: 0 4px 4px 0 / 0 8px 12px 6px

STATE LAYER OPACITIES: hover .08, focus .12, pressed .12, dragged .16
TOUCH TARGET: 48x48px minimum

COLOR ROLE -> TONE (light | dark)
primary 40|80; on-primary 100|20; primary-container 90|30; on-primary-container 10|90
secondary 40|80; on-secondary 100|20; secondary-container 90|30; on-secondary-container 10|90
tertiary 40|80; tertiary-container 90|30; on-tertiary-container 10|90
error 40|80; error-container 90|30; on-error-container 10|90
surface neutral98|neutral6; surface-dim neutral87|neutral6; surface-bright neutral98|neutral24
surface-container-lowest neutral100|neutral4; -low neutral96|neutral10; surface-container neutral94|neutral12; -high neutral92|neutral17; -highest neutral90|neutral22
surface-variant nv90|nv30; on-surface neutral10|neutral90; on-surface-variant nv30|nv80
background neutral98|neutral6; on-background neutral10|neutral90
outline nv50|nv60; outline-variant nv80|nv30
inverse-surface neutral20|neutral90; inverse-on-surface neutral95|neutral20; inverse-primary primary80|primary40
surface-tint primary40|primary80; shadow neutral0; scrim neutral0

BASELINE NEUTRAL HEXES
neutral0 #000000, 4 #0f0d13, 6 #141218, 10 #1d1b20, 12 #211f26, 17 #2b2930, 20 #322f35, 22 #36343b, 24 #3b383e, 30 #48464c, 40 #605d64, 50 #79767d, 60 #938f96, 70 #aea9b1, 80 #cac5cd, 87 #ded8e1, 90 #e6e0e9, 92 #ece6f0, 94 #f3edf7, 95 #f5eff7, 96 #f7f2fa, 98 #fef7ff, 99 #fffbff, 100 #ffffff
neutral-variant30 #49454f, 50 #79747e, 60 #938f99, 80 #cac4d0, 90 #e7e0ec

CARDS: elevated surface-container-low/level1 (hover level2); filled surface-container-highest/level0 (hover level1); outlined surface/level0 + 1px outline-variant (hover level1). All corner-medium 12px, icon primary 24px. Divider color outline-variant.

WINDOW SIZE CLASSES (dp width): compact <600, medium 600-839, expanded 840-1199, large 1200-1599, extra-large >=1600

ADMIN CONSOLE TOP-LEVEL NAV (harvested from 1,890 official help articles)
Home, Directory, Devices, Apps, Chrome browser, Generative AI, Security, Reporting, Billing, Account, Rules, Data, Storage
Full 3-4 level tree is in findings section 2.2. Home card grid (20 tiles) in 2.3.
Nav behavior: persistent collapsible drawer; hamburger top-left; in-place accordion nesting; Pinned list capped at 5; permission-filtered (missing, not disabled).

TENURE CURRENT (apps/web/src/app/globals.css)
--shell-height 52px; --sidenav-width 224px; --sidenav-width-collapsed 60px; --footer-height 38px
--space-1..16: 4,8,12,16,20,24,32,40,48,64px
--radius-sm/md/lg/xl: 7/9/13/18px; --radius-full 9999px
--primary var(--tenure-forest-700) #198052; forest ramp 25..950 incl. --tenure-forest-500 #2bb673
--shell-item-hover rgba(23,24,26,.045); --shell-item-active rgba(23,24,26,.075)

## Sources
- https://knowledge.workspace.google.com/admin/getting-started/navigate-the-admin-console
- https://knowledge.workspace.google.com/admin/getting-started/admin-console-map
- https://knowledge.workspace.google.com/admin/getting-started/sign-in-to-your-admin-console
- https://knowledge.workspace.google.com/admin/getting-started/search-in-the-admin-console
- https://knowledge.workspace.google.com/admin/users/add-an-account-for-a-new-user
- https://workspaceupdates.googleblog.com/2021/07/improved-admin-console-navigation.html
- https://workspaceupdates.googleblog.com/2021/10/improved-admin-console-security-menu.html
- https://workspaceupdates.googleblog.com/2023/10/admin-console-navigation-update-chrome-browser-management.html
- https://workspaceupdates.googleblog.com/2021/06/improved-experience-for-user-and-domain-management-in-admin-console.html
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-sys-typescale.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-sys-color.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-sys-elevation.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-sys-state.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-sys-shape.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-ref-typeface.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-ref-palette.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-comp-navigation-drawer.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-comp-navigation-rail.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-comp-list.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-comp-data-table.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-comp-top-app-bar-small.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-comp-top-app-bar-medium.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-comp-top-app-bar-large.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-comp-elevated-card.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-comp-outlined-card.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-comp-filled-card.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-comp-divider.scss
- https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-comp-search-bar.scss
- https://raw.githubusercontent.com/material-components/material-web/main/elevation/internal/_elevation.scss
- https://raw.githubusercontent.com/material-components/material-web/main/checkbox/internal/_checkbox.scss
- https://developer.android.com/develop/ui/compose/layouts/adaptive/window-size-classes
- https://developer.android.com/develop/ui/compose/layouts/adaptive/canonical-layouts

## Confidence / not asserted
WHAT I COULD NOT VERIFY — read before typing any number into code.

1. NO NUMBER HERE IS A MEASUREMENT OF admin.google.com. `curl https://admin.google.com/` returns 302 to `https://www.google.com/sorry/index?continue=...` (bot interstitial). The Chrome browser tool returned "Browser extension is not connected." I have no logged-in access and took no screenshots. Every dp/px value in sections 1.2, 3, 4, 5 is the Material 3 specification's value, not the console's.

2. I COULD NOT CONFIRM THE CONSOLE IS BUILT ON M3, and there is public evidence against the strong form of the brief's premise. The current left-hand nav shipped 2021-07-13 (Workspace Updates), before M3's web rollout. The console's product logo asset is still versioned `admin_2020q4` (from the help-page img src). Its chrome is Google Sans + Google blue, not a dynamic-color M3 theme. My position: M3 is the right spec to BUILD AGAINST (it is Google's current published system and the console is Material-family), but do not tell anyone "admin.google.com uses these tokens." Sections 1.1, 2, 6 describe the console from Google's own prose; sections 1.2, 3, 4, 5 describe M3.

3. THE M3 PAGES THE BRIEF NAMED ARE NOT FETCHABLE. m3.material.io is an Angular SPA (/static/angular/main.4dfe169d936f254a.js, 509KB); the served HTML has no content, only meta tags. WebFetch returned "the content section shows only a title." m2.material.io is the same. I substituted the machine-generated token files that the M3 site is generated from (headers read "THIS FILE WAS AUTOMATICALLY GENERATED... Design system display name: Google Material 3... version: v0.192... Platform: Web"). That substitution is strictly better for numeric values but LOSES M3's layout prose.

4. THE BIGGEST REMAINING GAP: page gutters, max content width, and the page-title -> description -> first-card vertical rhythm (brief item 3). These exist only as prose on the un-fetchable SPA. M3 v0.192 ships NO spacing token set and NO layout-margin tokens. I did not invent values; findings 3.4 gives my reasoned defaults (16/24px gutters, no width cap or 1440px, 8px then 24px rhythm) explicitly labelled as MY recommendation, not Google's. Someone with browser access should verify against m3.material.io/foundations/layout/applying-layout.

5. Data-table CELL HORIZONTAL PADDING is not a token in v0.192. I inferred 16px from list-item-leading-space consistency. Unconfirmed.

6. The 4dp grid is INFERRED, not quoted. M3 has no named spacing scale. My evidence: every size token extracted is a multiple of 4 (24,32,40,52,56,64,72,80,88,112,152,336,360), exceptions being 1px hairlines, 11px label-small, 30px search avatar. The 48px touch target IS directly confirmed in implementation source (checkbox/internal/_checkbox.scss L74/79, and identically in radio/ and switch/).

7. NAV TREE DEPTH-4 ENTRIES ARE UNRELIABLE. Google's help prose uses one separator glyph for both left-nav nodes and in-page tabs/sections, so `Apps > Google Workspace > Gmail > Routing` may mean "Routing is a nav node" or "Routing is a card on the Gmail settings page" — I cannot mechanically distinguish. Levels 1-3 are reliable. Treat level 4 as candidate leaves.

8. THE NAV TREE IS A SAMPLE, NOT AN EXPORT. It is the union of paths that 1,890 help articles happen to mention. A nav node no article documents will be missing. It also reflects the max-entitlement view; a real admin sees a filtered subset. Two harvested entries are NOT Admin console and must be dropped: `APIs & Services > Credentials` and `IAM & Admin > Manage resources` are Google CLOUD console paths appearing in Workspace service-account articles.

9. TOP-BAR CONTENTS ARE PARTLY UNCONFIRMED. Grounded: hamburger at top-left; a unified search box over Users/Groups/Features/Settings/Devices/Meetings/Meeting-room-hardware with filter chips, a Help-articles section, and an AI overview; alert-center notifications in the toolbar. NOT confirmed: exact bar height, presence/position of the Google apps launcher and account avatar (near-certain by One Google convention, but I did not verify for THIS console), whether search is centered or left-aligned, and the nav's actual pixel width.

10. FIGURES THAT ARE EXACT AND YOU CAN RELY ON: everything tagged [M3] is a literal value read out of a Google-generated token file, and everything in quotation marks tagged [GOOG] is Google's own published sentence. The crawl numbers are exact: 1,890 URLs fetched, 2,191 `go to Menu` instances, 191 distinct paths.

11. NO GOOGLE-PUBLISHED DESIGN CASE STUDY OF THE ADMIN CONSOLE WAS FOUND. The brief asked for one. My searches surfaced only feature-launch posts on workspaceupdates.googleblog.com, which I used and cited. If one exists I did not find it.

12. REPO STATE: strictly read-only, as instructed. I read CLAUDE.md and apps/web/src/app/globals.css and ran `git status --porcelain` (clean, no output). All scratch files were written to /tmp, never inside the repository. No file was edited, staged, committed, or deleted; no npm or AWS command was run.

## Risks
1. PREMISE RISK (highest). The brief instructs "the console is built on [M3]." I could not verify that and found evidence against the strong form (nav shipped 2021-07, pre-M3 web; logo asset still admin_2020q4; Google Sans + Google blue, not a dynamic-color M3 theme). If downstream work assumes M3 fidelity == Admin-console fidelity, it will produce something that is correct M3 and still does not look like admin.google.com. Mitigation: treat sections 1.1/2/6 (console, Google-sourced) and 1.2/3/4/5 (M3 spec) as separate authorities and never quote the latter as console behavior.

2. DIMENSIONAL MISMATCH. M3's drawer is 360px; Tenure's --sidenav-width is 224px. M3's list rows are 56px and its top bar 64px; Tenure's shell is 52px. M3's defaults are TABLET-FIRST and noticeably airier than an ERP console wants. Adopting 360px/56px wholesale will cost real screen area on a table-primary product. Recommendation: adopt M3's STRUCTURE (pill indicator geometry, tonal container ladder, state-layer opacities, type roles) at Tenure's tighter dimensions, rather than adopting the dp values literally. Whoever implements should make that an explicit, recorded decision, not an accident.

3. LAYOUT GAP FORCES INVENTION. Gutters, max content width, and title/description/card rhythm are unverified (confidence note 4). This is exactly the "somebody will type these numbers into code" hazard the brief warns about. Do not let 3.4's recommendations get laundered into the codebase as "Google's values."

4. NAV-PILL REWRITE IS STRUCTURAL, NOT COSMETIC. Tenure's active state is a neutral tint (rgba(23,24,26,.075)) on a presumably rectangular row. M3's is a 336x56 corner-full pill in secondary-container with a 700-weight label. This is a DOM + geometry change, and it interacts with the 224px vs 360px decision (a 336px indicator cannot live in a 224px drawer — it must be re-derived as width minus 2x12px inset). Sequence the width decision before the indicator work.

5. ACCESSIBILITY REGRESSION RISK. globals.css carries a documented WCAG rationale (three border tokens; --border-control held to 3:1; status hues at 3:1 fill / 4.5:1 text; explicit audit findings GE-022-003 in comments) plus a z-layer contract asserted by src/app/design-contracts.test.ts. M3's baseline role pairs are contrast-verified for M3's OWN palette, not for Tenure green on the warm-paper surfaces. Mechanically swapping to M3 roles can silently drop below the floors that file deliberately established. Re-verify every pair after generating the green ramp, and keep design-contracts.test.ts green.

6. DARK MODE INVERSION TRAP. outline-variant crosses the midpoint (nv80 light -> nv30 dark) and the surface-container ladder REVERSES direction. A naive "invert the palette" dark mode will produce glowing table rules and an inverted elevation reading. The dark-mode container gaps are also very tight (tones 4/10/12/17/22); widening them for "clarity" breaks M3's elevation semantics.

7. SURFACE-TINT SURPRISE. M3 surfaces are tinted toward the seed hue: surface light = neutral98 = #fef7ff, NOT #ffffff; dark = neutral6 = #141218, NOT #000. Seeded with Tenure green, light surfaces come out faintly green. That is correct M3 behavior but will read as a bug to anyone expecting neutral greys, and it collides with Tenure's existing deliberate WARM paper ramp (#faf9f5/#f1f0ea/#e6e4dd). Warm-vs-cool is a brand decision that needs a human, not a default.

8. IA STALENESS AND SAMPLING. The tree is a snapshot of what help articles documented as of this crawl (2026-08). Google reorganizes this nav (Security 2021-10, Chrome browser 2023-10, Generative AI recent). It is also union-of-mentions, not an export, and reflects max entitlement. Do not hard-code it as a static constant without a review date; do model per-node entitlement filtering from day one, since Google HIDES rather than disables (confirmed [GOOG]).

9. CONCURRENT EDITS. Other agents were editing this tree during the research window. globals.css values quoted here were read at one point in time and may have moved since; re-read before acting on the section 7 delta table.

10. TOKEN VERSION PINNING. All values are M3 v0.192 as vendored in material-components/material-web@main. Google revises these (the repo carries a versions/ directory precisely because they change). Record "M3 v0.192" alongside any tokens committed, so a future diff is possible.
