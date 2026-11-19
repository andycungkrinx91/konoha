'use strict';

/**
 * `/konoha` slash command deployment.
 *
 * A slash command is a client-side prompt template, not a server route: the
 * MCP server cannot register one. Each client reads prompt files from its own
 * directory, so `/konoha` only exists in a client whose directory Konoha writes.
 *
 * Fail closed: a client is written only when its prompt-file contract is
 * confirmed from that client's installed bundle and its config root already
 * exists. Presence of the config root is the gate — a root that is absent is
 * never created, so a client the user does not run receives nothing. `pi` and
 * `antigravity` expose commands only through their own plugin/extension
 * packaging, which Konoha cannot author safely, so they are reported as
 * unsupported instead of being given a file that may never load.
 */

const fs = require('fs');
const path = require('path');

const COMMAND_NAME = 'konoha';

// Ownership marker. Konoha rewrites only a file carrying this line, so a user
// file is never clobbered and a reworded body never makes our own file look
// user-authored. Same convention as agent profiles (`generated_by: konoha`).
const KONOHA_COMMAND_MARKER = /^generated_by:\s*konoha\s*$/m;

const KONOHA_COMMAND_BODY = `---
description: Run the Konoha multi-agent workflow for this request
generated_by: konoha
---

Run the Konoha workflow for: $ARGUMENTS

1. Classify the request. Website build intent (build/create/scaffold/make + website, web app, landing page, UI, frontend, dashboard, storefront, portfolio, or a named framework) is Branch B; everything else is Branch A.
2. Branch A: \`konoha.sannin\` first for triage and the resolved task dir, then explore (\`genin\`), plan (\`kage\`), execute (\`jonin\`/\`anbu\`/\`chunin\`), document (\`tokubetsu_jonin\`), review (\`kage\`).
3. Branch B: \`konoha.build_from_text\` (or \`build_from_source\` for mockups) first, then hand the directives to \`konoha.jonin\`. Skip Chunin, Genin, and Kage.
4. Spawn each specialist with the \`spawn_directive\` the MCP tool returns, using this client's native subagent tool, or the CLI fallback \`rtk konoha run-agent\` when the client has none.
5. A slice is complete only after \`konoha.report_from_agent\` records it with real validation evidence.

If the request is empty, ask what to build or fix and stop.
`;

// Migration: the first 2.2.23 build shipped this body without the marker, so a
// file it wrote would otherwise read as user-owned and never upgrade again.
// Derived, not duplicated; drop once no markerless file is in the field.
const LEGACY_COMMAND_BODY = KONOHA_COMMAND_BODY.replace('generated_by: konoha\n', '');

// Prompt-file contract per client, confirmed from the installed bundle:
//   claudecode  ~/.local/share/claude/versions/<v>  -> `.claude/commands/`
//   cursor      cursor-agent bundle                 -> `.cursor/commands/`
//   opencode    opencode binary                     -> `<config>/opencode/command/`
//   commandcode dist/bundled/.../custom-slash-commands.md -> `~/.commandcode/commands/`
//   codex + omp omp's prompt loader reads `~/.codex/prompts`, so one file serves both
// Each of those also has a project form: commandcode's reference documents
// `.commandcode/commands/` beside the user directory, and omp's loader lists
// `.codex/prompts/` next to `~/.codex/prompts`. `projectDir` only differs where
// the project path is not the same relative shape as the user path.
const COMMAND_TARGETS = Object.freeze([
  { client: 'claudecode', configRoot: '.claude', dir: ['.claude', 'commands'] },
  { client: 'cursor', configRoot: '.cursor', dir: ['.cursor', 'commands'] },
  { client: 'opencode', configRoot: path.join('.config', 'opencode'), dir: ['.config', 'opencode', 'command'], projectDir: ['.opencode', 'command'] },
  { client: 'commandcode', configRoot: '.commandcode', dir: ['.commandcode', 'commands'] },
  { client: 'codex', configRoot: '.codex', dir: ['.codex', 'prompts'], alsoServes: ['omp'] }
]);

const UNSUPPORTED_CLIENTS = Object.freeze([
  { client: 'pi', reason: 'pi loads commands only through its extension packaging; no prompt directory is exposed' },
  { client: 'antigravity', reason: 'antigravity loads commands only from installed plugins; no user prompt directory is exposed' }
]);

function resolveHome(home) {
  return home || process.env.HOME || process.env.USERPROFILE || require('os').homedir();
}

/**
 * Classifies a command file without touching it.
 * @returns {{present?:true, unchanged?:true, skip?:string}}
 */
function _inspectCommandFile(file) {
  if (!fs.existsSync(file)) return { present: false };
  const current = fs.readFileSync(file, 'utf8');
  if (current === KONOHA_COMMAND_BODY) return { present: true, unchanged: true };
  if (current === LEGACY_COMMAND_BODY) return { present: true };
  if (!KONOHA_COMMAND_MARKER.test(current)) return { skip: `user-owned ${file} left untouched` };
  return { present: true };
}

/**
 * Writes Konoha's command file unless a user authored one there. Konoha's own
 * file is rewritten so upgrades land.
 * @returns {{unchanged?:true, skip?:string}}
 */
function _writeCommandFile(file) {
  const state = _inspectCommandFile(file);
  if (state.skip || state.unchanged) return state;
  fs.writeFileSync(file, KONOHA_COMMAND_BODY, { encoding: 'utf8', mode: 0o644 });
  return {};
}

function _recordDeployment(target, scope, file, outcome, ctx) {
  if (outcome.skip) {
    ctx.skipped.push({ client: target.client, scope, reason: outcome.skip });
    return;
  }
  const unchanged = outcome.unchanged ? { unchanged: true } : {};
  ctx.deployed.push({ client: target.client, scope, path: file, ...unchanged });
  for (const alias of target.alsoServes || []) {
    ctx.deployed.push({ client: alias, scope, path: file, sharedWith: target.client, ...unchanged });
  }
}

function _deployScope(target, { scope, base, segments }, ctx) {
  const { options, home } = ctx;
  if (!options.force && !fs.existsSync(path.join(home, target.configRoot))) {
    ctx.skipped.push({ client: target.client, scope, reason: `${target.configRoot} not present for this user` });
    return;
  }
  const file = path.join(base, ...segments, `${COMMAND_NAME}.md`);
  if (options.statusOnly) {
    const state = _inspectCommandFile(file);
    _recordDeployment(target, scope, file, state.present ? state : { skip: `no command file at ${file}` }, ctx);
    return;
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    _recordDeployment(target, scope, file, _writeCommandFile(file), ctx);
  } catch (err) {
    ctx.skipped.push({ client: target.client, scope, reason: `${err.code || 'error'}: ${err.message}` });
  }
}

function _deployTarget(target, ctx) {
  const { options, home } = ctx;
  _deployScope(target, { scope: 'user', base: home, segments: target.dir }, ctx);
  if (!options.projectRoot) return;
  _deployScope(target, {
    scope: 'project',
    base: options.projectRoot,
    segments: target.projectDir || target.dir
  }, ctx);
}

/**
 * @param {object} [options]
 * @param {string} [options.home] overrides HOME (tests)
 * @param {string|null} [options.projectRoot] also deploy the project-scoped copy
 * @param {boolean} [options.force] write even when the client config root is missing
 * @param {boolean} [options.statusOnly] report what is installed without writing (doctor)
 * @returns {{deployed: Array<{client:string,scope:string,path:string}>, skipped: Array<{client:string,scope:string,reason:string}>}}
 */
function deployKonohaCommands(options = {}) {
  const home = resolveHome(options.home);
  const deployed = [];
  const skipped = [];
  const ctx = { options, home, deployed, skipped };
  for (const target of COMMAND_TARGETS) _deployTarget(target, ctx);
  for (const entry of UNSUPPORTED_CLIENTS) {
    skipped.push({ client: entry.client, scope: 'user', reason: entry.reason });
  }
  return { deployed, skipped };
}

module.exports = {
  COMMAND_NAME,
  KONOHA_COMMAND_BODY,
  LEGACY_COMMAND_BODY,
  COMMAND_TARGETS,
  UNSUPPORTED_CLIENTS,
  deployKonohaCommands
};
