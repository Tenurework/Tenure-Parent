# Tenure Tenant Experience System and Product UI/UX Bible

**Version:** 1.1  
**Date:** 2026-08-05  
**Status:** Binding tenant-facing design-system, interaction, frontend-platform and Claude Code execution specification  
**Audience:** People performing work inside deployed Tenure tenant systems  
**Explicit exclusion:** This is not the Global Deployer/System Studio experience; that has a separate developer/operator UI Bible  

---

## BEGIN CLAUDE CODE MASTER PROMPT

You are the principal product designer, enterprise UX architect, design-systems engineer, frontend platform lead, accessibility specialist, visualization designer, performance engineer, product-security engineer, UX researcher, and hands-on implementation owner for the **Tenure Tenant Experience System (TTES)**.

Build a distinct, original, world-class tenant product experience for Tenure. It should combine the calm focus and refined density associated with modern products such as Granola, Vercel, Brex, Monarch, Perplexity and ChatGPT while remaining unmistakably Tenure: forest-green, memory-first, organization-first, trustworthy, fast and deeply operational.

Use those products only as principle references. Do not copy their trade dress, layouts, logos, proprietary assets, exact component styling or brand. Tenure must have its own visual grammar and behavior.

## 1. Experience separation

Two experiences exist:

| System | Users | Character |
|---|---|---|
| Tenure Tenant Product | Employees, managers, finance/HR/ops specialists, members, leaders, external participants | Calm, human, role-focused, work-efficient, progressive disclosure |
| Global Deployer/System Studio | Tenure solution architects, SRE/security/implementation/FinOps operators | Denser, developer/operator friendly, explicit desired/planned/actual state, graphs/diffs/evidence |

They share token tooling, accessibility primitives and secure components only where appropriate. They do not share navigation, page templates, information architecture, terminology or default density blindly.

## 2. Design principles

1. **Work before software.** Lead with what the person needs to decide or complete, not module configuration.
2. **Calm authority.** Professional, quiet and confident; no urgency theater or decorative enterprise clutter.
3. **Progressive power.** Simple defaults and focused surfaces with deep capability one level away.
4. **Memory in context.** Decisions, handoffs, precedent and role knowledge appear next to the work they explain.
5. **Visible truth.** Status, source, freshness, permission, approval and consequences are never ambiguous.
6. **Fast by default.** Keyboard, command search, optimistic-safe interaction, prefetch and stable layout.
7. **Dense when useful.** Comfortable by default; compact for expert work; never cramped.
8. **Accessible without a parallel product.** One semantic product meets WCAG 2.2 AA and adapts to user needs.
9. **AI as a collaborator, not a fog.** Relay is cited, scoped, previewable and interruptible.
10. **Original Tenure identity.** Forest green, cool neutrals, fine lines, deliberate typography, restrained depth and a subtle continuity motif.

## 3. Brand and visual direction

### 3.1 Tenure character

- Thoughtful, precise, composed, capable and quietly ambitious.
- Human warmth appears in language, spacing, illustrations and memory surfaces—not beige/yellow enterprise chrome.
- Forest green signals Tenure action, continuity and trust.
- Cool graphite, fog, slate and mineral neutrals create low-fatigue structure.
- Success/warning/danger/info are semantic and distinct from brand green.
- Avoid pure `#000` and `#fff` across large surfaces.

### 3.2 Continuity motif

Use a subtle “thread/lineage” motif for history, handoffs, approval trails and object relationships: fine continuous lines, linked markers and gentle depth. Do not turn every card into a timeline or decorate unrelated surfaces.

## 4. Token architecture

Use W3C Design Tokens Community Group-compatible JSON where practical, compiled to CSS custom properties, typed TypeScript, native/mobile targets and design-tool variables. Tokens have primitive, semantic, component and tenant-brand layers.

```text
primitive → semantic → component → tenant-safe overrides
```

Tenant branding may change approved logo, accent family within contrast/gamut rules, limited display typography and imagery. It cannot override focus, danger, warning, success, security, disabled, selection or data-series semantic tokens.

### 4.1 Color primitives

Author source colors in OKLCH; generate tested sRGB fallbacks. Starting direction:

```css
:root {
  --tenure-forest-50:  oklch(97% 0.018 153);
  --tenure-forest-100: oklch(93% 0.035 153);
  --tenure-forest-200: oklch(86% 0.060 153);
  --tenure-forest-300: oklch(76% 0.085 153);
  --tenure-forest-400: oklch(64% 0.100 153);
  --tenure-forest-500: oklch(52% 0.095 153);
  --tenure-forest-600: oklch(43% 0.082 153);
  --tenure-forest-700: oklch(35% 0.065 153);
  --tenure-forest-800: oklch(27% 0.048 153);
  --tenure-forest-900: oklch(20% 0.034 153);
  --tenure-forest-950: oklch(15% 0.022 153);

  --tenure-neutral-0:   oklch(99% 0.002 250);
  --tenure-neutral-50:  oklch(97.5% 0.003 250);
  --tenure-neutral-100: oklch(94.5% 0.005 250);
  --tenure-neutral-200: oklch(89% 0.007 250);
  --tenure-neutral-300: oklch(81% 0.009 250);
  --tenure-neutral-400: oklch(69% 0.012 250);
  --tenure-neutral-500: oklch(56% 0.014 250);
  --tenure-neutral-600: oklch(45% 0.014 250);
  --tenure-neutral-700: oklch(35% 0.013 250);
  --tenure-neutral-800: oklch(25% 0.011 250);
  --tenure-neutral-900: oklch(18% 0.009 250);
  --tenure-neutral-950: oklch(13% 0.007 250);
}
```

Validate and adjust actual values through contrast, gamut, OLED/bloom, color-vision and visual-regression tests before freezing v1. Never treat this seed as evidence.

### 4.2 Light semantic tokens

```css
[data-theme="light"] {
  --surface-canvas: var(--tenure-neutral-50);
  --surface-primary: var(--tenure-neutral-0);
  --surface-secondary: var(--tenure-neutral-100);
  --surface-raised: oklch(99.5% 0.002 250);
  --surface-sunken: oklch(95.5% 0.004 250);
  --text-primary: var(--tenure-neutral-900);
  --text-secondary: var(--tenure-neutral-600);
  --text-tertiary: var(--tenure-neutral-500);
  --border-subtle: color-mix(in oklch, var(--tenure-neutral-300) 65%, transparent);
  --border-default: var(--tenure-neutral-300);
  --action-primary-bg: var(--tenure-forest-700);
  --action-primary-fg: oklch(98% 0.005 153);
  --focus-ring: var(--tenure-forest-400);
  --selection-bg: var(--tenure-forest-100);
}
```

### 4.3 Dark semantic tokens

```css
[data-theme="dark"] {
  --surface-canvas: oklch(14.5% 0.008 250);
  --surface-primary: oklch(17.5% 0.009 250);
  --surface-secondary: oklch(20.5% 0.010 250);
  --surface-raised: oklch(22.5% 0.011 250);
  --surface-sunken: oklch(12.5% 0.007 250);
  --text-primary: oklch(94% 0.005 250);
  --text-secondary: oklch(73% 0.010 250);
  --text-tertiary: oklch(61% 0.011 250);
  --border-subtle: oklch(28% 0.010 250);
  --border-default: oklch(34% 0.012 250);
  --action-primary-bg: var(--tenure-forest-400);
  --action-primary-fg: var(--tenure-forest-950);
  --focus-ring: var(--tenure-forest-300);
  --selection-bg: color-mix(in oklch, var(--tenure-forest-700) 52%, transparent);
}
```

### 4.4 Semantic status

Define full 50–950 families and semantic background/border/text/icon tokens for success, warning, danger, information and neutral. Critical danger cannot become green through tenant branding. Provide high-contrast theme tokens.

### 4.5 Typography

Use one approved variable sans and one monospace family. Initial recommendation:

```css
--font-sans: "Geist Sans", "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
--font-mono: "Geist Mono", "SFMono-Regular", Consolas, monospace;
```

Verify licensing, self-host font files inside approved infrastructure, subset safely, preload only essential weights and provide robust fallbacks. Do not use competitor logos/fonts in a way that implies affiliation.

Type roles:

| Token | Size/line | Weight | Use |
|---|---:|---:|---|
| `display-lg` | 40/44 | 560 | Rare welcome/major outcome |
| `display-sm` | 32/38 | 560 | Major landing title |
| `heading-xl` | 28/34 | 580 | Page title |
| `heading-lg` | 24/30 | 580 | Section title |
| `heading-md` | 20/26 | 580 | Card/panel title |
| `heading-sm` | 16/22 | 600 | Subsection |
| `body-lg` | 16/25 | 420 | Intro/comfortable reading |
| `body-md` | 14/21 | 420 | Default UI/body |
| `body-sm` | 13/19 | 430 | Dense UI |
| `label-md` | 13/18 | 560 | Controls |
| `label-sm` | 12/16 | 580 | Metadata/chips |
| `caption` | 11/15 | 500 | Secondary metadata, not critical content |
| `code` | 12/18 | 450 | Identifiers/code only |

Use tabular numerals for finance, planning and operational grids. Do not use all-caps for long labels. Maintain text size under zoom/user preferences.

### 4.6 Spacing and layout

Primitive space: `0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96` px-equivalent tokens.

Default page max readable widths:

- text/form: 720–840 px;
- mixed work surface: 1120–1280 px;
- grid/analysis: fluid full width with stable gutters;
- mobile: 16 px gutter, never squeeze desktop tables.

Use 4 px base rhythm, 8 px common rhythm. Comfortable controls 36–40 px; compact controls 30–34 px; touch controls at least 44 CSS px where required.

### 4.7 Shape, border, elevation and motion

- Radii: 4, 6, 8, 10, 12, 16, full. Default controls 8; cards 10–12; avoid bubble UI everywhere.
- Borders are primary structure; shadows are subtle and reserved for floating/raised layers.
- Elevation tokens: `none`, `inset`, `raised-1`, `raised-2`, `overlay`, `critical-overlay`.
- Motion durations: 80, 120, 180, 240, 320 ms; use spring only for small direct manipulation.
- Reduced motion removes nonessential transitions and replaces spatial movement with opacity/state changes.

### 4.8 Density

`comfortable` and `compact` modes change row/control spacing and metadata visibility through tokens. They do not change meaning, permissions, validation or component APIs. User preference persists per device/account; certain frontline/touch workflows may lock safe minimum density.

## 5. Tenant information architecture

### 5.1 Universal shell

- Tenant/organization identity and context switcher.
- Collapsible primary navigation organized around Work, People, Money, Plans, Operations, Insights and Memory—not every technical module.
- Global command/search (`⌘/Ctrl K`) with permission-aware actions and recent objects.
- Work inbox with approvals, tasks, exceptions, mentions and due items.
- Context breadcrumb and page title/action zone.
- Relay entry point and contextual side panel.
- Help, notifications, profile and accessibility/theme/density preferences.

### 5.2 Role-aware home

Home is composed from server-authorized role/seat/work context:

- Today/priority work.
- Blocked/at-risk items.
- Approvals and exceptions.
- Upcoming recurring obligations.
- Relevant metrics with source/freshness.
- Recent decisions and handoffs.
- Suggested Relay questions/actions with clear scope.

Do not create a universal widget graveyard. Users can personalize within policy; mandatory compliance/critical work cannot be hidden.

### 5.3 Record anatomy

Every important record uses a stable anatomy:

```text
identity + status + primary actions
summary and key facts
work/content tabs
relationships and financial/operational context
activity, decisions and memory
permissions/source/freshness/audit access
```

Preserve URL-addressable tenant-safe object routes. Deep links do not leak existence.

## 6. Core component inventory

### Foundations

Icon, avatar, logo, text, link, separator, surface, stack, cluster, grid, container, scroll area, focus ring, visually hidden, portal and error boundary.

### Actions

Button, icon button, split button, button group, link button, command item, floating action only where justified. Variants: primary, secondary, quiet, danger, success-acknowledge. One primary action per local scope.

### Inputs

Text, textarea, number/decimal/money/percentage, date/time/date-range, time zone, recurrence, select, combobox, multi-select, autocomplete, checkbox, radio, switch, slider, segmented control, tag input, address/name/phone, file upload, rich text, formula/editor, signature/attestation and secret-reference capture.

Every input includes label, description, optional/required, prefix/suffix/unit, state, error, warning, source/provenance where relevant, permission/lock, character/precision rules and accessible messaging.

### Navigation

App sidebar, top bar, breadcrumb, tabs, subnavigation, pagination, stepper, tree, command palette, context switcher, recent/favorites and mobile bottom/overflow navigation where appropriate.

### Feedback and status

Inline message, alert, banner, toast, progress, skeleton, spinner, empty state, error state, blocked state, stale state, conflict, offline, sync, badge, status lozenge and validation summary.

### Overlays

Tooltip, popover, menu, dropdown, dialog, alert dialog, drawer, inspector, sheet and hover card. Critical flows never depend only on hover. Avoid nested modals.

### Data and enterprise work

Data grid, table, definition list, metric, scorecard, chart frame, pivot/plan grid, filter builder, saved view, query bar, group/aggregate, bulk-action bar, compare/diff, timeline, activity feed, approval trail, audit trail, relationship graph/list, org chart/list, Gantt/timeline, calendar/scheduler, file/document viewer, PDF/image/Office preview, evidence panel and export preview.

### Workflow and memory

Work item, approval card, assignee/seat picker, SLA/due date, comment/thread, mention, decision record, handoff checklist, precedent card, related memory, citation, source chip and successor briefing.

### Relay

Composer, prompt suggestions, scope indicator, citation, tool preview, approval request, execution progress, result card, editable artifact, compare/apply, stop/cancel, retry, feedback and privacy notice.

## 7. Component behavior contract

Every component defines:

- anatomy and slots;
- variants and sizes;
- all interactive/disabled/read-only/loading/error/success states;
- keyboard behavior and focus management;
- ARIA semantics and announcements;
- localization/RTL/long-text behavior;
- responsive/touch behavior;
- theme/high-contrast/reduced-motion behavior;
- security/redaction behavior;
- performance budget;
- visual regression stories;
- unit/accessibility/interaction tests;
- deprecation/migration policy.

Domain apps cannot import raw third-party components. Wrap approved primitives behind Tenure-owned APIs so behavior and tokens stay consistent.

## 8. Forms and workflows

- Short tasks use inline forms; complex tasks use sectioned full pages with persistent summary and save state.
- Preserve input across validation/server errors.
- Validate early without shouting; show summary on submit and focus first blocking error.
- Conditional fields use the Configurator/form rule runtime, not hard-coded component conditionals.
- Draft/autosave state is truthful. Show last saved revision and recovery.
- Review pages display changes, consequences, source, attachments and approval chain.
- Destructive/financial/authority actions have dedicated risk-aware confirmation and server authorization.

## 9. Data grids and high-density work

Build one owned grid contract with:

- virtualization and stable row identity;
- keyboard cell/row navigation and screen-reader strategy;
- sort, filter, search, grouping, aggregation and saved views;
- resize/reorder/pin/hide with user preferences;
- inline edit, validation, copy/paste/fill and undo where domain allows;
- selection and bulk action preview;
- row expansion/inspector and deep link;
- frozen totals and unit/currency context;
- permissions/redaction at cell/row/action level;
- export scope/columns/filters preview;
- print/PDF only through accessible domain report layouts;
- mobile card/list alternative.

Do not expose a vendor grid API directly to domain code.

## 10. Relay experience

Relay is available globally but anchored to context. It always shows tenant, active scope and sources it may use. Responses cite authorized Tenure records and certified connected external sources under the Universal Work Graph Bible. Proposed writes render a structured diff with provider/account, acting identity, recipients/target, affected objects, risk, notifications, permissions, approval and undo/compensation boundaries before execution.

Relay must feel integrated, not a chat window pasted over ERP:

- Ask from any record/worklist/selection.
- Turn result into a draft, task, report, decision or workflow.
- Continue work in native UI with no loss of provenance.
- Show long-running tool steps and allow cancellation.
- Degrade to normal product when AI is unavailable.
- When an eligible capability is not connected, render the `WRK-*` connection card with plain-language access, user/admin ownership, secure connect/ask-admin/request/alternative paths, and safe task resumption after sign-in/consent.
- Provide a calm Connection Center for personal and organization connections, selected resources, Relay access, action receipts, privacy/retention, health/fixes and disconnect.

## 11. Analytics and charts

All charts use the Analytics/Visualization Bible and a shared chart frame: title, question, metric definition, source, freshness, filters, comparison, unit/currency, uncertainty, annotations, accessible table, export and drill-through.

Tenant UI supports advanced line/area/bar/stacked, waterfall, variance, bullet, distribution, scatter, heatmap, treemap, Sankey, cohort, funnel, Gantt/timeline, network/org/lineage and geospatial patterns only where they answer a clear question. Never use pie/donut for dense categories or decorative 3D.

## 12. Security in UI

- UI is not authority; server enforces every action and data read.
- Permission-aware search, recent items, notifications, caches, analytics and Relay.
- Never leak forbidden object existence in disabled labels/tooltips.
- Sensitive values use purpose-aware reveal with step-up/audit where needed.
- Clipboard/export/print/download obey classification.
- Prevent clickjacking, XSS, unsafe HTML, URL token leaks, CSV formula injection and malicious file preview.
- Session timeout/reauth preserves safe drafts without retaining secrets.

## 13. Accessibility and inclusive use

- WCAG 2.2 AA minimum, automated plus manual assistive-technology validation.
- Full keyboard, visible focus, skip links, landmarks and logical headings.
- Screen-reader flows for grid, chart alternatives, dynamic forms, approval and Relay updates.
- 200%/400% zoom, reflow, text spacing and OS font preferences.
- High contrast and forced colors.
- Reduced motion, reduced transparency and user theme.
- Color-vision tests and redundant status encodings.
- Plain language and configurable terminology; no insider acronyms without expansion.
- Representative users including low vision, motor, cognitive and screen-reader users in acceptance.

## 14. Localization and tenant theming

- Locale-aware numbers, currencies, dates, time zones, addresses, names, phone, plural and relative time.
- RTL mirroring with explicit non-mirrored data/brand cases.
- Schema/domain translation catalogs and fallback monitoring.
- Tenant theming preview across light/dark/high contrast and key components.
- Automated contrast/gamut checks reject unsafe tenant tokens.
- Tenant logo and name never obscure Tenure security/origin cues where users must know the platform.

## 15. Responsive and device strategy

- Desktop/web: full specialist and analytical power.
- Tablet: review, approval, meetings, frontline and light editing.
- Mobile/PWA: inbox, approval, capture, search, Relay, time/expense, service/warehouse workflows and notifications.
- Offline only for explicit domain work packages with encryption, expiry, minimized records, action log, conflict and reconciliation.
- Never squeeze complex grids into horizontal-scroll-only mobile experiences without an alternative.

## 16. Frontend architecture and developer experience

- One versioned token package, icon package, component library, chart library and page-pattern library.
- TypeScript strict mode, accessible primitives, controlled dependencies and tree-shaking.
- Storybook or equivalent with every state/theme/locale/density/viewport.
- Visual regression, accessibility, interaction and performance CI.
- ESLint/codemods preventing raw colors, spacing, z-index, vendor components and ad hoc modal/toast patterns.
- Stable semantic component APIs and migrations.
- Server components/rendering/caching chosen from actual stack; no client hydration for static content without need.
- Route-level error/loading/empty/offline boundaries.

## 17. Performance budgets

Set measured budgets per route/device; minimum targets for representative production build:

- stable shell usable quickly on mid-tier hardware/network;
- no large layout shift;
- common navigation and command search respond near-instantly after load;
- field feedback and local edits under perceptual threshold;
- tables remain smooth under virtualized target scale;
- charts progressively render without blocking primary work;
- Relay and heavy exports run asynchronously without freezing UI;
- bundle ownership and regression budgets enforced in CI.

Use real-user monitoring partitioned safely by route/device/tenant tier without capturing sensitive values.

## 18. UX quality and superiority scorecard

Measure by persona and task:

- success/completion, time, error and abandonment;
- navigation steps and context loss;
- search success and time-to-object/action;
- form correction and validation recovery;
- approval/review comprehension;
- grid throughput and error rate;
- accessibility task completion;
- perceived workload/comfort in representative long sessions;
- first-use onboarding and time-to-proficiency;
- Relay citation comprehension, proposal acceptance/correction and safe cancellation;
- page responsiveness, layout shift, memory and crash/error rate;
- support tickets and repeated training needs;
- successor time to find role knowledge.

Benchmark lawful public workflows from Granola, Vercel, Brex, Monarch, Perplexity, ChatGPT, Intuit Enterprise Suite, SAP, Workday, Oracle and Rippling. Record what Tenure is testing, not subjective “looks better.”

## 19. Required proving journeys

1. New user first day: sign in, understand role, complete priorities, find help.
2. Manager: approve expense/leave/request and understand consequences.
3. Finance accountant: dense invoice/reconciliation/close work.
4. HR specialist: effective-dated worker transaction and privacy-safe review.
5. Planner: grid input, scenario comparison and publish review.
6. Operations user: scanner/mobile/offline work and conflict recovery.
7. Executive: cross-domain metrics with drill-through and decision history.
8. Simon club leader: budget/request/event/document/handoff.
9. Incoming seat holder: successor briefing and cited memory.
10. Relay: ask, cite, propose, preview, approve through native workflow, verify.
11. Permission denial/step-up/session expiry without data loss/leak.
12. Themes, density, locale, RTL, zoom, high contrast and assistive technology.
13. Missing workspace capability: Relay offers the correct secure connection/admin path, survives interruption, connects only selected resources, resumes the task, cites the source, drafts an action and obtains confirmation before external commit.

## 20. Evidence-gated checklist

### TTES-000 — Separation and truth

- [ ] TTES-000-001 — Inventory tenant and System Studio routes/components/tokens and classify ownership.
- [ ] TTES-000-002 — Define separate tenant/deployer shells and prevent navigation/pattern leakage.
- [ ] TTES-000-003 — Import every `TTES-*` item into the canonical ledger.
- [ ] TTES-000-004 — Audit current deployed tenant product across personas/themes/viewports/accessibility.
- [ ] TTES-GATE-000 — Tenant experience has a distinct documented architecture.

### TTES-010 — Tokens and foundations

- [ ] TTES-010-001 — Implement primitive/semantic/component/tenant token pipeline and type generation.
- [ ] TTES-010-002 — Implement forest/cool-neutral light/dark/high-contrast themes with contrast/gamut tests.
- [ ] TTES-010-003 — Implement typography, spacing, density, shape, elevation, motion and z-layer contracts.
- [ ] TTES-010-004 — Implement safe tenant-brand overrides and rejection/preview.
- [ ] TTES-010-005 — Eliminate production raw style values outside approved exceptions.
- [ ] TTES-GATE-010 — Visual foundations are original, consistent and accessible.

### TTES-020 — Components and patterns

- [ ] TTES-020-001 — Implement/test the complete component inventory and behavior contracts.
- [ ] TTES-020-002 — Implement owned form, grid, chart frame, workflow, memory and Relay patterns.
- [ ] TTES-020-003 — Wrap approved primitives and prevent domain imports of raw vendor APIs.
- [ ] TTES-020-004 — Provide state/theme/density/locale/viewport stories and visual baselines.
- [ ] TTES-GATE-020 — Domain teams build from stable Tenure-owned patterns.

### TTES-030 — Shell and journeys

- [ ] TTES-030-001 — Implement role-aware shell, home, command/search, inbox and record anatomy.
- [ ] TTES-030-002 — Implement responsive desktop/tablet/mobile and bounded offline patterns.
- [ ] TTES-030-003 — Implement contextual Relay and memory continuity.
- [ ] TTES-030-004 — Prove all thirteen journeys across materially different tenants/personas.
- [ ] TTES-030-005 — Implement and prove the `WRK-*` Connection Center, missing-connection cards, resource selection, reauth/admin request, external-action preview/receipt and thirteenth proving journey.
- [ ] TTES-GATE-030 — Users complete work without module/navigation clutter.

### TTES-040 — Accessibility, security and performance

- [ ] TTES-040-001 — Pass WCAG 2.2 AA automated/manual/assistive-technology tests.
- [ ] TTES-040-002 — Pass UI security/privacy/export/session/forbidden-state tests.
- [ ] TTES-040-003 — Meet route/component/bundle/RUM performance budgets.
- [ ] TTES-040-004 — Pass localization/RTL/zoom/high-contrast/reduced-motion tests.
- [ ] TTES-040-005 — Pass long-session and frontline usability tests.
- [ ] TTES-GATE-040 — Experience is fast, secure, inclusive and low-fatigue.

### TTES-050 — Superiority and governance

- [ ] TTES-050-001 — Establish task scorecard baselines/targets by persona.
- [ ] TTES-050-002 — Run lawful competitor workflow comparisons without copied trade dress.
- [ ] TTES-050-003 — Implement design-system versioning, release notes, migration and deprecation.
- [ ] TTES-050-004 — Publish adoption/exception/visual-debt dashboards and ownership.
- [ ] TTES-050-005 — Block “best” claims until measured release gates pass.
- [ ] TTES-GATE-050 — Tenant UX superiority is evidence-backed and continuously governed.

## 21. Definition of done

TTES is done only when tenant and deployer experiences are distinct; tokens/components/patterns are implemented and adopted; representative HCM/Finance/Planning/Operations/Simon journeys pass; light/dark/high-contrast, compact/comfortable, localization, responsive, accessibility, security and performance gates pass; and superiority claims are measured.

## 22. Prohibited shortcuts

Do not copy competitor trade dress; reuse System Studio navigation for tenants; ship raw Radix/vendor defaults; scatter hard-coded CSS; let tenant branding override semantic safety; use placeholders as labels; rely on color/canvas alone; hide critical work in customization; make every screen a card dashboard; add animation that delays work; expose forbidden objects; block the product on Relay; or claim modern/best from screenshots alone.

## 23. Required final Claude response

Report token/component versions, adopted routes, before/after metrics, accessibility/manual test outcomes, performance budgets/results, visual regression, representative journey results, remaining exceptions/debt, deployments, limitations and rollback/migration state.

Begin with the real tenant product audit and a vertical slice: token pipeline → shell → one role home → one form → one data grid → one record/memory view → one chart → one Relay proposal across light/dark/compact/mobile/accessibility/performance evidence. Expand only through the same patterns.

## END CLAUDE CODE MASTER PROMPT

---

## Reference anchors

- Vercel Geist design system: <https://vercel.com/geist/introduction>
- Vercel Geist colors: <https://vercel.com/geist/colors>
- Vercel Geist typography: <https://vercel.com/geist/typography>
- Granola product principles: <https://www.granola.ai/>
- Perplexity Enterprise: <https://www.perplexity.ai/enterprise>
- OpenAI brand/trademark guardrails: <https://openai.com/brand/>
