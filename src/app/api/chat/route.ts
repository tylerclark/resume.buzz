import { chatStream, type ChatMessage } from "@/lib/ai";
import { getBaseResume, getFacts, getJob, userFromRequest } from "@/lib/data";

export const maxDuration = 300;

const MAX_MESSAGES = 40;
const MAX_CHARS = 8000;

// Streams a plain-text reply. The model sees the base resume, confirmed facts and (when jobId is
// given) everything about that job: posting, scores, requirements, tailored resume, cover letter.
export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { jobId?: unknown; messages?: unknown } | null;
  const jobId = typeof body?.jobId === "string" ? body.jobId : null;
  const raw = Array.isArray(body?.messages) ? body.messages : null;
  if (!raw) return Response.json({ error: "Missing messages" }, { status: 400 });

  const messages: ChatMessage[] = [];
  for (const m of raw as { role?: unknown; content?: unknown }[]) {
    if ((m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") continue;
    const content = m.content.trim().slice(0, MAX_CHARS);
    if (!content) continue;
    // Anthropic wants strictly alternating turns; merge repeats.
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + content;
    else messages.push({ role: m.role, content });
  }
  if (messages.length === 0 || messages[messages.length - 1].role !== "user")
    return Response.json({ error: "The last message must be from you." }, { status: 400 });
  if (messages[0].role === "assistant") messages.shift();

  const [base, facts, job] = await Promise.all([
    getBaseResume(user.id),
    getFacts(user.id),
    jobId ? getJob(user.id, jobId) : null,
  ]);
  if (jobId && !job) return Response.json({ error: "Not found" }, { status: 404 });

  const stream = chatStream(
    {
      base,
      facts,
      job: job && {
        title: job.title,
        company: job.company,
        location: job.location,
        pay: job.pay,
        employmentType: job.employmentType,
        level: job.level,
        url: job.url,
        status: job.status,
        notes: job.notes,
        raw: job.raw,
        prompt: job.prompt,
        score: job.score,
        scoreNote: job.scoreNote,
        requirements: job.requirements,
        tailoredScore: job.tailoredScore,
        tailoredScoreNote: job.tailoredScoreNote,
        tailoredRequirements: job.tailoredRequirements,
        keywordsHit: job.keywordsHit,
        keywordsMissing: job.keywordsMissing,
        tailored: job.tailored,
        coverLetter: job.coverLetter,
      },
    },
    messages.slice(-MAX_MESSAGES),
    request.signal,
  );
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
