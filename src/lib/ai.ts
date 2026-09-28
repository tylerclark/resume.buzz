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
