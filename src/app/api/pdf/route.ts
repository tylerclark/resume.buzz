import { getBaseResume, getJob, userFromRequest } from "@/lib/data";
import { buildPdf, pdfResponse } from "@/lib/pdf";

// ?kind=resume|cover, ?job=<id> for that job's tailored resume or letter (no job = the base resume).
export async function GET(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") === "cover" ? "cover" : "resume";
  const jobId = params.get("job");

  const [base, row] = await Promise.all([getBaseResume(user.id), jobId ? getJob(user.id, jobId) : null]);
  if (!base || (jobId && !row)) return Response.json({ error: "Not found" }, { status: 404 });

  const out = await buildPdf({ base, row, fallbackName: user.name ?? "", kind, tz: params.get("tz") });
  if (!out) return Response.json({ error: "No cover letter yet" }, { status: 404 });
  return pdfResponse(out.pdf, out.name);
}
