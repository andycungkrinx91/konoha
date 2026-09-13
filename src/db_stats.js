#!/usr/bin/env node
/**
 * Helper script and in-process module to return database stats as JSON.
 * Replaces db_stats.py with pure Node.js better-sqlite3.
 */


const db = require('./db');

function getDbStats(dbPath = null) {
  const targetPath = dbPath || db.DB_PATH;
  const conn = db.getConnection(targetPath, false);
  try {
    db.setupSchema(conn);
    const totalRow = conn.prepare("SELECT COUNT(*) as cnt FROM skills").get();
    const skillsRow = conn.prepare("SELECT COUNT(*) as cnt FROM skills WHERE type='skill'").get();
    const refsRow = conn.prepare("SELECT COUNT(*) as cnt FROM skills WHERE type='reference'").get();
    const bytesRow = conn.prepare("SELECT SUM(byte_size) as b FROM skills").get();

    return {
      total: totalRow ? totalRow.cnt : 0,
      skills: skillsRow ? skillsRow.cnt : 0,
      refs: refsRow ? refsRow.cnt : 0,
      bytes: bytesRow && bytesRow.b ? bytesRow.b : 0
    };
  } finally {
    conn.close();
  }
}

if (require.main === module) {
  const customDbPath = process.argv[2] || null;
  try {
    const stats = getDbStats(customDbPath);
    console.log(JSON.stringify(stats));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

module.exports = {
  getDbStats
};
