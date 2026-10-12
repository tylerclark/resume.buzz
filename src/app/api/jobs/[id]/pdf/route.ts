import { userFromSessionOrToken } from "@/lib/api-tokens";
import { getBaseResume, getJob } from "@/lib/data";
import { buildPdf, pdfResponse } from "@/lib/pdf";

// The job's tailored resume as a PDF (?kind=cover for its cover letter). Works with a session or an API
// token, so an agent that tailored a job through POST /api/jobs/tailor can fetch the file to attach.
export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/pdf">) {
  const user = await userFromSessionOrToken(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") === "cover" ? "cover" : "resume";

  const [base, row] = await Promise.all([getBaseResume(user.id), getJob(user.id, id)]);
  if (!base || !row) return Response.json({ error: "Not found" }, { status: 404 });
  if (kind === "resume" && !row.tailored) {
    return Response.json(
      { error: row.stage === "failed" ? `Tailoring failed: ${row.error}` : `Not tailored yet (stage: ${row.stage}).`, stage: row.stage },
      { status: 409 },
    );
  }

  const out = await buildPdf({ base, row, fallbackName: "", kind, tz: params.get("tz") });
  if (!out) return Response.json({ error: "No cover letter yet" }, { status: 404 });
  return pdfResponse(out.pdf, out.name, { "X-Job-Id": id });
}
