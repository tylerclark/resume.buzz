// The public API, as data: what a personal token (`Authorization: Bearer rb_…`) can call, with every
// field, parameter and status code. The API dialog renders it, and `apiReferenceMarkdown` turns it into
// one document a user can paste into an agent's context. Keep it in step with the routes under
// src/app/api/jobs and the README's API section.

import { JOB_SORTS, JOB_STAGES, JOB_STATUSES, MAX_DESCRIPTION, MIN_DESCRIPTION } from "./types";

export type Method = "GET" | "POST" | "PATCH";

export type Field = { name: string; type: string; note: string; required?: boolean };
export type Status = { code: number; meaning: string };

export type Endpoint = {
  id: string;
  method: Method;
  path: string;
  title: string;
  summary: string;
  // Request headers beyond Authorization, query params, body fields.
  headers?: Field[];
  query?: Field[];
  body?: Field[];
  bodyNote?: string;
  responses: Status[];
  responseFields?: Field[];
  responseNote?: string;
  example: (origin: string, token: string) => string;
  exampleOutput?: string;
};

export const JOB_STATUS_KEYS = Object.keys(JOB_STATUSES) as (keyof typeof JOB_STATUSES)[];
export const JOB_STAGE_KEYS = Object.keys(JOB_STAGES) as (keyof typeof JOB_STAGES)[];
export const JOB_SORT_KEYS = Object.keys(JOB_SORTS) as (keyof typeof JOB_SORTS)[];

export const DAILY_LIMIT = 50;
export const MAX_BATCH = 10;
export const MAX_IDS = 100;
export const MAX_PAGE = 100;
export const DEFAULT_PAGE = 25;

// The job object a client sends to either submit endpoint.
const JOB_INPUT: Field[] = [
  { name: "url", type: "string", note: "The posting's http(s) URL, max 2000 chars. Tracking params (utm_* etc.) are ignored for dedupe." },
  {
    name: "description",
    type: "string",
    note: `The posting's text, ${MIN_DESCRIPTION}–${MAX_DESCRIPTION.toLocaleString("en-US")} chars. Send this when the page blocks crawlers (LinkedIn, Indeed…); url then becomes just a link.`,
  },
  { name: "title", type: "string", note: "Job title, max 300. Extracted from the posting if omitted." },
  { name: "company", type: "string", note: "Employer, max 200. Used for the company-conflict check. Extracted if omitted." },
  { name: "comp", type: "string", note: "Pay band, max 200. Shown in the list as the job's pay until the posting is extracted." },
  { name: "notes", type: "string", note: "Why it's a fit, max 4000. Shown on the job. A first line shaped like “Company — Title — Location — $pay” fills missing title/company/comp." },
  { name: "priority", type: "string", note: "Max 40. Folded into notes as “Priority: …”." },
  { name: "source", type: "string", note: "Label for your agent, shown as a badge in the app. Letters, numbers, spaces, . _ - only; max 40. Defaults to “api”." },
  { name: "prompt", type: "string", note: "Extra tailoring instructions, max 4000. Defaults to the app's standard prompt." },
];

const CONFLICT_FIELDS: Field[] = [
  { name: "companyConflict", type: "boolean", note: "True when you already have a job at this employer with any status other than not_applied." },
  { name: "conflicts", type: "object[]", note: "Those jobs: { id, title, company, status, link }. Matched by company name, or by hostname for employer-owned career sites (never for LinkedIn, Greenhouse and other shared hosts)." },
];

// Fields on a job summary (list and ?ids= responses).
export const SUMMARY_FIELDS: Field[] = [
  { name: "id", type: "string", note: "Job id." },
  { name: "url", type: "string", note: "Posting URL. Empty when only a description was sent." },
  { name: "host", type: "string", note: "The URL's hostname, lowercased, without www. Use it to skip employers you've already dealt with." },
  { name: "title", type: "string", note: "Empty until extracted unless you sent one." },
  { name: "company", type: "string", note: "Empty until extracted unless you sent one." },
  { name: "pay", type: "string", note: "Pay band, from comp or the posting." },
  { name: "score", type: "number", note: "Fit of your base resume, 0–100. 0 until scored." },
  { name: "tailoredScore", type: "number | null", note: "Fit of the tailored resume. Null until tailored." },
  { name: "status", type: "string", note: `Application status: ${JOB_STATUS_KEYS.join(" | ")}.` },
  { name: "stage", type: "string", note: `Pipeline stage: ${JOB_STAGE_KEYS.join(" | ")}.` },
  { name: "error", type: "string | null", note: "Why the pipeline failed, when stage is failed." },
  { name: "coverStage", type: "string", note: "idle | writing | failed." },
  { name: "coverError", type: "string | null", note: "Why the cover letter failed." },
  { name: "hasCover", type: "boolean", note: "A cover letter exists; fetch it with GET /api/jobs/{id}/pdf?kind=cover." },
  { name: "source", type: "string", note: "“app”, or the source label the submitter sent." },
  { name: "seenAt", type: "string | null", note: "ISO time the user first opened the job in the app. Null = not looked at yet." },
  { name: "statusAt", type: "string | null", note: "ISO time of the last status change." },
  { name: "appliedAt", type: "string | null", note: "ISO time of the first applied / interviewing / offer status." },
  { name: "createdAt", type: "string", note: "ISO time." },
  { name: "updatedAt", type: "string", note: "ISO time. The pipeline bumps it on every step." },
];

// What GET /api/jobs/{id} adds on top of the summary.
export const FULL_JOB_EXTRA_FIELDS: Field[] = [
  { name: "location", type: "string", note: "From the posting." },
  { name: "employmentType", type: "string", note: "Full-time, contract…" },
  { name: "level", type: "string", note: "Seniority, from the posting." },
  { name: "pasted", type: "boolean", note: "The description was sent in rather than crawled." },
  { name: "scoreNote", type: "string", note: "One-paragraph rationale for score." },
  { name: "requirements", type: "object[]", note: "Extracted requirements with how well the base resume meets each." },
  { name: "tailoredScoreNote", type: "string | null", note: "Rationale for tailoredScore." },
  { name: "tailoredRequirements", type: "object[] | null", note: "Same requirements, rescored against the tailored resume." },
  { name: "keywordsHit", type: "string[]", note: "Posting keywords the tailored resume covers." },
  { name: "keywordsMissing", type: "string[]", note: "Posting keywords it still lacks (facts the user hasn't confirmed)." },
  { name: "raw", type: "string", note: "The posting's extracted text." },
  { name: "prompt", type: "string", note: "The tailoring prompt used." },
  { name: "tailored", type: "object | null", note: "The tailored resume (structured, same shape as the base resume). Render it with the pdf endpoint." },
  { name: "baseHash", type: "string | null", note: "Hash of the base resume this was tailored from. Differs from the current one when stale." },
  { name: "notes", type: "string", note: "Notes sent with the submission (with Priority/Comp lines folded in)." },
  { name: "coverPrompt", type: "string", note: "Prompt used for the cover letter." },
  { name: "coverLetter", type: "string[] | null", note: "Cover letter paragraphs, once written in the app." },
];

const bearer = (token: string) => `-H "Authorization: Bearer ${token}"`;

export const ENDPOINTS: Endpoint[] = [
  {
    id: "submit",
    method: "POST",
    path: "/api/jobs",
    title: "Submit a job for approval",
    summary:
      "Add a job as a lead. It shows up in the app with an API badge and waits (stage “pending”) until the user approves it; nothing is crawled, tailored or billed before that. The safe default for an agent that finds jobs.",
    headers: [{ name: "Content-Type", type: "application/json", note: "", required: true }],
    body: JOB_INPUT,
    bodyNote: `One job object, or up to ${MAX_BATCH} as an array (or { "jobs": [ … ] }). Send url and/or description; everything else is optional. Unknown fields are ignored.`,
    responses: [
      { code: 202, meaning: "Created and waiting for approval (batch: at least one new job)." },
      { code: 200, meaning: "You already had this URL: the existing job is returned with duplicate: true, nothing new created (batch: nothing new)." },
      { code: 400, meaning: "Invalid body (error + details), or the user hasn't added a base resume yet." },
      { code: 401, meaning: "Missing or revoked token." },
      { code: 429, meaning: `Daily limit of ${DAILY_LIMIT} API jobs reached (single). In a batch the item carries { error } instead.` },
    ],
    responseFields: [
      { name: "id", type: "string", note: "Job id for the other endpoints." },
      { name: "stage", type: "string", note: "“pending” for a new job; the current stage for a duplicate." },
      { name: "link", type: "string", note: "The job in the app." },
      { name: "duplicate", type: "boolean", note: "An existing job was returned." },
      ...CONFLICT_FIELDS,
    ],
    responseNote: "Batch responses wrap the same objects as { jobs: [ … ] }, in request order. A duplicate at a conflicting company is still returned with its conflicts so you can decide.",
    example: (origin, token) => `curl -X POST ${origin}/api/jobs \\
  ${bearer(token)} \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://jobs.example.com/123", "source": "my-agent", "notes": "Strong fit"}'`,
    exampleOutput: `202 {"id": "…", "stage": "pending", "link": "${"{origin}"}/j/…", "duplicate": false,
     "companyConflict": false, "conflicts": []}`,
  },
  {
    id: "tailor",
    method: "POST",
    path: "/api/jobs/tailor",
    title: "Tailor in one call",
    summary:
      "Create the job, crawl the posting, extract and score it, tailor the resume, and answer when that's done (usually 1–3 minutes; keep the HTTP timeout at 5 minutes). This spends model credits without the user approving anything, so only an agent the user trusts to apply on their behalf should use it.",
    headers: [
      { name: "Content-Type", type: "application/json", note: "", required: true },
      { name: "Accept", type: "application/pdf", note: "Optional. Return the tailored resume PDF itself instead of JSON; the job id is in the X-Job-Id response header, the app link in X-Job-Link." },
    ],
    body: [
      ...JOB_INPUT,
      { name: "skipIfConflict", type: "boolean", note: "Refuse with 409 (nothing created, nothing billed) when the user has already acted on a job at this company." },
    ],
    bodyNote: "One job object only (no arrays). Same fields as POST /api/jobs plus skipIfConflict.",
    responses: [
      { code: 201, meaning: "Tailored. Body has the scores and a pdf link." },
      { code: 200, meaning: "You already had this URL and it's tailored: returned with duplicate: true. If it was waiting or had failed, it's tailored now." },
      { code: 202, meaning: "Still running after the wait. Poll GET /api/jobs/{id} until stage is done, or re-send the same request to wait again." },
      { code: 400, meaning: "Invalid body, or no base resume yet." },
      { code: 401, meaning: "Missing or revoked token." },
      { code: 409, meaning: "skipIfConflict was true and the company clashes. Body lists the conflicts." },
      { code: 410, meaning: "The user deleted the job while it was tailoring." },
      { code: 422, meaning: "The pipeline failed (page needs a login, no posting found…). error says why; fix the input or send description instead." },
      { code: 429, meaning: `Daily limit of ${DAILY_LIMIT} API jobs reached (shared with POST /api/jobs).` },
    ],
    responseFields: [
      { name: "id", type: "string", note: "Job id." },
      { name: "stage", type: "string", note: "done, failed, or an in-flight stage on 202." },
      { name: "duplicate", type: "boolean", note: "An existing job was returned." },
      { name: "link", type: "string", note: "The job in the app." },
      { name: "pdf", type: "string", note: "GET this URL (with the token) for the tailored resume PDF." },
      { name: "title / company / host / location / pay", type: "string", note: "From the posting." },
      { name: "score", type: "number", note: "Base resume fit, 0–100." },
      { name: "tailoredScore", type: "number | null", note: "Tailored resume fit." },
      { name: "keywordsHit / keywordsMissing", type: "string[]", note: "Posting keywords covered / still missing." },
      { name: "status", type: "string", note: "Application status (not_applied until you PATCH it)." },
      ...CONFLICT_FIELDS,
    ],
    example: (origin, token) => `curl -X POST ${origin}/api/jobs/tailor --max-time 300 \\
  ${bearer(token)} \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://jobs.example.com/123", "source": "my-agent", "skipIfConflict": true}'`,
    exampleOutput: `201 {"id": "…", "stage": "done", "title": "…", "company": "…", "score": 61, "tailoredScore": 84,
     "pdf": "${"{origin}"}/api/jobs/…/pdf", "link": "${"{origin}"}/j/…", "companyConflict": false, …}`,
  },
  {
    id: "status",
    method: "GET",
    path: "/api/jobs?ids=…",
    title: "Check several jobs",
    summary: "Lightweight status for jobs you know the ids of. Poll this while a job is pending or in flight.",
    query: [{ name: "ids", type: "string", note: `Comma-separated job ids, up to ${MAX_IDS}. Unknown ids are left out.`, required: true }],
    responses: [
      { code: 200, meaning: "{ jobs: [ summary, … ] }" },
      { code: 401, meaning: "Missing or revoked token." },
    ],
    responseFields: SUMMARY_FIELDS,
    example: (origin, token) => `curl "${origin}/api/jobs?ids=JOB_ID_1,JOB_ID_2" \\
  ${bearer(token)}`,
    exampleOutput: `200 {"jobs": [{"id": "…", "stage": "tailoring", "status": "not_applied", "title": "…", "company": "…", "host": "…", …}]}`,
  },
  {
    id: "list",
    method: "GET",
    path: "/api/jobs",
    title: "List and search jobs",
    summary:
      "Page through the user's jobs, filtered and sorted. Use ?acted=1 before pitching a role to see every employer they've already applied to, been rejected by, or dropped.",
    query: [
      { name: "q", type: "string", note: "Substring match on title, company or URL." },
      { name: "status", type: "string", note: `Comma-separated statuses to include: ${JOB_STATUS_KEYS.join(", ")}.` },
      { name: "acted", type: "1", note: "Every status except not_applied. Ignored when status is given." },
      { name: "sort", type: "string", note: `${JOB_SORT_KEYS.join(" | ")}. Default status (to-do first, then applied, already applied, rejected, withdrawn).` },
      { name: "dir", type: "asc | desc", note: "Defaults per sort: asc for status, title, company; desc for the rest." },
      { name: "offset", type: "number", note: "Default 0." },
      { name: "limit", type: "number", note: `Default ${DEFAULT_PAGE}, max ${MAX_PAGE}.` },
    ],
    responses: [
      { code: 200, meaning: "{ jobs: [ summary, … ], nextOffset: number | null }" },
      { code: 401, meaning: "Missing or revoked token." },
    ],
    responseFields: [
      { name: "jobs", type: "object[]", note: "Job summaries (same fields as ?ids=)." },
      { name: "nextOffset", type: "number | null", note: "Pass as offset for the next page; null on the last page." },
    ],
    example: (origin, token) => `curl "${origin}/api/jobs?acted=1&sort=company&limit=100" \\
  ${bearer(token)}`,
    exampleOutput: `200 {"jobs": [{"id": "…", "company": "Acme", "host": "acme.com", "status": "rejected", …}], "nextOffset": null}`,
  },
  {
    id: "get",
    method: "GET",
    path: "/api/jobs/{id}",
    title: "Read one job in full",
    summary: "Everything about a job: the posting text, requirements, scores with rationale, keywords, the tailored resume and any cover letter.",
    responses: [
      { code: 200, meaning: "The full job object." },
      { code: 401, meaning: "Missing or revoked token." },
      { code: 404, meaning: "Not your job, or deleted." },
    ],
    responseFields: FULL_JOB_EXTRA_FIELDS,
    responseNote: "Plus every summary field except host (see “Check several jobs”).",
    example: (origin, token) => `curl ${origin}/api/jobs/JOB_ID \\
  ${bearer(token)}`,
  },
  {
    id: "pdf",
    method: "GET",
    path: "/api/jobs/{id}/pdf",
    title: "Download the PDF",
    summary: "The tailored resume as a PDF, or the cover letter once the user has written one in the app. The filename is in Content-Disposition.",
    query: [
      { name: "kind", type: "resume | cover", note: "Default resume." },
      { name: "tz", type: "string", note: "IANA time zone (e.g. America/New_York) for the date on a cover letter." },
    ],
    responses: [
      { code: 200, meaning: "application/pdf. X-Job-Id header carries the id." },
      { code: 401, meaning: "Missing or revoked token." },
      { code: 404, meaning: "No such job, no base resume, or no cover letter yet." },
      { code: 409, meaning: "Not tailored yet: { error, stage }. Poll until stage is done (or approve it in the app if pending)." },
    ],
    example: (origin, token) => `curl -o resume.pdf ${origin}/api/jobs/JOB_ID/pdf \\
  ${bearer(token)}`,
  },
  {
    id: "patch",
    method: "PATCH",
    path: "/api/jobs/{id}",
    title: "Record the application",
    summary: "Set the job's status once the agent has applied (or heard back), and/or mark it seen. The first applied / interviewing / offer sets the applied date; going back to not_applied clears the job's history.",
    headers: [{ name: "Content-Type", type: "application/json", note: "", required: true }],
    body: [
      { name: "status", type: "string", note: `One of ${JOB_STATUS_KEYS.join(", ")}.` },
      { name: "seen", type: "true", note: "Mark the job as looked at so it stops sorting to the top of the list. Any status change does this too." },
    ],
    bodyNote: "Send status, seen: true, or both.",
    responses: [
      { code: 200, meaning: "{ status, statusAt, appliedAt, seenAt }" },
      { code: 400, meaning: "Invalid status, or neither field sent." },
      { code: 401, meaning: "Missing or revoked token." },
      { code: 404, meaning: "Not your job, or deleted." },
    ],
    example: (origin, token) => `curl -X PATCH ${origin}/api/jobs/JOB_ID \\
  ${bearer(token)} \\
  -H "Content-Type: application/json" \\
  -d '{"status": "applied"}'`,
    exampleOutput: `200 {"status": "applied", "statusAt": "2026-10-22T14:03:11.000Z", "appliedAt": "2026-10-22T14:03:11.000Z", "seenAt": "…"}`,
  },
];

export const STAGE_FLOW = "pending → queued → scraping → extracting → scoring → tailoring → rescoring → done (or failed)";

// Things an agent might reasonably try that a token can't do. Listed so it stops guessing.
export const SESSION_ONLY = [
  "Approving a pending job (POST /api/jobs/{id}/approve): only the user, in the app. Use POST /api/jobs/tailor instead if the agent should tailor on its own.",
  "Retrying a failed job (POST /api/jobs/{id}/retry) or re-tailoring (POST /api/jobs/{id}/tailor): re-send the same job to POST /api/jobs/tailor instead.",
  "Writing or editing a cover letter (POST / PUT /api/jobs/{id}/cover): the user does this in the app; the token can then download it with ?kind=cover.",
  "Deleting a job (DELETE /api/jobs/{id}), editing a tailored resume (PUT /api/jobs/{id}), or anything under /api/resume, /api/facts, /api/tokens, /api/chat: 401 for a token.",
];

export const LIMITS = [
  `${DAILY_LIMIT} new jobs per rolling 24 hours per user, counted across POST /api/jobs and POST /api/jobs/tailor. Duplicates don't count.`,
  `${MAX_BATCH} jobs per POST /api/jobs request; ${MAX_IDS} ids per ?ids= query; ${MAX_PAGE} rows per list page.`,
  `description must be ${MIN_DESCRIPTION}–${MAX_DESCRIPTION.toLocaleString("en-US")} characters; url max 2000.`,
  "POST /api/jobs/tailor holds the connection for up to 4.5 minutes, then answers 202.",
  "Tokens are accepted only on /api/jobs… paths. Every other /api route answers 401 to a Bearer token.",
];

const table = (rows: Field[]) =>
  ["| Field | Type | Notes |", "|---|---|---|", ...rows.map((f) => `| \`${f.name}\`${f.required ? " (required)" : ""} | ${f.type} | ${f.note.replace(/\|/g, "\\|")} |`)].join("\n");

const TOKEN_PLACEHOLDER = "rb_…";

// The whole reference as one markdown document, for pasting into an agent's instructions.
export function apiReferenceMarkdown(origin: string) {
  const out: string[] = [];
  out.push(`# resume.buzz API`, ``);
  out.push(
    `Base URL: \`${origin}\`. Authenticate every request with \`Authorization: Bearer <token>\` (tokens start with \`rb_\`; the user creates them under account menu → API). JSON in, JSON out, except the PDF endpoints. Tokens only work on \`/api/jobs…\` paths.`,
    ``,
  );
  out.push(`## How it fits together`, ``);
  out.push(
    `1. Before pitching a role, \`GET /api/jobs?acted=1\` lists every employer the user has already applied to, been rejected by, or dropped (check \`company\` and \`host\`).`,
    `2. \`POST /api/jobs\` adds a lead that waits for the user's approval in the app (nothing billed). Or \`POST /api/jobs/tailor\` crawls and tailors it right away and returns the scores and a PDF link (billed, no approval).`,
    `3. Poll \`GET /api/jobs?ids=…\` or \`GET /api/jobs/{id}\` until \`stage\` is \`done\`. Stages: ${STAGE_FLOW}.`,
    `4. \`GET /api/jobs/{id}/pdf\` downloads the tailored resume (\`?kind=cover\` for the cover letter).`,
    `5. After applying, \`PATCH /api/jobs/{id}\` with \`{"status": "applied"}\`.`,
    ``,
  );
  out.push(`Every submit response also carries \`companyConflict\` and \`conflicts\` (your jobs at the same employer with any status other than \`not_applied\`). The job is still created; the agent decides.`, ``);
  out.push(`## Statuses and stages`, ``);
  out.push(`\`status\` (application): ${JOB_STATUS_KEYS.map((k) => `\`${k}\` (${JOB_STATUSES[k].label})`).join(", ")}.`, ``);
  out.push(`\`stage\` (pipeline): ${JOB_STAGE_KEYS.map((k) => `\`${k}\``).join(", ")}. Order: ${STAGE_FLOW}. A pending job stays pending until the user approves it in the app.`, ``);
  out.push(`## Limits`, ``, ...LIMITS.map((l) => `- ${l}`), ``);
  out.push(`## Endpoints`, ``);
  for (const e of ENDPOINTS) {
    out.push(`### ${e.method} ${e.path} — ${e.title}`, ``, e.summary, ``);
    if (e.headers?.length) out.push(`**Headers**`, ``, table(e.headers), ``);
    if (e.query?.length) out.push(`**Query parameters**`, ``, table(e.query), ``);
    if (e.body?.length) {
      out.push(`**Body**${e.bodyNote ? ` — ${e.bodyNote}` : ""}`, ``, table(e.body), ``);
    }
    out.push(`**Responses**`, ``, ...e.responses.map((r) => `- \`${r.code}\` ${r.meaning}`), ``);
    if (e.responseFields?.length) {
      out.push(`**Response fields**${e.responseNote ? ` — ${e.responseNote}` : ""}`, ``, table(e.responseFields), ``);
    } else if (e.responseNote) out.push(e.responseNote, ``);
    out.push("```sh", e.example(origin, TOKEN_PLACEHOLDER), "```", ``);
    if (e.exampleOutput) out.push("```", e.exampleOutput.replaceAll("{origin}", origin), "```", ``);
  }
  out.push(`## Not available to a token`, ``, ...SESSION_ONLY.map((s) => `- ${s}`), ``);
  return out.join("\n");
}
