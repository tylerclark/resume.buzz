import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Resend } from "resend";
import { db, schema } from "@/db";
import { effectiveUser, type AppUser } from "./demo";

// Private beta: comma-separated allowlist. Empty = nobody can sign in (fail closed).
const allowed = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const isAllowed = (email: unknown) => typeof email === "string" && allowed.includes(email.trim().toLowerCase());
const GATED_PATHS = new Set(["/email-otp/send-verification-otp", "/sign-in/email-otp"]);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  session: { expiresIn: 60 * 60 * 24 * 30 },
  hooks: {
    // Enforced here (not only inside sendVerificationOTP) because better-auth
    // swallows errors thrown from the send callback and reports success anyway.
    before: createAuthMiddleware(async (ctx) => {
      if (GATED_PATHS.has(ctx.path) && !isAllowed(ctx.body?.email)) {
        throw new APIError("FORBIDDEN", { message: "resume.buzz is in private beta. This email isn't on the invite list." });
      }
    }),
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      storeOTP: "hashed",
      async sendVerificationOTP({ email, otp }) {
        // Belt and braces: never email anyone off the list even if the hook is bypassed.
        if (!isAllowed(email)) return;
        const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
          from: process.env.EMAIL_FROM ?? "resume.buzz <login@resume.buzz>",
          to: email,
          subject: `${otp} is your resume.buzz code`,
          text: `Your resume.buzz sign-in code is ${otp}\n\nIt expires in 10 minutes. If you didn't request it, ignore this email.`,
          html: `<div style="font-family:system-ui,sans-serif;color:#0f1b3d"><p>Your resume.buzz sign-in code:</p><p style="font-size:32px;font-weight:800;letter-spacing:.2em;margin:16px 0">${otp}</p><p style="color:#6b7592;font-size:13px">It expires in 10 minutes. If you didn't request it, ignore this email.</p></div>`,
        });
        if (error) throw new APIError("INTERNAL_SERVER_ERROR", { message: error.message });
      },
    }),
    nextCookies(),
  ],
});

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

// The signed-in user the app should act as, or null. In demo mode that's the demo user, not the real one,
// so everything looked up by its id (resume, jobs, facts) is the demo data.
export async function userFromHeaders(headers: Headers): Promise<AppUser | null> {
  const session = await auth.api.getSession({ headers });
  return session ? effectiveUser(session.user, headers.get("cookie")) : null;
}

export async function requireUser() {
  const user = await userFromHeaders(await headers());
  if (!user) redirect("/login");
  return user;
}
