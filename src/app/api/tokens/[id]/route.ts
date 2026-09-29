import { revokeApiToken } from "@/lib/api-tokens";
import { userFromRequest } from "@/lib/data";

export async function DELETE(request: Request, ctx: RouteContext<"/api/tokens/[id]">) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await revokeApiToken(user.id, id))) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
