import { setCoverStarters, userFromRequest } from "@/lib/data";
import { MAX_COVER_STARTER_LENGTH, MAX_COVER_STARTERS } from "@/lib/types";

// Replace the user's cover letter starter prompts (they apply to every job).
export async function PUT(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { starters } = (await request.json()) as { starters?: unknown };
  if (!Array.isArray(starters) || !starters.every((s) => typeof s === "string"))
    return Response.json({ error: "Invalid starters" }, { status: 400 });

  const cleaned = [
    ...new Set(starters.map((s) => s.trim().slice(0, MAX_COVER_STARTER_LENGTH)).filter(Boolean)),
  ].slice(0, MAX_COVER_STARTERS);
  const saved = await setCoverStarters(user.id, cleaned);
  if (!saved) return Response.json({ error: "Add your base resume first." }, { status: 400 });
  return Response.json(saved);
}
