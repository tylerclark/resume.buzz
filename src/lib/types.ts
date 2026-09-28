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
