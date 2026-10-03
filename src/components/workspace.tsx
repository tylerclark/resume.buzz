"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "@/db/schema";
import { alignToBase } from "@/lib/align";
import type { JobSummary } from "@/lib/data";
import {
  companyFromUrl,
  explainError,
  DEFAULT_COVER_STARTERS,
  DEFAULT_PROMPT,
  hasUserEdits,
  isBackground,
  JOB_STAGES,
  MAX_COVER_STARTER_LENGTH,
  MAX_COVER_STARTERS,
  PIPELINE_STEPS,
  resumeHash,
  stageInFlight,
  type Fact,
  type JobStage,
  type JobStatus,
  type Resume,
  type StoredTailored,
} from "@/lib/types";
import { hostOf, Spinner } from "./app-header";
import { ApiBadge, JobRow, when } from "./job-row";
import { RecentJobs } from "./recent-jobs";
import { AutoTextarea } from "./auto-textarea";
import { BaseResumeDrawer } from "./base-resume-drawer";
import { toStatus, useJobStatus, useJobStatusActions } from "./job-status";
import { StatusPicker } from "./status-picker";
import { baseModel, countChanges, DIFF_STYLES, ResumeDoc, tailoredModel } from "./resume-doc";
import { useLeaveGuard, useTabs } from "./tabs-store";
import { TailoredEditor } from "./tailored-editor";

// Shared by the left (job) and right (resume) toolbars so they line up.
const toolbar = "flex items-center min-h-[61px] box-border px-5 py-2.5 bg-surface border-b border-line flex-none";
const btnGhost =
  "bg-surface hover:bg-canvas border border-line-2 text-ink px-3 py-2 rounded-[9px] text-[13px] font-semibold cursor-pointer whitespace-nowrap";
const btnPrimary =
  "bg-brand hover:bg-brand-hover text-white border-0 rounded-[9px] px-3.5 py-2 text-[13px] font-bold cursor-pointer disabled:opacity-60";
const btnDark =
  "bg-ink hover:bg-ink-hover text-on-ink border-0 rounded-[9px] px-3.5 py-2 text-[13px] font-bold cursor-pointer whitespace-nowrap";

export function Workspace({
  base,
  facts,
  coverStarters,
  history,
  job: initialJob,
  autoUrl,
}: {
  base: Resume | null;
  facts: Fact[];
  coverStarters?: string[];
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
  const [busyAction, setBusyAction] = useState<"regen" | "cover" | "retry" | "approve" | "delete" | "status" | null>(null);
  const [pdf, setPdf] = useState<"busy" | "failed" | null>(null);
  // True from the moment a re-tailor is requested until the server confirms it's queued, so the resume
  // pane reacts on click instead of waiting a round-trip (or two, when facts are saved first).
  const [retailorPending, setRetailorPending] = useState(false);

  // Single-line input: fold line breaks from prompts saved before it was one.
  const [coverPrompt, setCoverPrompt] = useState(() => (initialJob?.coverPrompt ?? "").replace(/\s*\n\s*/g, " "));
  const [starters, setStarters] = useState(coverStarters ?? DEFAULT_COVER_STARTERS);
  const [editingStarters, setEditingStarters] = useState(false);
  const [coverDraft, setCoverDraft] = useState<string | null>(null); // non-null = editing the letter (blank line = new paragraph)

  // The URL box on the Home tab lives in the tab store so switching tabs doesn't lose it.
  const url = tabs.draftUrl;
  const setUrl = tabs.setDraftUrl;

  const hasJob = !!job;
  const inFlight = !!job && stageInFlight(job.stage);
  const failed = job?.stage === "failed";
  // Submitted through the API; nothing has run yet and won't until the user approves it.
  const pending = job?.stage === "pending";
  // Who the employer is, even before (or without) a successful extraction.
  const company = job ? job.company || companyFromUrl(job.url) : "";
  const failure = failed ? explainError(job?.error) : null;
  const hasResume = !!job?.tailored;
  // Re-running tailoring on a job that already has a resume (prompt change, base change, new facts).
  const regen = inFlight && hasResume;
  // Show the resume skeleton: the job is being re-tailored, or we just asked for it and are waiting on the server.
  const retailoring = regen || retailorPending;
  // A brand-new job still going through scrape → extract → score → tailor.
  const building = inFlight && !hasResume;
  const cover = job?.coverLetter ?? null;
  const coverBusy = job?.coverStage === "writing";
  const coverReady = !!job?.raw && !inFlight && !pending;

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

  // Opening a job that arrived through the API marks it seen (it stops sorting first; the badge stays).
  useEffect(() => {
    if (!job || !isBackground(job)) return;
    fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seen: true }),
    })
      .then((r) => r.ok && router.refresh())
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

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
  const stale = useMemo(() => !!(job?.tailored && base && job.baseHash !== resumeHash(base)), [job, base]);

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
      // Open a tab for the new job next to Home; the pipeline keeps going on the server.
      tabs.start(body.id);
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

  // Start tailoring a job that came in through the API and was waiting for a go-ahead.
  async function approve() {
    await kick("/approve", { method: "POST" }, { stage: "queued", error: null }, "approve");
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

  // One-click triage from the background banner.
  async function setStatus(status: JobStatus) {
    if (!job || busyAction) return;
    setBusyAction("status");
    setError(null);
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = await res.json().catch(() => ({}));
    setBusyAction(null);
    if (!res.ok) return setError(body.error ?? "That didn't work.");
    // Turning down a job that was never tailored leaves nothing to look at here.
    if (pending && status === "withdrawn") {
      tabs.close(job.id);
      router.replace("/");
    } else setJob({ ...job, ...body });
    router.refresh();
  }

  // The server renders the PDF (real text, clickable links) and names the file.
  async function downloadPdf() {
    setPdf("busy");
    try {
      const query = new URLSearchParams({ kind: tab, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
      if (job) query.set("job", job.id);
      const res = await fetch(`/api/pdf?${query}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const name = res.headers.get("Content-Disposition")?.match(/filename\*=UTF-8''(.+)$/)?.[1];
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = name ? decodeURIComponent(name) : "Resume.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      setPdf(null);
    } catch {
      setPdf("failed");
    }
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
      on ? "bg-surface text-ink shadow-pill" : "bg-transparent text-subtle"
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
              <div className="w-8 h-8 rounded-lg bg-ink text-on-ink grid place-items-center font-extrabold text-[14px] flex-none">
                {(company || job.title || hostOf(job.url))[0]?.toUpperCase()}
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
              <div className="text-[12px] truncate text-muted">
                {inFlight || pending || (failed && !hasResume) ? (
                  <>
                    {company && <span className="font-semibold">{company} · </span>}
                    <span className={failed ? "text-bad" : "text-brand"}>
                      {failed ? "Failed" : pending ? JOB_STAGES.pending.label : `${JOB_STAGES[job.stage].label}…`}
                    </span>
                  </>
                ) : (
                  [company, job.location].filter(Boolean).join(" · ")
                )}
              </div>
            </div>
            {hasResume && <StatusPicker key={job.status} jobId={job.id} status={job.status} />}
            <HistoryMenu history={history} currentId={job.id} />
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-6 pb-[60px] flex flex-col gap-[22px]">
          {!hasJob && (
            <>

              {!base && (
                <div className="bg-surface border border-dashed border-line-dash rounded-[14px] px-[18px] py-4 flex flex-col gap-2">
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
                    autoFocus
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={starting || !base}
                    placeholder="https://jobs.example.com/senior-product-designer"
                    className="w-full box-border border border-line-2 rounded-[10px] text-[14px] pl-3 pr-[46px] py-[11px] bg-surface text-ink disabled:opacity-60 focus:border-brand focus:outline-none"
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
                <div className="flex items-center gap-3 text-[12px] text-subtle leading-[1.6]">
                  <span className="min-w-0 truncate">
                    Or prefix any posting:{" "}
                    <code className="font-mono bg-chip text-ink px-1.5 py-0.5 rounded-[5px] text-[11.5px]">
                      resume.buzz/<span className="text-brand">https://…</span>
                    </code>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setPasteOpen(true);
                    }}
                    disabled={starting || !base}
                    title="For LinkedIn and other sites that block crawlers"
                    className="ml-auto flex-none inline-flex items-center gap-1.5 bg-transparent border-0 p-0 text-[12px] font-semibold text-brand cursor-pointer hover:underline disabled:opacity-60 disabled:cursor-default disabled:no-underline"
                  >
                    <ClipboardIcon className="w-3.5 h-3.5" />
                    Paste a job
                  </button>
                </div>
              </form>

              {history.length > 0 && <RecentJobs initial={history} />}
            </>
          )}

          {job && job.source !== "app" && (job.status === "not_applied" || pending) && (
            <BackgroundCard
              job={job}
              company={company}
              ready={!inFlight && hasResume}
              busy={!!busyAction}
              error={pending ? error : null}
              onStatus={setStatus}
              onApprove={pending ? approve : undefined}
              approving={busyAction === "approve"}
            />
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
            <div className="bg-surface border border-bad-line rounded-[14px] px-[18px] py-4 flex flex-col gap-3">
              <div className="flex gap-3 items-start">
                <span className="w-7 h-7 rounded-full bg-bad-bg text-bad grid place-items-center text-[14px] font-extrabold flex-none">
                  !
                </span>
                <div className="flex-1 min-w-0">
                  <div className="eyebrow text-bad">{hasResume ? "Re-tailoring failed" : "Tailoring failed"}</div>
                  <div className="font-bold text-[14.5px] leading-snug mt-0.5">
                    {failure?.title ?? "Something went wrong"}
                  </div>
                  <div className="text-[13px] text-muted leading-[1.5] mt-1 break-words">{failure?.detail}</div>
                  {failure?.link && (
                    <a
                      href={failure.link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block mt-1.5 text-[13px] font-semibold text-brand hover:underline"
                    >
                      {failure.link.label} ↗
                    </a>
                  )}
                </div>
              </div>
              {!hasResume && (
                <div className="flex items-center gap-2 min-w-0 bg-canvas rounded-[10px] px-3 py-2 text-[12.5px]">
                  {company && <span className="font-bold text-ink flex-none">{company}</span>}
                  {job.url ? (
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noreferrer"
                      title={job.url}
                      className="min-w-0 truncate text-subtle hover:text-brand"
                    >
                      {job.title || job.url.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  ) : (
                    <span className="min-w-0 truncate text-subtle">{job.title || "Pasted description"}</span>
                  )}
                </div>
              )}
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
                    : "bg-surface border-line-2 text-subtle hover:bg-canvas hover:text-ink"
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
              {(!hasJob || building || pending) && (
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
                      background: showDiff ? "var(--color-ok-bg)" : "var(--color-surface)",
                      borderColor: showDiff ? "var(--color-ok-line)" : "var(--color-line-2)",
                      color: showDiff ? "var(--color-ok-ink)" : "var(--color-ink)",
                    }}
                  >
                    <span
                      className="w-[26px] h-4 rounded-full relative transition-colors"
                      style={{ background: showDiff ? "var(--color-ok)" : "var(--color-line-3)" }}
                    >
                      <span
                        className="absolute top-0.5 w-3 h-3 rounded-full bg-surface transition-[left] shadow-knob"
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
                    style={{ background: promptOpen ? "var(--color-brand-tint)" : undefined }}
                  >
                    Prompt
                  </button>
                </>
              )}
              {!editingHere && (
                <>
                  {pdf === "failed" && <span className="text-[12px] text-bad">Couldn&apos;t create the PDF.</span>}
                  <button
                    onClick={downloadPdf}
                    disabled={!model || building || (tab === "cover" && !cover) || pdf === "busy"}
                    className={`${btnDark} disabled:opacity-50`}
                  >
                    {pdf === "busy" ? "Preparing…" : "Download PDF"}
                  </button>
                </>
              )}
            </div>
          </div>

          {promptOpen && (
            <div className="bg-surface border-b border-line px-5 py-3.5 flex flex-col gap-2.5 flex-none">
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
                <div className="w-full max-w-[720px] text-[12.5px] text-muted bg-surface border border-line-2 rounded-[10px] px-3.5 py-2">
                  Click any line to edit it. Your changes are tracked separately from the AI&apos;s and shown in{" "}
                  <span className={`${DIFF_STYLES.u.swatch} rounded-[3px] px-1`}>purple</span>.
                </div>
              )}
              {stale && !editing && !inFlight && (
                <div className="w-full max-w-[720px] flex gap-3 items-center text-[12.5px] bg-warn-bg border border-warn-line text-warn-ink-2 rounded-[10px] px-3.5 py-2.5">
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
                <div className="w-full max-w-[720px] flex gap-x-4 gap-y-1 flex-wrap items-center text-[12.5px] text-muted bg-surface border border-line-2 rounded-[10px] px-3.5 py-2">
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
                <div className="w-full max-w-[720px] bg-surface border border-line-2 rounded-[14px] px-5 py-[18px] flex flex-col gap-2.5">
                  <div className="flex justify-between items-baseline">
                    <label htmlFor="cover-prompt" className="font-bold text-[14px]">
                      Cover letter prompt
                    </label>
                    <span className="text-[12px] text-faint">Optional · nothing is generated until you ask</span>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      generateCover();
                    }}
                    className="relative"
                  >
                    <input
                      id="cover-prompt"
                      type="text"
                      value={coverPrompt}
                      onChange={(e) => setCoverPrompt(e.target.value)}
                      disabled={coverBusy}
                      placeholder="Tone, length, what to lead with, anything to avoid…"
                      className="w-full box-border border border-line-2 rounded-[10px] text-[14px] pl-3 pr-[46px] py-[11px] bg-field text-ink disabled:opacity-60 focus:border-brand focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={coverBusy || !!busyAction}
                      title={cover ? "Regenerate cover letter" : "Generate cover letter"}
                      aria-label={cover ? "Regenerate cover letter" : "Generate cover letter"}
                      className="absolute right-[6px] top-1/2 -translate-y-1/2 w-[32px] h-[32px] grid place-items-center bg-brand hover:bg-brand-hover text-white border-0 rounded-[8px] cursor-pointer disabled:opacity-40 disabled:cursor-default"
                    >
                      {coverBusy || busyAction === "cover" ? (
                        <Spinner className="w-4 h-4 border-white border-t-transparent" />
                      ) : (
                        <ArrowIcon className="w-4 h-4" />
                      )}
                    </button>
                  </form>
                  {editingStarters ? (
                    <StartersEditor
                      initial={starters}
                      onSaved={(saved) => {
                        setStarters(saved);
                        setEditingStarters(false);
                        router.refresh(); // other job tabs
                      }}
                      onCancel={() => setEditingStarters(false)}
                    />
                  ) : (
                    <div className="flex gap-1.5 flex-wrap items-center">
                      {starters.map((label) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() =>
                            setCoverPrompt(
                              (p) => (p ? p.replace(/\s*$/, "") + " " : "") + label + (/[.!?…]$/.test(label) ? "" : "."),
                            )
                          }
                          title={label}
                          className="max-w-full truncate bg-canvas border border-line rounded-full px-2.5 py-[5px] text-[12px] font-semibold text-muted cursor-pointer hover:border-brand hover:text-brand"
                        >
                          + {label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setEditingStarters(true)}
                        className="ml-auto bg-transparent border-0 p-0 text-subtle hover:text-ink text-[12px] font-semibold cursor-pointer"
                      >
                        Edit starters
                      </button>
                    </div>
                  )}
                  {(error || job.coverStage === "failed") && (
                    <p className="m-0 text-[12.5px] text-bad">{error ?? job.coverError ?? "Cover letter failed."}</p>
                  )}
                </div>
              )}

              {coverDraft !== null ? (
                <article className="w-full max-w-[720px] bg-surface rounded-[4px] px-16 py-14 box-border font-serif text-ink-2 text-[14.5px] leading-[1.7] shadow-paper outline-2 outline-dashed outline-user-mark outline-offset-4">
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
                <div className="w-full max-w-[720px] bg-surface rounded-[4px] px-16 py-14 box-border flex flex-col gap-3">
                  <div className="text-[12px] text-brand font-semibold mb-2">
                    Writing… you can switch tabs; it keeps going in the background.
                  </div>
                  {[92, 100, 96, 60, 100, 88, 40].map((w, i) => (
                    <div
                      key={i}
                      className="h-3 rounded-md bg-skeleton animate-pulse-soft"
                      style={{ width: `${w}%`, animationDelay: `${i * 0.12}s` }}
                    />
                  ))}
                </div>
              ) : cover ? (
                <article className="print-doc w-full max-w-[720px] bg-surface rounded-[4px] px-16 py-14 box-border font-serif text-ink-2 text-[14.5px] leading-[1.7] shadow-paper">
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
                <div className="w-full max-w-[720px] border border-dashed border-line-3 rounded-[14px] px-6 py-12 text-center text-balance text-faint text-[13.5px] leading-normal">
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
        className={`${h} rounded-md bg-skeleton animate-pulse-soft`}
        style={{ width: typeof w === "number" ? `${w}%` : w, animationDelay: `${(n % 12) * 0.1}s` }}
      />
    );
  };
  return (
    <article
      aria-busy="true"
      aria-label="Re-tailoring your resume"
      className="w-full max-w-[720px] bg-surface rounded-[4px] px-16 py-14 box-border font-serif text-ink-2 shadow-paper"
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
    <div className="bg-surface border border-line-2 rounded-[14px] px-[18px] py-4 flex flex-col gap-3.5">
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
                className={`w-5 h-5 rounded-full grid place-items-center flex-none text-[11px] font-extrabold border-2 box-border ${done || active ? "text-white" : "text-faint"}`}
                style={{
                  background: done ? "var(--color-ok)" : active ? "var(--color-brand)" : "var(--color-surface)",
                  borderColor: done ? "var(--color-ok)" : active ? "var(--color-brand)" : "var(--color-line-3)",
                }}
              >
                {done ? "✓" : i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold">{JOB_STAGES[st].label}</div>
                <div className="text-[11.5px] text-subtle leading-[1.4]">{JOB_STAGES[st].sub}</div>
              </div>
              {done ? (
                <span
                  aria-label="done"
                  className="flex-none w-4 h-4 rounded-full grid place-items-center text-white"
                  style={{ background: "var(--color-ok)" }}
                >
                  <svg
                    aria-hidden
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-2.5 h-2.5"
                  >
                    <path d="M3 8.5l3 3 7-7" />
                  </svg>
                </span>
              ) : active ? (
                <Spinner className="w-4! h-4!" />
              ) : null}
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


// Shown on a job that came in through the API until it's triaged: where it came from, the client's
// notes, and the two usual outcomes.
// While the job is waiting for approval (`onApprove`), the card is the approval prompt instead: who's
// hiring, the posting, and a button to start tailoring. Nothing is fetched or sent to the model before that.
function BackgroundCard({
  job,
  company,
  ready,
  busy,
  error,
  onStatus,
  onApprove,
  approving,
}: {
  job: Job;
  company: string;
  ready: boolean;
  busy: boolean;
  error?: string | null;
  onStatus: (s: JobStatus) => void;
  onApprove?: () => void;
  approving?: boolean;
}) {
  return (
    <div className="bg-surface border border-brand-line rounded-[14px] px-[18px] py-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ApiBadge />
        <span className="text-[12.5px] text-subtle truncate">
          Sent by <span className="font-semibold text-ink">{job.source}</span> · {when(job.createdAt)}
        </span>
      </div>
      {onApprove && (
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="font-bold text-[14.5px] leading-snug">
            {company ? `Tailor your resume for ${company}?` : "Tailor your resume for this job?"}
          </div>
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noreferrer"
              title={job.url}
              className="text-[12.5px] text-subtle truncate hover:text-brand"
            >
              {job.title || job.url.replace(/^https?:\/\/(www\.)?/, "")} ↗
            </a>
          )}
          <div className="text-[12.5px] text-subtle leading-[1.5] mt-1">
            Nothing has run yet. Approving fetches the posting and tailors your resume, which uses AI credits.
          </div>
        </div>
      )}
      {job.notes && (
        <p className="m-0 text-[13px] text-muted leading-[1.55] whitespace-pre-wrap break-words">{job.notes}</p>
      )}
      {error && <p className="m-0 text-[12.5px] text-bad">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button onClick={() => onStatus("withdrawn")} disabled={busy} className={btnGhost}>
          {onApprove ? "Not interested" : "No longer interested"}
        </button>
        {onApprove ? (
          <button onClick={onApprove} disabled={busy} className={btnPrimary}>
            {approving ? "Starting…" : "Tailor resume"}
          </button>
        ) : (
          <button
            onClick={() => onStatus("applied")}
            disabled={busy || !ready}
            title={ready ? undefined : "Available once the resume is tailored"}
            className={btnPrimary}
          >
            Mark applied
          </button>
        )}
      </div>
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
            : "bg-surface border-line-2 text-subtle hover:bg-canvas hover:text-ink"
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
          <div className="absolute right-0 top-10 z-20 w-[360px] max-h-[60vh] overflow-y-auto bg-surface border border-line-2 rounded-[12px] shadow-menu p-1.5">
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
    hit: { glyph: "✓", bg: "var(--color-ok-bg)", fg: "var(--color-ok-ink)" },
    partial: { glyph: "~", bg: "var(--color-warn-bg)", fg: "var(--color-warn-ink)" },
    miss: { glyph: "–", bg: "var(--color-bad-bg)", fg: "var(--color-bad)" },
  } as const;

  return (
    <>
      {pills.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {pills.map((p) => (
            <span
              key={p}
              className="text-[12px] font-semibold bg-surface border border-line-2 px-[9px] py-1 rounded-full"
            >
              {p}
            </span>
          ))}
        </div>
      )}

      <div className="bg-surface border border-line-2 rounded-[14px] px-[18px] py-4 flex gap-4 items-center">
        <div
          className="relative w-16 h-16 flex-none rounded-full grid place-items-center"
          style={{
            // Base score in muted green, the tailored gain layered on top in brand blue.
            background:
              after !== null && delta > 0
                ? `conic-gradient(var(--color-ok) ${Math.round(job.score * 3.6)}deg, var(--color-brand) ${Math.round(job.score * 3.6)}deg ${Math.round(after * 3.6)}deg, var(--color-skeleton) 0)`
                : `conic-gradient(var(--color-ok) ${Math.round(ring * 3.6)}deg, var(--color-skeleton) 0)`,
          }}
        >
          <div className="w-[50px] h-[50px] rounded-full bg-surface grid place-items-center font-extrabold text-[16px]">
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
                  className="flex gap-2.5 items-start bg-surface border border-line rounded-[10px] px-3 py-[9px] text-[13px] leading-[1.45]"
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
                    : "bg-surface text-bad border-bad-line-2 hover:border-bad hover:bg-bad-bg"
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
            className="bg-surface border border-line-2 rounded-[12px] p-3.5 flex flex-col gap-3"
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
          <div className="bg-surface border border-line rounded-[10px] px-4 py-3.5 text-[12.5px] leading-[1.6] text-muted whitespace-pre-wrap font-mono">
            {job.raw}
          </div>
        )}
      </section>
    </>
  );
}

// Edit the one-click starter prompts under the cover letter prompt. Saved per user, so they show on every job.
function StartersEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial: string[];
  onSaved: (starters: string[]) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState(initial.length > 0 ? initial : [""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/cover-starters", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starters: rows }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(body.error ?? "Couldn't save that.");
    onSaved(body);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-2 border-t border-line pt-3"
    >
      <div className="flex justify-between items-baseline">
        <div className="font-bold text-[13px]">Starter prompts</div>
        <span className="text-[12px] text-faint">One click adds them to the prompt · saved for every job</span>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <input
            type="text"
            value={row}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? e.target.value : r)))}
            maxLength={MAX_COVER_STARTER_LENGTH}
            autoFocus={i === rows.length - 1 && !row}
            placeholder="e.g. Under 250 words, warm, lead with my strongest match"
            aria-label={`Starter prompt ${i + 1}`}
            className="flex-1 min-w-0 box-border border border-line-2 rounded-[9px] text-[13px] px-3 py-2 bg-field text-ink focus:border-brand focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
            title="Remove"
            aria-label={`Remove starter prompt ${i + 1}`}
            className="w-8 h-8 flex-none grid place-items-center bg-transparent border-0 rounded-[8px] text-[18px] leading-none text-subtle hover:text-bad hover:bg-canvas cursor-pointer"
          >
            ×
          </button>
        </div>
      ))}
      <div className="flex gap-2 items-center flex-wrap">
        <button
          type="button"
          onClick={() => setRows([...rows, ""])}
          disabled={rows.length >= MAX_COVER_STARTERS}
          className="bg-transparent border-0 p-0 text-brand text-[12px] font-semibold cursor-pointer hover:underline disabled:opacity-60 disabled:cursor-default disabled:no-underline"
        >
          + Add starter
        </button>
        <button
          type="button"
          onClick={() => setRows(DEFAULT_COVER_STARTERS)}
          className="ml-auto bg-transparent border-0 text-subtle hover:text-ink text-[12px] font-semibold cursor-pointer"
        >
          Reset to default
        </button>
        <button type="button" onClick={onCancel} className={btnGhost}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className={btnPrimary}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="m-0 text-[12.5px] text-bad">{error}</p>}
    </form>
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
      <div onClick={() => !busy && onClose()} className="fixed inset-0 z-30 bg-scrim-strong" />
      <div
        role="dialog"
        aria-modal
        aria-label="Paste a job description"
        className="fixed z-30 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] max-w-[94vw] h-[84vh] max-h-[860px] bg-surface rounded-[16px] shadow-modal flex flex-col overflow-hidden"
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
              className="w-full box-border border border-line-2 rounded-[10px] text-[13.5px] px-3 py-[9px] bg-surface text-ink disabled:opacity-60 focus:border-brand focus:outline-none"
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
