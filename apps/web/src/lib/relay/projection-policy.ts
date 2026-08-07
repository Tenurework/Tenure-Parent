import type { UntrustedItem } from "@/lib/relay/untrusted-content"

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

/** The declared mode for a source kind. */
export function projectionModeFor(kind: ProjectedKind): ProjectionMode {
  return MODE_BY_KIND[kind]
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
}

/** Shown in place of a body that policy does not project. Platform-authored. */
export const REFERENCE_ONLY_NOTE =
  "(reference only: this source's text is not projected to the model. Cite it by " +
  "title and link, and say that its contents must be opened directly.)"

/**
 * One retrieved doc, reduced to what may cross the model boundary.
 *
 * Returns the shape `fenceUntrusted` consumes, so the two §9.4/§3.4 decisions —
 * *how much* text, and *how* it is fenced — are made in one place and composed
 * by the callers rather than each caller inventing half of it.
 */
export function modelSourceFor(doc: ProjectedDoc): UntrustedItem {
  const heading = `(${doc.kind} · ${doc.context}) ${doc.title} — ${doc.href}`
  switch (projectionModeOf(doc.mode)) {
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
