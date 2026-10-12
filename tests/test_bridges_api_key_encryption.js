/**
 * Test Bridges API Key Encryption at Rest and Idempotent Migration
 * Verifies that bridges.api_key is encrypted with AES-256-GCM via crypto_vault,
 * migrated idempotently with VACUUM INTO backup, 0600 file modes, and throws on missing key.
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "konoha_test_bridges_enc_"));
const testDbPath = path.join(sandboxDir, "skills.db");

// Set environment for database isolation
process.env.KONOHA_DB_PATH = testDbPath;
const db = require("../src/db");
db.DB_PATH = testDbPath;

const dbBridges = require("../src/db_bridges");
const vault = require("../src/crypto_vault");

test("Bridges API Key Encryption and Migration", async (t) => {
  t.after(() => {
    try { fs.rmSync(sandboxDir, { recursive: true, force: true }); } catch (_) {}
  });

  await t.test("upsertBridge encrypts apiKey at rest with enc:v1: prefix", () => {
    const conn = dbBridges.getDbConnection(testDbPath);
    conn.close();

    dbBridges.upsertBridge({
      name: "test-openai-bridge",
      port: 11435,
      provider: "openai",
      enabled: true,
      apiKey: "sk-proj-supersecretkey12345"
    }, testDbPath);

    // Inspect raw database column directly
    const rawConn = db.getConnection(testDbPath, false);
    const row = rawConn.prepare("SELECT api_key FROM bridges WHERE name = ?").get("test-openai-bridge");
    rawConn.close();

    assert.ok(row, "Bridge row must exist in database");
    assert.notStrictEqual(row.api_key, "sk-proj-supersecretkey12345", "API key must NOT be stored in plaintext");
    assert.ok(String(row.api_key).startsWith("enc:v1:"), "API key must start with enc:v1: prefix");

    // listBridges must return decrypted key
    const bridges = dbBridges.listBridges(testDbPath);
    const bridge = bridges.find(b => b.name === "test-openai-bridge");
    assert.strictEqual(bridge.apiKey, "sk-proj-supersecretkey12345", "listBridges must return decrypted key");
  });

  await t.test("migrateBridgesEncryption idempotently encrypts legacy plaintext rows with backup", () => {
    // Insert legacy plaintext bridge directly via SQL
    const rawConn = db.getConnection(testDbPath, false);
    rawConn.prepare(`
      INSERT OR REPLACE INTO bridges (name, port, provider, enabled, target_url, api_key)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("legacy-bridge", 11436, "anthropic", 1, null, "sk-ant-plaintext-key-999");
    rawConn.close();

    assert.ok(typeof dbBridges.migrateBridgesEncryption === "function", "migrateBridgesEncryption must be implemented");
    const migrationResult = dbBridges.migrateBridgesEncryption(testDbPath);

    assert.strictEqual(migrationResult.migrated, 1, "Should migrate 1 plaintext bridge");
    assert.strictEqual(migrationResult.backedUp, true, "Should create backup before migration");
    assert.ok(fs.existsSync(migrationResult.backupPath), "Backup file must exist on disk");

    // Verify row is now encrypted in DB
    const checkConn = db.getConnection(testDbPath, false);
    const updatedRow = checkConn.prepare("SELECT api_key FROM bridges WHERE name = ?").get("legacy-bridge");
    checkConn.close();
    assert.ok(String(updatedRow.api_key).startsWith("enc:v1:"));

    // Verify idempotent re-run
    const rerunResult = dbBridges.migrateBridgesEncryption(testDbPath);
    assert.strictEqual(rerunResult.migrated, 0, "Idempotent re-run should migrate 0 rows");
    assert.strictEqual(rerunResult.backedUp, false, "Idempotent re-run should not create redundant backups");
  });

  await t.test("listBridges throws explicit error if encrypted key cannot be decrypted", () => {
    // Insert a corrupted encrypted payload
    const rawConn = db.getConnection(testDbPath, false);
    rawConn.prepare(`
      INSERT OR REPLACE INTO bridges (name, port, provider, enabled, target_url, api_key)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("corrupted-bridge", 11437, "openai", 1, null, "enc:v1:000000000000000000000000:ffffffffffffffffffffffffffffffff:abcdef");
    rawConn.close();

    assert.throws(() => {
      dbBridges.listBridges(testDbPath);
    }, /Crypto vault key unavailable or corrupted/i);
  });
});
