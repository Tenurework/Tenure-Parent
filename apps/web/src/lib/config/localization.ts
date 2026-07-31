import { z } from "zod"
import { defineConfig, type ConfigDefinition } from "@tenure/configuration"

/**
 * Locale, currency and calendar, as configuration rather than as literals.
 *
 * `"en-US"` appears in seven places and `$` is baked into `formatCents`. Both
 * are correct for the pilot and wrong for the first customer who is not in the
 * United States — and there is currently nowhere to say so.
 *
 * These are deliberately *formatting* keys. Nothing here decides authority, so
 * the same narrow fallback the terminology keys use applies: an institution
 * with no binding formats in the platform default rather than 500ing, and
 * `system-config.test.ts` asserts no key in this registry carries a capability
 * requirement, and that none is confidential or secret.
 *
 * Time zone is deliberately NOT here. It already lives on `Institution.timeZone`
 * and is resolved per request by `institution-time.ts`. Adding a second source
 * for it would create two answers to one question, and the existing one is
 * closer to the data.
 */

export const locale = defineConfig({
  key: "platform.localization.locale",
  owner: "platform",
  type: z
    .string()
    .min(2)
    .max(35)
    // BCP 47, checked by asking the platform rather than by a regex that will be
    // wrong about some real tag. A locale nobody can format in is a page of
    // RangeErrors, so it is refused at publication instead.
    .refine(
      (tag) => {
        try {
          return Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0
        } catch {
          return false
        }
      },
      { message: "not a locale this runtime can format in" },
    ),
  default: "en-US",
  allowedScopes: ["blueprint", "tenant", "user"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  description:
    "BCP 47 locale for dates, numbers and sorting. Settable per user, because a reader's language is theirs.",
})

export const currency = defineConfig({
  key: "platform.localization.currency",
  owner: "platform",
  type: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/, "an ISO 4217 code, uppercase")
    .refine(
      (code) => {
        try {
          new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(1)
          return true
        } catch {
          return false
        }
      },
      { message: "not a currency this runtime can format" },
    ),
  default: "USD",
  // NOT user-settable, unlike locale. A person may read dates in their own
  // language; they may not decide what currency a budget is denominated in.
  // Changing that reinterprets every stored amount.
  allowedScopes: ["blueprint", "tenant", "legalEntity"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  description:
    "ISO 4217 currency the tenant's money is denominated in. A legal entity may differ from its tenant.",
})

export const firstDayOfWeek = defineConfig({
  key: "platform.localization.firstDayOfWeek",
  owner: "platform",
  type: z.number().int().min(0).max(6),
  default: 0,
  allowedScopes: ["blueprint", "tenant", "user"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  description: "First column of a month grid. 0 = Sunday, 1 = Monday.",
})

export const fiscalYearStartMonth = defineConfig({
  key: "platform.localization.fiscalYearStartMonth",
  owner: "platform",
  type: z.number().int().min(1).max(12),
  default: 7,
  // Not a user preference and not a display setting: it decides which budget
  // period a transaction lands in.
  allowedScopes: ["blueprint", "tenant", "legalEntity"],
  mergeStrategy: "replace",
  sensitivity: "internal",
  overridable: true,
  description:
    "Month the fiscal year opens. 7 = July, which is the academic year most universities budget on.",
})

export const LOCALIZATION_DEFINITIONS: readonly ConfigDefinition[] = [
  locale,
  currency,
  firstDayOfWeek,
  fiscalYearStartMonth,
] as ConfigDefinition[]

export interface Localization {
  locale: string
  currency: string
  firstDayOfWeek: number
  fiscalYearStartMonth: number
}

/**
 * `localizationFor` lives in system-config.ts, not here.
 *
 * definitions.ts collects these into the platform registry, and system-config.ts
 * builds the registry — so a resolver in this file would close the cycle
 * localization -> system-config -> definitions -> localization. Definitions and
 * pure formatters stay here; anything that needs the registry goes there.
 */

/**
 * The pure formatter lives in `lib/money.ts` and is re-exported here so callers
 * that already have a Localization can use one import. It is not defined here
 * because this module pulls in `@tenure/configuration`, whose index reaches
 * `node:crypto` — and `finance.ts`, which needs the formatter, is imported by
 * client components.
 */
export { formatMoney } from "../money"
