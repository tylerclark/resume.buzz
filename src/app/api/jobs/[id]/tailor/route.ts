import { getBaseResume, getJob, userFromRequest } from "@/lib/data";
import { retailorJob } from "@/lib/pipeline";
import { DEFAULT_PROMPT, stageInFlight } from "@/lib/types";

export const maxDuration = 300;

// Re-run tailoring for an existing job (edited prompt, changed base resume, new facts). Runs in the
// background; poll GET /api/jobs?ids= for progress.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/tailor">) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const [row, base] = await Promise.all([getJob(user.id, id), getBaseResume(user.id)]);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  if (!base) return Response.json({ error: "Add your base resume first." }, { status: 400 });
  if (stageInFlight(row.stage)) return Response.json({ error: "This job is already being tailored." }, { status: 409 });
  if (row.stage === "pending") return Response.json({ error: "Approve this job first." }, { status: 409 });
  if (!row.raw) return Response.json({ error: "This job never finished loading. Retry it first." }, { status: 409 });

  const { prompt } = (await request.json()) as { prompt?: string };
  await retailorJob(row, prompt?.trim() || DEFAULT_PROMPT);
  return Response.json({ id, stage: "queued" }, { status: 202 });
}
