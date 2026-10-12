import { userFromSessionOrToken } from "@/lib/api-tokens";
import {
  countRecentApiJobs,
  findActedJobsByCompany,
  findJobIdByUrl,
  getBaseResume,
  listJobsByIds,
  searchJobs,
} from "@/lib/data";
import { startJob } from "@/lib/pipeline";
import {
  ApiJobInput,
  apiJobMeta,
  canonicalJobUrl,
  DEFAULT_PROMPT,
  DEFAULT_SORT,
  isJobSort,
  isJobStatus,
  isSortDir,
  JOB_SORTS,
  JOB_STATUSES,
  jobHost,
  type JobStatus,
  parseJobUrl,
} from "@/lib/types";

// Both methods accept a session cookie or `Authorization: Bearer rb_…` (a personal API token).
const caller = userFromSessionOrToken;

// Every status except "not applied": the user has acted on the job one way or another.
const ACTED: JobStatus[] = (Object.keys(JOB_STATUSES) as JobStatus[]).filter((s) => s !== "not_applied");

// Lightweight status for a set of jobs (tab bar + progress polling, and API clients): ?ids=a,b,c
// Without ids: a page of the user's jobs, optionally filtered and sorted:
//   ?q=acme&sort=score&dir=desc&offset=25&limit=25   (sort: status | score | applied | created | updated | title | company)
//   ?status=applied,rejected   (any of the job statuses)   ?acted=1   (everything except not_applied)
// Each job carries `company` and `host` (the posting's hostname) so agents can skip employers already dealt with.
export async function GET(request: Request) {
  const user = await caller(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  if (!params.has("ids")) {
    const sort = params.get("sort");
    const dir = params.get("dir");
    const key = isJobSort(sort) ? sort : DEFAULT_SORT.key;
    const status = (params.get("status") ?? "").split(",").map((s) => s.trim()).filter(isJobStatus);
    const acted = /^(1|true|yes)$/i.test(params.get("acted") ?? "");
    const page = await searchJobs(user.id, {
      q: params.get("q") ?? "",
      status: status.length ? status : acted ? ACTED : undefined,
      sort: key,
      dir: isSortDir(dir) ? dir : JOB_SORTS[key].dir,
      offset: Number(params.get("offset")) || 0,
      limit: Number(params.get("limit")) || 25,
    });
    return Response.json(
      { ...page, jobs: page.jobs.map(withHost) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const ids = [
    ...new Set(
      (params.get("ids") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, 100);
  const jobs = await listJobsByIds(user.id, ids);
  return Response.json({ jobs: jobs.map(withHost) }, { headers: { "Cache-Control": "no-store" } });
}

function withHost<T extends { url: string }>(j: T) {
  return { ...j, host: jobHost(j.url) };
}

// API submissions per rolling 24h, so a leaked token or a looping script can't flood the list.
const DAILY_LIMIT = 50;
const MAX_BATCH = 10;

// Submit one job ({…}), or several ([…] or { jobs: […] }). Each shows up in the app with an "API" badge and
// waits there ("pending") until the user approves it; only then is it tailored, so a script can't spend
// model credits on its own. Re-submitting a URL you already have returns the existing job. A job at a
// company the user has already applied to, been rejected by, etc. is still created (another role there
// may be fine) but comes back with `companyConflict: true` and the jobs it clashes with.
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

  const parsed = items.map((it) => ApiJobInput.safeParse(it));
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
    const conflicts = async () => {
      const clashes = await findActedJobsByCompany(user.id, j.company ?? "", url);
      return {
        companyConflict: clashes.length > 0,
        conflicts: clashes.map((c) => ({ id: c.id, title: c.title, company: c.company, status: c.status, link: `${origin}/j/${c.id}` })),
      };
    };

    const existing = url ? (seen.get(url) ?? (await findJobIdByUrl(user.id, url))) : null;
    if (existing) {
      const [row] = await listJobsByIds(user.id, [existing]);
      results.push({ ...describe(origin, existing, row?.stage ?? "pending"), duplicate: true, ...(await conflicts()) });
      continue;
    }
    if (remaining <= 0) {
      results.push({ error: `Daily limit of ${DAILY_LIMIT} API jobs reached. Try again later.` });
      continue;
    }
    remaining--;

    const id = await startJob(user.id, { url, description: j.description }, j.prompt || DEFAULT_PROMPT, {
      ...apiJobMeta(j),
      hold: true,
    });
    if (url) seen.set(url, id);
    results.push({ ...describe(origin, id, "pending"), duplicate: false, ...(await conflicts()) });
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
