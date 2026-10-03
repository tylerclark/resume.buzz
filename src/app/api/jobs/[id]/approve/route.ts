import { getBaseResume, getJob, userFromRequest } from "@/lib/data";
import { approveJob } from "@/lib/pipeline";

export const maxDuration = 300;

// Start tailoring a job that was submitted through the API and is waiting for approval. Session only:
// an API token can submit jobs but can't approve them.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/approve">) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const [row, base] = await Promise.all([getJob(user.id, id), getBaseResume(user.id)]);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  if (!base) return Response.json({ error: "Add your base resume first." }, { status: 400 });
  if (row.stage !== "pending" || !(await approveJob(row)))
    return Response.json({ error: "This job isn't waiting for approval." }, { status: 409 });

  return Response.json({ id, stage: "queued" }, { status: 202 });
}
