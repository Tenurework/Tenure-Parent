import type { Partition } from "@/lib/cell-context"
import { serviceAvailableIn, type ServiceId } from "@/lib/partition-services"
import type { UntrustedItem } from "@/lib/relay/untrusted-content"
import {
  citationLabel,
  isAnswerable,
  type ProjectedState,
  type SourceCitation,
} from "@/lib/relay/citation"

/**
 * WRK-010-003 — how much of a source may be projected, decided per source kind.
 *
 * Bible §3.4 requires three data modes per capability/object/container and says
 * to "default to the least-retentive mode that satisfies the use case". Before
 * this file, `grep -rn 'REFERENCE_ONLY|SEARCH_PROJECTION|GOVERNED_REPLICA' apps
 * packages tools tests` returned nothing outside the Bible, and the one
 * projection this platform actually builds — `loadSearchCorpus` — flattened
 * five very different sources into `SearchDoc` and gave every one of them a
 * full `body`. A memory card's free text left the process on exactly the same
 * terms as a club's public description, and both were posted to a third-party
 * model vendor by `/api/ai/chat` and `/search`.
 *
 * ## This is not the question `authorizeRetrieved` answers
 *
 * `search.ts` already has real privacy machinery: `SENSITIVITY_LEVELS`,
 * `sensitivityRank`, `authorizeRetrieved`. All of it decides **who** may see a
 * row. None of it decides **how much of that row** may be copied into an index
 * or shipped to a vendor. They are different questions and only the first was
 * being asked — a president cleared to read a restricted memory card was, by
 * the same act, sending its full text to `api.anthropic.com`.
 *
 * ## The modes, and what each kind gets
 *
 * `REFERENCE_ONLY` is the default here and it is the one that costs something:
 * a memory card contributes its title, its club, its link and nothing else, so
 * it can still be found and cited but its text never enters the corpus, never
 * reaches ranking, and never reaches the vendor. That is §3.4's worked example
 * ("a meeting title may be indexed while its recording is reference-only") and
 * it is deliberately the *less useful* choice, because the Bible says to start
 * from the least-retentive mode a tenant can then opt up from, not from the
 * most useful one somebody can later argue down.
 *
 * The four description-shaped kinds are `SEARCH_PROJECTION`: a document's
 * caption, an approval's description, an event's blurb and a club's
 * description are written to be read by the club, and indexing them is the
 * approved-field case §3.4 names. Note what is *not* projected even here — a
 * `Document`'s stored file is never in the corpus at all; only the caption is.
 *
 * No kind maps to `GOVERNED_REPLICA`. It is declared, and `modelSourceFor`
 * handles it, because it is one of the three names §3.4 fixes and re-inventing
 * it later under a different name is how a vocabulary rots. What would justify
 * it is a retained, approved copy of a source held for a defined legal or
 * continuity purpose — a countersigned contract kept after the club's Drive
 * folder is gone. Nothing in this corpus retains anything: `loadSearchCorpus`
 * reads live rows on every request. Saying so here is more honest than omitting
 * the mode and pretending the question never came up.
 *
 * ## Callers
 *
 * `apps/web/src/lib/search-data.ts` stamps `mode` on every doc it builds and
 * drops the body of a `REFERENCE_ONLY` one there, so the text is not in the
 * corpus at all rather than merely unprinted. `apps/web/src/app/api/ai/chat/
 * route.ts` and `synthesizeAnswer` in `apps/web/src/lib/ai.ts` re-decide it at
 * the boundary through `modelSourceFor`, because a corpus loader that forgets
 * must not be the only thing standing between a private body and a vendor.
 */

/** The three §3.4 modes, in order of increasing retention. */
export const PROJECTION_MODES = [
  "REFERENCE_ONLY",
  "SEARCH_PROJECTION",
  "GOVERNED_REPLICA",
] as const

export type ProjectionMode = (typeof PROJECTION_MODES)[number]

/** Every source kind `loadSearchCorpus` produces. */
export type ProjectedKind = "memory" | "document" | "approval" | "event" | "organization"

/**
 * The mode for each kind, stated exhaustively.
 *
 * A `Record` rather than a `switch` with a default, so adding a sixth kind to
 * `ProjectedKind` is a compile error here instead of an unstated policy that
 * silently inherits somebody else's.
 */
const MODE_BY_KIND: Record<ProjectedKind, ProjectionMode> = {
  // Free-form institutional-memory card text: the corpus's most guarded
  // content (role-scoped via `roleId`, classified via `sensitivity`, gated by
  // `canSeeMemoryCard`'s handoff window) and the only kind whose body is a
  // person's own words rather than a description of a thing.
  memory: "REFERENCE_ONLY",
  // A caption the uploader wrote about a file. The file itself is never here.
  document: "SEARCH_PROJECTION",
  approval: "SEARCH_PROJECTION",
  event: "SEARCH_PROJECTION",
  organization: "SEARCH_PROJECTION",
}

// ── WRK-070-001: the same question, asked of the tenant's residency ─────────

/**
 * Where the tenant whose rows these are is allowed to have them processed.
 *
 * `CellContext` satisfies this structurally, which is deliberate: the partition
 * and the region a projection is decided against must be the ones the PROCESS
 * is running in, not a pair somebody passed. `cellContext()` is the only
 * production producer of this value.
 */
export interface ProjectionResidency {
  partition: Partition
  region: string
}

/**
 * The service a projected BODY would ultimately be shipped to.
 *
 * Read through `serviceAvailableIn` (`partition-services.ts`) rather than
 * restated here, so the System Studio's availability matrix and this request
 * path cannot disagree about whether a cell can reach the vendor. A second list
 * would be a second answer, and the one that drifts is whichever nobody looks at.
 */
const VENDOR_SERVICE: ServiceId = "anthropic-public-api"

/**
 * The partition a region name belongs to, or null when this build cannot say.
 *
 * `us-gov-west-1` is GovCloud, `cn-north-1` is China, everything else that looks
 * like a region name is commercial. This exists because `AWS_PARTITION` and
 * `AWS_REGION` are two environment variables and nothing has ever checked that
 * they describe the same place: a cell claiming `AWS_PARTITION=aws` while
 * running in `us-gov-west-1` would otherwise be handed the commercial answer.
 */
function partitionOfRegion(region: string): Partition | null {
  if (/^cn-[a-z]+-\d$/.test(region)) return "aws-cn"
  if (/^[a-z]{2}-gov-[a-z]+-\d$/.test(region)) return "aws-us-gov"
  if (/^[a-z]{2}-[a-z]+-\d$/.test(region)) return "aws"
  return null
}

/**
 * The MOST a projection may retain for a tenant whose data lives here.
 *
 * Two reasons to cap at `REFERENCE_ONLY`, and both are residency failures
 * rather than policy preferences:
 *
 *   1. **The vendor is not in this partition.** `lib/ai.ts` already refuses to
 *      INVOKE a model from a partition that does not offer the endpoint
 *      (GE-010-007) — but nothing capped the CORPUS, so a GovCloud cell built
 *      full-retention search projections of tenant bodies and held them in
 *      memory ready to post. The model gate and the corpus gate now read the
 *      same matrix.
 *   2. **The region and the partition disagree.** A residency record that
 *      contradicts itself is not one anything may rely on, so it gets the
 *      least-retentive answer rather than the commercial one.
 *
 * `GOVERNED_REPLICA` is the uncapped answer because it is the most retentive
 * mode: this function states a ceiling, and `projectionModeFor` takes the lower
 * of the ceiling and the kind's own declared mode.
 */
export function residencyCeiling(residency: ProjectionResidency): ProjectionMode {
  if (partitionOfRegion(residency.region) !== residency.partition) return "REFERENCE_ONLY"
  return serviceAvailableIn(VENDOR_SERVICE, residency.partition)
    ? "GOVERNED_REPLICA"
    : "REFERENCE_ONLY"
}

/** The less retentive of two modes, by `PROJECTION_MODES`' own ordering. */
function capAt(mode: ProjectionMode, ceiling: ProjectionMode): ProjectionMode {
  return PROJECTION_MODES.indexOf(mode) <= PROJECTION_MODES.indexOf(ceiling) ? mode : ceiling
}

/**
 * The mode for a source kind, for a tenant whose data lives in this partition
 * and region.
 *
 * `residency` is REQUIRED and not defaulted. An optional residency argument
 * compiles at every existing call site, passes every unit test that builds its
 * own fixture, and is wrong only in production — which is the exact failure this
 * codebase has recorded twice (`requiresEngine` and `dependsOn`). Making it
 * required is what makes `tsc` enumerate the callers: the five reads in
 * `search-data.ts`, and the fixtures in `projection-policy.test.ts`.
 */
export function projectionModeFor(
  kind: ProjectedKind,
  residency: ProjectionResidency,
): ProjectionMode {
  return capAt(MODE_BY_KIND[kind], residencyCeiling(residency))
}

/**
 * Read a mode off a value that came from somewhere this module does not own.
 *
 * Fails closed, matching `sensitivityRank`'s convention two files away: an
 * absent or unrecognised mode is `REFERENCE_ONLY`, so the failure mode of a
 * corpus builder that forgot to stamp one is that a body is withheld, not that
 * it is shipped. `SearchDoc.mode` is required and `tsc` enforces it, but the
 * boundary this guards is a runtime one — a test double, a cached payload, or a
 * future loader — and `tsc` does not stand at runtime boundaries.
 */
export function projectionModeOf(value: unknown): ProjectionMode {
  return (PROJECTION_MODES as readonly string[]).includes(value as string)
    ? (value as ProjectionMode)
    : "REFERENCE_ONLY"
}

/**
 * The body a corpus row may retain, given its mode.
 *
 * Called by `loadSearchCorpus` at the moment each `SearchDoc` is built, which
 * is why a `REFERENCE_ONLY` body is absent from ranking, from `/api/search`'s
 * snippets and from the model prompt without any of those three having to know
 * the rule.
 */
export function retainedBody(mode: ProjectionMode, body: string): string {
  return projectionModeOf(mode) === "REFERENCE_ONLY" ? "" : body
}

/** What `modelSourceFor` needs. `ScoredDoc` and `SearchDoc` both satisfy it. */
export interface ProjectedDoc {
  kind: ProjectedKind
  title: string
  context: string
  href: string
  body: string
  mode: ProjectionMode
  /**
   * WRK-010-005 / WRK-070-003. The lifecycle state and the §9.3 citation.
   *
   * Required, so `tsc` enumerates every construction site the way it did for
   * `mode`. Both are read below: the state decides whether any text crosses at
   * all, and the citation is what the model is shown so it cannot present a
   * STALE source as current.
   */
  state: ProjectedState
  citation: SourceCitation
}

/** Shown in place of a body that policy does not project. Platform-authored. */
export const REFERENCE_ONLY_NOTE =
  "(reference only: this source's text is not projected to the model. Cite it by " +
  "title and link, and say that its contents must be opened directly.)"

/**
 * Shown in place of a body that the object's STATE does not project.
 *
 * A different sentence from `REFERENCE_ONLY_NOTE` and deliberately so: "policy
 * does not copy this kind of text" and "this object is gone, or unsafe, or no
 * longer reachable" are different facts with different consequences for the
 * answer, and one note for both would tell the model something false about one
 * of them. Platform-authored, never tenant data.
 */
export function stateWithheldNote(state: ProjectedState): string {
  const because: Record<string, string> = {
    TOMBSTONED: "the source reports this object as deleted",
    QUARANTINED: "this record's text carried active content and is being held",
    ACCESS_LOST: "access to the source of this object has been lost",
    CONFLICTED: "this object disagrees with its source and has not been reconciled",
  }
  return (
    `(withheld: ${because[state] ?? "this object is not in an answerable state"}. ` +
    `State is ${state}. Do not answer as though this source is current — cite it only to say ` +
    `that it exists in this state, and tell the reader to open it directly.)`
  )
}

/**
 * One retrieved doc, reduced to what may cross the model boundary.
 *
 * Returns the shape `fenceUntrusted` consumes, so the three §9.4/§3.4/§9.3
 * decisions — *how much* text, *how* it is fenced, and *what the source is* —
 * are made in one place and composed by the callers rather than each caller
 * inventing a third of it.
 *
 * The state is checked BEFORE the mode, and it is checked here as well as in
 * `rankDocs` for the reason the mode is checked here as well as in the corpus
 * builder: a loader that forgot, a cached payload from an older build, or a
 * caller that assembles its own list must not be the only thing standing between
 * a tombstoned body and `api.anthropic.com`.
 *
 * The citation label goes at the FRONT of the heading, ahead of the tenant's own
 * title, so it survives `fenceUntrusted`'s 300-character heading cap. A label
 * that a long club name can push off the end is a label that is present exactly
 * when it is not needed.
 *
 * ## WRK-070-001 — the mode is re-decided against residency, here too
 *
 * `residency` is required for the same reason it is required on
 * `projectionModeFor`, and it is asked again at this boundary rather than
 * trusted from the corpus: the corpus loader stamps a mode for the cell it ran
 * in, and this is the last statement made before the text is handed to a vendor.
 * `effectiveModeFor` caps the doc's own mode at what the tenant's partition
 * allows, so a `SEARCH_PROJECTION` row assembled anywhere still contributes no
 * text from a cell that has no partition-local route to the vendor.
 */
export function effectiveModeFor(
  doc: Pick<ProjectedDoc, "mode">,
  residency: ProjectionResidency,
): ProjectionMode {
  return capAt(projectionModeOf(doc.mode), residencyCeiling(residency))
}

export function modelSourceFor(
  doc: ProjectedDoc,
  residency: ProjectionResidency,
): UntrustedItem {
  const heading = `${citationLabel(doc.citation)} (${doc.kind} · ${doc.context}) ${doc.title} — ${doc.href}`
  if (!isAnswerable(doc.state)) {
    return { heading, body: "", omitted: stateWithheldNote(doc.state) }
  }
  switch (effectiveModeFor(doc, residency)) {
    case "REFERENCE_ONLY":
      return { heading, body: "", omitted: REFERENCE_ONLY_NOTE }
    case "SEARCH_PROJECTION":
    // Same projection at this boundary as a search projection: the approved
    // body. `GOVERNED_REPLICA` differs in *retention*, not in what a model may
    // read, and nothing in this corpus retains anything yet.
    case "GOVERNED_REPLICA":
      return { heading, body: doc.body }
  }
}
