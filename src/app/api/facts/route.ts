import { getFacts, setFacts, userFromRequest } from "@/lib/data";

type Incoming = { keyword?: string; detail?: string };

// Add experience the user has but the base resume doesn't mention. Accepts one { keyword, detail } or
// { facts: [{ keyword, detail }, …] } so several keywords can be confirmed in a single re-tailor.
export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as Incoming & { facts?: Incoming[] };
  const incoming = (Array.isArray(body.facts) ? body.facts : [body])
    .map((f) => ({ keyword: String(f.keyword ?? "").trim(), detail: String(f.detail ?? "").trim() }))
    .filter((f) => f.keyword || f.detail);
  if (incoming.length === 0 || incoming.some((f) => !f.keyword || !f.detail))
    return Response.json({ error: "Describe where you used each one." }, { status: 400 });

  const facts = await getFacts(user.id);
  const saved = await setFacts(user.id, [
    ...facts,
    ...incoming.map((f) => ({
      id: crypto.randomUUID(),
      keyword: f.keyword.slice(0, 100),
      detail: f.detail.slice(0, 1000),
    })),
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
