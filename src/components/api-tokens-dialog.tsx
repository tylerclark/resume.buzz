"use client";

import { useEffect, useState } from "react";
import {
  apiReferenceMarkdown,
  ENDPOINTS,
  type Endpoint,
  type Field,
  JOB_STAGE_KEYS,
  JOB_STATUS_KEYS,
  LIMITS,
  type Method,
  SESSION_ONLY,
  STAGE_FLOW,
} from "@/lib/api-reference";
import { JOB_STATUSES } from "@/lib/types";
import { confirmDialog } from "./confirm-dialog";

type Token = { id: string; name: string; hint: string; lastUsedAt: string | null; createdAt: string };
type Tab = "tokens" | "reference";
// "start" is the overview page; the rest are endpoint ids.
type Page = "start" | "rules" | (typeof ENDPOINTS)[number]["id"];

const btnGhost =
  "bg-surface hover:bg-canvas border border-line-2 text-ink px-3 py-2 rounded-[9px] text-[13px] font-semibold cursor-pointer whitespace-nowrap disabled:opacity-60";
const btnPrimary =
  "bg-brand hover:bg-brand-hover text-white border-0 rounded-[9px] px-3.5 py-2 text-[13px] font-bold cursor-pointer disabled:opacity-60 whitespace-nowrap";
const linkBtn = "bg-transparent border-0 p-0 text-[12px] font-semibold text-brand cursor-pointer hover:underline";

const METHOD_CLS: Record<Method, string> = {
  GET: "bg-ok-bg text-ok-ink border-ok-line",
  POST: "bg-brand-tint text-brand border-brand-line",
  PATCH: "bg-warn-bg text-warn-ink border-warn-line",
};

const day = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Personal API tokens plus the reference for what they can call. Tokens tab: create (shown once) and
// revoke. Reference tab: one page per endpoint so nothing has to scroll far, and a copy of the whole
// thing as markdown for an agent's instructions.
export function ApiTokensDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("tokens");
  const [page, setPage] = useState<Page>("start");
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
  // Examples use the token just created, so they're paste-ready; otherwise a placeholder.
  const token = created ?? "rb_…";
  const current = ENDPOINTS.find((e) => e.id === page);

  const tabCls = (active: boolean) =>
    `h-8 px-3 rounded-[8px] border text-[13px] font-semibold cursor-pointer transition-colors ${
      active ? "bg-canvas border-line-2 text-ink" : "bg-transparent border-transparent text-subtle hover:bg-canvas hover:text-ink"
    }`;

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-30 bg-scrim-strong" />
      <div
        role="dialog"
        aria-modal
        aria-label="API"
        className="fixed z-30 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[940px] max-w-[94vw] h-[84vh] max-h-[760px] bg-surface rounded-[16px] shadow-modal flex flex-col overflow-hidden"
      >
        <header className="flex items-center gap-4 px-6 pt-4 pb-3 border-b border-line flex-none">
          <div className="min-w-0">
            <div className="font-extrabold text-[16px] tracking-[-.01em]">API</div>
            <div className="text-[12.5px] text-subtle mt-0.5">
              Let a script or agent submit jobs, tailor resumes, fetch PDFs and record applications.
            </div>
          </div>
          <div role="tablist" className="ml-auto flex items-center gap-1 flex-none">
            <button type="button" role="tab" aria-selected={tab === "tokens"} onClick={() => setTab("tokens")} className={tabCls(tab === "tokens")}>
              Tokens
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "reference"}
              onClick={() => setTab("reference")}
              className={tabCls(tab === "reference")}
            >
              Reference
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="bg-transparent border-0 text-[22px] leading-none cursor-pointer text-subtle px-1 flex-none"
          >
            ×
          </button>
        </header>

        {tab === "tokens" ? (
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
                <div className="text-[12px] text-ok-ink">
                  The examples under Reference now use this token, so you can paste them straight into your agent.
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

            <div className="bg-well rounded-[12px] px-4 py-3 text-[12.5px] text-subtle leading-[1.55] flex flex-col gap-2">
              <p className="m-0">
                A token works only on <code className="font-mono text-ink">/api/jobs…</code>. It can submit jobs (which wait for
                your approval here), tailor them outright with <code className="font-mono text-ink">POST /api/jobs/tailor</code>{" "}
                (billed, no approval, so only for an agent you trust), read their status, download PDFs and mark them applied.
                It can&apos;t approve, delete, or touch your resume.
              </p>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setTab("reference")} className={btnGhost}>
                  Open the reference
                </button>
                <button type="button" onClick={() => copy("md", apiReferenceMarkdown(origin))} className={btnGhost}>
                  {copied === "md" ? "Copied" : "Copy docs for your agent"}
                </button>
                <span className="text-[11.5px] text-faint">Markdown with every endpoint, field and status code.</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex">
            <nav aria-label="Endpoints" className="w-[232px] flex-none border-r border-line overflow-y-auto py-2 flex flex-col">
              <NavItem active={page === "start"} onClick={() => setPage("start")}>
                <span className="text-[13px] font-semibold">Start here</span>
              </NavItem>
              <NavItem active={page === "rules"} onClick={() => setPage("rules")}>
                <span className="text-[13px] font-semibold">Limits and rules</span>
              </NavItem>
              <div className="eyebrow px-4 pt-3 pb-1 text-[10.5px]">Endpoints</div>
              {ENDPOINTS.map((e) => (
                <NavItem key={e.id} active={page === e.id} onClick={() => setPage(e.id)}>
                  <span className={`font-mono text-[10px] font-bold px-1 py-px rounded border ${METHOD_CLS[e.method]}`}>{e.method}</span>
                  <span className="min-w-0 flex flex-col">
                    <span className="text-[12.5px] font-semibold truncate">{e.title}</span>
                    <span className="font-mono text-[10.5px] text-faint truncate">{e.path}</span>
                  </span>
                </NavItem>
              ))}
              <div className="mt-auto px-3 pt-3 pb-1">
                <button type="button" onClick={() => copy("md", apiReferenceMarkdown(origin))} className={`${btnGhost} w-full`}>
                  {copied === "md" ? "Copied" : "Copy docs for your agent"}
                </button>
              </div>
            </nav>

            <div className="flex-1 min-w-0 overflow-y-auto px-6 py-4">
              {current ? (
                <EndpointPage e={current} origin={origin} token={token} copied={copied} copy={copy} />
              ) : page === "rules" ? (
                <RulesPage />
              ) : (
                <StartPage origin={origin} token={token} copied={copied} copy={copy} go={setPage} />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function NavItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`mx-2 flex items-center gap-2 text-left px-2 py-1.5 rounded-[8px] border-0 cursor-pointer ${
        active ? "bg-canvas text-ink" : "bg-transparent text-subtle hover:bg-canvas hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

type CopyProps = { copied: string | null; copy: (label: string, text: string) => void };

function StartPage({ origin, token, copied, copy, go }: { origin: string; token: string; go: (p: Page) => void } & CopyProps) {
  const auth = `Authorization: Bearer ${token}`;
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-[15px] font-extrabold tracking-[-.01em]">Authentication</h3>
        <p className="m-0 text-[12.5px] text-subtle leading-[1.55]">
          Base URL <code className="font-mono text-ink">{origin}</code>. Send the token on every request. JSON in, JSON out,
          except the PDF endpoints.
        </p>
        <Code label="auth" text={auth} copied={copied} copy={copy} />
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-[15px] font-extrabold tracking-[-.01em]">A typical agent run</h3>
        <ol className="m-0 pl-5 list-decimal text-[12.5px] text-subtle leading-[1.6] flex flex-col gap-0.5">
          <li>
            <Jump go={go} to="list">
              GET /api/jobs?acted=1
            </Jump>{" "}
            lists every employer you&apos;ve already dealt with (check <code className="font-mono">company</code> and{" "}
            <code className="font-mono">host</code>) so the agent skips them.
          </li>
          <li>
            <Jump go={go} to="submit">
              POST /api/jobs
            </Jump>{" "}
            adds a lead that waits for your approval (nothing billed), or{" "}
            <Jump go={go} to="tailor">
              POST /api/jobs/tailor
            </Jump>{" "}
            crawls and tailors it right away and returns scores and a PDF link (billed, no approval).
          </li>
          <li>
            Poll{" "}
            <Jump go={go} to="status">
              GET /api/jobs?ids=…
            </Jump>{" "}
            or{" "}
            <Jump go={go} to="get">
              GET /api/jobs/{"{id}"}
            </Jump>{" "}
            until <code className="font-mono">stage</code> is <code className="font-mono">done</code>.
          </li>
          <li>
            <Jump go={go} to="pdf">
              GET /api/jobs/{"{id}"}/pdf
            </Jump>{" "}
            downloads the tailored resume (<code className="font-mono">?kind=cover</code> for the cover letter).
          </li>
          <li>
            After applying,{" "}
            <Jump go={go} to="patch">
              PATCH /api/jobs/{"{id}"}
            </Jump>{" "}
            with <code className="font-mono">{`{"status": "applied"}`}</code>.
          </li>
        </ol>
      </section>

      <div className="grid grid-cols-2 gap-4">
        <section className="flex flex-col gap-1.5">
          <h3 className="m-0 text-[13px] font-extrabold">Statuses</h3>
          <ul className="m-0 pl-0 list-none text-[12px] text-subtle leading-[1.6]">
            {JOB_STATUS_KEYS.map((k) => (
              <li key={k}>
                <code className="font-mono text-ink">{k}</code> <span className="text-faint">{JOB_STATUSES[k].label}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="m-0 text-[13px] font-extrabold">Stages</h3>
          <p className="m-0 text-[12px] text-subtle leading-[1.6]">
            {JOB_STAGE_KEYS.map((k, i) => (
              <span key={k}>
                {i > 0 && " "}
                <code className="font-mono text-ink">{k}</code>
              </span>
            ))}
          </p>
          <p className="m-0 text-[12px] text-subtle leading-[1.6]">
            Order: {STAGE_FLOW}. A job submitted through <code className="font-mono">POST /api/jobs</code> stays{" "}
            <code className="font-mono">pending</code> until you approve it in the app.
          </p>
        </section>
      </div>

    </div>
  );
}

function RulesPage() {
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-[15px] font-extrabold tracking-[-.01em]">Limits</h3>
        <ul className="m-0 pl-5 list-disc text-[12.5px] text-subtle leading-[1.55] flex flex-col gap-1">
          {LIMITS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-[15px] font-extrabold tracking-[-.01em]">Company conflicts</h3>
        <p className="m-0 text-[12.5px] text-subtle leading-[1.55]">
          Every submit response carries <code className="font-mono text-ink">companyConflict</code> and a{" "}
          <code className="font-mono text-ink">conflicts</code> list: your jobs at the same employer (by company name, or by
          hostname for employer-owned career sites) with any status other than <code className="font-mono text-ink">not_applied</code>.
          The job is still created, since another role there may be fine; the agent decides. Send{" "}
          <code className="font-mono text-ink">skipIfConflict: true</code> to <code className="font-mono text-ink">POST /api/jobs/tailor</code>{" "}
          to refuse instead.
        </p>
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-[15px] font-extrabold tracking-[-.01em]">Dedupe</h3>
        <p className="m-0 text-[12.5px] text-subtle leading-[1.55]">
          A URL you already have (ignoring utm_* and similar tracking params) returns the existing job with{" "}
          <code className="font-mono text-ink">duplicate: true</code> instead of creating another. Duplicates don&apos;t count
          toward the daily limit.
        </p>
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-[15px] font-extrabold tracking-[-.01em]">Not available to a token</h3>
        <ul className="m-0 pl-5 list-disc text-[12.5px] text-subtle leading-[1.55] flex flex-col gap-1">
          {SESSION_ONLY.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Jump({ to, go, children }: { to: Page; go: (p: Page) => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={() => go(to)} className="bg-transparent border-0 p-0 font-mono text-[12px] text-brand cursor-pointer hover:underline">
      {children}
    </button>
  );
}

function EndpointPage({ e, origin, token, copied, copy }: { e: Endpoint; origin: string; token: string } & CopyProps) {
  const example = e.example(origin, token);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border ${METHOD_CLS[e.method]}`}>{e.method}</span>
          <code className="font-mono text-[14px] font-bold text-ink">{e.path}</code>
        </div>
        <h3 className="m-0 text-[15px] font-extrabold tracking-[-.01em]">{e.title}</h3>
        <p className="m-0 text-[12.5px] text-subtle leading-[1.55]">{e.summary}</p>
      </div>

      <Code label={`ex-${e.id}`} text={example} copied={copied} copy={copy} title="Example" />
      {e.exampleOutput && (
        <pre className="m-0 -mt-2 font-mono text-[11px] leading-[1.6] text-subtle px-3 py-2 rounded-[10px] border border-line whitespace-pre-wrap break-all">
          {e.exampleOutput.replaceAll("{origin}", origin)}
        </pre>
      )}

      {e.headers?.length ? <FieldTable title="Headers" rows={e.headers} /> : null}
      {e.query?.length ? <FieldTable title="Query parameters" rows={e.query} /> : null}
      {e.body?.length ? <FieldTable title="Body" note={e.bodyNote} rows={e.body} /> : null}

      <section className="flex flex-col gap-1.5">
        <span className="eyebrow">Responses</span>
        <ul className="m-0 pl-0 list-none text-[12.5px] text-subtle leading-[1.55] flex flex-col gap-1">
          {e.responses.map((r) => (
            <li key={r.code} className="flex gap-2">
              <code className={`font-mono text-[11.5px] font-bold flex-none w-8 ${r.code < 300 ? "text-ok-ink" : r.code < 500 ? "text-warn-ink" : "text-bad"}`}>
                {r.code}
              </code>
              <span>{r.meaning}</span>
            </li>
          ))}
        </ul>
      </section>

      {e.responseFields?.length ? <FieldTable title="Response fields" note={e.responseNote} rows={e.responseFields} /> : e.responseNote ? (
        <p className="m-0 text-[12.5px] text-subtle">{e.responseNote}</p>
      ) : null}
    </div>
  );
}

function FieldTable({ title, note, rows }: { title: string; note?: string; rows: Field[] }) {
  return (
    <section className="flex flex-col gap-1.5">
      <span className="eyebrow">{title}</span>
      {note && <p className="m-0 text-[12px] text-subtle leading-[1.5]">{note}</p>}
      <div className="border border-line-2 rounded-[10px] overflow-hidden">
        <table className="w-full border-collapse text-[12px] leading-[1.5]">
          <tbody className="divide-y divide-line">
            {rows.map((f) => (
              <tr key={f.name} className="align-top">
                <td className="px-2.5 py-1.5 w-[170px] whitespace-nowrap">
                  <code className="font-mono text-ink font-semibold">{f.name}</code>
                  {f.required && <span className="ml-1 text-[10px] font-bold text-bad uppercase">req</span>}
                </td>
                <td className="px-2 py-1.5 w-[110px] font-mono text-[11px] text-faint">{f.type}</td>
                <td className="px-2.5 py-1.5 text-subtle">{f.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Code({ label, text, title, copied, copy }: { label: string; text: string; title?: string } & CopyProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center">
        {title && <span className="eyebrow">{title}</span>}
        <button type="button" onClick={() => copy(label, text)} className={`ml-auto ${linkBtn}`}>
          {copied === label ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="m-0 font-mono text-[11.5px] leading-[1.6] bg-well text-ink px-3 py-2.5 rounded-[10px] overflow-x-auto whitespace-pre">{text}</pre>
    </div>
  );
}
