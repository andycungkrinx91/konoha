#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Canonical budget for every install / build / migrate / embed subprocess.
 * Mirrors INSTALL_BUILD_MIGRATE_TIMEOUT_MS in bin/lib/paths.js.
 */
const SLOW_NETWORK_MS = 900000;
const SHORT_GUARD_MS = 60000;

const SOURCES = {
  upgrade: path.join(ROOT, 'bin', 'commands', 'upgrade.js'),
  install: path.join(ROOT, 'bin', 'lib', 'runtime_install.js'),
  mcp: path.join(ROOT, 'bin', 'lib', 'runtime_mcp.js'),
  paths: path.join(ROOT, 'bin', 'lib', 'paths.js'),
  init: path.join(ROOT, 'bin', 'commands', 'init.js'),
  initMigration: path.join(ROOT, 'bin', 'commands', 'init_migration.js'),
  migrate: path.join(ROOT, 'bin', 'commands', 'migrate.js'),
  doctorServices: path.join(ROOT, 'bin', 'commands', 'doctor_services.js'),
  runtimeLifecycle: path.join(ROOT, 'bin', 'lib', 'runtime_lifecycle.js'),
  uiBuild: path.join(ROOT, 'bin', 'lib', 'ui_build.js'),
  extension: path.join(ROOT, 'bin', 'lib', 'extension.js'),
  rtkInstaller: path.join(ROOT, 'src', 'rtk_installer.js'),
  skillManager: path.join(ROOT, 'src', 'skill_manager.js'),
  skillsController: path.join(ROOT, 'src', 'web', 'controllers', 'skills_controller.js')
};

let failures = 0;
let checks = 0;

function read(src) {
  return fs.readFileSync(SOURCES[src], 'utf8').split('\n');
}

function locate(lines, pattern) {
  const hits = [];
  lines.forEach((line, index) => {
    if (pattern.test(line)) hits.push({ lineNo: index + 1, line: line.trim() });
  });
  return hits;
}

/** Constant names that legitimately stand in for a budget, keyed by the budget they carry. */
const BUDGET_CONSTANTS = {
  [SLOW_NETWORK_MS]: ['INSTALL_BUILD_MIGRATE_TIMEOUT_MS', 'MIGRATION_TIMEOUT_MS'],
  180000: ['UI_READY_TIMEOUT_MS', 'AISLOP_GATE_TIMEOUT_MS'],
  30000: ['GIT_TIMEOUT_MS', 'CLI_PROBE_TIMEOUT_MS']
};

/** Returns true when the line carries the canonical budget in literal or constant form. */
function hasCanonicalBudget(line, expectedMs) {
  if (new RegExp(`\\b${expectedMs}\\b`).test(line)) return true;
  return (BUDGET_CONSTANTS[expectedMs] || []).some((name) => line.includes(name));
}

function expectTimeout(src, pattern, expectedMs, label, { allowConstant = false } = {}) {
  const hits = locate(read(src), pattern);
  checks += 1;
  if (hits.length === 0) {
    failures += 1;
    console.error(`  FAIL ${label}: no match for ${pattern} in ${src}`);
    return;
  }
  const bad = hits.filter(h => {
    if (allowConstant) return !hasCanonicalBudget(h.line, expectedMs);
    return !new RegExp(`\\b${expectedMs}\\b`).test(h.line);
  });
  if (bad.length) {
    failures += 1;
    bad.forEach(h => console.error(`  FAIL ${label}: ${src}:${h.lineNo} does not use ${expectedMs}ms -> ${h.line}`));
    return;
  }
  console.log(`  ok   ${label} (${hits.map(h => `${src}:${h.lineNo}`).join(', ')} = ${expectedMs}ms)`);
}

/**
 * Locate a call by its start pattern and assert the canonical budget appears
 * within the following `window` lines (multi-line spawnSync options put the
 * timeout on a continuation line).
 */
function expectTimeoutWindow(src, pattern, expectedMs, label, { window = 4 } = {}) {
  const lines = read(src);
  const hits = [];
  lines.forEach((line, index) => {
    if (pattern.test(line)) hits.push({ lineNo: index + 1, window: lines.slice(index, index + window).join(' ') });
  });
  checks += 1;
  if (hits.length === 0) {
    failures += 1;
    console.error(`  FAIL ${label}: no match for ${pattern} in ${src}`);
    return;
  }
  const bad = hits.filter(h => !hasCanonicalBudget(h.window, expectedMs));
  if (bad.length) {
    failures += 1;
    bad.forEach(h => console.error(`  FAIL ${label}: ${src}:${h.lineNo} does not use ${expectedMs}ms within ${window} lines`));
    return;
  }
  console.log(`  ok   ${label} (${hits.map(h => `${src}:${h.lineNo}`).join(', ')} = ${expectedMs}ms)`);
}

function expectNeverLiteralBudget(src, pattern, label) {
  const hits = locate(read(src), pattern);
  checks += 1;
  if (hits.length) {
    failures += 1;
    hits.forEach(h => console.error(`  FAIL ${label}: ${src}:${h.lineNo} still uses a sub-canonical literal -> ${h.line}`));
    return;
  }
  console.log(`  ok   ${label} (${src})`);
}

function expectNoStrayBudget(src, allowedMs) {
  const lines = read(src);
  const stray = [];
  lines.forEach((line, index) => {
    if (/hooks:/.test(line)) return;
    const match = line.match(/\b(?:timeout|timeoutMs):\s*(\d+)/);
    if (match && !allowedMs.includes(Number(match[1]))) {
      stray.push({ lineNo: index + 1, line: line.trim() });
    }
  });
  checks += 1;
  if (stray.length) {
    failures += 1;
    stray.forEach(s => console.error(`  FAIL ${src}:${s.lineNo} uses an unapproved timeout budget -> ${s.line}`));
    return;
  }
  console.log(`  ok   ${src} contains only approved budgets (${allowedMs.join(', ')})`);
}

/** Recursively collect .js files under a directory, skipping vendor/build trees. */
function collectJs(dir) {
  const out = [];
  const skip = new Set(['node_modules', '.git', 'build', '.svelte-kit', 'dist', 'coverage', 'vendor', 'output', 'test-results']);
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * Patterns that identify an install / build / migrate / embed subprocess
 * invocation. Matching is deliberately on the command label, not the timeout,
 * so the sweep can also catch calls that omit a timeout entirely.
 */
const INSTALL_BUILD_MIGRATE_RE = new RegExp([
  // package installs
  '\\binstall\\b',
  '\\b(?:pnpm|npm|yarn|bun)\\s+(?:add|i)\\b',
  '\\badd\\s+-g\\b',
  '\\bglobal\\s+add\\b',
  '\\bcargo\\s+install\\b',
  '\\bbrew\\s+install\\b',
  // builds
  '\\brun\\s+build\\b',
  // migrations / embeddings
  '\\bmigrate\\b',
  '\\b--skip-embeddings\\b',
  '\\b--skills-only\\b',
  '\\b--rebuild-embeddings\\b'
].join('|'), 'i');

const SPAWN_RE = /\b(?:execSync|execFileSync|spawnSync|execFile|exec|spawn)\s*\(/;

/**
 * Heuristic: a physical line that begins a subprocess call whose command label
 * matches the install/build/migrate/embed vocabulary. Returns true when the
 * line looks like such a call.
 */
function isInstallBuildMigrateCall(line) {
  if (!SPAWN_RE.test(line)) return false;
  // Strip quoted version probes and pure detection helpers that merely *read* state.
  if (/\b--version\b/.test(line) && !/\binstall\b/i.test(line)) return false;
  return INSTALL_BUILD_MIGRATE_RE.test(line);
}

function sweepRepoWide() {
  const targets = [
    path.join(ROOT, 'bin'),
    path.join(ROOT, 'src')
  ];
  const files = targets.flatMap(collectJs);
  const violations = [];
  let inspected = 0;

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (_) {
      continue;
    }
    const lines = text.split('\n');
    // Some calls span multiple lines; join a small window so the timeout that
    // sits on a continuation line still counts as belonging to the call.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!isInstallBuildMigrateCall(line)) continue;
      inspected += 1;
      const window = lines.slice(i, Math.min(i + 8, lines.length)).join(' ');
      if (!hasCanonicalBudget(window, SLOW_NETWORK_MS)) {
        violations.push({ file: path.relative(ROOT, file), lineNo: i + 1, line: line.trim() });
      }
    }
  }

  checks += 1;
  if (violations.length) {
    failures += 1;
    violations.forEach(v => console.error(`  FAIL repo sweep: ${v.file}:${v.lineNo} install/build/migrate/embed call lacks a ${SLOW_NETWORK_MS}ms budget -> ${v.line}`));
  } else {
    console.log(`  ok   repo-wide sweep: ${inspected} install/build/migrate/embed call(s) across ${files.length} file(s) all budget ${SLOW_NETWORK_MS}ms`);
  }
}

console.log('Canonical constants');

expectTimeout('paths', /const MIGRATION_TIMEOUT_MS = getConfigValue\('install_build_migrate_timeout_ms', \d+\)/, SLOW_NETWORK_MS, 'MIGRATION_TIMEOUT_MS (config-derived)');
expectTimeout('paths', /const INSTALL_BUILD_MIGRATE_TIMEOUT_MS = getConfigValue\('install_build_migrate_timeout_ms', \d+\)/, SLOW_NETWORK_MS, 'INSTALL_BUILD_MIGRATE_TIMEOUT_MS (config-derived)');

console.log('Upgrade timeout budgets');

expectTimeout('upgrade', /controller\.abort\(\)/, 30000, 'HTTP metadata fetch abort');
expectTimeout('upgrade', /--version.*timeout: \d+/, 30000, 'CLI version probe');
expectTimeout('upgrade', /sizeErr|execSync|spawnSync\(c, \['--version'\]/, 30000, 'CLI version probe (exec form)');
expectTimeout('upgrade', /root -g.*timeout: \d+/, 30000, 'global root lookup');
expectTimeout('upgrade', /spawnSync\(cmd, \['root', '-g'\]/, 30000, 'global root lookup (exec form)');
expectTimeout('upgrade', /^      timeout: \d+,$/, 60000, 'installed version read');
expectTimeout('upgrade', /waitForPortReady\(UI_PORT, \{ timeoutMs: (?:UI_READY_TIMEOUT_MS|\d+) \}\)/, 180000, 'web daemon readiness', { allowConstant: true });

console.log('Slow-network budgets (install / build / migrate / embed)');

expectTimeout('upgrade', /spawnOptions = \{.*timeout: (?:\d+|INSTALL_BUILD_MIGRATE_TIMEOUT_MS)/, SLOW_NETWORK_MS, 'package install', { allowConstant: true });
expectTimeout('install', /execSync\('(pnpm|npm) run build'.*timeout: (?:\d+|INSTALL_BUILD_MIGRATE_TIMEOUT_MS)/, SLOW_NETWORK_MS, 'web build', { allowConstant: true });
expectTimeout('install', /timeout: (?:\d+|INSTALL_BUILD_MIGRATE_TIMEOUT_MS), stdio: 'ignore'/, SLOW_NETWORK_MS, 'runtime dependency install', { allowConstant: true });

console.log('Init / migrate / embed budgets');

expectTimeout('init', /safeTimeoutMs: (?:INSTALL_BUILD_MIGRATE_TIMEOUT_MS|\d+)/, SLOW_NETWORK_MS, 'init migration budget', { allowConstant: true });
expectNeverLiteralBudget('runtimeLifecycle', /timeout: (?:120000|180000|60000)\b/, 'runtime lifecycle migrate uses no sub-canonical literal');

console.log('Web UI install / build budgets');

expectTimeout('uiBuild', /execSync\(pmCmd,.*timeout:/, SLOW_NETWORK_MS, 'apps/web install', { allowConstant: true });
expectTimeout('uiBuild', /execSync\('npm install',.*timeout:/, SLOW_NETWORK_MS, 'apps/web install fallback', { allowConstant: true });
expectTimeout('uiBuild', /execSync\(buildCmd,.*timeout:/, SLOW_NETWORK_MS, 'apps/web build', { allowConstant: true });
expectTimeout('uiBuild', /execSync\('npm run build',.*timeout:/, SLOW_NETWORK_MS, 'apps/web build fallback', { allowConstant: true });

console.log('Tool / extension install budgets');

expectTimeout('extension', /install\.ps1.*timeout:/, SLOW_NETWORK_MS, 'uv install (windows download)', { allowConstant: true });
expectTimeout('extension', /ExecutionPolicy Bypass -File.*timeout:/, SLOW_NETWORK_MS, 'uv install (windows script)', { allowConstant: true });
expectTimeout('extension', /winget install.*timeout:/, SLOW_NETWORK_MS, 'uv install (winget fallback)', { allowConstant: true });
expectTimeout('extension', /install\.sh.*timeout:/, SLOW_NETWORK_MS, 'uv install (posix download)', { allowConstant: true });
expectTimeout('extension', /execSync\(`sh "\$\{scriptPath\}"`.*timeout:/, SLOW_NETWORK_MS, 'uv install (posix script)', { allowConstant: true });
expectTimeoutWindow('rtkInstaller', /spawnSync\(cargo, \['install'/, SLOW_NETWORK_MS, 'rtk cargo install');
expectTimeoutWindow('rtkInstaller', /spawnSync\(cargo, \['install'/, SLOW_NETWORK_MS, 'rtk cargo install (fallback)');
expectTimeoutWindow('rtkInstaller', /spawnSync\('brew', \['install'/, SLOW_NETWORK_MS, 'rtk brew install');
expectTimeoutWindow('rtkInstaller', /spawnSync\('sh', \[verifiedScript\]/, SLOW_NETWORK_MS, 'rtk installer script');

console.log('Skill migrate / reindex budgets');


console.log('Short operational guards');

expectTimeout('install', /config get prefix.*timeout: \d+/, 30000, 'npm prefix lookup');
expectTimeout('install', /spawnSync\(npmCmd, \['config', 'get', 'prefix'\]/, 30000, 'npm prefix lookup (exec form)');
expectTimeout('mcp', /timeout: \d+, env: childEnv/, SHORT_GUARD_MS, 'MCP registration spawn');
expectTimeout('mcp', /timeout: \d+, env: cleanEnv/, SHORT_GUARD_MS, 'MCP handshake');

console.log('Budget hygiene');

const approved = [SLOW_NETWORK_MS, SHORT_GUARD_MS, 30000, 180000];
expectNoStrayBudget('upgrade', approved);
expectNoStrayBudget('install', approved);
expectNoStrayBudget('mcp', approved);

console.log('Repo-wide sweep');

sweepRepoWide();

checks += 1;
if (SLOW_NETWORK_MS <= SHORT_GUARD_MS) {
  failures += 1;
  console.error('  FAIL slow-network budget must strictly exceed the short guard');
} else {
  console.log(`  ok   slow-network budget (${SLOW_NETWORK_MS}ms) exceeds short guard (${SHORT_GUARD_MS}ms)`);
}

console.log(`\n${checks - failures}/${checks} timeout assertions passed`);
if (failures) {
  console.error(`\nFAILED: ${failures} timeout budget assertion(s)`);
  process.exit(1);
}
console.log('All upgrade timeout budget checks passed');
