import { z } from "zod";
import { userFromToken } from "@/lib/api-tokens";
import { countRecentApiJobs, findJobIdByUrl, getBaseResume, listJobsByIds, userFromRequest } from "@/lib/data";
import { startJob } from "@/lib/pipeline";
import {
  canonicalJobUrl,
  DEFAULT_PROMPT,
  MAX_DESCRIPTION,
  MIN_DESCRIPTION,
  parseJobUrl,
} from "@/lib/types";

// `after()` work (the pipelines) runs within this route's duration budget.
export const maxDuration = 300;

// Both methods accept a session cookie or `Authorization: Bearer rb_…` (a personal API token).
async function caller(request: Request) {
  return (await userFromRequest(request)) ?? (await userFromToken(request));
}

// Lightweight status for a set of jobs (tab bar + progress polling, and API clients): ?ids=a,b,c
export async function GET(request: Request) {
  const user = await caller(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const ids = [
    ...new Set(
      (new URL(request.url).searchParams.get("ids") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, 100);
  const jobs = await listJobsByIds(user.id, ids);
  return Response.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}

// API submissions per rolling 24h. Every job runs several model calls, so this caps the bill if a
// token leaks or a script loops.
const DAILY_LIMIT = 50;
const MAX_BATCH = 10;

const opt = (max: number) => z.string().trim().max(max).optional();

// Unknown fields are ignored so clients can send whatever shape they already have.
const JobInput = z
  .object({
    url: opt(2000),
    description: opt(MAX_DESCRIPTION),
    title: opt(300),
    company: opt(200),
    notes: opt(4000),
    // Folded into notes; common in scraped/agent job data.
    comp: opt(200),
    priority: opt(40),
    source: z
      .string()
      .trim()
      .regex(/^[\w .-]{1,40}$/, "source: letters, numbers, spaces, . _ - (max 40)")
      .optional(),
    prompt: opt(4000),
  })
  .superRefine((j, ctx) => {
    if (!j.url && !j.description) ctx.addIssue({ code: "custom", message: "Send a url, a description, or both." });
    if (j.url && !parseJobUrl(j.url)) ctx.addIssue({ code: "custom", path: ["url"], message: "Not a valid http(s) URL." });
    if (j.description && j.description.length < MIN_DESCRIPTION)
      ctx.addIssue({ code: "custom", path: ["description"], message: `At least ${MIN_DESCRIPTION} characters.` });
  });

// Submit one job ({…}), or several ([…] or { jobs: […] }). Each is tailored in the background and shows
// up in the app with a "Background" badge. Re-submitting a URL you already have returns the existing job.
export async function POST(request: Request) {
  const user = await caller(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  const single = !!body && typeof body === "object" && !Array.isArray(body) && !("jobs" in body);
  const items = single ? [body] : Array.isArray(body) ? body : (body as { jobs?: unknown } | undefined)?.jobs;
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: "Send a job object, an array of them, or { jobs: [...] }." }, { status: 400 });
  }
  if (items.length > MAX_BATCH) {
    return Response.json({ error: `At most ${MAX_BATCH} jobs per request.` }, { status: 400 });
  }

  const parsed = items.map((it) => JobInput.safeParse(it));
  const invalid = parsed.flatMap((p, index) =>
    p.success ? [] : [{ index, errors: p.error.issues.map((i) => i.message) }],
  );
  if (invalid.length) {
    return Response.json({ error: "Invalid job", details: single ? invalid[0].errors : invalid }, { status: 400 });
  }

  if (!(await getBaseResume(user.id))) {
    return Response.json({ error: "Add your base resume in resume.buzz first." }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  let remaining = DAILY_LIMIT - (await countRecentApiJobs(user.id));
  const seen = new Map<string, string>(); // canonical URL → id, for repeats within one batch

  const results = [];
  for (const p of parsed) {
    const j = p.data!;
    const url = j.url ? canonicalJobUrl(parseJobUrl(j.url)!) : "";

    const existing = url ? (seen.get(url) ?? (await findJobIdByUrl(user.id, url))) : null;
    if (existing) {
      const [row] = await listJobsByIds(user.id, [existing]);
      results.push({ ...describe(origin, existing, row?.stage ?? "queued"), duplicate: true });
      continue;
    }
    if (remaining <= 0) {
      results.push({ error: `Daily limit of ${DAILY_LIMIT} API jobs reached. Try again later.` });
      continue;
    }
    remaining--;

    const notes = [j.priority && `Priority: ${j.priority}`, j.comp && `Comp: ${j.comp}`, j.notes]
      .filter(Boolean)
      .join("\n");
    const id = await startJob(user.id, { url, description: j.description }, j.prompt || DEFAULT_PROMPT, {
      source: j.source || "api",
      notes,
      title: j.title,
      company: j.company,
    });
    if (url) seen.set(url, id);
    results.push({ ...describe(origin, id, "queued"), duplicate: false });
  }

  if (single) {
    const r = results[0];
    if ("error" in r) return Response.json(r, { status: 429 });
    return Response.json(r, { status: r.duplicate ? 200 : 202 });
  }
  const queued = results.some((r) => "duplicate" in r && !r.duplicate);
  return Response.json({ jobs: results }, { status: queued ? 202 : 200 });
}

function describe(origin: string, id: string, stage: string) {
  return { id, stage, link: `${origin}/j/${id}` };
}
