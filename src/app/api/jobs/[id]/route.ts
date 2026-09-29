import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { job } from "@/db/schema";
import { deleteJob, getJob, userFromRequest } from "@/lib/data";
import { isJobStatus, StoredTailoredSchema } from "@/lib/types";

export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const row = await getJob(user.id, id);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row, { headers: { "Cache-Control": "no-store" } });
}

// Deleting a job that's still being tailored also cancels it: the pipeline stops at its next write.
export async function DELETE(request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await deleteJob(user.id, id))) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}

// Save the user's manual edits to a tailored resume.
export async function PUT(request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const parsed = StoredTailoredSchema.safeParse((await request.json())?.tailored);
  if (!parsed.success) return Response.json({ error: "Invalid resume" }, { status: 400 });

  const [updated] = await db
    .update(job)
    .set({ tailored: parsed.data, updatedAt: new Date() })
    .where(and(eq(job.id, id), eq(job.userId, user.id)))
    .returning();
  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(updated);
}

// Update application status, and/or mark a background job as seen. Any status change also counts as
// seeing it (e.g. "No longer interested" straight from the list). Picking "applied" (or later) the first
// time records the applied date.
export async function PATCH(request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const { status, seen } = (await request.json()) as { status?: unknown; seen?: unknown };
  if (status !== undefined && !isJobStatus(status)) return Response.json({ error: "Invalid status" }, { status: 400 });
  if (status === undefined && seen !== true) return Response.json({ error: "Nothing to update" }, { status: 400 });

  const now = new Date();
  const [updated] = await db
    .update(job)
    .set({
      seenAt: sql`coalesce(${job.seenAt}, now())`,
      ...(status !== undefined && {
        status,
        statusAt: now,
        appliedAt:
          status === "not_applied"
            ? null
            : ["applied", "interviewing", "offer"].includes(status)
              ? sql`coalesce(${job.appliedAt}, now())`
              : undefined,
      }),
    })
    .where(and(eq(job.id, id), eq(job.userId, user.id)))
    .returning({ status: job.status, statusAt: job.statusAt, appliedAt: job.appliedAt, seenAt: job.seenAt });
  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(updated);
}
