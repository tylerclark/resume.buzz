import { after } from "next/server";
import { userFromSessionOrToken } from "@/lib/api-tokens";
import {
  countRecentApiJobs,
  findActedJobsByCompany,
  findJobIdByUrl,
  getBaseResume,
  getJob,
} from "@/lib/data";
import { buildPdf, pdfResponse } from "@/lib/pdf";
import { runJobNow, startJob } from "@/lib/pipeline";
import { ApiJobInput, apiJobMeta, canonicalJobUrl, DEFAULT_PROMPT, jobHost, parseJobUrl, stageInFlight } from "@/lib/types";

export const maxDuration = 300;

// Same rolling-24h budget as POST /api/jobs (both count toward it). Unlike that endpoint, this one tailors
// right away, so every accepted call spends model credits.
const DAILY_LIMIT = 50;
// How long to hold the request open. Scrape + extract + score + tailor + rescore is usually 1–3 minutes;
// past this we answer 202 and the pipeline keeps running (`after`), so the client polls or re-POSTs.
const WAIT_MS = 270_000;
const POLL_MS = 3_000;

// Submit one posting and get its tailored resume back in the same call: the job is created, crawled,
// extracted, scored and tailored while the request waits, then answered with the job id and PDF link
// (JSON) or the PDF itself (`Accept: application/pdf`, id in `X-Job-Id`). Afterwards
// PATCH /api/jobs/{id} {"status":"applied"} records the application.
//
// Re-sending a URL already in the list returns that job (tailoring it first if it was waiting or had
// failed; waiting for it if it's in progress) rather than creating another. `skipIfConflict: true`
// refuses (409, nothing created) when the user has already acted on a job at the same company.
export async function POST(request: Request) {
  const user = await userFromSessionOrToken(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  const parsed = ApiJobInput.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid job", details: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const j = parsed.data;
  const skipIfConflict = !!(body as { skipIfConflict?: unknown }).skipIfConflict;
  const wantPdf = /application\/pdf/i.test(request.headers.get("accept") ?? "");

  const base = await getBaseResume(user.id);
  if (!base) return Response.json({ error: "Add your base resume in resume.buzz first." }, { status: 400 });

  const origin = new URL(request.url).origin;
  const url = j.url ? canonicalJobUrl(parseJobUrl(j.url)!) : "";
  const clashes = await findActedJobsByCompany(user.id, j.company ?? "", url);
  const conflict = {
    companyConflict: clashes.length > 0,
    conflicts: clashes.map((c) => ({ id: c.id, title: c.title, company: c.company, status: c.status, link: `${origin}/j/${c.id}` })),
  };

  let id = url ? await findJobIdByUrl(user.id, url) : null;
  const duplicate = !!id;
  if (!id) {
    if (skipIfConflict && conflict.companyConflict) {
      return Response.json({ error: "Already dealt with this company; nothing created.", ...conflict }, { status: 409 });
    }
    if ((await countRecentApiJobs(user.id)) >= DAILY_LIMIT) {
      return Response.json({ error: `Daily limit of ${DAILY_LIMIT} API jobs reached. Try again later.` }, { status: 429 });
    }
    id = await startJob(user.id, { url, description: j.description }, j.prompt || DEFAULT_PROMPT, {
      ...apiJobMeta(j),
      hold: true,
    });
  }

  // Run now (pending/failed), or just wait on it if another call already has it going.
  let row = await getJob(user.id, id);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  const work =
    row.stage === "pending" || row.stage === "failed" ? runJobNow(row).catch(() => false) : Promise.resolve(false);
  after(() => work);
  const deadline = Date.now() + WAIT_MS;
  while (stageInFlight(row.stage) || row.stage === "pending") {
    if (Date.now() > deadline) break;
    await Promise.race([work, sleep(POLL_MS)]);
    row = await getJob(user.id, id);
    if (!row) return Response.json({ error: "Deleted while tailoring" }, { status: 410 });
  }

  const summary = {
    id,
    stage: row.stage,
    duplicate,
    link: `${origin}/j/${id}`,
    pdf: `${origin}/api/jobs/${id}/pdf`,
    title: row.title,
    company: row.company,
    host: jobHost(row.url),
    location: row.location,
    pay: row.pay,
    score: row.score,
    tailoredScore: row.tailoredScore,
    keywordsHit: row.keywordsHit,
    keywordsMissing: row.keywordsMissing,
    status: row.status,
    ...conflict,
  };

  if (row.stage === "failed") return Response.json({ ...summary, error: row.error }, { status: 422 });
  if (row.stage !== "done" || !row.tailored) {
    return Response.json(
      { ...summary, message: `Still ${row.stage}. Poll GET /api/jobs/${id} until stage is "done", then GET the pdf link.` },
      { status: 202 },
    );
  }

  if (wantPdf) {
    const out = await buildPdf({ base, row, fallbackName: "", kind: "resume" });
    return pdfResponse(out!.pdf, out!.name, { "X-Job-Id": id, "X-Job-Link": summary.link, "X-Job-Stage": "done" });
  }
  return Response.json(summary, { status: duplicate ? 200 : 201 });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
