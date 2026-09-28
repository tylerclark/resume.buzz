# Contributing

Thanks for taking a look. Bug reports, fixes and small features are all welcome.
For anything larger, open an issue first so we can agree on the shape before you
spend time on it.

## Getting set up

You need Node 24 (see `.node-version`) and pnpm 11 (`corepack enable` picks the
version pinned in `package.json`).

```sh
git clone https://github.com/tylerclark/resume.buzz.git
cd resume.buzz
pnpm install            # also installs the commit-msg hook
cp .env.example .env.local
# fill in .env.local (see README → Self-hosting)
pnpm db:migrate
pnpm dev
```

`pnpm install` runs `simple-git-hooks`, which installs a `commit-msg` hook that
runs commitlint. If you cloned before that existed, run `pnpm prepare` once.

## Before you open a PR

```sh
pnpm check     # eslint + tsc
pnpm build     # what CI runs
```

CI runs lint, typecheck, build and commitlint on every pull request.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
and enforces them with commitlint, both locally (git hook) and in CI.

```
<type>(<scope>): <short summary in the imperative, lowercase, no period>

<optional body: what and why, wrapped at 100 columns>

<optional footer: BREAKING CHANGE: …, Closes #123>
```

Types in use: `feat`, `fix`, `refactor`, `perf`, `docs`, `style`, `test`, `build`,
`ci`, `chore`. Scopes are free-form but the existing ones are a good guide:
`jobs`, `tailor`, `cover`, `facts`, `auth`, `login`, `base-editor`, `tabs`,
`workspace`, `pipeline`, `db`, `ui`, `export`, `deps`.

Examples from the history:

```
feat(jobs): run tailoring in the background and open jobs as tabs
fix(tailor): keep sections and entries in base resume order
refactor(ui): simplify new job form, paste-a-job as an inline link
chore(deps): bump next to 16.3.6
```

Keep the subject under 72 characters. If a change is hard to summarise in one
line, it is usually two commits.

## Pull requests

- One logical change per PR. Small PRs get reviewed fast.
- Fill in the PR template. Link the issue if there is one.
- Keep the branch rebased on `main`; PRs are merged with their commits intact,
  so each commit should stand on its own and pass `pnpm check`.
- Schema changes: edit `src/db/schema.ts`, run `pnpm db:generate`, and commit
  the generated files under `drizzle/` with the change that needs them.

## Style

- TypeScript strict, no `any` unless there is a comment saying why.
- Server-only code imports `server-only`. Anything that touches the database
  or an API key lives under `src/lib` or `src/db`, never in a component.
- Prompts live in `src/lib/ai.ts`; output style rules in `src/lib/style.ts`
  are enforced on every model response, so change them there rather than
  patching text in the UI.
- Prettier is not configured; match the surrounding code.

## Reporting security issues

Please do not open a public issue. See [SECURITY.md](SECURITY.md).
