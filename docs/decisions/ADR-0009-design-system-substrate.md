# ADR-0009 — A token system, not a look: why the Studio stays on its own MD3-derived substrate

- **Status:** Accepted
- **Date:** 2026-08-14
- **Implements:** STUDIO-030-001, STUDIO-030-002
- **Constrains:** STUDIO-030-003, STUDIO-030-007, STUDIO-030-010, STUDIO-030-011
- **Enforced by:** `apps/system-studio/e2e/preferences.spec.ts` (contrast in every theme),
  `apps/system-studio/e2e/md3-tokens-logic.spec.ts` (no literal colour in a primitive),
  `apps/system-studio/e2e/layout.spec.ts` (four viewports, no overlap, no page scroll)

## Context

The product owner asked whether Liquid Glass / SwiftUI would be a better substrate
for the System Studio than the Material-3-derived token layer it uses, on the
grounds that "the overall aesthetics and calmness is there" — with the explicit
instruction to adopt it only if genuinely better, and otherwise not.

The question is worth settling once, in writing, because it will be asked again
every time the console looks tired.

## Decision

**Stay on the existing token substrate. Do not adopt SwiftUI. Do not adopt Liquid
Glass as a visual language.** Take the legitimate half of the critique — calm —
as a restraint directive on the tokens and the shell.

## Why

### SwiftUI is not available to this product at all

SwiftUI is Swift, compiled to Apple platforms. The System Studio is a Next.js /
React application served from CloudFront to a browser. There is no version of
"adopt SwiftUI" that ships here, so the comparison is not between two options.

### Liquid Glass is a platform material, not a library

It is Apple's design language, implemented in SwiftUI and UIKit against a
compositor that computes refraction and specular highlight in real time. The web
has no implementation of it. What a web application can do is *approximate* it
with `backdrop-filter: blur()` and layered gradients — which is a CSS technique,
not a component library. Adopting it would mean hand-building all twenty-two
primitives STUDIO-030-003 names, with none of the accessibility work the current
layer already carries.

### It cannot satisfy the contrast requirement this console is held to

STUDIO-030-007 requires WCAG 2.2 AA, high contrast, and colour-vision safety.
Liquid Glass surfaces are translucent by definition: the effective contrast of
text on one depends on whatever is scrolling behind it at that moment. There is
no pair to measure and therefore no ratio to guarantee.

That is not a theoretical objection. `preferences.spec.ts` computes contrast for
every declared token pair in light, dark and high-contrast, and reds when one
drops below AA. A translucent surface makes that check unwritable, and the check
is what stopped a pale-mint-on-black pair shipping this month.

### It is the wrong material for the substrate the owner chose

The dark theme is OLED black with a deep forest-green accent, by direct
instruction. Liquid Glass is about light passing through material — it is
designed for bright, layered canvases with depth behind the glass. Over `#000`
it either disappears or resolves to grey haze. The two directives are in genuine
tension and the OLED one is the better fit for a console operators read for
hours.

### The performance budget forbids it where it would matter most

STUDIO-030-011 requires Core Web Vitals budgets and virtualised large tables;
STUDIO-030-010 requires validating against thousands of resources. `/platform/estate`
alone renders six tables, one of them a row per AWS service in the account.
`backdrop-filter` on scrolling containers is precisely where that budget is
spent. The stylesheet contains zero `backdrop-filter` declarations today, and
that is a property worth keeping rather than an omission.

### MD3 here is a vocabulary, not an appearance

This is the part most likely to be misread. The Studio does not look like a
Material application: the palette is forest green, not Material purple, and the
primitives are the console's own. What the layer supplies is exactly what
STUDIO-030-001 demands — "one token source for color, typography, spacing, radii,
borders, elevation, motion, charts, density, and focus across every System Studio
surface". Replacing the vocabulary would not change the look; it would delete the
guarantees and require rebuilding the primitives to get back to the same place.

Bible §20 also forbids copying "Monarch, Vercel, Perplexity, AWS Console, SAP,
Workday, or Jira trade dress". Apple is not on that list, but the principle it
encodes — this product wears its own identity — argues the same way.

## The half of the critique that is right, and what is done about it

"Aesthetics and calmness" is a fair reading of the console as it stood: a wall of
cards, chips and borders competing for attention inside a centred column.

Calm is not a material. It comes from restraint, and it is achievable in the
substrate already present:

- one accent, used sparingly, and neutral surfaces everywhere else — which is what
  the OLED-black-plus-single-green direction already asks for;
- hierarchy carried by type scale and spacing rather than by a border on every
  container;
- fewer simultaneous surfaces per view, with detail behind disclosure;
- motion only where it explains a change, and none of it under
  `prefers-reduced-motion`.

Those are directives on the token and shell work, not a new dependency.

## Component scale: compact by default

A second instruction from the product owner, and the more specific one: components
must be "not too large or even large, just medium to small so its compact and most
is visible in a single view", matching the restraint of a well-made desktop
application.

This is a decision about the BASE scale, not about the density toggle.
STUDIO-030-005 gives operators a comfortable/compact preference; that is a
preference around a default, and the default itself was too loose. An operations
console is read the way a spreadsheet is read — the value is in seeing the whole
fleet at once, and every 4px of padding on a row costs a row of the estate at the
bottom of the screen.

The rules that follow, and they bind the token layer rather than individual pages:

- **Type**: the body scale is the working size, and headings step by ratio, not by
  leaps. A heading that is three times body size on an internal console is a poster,
  not a hierarchy. Hierarchy comes from weight, colour and space before it comes
  from size.
- **Controls**: buttons, inputs, selects and chips sit at a medium height, with the
  touch-target minimum met by the hit area rather than by inflating the visible
  box — STUDIO-030-007 requires the target, not the ornament.
- **Rows**: table and list rows are compact enough that a screen shows a working
  set. Padding is the last thing added and the first thing cut.
- **Cards**: a card earns its padding by grouping something; nested cards each
  paying full padding is how a console ends up showing four facts per screen.
- **Space is hierarchy**: the gap between groups should exceed the gap within one,
  and that difference does more work than any border. Prefer removing a border to
  adding one.

The falsifiable form: STUDIO-030-005's "without information loss" test asserts
that compact and comfortable show the same facts. The complement — that the
DEFAULT shows a useful working set — belongs with STUDIO-030-010's "realistic
high-density tenants … thousands of resources", and is checked by asserting a
minimum number of rows visible in a standard viewport rather than by eye.

## Consequences

- Anyone proposing a substrate change must answer the contrast question first: how
  a token pair's ratio is measured when one side is translucent.
- `backdrop-filter` is not forbidden outright — a scrim over a modal is a
  legitimate use — but it may not become the mechanism by which ordinary surfaces
  are distinguished, because that is the form that breaks both the contrast check
  and the performance budget.
- If the console still reads as cluttered after the shell and token work lands,
  the remedy is fewer elements, not a different material. That is a decision this
  ADR is deliberately pre-committing to, so the next round of the question starts
  from evidence rather than from taste.
