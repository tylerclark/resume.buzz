"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "@/db/schema";
import { alignToBase } from "@/lib/align";
import type { JobSummary } from "@/lib/data";
import {
  DEFAULT_PROMPT,
  hasUserEdits,
  JOB_STAGES,
  JOB_STATUSES,
  PIPELINE_STEPS,
  resumeHash,
  stageInFlight,
  type Fact,
  type JobStage,
  type Resume,
  type StoredTailored,
} from "@/lib/types";
import { hostOf, Spinner } from "./app-header";
import { AutoTextarea } from "./auto-textarea";
import { BaseResumeDrawer } from "./base-resume-drawer";
import { shownScore, toStatus, useJobStatus, useJobStatusActions } from "./job-status";
import { StatusPicker, StatusPill } from "./status-picker";
import { baseModel, countChanges, DIFF_STYLES, ResumeDoc, tailoredModel } from "./resume-doc";
import { confirmLeave, NEW_TAB, useLeaveGuard, useTabs } from "./tabs-store";
import { TailoredEditor } from "./tailored-editor";

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

function when(d: Date) {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days < 1) return "Today";
  if (days < 2) return "Yesterday";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function Workspace({
  user,
  base,
  facts,
  history,
  job: initialJob,
  autoUrl,
}: {
  user: { name: string; email: string };
  base: Resume | null;
  facts: Fact[];
  history: JobSummary[];
  job: Job | null;
  autoUrl?: string;
}) {
  const router = useRouter();
  const tabs = useTabs();
  const { prime, poke } = useJobStatusActions();
  const [job, setJob] = useState(initialJob);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<"resume" | "cover">("resume");
  const [showDiff, setShowDiff] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [prompt, setPrompt] = useState(initialJob?.prompt ?? DEFAULT_PROMPT);
  const [rawOpen, setRawOpen] = useState(false);
  const [baseDrawer, setBaseDrawer] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [draft, setDraft] = useState<StoredTailored | null>(null); // non-null = editing the tailored resume
  const [savingDraft, setSavingDraft] = useState(false);
  const [busyAction, setBusyAction] = useState<"regen" | "cover" | "retry" | "delete" | null>(null);
  // True from the moment a re-tailor is requested until the server confirms it's queued, so the resume
  // pane reacts on click instead of waiting a round-trip (or two, when facts are saved first).
  const [retailorPending, setRetailorPending] = useState(false);

  const [coverPrompt, setCoverPrompt] = useState(initialJob?.coverPrompt ?? "");
  const [coverDraft, setCoverDraft] = useState<string | null>(null); // non-null = editing the letter (blank line = new paragraph)

  // The URL box on the "new job" tab lives in the tab store so switching tabs doesn't lose it.
  const url = tabs.draftUrl;
  const setUrl = tabs.setDraftUrl;

  const hasJob = !!job;
  const inFlight = !!job && stageInFlight(job.stage);
  const failed = job?.stage === "failed";
  const hasResume = !!job?.tailored;
  // Re-running tailoring on a job that already has a resume (prompt change, base change, new facts).
  const regen = inFlight && hasResume;
  // Show the resume skeleton: the job is being re-tailored, or we just asked for it and are waiting on the server.
  const retailoring = regen || retailorPending;
  // A brand-new job still going through scrape → extract → score → tailor.
  const building = inFlight && !hasResume;
  const cover = job?.coverLetter ?? null;
  const coverBusy = job?.coverStage === "writing";
  const coverReady = !!job?.raw && !inFlight;

  // --- Keep this job in sync with the background pipeline ---------------------------------------
  // Tell the poller what the server just rendered, and register for updates.
  const status = useJobStatus(job?.id);
  useEffect(() => {
    if (job) prime(toStatus(job));
  }, [job, prime]);
  // When the poller sees a newer version than we're showing, load it. That's how the title shows up
  // mid-pipeline, the resume appears when tailoring finishes, and the letter lands when it's written.
  const jobUpdatedAt = job ? new Date(job.updatedAt).getTime() : 0;
  useEffect(() => {
    if (!job || !status || status.missing) return;
    if (new Date(status.updatedAt).getTime() <= jobUpdatedAt) return;
    let cancelled = false;
    fetch(`/api/jobs/${job.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((fresh: Job | null) => {
        if (cancelled || !fresh) return;
        setJob(fresh);
        if (fresh.stage === "done" && job.stage !== "done") {
          setShowDiff(true);
          router.refresh(); // history lists in other views
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.updatedAt, jobUpdatedAt, job?.id]);
  // Deleted from another window: leave gracefully.
  useEffect(() => {
    if (job && status?.missing) {
      tabs.close(job.id);
      router.replace("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.missing]);

  useLeaveGuard(draft !== null || coverDraft !== null);

  const model = useMemo(() => {
    // Always follow the base resume's section/entry order, even for jobs tailored before a reorder.
    if (job?.tailored) return tailoredModel(base ? alignToBase(job.tailored, base) : job.tailored);
    return base ? baseModel(base) : null;
  }, [job, base]);
  const changes = job?.tailored && model ? countChanges(model) : { total: 0, user: 0 };
  const editing = !!draft;
  const editingHere = tab === "cover" ? coverDraft !== null : editing;
  // Tailored resumes are snapshots; flag when the base has changed since (null = tailored before we tracked it).
  const stale = useMemo(
    () => !!(job?.tailored && base && job.baseHash !== resumeHash(base)),
    [job?.tailored, job?.baseHash, base],
  );

  // A URL to scrape, or a pasted description (LinkedIn etc. block crawlers) with an optional URL.
  // Resolves true once the job exists and we're navigating to it; the message is thrown otherwise.
  async function start(source: { url?: string; description?: string }) {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(source),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      // The "new job" tab becomes this job's tab; the pipeline keeps going on the server.
      tabs.replace(NEW_TAB, body.id);
      router.replace(`/j/${body.id}`);
      return true;
    } catch (err) {
      setStarting(false);
      throw err;
    }
  }

  function startUrl(target: string) {
    start({ url: target }).catch((err) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }

  const started = useRef(false);
  useEffect(() => {
    if (autoUrl && base && !started.current) {
      started.current = true;
      setUrl(autoUrl);
      startUrl(autoUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire a background action on this job and mark it busy locally so the poller picks it up right away.
  async function kick(path: string, init: RequestInit, patch: Partial<Job>, action: typeof busyAction) {
    if (!job || busyAction) return false;
    setBusyAction(action);
    setError(null);
    const res = await fetch(`/api/jobs/${job.id}${path}`, init);
    const body = await res.json().catch(() => ({}));
    setBusyAction(null);
    if (!res.ok) {
      setError(body.error ?? "That didn't work.");
      return false;
    }
    setJob({ ...job, ...patch });
    poke(job.id, {
      stage: patch.stage,
      error: patch.error,
      coverStage: patch.coverStage,
      coverError: patch.coverError,
    });
    return true;
  }

  // "I do have this experience": remember it for every job, then re-tailor this one with it.
  async function addFacts(facts: { keyword: string; detail: string }[]) {
    setRetailorPending(true);
    try {
      const res = await fetch("/api/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facts }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? "Couldn't save that.");
        return false;
      }
      router.refresh();
      await regenerate(true);
      return true;
    } finally {
      setRetailorPending(false);
    }
  }

  async function regenerate(skipConfirm = false) {
    if (!job || inFlight) return;
    if (
      !skipConfirm &&
      job.tailored &&
      hasUserEdits(job.tailored) &&
      !confirm("Regenerating replaces your manual edits. Continue?")
    )
      return;
    setRetailorPending(true);
    try {
      const ok = await kick(
        "/tailor",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) },
        { stage: "queued", error: null, prompt },
        "regen",
      );
      if (ok) setPromptOpen(false);
    } finally {
      setRetailorPending(false);
    }
  }

  async function retry() {
    await kick("/retry", { method: "POST" }, { stage: "queued", error: null }, "retry");
  }

  // Removing a job that's still working also cancels it.
  async function discard() {
    if (!job) return;
    const msg = inFlight ? "Stop tailoring this job and remove it?" : "Remove this job?";
    if (!confirm(msg)) return;
    setBusyAction("delete");
    const res = await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
    setBusyAction(null);
    if (!res.ok && res.status !== 404) return setError("Couldn't remove it. Try again.");
    tabs.close(job.id);
    router.replace("/");
    router.refresh();
  }

  // The browser's "Save as PDF" uses document.title as the file name.
  function downloadPdf() {
    const who = base?.name.trim() || user.name || "Resume";
    const kind = tab === "cover" ? "Cover Letter" : "Resume";
    const target = job ? job.company || job.title : "";
    const name = (target ? `${who} - ${kind} for ${target}` : `${who} - ${kind}`).replace(/[\\/:*?"<>|]+/g, "-");
    const prev = document.title;
    document.title = name;
    window.addEventListener("afterprint", () => (document.title = prev), { once: true });
    window.print();
  }

  function startEditing() {
    if (!job?.tailored) return setBaseDrawer(true);
    setTab("resume");
    setPromptOpen(false);
    setDraft(structuredClone(base ? alignToBase(job.tailored, base) : job.tailored));
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

  async function saveCoverDraft() {
    if (!job || coverDraft === null) return;
    setSavingDraft(true);
    setError(null);
    const res = await fetch(`/api/jobs/${job.id}/cover`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverLetter: coverDraft.split(/\n\s*\n/) }),
    });
    const body = await res.json();
    setSavingDraft(false);
    if (!res.ok) return setError(body.error ?? "Save failed.");
    setJob(body);
    setCoverDraft(null);
  }

  async function generateCover() {
    if (!job || coverBusy) return;
    if (cover && !confirm("Replace the current letter (including any edits) with a new one?")) return;
    await kick(
      "/cover",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: coverPrompt }) },
      { coverStage: "writing", coverError: null, coverPrompt },
      "cover",
    );
  }

  const tabCls = (on: boolean) =>
    `border-0 px-3.5 py-[7px] rounded-lg text-[13px] font-bold cursor-pointer whitespace-nowrap flex gap-1.5 items-center ${
      on ? "bg-white text-ink shadow-[0_1px_2px_rgba(15,27,61,.12)]" : "bg-transparent text-subtle"
    }`;

  return (
    <div className="flex-1 min-h-0 grid grid-cols-[minmax(320px,5fr)_minmax(0,7fr)]">
      {/* LEFT: job summary */}
      <aside className="flex flex-col min-h-0 border-r border-line bg-panel">
        {job && (
          <div className={`${toolbar} gap-2.5`}>
            {building ? (
              <Spinner className="w-8 h-8 border-[3px]" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-ink text-white grid place-items-center font-extrabold text-[14px] flex-none">
                {(job.company || job.title || hostOf(job.url))[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              {job.url ? (
                <a
                  href={job.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block font-extrabold text-[14px] tracking-[-.01em] leading-tight truncate text-ink hover:text-brand"
                  title={job.title || job.url}
                >
                  {job.title || hostOf(job.url)}
                </a>
              ) : (
                <div
                  className="font-extrabold text-[14px] tracking-[-.01em] leading-tight truncate text-ink"
                  title={job.title || "Pasted posting"}
                >
                  {job.title || "Pasted posting"}
                </div>
              )}
              <div className={`text-[12px] truncate ${inFlight ? "text-brand" : failed ? "text-bad" : "text-muted"}`}>
                {inFlight
                  ? `${JOB_STAGES[job.stage].label}…`
                  : failed && !hasResume
                    ? "Failed"
                    : [job.company, job.location].filter(Boolean).join(" · ")}
              </div>
            </div>
            {hasResume && <StatusPicker key={job.status} jobId={job.id} status={job.status} />}
            <HistoryMenu history={history} currentId={job.id} />
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
                  Each job opens in its own tab, so you can start the next one while this one works.
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
                  if (url.trim()) startUrl(url.trim());
                }}
                className="flex flex-col gap-2"
              >
                <label className="eyebrow" htmlFor="job-url">
                  Job URL
                </label>
                <div className="relative">
                  <input
                    id="job-url"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={starting || !base}
                    placeholder="https://jobs.example.com/senior-product-designer"
                    className="w-full box-border border border-line-2 rounded-[10px] text-[14px] pl-3 pr-[46px] py-[11px] bg-white text-ink disabled:opacity-60 focus:border-brand focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={starting || !base || !url.trim()}
                    title="Tailor resume"
                    aria-label="Tailor resume"
                    className="absolute right-[6px] top-1/2 -translate-y-1/2 w-[32px] h-[32px] grid place-items-center bg-brand hover:bg-brand-hover text-white border-0 rounded-[8px] cursor-pointer disabled:opacity-40 disabled:cursor-default"
                  >
                    {starting && !pasteOpen ? (
                      <Spinner className="w-4 h-4 border-white border-t-transparent" />
                    ) : (
                      <ArrowIcon className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {error && !pasteOpen && <p className="m-0 text-[12.5px] text-bad">{error}</p>}
                <div className="text-[12px] text-subtle leading-[1.6]">
                  Or prefix any posting:{" "}
                  <code className="font-mono bg-chip text-ink px-1.5 py-0.5 rounded-[5px] text-[11.5px]">
                    resume.buzz/<span className="text-brand">https://…</span>
                  </code>
                </div>
                <div className="flex items-center gap-3 my-1 text-[11px] font-bold uppercase tracking-[.08em] text-faint">
                  <span className="flex-1 h-px bg-line-2" />
                  or
                  <span className="flex-1 h-px bg-line-2" />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setPasteOpen(true);
                  }}
                  disabled={starting || !base}
                  className={`${btnGhost} flex items-center justify-center gap-2 py-[11px] text-[13.5px] disabled:opacity-60 disabled:cursor-default`}
                >
                  <ClipboardIcon className="w-4 h-4 text-subtle" />
                  Paste the job description
                </button>
                <div className="text-[12px] text-subtle leading-[1.6]">
                  For LinkedIn and other sites that block crawlers: copy the posting text and paste it in.
                </div>
              </form>

              {history.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="m-0 eyebrow">Recent</h3>
                  <div className="bg-white border border-line-2 rounded-[14px] p-1.5 flex flex-col">
                    {history.map((h, i) => (
                      <JobRow key={h.id} h={h} i={i} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {job && building && (
            <ProgressCard
              url={job.url}
              pasted={job.pasted}
              stage={job.stage}
              onCancel={discard}
              cancelling={busyAction === "delete"}
            />
          )}

          {job && failed && (
            <div className="bg-white border border-[#f1c4c4] rounded-[14px] px-[18px] py-4 flex flex-col gap-3">
              <div className="flex gap-2.5 items-start">
                <span className="w-5 h-5 rounded-full bg-bad-bg text-bad grid place-items-center text-[12px] font-extrabold flex-none">
                  !
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[14px]">{hasResume ? "Re-tailoring failed" : "Tailoring failed"}</div>
                  <div className="text-[12.5px] text-muted leading-[1.5] mt-0.5 break-words">
                    {job.error || "Something went wrong."}
                  </div>
                  {!hasResume && (
                    <div className="text-[12px] text-subtle break-all mt-1.5">{job.url || "Pasted description"}</div>
                  )}
                </div>
              </div>
              {error && <p className="m-0 text-[12.5px] text-bad">{error}</p>}
              <div className="flex gap-2 justify-end">
                <button onClick={discard} disabled={!!busyAction} className={btnGhost}>
                  {busyAction === "delete" ? "Removing…" : hasResume ? "Remove job" : "Discard"}
                </button>
                <button onClick={retry} disabled={!!busyAction} className={btnPrimary}>
                  {busyAction === "retry" ? "Retrying…" : "Retry"}
                </button>
              </div>
            </div>
          )}

          {job && !!job.scoreNote && (
            <JobPanel job={job} rawOpen={rawOpen} setRawOpen={setRawOpen} onAddFacts={addFacts} busy={inFlight} />
          )}
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
                  if (coverReady) {
                    setTab("cover");
                    setPromptOpen(false);
                  }
                }}
                disabled={!coverReady}
                title={hasJob && !coverReady ? "Available once the resume is tailored" : undefined}
                className={tabCls(tab === "cover")}
                style={{ opacity: coverReady ? 1 : 0.45 }}
              >
                Cover letter
                {coverBusy ? <Spinner className="w-3 h-3" /> : cover && <span className="w-1.5 h-1.5 rounded-full bg-ok" />}
              </button>
            </div>
            {((tab === "resume" && !building) || (tab === "cover" && cover && !coverBusy)) && (
              <button
                onClick={
                  editingHere
                    ? undefined
                    : tab === "cover"
                      ? () => cover && setCoverDraft(cover.join("\n\n"))
                      : startEditing
                }
                title={tab === "cover" ? "Edit cover letter" : hasJob ? "Edit this resume" : "Edit base resume"}
                aria-label={tab === "cover" ? "Edit cover letter" : hasJob ? "Edit this resume" : "Edit base resume"}
                aria-pressed={editingHere}
                className={`w-[34px] h-[34px] grid place-items-center rounded-[9px] border cursor-pointer ${
                  editingHere
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
              {(!hasJob || building) && (
                <span className="text-[12.5px] text-faint whitespace-nowrap">
                  {building ? "Showing your base resume while this tailors" : "Showing your base resume"}
                </span>
              )}
              {editingHere && (
                <>
                  {error && <span className="text-[12px] text-bad">{error}</span>}
                  {tab === "resume" && (
                    <button onClick={() => setBaseDrawer(true)} className={`${btnGhost} py-[7px]`}>
                      Edit base resume
                    </button>
                  )}
                  <button
                    onClick={() => (tab === "cover" ? setCoverDraft(null) : setDraft(null))}
                    className={`${btnGhost} py-[7px]`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={tab === "cover" ? saveCoverDraft : saveDraft}
                    disabled={savingDraft}
                    className={btnPrimary}
                  >
                    {savingDraft ? "Saving…" : "Save edits"}
                  </button>
                </>
              )}
              {tab === "resume" && hasResume && !editing && (
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
              {!editingHere && (
                <button
                  onClick={downloadPdf}
                  disabled={!model || building || (tab === "cover" && !cover)}
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
                <button onClick={() => regenerate()} disabled={inFlight || !!busyAction} className={btnPrimary}>
                  {inFlight ? "Regenerating…" : "Regenerate resume"}
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
              {stale && !editing && !inFlight && (
                <div className="w-full max-w-[720px] flex gap-3 items-center text-[12.5px] bg-warn-bg border border-[#f0d9a8] text-[#6b4a00] rounded-[10px] px-3.5 py-2.5">
                  <span className="flex-1">
                    <b>Your base resume changed</b> since this was tailored, so this version may be missing your latest
                    edits or ordering.
                    {job?.tailored &&
                      hasUserEdits(job.tailored) &&
                      " Re-tailoring replaces your manual edits on this job."}
                  </span>
                  {error && !promptOpen && <span className="text-bad">{error}</span>}
                  <button
                    onClick={() => regenerate()}
                    disabled={!!busyAction}
                    className={`${btnPrimary} whitespace-nowrap`}
                  >
                    Re-tailor
                  </button>
                </div>
              )}
              {showDiff && hasResume && !editing && !inFlight && (
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
              {retailoring && !draft ? (
                <ResumeSkeleton name={base?.name} contact={base?.contact} />
              ) : draft && base ? (
                <TailoredEditor value={draft} onChange={setDraft} name={base.name} contact={base.contact} />
              ) : model && base ? (
                <ResumeDoc
                  model={model}
                  name={base.name}
                  contact={base.contact}
                  showDiff={showDiff && hasResume}
                  dim={inFlight}
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
              {coverDraft === null && (
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
                      disabled={coverBusy || !!busyAction}
                      className={`${btnPrimary} ml-auto px-4 py-[9px]`}
                    >
                      {coverBusy ? "Writing…" : cover ? "Regenerate" : "Generate cover letter"}
                    </button>
                  </div>
                  {(error || job.coverStage === "failed") && (
                    <p className="m-0 text-[12.5px] text-bad">{error ?? job.coverError ?? "Cover letter failed."}</p>
                  )}
                </div>
              )}

              {coverDraft !== null ? (
                <article className="w-full max-w-[720px] bg-white rounded-[4px] px-16 py-14 box-border font-serif text-ink-2 text-[14.5px] leading-[1.7] shadow-[0_1px_3px_rgba(15,27,61,.08),0_12px_32px_rgba(15,27,61,.06)] outline-2 outline-dashed outline-user-mark outline-offset-4">
                  <div className="mb-6">
                    {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </div>
                  <AutoTextarea
                    autoFocus
                    value={coverDraft}
                    onChange={(e) => setCoverDraft(e.target.value)}
                    className="w-full box-border border border-line rounded-md px-3 py-2 -mx-3 text-[14.5px] leading-[1.7] resize-none overflow-hidden bg-field font-serif text-ink-2"
                  />
                  <div className="font-sans text-[11.5px] text-faint mt-1">Leave a blank line between paragraphs.</div>
                  <p className="mt-5 mb-0">
                    Warmly,
                    <br />
                    {base?.name}
                  </p>
                </article>
              ) : coverBusy ? (
                <div className="w-full max-w-[720px] bg-white rounded-[4px] px-16 py-14 box-border flex flex-col gap-3">
                  <div className="text-[12px] text-brand font-semibold mb-2">
                    Writing… you can switch tabs; it keeps going in the background.
                  </div>
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
                  <div className="mb-6">
                    {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </div>
                  {cover.map((p, i) => (
                    <p key={i} className="m-0 mb-3.5 whitespace-pre-wrap">
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

      {baseDrawer && <BaseResumeDrawer initial={base} facts={facts} onClose={() => setBaseDrawer(false)} />}
      {pasteOpen && (
        <PasteJobModal initialUrl={url} onStart={start} onClose={() => !starting && setPasteOpen(false)} />
      )}
    </div>
  );
}

// Placeholder document shown while a resume is being re-tailored. Keeps the real name/contact so the page
// doesn't jump, and pulses resume-shaped bars (heading, role lines, bullets) like the cover letter skeleton.
function ResumeSkeleton({ name, contact }: { name?: string; contact?: string }) {
  const sections: { role: boolean; bullets: number[] }[][] = [
    [{ role: false, bullets: [100, 96, 88, 62] }],
    [
      { role: true, bullets: [98, 92, 84] },
      { role: true, bullets: [95, 70] },
      { role: true, bullets: [90, 96, 58] },
    ],
    [{ role: false, bullets: [80] }],
  ];
  let i = 0;
  const bar = (w: number | string, h = "h-3") => {
    const n = i++;
    return (
      <div
        key={n}
        className={`${h} rounded-md bg-[#e6ebf5] animate-pulse-soft`}
        style={{ width: typeof w === "number" ? `${w}%` : w, animationDelay: `${(n % 12) * 0.1}s` }}
      />
    );
  };
  return (
    <article
      aria-busy="true"
      aria-label="Re-tailoring your resume"
      className="w-full max-w-[720px] bg-white rounded-[4px] px-16 py-14 box-border font-serif text-ink-2 shadow-[0_1px_3px_rgba(15,27,61,.08),0_12px_32px_rgba(15,27,61,.06)]"
    >
      <div className="font-sans text-[12px] text-brand font-semibold mb-6 flex items-center gap-2">
        <Spinner className="w-3.5 h-3.5" />
        Re-tailoring… you can switch tabs; it keeps going in the background.
      </div>
      <header className="border-b-[1.5px] border-line-2 pb-3.5 mb-5 flex flex-col gap-2">
        {name ? <div className="text-[28px] font-semibold tracking-[-.01em] text-faint">{name}</div> : bar(40, "h-7")}
        {bar(55, "h-3.5")}
        {contact ? <div className="text-[12.5px] text-faint font-sans">{contact}</div> : bar(70, "h-3")}
      </header>
      {sections.map((entries, si) => (
        <section key={si} className="mb-6 flex flex-col gap-3">
          {bar("96px", "h-2.5")}
          {entries.map((e, ei) => (
            <div key={ei} className="flex flex-col gap-2">
              {e.role && (
                <div className="flex justify-between items-center gap-3">
                  {bar(45, "h-3.5")}
                  {bar(18, "h-2.5")}
                </div>
              )}
              <div className="pl-[18px] flex flex-col gap-2">{e.bullets.map((w) => bar(w))}</div>
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}

function ProgressCard({
  url,
  pasted,
  stage,
  onCancel,
  cancelling,
}: {
  url: string;
  pasted: boolean;
  stage: JobStage;
  onCancel: () => void;
  cancelling: boolean;
}) {
  // Pasted jobs have nothing to fetch.
  const steps: readonly JobStage[] = pasted ? PIPELINE_STEPS.filter((s) => s !== "scraping") : PIPELINE_STEPS;
  const current = steps.indexOf(stage);
  const progress = stage === "done" ? 1 : Math.max(0, current) / steps.length;
  return (
    <div className="bg-white border border-line-2 rounded-[14px] px-[18px] py-4 flex flex-col gap-3.5">
      <div className="text-[12px] text-subtle break-all">
        {pasted && <span className="text-faint">Pasted description{url ? " · " : ""}</span>}
        {url}
      </div>
      <ol className="list-none m-0 p-0 flex flex-col gap-3">
        {steps.map((st, i) => {
          const done = stage === "done" || i < current,
            active = i === current;
          return (
            <li key={st} className="flex gap-2.5 items-center" style={{ opacity: done || active ? 1 : 0.45 }}>
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
                <div className="text-[13px] font-semibold">{JOB_STAGES[st].label}</div>
                <div className="text-[11.5px] text-subtle leading-[1.4]">{JOB_STAGES[st].sub}</div>
              </div>
              <span className={`text-[11px] font-bold whitespace-nowrap ${done ? "text-ok-ink" : "text-brand"}`}>
                {done ? "done" : active ? "working…" : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="h-[5px] bg-chip rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-linear-to-r from-brand to-ok transition-[width] duration-500"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <div className="flex justify-between items-center text-[12px] text-faint">
        <span>Runs on the server. Open another tab meanwhile.</span>
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="bg-transparent border-0 p-0 text-[12px] font-semibold text-subtle cursor-pointer hover:text-bad disabled:opacity-60"
        >
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

function JobRow({
  h,
  i,
  current,
  onNavigate,
  readOnly,
}: {
  h: JobSummary;
  i: number;
  current?: boolean;
  onNavigate?: () => void;
  readOnly?: boolean;
}) {
  const applied = h.appliedAt
    ? ` · Applied ${new Date(h.appliedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : "";
  // Live view of jobs still being tailored (the server-rendered summary is a snapshot).
  const live = useJobStatus(stageInFlight(h.stage) ? h.id : null) ?? h;
  const working = stageInFlight(live.stage);
  const failed = live.stage === "failed";
  const title = live.title || h.title || hostOf(h.url) || "Pasted posting";
  return (
    <div
      className={`flex items-center gap-2.5 p-2 rounded-[10px] ${current ? "bg-brand-tint" : "hover:bg-canvas"} ${
        JOB_STATUSES[h.status].closed ? "opacity-60 hover:opacity-100" : ""
      }`}
    >
      <Link
        href={`/j/${h.id}`}
        onClick={(e) => {
          if (!current && !confirmLeave()) return e.preventDefault();
          onNavigate?.();
        }}
        aria-current={current ? "page" : undefined}
        className="flex-1 min-w-0 flex items-center gap-2.5 text-inherit hover:no-underline hover:text-inherit"
      >
        {working ? (
          <div className="w-[32px] h-[32px] flex-none grid place-items-center">
            <Spinner />
          </div>
        ) : (
          <div
            className="w-[32px] h-[32px] flex-none rounded-[9px] text-white grid place-items-center font-extrabold text-[12.5px]"
            style={{ background: failed ? "#b23b3b" : TINTS[i % TINTS.length] }}
          >
            {failed ? "!" : (live.company || title)[0]?.toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="font-semibold text-[13px] truncate text-ink">{title}</div>
          <div className={`text-[11.5px] truncate ${working ? "text-brand" : failed ? "text-bad" : "text-subtle"}`}>
            {working
              ? `${JOB_STAGES[live.stage].label}…`
              : failed
                ? "Failed · click to retry"
                : `${live.company} · ${when(h.createdAt)}${applied}`}
          </div>
        </div>
      </Link>
      {!working &&
        !failed &&
        (readOnly ? <StatusPill status={h.status} /> : <StatusPicker key={h.status} jobId={h.id} status={h.status} />)}
      {!working && !failed && (
        <div className="text-[11.5px] font-bold text-ok-ink bg-ok-bg px-[7px] py-[3px] rounded-full">
          {shownScore(live)}%
        </div>
      )}
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
              return (
                <JobRow
                  key={h.id}
                  h={h}
                  i={i}
                  current={h.id === currentId}
                  onNavigate={() => setOpen(false)}
                  readOnly
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function JobPanel({
  job,
  rawOpen,
  setRawOpen,
  onAddFacts,
  busy,
}: {
  job: Job;
  rawOpen: boolean;
  setRawOpen: (v: boolean) => void;
  onAddFacts: (facts: { keyword: string; detail: string }[]) => Promise<boolean>;
  busy: boolean;
}) {
  // Missing keywords the user has picked, in click order, with what they typed for each.
  const [picked, setPicked] = useState<string[]>([]);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const pills = [job.pay, job.employmentType, job.level].filter(Boolean);
  const requirements = job.tailoredRequirements ?? job.requirements;
  const after = job.tailoredScore;
  const delta = after === null ? 0 : after - job.score;
  const ring = after ?? job.score;

  function toggle(k: string) {
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  }
  const ready = picked.length > 0 && picked.every((k) => details[k]?.trim());
  const reqStyle = {
    hit: { glyph: "✓", bg: "#e6f7ee", fg: "#158a48" },
    partial: { glyph: "~", bg: "#fff4dd", fg: "#a56a00" },
    miss: { glyph: "–", bg: "#fde8e8", fg: "#b23b3b" },
  } as const;

  return (
    <>
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

      <div className="bg-white border border-line-2 rounded-[14px] px-[18px] py-4 flex gap-4 items-center">
        <div
          className="relative w-16 h-16 flex-none rounded-full grid place-items-center"
          style={{
            // Base score in muted green, the tailored gain layered on top in brand blue.
            background:
              after !== null && delta > 0
                ? `conic-gradient(#22b55e ${Math.round(job.score * 3.6)}deg, #1a6fe8 ${Math.round(job.score * 3.6)}deg ${Math.round(after * 3.6)}deg, #e6ebf5 0)`
                : `conic-gradient(#22b55e ${Math.round(ring * 3.6)}deg, #e6ebf5 0)`,
          }}
        >
          <div className="w-[50px] h-[50px] rounded-full bg-white grid place-items-center font-extrabold text-[16px]">
            {ring}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="font-bold text-[14px]">{after !== null ? "Tailored match" : "Match score"}</div>
            {after !== null && (
              <span
                className={`text-[11.5px] font-bold px-1.5 py-px rounded-full ${
                  delta > 0
                    ? "bg-brand-tint text-brand"
                    : delta < 0
                      ? "bg-bad-bg text-bad"
                      : "bg-well text-subtle"
                }`}
                title="Change from your base resume's score"
              >
                {delta > 0 ? `+${delta}` : delta === 0 ? "±0" : delta} vs base ({job.score})
              </span>
            )}
          </div>
          <div className="text-[12.5px] text-subtle leading-[1.45]">{job.tailoredScoreNote ?? job.scoreNote}</div>
        </div>
      </div>

      {requirements.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 eyebrow">Key requirements</h3>
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {requirements.map((r, i) => {
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

      {(job.keywordsHit.length > 0 || job.keywordsMissing.length > 0) && (
      <section className="flex flex-col gap-2">
        <h3 className="m-0 eyebrow">Keywords</h3>
        <div className="flex flex-wrap gap-1.5">
          {job.keywordsHit.map((k) => (
            <span key={k} className="text-[12px] font-semibold bg-ok-bg text-ok-ink px-[9px] py-1 rounded-md">
              {k}
            </span>
          ))}
          {job.keywordsMissing.map((k) => {
            const on = picked.includes(k);
            return (
              <button
                key={k}
                onClick={() => toggle(k)}
                aria-pressed={on}
                title={on ? "Remove from the list" : "I have this experience"}
                className={`text-[12px] font-semibold border border-dashed px-2 py-[3px] rounded-md cursor-pointer ${
                  on
                    ? "bg-bad-bg text-bad border-bad"
                    : "bg-white text-bad border-[#e4b2b2] hover:border-bad hover:bg-bad-bg"
                }`}
              >
                {on ? "✓ " : ""}
                {k}
              </button>
            );
          })}
        </div>
        {picked.length > 0 && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!ready) return;
              setSaving(true);
              const ok = await onAddFacts(picked.map((k) => ({ keyword: k, detail: details[k].trim() })));
              setSaving(false);
              if (ok) {
                setPicked([]);
                setDetails({});
              }
            }}
            className="bg-white border border-line-2 rounded-[12px] p-3.5 flex flex-col gap-3"
          >
            {picked.map((k, i) => (
              <div key={k} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <label htmlFor={`fact-${i}`} className="text-[13px] font-bold flex-1">
                    Where have you used {k}?
                  </label>
                  <button
                    type="button"
                    onClick={() => toggle(k)}
                    title={`Remove ${k}`}
                    aria-label={`Remove ${k}`}
                    className="bg-transparent border-0 text-faint text-[16px] leading-none cursor-pointer hover:text-bad"
                  >
                    ×
                  </button>
                </div>
                <textarea
                  id={`fact-${i}`}
                  autoFocus={i === picked.length - 1}
                  required
                  rows={2}
                  value={details[k] ?? ""}
                  onChange={(e) => setDetails((d) => ({ ...d, [k]: e.target.value }))}
                  placeholder={`e.g. Led ${k} work at Salesforce, 2016 to 2020`}
                  className="w-full box-border border border-line-2 rounded-[10px] px-3 py-2 text-[13px] leading-normal resize-y text-ink bg-field"
                />
              </div>
            ))}
            <div className="text-[11.5px] text-faint">
              Saved to your profile so every tailored resume can use them. Name the employer so each lands in the
              right place. Pick more keywords above to add them to this list.
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setPicked([]);
                  setDetails({});
                }}
                className={btnGhost}
              >
                Cancel
              </button>
              <button type="submit" disabled={saving || busy || !ready} className={btnPrimary}>
                {saving || busy
                  ? "Re-tailoring…"
                  : picked.length > 1
                    ? `Add ${picked.length} & re-tailor`
                    : "Add & re-tailor"}
              </button>
            </div>
          </form>
        )}
        <div className="text-[12px] text-faint">
          Green = in your tailored resume · red = not in your resume yet. Click the ones you actually have, then add
          them all at once.
        </div>
      </section>
      )}

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

function ArrowIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`block ${className}`}
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function ClipboardIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`block ${className}`}
    >
      <rect x="3" y="3" width="10" height="11.5" rx="1.8" />
      <path d="M6 3V2.2A1 1 0 0 1 7 1.2h2a1 1 0 0 1 1 1V3M5.5 7.5h5M5.5 10.5h3.5" />
    </svg>
  );
}

// Large paste-in dialog for postings we can't crawl (LinkedIn and friends). The URL is optional and only
// kept as the link back to the posting.
function PasteJobModal({
  initialUrl,
  onStart,
  onClose,
}: {
  initialUrl: string;
  onStart: (source: { url?: string; description: string }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chars = text.trim().length;
  const ready = chars >= 200 && !busy;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await onStart({ url: url.trim() || undefined, description: text.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <>
      <div onClick={() => !busy && onClose()} className="fixed inset-0 z-30 bg-[rgba(15,27,61,.45)]" />
      <div
        role="dialog"
        aria-modal
        aria-label="Paste a job description"
        className="fixed z-30 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] max-w-[94vw] h-[84vh] max-h-[860px] bg-white rounded-[16px] shadow-[0_24px_64px_rgba(15,27,61,.28)] flex flex-col overflow-hidden"
      >
        <header className="flex items-start gap-4 px-6 pt-5 pb-4 border-b border-line flex-none">
          <div className="min-w-0 flex-1">
            <div className="font-extrabold text-[16px] tracking-[-.01em]">Paste the job description</div>
            <div className="text-[12.5px] text-subtle mt-0.5">
              Copy everything from the posting: title, company, responsibilities, requirements. More is better.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="bg-transparent border-0 text-[22px] leading-none cursor-pointer text-subtle px-1 disabled:opacity-40"
          >
            ×
          </button>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex-1 min-h-0 flex flex-col gap-3 px-6 py-4"
        >
          <div className="flex flex-col gap-1.5 flex-none">
            <label className="eyebrow" htmlFor="paste-url">
              Posting URL <span className="normal-case tracking-normal font-semibold text-faint">(optional)</span>
            </label>
            <input
              id="paste-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              placeholder="https://www.linkedin.com/jobs/view/…"
              className="w-full box-border border border-line-2 rounded-[10px] text-[13.5px] px-3 py-[9px] bg-white text-ink disabled:opacity-60 focus:border-brand focus:outline-none"
            />
          </div>
          <div className="flex-1 min-h-0 flex flex-col gap-1.5">
            <label className="eyebrow" htmlFor="paste-text">
              Job description
            </label>
            <textarea
              id="paste-text"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              disabled={busy}
              placeholder={"Senior Product Designer\nAcme Inc · San Francisco, CA (Hybrid)\n\nAbout the role…"}
              className="flex-1 min-h-0 w-full box-border resize-none border border-line-2 rounded-[10px] text-[13.5px] leading-[1.55] px-3.5 py-3 bg-field text-ink disabled:opacity-60 focus:border-brand focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-3 flex-none pt-1">
            <div className="text-[12px] text-faint min-w-0 flex-1">
              {error ? (
                <span className="text-bad">{error}</span>
              ) : chars === 0 ? (
                "Nothing pasted yet."
              ) : chars < 200 ? (
                `Paste a bit more — that's only ${chars} characters.`
              ) : (
                `${chars.toLocaleString()} characters · ⌘↵ to start`
              )}
            </div>
            <button type="button" onClick={onClose} disabled={busy} className={btnGhost}>
              Cancel
            </button>
            <button type="submit" disabled={!ready} className={`${btnPrimary} h-[38px] px-4 disabled:cursor-default`}>
              {busy ? "Starting…" : "Tailor resume →"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
