import { saveBaseResume, userFromRequest } from "@/lib/data";
import { ResumeSchema } from "@/lib/types";

export async function PUT(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = ResumeSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid resume" }, { status: 400 });
  await saveBaseResume(user.id, parsed.data);
  return Response.json({ ok: true });
}
