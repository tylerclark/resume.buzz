# Security policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/tylerclark/resume.buzz/security/advisories/new)
rather than a public issue. You should hear back within a few days.

Include what you found, how to reproduce it, and what you think the impact is.
If you have a fix in mind, say so, but a report alone is plenty.

## Scope

- The application code in this repository.
- The hosted instance at https://resume.buzz. Please test against your own
  self-hosted copy where you can, and never against other users' data.

Out of scope: vulnerabilities in third-party services the app calls (Neon,
Resend, Firecrawl, Vercel AI Gateway) should go to those vendors.

## Supported versions

Only the `main` branch is supported. There are no tagged releases yet.

## What the app does with your data

- Resumes, job postings and generated text are stored in Postgres, scoped to the
  signed-in user, and deleted when the user or job is deleted.
- Resume and posting text is sent to Claude through Vercel AI Gateway to score
  and rewrite it, and posting URLs are sent to Firecrawl to fetch them.
- Sign-in is by emailed one-time code. Codes are stored hashed and expire after
  ten minutes; sessions last 30 days.
- Sign-in is restricted to the `ALLOWED_EMAILS` allowlist and fails closed when
  it is empty.
