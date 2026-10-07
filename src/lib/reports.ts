import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { job, jobEvent } from "@/db/schema";
import type { JobStatus } from "./types";

// Where jobs came from: suggested by an API client, or added by the user in the app.
export const REPORT_SOURCES = { all: "All jobs", api: "Suggested (API)", app: "Added by you" } as const;
export type ReportSource = keyof typeof REPORT_SOURCES;
export const isReportSource = (s: unknown): s is ReportSource => typeof s === "string" && s in REPORT_SOURCES;

const DAY = 86_400_000;
// An application with no reply after this long is probably not getting one.
export const GHOSTED_DAYS = 30;
export const WEEKS = 12;

// One job's path through the search: when each step happened, as far as we know.
export type JobTimeline = {
  id: string;
  title: string;
  company: string;
  url: string;
  source: string;
  status: JobStatus;
  addedAt: Date;
  appliedAt: Date | null;
  interviewAt: Date | null;
  offerAt: Date | null;
  rejectedAt: Date | null;
  closedAt: Date | null;
};

export type Duration = { label: string; hint: string; days: number[] };

export type Report = {
  total: number;
  untriaged: number;
  applied: number;
  interviewed: number;
  offers: number;
  rejected: number;
  awaiting: number;
  ghosted: number;
  // Turned down before applying, or blocked by an earlier application.
  skipped: number;
  alreadyApplied: number;
  durations: Duration[];
  weeks: { start: Date; added: number; applied: number; rejected: number }[];
  timelines: JobTimeline[];
};

const daysBetween = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / DAY);

export async function getReport(userId: string, source: ReportSource): Promise<Report> {
  const [jobs, events] = await Promise.all([
    db
      .select({
        id: job.id,
        title: job.title,
        company: job.company,
        url: job.url,
        source: job.source,
        status: job.status,
        statusAt: job.statusAt,
        appliedAt: job.appliedAt,
        seenAt: job.seenAt,
        createdAt: job.createdAt,
      })
      .from(job)
      .where(eq(job.userId, userId)),
    db
      .select({ jobId: jobEvent.jobId, status: jobEvent.status, at: jobEvent.at })
      .from(jobEvent)
      .where(eq(jobEvent.userId, userId))
      .orderBy(asc(jobEvent.at)),
  ]);

  // First time each job reached each status.
  const firstAt = new Map<string, Map<JobStatus, Date>>();
  for (const e of events) {
    const m = firstAt.get(e.jobId) ?? new Map<JobStatus, Date>();
    if (!m.has(e.status)) m.set(e.status, e.at);
    firstAt.set(e.jobId, m);
  }

  const picked = jobs.filter((j) => source === "all" || (source === "app" ? j.source === "app" : j.source !== "app"));
  const timelines: JobTimeline[] = picked.map((j) => {
    const seen = firstAt.get(j.id);
    // Jobs from before status history was logged (and demo jobs) only know their current status.
    const reached = (s: JobStatus) => seen?.get(s) ?? (j.status === s ? j.statusAt : null);
    const closedStatus = j.status === "rejected" || j.status === "withdrawn" || j.status === "already_applied";
    return {
      id: j.id,
      title: j.title,
      company: j.company,
      url: j.url,
      source: j.source,
      status: j.status,
      addedAt: j.createdAt,
      appliedAt: j.appliedAt ?? seen?.get("applied") ?? null,
      interviewAt: reached("interviewing"),
      offerAt: reached("offer"),
      rejectedAt: reached("rejected"),
      closedAt: closedStatus ? j.statusAt : null,
    };
  });

  const now = Date.now();
  const applied = timelines.filter((t) => t.appliedAt);
  const awaiting = applied.filter((t) => t.status === "applied");
  const durations: Duration[] = [
    {
      label: "Added → applied",
      hint: "How long a job sat before you applied",
      days: applied.map((t) => daysBetween(t.addedAt, t.appliedAt!)),
    },
    {
      label: "Applied → interview",
      hint: "Time to the first interview",
      days: applied.filter((t) => t.interviewAt).map((t) => daysBetween(t.appliedAt!, t.interviewAt!)),
    },
    {
      label: "Applied → rejected",
      hint: "Time to hear no",
      days: applied.filter((t) => t.rejectedAt).map((t) => daysBetween(t.appliedAt!, t.rejectedAt!)),
    },
    {
      label: "Applied → offer",
      hint: "Time to an offer",
      days: applied.filter((t) => t.offerAt).map((t) => daysBetween(t.appliedAt!, t.offerAt!)),
    },
  ];

  // Monday-start weeks, oldest first, ending with the current one.
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weeks = Array.from({ length: WEEKS }, (_, i) => ({
    start: new Date(monday.getTime() - (WEEKS - 1 - i) * 7 * DAY),
    added: 0,
    applied: 0,
    rejected: 0,
  }));
  const bump = (d: Date | null, key: "added" | "applied" | "rejected") => {
    if (!d) return;
    const i = Math.floor((d.getTime() - weeks[0].start.getTime()) / (7 * DAY));
    if (i >= 0 && i < WEEKS) weeks[i][key]++;
  };
  for (const t of timelines) {
    bump(t.addedAt, "added");
    bump(t.appliedAt, "applied");
    bump(t.rejectedAt, "rejected");
  }

  return {
    total: timelines.length,
    untriaged: picked.filter((j) => j.source !== "app" && !j.seenAt && j.status === "not_applied").length,
    applied: applied.length,
    interviewed: timelines.filter((t) => t.interviewAt || t.offerAt).length,
    offers: timelines.filter((t) => t.offerAt).length,
    rejected: timelines.filter((t) => t.status === "rejected").length,
    awaiting: awaiting.length,
    ghosted: awaiting.filter((t) => now - t.appliedAt!.getTime() >= GHOSTED_DAYS * DAY).length,
    skipped: timelines.filter((t) => t.status === "withdrawn" && !t.appliedAt).length,
    alreadyApplied: timelines.filter((t) => t.status === "already_applied").length,
    durations,
    weeks,
    timelines: applied.sort((a, b) => b.appliedAt!.getTime() - a.appliedAt!.getTime()),
  };
}
