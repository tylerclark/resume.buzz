import { db } from "@/db";
import { job } from "@/db/schema";
import { extractJob, scoreJob, scrapePosting, tailorResume } from "@/lib/ai";
import { getBaseResume, userFromRequest } from "@/lib/data";
import { DEFAULT_PROMPT } from "@/lib/types";

export const maxDuration = 300;

export type TailorEvent = { step: number } | { done: string } | { error: string };

// Streams NDJSON progress events so the UI can tick through the four steps.
export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { url: rawUrl, prompt } = (await request.json()) as { url?: string; prompt?: string };
  let url: string;
  try {
    url = new URL(String(rawUrl ?? "").trim()).toString();
  } catch {
    return Response.json({ error: "That doesn't look like a URL." }, { status: 400 });
  }

  const base = await getBaseResume(user.id);
  if (!base) return Response.json({ error: "Add your base resume first." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: TailorEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        send({ step: 0 });
        const markdown = await scrapePosting(url);
        send({ step: 1 });
        const details = await extractJob(url, markdown);
        // Don't score/tailor against an empty page (e.g. a JS app that never finished loading).
        if (!details.title.trim() || details.description.trim().length < 200) {
          throw new Error(
            "Couldn't find a job posting on that page — it may need a login or didn't finish loading. Try the company's direct careers link.",
          );
        }
        send({ step: 2 });
        const score = await scoreJob(base, details.description);
        send({ step: 3 });
        const tailorPrompt = prompt?.trim() || DEFAULT_PROMPT;
        const tailored = await tailorResume(base, details.description, tailorPrompt);

        const id = crypto.randomUUID();
        await db.insert(job).values({
          id,
          userId: user.id,
          url,
          title: details.title,
          company: details.company,
          location: details.location,
          pay: details.pay,
          employmentType: details.employmentType,
          level: details.level,
          score: Math.max(0, Math.min(100, score.score)),
          scoreNote: score.scoreNote,
          requirements: score.requirements,
          keywordsHit: tailored.keywordsHit,
          keywordsMissing: tailored.keywordsMissing,
          raw: details.description,
          prompt: tailorPrompt,
          tailored,
        });
        send({ step: 4 });
        send({ done: id });
      } catch (err) {
        console.error(err);
        send({ error: err instanceof Error ? err.message : "Something went wrong." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
