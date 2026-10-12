const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const realHome = (() => {
  try { return os.userInfo().homedir; } catch (_) { return null; }
})();

// 1. Assert HOME != os.userInfo().homedir
assert.ok(process.env.HOME, 'HOME environment variable must be set');
assert.notStrictEqual(process.env.HOME, realHome, 'HOME must not match the real user home');

// 2. Assert KONOHA_TEST_SANDBOX === '1'
assert.strictEqual(process.env.KONOHA_TEST_SANDBOX, '1', 'KONOHA_TEST_SANDBOX must be 1');

// 3. Assert DB path ends in konoha.db
assert.ok(process.env.KONOHA_DB_PATH, 'KONOHA_DB_PATH must be set');
assert.ok(process.env.KONOHA_DB_PATH.endsWith('konoha.db'), 'KONOHA_DB_PATH must end with konoha.db');

// 4. Assert .konoha/server.js exists in HOME
const serverJsPath = path.join(process.env.HOME, '.konoha', 'server.js');
assert.ok(fs.existsSync(serverJsPath), '.konoha/server.js must exist in sandboxed HOME');

console.log('test_runner_isolation: PASS');
