import { createHash } from "node:crypto"

import { ALL_THEMES, readThemes } from "@/lib/a11y/theme-tokens"

/**
 * TTES-050-003 — the design system's own version, release notes, migration
 * notes and deprecation register.
 *
 * None of the four existed. `grep -rn "@deprecated" src packages` returned
 * nothing across the repository; there was no CHANGELOG outside node_modules;
 * and `packages/releases` versions a TENANT SYSTEM (blueprint + modules +
 * configuration + topology, frozen and hashed), not the component and token
 * layer. So the token layer was unversioned prose: the `#1c8c5a → #198052`
 * contrast fix reached every tenant with no version, no note and no migration,
 * recorded only as a comment in `packages/platform-config/src/branding.ts`.
 *
 * ## Why a hash of the real stylesheet, and not a hand-written version string
 *
 * A version number somebody remembers to bump is a version number that is
 * wrong the first time somebody forgets. `tokenHashNow()` reads `globals.css`
 * through the SAME reader the contrast audit uses (`readThemes`), so the hash
 * is over the values the product actually renders, in all four themes, after
 * the cascade. The jest test beside this file asserts the recomputed hash
 * equals `VERSIONS.at(-1)!.tokenHash`. Change any `--token` and CI is red until
 * a version entry — WITH notes and a migration — is added. That is the whole
 * mechanism: the release note is not a convention, it is the only way to get
 * green again.
 *
 * ## Deprecation
 *
 * `DEPRECATIONS` is read by an ESLint rule in `apps/web/eslint.config.mjs`,
 * which reports any import of a listed name and names its replacement and the
 * version it will be removed in. A deprecation nothing enforces is a comment.
 */

export const DESIGN_SYSTEM_VERSION = "1.1.0"

export interface DesignSystemRelease {
  /** Semver. Minor for an added token, major for a removed or re-meant one. */
  version: string
  /** ISO date the version was cut. */
  date: string
  /** Hash of every token in every theme at this version. See `tokenHashNow`. */
  tokenHash: string
  /**
   * What changed and why, for somebody reading it a year later. REQUIRED —
   * an optional field here is how an entry gets added empty to make CI green,
   * which is the exact failure this register exists to prevent.
   */
  notes: string
  /**
   * What a consumer has to do. "Nothing — additive" is a valid migration and
   * has to be written down; an absent migration is not.
   */
  migration: string
}

/**
 * Newest LAST. `at(-1)` is the current release, which is what the test checks
 * the live stylesheet against.
 */
export const VERSIONS: readonly DesignSystemRelease[] = [
  {
    version: "1.0.0",
    date: "2026-07-01",
    tokenHash: "unrecorded-pre-versioning",
    notes:
      "The token layer as it stood when versioning was introduced: four themes " +
      "(light, dark, and the prefers-contrast:more override of each) resolved from " +
      "src/app/globals.css, bound to Tailwind utilities in tailwind.config.ts, and " +
      "audited for WCAG 1.4.3 by src/lib/a11y/contrast.test.ts. Includes the " +
      "--primary #1c8c5a -> #198052 darkening (white on the old value was 4.24:1, " +
      "below the 4.5:1 AA floor on the most-clicked control in the product), which " +
      "shipped to every tenant with no version, no note and no migration. This " +
      "entry exists so that omission is on the record.",
    migration:
      "None. Any tenant branding that overrode --primary was already validated " +
      "against the same contrast floor at publication, so no override had to change.",
  },
  {
    version: "1.1.0",
    date: "2026-08-07",
    // Recomputed by design-system.test.ts from the live stylesheet. When this
    // is wrong the test says so and names the value it read, so the fix is to
    // add the next entry rather than to guess.
    tokenHash: "cf8b53db5945ffcde7be76eb5b882fe8",
    notes:
      "Additive. Adds the offline boundary's contract to the component layer " +
      "(html[data-offline] suppresses form submits, TTES-030-002) and moves the " +
      "product's empty panels onto StateSurface so the fourteen-state ARIA table " +
      "in src/components/ui/states.ts reaches the DOM (TTES-020-001). No token " +
      "value changed; the hash is recorded here for the first time so the NEXT " +
      "change to a token cannot land silently.",
    migration:
      "EmptyState now REQUIRES a `state` prop of \"empty\" | \"no-results\". There is " +
      "no default, deliberately: a default would compile at every existing call " +
      "site and keep filtered-to-nothing panels announcing \"nothing here yet\" " +
      "forever. Pass \"no-results\" wherever the surface is behind a filter, " +
      "\"empty\" otherwise. ShellHeader and SearchCommand require `sections`, and " +
      "TenureAIPanel requires `scope`; both are supplied by src/app/(app)/layout.tsx.",
  },
]

/** A deprecated export, and the two things a consumer needs from it. */
export interface Deprecation {
  replacement: string
  deprecatedIn: string
  removeIn: string
  reason: string
}

/**
 * The register the ESLint rule reads.
 *
 * Empty today, and that is a true statement rather than an unfinished one:
 * nothing in the component layer has been deprecated yet. The mechanism is what
 * this item is for — `eslint.config.mjs` builds a `no-restricted-imports` entry
 * from every key here, so adding one line makes the whole product report the
 * import with its replacement and its removal version.
 */
export const DEPRECATIONS: Readonly<Record<string, Deprecation>> = {
  // Add entries in the form:
  //   OldComponentName: {
  //     replacement: "NewComponentName",
  //     deprecatedIn: "1.2.0",
  //     removeIn: "2.0.0",
  //     reason: "why, in a sentence somebody reading the lint error can use",
  //   },
  // Keep the closing brace on its own line at column 0 — eslint.config.mjs
  // reads this object textually and `deprecatedNamesFrom` throws if it cannot
  // find the block, rather than quietly enforcing nothing.
}

/**
 * The hash of every declared token, in every theme, as the browser resolves it.
 *
 * Node-only (`node:crypto` and the filesystem reader). It is called from the
 * jest test and from tooling, never from a component — a component that hashed
 * the stylesheet at render time would be reading the filesystem in a request.
 */
export function tokenHashNow(): string {
  const themes = readThemes()
  const hash = createHash("sha256")
  for (const name of ALL_THEMES) {
    hash.update(`\n[${name}]\n`)
    for (const key of Object.keys(themes[name]).sort()) {
      hash.update(`${key}:${themes[name][key]};`)
    }
  }
  return hash.digest("hex").slice(0, 32)
}

/** The release the product is currently on. */
export function currentRelease(): DesignSystemRelease {
  const latest = VERSIONS[VERSIONS.length - 1]
  if (!latest) throw new Error("VERSIONS is empty; the design system has no current release.")
  return latest
}
