import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { baseResume, job, type Job } from "@/db/schema";
import { auth } from "./auth";
import type { Resume } from "./types";

export async function userFromRequest(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
}

export async function getBaseResume(userId: string): Promise<Resume | null> {
  const [row] = await db.select().from(baseResume).where(eq(baseResume.userId, userId));
  return row?.data ?? null;
}

export async function saveBaseResume(userId: string, data: Resume) {
  await db
    .insert(baseResume)
    .values({ userId, data })
    .onConflictDoUpdate({ target: baseResume.userId, set: { data, updatedAt: new Date() } });
}

export async function getJob(userId: string, id: string): Promise<Job | null> {
  const [row] = await db.select().from(job).where(and(eq(job.id, id), eq(job.userId, userId)));
  return row ?? null;
}

export async function listJobs(userId: string, limit = 12) {
  return db
    .select({ id: job.id, title: job.title, company: job.company, score: job.score, createdAt: job.createdAt })
    .from(job)
    .where(eq(job.userId, userId))
    .orderBy(desc(job.createdAt))
    .limit(limit);
}

export type JobSummary = Awaited<ReturnType<typeof listJobs>>[number];
