import "server-only";
import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { job, type Job } from "@/db/schema";
import { extractJob, scoreJob, scrapePosting, tailorResume, writeCoverLetter } from "./ai";
import { getBaseResume, getFacts } from "./data";
import { DEFAULT_PROMPT, finalResume, resumeHash, type JobStage } from "./types";

// The tailoring pipeline runs on the server *after* the request that kicked it off has returned, so the
// user can open other tabs, refresh, or close the browser while it works. Every stage transition is
// written to the job row, and the UI polls for it.
//
// Cancellation = deleting the row: each stage write is conditional on the row still existing, and the
// pipeline stops as soon as one of those writes touches nothing.

class Cancelled extends Error {}

type Patch = Partial<typeof job.$inferInsert>;

async function advance(id: string, userId: string, stage: JobStage, patch: Patch = {}) {
  const rows = await db
    .update(job)
    .set({ ...patch, stage, updatedAt: new Date() })
    .where(and(eq(job.id, id), eq(job.userId, userId)))
    .returning({ id: job.id });
  if (rows.length === 0) throw new Cancelled();
}

async function fail(id: string, userId: string, err: unknown) {
  if (err instanceof Cancelled) return;
  console.error(`[pipeline] job ${id} failed:`, err);
  const message = err instanceof Error ? err.message : "Something went wrong.";
  await db
    .update(job)
    .set({ stage: "failed", error: message.slice(0, 1000), updatedAt: new Date() })
    .where(and(eq(job.id, id), eq(job.userId, userId)));
}

// Runs the pipeline from `from` onward for an existing row. Each step persists its own results so a
// retry can resume, and the tab shows the title as soon as it's known.
async function run(id: string, userId: string, from: JobStage) {
  const order: JobStage[] = ["scraping", "extracting", "scoring", "tailoring", "rescoring"];
  const startAt = Math.max(0, order.indexOf(from));
  try {
    const [row, base, facts] = await Promise.all([
      db.select().from(job).where(and(eq(job.id, id), eq(job.userId, userId))).then((r) => r[0]),
      getBaseResume(userId),
      getFacts(userId),
    ]);
    if (!row) throw new Cancelled();
    if (!base) throw new Error("Add your base resume first.");

    let description = row.raw;

    // Two ways in: a URL we scrape, or text the user pasted (LinkedIn etc. can't be crawled). Pasted jobs
    // are created with `raw` filled in and start at "extracting".
    if (startAt <= order.indexOf("extracting")) {
      let page = row.raw;
      if (startAt <= order.indexOf("scraping") && !row.pasted) {
        if (!row.url) throw new Error("This job has no URL and no pasted description.");
        await advance(id, userId, "scraping");
        page = await scrapePosting(row.url);
      }
      await advance(id, userId, "extracting");
      const details = await extractJob(row.url, page);
      // Don't score/tailor against an empty page (e.g. a JS app that never finished loading).
      if (!details.title.trim() || details.description.trim().length < 200) {
        throw new Error(
          !row.pasted
            ? "Couldn't find a job posting on that page — it may need a login or didn't finish loading. Try the company's direct careers link, or paste the description instead."
            : "Couldn't find a job posting in that text. Paste the full description, including the title.",
        );
      }
      // Pasted text is already the posting; for scraped pages keep Claude's chrome-free version.
      description = row.pasted ? row.raw : details.description;
      await advance(id, userId, "scoring", {
        title: details.title,
        company: details.company,
        location: details.location,
        pay: details.pay,
        employmentType: details.employmentType,
        level: details.level,
        raw: description,
      });
    } else if (startAt <= order.indexOf("scoring")) {
      await advance(id, userId, "scoring");
    }

    if (startAt <= order.indexOf("scoring")) {
      const score = await scoreJob(base, description, facts);
      await advance(id, userId, "tailoring", {
        score: Math.max(0, Math.min(100, score.score)),
        scoreNote: score.scoreNote,
        requirements: score.requirements,
      });
    } else {
      await advance(id, userId, "tailoring");
    }

    const tailored = await tailorResume(base, description, row.prompt || DEFAULT_PROMPT, facts);
    await advance(id, userId, "rescoring", {
      tailored,
      baseHash: resumeHash(base),
      keywordsHit: tailored.keywordsHit,
      keywordsMissing: tailored.keywordsMissing,
    });

    // Score the resume we actually produced, so the panel can show before → after.
    const after = await scoreJob({ ...base, ...finalResume(tailored) }, description, facts);
    await advance(id, userId, "done", {
      tailoredScore: Math.max(0, Math.min(100, after.score)),
      tailoredScoreNote: after.scoreNote,
      tailoredRequirements: after.requirements,
      error: null,
    });
  } catch (err) {
    await fail(id, userId, err);
  }
}

// Create the row and schedule the full pipeline. Returns immediately with the new id. Either a URL to
// scrape or a pasted description (with an optional URL kept only as the link back to the posting).
export async function startJob(userId: string, source: { url: string; description?: string }, prompt: string) {
  const id = crypto.randomUUID();
  const raw = source.description?.trim() ?? "";
  await db
    .insert(job)
    .values({ id, userId, url: source.url, pasted: !!raw, title: "", company: "", raw, prompt, stage: "queued" });
  after(() => run(id, userId, raw ? "extracting" : "scraping"));
  return id;
}

// Re-run just the tailoring step (e.g. with an edited prompt, or after the base resume changed).
export async function retailorJob(row: Job, prompt: string) {
  await advance(row.id, row.userId, "queued", { prompt, error: null });
  after(() => run(row.id, row.userId, "tailoring"));
}

// Resume a failed job from the last step that didn't finish.
export async function retryJob(row: Job) {
  // A pasted job has `raw` from the start; `title` only lands once extraction succeeds.
  const from: JobStage = !row.raw
    ? "scraping"
    : row.pasted && !row.title
      ? "extracting"
    : row.tailored
        ? "tailoring"
        : !row.scoreNote
          ? "scoring"
          : "tailoring";
  await advance(row.id, row.userId, "queued", { error: null });
  after(() => run(row.id, row.userId, from));
}

export async function startCoverLetter(row: Job, prompt: string) {
  await db
    .update(job)
    .set({ coverPrompt: prompt, coverStage: "writing", coverError: null, updatedAt: new Date() })
    .where(and(eq(job.id, row.id), eq(job.userId, row.userId)));
  after(async () => {
    try {
      const base = await getBaseResume(row.userId);
      if (!base) throw new Error("Add your base resume first.");
      const coverLetter = await writeCoverLetter(base, row.tailored, row.raw, prompt);
      await db
        .update(job)
        .set({ coverLetter, coverStage: "idle", coverError: null, updatedAt: new Date() })
        .where(and(eq(job.id, row.id), eq(job.userId, row.userId)));
    } catch (err) {
      console.error(`[pipeline] cover letter for ${row.id} failed:`, err);
      await db
        .update(job)
        .set({
          coverStage: "failed",
          coverError: (err instanceof Error ? err.message : "Cover letter failed.").slice(0, 1000),
          updatedAt: new Date(),
        })
        .where(and(eq(job.id, row.id), eq(job.userId, row.userId)));
    }
  });
}
