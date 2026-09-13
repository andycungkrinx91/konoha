#!/usr/bin/env node
/**
 * Helper script to query agent tool call statistics as JSON.
 * Pure Node.js replacement for src/agent_stats.py.
 */
const fs = require('fs');


const { getDb, DB_PATH } = require('./db');

const dbPath = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : (process.env.KONOHA_DB_PATH || DB_PATH);

// Check for prune command
if (process.argv.includes('--prune')) {
  const pruneIdx = process.argv.indexOf('--prune');
  const agentToPrune = process.argv[pruneIdx + 1];
  try {
    if (!fs.existsSync(dbPath)) {
      console.log(JSON.stringify({ error: `Database not found at ${dbPath}` }));
      process.exit(1);
    }
    const conn = getDb(dbPath);
    const info = conn.prepare("DELETE FROM tool_calls WHERE LOWER(agent) = LOWER(?)").run(agentToPrune);
    console.log(JSON.stringify({ success: true, deleted_count: info.changes }));
    process.exit(0);
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}

function getAgentStats(targetDbPath = dbPath) {
  if (!fs.existsSync(targetDbPath)) {
    return { error: `Database not found at ${targetDbPath}` };
  }
  const conn = getDb(targetDbPath);
  try {
    conn.exec(`
      CREATE TABLE IF NOT EXISTS tool_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        tool TEXT NOT NULL,
        query TEXT,
        returned_bytes INTEGER,
        total_library_bytes INTEGER,
        bytes_saved INTEGER,
        tokens_saved INTEGER,
        agent TEXT,
        client TEXT
      );
    `);

    const query = `
      SELECT
        LOWER(COALESCE(agent, '')) as agent_key,
        COUNT(CASE WHEN date(timestamp, 'localtime') >= date('now', 'localtime') THEN 1 END) as today,
        COUNT(CASE WHEN date(timestamp, 'localtime') >= date('now', '-7 days', 'localtime') THEN 1 END) as last7days,
        COUNT(*) as alltime
      FROM tool_calls
      GROUP BY agent_key
    `;

    const rows = conn.prepare(query).all();
    const results = {};
    for (const row of rows) {
      const agentName = row.agent_key ? row.agent_key : "(direct)";
      results[agentName] = {
        today: row.today,
        last7days: row.last7days,
        alltime: row.alltime
      };
    }
    return results;
  } catch (e) {
    return { error: e.message };
  }
}

function pruneAgentStats(agentToPrune, targetDbPath = dbPath) {
  try {
    if (!fs.existsSync(targetDbPath)) {
      return { error: `Database not found at ${targetDbPath}` };
    }
    const conn = getDb(targetDbPath);
    const info = conn.prepare("DELETE FROM tool_calls WHERE LOWER(agent) = LOWER(?)").run(agentToPrune);
    return { success: true, deleted_count: info.changes };
  } catch (e) {
    return { error: e.message };
  }
}

if (require.main === module) {
  const stats = getAgentStats();
  console.log(JSON.stringify(stats));
  if (stats.error) process.exit(1);
}

module.exports = {
  getAgentStats,
  computeStats: getAgentStats,
  pruneAgentStats
};
