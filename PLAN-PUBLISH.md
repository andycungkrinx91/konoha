# Plan: Publish Konoha to npm as `konoha-mcp` (plug and play)

## Goal

Everything Konoha needs by default is **prepared by the publisher** and shipped inside the package. The user installs it and it works:

```bash
# npm
npm i -g konoha-mcp
konoha init                       # registers the MCP server in their AI clients

# pnpm (first-class, same result)
pnpm add -g konoha-mcp            # run `pnpm setup` once if pnpm's global bin is not on PATH
konoha init

# no install, one shot
npx konoha-mcp init
pnpm dlx konoha-mcp init
```

The owner already has an npm account. The executing agent prepares the repo (Phases 0 to 5). **The owner runs the login and publish commands** (Phase 6).

## The plug-and-play contract

After install, with no extra steps and with the network turned off:

1. **No lifecycle scripts run**, in Konoha or in any dependency (`preinstall`, `install`, `postinstall`, `prepare`), and no implicit `node-gyp` build (`binding.gyp`).
2. **No compilation and no downloads** at install time, and none on the first run of any core feature.
3. **All artifacts are prebuilt in the tarball**: web UI build, skills seed data, docs.
4. **Core features work immediately:** `konoha` CLI, `init` for all supported clients, MCP server, FTS5 skill search, web UI, `doctor`.
5. Works with **npm, pnpm 10+ (dependency scripts blocked by default), `--ignore-scripts`, and `npx` / `pnpm dlx`**. pnpm is a first-class target for users (`pnpm add -g`, `pnpm dlx`, `pnpm add` as a project dependency) and for contributors (`pnpm install` in the repo).
6. A wrong Node version gives one friendly message, never a stack trace.

**Optional packs** (semantic search, browser QA) cannot be fully prebuilt: semantic search needs model weights downloaded from Hugging Face, and the browser tool needs Chrome downloaded. They are therefore **one command each** (`konoha enable semantic`, `konoha enable browser`), run by the user when wanted, with progress output and a clear result. They are never part of the default install.

## Findings from the current `package.json` and registry

| # | Finding | Impact | Fix |
|---|---|---|---|
| 1 | `"name": "Konoha"` has an uppercase letter | npm rejects it for new packages | Rename to `konoha-mcp` (registry returns 404, so it is free; plain `konoha` is taken by an unrelated package) |
| 2 | `better-sqlite3` is a native module with an install script and requires Node `>=22` | **pnpm 10+ blocks dependency install scripts by default**, so the binding is never built and Konoha crashes with "Could not locate the bindings file". `--ignore-scripts` and Bun hit the same wall | Replace it with Node's built-in `node:sqlite` (Phase 3) |
| 3 | `engines.node` is `>=18` | Wrong; installs fail on Node 18/20 | `>=22.16.0` (see Phase 0 item 1 for why not 22.13) |
| 4 | `postinstall` and `prepare` try to build `apps/web` on the user's machine | Dev dependencies are absent there, so the build fails silently and `konoha web` breaks | Remove both; ship the prebuilt output |
| 5 | `files` includes all of `apps/`, `assets/`, `.cursor/`, `.claude/` | Ships source, demo GIFs, maybe local dev config | Whitelist (Phase 1) |
| 6 | Heavy default dependencies (registry unpacked sizes): `onnxruntime-node` ~301 MB and `onnxruntime-web` ~145 MB (via `@huggingface/transformers`), `agent-browser` ~118 MB, `better-sqlite3` ~27 MB, `playwright` ~5 MB | About 600 MB unpacked before Konoha's own files; several have install scripts or downloads | Move to opt-in packs (Phase 3) |
| 7 | `agent-browser ^0.36.0` | For `0.x`, caret matches only `0.36.x`; latest is `0.38.x` and lists Node `>=24` | Becomes an opt-in pack with its own Node check |
| 8 | `repository.url` is a bare URL; no `description`, `homepage`, `bugs` | Warning and empty npm page | Fix (Phase 1) |

## Rules for the executing agent

- Phase 0 is **read-only**; report before changing anything.
- Do **not** run `npm login` or `npm publish`. Do **not** read `~/.npmrc` or any `.npmrc` (may contain tokens).
- Do **not** run any `git` command (read-only ones included). For version changes use `npm version <x.y.z> --no-git-tag-version` (plain `npm version` creates a git commit and tag).
- Do not read or modify `.env`, `.tfvars`, or secret files.
- Use `pnpm` for installs and scripts inside the repo. Keep CommonJS in the root.
- Never add a `postinstall` that downloads, builds, or edits user config files. pnpm 10+ would block it, and writing into other tools' configs without consent is not acceptable.
- After each phase, summarize: files changed, commands run, results.

---

## Phase 0: Audit (read-only)

Report:

1. **Node floor for `node:sqlite` + FTS5.** `node:sqlite` is unflagged from Node 22.13.0, but one third-party project reports its bundled SQLite only provides FTS5 from 22.16.0. Verify on the installed Node, then on 22.13, 22.16, latest 22, and 24 (run other versions with `npx -y node@<version> -e "..."`): open `new DatabaseSync(':memory:')`, `CREATE VIRTUAL TABLE t USING fts5(x)`, insert, `MATCH`, `bm25()`. Recommend the lowest version where everything Konoha uses works.
2. **SQLite API surface in use.** List every `better-sqlite3` call in `bin/`, `src/`, `scripts/`, `tests/`: `prepare/get/all/run/iterate`, `exec`, `transaction`, `pragma`, `function`, `aggregate`, `backup`, `loadExtension`, `readonly`, `nativeBinding`. Mark anything with no `node:sqlite` equivalent.
3. **Extensions.** Does anything load a SQLite extension (the old `vendor/sqlite-vector` approach, vector search)? Does any of it download a platform binary on first run?
4. **First-run network use.** Search core code paths (`init`, `status`, `doctor`, `web`, MCP server startup, skill seeding) for `fetch`, `https.get`, `child_process` calls to `npm`/`git`/`curl`, and downloads. List each and whether it is core or optional.
5. **Skills seeding.** How the skills DB is seeded (from `.agents/skills` via `scripts/sync_skills.js`?), how long a cold seed takes, and whether any step needs the network. Does the installed package need `scripts/`?
6. **Web UI build.** In `apps/web`: framework and adapter (`build/handler.js` suggests SvelteKit `adapter-node`), contents of `apps/web/.gitignore`, whether `build/` exists, and the bare imports (`from 'x'`) left in `build/index.js` and `build/handler.js`. Adapter-node leaves packages listed under `dependencies` external. Also check whether `sharp` or any native package is needed at runtime.
7. **Dev folders.** Which of `.cursor/`, `.claude/`, `.agents/`, `assets/` does runtime code actually read or copy (for example `init` copying templates)?
8. **MCP command written by `init`.** Exactly what command and args each client config gets (for example `konoha mcp`). What happens when `init` ran through `npx`/`dlx`, where no permanent `konoha` binary exists on PATH?
9. **Heavy modules.** Where `@huggingface/transformers`, `agent-browser`, and `playwright` are loaded or referenced. Is each required lazily inside its own feature?
10. **GitHub references.** Where `upgrade`, `version`, `init`, and the README reference `github:andycungkrinx91/konoha`.
11. **Undeclared dependencies (pnpm is strict).** pnpm does not hoist packages, so a bare `require`/`import` of something not listed in Konoha's `dependencies` works under npm by luck and fails under pnpm. List every bare import in `bin/`, `src/`, and `apps/web/build/`, and compare with `dependencies`.
12. **Contributor install.** In a clean checkout run `pnpm install`, then `pnpm ignored-builds`. Which dev dependencies (for example the web app's bundler) had build scripts blocked, and does the web build still work?
13. **Baseline.** `npm pack --dry-run`: total size, file count, 15 largest files.

Stop and report before Phase 1. If item 2 or 3 finds something `node:sqlite` cannot do, stop and propose options (move that feature into the semantic pack, or vendor prebuilt bindings) instead of improvising.

## Phase 1: Fix `package.json`

Apply exactly these changes; leave other fields as they are.

```json
{
  "name": "konoha-mcp",
  "description": "Token-efficient MCP skill server with SQLite FTS5 and specialist agent routing",
  "homepage": "https://github.com/andycungkrinx91/konoha#readme",
  "bugs": "https://github.com/andycungkrinx91/konoha/issues",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/andycungkrinx91/konoha.git"
  },
  "bin": { "konoha": "./bin/cli.js" },
  "files": [
    "bin/",
    "src/",
    "docs/",
    "apps/web/build/",
    ".agents/",
    "README.md",
    "LICENSE"
  ],
  "engines": { "node": ">=22.16.0" },
  "publishConfig": { "access": "public" }
}
```

- Add `scripts/` or any of `.cursor/`, `.claude/`, `assets/` to `files` **only** when Phase 0 items 5 or 7 show runtime needs them, and then only the needed subpaths.
- Version: `npm version 2.1.0 --no-git-tag-version` (Node floor and DB driver change).
- `bin/cli.js` starts with `#!/usr/bin/env node`.
- Keep `os`, `keywords`, `author`, `license`, `type`.

## Phase 2: Remove install-time work and prebuild everything

- **Remove** `postinstall` and `prepare`.
- Add `"prepublishOnly": "npm run build && npm test"`. `build` already runs `node bin/cli.js ui build`; confirm it creates `apps/web/build/handler.js`.
- Make sure `apps/web/build/` is really packed. npm honors a nested `.gitignore` inside included folders. If `apps/web/.gitignore` ignores `build/`, add `apps/web/.npmignore` (a nested `.npmignore` takes precedence there) that does not exclude `build/`.
- If the web build imports packages at runtime (Phase 0 item 6), bundle them (move them to `devDependencies` of `apps/web`) or, if they are pure JavaScript, add them to root `dependencies`. They must not need install scripts.
- If Phase 0 item 5 shows slow or networked seeding, ship a prebuilt seed (a skills snapshot generated by `sync_skills.js` at release time) and copy or import it on first run. If seeding is local and fast, do not add this.
- Remove every core-path network call found in Phase 0 item 4. Anything that remains must belong to an opt-in pack.

**Prebuilt artifacts checklist**

| Artifact | Built by | Verified by |
|---|---|---|
| `apps/web/build/` | `prepublishOnly` | `npm pack --dry-run` lists `handler.js`; `konoha web` works from a clean install |
| Skills seed data | existing sync or prebuilt snapshot | `konoha init` then `konoha status`, offline |
| Docs | already in repo | listed in tarball |
| MCP server | plain JS in `src/` | `npm run test:mcp` against the installed copy |

## Phase 3: Make the default install dependency-light and script-free

1. **Replace `better-sqlite3` with `node:sqlite`.** Add a thin adapter (for example `src/db.js`) that exposes the subset Phase 0 item 2 found, so the migration is mechanical and callers do not change. Requirements:
   - Existing `~/.konoha/konoha.db` files must open unchanged (they are standard SQLite files). Add a test that opens a database created by the previous version.
   - Keep WAL and the same pragmas.
   - `node:sqlite` prints an `ExperimentalWarning` to stderr on first use. Suppress that specific warning before the first `require('node:sqlite')`. Never write anything to stdout outside the MCP protocol.
   - Add an FTS5 self-test to `konoha doctor`.
2. **Node gate.** The first lines of `bin/cli.js`, written in plain syntax and before any other `require`, check `process.versions.node` against the floor and print one actionable message (required version, current version, upgrade hint), then exit.
3. **Remove from `dependencies`:** `better-sqlite3`, `@huggingface/transformers`, `playwright` (if unused per Phase 0 item 9), and drop `agent-browser` from `optionalDependencies`. The remaining default dependencies should be pure JavaScript with no install scripts: `@bufbuild/protobuf`, `@inquirer/prompts`, `chalk`, `figlet`, `gradient-string`.
4. **Opt-in packs, one command each.** Implement `konoha enable semantic` and `konoha enable browser` (and show their status in `doctor`):
   - Install into `~/.konoha/packs/<name>/` using `npm install --prefix`, with the version **pinned** in Konoha's code, so the user's package manager settings (for example pnpm blocking scripts) do not matter. Load with `createRequire` from that folder.
   - `semantic`: installs `@huggingface/transformers` and then downloads the model with visible progress, so first use is instant afterwards. Any vector-extension logic from Phase 0 item 3 lives here, not in core.
   - `browser`: checks the Node version `agent-browser` needs, asks before installing, then runs `agent-browser install` (Chrome download) and re-runs its own `doctor`.
   - If a pack is missing when a feature needs it, print one line: `konoha enable <pack>`. Never crash.
5. `@playwright/test` (for `apps/web` e2e) stays a devDependency only.
6. `pnpm.overrides` apply only inside this repo, not to people installing the package. Keep them as repo hygiene; do not rely on them for consumer security. The same holds for `pnpm.onlyBuiltDependencies`: add the entries contributors need so `pnpm install` works in the repo (Phase 0 item 12), but it has no effect on people installing the package, which is why the package itself must not need install scripts.

## Phase 4: `init`, commands, and docs

- **`init` must work however it was started.** Resolve the MCP command at init time: if a permanent `konoha` binary is on PATH, write that; if `init` is running through `npx`/`dlx` (ephemeral), write an `npx -y konoha-mcp@<current version> <mcp subcommand>` form so the registration survives the cache being cleaned. Where a client needs a Windows `cmd /c` wrapper, apply it. Verify against all supported clients' config formats.
- **pnpm specifics.** Detect the package manager from `npm_config_user_agent` (and from the install path) in `upgrade` and `init`. For pnpm installs, `upgrade` runs `pnpm add -g konoha-mcp@latest`; for ephemeral runs, write the `pnpm dlx` or `npx -y` form that matches how `init` was started. If `konoha` is not found on PATH after a pnpm global install, `doctor` prints the fix (`pnpm setup`, then restart the shell).
- `konoha upgrade`: install from npm (`npm i -g konoha-mcp@latest`, or `pnpm add -g` when pnpm is detected). No `github:` installs.
- `konoha version`: compare against `npm view konoha-mcp version`; fall back to GitHub releases when offline.
- README: replace every `github:` install example with the install commands from the Goal, showing npm and pnpm side by side (including `pnpm dlx` and the one-time `pnpm setup` note); state **Node 22.16+**; document `konoha enable semantic|browser`.
- `CHANGELOG.md`: new entry (npm distribution, Node floor, built-in SQLite, opt-in packs).
- Keep `tests/test_docs_currency.js` passing.

## Phase 5: Verification (agent runs; no publishing)

**1. Contract test** `tests/test_package_contract.js`, part of `npm test`: name is lowercase `konoha-mcp`; `engines.node` is the agreed floor; no `preinstall`/`install`/`postinstall`/`prepare` scripts; `files` contains `apps/web/build/`; `dependencies` excludes `better-sqlite3`, `@huggingface/transformers`, `playwright`, `agent-browser`; `bin/cli.js` has a shebang and a Node gate before other `require` calls; every bare import in shipped code is declared in `dependencies` (pnpm strictness), checked by `scripts/check_undeclared_deps.js`.

**2. Installed-tree scanner** `scripts/check_install_scripts.js` (dev tool, not shipped): walks an installed `node_modules` tree and fails if any package declares `preinstall`/`install`/`postinstall` or contains a `binding.gyp`. Prints the offenders.

**3. Install matrix** from the packed tarball:

```bash
pnpm install
npm run build
npm test
npm pack --dry-run                      # compare with the Phase 0 baseline
npm pack

# npm, scripts disabled
export P=/tmp/konoha-npm && rm -rf $P
npm i -g --prefix $P --ignore-scripts ./konoha-mcp-2.1.0.tgz
$P/bin/konoha version && $P/bin/konoha doctor
node scripts/check_install_scripts.js $P/lib/node_modules/konoha-mcp

# pnpm 10+ default (dependency scripts blocked)
export PNPM_HOME=/tmp/konoha-pnpm && rm -rf $PNPM_HOME && mkdir -p $PNPM_HOME
PATH=$PNPM_HOME:$PATH pnpm add -g ./konoha-mcp-2.1.0.tgz
PATH=$PNPM_HOME:$PATH konoha doctor

# pnpm as a project dependency
mkdir -p /tmp/konoha-proj && cd /tmp/konoha-proj && pnpm init
pnpm add /path/to/konoha-mcp-2.1.0.tgz
pnpm exec konoha doctor

# contributor flow (clean checkout)
pnpm install && pnpm ignored-builds && pnpm run build && npm test

# npx path
npx --yes ./konoha-mcp-2.1.0.tgz version
```

`pnpm dlx` may not accept a local tarball. If it does not, do not fake it: the real `pnpm dlx` and `npx` checks against the registry happen in Phase 6 using a beta tag.

**4. Offline first run.** With the network disabled (container with `--network none`, or Wi-Fi off), run on the installed copy: `konoha init --yes`, `konoha status`, `konoha doctor`, a skill search, `konoha web` (UI loads), and the MCP end-to-end test. All must pass.

**5. Node matrix.** Repeat steps 3 and 4 on the floor version, the latest Node 22, and Node 24 (use `npx -y node@<version>`), plus one run on Node 20 to confirm the friendly gate message.

**6. Platforms.** Run on Linux, macOS, and Windows when available (a CI matrix is fine).

**7. Measure, do not claim.** Record tarball size, installed size (`du -sh`), file count, and install time, before (Phase 0 baseline) and after. Report them as measurements.

## Phase 6: Release (owner runs manually)

```bash
npm whoami                    # if this fails: npm login (2FA required)
npm view konoha-mcp           # must still say 404 (name is free)
npm run build && npm test
npm publish --dry-run         # last look at the file list
npm publish                   # prompts for 2FA
```

Then verify like a user, on a machine that never had Konoha:

```bash
npm view konoha-mcp version
npx konoha-mcp@latest version
pnpm dlx konoha-mcp version
npm i -g konoha-mcp && konoha init && konoha doctor
pnpm add -g konoha-mcp && konoha init && konoha doctor
```

Notes:
- Publish with `npm publish`. If you prefer `pnpm publish`, it runs git checks (clean working tree, expected branch) by default; add `--no-git-checks` to skip them.
- A published version can never be reused. Fix problems with a new version (`npm version patch --no-git-tag-version`, then `npm publish`). Unpublishing is only possible for a short window and is discouraged.
- If the name were lost before publishing, use the scoped fallback `@andycungkrinx91/konoha-mcp` (`publishConfig.access` is already `public`) and update every install command.
- Want a trial run? Publish `2.1.0-beta.0` with `npm publish --tag beta`. Users then run `npm i -g konoha-mcp@beta` or `pnpm add -g konoha-mcp@beta`, and `latest` stays unset until a stable release. This is also the only way to test `pnpm dlx` and `npx` against the real registry before `latest` exists.

## Definition of done

- [ ] Package name `konoha-mcp`, version `2.1.0`, `engines.node` set to the verified floor.
- [ ] No lifecycle scripts in Konoha or in any default dependency; the scanner passes on the installed tree.
- [ ] Default dependencies are pure JavaScript; `better-sqlite3`, transformers, playwright, and agent-browser are not default dependencies.
- [ ] `node:sqlite` migration complete; an existing `konoha.db` opens unchanged; `doctor` has an FTS5 self-test.
- [ ] `apps/web/build/` ships and `konoha web` works from a clean install.
- [ ] Offline first run passes: `init`, `status`, `doctor`, skill search, web UI, MCP e2e.
- [ ] Install works with npm, `--ignore-scripts`, pnpm 10+ (`pnpm add -g` and as a project dependency), and `npx`, on the Node matrix; `pnpm dlx` verified on the beta tag.
- [ ] Every bare import in shipped code is declared in `dependencies`; contributors can run `pnpm install` in a clean checkout and build.
- [ ] `init` writes a working MCP command whether run globally or through `npx`.
- [ ] `konoha enable semantic|browser` work and fail gracefully when not enabled.
- [ ] `upgrade`, `version`, and the README use npm instead of GitHub installs.
- [ ] Measured before/after sizes recorded.
- [ ] Owner has published and verified with `npx konoha-mcp@latest version`.