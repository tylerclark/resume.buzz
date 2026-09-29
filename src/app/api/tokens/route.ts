import { createApiToken, listApiTokens } from "@/lib/api-tokens";
import { userFromRequest } from "@/lib/data";

// Personal API tokens are managed with a session only (a token can't mint more tokens).
export async function GET(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ tokens: await listApiTokens(user.id) }, { headers: { "Cache-Control": "no-store" } });
}

const MAX_TOKENS = 10;

// Returns the token itself exactly once.
export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { name } = (await request.json().catch(() => ({}))) as { name?: unknown };
  const label = String(name ?? "").trim().slice(0, 60) || "API token";
  if ((await listApiTokens(user.id)).length >= MAX_TOKENS) {
    return Response.json({ error: `You can have up to ${MAX_TOKENS} tokens. Revoke one first.` }, { status: 400 });
  }
  return Response.json(await createApiToken(user.id, label), { status: 201 });
}
