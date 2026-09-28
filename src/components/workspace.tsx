"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TailorEvent } from "@/app/api/tailor/route";
import type { Job } from "@/db/schema";
import { authClient } from "@/lib/auth-client";
import type { JobSummary } from "@/lib/data";
import { DEFAULT_PROMPT, hasUserEdits, resumeHash, type Resume, type StoredTailored } from "@/lib/types";
import { BaseResumeDrawer } from "./base-resume-drawer";
import { Logo } from "./logo";
import { baseModel, countChanges, DIFF_STYLES, ResumeDoc, tailoredModel } from "./resume-doc";
import { TailoredEditor } from "./tailored-editor";

const STEPS = [
  { label: "Fetching the posting", sub: "Firecrawl renders the page and strips nav, footers and cookie banners" },
  { label: "Extracting the job", sub: "Title, company, pay, requirements, keywords" },
  { label: "Scoring against your base resume", sub: "What already matches, what doesn't" },
  { label: "Tailoring", sub: "Small, truthful edits to wording, order and emphasis" },
];

const COVER_CHIPS = [
  "Confident but not salesy",
  "Under 250 words",
  "Lead with my strongest match",
  "Mention I'm open to relocating",
];

const TINTS = ["#0f1b3d", "#1a6fe8", "#22b55e"];

// Shared by the left (job) and right (resume) toolbars so they line up.
const toolbar = "flex items-center min-h-[61px] box-border px-5 py-2.5 bg-white border-b border-line flex-none";
const btnGhost =
  "bg-white hover:bg-canvas border border-line-2 text-ink px-3 py-2 rounded-[9px] text-[13px] font-semibold cursor-pointer whitespace-nowrap";
const btnPrimary =
  "bg-brand hover:bg-brand-hover text-white border-0 rounded-[9px] px-3.5 py-2 text-[13px] font-bold cursor-pointer disabled:opacity-60";
const btnDark =
  "bg-ink hover:bg-ink-hover text-white border-0 rounded-[9px] px-3.5 py-2 text-[13px] font-bold cursor-pointer whitespace-nowrap";

function initials(s: string) {
  const parts = s
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function when(d: Date) {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days < 1) return "Today";
  if (days < 2) return "Yesterday";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function Workspace({
  user,
  base,
  history,
  job: initialJob,
  autoUrl,
}: {
  user: { name: string; email: string };
  base: Resume | null;
  history: JobSummary[];
  job: Job | null;
  autoUrl?: string;
}) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [phase, setPhase] = useState<"idle" | "loading">("idle");
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState(autoUrl ?? "");
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<"resume" | "cover">("resume");
  const [showDiff, setShowDiff] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [prompt, setPrompt] = useState(initialJob?.prompt ?? DEFAULT_PROMPT);
  const [regen, setRegen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [baseDrawer, setBaseDrawer] = useState(false);
  const [draft, setDraft] = useState<StoredTailored | null>(null); // non-null = editing the tailored resume
  const [savingDraft, setSavingDraft] = useState(false);

  const [coverPrompt, setCoverPrompt] = useState(initialJob?.coverPrompt ?? "");
  const [cover, setCover] = useState<string[] | null>(initialJob?.coverLetter ?? null);
  const [coverBusy, setCoverBusy] = useState(false);

  const hasJob = !!job;
  const isLoading = phase === "loading";

  const model = useMemo(() => {
    if (job?.tailored) return tailoredModel(job.tailored);
    return base ? baseModel(base) : null;
  }, [job, base]);
  const changes = job?.tailored && model ? countChanges(model) : { total: 0, user: 0 };
  const editing = !!draft;
  // Tailored resumes are snapshots; flag when the base has changed since (null = tailored before we tracked it).
  const stale = useMemo(
    () => !!(job?.tailored && base && job.baseHash !== resumeHash(base)),
    [job?.tailored, job?.baseHash, base],
  );

  async function start(target: string) {
    setError(null);
    setPhase("loading");
    setStep(0);
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const ev = JSON.parse(line) as TailorEvent;
          if ("step" in ev) setStep(ev.step);
          if ("error" in ev) throw new Error(ev.error);
          if ("done" in ev) {
            router.push(`/j/${ev.done}`);
            return;
          }
        }
      }
      throw new Error("The connection closed early. Try again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("idle");
    }
  }

  const started = useRef(false);
  useEffect(() => {
    if (autoUrl && base && !started.current) {
      started.current = true;
      start(autoUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function regenerate() {
    if (!job || regen) return;
    if (job.tailored && hasUserEdits(job.tailored) && !confirm("Regenerating replaces your manual edits. Continue?"))
      return;
    setRegen(true);
    setError(null);
    const res = await fetch(`/api/jobs/${job.id}/tailor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const body = await res.json();
    setRegen(false);
    if (!res.ok) return setError(body.error ?? "Regenerate failed.");
    setJob(body);
    setPromptOpen(false);
    setShowDiff(true);
  }

  function startEditing() {
    if (!job?.tailored) return setBaseDrawer(true);
    setTab("resume");
    setPromptOpen(false);
    setDraft(structuredClone(job.tailored));
  }

  async function saveDraft() {
    if (!job || !draft) return;
    setSavingDraft(true);
    setError(null);
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tailored: draft }),
    });
    const body = await res.json();
    setSavingDraft(false);
    if (!res.ok) return setError(body.error ?? "Save failed.");
    setJob(body);
    setDraft(null);
    setShowDiff(true);
  }

  async function generateCover() {
    if (!job || coverBusy) return;
    setCoverBusy(true);
    setError(null);
    const res = await fetch(`/api/jobs/${job.id}/cover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: coverPrompt }),
    });
    const body = await res.json();
    setCoverBusy(false);
    if (!res.ok) return setError(body.error ?? "Cover letter failed.");
    setCover(body.coverLetter);
  }

  const tabCls = (on: boolean) =>
    `border-0 px-3.5 py-[7px] rounded-lg text-[13px] font-bold cursor-pointer whitespace-nowrap flex gap-1.5 items-center ${
      on ? "bg-white text-ink shadow-[0_1px_2px_rgba(15,27,61,.12)]" : "bg-transparent text-subtle"
    }`;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="flex items-center gap-3.5 px-5 py-2.5 bg-white border-b border-line flex-none min-h-[64px]">
        <Link href="/" className="hover:no-underline">
          <Logo height={26} priority />
        </Link>
        <div className="ml-auto flex gap-2 items-center">
          {hasJob && (
            <span className="text-[12px] text-faint flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-[7px] h-[7px] rounded-full bg-ok" />
              Saved to history
            </span>
          )}
          <UserMenu user={user} />
        </div>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(320px,5fr)_minmax(0,7fr)]">
        {/* LEFT: job summary */}
        <aside className="flex flex-col min-h-0 border-r border-line bg-panel">
          {job && (
            <div className={`${toolbar} gap-2.5`}>
              <div className="w-8 h-8 rounded-lg bg-ink text-white grid place-items-center font-extrabold text-[14px] flex-none">
                {job.company[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-extrabold text-[14px] tracking-[-.01em] leading-tight truncate" title={job.title}>
                  {job.title}
                </div>
                <div className="text-[12px] text-muted truncate">
                  {[job.company, job.location].filter(Boolean).join(" · ")}
                </div>
              </div>
              <HistoryMenu history={history} currentId={job.id} />
              <Link href="/" className={`${btnGhost} hover:no-underline`}>
                New job
              </Link>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-6 pb-[60px] flex flex-col gap-[22px]">
            {!hasJob && (
              <>
                <div className="flex flex-col gap-1.5">
                  <h1 className="m-0 text-[22px] leading-[1.2] font-extrabold tracking-[-.02em] text-pretty">
                    Paste a job. Get a resume built for it.
                  </h1>
                  <p className="m-0 text-[13px] leading-normal text-muted text-pretty">
                    We read the posting, make small honest edits to your base resume, and show exactly what changed.
                  </p>
                </div>

                {!base && (
                  <div className="bg-white border border-dashed border-[#b9c6de] rounded-[14px] px-[18px] py-4 flex flex-col gap-2">
                    <div className="font-bold text-[14px]">Start with your base resume</div>
                    <div className="text-[12.5px] text-subtle">
                      Upload a PDF or DOCX once. Every tailored version is built from it.
                    </div>
                    <button onClick={() => setBaseDrawer(true)} className={`${btnDark} self-start`}>
                      Add base resume →
                    </button>
                  </div>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (url.trim()) start(url.trim());
                  }}
                  className="flex flex-col gap-2"
                >
                  <label className="eyebrow" htmlFor="job-url">
                    Job URL
                  </label>
                  <input
                    id="job-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={isLoading || !base}
                    placeholder="https://jobs.example.com/senior-product-designer"
                    className="w-full box-border border border-line-2 rounded-[10px] text-[14px] px-3 py-[11px] bg-white text-ink disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !base || !url.trim()}
                    className="bg-brand hover:bg-brand-hover text-white border-0 rounded-[10px] px-4 h-[42px] text-[14px] font-bold cursor-pointer disabled:opacity-60 disabled:cursor-default"
                  >
                    {isLoading ? "Tailoring…" : "Tailor resume →"}
                  </button>
                  <div className="text-[12px] text-subtle leading-[1.6]">
                    Or prefix any posting:{" "}
                    <code className="font-mono bg-chip text-ink px-1.5 py-0.5 rounded-[5px] text-[11.5px]">
                      resume.buzz/<span className="text-brand">https://…</span>
                    </code>
                    <br />
                    Scraped with Firecrawl.
                  </div>
                  {error && <p className="m-0 text-[12.5px] text-bad">{error}</p>}
                </form>

                {isLoading && (
                  <div className="bg-white border border-line-2 rounded-[14px] px-[18px] py-4 flex flex-col gap-3.5">
                    <div className="text-[12px] text-subtle break-all">{url}</div>
                    <ol className="list-none m-0 p-0 flex flex-col gap-3">
                      {STEPS.map((st, i) => {
                        const done = i < step,
                          active = i === step;
                        return (
                          <li
                            key={i}
                            className="flex gap-2.5 items-center"
                            style={{ opacity: done || active ? 1 : 0.45 }}
                          >
                            <div
                              className="w-5 h-5 rounded-full grid place-items-center flex-none text-white text-[11px] font-extrabold border-2 box-border"
                              style={{
                                background: done ? "#22b55e" : active ? "#1a6fe8" : "#fff",
                                borderColor: done ? "#22b55e" : active ? "#1a6fe8" : "#d3dae8",
                              }}
                            >
                              {done ? "✓" : i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-semibold">{st.label}</div>
                              <div className="text-[11.5px] text-subtle leading-[1.4]">{st.sub}</div>
                            </div>
                            <span
                              className={`text-[11px] font-bold whitespace-nowrap ${done ? "text-ok-ink" : "text-brand"}`}
                            >
                              {done ? "done" : active ? "working…" : ""}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                    <div className="h-[5px] bg-chip rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-linear-to-r from-brand to-ok transition-[width] duration-500"
                        style={{ width: `${Math.min(100, Math.round((step / 4) * 100))}%` }}
                      />
                    </div>
                  </div>
                )}

                {!isLoading && history.length > 0 && (
                  <section className="flex flex-col gap-2">
                    <h3 className="m-0 eyebrow">Recent</h3>
                    <div className="bg-white border border-line-2 rounded-[14px] p-1.5 flex flex-col">
                      {history.map((h, i) => (
                        <Link
                          key={h.id}
                          href={`/j/${h.id}`}
                          className="grid grid-cols-[34px_1fr_auto] gap-2.5 items-center text-left p-2 rounded-[10px] text-inherit hover:bg-canvas hover:no-underline hover:text-inherit"
                        >
                          <div
                            className="w-[34px] h-[34px] rounded-[9px] text-white grid place-items-center font-extrabold text-[13px]"
                            style={{ background: TINTS[i % TINTS.length] }}
                          >
                            {h.company[0]?.toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-[13px] truncate text-ink">{h.title}</div>
                            <div className="text-[11.5px] text-subtle">
                              {h.company} · {when(h.createdAt)}
                            </div>
                          </div>
                          <div className="text-[11.5px] font-bold text-ok-ink bg-ok-bg px-[7px] py-[3px] rounded-full">
                            {h.score}%
                          </div>
                        </Link>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}

            {job && <JobPanel job={job} rawOpen={rawOpen} setRawOpen={setRawOpen} />}
          </div>
        </aside>

        {/* RIGHT: resume / cover letter */}
        <section className="flex flex-col min-h-0 min-w-0 overflow-x-hidden bg-well">
          <div className={`${toolbar} gap-1.5 gap-y-2 flex-wrap min-w-0`}>
            <div className="flex bg-well p-[3px] rounded-[10px] gap-0.5">
              <button onClick={() => setTab("resume")} className={tabCls(tab === "resume")}>
                Resume
              </button>
              <button
                onClick={() => {
                  if (hasJob) {
                    setTab("cover");
                    setPromptOpen(false);
                  }
                }}
                disabled={!hasJob}
                className={tabCls(tab === "cover")}
                style={{ opacity: hasJob ? 1 : 0.45 }}
              >
                Cover letter
                {cover && <span className="w-1.5 h-1.5 rounded-full bg-ok" />}
              </button>
            </div>
            {tab === "resume" && (
              <button
                onClick={editing ? undefined : startEditing}
                title={hasJob ? "Edit this resume" : "Edit base resume"}
                aria-label={hasJob ? "Edit this resume" : "Edit base resume"}
                aria-pressed={editing}
                className={`w-[34px] h-[34px] grid place-items-center rounded-[9px] border cursor-pointer ${
                  editing
                    ? "bg-user-del border-user-mark text-user-ink"
                    : "bg-white border-line-2 text-subtle hover:bg-canvas hover:text-ink"
                }`}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                </svg>
              </button>
            )}
            <div className="ml-auto flex gap-2 items-center">
              {!hasJob && <span className="text-[12.5px] text-faint whitespace-nowrap">Showing your base resume</span>}
              {editing && (
                <>
                  {error && <span className="text-[12px] text-bad">{error}</span>}
                  <button onClick={() => setBaseDrawer(true)} className={`${btnGhost} py-[7px]`}>
                    Edit base resume
                  </button>
                  <button onClick={() => setDraft(null)} className={`${btnGhost} py-[7px]`}>
                    Cancel
                  </button>
                  <button onClick={saveDraft} disabled={savingDraft} className={btnPrimary}>
                    {savingDraft ? "Saving…" : "Save edits"}
                  </button>
                </>
              )}
              {tab === "resume" && hasJob && !editing && (
                <>
                  <button
                    onClick={() => setShowDiff(!showDiff)}
                    className="flex items-center gap-2 whitespace-nowrap border px-3 py-[7px] rounded-[9px] text-[13px] font-semibold cursor-pointer"
                    style={{
                      background: showDiff ? "#e6f7ee" : "#fff",
                      borderColor: showDiff ? "#9fe0bb" : "#dbe2ef",
                      color: showDiff ? "#158a48" : "#0f1b3d",
                    }}
                  >
                    <span
                      className="w-[26px] h-4 rounded-full relative transition-colors"
                      style={{ background: showDiff ? "#22b55e" : "#c5cfe2" }}
                    >
                      <span
                        className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-[left] shadow-[0_1px_2px_rgba(0,0,0,.2)]"
                        style={{ left: showDiff ? 12 : 2 }}
                      />
                    </span>
                    Show changes
                    <span className="text-[11px] font-bold bg-ok-bg text-ok-ink px-1.5 py-0.5 rounded-full">
                      {changes.total}
                    </span>
                  </button>
                  <button
                    onClick={() => setPromptOpen(!promptOpen)}
                    className={`${btnGhost} py-[7px]`}
                    style={{ background: promptOpen ? "#eef3fc" : undefined }}
                  >
                    Prompt
                  </button>
                </>
              )}
              {!editing && (
                <button
                  onClick={() => window.print()}
                  disabled={!model || (tab === "cover" && !cover)}
                  className={`${btnDark} disabled:opacity-50`}
                >
                  Download PDF
                </button>
              )}
            </div>
          </div>

          {promptOpen && (
            <div className="bg-white border-b border-line px-5 py-3.5 flex flex-col gap-2.5 flex-none">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-bold text-[13px]">Tailoring prompt</div>
                  <div className="text-[12px] text-subtle">
                    Sent as the system prompt with your base resume + the scraped posting. Saved per job.
                  </div>
                </div>
                <button
                  onClick={() => setPrompt(DEFAULT_PROMPT)}
                  className="bg-transparent border-0 text-subtle text-[12px] font-semibold cursor-pointer"
                >
                  Reset to default
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                className="w-full box-border border border-line-2 rounded-[10px] px-3.5 py-3 text-[13px] leading-[1.55] resize-y text-ink font-mono bg-field"
              />
              <div className="flex gap-2 justify-end items-center">
                <span className="text-[12px] text-faint mr-auto">Model: Claude · scrape: Firecrawl</span>
                {error && <span className="text-[12px] text-bad">{error}</span>}
                <button onClick={() => setPromptOpen(false)} className={btnGhost}>
                  Close
                </button>
                <button onClick={regenerate} disabled={regen} className={btnPrimary}>
                  {regen ? "Regenerating…" : "Regenerate resume"}
                </button>
              </div>
            </div>
          )}

          {tab === "resume" && (
            <div className="flex-1 min-h-0 overflow-y-auto px-8 pt-7 pb-20 flex flex-col items-center gap-3.5">
              {editing && (
                <div className="w-full max-w-[720px] text-[12.5px] text-muted bg-white border border-line-2 rounded-[10px] px-3.5 py-2">
                  Click any line to edit it. Your changes are tracked separately from the AI&apos;s and shown in{" "}
                  <span className={`${DIFF_STYLES.u.swatch} rounded-[3px] px-1`}>purple</span>.
                </div>
              )}
              {stale && !editing && (
                <div className="w-full max-w-[720px] flex gap-3 items-center text-[12.5px] bg-warn-bg border border-[#f0d9a8] text-[#6b4a00] rounded-[10px] px-3.5 py-2.5">
                  <span className="flex-1">
                    <b>Your base resume changed</b> since this was tailored, so this version may be missing your latest
                    edits or ordering.
                    {job?.tailored &&
                      hasUserEdits(job.tailored) &&
                      " Re-tailoring replaces your manual edits on this job."}
                  </span>
                  {error && !promptOpen && <span className="text-bad">{error}</span>}
                  <button onClick={regenerate} disabled={regen} className={`${btnPrimary} whitespace-nowrap`}>
                    {regen ? "Re-tailoring…" : "Re-tailor"}
                  </button>
                </div>
              )}
              {showDiff && hasJob && !editing && (
                <div className="w-full max-w-[720px] flex gap-x-4 gap-y-1 flex-wrap items-center text-[12.5px] text-muted bg-white border border-line-2 rounded-[10px] px-3.5 py-2">
                  <span className="font-bold text-ink">
                    {changes.total} edits{changes.user > 0 && ` · ${changes.user} yours`}
                  </span>
                  {Object.values(DIFF_STYLES).map((d) => (
                    <span key={d.label} className="flex gap-1.5 items-center">
                      <span className={`w-3 h-3 rounded-[3px] ${d.swatch}`} />
                      {d.label}
                    </span>
                  ))}
                </div>
              )}
              {draft && base ? (
                <TailoredEditor value={draft} onChange={setDraft} name={base.name} contact={base.contact} />
              ) : model && base ? (
                <ResumeDoc
                  model={model}
                  name={base.name}
                  contact={base.contact}
                  showDiff={showDiff && hasJob}
                  dim={regen}
                />
              ) : (
                <div className="w-full max-w-[720px] border border-dashed border-line-3 rounded-[14px] px-6 py-12 text-center text-faint text-[13.5px] leading-normal">
                  Your resume will appear here once you add a base resume.
                </div>
              )}
            </div>
          )}

          {tab === "cover" && job && (
            <div className="flex-1 min-h-0 overflow-y-auto px-8 pt-7 pb-20 flex flex-col items-center gap-4">
              <div className="w-full max-w-[720px] bg-white border border-line-2 rounded-[14px] px-5 py-[18px] flex flex-col gap-2.5">
                <div className="flex justify-between items-baseline">
                  <div className="font-bold text-[14px]">Cover letter prompt</div>
                  <span className="text-[12px] text-faint">Optional · nothing is generated until you ask</span>
                </div>
                <textarea
                  value={coverPrompt}
                  onChange={(e) => setCoverPrompt(e.target.value)}
                  rows={4}
                  placeholder="Tell it how to write. Tone, length, what to lead with, anything to avoid…"
                  className="w-full box-border border border-line-2 rounded-[10px] px-3.5 py-3 text-[13.5px] leading-[1.55] resize-y text-ink bg-field"
                />
                <div className="flex gap-1.5 flex-wrap items-center">
                  {COVER_CHIPS.map((label) => (
                    <button
                      key={label}
                      onClick={() => setCoverPrompt((p) => (p ? p.replace(/\s*$/, "") + " " : "") + label + ".")}
                      className="bg-canvas border border-line rounded-full px-2.5 py-[5px] text-[12px] font-semibold text-muted cursor-pointer hover:border-brand hover:text-brand"
                    >
                      + {label}
                    </button>
                  ))}
                  <button
                    onClick={generateCover}
                    disabled={coverBusy}
                    className={`${btnPrimary} ml-auto px-4 py-[9px]`}
                  >
                    {coverBusy ? "Writing…" : cover ? "Regenerate" : "Generate cover letter"}
                  </button>
                </div>
                {error && <p className="m-0 text-[12.5px] text-bad">{error}</p>}
              </div>

              {coverBusy ? (
                <div className="w-full max-w-[720px] bg-white rounded-[4px] px-16 py-14 box-border flex flex-col gap-3">
                  {[92, 100, 96, 60, 100, 88, 40].map((w, i) => (
                    <div
                      key={i}
                      className="h-3 rounded-md bg-[#e6ebf5] animate-pulse-soft"
                      style={{ width: `${w}%`, animationDelay: `${i * 0.12}s` }}
                    />
                  ))}
                </div>
              ) : cover ? (
                <article className="print-doc w-full max-w-[720px] bg-white rounded-[4px] px-16 py-14 box-border font-serif text-ink-2 text-[14.5px] leading-[1.7] shadow-[0_1px_3px_rgba(15,27,61,.08),0_12px_32px_rgba(15,27,61,.06)]">
                  <div className="font-sans text-[12.5px] text-muted mb-6">
                    {[base?.name, base?.contact].filter(Boolean).join(" · ")}
                    <br />
                    {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </div>
                  {cover.map((p, i) => (
                    <p key={i} className="m-0 mb-3.5">
                      {p}
                    </p>
                  ))}
                  <p className="mt-5 mb-0">
                    Warmly,
                    <br />
                    {base?.name}
                  </p>
                </article>
              ) : (
                <div className="w-full max-w-[720px] border border-dashed border-line-3 rounded-[14px] px-6 py-12 text-center text-faint text-[13.5px] leading-normal">
                  Your letter will appear here. It reads the tailored resume and the posting, so generate it after
                  you&apos;re happy with the resume.
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {baseDrawer && <BaseResumeDrawer initial={base} onClose={() => setBaseDrawer(false)} />}
    </div>
  );
}

function HistoryMenu({ history, currentId }: { history: JobSummary[]; currentId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="History"
        aria-label="History"
        aria-expanded={open}
        className={`w-[34px] h-[34px] grid place-items-center rounded-[9px] border cursor-pointer ${
          open
            ? "bg-canvas border-line-3 text-ink"
            : "bg-white border-line-2 text-subtle hover:bg-canvas hover:text-ink"
        }`}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-20 w-[360px] max-h-[60vh] overflow-y-auto bg-white border border-line-2 rounded-[12px] shadow-[0_8px_24px_rgba(15,27,61,.12)] p-1.5">
            <div className="eyebrow px-2 pt-1.5 pb-2">History</div>
            {history.length === 0 && <div className="px-2 pb-2 text-[13px] text-subtle">No previous jobs yet.</div>}
            {history.map((h, i) => {
              const current = h.id === currentId;
              return (
                <Link
                  key={h.id}
                  href={`/j/${h.id}`}
                  onClick={() => setOpen(false)}
                  aria-current={current ? "page" : undefined}
                  className={`grid grid-cols-[30px_1fr_auto] gap-2.5 items-center p-2 rounded-[9px] text-inherit hover:no-underline hover:text-inherit ${
                    current ? "bg-brand-tint" : "hover:bg-canvas"
                  }`}
                >
                  <div
                    className="w-[30px] h-[30px] rounded-lg text-white grid place-items-center font-extrabold text-[12px]"
                    style={{ background: TINTS[i % TINTS.length] }}
                  >
                    {h.company[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-[13px] truncate text-ink">{h.title}</div>
                    <div className="text-[11.5px] text-subtle truncate">
                      {h.company} · {when(h.createdAt)}
                    </div>
                  </div>
                  <div className="text-[11.5px] font-bold text-ok-ink bg-ok-bg px-[7px] py-[3px] rounded-full">
                    {h.score}%
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function UserMenu({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title={user.email}
        className="w-8 h-8 rounded-full bg-brand text-white grid place-items-center text-[12px] font-bold border-0 cursor-pointer"
      >
        {initials(user.name || user.email)}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-10 bg-white border border-line-2 rounded-[10px] shadow-[0_8px_24px_rgba(15,27,61,.12)] p-1.5 min-w-[200px]">
          <div className="px-2.5 py-2 text-[12px] text-subtle truncate">{user.email}</div>
          <button
            onClick={async () => {
              await authClient.signOut();
              router.replace("/login");
              router.refresh();
            }}
            className="w-full text-left bg-transparent hover:bg-canvas border-0 rounded-md px-2.5 py-2 text-[13px] font-semibold text-ink cursor-pointer"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function JobPanel({ job, rawOpen, setRawOpen }: { job: Job; rawOpen: boolean; setRawOpen: (v: boolean) => void }) {
  const pills = [job.pay, job.employmentType, job.level].filter(Boolean);
  const reqStyle = {
    hit: { glyph: "✓", bg: "#e6f7ee", fg: "#158a48" },
    partial: { glyph: "~", bg: "#fff4dd", fg: "#a56a00" },
    miss: { glyph: "–", bg: "#fde8e8", fg: "#b23b3b" },
  } as const;

  return (
    <>
      <div className="flex flex-col gap-2.5">
        {pills.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {pills.map((p) => (
              <span
                key={p}
                className="text-[12px] font-semibold bg-white border border-line-2 px-[9px] py-1 rounded-full"
              >
                {p}
              </span>
            ))}
          </div>
        )}
        <a
          href={job.url}
          target="_blank"
          rel="noreferrer"
          className="text-[12.5px] font-semibold inline-flex gap-1.5 items-center"
        >
          Open original posting ↗
        </a>
      </div>

      <div className="bg-white border border-line-2 rounded-[14px] px-[18px] py-4 flex gap-4 items-center">
        <div
          className="relative w-16 h-16 flex-none rounded-full grid place-items-center"
          style={{ background: `conic-gradient(#22b55e ${Math.round(job.score * 3.6)}deg, #e6ebf5 0)` }}
        >
          <div className="w-[50px] h-[50px] rounded-full bg-white grid place-items-center font-extrabold text-[16px]">
            {job.score}
          </div>
        </div>
        <div className="flex-1">
          <div className="font-bold text-[14px]">Match score</div>
          <div className="text-[12.5px] text-subtle leading-[1.45]">{job.scoreNote}</div>
        </div>
      </div>

      {job.requirements.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 eyebrow">Key requirements</h3>
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {job.requirements.map((r, i) => {
              const s = reqStyle[r.status];
              return (
                <li
                  key={i}
                  className="flex gap-2.5 items-start bg-white border border-line rounded-[10px] px-3 py-[9px] text-[13px] leading-[1.45]"
                >
                  <span
                    className="w-[18px] h-[18px] rounded-full flex-none grid place-items-center text-[11px] font-extrabold mt-px"
                    style={{ background: s.bg, color: s.fg }}
                  >
                    {s.glyph}
                  </span>
                  <span className="flex-1">{r.text}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="m-0 eyebrow">Keywords</h3>
        <div className="flex flex-wrap gap-1.5">
          {job.keywordsHit.map((k) => (
            <span key={k} className="text-[12px] font-semibold bg-ok-bg text-ok-ink px-[9px] py-1 rounded-md">
              {k}
            </span>
          ))}
          {job.keywordsMissing.map((k) => (
            <span
              key={k}
              className="text-[12px] font-semibold bg-white text-bad border border-dashed border-[#e4b2b2] px-2 py-[3px] rounded-md"
            >
              {k}
            </span>
          ))}
        </div>
        <div className="text-[12px] text-faint">
          Green = in your tailored resume · red = still missing (we won&apos;t invent experience)
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <button
          onClick={() => setRawOpen(!rawOpen)}
          className="flex justify-between items-center bg-transparent border-0 p-0 cursor-pointer text-inherit"
        >
          <h3 className="m-0 eyebrow">Scraped description</h3>
          <span className="text-[12px] text-brand font-semibold">{rawOpen ? "Hide" : "Show"}</span>
        </button>
        {rawOpen && (
          <div className="bg-white border border-line rounded-[10px] px-4 py-3.5 text-[12.5px] leading-[1.6] text-muted whitespace-pre-wrap font-mono">
            {job.raw}
          </div>
        )}
      </section>
    </>
  );
}
