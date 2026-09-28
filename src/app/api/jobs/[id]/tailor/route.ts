import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { job } from "@/db/schema";
import { tailorResume } from "@/lib/ai";
import { getBaseResume, getJob, userFromRequest } from "@/lib/data";
import { DEFAULT_PROMPT, resumeHash } from "@/lib/types";

export const maxDuration = 300;

// Re-run tailoring for an existing job with an edited prompt.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/tailor">) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const [row, base] = await Promise.all([getJob(user.id, id), getBaseResume(user.id)]);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  if (!base) return Response.json({ error: "Add your base resume first." }, { status: 400 });

  const { prompt } = (await request.json()) as { prompt?: string };
  const tailorPrompt = prompt?.trim() || DEFAULT_PROMPT;
  try {
    const tailored = await tailorResume(base, row.raw, tailorPrompt);
    const [updated] = await db
      .update(job)
      .set({
        prompt: tailorPrompt,
        tailored,
        baseHash: resumeHash(base),
        keywordsHit: tailored.keywordsHit,
        keywordsMissing: tailored.keywordsMissing,
        updatedAt: new Date(),
      })
      .where(and(eq(job.id, id), eq(job.userId, user.id)))
      .returning();
    return Response.json(updated);
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : "Tailoring failed." }, { status: 500 });
  }
}
