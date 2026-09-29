import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Optimistic cookie check only — pages and API routes still verify the session.
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  // Personal API tokens work on the job submit/status endpoint only; the route verifies them.
  if (request.nextUrl.pathname === "/api/jobs" && /^Bearer\s/i.test(request.headers.get("authorization") ?? "")) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/") login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png).*)"],
};
