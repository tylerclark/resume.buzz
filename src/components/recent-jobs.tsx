"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { JobSummary } from "@/lib/data";
import { DEFAULT_SORT, isJobSort, isSortDir, JOB_SORTS, type JobSort, type SortDir, stageInFlight } from "@/lib/types";
import { JobRow } from "./job-row";
import { useTabs } from "./tabs-store";

const PAGE = 25;
const SORT_KEY = "resume.buzz:recentSort";

type Page = { jobs: JobSummary[]; nextOffset: number | null };
type Sort = { key: JobSort; dir: SortDir };

const isDefaultSort = (s: Sort) => s.key === DEFAULT_SORT.key && s.dir === DEFAULT_SORT.dir;

// The chosen sort lives in localStorage so it sticks per browser; the server render assumes the default.
const sortListeners = new Set<() => void>();
function subscribeSort(cb: () => void) {
  sortListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SORT_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    sortListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
function parseSort(raw: string | null): Sort {
  try {
    const parsed = JSON.parse(raw ?? "") as Partial<Sort>;
    return isJobSort(parsed.key) && isSortDir(parsed.dir) ? { key: parsed.key, dir: parsed.dir } : DEFAULT_SORT;
  } catch {
    return DEFAULT_SORT;
  }
}
function useStoredSort(): [Sort, (s: Sort) => void] {
  const raw = useSyncExternalStore(
    subscribeSort,
    () => localStorage.getItem(SORT_KEY),
    () => null,
  );
  const sort = useMemo(() => parseSort(raw), [raw]);
  const set = useCallback((next: Sort) => {
    localStorage.setItem(SORT_KEY, JSON.stringify(next));
    for (const l of sortListeners) l();
  }, []);
  return [sort, set];
}

// The Recent list on Home: every job, searchable and sortable, loaded a page at a time as you scroll.
// The first page comes server-rendered with the page in the default order; searching, sorting or
// scrolling fetches from /api/jobs. The chosen sort sticks per browser.
export function RecentJobs({ initial }: { initial: JobSummary[] }) {
  const router = useRouter();
  const tabs = useTabs();
  const [q, setQ] = useState("");
  const [sort, setSort] = useStoredSort();
  const [jobs, setJobs] = useState(initial);
  const [nextOffset, setNextOffset] = useState<number | null>(initial.length);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const reqSeq = useRef(0);

  // With no search and the default sort, the list is the server-rendered one. Snap back to it whenever
  // that becomes true (search cleared, sort reset) or it changes (a server refresh after a status change
  // or new job).
  const serverList = !q && isDefaultSort(sort);
  const [prev, setPrev] = useState({ serverList, initial });
  if (prev.serverList !== serverList || prev.initial !== initial) {
    setPrev({ serverList, initial });
    if (serverList) {
      setLoading(false);
      setError(null);
      setJobs(initial);
      setNextOffset(initial.length);
    }
  }

  const load = useCallback(
    async (query: string, order: Sort, offset: number, replace: boolean) => {
      const seq = ++reqSeq.current;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          q: query,
          sort: order.key,
          dir: order.dir,
          offset: String(offset),
          limit: String(PAGE),
        });
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

  // Otherwise fetch page one: right away for a sort change or server refresh, debounced while typing.
  // Back on the server list, drop any response still in flight so it can't overwrite it.
  useEffect(() => {
    if (serverList) {
      reqSeq.current++;
      return;
    }
    const t = setTimeout(() => load(q, sort, 0, true), q ? 200 : 0);
    return () => clearTimeout(t);
  }, [serverList, q, sort, initial, load]);

  // Infinite scroll: when the sentinel at the bottom comes into view, fetch the next page.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || nextOffset === null) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loading) load(q, sort, nextOffset, false);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nextOffset, loading, q, sort, load]);

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
      <div className="flex items-center gap-2">
        <h3 className="m-0 eyebrow">Recent</h3>
        <SortMenu sort={sort} onChange={setSort} />
        <div className="relative w-[240px] max-w-full">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint pointer-events-none" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
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
            onClick={() => load(q, sort, jobs.length, false)}
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

// "Sort: Score ↓" button with a menu of keys. Picking the current key again flips the direction.
function SortMenu({ sort, onChange }: { sort: Sort; onChange: (s: Sort) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const flip = (d: SortDir): SortDir => (d === "asc" ? "desc" : "asc");
  const arrow = (d: SortDir) => (d === "asc" ? "↑" : "↓");

  return (
    <div className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Sort"
        className="h-8 inline-flex items-center gap-1.5 px-2.5 rounded-[9px] border border-line-2 bg-surface text-[13px] text-subtle cursor-pointer hover:text-ink hover:bg-canvas"
      >
        <SortIcon className="w-3.5 h-3.5" />
        <span className="text-ink font-semibold">{JOB_SORTS[sort.key].label}</span>
        <span aria-hidden className="text-faint">
          {arrow(sort.dir)}
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 top-9 z-40 w-[190px] bg-surface border border-line-2 rounded-[10px] shadow-menu p-1.5"
          >
            {(Object.keys(JOB_SORTS) as JobSort[]).map((k) => {
              const active = k === sort.key;
              return (
                <button
                  key={k}
                  role="menuitemradio"
                  aria-checked={active}
                  title={active ? "Flip direction" : undefined}
                  onClick={() => {
                    onChange(active ? { key: k, dir: flip(sort.dir) } : { key: k, dir: JOB_SORTS[k].dir });
                    if (!active) setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2 bg-transparent border-0 rounded-md px-2.5 py-1.5 text-[13px] text-left cursor-pointer hover:bg-canvas ${
                    active ? "bg-canvas font-semibold text-ink" : "text-ink"
                  }`}
                >
                  {JOB_SORTS[k].label}
                  {active && (
                    <span aria-hidden className="text-[12px] text-subtle">
                      {arrow(sort.dir)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SortIcon({ className = "" }: { className?: string }) {
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
      <path d="M3 4h10M3 8h7M3 12h4" />
    </svg>
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
