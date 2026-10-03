import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { job } from "@/db/schema";
import { getBaseResume, getJob, userFromRequest } from "@/lib/data";
import { startCoverLetter } from "@/lib/pipeline";
import { stageInFlight } from "@/lib/types";

export const maxDuration = 300;

// Write the letter in the background; the job's coverStage goes "writing" → "idle" (or "failed").
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/cover">) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const [row, base] = await Promise.all([getJob(user.id, id), getBaseResume(user.id)]);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  if (!base) return Response.json({ error: "Add your base resume first." }, { status: 400 });
  if (stageInFlight(row.stage) || row.stage === "pending" || !row.raw)
    return Response.json({ error: "Wait for the resume to finish tailoring first." }, { status: 409 });
  if (row.coverStage === "writing")
    return Response.json({ error: "A cover letter is already being written." }, { status: 409 });

  const { prompt = "" } = (await request.json()) as { prompt?: string };
  await startCoverLetter(row, prompt);
  return Response.json({ id, coverStage: "writing" }, { status: 202 });
}

// Save the user's edits to a generated letter.
export async function PUT(request: Request, ctx: RouteContext<"/api/jobs/[id]/cover">) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const { coverLetter } = (await request.json()) as { coverLetter?: unknown };
  if (!Array.isArray(coverLetter) || !coverLetter.every((p) => typeof p === "string"))
    return Response.json({ error: "Invalid letter" }, { status: 400 });

  const paragraphs = coverLetter.map((p) => p.trim()).filter(Boolean);
  const [updated] = await db
    .update(job)
    .set({ coverLetter: paragraphs, updatedAt: new Date() })
    .where(and(eq(job.id, id), eq(job.userId, user.id)))
    .returning();
  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(updated);
}
