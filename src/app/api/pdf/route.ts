import { alignToBase } from "@/lib/align";
import { getBaseResume, getJob, userFromRequest } from "@/lib/data";
import { renderCoverPdf, renderResumePdf } from "@/lib/pdf";
import { finalResume } from "@/lib/types";

// The letter is dated in the reader's time zone, not the server's.
function today(timeZone: string | null) {
  const fmt = (tz?: string) =>
    new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: tz });
  try {
    return fmt(timeZone ?? undefined);
  } catch {
    return fmt();
  }
}

// ?kind=resume|cover, ?job=<id> for that job's tailored resume or letter (no job = the base resume).
export async function GET(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const cover = params.get("kind") === "cover";
  const jobId = params.get("job");

  const [base, row] = await Promise.all([getBaseResume(user.id), jobId ? getJob(user.id, jobId) : null]);
  if (!base || (jobId && !row)) return Response.json({ error: "Not found" }, { status: 404 });
  if (cover && !row?.coverLetter) return Response.json({ error: "No cover letter yet" }, { status: 404 });

  const who = base.name.trim() || user.name || "Resume";
  const kind = cover ? "Cover Letter" : "Resume";
  const target = row ? row.company || row.title : "";
  const name = (target ? `${who} - ${kind} for ${target}` : `${who} - ${kind}`).replace(/[\\/:*?"<>|]+/g, "-");

  // Always follow the base resume's section/entry order, as the on-screen document does.
  const resume = { ...base, name: who, ...(row?.tailored && finalResume(alignToBase(row.tailored, base))) };
  const pdf =
    cover && row?.coverLetter
      ? await renderCoverPdf(resume, row.coverLetter, today(params.get("tz")), name)
      : await renderResumePdf(resume, name);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}.pdf`,
      "Cache-Control": "no-store",
    },
  });
}
