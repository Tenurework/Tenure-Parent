# Audit of the System Studio shell + design tokens as they exist today (apps/system-studio), so the overhaul can be written as a diff. Read-only; nothing edited.

## Summary
The Studio is NOT a blank slate — it has a complete, heavily-reasoned, machine-enforced Material-3 token layer (4,028-line `globals.css`, 255 custom-property declarations, 63 colour/elevation/state tokens with exact light+dark parity, zero orphans), 40 md3 primitives behind one barrel, a three-region shell (64px sticky top bar + 17rem sticky rail + fluid main), and a five-axis preference system (theme/density/motion/contrast/direction) applied pre-paint via `data-*` attributes on `<html>`. Ten e2e specs mechanically enforce it, including one that reads `apps/web/src/app/globals.css` at test time and fails if `primary`/`primary-container`/`inverse-primary` is not a verbatim step of the Tenure forest ramp. The real gaps are: (1) NO icon system at all — zero icon dependency, the nav is text-only; (2) the two architecture docs are materially stale against the code they describe (the dark theme is documented as `#000000`/`#12cc7e`, the code is `#212121`/`#6ee7b7`; the route map's sub-item counts are wrong for 5 of 15 entries); (3) 21 route-level `.module.css` files (3,109 lines) sit outside the token audit's class-drift contract; (4) the Studio's theme switcher is 3-mode while the tenant app's is 4-mode with a scheduled-dark window the Studio has never had; (5) `--tenure-*` is declared 249 times in apps/web and 0 times in the Studio — the ramp is duplicated as literal hexes, reconciled only by a test. "Tenure green" #198052 exists as `--tenure-forest-700` in apps/web and is DELIBERATELY not the Studio's primary — the contrast reasoning is intact and recorded in three places.

## Findings
## 0. What I verified, and how

Everything below was read from the working tree at `C:/Users/satvi/Tenure-Parent`, branch `recover-fanout-wave`, with `sed`/`grep`/`awk`. No file was written. I did **not** fetch admin.google.com, the Material 3 spec, or any external reference — that is outside this lane, and I make no claim about what any external console looks like. Every hex, pixel value and line number below came out of a file in this repo.

---

## 1. `apps/system-studio/src/app/globals.css` — the token layer

**4,028 lines.** Roughly 55% of it is prose comment: each token carries the measured contrast ratio that chose it. This is the single most load-bearing artefact in the lane, and it is far more finished than "a stylesheet".

### 1.1 Structure — nine `:root` blocks, not one

| Lines | Selector | What it declares |
|---|---|---|
| 61–201 | `:root` | Reference ramp + all colour roles + elevation + state layers + legacy aliases, `color-scheme: light` |
| 290–434 | `:root[data-theme="dark"]` | Every one of the above, re-declared, `color-scheme: dark` |
| 456–464 | `:root` | Shape corner ramp |
| 546–643 | `:root` | Type scale (15 roles × 4 parts = 60 tokens) |
| 683–687 | `:root` | State-layer **opacities** (the modern mechanism) |
| 703–721 | `:root` | Space scale + `--tap` |
| 723–732 | `:root[data-density="compact"]` | Space scale, tightened; `--tap` deliberately unchanged |
| 797–815 | `:root` | Component geometry (control height, row padding, card padding) |
| 825–844 | `:root[data-contrast="more"]` | 3 tokens raised |
| 846–853 | `:root[data-theme="dark"][data-contrast="more"]` | Same 3, dark values |
| 864–868 / 893–899 | `:root` | Motion, and Material-named aliases onto it |
| 901–908 | `:root[data-motion="reduced"]` | Zeroes `--motion-fast` / `--motion-base` |
| 919–930 | `@media (prefers-reduced-motion: reduce)` | Same, as an OS floor |
| 1019–1039 | `:root` | **Shell frame** — `--topbar-block-size`, `--rail-inline-size`, `--measure` |
| 1040–1044 | `@media (max-width: 1180px)` | `--rail-inline-size: 15rem` |

### 1.2 The colour tokens, verbatim (light `:root`, L61–201)

Reference layer (L62–73):
```css
--md-ref-primary-10: #06130c;   /* = --tenure-forest-950 */
--md-ref-primary-30: #115e3d;   /* = --tenure-forest-850 */
--md-ref-primary-80: #6ee7b7;   /* = --tenure-forest-200 */
--md-ref-primary-90: #e4f2ea;   /* = --tenure-forest-50  */
--md-ref-secondary-40: #454a53; /* = --tenure-slate-700  */
--md-ref-tertiary-40: #3c6370;
```

System layer, light (L74–190) — every one has a dark counterpart:

| Role | Light | Dark (L290–411) |
|---|---|---|
| `primary` | `var(--md-ref-primary-30)` → `#115e3d` | `#6ee7b7` |
| `on-primary` | `#f7fbf8` | `#06130c` |
| `primary-container` | `var(--md-ref-primary-90)` → `#e4f2ea` | `#115e3d` |
| `on-primary-container` | `var(--md-ref-primary-10)` → `#06130c` | `#6ee7b7` |
| `secondary` | `#454a53` | `#c4c4c4` |
| `on-secondary` | `#f8f8f7` | `#1a1a1a` |
| `secondary-container` | `#e2e0da` | `#3a3a3a` |
| `on-secondary-container` | `#2c3038` | `#ececec` |
| `tertiary` | `#3c6370` | `#8fc7dd` |
| `on-tertiary` | `#f7fdff` | `#06222c` |
| `tertiary-container` | `#cbe6ef` | `#123844` |
| `on-tertiary-container` | `#0b232c` | `#c3e8f3` |
| `error` | `#8b2f35` | `#f7b8ba` |
| `on-error` | `#fff8f7` | `#3b0d10` |
| `error-container` | `#f7dedd` | `#5a2225` |
| `on-error-container` | `#2d0709` | `#ffdad9` |
| `warning` *(non-Material)* | `#765b12` | `#d8bd6a` |
| `on-warning` | `#fffcf3` | `#2b2200` |
| `warning-container` | `#f4e6c2` | `#4d3d08` |
| `on-warning-container` | `#241a00` | `#f6e6bf` |
| `success` *(non-Material)* | `#14724a` (forest-750) | `#56d199` (forest-300) |
| `on-success` | `#f7fbf8` | `#06130c` |
| `success-container` | `#e4f2ea` (forest-50) | `#0f5132` (forest-900) |
| `on-success-container` | `#14724a` | `#6ee7b7` |
| `background` | `#f1f0ea` | `#212121` |
| `on-background` | `#191a1c` | `#ececec` |
| `surface` | `#fbfaf7` | `#212121` |
| `surface-dim` | `#ecebe5` | `#171717` ← **the rail** |
| `surface-bright` | `#fdfcfa` | `#424242` |
| `surface-container-lowest` | `#fdfcfa` | `#0d0d0d` |
| `surface-container-low` | `#fbfaf7` | `#292929` ← **the card** |
| `surface-container` | `#f4f3ed` | `#323232` |
| `surface-container-high` | `#edece5` | `#3a3a3a` |
| `surface-container-highest` | `#e6e4dd` | `#424242` |
| `surface-variant` | `#ecebe5` | `#171717` ← table header band |
| `on-surface` | `#191a1c` | `#ececec` |
| `on-surface-variant` | `#565b62` | `#b4b4b4` |
| `outline` | `#6b7280` | `#9a9a9a` |
| `outline-variant` | `#cbc9c1` | `#525252` |
| `inverse-surface` | `#2c3038` | `#ececec` |
| `inverse-on-surface` | `#f1f0ea` | `#212121` |
| `inverse-primary` | `#6ee7b7` (ref-80) | `#0f6b42` |
| `scrim` | `rgba(23,24,26,0.42)` | `rgba(0,0,0,0.72)` |

Baked state layers (legacy, L186–188 / L410–412):
```css
/* light */ --md-sys-state-hover:  rgba(17, 94, 61, 0.08);
            --md-sys-state-focus:  rgba(17, 94, 61, 0.14);
            --md-sys-state-pressed:rgba(17, 94, 61, 0.16);
/* dark  */ --md-sys-state-hover:  rgba(110, 231, 183, 0.1);
            --md-sys-state-focus:  rgba(110, 231, 183, 0.16);
            --md-sys-state-pressed:rgba(110, 231, 183, 0.18);
```
Modern opacity layer (L683–687), which the baked trio is being replaced by:
```css
--md-sys-state-hover-opacity: 0.08;
--md-sys-state-focus-opacity: 0.12;
--md-sys-state-pressed-opacity: 0.12;
```

Elevation, light (L189–195) / dark (L406–410):
```css
/* light */ --md-sys-elevation-1: 0 1px 2px rgba(23,24,26,.09), 0 1px 3px rgba(23,24,26,.07);
            --md-sys-elevation-2: 0 2px 6px rgba(23,24,26,.11), 0 1px 3px rgba(23,24,26,.08);
            --md-sys-elevation-3: 0 4px 10px rgba(23,24,26,.12), 0 1px 3px rgba(23,24,26,.09);
            --md-sys-elevation-4: 0 8px 16px rgba(23,24,26,.13), 0 2px 4px rgba(23,24,26,.10);
            --md-sys-elevation-5: 0 12px 24px rgba(23,24,26,.15), 0 4px 6px rgba(23,24,26,.11);
/* dark  */ --md-sys-elevation-1: 0 1px 2px rgba(0,0,0,.44), 0 1px 3px rgba(0,0,0,.30);
            … through …
            --md-sys-elevation-5: 0 12px 26px rgba(0,0,0,.60), 0 4px 6px rgba(0,0,0,.40);
```

Legacy product-contract aliases (L199–210 light / L424–434 dark) — these names are read by `tools/entry-point-inventory.mjs` and cannot be renamed casually:
```css
--bg --surface --surface-2 --border --border-strong --text --muted --accent --ok --warn --bad
```
Note `--surface` resolves differently per theme: light `surface-container-lowest`, dark `surface-container-low`.

### 1.3 Shape (L456–464) and the four aliases (L193–196)
```css
--md-sys-shape-corner-none: 0;          --md-sys-shape-corner-large: 12px;
--md-sys-shape-corner-extra-small: 4px; --md-sys-shape-corner-extra-large: 16px;
--md-sys-shape-corner-small: 6px;       --md-sys-shape-corner-full: 999px;
--md-sys-shape-corner-medium: 8px;
/* aliases: --md-sys-shape-xs/sm/md/full → extra-small/small/medium/full */
```
Deliberately tighter than consumer Material (which runs 4→28).

### 1.4 Type (L546–643) — 15 roles × 4 parts, all present
Anchor `title-large: 1rem`; heading ladder steps by **1.09** per rung; body is `0.86rem` (13.76px) at `line-height: 1.5`; `body-small` (the table role) is `0.78rem` at `1.4`; `label-small` is `0.69rem/1.35/650/0.06em`. The three displays and two largest headlines are `clamp()`ed for 320 CSS px. `display-large` tops out at `1.68rem` = 26.88px = **1.95× body**, asserted as a ratio (not a pixel) by `base-scale.spec.ts:373`.

Fonts (L197–198):
```css
--md-sys-type-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--md-sys-type-mono: "SFMono-Regular", "Roboto Mono", Menlo, Consolas, monospace;
```
**There is no `@font-face` and no font loader.** Inter is named but never fetched; in practice the console renders in the system fallback unless the machine happens to have Inter.

### 1.5 Space, density, geometry
```css
/* L703–721 comfortable */  --space-1..6: 4/8/12/16/20/28px;  --tap: 24px;
/* L723–732 compact     */  --space-1..6: 2/6/8/10/14/18px;   --tap: 24px  (deliberately unchanged)
/* L797–815 geometry    */
--control-block-size:   calc(var(--tap) + var(--space-2));  /* 32px comfortable, 30px compact */
--control-padding-block: var(--space-1);
--row-padding-block:     var(--space-1);   /* 4px */
--card-padding:          var(--space-4);   /* 16px */
--card-gap:              var(--space-2);   /* 8px  */
--card-padding-nested:   var(--space-3);   /* 12px */
--card-gap-nested:       var(--space-1);   /* 4px  */
```
`--space-6` is 28px and **diverges from the tenant app's 24px on purpose** — recorded in `SHARED_TOKENS` at `tools/entry-point-inventory.mjs:496`.

### 1.6 Motion
```css
--motion-fast: 120ms;  --motion-base: 180ms;  --ease-entry: cubic-bezier(0, 0, 0.2, 1);
--md-sys-motion-duration-short:  var(--motion-fast);
--md-sys-motion-duration-medium: var(--motion-base);
--md-sys-motion-easing-standard:   cubic-bezier(0.2, 0, 0, 1);
--md-sys-motion-easing-decelerate: var(--ease-entry);
--md-sys-motion-easing-accelerate: cubic-bezier(0.3, 0, 1, 1);
```
Documented ceiling 220ms, asserted on the rendered page by `preferences.spec.ts:377`.

### 1.7 Light/dark parity — measured, not assumed
Of **255** `--name: value` declarations inside `:root`-family blocks:
- **63** are colour/elevation/state/alias tokens, and **every single one declared in light is re-declared under `:root[data-theme="dark"]`**. I diffed the two sets programmatically: **zero light-only colour tokens, zero dark-only colour tokens.**
- **107** are theme-invariant by nature (shape ×7 + aliases ×4, type ×60, space ×7, geometry ×7, motion ×8, state opacities ×3, shell ×3, ref ramp ×6) and correctly have no dark counterpart.

This is the healthiest single fact in the audit. A restyle does not have to build dark mode; it has to not break it.

---

## 2. `apps/system-studio/src/components/md3/` — the primitives

**40 `.tsx`/`.ts` modules + `primitives.css` (877 lines) + `index.ts` barrel (282 lines).** Memory's list (Surface, Card, Button, Chip, Badge, DataTable, EmptyState, KeyValue, Menu, Tree, StaleIndicator) is **an undercount by roughly two-thirds.**

| Primitive | File:lines | Props (exact) | Completeness |
|---|---|---|---|
| `Surface` | Surface.tsx:76 | `as` `container` `level` `shape` `outlined` `children` + all `HTMLAttributes` | Complete. Every other primitive is a Surface. `data-container`/`data-level`/`data-shape` ladders at globals.css:2823–2897 |
| `Card` | Card.tsx:36 | `headline` `headlineAs` `supportingText` `headerAside` `actions` `container` `level` `shape` `outlined` `as` `id` `children` | Complete; nested-card rule at globals.css:3006 |
| `Button` / `ButtonLink` | Button.tsx:54–78 | `variant`: filled\|tonal\|outlined\|text; `tone`: neutral\|danger | Complete, 4×2 matrix all styled (globals.css:3063–3125) |
| `Chip` / `ChipButton` | Chip.tsx:25–40 | `children` `selected` | Complete |
| `Badge` | Badge.tsx:28 | `children` (required) `tone` `title` `id` | 5 tones: neutral/info/ok/warn/bad |
| `DataTable` | DataTable.tsx:49 | `caption`(req) `columns` `rows` `rowKey` `empty` | Shell only — no sort, no paging, no fetch, **by design** |
| `EmptyState` | EmptyState.tsx:29 | `headline` `description`(req) `actions` `headlineAs` | Complete |
| `KeyValue` | KeyValue.tsx:69 | `items` `ariaLabel` `id`; per-item `asOf` | Complete |
| `StaleIndicator` | StaleIndicator.tsx:94 | `asOf` `cadenceMs` `now` `label` + `staleness()` `formatAge()` | Complete |
| `UnknownState` | UnknownState.tsx:96 | `what` `read: UnknownRead` `now` `id` | 4 distinct arms (DENIED/THROTTLED/UNCONFIGURED/ERROR); the most load-bearing component |
| `Tabs` | Tabs.tsx:58 | `ariaLabel` `items` `selected` `id` | Links + `aria-current`, deliberately **not** an ARIA tablist |
| `Dialog` | Dialog.tsx:42 | `open` `id` `headline` `supportingText` `children` `actions` `dismiss`(req) | Server-safe; deliberately no `aria-modal` |
| `ModalDialog` | ModalDialog.tsx:48 | `open` `onClose` `headline` `supportingText` `actions` `dismissLabel` `busy` `id` | Client; real focus trap via `hooks.ts` |
| `Drawer` | Drawer.tsx:41 | `open` `onClose` `title` `children` `footer` `side` `dismissLabel` | Complete |
| `Popover` | Popover.tsx:50 | `label` `trigger` `triggerVariant` `triggerTone` `children`(fn ok) `align` `open` `onOpenChange` `triggerHint` | Complete |
| `Menu` | Menu.tsx:95 | `label` `trigger` `triggerVariant` `triggerTone` `groups` `align` `dir` `onOpenChange` | Full keyboard model |
| `Tree` | Tree.tsx:56 | `label` `nodes` `expanded` `onExpandedChange` `defaultExpanded` `onActivate` `selectedId` `dir` | Full ARIA tree |
| `Tooltip` | Tooltip.tsx:48 | `tip` `children` `placement` | Complete |
| `Accordion` | Accordion.tsx:56 | `sections` `headingLevel` `multiple` `defaultOpen` `label` | Complete |
| `Combobox` | Combobox.tsx:68 | `options` `name` `defaultValue` `onChange` `placeholder` `required` `disabled` + FieldText | Complete |
| `Snackbar` | Snackbar.tsx:42 | `message` `action` `dismiss` | No timer, deliberately |
| `ToastRegion` | ToastRegion.tsx:63 | `toasts` `onDismiss` `label` + `LIMIT` | Complete |
| `ProgressIndicator` / `IndeterminateProgress` | ProgressIndicator.tsx:40,99 | `label` `value` `max` `valueText` | Clamps; static track under reduced motion |
| `Field` | Field.tsx:59 | `id`(req) `children` + FieldText | Complete |
| `TextField` / `TextArea` | TextField.tsx:39,43 | `id`(req) + FieldText | No floating label, deliberately |
| `Select` | Select.tsx:37–54 | `id` `options` `placeholder` | Native `<select>` |
| `Switch` | Switch.tsx:40 | `id`(req) `label`(req) `supportingText` `stateText` | `role="switch"` checkbox |
| `SeverityChip` | SeverityChip.tsx:50 | `severity` `children` `title` `id` + `SEVERITIES` | 5 AWS levels; **no red/green** |
| `Stepper` | Stepper.tsx:60 | `label` `steps` `orientation` | Complete |
| `FileUpload` | FileUpload.tsx:53 | `name` `legend` `supportingText` `accept` `maxBytes` `maxFiles` `multiple` `required` | + pure `files.ts` |
| `Chart` | Chart.tsx:55 | `title` `unit` `timeRange` `source` `freshness` `series` `formatX` `filters` | Hand-rolled SVG + pure `chart-model.ts` |
| `CodeBlock` / `DiffView` | Code.tsx:37,85 | `code` `caption`(req) `language` / `before` `after` | + pure `diff.ts` |
| `DateTimeField` | DateTimeField.tsx:42 | `name` `legend` `supportingText` `defaultIso` `error` `required` `min` `max` | + pure `datetime.ts` |
| `DangerZone` | DangerZone.tsx:172 | `id` `subject` `actions` + 8 exported constants | STUDIO-030-004 spatial separation |
| `Logo` | Logo.tsx:204 | `mark` `size` `className` + `LOGO_ICONS` `LOGO_ICON_PATH` | The one mark |
| `interaction.ts` | 16 exports | pure keyboard model — no DOM, no React | Tested at node speed |
| `hooks.ts` | 4 exports | `useFocusTrap` `useDismissableLayer` `useModalHost` `openLayerCount` | Complete |

**The rule that governs the whole directory** (index.ts:5–23, restated in the doc at studio-design-system.md:17–56): *a component may not contain a literal colour.* `md3-tokens-logic.spec.ts:1112–1187` scans every non-`*.test.tsx` file for hex codes, `rgb(`/`hsl(`/`oklch(`/`color-mix(`/`light-dark(`, all 148 CSS colour keywords, and any `style={{…}}`. Two mutations were run and both failed the build; the doc records them.

**Split point:** everything above index.ts:154 is server-renderable (no `"use client"`); everything below is client. That split is a documented contract, not an accident.

---

## 3. The shell — `layout.tsx`, `Nav.tsx`, `TopBar.tsx`

### 3.1 `apps/system-studio/src/app/layout.tsx` (317 lines)
Three regions, in DOM order:
1. `<script>` inline `NO_FLASH_SCRIPT` as the **first child of `<body>`** (layout.tsx:154) — not in `<head>`, because App Router silently drops an arbitrary `<script>` there.
2. `.skip-link` → `#console-main` (layout.tsx:166).
3. `<header className="masthead" role="presentation">` wrapping `<TopBar>{<PreferencesMenu/>}</TopBar>` (layout.tsx:197–201). `role="presentation"` because `TopBar` renders the real `role="banner"`.
4. `<div className="console-shell" data-shell={signedIn ? "console" : "bare"}>` (layout.tsx:203) containing `<div className="console-rail"><Nav/></div>` (only when signed in) and `<div className="console-content"><main id="console-main" tabIndex={-1}>` with `<OfflineBanner/>`, `<Breadcrumbs names={names}/>`, `{children}`.
5. `<Launcher/>` (Ctrl/Cmd-K command palette).
6. A second inline `<script>` (layout.tsx:293–312) — a 100ms URL poll + Navigation API listener that rescues focus to `#console-main` when a route change drops it on `<body>`.

`export const dynamic = "force-dynamic"` (layout.tsx:43) because the layout calls `auth()`. The shell keys off **session presence, not pathname** (layout.tsx:81–95) — a server layout cannot read the pathname.

**Yes there is a top bar. Yes there is a side nav.** The frame is (globals.css:1086–1160):
```css
.console-shell { display: grid; grid-template-columns: minmax(0,1fr); align-items: start; }
@media (min-width: 901px) {
  .console-shell[data-shell="console"] { grid-template-columns: var(--rail-inline-size) minmax(0,1fr); }
  .console-rail { position: sticky; inset-block-start: var(--topbar-block-size);
                  block-size: calc(100dvh - var(--topbar-block-size)); z-index: 10;
                  border-inline-end: 1px solid var(--border); }
}
.console-rail { padding-block: var(--space-4); padding-inline: var(--space-3);
                background: var(--md-sys-color-surface-dim);
                --console-nav-offset: calc(var(--topbar-block-size) + 2 * var(--space-4)); }
```
`--topbar-block-size: 64px` (globals.css:1027), `--rail-inline-size: 17rem` = 272px (globals.css:1028), dropping to `15rem` = 240px below 1180px (globals.css:1042). `main` is fluid: `inline-size: 100%; padding-block: var(--space-3) var(--space-5); padding-inline: var(--space-4)` (globals.css:1371–1377). Prose is capped at `--measure: 72ch` but only on `main p, main li, main dd, main figcaption, main .supporting-text` (globals.css:1388–1395).

z-index ladder: rail 10, top bar 20, popovers 30, command palette 100.

### 3.2 `Nav.tsx` (≈740 lines) — the tree is **declared as data, and it is nested two levels + a contextual third**

Declared at `Nav.tsx:165` as `export const GROUPS: readonly Group[]`. Types at `Nav.tsx:141–163`:
```ts
interface SubItem { label: string; anchor: string; hint: string }
interface Entry   { href: string; label: string; hint: string; subItems?: readonly SubItem[] }
interface Group   { domain: string; entries: readonly Entry[]; tail?: true }
```

The eleven groups, in order, with their entries and real sub-item counts:

| # | `domain` | Entry (`href` → `label`) | subItems |
|---|---|---|---|
| 1 | Fleet (L167) | `/tenants` → Tenants (L170) | 0 |
| 2 | Blueprints (L177) | `/` → Systems (L180) | 2 |
| 3 | AWS (L199) | `/platform/estate` → Estate (L202) | 6 |
| | | `/platform/network` → Network (L227) | **0** |
| | | `/platform/compute` → Compute (L232) | 4 |
| | | `/platform/messaging` → Messaging (L251) | 5 |
| 4 | Identity (L265) | `/platform/identity` → Identity (L268) | **0** |
| 5 | Data (L275) | `/platform/data` → Data (L278) | 6 |
| 6 | Security (L293) | `/platform/security` → **Findings** (L296) | **0** |
| 7 | Operations (L303) | `/platform/health` → Health (L306) | 6 |
| 8 | FinOps (L321) | `/platform/cost` → Cost (L324) | 0 (deliberate) |
| 9 | Evidence (L331) | `/platform/audit` → Audit (L334) | 5 |
| 10 | Diagnostics (L348, `tail: true`) | `/platform/diagnostics` → Diagnostics (L352) | 0 |
| | | `/platform` → Platform (L357) | 0 |

Plus a **contextual third level**: `export const CONTEXTUAL` at `Nav.tsx:389` declares a branch under `/tenants` with leaves Overview (`Nav.tsx:396`, 5 anchors) and Configuration (`Nav.tsx:408`, 4 anchors), templated on `[slug]` and resolved at `Nav.tsx:448`.

**Active-item mechanism** (`Nav.tsx:455–475`): `matches()` does exact-or-subtree; `currentDestination()` collects every group entry href plus every contextual leaf href, filters by match, and sorts by **descending href length — most specific wins, and only one wins.** So `/platform/cost` lights `Cost` and not `Platform`.

Three distinct current-state markers, deliberately:
- The **page**: `<span className="here" aria-current="page">` replacing the `<a>` (`Nav.tsx:571`). `e2e/cost.spec.ts` pins the count of `aria-current="page"` inside the nav at exactly **one**.
- The **section**: `aria-current={true}` on the group `<div role="group">` (`Nav.tsx:~690`), computed from an `owned` href set so a tenant sub-route still lights `Fleet`.
- The **anchor**: `aria-current="location"` on a sub-link when the hash matches (`Nav.tsx:~648`).

Visual treatment (globals.css:1710–1722):
```css
.tabs a       { color: var(--muted); }
.tabs a:hover { background: var(--md-sys-state-hover); color: var(--text); }
.tabs .here   { color: var(--md-sys-color-on-primary-container);
                background: var(--md-sys-color-primary-container);
                font-weight: 600; box-shadow: none; }
.tabs a, .tabs .here { min-block-size: var(--control-block-size);  /* 32px */
                       padding-inline: var(--space-3);              /* 12px */
                       border-radius: var(--md-sys-shape-corner-full); }
```
So the current entry is a **filled pill** in `primary-container` — `#e4f2ea` on light, `#115e3d` on dark. Section headers are `nav.module.css:150–166`: `0.68rem / 650 / 0.07em / uppercase / --muted`, with a **2px bottom rule in `--accent`** when the section is current.

The nav element keeps `className={"tabs " + styles.rail}` (`Nav.tsx:~636`) — `tabs` is retained purely as a test-contract anchor for `cost.spec.ts:87,92` even though it is now a vertical rail.

Below 901px the tree collapses behind a `<button className={styles.disclosure}>` (`nav.module.css:66–102`, `@media (max-width: 900px)` at `nav.module.css:123`) and the panel is `display: none`, never translated off-canvas.

### 3.3 `TopBar.tsx` + `topbar.module.css` (245 lines)
Slots left→right: `Logo size={22}` + "System Studio" wordmark linking `/` (TopBar.tsx:313–315) · AWS account/region chip (TopBar.tsx:332–335, with `ESTATE_UNKNOWN` fallback and a 2.5s timeout / 30s failure TTL) · a **search button** (`Search ⌘K`) that opens the palette, never an input · account menu with email, role, `PreferencesMenu`, sign-out.

`.bar` (topbar.module.css:34–56): `display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); min-block-size: 64px; padding-block: var(--space-2); position: sticky; inset-block-start: 0; z-index: 20;`

---

## 4. Light/dark — how it is actually done

**Mechanism: a `data-theme="dark"` attribute on `<html>`, stamped pre-paint by an inline script, plus a token swap. There is no `prefers-color-scheme` media query for colour** (only for reduced motion, globals.css:919).

The chain:
1. `apps/system-studio/src/lib/preferences.ts:30–33` types: `ColorScheme = "system"|"light"|"dark"`, `Density`, `AccessibilityPreference = "system"|"on"|"off"`, `TextDirection = "ltr"|"rtl"`.
2. Storage keys (preferences.ts:64–70) — **`localStorage` only, deliberately no cookie** (STUDIO-030-005: the preference must not reach any server-side record):
   `tenure-studio-theme`, `-density`, `-reduced-motion`, `-increased-contrast`, `-direction`.
3. `resolveColorScheme` (preferences.ts:89) — `dark` wins, `system` asks the OS. `resolveAccessibility` (preferences.ts:79) — **the OS is a floor, not a default**: `on || deviceAsks`, so there is no way to express "never reduce motion".
4. `documentAttributes` (preferences.ts:196) — returns `null` for the default state so the attribute is *removed*, meaning there is exactly one source of truth per state.
5. `NO_FLASH_SCRIPT` (preferences.ts:227–283) — a dependency-free string, inlined at layout.tsx:154, that duplicates the resolution logic (it cannot import it — the bundle it would import from is the thing being raced). `preferences.test.ts` runs the same case matrix against both so the copies cannot drift.
6. `PreferencesMenu.tsx` — a `<details>`-based popover with **four radiogroups** (theme / density / motion / contrast) + direction, re-stamping the attributes on change. It handles a throwing `localStorage` (Safari private browsing) via `preferenceStore()`.

**Compared with the tenant app (`apps/web/src/components/ThemeSwitcher.tsx`), the Studio is behind on two counts:**

| | Studio | apps/web |
|---|---|---|
| Selector | `:root[data-theme="dark"]` (globals.css:290) | `html.dark` (apps/web/globals.css:398) |
| Modes | 3 — system / light / dark | **4** — light / dark / system / **scheduled** (ThemeSwitcher.tsx:27–32) |
| Scheduled dark | none | `THEME_SCHEDULE_STORAGE_KEY`, default window `20:00-06:30`, re-resolved on a 60s interval (ThemeSwitcher.tsx:34, 64) |
| `forced-colors` | not handled | `matchMedia("(forced-colors: active)")` listener (ThemeSwitcher.tsx:59); `:root[data-forced-colors="active"]` at apps/web/globals.css:698 |
| Resolution logic | duplicated script + module, kept honest by a test | centralised in `apps/web/src/lib/a11y/theme-resolution.ts` with `THEME_BOOT_SCRIPT` owned by the same module |
| Storage keys | `tenure-studio-*` | `THEME_STORAGE_KEY` / `THEME_SCHEDULE_STORAGE_KEY` |

The two apps use **incompatible selectors** (`data-theme` vs `.dark`), so no stylesheet or component can be shared across them without a shim.

---

## 5. "Tenure green" — where it is, what it is, and why the Studio's is different

**`#198052` is `--tenure-forest-700`, declared at `apps/web/src/app/globals.css:46`**, and it is the tenant app's `--primary` (`apps/web/src/app/globals.css:151`).

The contrast reasoning is recorded in **three** places and all three agree:

1. `packages/platform-config/src/branding.ts:35–38`:
   ```ts
   // Was #1c8c5a. The GE-022-003 contrast audit measured white on it at 4.24:1,
   // below the 4.5:1 AA floor, and this default is what every unbranded tenant
   // renders its primary buttons in. #198052 is the same hue at 4.94:1.
   default: "#198052",
   ```
   `#1c8c5a` is still in the ramp as `--tenure-forest-650` (apps/web/globals.css:45), used as `--success` — a fill, not a glyph.
2. `apps/system-studio/src/app/globals.css:50–58` extends it rather than undoing it. Quoted verbatim:
   > `--md-ref-primary-30` is `#115e3d` and NOT `#198052`, which is the tenant app's `--primary`. That is deliberate and measured. `#198052` was chosen for WHITE ON GREEN and clears 4.94:1 there; as a text-button LABEL it has to clear 4.5:1 on the darkest step of this console's paper ladder (`surface-container-highest`, #e6e4dd) and measures **3.88:1** — it fails. The next two steps down, forest-800 `#0f6b42`, clears at rest (5.15:1) and fails hovered (4.37:1 …). forest-850 `#115e3d` clears both: **6.13:1 at rest, 5.14:1 hovered**. The contrast audit that darkened `#1c8c5a` to `#198052` is extended here, not undone — `on-primary` on `#115e3d` is 7.47:1 and pure white is 7.80:1.
3. Dark side, globals.css:266–279: forest-350 `#34d399` = 4.24:1 **fails**, forest-300 `#56d199` = 4.23:1 **fails**, forest-200 `#6ee7b7` = **5.08:1 clears** — measured against `surface-container-highest` `#424242` **with the 12% hover layer composited under it**, because the state layer is the label's own colour and raising the label raises the ground.

**This reasoning is machine-enforced, not just written down.** `e2e/md3-tokens-logic.spec.ts:889–938` reads `apps/web/src/app/globals.css` **at test time**, extracts every `--tenure-forest-N: #RRGGBB` into a set, asserts the set has ≥14 members and contains `#198052` (so it cannot pass vacuously), then requires that `primary`, `primary-container` and `inverse-primary` in **every** theme are verbatim members of that set. A separate test (`:939`) asserts the previously-invented `#12cc7e` appears in no stylesheet with comments stripped.

**Any restyle that changes the Studio's green must pick a step of `--tenure-forest-*` or it will red the build.** That is the correct outcome and the contrast reasoning survives by construction.

**Gap:** the Studio declares **zero** `--tenure-*` tokens. It mentions the names 13 times, all in comments; apps/web declares 249. The ramp is duplicated as raw hexes and reconciled only by that test — there is no shared token package.

---

## 6. The docs

### `docs/architecture/studio-design-system.md` (674 lines)
Sections: The rule (17) · Colour (58) · Density & 320px (144) · Component geometry (158) · `--md-ref-*` (261) · `--md-sys-color-*` (268) · outline vs outline-variant (289) · The scrim (322) · Disabled opacities (342) · Type (354) · Shape (446) · Elevation (462) · State layers (481) · Motion (504) · The primitives (534) · The AWS-reading set (548) · Navigation/overlays/forms (576) · EmptyState overlap (598) · What the audit checks (618).

**It is materially stale.** §"The dark theme is OLED black" (line 71) and its two tables document values the code no longer has:

| Doc says (studio-design-system.md:100–140) | globals.css says | Line |
|---|---|---|
| `background`/`surface`/`surface-dim`/`container-lowest` all `#000000` | `#212121` / `#212121` / `#171717` / `#0d0d0d` — four different planes | 352–360 |
| `surface-container-low: #151515` | `#292929` | 357 |
| `surface-container: #222222` | `#323232` | 358 |
| `surface-container-high: #2d2d2d` | `#3a3a3a` | 359 |
| `surface-container-highest: #363636` | `#424242` | 360 |
| `surface-bright: #3c3c3c` | `#424242` | 356 |
| `surface-variant: #262626` | `#171717` | 361 |
| `on-surface: #e8e8e8` | `#ececec` | 375 |
| `outline-variant: #4a4a4a` at 2.37:1 | `#525252` | 396 |
| `primary: #12cc7e` (84% sat) | `#6ee7b7` | 291 |
| `on-primary: #00120a` | `#06130c` | 292 |
| `primary-container: #0b3b28` | `#115e3d` | 293 |
| `on-primary-container: #b6ecd0` | `#6ee7b7` | 294 |
| `inverse-primary: #0d5638` | `#0f6b42` | 400 |
| "Elevation cannot be carried by `--md-sys-elevation-*`" | Dark elevation alphas were deliberately raised (0.32→0.44 at L1) **because** the base moved off `#000` and shadow works again | 401–410 |

The doc's own §"The primitives" table covers **19** components. It contains **zero** mentions of `Menu`, `Tree`, `Popover`, `Drawer`, `Tooltip`, `Accordion`, `Combobox`, `ToastRegion`, `ModalDialog`, `Stepper`, `FileUpload`, `Chart`, `CodeBlock`, `DateTimeField`, `DangerZone` or `Logo` — 16 shipped primitives are undocumented. (I checked each name with `grep -c`.)

### `docs/architecture/studio-information-architecture.md` (769 lines)
Sections: What is wrong today (39) · What the Bible asks for (75) · **The shell (102)** · The frame (104) · Reading measure (146) · **The navigation tree (185)** · Level one (187) · Level two (225) · Domains with no surface (290) · Contextual sub-tree (309) · **The top bar (340)** · Breadcrumbs (399) · Collapse behaviour (448) · What does not change (481) · **The route map — 18 routes (511)** · Sign-in (548) · Guards (565) · Verification (606) · Implementation lanes (626) · Deliberate deviations (658) · What this doc does not do (721) · Adding a route (746).

Mostly accurate on the frame, but three concrete drifts:

| Doc | Code |
|---|---|
| ASCII diagram at :107 labels the top bar **56px** | `--topbar-block-size: 64px` (globals.css:1027) and `min-block-size: 64px` (topbar.module.css:42) |
| :492 "the new CSS hangs off an added **`console-nav`** class" | No such class exists. `Nav.tsx` uses the CSS-module hash `styles.rail`; the only `console-nav` string anywhere is the **variable** `--console-nav-offset` |
| §9 route map sub-item counts: Estate 4, Network 5, Compute 4, Messaging 4, Identity 5, Data 5, Security 3, Health 2, Audit 3 | Estate **6**, Network **0**, Compute 4, Messaging **5**, Identity **0**, Data **6**, Security **0**, Health **6**, Audit **5**. Five entries the doc says have sub-items have none |
| §3.2(b) specifies the card region becomes `grid-template-columns: repeat(auto-fit, minmax(min(100%, 34rem), 1fr)); gap: var(--space-5)` | **Not implemented.** `grep` for `auto-fit` in globals.css finds one hit (`:2299`, `.state-split`, `240px` floor) and it is not the card region. `main` has no grid at all (globals.css:1371). At 1920px a page of cards is a single stretched column |

---

## 7. The guard rail — what a restyle will red

Ten specs constrain visual change. These are the ones an implementer must read before touching a value.

| Spec | Constraint that bites |
|---|---|
| `e2e/md3-tokens-logic.spec.ts:215` | Every colour role declared in light **and again** in dark |
| `:230` | Every type role carries all four parts |
| `:243` | Shape ramp complete and monotonic |
| `:262` | Elevation 0–5 both themes, `-0` is `none` |
| `:271` | State layer opacities are Material's (8/12/12) |
| `:307` | Scrim translucent, not white, halves page luminance |
| `:335` | Motion durations inside the documented band |
| `:575` | **Every declared pair clears WCAG 2.2 AA in all four theme×contrast combinations** |
| `:739` | No dark surface / content colour / boundary carries a hue (r=g=b asserted) |
| `:760` | No foreground is pure white, in any theme |
| `:778` / `:847` | Every adjacent container step ≥ **1.12:1**, ladder monotonic |
| `:912–938` | Every green is a verbatim step of `apps/web`'s forest ramp |
| `:984` | The state layer does not spend the contrast budget |
| `:1128` | No literal colour in any md3 component |
| `:1190` / `:1197` | **Every `md3-*` class a component emits is declared in globals.css, and every `md3-*` class in globals.css is emitted by a component** — both directions |
| `:1219` | Every component in `md3/` is exported from the barrel |
| `:1270` | **No token may be declared without a consumer or an entry in `DECLARED_NOT_REFERENCED`**, whose size is capped at **11** and may only fall. Adding an unused token reds the build |
| `e2e/base-scale.spec.ts:101` | A fleet table row is **at or under 52px** |
| `:134` / `:149` | Button and text input between **24px and 34px** |
| `:175` | 24×24 hit area probed with `elementFromPoint` at four corners |
| `:313` / `:344` | ≥15 fleet rows / ≥28 estate rows in a 900px content region |
| `:373` | Largest display role **under 2× body** |
| `:441` | No sideways scroll at 200% zoom |
| `e2e/preferences.spec.ts:398` | AA contrast holds across theme × density × contrast (**no large-text exemption** — `contrastFailures` compares against 4.5 unconditionally) |
| `:304` | Every control ≥24×24 in both densities |
| `:534` | Dark container ladder visibly stepped **on the rendered page** |
| `e2e/layout.spec.ts:145/176/285/326` | No text overlap, no container overflow, no text overflowing its box, nothing clipped by fixed height — at **320 / 900 / 1440 / 1920** |
| `:463` | Whole suite re-run under `dir="rtl"` — **one physical direction property reds it** |
| `:485` | No reflow after hydration (measured with JS disabled) |
| `:625` | Nav is a full-height rail at 1440 and off-canvas at 320 |
| `tests/architecture/shell-separation.test.mjs` | Nav groups are the Bible's domains in the Bible's order; everything unfinished stays behind `tail: true` |
| `e2e/operator-roles.spec.ts:79` | `href="/tenants/new"` must be **absent from an auditor's markup** — no shell surface may render a create destination as an href literal |
| `tools/entry-point-inventory.mjs:463` | `SHARED_TOKENS` — a token whose value differs between the two apps must carry a recorded reason (`--accent`, `--border`, `--border-strong`, `--space-6`, `--ease-entry`) |

---

## 8. The table asked for: exists / missing / inconsistent

### EXISTS (do not rebuild)

| Thing | Where | State |
|---|---|---|
| Full MD3 colour role set, light | globals.css:61–201 | Complete, every value contrast-measured in-comment |
| Same set, dark | globals.css:290–434 | Complete; **exact parity, verified programmatically** |
| Increased-contrast overrides | globals.css:825–853 | 3 tokens × 2 themes |
| Shape ramp (7 steps + 4 aliases) | globals.css:456–464, 193–196 | Complete, monotonic |
| Type scale (15 roles × 4 parts) | globals.css:546–643 | Complete, ratio-1.09 ladder |
| Space scale + compact density | globals.css:703–732 | Complete, `--tap` protected |
| Component geometry tokens | globals.css:797–815 | 7 tokens, single source for control/row/card sizing |
| Motion + Material aliases + reduced | globals.css:864–930 | Complete, OS is a floor |
| Shell frame tokens | globals.css:1019–1044 | `--topbar-block-size` `--rail-inline-size` `--measure` |
| Legacy product-contract aliases | globals.css:199–210 / 424–434 | 11 names read by the inventory tool |
| Sticky 64px top bar | layout.tsx:197, topbar.module.css:34 | Mark / env / account·region / search / account menu |
| Sticky 272px full-height rail | globals.css:1121–1160 | Own scroll, `surface-dim` |
| Two-level nav tree + contextual third | Nav.tsx:165, :389 | 11 groups, 15 entries, 39 sub-items |
| Three-tier active marking | Nav.tsx:571, :690, :648 | page / section / location — exactly one `aria-current="page"` |
| Pre-paint theme+density+motion+contrast+dir | preferences.ts:227, layout.tsx:154 | No flash, no reflow |
| 40 md3 primitives + barrel | md3/index.ts | Server/client split documented |
| `primitives.css` layout layer | md3/primitives.css (877 lines) | Attribute hooks `[data-md3="…"]`, colour-free, own drift test |
| Skip link + focus rescue on route change | layout.tsx:166, :293 | Real, measured |
| Command palette (Ctrl/Cmd-K) | components/Launcher.tsx + CommandPalette.tsx | Role-filtered server-side |
| Forest-ramp enforcement | md3-tokens-logic.spec.ts:889–938 | Reads apps/web at test time |

### MISSING

| Thing | Evidence | Impact |
|---|---|---|
| **Any icon system** | `apps/system-studio/package.json` has **zero** UI dependencies. `grep -rl '<svg'` over `src/` returns 5 files, of which 3 are the logo and its test and 1 is `Chart.tsx`. apps/web has `@phosphor-icons/react ^2.1.10` and `apps/web/src/components/ui/icons.tsx` re-exporting it | The nav, the top bar, every badge and every empty state are **text-only**. An icon-led shell cannot be built without first choosing and installing an icon source |
| Web font loading | `--md-sys-type-font` names Inter (globals.css:197) but there is no `next/font`, no `@font-face`, no `<link>` | The console renders in the system fallback on most machines. Any typographic restyle is measuring a font that isn't loaded |
| Scheduled dark | Studio `ColorScheme` is 3-valued (preferences.ts:30); apps/web has 4 incl. `scheduled` with a `20:00-06:30` default (ThemeSwitcher.tsx:34) | Feature parity gap the parent flagged; it is real |
| `forced-colors` / Windows High Contrast handling | Studio `globals.css` has no `forced-colors` rule; apps/web has `:root[data-forced-colors="active"]` at its globals.css:698 | Accessibility gap |
| The multi-column card region from IA §3.2(b) | Specified at studio-information-architecture.md:172; `grep auto-fit` finds it nowhere in `main` | At 1920px a 14-card page is one stretched column — the exact "wide layout" complaint the IA doc was written to fix, half-fixed |
| A shared token package | `packages/` has 16 packages; none is a design-token package. `--tenure-*` declared 249× in apps/web, **0×** in the Studio | The ramp is duplicated as literal hex; only a test keeps them honest |
| Nav search / filter | `Nav.tsx` has no filter input | 15 entries + 39 sub-items in a 272px rail |
| Nav counts / badges | IA doc anticipates them (`:499` warns against putting a count inside the `aria-current` element) but none is rendered | — |

### INCONSISTENT

| Inconsistency | Location | Note |
|---|---|---|
| **Design-system doc documents a dark palette that no longer exists** | studio-design-system.md:71–140 vs globals.css:290–411 | 14 documented hexes are wrong; the doc's central argument ("shadow cannot carry elevation at #000") was **reversed** in code |
| 16 shipped primitives absent from the design-system doc | studio-design-system.md:534–597 | Menu, Tree, Popover, Drawer, Tooltip, Accordion, Combobox, ToastRegion, ModalDialog, Stepper, FileUpload, Chart, CodeBlock, DateTimeField, DangerZone, Logo |
| IA doc top-bar height 56px vs code 64px | studio-information-architecture.md:107 vs globals.css:1027 + topbar.module.css:42 | — |
| IA route-map sub-item counts wrong for 5 of 15 entries | studio-information-architecture.md:520–535 vs Nav.tsx | Network/Identity/Security documented with sub-items, have none |
| IA doc's `console-nav` class does not exist | studio-information-architecture.md:492 | Only `--console-nav-offset` exists |
| **A rule that is documented as not belonging where it is** | globals.css:1183–1198, quoted: *"THIS RULE SHOULD NOT SURVIVE. It belongs in `topbar.module.css`"* | `body [data-topbar="true"] { padding-inline: var(--space-4) }` at globals.css:1196 exists solely to override `padding-inline: max(var(--space-5), calc((100vw - 1280px)/2 + var(--space-5)))` at **topbar.module.css:47**. Two files fighting over one property. The correct fix is one line in topbar.module.css and one deletion in globals.css |
| Two parallel state-layer mechanisms | Baked `--md-sys-state-hover/-focus/-pressed` (globals.css:186) vs opacity tokens + `.md3-state::before` (globals.css:684, 2761–2784) | `--md-sys-state-pressed` is in `DECLARED_NOT_REFERENCED` with the note *"New work uses the opacity token instead"* (md3-tokens-logic.spec.ts:~1264). Focus/hover baked values are still live in ~10 rules |
| Two table implementations at two scales | `table.grid` (globals.css:1738) vs `.md3-table` (globals.css:3245) | The comment at globals.css:1723 records this: legacy grid predating the token layer, now repointed to `body-small` — but they remain two rulesets |
| `EmptyState` / `UnknownState` exist twice | `md3/EmptyState.tsx` + `md3/UnknownState.tsx` vs `components/states.tsx` | Recorded as open work at studio-design-system.md:598–617: `states.tsx` owns the *word*, `md3/` owns the *form*; nothing renders the other |
| 21 route-level `.module.css` files outside the class-drift contract | 3,109 lines total: signin 417, nav 368, topbar 245, cost 206, identity 190, compose 183, network 183, security 175, tenant 171, breadcrumbs 153, data 151, health 147, platform 146, audit 144, estate 136, compute 134, fleet 127, messaging 127, diagnostics 40, console-index 40, live 33 | `md3-tokens-logic.spec.ts:1190/1197` enforces bidirectional class↔stylesheet agreement **only for `md3-*` classes in globals.css**. These 21 files are only covered by the weaker "no invented colour pair" rule (nav.module.css:11–19 states the convention). This is where a restyle will find the most drift |
| Two apps, two dark-mode selectors | Studio `:root[data-theme="dark"]`, apps/web `html.dark` | Nothing visual can be shared between them |
| Nav element still called `.tabs` | Nav.tsx:~636, globals.css:1676 | Retained as a test-contract anchor for `cost.spec.ts:87,92`; IA doc:497 records the decision not to rename |
| `--md-sys-type-mono` declared but unreferenced | globals.css:198; recorded in `DECLARED_NOT_REFERENCED` as *"declared before the one monospace rule that exists, which spells its own stack"* | One rule spells its own font stack instead |

---

## 9. Practical guidance for whoever writes the overhaul

1. **This is a diff, not a rewrite.** The token layer is complete and correct in both themes. Changing a colour means changing a value in two places (globals.css:61–201 and :290–434) and re-running `md3-tokens-logic.spec.ts` — which will tell you the exact ratio you broke.
2. **You cannot add an unused token.** `md3-tokens-logic.spec.ts:1270` fails on any `--name:` with no `var(--name` reference across all stylesheets, and the exemption list is capped at 11 and may only shrink.
3. **You cannot add a colour to a component.** Every colour is a role. Add the role to globals.css first.
4. **You cannot add a physical direction property.** `layout.spec.ts:463` re-runs the whole suite under `dir="rtl"`.
5. **You cannot make rows or controls taller.** `base-scale.spec.ts` pins a fleet row ≤52px and a button/input between 24 and 34px, and `density-budget.spec.ts:577` pins a working set per fold on every dense route.
6. **The green is not yours to pick.** It must be a step of `--tenure-forest-*` in `apps/web/src/app/globals.css`, and the step must clear 4.5:1 with the 12% state layer composited under it.
7. **The two docs need updating as part of the work**, not after it. `studio-design-system.md:71–140` currently describes a console that shipped and was replaced.
8. **The first genuinely new thing to decide is the icon source** — there is no icon library, no icon component, and no icon token in the Studio at all.

## Concrete values
## Exact tokens somebody will type

### Light `:root` — apps/system-studio/src/app/globals.css:61
```css
--md-ref-primary-10: #06130c;  --md-ref-primary-30: #115e3d;
--md-ref-primary-80: #6ee7b7;  --md-ref-primary-90: #e4f2ea;
--md-ref-secondary-40: #454a53; --md-ref-tertiary-40: #3c6370;
--md-sys-color-primary: var(--md-ref-primary-30);          /* #115e3d */
--md-sys-color-on-primary: #f7fbf8;
--md-sys-color-primary-container: var(--md-ref-primary-90); /* #e4f2ea */
--md-sys-color-on-primary-container: var(--md-ref-primary-10);
--md-sys-color-secondary: var(--md-ref-secondary-40);
--md-sys-color-on-secondary: #f8f8f7;
--md-sys-color-secondary-container: #e2e0da;
--md-sys-color-on-secondary-container: #2c3038;
--md-sys-color-tertiary: var(--md-ref-tertiary-40);
--md-sys-color-on-tertiary: #f7fdff;
--md-sys-color-tertiary-container: #cbe6ef;
--md-sys-color-on-tertiary-container: #0b232c;
--md-sys-color-error: #8b2f35;             --md-sys-color-on-error: #fff8f7;
--md-sys-color-error-container: #f7dedd;   --md-sys-color-on-error-container: #2d0709;
--md-sys-color-warning: #765b12;           --md-sys-color-on-warning: #fffcf3;
--md-sys-color-warning-container: #f4e6c2; --md-sys-color-on-warning-container: #241a00;
--md-sys-color-success: #14724a;           --md-sys-color-on-success: #f7fbf8;
--md-sys-color-success-container: #e4f2ea; --md-sys-color-on-success-container: #14724a;
--md-sys-color-background: #f1f0ea;        --md-sys-color-on-background: #191a1c;
--md-sys-color-surface: #fbfaf7;
--md-sys-color-surface-dim: #ecebe5;       --md-sys-color-surface-bright: #fdfcfa;
--md-sys-color-surface-container-lowest: #fdfcfa;
--md-sys-color-surface-container-low: #fbfaf7;
--md-sys-color-surface-container: #f4f3ed;
--md-sys-color-surface-container-high: #edece5;
--md-sys-color-surface-container-highest: #e6e4dd;
--md-sys-color-surface-variant: #ecebe5;
--md-sys-color-on-surface: #191a1c;        --md-sys-color-on-surface-variant: #565b62;
--md-sys-color-outline: #6b7280;           --md-sys-color-outline-variant: #cbc9c1;
--md-sys-color-inverse-surface: #2c3038;   --md-sys-color-inverse-on-surface: #f1f0ea;
--md-sys-color-inverse-primary: var(--md-ref-primary-80);
--md-sys-color-scrim: rgba(23, 24, 26, 0.42);
--md-sys-state-hover: rgba(17, 94, 61, 0.08);
--md-sys-state-focus: rgba(17, 94, 61, 0.14);
--md-sys-state-pressed: rgba(17, 94, 61, 0.16);
--md-sys-elevation-0: none;
--md-sys-elevation-1: 0 1px 2px rgba(23,24,26,.09), 0 1px 3px rgba(23,24,26,.07);
--md-sys-elevation-2: 0 2px 6px rgba(23,24,26,.11), 0 1px 3px rgba(23,24,26,.08);
--md-sys-elevation-3: 0 4px 10px rgba(23,24,26,.12), 0 1px 3px rgba(23,24,26,.09);
--md-sys-elevation-4: 0 8px 16px rgba(23,24,26,.13), 0 2px 4px rgba(23,24,26,.10);
--md-sys-elevation-5: 0 12px 24px rgba(23,24,26,.15), 0 4px 6px rgba(23,24,26,.11);
--md-sys-type-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--md-sys-type-mono: "SFMono-Regular", "Roboto Mono", Menlo, Consolas, monospace;
--bg --surface --surface-2 --border --border-strong --text --muted --accent --ok --warn --bad
color-scheme: light;
```

### Dark `:root[data-theme="dark"]` — globals.css:290
```css
--md-sys-color-primary: #6ee7b7;            /* --tenure-forest-200 */
--md-sys-color-on-primary: #06130c;
--md-sys-color-primary-container: #115e3d;  /* forest-850 */
--md-sys-color-on-primary-container: #6ee7b7;
--md-sys-color-secondary: #c4c4c4;          --md-sys-color-on-secondary: #1a1a1a;
--md-sys-color-secondary-container: #3a3a3a; --md-sys-color-on-secondary-container: #ececec;
--md-sys-color-tertiary: #8fc7dd;           --md-sys-color-on-tertiary: #06222c;
--md-sys-color-tertiary-container: #123844; --md-sys-color-on-tertiary-container: #c3e8f3;
--md-sys-color-error: #f7b8ba;              --md-sys-color-on-error: #3b0d10;
--md-sys-color-error-container: #5a2225;    --md-sys-color-on-error-container: #ffdad9;
--md-sys-color-warning: #d8bd6a;            --md-sys-color-on-warning: #2b2200;
--md-sys-color-warning-container: #4d3d08;  --md-sys-color-on-warning-container: #f6e6bf;
--md-sys-color-success: #56d199;            /* forest-300 */
--md-sys-color-on-success: #06130c;
--md-sys-color-success-container: #0f5132;  /* forest-900 */
--md-sys-color-on-success-container: #6ee7b7;
--md-sys-color-background: #212121;         --md-sys-color-on-background: #ececec;
--md-sys-color-surface: #212121;
--md-sys-color-surface-dim: #171717;        /* the rail */
--md-sys-color-surface-bright: #424242;
--md-sys-color-surface-container-lowest: #0d0d0d;
--md-sys-color-surface-container-low: #292929;   /* the card */
--md-sys-color-surface-container: #323232;
--md-sys-color-surface-container-high: #3a3a3a;
--md-sys-color-surface-container-highest: #424242;
--md-sys-color-surface-variant: #171717;
--md-sys-color-on-surface: #ececec;         --md-sys-color-on-surface-variant: #b4b4b4;
--md-sys-color-outline: #9a9a9a;            --md-sys-color-outline-variant: #525252;
--md-sys-color-inverse-surface: #ececec;    --md-sys-color-inverse-on-surface: #212121;
--md-sys-color-inverse-primary: #0f6b42;    /* forest-800 */
--md-sys-color-scrim: rgba(0, 0, 0, 0.72);
--md-sys-state-hover: rgba(110, 231, 183, 0.10);
--md-sys-state-focus: rgba(110, 231, 183, 0.16);
--md-sys-state-pressed: rgba(110, 231, 183, 0.18);
--md-sys-elevation-1: 0 1px 2px rgba(0,0,0,.44), 0 1px 3px rgba(0,0,0,.30);
--md-sys-elevation-2: 0 2px 8px rgba(0,0,0,.48), 0 1px 3px rgba(0,0,0,.34);
--md-sys-elevation-3: 0 4px 12px rgba(0,0,0,.52), 0 1px 3px rgba(0,0,0,.36);
--md-sys-elevation-4: 0 8px 18px rgba(0,0,0,.56), 0 2px 4px rgba(0,0,0,.38);
--md-sys-elevation-5: 0 12px 26px rgba(0,0,0,.60), 0 4px 6px rgba(0,0,0,.40);
color-scheme: dark;
```

### Increased contrast — globals.css:825 / :846
```css
:root[data-contrast="more"] {
  --md-sys-color-on-surface-variant: #2c3038;  /* 5.38 → 10.40:1 on #e6e4dd */
  --md-sys-color-outline: #565b62;             /* 3.80 → 5.38:1 */
  --md-sys-color-outline-variant: #7f8794;     /* 1.30 → 2.85:1 */
}
:root[data-theme="dark"][data-contrast="more"] {
  --md-sys-color-on-surface-variant: #e0e0e0;  /* 7.61:1 on #424242, 12.20:1 on page */
  --md-sys-color-outline: #c9c9c9;
  --md-sys-color-outline-variant: #767676;
}
```

### Shape / space / geometry / motion / shell
```css
/* :456 */ none 0 · extra-small 4px · small 6px · medium 8px · large 12px · extra-large 16px · full 999px
/* :703 */ --space-1..6 = 4 8 12 16 20 28 px ; --tap: 24px
/* :723 */ compact      = 2 6  8 10 14 18 px ; --tap: 24px
/* :799 */ --control-block-size: calc(var(--tap) + var(--space-2))   /* 32px / 30px */
/* :806 */ --control-padding-block: var(--space-1)                    /* 4px */
/* :808 */ --row-padding-block: var(--space-1)                        /* 4px */
/* :810 */ --card-padding: var(--space-4) ; --card-gap: var(--space-2)
/* :813 */ --card-padding-nested: var(--space-3) ; --card-gap-nested: var(--space-1)
/* :865 */ --motion-fast: 120ms ; --motion-base: 180ms ; --ease-entry: cubic-bezier(0,0,.2,1)
/* :896 */ --md-sys-motion-easing-standard: cubic-bezier(.2,0,0,1)
/* :898 */ --md-sys-motion-easing-accelerate: cubic-bezier(.3,0,1,1)
/* :1027*/ --topbar-block-size: 64px
/* :1028*/ --rail-inline-size: 17rem   (15rem below 1180px, :1042)
/* :1038*/ --measure: 72ch
/* :1135*/ --console-nav-offset: calc(var(--topbar-block-size) + 2 * var(--space-4))  /* 96px */
```

### Type scale — globals.css:546–643 (size / line-height / weight / tracking)
```
display-large    clamp(1.38rem, 1.24rem + 0.7vw,  1.68rem) / 1.2  / 400 / -0.01em
display-medium   clamp(1.30rem, 1.19rem + 0.55vw, 1.54rem) / 1.2  / 400 / -0.005em
display-small    clamp(1.22rem, 1.13rem + 0.45vw, 1.41rem) / 1.22 / 400 / 0
headline-large   clamp(1.14rem, 1.07rem + 0.35vw, 1.30rem) / 1.25 / 720 / 0
headline-medium  clamp(1.09rem, 1.05rem + 0.2vw,  1.19rem) / 1.28 / 700 / 0
headline-small   1.09rem / 1.30 / 700 / 0
title-large      1.00rem / 1.30 / 680 / 0        ← the anchor
title-medium     0.92rem / 1.40 / 650 / 0.005em
title-small      0.84rem / 1.45 / 650 / 0.01em
body-large       0.94rem / 1.50 / 400 / 0.005em
body-medium      0.86rem / 1.50 / 400 / 0.01em   ← 13.76px, the working size
body-small       0.78rem / 1.40 / 400 / 0.015em  ← the table role
label-large      0.82rem / 1.35 / 600 / 0.01em
label-medium     0.75rem / 1.35 / 600 / 0.03em
label-small      0.69rem / 1.35 / 650 / 0.06em   ← 11px, badges/eyebrows only
```

### Current rendered geometry (what the console looks like today)

| Element | Rule | Numbers |
|---|---|---|
| Nav entry / current pill | globals.css:1695–1722 | `min-block-size: 32px`, `padding-inline: 12px`, `padding-block: 0.25rem`, `border-radius: 999px`. Current = `primary-container` fill (`#e4f2ea` light / `#115e3d` dark) at weight 600 |
| Nav section header | nav.module.css:150 | `0.68rem / 1.5 / 650 / 0.07em` uppercase, `--muted`, `padding-inline: 12px`, 2px transparent bottom border → `--accent` when current |
| Nav entry gap | nav.module.css:186 | `2px` between entries; `--space-1` between section header and list |
| Nav panel | nav.module.css:106–121 | `grid-template-columns: repeat(auto-fill, minmax(12.5rem, 1fr))`, `gap: 12px 16px`, `max-block-size: calc(100dvh - var(--console-nav-offset, 9rem))`, `overflow-y: auto` |
| Top bar | topbar.module.css:34–56 | `min-block-size: 64px`, `padding-block: 8px`, `gap: 12px`, `position: sticky`, `z-index: 20` |
| Table row | globals.css:3288 | `padding-block: 4px`, `padding-inline: 12px`, `border-block-end: 1px solid outline-variant`, `vertical-align: top`, `font: body-small` (12.48px / 1.4) → measured ~46.28px per fleet row |
| Table header | globals.css:3271 | `padding-block: 4px`, `padding-inline: 12px`, `background: surface-variant`, `border-block-end: 1px solid outline`, `label-medium` uppercase, `white-space: nowrap` |
| Table shell | globals.css:3238 | `overflow-x: auto`, `border: 1px solid outline-variant`, `border-radius: 8px`, `background: surface-container-lowest` |
| Button | globals.css:3025–3040 | `min-block-size: 32px`, `padding-inline: 16px` (text variant 12px), `border-radius: 999px`, `label-large`, `border: 1px solid transparent`, focus `outline: 2px solid primary; outline-offset: 2px` |
| Card | globals.css:2908–2916 | `display: flex; flex-direction: column; gap: 8px; padding: 16px`. Nested: 12px / 4px (globals.css:3000) |
| Surface | globals.css:2802–2814 | `background: surface-container-low`, `border: 1px solid outline-variant` **by default** |
| Chip | globals.css:3131–3148 | `min-block-size: 24px`, `padding-inline: 12px`, `border: 1px solid outline`, `border-radius: 6px`, `background: surface-container-low`, `label-large` |
| Badge | globals.css:3169–3182 | `min-block-size: calc(24px - 4px) = 20px`, `padding-inline: 8px`, `border-radius: 999px`, `label-small` uppercase, `text-wrap: balance` |
| State layer | globals.css:2761–2784 | `.md3-state::before` = `currentColor` at 0.08 hover / 0.12 focus-visible / 0.12 active |
| `main` | globals.css:1371–1377 | `inline-size: 100%`, `padding-block: 12px 20px`, `padding-inline: 16px` — **no max width, no column grid** |
| Prose measure | globals.css:1388–1395 | `main p, main li, main dd, main figcaption, main .supporting-text { max-inline-size: 72ch }` |
| body | globals.css:958–966 | `font-size: 13.5px; line-height: 1.55; min-block-size: 100vh; text-rendering: optimizeLegibility` |

### Tenure forest ramp — apps/web/src/app/globals.css:36–53 (the authority)
```css
--tenure-forest-25:  #f0f9f4;   --tenure-forest-600: #1f9e63;
--tenure-forest-50:  #e4f2ea;   --tenure-forest-650: #1c8c5a;  /* rejected: white-on = 4.24:1 */
--tenure-forest-200: #6ee7b7;   --tenure-forest-700: #198052;  /* THE Tenure green: 4.94:1 */
--tenure-forest-300: #56d199;   --tenure-forest-750: #14724a;
--tenure-forest-350: #34d399;   --tenure-forest-800: #0f6b42;
--tenure-forest-400: #37c884;   --tenure-forest-850: #115e3d;
--tenure-forest-500: #2bb673;   --tenure-forest-900: #0f5132;
--tenure-forest-550: #23a869;   --tenure-forest-950: #06130c;
--tenure-forest-a14: rgba(43,182,115,.14);  --tenure-forest-a16: rgba(43,182,115,.16);
```
`packages/platform-config/src/branding.ts:38` — `primaryColor.default: "#198052"`, `primaryTextColor.default: "#ffffff"`, `wordmark.default: "Tenure"` (priced `perOrgMinor: 9_900` USD), `colorScheme.default: "system"`.

### Measured contrast facts that must survive any restyle
| Pair | Ratio | Source |
|---|---|---|
| white on `#1c8c5a` | **4.24:1 — FAILS AA** | branding.ts:35 |
| white on `#198052` | **4.94:1 — passes** | branding.ts:37 |
| `#198052` label on `#e6e4dd` | **3.88:1 — fails** | globals.css:52–54 |
| `#0f6b42` on `#e6e4dd` at rest / hovered | 5.15:1 / **4.37:1 fails** | globals.css:55 |
| `#115e3d` on `#e6e4dd` at rest / hovered | **6.13:1 / 5.14:1 — passes both** | globals.css:56 |
| `#f7fbf8` on `#115e3d` | 7.47:1 (pure white 7.80:1) | globals.css:57 |
| `#34d399` on `#424242` + 12% layer | 4.24:1 fails | globals.css:274 |
| `#56d199` on `#424242` + 12% layer | 4.23:1 fails | globals.css:275 |
| `#6ee7b7` on `#424242` + 12% layer | **5.08:1 passes** | globals.css:276 |
| `#ececec` on `#212121` / `#424242` | 13.63:1 / 8.51:1 | globals.css:373 |
| `#9a9a9a` on `#424242` | 3.57:1 (≥3:1, WCAG 1.4.11) | globals.css:387 |
| `#6b7280` on `#e6e4dd` | 3.80:1 | globals.css:160 |
| dark container ladder steps | 1.336 / 1.135 / 1.127 / 1.132 (floor 1.12) | globals.css:236 |
| dark scrim cuts brightest surface to | 11.5% luminance | globals.css:403 |

### Preference storage keys (localStorage, no cookie)
```
tenure-studio-theme               system | light | dark          → html[data-theme="dark"]
tenure-studio-density             comfortable | compact          → html[data-density="compact"]
tenure-studio-reduced-motion      system | on | off              → html[data-motion="reduced"]
tenure-studio-increased-contrast  system | on | off              → html[data-contrast="more"]
tenure-studio-direction           ltr | rtl                      → html[dir]
tenure-studio-storage-probe       (never read; access probe)
```
Tenant app, for contrast: `THEME_STORAGE_KEY` + `THEME_SCHEDULE_STORAGE_KEY` (default `20:00-06:30`), applied as `html.dark`.

## Sources


## Confidence / not asserted
**What I did not verify and am therefore not asserting.**

1. **I made no observation of admin.google.com, Material 3's published spec, or any external console.** I did not fetch a page, read a spec, or look at a screenshot. Every number in this report came out of a file in this repository. If the parent needs "admin.google.com's list rows are 48px", that measurement has to come from a lane that actually loaded the page — it is not in this report and I will not invent it.

2. **I did not run the app or any test.** All contrast ratios quoted are the values *written in the source comments and doc tables* by whoever computed them. I did not recompute a single ratio. They are internally consistent and the specs claim to recompute them at test time, but I am reporting them as claims-in-source, not as verified measurements. The one thing I did verify mechanically is **light/dark token parity** — I extracted all 255 declarations with awk and diffed the colour subset, finding zero asymmetry in either direction.

3. **The "measured" pixel outcomes** (fleet row 46.28px, `.md3-field-input` measuring 39.33px against a declared 36px, the 460px `.md3-unknown` panels) are quoted from source comments describing measurements someone else took. I computed only the arithmetic ones (`--control-block-size` = 24 + 8 = 32px, `--card-padding` = 16px, badge `min-block-size` = 20px).

4. **Sub-item counts** were extracted with an awk scan over `Nav.tsx`, then spot-checked by reading lines 225–350 directly. The counts for Estate (6), Compute (4), Messaging (5), Data (6), Health (6), Audit (5), Systems (2) and the zeros for Network / Identity / Security / Cost / Tenants / Diagnostics / Platform are confirmed by direct read. The contextual leaves' anchor counts (Overview 5, Configuration 4) came from the awk scan only and could be off by one; the branch structure itself is confirmed.

5. **`Nav.tsx` is ~740 lines and I read roughly 500 of them** (the type declarations, the whole `GROUPS` table, `CONTEXTUAL`, `matches`/`currentDestination`, and the render body through the group map). I did not read the final ~40 lines of the contextual-leaf render. Nothing I assert depends on them.

6. **`globals.css` is 4,028 lines and I read roughly 1,400** — all nine `:root` blocks in full, the shell frame, `main`, `.tabs`, `table.grid`, and the `.md3-*` component rules for surface/state/card/button/chip/badge/table. I did **not** read lines ~1900–2800 or ~3400–4028 in detail, so there may be additional inconsistencies in the mid-file legacy rules and in the Tab / Stale / Field / Severity / progress blocks that I have not surfaced. The 80 `.md3-*` class names I list are a complete `grep -o` extraction, so the *inventory* is complete even where I did not read the rule bodies.

7. **The 21 `.module.css` files**: I read `nav.module.css` (200 of 368 lines) and `topbar.module.css` (partially, via grep). The other 19 I only counted lines for. My claim that they sit outside the bidirectional class-drift contract is an inference from reading the two assertions at `md3-tokens-logic.spec.ts:1190/1197` (which are scoped to `md3-*` classes in globals.css) plus the *unused-token* test at `:1270` which explicitly says it scans `allStylesheets`. So: unused-token detection **does** cover them; class-drift detection does not. I did not read `allStylesheets`' definition to confirm exactly which files it globs.

8. **Doc drift**: I compared the design-system doc's dark-palette table against globals.css value by value and every mismatch above is a direct comparison. But I did not read all 674 lines of that doc — there may be a later section that supersedes §71–140 and that I missed, though the two colour tables at :100 and :131 read as current rather than historical, and the `#12cc7e` value they state is the one `md3-tokens-logic.spec.ts:939` now *forbids*, which is strong evidence the doc is stale rather than that I misread it.

9. **`e2e/*.spec.ts`**: I read test *names* and a handful of bodies (the forest-ramp block at :880–938, the unused-token block at :1262–1296). The constraint table in §7 reports what each test's name and, where read, body claims. I did not execute them, so I cannot confirm they currently pass.

10. **Git state**: `git branch --show-current` returned `recover-fanout-wave` but `git status` was not run (other agents are editing this tree; a file may have changed under me between reads). If a number here disagrees with the file, the file wins.

## Risks
**Risks the overhaul will hit, in order of how expensive they are to discover late.**

1. **The single biggest risk is treating this as a greenfield restyle.** The token layer is not a draft — it is a contrast-audited, machine-enforced artefact with light/dark parity verified in both directions and ~2,200 lines of recorded reasoning. Overwriting `globals.css` throws away decisions that were made because measured alternatives failed AA, and `md3-tokens-logic.spec.ts` will red immediately but will not tell you *which* of the discarded reasons you needed. Every change should be a value-level diff against a named token.

2. **`md3-tokens-logic.spec.ts:1270` makes additive work hostile.** A new token with no `var()` consumer fails the build, and the exemption list is capped at 11 and asserted to only ever fall. So tokens must land in the same commit as the rules that consume them — you cannot stage a palette first and wire it up second.

3. **The class-drift contract is bidirectional** (`:1190` and `:1197`). Deleting a `.md3-*` rule from `globals.css` reds the build if any component still emits the class, and adding a rule reds it if no component emits it. Renaming any `md3-*` class is a two-file atomic edit.

4. **`layout.spec.ts:463` re-runs the entire overlap and sideways-scroll suite under `dir="rtl"`.** One `margin-left`, `padding-right`, `left:`, `text-align: right` or `border-left` anywhere — including in a route `.module.css` — reds it. The current stylesheets contain zero physical-direction declarations and that is a property worth not losing.

5. **The height budget is tight and tested from two directions.** `base-scale.spec.ts:101` caps a fleet row at 52px (current ≈46px, so ~6px of headroom); `:134/:149` bound controls to 24–34px (current 32px, so 2px of headroom above and 8px below); `density-budget.spec.ts:577` and `base-scale.spec.ts:313/344` require ≥15 fleet rows / ≥28 estate rows in a 900px region. Any "give it more breathing room" restyle fails all four. Conversely `preferences.spec.ts:304` and `base-scale.spec.ts:175` floor every hit area at 24×24 probed with `elementFromPoint`.

6. **`preferences.spec.ts:398` requires 4.5:1 across theme × density × contrast with no large-text exemption.** The comment at globals.css:534 records this explicitly: `contrastFailures` compares against 4.5 unconditionally, so no pair in the console is currently passing only because it counts as large text. A restyle cannot buy contrast headroom by enlarging type.

7. **The green is locked to the tenant app's file.** `md3-tokens-logic.spec.ts:889` reads `apps/web/src/app/globals.css` at test time. Two consequences: (a) any new accent must be a verbatim `--tenure-forest-*` step; (b) **an unrelated edit to `apps/web/src/app/globals.css` can red the Studio's test suite.** That coupling is not visible from inside `apps/system-studio` and is a live footgun for a parallel lane.

8. **`--space-6` is 28px in the Studio and 24px in the tenant app, deliberately, and the divergence is recorded** at `tools/entry-point-inventory.mjs:496`. Its entry also records that a previous mutation test set it to 24px and the mutant *survived in the working tree* because the run that made it was killed. If the two ever silently converge again, the recorded divergence becomes a lie that a test reads as truth. Any change to the space scale must update that record in the same commit.

9. **`--ease-entry` is recorded as `unreconciled`** (`tools/entry-point-inventory.mjs:509`): the Studio uses `cubic-bezier(0,0,.2,1)`, the tenant app `cubic-bezier(.16,1,.3,1)`. Nobody decided this. A motion pass should resolve it rather than adding a third curve — the inventory test refuses a second Studio curve.

10. **`body [data-topbar="true"] { padding-inline: var(--space-4) }` at globals.css:1196 is a live cross-file specificity fight.** It exists to beat `topbar.module.css:47`'s `max(var(--space-5), calc((100vw - 1280px)/2 + var(--space-5)))`, and the comment says so, at (0,1,1) so it wins "whichever order the two stylesheets are inserted in". CSS-module insertion order is a Next build detail. If a restyle touches either file without fixing both, the top bar's inset can silently become 340px on a 1920px monitor again — which is the exact defect the shell rewrite was commissioned to fix.

11. **Nothing loads Inter.** Any typographic decision made against a rendering that shows Inter (a designer's machine that has it installed) will look different on a machine that does not. Fix the font loading *before* tuning the type scale, or the tuning is against an unknown font.

12. **There is no icon dependency at all**, and adding one is not free here: `@phosphor-icons/react` in `apps/web` is a client-heavy barrel, while ~24 of the Studio's md3 primitives are deliberately server-renderable with no `"use client"` directive (index.ts:154 marks the split). An icon import in a server primitive either forces it client or needs an SSR-safe entrypoint. The tenant app already solved this (`icons.tsx:10–12` re-exports the type separately from "the SSR-safe entrypoint"); the Studio would need the same discipline, and `layout.spec.ts:485`'s "no reflow after hydration" check will catch it if it gets this wrong.

13. **Doc rot is now load-bearing.** `studio-design-system.md:71–140` describes an `#000000` OLED dark theme with `#12cc7e` as the accent. Both were replaced; `#12cc7e` is now *forbidden by test*. An implementer who reads the doc as the spec — which is what a doc in `docs/architecture/` is for — will write code the test suite rejects, and will not immediately understand why. Updating those two sections should be step zero of the work, not a cleanup at the end.

14. **`states.tsx` and `md3/` both export `EmptyState` and `UnknownState`.** Importing both in one route is a duplicate-identifier compile error (index.ts:70 notes this is intentional — "the compiler telling you to decide which layer you meant"). A restyle that consolidates them is touching a governed-vocabulary file (`states.tsx` owns fourteen governed state names) and needs to preserve the words, not just the shapes.

15. **Two live table implementations** (`table.grid` at globals.css:1738 and `.md3-table` at :3245) were only recently brought to one type scale. Restyling one and not the other reinstates the defect the comment at :1723 records: a row on `/tenants/[slug]` a different height from a row on `/platform/estate` for no reason a reader can infer.

16. **Other agents are editing this tree right now.** Line numbers in this report are accurate as of my reads and may shift. Every reference is also anchored by a quoted selector or token name so it can be re-found by grep rather than by line.
