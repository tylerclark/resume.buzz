import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { DEMO_COOKIE, ensureDemoUser } from "@/lib/demo";

// Turn demo mode on or off for this browser: { on: boolean }. Reads the real session (not the demo
// user) so it can always be switched back.
export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { on } = (await request.json().catch(() => ({}))) as { on?: unknown };
  if (typeof on !== "boolean") return Response.json({ error: "Send { on: true | false }." }, { status: 400 });

  const jar = await cookies();
  if (on) {
    await ensureDemoUser(session.user.id);
    jar.set(DEMO_COOKIE, session.user.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  } else {
    jar.delete(DEMO_COOKIE);
  }
  return Response.json({ demo: on });
}
