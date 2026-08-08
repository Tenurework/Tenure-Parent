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
 * So there are fourteen named states and no fifteenth. Adding one is a change
 * to this file, which is what makes the vocabulary governed rather than a habit.
 *
 * STUDIO-000-007 added the fourteenth, `unknown`: the ENGINE's own role was
 * refused. Distinct from `permissionDenied` (the human is refused) and from
 * `empty` (there is genuinely nothing), because a denied AWS read rendered as an
 * empty list is how an operator reads "no RDS instances" off a role that may not
 * call DescribeDBInstances.
 *
 * STUDIO-030-006 added the twelfth and thirteenth — `retrying` and `degraded` —
 * because eleven could not describe what a live AWS reader produces. A panel
 * waiting out a `ThrottlingException` is neither loading (nothing is in flight)
 * nor errored (nothing has failed); it is retrying, and a retry banner with no
 * next-attempt time is the noise this file already argues against. An estate
 * view where three of eight service reads came back is not "partial data of one
 * list" either: `partialData` names fields missing from ONE answer, and this is
 * some answers missing entirely, which is a different remedy — you wait for
 * `retrying`, you escalate for `degraded`.
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
 *   * `RetryingState` requires `attempt`, `of` and `nextAttemptAt`. "Retrying…"
 *     with no ceiling and no next-attempt time is a spinner with a different
 *     word on it — the operator cannot tell a backoff that will resolve in four
 *     seconds from one that has three more minutes of it to go.
 *   * `DegradedState` requires BOTH halves — what answered and what did not.
 *     "Degraded" without naming which half is down is untestable and, worse,
 *     unactionable: the figure an operator came for is either in the working
 *     half or it is not, and only the two lists say which.
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
  "retrying",
  "degraded",
  /**
   * STUDIO-000-007. The ENGINE's role was refused, which is not the same as the
   * human operator being refused (`permissionDenied`, above) and not the same as
   * there being nothing (`empty`). It exists because a denied AWS read used to
   * render as an empty list, and an operator cannot tell "no RDS instances" from
   * "this role may not call rds:DescribeDBInstances" once it has.
   */
  "unknown",
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
  // Transient by definition, so it is a warning rather than a failure: a
  // throttled read that is still backing off has not failed yet, and colouring
  // it as though it had is how an operator escalates a wait.
  retrying: { label: "Retrying", tone: "warn" },
  // Louder than `partialData`, because something is actually down rather than
  // merely absent from one answer.
  degraded: { label: "Degraded", tone: "bad" },
  // `warn`, not `bad`. Nothing is broken — the engine simply was not allowed to
  // look, and the operator's next move is an IAM statement rather than an
  // incident. Distinct from `permissionDenied` ("Denied"), which is about the
  // human reading the page.
  unknown: { label: "Unknown", tone: "warn" },
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

/**
 * A read that failed transiently and is being tried again — STUDIO-030-006.
 *
 * Every prop is required, and that is the contract rather than strictness for
 * its own sake. `attempt` and `of` say where in the backoff the reader is;
 * `nextAttemptAt` says when the wait ends, which is the only thing that tells
 * an operator whether to keep the page open or go and look at the service
 * quotas; `why` names the exception, because a `ThrottlingException` and a
 * `ProvisionedThroughputExceededException` have different remedies and the
 * second one costs money to fix.
 *
 * Distinct from `LoadingState` on purpose. Loading means a request is in
 * flight. This means the last request came back with a refusal the reader
 * expects to clear on its own, and nothing is in flight right now.
 */
export function RetryingState({
  attempt,
  of,
  nextAttemptAt,
  why,
}: {
  /** Which attempt just failed. 1-based, so "attempt 1 of 4" is the first failure. */
  attempt: number
  /** How many will be made before this becomes an error. */
  of: number
  /** When the next one runs. An ISO instant, or a phrase like "in 4s". */
  nextAttemptAt: string
  /** What the service said. The exception name, not a paraphrase of it. */
  why: string
}) {
  return (
    <StateBlock kind="retrying" headline={`Attempt ${attempt} of ${of} did not succeed`}>
      <p className="state-retry">
        <span>
          next attempt <b>{nextAttemptAt}</b>
        </span>
        <span>
          then <b>{Math.max(0, of - attempt)}</b> left
        </span>
      </p>
      <p>{why}</p>
    </StateBlock>
  )
}

/** One source that did not answer, and what it said. */
export interface FailedSource {
  /** The read, named the way an operator would name it — `organizations list-accounts`. */
  source: string
  /** Why it did not answer. */
  why: string
}

/**
 * A non-empty list, in the type.
 *
 * `DegradedState` cannot be rendered with an empty half, and this is how that is
 * a compile error rather than a runtime check somebody adds later. A view with
 * nothing failing is whole; one with nothing working is down. Both are other
 * states, and rendering "Degraded" for either is a claim that is not true.
 */
export type NonEmpty<T> = readonly [T, ...T[]]

/**
 * Some of the sources answered — STUDIO-030-006.
 *
 * Both lists are required and both are non-empty by construction. "Degraded"
 * on its own is the least actionable word a console can print: the number an
 * operator came for is either inside the half that answered or inside the half
 * that did not, and only naming both says which.
 */
export function DegradedState({
  what,
  working,
  failing,
}: {
  what: string
  working: NonEmpty<string>
  failing: NonEmpty<FailedSource>
}) {
  const total = working.length + failing.length
  return (
    <StateBlock
      kind="degraded"
      headline={`${what}: ${working.length} of ${total} sources answered`}
    >
      <div className="state-split">
        <div>
          <p className="state-split-head">Answered</p>
          <ul className="state-list">
            {working.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="state-split-head">Did not answer</p>
          <ul className="state-list">
            {failing.map((f) => (
              <li key={f.source}>
                {f.source} — {f.why}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </StateBlock>
  )
}

/**
 * Which of the three a set of reads is in.
 *
 * The narrowing that lets a caller hand `DegradedState` its non-empty halves.
 * Exported because the decision belongs to the vocabulary rather than to each
 * page: without it, every caller invents its own threshold for "degraded" and
 * two consoles disagree about the same estate.
 */
export type Degradation =
  | { kind: "whole" }
  | { kind: "degraded"; working: NonEmpty<string>; failing: NonEmpty<FailedSource> }
  | { kind: "down"; failing: NonEmpty<FailedSource> }

export function degradationOf(
  working: readonly string[],
  failing: readonly FailedSource[],
): Degradation {
  if (failing.length === 0) return { kind: "whole" }
  const bad = failing as NonEmpty<FailedSource>
  if (working.length === 0) return { kind: "down", failing: bad }
  return { kind: "degraded", working: working as NonEmpty<string>, failing: bad }
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

/**
 * What the operator must type before the action is allowed to run.
 *
 * STUDIO-140-006. Until this existed the confirmation was a `<dl>`: it took no
 * value from the person reading it, the server action received nothing from it,
 * and the whole panel could be scrolled past. A confirmation that accepts no
 * input is a display, and a display is not a gate.
 */
export interface RiskConfirmation {
  /** The instruction, in words — "Type the tenant slug to confirm". */
  label: string
  /**
   * Exactly what has to be typed: the tenant slug, or the ARN for an AWS
   * mutation. Rendered so the operator can read it — the control is
   * deliberateness, not secrecy — but never pre-filled, and never a placeholder
   * inside the field, which browsers will happily autofill over.
   */
  expected: string
}

/**
 * The name under which the typed value reaches the server action, and the name
 * under which the digest does.
 *
 * Exported so the action reads the same two strings the form writes. A form
 * field and a `form.get()` that disagree is a gate that is always satisfied and
 * never checked, and neither `tsc` nor a rendering test can see it.
 */
export const CONFIRM_TARGET_FIELD = "confirmTarget"
export const RISK_DIGEST_FIELD = "riskDigest"

/**
 * A digest over exactly the five facts that were rendered.
 *
 * ## What it is for
 *
 * Binding, not secrecy. The server recomputes the risk from the lifecycle graph
 * and the tenant's own record, digests it with THIS function, and refuses when
 * the submitted digest differs — which means the consequence the operator read
 * is the consequence that executes. Between the page rendering and the button
 * being pressed, another operator can move the tenant, a residual reconciliation
 * can change from "reversible" to "IRREVERSIBLE", and the panel on screen
 * becomes a description of something else.
 *
 * ## What it is not
 *
 * It is not a signature and nothing here pretends otherwise. It is unkeyed, so
 * anyone who can post the form can compute a matching value for a body of their
 * choosing. That buys them nothing: the server does not TRUST the submitted
 * digest, it COMPARES it to one it computed itself from facts the browser never
 * supplied, and every other gate — legality, the typed target, the approver
 * lookup, the destructive-verb refusal — is enforced regardless.
 *
 * ## Why not SHA-256
 *
 * This runs in the browser, inside a render, where the only SHA-256 available
 * (`crypto.subtle.digest`) is asynchronous. A hash computed on the server and
 * passed in as a prop would defeat the purpose: the point is that the digest
 * covers the bytes that were RENDERED, so a component that displays one risk and
 * submits the digest of another is impossible by construction.
 *
 * So: four salted FNV-1a passes, each finished with the MurmurHash3 avalanche,
 * concatenated to 128 bits. `Math.imul` rather than BigInt because this app's
 * tsconfig targets ES2017 and a BigInt literal will not compile there — and
 * because a 32-bit multiply is exact in a double while a 64-bit one is not.
 */

/** MurmurHash3's 32-bit finalizer. Spreads a one-bit difference across all 32. */
function avalanche(x: number): number {
  let h = x >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

export function riskDigest(risk: HighRisk): string {
  // Field order is HIGH_RISK_FIELDS, and the separator is a NUL, which cannot
  // occur in any of these values. Joining on a printable character would let
  // {target: "a|b", impact: "c"} and {target: "a", impact: "b|c"} hash alike.
  const canonical = HIGH_RISK_FIELDS.map((f) => risk[f] ?? "").join("\u0000")
  const bytes = new TextEncoder().encode(canonical)

  // Salted BEFORE the message and avalanched after, so the four passes do not
  // walk one state from four starting points: a collision in one is not a
  // collision in the others, which is what makes concatenating them worth more
  // than truncating a single hash four times.
  const pass = (salt: number) => {
    let h = avalanche((0x811c9dc5 ^ salt) >>> 0)
    for (let i = 0; i < bytes.length; i++) {
      h = (h ^ bytes[i]) >>> 0
      h = Math.imul(h, 0x01000193) >>> 0
    }
    // The length is hashed too. Without it, two messages differing only by
    // trailing NULs are one message to the loop above.
    return avalanche((h ^ bytes.length) >>> 0)
      .toString(16)
      .padStart(8, "0")
  }

  return pass(1) + pass(2) + pass(3) + pass(4)
}

/**
 * The five facts, and the field that turns reading them into consenting to them.
 *
 * `confirm` is required. Making it optional would have let every existing call
 * site keep compiling while rendering the same display it rendered before, which
 * is exactly how a gate gets added to a codebase and reaches nothing.
 *
 * The inputs it renders are plain form controls with no client state, so this
 * component has to be placed INSIDE the `<form>` whose submission it gates —
 * `AdvanceControls` does. Outside one they are inert, which is the failure this
 * whole item is about, so `states-logic.spec.ts` asserts the containment.
 */
export function HighRiskConfirmation({
  action,
  risk,
  confirm,
  children,
}: {
  action: string
  risk: HighRisk
  confirm: RiskConfirmation
  children?: ReactNode
}) {
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

      <div className="field state-confirm">
        <label htmlFor={CONFIRM_TARGET_FIELD}>{confirm.label}</label>
        <input
          id={CONFIRM_TARGET_FIELD}
          name={CONFIRM_TARGET_FIELD}
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
        />
        <p className="hint">
          Type <code>{confirm.expected}</code> exactly. The server compares what you typed against
          the target it resolved itself, so a confirmation typed for a different tenant is refused
          rather than applied to this one.
        </p>
      </div>

      {/*
        The digest of the five facts above, as rendered. The action recomputes
        the risk from the lifecycle graph and refuses when they differ — an
        approver who read a different consequence did not approve this one.
      */}
      <input type="hidden" name={RISK_DIGEST_FIELD} value={riskDigest(risk)} readOnly />
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

/**
 * STUDIO-000-007 — the engine's role was refused.
 *
 * All three props are REQUIRED, and that is the whole design. A surface cannot
 * render an unknown without saying which principal was refused, which action it
 * was refused, and the minimum IAM statement that would fix it — because an
 * "unknown" with none of those is indistinguishable from an empty list with a
 * different colour, which is the defect this state exists to end.
 *
 * Unlike `PermissionDeniedState`, this one DOES name what was refused. The
 * reason those differ: `PermissionDeniedState` is about the human at the
 * keyboard, where naming the resource confirms it exists to somebody who may not
 * be allowed to know. This is about Tenure's own task role, read by Tenure's own
 * operators, and the resource's existence is exactly what they are here to learn.
 */
export function UnknownState({
  what,
  principal,
  action,
  minimumStatement,
  errorCode,
  accountId,
  region,
  partition,
}: {
  /** What could not be read, in the operator's language. */
  what: string
  /** The principal ARN the call was made as, or why it is not known. */
  principal: string
  /** The AWS action, spelled as IAM spells it. */
  action: string
  /** JSON the operator can paste into a policy. Never a prose description. */
  minimumStatement: string
  errorCode?: string
  accountId?: string | null
  region?: string | null
  partition?: string | null
}) {
  return (
    <StateBlock kind="unknown" headline={`Unknown — ${what} could not be read`}>
      <dl className="kv">
        <dt>Principal</dt>
        <dd>{principal}</dd>
        <dt>Action</dt>
        <dd>{action}</dd>
        {errorCode ? (
          <>
            <dt>AWS said</dt>
            <dd>{errorCode}</dd>
          </>
        ) : null}
        <dt>Account / region / partition</dt>
        <dd>
          {accountId ?? "unknown"} / {region ?? "unknown"} / {partition ?? "unknown"}
        </dd>
        <dt>Minimum statement</dt>
        <dd>
          <code>{minimumStatement}</code>
        </dd>
      </dl>
      <p>
        This is not an empty result. Nothing is known about {what} until the statement above is
        granted to this engine&rsquo;s task role.
      </p>
    </StateBlock>
  )
}

/**
 * One `AwsRead` arm, rendered.
 *
 * The single component every AWS-backed surface uses, so DENIED cannot be worded
 * as an absence on one page and correctly on another. `ACTUAL` renders nothing
 * here — the surface itself renders the data — because a panel above a populated
 * table saying "read succeeded" is noise.
 */
export function AwsReadPanel({
  read,
  what,
}: {
  read: {
    state: string
    action?: string
    principal?: string
    minimumStatement?: string
    errorCode?: string
    accountId?: string | null
    region?: string | null
    partition?: string | null
    asOf?: string
    retryAfterMs?: number
    why?: string
    code?: string
    safeDetail?: string
  }
  what: string
}) {
  switch (read.state) {
    case "ACTUAL":
      return null
    case "EMPTY":
      return (
        <EmptyState
          what={what}
          because={`AWS answered successfully and returned nothing, as of ${read.asOf ?? "an unknown time"}. This is a real absence, not a refusal.`}
        />
      )
    case "DENIED":
      return (
        <UnknownState
          what={what}
          principal={read.principal ?? "unknown principal"}
          action={read.action ?? "an AWS action"}
          minimumStatement={read.minimumStatement ?? ""}
          errorCode={read.errorCode}
          accountId={read.accountId}
          region={read.region}
          partition={read.partition}
        />
      )
    case "STALE":
      return <StaleState asOf={read.asOf ?? "an unknown time"} why={`${what} was not re-read.`} />
    case "THROTTLED":
      return (
        <RetryingState
          attempt={1}
          of={3}
          nextAttemptAt={`in ${Math.round((read.retryAfterMs ?? 0) / 1000)}s`}
          why={`AWS rate-limited the read behind ${what}.`}
        />
      )
    case "UNCONFIGURED":
      return <EmptyState what={what} because={`Not configured: ${read.why ?? "no reason given"}`} />
    default:
      return <ErrorState what={what} detail={`${read.code ?? read.state}: ${read.safeDetail ?? ""}`} />
  }
}
