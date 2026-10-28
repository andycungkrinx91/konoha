'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

// 1. Assert filesystem absence
assert.ok(!fs.existsSync(path.join(ROOT_DIR, 'src', 'tunnel')), 'src/tunnel directory must not exist');
assert.ok(!fs.existsSync(path.join(ROOT_DIR, 'bin', 'commands', 'tunnel.js')), 'bin/commands/tunnel.js must not exist');
assert.ok(!fs.existsSync(path.join(ROOT_DIR, 'docs', 'CLOUDFLARE_TUNNEL_GUIDE.md')), 'docs/CLOUDFLARE_TUNNEL_GUIDE.md must not exist');

// 2. Assert database schema absence
const tmpDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_no_tunnel_test_'));
const dbPath = path.join(tmpDbDir, 'test.db');
process.env.KONOHA_DB_PATH = dbPath;

try {
  const db = require('../src/db');
  const conn = db.getConnection(dbPath, false);
  db.setupSchema(conn);

  const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  assert.ok(!tables.includes('tunnel_config'), 'tunnel_config table must not exist in SQLite schema');

  // Verify telegram_config transport constraint
  const tgRow = conn.prepare("SELECT transport FROM telegram_config WHERE id = 1").get();
  assert.strictEqual(tgRow.transport, 'polling', 'telegram transport must default to polling');

  conn.close();
} finally {
  try { fs.rmSync(tmpDbDir, { recursive: true, force: true }); } catch (_) {}
}

// 3. Assert CLI command rejection
const cliRes = spawnSync(process.execPath, [path.join(ROOT_DIR, 'bin', 'cli.js'), 'tunnel'], {
  encoding: 'utf8'
});
assert.strictEqual(cliRes.status, 1, 'konoha tunnel must exit with code 1');
assert.ok(cliRes.stderr.includes('Unknown command: tunnel') || cliRes.stdout.includes('Unknown command: tunnel'), 'Must report unknown command');

// 4. Assert absence in production controllers
const webServerCode = fs.readFileSync(path.join(ROOT_DIR, 'src', 'web_server.js'), 'utf8');
assert.ok(!webServerCode.includes('tunnel'), 'src/web_server.js must not contain tunnel references');
assert.ok(!webServerCode.includes('cf-access'), 'src/web_server.js must not contain cf-access references');

const servicesCtrlCode = fs.readFileSync(path.join(ROOT_DIR, 'src', 'web', 'controllers', 'services_controller.js'), 'utf8');
assert.ok(!servicesCtrlCode.includes('_handleTunnel'), 'services_controller.js must not contain _handleTunnel');
assert.ok(!servicesCtrlCode.includes('/api/v1/tunnel'), 'services_controller.js must not contain /api/v1/tunnel');

console.log('✔ All tunnel removal regression assertions passed cleanly.');
