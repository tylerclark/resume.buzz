"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { JobSummary } from "@/lib/data";
import { companyFromUrl, JOB_STAGES, JOB_STATUSES, stageInFlight } from "@/lib/types";
import { hostOf, Spinner } from "./app-header";
import { shownScore, useJobStatus } from "./job-status";
import { StatusPicker, StatusPill } from "./status-picker";
import { confirmLeave } from "./tabs-store";

const TINTS = ["var(--color-avatar)", "var(--color-brand)", "var(--color-ok)"];

export function when(d: Date) {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days < 1) return "Today";
  if (days < 2) return "Yesterday";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Marks a job that came in through the API. It stays for good, so imported jobs are easy to spot.
export function ApiBadge() {
  return (
    <span
      title="Submitted through the API."
      className="flex-none text-[10.5px] font-bold uppercase tracking-[.04em] text-brand bg-brand-tint border border-brand-line px-1.5 py-px rounded-full leading-4"
    >
      API
    </span>
  );
}

export function JobRow({
  h,
  i,
  current,
  onNavigate,
  readOnly,
  onDelete,
}: {
  h: JobSummary;
  i: number;
  current?: boolean;
  onNavigate?: () => void;
  readOnly?: boolean;
  // Given, the row gets a "…" menu with Delete.
  onDelete?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  const applied = h.appliedAt
    ? ` · Applied ${new Date(h.appliedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : "";
  // Live view of jobs still being tailored (the server-rendered summary is a snapshot).
  const live = useJobStatus(stageInFlight(h.stage) ? h.id : null) ?? h;
  const working = stageInFlight(live.stage);
  const failed = live.stage === "failed";
  const pending = live.stage === "pending";
  // Always say who the employer is, even before (or without) a successful extraction.
  const company = live.company || h.company || companyFromUrl(h.url);
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
            style={{ background: failed ? "var(--color-bad)" : TINTS[i % TINTS.length] }}
          >
            {failed ? "!" : (company || title)[0]?.toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="font-semibold text-[13px] truncate text-ink">{title}</div>
            {h.source !== "app" && <ApiBadge />}
          </div>
          <div className="text-[11.5px] truncate text-subtle">
            {company && <span className="font-semibold text-muted">{company}</span>}
            {company && " · "}
            {working ? (
              <span className="text-brand">{JOB_STAGES[live.stage].label}…</span>
            ) : failed ? (
              <span className="text-bad">Failed · click to retry</span>
            ) : pending ? (
              <span className="text-brand">Needs your approval · {when(h.createdAt)}</span>
            ) : (
              `${when(h.createdAt)}${applied}`
            )}
          </div>
        </div>
      </Link>
      {!working &&
        !failed &&
        (readOnly ? <StatusPill status={h.status} /> : <StatusPicker key={h.status} jobId={h.id} status={h.status} />)}
      {!working && !failed && !pending && (
        <div className="text-[11.5px] font-bold text-ok-ink bg-ok-bg px-[7px] py-[3px] rounded-full">
          {shownScore(live)}%
        </div>
      )}
      {onDelete && (
        <div className="relative flex-none">
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            title="More"
            aria-label={`More options for ${title}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="w-7 h-7 grid place-items-center rounded-md border-0 bg-transparent text-faint cursor-pointer hover:bg-line-2 hover:text-ink"
          >
            <DotsIcon className="w-4 h-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div
                role="menu"
                className="absolute right-0 top-8 z-40 min-w-[190px] bg-surface border border-line-2 rounded-[10px] shadow-menu p-1.5"
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                  className="w-full text-left bg-transparent hover:bg-bad-bg border-0 rounded-md px-2.5 py-2 text-[13px] font-semibold text-bad cursor-pointer"
                >
                  {working ? "Stop and delete job" : "Delete job"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DotsIcon({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="currentColor" className={`block ${className}`}>
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
  );
}
