import { getBaseResume, userFromRequest } from "@/lib/data";
import { startJob } from "@/lib/pipeline";
import { DEFAULT_PROMPT, MAX_DESCRIPTION, MIN_DESCRIPTION, parseJobUrl } from "@/lib/types";

// `after()` work (the pipeline) runs within this route's duration budget.
export const maxDuration = 300;

// Creates the job and kicks off the pipeline in the background. Responds right away with the id;
// the client navigates to /j/[id] and polls GET /api/jobs?ids= for progress.
export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const {
    url: rawUrl,
    description: rawDescription,
    prompt,
  } = (await request.json()) as { url?: string; description?: string; prompt?: string };
  const description = String(rawDescription ?? "").trim();
  if (description.length > MAX_DESCRIPTION) {
    return Response.json({ error: "That description is too long to be a single posting." }, { status: 400 });
  }
  // With a pasted description the URL is optional (just the link back to the posting); without one it's
  // what we scrape.
  let url = "";
  if (String(rawUrl ?? "").trim() || !description) {
    const parsed = parseJobUrl(rawUrl);
    if (!parsed) return Response.json({ error: "That doesn't look like a URL." }, { status: 400 });
    url = parsed;
  }
  if (description && description.length < MIN_DESCRIPTION) {
    return Response.json({ error: "Paste the whole posting, not just a snippet." }, { status: 400 });
  }

  if (!(await getBaseResume(user.id))) return Response.json({ error: "Add your base resume first." }, { status: 400 });

  const id = await startJob(user.id, { url, description }, prompt?.trim() || DEFAULT_PROMPT);
  return Response.json({ id }, { status: 202 });
}
