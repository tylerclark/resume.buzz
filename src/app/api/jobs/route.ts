import { listJobsByIds, userFromRequest } from "@/lib/data";

// Lightweight status for a set of jobs (tab bar + progress polling): ?ids=a,b,c
export async function GET(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const ids = [
    ...new Set(
      (new URL(request.url).searchParams.get("ids") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, 100);
  const jobs = await listJobsByIds(user.id, ids);
  return Response.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}
