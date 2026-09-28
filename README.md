# resume.buzz

Paste a job URL → get your base resume tailored to it (with a word-level diff), plus an optional cover letter.

Stack: Next.js 16 (App Router) · BetterAuth email OTP (Resend) · Neon Postgres + Drizzle · Firecrawl · Claude via Vercel AI Gateway.

## Setup

```sh
pnpm install
vercel env pull .env.local   # DATABASE_URL etc. from the Neon integration
# then fill RESEND_API_KEY, AI_GATEWAY_API_KEY, FIRECRAWL_API_KEY in .env.local (see .env.example)
pnpm db:migrate
pnpm dev
```

## Routes

- `/login` — email → 6-digit code
- `/` — workspace (paste URL, recent jobs)
- `/j/[id]` — a tailored job: match score, requirements, keywords, diff toggle, prompt, cover letter
- "Base resume" drawer (header button) — edit base resume, PDF/DOCX import
- `/https://…` — prefix any posting URL to start tailoring it

Schema changes: edit `src/db/schema.ts`, then `pnpm db:generate && pnpm db:migrate`.
