import type { Sensitivity } from "@tenure/configuration"
import type { TenantManifest } from "@tenure/provisioning"

/**
 * STUDIO-040-008 — a tenant's configuration, portable, with everything that
 * must not travel taken out by name.
 *
 * > "Make configuration import/export portable without exporting platform
 * >  secrets, AWS credentials, other tenants, or internal exploit-sensitive
 * >  policy details."
 *
 * ## What this is not
 *
 * `src/app/api/export/route.ts` exports the ESTATE — inventory, drift, posture
 * — for an operator's own analysis. It is a different artifact with a different
 * audience and it is not portable: it names AWS accounts, ARNs and security
 * groups on purpose, because the operator reading it already has them. This is
 * the artifact that LEAVES: a tenant's desired state, in a form that can be
 * handed to another Tenure installation, kept as a customer's own record, or
 * used to stand the same system up again. Two artifacts, two rules, and
 * collapsing them is how an estate inventory ends up in a customer's inbox.
 *
 * ## Sensitivity decides, and an undeclared key is not portable
 *
 * A value travels when its `ConfigDefinition.sensitivity` is `public` or
 * `internal`. `confidential` and `secret` do not. A key with NO definition does
 * not travel either — an unreviewable key is not a safe key, and the registry
 * is the thing that makes a key reviewable. This reuses the sensitivity field
 * that `@tenure/configuration` already declares rather than inventing a second
 * "exportable" flag: two lists that can disagree eventually do, and the one
 * that would be wrong is the one nobody looks at.
 *
 * ## The self-check is the point
 *
 * `exportBundle` builds the bundle, then runs `bundleLeaks` over what it built
 * and REFUSES to return one that leaks. A redaction rule that is only applied
 * on the way in is a rule that silently stops covering the next field somebody
 * adds; a check over the finished artifact covers fields nobody thought about.
 * The same check runs on the way IN, so a bundle that reaches this console
 * carrying another estate's ARNs is refused rather than imported.
 */

/** The bundle format. An importer that does not know this number refuses. */
export const BUNDLE_VERSION = 1

/** Sensitivities whose values may leave the building. */
export const PORTABLE_SENSITIVITIES: readonly Sensitivity[] = ["public", "internal"]

/** Something taken out of the bundle, and why. */
export interface Withholding {
  field: string
  reason: string
}

export interface PortableBundle {
  bundleVersion: number
  manifestVersion: number
  /** Which engine produced it, so an importer can refuse a shape it cannot read. */
  engineVersion: string
  slug: string
  displayName: string
  legalName: string
  blueprintId: string
  archetype?: { organization: string; operatingModel: string } | Record<string, string>
  modules: readonly string[]
  entitlements: readonly string[]
  region: string
  isolation: string
  coexistence: string
  systemOfRecord: Readonly<Record<string, string>>
  /** Values whose definitions say they may travel. */
  configuration: Readonly<Record<string, unknown>>
  /**
   * The NAMES of the secrets this tenant needs, with no pointer to where any
   * value lives. A `secretsmanager:` ARN is a map of the platform's vault, and
   * an importer needs to know a slot exists, not where ours is.
   */
  secretSlots: readonly string[]
  withheld: readonly Withholding[]
}

/** A thing found in a bundle that must not be in one. */
export interface Leak {
  /** Dotted path to the offending value. */
  at: string
  kind: LeakKind
  detail: string
}

export type LeakKind =
  | "aws-access-key"
  | "aws-account-id"
  | "aws-arn"
  | "secret-reference"
  | "private-key"
  | "email-address"
  | "foreign-tenant"

/**
 * The patterns that must never appear in a portable artifact.
 *
 * Each is a shape that is either a credential, a pointer into this platform's
 * vault, or a fact about another customer. They are checked over the SERIALISED
 * bundle rather than over the fields it was built from, so a value nested three
 * objects deep inside a configuration blob is checked exactly like a top-level
 * one.
 */
const PATTERNS: readonly { kind: LeakKind; re: RegExp; detail: string }[] = [
  {
    kind: "aws-access-key",
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    detail: "an AWS access key id",
  },
  {
    kind: "aws-arn",
    re: /\barn:aws[a-z-]*:[a-z0-9-]+:/,
    detail: "an AWS ARN, which names this estate's account and resource",
  },
  {
    kind: "secret-reference",
    re: /\b(?:secretsmanager|ssm):[\w/@.-]+/,
    detail: "a pointer into this platform's secret store",
  },
  {
    kind: "private-key",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    detail: "a private key block",
  },
  {
    kind: "aws-account-id",
    re: /(?<![\d-])\d{12}(?![\d-])/,
    detail: "a twelve-digit AWS account id",
  },
  {
    kind: "email-address",
    re: /[\w.+-]+@[\w-]+\.[\w.-]+/,
    detail: "an email address, which is personal data and does not belong in a portable artifact",
  },
]

/** Walk every string in a value, with the path that reached it. */
function* strings(value: unknown, path: string): Generator<{ at: string; text: string }> {
  if (typeof value === "string") {
    yield { at: path, text: value }
    return
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) yield* strings(entry, `${path}[${index}]`)
    return
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      yield* strings(entry, path === "" ? key : `${path}.${key}`)
    }
  }
}

/**
 * Everything in this bundle that must not be in one.
 *
 * `otherTenants` is the list of slugs this installation knows about MINUS the
 * bundle's own. A bundle that names another customer is a data-protection
 * incident wearing a JSON extension, and the check has to be given the list
 * because the bundle itself cannot know it.
 */
export function bundleLeaks(
  bundle: PortableBundle,
  otherTenants: readonly string[] = [],
): readonly Leak[] {
  const leaks: Leak[] = []
  const foreign = new Set(otherTenants.filter((slug) => slug !== bundle.slug))

  for (const { at, text } of strings(bundle, "")) {
    // `withheld` records what was REMOVED. Its reasons name the shapes on
    // purpose ("held a secret reference"), so scanning it would report the
    // redaction as the leak.
    if (at.startsWith("withheld")) continue
    for (const pattern of PATTERNS) {
      if (pattern.re.test(text)) {
        leaks.push({ at, kind: pattern.kind, detail: `${pattern.detail} at ${at}` })
      }
    }
    for (const slug of foreign) {
      if (new RegExp(`\\b${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) {
        leaks.push({
          at,
          kind: "foreign-tenant",
          detail: `names another tenant (${slug}) at ${at}`,
        })
      }
    }
  }
  return leaks
}

export class PortabilityRefused extends Error {
  readonly leaks: readonly Leak[]
  constructor(message: string, leaks: readonly Leak[]) {
    super(message)
    this.name = "PortabilityRefused"
    this.leaks = leaks
  }
}

export interface ExportInput {
  manifest: TenantManifest
  /** The configuration registry's definitions, for the sensitivity of each key. */
  definitions: readonly { key: string; sensitivity: Sensitivity }[]
  engineVersion: string
  /** Every other tenant slug this installation knows, for the foreign-tenant check. */
  otherTenants: readonly string[]
}

/**
 * The bundle, or a refusal.
 *
 * Throws `PortabilityRefused` rather than returning a partly-sanitised bundle.
 * A caller handed `{ bundle, leaks }` writes the file first and reads the
 * second field never; a throw cannot be ignored by accident.
 */
export function exportBundle(input: ExportInput): PortableBundle {
  const { manifest } = input
  const sensitivityOf = new Map(input.definitions.map((d) => [d.key, d.sensitivity]))
  const withheld: Withholding[] = []
  const configuration: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(manifest.configuration)) {
    const sensitivity = sensitivityOf.get(key)
    if (sensitivity === undefined) {
      withheld.push({
        field: `configuration.${key}`,
        reason: "no definition in the configuration registry — an unreviewable key is not a portable one",
      })
      continue
    }
    if (!PORTABLE_SENSITIVITIES.includes(sensitivity)) {
      withheld.push({
        field: `configuration.${key}`,
        reason: `declared ${sensitivity}; only ${PORTABLE_SENSITIVITIES.join(" and ")} values travel`,
      })
      continue
    }
    configuration[key] = value
  }

  const secretSlots = Object.keys(manifest.secretRefs).sort()
  for (const slot of secretSlots) {
    withheld.push({
      field: `secretRefs.${slot}`,
      reason: "the slot name travels and the pointer does not — a store reference maps this platform's vault",
    })
  }
  withheld.push({
    field: "initialAdminEmail",
    reason: "an email address is personal data; the importing installation names its own first administrator",
  })
  if (manifest.notes !== undefined) {
    withheld.push({
      field: "notes",
      reason: "free text is not reviewable against a definition, so it does not travel",
    })
  }

  const bundle: PortableBundle = {
    bundleVersion: BUNDLE_VERSION,
    manifestVersion: manifest.manifestVersion,
    engineVersion: input.engineVersion,
    slug: manifest.slug,
    displayName: manifest.displayName,
    legalName: manifest.legalName,
    blueprintId: manifest.blueprintId,
    ...(manifest.archetype ? { archetype: { ...manifest.archetype } } : {}),
    modules: [...manifest.modules].sort(),
    entitlements: [...manifest.entitlements].sort(),
    region: manifest.region,
    isolation: manifest.isolation,
    coexistence: manifest.coexistence,
    systemOfRecord: { ...manifest.systemOfRecord },
    configuration,
    secretSlots,
    withheld: withheld.sort((a, b) => a.field.localeCompare(b.field)),
  }

  const leaks = bundleLeaks(bundle, input.otherTenants)
  if (leaks.length > 0) {
    throw new PortabilityRefused(
      `Refusing to export ${manifest.slug}: ${leaks.length} thing(s) that must not leave this estate survived redaction. ` +
        leaks.map((l) => l.detail).join("; "),
      leaks,
    )
  }
  return bundle
}

export interface ImportProblem {
  field: string
  reason: string
  detail: string
}

export type ImportOutcome =
  | { ok: true; bundle: PortableBundle }
  | { ok: false; problems: readonly ImportProblem[] }

const REQUIRED_STRINGS = [
  "slug",
  "displayName",
  "legalName",
  "blueprintId",
  "region",
  "isolation",
  "coexistence",
] as const

/**
 * Read a bundle somebody handed us.
 *
 * Refuses an unknown format version, a missing field, and — the clause that
 * makes this more than a parser — a bundle that carries anything the export
 * rule forbids. A bundle produced elsewhere was sanitised by somebody else's
 * code, or by nobody's, and importing one that names an AWS account is how a
 * foreign estate's identifiers end up in this registry.
 */
export function importBundle(raw: unknown, otherTenants: readonly string[] = []): ImportOutcome {
  const problems: ImportProblem[] = []
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      problems: [{ field: "", reason: "not-an-object", detail: "A bundle is a JSON object." }],
    }
  }
  const candidate = raw as Record<string, unknown>

  if (candidate.bundleVersion !== BUNDLE_VERSION) {
    problems.push({
      field: "bundleVersion",
      reason: "unsupported-version",
      detail: `This engine reads bundle version ${BUNDLE_VERSION}; this one says ${String(candidate.bundleVersion)}.`,
    })
  }
  for (const field of REQUIRED_STRINGS) {
    if (typeof candidate[field] !== "string" || (candidate[field] as string).trim() === "") {
      problems.push({ field, reason: "missing", detail: `${field} is required and must be a non-empty string.` })
    }
  }
  for (const field of ["modules", "entitlements", "secretSlots"] as const) {
    if (!Array.isArray(candidate[field])) {
      problems.push({ field, reason: "missing", detail: `${field} is required and must be an array.` })
    }
  }
  if (candidate.configuration === null || typeof candidate.configuration !== "object") {
    problems.push({
      field: "configuration",
      reason: "missing",
      detail: "configuration is required and must be an object.",
    })
  }
  if (problems.length > 0) return { ok: false, problems }

  const bundle = { withheld: [], ...candidate } as unknown as PortableBundle
  const leaks = bundleLeaks(bundle, otherTenants)
  if (leaks.length > 0) {
    return {
      ok: false,
      problems: leaks.map((leak) => ({
        field: leak.at,
        reason: `leak:${leak.kind}`,
        detail: `Refusing to import: ${leak.detail}.`,
      })),
    }
  }
  return { ok: true, bundle }
}

/** The lines the panel renders, and the lines a test reads. */
export function bundleLines(bundle: PortableBundle): readonly string[] {
  return [
    `bundle v${bundle.bundleVersion} of ${bundle.slug}, manifest v${bundle.manifestVersion}, engine ${bundle.engineVersion}`,
    `carries ${bundle.modules.length} modules, ${Object.keys(bundle.configuration).length} configuration values, ${bundle.secretSlots.length} secret slot names`,
    ...bundle.withheld.map((w) => `withheld ${w.field} — ${w.reason}`),
  ]
}
