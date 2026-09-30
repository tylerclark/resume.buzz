import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import Firecrawl from "@mendable/firecrawl-js";
import { z } from "zod";
import {
  JobDetailsSchema,
  JobScoreSchema,
  ResumeSchema,
  TailoredResumeSchema,
  finalResume,
  type Fact,
  type Resume,
  type StoredTailored,
  type TailoredResume,
} from "./types";
import { alignToBase } from "./align";
import { scrub, STYLE_RULES } from "./style";

// Claude via Vercel AI Gateway (Anthropic Messages-compatible). On Vercel, OIDC works without a key.
const anthropic = new Anthropic({
  apiKey: process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
  baseURL: "https://ai-gateway.vercel.sh",
});
const MODEL = process.env.AI_GATEWAY_MODEL ?? "anthropic/claude-opus-5.5";

type Effort = "low" | "medium" | "high";

async function structured<T extends z.ZodType>(
  schema: T,
  system: string,
  content: Anthropic.ContentBlockParam[] | string,
  effort: Effort,
): Promise<z.infer<T>> {
  const res = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(schema), effort },
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (!res.parsed_output) throw new Error(`Model returned no structured output (stop_reason: ${res.stop_reason})`);
  return res.parsed_output;
}

const resumeJson = (r: Resume) => JSON.stringify(r, null, 2);

const factsBlock = (facts: Fact[]) =>
  facts.length
    ? `\n\n<confirmed_experience>\nThe candidate confirmed these are true even though the base resume doesn't mention them:\n${facts
        .map((f) => `- ${f.keyword}: ${f.detail}`)
        .join("\n")}\n</confirmed_experience>`
    : "";

export async function scrapePosting(url: string) {
  const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });
  // Most ATS pages (Workday, iCIMS, etc.) render the posting client-side, so give JS time to run.
  // onlyMainContent is off because it strips the posting when the page layout is unusual; Claude filters the chrome.
  const doc = await firecrawl.scrape(url, {
    formats: ["markdown"],
    onlyMainContent: false,
    waitFor: 3000,
    proxy: "auto",
  });
  const status = doc.metadata?.statusCode ?? 200;
  if (status >= 400) throw new Error(`The posting page returned HTTP ${status}.`);
  if (!doc.markdown?.trim()) throw new Error("Couldn't read any text from that page.");
  return doc.markdown;
}

export function extractJob(url: string, markdown: string) {
  return structured(
    JobDetailsSchema,
    "You extract structured job-posting details from scraped web pages. Use only what the page says; leave fields empty when unknown.",
    `${url ? `Posting URL: ${url}` : "Source: text the candidate pasted from the posting"}\n\n<page>\n${markdown}\n</page>`,
    "low",
  );
}

export function scoreJob(base: Resume, description: string, facts: Fact[] = []) {
  return structured(
    JobScoreSchema,
    "You compare a candidate's resume to a job posting. Be honest and specific: 'hit' means clearly demonstrated in the resume, 'partial' means adjacent evidence, 'miss' means absent.",
    `<resume>\n${resumeJson(base)}\n</resume>${factsBlock(facts)}\n\n<posting>\n${description}\n</posting>`,
    "medium",
  );
}

export async function tailorResume(
  base: Resume,
  description: string,
  prompt: string,
  facts: Fact[] = [],
): Promise<TailoredResume> {
  const t = await structured(
    TailoredResumeSchema,
    `${prompt}

Output format rules:
- Return every section and entry from the base resume, in exactly the same order as the base resume. Never reorder sections or entries (entries are in timeline order). You may reorder bullets within an entry.
- For each bullet and the headline, "original" is the exact base-resume text it came from and "text" is your tailored version.
- If a line is unchanged, set text equal to original.
- To drop a base bullet, keep it with text "". To add a line that has no base source, use original "" (only when it restates facts already in the resume).
- Keep role, org and dates exactly as in the base resume.
- Items in <confirmed_experience> are true. When relevant to the posting, work them into the entry they belong to (rewording a bullet or adding one with original "") or into Skills. Never attribute them to a different employer than stated.

${STYLE_RULES}`,
    `<base_resume>\n${resumeJson(base)}\n</base_resume>${factsBlock(facts)}\n\n<posting>\n${description}\n</posting>`,
    "high",
  );
  // Belt and braces: the rules above are a request; this makes them a guarantee.
  const clean = (l: { original: string; text: string }) => ({ ...l, text: scrub(l.text) });
  return alignToBase(
    {
      ...t,
      headline: clean(t.headline),
      sections: t.sections.map((s) => ({
        ...s,
        entries: s.entries.map((e) => ({ ...e, bullets: e.bullets.map(clean) })),
      })),
    },
    base,
  );
}

export async function writeCoverLetter(
  base: Resume,
  tailored: StoredTailored | null,
  description: string,
  guidance: string,
) {
  const { paragraphs } = await structured(
    z.object({ paragraphs: z.array(z.string()).describe("Body paragraphs only: no greeting, date or sign-off") }),
    `You write honest, specific cover letters in the candidate's own voice. Never claim experience the resume doesn't support; acknowledge gaps plainly when relevant.\n\n${STYLE_RULES}`,
    `<resume>\n${resumeJson(base)}\n</resume>\n\n${tailored ? `<tailored_resume>\n${JSON.stringify(finalResume(tailored))}\n</tailored_resume>\n\n` : ""}<posting>\n${description}\n</posting>\n\nGuidance from the candidate: ${guidance.trim() || "(none)"}`,
    "high",
  );
  return paragraphs.map(scrub);
}

export function parseResumeFile(file: { name: string; type: string; data: Buffer; text?: string }) {
  const content: Anthropic.ContentBlockParam[] = file.text
    ? [{ type: "text", text: `<resume_file name="${file.name}">\n${file.text}\n</resume_file>` }]
    : [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: file.data.toString("base64") },
        },
      ];
  content.push({
    type: "text",
    text: "Convert this resume into the structured format. Copy text verbatim; don't rewrite.",
  });
  return structured(
    ResumeSchema,
    "You convert resumes into structured data. Preserve the author's exact wording. Put skill lists as a single entry with empty role/org/dates whose bullets are the lines of the list.",
    content,
    "low",
  );
}

// ---------- Chat ----------

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatContext = {
  base: Resume | null;
  facts: Fact[];
  job: {
    title: string;
    company: string;
    location: string;
    pay: string;
    employmentType: string;
    level: string;
    url: string;
    status: string;
    notes: string;
    raw: string;
    prompt: string;
    score: number;
    scoreNote: string;
    requirements: { status: string; text: string }[];
    tailoredScore: number | null;
    tailoredScoreNote: string | null;
    tailoredRequirements: { status: string; text: string }[] | null;
    keywordsHit: string[];
    keywordsMissing: string[];
    tailored: StoredTailored | null;
    coverLetter: string[] | null;
  } | null;
};

const reqList = (rs: { status: string; text: string }[]) => rs.map((r) => `- [${r.status}] ${r.text}`).join("\n");

function chatSystem(ctx: ChatContext) {
  const parts: string[] = [
    `You are the resume.buzz assistant: a blunt, practical coach helping a candidate land one specific job. You can see everything resume.buzz knows about them and the posting (below). Answer questions about the fit, the scores, the tailored resume, the cover letter, interview prep, or anything else in that context.

How the scores work: the "base score" (0–100) is how well the candidate's base resume plus their confirmed facts fits the posting; the "tailored score" is the same measure for the tailored resume. Both come from the requirement checklist: "hit" = clearly demonstrated, "partial" = adjacent evidence, "miss" = absent. The way to drive the score up is to turn partials and misses into hits honestly: surface real experience the resume leaves out (the candidate can add these as confirmed facts, which are then worked into tailoring), reword bullets to use the posting's language, and re-run tailoring. Never suggest inventing experience.

Style: plain text, no markdown headers or tables. Short paragraphs; "-" bullets when listing. Be specific: quote the requirement or bullet you mean. Keep answers tight unless asked to go deep. When you suggest a resume change, give the exact wording. When something isn't in the context (e.g. no job open), say so instead of guessing.`,
  ];
  if (ctx.base) parts.push(`<base_resume>\n${resumeJson(ctx.base)}\n</base_resume>`);
  else parts.push("The candidate has not added a base resume yet.");
  if (ctx.facts.length) parts.push(factsBlock(ctx.facts).trim());
  const j = ctx.job;
  if (!j) {
    parts.push("No job is open right now (the candidate is on the Home tab). You can still talk about the base resume in general.");
    return parts.join("\n\n");
  }
  const meta = [
    `Title: ${j.title || "(unknown)"}`,
    `Company: ${j.company || "(unknown)"}`,
    j.location && `Location: ${j.location}`,
    j.pay && `Pay: ${j.pay}`,
    j.employmentType && `Type: ${j.employmentType}`,
    j.level && `Level: ${j.level}`,
    j.url && `URL: ${j.url}`,
    `Application status: ${j.status}`,
    j.notes && `Notes attached to this job: ${j.notes}`,
  ]
    .filter(Boolean)
    .join("\n");
  parts.push(`<job>\n${meta}\n</job>`);
  parts.push(`<posting>\n${j.raw}\n</posting>`);
  parts.push(
    `<base_score>\nScore: ${j.score}/100\n${j.scoreNote}\nRequirements against the base resume:\n${reqList(j.requirements)}\n</base_score>`,
  );
  if (j.tailoredScore !== null)
    parts.push(
      `<tailored_score>\nScore: ${j.tailoredScore}/100\n${j.tailoredScoreNote ?? ""}\nRequirements against the tailored resume:\n${reqList(j.tailoredRequirements ?? [])}\nKeywords hit: ${j.keywordsHit.join(", ") || "(none)"}\nKeywords missing: ${j.keywordsMissing.join(", ") || "(none)"}\n</tailored_score>`,
    );
  parts.push(`<tailoring_instructions>\n${j.prompt}\n</tailoring_instructions>`);
  if (j.tailored)
    parts.push(
      `<tailored_resume note="the resume as it will be sent, including the candidate's own edits">\n${JSON.stringify(finalResume(j.tailored), null, 2)}\n</tailored_resume>`,
    );
  else parts.push("The resume has not been tailored for this job yet (or tailoring is still running).");
  if (j.coverLetter) parts.push(`<cover_letter>\n${j.coverLetter.join("\n\n")}\n</cover_letter>`);
  return parts.join("\n\n");
}

// Streams the assistant's reply as plain text chunks.
export function chatStream(ctx: ChatContext, messages: ChatMessage[], signal?: AbortSignal) {
  const stream = anthropic.messages.stream(
    {
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: chatSystem(ctx),
      messages,
    },
    { signal },
  );
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      stream.on("text", (t) => controller.enqueue(enc.encode(t)));
      stream.on("error", (e) => controller.error(e));
      stream.on("abort", () => controller.close());
      stream.on("finalMessage", () => controller.close());
    },
    cancel() {
      stream.abort();
    },
  });
}
