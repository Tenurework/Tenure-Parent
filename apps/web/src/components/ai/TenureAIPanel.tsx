"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { X, ArrowRight, Sparkles, Loader2 } from "@/components/ui/icons"
import { TenureAIMark } from "@/components/brand/TenureLogo"
import { MissingConnectionCard } from "@/components/connections/MissingConnectionCard"
import {
  capabilityAdministrators,
  certifiedCapabilityState,
} from "@/lib/connections/capability-resolution"
import {
  citationLine,
  stateCaveat,
  INFERENCE_NOTE,
  WITHHELD_NOTE,
} from "@/lib/relay/citation-display"
import { relayReply, type RelayOutcome } from "./relay-reply"
import { useAI } from "./AIProvider"

/**
 * A numbered source, in the shape `/api/ai/chat` actually returns it.
 *
 * WRK-070-003. `state` and `citation` are REQUIRED here, and until now neither
 * was declared at all: the route has emitted §9.3's full citation — which system
 * holds the source, whether this is the record or a copy of somebody else's,
 * when the source last changed, what state it is in, and a governed deep link —
 * and this interface listed four display strings, so every one of those facts
 * was parsed off the wire and dropped before a reader could see it. A record
 * nobody had touched in two years rendered as the same two lines as one saved
 * this morning, which is §3.5's failure stated exactly.
 */
interface Source {
  title: string
  href: string
  kind: string
  context: string
  /** The operational verdict: LIVE, STALE, TOMBSTONED, … */
  state: string
  citation: {
    ref: { provider: string }
    assertion: string
    /** When the source itself last changed. */
    versionAt: string
    /**
     * The GOVERNED deep link, or null. Rendered instead of `href`, never
     * beside it: `governedDeepLink` minted this one and nothing else may be
     * presented as a link Tenure vouches for.
     */
    href: string | null
  }
}

/**
 * WRK-010-005. A row that matched and may not be answered from.
 *
 * No `body` and no `snippet` — `WithheldMatch` has no field that could carry
 * one — so rendering it cannot leak the text the state withheld.
 */
interface Withheld {
  id: string
  title: string
  kind: string
  context: string
  href: string
  state: string
  observedAt: string
}

interface Message {
  role: "user" | "assistant"
  content: string
  sources?: Source[]
  /** Matching rows an answer may not rest on, with the state that disqualified each. */
  withheld?: Withheld[]
  aiEnabled?: boolean
  /** Which of the five refusal/answer outcomes produced this turn. */
  outcome?: RelayOutcome
  /** The question this turn was answering, kept so a refusal can resume it. */
  askedAbout?: string
}

/**
 * What `/api/ai/chat` actually returns. The panel used to declare only the
 * first three fields, so the two refusal facts the route deliberately keeps
 * apart were dropped before anything could read them.
 */
interface ChatResponse {
  answer: string | null
  aiEnabled: boolean
  aiDisabledReason: string | null
  toolRefusal: string | null
  /**
   * WRK-GATE-070. Why a vendor answer was discarded, when one was — the route
   * verifies every bracketed number against the sources it actually offered and
   * suppresses an answer that names one it did not.
   *
   * Declared here because it decides which sentence the transcript shows: a
   * response missing this field falls to `relayReply`'s bottom branch, which
   * calls a suppressed answer a transient failure.
   */
  citationRefusal: string | null
  /** Which offered sources the returned answer rests on, parsed from the prose. */
  citedSources?: number[]
  sources: Source[]
  /** WRK-010-005. Matching rows that were not offered as sources. */
  withheld?: Withheld[]
  /** The scope the route actually applied, echoed back. */
  scopeApplied?: { kind: string; id: string | null } | null
}

const SUGGESTIONS = [
  "What are my upcoming deadlines?",
  "Who was last year's VP Finance?",
  "How do I submit an event proposal?",
  "Summarize our recent approvals.",
]

/**
 * Tenure AI as a right-side conversation panel. Retrieval-augmented over the
 * user's own permission-scoped workspace (via /api/ai/chat); answers cite
 * numbered sources. Opened from the header / side-nav Tenure AI entry.
 *
 * ## What this panel is required to always show, and now does
 *
 * * **Tenant and active scope** (TTES-030-003, TTES-020-002). `scope.tenantName`
 *   is a REQUIRED prop rather than an optional one, and there is exactly one
 *   construction site — `src/app/(app)/layout.tsx`, which already holds
 *   `tenants.active`. An optional prop here would compile at that call site
 *   untouched and ship an assistant that never names the workspace it reads.
 *   The active scope comes from `AIProvider`, which derives it from the route
 *   and from any `AIScopeAnchor` a record page mounted, and it is SENT with the
 *   question — so the line under the title describes the request rather than
 *   decorating it.
 * * **Cancellation.** `ask()` holds an `AbortController`; the Stop button
 *   aborts it and appends a cancelled turn.
 * * **Announcements** (WCAG 2.2 SC 4.1.3, Status Messages). Two live regions,
 *   both mounted permanently — a region that appears at the same moment as its
 *   content announces nothing, because assistive technology has to have been
 *   watching it already. One wraps the transcript; the other is a short status
 *   line ("Tenure AI is thinking", "Answer ready, 3 sources") derived from the
 *   same state the visible UI renders, so it cannot drift from the screen.
 * * **The four outcomes, distinguished.** `relayReply` decides the copy, so a
 *   tenant that switched the assistant off is not told nobody configured it,
 *   and a principal refused the retrieval tool is not told their workspace is
 *   empty.
 */
export function TenureAIPanel({
  scope,
}: {
  /** The institution every answer is scoped to. Required; see the header. */
  scope: { tenantName: string }
}) {
  const { open, closePanel, scope: askScope } = useAI()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120)
  }, [open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, loading])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) closePanel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, closePanel])

  // A request still in flight when the panel unmounts is a fetch nobody reads.
  useEffect(() => () => abortRef.current?.abort(), [])

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  async function ask(question: string) {
    const q = question.trim()
    if (!q || loading) return
    const history = messages.map((m) => ({ role: m.role, content: m.content }))
    setMessages((m) => [...m, { role: "user", content: q }])
    setInput("")
    setLoading(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The scope travels with the question. Without it the route ranks the
        // whole corpus identically whichever page you asked from, which is the
        // "chat window pasted over the product" the pattern forbids by name.
        body: JSON.stringify({
          question: q,
          history,
          scope: { kind: askScope.kind, id: askScope.id, label: askScope.label },
        }),
        signal: controller.signal,
      })
      const data = (await res.json()) as ChatResponse
      const reply = relayReply({
        answer: data.answer,
        aiEnabled: data.aiEnabled,
        aiDisabledReason: data.aiDisabledReason ?? null,
        toolRefusal: data.toolRefusal ?? null,
        citationRefusal: data.citationRefusal ?? null,
        sourceCount: data.sources?.length ?? 0,
      })
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: reply.message,
          sources: reply.showSources ? data.sources : [],
          // WRK-010-005. Shown on the same terms as the sources: a cancelled
          // event that is simply absent reads as "there is no such event",
          // which is a different and untrue statement. Not gated on
          // `showSources` — a refusal that retrieved nothing has nothing
          // withheld either, and the route returns an empty list for it.
          withheld: data.withheld ?? [],
          aiEnabled: data.aiEnabled,
          outcome: reply.outcome,
          askedAbout: q,
        },
      ])
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError"
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: aborted
            ? "Stopped. Nothing further was sent to the model."
            : "Something went wrong reaching Tenure AI. Please try again.",
        },
      ])
    } finally {
      abortRef.current = null
      setLoading(false)
    }
  }

  const last = messages[messages.length - 1]
  /**
   * SC 4.1.3. Derived from the same `loading` / `messages` state the visible UI
   * renders — delete `aria-live` from the node below and a screen-reader user
   * is told nothing when an answer lands, which is what e2e/a11y.spec.ts's
   * "4.1.3 Status Messages" case asserts against.
   */
  const liveStatus = loading
    ? "Tenure AI is thinking"
    : last?.role === "assistant"
      ? `Answer ready, ${last.sources?.length ?? 0} sources`
      : ""

  return (
    <>
      {/* Backdrop — only on narrow screens, where the panel overlays instead
          of squeezing the content. */}
      <div
        onClick={closePanel}
        className={`fixed inset-0 z-assist-scrim bg-black/20 transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden
      />

      <aside
        role="complementary"
        aria-label="Tenure AI assistant"
        aria-hidden={open ? undefined : true}
        inert={!open}
        className={`fixed right-0 z-assist flex w-[min(26rem,100vw)] flex-col border-l border-border bg-surface shadow-lg transition-transform duration-slow ease-entry ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ top: "var(--shell-height)", bottom: "var(--footer-height)" }}
      >
        {/* Rendered only while open so the assistant's copy never sits in the
            DOM on other pages (avoids text collisions and screen-reader noise). */}
        {open && (
        <>
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <TenureAIMark size={22} />
            <div className="min-w-0">
              <p className="font-display text-base font-bold text-text-1">Tenure AI</p>
              {/* The named scope indicator: tenant first, then the active
                  scope the question will actually carry. */}
              <p className="text-meta text-text-3" data-testid="relay-scope">
                Asking within: {scope.tenantName} · {askScope.label}
              </p>
            </div>
          </div>
          <button
            onClick={closePanel}
            aria-label="Close Tenure AI"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-base hover:text-text-1"
          >
            <X size={18} />
          </button>
        </header>

        {/* Privacy notice — what leaves this workspace, said before it does. */}
        <p className="border-b border-border px-5 py-2 text-meta text-text-3">
          Only records you can already open are read. Your question and the
          passages used to answer it are sent to the connected model.
        </p>

        {/* SC 4.1.3. Mounted whether or not it has anything to say: a live
            region that appears together with its text announces nothing. */}
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          data-testid="relay-live-status"
        >
          {liveStatus}
        </p>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
          {messages.length === 0 && (
            <div className="pt-4">
              {/* Outline-only: a hairline ring, not a tinted plate. */}
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-border">
                <Sparkles size={22} weight="regular" className="text-[--primary]" />
              </div>
              <p className="mt-4 text-center text-sm text-text-2">
                Ask about your clubs, seats, deadlines, approvals, documents and institutional memory.
                Answers cite where they came from.
              </p>
              <div className="mt-5 space-y-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="flex w-full items-center gap-2 rounded-lg border border-border px-3.5 py-2.5 text-left text-sm text-text-1 transition-colors hover:border-[--primary] hover:bg-base"
                  >
                    <ArrowRight size={15} className="shrink-0 text-text-3" />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* The transcript's own live region, mounted even when empty. */}
          <div
            className="space-y-4"
            aria-live="polite"
            aria-atomic="false"
            data-testid="relay-transcript"
          >
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-br-sm bg-[--primary] px-4 py-2.5 text-sm text-[--primary-text]"
                    : "max-w-full rounded-2xl rounded-bl-sm bg-base px-4 py-3 text-sm text-text-1"
                }
              >
                <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>

                {/* TTES-030-005. A capability that is not connected gets the
                    owned card — plain language, who owns it, one path, and the
                    question kept for when it resumes — not a bare sentence.
                    Driven by the `aiEnabled` flag the route computes from
                    aiConfigured(); genuine state, not a fixture. */}
                {(m.outcome === "unconfigured" || m.outcome === "assistant-disabled") && (
                  <div className="mt-3">
                    <MissingConnectionCard
                      capability={{
                        // WRK-030-005. Derived from the provider review the chat
                        // route reads, never asserted here. This was the fourth
                        // hardcoded `certified: true`, and it was false: no
                        // provider-side review of the model connector has been
                        // submitted, so the route refuses the vendor call and
                        // this card would have offered "ask an administrator"
                        // for something no administrator can enable.
                        ...certifiedCapabilityState("ai.model"),
                        ...capabilityAdministrators("ai.model"),
                        label: "Tenure AI model",
                        configured: m.aiEnabled ?? false,
                        reachable: true,
                        connectableBy: "admin",
                        requiredScopes: [],
                        grantedScopes: [],
                        credential: null,
                        alternative: null,
                      }}
                      // Where a person goes in TENURE. The panel's own
                      // alternative below is the richer path; this is the
                      // control the resolution allows.
                      manageHref="/messages/compose"
                      pendingIntent={m.askedAbout}
                      alternative={
                        <>
                          In the meantime,{" "}
                          <Link href="/search" onClick={closePanel} className="text-text-link">
                            search your workspace
                          </Link>{" "}
                          — the same records, without a written answer.
                        </>
                      }
                    />
                  </div>
                )}

                {m.sources && m.sources.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                    <p className="text-meta font-semibold uppercase tracking-wide text-text-3">Sources</p>
                    {/* WRK-070-003 / §9.3. The distinction between the prose and
                        the records it was built from, said by the platform
                        rather than left to the model's own "(inference)". */}
                    <p className="text-[12px] text-text-3">{INFERENCE_NOTE}</p>
                    {m.sources.map((s, si) => {
                      // The GOVERNED link, never the stored one. Null means no
                      // link may be vouched for, and the row renders as text —
                      // which is a different statement from "no such record".
                      const link = s.citation?.href ?? null
                      // `state` is a sibling of `citation` on `Source`, not a
                      // member of it — the route emits the operational verdict
                      // once for the source rather than repeating it inside the
                      // citation. `citationLine` needs it to render the STALE /
                      // TOMBSTONED caveat, which is the whole point of showing a
                      // citation rather than a bare link, so it is passed
                      // through here rather than duplicated on the wire.
                      const line = s.citation
                        ? citationLine({ ...s.citation, state: s.state }, new Date())
                        : "citation unavailable — open the source directly"
                      const body = (
                        <span className="min-w-0">
                          {s.title} <span className="text-text-3">· {s.context}</span>
                          <span className="block text-[12px] text-text-3">{line}</span>
                        </span>
                      )
                      return (
                        <div key={si} className="flex items-start gap-1.5 text-[13px]">
                          <span className="shrink-0 font-semibold text-text-3">[{si + 1}]</span>
                          {link ? (
                            <Link
                              href={link}
                              onClick={closePanel}
                              className="min-w-0 text-text-link no-underline hover:underline"
                            >
                              {body}
                            </Link>
                          ) : (
                            <span className="min-w-0 text-text-1">{body}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* WRK-010-005. What matched and could not be answered from. */}
                {m.withheld && m.withheld.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                    <p className="text-meta font-semibold uppercase tracking-wide text-text-3">
                      Not answerable
                    </p>
                    <p className="text-[12px] text-text-3">{WITHHELD_NOTE}</p>
                    {m.withheld.map((w) => (
                      <p key={w.id} className="text-[13px] text-text-1">
                        {w.title}{" "}
                        <span className="text-text-3">
                          · {w.context} · {stateCaveat(w.state) ?? w.state}
                        </span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-text-3">
              <Loader2 size={16} className="animate-spin" /> Tenure AI is thinking…
              <button
                type="button"
                onClick={stop}
                aria-label="Stop Tenure AI"
                className="ml-1 inline-flex h-8 items-center rounded-md border border-border-strong px-2.5 text-[13px] font-medium text-text-1 transition-colors hover:bg-subtle"
              >
                Stop
              </button>
            </div>
          )}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask(input)
          }}
          className="border-t border-border p-3"
        >
          <div className="flex items-end gap-2 rounded-lg border border-border bg-surface p-2 focus-within:border-[--border-focus]">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  ask(input)
                }
              }}
              rows={1}
              placeholder="Ask Tenure AI…"
              aria-label="Ask Tenure AI"
              className="max-h-32 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[15px] text-text-1 outline-none placeholder:text-text-3"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              aria-label="Send to Tenure AI"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[--primary] text-[--primary-text] transition-colors hover:bg-[--primary-hover] disabled:opacity-40"
            >
              <ArrowRight size={18} />
            </button>
          </div>
        </form>
        </>
        )}
      </aside>
    </>
  )
}
