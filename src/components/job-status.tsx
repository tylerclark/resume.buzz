"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { JobSummary } from "@/lib/data";
import { stageInFlight, type CoverStage, type JobStage } from "@/lib/types";

// One poller for the whole app. Anything that shows a job (tab chip, history row, the workspace)
// registers the id with `useWatchJob`; while any watched job is still working, we ask the server for
// fresh status every couple of seconds and fan it out. Finished jobs aren't polled.

export type JobStatus = {
  id: string;
  url: string;
  title: string;
  company: string;
  score: number;
  status: JobSummary["status"];
  stage: JobStage;
  error: string | null;
  coverStage: CoverStage;
  coverError: string | null;
  hasCover: boolean;
  updatedAt: string;
  /** The server no longer has this job (deleted, or a stale id in localStorage). */
  missing?: boolean;
};

export const isBusy = (s: Pick<JobStatus, "stage" | "coverStage"> | undefined) =>
  !!s && (stageInFlight(s.stage) || s.coverStage === "writing");

type Ctx = {
  statuses: Record<string, JobStatus>;
  /** Push what we already know (e.g. from server-rendered props) so the poller doesn't have to fetch it. */
  prime: (s: JobStatus) => void;
  /** Mark a job as working right now and poll immediately (called after kicking off background work). */
  poke: (id: string, patch: Partial<JobStatus>) => void;
  watch: (id: string) => () => void;
};

const JobStatusContext = createContext<Ctx | null>(null);

const POLL_MS = 2000;
const HIDDEN_POLL_MS = 10_000;
const RETRY_MS = 6000;

export function JobStatusProvider({ children }: { children: React.ReactNode }) {
  const [statuses, setStatuses] = useState<Record<string, JobStatus>>({});
  const watched = useRef(new Map<string, number>());
  const [watchVersion, setWatchVersion] = useState(0);
  const [tick, setTick] = useState(0); // bumped to force an immediate poll
  const failures = useRef(0);

  const prime = useCallback((s: JobStatus) => {
    setStatuses((prev) => {
      const cur = prev[s.id];
      // Never let older data overwrite newer.
      if (cur && !cur.missing && new Date(cur.updatedAt).getTime() > new Date(s.updatedAt).getTime()) return prev;
      return { ...prev, [s.id]: s };
    });
  }, []);

  const poke = useCallback((id: string, patch: Partial<JobStatus>) => {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    setStatuses((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...defined } } : prev));
    setTick((t) => t + 1);
  }, []);

  const watch = useCallback((id: string) => {
    const m = watched.current;
    m.set(id, (m.get(id) ?? 0) + 1);
    setWatchVersion((v) => v + 1);
    return () => {
      const n = (m.get(id) ?? 1) - 1;
      if (n <= 0) m.delete(id);
      else m.set(id, n);
      setWatchVersion((v) => v + 1);
    };
  }, []);

  // Re-poll promptly when the window comes back into view.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && setTick((t) => t + 1);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Self-scheduling poll loop: runs only while something watched is unknown or still working.
  useEffect(() => {
    const ids = [...watched.current.keys()].filter((id) => {
      const s = statuses[id];
      return !s || (!s.missing && isBusy(s));
    });
    if (ids.length === 0) return;

    const unknown = ids.some((id) => !statuses[id]);
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    const delay = failures.current ? RETRY_MS : unknown ? 0 : hidden ? HIDDEN_POLL_MS : POLL_MS;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/jobs?ids=${encodeURIComponent(ids.join(","))}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const { jobs } = (await res.json()) as { jobs: JobStatus[] };
        if (cancelled) return;
        failures.current = 0;
        const seen = new Set(jobs.map((j) => j.id));
        setStatuses((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const j of jobs) {
            if (!sameStatus(prev[j.id], j)) {
              next[j.id] = j;
              changed = true;
            }
          }
          for (const id of ids) {
            if (!seen.has(id) && !prev[id]?.missing) {
              next[id] = { ...(prev[id] ?? blank(id)), missing: true };
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        setTick((t) => t + 1); // keep the loop going even when nothing changed
      } catch {
        if (cancelled) return;
        failures.current += 1;
        setTick((t) => t + 1); // schedule the retry
      }
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [statuses, watchVersion, tick]);

  const value = useMemo(() => ({ statuses, prime, poke, watch }), [statuses, prime, poke, watch]);
  return <JobStatusContext.Provider value={value}>{children}</JobStatusContext.Provider>;
}

function sameStatus(a: JobStatus | undefined, b: JobStatus) {
  return (
    !!a &&
    !a.missing &&
    a.updatedAt === b.updatedAt &&
    a.stage === b.stage &&
    a.coverStage === b.coverStage &&
    a.status === b.status &&
    a.title === b.title &&
    a.score === b.score &&
    a.hasCover === b.hasCover
  );
}

function blank(id: string): JobStatus {
  return {
    id,
    url: "",
    title: "",
    company: "",
    score: 0,
    status: "not_applied",
    stage: "failed",
    error: null,
    coverStage: "idle",
    coverError: null,
    hasCover: false,
    updatedAt: new Date(0).toISOString(),
  };
}

function useCtx() {
  const ctx = useContext(JobStatusContext);
  if (!ctx) throw new Error("useJobStatus must be used inside <JobStatusProvider>");
  return ctx;
}

export function useJobStatusActions() {
  const { prime, poke } = useCtx();
  return { prime, poke };
}

/** Live status for one job; registers it with the poller for as long as the component is mounted. */
export function useJobStatus(id: string | null | undefined): JobStatus | undefined {
  const { statuses, watch } = useCtx();
  useEffect(() => (id ? watch(id) : undefined), [id, watch]);
  return id ? statuses[id] : undefined;
}

/** Live status for many jobs (the tab bar). */
export function useJobStatuses(ids: string[]): Record<string, JobStatus> {
  const { statuses, watch } = useCtx();
  const key = ids.join("\u0000");
  useEffect(() => {
    const offs = key ? key.split("\u0000").map(watch) : [];
    return () => offs.forEach((off) => off());
  }, [key, watch]);
  return statuses;
}

export function toStatus(j: {
  id: string;
  url: string;
  title: string;
  company: string;
  score: number;
  status: JobSummary["status"];
  stage: JobStage;
  error: string | null;
  coverStage: CoverStage;
  coverError: string | null;
  coverLetter?: string[] | null;
  hasCover?: boolean;
  updatedAt: Date | string;
}): JobStatus {
  return {
    id: j.id,
    url: j.url,
    title: j.title,
    company: j.company,
    score: j.score,
    status: j.status,
    stage: j.stage,
    error: j.error,
    coverStage: j.coverStage,
    coverError: j.coverError,
    hasCover: j.hasCover ?? j.coverLetter != null,
    updatedAt: new Date(j.updatedAt).toISOString(),
  };
}
