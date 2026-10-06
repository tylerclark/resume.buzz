import "server-only";
import { and, desc, eq, gt, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { baseResume, job, type Job } from "@/db/schema";
import { userFromHeaders } from "./auth";
import {
  canonicalJobUrl,
  companyFromUrl,
  companyKey,
  DEFAULT_COVER_STARTERS,
  DEFAULT_SORT,
  type Fact,
  isSharedJobHost,
  jobHost,
  type JobSort,
  type JobStatus,
  type Resume,
  type SortDir,
  STAGE_TIMEOUT_MESSAGE,
  STAGE_TIMEOUT_MS,
  stageInFlight,
} from "./types";

export function userFromRequest(request: Request) {
  return userFromHeaders(request.headers);
}

export async function getBaseResume(userId: string): Promise<Resume | null> {
  const [row] = await db.select().from(baseResume).where(eq(baseResume.userId, userId));
  return row?.data ?? null;
}

export async function getFacts(userId: string): Promise<Fact[]> {
  const [row] = await db.select({ facts: baseResume.facts }).from(baseResume).where(eq(baseResume.userId, userId));
  return row?.facts ?? [];
}

export async function setFacts(userId: string, facts: Fact[]) {
  const [row] = await db
    .update(baseResume)
    .set({ facts })
    .where(eq(baseResume.userId, userId))
    .returning({ facts: baseResume.facts });
  return row?.facts ?? null;
}

export async function getCoverStarters(userId: string): Promise<string[]> {
  const [row] = await db
    .select({ coverStarters: baseResume.coverStarters })
    .from(baseResume)
    .where(eq(baseResume.userId, userId));
  return row?.coverStarters ?? DEFAULT_COVER_STARTERS;
}

export async function setCoverStarters(userId: string, coverStarters: string[]) {
  const [row] = await db
    .update(baseResume)
    .set({ coverStarters })
    .where(eq(baseResume.userId, userId))
    .returning({ coverStarters: baseResume.coverStarters });
  return row?.coverStarters ?? null;
}

export async function saveBaseResume(userId: string, data: Resume) {
  await db
    .insert(baseResume)
    .values({ userId, data })
    .onConflictDoUpdate({ target: baseResume.userId, set: { data, updatedAt: new Date() } });
}

// A pipeline that stopped reporting progress (killed function, crash before the failure write) would
// otherwise spin forever. Every read goes through here so the UI sees it as failed and offers a retry.
export function settleStale<T extends Pick<Job, "stage" | "error" | "coverStage" | "coverError" | "updatedAt">>(
  row: T,
): T {
  const stuck = Date.now() - new Date(row.updatedAt).getTime() > STAGE_TIMEOUT_MS;
  if (!stuck) return row;
  const out = { ...row };
  if (stageInFlight(row.stage)) {
    out.stage = "failed";
    out.error = STAGE_TIMEOUT_MESSAGE;
  }
  if (row.coverStage === "writing") {
    out.coverStage = "failed";
    out.coverError = STAGE_TIMEOUT_MESSAGE;
  }
  return out;
}

export async function getJob(userId: string, id: string): Promise<Job | null> {
  const [row] = await db
    .select()
    .from(job)
    .where(and(eq(job.id, id), eq(job.userId, userId)));
  return row ? settleStale(row) : null;
}

export async function deleteJob(userId: string, id: string) {
  const rows = await db
    .delete(job)
    .where(and(eq(job.id, id), eq(job.userId, userId)))
    .returning({ id: job.id });
  return rows.length > 0;
}

// The fields the tab bar / history rows / poller need. Small enough to fetch for many jobs at once.
const summaryColumns = {
  id: job.id,
  url: job.url,
  title: job.title,
  company: job.company,
  pay: job.pay,
  score: job.score,
  tailoredScore: job.tailoredScore,
  status: job.status,
  stage: job.stage,
  error: job.error,
  coverStage: job.coverStage,
  coverError: job.coverError,
  hasCover: sql<boolean>`${job.coverLetter} is not null`,
  source: job.source,
  seenAt: job.seenAt,
  statusAt: job.statusAt,
  appliedAt: job.appliedAt,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
};

// ORDER BY for a job list. In the default order, jobs prepared in the background that haven't been looked
// at yet come first; an explicitly chosen sort is left pure. Then the chosen key; ties (and everything for
// "status") fall back to newest first, with the id as a final tiebreak so pagination is stable.
function jobOrder(sort: JobSort, dir: SortDir) {
  const key = {
    // To-do (not applied, or in conversation) → applied → already applied → rejected → no longer interested.
    status: sql`case ${job.status} when 'applied' then 1 when 'already_applied' then 2 when 'rejected' then 3 when 'withdrawn' then 4 else 0 end`,
    score: sql`coalesce(${job.tailoredScore}, ${job.score})`,
    applied: job.appliedAt,
    created: job.createdAt,
    updated: job.updatedAt,
    title: sql`lower(nullif(${job.title}, ''))`,
    company: sql`lower(nullif(${job.company}, ''))`,
  }[sort];
  return [
    ...(sort === DEFAULT_SORT.key ? [sql`(${job.source} <> 'app' and ${job.seenAt} is null) desc`] : []),
    sql`${key} ${sql.raw(dir)} nulls last`,
    desc(job.createdAt),
    desc(job.id),
  ];
}

export async function listJobs(userId: string, limit = 12) {
  const rows = await db
    .select(summaryColumns)
    .from(job)
    .where(eq(job.userId, userId))
    .orderBy(...jobOrder(DEFAULT_SORT.key, DEFAULT_SORT.dir))
    .limit(limit);
  return rows.map(settleStale);
}

// The Recent list: optionally filtered by a substring of the title, company or URL, in the chosen order,
// one page at a time.
export async function searchJobs(
  userId: string,
  opts: { q?: string; status?: JobStatus[]; sort?: JobSort; dir?: SortDir; offset?: number; limit?: number } = {},
) {
  const q = (opts.q ?? "").trim();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = await db
    .select(summaryColumns)
    .from(job)
    .where(
      and(
        eq(job.userId, userId),
        pattern ? or(ilike(job.title, pattern), ilike(job.company, pattern), ilike(job.url, pattern)) : undefined,
        opts.status?.length ? inArray(job.status, opts.status) : undefined,
      ),
    )
    .orderBy(...jobOrder(opts.sort ?? DEFAULT_SORT.key, opts.dir ?? DEFAULT_SORT.dir))
    .offset(offset)
    .limit(limit + 1);
  const page = rows.slice(0, limit).map(settleStale);
  return { jobs: page, nextOffset: rows.length > limit ? offset + limit : null };
}

export async function listJobsByIds(userId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select(summaryColumns)
    .from(job)
    .where(and(eq(job.userId, userId), inArray(job.id, ids)));
  return rows.map(settleStale);
}

export type JobSummary = Awaited<ReturnType<typeof listJobs>>[number];

// For de-duplicating API submissions: the id of the user's newest job for the same posting, comparing
// canonical URLs so tracking params on either side don't matter. One user's job list is small.
export async function findJobIdByUrl(userId: string, canonical: string) {
  const rows = await db
    .select({ id: job.id, url: job.url })
    .from(job)
    .where(and(eq(job.userId, userId), ne(job.url, "")))
    .orderBy(desc(job.createdAt));
  return rows.find((r) => canonicalJobUrl(r.url) === canonical)?.id ?? null;
}

// For warning API clients off employers the user has already dealt with: the user's jobs at the same
// company (by loose name match, falling back to the company a job-board URL implies) or on the same
// employer-owned site, with any status other than "not applied". Hosts shared by many employers
// (LinkedIn, jobs.ashbyhq.com…) never count as an employer site.
export async function findActedJobsByCompany(userId: string, company: string, url: string) {
  const key = companyKey(company || companyFromUrl(url));
  const host = jobHost(url);
  const hostKey = host && !isSharedJobHost(host) ? host : "";
  if (!key && !hostKey) return [];
  const rows = await db
    .select({ id: job.id, title: job.title, company: job.company, url: job.url, status: job.status })
    .from(job)
    .where(and(eq(job.userId, userId), ne(job.status, "not_applied")))
    .orderBy(desc(job.createdAt));
  return rows.filter(
    (r) =>
      (key && companyKey(r.company || companyFromUrl(r.url)) === key) || (hostKey && jobHost(r.url) === hostKey),
  );
}

// API submissions in the last 24h, for the daily cap.
export async function countRecentApiJobs(userId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(job)
    .where(and(eq(job.userId, userId), ne(job.source, "app"), gt(job.createdAt, new Date(Date.now() - 86_400_000))));
  return row?.n ?? 0;
}
