# Custom Agent Rules for Konoha

- **No `skilladd` Command**: Under no circumstances should `konoha skilladd` or `node bin/cli.js skilladd` be implemented, documented, or used. Only use `konoha skill add` to directly install a skill from a Git repository.
- **Strict No-Push / No-Release / No-Publish Invariant (Git & npm)**: Under NO circumstances should any agent, tool, or command execute `git push`, `git tag`, `git release`, `npm publish`, `pnpm publish`, `yarn publish`, or trigger any remote publishing or release workflows. All changes, tests, audits, and documentation must strictly remain local to this repository.
