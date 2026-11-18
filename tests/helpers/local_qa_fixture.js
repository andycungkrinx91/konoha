'use strict';

/**
 * tests/helpers/local_qa_fixture.js — a throwaway project that runs the repo's
 * own Playwright, plus a `docker` shim that records any invocation.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function shimSource(marker) {
  return process.platform === 'win32'
    ? `@echo %*>> "${marker}"\r\n@exit /b 1\r\n`
    : `#!/bin/sh\necho "$@" >> "${marker}"\nexit 1\n`;
}

function createLocalQaFixture({ tmpDir, name = 'fixture-proj', specSource, configSource }) {
  const proj = path.join(tmpDir, name);
  fs.mkdirSync(path.join(proj, 'e2e'), { recursive: true });
  fs.symlinkSync(
    path.join(REPO_ROOT, 'node_modules'),
    path.join(proj, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  fs.writeFileSync(
    path.join(proj, 'playwright.config.js'),
    configSource || `module.exports = {\n  testDir: './e2e',\n  reporter: 'json',\n  use: { headless: true }\n};\n`
  );
  fs.writeFileSync(path.join(proj, 'e2e', 'smoke.spec.js'), specSource);

  const shimDir = path.join(tmpDir, `${name}-shim`);
  fs.mkdirSync(shimDir, { recursive: true });
  const dockerMarker = path.join(tmpDir, `${name}-docker-invocations.txt`);
  const shimPath = path.join(shimDir, process.platform === 'win32' ? 'docker.cmd' : 'docker');
  fs.writeFileSync(shimPath, shimSource(dockerMarker));
  fs.chmodSync(shimPath, 0o755);

  return {
    proj,
    shimDir,
    dockerMarker,
    dockerCalls: () => (fs.existsSync(dockerMarker) ? fs.readFileSync(dockerMarker, 'utf8').trim() : '')
  };
}

module.exports = { createLocalQaFixture };
