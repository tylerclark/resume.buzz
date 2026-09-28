import { getBaseResume, userFromRequest } from "@/lib/data";
import { startJob } from "@/lib/pipeline";
import { DEFAULT_PROMPT } from "@/lib/types";

// `after()` work (the pipeline) runs within this route's duration budget.
export const maxDuration = 300;

// Creates the job and kicks off the pipeline in the background. Responds right away with the id;
// the client navigates to /j/[id] and polls GET /api/jobs?ids= for progress.
export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { url: rawUrl, prompt } = (await request.json()) as { url?: string; prompt?: string };
  let url: string;
  try {
    const u = new URL(String(rawUrl ?? "").trim());
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw new Error();
    url = u.toString();
  } catch {
    return Response.json({ error: "That doesn't look like a URL." }, { status: 400 });
  }

  if (!(await getBaseResume(user.id))) return Response.json({ error: "Add your base resume first." }, { status: 400 });

  const id = await startJob(user.id, url, prompt?.trim() || DEFAULT_PROMPT);
  return Response.json({ id }, { status: 202 });
}
