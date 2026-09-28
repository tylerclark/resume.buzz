import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Resend } from "resend";
import { db, schema } from "@/db";

// Optional comma-separated allowlist. Empty = anyone can sign in.
const allowed = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  session: { expiresIn: 60 * 60 * 24 * 30 },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      storeOTP: "hashed",
      async sendVerificationOTP({ email, otp }) {
        if (allowed.length && !allowed.includes(email.toLowerCase())) {
          throw new APIError("FORBIDDEN", { message: "This email isn't on the invite list." });
        }
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

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}
