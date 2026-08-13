/**
 * STUDIO-080-001 / STUDIO-000-007 / STUDIO-000-009 — the functions this estate
 * runs, and whether AWS has already stopped supporting what they run on.
 *
 * A Lambda on a runtime AWS has end-of-lifed is a scheduled outage that nothing
 * in this platform could see. `lambda:ListFunctions` and
 * `lambda:GetFunctionConcurrency` were added to the capability registry and to
 * `client.ts`, and then nothing called them: the estate page reads ECS, RDS,
 * CloudFront and ACM, so every function in the account — its runtime, its
 * memory, its timeout, its reserved concurrency — was invisible from the console
 * that is supposed to be authoritative about the estate.
 *
 * Three facts about this module that are load-bearing rather than incidental.
 *
 * **A denial is UNKNOWN, and never a short list.** Every read returns
 * `AwsRead<T>` from `read.ts`, whose DENIED arm carries no `value` at all, so a
 * caller cannot render a refusal as "no functions". That distinction is the
 * whole reason this file is not four lines of `?? []`: an operator told "no
 * functions are on a dead runtime" when the truth is "we were not allowed to
 * look" will not look again.
 *
 * **The runtime calendar can only ever be pessimistic.** AWS publishes runtime
 * deprecation dates on a documentation page and exposes them through no API, so
 * the calendar below is a transcription with a date stamped on it. When the
 * stamp is older than `CALENDAR_MAX_AGE_MS`, the reassuring verdict — SUPPORTED
 * — is withdrawn and becomes UNKNOWN_STALE_CALENDAR, while DEPRECATED and
 * APPROACHING stand. The asymmetry is the point: a date in the past does not
 * move, and over-warning costs an operator a lookup, while under-warning is the
 * outage this file exists to prevent. A runtime the calendar has never heard of
 * is UNKNOWN_RUNTIME and is never assumed current.
 *
 * **Region and partition come from the resolved identity and from the ARNs the
 * API returned.** Not from a literal, not from an environment default. That is
 * GE-010-007: a console that prints one region while reading another is how a
 * residency breach is found by an audit instead of by the software.
 *
 * Nothing here declares a Lambda function to be expected or unmanaged. No
 * `aws_lambda_function` exists anywhere in `infrastructure/`, so an
 * expected-set comparison would be a claim this repository cannot support;
 * `drift.ts` owns that question and reads its expectation from the Terraform.
 */

import {
  CONTROL_PLANE_SCHEMA_VERSIONS,
  parseEstateResource,
  type EstateResource as PublishedResource,
} from "@tenure/contracts"

import { LAMBDA_TTL_MS } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import { parseArn, STATEFUL_RESOURCE_TYPES } from "./inventory"
import {
  describeRead,
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import { attributionOf, tagIndex, taggedResources, type Attribution, type TaggedResource } from "./tags"
import { backoffMs, READ_ATTEMPTS } from "./throttle"

/* ------------------------------------------------- the runtime calendar -- */

/**
 * Where these dates come from, printed beside every verdict derived from them.
 *
 * An operator must be able to check the claim without asking anybody, and a
 * verdict whose provenance is "somebody typed it into a file" is one nobody can
 * check.
 */
export const RUNTIME_CALENDAR_SOURCE =
  "https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html"

/**
 * The date this transcription was last checked against that page.
 *
 * Stamped rather than implied. Every SUPPORTED verdict is only as good as this
 * date, so the surface prints it and `calendarStaleness()` decides when it stops
 * being good enough at all.
 */
export const RUNTIME_CALENDAR_AS_OF = "2026-05-01"

/**
 * How long a transcription may be trusted to say "still supported".
 *
 * Ninety days is chosen against AWS's own behaviour: deprecations are announced
 * on the runtime page months ahead, so a calendar within a quarter of the page
 * will not have missed an announcement by more than the announcement's own
 * notice period. Past that the SUPPORTED verdict is withdrawn — not the whole
 * panel, only the reassuring half.
 */
export const CALENDAR_MAX_AGE_MS = 90 * 24 * 3_600_000

/**
 * How far ahead a deprecation is still worth calling out.
 *
 * Six months is a planning horizon rather than a warning threshold: moving a
 * function to a new runtime means a dependency upgrade, a test pass and a
 * deploy window, and a fortnight's notice is not enough to schedule that
 * against everything else.
 */
export const APPROACHING_HORIZON_DAYS = 180

const DAY_MS = 24 * 3_600_000

/**
 * Runtimes AWS has published a deprecation date for, as transcribed on
 * `RUNTIME_CALENDAR_AS_OF`.
 *
 * The date is AWS's "deprecation date" — the day it stops allowing a function to
 * be CREATED on the runtime — which is the earliest date at which a redeploy of
 * an existing function can fail. Using the later block-update date would tell an
 * operator they have longer than they do.
 *
 * Runtimes are absent rather than guessed. An absent runtime produces
 * UNKNOWN_RUNTIME, which reads as "check the page", not as "fine".
 */
export const RUNTIME_DEPRECATION_CALENDAR: Readonly<Record<string, string>> = {
  // Node.js
  "nodejs": "2016-10-31",
  "nodejs4.3": "2020-03-06",
  "nodejs4.3-edge": "2020-03-06",
  "nodejs6.10": "2019-08-12",
  "nodejs8.10": "2020-03-06",
  "nodejs10.x": "2023-07-30",
  "nodejs12.x": "2023-03-31",
  "nodejs14.x": "2023-12-04",
  "nodejs16.x": "2024-06-12",
  "nodejs18.x": "2025-09-01",
  // Python
  "python2.7": "2021-07-15",
  "python3.6": "2022-07-18",
  "python3.7": "2023-12-04",
  "python3.8": "2024-10-14",
  "python3.9": "2025-12-15",
  // Java
  "java8": "2024-01-08",
  // Ruby
  "ruby2.5": "2021-07-30",
  "ruby2.7": "2023-12-07",
  // .NET
  "dotnetcore2.1": "2022-01-05",
  "dotnetcore3.1": "2023-04-03",
  // Go and the original custom runtime, both on Amazon Linux 1
  "go1.x": "2023-12-31",
  "provided": "2023-12-31",
}

/**
 * Runtimes the page listed as supported with no announced deprecation date, as
 * of `RUNTIME_CALENDAR_AS_OF`.
 *
 * Separate from the calendar above because "supported, nothing announced" and
 * "supported until DATE" are different facts, and only the second can produce an
 * APPROACHING verdict. Membership here is what a SUPPORTED verdict rests on,
 * which is exactly why it expires with the stamp.
 */
export const RUNTIMES_WITH_NO_ANNOUNCED_DEPRECATION: ReadonlySet<string> = new Set([
  "nodejs20.x",
  "nodejs22.x",
  "python3.11",
  "python3.12",
  "python3.13",
  "java17",
  "java21",
  "dotnet8",
  "ruby3.3",
  "provided.al2023",
])

/** How old the transcription is, and whether it may still say "supported". */
export interface CalendarStaleness {
  asOf: string
  ageDays: number
  /** True once a SUPPORTED verdict stops being defensible from this stamp. */
  stale: boolean
  source: string
}

export function calendarStaleness(now: Date): CalendarStaleness {
  const stamped = Date.parse(`${RUNTIME_CALENDAR_AS_OF}T00:00:00.000Z`)
  const ageMs = now.getTime() - stamped
  return {
    asOf: RUNTIME_CALENDAR_AS_OF,
    ageDays: Math.floor(ageMs / DAY_MS),
    stale: ageMs > CALENDAR_MAX_AGE_MS,
    source: RUNTIME_CALENDAR_SOURCE,
  }
}

/**
 * What this engine can honestly say about one function's runtime.
 *
 * Six arms, three of which are forms of not knowing. There is deliberately no
 * boolean: `deprecated: false` would be returned for a runtime nobody has heard
 * of and for a container image alike, and both of those are questions rather
 * than answers.
 */
export type RuntimeSupport =
  /** AWS's date is in the past. The function may already be unredeployable. */
  | {
      status: "DEPRECATED"
      runtime: string
      deprecationDate: string
      daysSince: number
      source: string
      calendarAsOf: string
    }
  /** Inside the planning horizon. Still deployable, already a dated commitment. */
  | {
      status: "APPROACHING"
      runtime: string
      deprecationDate: string
      daysRemaining: number
      source: string
      calendarAsOf: string
    }
  /** Supported, and the calendar is recent enough for that to mean something. */
  | {
      status: "SUPPORTED"
      runtime: string
      /** Null when AWS has announced no date at all for it. */
      deprecationDate: string | null
      source: string
      calendarAsOf: string
    }
  /** Not in the transcription. Never assumed current. */
  | { status: "UNKNOWN_RUNTIME"; runtime: string; why: string; source: string; calendarAsOf: string }
  /** In the transcription as supported, but the transcription is too old to say so. */
  | {
      status: "UNKNOWN_STALE_CALENDAR"
      runtime: string
      why: string
      ageDays: number
      source: string
      calendarAsOf: string
    }
  /** A container image. AWS deprecates managed runtimes; this is not one. */
  | { status: "NOT_A_MANAGED_RUNTIME"; packageType: string; why: string }

/**
 * The verdict for one runtime, at one moment.
 *
 * `now` is a parameter rather than a call to the clock because the answer
 * changes with the date — that is the whole nature of a deprecation — and a
 * function that read the clock itself could not be asked what it will say next
 * quarter.
 */
export function runtimeSupportFor(
  runtime: string | null,
  packageType: string,
  now: Date,
): RuntimeSupport {
  const calendar = calendarStaleness(now)

  // A container-image function has no managed runtime. AWS does not deprecate
  // it — which is not the same as it being current, and saying so is the honest
  // form of "we cannot see inside your base image".
  if (!runtime) {
    return {
      status: "NOT_A_MANAGED_RUNTIME",
      packageType: packageType || "Image",
      why:
        "this function ships a container image, so AWS publishes no runtime deprecation date for it. " +
        "The base image's own end-of-life is the operator's to track; this console cannot read it.",
    }
  }

  const announced = RUNTIME_DEPRECATION_CALENDAR[runtime]
  if (announced) {
    const date = Date.parse(`${announced}T00:00:00.000Z`)
    const deltaDays = Math.floor((date - now.getTime()) / DAY_MS)
    if (deltaDays < 0) {
      return {
        status: "DEPRECATED",
        runtime,
        deprecationDate: announced,
        daysSince: -deltaDays,
        source: RUNTIME_CALENDAR_SOURCE,
        calendarAsOf: calendar.asOf,
      }
    }
    if (deltaDays <= APPROACHING_HORIZON_DAYS) {
      return {
        status: "APPROACHING",
        runtime,
        deprecationDate: announced,
        daysRemaining: deltaDays,
        source: RUNTIME_CALENDAR_SOURCE,
        calendarAsOf: calendar.asOf,
      }
    }
    // Dated, and the date is far away. This is still a "supported" claim, so it
    // expires with the transcription like every other one.
    if (calendar.stale) {
      return staleVerdict(runtime, calendar)
    }
    return {
      status: "SUPPORTED",
      runtime,
      deprecationDate: announced,
      source: RUNTIME_CALENDAR_SOURCE,
      calendarAsOf: calendar.asOf,
    }
  }

  if (RUNTIMES_WITH_NO_ANNOUNCED_DEPRECATION.has(runtime)) {
    if (calendar.stale) {
      return staleVerdict(runtime, calendar)
    }
    return {
      status: "SUPPORTED",
      runtime,
      deprecationDate: null,
      source: RUNTIME_CALENDAR_SOURCE,
      calendarAsOf: calendar.asOf,
    }
  }

  return {
    status: "UNKNOWN_RUNTIME",
    runtime,
    why:
      `${runtime} is not in this engine's transcription of AWS's runtime support page. ` +
      "It is not therefore supported — it is unchecked, and AWS publishes no API to check it against.",
    source: RUNTIME_CALENDAR_SOURCE,
    calendarAsOf: calendar.asOf,
  }
}

function staleVerdict(runtime: string, calendar: CalendarStaleness): RuntimeSupport {
  return {
    status: "UNKNOWN_STALE_CALENDAR",
    runtime,
    why:
      `this engine's transcription of AWS's runtime support page is ${calendar.ageDays} days old ` +
      `(stamped ${calendar.asOf}), which is past the ${Math.round(CALENDAR_MAX_AGE_MS / DAY_MS)}-day ` +
      "window in which it may be relied on to call a runtime supported. A deprecation announced since " +
      "then would not be in it.",
    ageDays: calendar.ageDays,
    source: RUNTIME_CALENDAR_SOURCE,
    calendarAsOf: calendar.asOf,
  }
}

/**
 * The sentence a surface prints for a runtime verdict.
 *
 * One renderer, for the reason `describeRead` is one renderer: a deprecated
 * runtime must not read as a warning on one page and as a dash on another. Each
 * arm produces text the others cannot — "end-of-lifed" appears only in
 * DEPRECATED, "unchecked" only in UNKNOWN_RUNTIME — so two states cannot be
 * mistaken for one another by a reader or by a test.
 */
export function describeRuntimeSupport(support: RuntimeSupport): string {
  switch (support.status) {
    case "DEPRECATED":
      return (
        `${support.runtime} was end-of-lifed by AWS on ${support.deprecationDate}, ` +
        `${support.daysSince} days ago — this function is a scheduled outage. Source: ${support.source}`
      )
    case "APPROACHING":
      return (
        `${support.runtime} is end-of-lifed by AWS on ${support.deprecationDate}, ` +
        `in ${support.daysRemaining} days. Source: ${support.source}`
      )
    case "SUPPORTED":
      return support.deprecationDate
        ? `${support.runtime} is supported until ${support.deprecationDate} (calendar checked ${support.calendarAsOf})`
        : `${support.runtime} is supported, with no deprecation announced as of ${support.calendarAsOf}`
    case "UNKNOWN_RUNTIME":
      return `unknown — ${support.why}`
    case "UNKNOWN_STALE_CALENDAR":
      return `unknown — ${support.why}`
    case "NOT_A_MANAGED_RUNTIME":
      return `not applicable — ${support.why}`
  }
}

/** Whether a verdict is one an operator has to do something about. */
export function isRuntimeRisk(support: RuntimeSupport): boolean {
  return support.status === "DEPRECATED" || support.status === "APPROACHING"
}

/** Whether a verdict is one this engine could not reach at all. */
export function isRuntimeUnknown(support: RuntimeSupport): boolean {
  return support.status === "UNKNOWN_RUNTIME" || support.status === "UNKNOWN_STALE_CALENDAR"
}

/* ------------------------------------------------------- attribution -- */

/**
 * Who a function belongs to — or the fact that this engine could not find out.
 *
 * `attributionOf({})` returns `unattributed`, which MEANS "nobody tagged this".
 * Feeding it an empty tag index because `tag:GetResources` was refused would
 * therefore report every function in the account as untagged: a specific,
 * actionable, false finding, produced by a call nobody was allowed to make. It
 * is the STUDIO-000-007 defect wearing a compliance report's clothes.
 *
 * So the tag read's own state travels with the attribution. `known: false` is
 * not a fourth kind of attribution — it is the absence of one, and a caller has
 * to narrow past it before it can name a tenant.
 *
 * The three known arms are `@tenure/provisioning`'s decision, unchanged:
 * `tenure:tenant = tenure:shared` is somebody DECIDING a resource is platform
 * overhead, and no tag at all is nobody having looked. Folding the second into
 * the first — "no tenant tag means shared" — is how an untagged function's cost
 * is spread across every customer's bill.
 */
export type FunctionAttribution =
  | { known: true; attribution: Attribution }
  | { known: false; why: string }

/** The sentence a surface prints for one function's attribution. */
export function describeFunctionAttribution(attribution: FunctionAttribution): string {
  if (!attribution.known) return `unknown — ${attribution.why}`
  switch (attribution.attribution.kind) {
    case "tenant":
      return attribution.attribution.tenantSlug
    case "shared":
      return "shared — platform overhead, decided by tag"
    case "unattributed":
      return "unattributable — missing tenure:tenant"
  }
}

/** The tenant slug, or null — and null ONLY when the tags were actually read. */
export function tenantSlugOf(attribution: FunctionAttribution): string | null {
  if (!attribution.known) return null
  return attribution.attribution.kind === "tenant" ? attribution.attribution.tenantSlug : null
}

/* ---------------------------------------------------------------- shapes -- */

/**
 * One function, as this engine can honestly describe it.
 *
 * `reservedConcurrency` is an `AwsRead`, not a number-or-null, and that is the
 * single most important line in this file after the runtime calendar. Lambda
 * reports no reservation by returning a response with the field absent, so
 * "this function shares the account's pool" and "we were refused
 * GetFunctionConcurrency" arrive as the same shape from the SDK and must not
 * arrive as the same shape here. EMPTY is the first; DENIED is the second; and
 * a caller that reaches for a number without narrowing does not compile.
 */
export interface LambdaFunctionReading {
  arn: string
  name: string
  /** Null for a container-image function, which has no managed runtime. */
  runtime: string | null
  packageType: string
  memoryMb: number | null
  timeoutSeconds: number | null
  codeSizeBytes: number | null
  architectures: readonly string[]
  /** Normalised to UTC ISO 8601. Null when Lambda's own stamp did not parse. */
  lastModified: string | null
  /** Exactly what the API returned, kept so a null above is checkable. */
  lastModifiedRaw: string | null
  daysSinceLastModified: number | null
  /** From the function's own ARN. Never a literal, never an environment default. */
  region: string
  accountId: string
  partition: string
  /** Empty when the tag index itself could not be read — see `attribution`. */
  tags: Readonly<Record<string, string>>
  attribution: FunctionAttribution
  runtimeSupport: RuntimeSupport
  /** ACTUAL n · EMPTY (shares the account pool) · DENIED · THROTTLED. */
  reservedConcurrency: AwsRead<number>
  asOf: string
  /** The same function in the published, versioned estate shape. */
  contract: PublishedResource
}

/** Lambda's own response shapes, declared rather than imported — see client.ts. */
interface ListFunctionsResponse {
  Functions?: Array<{
    FunctionArn?: string
    FunctionName?: string
    Runtime?: string
    PackageType?: string
    MemorySize?: number
    Timeout?: number
    CodeSize?: number
    Architectures?: string[]
    LastModified?: string
  }>
  NextMarker?: string
}

interface GetFunctionConcurrencyResponse {
  ReservedConcurrentExecutions?: number
}

/**
 * How many pages of functions to walk. Fifty per page, so a thousand functions.
 *
 * Bounded because a page loop that never ends is an outage in the console rather
 * than in the estate.
 */
const MAX_PAGES = 20

/**
 * How many functions get their reserved concurrency read.
 *
 * `GetFunctionConcurrency` is per function — there is no bulk form — so this is
 * an N+1 against an account-wide throttle shared with every deploy. The budget
 * caps the blast radius; functions past it are not silently reported as
 * unreserved, they carry UNCONFIGURED naming the budget, because "we did not
 * ask" is not "there is no reservation".
 */
export const CONCURRENCY_READ_BUDGET = 100

/** How many concurrency reads are in flight at once. Small, to avoid self-throttling. */
const CONCURRENCY_BATCH = 5

interface ReadContext {
  now: () => Date
  denial: DenialContext
  tags: Map<string, Readonly<Record<string, string>>>
  /**
   * Why no attribution can be decided, or null when the tag index was read.
   *
   * A string rather than a boolean because it is rendered: an operator seeing
   * "unknown" needs to be told it was `tag:GetResources` that was refused, not
   * left to guess which of the two calls failed.
   */
  tagsUnavailable: string | null
  sleep?: (ms: number) => Promise<void>
}

/** The retry schedule, taken from throttle.ts rather than re-invented here. */
function throttleOptions(ctx: ReadContext) {
  return {
    now: ctx.now,
    denial: ctx.denial,
    attempts: READ_ATTEMPTS,
    // `backoffMs(2)` is the pause after the first failure; `readAws` doubles it
    // from there, which reproduces throttle.ts's schedule exactly. Two backoff
    // curves for one console is two answers to "how long until it tries again".
    backoffMs: backoffMs(2),
    sleep: ctx.sleep,
  }
}

/**
 * Lambda's `LastModified`, as UTC ISO 8601, or null.
 *
 * The API returns `2026-05-01T12:00:00.000+0000` — an offset without the colon
 * ES2020 requires, which some engines parse by falling back to a legacy path and
 * some do not. Normalising first makes the answer the same on every platform,
 * which matters because this string is compared and rendered.
 */
export function normaliseLastModified(raw: string | null | undefined): string | null {
  if (!raw) return null
  const withColon = raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")
  const parsed = Date.parse(withColon)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toISOString()
}

/* ----------------------------------------------------------- the reads -- */

async function readReservedConcurrency(
  gw: AwsGateway,
  functionName: string,
  ctx: ReadContext,
): Promise<AwsRead<number>> {
  return readAws<number>(
    "lambda:GetFunctionConcurrency",
    async () => {
      const response = (await gw.call("lambda:GetFunctionConcurrency", {
        FunctionName: functionName,
      })) as GetFunctionConcurrencyResponse
      const reserved = response?.ReservedConcurrentExecutions
      // Null, not zero. A reservation of ZERO is a function AWS will refuse to
      // invoke at all — the loudest thing this read can find — and folding it
      // into "no reservation" would hide it behind the most common case.
      //
      // The cast is at the one point the value is known-absent: `isEmpty` below
      // turns exactly this null into EMPTY, so it never reaches an ACTUAL arm
      // and no caller can receive it as a number.
      return (typeof reserved === "number" ? reserved : null) as number
    },
    {
      ...throttleOptions(ctx),
      // Only an absent reservation is EMPTY. `0` is a decision somebody made.
      isEmpty: (value) => value === null,
    },
  )
}

/**
 * The one read of the estate's functions.
 *
 * Wrapped in `readAws`, which is what makes a refusal DENIED rather than a short
 * list: there is deliberately no try/catch in the body, so nothing here can turn
 * a thrown AccessDenied into `[]`.
 */
async function readFunctions(
  gw: AwsGateway,
  ctx: ReadContext,
): Promise<AwsRead<readonly LambdaFunctionReading[]>> {
  return readAws<readonly LambdaFunctionReading[]>(
    "lambda:ListFunctions",
    async () => {
      const listed: Array<NonNullable<ListFunctionsResponse["Functions"]>[number]> = []
      let marker: string | undefined
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = (await gw.call("lambda:ListFunctions", {
          Marker: marker,
        })) as ListFunctionsResponse
        for (const fn of response?.Functions ?? []) {
          if (fn?.FunctionArn) listed.push(fn)
        }
        marker = response?.NextMarker || undefined
        if (!marker) break
      }

      // Reserved concurrency, in small batches, up to the budget. Sequential
      // batches rather than one Promise.all over everything: a hundred parallel
      // calls to an account-wide API is how a console throttles its own deploy
      // pipeline.
      const concurrency = new Map<string, AwsRead<number>>()
      const budgeted = listed.slice(0, CONCURRENCY_READ_BUDGET)
      for (let i = 0; i < budgeted.length; i += CONCURRENCY_BATCH) {
        const batch = budgeted.slice(i, i + CONCURRENCY_BATCH)
        const reads = await Promise.all(
          batch.map((fn) => readReservedConcurrency(gw, fn.FunctionName ?? fn.FunctionArn!, ctx)),
        )
        batch.forEach((fn, j) => concurrency.set(fn.FunctionArn!, reads[j]))
      }

      const now = ctx.now()
      const asOf = now.toISOString()
      return listed.map((fn) => {
        const arn = fn.FunctionArn!
        const parsed = parseArn(arn)
        const name = fn.FunctionName || arn
        const tags = ctx.tags.get(arn) ?? {}
        const attribution: FunctionAttribution = ctx.tagsUnavailable
          ? { known: false, why: ctx.tagsUnavailable }
          : { known: true, attribution: attributionOf(tags) }
        const lastModified = normaliseLastModified(fn.LastModified)
        const runtime = fn.Runtime ?? null
        const packageType = fn.PackageType ?? (runtime ? "Zip" : "Image")

        return {
          arn,
          name,
          runtime,
          packageType,
          memoryMb: typeof fn.MemorySize === "number" ? fn.MemorySize : null,
          timeoutSeconds: typeof fn.Timeout === "number" ? fn.Timeout : null,
          codeSizeBytes: typeof fn.CodeSize === "number" ? fn.CodeSize : null,
          architectures: fn.Architectures ?? [],
          lastModified,
          lastModifiedRaw: fn.LastModified ?? null,
          daysSinceLastModified: lastModified
            ? Math.floor((now.getTime() - Date.parse(lastModified)) / DAY_MS)
            : null,
          region: parsed?.region ?? "",
          accountId: parsed?.accountId ?? "",
          partition: parsed?.partition ?? "",
          tags,
          attribution,
          runtimeSupport: runtimeSupportFor(runtime, packageType, now),
          reservedConcurrency:
            concurrency.get(arn) ??
            {
              state: "UNCONFIGURED",
              capability: "lambda:GetFunctionConcurrency",
              why:
                `reserved concurrency was not read for this function: this page reads it for the ` +
                `first ${CONCURRENCY_READ_BUDGET} functions and this account returned more. ` +
                "Not read is not unreserved.",
            },
          asOf,
          // Parsed, not asserted. A malformed mapping throws inside `readAws`
          // and the surface becomes ERROR rather than rendering a function an
          // operator would then act on.
          contract: parseEstateResource({
            schemaVersion: CONTROL_PLANE_SCHEMA_VERSIONS.EstateResource,
            arn,
            service: "lambda",
            resourceType: "function",
            name,
            accountId: parsed?.accountId ?? "",
            region: parsed?.region ?? "",
            partition: parsed?.partition ?? "",
            // The published contract has no "unknown" for a tenant: its
            // `tenantId: null` means "carries no tenant tag". When the tag index
            // could not be read that is not something this engine knows, so a
            // surface must read `attribution` — which does carry the third
            // state — rather than `contract.tenantId`. Said here because the
            // contract is shared and cannot be widened from this file.
            tenantId: tenantSlugOf(attribution),
            cell: tags["tenure:cell"] ?? null,
            environment: tags["tenure:environment"] ?? null,
            // A function holds no data that survives it. Deleting one and
            // putting it back is a deploy, which is what `stateful` means.
            stateful: STATEFUL_RESOURCE_TYPES.has("lambda:function"),
            tags,
            observedAt: asOf,
          }),
        }
      })
    },
    throttleOptions(ctx),
  )
}

/* ------------------------------------------------------- the whole load -- */

export interface LambdaReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  functions: AwsRead<readonly LambdaFunctionReading[]>
  /** When this load was performed. Explicit, so a surface cannot imply "now". */
  asOf: string
  /** This capability's own cadence, from the registry — not a page-wide number. */
  refreshMs: number
  /** The moment after which this reading should not be shown without re-reading. */
  staleAfter: string
  /** The region the reads were actually issued against, from the resolved identity. */
  region: string | null
  /** The partition, from the resolved identity's ARN. Never assumed to be `aws`. */
  partition: string | null
  calendar: CalendarStaleness
}

/**
 * The Lambda surface's whole data load, in one call.
 *
 * A route calls this with no arguments; a test calls it with a stand-in gateway.
 * Deliberately the same function — a test that drove a helper the route does not
 * call would stay green the day the route stopped calling it.
 */
export async function lambdaInventory(
  supplied?: AwsGateway,
  options: { now?: () => Date; sleep?: (ms: number) => Promise<void> } = {},
): Promise<LambdaReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)

  const tagged = await taggedResources(supplied, { now, denial })
  const ctx: ReadContext = {
    now,
    denial,
    tags: tagIndex(
      tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
    ),
    // A DENIED tag read must not quietly become "no tags": an empty index makes
    // `attributionOf` answer "unattributed" for every function, which is a
    // finding — one an operator would act on — invented out of a refusal.
    // EMPTY is different and is a real answer: the tagging API looked and found
    // nothing tagged, so "unattributable" is then true.
    tagsUnavailable:
      tagged.state === "ACTUAL" || tagged.state === "EMPTY" || tagged.state === "STALE"
        ? null
        : describeRead(tagged, "the tag index"),
    sleep: options.sleep,
  }

  const functions = await readFunctions(gw, ctx)
  const at = now()

  return {
    identity,
    tagged,
    functions,
    asOf: at.toISOString(),
    refreshMs: LAMBDA_TTL_MS,
    staleAfter: new Date(at.getTime() + LAMBDA_TTL_MS).toISOString(),
    region: identity.state === "ACTUAL" ? identity.value.region : null,
    partition: identity.state === "ACTUAL" ? identity.value.partition : null,
    calendar: calendarStaleness(at),
  }
}

/* ------------------------------------------------------------ renderers -- */

export interface LambdaLine {
  surface: string
  /** The rendered sentence. One funnel, so DENIED cannot be worded as absence. */
  text: string
  read: AwsRead<readonly LambdaFunctionReading[]>
}

/**
 * The functions line: what was read, and how much of it there is.
 *
 * The count is inside the ACTUAL arm and cannot escape it. A count computed from
 * `itemsOf()` outside the switch would print "0 functions" for a denial, which
 * is the STUDIO-000-007 defect with a number attached.
 */
export function lambdaFunctionsLine(read: AwsRead<readonly LambdaFunctionReading[]>): string {
  if (read.state === "ACTUAL" || read.state === "STALE") {
    return `${describeRead(read, "Lambda functions read from AWS")} — ${read.value.length} function(s)`
  }
  return describeRead(read, "Lambda functions read from AWS")
}

/**
 * The runtime-risk line.
 *
 * Anything other than a completed read produces "unknown" and NO count. An
 * operator who reads "0 functions on an end-of-lifed runtime" under a denied
 * ListFunctions has been told the estate is safe by a console that never looked.
 */
export function runtimeRiskLine(
  read: AwsRead<readonly LambdaFunctionReading[]>,
  calendar: CalendarStaleness,
): string {
  // EMPTY is an ANSWER — the account has no functions — and is the one non-ACTUAL
  // state that may say something reassuring, because a completed call said it.
  // Every other one is a question, and answers "unknown".
  if (read.state === "EMPTY") {
    return `no functions to check against the runtime calendar (${stampOf(calendar)})`
  }
  if (read.state !== "ACTUAL" && read.state !== "STALE") {
    return (
      "unknown — the runtime calendar could not be applied to this estate, because the function " +
      `list itself is not available: ${describeRead(read, "lambda:ListFunctions")}`
    )
  }
  const deprecated = read.value.filter((f) => f.runtimeSupport.status === "DEPRECATED")
  const approaching = read.value.filter((f) => f.runtimeSupport.status === "APPROACHING")
  const unchecked = read.value.filter((f) => isRuntimeUnknown(f.runtimeSupport))
  if (read.value.length === 0) {
    return `no functions to check against the runtime calendar (${stampOf(calendar)})`
  }
  return (
    `${deprecated.length} function(s) on a runtime AWS has already end-of-lifed, ` +
    `${approaching.length} within ${APPROACHING_HORIZON_DAYS} days of one, ` +
    `${unchecked.length} unchecked (${stampOf(calendar)})`
  )
}

/**
 * How old the calendar is, in words.
 *
 * A negative age is a clock, not a calendar: an ECS task whose time is wrong
 * would otherwise print "checked -334 days ago", which reads as a typo rather
 * than as the real problem it is.
 */
function stampOf(calendar: CalendarStaleness): string {
  return calendar.ageDays >= 0
    ? `calendar checked ${calendar.asOf}, ${calendar.ageDays} days ago`
    : `calendar stamped ${calendar.asOf}, which is ahead of this engine's clock`
}

/**
 * The sentence for one function's reserved concurrency.
 *
 * Four different answers for four different facts. The one that matters is the
 * third: a refusal says "unknown" and names the action, where an absent
 * reservation says the function shares the account pool — which is a claim about
 * how it will behave under load, and must never be printed off a call nobody was
 * allowed to make.
 */
export function describeReservedConcurrency(read: AwsRead<number>): string {
  switch (read.state) {
    case "ACTUAL":
    case "STALE":
      return read.value === 0
        ? "reserved concurrency 0 — this function is throttled to zero and cannot be invoked at all"
        : `reserved concurrency ${read.value}, held out of the account pool`
    case "EMPTY":
      return "no reservation — shares the account's unreserved concurrency pool"
    default:
      return describeRead(read, "reserved concurrency")
  }
}

/**
 * The attribution line.
 *
 * Three counts when the tag index was read, and one sentence naming the refused
 * call when it was not. "0 unattributable functions" off a denied
 * `tag:GetResources` would be a clean bill of health issued by a call that never
 * happened — and unlike a missing row, somebody would file it.
 */
export function attributionLine(readings: LambdaReadings): string {
  const read = readings.functions
  // As in `runtimeRiskLine`: EMPTY is the one completed answer among the
  // non-ACTUAL states, and is allowed to say there is nothing to attribute.
  if (read.state === "EMPTY") return "no functions to attribute"
  if (read.state !== "ACTUAL" && read.state !== "STALE") {
    return `unknown — ${describeRead(read, "lambda:ListFunctions")}`
  }
  const unknown = read.value.filter((f) => !f.attribution.known)
  if (unknown.length > 0) {
    return (
      `unknown for ${unknown.length} of ${read.value.length} function(s) — ` +
      describeRead(readings.tagged, "the tag index")
    )
  }
  const kinds = read.value.map((f) => (f.attribution.known ? f.attribution.attribution.kind : null))
  return (
    `${kinds.filter((k) => k === "tenant").length} attributed to a tenant, ` +
    `${kinds.filter((k) => k === "shared").length} shared by decision, ` +
    `${kinds.filter((k) => k === "unattributed").length} unattributable`
  )
}

/** Every line the Lambda surface prints, in the order it prints them. */
export function lambdaLines(readings: LambdaReadings): readonly LambdaLine[] {
  return [
    { surface: "Functions", text: lambdaFunctionsLine(readings.functions), read: readings.functions },
    {
      surface: "Runtime support",
      text: runtimeRiskLine(readings.functions, readings.calendar),
      read: readings.functions,
    },
    { surface: "Tenant attribution", text: attributionLine(readings), read: readings.functions },
  ]
}

/** The band above the table: what was read, where, when, and how often. */
export function lambdaHeadline(readings: LambdaReadings): string {
  const where =
    readings.region && readings.partition
      ? `region ${readings.region}, partition ${readings.partition}`
      : "region and partition unknown — sts:GetCallerIdentity has not answered, so this reading " +
        "cannot say which estate it describes"
  return (
    `Lambda in ${where} — as of ${readings.asOf}, re-read every ${Math.round(readings.refreshMs / 1000)}s ` +
    `(stale after ${readings.staleAfter})`
  )
}

/**
 * Functions whose ARN does not agree with the identity the reads were made as.
 *
 * `ListFunctions` is regional, so a disagreement means the SDK resolved one
 * region and the API answered about another — or the identity is from a
 * different partition entirely. Either is a residency question, which is the
 * class of defect GE-010-007 is, and it is reported rather than normalised away.
 */
export function residencyAnomalies(
  readings: LambdaReadings,
): readonly { arn: string; detail: string }[] {
  if (readings.functions.state !== "ACTUAL" && readings.functions.state !== "STALE") return []
  if (!readings.region || !readings.partition) return []
  const out: { arn: string; detail: string }[] = []
  for (const fn of readings.functions.value) {
    if (fn.region && fn.region !== readings.region) {
      out.push({
        arn: fn.arn,
        detail: `ARN names region ${fn.region}; this engine resolved ${readings.region}`,
      })
      continue
    }
    if (fn.partition && fn.partition !== readings.partition) {
      out.push({
        arn: fn.arn,
        detail: `ARN names partition ${fn.partition}; this engine resolved ${readings.partition}`,
      })
    }
  }
  return out
}

/** The functions an operator has to act on, worst first. Empty only after a real read. */
export function runtimeRisks(
  read: AwsRead<readonly LambdaFunctionReading[]>,
): readonly LambdaFunctionReading[] {
  if (read.state !== "ACTUAL" && read.state !== "STALE") return []
  const rank = (f: LambdaFunctionReading) =>
    f.runtimeSupport.status === "DEPRECATED" ? 0 : f.runtimeSupport.status === "APPROACHING" ? 1 : 2
  return read.value
    .filter((f) => isRuntimeRisk(f.runtimeSupport))
    .slice()
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

export { LAMBDA_TTL_MS }
