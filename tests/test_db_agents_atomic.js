'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_test_agents_atomic_'));
const dbPath = path.join(tmpDir, 'agents.db');
const yamlDir = path.join(tmpDir, '.agents');
fs.mkdirSync(yamlDir, { recursive: true });
const yamlPath = path.join(yamlDir, 'agents.yaml');

const origHome = process.env.HOME;
process.env.HOME = tmpDir;

try {
  const db = require('../src/db');
  const dbAgents = require('../src/db_agents');

  // Test 1: importYamlToDb rollback on failure halfway through
  {
    const conn = db.getConnection(dbPath, false);
    db.setupSchema(conn);
    conn.prepare("INSERT INTO agents (name, title) VALUES (?, ?)").run("kage", "Village Leader");
    assert.strictEqual(conn.prepare("SELECT count(*) as c FROM agents").get().c, 1);
    conn.close();

    // Create yaml with multiple agents
    fs.writeFileSync(yamlPath, "- name: chunin\n- name: jonin\n- name: anbu\n");

    // Monkey-patch db.getConnection to throw on the 2nd insert
    const origGetConn = db.getConnection.bind(db);
    let insertCount = 0;
    db.getConnection = function(...args) {
      const c = origGetConn(...args);
      const origPrepare = c.prepare.bind(c);
      c.prepare = function(sql) {
        const stmt = origPrepare(sql);
        if (sql.includes("INSERT OR REPLACE INTO agents")) {
          const origRun = stmt.run.bind(stmt);
          stmt.run = function(...a) {
            insertCount++;
            if (insertCount === 2) {
              throw new Error("Simulated mid-loop failure during yaml import");
            }
            return origRun(...a);
          };
        }
        return stmt;
      };
      return c;
    };

    let caught = false;
    try {
      dbAgents.importYamlToDb(dbPath);
    } catch (err) {
      if (/Simulated mid-loop failure/.test(err.message)) {
        caught = true;
      } else {
        throw err;
      }
    }
    db.getConnection = origGetConn;
    assert.strictEqual(caught, true, 'importYamlToDb must propagate the mid-loop failure');

    // Assert that the pre-existing row 'kage' was preserved due to transaction rollback
    const verifyConn = db.getConnection(dbPath, false);
    const rows = verifyConn.prepare("SELECT name FROM agents").all();
    verifyConn.close();

    assert.strictEqual(
      rows.length,
      1,
      `importYamlToDb must rollback all-or-nothing: expected 1 pre-existing row, got ${rows.length}`
    );
    assert.strictEqual(
      rows[0].name,
      'kage',
      `Pre-existing agent 'kage' must survive intact after rolled-back import`
    );
  }

  // Test 2: autoMigrateYamlToDb rollback on failure halfway through
  {
    const autoDbPath = path.join(tmpDir, 'auto_agents.db');
    const conn = db.getConnection(autoDbPath, false);
    db.setupSchema(conn);

    const origPrepare = conn.prepare.bind(conn);
    let insertCount = 0;
    conn.prepare = function(sql) {
      const stmt = origPrepare(sql);
      if (sql.includes("INSERT OR REPLACE INTO agents")) {
        const origRun = stmt.run.bind(stmt);
        stmt.run = function(...a) {
          insertCount++;
          if (insertCount === 2) {
            throw new Error("Simulated mid-loop failure during auto-migrate");
          }
          return origRun(...a);
        };
      }
      return stmt;
    };

    let caught = false;
    try {
      dbAgents.autoMigrateYamlToDb(conn);
    } catch (err) {
      if (/Simulated mid-loop failure/.test(err.message)) {
        caught = true;
      }
    }

    conn.prepare = origPrepare;
    const rowCount = conn.prepare("SELECT count(*) as c FROM agents").get().c;
    conn.close();

    assert.strictEqual(
      rowCount,
      0,
      `autoMigrateYamlToDb must rollback all-or-nothing: expected 0 rows, got ${rowCount}`
    );
  }

  console.log('test_db_agents_atomic: PASS');
} finally {
  process.env.HOME = origHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
