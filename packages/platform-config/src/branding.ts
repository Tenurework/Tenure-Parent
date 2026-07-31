import { z } from "zod"
import { defineConfig, type ConfigDefinition } from "@tenure/configuration"

/**
 * Visual identity, as configuration.
 *
 * The brand green is five hex literals in `globals.css`, which is right for
 * Tenure's own product and wrong the first time an institution wants its own
 * colour on a system its students use daily.
 *
 * Scoped narrowly on purpose. A colour is not a security decision, but the way
 * it reaches the page is: these values are interpolated into a `<style>` block,
 * so an unvalidated string here is a CSS injection and — with the right payload
 * — an exfiltration channel. Every value is therefore validated to a shape that
 * cannot escape a CSS declaration, and the merge strategy is `replace` rather
 * than `deepMerge` so no partial value can be assembled from two layers.
 */

/**
 * A colour this can safely interpolate.
 *
 * Deliberately only `#rgb` / `#rrggbb`. Not `rgb()`, not `hsl()`, not named
 * colours, and certainly not arbitrary CSS: the point of the allowlist is that
 * nothing accepted here can contain a `;`, a `}` or a `url(`, so it cannot
 * terminate the declaration it sits in.
 */
const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "a #rgb or #rrggbb colour")

export const primaryColor = defineConfig({
  key: "platform.branding.primaryColor",
  owner: "platform",
  type: hexColor,
  default: "#1c8c5a",
  allowedScopes: ["blueprint", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  description: "The accent colour: active navigation, primary buttons, focus rings.",
})

export const primaryTextColor = defineConfig({
  key: "platform.branding.primaryTextColor",
  owner: "platform",
  type: hexColor,
  default: "#ffffff",
  allowedScopes: ["blueprint", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  description:
    "Text drawn on top of the accent colour. Separate from it because contrast is a decision, not a calculation.",
})

export const wordmark = defineConfig({
  key: "platform.branding.wordmark",
  owner: "platform",
  type: z.string().min(1).max(40),
  default: "Tenure",
  allowedScopes: ["blueprint", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  description: "The name shown in the shell. Rendered as text, never as markup.",
})

export const BRANDING_DEFINITIONS: readonly ConfigDefinition[] = [
  primaryColor,
  primaryTextColor,
  wordmark,
] as ConfigDefinition[]

export interface Branding {
  primaryColor: string
  primaryTextColor: string
  wordmark: string
}

/**
 * The CSS a tenant's branding contributes, as a `<style>` body.
 *
 * Re-validated here rather than trusted. The values have already passed their
 * schema at resolution, but this function is what actually writes into a page,
 * and a defence that lives only at the far end of a call chain is a defence that
 * a future refactor removes without noticing. Anything that fails is dropped
 * rather than escaped: there is no correct escaping of a colour that is not one.
 *
 * Returns "" when nothing differs from the default, so the common case adds no
 * bytes to the document.
 */
export function brandingCss(branding: Branding): string {
  const declarations: string[] = []

  const safe = (value: string) => hexColor.safeParse(value).success

  if (safe(branding.primaryColor) && branding.primaryColor !== primaryColor.default) {
    declarations.push(`--primary: ${branding.primaryColor};`)
    // The hover and press shades derive from the same value rather than being
    // three more settings. Asking an administrator for a colour ramp is asking
    // them to get contrast wrong in three new places.
    declarations.push(`--primary-hover: color-mix(in srgb, ${branding.primaryColor} 88%, black);`)
    declarations.push(`--primary-press: color-mix(in srgb, ${branding.primaryColor} 76%, black);`)
    declarations.push(`--primary-light: color-mix(in srgb, ${branding.primaryColor} 12%, white);`)
  }

  if (safe(branding.primaryTextColor) && branding.primaryTextColor !== primaryTextColor.default) {
    declarations.push(`--primary-text: ${branding.primaryTextColor};`)
  }

  if (declarations.length === 0) return ""
  return `:root{${declarations.join("")}}`
}
