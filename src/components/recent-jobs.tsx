"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobSummary } from "@/lib/data";
import { stageInFlight } from "@/lib/types";
import { JobRow } from "./job-row";
import { useTabs } from "./tabs-store";

const PAGE = 25;

type Page = { jobs: JobSummary[]; nextOffset: number | null };

// The Recent list on Home: every job, searchable, loaded a page at a time as you scroll. The first
// page comes server-rendered with the page; searching or scrolling fetches from /api/jobs.
export function RecentJobs({ initial }: { initial: JobSummary[] }) {
  const router = useRouter();
  const tabs = useTabs();
  const [q, setQ] = useState("");
  const [jobs, setJobs] = useState(initial);
  const [nextOffset, setNextOffset] = useState<number | null>(initial.length);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const reqSeq = useRef(0);

  // A server refresh (status change, new job) replaces the unfiltered first page.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    if (!q) {
      setJobs(initial);
      setNextOffset(initial.length);
    }
  }

  const load = useCallback(
    async (query: string, offset: number, replace: boolean) => {
      const seq = ++reqSeq.current;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: query, offset: String(offset), limit: String(PAGE) });
        const res = await fetch(`/api/jobs?${params}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const page = (await res.json()) as Page;
        if (seq !== reqSeq.current) return;
        setJobs((prev) => {
          if (replace) return page.jobs;
          const seen = new Set(prev.map((j) => j.id));
          return [...prev, ...page.jobs.filter((j) => !seen.has(j.id))];
        });
        setNextOffset(page.nextOffset);
      } catch {
        if (seq === reqSeq.current) setError("Couldn't load jobs. Try again.");
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    },
    [],
  );

  // Search: debounce, then fetch page one for the query. Clearing goes back to the server-rendered list.
  useEffect(() => {
    if (!q) return;
    const t = setTimeout(() => load(q, 0, true), 200);
    return () => clearTimeout(t);
  }, [q, load]);

  // Infinite scroll: when the sentinel at the bottom comes into view, fetch the next page.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || nextOffset === null) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loading) load(q, nextOffset, false);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nextOffset, loading, q, load]);

  // Removing a job that's still working also cancels it.
  async function remove(j: JobSummary) {
    const msg = stageInFlight(j.stage) ? "Stop tailoring this job and remove it?" : "Remove this job?";
    if (!confirm(msg)) return;
    const res = await fetch(`/api/jobs/${j.id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      alert("Couldn't remove it. Try again.");
      return;
    }
    setJobs((prev) => prev.filter((x) => x.id !== j.id));
    setNextOffset((n) => (n === null ? null : Math.max(0, n - 1)));
    tabs.close(j.id);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h3 className="m-0 eyebrow">Recent</h3>
        <div className="relative ml-auto w-[240px] max-w-full">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint pointer-events-none" />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              const v = e.target.value;
              setQ(v);
              if (!v) {
                // Back to the server-rendered list; drop any search response still in flight.
                reqSeq.current++;
                setLoading(false);
                setJobs(initial);
                setNextOffset(initial.length);
              }
            }}
            placeholder="Search title, company, URL"
            aria-label="Search jobs"
            className="w-full h-8 pl-8 pr-2.5 rounded-[9px] border border-line-2 bg-surface text-[13px] text-ink placeholder:text-faint focus:outline-none focus:border-brand"
          />
        </div>
      </div>
      <div className="bg-surface border border-line-2 rounded-[14px] p-1.5 flex flex-col">
        {jobs.map((h, i) => (
          <JobRow key={h.id} h={h} i={i} onDelete={() => remove(h)} />
        ))}
        {jobs.length === 0 && !loading && (
          <div className="px-2.5 py-3 text-[13px] text-subtle">{q ? `No jobs match “${q}”.` : "No jobs yet."}</div>
        )}
        {error && (
          <button
            type="button"
            onClick={() => load(q, jobs.length, false)}
            className="m-1 bg-transparent border-0 text-[12.5px] text-bad cursor-pointer hover:underline"
          >
            {error}
          </button>
        )}
        {loading && <div className="px-2.5 py-2 text-[12px] text-faint">Loading…</div>}
        <div ref={sentinel} aria-hidden className="h-px" />
      </div>
    </section>
  );
}

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className={`block ${className}`}
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  );
}
