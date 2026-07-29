"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { X, ArrowRight, Sparkles, Loader2 } from "@/components/ui/icons"
import { TenureAIMark } from "@/components/brand/TenureLogo"
import { useAI } from "./AIProvider"

interface Source {
  title: string
  href: string
  kind: string
  context: string
}
interface Message {
  role: "user" | "assistant"
  content: string
  sources?: Source[]
  aiEnabled?: boolean
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
 * numbered sources, and when no model is configured it still surfaces the most
 * relevant items. Opened from the header / side-nav Tenure AI entry.
 */
export function TenureAIPanel() {
  const { open, closePanel } = useAI()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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

  async function ask(question: string) {
    const q = question.trim()
    if (!q || loading) return
    const history = messages.map((m) => ({ role: m.role, content: m.content }))
    setMessages((m) => [...m, { role: "user", content: q }])
    setInput("")
    setLoading(true)
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, history }),
      })
      const data = (await res.json()) as { answer: string | null; aiEnabled: boolean; sources: Source[] }
      // Distinguish the two no-answer cases so the state is honest: the key is
      // simply not set up here (aiEnabled false) vs. it is set up but the answer
      // couldn't be generated right now (aiEnabled true — a transient model or
      // billing issue). Either way we still surface the ranked sources.
      const fallback = data.sources.length
        ? data.aiEnabled
          ? "Tenure AI couldn't generate an answer just now — here are the most relevant items in your workspace:"
          : "AI answers aren't set up for this workspace yet, but these are the most relevant items:"
        : data.aiEnabled
          ? "Tenure AI couldn't generate an answer just now, and I didn't find anything matching in your workspace."
          : "I couldn't find anything about that in your workspace."
      const content = data.answer ?? fallback
      setMessages((m) => [...m, { role: "assistant", content, sources: data.sources, aiEnabled: data.aiEnabled }])
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Something went wrong reaching Tenure AI. Please try again." }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Backdrop — only on narrow screens, where the panel overlays instead
          of squeezing the content. */}
      <div
        onClick={closePanel}
        className={`fixed inset-0 z-[60] bg-black/20 transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden
      />

      <aside
        role="complementary"
        aria-label="Tenure AI assistant"
        aria-hidden={open ? undefined : true}
        inert={!open}
        className={`fixed right-0 z-[61] flex w-[min(26rem,100vw)] flex-col border-l border-border bg-surface shadow-lg transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ top: "var(--shell-height)", bottom: "var(--footer-height)" }}
      >
        {/* Rendered only while open so the assistant's copy never sits in the
            DOM on other pages (avoids text collisions and screen-reader noise). */}
        {open && (
        <>
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <TenureAIMark size={22} color="#25a96d" />
            <div>
              <p className="font-display text-base font-bold text-text-1">Tenure AI</p>
              <p className="text-meta text-text-3">Grounded in your workspace</p>
            </div>
          </div>
          <button
            onClick={closePanel}
            aria-label="Close Tenure AI"
            className="grid h-9 w-9 place-items-center rounded-md text-text-3 transition-colors hover:bg-base hover:text-text-1"
          >
            <X size={18} />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
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

          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-br-sm bg-[--primary] px-4 py-2.5 text-sm text-white"
                    : "max-w-full rounded-2xl rounded-bl-sm bg-base px-4 py-3 text-sm text-text-1"
                }
              >
                <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                    <p className="text-meta font-semibold uppercase tracking-wide text-text-3">Sources</p>
                    {m.sources.map((s, si) => (
                      <Link
                        key={si}
                        href={s.href}
                        onClick={closePanel}
                        className="flex items-start gap-1.5 text-[13px] text-text-link no-underline hover:underline"
                      >
                        <span className="shrink-0 font-semibold">[{si + 1}]</span>
                        <span className="min-w-0">
                          {s.title} <span className="text-text-3">· {s.context}</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-text-3">
              <Loader2 size={16} className="animate-spin" /> Tenure AI is thinking…
            </div>
          )}
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
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[--primary] text-white transition-colors hover:bg-[--primary-hover] disabled:opacity-40"
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
