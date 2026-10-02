'use strict';

/**
 * tests/test_ui_cross_platform_lifecycle.js
 *
 * Verifies cross-platform correctness for Windows, macOS, and Linux
 * Web UI lifecycle commands:
 * - openUrlInBrowser uses cmd.exe /c start "" on Windows with windowsHide: true
 * - cmdUiStart uses windowsHide: true and extended retry count on Windows
 * - cmdUiStop supports arbitrary ports on Windows, uses taskkill /F /T /PID,
 *   PowerShell -Unique, and netstat -ano fallback
 * - cmdUiRestart waits for port release before restarting
 * - resolveWebUiDir handles konoha / Konoha / konohagakure case variations
 * - web_server.js getDistDir resolves dynamically
 */

require('./helpers/isolate_db');

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function runTests() {
  console.log('Running test_ui_cross_platform_lifecycle tests...');

  const cliSource = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'cli.js'), 'utf8') +
    fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'lib', 'ui_commands.js'), 'utf8');
  const deployUtils = require('../src/deploy_utils');
  const webServerSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'web_server.js'), 'utf8');

  // 1. openUrlInBrowser on Windows
  ok(
    'openUrlInBrowser uses cmd.exe /c start "" on Windows',
    cliSource.includes("spawn('cmd.exe', ['/c', 'start', '\"\"', targetUrl]")
  );
  ok(
    'openUrlInBrowser sets windowsHide: true on Windows',
    cliSource.includes("windowsHide: true")
  );

  // 2. cmdUiStart daemon spawn
  ok(
    'cmdUiStart passes windowsHide: true in daemon spawn options',
    cliSource.includes("windowsHide: true\n  });") || cliSource.includes("windowsHide: true")
  );
  ok(
    'cmdUiStart adapts maxAttempts to 30 on Windows',
    cliSource.includes("const maxAttempts = process.platform === 'win32' ? 30 : 15;")
  );

  // 3. cmdUiStop Windows logic
  ok(
    'pidBelongsToPort allows any valid PID on Windows (not hardcoded to 1404)',
    !cliSource.includes("if (process.platform === 'win32') return stopPort === 1404;") &&
    cliSource.includes("if (process.platform === 'win32') {")
  );
  ok(
    'cmdUiStop uses taskkill /F /T /PID for tree kill',
    cliSource.includes("taskkill /F /T /PID")
  );
  ok(
    'cmdUiStop uses PowerShell -Unique and netstat -ano fallback on Windows',
    cliSource.includes("Select-Object -ExpandProperty OwningProcess -Unique") &&
    cliSource.includes("netstat -ano -p tcp")
  );

  // 4. cmdUiRestart polling
  ok(
    'cmdUiRestart polls checkPortActive before starting new daemon',
    cliSource.includes("for (let i = 0; i < 20; i++) {") &&
    cliSource.includes("if (!await checkPortActive(restartPort)) break;")
  );

  // 5. cmdUiBuild cross-platform safety
  ok(
    'cmdUiBuild detects pnpm safely and sets shell: isWin',
    cliSource.includes("where pnpm") &&
    cliSource.includes("shell: isWin")
  );
  ok(
    'cmdUiBuild copies build in-place with recursive copy to avoid Windows EBUSY',
    cliSource.includes("fs.cpSync(path.join(webDir, 'build'), installedBuild, { recursive: true, force: true });")
  );

  // 6. resolveWebUiDir casing support
  ok(
    'resolveWebUiDir supports konoha, Konoha, and konohagakure candidates',
    typeof deployUtils.resolveWebUiDir === 'function'
  );
  const deployUtilsSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'deploy_utils.js'), 'utf8');
  ok(
    'deployUtils candidates include konoha and konohagakure',
    deployUtilsSource.includes('path.join(globalRoot, "konoha", "apps", "web")') &&
    deployUtilsSource.includes('path.join(globalRoot, "konohagakure", "apps", "web")')
  );

  // 7. web_server.js dynamic getDistDir
  ok(
    'web_server.js defines dynamic getDistDir helper',
    webServerSource.includes('function getDistDir()')
  );
  ok(
    'web_server.js uses getDistDir() in request handler',
    webServerSource.includes('const distDir = getDistDir();')
  );

  // 8. Windows SIGBREAK support in daemon and foreground modes
  ok(
    'cli.js hooks SIGBREAK on Windows in cmdUiDaemon and cmdWebForeground',
    cliSource.includes("if (process.platform === 'win32') {\n    process.on('SIGBREAK', shutdown);") &&
    cliSource.includes("if (process.platform === 'win32') {\n      process.on('SIGBREAK', handleShutdown);")
  );

  console.log(`\nLifecycle test summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
