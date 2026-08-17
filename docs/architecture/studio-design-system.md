# System Studio design system — the Material 3 foundation

What the console's tokens are, what each group is for, and the one rule that
keeps the accessibility guarantee true.

There are two files and two tests:

| | |
|---|---|
| `apps/system-studio/src/app/globals.css` | Every token, and every rule that uses one. The only place in the console a colour exists. |
| `apps/system-studio/src/components/md3/` | The primitives. Eighteen components, and not a colour among them. |
| `apps/system-studio/e2e/md3-tokens-logic.spec.ts` | The audit. Computes WCAG 2.2 AA for every declared pair in all four theme/contrast combinations, with and without the state layer, and fails on a colour in a component. No browser, no server. |
| `apps/system-studio/src/components/md3/aws-outcomes.test.tsx` | The rendering proof. Drives the real `readAws` through four genuinely different AWS outcomes and asserts the four surfaces differ. Runs under jest — Playwright transforms JSX with its own component-locator pragma and therefore cannot render a React tree, which is why `apps/web/jest.config.js` lists `apps/system-studio/src` as a root. |

---

## The rule

> **A component may not contain a literal colour.**
>
> Not a hex code, not `rgb(` or any other colour function, not one of the 148
> CSS colour keywords, not a `style` attribute carrying one. A component decides
> which **role** applies. It never decides what the role's value is.

It is not a style preference; the contrast guarantee depends on it. The audit
computes ratios for the pairs it can find, and every pair it can find is a pair
declared in `globals.css`. One literal in one component is a pair the audit does
not know exists, in the file nobody would think to point it at — and it will be
a pair that is fine in light and 2.1:1 in dark, because that is the one a person
cannot check by looking.

So the spec reads every file in `components/md3/` and fails on:

- a hex code, in any length;
- a colour function — `rgb(`, `hsl(`, `oklch(`, `color-mix(`, `light-dark(`;
- a **named colour**, when it appears as a whole string literal (`"red"`) or as
  the value of something colour-shaped (`color: gold`). Not the bare word
  anywhere: `tan`, `plum`, `linen` and `peru` are all CSS keywords and all things
  an identifier can legitimately contain, and a scan that flagged `Math.tan`
  would be switched off within a week;
- an inline `style={{…}}` — which is where a colour hides once it is a variable
  and the lexical scan can no longer see it.

Test files in the directory are the one exclusion, and the exclusion is pinned to
exactly `*.test.tsx`: a test may need to name a colour in order to demonstrate
that the ban catches one.

**Proven, not asserted.** Two mutations, both run:

| Mutation | Result |
|---|---|
| `const MUTATION_HEX = "#c0392b"` appended to `SeverityChip.tsx` | `1 failed` — `"SeverityChip.tsx: #c0392b"` |
| `const MUTATION_NAMED = "red"` appended to `SeverityChip.tsx` | `1 failed` — `"SeverityChip.tsx: named colour red — \"red\""` |
| both reverted | `25 passed` |

---

## Colour

Two layers, which is Material's structure and is worth keeping.

> **Audited against MD3 and found complete.** The full role set in both themes,
> the fifteen type roles with all four parts each, elevation 0–5, the seven-step
> corner ramp, the motion durations and curves, and the state-layer opacities
> were all already declared. Nothing was added to close a gap; what was added
> below is the audit of three **new pairs** the severity chip introduced, and
> three assertions about the scrim that the dialog introduced — one of which has
> since been rewritten and one added, so the scrim now carries four. See
> [The scrim](#the-scrim).

### The dark theme is OLED black — a recorded deviation from STUDIO-030-002

STUDIO-030-002 reads, in full: *"Implement forest-green light/dark palettes with
measured contrast, no muddy brown/gold legacy theme, **no pure-black glare**, and
no low-contrast gray-on-gray critical text."*

The product owner has directed an OLED-black dark theme. That instruction
overrides the emphasised clause. The deviation is recorded in
`docs/implementation/system-studio-aws-control-plane-execution-ledger.md` under
STUDIO-030-002 rather than papered over, and the **concern behind the clause is
answered rather than waived**. Two things go wrong at `#000000`, and both are
structural:

1. **Shadow stops working.** A drop shadow is darker pixels, and there are none
   darker than `#000`. Elevation therefore cannot be carried by
   `--md-sys-elevation-*`; it is carried by the container ladder, and every
   adjacent step is spaced to be measurably distinct.
2. **Adjacent panels smear.** So `.md3-surface` draws a hairline in
   `outline-variant` **by default** rather than only when asked. The border was
   already `1px solid transparent`, so nothing reflowed.

And the half of the clause that is genuinely about glare survives intact: **no
foreground is pure white.** `#ffffff` on `#000` is 21:1, which is where halation
and the smearing of adjacent glyphs actually come from. `on-surface` is `#e8e8e8`.

#### The ramp, measured

| Role | Value | Step from the one below |
|---|---|---|
| `surface-container-lowest` (= `background`, `surface`, `surface-dim`) | `#000000` | — |
| `surface-container-low` | `#151515` | **1.150:1** |
| `surface-container` | `#222222` | **1.148:1** |
| `surface-container-high` | `#2d2d2d` | **1.155:1** |
| `surface-container-highest` | `#363636` | **1.140:1** |
| `surface-bright` | `#3c3c3c` | 1.095:1 |
| `surface-variant` (the table header band) | `#262626` | — |

Four roles resolve to the same `#000000` deliberately — the page, the default
surface, the dim surface and the lowest container are all *the black the panel is
drawn on*, and giving three of them a near-black of their own would be three
steps of a ladder nobody can see.

`md3-tokens-logic.spec.ts` asserts each of the four bracketed steps clears
**1.12:1**, and `preferences.spec.ts` re-measures the same five tokens on the
rendered page. The card hairline, `outline-variant` `#4a4a4a`, is **2.37:1** on
the base.

#### Green is the accent and the mark, and nothing else

Every surface, both content colours, both boundaries, the inverse pair and the
whole secondary family are pure greys — `r = g = b`, asserted, not intended. The
previous palette tinted the console green (`on-surface-variant: #edf7f0`) and
then used a pale mint (`#9bdcba`, 48% saturation) as the accent, which is the
wrong way round.

| Role | Value | Measured |
|---|---|---|
| `primary` | `#12cc7e` — hue 155°, **84% saturation**, 43% lightness | 9.96:1 on the base, 5.73:1 on `surface-container-highest`, **4.67:1** there again under a 12% state layer |
| `on-primary` | `#00120a` | 9.13:1 on `primary` |
| `primary-container` | `#0b3b28` — the masthead mark, the current tab | 9.52:1 with its on-colour |
| `on-primary-container` | `#b6ecd0` | |
| `inverse-primary` | `#0d5638` — the accent on an inverse surface | 7.13:1 on `inverse-surface` |

`primary` is as deep as WCAG 2.2 AA permits a colour used as **text** to be —
luminance is what contrast is made of, so a darker forest green cannot be a legible
glyph on a dark surface. The genuinely deep tone therefore lives where it is a
**fill** rather than a glyph: `primary-container` and `inverse-primary`.

Not neutral, deliberately: `error`, `warning`, `success` and `tertiary`. Hue is
part of what those mean.

---

## Density and 320 CSS pixels

Two axes every primitive here has to survive, because `layout.spec.ts` runs every
route at 1440, 1180, 900 **and** 320, and `preferences.spec.ts` runs eight
theme × density × contrast combinations.

- **Space comes from `--space-1…6`**, which is the only thing compact changes. No
  primitive hardcodes a padding.
- **`--tap` is identical in both densities** (WCAG 2.2 AA 2.5.8, 24×24 CSS
  pixels). Every control's height is built out of it rather than out of a
  padding: `Button` is `--control-block-size`, which is `--tap` plus a space
  step; `Switch`'s track *is* `--tap`. Compact tightens the space around a
  control, never the control.

### Component geometry — STUDIO-030-001

ADR-0009 asks for controls at a **medium** height, rows compact enough that a
screen shows a working set, and a nested card that does not pay full padding a
second time. These are the five tokens that hold it, and they are five rather
than five hundred for a reason worth stating:

| Token | Default | Compact | Was |
|---|---|---|---|
| `--control-block-size` | 32px | 30px | eight different heights: 32, 36, 36+8, 40, 40, 40, 40, 44 |
| `--control-padding-block` | 4px | 2px | 8px, `0.5rem`, `0.55rem` |
| `--row-padding-block` | 4px | 2px | 8px |
| `--card-padding` / `--card-gap` | 16px / 8px | 10px / 6px | unchanged in value |
| `--card-padding-nested` / `--card-gap-nested` | 12px / 4px | 8px / 2px | 16px / 8px — the same as the container |

**Eight heights, not one.** Before this, "bring the controls down" had eight
places to be applied and no way to check it had been: `.md3-button` 36px,
`.md3-field-input` 36px *declared* and **39.33px measured** (a `min-block-size`
only ever raises, and the 8px padding plus a 21.3px line plus 2px of border
exceeded it — so the number in the stylesheet was not the number on the screen),
`.field input` / `.primary-action` / two submit buttons / `form.signin button` /
`.adopt button` / `.md3-tab` at 40px, `.palette-input` at 44px,
`.palette-result` at 32px. Each was defensible where it was written. Together
they were not a scale.

**Why the height derives from `--tap` rather than being a literal `32px`.**
`--tap` is the one token compact does not reduce, so deriving from it makes the
accessibility floor *structural*: `--control-block-size` cannot fall below 24px
in either density without someone editing the token `preferences.spec.ts`
measures in all eight preference combinations. A literal would make the floor a
coincidence that holds until the next edit.

**Why 32px and not 28px.** The instruction is "medium to small" and the ADR says
"a **medium** height" — not the minimum. 32px is where a desktop application's
regular control sits; 28px is its *small* variant. Coming down from 36–44 to 32
is the change that was asked for. Going to 24 would be meeting the accessibility
floor with the visible box, which is the specific thing STUDIO-030-007 says not
to do: **the 24px target is met inside the 32px box by padding, not by the box
being 40px.** `base-scale.spec.ts` proves it the way 2.5.8 asks — four
`elementFromPoint` probes at the corners of the 24×24 square centred on the
control — which is a question no height measurement can answer.

**Rows: padding is the last thing added and the first thing cut.** A row's height
is `padding × 2 + line-height × lines`, so `--row-padding-block` at 4px is 8px
off every row in the console, and it compounds with `body-small` at 1.4.

**Cards: the nested level pays less.** Not a hypothetical. Measured on `/tenants`
at 1440×900, the first table row sat at **y = 1414 on a 900px screen**, and 920px
of what was above it was two `.md3-unknown` panels inside the fleet-health card —
**460px each** — every one of them paying the container's own 16px padding and
8px gap a second time, charged six times over because the panel is six short
blocks in a column. At 12px and 4px they are 397px.

The rule is a descendant selector (`.md3-card .md3-unknown`) rather than a
`data-nested` prop because a card does not know whether it is nested: `Card.tsx`
is called by whichever page needs one, and depth is a fact about the composition.
A prop would be wrong the first time a page wrapped an existing card in a new
one; the selector reads the DOM, which is where the answer is.

**And the nested hairline goes with it.** ADR-0009's last rule — "the gap between
groups should exceed the gap within one, and that difference does more work than
any border. Prefer removing a border to adding one." A nested surface had a
background one ladder step from its container **and** its own padding **and** a
hairline: three signals for one boundary. The hairline costs a pixel of layout
and carries the least. It is removed **only** where it is decorative — two
exclusions, both load-bearing: `[data-outlined="true"]`, whose edge the caller
has declared meaningful, and `.md3-unknown`, which draws its border in `outline`
rather than `outline-variant` precisely because it is the edge of the claim
"nothing is known here" (3:1, WCAG 2.2 AA 1.4.11).

**One type scale for both tables.** `table.grid` — the legacy grid, predating the
token layer — set its own `font-size: 0.88rem` while `.md3-table` took all four
parts of `body-small`. Two tables in one console at two sizes is not a density
decision anybody made, and the visible consequence was that a row on
`/tenants/[slug]` was a different height from a row on `/platform/estate` for no
reason a reader could infer. `table.grid` now reads the same four tokens.

**What this did not reach, and why it is recorded rather than claimed.** Rows
visible without scrolling on `/platform/estate` at 1440×900 is **0 before and 0
after**. The base scale moved the first table's y-coordinate from 1399 to 1319 on
that page and from 1414 to 1275 on `/tenants`, and it took the page's own scroll
height down 9–10%; but roughly 1,200px of what sits above the first row is *page
composition* — five paragraphs of prose and two full unknown-state panels — which
lives in `src/app/platform/estate/page.tsx` and `src/app/tenants/page.tsx`, not
in the token layer this requirement binds. What the token layer does control is
how many rows the scale **affords** in the content region, and that is the number
`base-scale.spec.ts` asserts: 13 → 15 on the fleet, 9 → 11 on the estate.
- **Anything that can be wider than its column scrolls inside itself.**
  `DataTable`'s shell (`overflow-x: auto` with a visible border, so a table that
  continues past the fold does not read as one that ends there), `Tabs`' strip,
  and `UnknownState`'s `<pre>`. The page itself never scrolls sideways — that is
  the defect `layout.spec.ts` measures directly.
- **Long identifiers wrap**, with `overflow-wrap: anywhere` rather than
  `break-word`: only `anywhere` also lowers an element's min-content width, which
  is what stops one ARN setting the floor for a whole grid track. The one place
  it is deliberately switched **off** is the pasteable IAM statement, which must
  survive being copied.
- **Two-column layouts collapse below 480px** — `KeyValue` included, and its key
  column is the one that gives way. `.kv` in `globals.css` records what happens
  when it is the other way round: the *value* was squeezed to a clientWidth of
  zero at 320 while the ARN inside it kept its full width and printed outside the
  card.

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
| **Scrim** | `scrim` | The page behind a dialog. `rgba(0, 0, 0, 0.72)` in dark — see below. |

### `outline` and `outline-variant` are not interchangeable

- **`outline`** is a boundary that carries **meaning** — the edge of a control,
  the edge of a focusable thing. Audited at 3:1 against every surface
  (WCAG 2.2 AA 1.4.11). `Button`, `Chip`, the table's header rule and
  `Surface`'s `outlined` prop use it.
- **`outline-variant`** is a **decorative** hairline: the edge of a card that is
  already distinct by its container colour, the divider between two rows that
  are already legible. It is around 1.2–2.4:1 by design and **may never be the
  only thing separating a control from the page.**

Every `.md3-surface` now carries the decorative hairline by default, because at
`#000` a drop shadow has no darker pixels to work with and two adjacent panels
would otherwise smear. `data-outlined="true"` therefore moved up to `outline` —
the stronger, meaning-carrying boundary — rather than repeating the default and
meaning nothing. Both pairs were already in the audit.

That rule caught a real defect while it was being written: the disabled filled
button drew its border in `outline-variant`, which measured 1.21:1 in light and
1.24:1 in dark against `surface-container-highest`. Once the fill goes neutral
that border is the only thing marking where the control is — a boundary that
carries meaning. It is `outline` now.

### A family's base colour, drawn on that family's own container

`SeverityChip` needs a border that separates two levels sharing one family —
`critical` is the filled error, `high` is the error *container* — so
`error`-on-`error-container`, `warning`-on-`warning-container` and
`tertiary`-on-`tertiary-container` are audited as **control boundaries** (3:1,
WCAG 2.2 AA 1.4.11). All three measure above 5:1 in both themes. The assertion
exists so that stays true the next time a container tone is adjusted; the word on
the chip is what carries the meaning for everyone who cannot see the difference.

### The scrim

`--md-sys-color-scrim` is the page behind a `Dialog`, and the audit asserts four
things about it in both themes: that it is **translucent** (an opaque scrim is a
page, not a scrim), that it is at least 20% opaque (below that it stops
separating), that it is **not pure white**, and that it **does its job** —
composited over the brightest surface the theme has, it must cut that surface's
relative luminance by at least half.

The last one replaced an older assertion that the scrim's colour must not be pure
black. That rule was correct about the old palette and is wrong about this one:
the dark theme's base surface **is** `#000`, so a green-charcoal scrim was a tint
over black rather than a dimming of it, and the prohibition would have forced
exactly that. Alpha alone is no substitute — `rgba(250, 250, 250, 0.62)` is 62%
opaque and makes the page *brighter* — so the colour constraint was not dropped,
it was replaced with the property it was a proxy for.

Measured: the dark scrim leaves `surface-bright` at **12.2%** of its luminance,
the light scrim at **33.7%**.

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
`layout.spec.ts` runs every route at **320 CSS pixels** — a fixed headline is
unbreakable word on a 320px screen, and the token is where that has to be
solved, not the page.

### The heading end steps by ratio — STUDIO-030-001

ADR-0009, *Component scale: compact by default*: "headings step by ratio, not by
leaps. A heading that is three times body size on an internal console is a
poster, not a hierarchy."

It was a poster. Measured on the rendered page at 1440 CSS pixels,
`display-large` was **40px against a 13.76px body — 2.91×** — and the ladder
above `title-large` climbed in six different ratios (1.08×, 1.20×, 1.35×, 1.14×,
1.25×). Six sizes in order is not a scale.

It is now one geometric ladder from `title-large`, **ratio 1.09 per step**:

| Role | Was | Is | × `body-medium` |
|---|---|---|---|
| `title-large` | 1.00rem | 1.00rem | 1.16× (the anchor, unchanged) |
| `headline-small` | 1.08rem | 1.09rem | 1.27× |
| `headline-medium` | 1.30rem | 1.19rem | 1.51× → 1.38× |
| `headline-large` | 1.55rem | 1.30rem | 1.79× → 1.51× |
| `display-small` | 1.75rem | 1.41rem | 2.03× → 1.64× |
| `display-medium` | 2.00rem | 1.54rem | 2.33× → 1.79× |
| `display-large` | 2.50rem | 1.68rem | **2.91× → 1.95×** |

`headline-small` is the one value that rises, by 0.16px, and it rises to make the
ladder geometric rather than to make anything larger.

`base-scale.spec.ts` asserts the **ratio** — `display-large` under 2× body — not
the pixel size, so a reader who has raised their browser's base size does not
fail it.

**Body, title and label sizes did not move**, and the second reason is the
load-bearing one. Body is already the working size and the ADR calls it that;
and `preferences.spec.ts`'s `contrastFailures` requires **4.5:1 of every text
element with no large-text exemption written into it**, so no pair in this
console was passing only because it counted as large text, and there is no pair
that shrinking could drop below its required ratio. Re-run and confirmed rather
than reasoned about.

**Line heights came down with the sizes, but not proportionally.** A 26.88px
heading needs relatively *more* leading than a 40px one, so `display-large` goes
1.15 → 1.2 and still measures 32px against 46px. Negative tracking relaxes for
the same reason: tight tracking is a large-size correction, and −0.02em at
26.88px is over-tightened.

Two line-heights moved for density rather than for optics:

- `body-small` 1.5 → **1.4**. `body-small` is the *table* role — `.md3-table`
  sets all four of its parts — so its line-height is a row-height decision. A
  line goes 18.72px → 17.47px, and a fleet cell that wraps to two or three lines
  is the tallest thing in its row, so this is worth more per row than the padding
  cut.
- `body-large` and `body-medium` 1.55 → **1.5**, which lands the tokens *on* the
  canonical UI line-height and the exact figure WCAG 1.4.12 names, rather than
  above it.

WCAG 1.4.12 is unaffected by either: it requires the content to survive a reader
**setting** 1.5, which is a different question from what is authored.

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

**On the dark theme the shadow ramp is nearly inert, and that is expected.** A
drop shadow is darker pixels and the base surface is `#000000`, so the levels
still resolve and still ease, but what an operator actually sees separating two
panels is the container ladder and the hairline — which is why both are asserted
numerically rather than left to a screenshot.

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

### The AWS-reading set

This console's job is to report readings of somebody else's estate, and a reading
has outcomes a consumer UI never has to think about. These three are how twelve
surfaces get them right once instead of twelve times.

| Component | Reach for it when | Do **not** reach for it when |
|---|---|---|
| `KeyValue` | You have facts about **one subject** — "fact: value, as of T". Every AWS panel is this shape. `asOf` is per item, because one panel routinely mixes a 15-second ECS count with an hourly certificate inventory, and a single list-level timestamp would have to lie about one of them. | You have rows of one kind of thing — that is `DataTable`. Or a value that could **not** be read: a `<dd>` reading "—" is the defect below. |
| `UnknownState` | A reading came back `DENIED`, `THROTTLED`, `UNCONFIGURED` or `ERROR`. **This is the most load-bearing component in the system.** | Ever, for a successful read. It is not expressible: `read` is typed `UnknownRead`, the four arms of `AwsRead<T>` that carry no value. |
| `StaleIndicator` | You are printing an `asOf`. It takes the capability's own `refreshMs` as well, and says "overdue" — in a word, not only a tint — once the age is past it. | You do not have the cadence. Four minutes is fresh for an ACM inventory and stale for an SQS depth; a timestamp without its cadence is a number nobody can judge. |

**Why `UnknownState` is the important one.** STUDIO-000-007: a read this engine
could not perform must never render as an empty list. The collector this console
replaced turned every failure into `null` and every `null` into `[]`, so a
refused `cloudwatch:DescribeAlarms` produced an empty alarm list which a page
rendered as reassuring chips. Each of the four arms gets a **different** headline,
a different fact list and a different remedy, because a surface that says
"unavailable" for all four teaches operators to ignore it:

- `DENIED` — principal, action as IAM spells it, error code, account / region /
  partition, and the minimum statement as pasteable JSON. Remedy: grant it.
- `THROTTLED` — the retry interval, and **no** IAM statement. Nothing is broken;
  a policy edit that "fixes" a throttle is a permission granted for no reason.
- `UNCONFIGURED` — what is missing. Usually an account subscription, so no
  statement is offered here either.
- `ERROR` — the code and `safeDetail`, already stripped of credential material.

### Navigation, overlays and forms

Each of these declines to do something its consumer-Material counterpart does,
and every one declines for the same reason: **nothing in this directory has a
`"use client"` directive**, so a primitive here does not claim a behaviour it
cannot implement without one. The escape hatch is the same in every case — a
route that needs the client behaviour wraps the primitive; the directory does not
pretend.

| Component | Reach for it when | What it deliberately does not do |
|---|---|---|
| `Tabs` | The tab **is** the URL. Bookmarkable, shareable, works with the back button — the same argument `fleet-filter.ts` makes about filters. | It is a `<nav>` of links with `aria-current="page"`, **not** an ARIA `tablist`. A `role="tab"` that loads a document breaks the arrow-key contract it just promised. |
| `Dialog` | A confirmation or a detail panel whose openness the caller owns — normally a query parameter. `open={false}` renders **nothing**, not a hidden element. | It does not set `aria-modal`. Nothing here traps focus, and claiming modality while the page behind is still tabbable is worse than not claiming it. `dismiss` is required: a dialog with no exit and no Escape key is a trap. |
| `Snackbar` | The outcome of something the operator just did. Inverse surface, `role="status"`. | It does not auto-dismiss. WCAG 2.2 AA 2.2.1, and in a control plane the message is often the only on-screen record that a mutation was accepted. |
| `ProgressIndicator` | A known ratio — "4 of 11 cells". A native `<progress value max>`, which is how a component here expresses a width without an inline style. | It does not accept a value above `max`: Chrome renders that as *indeterminate*, so "12 of 11 done" would start sliding as though nothing were known. It clamps. |
| `IndeterminateProgress` | Busy, amount unknown. `role="progressbar"` with **no** `aria-valuenow`, which is how ARIA spells exactly that. | It does not rely on motion alone: under reduced motion the stylesheet gives it a full static track, because a bar frozen at its first keyframe is drawn identically to a broken one. |
| `TextField` / `TextArea` | Any typed value. The label is **above** the box and never floats. | No floating label: it needs JavaScript or a placeholder that duplicates it, and a placeholder is announced twice and then vanishes as typing starts. Two exports rather than a `multiline` prop, so `<TextField multiline type="number">` is not expressible. |
| `Select` | A choice from a known list. Options are **data**, so a `<div>` cannot end up inside a `<select>`. | It is the platform's own control. A custom listbox means owning keyboard interaction, typeahead, focus restoration, portalling and the mobile picker — and the only thing it buys is styling the open menu, which holds regions and slugs here, not swatches. |
| `Switch` | A boolean setting inside a form. An `<input type="checkbox">` with `role="switch"`, so it posts with the form and works with no JavaScript. | It does not apply on toggle. That is a phone-settings idiom; here the form's button commits, and a high-risk change goes through the confirmation in `states.tsx` first. |
| `Field` | You are wrapping a control this directory does not provide — a date input, a file input. | Inventing a fourth way to draw a label, a hint and an error. That is what this exists to prevent. |
| `SeverityChip` | A Security Hub finding's level. `critical` / `high` / `medium` / `low` / `informational`, in AWS's own words so no operator has to hold a translation table. | There is no red and no green in it. `critical` and `high` are the **error** family, `medium` the warning family, `low` the **tertiary** family — "neither good nor bad" — and `informational` has no status family at all. |

### `EmptyState` overlaps `components/states.tsx`, and that is recorded

`states.tsx` owns fourteen **governed states** and the distinctions between them
are load-bearing: a denied AWS read rendered as an empty list is how an operator
reads "no RDS instances" off a role that may not call `DescribeDBInstances`.
Nothing in `md3/` replaces that vocabulary.

`md3/EmptyState` is the **shape** such a report takes when it is the whole region
rather than a banner inside one. The right end state is for `states.tsx`'s
`EmptyState` to render this shell; that is a change to a file outside this
foundation's scope and is open work, not a finished design.

The same relationship holds for `md3/UnknownState` and `states.tsx`'s
`UnknownState` / `AwsReadPanel`. `states.tsx` owns the **word** — `unknown` is one
of its fourteen governed states — and `md3/` owns the MD3 **form** that word
takes. Both are driven by the same `AwsRead` union, so they say the same things;
having one render the other is the same open work.

---

## What the audit checks

`npx playwright test e2e/md3-tokens-logic.spec.ts` — 25 tests, no browser, no
server.

1. Every required colour role is declared in light **and restated in dark**.
2. Every type role carries all four parts.
3. The shape ramp is complete and monotonic.
4. Elevation runs 0–5 in both themes; 0 is `none`.
5. State opacities are Material's.
6. The scrim is translucent, dark enough to separate, and not pure black or white.
7. Motion durations are inside the band, and reduced motion zeroes them.
8. **Every declared pair clears its WCAG 2.2 AA threshold** — in `light`, `dark`,
   `light-contrast` and `dark-contrast`. Thresholds are per purpose: `body` 4.5:1
   (1.4.3), `nonText` 3:1 (1.4.11), and `decorative` 1.2:1 for the named
   hairlines WCAG requires nothing of — each of which is listed individually, so
   "decorative" is a claim about a specific edge rather than a category anything
   can fall into.
9. **The same pairs with the state layer composited on**, at all three opacities.
10. No literal colour — hex, function **or named keyword** — and no inline style
    in any `md3/` component; and the keyword list is asserted to still be all 148.
11. The stylesheet's `.md3-*` classes and the components' class names are the
    same set — no unstyled component, no dead CSS.
12. **Every component is exported from the barrel.** A primitive that exists but
    is not exported is one twelve routes either import by deep path or, far more
    likely, reimplement locally with a `<div>` and a colour — which is exactly how
    a design system acquires a second, unaudited palette.
13. No token is declared without either a consumer or a recorded reason.

### And what the rendering proof checks

`npx jest ../system-studio/src/components/md3` from `apps/web` — 19 tests.

The stand-in for AWS distinguishes four outcomes — refused, throttled,
successful-and-empty, successful-and-populated — and every one goes through
`readAws`, the one function in the Studio that turns an exception into a rendered
state. The denied and throttled cases **throw**, the way the SDK does, because
the classification under test reads an exception's modelled `name`.

The assertion that matters is that the four surfaces are **pairwise different**,
and that a refused read contains none of the vocabulary of an absence. A fake
returning a canned answer regardless of its input would let all four render
identically and still pass, which is why the four behaviours are real.

**Proven, not asserted.**

| Mutation | Result |
|---|---|
| `UnknownState`'s `{read.state === "DENIED" ? …}` → `{false ? …}`, dropping the pasteable statement from a denial | `1 failed` — "the surface carries principal, action and statement" |
| reverted | `19 passed` |
| `UnknownRead`'s `Extract` widened to admit `"ACTUAL"` | `tsc` reds in **four** places: the two `Record` maps lose exhaustiveness, `factsOf`'s `switch` no longer returns on every path, and the `@ts-expect-error` in the test becomes `TS2578: Unused '@ts-expect-error' directive` |
| reverted | `0` errors in `md3/` |

`preferences.spec.ts` remains the other half and neither replaces the other: it
measures the **rendered page**, which is the only way to catch a rule that
overrides a correct token with a literal. This measures the **system**, which is
the only way to catch a pair that is wrong but not yet rendered.
