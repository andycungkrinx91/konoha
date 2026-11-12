const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

test('apps/web @playwright/test is aligned to 1.64.1 and playwright executes without export mismatch', () => {
  const rootDir = path.resolve(__dirname, '..');
  const webPkgPath = path.join(rootDir, 'apps', 'web', 'package.json');
  const webPkg = JSON.parse(fs.readFileSync(webPkgPath, 'utf8'));

  const pwVersion = webPkg.devDependencies?.['@playwright/test'];
  assert.match(
    pwVersion,
    /1\.64\.1/,
    `apps/web devDependencies['@playwright/test'] must be pinned to '1.64.1' (found: ${pwVersion})`
  );

  // pnpm is a .cmd shim on Windows; Node refuses to spawn it without a shell
  // (CVE-2024-27980 hardening), which surfaces as status null / ENOENT.
  const res = spawnSync('pnpm', ['--dir', 'apps/web', 'exec', 'playwright', '--version'], {
    cwd: rootDir,
    encoding: 'utf8',
    // A cold `pnpm exec` on a Windows VM needs to resolve the shim and the
    // package store on first touch; 30 s expired before the process printed
    // anything, which shows up as status null with empty output.
    timeout: 120000,
    shell: process.platform === 'win32'
  });

  const output = (res.stdout || '') + (res.stderr || '') + (res.error ? `\n[spawn error] ${res.error.message}` : '');
  assert.ok(
    !output.includes('ERR_PACKAGE_PATH_NOT_EXPORTED'),
    `playwright execution must not fail with ERR_PACKAGE_PATH_NOT_EXPORTED:\n${output}`
  );
  assert.strictEqual(
    res.status,
    0,
    `playwright --version must exit with 0, got ${res.status}:\n${output}`
  );
  assert.match(output, /Version 1\.64\.1/, `must output Version 1.64.1, got: ${output}`);
});
