/**
 * Seed the default subagent delegation keywords + skill bindings into the
 * ISOLATED test DB, and copy the primary skill rows (content) from the
 * production database so agent-instruction rendering works hermetically.
 *
 * Sannin keyword-routing (`routeByKeywordsWithPrompt`) reads
 * `agents.delegation_keywords`, and the delegation instructions embed each
 * agent's skills from `agents.skills` + the `skills` table. Require
 * `isolate_db` BEFORE this helper.
 */
'use strict';

require('./isolate_db');

const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const { getConnection } = require('../../src/db');

const DEFAULT_AGENT_KEYWORDS = [
  ['sannin', 'Triage, route tasks, select subagent, orchestrate agents', ['sannin-skill']],
  ['genin', 'Understand codebase, trace flows, map dependencies, explore, code path, call graph, usage', ['genin-skill']],
  ['kage', 'Architecture decisions, security review, deep analysis, security audit, architecture, scalability, risk', ['kage-skill']],
  ['chunin', 'External research, documentation, best practices, web search, evidence, synthesis, research, citation, compliance', ['chunin-skill']],
  ['jonin', 'UI design, frontend components, styling, SvelteKit, Next.js, Tailwind, landing page, responsive, component, page, dashboard', ['jonin-skill']],
  ['anbu', 'Backend logic, bug fixing, DevOps, infrastructure, CI/CD, debugging, API endpoint, middleware, deploy, docker, kubernetes', ['anbu-skill']],
  ['tokubetsu-jonin', 'Technical writing, README, API docs, runbooks, onboarding, write, readme, api spec, technical guide, prd', ['tokubetsu-jonin-skill']],
];

function seedAgents() {
  const conn = getConnection();
  const prodDbPath = path.join(os.homedir(), '.konoha', 'konoha.db');
  let prodRows = [];
  try {
    const prod = new Database(prodDbPath, { readonly: true });
    const names = DEFAULT_AGENT_KEYWORDS.flatMap(([, , skills]) => skills);
    const placeholders = names.map(() => '?').join(',');
    prodRows = prod.prepare(`SELECT * FROM skills WHERE name IN (${placeholders})`).all(...names);
    prod.close();
  } catch (e) {
    process.stderr.write(`[seed_agents] production skill copy skipped: ${e.message}\n`);
  }

  try {
    const tx = conn.transaction(() => {
      const upsertAgent = conn.prepare(`
        INSERT INTO agents (name, delegation_keywords, skills)
        VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          delegation_keywords = excluded.delegation_keywords,
          skills = excluded.skills
      `);
      for (const [name, keywords, skills] of DEFAULT_AGENT_KEYWORDS) {
        upsertAgent.run(name, keywords, JSON.stringify(skills));
      }

      if (prodRows.length > 0) {
        const insertSkill = conn.prepare(`
          INSERT OR REPLACE INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count)
          VALUES (@name, @skill_name, @type, @tags, @content, @file_path, @byte_size, @line_count)
        `);
        for (const row of prodRows) insertSkill.run(row);
      }
    });
    tx();
  } finally {
    conn.close();
  }
}

seedAgents();

module.exports = { seedAgents, DEFAULT_AGENT_KEYWORDS };
