import { z } from "zod"
import { defineConfig, type ConfigDefinition } from "@tenure/configuration"

import { BRANDING_DEFINITIONS } from "./branding"
import { FLAG_DEFINITIONS } from "./flags"
import { LOCALIZATION_DEFINITIONS } from "./localization"

/**
 * What the platform lets an organization system change about the words it uses.
 *
 * Every string here is one that used to be a literal in a component. "Ainslie
 * OSE" appears in eight files today; a second institution does not call its
 * staff office that, and there is no acceptable version of
 * `if (slug === "rochester")` to make it say something else.
 *
 * Terminology is the smallest honest first consumer of the configuration engine:
 * it is real (these strings ship to users), it is genuinely per-institution, and
 * getting it wrong is a cosmetic bug rather than a security one — which is the
 * right risk profile for the first thing to route through a new resolver.
 */

export const staffOfficeName = defineConfig({
  key: "platform.terminology.staffOfficeName",
  owner: "platform",
  type: z.string().min(1).max(80),
  default: "Student Engagement Office",
  allowedScopes: ["blueprint", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  description:
    "The staff office that oversees organizations, as this institution names it. Rochester calls it Ainslie OSE.",
})

export const staffOfficeShortName = defineConfig({
  key: "platform.terminology.staffOfficeShortName",
  owner: "platform",
  type: z.string().min(1).max(24),
  default: "the office",
  allowedScopes: ["blueprint", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  description: "Short form used inline, e.g. in a seat label or a filter chip.",
})

export const organizationTerm = defineConfig({
  key: "platform.terminology.organizationSingular",
  owner: "platform",
  type: z.string().min(1).max(40),
  default: "organization",
  // `archetype` because this word IS the organization axis: selecting
  // `nonprofit-program-operations` is selecting "program". `blueprint` is kept
  // so a blueprint for a shape the axis does not yet name can still supply it;
  // `modules.test.ts` refuses a blueprint that sets it while its axis compiles
  // one, because the archetype layer would silently win.
  allowedScopes: ["blueprint", "archetype", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  description: "What one organization is called: a club, a chapter, a program, an operating unit.",
})

export const organizationTermPlural = defineConfig({
  key: "platform.terminology.organizationPlural",
  owner: "platform",
  type: z.string().min(1).max(40),
  default: "organizations",
  allowedScopes: ["blueprint", "archetype", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  description: "Plural of the above.",
})

export const leadershipBodyTerm = defineConfig({
  key: "platform.terminology.leadershipBody",
  owner: "platform",
  type: z.string().min(1).max(40),
  default: "leadership team",
  allowedScopes: ["blueprint", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  description: "The group that runs one organization: an executive board, a steering committee.",
})

export const seatTerm = defineConfig({
  key: "platform.terminology.seatSingular",
  owner: "platform",
  type: z.string().min(1).max(40),
  default: "role",
  allowedScopes: ["blueprint", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  description: "One position within the leadership body: a seat, an office, a post.",
})

/**
 * Every platform-owned definition a running system knows about.
 *
 * Modules extend this at enable time via `ConfigRegistry.with`, which produces a
 * new registry rather than mutating this one.
 */
export const PLATFORM_DEFINITIONS: readonly ConfigDefinition[] = [
  staffOfficeName,
  staffOfficeShortName,
  organizationTerm,
  organizationTermPlural,
  leadershipBodyTerm,
  seatTerm,
  ...LOCALIZATION_DEFINITIONS,
  ...BRANDING_DEFINITIONS,
  // Flags sit in the same registry as everything else deliberately: one
  // resolution, one checksum, one provenance trace. A separate flag store would
  // be a second configuration system with its own precedence rules, and the
  // restrict-only law in flags.ts is enforceable precisely because it is written
  // as merge strategies this engine already understands.
  ...FLAG_DEFINITIONS,
] as ConfigDefinition[]
