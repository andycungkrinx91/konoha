const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

test('apps/web @playwright/test is aligned to 1.50.1 and playwright executes without export mismatch', () => {
  const rootDir = path.resolve(__dirname, '..');
  const webPkgPath = path.join(rootDir, 'apps', 'web', 'package.json');
  const webPkg = JSON.parse(fs.readFileSync(webPkgPath, 'utf8'));

  const pwVersion = webPkg.devDependencies?.['@playwright/test'];
  assert.strictEqual(
    pwVersion,
    '1.50.1',
    `apps/web devDependencies['@playwright/test'] must be pinned to '1.50.1' (found: ${pwVersion})`
  );

  const res = spawnSync('pnpm', ['--dir', 'apps/web', 'exec', 'playwright', '--version'], {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 30000
  });

  const output = (res.stdout || '') + (res.stderr || '');
  assert.ok(
    !output.includes('ERR_PACKAGE_PATH_NOT_EXPORTED'),
    `playwright execution must not fail with ERR_PACKAGE_PATH_NOT_EXPORTED:\n${output}`
  );
  assert.strictEqual(
    res.status,
    0,
    `playwright --version must exit with 0, got ${res.status}:\n${output}`
  );
  assert.match(output, /Version 1\.50\.1/, `must output Version 1.50.1, got: ${output}`);
});
