#!/usr/bin/env node
'use strict';

/**
 * tests/test_agent_browser_provisioning.js — Guards the agent-browser install
 * contract. Every assertion here is behavioural: the candidate lists are built by
 * the module under test, so a regression (yarn re-added, --ignore-scripts
 * dropped, pnpm --prefix restored, pin reverted) fails here rather than passing a
 * source-text grep.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  PINNED_AB_PACKAGE,
  PINNED_AB_VERSION,
  globalInstallCandidates,
  managedInstallCandidates,
  resolvePackageManagerBin,
  packageManagerEnv
} = require('../bin/lib/extension');

console.log('Running test_agent_browser_provisioning.js...');

// 0.3.1 has no linux-x64 native binary and pulls a vulnerable zod; the pin must
// stay on a version that ships prebuilt binaries.
assert.strictEqual(PINNED_AB_PACKAGE, 'agent-browser@0.41.2', 'Pin must be agent-browser@0.41.2');
assert.strictEqual(PINNED_AB_VERSION, '0.41.2', 'Derived version must match the pin');

for (const isWin of [false, true]) {
  const label = isWin ? 'win32' : 'posix';

  for (const [kind, candidates, prefix] of [
    ['global', globalInstallCandidates(isWin), null],
    ['managed', managedInstallCandidates('/tmp/probe-prefix', isWin), '/tmp/probe-prefix']
  ]) {
    const names = candidates.map((c) => c.name);
    assert.deepStrictEqual(names, ['npm', 'pnpm'], `${kind}/${label}: candidates must be npm then pnpm only`);

    for (const candidate of candidates) {
      const joined = candidate.args.join(' ');
      assert.ok(
        !/\byarn\b/.test(candidate.cmd) && !/\byarn\b/.test(joined),
        `${kind}/${label}: yarn must never appear in the install chain, got ${candidate.cmd} ${joined}`
      );
      assert.ok(
        candidate.args.includes('--ignore-scripts'),
        `${kind}/${label}: ${candidate.name} must pass --ignore-scripts so no build script runs`
      );
      assert.ok(
        candidate.args.includes(PINNED_AB_PACKAGE),
        `${kind}/${label}: ${candidate.name} must install the pinned package`
      );
      assert.ok(
        !candidate.args.includes('--prefix') || candidate.name === 'npm',
        `${kind}/${label}: only npm understands --prefix; pnpm needs --dir`
      );
      if (prefix && candidate.name === 'pnpm') {
        assert.ok(joined.includes('--dir'), `${kind}/${label}: pnpm managed install must use --dir`);
      }
    }
  }
}

// Windows installs add the .cmd shim to PATH; the resolver must return it there.
// Only assert the extension on a real win32 host, where the candidates are built
// from actual Windows paths.
if (process.platform === 'win32') {
  for (const candidate of globalInstallCandidates(true)) {
    assert.ok(candidate.cmd.endsWith('.cmd'), `Windows candidate ${candidate.name} must use the .cmd shim`);
  }
}

// A managed prefix containing a space (C:\Users\First Last) is quoted so the
// Windows shell form does not split the flag.
const spaced = managedInstallCandidates('/tmp/a b', true);
assert.ok(
  spaced.every((c) => c.args.some((a) => a.includes('"/tmp/a b"'))),
  'Windows managed install must quote a prefix containing spaces'
);
const spacedPosix = managedInstallCandidates('/tmp/a b', false);
assert.ok(
  spacedPosix.every((c) => c.args.some((a) => a === '/tmp/a b')),
  'POSIX managed install must pass the prefix unquoted'
);

// Package managers are resolved by absolute path, not left to PATH: distro,
// Homebrew, and standalone pnpm installs live outside nvm, and a GUI-launched
// app on macOS gets a PATH that omits them all.
const savedPath = process.env.PATH;
try {
  process.env.PATH = path.join('/nonexistent-konoha-prefix');
  const npmBin = resolvePackageManagerBin('npm', false);
  const pnpmBin = resolvePackageManagerBin('pnpm', false);
  console.log(`  resolution with PATH emptied: npm=${npmBin || '(none)'} pnpm=${pnpmBin || '(none)'}`);
  assert.notStrictEqual(pnpmBin, null, 'pnpm must resolve even with an empty PATH (distro/standalone installs)');
  for (const resolved of [npmBin, pnpmBin]) {
    if (resolved === null) continue;
    assert.ok(path.isAbsolute(resolved), `Resolved binary must be absolute, got ${resolved}`);
  }
  const binName = (p) => path.basename(p).replace(/\.(cmd|exe|ps1)$/, '');
  if (npmBin) assert.strictEqual(binName(npmBin), 'npm', `Unexpected npm binary: ${npmBin}`);
  assert.strictEqual(binName(pnpmBin), 'pnpm', `Unexpected pnpm binary: ${pnpmBin}`);

  // Every candidate must carry an absolute command, so the spawn never depends on
  // PATH lookup either.
  for (const candidate of [...globalInstallCandidates(false), ...managedInstallCandidates('/tmp/p', false)]) {
    assert.ok(path.isAbsolute(candidate.cmd), `Candidate ${candidate.name} must use an absolute path, got ${candidate.cmd}`);
  }

  // A package manager that exists nowhere must report absent instead of throwing.
  assert.strictEqual(
    resolvePackageManagerBin('konoha-nonexistent-pm', false),
    null,
    'Missing package manager must resolve to null'
  );
} finally {
  if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
}

// A system node on PATH must never win over the node running Konoha: a
// GUI-minimal PATH resolves `env node` to the distro node (v16 here), and npm
// then emits EBADENGINE for a package requiring >=24. This reproduces that
// selection bug deterministically, without network access or a real install.
{
  const decoyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-decoy-'));
  fs.writeFileSync(path.join(decoyDir, 'node'), '#!/bin/sh\necho v0.0.0-decoy\n', { mode: 0o755 });
  const savedPath = process.env.PATH;
  try {
    process.env.PATH = [decoyDir, '/usr/bin', '/bin'].join(path.delimiter);
    const legacy = spawnSync('node', ['--version'], { encoding: 'utf-8', env: { ...process.env } });
    assert.strictEqual(legacy.stdout.trim(), 'v0.0.0-decoy', 'Precondition: the decoy node must shadow the real one');
    const fixed = spawnSync('node', ['--version'], { encoding: 'utf-8', env: packageManagerEnv() });
    assert.strictEqual(fixed.stdout.trim(), process.version, 'packageManagerEnv() must put the running node first');
  } finally {
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
  }
}

// Resolved candidates must keep the rest of PATH intact: lifecycle and runtime
// tools still need the system directories.
{
  const env = packageManagerEnv();
  const parts = env.PATH.split(path.delimiter);
  const nodeDir = path.dirname(process.execPath);
  assert.ok(parts.includes(nodeDir), 'Running node dir must be present in PATH');
  assert.strictEqual(parts.filter((p) => p === nodeDir).length, 1, 'Node dir must not be duplicated');
  const inherited = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const entry of inherited) {
    assert.ok(parts.includes(entry), `pre-existing PATH entry dropped: ${entry}`);
  }
  assert.ok(typeof env === 'object' && env !== null, 'Env must be a full environment, not just PATH');
}

console.log('✓ test_agent_browser_provisioning.js passed cleanly.');
