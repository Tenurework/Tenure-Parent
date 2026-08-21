# Studio light/dark token system, Tenure green, Material 3 structure

## Summary
The Studio token system I was asked to design already exists and is more complete than the brief assumes: `apps/system-studio/src/app/globals.css` (4,028 lines) declares a full MD3 `--md-ref-*` / `--md-sys-*` two-layer system across four themes (light, dark, light-contrast, dark-contrast), with the accent drawn verbatim from the `--tenure-forest-*` ramp in `apps/web/src/app/globals.css`, and `apps/system-studio/e2e/md3-tokens-logic.spec.ts` already computes contrast for ~100 declared pairs using the very helper the brief names. So the deliverable is a *delta spec*, not a greenfield palette. I recomputed every pair independently with `apps/web/src/lib/a11y/contrast.ts` loaded through jiti, and found four real defects the existing audit does not catch — the worst being that the focus ring inside an inverse surface (snackbar / toast, which ship) measures 1.70:1 in light and 1.29:1 in dark against a 3:1 floor. The token table, the measured ratios, the exact green placement map, and the mode-persistence reconciliation are all below.

## Findings
# Studio token system — measured spec and delta

## 0. What already exists (read before writing anything)

| Thing | Where | State |
|---|---|---|
| MD3 two-layer token system | `apps/system-studio/src/app/globals.css` L61–L930 | Complete: `--md-ref-primary-{10,30,80,90}`, `--md-ref-secondary-40`, `--md-ref-tertiary-40`, 43 `--md-sys-color-*` roles, 60 `--md-sys-typescale-*`, 7 `--md-sys-shape-corner-*`, 6 `--md-sys-elevation-*`, 3 state opacities, 5 motion tokens |
| Four themes | `:root`, `:root[data-theme="dark"]`, `:root[data-contrast="more"]`, `:root[data-theme="dark"][data-contrast="more"]` | All four resolve; the dark block **restates every role** (asserted at spec L226) |
| Contrast audit | `apps/system-studio/e2e/md3-tokens-logic.spec.ts` L435–L578 | ~100 declared pairs × 4 themes, with `purpose` → threshold (`body` 4.5, `nonText` 3, `decorative` 1.2) |
| State-layer audit | same file L968–L1014 | Composites hover/focus/pressed under 26 interactive pairs × 4 themes |
| Persistence | `apps/system-studio/src/lib/preferences.ts` | `data-theme` attribute, key `tenure-studio-theme`, `NO_FLASH_SCRIPT` |
| Tenant-app persistence | `apps/web/src/lib/a11y/theme-resolution.ts` | `.dark` **class**, key `tenure-theme`, `THEME_BOOT_SCRIPT`, four preferences incl. `scheduled` |
| Cross-app divergence ledger | `tools/entry-point-inventory.mjs` L463–L523 `SHARED_TOKENS` | Already records `--accent`, `--border`, `--border-strong`, `--space-6`, `--ease-entry` as divergent |

**Therefore: do not write a second palette.** The work is (a) four measured fixes, (b) three missing tokens, (c) one persistence reconciliation.

---

## 1. The complete colour token table

Every value below was read out of the live stylesheet by `paletteOf`/`blockAt`/`resolveToken` from `apps/web/src/lib/a11y/css-declarations.mjs`, not transcribed by hand.

### 1.1 Accent / primary — this is where Tenure green lives

| Token | Light | Dark | Ramp step | For |
|---|---|---|---|---|
| `--md-sys-color-primary` | `#115e3d` | `#6ee7b7` | forest-850 / forest-200 | Filled-button fill, text/outlined-button label, focus ring, active tab label + indicator, progress bar, switch-on, brand mark |
| `--md-sys-color-on-primary` | `#f7fbf8` | `#06130c` | — / forest-950 | Label on the filled button |
| `--md-sys-color-primary-container` | `#e4f2ea` | `#115e3d` | forest-50 / forest-850 | Current tab pill, selected chip, masthead mark ground |
| `--md-sys-color-on-primary-container` | `#06130c` | `#6ee7b7` | forest-950 / forest-200 | Text in the above |
| `--md-sys-color-inverse-primary` | `#6ee7b7` | `#0f6b42` | forest-200 / forest-800 | Text button inside a snackbar/toast |

### 1.2 Surface ladder — pure neutral, no green

| Token | Light | Dark | For |
|---|---|---|---|
| `--md-sys-color-background` | `#f1f0ea` (paper-100) | `#212121` | The page; what `body` paints |
| `--md-sys-color-on-background` | `#191a1c` (ink-900) | `#ececec` | Text on the page |
| `--md-sys-color-surface` | `#fbfaf7` (paper-25) | `#212121` | Default plane |
| `--md-sys-color-surface-dim` | `#ecebe5` (paper-200) | `#171717` | `.console-rail`, header band |
| `--md-sys-color-surface-bright` | `#fdfcfa` | `#424242` | Brightest plane |
| `--md-sys-color-surface-container-lowest` | `#fdfcfa` | `#0d0d0d` | Tables, inputs, palette panel |
| `--md-sys-color-surface-container-low` | `#fbfaf7` | `#292929` | Card |
| `--md-sys-color-surface-container` | `#f4f3ed` | `#323232` | Raised |
| `--md-sys-color-surface-container-high` | `#edece5` | `#3a3a3a` | Tonal button, higher card |
| `--md-sys-color-surface-container-highest` | `#e6e4dd` (paper-300) | `#424242` | Hover plane, disabled fill — **the hardest ground in each theme** |
| `--md-sys-color-surface-variant` | `#ecebe5` | `#171717` | Table header band |
| `--md-sys-color-on-surface` | `#191a1c` | `#ececec` | Body text |
| `--md-sys-color-on-surface-variant` | `#565b62` (slate-600) | `#b4b4b4` | Secondary text, table headings, disabled labels |
| `--md-sys-color-outline` | `#6b7280` (slate-500) | `#9a9a9a` | Control boundary — 1.4.11, 3:1 |
| `--md-sys-color-outline-variant` | `#cbc9c1` | `#525252` | Decorative hairline — 1.2:1 floor only |
| `--md-sys-color-inverse-surface` | `#2c3038` (slate-800) | `#ececec` | Snackbar, toast |
| `--md-sys-color-inverse-on-surface` | `#f1f0ea` | `#212121` | Text on it |
| `--md-sys-color-scrim` | `rgba(23,24,26,0.42)` | `rgba(0,0,0,0.72)` | Dialog backdrop |

High-contrast overrides (`[data-contrast="more"]`) touch exactly three tokens per theme:

| Token | light-contrast | dark-contrast |
|---|---|---|
| `--md-sys-color-on-surface-variant` | `#2c3038` | `#e0e0e0` |
| `--md-sys-color-outline` | `#565b62` | `#c9c9c9` |
| `--md-sys-color-outline-variant` | `#7f8794` | `#767676` |

### 1.3 Secondary / tertiary — deliberately not a second green

| Token | Light | Dark |
|---|---|---|
| `--md-sys-color-secondary` | `#454a53` (slate-700) | `#c4c4c4` |
| `--md-sys-color-on-secondary` | `#f8f8f7` | `#1a1a1a` |
| `--md-sys-color-secondary-container` | `#e2e0da` | `#3a3a3a` |
| `--md-sys-color-on-secondary-container` | `#2c3038` | `#ececec` |
| `--md-sys-color-tertiary` | `#3c6370` | `#8fc7dd` |
| `--md-sys-color-on-tertiary` | `#f7fdff` | `#06222c` |
| `--md-sys-color-tertiary-container` | `#cbe6ef` | `#123844` |
| `--md-sys-color-on-tertiary-container` | `#0b232c` | `#c3e8f3` |

### 1.4 Error / warning / success (warning + success are Tenure additions, not MD3 roles)

| Token | Light | Dark |
|---|---|---|
| `--md-sys-color-error` | `#8b2f35` | `#f7b8ba` |
| `--md-sys-color-on-error` | `#fff8f7` | `#3b0d10` |
| `--md-sys-color-error-container` | `#f7dedd` | `#5a2225` |
| `--md-sys-color-on-error-container` | `#2d0709` | `#ffdad9` |
| `--md-sys-color-warning` | `#765b12` | `#d8bd6a` |
| `--md-sys-color-on-warning` | `#fffcf3` | `#2b2200` |
| `--md-sys-color-warning-container` | `#f4e6c2` | `#4d3d08` |
| `--md-sys-color-on-warning-container` | `#241a00` | `#f6e6bf` |
| `--md-sys-color-success` | `#14724a` (forest-750) | `#56d199` (forest-300) |
| `--md-sys-color-on-success` | `#f7fbf8` | `#06130c` |
| `--md-sys-color-success-container` | `#e4f2ea` (forest-50) | `#0f5132` (forest-900) |
| `--md-sys-color-on-success-container` | `#14724a` | `#6ee7b7` |

### 1.5 Focus ring — **the three tokens that do not exist and must be added**

There is no focus-ring token today. The ring is spelled literally at **17 sites** across `globals.css` and four `.module.css` files, always `outline: 2px solid <green>` but with **five different offsets**: `2px` ×9, `1px` ×4, `-2px` ×3, `-4px` ×1.

Add to `:root` in `apps/system-studio/src/app/globals.css`:

```css
--md-sys-color-focus-ring: var(--md-sys-color-primary);
--md-sys-color-focus-ring-inverse: var(--md-sys-color-inverse-primary);
--md-sys-focus-ring-width: 2px;
--md-sys-focus-ring-offset: 2px;
```

`--md-sys-color-focus-ring-inverse` needs no separate value in the dark block — it aliases `inverse-primary`, which already inverts. Ratios in §2.4.

---

## 2. Measured contrast — computed, not estimated

Method: `node` + `jiti` loading `apps/web/src/lib/a11y/contrast.ts` directly. Sanity check first — `contrastRatio("#ffffff", "#198052")` returns **4.9402**, which reproduces the 4.94:1 figure `packages/platform-config/src/branding.ts` records for the GE-022-003 audit. The helper is behaving.

### 2.1 Light theme — foreground on every surface (at rest)

Columns: background · surface · s-dim · s-bright · sc-lowest · sc-low · sc · sc-high · sc-highest · s-variant

| Foreground | Ratios | Floor | Worst |
|---|---|---|---|
| `on-surface` `#191a1c` | 15.25 · 16.68 · 14.58 · 16.98 · 16.98 · 16.68 · 15.66 · 14.70 · 13.69 · 14.58 | 4.5 | **13.69** ✅ |
| `on-surface-variant` `#565b62` | 5.99 · 6.56 · 5.73 · 6.67 · 6.67 · 6.56 · 6.16 · 5.78 · 5.38 · 5.73 | 4.5 | **5.38** ✅ |
| `primary` `#115e3d` | 6.83 · 7.47 · 6.53 · 7.61 · 7.61 · 7.47 · 7.02 · 6.59 · 6.13 · 6.53 | 4.5 | **6.13** ✅ |
| `secondary` `#454a53` | 7.80 · 8.53 · 7.46 · 8.69 · 8.69 · 8.53 · 8.01 · 7.52 · 7.00 · 7.46 | 4.5 | **7.00** ✅ |
| `tertiary` `#3c6370` | 5.73 · 6.27 · 5.48 · 6.38 · 6.38 · 6.27 · 5.88 · 5.52 · 5.14 · 5.48 | 4.5 | **5.14** ✅ |
| `error` `#8b2f35` | 7.20 · 7.87 · 6.88 · 8.01 · 8.01 · 7.87 · 7.39 · 6.94 · 6.46 · 6.88 | 4.5 | **6.46** ✅ |
| `warning` `#765b12` | 5.62 · 6.14 · 5.37 · 6.25 · 6.25 · 6.14 · 5.77 · 5.41 · 5.04 · 5.37 | 4.5 | **5.04** ✅ |
| `success` `#14724a` | 5.20 · 5.69 · 4.97 · 5.79 · 5.79 · 5.69 · 5.34 · 5.01 · 4.67 · 4.97 | 4.5 | **4.67** ✅ |
| `outline` `#6b7280` | 4.23 · 4.63 · 4.05 · 4.72 · 4.72 · 4.63 · 4.35 · 4.08 · 3.80 · 4.05 | 3.0 | **3.80** ✅ |
| `outline-variant` `#cbc9c1` | 1.45 · 1.59 · 1.39 · 1.62 · 1.62 · 1.59 · 1.49 · 1.40 · 1.30 · 1.39 | 1.2 (decorative) | **1.30** ✅ |

### 2.2 Dark theme — same columns

| Foreground | Ratios | Floor | Worst |
|---|---|---|---|
| `on-surface` `#ececec` | 13.63 · 13.63 · 15.18 · 8.51 · 16.45 · 12.31 · 10.85 · 9.63 · 8.51 · 15.18 | 4.5 | **8.51** ✅ |
| `on-surface-variant` `#b4b4b4` | 7.77 · 7.77 · 8.65 · 4.85 · 9.37 · 7.02 · 6.18 · 5.49 · 4.85 · 8.65 | 4.5 | **4.85** ✅ (thin) |
| `primary` `#6ee7b7` | 10.56 · 10.56 · 11.76 · 6.59 · 12.75 · 9.54 · 8.41 · 7.46 · 6.59 · 11.76 | 4.5 | **6.59** ✅ |
| `secondary` `#c4c4c4` | 9.23 · 9.23 · 10.28 · 5.76 · 11.14 · 8.34 · 7.35 · 6.52 · 5.76 · 10.28 | 4.5 | **5.76** ✅ |
| `tertiary` `#8fc7dd` | 8.73 · 8.73 · 9.72 · 5.45 · 10.53 · 7.88 · 6.95 · 6.16 · 5.45 · 9.72 | 4.5 | **5.45** ✅ |
| `error` `#f7b8ba` | 9.60 · 9.60 · 10.69 · 5.99 · 11.59 · 8.67 · 7.64 · 6.78 · 5.99 · 10.69 | 4.5 | **5.99** ✅ |
| `warning` `#d8bd6a` | 8.75 · 8.75 · 9.74 · 5.46 · 10.56 · 7.90 · 6.96 · 6.18 · 5.46 · 9.74 | 4.5 | **5.46** ✅ |
| `success` `#56d199` | 8.42 · 8.42 · 9.37 · 5.25 · 10.16 · 7.60 · 6.70 · 5.95 · 5.25 · 9.37 | 4.5 | **5.25** ✅ |
| `outline` `#9a9a9a` | 5.72 · 5.72 · 6.37 · 3.57 · 6.91 · 5.17 · 4.56 · 4.04 · 3.57 · 6.37 | 3.0 | **3.57** ✅ |
| `outline-variant` `#525252` | 2.06 · 2.06 · 2.29 · 1.29 · 2.49 · 1.86 · 1.64 · 1.46 · 1.29 · 2.29 | 1.2 (decorative) | **1.29** ✅ |

### 2.3 Filled pairs (`on-X` on `X`), both themes

| Pair | Light | Dark |
|---|---|---|
| `on-primary` / `primary` | **7.47** | **12.45** |
| `on-primary-container` / `primary-container` | **16.44** | **5.12** |
| `on-secondary` / `secondary` | **8.38** | **9.98** |
| `on-secondary-container` / `secondary-container` | **10.02** | **9.63** |
| `on-tertiary` / `tertiary` | **6.37** | **8.94** |
| `on-tertiary-container` / `tertiary-container` | **12.47** | **9.65** |
| `on-error` / `error` | **7.83** | **10.01** |
| `on-error-container` / `error-container` | **14.35** | **9.63** |
| `on-warning` / `warning` | **6.25** | **8.57** |
| `on-warning-container` / `warning-container` | **13.86** | **8.55** |
| `on-success` / `success` | **5.69** | **9.92** |
| `on-success-container` / `success-container` | **5.14** | **6.14** |
| `inverse-on-surface` / `inverse-surface` | **11.59** | **13.63** |
| `inverse-primary` / `inverse-surface` | **8.68** | **5.55** |

All ≥ 4.5. No body-text pair in the declared system is below the AA floor.

### 2.4 Focus ring — where the system breaks

`--md-sys-color-primary` used as an outline against every ground it can land on:

| Ground | Light ring `#115e3d` | Dark ring `#6ee7b7` |
|---|---|---|
| background | 6.83 | 10.56 |
| surface-container-lowest | 7.61 | 12.75 |
| surface-container-highest | 6.13 | 6.59 |
| primary-container | 6.76 | 5.12 |
| secondary-container | 5.91 | 7.46 |
| error-container | 6.11 | 8.15 |
| warning-container | 6.29 | 6.94 |
| tertiary-container | 5.98 | 8.23 |
| **inverse-surface** | **1.70 ❌** | **1.29 ❌** |

**DEFECT 1 (live).** `globals.css:3059` sets `.md3-button:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: 2px }`. `globals.css:2870` re-points a text/outlined button's *label* to `inverse-primary` inside `.md3-surface[data-container="inverse"]` — and the comment at L2860 names the exact reason ("`primary` on `inverse-surface` is 1.4:1 in light") — but **the focus ring was not re-pointed with it.** `Snackbar.tsx:66` and `ToastRegion.tsx:89` both render `container="inverse"` and both accept an action button. So a keyboard operator tabbing to a snackbar action sees a ring at **1.70:1** (light) / **1.29:1** (dark) against a WCAG 2.2 AA 1.4.11 floor of 3:1. The declared-pair audit misses it because no pair in `PAIRS` names `primary` on `inverse-surface` — the list has `inverse-primary` on `inverse-surface` (8.68 / 5.55) and stops there.

**Fix:**
```css
.md3-surface[data-container="inverse"] :focus-visible {
  outline-color: var(--md-sys-color-focus-ring-inverse);
}
```
Measured after fix: light `#6ee7b7` on `#2c3038` = **8.68:1**; dark `#0f6b42` on `#ececec` = **5.55:1**. Both clear 3:1 with margin.

Add to `PAIRS` in `md3-tokens-logic.spec.ts`, purpose `nonText`:
`{ content: role("focus-ring-inverse"), container: role("inverse-surface"), where: "the focus ring on a snackbar action" }`
and the negative case — assert `primary` on `inverse-surface` is *not* what any focus rule resolves to.

### 2.5 State layers — the baked tokens diverge from the opacity tokens

`globals.css` declares both a set of baked rgba state colours (L181–L183, L409–L411) and a set of opacities (L683–L685). Their alphas do not agree:

| State | Opacity token | Light baked | Dark baked |
|---|---|---|---|
| hover | `0.08` | `rgba(17,94,61,0.08)` ✅ | `rgba(110,231,183,0.10)` ⚠️ |
| focus | `0.12` | `rgba(17,94,61,0.14)` ⚠️ | `rgba(110,231,183,0.16)` ⚠️ |
| pressed | `0.12` | `rgba(17,94,61,0.16)` ⚠️ | `rgba(110,231,183,0.18)` ⚠️ |

The state-layer audit composites at the **opacity tokens**, so anything rendered through the baked values is audited at a lower opacity than it renders.

Primary label on `surface-container-highest`, at each alpha:

| Theme | @ token | @ baked hover | @ baked focus | @ baked pressed |
|---|---|---|---|---|
| light (0.12 / 0.08 / 0.14 / 0.16) | 5.14 | 5.46 | 4.99 | **4.84** ✅ |
| dark (0.12 / 0.10 / 0.16 / 0.18) | 5.08 | 5.31 | 4.66 | **4.46 ❌** |

**DEFECT 2 (latent, not live).** `--md-sys-state-pressed` is referenced by **zero rules** in the entire Studio (verified by grep over every `.css` under `apps/system-studio/src`). `--md-sys-state-focus` is referenced once — `.palette-result.chosen` at L2447, which I measured: light ground `#dce6e0` gives `--text` 13.62 / `--muted` 5.35; dark ground `#1d3028` gives 11.83 / 6.74. Both fine. `--md-sys-state-hover` is referenced 10 times. So the 4.46 failure is a token nobody renders — but it is a loaded gun. **Fix:** delete `--md-sys-state-pressed` from both blocks (a declared token nothing may use is exactly the class the file's own disabled-opacity note argues against), and bring `--md-sys-state-focus` / `--md-sys-state-hover` onto the opacity tokens with `color-mix` so the two systems cannot disagree:

```css
--md-sys-state-hover: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent);
--md-sys-state-focus: color-mix(in srgb, var(--md-sys-color-primary) 12%, transparent);
```
⚠️ Caveat: `contrast.ts`'s `parseColor` **cannot parse `color-mix()`** and `gamutViolations` explicitly rejects it by name (`LOOKS_LIKE_A_COLOUR` regex includes `color-mix\(`). If you make this change you must either teach `parseColor` `color-mix`, or keep literal rgba and add a spec assertion that the baked alpha equals the opacity token. **Recommend the second** — it is one assertion and no parser work.

**DEFECT 3 (latent).** Neutral text on the accent-tinted hover layer is fine at the values in force — dark `on-surface` on `composite(#6ee7b7@0.10, #212121)` = **10.83**; light `on-surface` on `composite(#115e3d@0.08, #fbfaf7)` = **14.75**. But `on-surface-variant` on the light *pressed* layer at 0.16 on `sc-highest` = **4.24 ❌**, and dark `on-surface-variant` under the 12% focus layer on `#424242` = **3.91 ❌**. Neither is rendered today (the `INTERACTIVE` list at spec L968 covers `on-primary`, `on-secondary-container`, `on-error`, `on-error-container`, `inverse-primary`, and `primary`/`error`/`on-surface` on control surfaces — **not** `on-surface-variant`). Add `on-surface-variant` to `INTERACTIVE` before anything renders a hoverable row with secondary text on `surface-container-highest`.

### 2.6 The two greens are not separable as fills

| Pair | Light | Dark |
|---|---|---|
| `primary` vs `success` | **1.31:1** | **1.26:1** |
| `primary-container` vs `success-container` | **1.00:1 — identical `#e4f2ea`** | **1.20:1** |

**DEFECT 4 (design, not accessibility).** In the light theme a selected chip / current tab (`primary-container`) and an "ok" badge (`success-container`) are the *same hex*. They are told apart only by their foreground (`#06130c` vs `#14724a`), which is a 1.31:1 difference. Nothing in WCAG forbids this; the omni-coherence problem is that "this is selected" and "this is healthy" render as one colour. The dark block already fought this battle once — the comment at L364 records moving `success-container` from forest-800 to forest-900 partly to stay "distinguishable from primary-container forest-850 (1.20:1)", which is a generous reading of 1.20. **Recommendation:** move light `--md-sys-color-success-container` off forest-50 to `#d7ece0` (a step between forest-50 and forest-200 — not on the published ramp, so it needs an owner's decision and a new ramp entry in `apps/web/src/app/globals.css` before it can be used, per the spec rule that every Studio green must be a verbatim ramp step). Alternatively accept it and record it, the way `SHARED_TOKENS` records divergences. Either is defensible; leaving it undocumented is not.

---

## 3. Exactly where Tenure green appears — and where it must not

Verified by grep over `apps/system-studio/src/app/globals.css` and every `.module.css`.

### 3.1 Green IS used (line numbers are `globals.css` unless noted)

| Surface | Token | Line |
|---|---|---|
| Filled primary button fill + border | `--md-sys-color-primary` | 1933–1934, 1992–1993, 2076–2077 |
| Sign-in submit | `--md-sys-color-primary` | 1643; `signin.module.css:124,175` |
| Text / outlined button label | `--md-sys-color-primary` | 3073, 3080 |
| Focus ring | `--md-sys-color-primary` / `--accent` | 1082, 1258, 1321, 1411, 1866, 2205, 2426, 2502, 3060, 3154, 3581, 3834, 3939 + 4 module sites |
| Active tab label + bottom indicator | `--md-sys-color-primary` | 3585–3586 |
| Current nav section underline | `--accent` | `nav.module.css:165` |
| Current tab pill fill | `--md-sys-color-primary-container` | 1717 |
| Selected chip | `--md-sys-color-primary-container` + `--accent` inset ring | 1328–1329, 1961–1963 |
| Progress bar value / indeterminate sweep | `--md-sys-color-primary` | 3735, 3739, 3756 |
| Switch, checked | `--md-sys-color-primary` | 3927–3928 |
| Checkbox/radio native tint | `accent-color: var(--accent)` | 1317 |
| Command-palette left rule | `border-inline-start: 4px solid var(--accent)` | 2178 |
| Brand mark | `--md-sys-color-primary` | `components/brand/TenureLogo.tsx:40` |
| Snackbar action label | `--md-sys-color-inverse-primary` | 2872 |
| Hover/focus state tint | `--md-sys-state-hover` / `-focus` (green at 8–16%) | 10 + 1 sites |
| Success family | `--md-sys-color-success*` | status glyphs and badges |

That is an accent, not a flood: 43 colour roles, of which 5 are green (`primary`, `on-primary-container`, `primary-container`, `inverse-primary` plus the success family).

### 3.2 Green is NOT used — verified absent

- **Page background.** `--md-sys-color-background` is `#f1f0ea` (paper-100) / `#212121`. Pure neutral.
- **Every surface-container rung.** Light: `#fdfcfa` → `#e6e4dd`, all warm paper. Dark: `#0d0d0d` → `#424242`, all r=g=b.
- **Table header band.** `--md-sys-color-surface-variant` = `#ecebe5` / `#171717`. Neutral.
- **`secondary` family.** `#454a53` / `#c4c4c4` — slate and pure grey. The comment at L69 records that `#47665a` (a green-grey) was *removed* for exactly this reason.
- **`outline` / `outline-variant`.** Neutral in all four themes.
- **Shadows.** L167–L171 records that the elevation shadows were mixed on `rgb(25,44,34)` — a green — and were moved to ink `rgba(23,24,26,…)` so raised panels stop casting a green shadow.
- **Scrim.** Ink / pure black.

**Keep it that way.** The one place a future edit will be tempted: the `[data-contrast="more"]` blocks. The comment at L831 records that those three tokens were *already once* green-greys (`#26382f`, `#43554b`, `#87988e`) and were moved to slate — "which put a tint into the one place a reader who has asked for MORE contrast is looking hardest".

### 3.3 The dark-mode green, and why it is a different hex

The brief asks for this explicitly, and the measurement is decisive. `packages/platform-config/src/branding.ts` chose `#198052` for **white on green** (4.94:1 — I reproduced it). It is wrong for **green on ground**:

| Ramp step | Hex | on `#e6e4dd` (light's darkest paper) | on `#424242` (dark's brightest) | on `#212121` (dark page) |
|---|---|---|---|---|
| forest-200 | `#6ee7b7` | 1.20 ❌ | **6.59 ✅** | 10.56 |
| forest-300 | `#56d199` | 1.50 ❌ | 5.25 ✅ | 8.42 |
| forest-350 | `#34d399` | 1.51 ❌ | 5.23 ✅ | 8.38 |
| forest-500 | `#2bb673` | 2.05 ❌ | 3.85 ❌ | 6.17 |
| forest-650 | `#1c8c5a` | 3.34 ❌ | 2.37 ❌ | 3.79 ❌ |
| **forest-700 `#198052` (branding.ts)** | `#198052` | **3.88 ❌** | **2.03 ❌** | **3.26 ❌** |
| forest-750 | `#14724a` | 4.67 ✅ | 1.69 ❌ | 2.71 ❌ |
| forest-800 | `#0f6b42` | 5.15 ✅ | 1.53 ❌ | 2.46 ❌ |
| **forest-850 `#115e3d` (Studio light)** | `#115e3d` | **6.13 ✅** | 1.29 ❌ | 2.06 ❌ |

So:

- **Light accent = `#115e3d` (forest-850)**, not `#198052`. `#198052` measures **3.88:1** as a text-button label on `surface-container-highest` — below the 4.5 floor. forest-800 `#0f6b42` clears at rest (5.15) and fails hovered (12% state layer → 4.37). forest-850 clears both: **6.13 at rest, 5.14 hovered**. This is the same audit that produced `#198052`, extended one rung, not undone: `on-primary` `#f7fbf8` on `#115e3d` = **7.47**, safer than the 4.94 that audit produced.
- **Dark accent = `#6ee7b7` (forest-200)**. The binding case is a text-button label with its own 12% state layer under it on `#424242` — the layer *is* the label's colour, so a brighter green raises the ground with it. forest-350 = 4.24 ❌, forest-300 = 4.23 ❌, forest-200 = **5.08 ✅**.
- **Light green on dark = 2.06:1. Dark green on light = 1.20:1.** Neither is a usable substitute for the other; the two-value split is required, not stylistic.
- Where green is a **fill** rather than a glyph the deeper end is used: dark `primary-container` = `#115e3d`, dark `inverse-primary` = `#0f6b42`.

---

## 4. Mode selection and persistence — the reconciliation

### 4.1 What each app does today

| | `apps/web` (tenant) | `apps/system-studio` |
|---|---|---|
| Module | `src/lib/a11y/theme-resolution.ts` | `src/lib/preferences.ts` |
| Selector | `<html class="dark">` | `<html data-theme="dark">` |
| Storage key | `tenure-theme` | `tenure-studio-theme` |
| Preferences | `light` \| `dark` \| `system` \| **`scheduled`** | `system` \| `light` \| `dark` |
| Schedule | `tenure-theme-schedule`, `"HH:MM-HH:MM"`, wall-clock, wraps midnight, refuses equal ends | **absent** |
| Pre-paint script | `THEME_BOOT_SCRIPT` | `NO_FLASH_SCRIPT` |
| Disclosure attrs | `data-theme-source` (`explicit`/`system`/`schedule`), `data-forced-colors` | none |
| Forced colours | `applyTheme` stamps `data-forced-colors="active"`; `globals.css` has an `@media (forced-colors: active)` block | **not handled** |
| Density | `data-density` (in boot script) | `data-density` ✅ |
| Reduced motion | `@media` only | `data-motion="reduced"` + device-as-floor ✅ |
| Increased contrast | `@media (prefers-contrast: more)` only | `data-contrast="more"` + device-as-floor ✅ |
| Direction | none | `dir` ✅ |
| Re-resolve on OS change | `matchMedia` listener + 60s interval (`ThemeSwitcher.tsx`) | listener in `PreferencesMenu` |
| Failure semantics | `parsePreference` narrows to `system`; `parseSchedule` returns a **reason** | `readPreference` narrows to fallback; `preferenceStore()` returns `null` on a throwing store, `writePreference` returns `false` |

Neither is a subset of the other. The Studio is ahead on device-floor accessibility, direction, and store-failure reporting. The tenant app is ahead on scheduled mode, source disclosure, and forced-colors.

### 4.2 The spec

**Do not unify the storage keys, and do not unify the selector.** Two reasons, both concrete:

1. They are different hosts. `apps/system-studio/package.json` line 5 records the reason the console is a separate app at all — "a host that serves one customer must not also serve the console that configures all of them (PD-007)". Different origins do not share `localStorage`, so a shared key would be a shared name with unshared storage: the most misleading kind of "unified".
2. `apps/web/src/lib/a11y/theme-tokens.ts` documents that the `html.dark` selector's (0,1,1) specificity is *load-bearing* — it is what makes tenant branding, injected as `:root{…}`, reach the light themes and never the dark ones, and `tenant-brand.ts` asserts that from the parsed blocks. Changing the tenant app's selector to an attribute breaks a guarantee that has a test. The Studio does not consume `brandingCss` at all (verified: its only import site is `apps/web/src/app/(app)/layout.tsx:89`), so it has no reason to adopt the class.

**Unify the RULE, not the mechanism.** Extract the shared decision into a package both apps import:

`packages/platform-config/src/theme-resolution.ts` — move `ThemePreference`, `ThemeSchedule`, `ThemeEnvironment`, `ResolvedTheme`, `parsePreference`, `parseClock`, `parseSchedule`, `formatSchedule`, `scheduleSaysDark`, `resolveTheme` verbatim out of `apps/web/src/lib/a11y/theme-resolution.ts`. These are pure functions over strings and booleans — no DOM, no storage, no client boundary. Both apps keep their own *stamping* layer (`applyTheme` writes a class; `documentAttributes` writes attributes) and their own boot string.

Then, ordered by value:

1. **Studio gains `scheduled`.** `ColorScheme` in `preferences.ts` becomes `ThemePreference` from the package; add `STORAGE_KEYS.colorSchedule = "tenure-studio-theme-schedule"`; extend `NO_FLASH_SCRIPT` with the window parse. `PreferencesMenu` gains the two `type="time"` fields that `ThemeSwitcher.tsx` already has, including its behaviour of *refusing* an unparseable window and saying why rather than persisting something the resolver will ignore.
2. **Studio gains forced-colors.** `documentAttributes` adds `"data-forced-colors": device.forcedColors ? "active" : null`, and `globals.css` gains an `@media (forced-colors: active)` block dropping shadows, the `.md3-state::before` translucent layer, and the scrim — matching what `apps/web/src/app/globals.css` already does. Today a Studio operator in Windows High Contrast gets a page fighting the platform palette.
3. **Studio gains `data-theme-source`.** Same three values. Without it, `preferences.spec.ts` cannot distinguish "dark because you chose it" from "dark because the schedule says so", and neither can the operator.
4. **Tenant app gains the device-as-floor asymmetry.** `apps/web` honours `prefers-contrast: more` and `prefers-reduced-motion` by media query only — there is no user control and therefore no way for a user to opt *in* on a machine that does not ask. Port `resolveAccessibility` and the `data-motion` / `data-contrast` attributes from `preferences.ts`. This is the one direction where the Studio is the better design.
5. **`platform.branding.colorScheme` is consumed by nobody.** `branding.ts` documents it as the institutional default ("an institution that runs its console dark by policy sets it once here"), and `apps/web/src/lib/a11y/brand-roles.ts:84` classifies it `role: "ambience", writes: []`. Grep confirms no reader in either app. Either wire it — the resolved tenant value becomes the *fallback* when `localStorage` holds nothing, injected into the boot script alongside `brandingCss` — or delete the key. A priced-and-documented configuration key that changes nothing is worse than an absent one.

### 4.3 Token-name reconciliation

The Studio already publishes an alias block onto the tenant vocabulary (`globals.css` L200–L212 and L423–L435): `--bg`, `--surface`, `--surface-2`, `--border`, `--border-strong`, `--text`, `--muted`, `--accent`, `--ok`, `--warn`, `--bad`. But the names only partly match `apps/web`:

| Studio | apps/web | Same name? | Same meaning? |
|---|---|---|---|
| `--bg` | `--bg-base` | no | yes |
| `--surface` | `--bg-surface` | no | yes |
| `--surface-2` | `--bg-subtle` | no | yes |
| `--text` | `--text-1` | no | yes |
| `--muted` | `--text-2` | no | yes |
| `--border` / `--border-strong` | same | **yes** | yes (values diverge — recorded in `SHARED_TOKENS`) |
| — | `--border-control` | absent | Studio uses `--md-sys-color-outline` |
| `--accent` = **green** | `--accent` = **navy** `--tenure-navy-700` | **yes** | **NO** |
| `--ok` / `--warn` / `--bad` | `--success` / `--warning` / `--error` | no | yes |

**`--accent` is the defect the brief is pointing at.** One name, two colour families, both apps declaring it, and any rule or component copied between them silently changes hue. `SHARED_TOKENS` marks it `deliberate` — but the reason it gives ("both are the local action/focus accent") is the argument *against* sharing the name, not for it.

**Fix:** rename the Studio's alias `--accent` → `--primary`, matching `apps/web`'s `--primary` (which is also the brand green, at a different rung — recordable as a `SHARED_TOKENS` divergence for the same reason `--border` is). Then either rename `apps/web`'s navy `--accent` → `--admin` (it means "the administration surface reads as its own plane", per the comment at `apps/web/src/app/globals.css:157`) or leave it and record that the Studio no longer declares an `--accent` at all. Twelve Studio call sites; mechanical.

Second-order: bring the Studio's remaining aliases onto the tenant names (`--bg-base`, `--bg-surface`, `--bg-subtle`, `--text-1`, `--text-2`, `--success`, `--warning`, `--error`). ~45 references. **Do this in a commit that touches nothing else**, because `tools/entry-point-inventory.mjs` regenerates `docs/…/entry-points.md` from these names and `npm run test:platform` fails on a stale copy.

### 4.4 Type scale — the brief's `--step-*` / `text-meta` question

The Studio has **no Tailwind** (`apps/system-studio/package.json` has no tailwind dependency and there is no `tailwind.config.ts`) — it is plain CSS modules plus `globals.css`. So `fontSize: { meta: "var(--step-00)" }` from `apps/web/tailwind.config.ts:170` does not apply, and there is nothing to reuse mechanically.

The two scales, for the record:

| apps/web | value | Studio equivalent | value |
|---|---|---|---|
| `--step-00` (`text-meta`) | `0.75rem` / 12px | `--md-sys-typescale-label-medium-size` | `0.75rem` — **agree** |
| `--step-0` (body) | `0.875rem` / 14px | `--md-sys-typescale-body-medium-size` | `0.86rem` / 13.76px — 0.24px apart |
| `--step-1` (`text-lead`) | `1rem` | `--md-sys-typescale-title-large-size` | `1rem` — **agree** |
| `--step-2` | `clamp(1.15rem, 1.05rem + 0.4vw, 1.35rem)` | `--md-sys-typescale-headline-large-size` | `clamp(1.14rem, 1.07rem + 0.35vw, 1.3rem)` |
| `--step-3` | `clamp(1.35rem, 1.2rem + 0.7vw, 1.75rem)` | `--md-sys-typescale-display-small-size` | `clamp(1.22rem, 1.13rem + 0.45vw, 1.41rem)` |
| `--step-4` | `clamp(1.7rem, 1.4rem + 1.3vw, 2.4rem)` | `--md-sys-typescale-display-large-size` | `clamp(1.38rem, 1.24rem + 0.7vw, 1.68rem)` |

These diverge *by decision*, not by drift: ADR-0009 §"Component scale: compact by default" and the note at `globals.css:496` record the Studio's heading ladder being deliberately flattened to a 1.09 geometric ratio topping out at 1.95× body, against the tenant app's 2.74× at the wide end. **Do not unify the type scale.** Add the six pairs to `SHARED_TOKENS` (status `deliberate`) so the divergence is owned, exactly as `--space-6` is. Spacing already agrees at steps 1–5 (4/8/12/16/20 in both) and diverges only at `--space-6` (24 vs 28), which is already recorded.

---

## 5. Implementation order

1. **Focus-ring tokens + the inverse-surface fix** (§1.5, §2.4). This is a live AA failure on a shipped component. Four new tokens, one new CSS rule, 17 declaration sites collapsed onto them, two new spec pairs.
2. **Delete `--md-sys-state-pressed`; assert baked alpha == opacity token** (§2.5). Removes a dead token that measures 4.46:1 if anyone reaches for it.
3. **Add `on-surface-variant` to `INTERACTIVE`** in `md3-tokens-logic.spec.ts` (§2.5). It will red at 3.91 (dark, 12% on `#424242`) — which is the point; fix by raising dark `on-surface-variant` from `#b4b4b4` toward `#c4c4c4` (which measures 4.51 hovered) or by forbidding secondary text inside a state-layered control.
4. **Rename `--accent` → `--primary` in the Studio** (§4.3). Mechanical, 12 sites, ends a name collision with opposite hues.
5. **Extract `theme-resolution` to `packages/platform-config`**, then Studio gains `scheduled` + forced-colors + `data-theme-source`; tenant app gains `data-motion` / `data-contrast` (§4.2 items 1–4).
6. **Decide `platform.branding.colorScheme`** — wire or delete (§4.2 item 5).
7. **Light `success-container` vs `primary-container`** — owner decision (§2.6).
8. **Fix the stale sentence in `docs/decisions/ADR-0009-design-system-substrate.md`**: it says "The dark theme is OLED black with a deep forest-green accent, by direct instruction", but `globals.css:230` records the owner moving off OLED black to the `#212121` near-black neutral family, and off the invented `#12cc7e` to forest-200. The ADR's *decision* is unaffected; its supporting sentence is now false.

## Concrete values
FOCUS RING TOKENS TO ADD — apps/system-studio/src/app/globals.css, in the :root block after --md-sys-color-scrim (line ~180):

  --md-sys-color-focus-ring: var(--md-sys-color-primary);
  --md-sys-color-focus-ring-inverse: var(--md-sys-color-inverse-primary);
  --md-sys-focus-ring-width: 2px;
  --md-sys-focus-ring-offset: 2px;

RESOLVED VALUES: focus-ring light #115e3d, dark #6ee7b7. focus-ring-inverse light #6ee7b7, dark #0f6b42. No dark-block override needed (both alias tokens that already invert).

CSS RULE TO ADD (fixes the live 1.70:1 / 1.29:1 failure):

  .md3-surface[data-container="inverse"] :focus-visible {
    outline-color: var(--md-sys-color-focus-ring-inverse);
  }

COMPLETE LIGHT PALETTE (:root)
--md-ref-primary-10 #06130c | --md-ref-primary-30 #115e3d | --md-ref-primary-80 #6ee7b7 | --md-ref-primary-90 #e4f2ea | --md-ref-secondary-40 #454a53 | --md-ref-tertiary-40 #3c6370
primary #115e3d | on-primary #f7fbf8 | primary-container #e4f2ea | on-primary-container #06130c
secondary #454a53 | on-secondary #f8f8f7 | secondary-container #e2e0da | on-secondary-container #2c3038
tertiary #3c6370 | on-tertiary #f7fdff | tertiary-container #cbe6ef | on-tertiary-container #0b232c
error #8b2f35 | on-error #fff8f7 | error-container #f7dedd | on-error-container #2d0709
warning #765b12 | on-warning #fffcf3 | warning-container #f4e6c2 | on-warning-container #241a00
success #14724a | on-success #f7fbf8 | success-container #e4f2ea | on-success-container #14724a
background #f1f0ea | on-background #191a1c | surface #fbfaf7 | surface-dim #ecebe5 | surface-bright #fdfcfa
surface-container-lowest #fdfcfa | -low #fbfaf7 | (base) #f4f3ed | -high #edece5 | -highest #e6e4dd
surface-variant #ecebe5 | on-surface #191a1c | on-surface-variant #565b62
outline #6b7280 | outline-variant #cbc9c1
inverse-surface #2c3038 | inverse-on-surface #f1f0ea | inverse-primary #6ee7b7
scrim rgba(23,24,26,0.42)
state-hover rgba(17,94,61,0.08) | state-focus rgba(17,94,61,0.14) | state-pressed rgba(17,94,61,0.16)

COMPLETE DARK PALETTE (:root[data-theme="dark"])
primary #6ee7b7 | on-primary #06130c | primary-container #115e3d | on-primary-container #6ee7b7
secondary #c4c4c4 | on-secondary #1a1a1a | secondary-container #3a3a3a | on-secondary-container #ececec
tertiary #8fc7dd | on-tertiary #06222c | tertiary-container #123844 | on-tertiary-container #c3e8f3
error #f7b8ba | on-error #3b0d10 | error-container #5a2225 | on-error-container #ffdad9
warning #d8bd6a | on-warning #2b2200 | warning-container #4d3d08 | on-warning-container #f6e6bf
success #56d199 | on-success #06130c | success-container #0f5132 | on-success-container #6ee7b7
background #212121 | on-background #ececec | surface #212121 | surface-dim #171717 | surface-bright #424242
surface-container-lowest #0d0d0d | -low #292929 | (base) #323232 | -high #3a3a3a | -highest #424242
surface-variant #171717 | on-surface #ececec | on-surface-variant #b4b4b4
outline #9a9a9a | outline-variant #525252
inverse-surface #ececec | inverse-on-surface #212121 | inverse-primary #0f6b42
scrim rgba(0,0,0,0.72)
state-hover rgba(110,231,183,0.10) | state-focus rgba(110,231,183,0.16) | state-pressed rgba(110,231,183,0.18)

HIGH-CONTRAST OVERRIDES (three tokens each)
:root[data-contrast="more"]            on-surface-variant #2c3038 | outline #565b62 | outline-variant #7f8794
:root[data-theme="dark"][data-contrast="more"]  on-surface-variant #e0e0e0 | outline #c9c9c9 | outline-variant #767676

SHAPE  none 0 | extra-small 4px | small 6px | medium 8px | large 12px | extra-large 16px | full 999px
SPACE  --space-1 4px | -2 8px | -3 12px | -4 16px | -5 20px | -6 28px | --tap 24px
       compact: 2 / 6 / 8 / 10 / 14 / 18 px, --tap stays 24px
GEOMETRY --control-block-size calc(var(--tap) + var(--space-2)) = 32px comfortable, 30px compact
         --control-padding-block var(--space-1) | --row-padding-block var(--space-1)
         --card-padding var(--space-4) | --card-gap var(--space-2)
         --card-padding-nested var(--space-3) | --card-gap-nested var(--space-1)
STATE OPACITIES hover 0.08 | focus 0.12 | pressed 0.12
MOTION --motion-fast 120ms | --motion-base 180ms | --ease-entry cubic-bezier(0,0,0.2,1)

NEW STORAGE KEY (Studio scheduled mode)  "tenure-studio-theme-schedule", format "HH:MM-HH:MM", default "20:00-06:30"
EXISTING KEYS  tenure-studio-theme | -density | -reduced-motion | -increased-contrast | -direction
TENANT KEYS    tenure-theme | tenure-theme-schedule | tenure-nav | tenure-density

MEASURED RATIOS, WORST CASE PER FOREGROUND (light / dark), computed with apps/web/src/lib/a11y/contrast.ts
  on-surface        13.69 / 8.51    floor 4.5   PASS
  on-surface-variant 5.38 / 4.85    floor 4.5   PASS
  primary            6.13 / 6.59    floor 4.5   PASS
  secondary          7.00 / 5.76    floor 4.5   PASS
  tertiary           5.14 / 5.45    floor 4.5   PASS
  error              6.46 / 5.99    floor 4.5   PASS
  warning            5.04 / 5.46    floor 4.5   PASS
  success            4.67 / 5.25    floor 4.5   PASS
  outline            3.80 / 3.57    floor 3.0   PASS
  outline-variant    1.30 / 1.29    floor 1.2   PASS (decorative)
  focus ring on inverse-surface  1.70 / 1.29    floor 3.0   FAIL -> 8.68 / 5.55 after fix
  primary hovered (12%) on sc-highest  5.14 / 5.08   floor 4.5  PASS
  on-surface-variant hovered (12%) on sc-highest  4.59 / 3.91  floor 4.5  dark FAILS, unaudited

GREEN RAMP AS FOREGROUND (why two values are required)
  #198052 (branding.ts) on #e6e4dd = 3.88 FAIL | on #212121 = 3.26 FAIL | on #424242 = 2.03 FAIL
  #ffffff on #198052 = 4.94 PASS  <- reproduces branding.ts's recorded figure exactly
  #115e3d on #e6e4dd = 6.13 PASS  | on #212121 = 2.06 FAIL
  #6ee7b7 on #424242 = 6.59 PASS  | on #e6e4dd = 1.20 FAIL
  #f7fbf8 on #115e3d = 7.47 PASS | #06130c on #6ee7b7 = 12.45 PASS

REPRODUCTION COMMAND (Node 22 + the repo's own jiti; writes nothing into the tree)
  node -e "const{createJiti}=await import('file:///C:/Users/satvi/Tenure-Parent/node_modules/jiti/lib/jiti.mjs');const j=createJiti(import.meta.url,{interopDefault:true});const{contrastRatio}=j('C:/Users/satvi/Tenure-Parent/apps/web/src/lib/a11y/contrast.ts');console.log(contrastRatio('#ffffff','#198052'))" --input-type=module
  => 4.940197196634233

## Sources
- https://m3.material.io/foundations/interaction/states/state-layers (attempted — returned only the page <title>; JS-rendered, no spec content retrieved)
- https://admin.google.com (attempted — 302 to https://www.google.com/sorry/index, captcha interstitial; page never seen)

## Confidence / not asserted
WHAT I VERIFIED BY EXECUTION
- Every contrast number in this spec was computed by running `contrastRatio` from apps/web/src/lib/a11y/contrast.ts, loaded through the repo's own jiti (node_modules/jiti), against token values parsed out of apps/system-studio/src/app/globals.css by the repo's own paletteOf/blockAt/resolveToken from apps/web/src/lib/a11y/css-declarations.mjs. Nothing was transcribed by hand and nothing was estimated. Control check: contrastRatio("#ffffff","#198052") = 4.9402, which reproduces the 4.94:1 figure branding.ts records — so the helper and my harness agree with the audit that produced the brand value.
- The four defects are grounded in file+line, not inference. DEFECT 1: globals.css:3059 sets the ring to --md-sys-color-primary; globals.css:2870 re-points only the LABEL inside data-container="inverse"; Snackbar.tsx:66 and ToastRegion.tsx:89 both render container="inverse". DEFECT 2: grep over every .css under apps/system-studio/src returns zero references to --md-sys-state-pressed and one to --md-sys-state-focus. DEFECT 3: the INTERACTIVE list at md3-tokens-logic.spec.ts:968-981 does not contain on-surface-variant. DEFECT 4: light primary-container and success-container both resolve to #e4f2ea.

WHAT I COULD NOT VERIFY — stated plainly rather than described
- **admin.google.com.** I attempted a fetch. It 302'd to google.com/sorry (a bot/captcha interstitial), so I never saw the page. I have NO verified measurement of its list-row height, its horizontal padding, its background hex, or its accent placement, and I have therefore made no claim about them anywhere in this spec. The "overwhelmingly neutral with one accent" principle is grounded instead in docs/decisions/ADR-0009-design-system-substrate.md ("one accent, used sparingly, and neutral surfaces everywhere else"), which I read in full and which is this repo's own accepted decision. If the implementer needs real admin.google.com numbers, they must be measured from an authenticated session with devtools — do not take them from me.
- **Material 3's focus-indicator spec.** I tried m3.material.io/foundations/interaction/states/state-layers; the page is JS-rendered and WebFetch returned only the <title>. A follow-up search returned no page carrying the token name, thickness or offset. So I do NOT assert what colour role or dimensions M3 specifies for the focus ring. My proposed 2px/2px is the value the Studio already uses at 9 of its 17 sites, chosen for internal consistency, not because M3 says so. The 8%/12%/12% state opacities in §1 are cited from the repo's own globals.css comment claiming them as "Material's own" — I could not independently confirm that against m3.material.io either.
- **Test suite status.** I did not run `npx playwright test` (would require a browser install and the instruction was strictly read-only). I re-derived the audits' arithmetic independently rather than trusting or running them. The three latent defects I report are pairs the existing spec does not enumerate, so they would not be red today; DEFECT 1 is a pair the spec does not enumerate either, which is exactly why it has shipped.
- **Whether Snackbar/ToastRegion callers actually pass a focusable action today.** The `action` prop is `ReactNode`; I did not trace every call site. The CSS rule at globals.css:2870 exists specifically for `.md3-button[data-variant="text"|"outlined"]` inside an inverse surface, so the placement is supported by the design system whether or not a caller exercises it this week. I would call DEFECT 1 confirmed as a system defect and unconfirmed as a currently-reachable one.
- **The proposed #d7ece0 for light success-container (§2.6)** is my arithmetic, not a published Tenure ramp step. It cannot be used until it is added to --tenure-forest-* in apps/web/src/app/globals.css, because md3-tokens-logic.spec.ts fails any green role whose value is not a verbatim ramp step. I flagged this rather than proposing a value that would red the build.

SCOPE HONESTY
The brief asked me to design this token system. It already exists, at a level of rigour above what a fresh design would produce — four themes, ~100 audited pairs, a documented reason for every hex. Presenting a new palette here would have been inventing work. What I have delivered instead is the measured delta: four defects with reproduced numbers, three missing tokens, and a persistence reconciliation. If the intent was a *different* Studio from apps/system-studio, that Studio does not exist in this tree on branch recover-fanout-wave and I found no plan file for one.

I edited, staged, committed and deleted nothing. The only files I wrote are four scratch .mjs harnesses under /tmp/tenure-contrast/, outside the repository.

## Risks
1. FOCUS RING FIX IS THE ONLY LIVE ACCESSIBILITY FAILURE — do it first. A keyboard operator dismissing a snackbar currently gets a focus ring at 1.29:1 in dark mode. WCAG 2.2 AA 1.4.11 requires 3:1. This has shipped.

2. RENAMING --accent IN THE STUDIO WILL BREAK docs/entry-points.md UNTIL REGENERATED. tools/entry-point-inventory.mjs enumerates declared token names across both apps and `npm run test:platform` fails on a stale committed copy. Rename and regenerate in the SAME commit, and update the SHARED_TOKENS entry for --accent (tools/entry-point-inventory.mjs:464-475) in that commit too — the ledger's own guard fails when an entry describes a divergence that no longer exists (this exact failure is recorded in the --space-6 entry at line 496).

3. color-mix() WILL BLIND THE CONTRAST AUDIT. If §2.5's state-layer fix is implemented with color-mix(), contrast.ts's gamutViolations() rejects it by name (the LOOKS_LIKE_A_COLOUR regex at contrast.ts includes `color-mix\(`) and parseColor returns null. The token would be flagged as unmeasurable, not silently skipped — which is the good failure — but the pair would then be untestable. Use literal rgba plus an assertion that the baked alpha equals the opacity token instead.

4. ADDING on-surface-variant TO INTERACTIVE WILL RED THE SUITE IMMEDIATELY at 3.91:1 (dark, 12% layer on #424242). That is intended, but it means the change cannot land alone — pair it with either raising dark on-surface-variant to #c4c4c4 (4.51 hovered) or a rule forbidding secondary text inside a state-layered control. Do not merge the spec change without the fix.

5. DO NOT CHANGE apps/web's html.dark SELECTOR TO AN ATTRIBUTE. Its (0,1,1) specificity is what stops tenant branding — injected as :root{...} by brandingCss — from reaching dark-theme tokens, and apps/web/src/lib/a11y/tenant-brand.ts asserts that from the parsed blocks. An attribute selector has the same specificity and would let a tenant accent leak into dark mode. This is documented at apps/web/src/lib/a11y/theme-tokens.ts in the readBlocks() header.

6. TWO STORAGE KEYS IS CORRECT, NOT A DEFECT. apps/system-studio and apps/web are deliberately different hosts (PD-007, recorded in apps/system-studio/package.json line 5). Different origins do not share localStorage. Unifying the KEY NAME without unifying the origin produces a shared name over unshared storage, which is more misleading than two names. Unify the resolution FUNCTION, not the key.

7. THE LIGHT primary-container / success-container COLLISION IS AN OWNER DECISION, NOT A BUG FIX. Any new green must be a verbatim --tenure-forest-* step or md3-tokens-logic.spec.ts fails it. Adding a ramp step means editing apps/web/src/app/globals.css, which is the tenant app — a cross-app change for a console-only problem. Get the decision before the edit.

8. FOUR AGENTS MAY BE EDITING THIS TREE. Every line number above was read at the time of this survey on branch recover-fanout-wave. Re-grep before applying any patch; a shifted line is somebody else's work, not drift in this spec.
