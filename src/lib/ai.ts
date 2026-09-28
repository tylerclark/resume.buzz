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
  type Resume,
  type TailoredResume,
} from "./types";

// Claude via Vercel AI Gateway (Anthropic Messages-compatible). On Vercel, OIDC works without a key.
const anthropic = new Anthropic({
  apiKey: process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
  baseURL: "https://ai-gateway.vercel.sh",
});
const MODEL = process.env.AI_GATEWAY_MODEL ?? "anthropic/claude-opus-5";

async function structured<T extends z.ZodType>(
  schema: T,
  system: string,
  content: Anthropic.ContentBlockParam[] | string,
): Promise<z.infer<T>> {
  const res = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(schema) },
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (!res.parsed_output) throw new Error(`Model returned no structured output (stop_reason: ${res.stop_reason})`);
  return res.parsed_output;
}

const resumeJson = (r: Resume) => JSON.stringify(r, null, 2);

export async function scrapePosting(url: string) {
  const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });
  const doc = await firecrawl.scrape(url, { formats: ["markdown"], onlyMainContent: true });
  if (!doc.markdown?.trim()) throw new Error("Couldn't read any text from that page.");
  return doc.markdown;
}

export function extractJob(url: string, markdown: string) {
  return structured(
    JobDetailsSchema,
    "You extract structured job-posting details from scraped web pages. Use only what the page says; leave fields empty when unknown.",
    `Posting URL: ${url}\n\n<page>\n${markdown}\n</page>`,
  );
}

export function scoreJob(base: Resume, description: string) {
  return structured(
    JobScoreSchema,
    "You compare a candidate's resume to a job posting. Be honest and specific: 'hit' means clearly demonstrated in the resume, 'partial' means adjacent evidence, 'miss' means absent.",
    `<resume>\n${resumeJson(base)}\n</resume>\n\n<posting>\n${description}\n</posting>`,
  );
}

export function tailorResume(base: Resume, description: string, prompt: string): Promise<TailoredResume> {
  return structured(
    TailoredResumeSchema,
    `${prompt}

Output format rules:
- Return every section and entry from the base resume (you may reorder sections, entries and bullets).
- For each bullet and the headline, "original" is the exact base-resume text it came from and "text" is your tailored version.
- If a line is unchanged, set text equal to original.
- To drop a base bullet, keep it with text "". To add a line that has no base source, use original "" — only when it restates facts already in the resume.
- Keep role, org and dates exactly as in the base resume.`,
    `<base_resume>\n${resumeJson(base)}\n</base_resume>\n\n<posting>\n${description}\n</posting>`,
  );
}

export async function writeCoverLetter(
  base: Resume,
  tailored: TailoredResume | null,
  description: string,
  guidance: string,
) {
  const { paragraphs } = await structured(
    z.object({ paragraphs: z.array(z.string()).describe("Body paragraphs only — no greeting, date or sign-off") }),
    "You write honest, specific cover letters in the candidate's own voice. Never claim experience the resume doesn't support; acknowledge gaps plainly when relevant.",
    `<resume>\n${resumeJson(base)}\n</resume>\n\n${tailored ? `<tailored_resume>\n${JSON.stringify(tailored)}\n</tailored_resume>\n\n` : ""}<posting>\n${description}\n</posting>\n\nGuidance from the candidate: ${guidance.trim() || "(none)"}`,
  );
  return paragraphs;
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
  content.push({ type: "text", text: "Convert this resume into the structured format. Copy text verbatim; don't rewrite." });
  return structured(
    ResumeSchema,
    "You convert resumes into structured data. Preserve the author's exact wording. Put skill lists as a single entry with empty role/org/dates whose bullets are the lines of the list.",
    content,
  );
}
