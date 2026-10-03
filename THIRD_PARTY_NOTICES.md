# Third-party notices

resume.buzz is released under the [MIT License](LICENSE). The repository also
redistributes the following third-party material under its own terms.

## Neon agent skills

`.agents/skills/neon/` and `.agents/skills/neon-postgres/` are vendored copies of
the [neondatabase/agent-skills](https://github.com/neondatabase/agent-skills)
repository, installed with `npx skills add neondatabase/agent-skills` and pinned
in `skills-lock.json`. They are instructions for AI coding agents and are not
part of the application build.

- Copyright: Neon, Inc. and contributors
- License: Apache License 2.0 (full text in [`.agents/skills/LICENSE`](.agents/skills/LICENSE))

## Fonts

`src/assets/fonts/` holds the typefaces embedded in exported PDFs.

- Source Serif 4. Copyright 2014 The Source Serif 4 Project Authors. SIL Open Font License 1.1
  ([`SourceSerif4-OFL.txt`](src/assets/fonts/SourceSerif4-OFL.txt))
- Plus Jakarta Sans. Copyright 2020 The Plus Jakarta Sans Project Authors. SIL Open Font License 1.1
  ([`PlusJakartaSans-OFL.txt`](src/assets/fonts/PlusJakartaSans-OFL.txt))

## npm dependencies

Runtime and development dependencies are pulled from npm at install time and are
not redistributed here. Run `pnpm licenses list` for the current set; all of them
are under permissive licenses (MIT, Apache-2.0, BSD, ISC, and similar).
