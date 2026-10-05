"use client";

import { useEffect, useState } from "react";
import { confirmDialog } from "./confirm-dialog";

type Token = { id: string; name: string; hint: string; lastUsedAt: string | null; createdAt: string };

const btnGhost =
  "bg-surface hover:bg-canvas border border-line-2 text-ink px-3 py-2 rounded-[9px] text-[13px] font-semibold cursor-pointer whitespace-nowrap disabled:opacity-60";
const btnPrimary =
  "bg-brand hover:bg-brand-hover text-white border-0 rounded-[9px] px-3.5 py-2 text-[13px] font-bold cursor-pointer disabled:opacity-60 whitespace-nowrap";

const day = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Create and revoke personal API tokens for POST /api/jobs. A new token is shown once, with a curl
// example, and never again.
export function ApiTokensDialog({ onClose }: { onClose: () => void }) {
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tokens", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b: { tokens: Token[] }) => setTokens(b.tokens))
      .catch(() => setError("Couldn't load your tokens."));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Couldn't create a token.");
    const { token, ...row } = body as Token & { token: string };
    setTokens((t) => [row, ...(t ?? [])]);
    setCreated(token);
    setName("");
  }

  async function revoke(t: Token) {
    const message = `Revoke "${t.name}"? Anything using it stops working.`;
    if (!(await confirmDialog({ message, confirmLabel: "Revoke", danger: true }))) return;
    const res = await fetch(`/api/tokens/${t.id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) return setError("Couldn't revoke it. Try again.");
    setTokens((ts) => ts?.filter((x) => x.id !== t.id) ?? null);
  }

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    });
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const example = `curl -X POST ${origin}/api/jobs \\
  -H "Authorization: Bearer ${created ?? "rb_…"}" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://jobs.example.com/123", "source": "my-agent", "notes": "Strong fit"}'`;

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-30 bg-scrim-strong" />
      <div
        role="dialog"
        aria-modal
        aria-label="API tokens"
        className="fixed z-30 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[620px] max-w-[94vw] max-h-[86vh] bg-surface rounded-[16px] shadow-modal flex flex-col overflow-hidden"
      >
        <header className="flex items-start gap-4 px-6 pt-5 pb-4 border-b border-line flex-none">
          <div className="min-w-0 flex-1">
            <div className="font-extrabold text-[16px] tracking-[-.01em]">API tokens</div>
            <div className="text-[12.5px] text-subtle mt-0.5">
              Let a script or agent submit jobs. They wait for your approval before anything is tailored, and show up here with an
              API badge.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="bg-transparent border-0 text-[22px] leading-none cursor-pointer text-subtle px-1"
          >
            ×
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {created && (
            <div className="bg-ok-bg border border-ok-line rounded-[12px] px-4 py-3 flex flex-col gap-2">
              <div className="text-[13px] font-bold text-ok-ink">Copy your token now. You won&apos;t see it again.</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 font-mono text-[12px] bg-surface text-ink px-2 py-1.5 rounded-md break-all">
                  {created}
                </code>
                <button type="button" onClick={() => copy("token", created)} className={btnGhost}>
                  {copied === "token" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
            className="flex gap-2"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name, e.g. Jobby"
              maxLength={60}
              aria-label="Token name"
              className="flex-1 min-w-0 box-border border border-line-2 rounded-[10px] text-[13.5px] px-3 py-2 bg-surface text-ink focus:border-brand focus:outline-none"
            />
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "Creating…" : "Create token"}
            </button>
          </form>
          {error && <p className="m-0 text-[12.5px] text-bad">{error}</p>}

          <div className="flex flex-col border border-line-2 rounded-[12px] divide-y divide-line">
            {tokens === null && !error && <div className="px-3 py-2.5 text-[13px] text-subtle">Loading…</div>}
            {tokens?.length === 0 && <div className="px-3 py-2.5 text-[13px] text-subtle">No tokens yet.</div>}
            {tokens?.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ink truncate">
                    {t.name} <span className="font-mono text-[11.5px] text-faint">…{t.hint}</span>
                  </div>
                  <div className="text-[11.5px] text-subtle">
                    Created {day(t.createdAt)} · {t.lastUsedAt ? `Last used ${day(t.lastUsedAt)}` : "Never used"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(t)}
                  className="bg-transparent border-0 p-0 text-[12.5px] font-semibold text-bad cursor-pointer hover:underline"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center">
              <span className="eyebrow">Example</span>
              <button
                type="button"
                onClick={() => copy("example", example)}
                className="ml-auto bg-transparent border-0 p-0 text-[12px] font-semibold text-brand cursor-pointer hover:underline"
              >
                {copied === "example" ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="m-0 font-mono text-[11.5px] leading-[1.6] bg-well text-ink px-3 py-2.5 rounded-[10px] overflow-x-auto whitespace-pre">
              {example}
            </pre>
            <p className="m-0 text-[12px] text-subtle leading-[1.55]">
              Send <code className="font-mono">url</code> and/or <code className="font-mono">description</code>, plus
              optional <code className="font-mono">title</code>, <code className="font-mono">company</code>,{" "}
              <code className="font-mono">notes</code>, <code className="font-mono">source</code>. Up to 10 at once as an
              array. Jobs wait in the app until you approve them; nothing is tailored (or billed) before that. Poll{" "}
              <code className="font-mono">GET /api/jobs?ids=…</code> for progress.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
