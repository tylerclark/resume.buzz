import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { job } from "@/db/schema";
import { writeCoverLetter } from "@/lib/ai";
import { getBaseResume, getJob, userFromRequest } from "@/lib/data";

export const maxDuration = 300;

export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/cover">) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const [row, base] = await Promise.all([getJob(user.id, id), getBaseResume(user.id)]);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  if (!base) return Response.json({ error: "Add your base resume first." }, { status: 400 });

  const { prompt = "" } = (await request.json()) as { prompt?: string };
  try {
    const coverLetter = await writeCoverLetter(base, row.tailored, row.raw, prompt);
    await db
      .update(job)
      .set({ coverPrompt: prompt, coverLetter, updatedAt: new Date() })
      .where(and(eq(job.id, id), eq(job.userId, user.id)));
    return Response.json({ coverLetter });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : "Cover letter failed." }, { status: 500 });
  }
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
    .returning({ coverLetter: job.coverLetter });
  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(updated);
}
