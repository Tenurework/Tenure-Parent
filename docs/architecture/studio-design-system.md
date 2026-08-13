# System Studio design system — the Material 3 foundation

What the console's tokens are, what each group is for, and the one rule that
keeps the accessibility guarantee true.

There are two files and one test:

| | |
|---|---|
| `apps/system-studio/src/app/globals.css` | Every token, and every rule that uses one. The only place in the console a colour exists. |
| `apps/system-studio/src/components/md3/` | The primitives. Seven components, and not a colour among them. |
| `apps/system-studio/e2e/md3-tokens-logic.spec.ts` | The audit. Computes WCAG 2.2 AA for every declared pair in all four theme/contrast combinations, with and without the state layer, and fails on a colour in a component. No browser, no server. |

---

## The rule

> **A component may not contain a literal colour.**
>
> Not a hex code, not `rgb(`, not a colour keyword, not a `style` attribute
> carrying one. A component decides which **role** applies. It never decides
> what the role's value is.

It is not a style preference; the contrast guarantee depends on it. The audit
computes ratios for the pairs it can find, and every pair it can find is a pair
declared in `globals.css`. One literal in one component is a pair the audit does
not know exists, in the file nobody would think to point it at — and it will be
a pair that is fine in light and 2.1:1 in dark, because that is the one a person
cannot check by looking.

So the spec reads every file in `components/md3/` and fails on a colour in any
syntax, and separately fails on an inline `style={{…}}` — which is where a
colour hides once it is a variable and the lexical scan can no longer see it.

**Proven, not asserted.** A literal `#8b2f35` added to `Badge.tsx` reds the
suite (`1 failed`); removing it greens it (`21 passed`).

---

## Colour

Two layers, which is Material's structure and is worth keeping.

### `--md-ref-*` — the reference ramp

Six tones of the seed, with no meaning attached. They say what a colour **is**.
The light theme's roles resolve *through* them (`--md-sys-color-primary:
var(--md-ref-primary-30)`) rather than restating their hex codes beside them, so
the ramp cannot drift from the palette it is the source of.

### `--md-sys-color-*` — the roles

They say what a colour is **for**. Every role is declared in the light `:root`
and **restated** in `:root[data-theme="dark"]` — the audit fails on a role the
dark theme inherits, because an inherited light `on-tertiary-container` is 1.2:1
on a dark surface and nothing says so until the chip that uses it ships.

| Group | Roles | What it is for |
|---|---|---|
| **Primary** | `primary`, `on-primary`, `primary-container`, `on-primary-container` | The one action per screen. The masthead mark, the current tab, the filled button. |
| **Secondary** | `secondary`, `on-secondary`, `secondary-container`, `on-secondary-container` | Supporting emphasis: the tonal button, the selected chip. |
| **Tertiary** | `tertiary`, `on-tertiary`, `tertiary-container`, `on-tertiary-container` | A fact that is neither good nor bad — a region, an environment, an account. |
| **Error** | `error`, `on-error`, `error-container`, `on-error-container` | Something failed, or something is about to be destroyed. |
| **Warning** | `warning`, `on-warning`, `warning-container`, `on-warning-container` | Not a Material role. Stale, retrying, refused, unknown. |
| **Success** | `success`, `on-success`, `success-container`, `on-success-container` | Not a Material role. Healthy, applied, reconciled. |
| **Surfaces** | `background`, `on-background`, `surface`, `surface-dim`, `surface-bright`, `surface-container-lowest` / `-low` / `-container` / `-high` / `-highest`, `surface-variant` | The container ladder. Regions are separated by **which step of the ladder** they sit on, not by a border. |
| **Content** | `on-surface`, `on-surface-variant` | Body text, and the quieter text: captions, table headings, disabled labels, hints. |
| **Boundaries** | `outline`, `outline-variant` | See below. The distinction is load-bearing. |
| **Inverse** | `inverse-surface`, `inverse-on-surface`, `inverse-primary` | A surface that must read as *not* part of the page. The accent inverts with it — `primary` on `inverse-surface` is 1.4:1 in light. |
| **Scrim** | `scrim` | The page behind a dialog. Deliberately not `rgba(0, 0, 0, …)`: `preferences.spec.ts` fails the theme that renders pure black. |

### `outline` and `outline-variant` are not interchangeable

- **`outline`** is a boundary that carries **meaning** — the edge of a control,
  the edge of a focusable thing. Audited at 3:1 against every surface
  (WCAG 2.2 AA 1.4.11). `Button`, `Chip` and the table's header rule use it.
- **`outline-variant`** is a **decorative** hairline: the edge of a card that is
  already distinct by its container colour, the divider between two rows that
  are already legible. It is around 1.2–1.5:1 by design and **may never be the
  only thing separating a control from the page.**

That rule caught a real defect while it was being written: the disabled filled
button drew its border in `outline-variant`, which measured 1.21:1 in light and
1.24:1 in dark against `surface-container-highest`. Once the fill goes neutral
that border is the only thing marking where the control is — a boundary that
carries meaning. It is `outline` now.

### Material's disabled opacities are deliberately absent

Material dims disabled content to 38%, and WCAG 1.4.3 permits it by name
("inactive user interface component"). This console does not. A disabled control
here is usually the most important thing on the screen — it is the transition an
operator came to perform and cannot — so it keeps a readable label
(`on-surface-variant`, 4.5:1 or better on every surface, in both themes and in
increased contrast) and loses its fill and its state layer instead. There are no
disabled-opacity tokens, because nothing may use one.

---

## Type — `--md-sys-typescale-*`

Five roles, three sizes each, and every one carries **all four** parts of a type
style: `-size`, `-line-height`, `-weight`, `-tracking`. Three of the four is what
"type scale" usually means in practice, and the one left out is always tracking —
which is how a stylesheet acquires eleven hand-tuned `letter-spacing` values.

| Role | For |
|---|---|
| `display-large` / `-medium` / `-small` | A number that is the whole point of the screen. Rare in a console. |
| `headline-large` / `-medium` / `-small` | Page and section headings. |
| `title-large` / `-medium` / `-small` | Card headlines, panel headings, the name of a thing. |
| `body-large` / `-medium` / `-small` | Prose, table cells, descriptions. |
| `label-large` / `-medium` / `-small` | Buttons, chips, badges, column headings, eyebrows. One or two words. |

Sizes are `rem`, so a raised browser base size raises the whole scale. The three
display sizes and the two largest headlines are `clamp()`d because
`layout.spec.ts` runs every route at **320 CSS pixels** — a fixed 2.5rem headline
is 40px of unbreakable word on a 320px screen, and the token is where that has to
be solved, not the page.

`label-small` is 0.69rem (11px at a 16px root). It is a **label** role and never
body text: WCAG sets no minimum type size, but an 11px paragraph is a defect
whatever its contrast ratio.

**Density does not touch this group.** Compact tightens space; it never shrinks
type (Bible §26.3.4), and `preferences.spec.ts` asserts the body size is
identical in both densities.

Each role has a matching class — `.md3-title-large`, `.md3-body-medium` — which
applies all four parts. That is how a surface applies a role.

---

## Shape — `--md-sys-shape-corner-*`

`none` → `extra-small` → `small` → `medium` → `large` → `extra-large` → `full`.

The **names** are Material's. The **values** are tighter than consumer Material,
which starts at 4px and reaches 28px: every radius here is drawn around a data
row, a status pill or a form control, and a 28px corner on a table card reads as
a toy. What a component relies on is the **order**, and the audit asserts the
ramp is monotonic — a ramp where `large` is smaller than `medium` type-checks,
renders, and makes every component that picked a step by name wrong.

The four older `--md-sys-shape-xs/-sm/-md/-full` names are **aliases** onto this
ramp, not a second set of numbers. About ninety rules already name them.

---

## Elevation — `--md-sys-elevation-0` … `-5`

A shadow ramp, per theme. Level 0 is `none`.

Elevation and the container ladder are **independent** here. Material ties them
together through a surface tint — higher surfaces get more primary mixed in —
and this console does not, because it renders long tables of neutral facts and a
tinted table header is a table header with an opinion. `level={0}` with
`container="high"` is a flat, distinct panel, and it is the most common
combination in a dense console.

---

## State layers — `--md-sys-state-*-opacity`

Material's interaction model, as **opacities** rather than as colours:
`hover` 0.08, `focus` 0.12, `pressed` 0.12.

A state layer is a `::before` filled with `currentColor` at one of these
opacities (`.md3-state`). `currentColor` is by definition the on-colour of
whatever container the control is in, so **one rule** is correct on a filled
button, on a tonal container, on an error chip and on a bare surface. The
alternative — a pre-composited `rgba()` per surface — is how a stylesheet
acquires nine hand-mixed values nobody can re-derive.

It also makes the hovered state **computable**. A state layer moves the
background *toward* the text, so hover always costs contrast and costs most where
the margin was thinnest. The audit composites every interactive pair at all three
opacities and requires the result to still clear 4.5:1 — which no rendered-page
audit that does not hover will ever check.

The older `--md-sys-state-hover/-focus/-pressed` are the pre-composited layer
used by about ten existing rules. New work uses the opacity tokens.

---

## Motion — `--md-sys-motion-*`

Two durations and three curves.

| Token | Value | For |
|---|---|---|
| `duration-short` | `var(--motion-fast)`, 120ms | A control responding — the state layer, a colour change. |
| `duration-medium` | `var(--motion-base)`, 180ms | A region moving — a surface changing elevation. |
| `easing-standard` | `cubic-bezier(0.2, 0, 0, 1)` | The default. |
| `easing-decelerate` | `var(--ease-entry)` | Something **arriving**. |
| `easing-accelerate` | `cubic-bezier(0.3, 0, 1, 1)` | Something **leaving**. |

The durations are **aliases** onto `--motion-fast` / `--motion-base`, which is
what `[data-motion="reduced"]` zeroes — one place to zero, and no second token
still reading 180ms after the page has stopped moving. The audit asserts both
that the durations sit inside the console's documented 120–220ms band
(Bible §26.3.7) and that reduced motion takes them to zero.

There is no `long`, and there are not Material's twelve. The band's 220ms ceiling
is asserted by `preferences.spec.ts` against the rendered page, which is where a
ceiling belongs; a third duration nothing was allowed to reach would be a number
in a stylesheet pretending to be a decision.

`--ease-entry` is aliased rather than restated: it is one of the two tokens the
two experiences disagree about, and `SHARED_TOKENS` in
`tools/entry-point-inventory.mjs` records that disagreement. A second decelerate
curve here would make that record describe one of two curves in one stylesheet.

---

## The primitives

`apps/system-studio/src/components/md3/`, imported from `@/components/md3`.

| Component | What it is |
|---|---|
| `Surface` | Container colour + elevation + corner, on a closed set of axes. Every other primitive is a Surface with content rules. |
| `Card` | A Surface with a headline, supporting text, a header slot and an action row. `headlineAs` because heading level is a document decision and visual size is not. |
| `Button` / `ButtonLink` | Four variants (`filled`, `tonal`, `outlined`, `text`) × two tones (`neutral`, `danger`). Two exports because a link has no `disabled` and a `<button>` that routes breaks middle-click. |
| `Chip` / `ChipButton` | A value (`<span>`) or a choice (`<button>`, with `aria-pressed`). Separate, because a `<span>` with an `onClick` is invisible to the keyboard. |
| `Badge` | A status, carried by a **word**. Five tones; `children` is required. Bible §26.3.2 forbids meaning conveyed by colour alone, and this palette is too desaturated for a colour to carry it anyway. |
| `DataTable` | The shell: a bounded scroll region, a required visible caption, and columns declared as data so a header and its cells cannot drift apart. It does not sort, page or fetch. |
| `EmptyState` | The layout of an empty region: what is absent, why, and what would create it. `description` is required — "No results" cannot distinguish *nothing exists* from *nothing matches your filter*. |

### `EmptyState` overlaps `components/states.tsx`, and that is recorded

`states.tsx` owns fourteen **governed states** and the distinctions between them
are load-bearing: a denied AWS read rendered as an empty list is how an operator
reads "no RDS instances" off a role that may not call `DescribeDBInstances`.
Nothing in `md3/` replaces that vocabulary.

`md3/EmptyState` is the **shape** such a report takes when it is the whole region
rather than a banner inside one. The right end state is for `states.tsx`'s
`EmptyState` to render this shell; that is a change to a file outside this
foundation's scope and is open work, not a finished design.

---

## What the audit checks

`npx playwright test e2e/md3-tokens-logic.spec.ts` — 21 tests, no browser, no
server.

1. Every required colour role is declared in light **and restated in dark**.
2. Every type role carries all four parts.
3. The shape ramp is complete and monotonic.
4. Elevation runs 0–5 in both themes; 0 is `none`.
5. State opacities are Material's.
6. Motion durations are inside the band, and reduced motion zeroes them.
7. **Every declared pair clears its WCAG 2.2 AA threshold** — in `light`, `dark`,
   `light-contrast` and `dark-contrast`. Thresholds are per purpose: `body` 4.5:1
   (1.4.3), `nonText` 3:1 (1.4.11), and `decorative` 1.2:1 for the named
   hairlines WCAG requires nothing of — each of which is listed individually, so
   "decorative" is a claim about a specific edge rather than a category anything
   can fall into.
8. **The same pairs with the state layer composited on**, at all three opacities.
9. No literal colour and no inline style in any `md3/` component.
10. The stylesheet's `.md3-*` classes and the components' class names are the
    same set — no unstyled component, no dead CSS.
11. No token is declared without either a consumer or a recorded reason.

`preferences.spec.ts` remains the other half and neither replaces the other: it
measures the **rendered page**, which is the only way to catch a rule that
overrides a correct token with a literal. This measures the **system**, which is
the only way to catch a pair that is wrong but not yet rendered.
