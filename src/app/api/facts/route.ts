import { getFacts, setFacts, userFromRequest } from "@/lib/data";

// Add experience the user has but the base resume doesn't mention.
export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { keyword, detail } = (await request.json()) as { keyword?: string; detail?: string };
  if (!keyword?.trim() || !detail?.trim())
    return Response.json({ error: "Describe where you used it." }, { status: 400 });

  const facts = await getFacts(user.id);
  const saved = await setFacts(user.id, [
    ...facts,
    { id: crypto.randomUUID(), keyword: keyword.trim().slice(0, 100), detail: detail.trim().slice(0, 1000) },
  ]);
  if (!saved) return Response.json({ error: "Add your base resume first." }, { status: 400 });
  return Response.json(saved);
}

export async function DELETE(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  const facts = await getFacts(user.id);
  const saved = await setFacts(
    user.id,
    facts.filter((f) => f.id !== id),
  );
  return Response.json(saved ?? []);
}
