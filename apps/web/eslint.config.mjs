import { dirname } from "path"
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

   WHAT IS NOT ENFORCED, and why not — stated so nobody reads silence as safety

   * Arbitrary spacing (`text-[13px]`, `p-[7px]`, …). 237 occurrences across 58
     files today, including nine in `src/components/ui`. A rule here is a
     cleanup project across the whole product, not a boundary, and it would red
     CI on files this change does not own.
   * Arbitrary z-index (`z-[60]`, `z-[100]`; four occurrences). Worse than
     spacing: `tailwind.config.ts` extends no `zIndex` scale and `globals.css`
     declares no `--z-*` tokens, so the rule would have no sanctioned
     alternative to name. The layering scale has to exist before its use can be
     required. Both of these need `tailwind.config.ts`, which this change does
     not own.

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

/* Regex sources for esquery attribute matching. `\x5B` rather than `\[`:
   esquery parses `[` inside a selector regex as the start of a character class
   and rejects the escaped form, which throws a selector SyntaxError mid-lint. */
const COLOR_VALUE = String.raw`#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\s*\(`
const ARBITRARY_COLOR_UTILITY = String.raw`\x5B(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch|oklab|color-mix)\()`
const ARBITRARY_SHADOW_UTILITY = String.raw`\b(?:shadow|drop-shadow)-\x5B`
const ARBITRARY_FONT_UTILITY = String.raw`\bfont-\x5B`

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
      "Unregistered font family. Use font-sans or font-display (tailwind.config.ts fontFamily → --font-inter / --font-display-face), which are the faces next/font actually loads.",
  },
}

const ICON_IMPORT_MESSAGE = `Import icons from "@/components/ui/icons", never from the vendor package. The registry aliases every icon the product uses, which is what keeps swapping the icon set a one-file change — see the header of ${ICON_REGISTRY}.`

const RESTRICTED_ICON_IMPORTS = [
  "error",
  {
    paths: [{ name: "lucide-react", message: ICON_IMPORT_MESSAGE }],
    patterns: [
      {
        group: ["@phosphor-icons/react", "@phosphor-icons/react/*"],
        message: ICON_IMPORT_MESSAGE,
      },
    ],
  },
]

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
    files: ["src/components/ai/TenureAIPanel.tsx"],
    allow: ["colorLiteral"],
    reason:
      "DEBT, not a sanctioned literal. The Tenure AI mark is drawn in #25a96d, which is not --primary (#198052) nor any other token — it is the drift this rule exists to stop, found by the rule itself. Closing it means adding a token for the mark or passing currentColor, both of which are edits to files outside the change that added this boundary. Short expiry on purpose.",
    expires: "2026-11-06",
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
 */
export function designTokenConfigs(exceptions, today) {
  if (!ISO_DATE.test(today)) {
    throw new Error(`designTokenConfigs needs an ISO date; got ${JSON.stringify(today)}.`)
  }

  const configs = [
    {
      name: "tenure/design-tokens",
      files: PRODUCT_MODULES,
      ignores: PRODUCT_MODULE_EXCLUSIONS,
      rules: {
        "no-restricted-syntax": ["error", ...restrictedSyntax()],
        "no-restricted-imports": RESTRICTED_ICON_IMPORTS,
      },
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

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  ...designTokenConfigs(DESIGN_TOKEN_EXCEPTIONS, lintToday()),
]

export default eslintConfig
