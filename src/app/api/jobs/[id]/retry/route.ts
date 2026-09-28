import { getBaseResume, getJob, userFromRequest } from "@/lib/data";
import { retryJob } from "@/lib/pipeline";

export const maxDuration = 300;

// Resume a failed job from the step that didn't finish.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/retry">) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const [row, base] = await Promise.all([getJob(user.id, id), getBaseResume(user.id)]);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  if (!base) return Response.json({ error: "Add your base resume first." }, { status: 400 });
  if (row.stage !== "failed") return Response.json({ error: "This job hasn't failed." }, { status: 409 });

  await retryJob(row);
  return Response.json({ id, stage: "queued" }, { status: 202 });
}
