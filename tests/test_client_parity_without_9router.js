#!/usr/bin/env node
/**
 * Client-parity regression test: Claude Code must work identically WITH and
 * WITHOUT 9router. 9router is an optional model gateway (npm global + service on
 * 127.0.0.1:20128); no client registration may depend on it.
 *
 * Both modes run in a throwaway HOME so the developer's real ~/.claude.json is
 * never touched:
 *   MODE A (9router absent): PATH shimmed to hide only `9router`, service port
 *     unreachable from the detector's point of view.
 *   MODE B (9router present): real PATH, real detector.
 * The resulting .claude.json mcpServers block must be structurally identical,
 * and no 9router reference may appear in any Claude Code config artifact.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const CLAUDE_CODE = path.join(REPO, 'src', 'mcp_clients', 'claude_code.js');
const NINE_ROUTER = path.join(REPO, 'src', 'nine_router.js');

const NINE_ROUTER_REF = /9router|20128/i;

/** Run a node snippet with a sandboxed HOME and a controlled PATH. */
function runSandboxed(script, { hide9Router }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-client-parity-'));
  let envPath = process.env.PATH;
  let nodeBin = process.execPath;

  if (hide9Router) {
    // Shim dir exposing node + claude but deliberately NOT 9router, so the
    // global npm install is invisible to isCommandAvailable('9router').
    const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-shim-'));
    fs.symlinkSync(process.execPath, path.join(shim, 'node'));
    const claudeBin = spawnSync('which', ['claude'], { encoding: 'utf-8' }).stdout.trim();
    if (!claudeBin) throw new Error('claude CLI not available; cannot run parity test');
    fs.symlinkSync(claudeBin, path.join(shim, 'claude'));
    envPath = `${shim}:/usr/local/bin:/usr/bin:/bin`;
    nodeBin = path.join(shim, 'node');
  }

  const res = spawnSync(nodeBin, ['-e', script, home], {
    cwd: REPO,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: envPath, KONOHA_3D_MODEL: '' },
    encoding: 'utf-8',
    timeout: 120000
  });
  if (res.status !== 0) {
    throw new Error(`sandboxed run failed (${res.status}): ${res.stderr || res.stdout}`);
  }
  return { home, out: JSON.parse(res.stdout.trim().split('\n').pop()) };
}

const PROBE = `
const fs = require('fs');
const path = require('path');
const HOME = process.argv[1];
const nineRouter = require(${JSON.stringify(NINE_ROUTER)});
const claude = require(${JSON.stringify(CLAUDE_CODE)});
const installed = nineRouter.is9RouterInstalled();
const setup = claude.ensureClaudeCodeSetup({ home: HOME });
const cfgPath = path.join(HOME, '.claude.json');
const raw = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : '';
const cfg = raw ? JSON.parse(raw) : {};
const settingsPath = path.join(HOME, '.claude', 'settings.json');
const settings = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : '';
process.stdout.write(JSON.stringify({
  installed,
  setupOk: Boolean(setup && setup.ok),
  setupReason: (setup && setup.reason) || null,
  servers: Object.keys(cfg.mcpServers || {}).sort(),
  konoha: cfg.mcpServers && cfg.mcpServers.konoha ? cfg.mcpServers.konoha : null,
  rawHasRouter: ${NINE_ROUTER_REF}.test(raw),
  settingsHasRouter: ${NINE_ROUTER_REF}.test(settings)
}) + '\\n');
`;

test('Claude Code registration is identical with and without 9router', () => {
  const absent = runSandboxed(PROBE, { hide9Router: true });
  const present = runSandboxed(PROBE, { hide9Router: false });

  // The two modes must actually differ in 9router availability (control).
  assert.equal(absent.out.installed, false, 'MODE A control failed: 9router still detected');
  assert.equal(present.out.installed, true, 'MODE B control failed: 9router not detected on this host');

  // Both modes must succeed at registering Claude Code.
  assert.equal(absent.out.setupOk, true, `9router-absent setup failed: ${absent.out.setupReason}`);
  assert.equal(present.out.setupOk, true, `9router-present setup failed: ${present.out.setupReason}`);

  // Same MCP servers, same konoha entry — no 9router dependency either way.
  // Each mode runs in its own sandbox HOME and its own controlled PATH (MODE A
  // shims PATH to hide the 9router binary), and the product deliberately bakes
  // the launching PATH into the stdio entry so a GUI-launched client can find
  // node. That baked string is therefore expected to differ between the two
  // modes and is masked here; a 9router reference anywhere in the artifact is
  // still caught by rawHasRouter/settingsHasRouter below.
  const normalize = (block, home) => {
    if (!block) return block;
    const json = JSON.stringify(block).split(home).join('<HOME>');
    const parsed = JSON.parse(json);
    if (parsed.env && typeof parsed.env.PATH === 'string') {
      parsed.env.PATH = '<PATH>';
    }
    return parsed;
  };

  assert.deepEqual(absent.out.servers, present.out.servers, 'mcpServers differ between modes');
  assert.ok(absent.out.servers.includes('konoha'), 'konoha MCP server missing');
  assert.deepEqual(
    normalize(absent.out.konoha, absent.home),
    normalize(present.out.konoha, present.home),
    'konoha server block differs between modes'
  );

  // No 9router leakage into any Claude Code config artifact.
  for (const mode of [absent, present]) {
    assert.equal(mode.out.rawHasRouter, false, '.claude.json references 9router');
    assert.equal(mode.out.settingsHasRouter, false, '.claude/settings.json references 9router');
  }

  // Zero-bug guard for the Gemini fix: the tools/list payload Claude consumes
  // must carry no non-standard "integer": true annotation.
  const router = require(path.join(REPO, 'src', 'file_tools_router.js'));
  const payload = JSON.stringify(router.listToolSchemas());
  assert.equal((payload.match(/"integer"\s*:\s*true/g) || []).length, 0, 'integer annotation leaked into tools/list');
});
