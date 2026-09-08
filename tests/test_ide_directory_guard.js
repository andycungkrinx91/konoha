'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const routerPath = path.join(__dirname, '..', 'src', 'file_tools_router.js');
const router = require(routerPath);

console.log('Testing IDE Directory Guard & Windows Workspace Isolation...');

// 1. Test isIdeInstallationDirectory
const testCases = [
  { path: 'C:\\Users\\User\\AppData\\Local\\Programs\\Antigravity IDE', expected: true },
  { path: 'C:/Users/User/AppData/Local/Programs/Antigravity IDE', expected: true },
  { path: 'C:\\Program Files\\Antigravity IDE', expected: true },
  { path: 'C:\\Program Files (x86)\\Antigravity IDE', expected: true },
  { path: 'D:\\Apps\\Antigravity IDE', expected: true },
  { path: 'E:\\Tools\\antigravity-ide', expected: true },
  { path: '/opt/Antigravity IDE', expected: true },
  { path: 'C:\\Users\\User\\Projects\\my-web-app', expected: false },
  { path: 'D:\\workspace\\project-1', expected: false },
  { path: '/home/user/code/konoha', expected: false }
];

for (const tc of testCases) {
  if (tc.expected) {
    assert.throws(
      () => router.assertWithinAllowed(tc.path),
      /Access to IDE installation directory is forbidden/,
      `Expected ${tc.path} to be forbidden`
    );
  }
}
console.log('  ✓ IDE installation directories are strictly forbidden in assertWithinAllowed');

// 2. Test getWorkspaceRoot never returns IDE directory
router.setWorkspaceRoot('C:\\Users\\User\\AppData\\Local\\Programs\\Antigravity IDE');
const ws = router.getWorkspaceRoot();
assert.notStrictEqual(
  ws,
  'C:\\Users\\User\\AppData\\Local\\Programs\\Antigravity IDE',
  'getWorkspaceRoot must reject IDE directory'
);
console.log('  ✓ getWorkspaceRoot never returns an IDE installation directory');

// 3. Test router.isIdeInstallationDirectory directly
assert.strictEqual(router.isIdeInstallationDirectory("C:\\\\Users\\\\User\\\\AppData\\\\Local\\\\Programs\\\\Antigravity IDE"), true);
assert.strictEqual(router.isIdeInstallationDirectory("C:\\\\Program Files\\\\Antigravity IDE"), true);
assert.strictEqual(router.isIdeInstallationDirectory("C:\\\\Users\\\\User\\\\myproject"), false);
console.log('  ✓ router.isIdeInstallationDirectory verified');

console.log('All IDE Directory Guard tests passed successfully!');
