#!/usr/bin/env node
'use strict';

/**
 * Phase D contract: every tunable comes from ONE loader, and `config get` must
 * report both the effective value and where it came from. The loader lives in
 * bin/lib/config_defaults.js — bin/lib/paths.js requires it, so it must stay
 * dependency-free or the CLI dies on a require cycle.
 *
 * Also guards against re-introducing the literals this phase removed.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');

const { CONFIG_DEFAULTS, DEFAULT_KEYS, getConfigValue } = require('../bin/lib/config_defaults');

function run(args, env = {}) {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env, KONOHA_UI_AUTOSTART: '0', KONOHA_SEMANTIC_SEARCH: '0' },
    timeout: 60000
  });
}

function check() {
  console.log('Running test_config_centralization...');

  // The loader is dependency-free: requiring it must not pull in paths.js.
  const loaderDeps = new Set();
  (function walk(mod) {
    for (const child of mod.children) {
      const rel = path.relative(ROOT, child.filename);
      if (loaderDeps.has(rel)) continue;
      loaderDeps.add(rel);
      if (rel.startsWith('bin') || rel.startsWith('src')) walk(child);
    }
  })(require.cache[require.resolve('../bin/lib/config_defaults')]);
  assert.ok(
    !loaderDeps.has(path.join('bin', 'lib', 'paths.js')),
    'config_defaults must not require bin/lib/paths.js (cycle)'
  );
  console.log('  ok   loader is cycle-free');

  // Every documented default resolves to itself when no user config exists.
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_cfg_'));
  const env = { HOME: sandbox, USERPROFILE: sandbox };
  try {
    for (const key of DEFAULT_KEYS) {
      const out = run(['config', 'get', key, '--json'], env);
      const parsed = JSON.parse(out);
      assert.strictEqual(parsed.key, key);
      assert.strictEqual(parsed.value, CONFIG_DEFAULTS[key], `${key} default mismatch`);
      assert.strictEqual(parsed.source, 'default', `${key} must report source=default`);
    }
    console.log(`  ok   ${DEFAULT_KEYS.length} defaults resolve with source=default`);

    // A user override must win and be reported as source=user.
    run(['config', 'set', 'ui_port', '1500'], env);
    const overridden = JSON.parse(run(['config', 'get', 'ui_port', '--json'], env));
    assert.strictEqual(overridden.value, 1500);
    assert.strictEqual(overridden.source, 'user');
    console.log('  ok   user override wins and reports source=user');

    // The override must reach the consumer, not just the accessor.
    const resolved = execFileSync(process.execPath, ['-e',
      "process.stdout.write(String(require('./bin/lib/paths').UI_PORT))"
    ], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
    assert.strictEqual(resolved.trim(), '1500', 'UI_PORT must read the user override');
    console.log('  ok   override reaches bin/lib/paths');

    // The install build/migrate ceiling must come from config too: 2.2.19
    // hardcoded 900000 in four places, so a slow proxy could not be accommodated.
    run(['config', 'set', 'install_build_migrate_timeout_ms', '1800000'], env);
    const timeout = execFileSync(process.execPath, ['-e',
      "process.stdout.write(String(require('./bin/lib/paths').INSTALL_BUILD_MIGRATE_TIMEOUT_MS))"
    ], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
    assert.strictEqual(timeout.trim(), '1800000', 'INSTALL_BUILD_MIGRATE_TIMEOUT_MS must read the user override');
    const runtimeInstall = fs.readFileSync(path.join(ROOT, 'bin', 'lib', 'runtime_install.js'), 'utf8');
    assert.ok(
      !/timeout:\s*900000\b/.test(runtimeInstall),
      'bin/lib/runtime_install.js must not hardcode a 900000 ms timeout'
    );
    console.log('  ok   install build/migrate timeout comes from config');

    // getConfigValue falls back only for keys with no default.
    assert.strictEqual(getConfigValue('definitely_not_a_key', 42), 42);
    assert.strictEqual(getConfigValue('ui_port'), CONFIG_DEFAULTS.ui_port);
    console.log('  ok   getConfigValue fallback semantics');

    // An upgrade must leave ~/.konoha/config.json byte-identical: shipped
    // defaults live in code, so new keys appear without rewriting user values.
    const cfgPath = path.join(sandbox, '.konoha', 'config.json');
    const before = fs.readFileSync(cfgPath, 'utf8');
    const upgradeSrc = fs.readFileSync(path.join(ROOT, 'bin', 'commands', 'upgrade.js'), 'utf8');
    assert.ok(
      !/writeConfigFileAtomic|writeFileSync\(CONFIG_FILE/.test(upgradeSrc),
      'bin/commands/upgrade.js must never write ~/.konoha/config.json'
    );
    const after = fs.readFileSync(cfgPath, 'utf8');
    assert.strictEqual(after, before, 'upgrade must not rewrite the user config file');
    console.log('  ok   upgrade never rewrites ~/.konoha/config.json');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  // src/*.js is mirrored FLAT into ~/.konoha/, where '../bin/lib/...' escapes to
  // ~/bin and does not exist. Top-level modules must import the layout-tolerant
  // loader (src/config_access.js) rather than bin/lib/config_defaults directly.
  const directDefaults = [];
  for (const entry of fs.readdirSync(path.join(ROOT, 'src'), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const text = fs.readFileSync(path.join(ROOT, 'src', entry.name), 'utf8');
    if (/require\(['"][^'"]*bin\/lib\/config_defaults['"]\)/.test(text)) directDefaults.push(entry.name);
  }
  assert.deepStrictEqual(
    directDefaults,
    [],
    `top-level src modules must require ./config_access, not bin/lib/config_defaults (flat ~/.konoha mirror): ${directDefaults.join(', ')}`
  );
  console.log('  ok   flat-mirrored src modules route config through ./config_access');

  // No re-introduced literals on the paths this phase centralized.
  const banned = [
    ['bin/lib/ui_service.js', /(?<!\d)1404(?!\d)/, '1404'],
    ['bin/lib/ui_commands.js', /(?<!\d)1404(?!\d)/, '1404'],
    ['bin/lib/ui_build.js', /(?<!\d)1404(?!\d)/, '1404'],
    ['bin/commands/init.js', /(?<!\d)1404(?!\d)/, '1404'],
    ['bin/commands/uninstall.js', /(?<!\d)1404(?!\d)/, '1404'],
    ['bin/commands/upgrade.js', /(?<!\d)1404(?!\d)/, '1404'],
    ['bin/commands/doctor_services.js', /(?<!\d)1404(?!\d)/, '1404'],
    ['src/web_server.js', /(?<!\d)1404(?!\d)/, '1404'],
    ['src/web/controllers/core_controller.js', /(?<!\d)19999(?!\d)/, '19999'],
    ['src/bridge/manager.js', /(?<!\d)19999(?!\d)/, '19999'],
    ['src/nine_router.js', /(?<!\d)20128(?!\d)/, '20128'],
    ['bin/commands/bridge.js', /(?<!\d)1313(?!\d)/, '1313'],
    ['src/provider_sources.js', /=\s*1200;/, 'PROBE_TIMEOUT_MS literal'],
    ['src/mcp/worktree_isolation.js', /=\s*30000;/, 'GIT_TIMEOUT_MS literal'],
    ['src/mcp/workflow_common.js', /=\s*180000;/, 'AISLOP_GATE_TIMEOUT_MS literal'],
    ['src/mcp/workflow_common.js', /=\s*98;/, 'MINIMUM_CONFIDENCE literal']
  ];
  for (const [rel, re, label] of banned) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!re.test(src), `${rel} must read ${label} from config, not declare it`);
  }
  console.log(`  ok   no re-introduced literals (${banned.length} files checked)`);

  console.log('All config centralization checks passed');
}

check();