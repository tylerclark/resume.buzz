"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { JOB_STATUSES, type JobStatus } from "@/lib/types";

export function StatusPill({ status, className = "" }: { status: JobStatus; className?: string }) {
  return (
    <span
      className={`inline-flex items-center text-[11.5px] font-bold px-2 py-[3px] rounded-full border whitespace-nowrap ${JOB_STATUSES[status].cls} ${className}`}
    >
      {JOB_STATUSES[status].label}
    </span>
  );
}

export function StatusPicker({ jobId, status: initial }: { jobId: string; status: JobStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [open, setOpen] = useState(false);

  async function choose(next: JobStatus) {
    setOpen(false);
    if (next === status) return;
    const prev = status;
    setStatus(next); // optimistic
    const res = await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) return setStatus(prev);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change status"
        className="bg-transparent border-0 p-0 cursor-pointer"
      >
        <StatusPill status={status} className="hover:brightness-95" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 top-8 z-40 w-[210px] bg-surface border border-line-2 rounded-[10px] shadow-menu p-1.5"
          >
            {(Object.keys(JOB_STATUSES) as JobStatus[]).map((s) => (
              <button
                key={s}
                role="menuitemradio"
                aria-checked={s === status}
                onClick={() => choose(s)}
                className={`w-full flex items-center justify-between gap-2 bg-transparent border-0 rounded-md px-2 py-1.5 cursor-pointer hover:bg-canvas ${
                  s === status ? "bg-canvas" : ""
                }`}
              >
                <StatusPill status={s} />
                {s === status && <span className="text-[12px] text-subtle">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
