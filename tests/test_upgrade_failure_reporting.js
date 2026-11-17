#!/usr/bin/env node
'use strict';

/**
 * tests/test_upgrade_failure_reporting.js
 *
 * `konoha upgrade` used to discard the install result and fall back to the
 * requested version, so a total failure still printed "successfully upgraded".
 * These assertions pin the failure path: unverified versions are never invented,
 * and the install result is checked before the post-upgrade lifecycle runs.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_upgrade_'));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
process.env.KONOHA_DB_PATH = path.join(tempHome, 'test.db');

const upgrade = require('../bin/commands/upgrade.js');

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  PASS ${label}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${label}: ${err.message}`);
  }
}

check('readInstalledVersion never returns the requested target', () => {
  const bogusRoot = path.join(tempHome, 'no-such-root');
  const result = upgrade.readInstalledVersion(bogusRoot);
  assert.strictEqual(result.source, 'unverified', `source was ${result.source}`);
  assert.strictEqual(result.version, null, `invented version ${result.version}`);
  assert.ok(result.error, 'error detail missing');
});

check('semver helpers still exported and correct', () => {
  assert.strictEqual(typeof upgrade.parseSemver, 'function');
  assert.strictEqual(typeof upgrade.semverCompare, 'function');
  assert.ok(upgrade.semverCompare('2.2.19', '2.2.18') > 0);
  assert.ok(upgrade.semverCompare('2.2.19', '2.2.19') === 0);
});

check('locateGlobalPackageRoot is exported', () => {
  assert.strictEqual(typeof upgrade.locateGlobalPackageRoot, 'function');
});

check('runtime mirror is never accepted as upgrade proof', () => {
  // Behavioral: seed ONLY the runtime mirror (~/.konoha/bin/cli.js), which the
  // post-upgrade sync refreshes even when the npm package replacement failed.
  // Verification must report unverified rather than resolve the repo's own CLI.
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_mirror_proof_'));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, KONOHA_DB_PATH: process.env.KONOHA_DB_PATH };
  try {
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    process.env.KONOHA_DB_PATH = path.join(tmpHome, 'test.db');
    const { SKILLS_DB_DIR } = require(path.join(ROOT, 'bin', 'lib', 'paths'));
    fs.mkdirSync(path.join(SKILLS_DB_DIR, 'bin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'bin', 'cli.js'), path.join(SKILLS_DB_DIR, 'bin', 'cli.js'));

    const result = upgrade.readInstalledVersion(null);
    assert.strictEqual(result.version, null, `mirror was accepted as proof: ${result.version}`);
    assert.strictEqual(result.source, 'unverified');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

check('Windows root discovery does not append .cmd twice', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bin', 'commands', 'upgrade.js'), 'utf8');
  // PowerShell does not apply PATHEXT to a name that already has an extension.
  assert.strictEqual(
    /`\$\{cmd\}\.cmd root -g`/.test(src),
    false,
    'runRootCmd appends .cmd to an already-suffixed command'
  );
});

check('GitHub fallback install receives the Windows flag', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bin', 'commands', 'upgrade.js'), 'utf8');
  const call = src.match(/tryInstallCandidate\(pm, fallbackArgs, spawnOptions[^)]*\)/);
  assert.ok(call, 'fallback install call not found');
  assert.match(call[0], /isWin/, 'fallback omits isWin, so .cmd spawning fails on Windows');
});

check('a fresh confirmed attempt clears a stale marker', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bin', 'commands', 'upgrade.js'), 'utf8');
  const confirmIdx = src.indexOf('if (!doUpgrade)');
  const clearIdx = src.indexOf('clearUpgradePendingMarker()', confirmIdx);
  assert.ok(confirmIdx > -1, 'confirm branch not found');
  assert.ok(clearIdx > -1 && clearIdx - confirmIdx < 400, 'confirmed upgrade does not clear a stale marker');
});

check('install result is checked before the post-upgrade lifecycle', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bin', 'commands', 'upgrade.js'), 'utf8');
  const match = src.match(/const pkgInstall = executePackageInstall\([^)]*\);\s*if \(!pkgInstall\.ok\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(match, 'no `if (!pkgInstall.ok)` guard found around the install call');
  assert.match(match[1], /process\.exit\(1\)/, 'guard does not abort the upgrade');
  assert.match(match[1], /Upgrade aborted/, 'guard lacks an actionable message');
});

check('upgrade-pending marker is written before install on Windows only', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bin', 'commands', 'upgrade.js'), 'utf8');
  const markerIdx = src.indexOf('if (isWin) writeUpgradePendingMarker(cleanTarget);');
  const installIdx = src.indexOf('const pkgInstall = executePackageInstall');
  assert.ok(markerIdx > -1, 'marker write missing');
  assert.ok(markerIdx < installIdx, 'marker must be written before the install');
});

check('marker write is atomic (temp file + rename)', () => {
  // A truncated marker would read back as no-upgrade-in-flight and lose the
  // recovery signal, so the writer must swap a completely-written file into place.
  const src = fs.readFileSync(path.join(ROOT, 'bin', 'commands', 'upgrade.js'), 'utf8');
  const writer = src.match(/function writeUpgradePendingMarker[\s\S]*?\n}/);
  assert.ok(writer, 'marker writer not found');
  assert.match(writer[0], /renameSync/, 'marker is written in place, not swapped');
});

check('marker helpers round-trip and clear', () => {
  const upgradeModulePath = path.join(ROOT, 'bin', 'commands', 'upgrade.js');
  const fresh = require(upgradeModulePath);
  const markerPath = path.join(tempHome, '.konoha', '.upgrade_pending.json');
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({ target: '2.2.19' }));
  const read = fresh.readUpgradePendingMarker();
  assert.strictEqual(read.target, '2.2.19');
  fresh.clearUpgradePendingMarker();
  assert.strictEqual(fs.existsSync(markerPath), false);
  assert.strictEqual(fresh.readUpgradePendingMarker(), null);
});

check('clean install failure clears the marker; verification failure keeps it', () => {
  // A reported package-manager failure leaves the old install intact, so the
  // marker must go. A verification failure may mean a partially replaced
  // runtime, so the recovery warning is retained for the next CLI start.
  const src = fs.readFileSync(path.join(ROOT, 'bin', 'commands', 'upgrade.js'), 'utf8');
  const installFail = src.match(/if \(!pkgInstall\.ok\) \{([\s\S]*?)process\.exit\(1\)/);
  assert.ok(installFail, 'install failure block not found');
  assert.match(installFail[1], /clearUpgradePendingMarker\(\)/, 'install failure leaves marker behind');
  const verifyFail = src.match(/if \(installed\.source === 'unverified'[\s\S]*?process\.exit\(1\)/);
  assert.ok(verifyFail, 'verification failure block not found');
  assert.strictEqual(
    /clearUpgradePendingMarker\(\)/.test(verifyFail[0]),
    false,
    'verification failure must retain the marker'
  );
});

check('a root-owned global prefix is reported as a permission failure', () => {
  // npm on a system prefix retires /usr/lib/node_modules/<pkg> and then fails
  // renaming /usr/bin/konoha with EACCES. Generic "no package manager could
  // install" text sends the user hunting for a registry problem, so the failure
  // must carry the permission flag and name sudo / a user prefix as recovery.
  const mod = require('../bin/commands/upgrade.js');
  assert.strictEqual(typeof mod.executePackageInstall, 'function');
  const pbar = { stopPulse() {}, logStep() {} };
  const result = mod.executePackageInstall(
    [{
      name: 'npm',
      cmd: process.execPath,
      args: ['-e', "console.error(\"npm error code EACCES\nnpm error Error: EACCES: permission denied, rename '/usr/bin/konoha' -> '/usr/bin/.konoha-qVbEiRw5'\"); process.exit(1)"]
    }],
    'konoha-mcp@9.9.9.tgz',
    'v9.9.9',
    false,
    pbar
  );
  assert.strictEqual(result.ok, false, 'install reported success');
  assert.strictEqual(result.permissionDenied, true, 'EACCES was not detected');

  const src = fs.readFileSync(path.join(ROOT, 'bin', 'commands', 'upgrade.js'), 'utf8');
  const block = src.match(/if \(pkgInstall\.permissionDenied\) \{([\s\S]*?)\n {4}\}/);
  assert.ok(block, 'no permission-specific remediation block');
  assert.match(block[1], /sudo npm install -g/, 'recovery omits the sudo install');
  assert.match(block[1], /npm config set prefix/, 'recovery omits the user-owned prefix');
});

fs.rmSync(tempHome, { recursive: true, force: true });

console.log(failures === 0 ? '\nupgrade failure reporting: OK' : `\nupgrade failure reporting: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
