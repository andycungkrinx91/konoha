#!/usr/bin/env node
/**
 * Agent and model storage management for Konoha via SQLite (skills.db).
 * Pure Node.js replacement for db_agents.py using better-sqlite3 and yaml_utils.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./db');

let yamlUtils;
try {
  yamlUtils = require('../bin/lib/yaml_utils');
} catch (_) {
  try {
    yamlUtils = require('./yaml_utils');
  } catch (_2) {
    yamlUtils = require(path.join(os.homedir(), '.konoha', 'yaml_utils'));
  }
}
const { parseYaml, stringifyYaml } = yamlUtils;

const AGENTS_YAML_PATH = path.normalize(path.join(os.homedir(), '.agents', 'agents.yaml'));

function getDbConnection(dbPath = null) {
  const target = dbPath !== null ? dbPath : db.DB_PATH;
  const conn = db.getConnection(target, false);
  db.setupSchema(conn);
  return conn;
}

function autoMigrateYamlToDb(conn) {
  const row = conn.prepare("SELECT COUNT(*) as cnt FROM agents").get();
  if (row && row.cnt > 0) {
    return;
  }

  if (fs.existsSync(AGENTS_YAML_PATH)) {
    try {
      const content = fs.readFileSync(AGENTS_YAML_PATH, 'utf-8');
      const data = parseYaml(content);
      if (Array.isArray(data)) {
        const stmt = conn.prepare(`
          INSERT OR REPLACE INTO agents (
            name, icon, title, model, purpose, skills, delegate_when,
            constraints_text, workflow, description, instructions, delegation_keywords,
            enable_mcp_tools
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const a of data) {
          const name = a.name;
          if (!name || name.startsWith('mcp_')) continue;
          const skillsStr = JSON.stringify(a.skills || []);
          stmt.run(
            name,
            a.icon || null,
            a.title || null,
            a.model || null,
            a.purpose || null,
            skillsStr,
            a.delegateWhen || a.delegate_when || null,
            a.constraints || a.constraints_text || null,
            a.workflow || null,
            a.description || null,
            a.instructions || null,
            a.delegationKeywords || a.delegation_keywords || null,
            (a.enable_mcp_tools !== undefined ? a.enable_mcp_tools : true) ? 1 : 0
          );
        }
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
}

function syncDbToYaml(conn) {
  const rows = conn.prepare(`
    SELECT name, icon, title, model, purpose, skills, delegate_when,
           constraints_text, workflow, description, instructions, delegation_keywords,
           enable_mcp_tools
    FROM agents
    WHERE name NOT LIKE 'mcp_%'
  `).all();

  const agentsList = [];
  for (const r of rows) {
    let skills = [];
    try {
      skills = r.skills ? JSON.parse(r.skills) : [];
    } catch (_) {
      skills = [];
    }

    agentsList.push({
      name: r.name,
      icon: r.icon,
      title: r.title,
      model: r.model || undefined,
      purpose: r.purpose,
      skills,
      delegateWhen: r.delegate_when,
      constraints: r.constraints_text,
      workflow: r.workflow,
      description: r.description,
      instructions: r.instructions,
      delegationKeywords: r.delegation_keywords,
      enable_mcp_tools: Boolean(r.enable_mcp_tools)
    });
  }

  const dir = path.dirname(AGENTS_YAML_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(AGENTS_YAML_PATH, stringifyYaml(agentsList), 'utf-8');
}

function listAgents(dbPath = null) {
  const conn = getDbConnection(dbPath);
  try {
    autoMigrateYamlToDb(conn);
    const rows = conn.prepare(`
      SELECT name, icon, title, model, purpose, skills, delegate_when,
             constraints_text, workflow, description, instructions, delegation_keywords,
             enable_mcp_tools
      FROM agents
      WHERE name NOT LIKE 'mcp_%'
    `).all();

    const result = [];
    for (const r of rows) {
      let skills = [];
      try {
        skills = r.skills ? JSON.parse(r.skills) : [];
      } catch (_) {
        skills = [];
      }

      result.push({
        // aislop-ignore-next-line code-quality/duplicate-block (SQL row-mapper/hydration pairs over distinct tables)
        name: r.name,
        icon: r.icon,
        title: r.title,
        model: r.model || undefined,
        purpose: r.purpose,
        skills,
        delegateWhen: r.delegate_when,
        constraints: r.constraints_text,
        workflow: r.workflow,
        description: r.description,
        instructions: r.instructions,
        delegationKeywords: r.delegation_keywords,
        enable_mcp_tools: Boolean(r.enable_mcp_tools)
      });
    }
    return result;
  } finally {
    conn.close();
  }
}

function upsertAgent(agentDict, dbPath = null) {
  const conn = getDbConnection(dbPath);
  try {
    autoMigrateYamlToDb(conn);
    const name = agentDict.name;
    if (!name) {
      throw new Error("Agent name is required");
    }

    const skillsStr = JSON.stringify(agentDict.skills || []);
    conn.prepare(`
      INSERT OR REPLACE INTO agents (
        name, icon, title, model, purpose, skills, delegate_when,
        constraints_text, workflow, description, instructions, delegation_keywords,
        enable_mcp_tools
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      agentDict.icon || null,
      agentDict.title || null,
      agentDict.model || null,
      agentDict.purpose || null,
      skillsStr,
      agentDict.delegateWhen || agentDict.delegate_when || null,
      agentDict.constraints || agentDict.constraints_text || null,
      agentDict.workflow || null,
      agentDict.description || null,
      agentDict.instructions || null,
      agentDict.delegationKeywords || agentDict.delegation_keywords || null,
      (agentDict.enable_mcp_tools !== undefined ? agentDict.enable_mcp_tools : true) ? 1 : 0
    );
    syncDbToYaml(conn);
  } finally {
    conn.close();
  }
}

function deleteAgent(name, dbPath = null) {
  const conn = getDbConnection(dbPath);
  try {
    autoMigrateYamlToDb(conn);
    conn.prepare("DELETE FROM agents WHERE name = ?").run(name);
    syncDbToYaml(conn);
  } finally {
    conn.close();
  }
}

function importYamlToDb(dbPath = null) {
  const conn = getDbConnection(dbPath);
  try {
    let data = null;
    if (fs.existsSync(AGENTS_YAML_PATH)) {
      try {
        const content = fs.readFileSync(AGENTS_YAML_PATH, 'utf-8');
        const payload = parseYaml(content);
        if (Array.isArray(payload) && payload.length > 0) {
          data = payload;
        }
      } catch (err) {
        process.stderr.write(`Error: Failed to read agents.yaml: ${err.message}\n`);
      }
    }

    if (data !== null) {
      conn.prepare("DELETE FROM agents").run();
      const stmt = conn.prepare(`
        INSERT OR REPLACE INTO agents (
          name, icon, title, model, purpose, skills, delegate_when,
          constraints_text, workflow, description, instructions, delegation_keywords,
          enable_mcp_tools
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const a of data) {
        const name = a.name;
        if (!name) continue;
        // aislop-ignore-next-line code-quality/duplicate-block (SQL row-mapper/hydration pairs over distinct tables)
        const skillsStr = JSON.stringify(a.skills || []);
        stmt.run(
          name,
          a.icon || null,
          a.title || null,
          a.model || null,
          a.purpose || null,
          skillsStr,
          a.delegateWhen || a.delegate_when || null,
          a.constraints || a.constraints_text || null,
          a.workflow || null,
          a.description || null,
          a.instructions || null,
          a.delegationKeywords || a.delegation_keywords || null,
          (a.enable_mcp_tools !== undefined ? a.enable_mcp_tools : true) ? 1 : 0
        );
      }
    }
  } finally {
    conn.close();
  }
}

function bulkImportAgents(agentsList, dbPath = null) {
  const conn = getDbConnection(dbPath);
  try {
    const stmt = conn.prepare(`
      INSERT OR REPLACE INTO agents (
        name, icon, title, model, purpose, skills, delegate_when,
        constraints_text, workflow, description, instructions, delegation_keywords,
        enable_mcp_tools
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = conn.transaction((list) => {
      for (const a of list) {
        // aislop-ignore-next-line code-quality/duplicate-block (SQL row-mapper/hydration pairs over distinct tables)
        const name = a.name;
        if (!name || name.startsWith('mcp_')) continue;
        const skillsStr = JSON.stringify(a.skills || []);
        stmt.run(
          name,
          a.icon || null,
          a.title || null,
          a.model || null,
          a.purpose || null,
          skillsStr,
          a.delegateWhen || a.delegate_when || null,
          a.constraints || a.constraints_text || null,
          a.workflow || null,
          a.description || null,
          a.instructions || null,
          a.delegationKeywords || a.delegation_keywords || null,
          (a.enable_mcp_tools !== undefined ? a.enable_mcp_tools : true) ? 1 : 0
        );
      }
    });

    insertMany(agentsList);
    syncDbToYaml(conn);
  } finally {
    conn.close();
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log(JSON.stringify(listAgents()));
    return;
  }

  const cmd = args[0];
  if (cmd === '--list' || cmd === 'list') {
    console.log(JSON.stringify(listAgents()));
  } else if (cmd === '--list-compact' || cmd === 'list-compact') {
    const agents = listAgents();
    for (const a of agents) {
      for (const k of ["instructions", "constraints", "workflow", "description", "constraints_text"]) {
        if (a[k]) {
          a[k] = "";
        }
      }
    }
    console.log(JSON.stringify(agents));
  } else if (cmd === '--bulk-import') {
    if (args.length < 2) process.exit(1);
    const agents = JSON.parse(args[1]);
    if (Array.isArray(agents)) {
      bulkImportAgents(agents);
      console.log(JSON.stringify({ ok: true }));
    } else {
      process.exit(1);
    }
  } else if (cmd === '--upsert' || cmd === 'upsert') {
    if (args.length < 2) process.exit(1);
    const a = JSON.parse(args[1]);
    upsertAgent(a);
    console.log(JSON.stringify({ ok: true }));
  } else if (cmd === '--delete' || cmd === 'delete') {
    if (args.length < 2) process.exit(1);
    deleteAgent(args[1]);
    console.log(JSON.stringify({ ok: true }));
  } else if (cmd === '--sync' || cmd === 'sync') {
    const conn = getDbConnection();
    try {
      autoMigrateYamlToDb(conn);
      syncDbToYaml(conn);
    } finally {
      conn.close();
    }
    console.log(JSON.stringify({ ok: true }));
  } else if (cmd === '--import' || cmd === 'import') {
    importYamlToDb();
    console.log(JSON.stringify({ ok: true }));
  } else {
    console.log(JSON.stringify(listAgents()));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  listAgents,
  list_agents: listAgents,
  upsertAgent,
  upsert_agent: upsertAgent,
  deleteAgent,
  delete_agent: deleteAgent,
  importYamlToDb,
  import_yaml_to_db: importYamlToDb,
  bulkImportAgents,
  bulk_import_agents: bulkImportAgents,
  autoMigrateYamlToDb,
  auto_migrate_yaml_to_db: autoMigrateYamlToDb,
  syncDbToYaml,
  sync_db_to_yaml: syncDbToYaml,
  getDbConnection,
  get_db_connection: getDbConnection
};
