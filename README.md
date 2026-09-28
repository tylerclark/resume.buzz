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
- `/` — the "New job" tab (paste URL, recent jobs)
- `/j/[id]` — a job tab: progress while it tailors, then match score, requirements, keywords, diff toggle, prompt, cover letter
- "Base resume" drawer (edit button on the resume) — edit base resume, PDF/DOCX import
- `/https://…` — prefix any posting URL to start tailoring it

## Tabs and background work

Every job is a tab (header bar; `+` opens a new one). Open tabs are kept per browser in localStorage and the
URL says which one is active, so plain links, bookmarks and the history menu all work.

Tailoring doesn't block the browser: `POST /api/tailor` inserts the job row and returns its id right away, and
the scrape → extract → score → tailor pipeline runs on the server via `after()` (`src/lib/pipeline.ts`), writing
each stage to `job.stage`. Re-tailoring and cover letters work the same way (`job.stage` / `job.coverStage`).
The client polls `GET /api/jobs?ids=` for any open tab that's still working (`src/components/job-status.tsx`),
so you can start several jobs, switch tabs, reload, or close the browser while they run. Deleting a job
(`DELETE /api/jobs/[id]`, the Cancel/Discard buttons) also stops its pipeline; a failed job can be retried from
the step that broke (`POST /api/jobs/[id]/retry`). A pipeline that stops reporting for 5 minutes is shown as
failed so nothing spins forever.

## Scores and missing keywords

`job.score` is the base resume's fit to the posting and never changes; `job.tailoredScore` is re-computed after
every tailoring run (the `rescoring` stage scores the resume that was actually produced), so the panel and tab
show the tailored number with the change from the base. Missing keywords are multi-select: pick every one you
actually have, describe each, and "Add & re-tailor" saves them all to your profile (`POST /api/facts` with
`{ facts: [...] }`) and re-tailors once.

Schema changes: edit `src/db/schema.ts`, then `pnpm db:generate && pnpm db:migrate`.
