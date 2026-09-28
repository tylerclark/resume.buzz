import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { job } from "@/db/schema";
import { userFromRequest } from "@/lib/data";
import { StoredTailoredSchema } from "@/lib/types";

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
