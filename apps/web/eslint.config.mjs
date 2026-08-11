import { readFileSync } from "node:fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { FlatCompat } from "@eslint/eslintrc"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

/* ─── GE-143-004 · the design-token boundary ──────────────────────────────────
   The token system is real — `src/app/globals.css` declares the `--token`
   layer, `tailwind.config.ts` binds every colour / shadow / radius / font class
   to it, and `src/lib/a11y/theme-tokens.ts` parses the stylesheet so the
   contrast audit reads the values the product actually renders. What it did not
   have was a boundary: nothing stopped a component writing `#25a96d` instead,
   and one already had. The audit cannot see that literal, so the palette can
   pass its contrast gate forever while the product drifts underneath it.

   These rules are the boundary. They run in CI (`.github/workflows/ci.yml`
   → `npm run lint` → `next lint` → this file), so the drift is caught at the
   commit that introduces it rather than at the next design review.

   WHAT IS ENFORCED, and why exactly this much

   * Literal colour values (`#rrggbb`, `rgb()`, `hsl()`, `oklch()`, …) in any
     string or template in a product module. This is the "raw primitive token"
     of the registry item: this token layer has no primitive tier to bypass —
     `--primary` IS the primitive — so bypassing it means writing the colour out
     by hand.
   * Tailwind arbitrary colour values (`bg-[#…]`, `text-[rgb(…)]`), which are
     the same bypass wearing a utility class. Baseline: zero occurrences.
   * Arbitrary shadows (`shadow-[…]`, `drop-shadow-[…]`, inline `boxShadow`).
     `tailwind.config.ts` extends `boxShadow` with xs/sm/md/lg → `--shadow-*`,
     so there is a sanctioned answer for every case. Baseline: zero.
   * Unregistered fonts (`font-[…]`, inline `fontFamily`). `tailwind.config.ts`
     extends `fontFamily` with `sans` / `display`. Baseline: zero.
   * Unregistered icons — direct imports of the icon vendor packages. The
     registry at `src/components/ui/icons.tsx` exists precisely so swapping the
     icon set stays a one-file change, and its own header already says "never
     from a vendor package directly". That was prose; it is now a rule.
     Baseline: zero violations outside the registry itself.
   * Vendor component libraries — `react-aria-components` (the behavioural
     primitives) and `class-variance-authority` (how a variant API is built).
     Bible §7 ends "Domain apps cannot import raw third-party components" and
     §16 asks for a rule "preventing … vendor components". The icon rule above
     covered the decorative half only; these are the primitives that carry
     behaviour and appearance, and a domain module that names one restyles the
     primitive locally. That had already happened twice — `CalendarSubscribe`
     and `ClubImageEditor` each hand-wrote the secondary-button class string
     that `src/components/ui/Button.tsx` owns, and the two copies had already
     drifted apart (`h-10` vs `h-9`, `border-border-strong` with no
     `data-[pressed]` state). The sanctioned alternative is the owned wrapper
     layer, `src/components/ui/**`: Button, Menu, Tooltip, Overlay, Select,
     Tabs, TextField, Segmented. Baseline: zero violations outside that layer.

   * Raw z-index — BOTH `z-[60]`-style arbitrary values AND Tailwind's own
     numeric `z-10 … z-50`, plus an inline `zIndex` property. This entry used to
     say the opposite ("the rule would have no sanctioned alternative to name"),
     and it was correct at the time: there was no scale. TTES-010-003 declared
     one — thirteen ordered `--z-*` tokens in `globals.css` bound to
     `zIndex` in `tailwind.config.ts` — and migrated all fourteen call sites
     onto it, so the alternative now exists and the numbers are what is left to
     forbid. Numeric `z-40` is banned as firmly as `z-[62]`, because "pick a
     number and hope" is the failure either way; the sanctioned names are read
     out of `globals.css` below, so the message can never name a class that is
     not declared. Baseline: zero.
   * Raw transition durations — `duration-[200ms]` and Tailwind's numeric
     `duration-150 … duration-1000`. Same shape and same reason: `--motion-fast`
     / `--motion-base` / `--motion-slow` exist and are bound to
     `transitionDuration`. Baseline: zero.

   WHAT IS NOT ENFORCED, and why not — stated so nobody reads silence as safety

   * Arbitrary spacing and type (`text-[13px]`, `p-[7px]`, `w-[min(…)]`, …).
     243 occurrences across 59 files as of 2026-08-07, including seven in
     `src/components/ui`. (The number this comment carried before — "237 across
     58" — had drifted; re-measure with:
       node -e "const fs=require('fs'),p=require('path');const rx=/\b(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|w|h|min-w|min-h|max-w|max-h|top|bottom|left|right|inset|inset-x|inset-y|start|end|text|leading|tracking|basis|size)-\[(?!--|#)/g;const f=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const q=p.join(d,e.name);if(e.isDirectory())w(q);else if(/\.tsx?$/.test(e.name)&&!/\.(test|itest)\.tsx?$/.test(e.name))f.push(q)}})('src');let n=0,c=0;for(const x of f){const m=fs.readFileSync(x,'utf8').match(rx);if(m){n+=m.length;c++}}console.log(n,c)"
     The `(?!--|#)` is what keeps `text-[--error]` and `bg-[#fff]` out of the
     count — those are a token reference and a colour, and the colour rules
     above already own the second.) A rule here is a cleanup project across the
     whole product rather than a boundary, so it is the debt-ratchet item
     (TTES-050-004), not something that can go green today.
   * Easing keywords (`ease-out`, `ease-in`). `--ease-entry` / `--ease-exit`
     exist and the shell uses them, but `ease-out` is a CSS keyword rather than
     a magic number, and banning it would red files this change does not own.

   THE EXCEPTION PROCESS

   Add an entry to `DESIGN_TOKEN_EXCEPTIONS` naming the files, the rule keys it
   suspends, a reason, and an `expires` date. Everything else stays enforced in
   that file — an exception for a colour literal does not also unlock shadows.

   The expiry is not documentation. On the day it passes, the exception stops
   suppressing anything and the file additionally reports the expiry itself, by
   name, with the original reason attached. `TENURE_DESIGN_TOKEN_TODAY` can move
   this clock, but only forwards (see `lintToday`) — the tests need to prove an
   expiry fires without waiting for a calendar, and no one needs to revive a
   dead exception by setting a date in the past.
───────────────────────────────────────────────────────────────────────────── */

/** Product modules: the UI that ships. Their tests are not product modules. */
const PRODUCT_MODULES = ["src/app/**/*.ts", "src/app/**/*.tsx", "src/components/**/*.ts", "src/components/**/*.tsx"]
const PRODUCT_MODULE_EXCLUSIONS = ["**/*.test.ts", "**/*.test.tsx", "**/*.itest.ts", "**/__tests__/**"]

/** The one module allowed to name the icon vendor. */
const ICON_REGISTRY = "src/components/ui/icons.tsx"

/**
 * The owned wrapper layer — the one place allowed to name a vendor component
 * library. Every Tenure primitive lives here (Button, Menu, Tooltip, Overlay,
 * Select, Tabs, TextField, Segmented), so a vendor swap stays inside it.
 *
 * It is deliberately NOT allowed to bypass the icon registry: the carve-out
 * below re-states the icon restriction for this glob, so `src/components/ui/**`
 * may name `react-aria-components` and may not name `lucide-react`. A blanket
 * `"no-restricted-imports": "off"` here would have quietly widened the icon
 * boundary from one file to twenty.
 */
const OWNED_WRAPPERS = "src/components/ui/**"

/* Regex sources for esquery attribute matching. `\x5B` rather than `\[`:
   esquery parses `[` inside a selector regex as the start of a character class
   and rejects the escaped form, which throws a selector SyntaxError mid-lint. */
const COLOR_VALUE = String.raw`#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\s*\(`
const ARBITRARY_COLOR_UTILITY = String.raw`\x5B(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch|oklab|color-mix)\()`
const ARBITRARY_SHADOW_UTILITY = String.raw`\b(?:shadow|drop-shadow)-\x5B`
const ARBITRARY_FONT_UTILITY = String.raw`\bfont-\x5B`
/* Both forms, not just the arbitrary one: `z-[62]` and `z-40` are the same
   decision, and only `z-[62]` looking wrong is why nine hand-picked numeric
   layers accumulated without anyone noticing. Same for `duration-300`. */
const RAW_Z_INDEX_UTILITY = String.raw`\bz-(?:\x5B|\d)`
const RAW_DURATION_UTILITY = String.raw`\bduration-(?:\x5B|\d)`

/**
 * The token names the messages below name, read out of the stylesheet that
 * declares them.
 *
 * Hardcoding the list here would let `globals.css` drop a layer while the lint
 * message kept advertising it — a rule pointing at a class Tailwind no longer
 * generates is worse than no rule, because the fix it demands does not work.
 * Throwing on an empty match is the other half: deleting the contract has to
 * break `npm run lint` loudly rather than quietly leaving the rule pointing at
 * nothing.
 *
 * @param prefix {string} e.g. "z" for `--z-nav`, "motion" for `--motion-base`
 * @param rename {(name: string) => string} token name → Tailwind class
 */
function tokenClasses(prefix, rename) {
  const css = readFileSync(join(__dirname, "src/app/globals.css"), "utf8")
  const found = [...css.matchAll(new RegExp(String.raw`^\s*--${prefix}-([a-z0-9-]+)\s*:`, "gm"))]
  const names = [...new Set(found.map((m) => m[1]))]
  if (names.length === 0) {
    throw new Error(
      `apps/web/src/app/globals.css declares no --${prefix}-* tokens, so the design-token rule that ` +
        `requires them has no sanctioned alternative to name. Restore the contract, or remove the rule ` +
        `from DESIGN_TOKEN_RULES deliberately — do not leave a rule pointing at classes that do not exist.`
    )
  }
  return names.map(rename)
}

const Z_LAYER_CLASSES = tokenClasses("z", (n) => `z-${n}`)
const MOTION_CLASSES = tokenClasses("motion", (n) => `duration-${n}`)

/**
 * The restricted-syntax rules, keyed so an exception can suspend one without
 * suspending the rest. Each message names the sanctioned alternative — a rule
 * that only says "no" gets an exception rather than a fix.
 */
export const DESIGN_TOKEN_RULES = {
  colorLiteral: {
    selectors: [`Literal[value=/${COLOR_VALUE}/]`, `TemplateElement[value.raw=/${COLOR_VALUE}/]`],
    message:
      "Literal colour value in a product module. Use the design token: a Tailwind class bound to it in tailwind.config.ts (bg-surface, text-text-1, border-border, text-status-error-text, fill-chart-1, …) or var(--token) from src/app/globals.css. The contrast audit reads globals.css and cannot see a literal, so a literal is invisible to it forever. If it genuinely cannot be a token, add a dated entry to DESIGN_TOKEN_EXCEPTIONS in eslint.config.mjs.",
  },
  arbitraryColorUtility: {
    selectors: [
      `Literal[value=/${ARBITRARY_COLOR_UTILITY}/]`,
      `TemplateElement[value.raw=/${ARBITRARY_COLOR_UTILITY}/]`,
    ],
    message:
      "Tailwind arbitrary colour value (bg-[#…], text-[rgb(…)]) bypasses the token layer exactly as a literal does. Use the token-bound colour classes from tailwind.config.ts.",
  },
  arbitraryShadow: {
    selectors: [
      `Literal[value=/${ARBITRARY_SHADOW_UTILITY}/]`,
      `TemplateElement[value.raw=/${ARBITRARY_SHADOW_UTILITY}/]`,
      `Property[key.name="boxShadow"]`,
    ],
    message:
      "Arbitrary shadow bypasses the elevation scale. Use shadow-xs / shadow-sm / shadow / shadow-md / shadow-lg (tailwind.config.ts boxShadow → --shadow-*).",
  },
  unregisteredFont: {
    selectors: [
      `Literal[value=/${ARBITRARY_FONT_UTILITY}/]`,
      `TemplateElement[value.raw=/${ARBITRARY_FONT_UTILITY}/]`,
      `Property[key.name="fontFamily"]`,
    ],
    message:
      "Unregistered font family. Use font-sans or font-display (tailwind.config.ts fontFamily → --font-inter / --font-display-face), which are the local font tokens globals.css declares.",
  },
  arbitraryZIndex: {
    selectors: [
      `Literal[value=/${RAW_Z_INDEX_UTILITY}/]`,
      `TemplateElement[value.raw=/${RAW_Z_INDEX_UTILITY}/]`,
      `Property[key.name="zIndex"]`,
    ],
    message: `Raw z-index. Pick the layer that says WHY the thing is lifted, from the ordered contract in globals.css: ${Z_LAYER_CLASSES.join(", ")}. Numeric z-40 counts as raw here as much as z-[62] does — twelve hand-picked numbers with no contract between them is what this replaced, and the one invariant that mattered (the nav drawer scrim sits above the footer and below the nav) was encoded in a bare 39 that nothing checked. If a new surface genuinely needs a layer none of these describes, add a token to globals.css and bind it in tailwind.config.ts zIndex rather than reaching for a number.`,
  },
  arbitraryDuration: {
    selectors: [
      `Literal[value=/${RAW_DURATION_UTILITY}/]`,
      `TemplateElement[value.raw=/${RAW_DURATION_UTILITY}/]`,
      `Property[key.name="transitionDuration"]`,
      `Property[key.name="animationDuration"]`,
    ],
    message: `Raw transition duration. Use the motion scale: ${MOTION_CLASSES.join(", ")} (globals.css --motion-* → tailwind.config.ts transitionDuration), paired with ease-entry for something arriving and ease-exit for something leaving. Two transitions on opposite edges of the same frame with different literal durations is a visible tear, and that is exactly what duration-200 beside duration-300 was.`,
  },
}

/* ─── TTES-050-003 · deprecation is enforced, not narrated ────────────────────
   `src/components/ui/design-system.ts` carries the design system's version,
   its release notes, its migration notes and `DEPRECATIONS`. This turns that
   last one into a rule: importing a deprecated name from the design system is
   reported, with the replacement and the version it disappears in.

   Read at config load with a regex rather than by importing the module: this
   file is ESM loaded by ESLint's own resolver, `design-system.ts` is
   TypeScript, and a config that needs a transform to load is a config that
   breaks the lint run the day the transform moves. The register is a flat
   object literal, and a malformed one throws below rather than silently
   enforcing nothing.

   Empty today, and that is honest: nothing has been deprecated yet. The rule
   still exists, so the day something is, one line in the register makes every
   import of it red.

   IT IS PATHS, NOT A CONFIG BLOCK. This used to ship as its own flat-config
   object — `{ files: PRODUCT_MODULES, rules: { "no-restricted-imports": [...] } }`
   appended after `designTokenConfigs`. Flat config resolves a rule by LAST
   WRITER: a later object naming the same rule over the same files REPLACES the
   earlier value whole, it does not merge with it. So that block was a loaded
   gun pointed at the vendor and icon boundaries — empty `DEPRECATIONS` meant
   `deprecationImportRules` returned `[]` and nothing was wrong, and the first
   line ever added to the register would have silently deleted
   `no-restricted-imports` for every product module at once. Measured, not
   reasoned: injecting one entry made
   `import { Menu } from "react-aria-components"` in `src/components/shell/`
   report nothing, and `import { Star } from "lucide-react"` report nothing.
   Both gates, gone, with a green test suite.

   So deprecations contribute PATHS into the single `no-restricted-imports`
   value built by `restrictedImports` below, and `assertOneImportBoundary`
   fails the lint run if a second writer for that rule over PRODUCT_MODULES
   ever reappears.
──────────────────────────────────────────────────────────────────────────── */
const DESIGN_SYSTEM_MODULE = "@/components/ui/design-system"

export function deprecatedNamesFrom(source) {
  const block = /export const DEPRECATIONS[^=]*=\s*\{\n([\s\S]*?)\n\}\n/.exec(source)
  if (!block) {
    throw new Error(
      "Could not find `export const DEPRECATIONS = { ... }` in design-system.ts. The deprecation lint rule reads it textually; if the declaration was reformatted, update the reader in eslint.config.mjs rather than dropping the rule.",
    )
  }
  const body = block[1]
  const names = []
  for (const match of body.matchAll(/^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*:\s*\{/gm)) {
    names.push(match[1] ?? match[2] ?? match[3])
  }
  return names
}

/**
 * The deprecation register as `no-restricted-imports` PATH entries, to be
 * merged into the one restricted-imports value rather than declared as a
 * competing config block. See the section header above for why that difference
 * is the whole point.
 *
 * @param names {string[]} keys of DEPRECATIONS; `[]` when nothing is deprecated
 */
export function deprecatedImportPaths(names) {
  if (names.length === 0) return []
  return [
    {
      name: DESIGN_SYSTEM_MODULE,
      importNames: names,
      message: `Deprecated design-system export. See DEPRECATIONS in ${DESIGN_SYSTEM_MODULE.replace("@/", "src/")}.ts for the replacement and the version it is removed in — the register carries both, and a version entry in VERSIONS carries the migration.`,
    },
  ]
}

const ICON_IMPORT_MESSAGE = `Import icons from "@/components/ui/icons", never from the vendor package. The registry aliases every icon the product uses, which is what keeps swapping the icon set a one-file change — see the header of ${ICON_REGISTRY}.`

const ICON_PATHS = [{ name: "lucide-react", message: ICON_IMPORT_MESSAGE }]
const ICON_PATTERNS = [
  {
    group: ["@phosphor-icons/react", "@phosphor-icons/react/*"],
    message: ICON_IMPORT_MESSAGE,
  },
]

/**
 * Named alternatives, not a bare "no". Every wrapper listed here exists and is
 * imported by a product module today, so the rule can be obeyed by editing an
 * import line rather than by opening an exception.
 */
const VENDOR_COMPONENT_MESSAGE = `Vendor component library in a product module. Build on the Tenure-owned wrappers in ${OWNED_WRAPPERS}: Button (@/components/ui/Button), Menu / MenuTrigger / MenuItem / MenuPopover (@/components/ui/Menu), Tooltip / TooltipTrigger / Focusable (@/components/ui/Tooltip), Overlay / PopoverDialog (@/components/ui/Overlay), Select, Tabs, TextField, Segmented. Those wrappers are the one layer allowed to name react-aria-components or class-variance-authority; a domain module that names one restyles the primitive locally, and the owned variant drifts away from it in the next change.`

const VENDOR_COMPONENT_PATHS = [
  { name: "react-aria-components", message: VENDOR_COMPONENT_MESSAGE },
  { name: "class-variance-authority", message: VENDOR_COMPONENT_MESSAGE },
]
const VENDOR_COMPONENT_PATTERNS = [
  { group: ["react-aria-components/*"], message: VENDOR_COMPONENT_MESSAGE },
]

/**
 * THE one `no-restricted-imports` value for a given glob — every list that has
 * to hold there, composed into a single rule entry.
 *
 * Composed rather than declared in separate config blocks because flat config
 * has no rule-level merge: two objects naming `no-restricted-imports` over
 * overlapping files means the later one wins outright and the earlier one's
 * paths stop being enforced, with no warning from ESLint and no failing test.
 * Everything that restricts an import for the same files therefore has to
 * arrive here, as paths, and `assertOneImportBoundary` checks that it did.
 *
 * @param vendorComponents {boolean} false inside the owned wrapper layer, which
 *   exists to name `react-aria-components` / `class-variance-authority`
 * @param deprecated {Array<object>} from `deprecatedImportPaths`; applies
 *   everywhere, wrappers included — a deprecated export is deprecated for its
 *   own neighbours too
 */
function restrictedImports({ vendorComponents, deprecated }) {
  return [
    "error",
    {
      paths: [...ICON_PATHS, ...(vendorComponents ? VENDOR_COMPONENT_PATHS : []), ...deprecated],
      patterns: [...ICON_PATTERNS, ...(vendorComponents ? VENDOR_COMPONENT_PATTERNS : [])],
    },
  ]
}

/**
 * Fails the lint run if the import boundary over product modules has stopped
 * being exactly one rule declaration carrying the vendor paths.
 *
 * This runs at config load — every `npm run lint`, every editor lint — because
 * the failure it catches is invisible by construction: the rule that lost is
 * simply not reported any more, so every existing test goes on passing while
 * the boundary is gone. A config that cannot enforce what it claims has to
 * refuse to load rather than quietly enforce less.
 *
 * @param configs {Array<object>} the assembled flat config
 */
export function assertOneImportBoundary(configs) {
  const overProductModules = configs.filter(
    (config) =>
      config?.rules &&
      Object.prototype.hasOwnProperty.call(config.rules, "no-restricted-imports") &&
      Array.isArray(config.files) &&
      config.files.some((glob) => PRODUCT_MODULES.includes(glob))
  )

  if (overProductModules.length !== 1) {
    throw new Error(
      `Expected exactly one config object to declare no-restricted-imports over PRODUCT_MODULES; found ${overProductModules.length} (${overProductModules.map((c) => c.name ?? "unnamed").join(", ")}). Flat config resolves a rule by last writer, not by merge, so a second declaration silently deletes the first — which is how the vendor and icon boundaries would disappear from every product module at once. Add the paths to restrictedImports() instead of adding a config block.`
    )
  }

  const [, options] = overProductModules[0].rules["no-restricted-imports"]
  const names = (options?.paths ?? []).map((path) => path.name)
  const missing = VENDOR_COMPONENT_PATHS.map((path) => path.name).filter((name) => !names.includes(name))
  if (missing.length > 0) {
    throw new Error(
      `The no-restricted-imports boundary over PRODUCT_MODULES no longer restricts ${missing.join(", ")}. Bible §7 ("Domain apps cannot import raw third-party components") and §16 are what this enforces; the owned wrappers in ${OWNED_WRAPPERS} are the sanctioned alternative. Remove the restriction deliberately if that is the decision — do not let it fall out of a rule value by accident.`
    )
  }
}

/**
 * Live exceptions. Every one carries an expiry that is enforced, not narrated.
 *
 * `src/components/ui/icons.tsx` is deliberately NOT here: the registry is the
 * boundary, not a hole in it, so it gets a structural carve-out below rather
 * than an entry that would have to be renewed forever.
 */
export const DESIGN_TOKEN_EXCEPTIONS = [
  {
    files: ["src/app/layout.tsx", "src/app/manifest.ts"],
    allow: ["colorLiteral"],
    reason:
      "Browser and OS chrome. `viewport.themeColor` and the web-app manifest's background_color / theme_color are read by the user agent before any stylesheet exists, so var(--bg-base) is not resolvable there. Values are kept equal to --bg-base and --primary by hand.",
    expires: "2027-08-06",
  },
  {
    files: ["src/app/apple-icon.tsx"],
    allow: ["colorLiteral"],
    reason:
      "next/og rasterises this route at build time through satori, which renders a subset of CSS with no custom properties. The rosette's fill has to be a literal to become a PNG.",
    expires: "2027-08-06",
  },
  {
    files: ["src/components/ui/Avatar.tsx"],
    allow: ["colorLiteral"],
    reason:
      "Deterministic monogram swatch: four hsl() values computed from a hash of the person's name so a roster reads as distinct discs. A fixed token cannot vary per person; the light/dark pair is still handed to `.avatar-monogram` in globals.css to resolve.",
    expires: "2027-08-06",
  },
  {
    files: ["src/components/ui/design-system.ts"],
    allow: ["colorLiteral"],
    reason:
      "A changelog of the token layer, not a surface that renders. Its release notes record that --primary was darkened from #1c8c5a to #198052 because white on the old value measured 4.24:1, under the 4.5:1 AA floor, and shipped to every tenant with no version and no migration. Those two literals ARE the record — writing them as var(--primary) would resolve both to today's value and destroy the only statement the entry makes. Nothing in this file reaches a stylesheet, so the contrast audit loses nothing by not seeing them.",
    expires: "2027-08-06",
  },
]

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The date the exception expiries are measured against.
 *
 * `TENURE_DESIGN_TOKEN_TODAY` moves it FORWARDS ONLY. A test has to be able to
 * prove that an expiry actually fires, and waiting for 2027 is not a test; but
 * an override that also worked backwards would be a way to keep a dead
 * exception alive from CI configuration, which is the ratchet loosening itself.
 * Taking the later of the two dates gives the first without the second.
 */
export function lintToday(env = process.env, now = new Date()) {
  const real = now.toISOString().slice(0, 10)
  const override = env.TENURE_DESIGN_TOKEN_TODAY
  if (override === undefined || override === "") return real
  if (!ISO_DATE.test(override) || Number.isNaN(Date.parse(override))) {
    throw new Error(`TENURE_DESIGN_TOKEN_TODAY must be a YYYY-MM-DD date; got ${JSON.stringify(override)}.`)
  }
  return override > real ? override : real
}

/** Every restricted-syntax entry except the keys an exception suspends. */
function restrictedSyntax(allow = []) {
  return Object.entries(DESIGN_TOKEN_RULES)
    .filter(([key]) => !allow.includes(key))
    .flatMap(([, rule]) => rule.selectors.map((selector) => ({ selector, message: rule.message })))
}

/**
 * Turns the exception table into flat-config blocks, and throws on a malformed
 * entry so a broken exception fails the lint run rather than silently
 * suppressing everything in the files it names.
 *
 * @param exceptions {typeof DESIGN_TOKEN_EXCEPTIONS}
 * @param today {string} ISO date; entries whose `expires` is before it are dead
 * @param deprecated {Array<object>} from `deprecatedImportPaths`. REQUIRED, and
 *   `[]` is the way to say "nothing is deprecated". A defaulted parameter here
 *   would mean a caller that forgot it silently shipped a config with the
 *   deprecation rule switched off, which is the same class of failure the
 *   separate-config-block version had.
 */
export function designTokenConfigs(exceptions, today, deprecated) {
  if (!ISO_DATE.test(today)) {
    throw new Error(`designTokenConfigs needs an ISO date; got ${JSON.stringify(today)}.`)
  }
  if (!Array.isArray(deprecated)) {
    throw new Error(
      `designTokenConfigs needs the deprecated-import paths as its third argument (pass [] when DEPRECATIONS is empty); got ${JSON.stringify(deprecated)}. They are merged into the one no-restricted-imports value rather than declared as their own config block — see deprecatedImportPaths.`
    )
  }

  const configs = [
    {
      name: "tenure/design-tokens",
      files: PRODUCT_MODULES,
      ignores: PRODUCT_MODULE_EXCLUSIONS,
      rules: {
        "no-restricted-syntax": ["error", ...restrictedSyntax()],
        "no-restricted-imports": restrictedImports({ vendorComponents: true, deprecated }),
      },
    },
    {
      // The wrapper layer is the boundary for vendor *components*, so it may
      // name them — and only it. The icon restriction is re-stated rather than
      // dropped: this glob covers ~20 files, and turning the rule off wholesale
      // would let any of them import lucide-react directly.
      name: "tenure/design-tokens-owned-wrappers",
      files: [OWNED_WRAPPERS],
      ignores: PRODUCT_MODULE_EXCLUSIONS,
      rules: { "no-restricted-imports": restrictedImports({ vendorComponents: false, deprecated }) },
    },
    {
      // The registry is the boundary. It is the one module whose job is to name
      // the vendor, so it carries no expiry — there is nothing here to clean up.
      name: "tenure/design-tokens-icon-registry",
      files: [ICON_REGISTRY],
      rules: { "no-restricted-imports": "off" },
    },
  ]

  for (const exception of exceptions) {
    const { files, allow, reason, expires } = exception
    const where = Array.isArray(files) ? files.join(", ") : String(files)

    if (!Array.isArray(files) || files.length === 0) {
      throw new Error(`A design-token exception must name the files it covers (got ${JSON.stringify(files)}).`)
    }
    if (!Array.isArray(allow) || allow.length === 0) {
      throw new Error(`Design-token exception for ${where} must list the rule keys it suspends in \`allow\`.`)
    }
    for (const key of allow) {
      if (!Object.prototype.hasOwnProperty.call(DESIGN_TOKEN_RULES, key)) {
        throw new Error(
          `Design-token exception for ${where} suspends unknown rule ${JSON.stringify(key)}; known keys are ${Object.keys(DESIGN_TOKEN_RULES).join(", ")}.`
        )
      }
    }
    if (typeof reason !== "string" || reason.trim().length < 20) {
      throw new Error(`Design-token exception for ${where} needs a reason explaining why a token cannot be used.`)
    }
    if (typeof expires !== "string" || !ISO_DATE.test(expires) || Number.isNaN(Date.parse(expires))) {
      throw new Error(
        `Design-token exception for ${where} needs an \`expires\` date in YYYY-MM-DD form; got ${JSON.stringify(expires)}. Exceptions without an expiry are permanent, and permanent exceptions are how the boundary stops meaning anything.`
      )
    }

    if (expires < today) {
      configs.push({
        name: `tenure/design-tokens-expired:${where}`,
        files,
        rules: {
          "no-restricted-syntax": [
            "error",
            ...restrictedSyntax(),
            {
              selector: "Program",
              message: `Design-token exception for ${where} expired on ${expires}. Replace the literal with a token, or renew the exception in apps/web/eslint.config.mjs with a new expires date and a reason that is still true. Reason recorded when it was granted: ${reason}`,
            },
          ],
        },
      })
    } else {
      configs.push({
        name: `tenure/design-tokens-except:${where}`,
        files,
        rules: { "no-restricted-syntax": ["error", ...restrictedSyntax(allow)] },
      })
    }
  }

  return configs
}

const DESIGN_SYSTEM_SOURCE = readFileSync(
  new URL("./src/components/ui/design-system.ts", import.meta.url),
  "utf8",
)

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  ...designTokenConfigs(
    DESIGN_TOKEN_EXCEPTIONS,
    lintToday(),
    deprecatedImportPaths(deprecatedNamesFrom(DESIGN_SYSTEM_SOURCE))
  ),
]

/* Checked on the assembled array, not on the pieces: the thing that can be
   wrong is the composition, and only the finished array shows it. */
assertOneImportBoundary(eslintConfig)

export default eslintConfig
