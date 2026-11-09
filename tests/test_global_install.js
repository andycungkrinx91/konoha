#!/usr/bin/env node
'use strict';

/**
 * The 2.2.20 install fix, proven end to end.
 *
 * Shipping a `postinstall` hook made `npm i -g konoha-mcp` die with
 * `npm error code EALLOWSCRIPTS` on npm versions that gate install scripts, and
 * the hook never ran anyway. It is gone. What replaces it must still work:
 *
 *   - the published tarball carries its own runtime deps (`bundleDependencies`),
 *     because a pnpm workspace symlink tree does not survive `npm pack`;
 *   - no install script fires;
 *   - the CLI, MCP entry point, and PPTX export all run from the installed tree.
 *
 * This test is intentionally heavy (packs + installs). It is skipped unless
 * KONOHA_RUN_INSTALL_TEST=1 so the unit suite stays fast; the release checklist
 * runs it explicitly.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', timeout: 900000, ...opts });
}

function check() {
  console.log('Running test_global_install...');

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  // No install-time script can fire, and no allowScripts escape hatch is
  //    documented as required.
  for (const hook of ['postinstall', 'preinstall', 'install']) {
    assert.ok(!pkg.scripts || !pkg.scripts[hook], `package.json must not declare a "${hook}" script`);
  }
  assert.ok(
    !fs.existsSync(path.join(ROOT, 'bin', 'postinstall.js')),
    'bin/postinstall.js must stay deleted'
  );
  console.log('  ok   no install hooks declared');

  // Runtime deps must be bundled: a global install gets no workspace.
  const bundled = pkg.bundleDependencies || pkg.bundledDependencies || [];
  assert.ok(bundled.includes('pptxgenjs'), 'bundleDependencies must include pptxgenjs');
  console.log(`  ok   bundleDependencies: ${bundled.join(', ')}`);

  // A shipped tarball exists and carries node_modules.
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_pack_'));
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_gprefix_'));
  try {
    sh('pnpm', ['pack', '--pack-destination', packDir], { cwd: ROOT });
    const tgz = fs.readdirSync(packDir).find((f) => f.endsWith('.tgz'));
    assert.ok(tgz, 'pnpm pack must produce a tarball');
    const tgzPath = path.join(packDir, tgz);

    const entries = sh('tar', ['-tzf', tgzPath]);
    assert.ok(entries.includes('package/bin/cli.js'), 'tarball must ship bin/cli.js');
    assert.ok(entries.includes('package/src/migrate.js'), 'tarball must ship src/');
    assert.ok(
      entries.includes('package/node_modules/pptxgenjs/package.json'),
      'tarball must ship bundled node_modules/pptxgenjs (global install has no workspace)'
    );
    assert.ok(
      !entries.includes('package/bin/postinstall.js'),
      'tarball must not ship the deleted postinstall script'
    );
    console.log(`  ok   packed ${tgz} (${(fs.statSync(tgzPath).size / 1048576).toFixed(1)}M with bundled deps)`);

    // Global-style install into an isolated prefix, no prompts, no scripts.
    sh('npm', ['install', '-g', '--prefix', prefix, tgzPath, '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: prefix,
      env: { ...process.env, npm_config_allow_scripts: '' }
    });

    const binDir = path.join(prefix, 'bin');
    const cli = path.join(binDir, 'konoha');
    assert.ok(fs.existsSync(cli), 'install must link the konoha binary');

    // The CLI actually runs from the installed tree.
    const version = sh(cli, ['--version'], { cwd: prefix }).trim();
    assert.match(version, /\d+\.\d+\.\d+/, `installed CLI must report a version, got "${version}"`);
    console.log(`  ok   installed CLI reports ${version}`);

    // image-size resolves compliantly in the installed tree.
    const pkgPath = path.join(prefix, 'lib', 'node_modules', 'konoha-mcp');
    const isPkg = path.join(pkgPath, 'node_modules', 'pptxgenjs', 'package.json');
    assert.ok(fs.existsSync(isPkg), 'installed tree must contain bundled pptxgenjs');
    const resolved = JSON.parse(
      sh(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(pkgPath, 'node_modules', 'image-size', 'package.json'))}).version))`])
    );
    const [maj, min] = resolved.split('.').map(Number);
    assert.ok(maj > 2 || (maj === 2 && min >= 0), `installed image-size ${resolved} must be >= 2.0.3`);
    console.log(`  ok   installed image-size ${resolved}`);

    // PPTX export works from the installed copy (the real user-visible path).
    const pptxOut = path.join(prefix, 'probe.pptx');
    sh(process.execPath, ['-e', `
      const PptxGenJS = require(${JSON.stringify(path.join(pkgPath, 'node_modules', 'pptxgenjs'))});
      const p = new PptxGenJS();
      const s = p.addSlide();
      s.addImage({ data: 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', x: 0, y: 0, w: 1, h: 1 });
      p.writeFile({ fileName: ${JSON.stringify(pptxOut)} }).then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
    `]);
    assert.ok(fs.statSync(pptxOut).size > 5000, 'installed tree must be able to write a PPTX');
    console.log('  ok   installed tree writes a PPTX');

    // Reinstall over the same prefix must stay clean (idempotent).
    sh('npm', ['install', '-g', '--prefix', prefix, tgzPath, '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: prefix,
      env: { ...process.env, npm_config_allow_scripts: '' }
    });
    assert.strictEqual(sh(cli, ['--version'], { cwd: prefix }).trim(), version, 'reinstall must not break the binary');
    console.log('  ok   reinstall is idempotent');

    console.log('All global install checks passed');
  } finally {
    fs.rmSync(packDir, { recursive: true, force: true });
    fs.rmSync(prefix, { recursive: true, force: true });
  }
}

if (process.env.KONOHA_RUN_INSTALL_TEST !== '1') {
  console.log('SKIP test_global_install (set KONOHA_RUN_INSTALL_TEST=1 to pack and install)');
  process.exit(0);
}

try {
  check();
} catch (err) {
  console.error(`FAIL test_global_install: ${err.message}`);
  if (err.stderr) console.error(String(err.stderr).slice(0, 2000));
  process.exit(1);
}