import { z } from "zod";

export const EntrySchema = z.object({
  role: z.string().describe("Job title, degree, or empty string for plain lists like Skills"),
  org: z.string().describe("Company / school, or empty string"),
  dates: z.string().describe("e.g. '2021 – present', or empty string"),
  bullets: z.array(z.string()),
});

export const ResumeSchema = z.object({
  name: z.string(),
  headline: z.string(),
  contact: z.string().describe("One line: city · email · site"),
  sections: z.array(z.object({ title: z.string(), entries: z.array(EntrySchema) })),
});

export type Entry = z.infer<typeof EntrySchema>;
export type Resume = z.infer<typeof ResumeSchema>;

// A tailored bullet keeps the base text it came from so we can show a word diff.
// original "" = newly added line, text "" = removed line.
export const TailoredLineSchema = z.object({ original: z.string(), text: z.string() });

export const TailoredResumeSchema = z.object({
  headline: TailoredLineSchema,
  sections: z.array(
    z.object({
      title: z.string(),
      entries: z.array(
        z.object({
          role: z.string(),
          org: z.string(),
          dates: z.string(),
          bullets: z.array(TailoredLineSchema),
        }),
      ),
    }),
  ),
  keywordsHit: z.array(z.string()).describe("Posting keywords that now honestly appear in the tailored resume"),
  keywordsMissing: z.array(z.string()).describe("Important posting keywords the candidate's history can't support"),
});

export type TailoredLine = z.infer<typeof TailoredLineSchema>;
export type TailoredResume = z.infer<typeof TailoredResumeSchema>;

// What we store per job: the model's output plus the user's own edits on top.
// `edited` (when present) is the user's final text for that line; `text` stays the AI version.
export const StoredLineSchema = TailoredLineSchema.extend({ edited: z.string().optional() });
export const StoredTailoredSchema = TailoredResumeSchema.extend({
  headline: StoredLineSchema,
  sections: z.array(
    z.object({
      title: z.string(),
      entries: z.array(
        z.object({ role: z.string(), org: z.string(), dates: z.string(), bullets: z.array(StoredLineSchema) }),
      ),
    }),
  ),
});
export type StoredLine = z.infer<typeof StoredLineSchema>;
export type StoredTailored = z.infer<typeof StoredTailoredSchema>;

export const finalText = (l: StoredLine) => l.edited ?? l.text;

export const hasUserEdits = (t: StoredTailored) =>
  t.headline.edited !== undefined ||
  t.sections.some((s) => s.entries.some((e) => e.bullets.some((b) => b.edited !== undefined)));

// The resume as it will actually be sent out (for cover letters, etc.).
export function finalResume(t: StoredTailored) {
  return {
    headline: finalText(t.headline),
    sections: t.sections.map((s) => ({
      title: s.title,
      entries: s.entries.map((e) => ({ ...e, bullets: e.bullets.map(finalText).filter(Boolean) })),
    })),
  };
}

export const JobRequirementSchema = z.object({
  status: z.enum(["hit", "partial", "miss"]),
  text: z.string(),
});
export type JobRequirement = z.infer<typeof JobRequirementSchema>;

export const JobDetailsSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string().describe("e.g. 'Remote (US)' or 'San Francisco · Hybrid'; empty if unknown"),
  pay: z.string().describe("e.g. '$165k–$195k'; empty if not listed"),
  employmentType: z.string().describe("e.g. 'Full-time'; empty if unknown"),
  level: z.string().describe("e.g. 'Senior', 'Staff'; empty if unknown"),
  description: z.string().describe("The posting text, cleaned of nav/boilerplate, lightly formatted as plain text"),
});

export const JobScoreSchema = z.object({
  score: z.number().int().describe("0–100 fit of the base resume to this posting"),
  scoreNote: z.string().describe("One or two sentences explaining the score"),
  requirements: z.array(JobRequirementSchema).describe("The 4–7 key requirements, each marked against the base resume"),
});

// Experience the user confirmed is true but that isn't written in the base resume (e.g. "SOC 2 at Salesforce").
export const FactSchema = z.object({ id: z.string(), keyword: z.string(), detail: z.string() });
export type Fact = z.infer<typeof FactSchema>;

export const JOB_STATUSES = {
  not_applied: { label: "Not applied", cls: "bg-well text-subtle border-line-2", closed: false },
  applied: { label: "Applied", cls: "bg-brand-tint text-brand border-brand-line", closed: false },
  interviewing: { label: "Interviewing", cls: "bg-warn-bg text-warn-ink border-warn-line", closed: false },
  offer: { label: "Offer", cls: "bg-ok-bg text-ok-ink border-ok-line", closed: false },
  // Tried to apply, but the employer blocked it because an earlier application is still on file.
  already_applied: { label: "Already applied", cls: "bg-surface text-subtle border-line-2", closed: true },
  rejected: { label: "Rejected", cls: "bg-bad-bg text-bad border-bad-line", closed: true },
  withdrawn: { label: "No longer interested", cls: "bg-surface text-faint border-line-2", closed: true },
} as const;
export type JobStatus = keyof typeof JOB_STATUSES;
export const isJobStatus = (s: unknown): s is JobStatus => typeof s === "string" && s in JOB_STATUSES;

// How the Recent list can be ordered. `dir` is the direction that makes sense by default for each key;
// the user can flip it. "status" is the working order: jobs still to apply to first, applied further
// down, then already-applied, rejected, and no-longer-interested at the very bottom.
export const JOB_SORTS = {
  status: { label: "Status", dir: "asc" },
  score: { label: "Score", dir: "desc" },
  applied: { label: "Date applied", dir: "desc" },
  created: { label: "Date added", dir: "desc" },
  updated: { label: "Last updated", dir: "desc" },
  title: { label: "Title", dir: "asc" },
  company: { label: "Company", dir: "asc" },
} as const satisfies Record<string, { label: string; dir: SortDir }>;
export type JobSort = keyof typeof JOB_SORTS;
export type SortDir = "asc" | "desc";
export const isJobSort = (s: unknown): s is JobSort => typeof s === "string" && s in JOB_SORTS;
export const isSortDir = (s: unknown): s is SortDir => s === "asc" || s === "desc";
export const DEFAULT_SORT: { key: JobSort; dir: SortDir } = { key: "status", dir: "asc" };

// Where a job is in the scrape → extract → score → tailor pipeline. The work runs on the server after the
// request that started it returns, so any tab (or a fresh page load) can pick up progress by polling.
export const JOB_STAGES = {
  // Submitted through the API and waiting for the user to approve it. Nothing runs (or is billed) until then.
  pending: { label: "Waiting for your approval", sub: "" },
  queued: { label: "Queued", sub: "Waiting to start" },
  scraping: { label: "Fetching the posting", sub: "Firecrawl renders the page and strips nav, footers and cookie banners" },
  extracting: { label: "Extracting the job", sub: "Title, company, pay, requirements, keywords" },
  scoring: { label: "Scoring against your base resume", sub: "What already matches, what doesn't" },
  tailoring: { label: "Tailoring", sub: "Small, truthful edits to wording, order and emphasis" },
  rescoring: { label: "Scoring the tailored resume", sub: "How much closer it gets you" },
  done: { label: "Done", sub: "" },
  failed: { label: "Failed", sub: "" },
} as const;
export type JobStage = keyof typeof JOB_STAGES;
// The steps shown in the progress card, in order.
export const PIPELINE_STEPS = [
  "scraping",
  "extracting",
  "scoring",
  "tailoring",
  "rescoring",
] as const satisfies JobStage[];
export const isJobStage = (s: unknown): s is JobStage => typeof s === "string" && s in JOB_STAGES;
export const stageInFlight = (s: JobStage) => s !== "done" && s !== "failed" && s !== "pending";

// A job an API client submitted that the user hasn't opened yet: sorts first in the default order and shows the triage card.
export const isBackground = (j: { source: string; seenAt: Date | string | null }) => j.source !== "app" && !j.seenAt;

// Validates a job posting URL (http(s), real hostname). Returns the normalized URL or null.
export function parseJobUrl(raw: unknown): string | null {
  try {
    const u = new URL(String(raw ?? "").trim());
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// The same posting shared twice usually differs only by tracking params or a fragment.
export function canonicalJobUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|gh_src$|ref$|source$|src$|trk)/i.test(k)) u.searchParams.delete(k);
  }
  return u.toString();
}

// Job boards that list many employers' postings; their hostname says nothing about who's hiring.
export function isAggregatorHost(host: string): boolean {
  return /(^|\.)(linkedin|indeed|glassdoor|ziprecruiter|wellfound|ycombinator|builtin|dice|monster|google)\.[a-z.]+$/.test(host);
}

// Hosted ATS boards where every employer shares one hostname and the company is a path segment.
const HOSTED_ATS = /(^|\.)(ashbyhq\.com|greenhouse\.io|lever\.co|workable\.com|smartrecruiters\.com|breezy\.hr|rippling\.com|gem\.com)$/;
const hostedAts = (host: string) => HOSTED_ATS.test(host) && /^(jobs|boards|job-boards|apply|ats)\./.test(host);

// A hostname many employers post under (aggregators and shared ATS boards), so matching on it says
// nothing about the employer.
export function isSharedJobHost(host: string): boolean {
  return isAggregatorHost(host) || hostedAts(host) || host === "workatastartup.com";
}

// The posting's hostname, lowercased and without "www.", so clients can group jobs by employer site.
// Empty for pasted postings without a link.
export function jobHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Company names as typed or extracted vary in case, spacing and legal suffixes; compare them loosely.
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|plc|gmbh)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// A best guess at the employer from a posting URL, for jobs whose company isn't known yet (not extracted,
// or extraction failed). Hosted job boards put the company in the first path segment or the subdomain;
// anything else is taken to be the company's own site.
export function companyFromUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "";
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const first = decodeURIComponent(u.pathname.split("/").filter(Boolean)[0] ?? "");
  const pretty = (slug: string) =>
    slug
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");

  if (hostedAts(host))
    return /^[\w-]{2,}$/.test(first) && !/^(embed|j|jobs?)$/i.test(first) ? pretty(first) : "";
  const sub = /^([\w-]+)\.(?:wd\d+\.)?(myworkdayjobs\.com|bamboohr\.com|recruitee\.com|teamtailor\.com|breezy\.hr|applytojob\.com|jobs\.personio\.(?:com|de))$/.exec(host);
  if (sub) return pretty(sub[1]);
  // Aggregators say nothing about who's hiring.
  if (isAggregatorHost(host)) return "";
  const parts = host.replace(/^(jobs|careers|career|apply|boards|work|hire)\./, "").split(".");
  const name = parts.length > 2 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts[parts.length - 2];
  return name ? pretty(name) : "";
}

// Agents often send a one-line summary as `notes` instead of separate fields:
//   "Temporal — Staff Software Engineer, AI Foundations — United States (Remote) — $169.6k–$278.25k + equity — why it fits"
// Pull the company, title and pay out of the first line so the job shows up properly before it's extracted.
// Only the first two segments are positional (company, then title); pay is whichever segment names money.
export function parseJobLine(notes: string): { company: string; title: string; pay: string } {
  const none = { company: "", title: "", pay: "" };
  const line = (notes ?? "").split("\n").find((l) => l.trim()) ?? "";
  const segs = line.split(/\s+[—–|]\s+|\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) return none;
  const money = /(?:[$€£]\s?\d|\d[\d,.]*\s?k\b|\b\d{2,3},\d{3}\b)/i;
  const [company, title] = segs;
  if (company.length > 60 || title.length > 200 || money.test(company) || money.test(title)) return none;
  const pay = segs.slice(2).find((s) => money.test(s) && s.length <= 120) ?? "";
  return { company, title, pay };
}

export const MIN_DESCRIPTION = 200;
export const MAX_DESCRIPTION = 60_000;

export type CoverStage = "idle" | "writing" | "failed";

// A pipeline that hasn't advanced in this long is considered dead (the function was killed or crashed
// without recording a failure). Longer than any single step should take under the 300s route limit.
export const STAGE_TIMEOUT_MS = 5 * 60_000;
export const STAGE_TIMEOUT_MESSAGE = "This took too long and was stopped. Try again.";

// Turns a stored pipeline error into something worth showing. Provider failures arrive as a status code
// plus a JSON blob ('402 {"error":{"message":"…","type":"insufficient_funds"}}'); the common ones get a
// plain explanation, the rest are reduced to the provider's own message.
export function explainError(raw: string | null | undefined): { title: string | null; detail: string; link?: { href: string; label: string } } {
  const text = (raw ?? "").trim();
  if (!text) return { title: null, detail: "Something went wrong." };

  const m = /^(\d{3})\s*(\{[\s\S]*\})\s*$/.exec(text);
  let code = m ? Number(m[1]) : 0;
  let message = text;
  let type = "";
  if (m) {
    try {
      const body = JSON.parse(m[2]) as { error?: { message?: unknown; type?: unknown } | string; message?: unknown };
      const err = typeof body.error === "object" && body.error ? body.error : undefined;
      const found = err?.message ?? (typeof body.error === "string" ? body.error : body.message);
      if (typeof found === "string" && found.trim()) message = found.trim();
      if (typeof err?.type === "string") type = err.type;
    } catch {
      code = 0;
    }
  }

  if (code === 402 || type === "insufficient_funds" || /credit balance/i.test(message)) {
    const href = /https?:\/\/[^\s"']+/.exec(message)?.[0].replace(/[.,)]+$/, "");
    return {
      title: "Out of AI credits",
      detail: "The AI provider account has no credits left, so nothing was tailored. Add credits, then retry.",
      link: href ? { href, label: "Add credits" } : undefined,
    };
  }
  if (code === 429 || /rate_limit|overloaded/i.test(type))
    return { title: "The AI provider is busy", detail: "Too many requests right now. Wait a minute, then retry." };
  if (code === 401 || code === 403 || /authentication|permission/i.test(type))
    return { title: "The AI provider rejected the request", detail: "Its API key is missing, invalid or not allowed to use this model." };
  if (code >= 500) return { title: "The AI provider had a problem", detail: "It returned an error on its side. Retry in a moment." };
  return { title: null, detail: message };
}

export const EMPTY_RESUME: Resume = {
  name: "",
  headline: "",
  contact: "",
  sections: [
    { title: "Experience", entries: [{ role: "", org: "", dates: "", bullets: [] }] },
    { title: "Skills", entries: [{ role: "", org: "", dates: "", bullets: [] }] },
    { title: "Education", entries: [{ role: "", org: "", dates: "", bullets: [] }] },
  ],
};

export const DEFAULT_PROMPT = `You are tailoring my resume for one specific job posting.
- Keep every fact true. Never invent employers, titles, dates, or metrics.
- Reorder and reword bullets to mirror the posting's language and priorities.
- Prefer the posting's exact keywords where they honestly apply.
- Keep it to one page. Preserve my voice; no buzzwords.`;

// One-click additions to the cover letter prompt. Users can replace these with their own.
export const DEFAULT_COVER_STARTERS = [
  "Confident but not salesy",
  "Under 250 words",
  "Lead with my strongest match",
  "Mention I'm open to relocating",
];
export const MAX_COVER_STARTERS = 12;
export const MAX_COVER_STARTER_LENGTH = 1000;

// Stable fingerprint of a base resume (runs on server and client). FNV-1a over the JSON.
export function resumeHash(r: Resume): string {
  // Sorted keys: Postgres jsonb doesn't preserve key order.
  const str = JSON.stringify(r, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
