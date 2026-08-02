import type { ReactNode } from "react"

/**
 * GE-022-006 — the states a dense ERP screen is actually in.
 *
 * Bible §26.2: product surfaces "do not invent local palettes, spacing scales,
 * dialog behavior, tables, charts, or **status meanings**". Before this, the
 * tenants page rendered its own failure paragraph, the platform page rendered a
 * different one, and "this screen has no data" and "this screen could not load
 * its data" looked identical — which is the specific confusion that gets an
 * operator to act on an empty list as though it were an empty fleet.
 *
 * So there are eleven named states and no twelfth. Adding one is a change to
 * this file, which is what makes the vocabulary governed rather than a habit.
 *
 * ## Every state carries a word, not just a colour
 *
 * Each renders a text label — `Empty`, `Denied`, `Stale`. Bible §26.3.2 forbids
 * meaning conveyed by colour alone, and this console's palette is deliberately
 * desaturated, so tone is a whisper and the word is the signal. `states.test`
 * asserts the labels are distinct: two states sharing a word would be two
 * states nobody can tell apart.
 *
 * ## What each state must be given
 *
 * The props are the contract, and they are deliberately not uniform:
 *
 *   * `StaleState` requires `asOf`. "This may be out of date" without a time is
 *     a warning nobody can act on.
 *   * `PartialDataState` requires the names of what is missing. "Some data could
 *     not be loaded" leaves the reader to guess whether the part they care
 *     about is the missing part.
 *   * `HighRiskConfirmation` requires all five of target, impact, policy,
 *     approval and reversibility — Bible §26.6: "High-risk actions show target,
 *     impact, policy, approvals, and reversibility before execution." A
 *     confirmation missing any of them is a dialog that trains people to click
 *     through, which is worse than no dialog at all.
 *   * `PermissionDeniedState` takes NO identifier, and that is a security
 *     property rather than an omission. A denial that names what was denied
 *     confirms the thing exists, so this component cannot be handed the name.
 */

export const STATE_KINDS = [
  "loading",
  "empty",
  "error",
  "permissionDenied",
  "stale",
  "offline",
  "conflict",
  "archived",
  "partialData",
  "pendingDeletion",
  "highRisk",
] as const

export type StateKind = (typeof STATE_KINDS)[number]

/**
 * The word each state shows, and how loud it is.
 *
 * `tone` maps to a muted token, never a saturated one — a console where the eye
 * is pulled to whatever is reddest stops being read.
 */
export const STATE_META: Readonly<Record<StateKind, { label: string; tone: "quiet" | "warn" | "bad" }>> = {
  loading: { label: "Loading", tone: "quiet" },
  empty: { label: "Empty", tone: "quiet" },
  error: { label: "Error", tone: "bad" },
  permissionDenied: { label: "Denied", tone: "bad" },
  stale: { label: "Stale", tone: "warn" },
  offline: { label: "Offline", tone: "warn" },
  conflict: { label: "Conflict", tone: "warn" },
  archived: { label: "Archived", tone: "quiet" },
  partialData: { label: "Partial", tone: "warn" },
  pendingDeletion: { label: "Pending deletion", tone: "bad" },
  highRisk: { label: "High risk", tone: "bad" },
}

function StateBlock({
  kind,
  headline,
  children,
  actions,
}: {
  kind: StateKind
  headline: string
  children?: ReactNode
  actions?: ReactNode
}) {
  const meta = STATE_META[kind]
  return (
    <section className={`state state-${meta.tone}`} data-state={kind} role="status">
      <p className="state-label">{meta.label}</p>
      <p className="state-headline">{headline}</p>
      {children ? <div className="state-body">{children}</div> : null}
      {actions ? <div className="state-actions">{actions}</div> : null}
    </section>
  )
}

/** Work in progress. `label` says what is loading, so a slow page is not a mystery. */
export function LoadingState({ label }: { label: string }) {
  return (
    <StateBlock kind="loading" headline={`Loading ${label}…`}>
      {/* Deliberately not an animated skeleton. Bible §26.3.8: never animate
          large regions continuously, and reduced motion must stop it — a
          shimmer that keeps moving under `prefers-reduced-motion` is the most
          common accessibility defect in exactly this component. */}
      <div className="skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </StateBlock>
  )
}

/**
 * Nothing here — and it says which of the two nothings it is.
 *
 * `because` distinguishes "no records exist" from "no records match your
 * filter", which are the same screen and completely different facts.
 */
export function EmptyState({
  what,
  because,
  actions,
}: {
  what: string
  because: string
  actions?: ReactNode
}) {
  return (
    <StateBlock kind="empty" headline={`No ${what}`} actions={actions}>
      <p>{because}</p>
    </StateBlock>
  )
}

/** Something failed. `detail` is the operator's only lead; never swallow it. */
export function ErrorState({ what, detail, actions }: { what: string; detail: string; actions?: ReactNode }) {
  return (
    <StateBlock kind="error" headline={`Could not load ${what}`} actions={actions}>
      <pre className="state-detail">{detail}</pre>
    </StateBlock>
  )
}

/**
 * Refused.
 *
 * There is no prop for what was refused, on purpose: a denial that names the
 * resource confirms the resource exists, and existence is often the fact worth
 * protecting. The Studio's sign-in already refuses a wrong secret and a
 * non-operator address identically, for the same reason.
 */
export function PermissionDeniedState({ actions }: { actions?: ReactNode }) {
  return (
    <StateBlock kind="permissionDenied" headline="You do not have access to this" actions={actions}>
      <p>If you believe this is wrong, ask an operator to check your access.</p>
    </StateBlock>
  )
}

/** Shown, but not fresh. `asOf` is required — a staleness warning with no time is noise. */
export function StaleState({ asOf, why, children }: { asOf: string; why: string; children?: ReactNode }) {
  return (
    <StateBlock kind="stale" headline={`As of ${asOf}`}>
      <p>{why}</p>
      {children}
    </StateBlock>
  )
}

export function OfflineState({ what }: { what: string }) {
  return (
    <StateBlock kind="offline" headline="No connection">
      <p>{what} cannot be reached. Changes are not being saved.</p>
    </StateBlock>
  )
}

/** Two writers disagreed. Says what the other one did, not just that it failed. */
export function ConflictState({
  what,
  theirChange,
  actions,
}: {
  what: string
  theirChange: string
  actions?: ReactNode
}) {
  return (
    <StateBlock kind="conflict" headline={`${what} changed while you were working`} actions={actions}>
      <p>{theirChange}</p>
    </StateBlock>
  )
}

/** Kept, not serving. Distinct from deleted, and it has to look distinct. */
export function ArchivedState({ what, since }: { what: string; since: string }) {
  return (
    <StateBlock kind="archived" headline={`${what} is archived`}>
      <p>Since {since}. It is retained and readable, and it is not serving traffic.</p>
    </StateBlock>
  )
}

/**
 * Some of it loaded.
 *
 * `missing` is a list rather than a count, because an operator who is told
 * "3 fields could not be loaded" has to go and find out whether any of them was
 * the one they came for.
 */
export function PartialDataState({ what, missing }: { what: string; missing: readonly string[] }) {
  return (
    <StateBlock kind="partialData" headline={`${what} is incomplete`}>
      <p>These could not be resolved, and everything shown excludes them:</p>
      <ul className="state-list">
        {missing.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </StateBlock>
  )
}

/** Scheduled for destruction. `at` is required so the window to stop it is visible. */
export function PendingDeletionState({
  what,
  at,
  actions,
}: {
  what: string
  at: string
  actions?: ReactNode
}) {
  return (
    <StateBlock kind="pendingDeletion" headline={`${what} is scheduled for deletion`} actions={actions}>
      <p>Purge begins {at}. Until then it can still be recovered.</p>
    </StateBlock>
  )
}

/**
 * The five things Bible §26.6 requires before a high-risk action runs.
 *
 * All five are required by the type. A confirmation that omits reversibility is
 * the one people click through, and "are you sure?" is not a control.
 */
export interface HighRisk {
  /** What it happens to, named exactly. */
  target: string
  /** What changes, in the operator's terms rather than the system's. */
  impact: string
  /** Which rule permits it. */
  policy: string
  /** Who must approve, or that nobody need. */
  approval: string
  /** Whether it can be undone, and how. Never omitted, never implied. */
  reversibility: string
}

export function HighRiskConfirmation({ action, risk, children }: { action: string; risk: HighRisk; children?: ReactNode }) {
  return (
    <StateBlock kind="highRisk" headline={action} actions={children}>
      <dl className="state-risk">
        <dt>Target</dt>
        <dd>{risk.target}</dd>
        <dt>Impact</dt>
        <dd>{risk.impact}</dd>
        <dt>Policy</dt>
        <dd>{risk.policy}</dd>
        <dt>Approval</dt>
        <dd>{risk.approval}</dd>
        <dt>Reversibility</dt>
        <dd>{risk.reversibility}</dd>
      </dl>
    </StateBlock>
  )
}

/**
 * Every field a high-risk confirmation must carry, as data.
 *
 * Exported so the guard can check a risk object without rendering it, and so
 * adding a sixth required field is one edit rather than a search for call sites.
 */
export const HIGH_RISK_FIELDS = ["target", "impact", "policy", "approval", "reversibility"] as const

/** Whether a risk description is complete enough to show a person. */
export function missingRiskFields(risk: Partial<HighRisk>): readonly string[] {
  return HIGH_RISK_FIELDS.filter((f) => !risk[f] || String(risk[f]).trim() === "")
}
