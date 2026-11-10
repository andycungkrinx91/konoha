# Konoha Web UI bootstrap form 401 — installed-runtime sync

Status: **executed 2026-11-10**, all checks passed. The repo code fix landed in commit `7f45649c`; this record documents the deployed-copy drift that kept the running installation on pre-fix code, and the resync that fixed it.

## Symptom

First-run "Initialize Password" form on `http://127.0.0.1:1404/dashboard` failed in the browser: validation passed, then `POST /api/v1/auth/setup-password` returned `401 {"error":"Unauthorized: Authentication required","requires_login":true}` and the page displayed that message. The same POST from a loopback `curl` with a valid `x-konoha-web-token` returned `200`.

## Root cause

The listener on port 1404 ran `node ~/.konoha/bin/cli.js ui daemon --port=1404 --host=127.0.0.1`, which loads server code from the installed tree `~/.konoha/src/` (not the repo checkout).

- Installed `~/.konoha/src/web_server.js` md5 `c60791247fb9d7d2f90e2383f82880f3` had an `isPublicApi` list without `/api/v1/auth/setup-password`, so `_verifyApiAuthentication` hit its `isBrowser && !session` branch and returned 401 before the controller ran.
- Repo `src/web_server.js` md5 `413f5d03b6cda5587b2760d49fb1fe8e` (commit `7f45649c`) includes the route -> gate passes -> controller returns 200.
- Drift was invisible because `~/.konoha/package.json` already declared `2.2.20`, so `assertPathVersionMatches` and `/api/v1/health` both reported 2.2.20 while the code was 2.2.19-era.
- The UI was the current repo build (`resolveWebUiDir` prefers `cwd/apps/web`; `getDistDir` picks `<cwd>/apps/web/dist`), so new UI ran against old server code.

Drift scope repo -> `~/.konoha` before the sync: 13 files under `src/`, 6 under `bin/` plus `bin/lib/upgrade_verify.js` missing, 2 under `apps/web/src/` (`components/Login.svelte`, `lib/state/authState.svelte.js`).

## Fix applied

1. Backed up `~/.konoha/{src,bin,apps/web/src}` to `/tmp/konoha-backup-1794310065-*`.
2. Synced code with `rsync -a` (no `--delete`, so runtime-only files `.node_exec_path`, `web_token`, `.deploy-fingerprint`, `patches/`, `migrations/` survive). `konoha init` would not have repaired this install: `installCliRuntime()` (`bin/lib/runtime_install.js:435`) resolves its source tree via `resolveEffectiveSourceRoot()` (line 20), which defaults to `REPO_ROOT` = the two levels above the running `cli.js`. Launched through the `~/.local/bin/konoha` shim, that is `~/.konoha` itself, so init copies installed code onto installed code (a no-op). It only refreshes from the repo checkout when run as `node bin/cli.js init` inside the repo, and `konoha upgrade` passes an explicit `sourceRoot: globalPkgRoot` (`bin/commands/upgrade.js:395`).
3. Restarted the daemon: `konoha ui stop --port=1404` then `konoha ui restart --port=1404`.
4. Proved the browser flow with Playwright chromium headless against the live daemon (setup form -> Initialize Password -> sign-in -> dashboard).
5. Restored bootstrap state with `konoha auth reset` and restarted again.

No repository source change was required; the fix is deployed-copy sync only.

## Evidence

```
# before sync
413f5d03b6cda5587b2760d49fb1fe8e  src/web_server.js
c60791247fb9d7d2f90e2383f82880f3  ~/.konoha/src/web_server.js

# after sync
413f5d03b6cda5587b2760d49fb1fe8e  src/web_server.js
413f5d03b6cda5587b2760d49fb1fe8e  ~/.konoha/src/web_server.js
89:  // setup-password is the only credential write reachable without a session; it is a
91:  const isPublicApi = ['/api/v1/health', '/api/v1/csrf', '/api/v1/token', '/api/v1/auth/login', '/api/v1/auth/status', '/api/v1/auth/session', '/api/v1/auth/setup-password'].includes(pathname);
# `diff -rq src ~/.konoha/src`, `bin`, `apps/web/src`: no differences

# daemon after restart (PID 1411799, port 1404)
{"status":"healthy","version":"2.2.20","uptime":3,"node":"v24.22.2","platform":"linux"}

# browser verification
setup statuses: [ 200 ]
OK: bootstrap setup + sign-in work

# after `konoha auth reset`
⚡ Web console password has been reset to default: konohagakure
{"ok":true,"authenticated":false,"is_bootstrap":true,"needs_initial_setup":true,"requires_password_change":false}

# UI still served from current build
curl -s http://127.0.0.1:1404/dashboard | grep -c _app/immutable -> 27
```

## Security disclosure

The administrator credential on this install was changed during diagnosis and then reset. It was set to `secure-shinobi-2026!` via `POST /api/v1/auth/setup-password`, then restored with `POST /api/v1/auth/reset-password` -> `resetAuthToDefault()` (`src/auth.js:383`), which re-hashes the default bootstrap passphrase, sets `is_bootstrap: true`, and destroys all sessions. `secure-shinobi-2026!` must be treated as compromised and never reused. Not restored and still unknown: the exact auth-file bytes before the change, prior session rows, file timestamps.

## Follow-ups (optional, not required for this fix)

- `assessSourceRootFreshness()` (`bin/lib/runtime_install.js:57`) detects exactly this drift class but is only consulted inside `copyRuntimeFiles`. A single stderr warning from `ui daemon` when the installed tree is older than the repo would have surfaced 2.2.19 code inside a "2.2.20" install. Add when stale deploys recur.
- No client-side signal distinguishes "server code too old" from a genuine auth failure; the toast was the only symptom.