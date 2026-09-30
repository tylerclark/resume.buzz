"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useJobStatuses } from "./job-status";
import { HOME_TAB, tabIdForPath } from "./tabs-store";

// A chat about whatever tab is open: on a job tab the model sees the posting, scores, tailored resume
// and cover letter; on Home it only sees the base resume. One conversation per tab, kept in memory for
// the life of the page (the header stays mounted across routes, so switching tabs doesn't lose them).

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS_JOB = [
  "How do I drive my score up?",
  "What are my biggest gaps for this role?",
  "Which bullets should I rewrite, and how?",
  "What should I expect them to ask in the interview?",
];
const SUGGESTIONS_HOME = [
  "What's the weakest part of my base resume?",
  "Which bullets need numbers?",
  "What roles is this resume strongest for?",
];

export function ChatButton() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const tabId = tabIdForPath(pathname) ?? HOME_TAB;
  const jobId = tabId === HOME_TAB ? null : tabId;
  const ids = useMemo(() => (jobId ? [jobId] : []), [jobId]);
  const statuses = useJobStatuses(ids);
  const status = jobId ? statuses[jobId] : undefined;

  // Conversation per tab. Streaming state is per tab too, so switching tabs mid-reply doesn't cross wires.
  const [threads, setThreads] = useState<Record<string, Msg[]>>({});
  const [streaming, setStreaming] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const aborts = useRef(new Map<string, AbortController>());

  const messages = threads[tabId] ?? [];
  const busy = !!streaming[tabId];
  const error = errors[tabId] ?? null;

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streaming[tabId]) return;
      const id = tabId;
      const history = [...(threads[id] ?? []), { role: "user" as const, content }];
      setThreads((t) => ({ ...t, [id]: [...history, { role: "assistant", content: "" }] }));
      setStreaming((s) => ({ ...s, [id]: true }));
      setErrors((e) => ({ ...e, [id]: null }));
      const ac = new AbortController();
      aborts.current.set(id, ac);
      const append = (chunk: string) =>
        setThreads((t) => {
          const cur = t[id] ?? [];
          const last = cur[cur.length - 1];
          if (!last || last.role !== "assistant") return t;
          return { ...t, [id]: [...cur.slice(0, -1), { ...last, content: last.content + chunk }] };
        });
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: id === HOME_TAB ? null : id, messages: history }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error ?? `Request failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          append(dec.decode(value, { stream: true }));
        }
      } catch (e) {
        if (!ac.signal.aborted) setErrors((er) => ({ ...er, [id]: e instanceof Error ? e.message : "Something went wrong." }));
      } finally {
        aborts.current.delete(id);
        setStreaming((s) => ({ ...s, [id]: false }));
        // Drop an empty assistant bubble (stopped before the first token, or an error).
        setThreads((t) => {
          const cur = t[id] ?? [];
          const last = cur[cur.length - 1];
          return last?.role === "assistant" && !last.content ? { ...t, [id]: cur.slice(0, -1) } : t;
        });
      }
    },
    [tabId, threads, streaming],
  );

  const stop = () => aborts.current.get(tabId)?.abort();
  const clear = () => {
    stop();
    setThreads((t) => ({ ...t, [tabId]: [] }));
    setErrors((e) => ({ ...e, [tabId]: null }));
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const contextLabel = jobId
    ? status
      ? [status.company, status.title].filter(Boolean).join(" · ") || "This job"
      : "This job"
    : "Your base resume";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={open ? "Close chat" : "Ask about this job"}
        aria-label="Chat"
        aria-expanded={open}
        aria-controls="rb-chat"
        className={`w-8 h-8 rounded-full grid place-items-center border cursor-pointer transition-colors ${
          open
            ? "bg-brand-tint border-brand-line text-brand"
            : "bg-surface border-line-2 text-subtle hover:text-ink hover:bg-canvas"
        }`}
      >
        <ChatIcon className="w-4 h-4" />
      </button>
      {open && (
        <ChatPanel
          key={tabId}
          contextLabel={contextLabel}
          hasJob={!!jobId}
          messages={messages}
          busy={busy}
          error={error}
          onSend={send}
          onStop={stop}
          onClear={clear}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ChatPanel({
  contextLabel,
  hasJob,
  messages,
  busy,
  error,
  onSend,
  onStop,
  onClear,
  onClose,
}: {
  contextLabel: string;
  hasJob: boolean;
  messages: Msg[];
  busy: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Follow the stream unless the user scrolled up to read something. `lastTop` is where we last put the
  // scroll ourselves: a scroll event below that means the user moved (scroll events from our own
  // scrollTop writes can arrive after the content has grown again, so "near the bottom" alone is racy).
  const stick = useRef(true);
  const lastTop = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  }, [messages]);

  function submit() {
    if (!text.trim() || busy) return;
    onSend(text);
    setText("");
    stick.current = true;
    if (inputRef.current) inputRef.current.style.height = "auto";
  }

  const suggestions = hasJob ? SUGGESTIONS_JOB : SUGGESTIONS_HOME;

  return (
    <div
      id="rb-chat"
      role="dialog"
      aria-label="Chat"
      className="fixed top-[64px] right-5 z-30 w-[440px] max-w-[calc(100vw-40px)] h-[min(600px,calc(100vh-84px))] bg-surface border border-line-2 border-t-0 rounded-b-[14px] shadow-menu flex flex-col overflow-hidden animate-drop"
    >
      <header className="flex items-center gap-2 px-4 h-11 border-b border-line flex-none">
        <span className="text-[11px] font-bold text-faint uppercase tracking-[.06em] flex-none">About</span>
        <span className="text-[12.5px] font-semibold text-ink truncate">{contextLabel}</span>
        <div className="ml-auto flex items-center gap-1 flex-none">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="bg-transparent border-0 px-1.5 py-1 text-[12px] font-semibold text-subtle hover:text-ink cursor-pointer"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="bg-transparent border-0 text-[20px] leading-none cursor-pointer text-subtle hover:text-ink px-1"
          >
            ×
          </button>
        </div>
      </header>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) stick.current = true;
          else if (el.scrollTop < lastTop.current - 1) stick.current = false;
        }}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3"
      >
        {messages.length === 0 && (
          <div className="flex flex-col gap-2 my-auto">
            <p className="m-0 text-[13px] text-subtle leading-[1.5]">
              {hasJob
                ? "Ask anything about this posting, your scores, the tailored resume or the cover letter."
                : "Open a job tab to ask about a posting. Here I only see your base resume."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSend(s)}
                  className="bg-well hover:bg-chip border border-line-2 text-ink rounded-full px-3 py-1.5 text-[12.5px] font-medium cursor-pointer text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} msg={m} pending={busy && i === messages.length - 1 && !m.content} />
        ))}
        {error && <p className="m-0 text-[12.5px] text-bad">{error}</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-2 px-3 py-2.5 border-t border-line flex-none bg-surface"
      >
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={hasJob ? "Ask about this job…" : "Ask about your resume…"}
          aria-label="Message"
          className="flex-1 min-w-0 box-border resize-none border border-line-2 rounded-[10px] text-[13.5px] leading-[1.45] px-3 py-2 bg-field text-ink focus:border-brand focus:outline-none max-h-[140px]"
        />
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            title="Stop"
            aria-label="Stop"
            className="w-9 h-9 flex-none rounded-[10px] border border-line-2 bg-surface hover:bg-canvas text-ink grid place-items-center cursor-pointer"
          >
            <span className="w-3 h-3 rounded-[2px] bg-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text.trim()}
            title="Send"
            aria-label="Send"
            className="w-9 h-9 flex-none rounded-[10px] border-0 bg-brand hover:bg-brand-hover text-white grid place-items-center cursor-pointer disabled:opacity-40"
          >
            <SendIcon className="w-4 h-4" />
          </button>
        )}
      </form>
    </div>
  );
}

function Bubble({ msg, pending }: { msg: Msg; pending: boolean }) {
  if (msg.role === "user")
    return (
      <div className="self-end max-w-[85%] bg-brand text-white rounded-[14px] rounded-br-[4px] px-3.5 py-2 text-[13.5px] leading-[1.5] whitespace-pre-wrap break-words">
        {msg.content}
      </div>
    );
  return (
    <div className="self-start max-w-[92%] text-[13.5px] leading-[1.55] text-ink whitespace-pre-wrap break-words">
      {pending ? <span className="text-faint animate-pulse-soft">Thinking…</span> : msg.content}
    </div>
  );
}

function ChatIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`block ${className}`}
    >
      <path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
    </svg>
  );
}

function SendIcon({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={`block ${className}`}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
