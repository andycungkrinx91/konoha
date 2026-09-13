#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
require('./helpers/isolate_db');
const db = require('../src/db');
const agentStats = require('../src/agent_stats');

const SERVER = path.join(os.homedir(), '.konoha', 'server.js');
const DB = process.env.KONOHA_DB_PATH || path.join(os.homedir(), '.konoha', 'konoha.db');
const PROJECTS = path.join(os.homedir(), '.cursor', 'projects');

const REGISTERED = new Set(['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin']);

const AGENTS = [
  ['genin', '[🍃 Genin] active. Calling konoha.find_skill(...)', null],
  ['kage', '[🌀 Kage] active. Calling konoha.find_skill(...)', null],
  ['chunin', '[📜 Chunin] active. Calling konoha.find_skill(...)', null],
  ['jonin', '[🛡️ Jonin] active. Calling konoha.find_skill(...)', null],
  ['anbu', '[👥 Anbu] active. Calling konoha.find_skill(...)', null],
  ['tokubetsu-jonin', '[🎯 Tokubetsu-Jonin] active. Calling konoha.find_skill(...)', null]
];

function loadStats() {
  return agentStats.getAgentStats(DB);
}

function directToday(stats) {
  let sum = 0;
  for (const [k, v] of Object.entries(stats)) {
    if (!REGISTERED.has(k)) {
      sum += (v.today || 0);
    }
  }
  return sum;
}

function lastLoggedAgent() {
  const conn = db.getConnection(DB);
  try {
    const row = conn.prepare("SELECT agent FROM tool_calls WHERE tool = 'find_skill' ORDER BY id DESC LIMIT 1").get();
    return (row && row.agent) ? String(row.agent).toLowerCase() : null;
  } finally {
    conn.close();
  }
}

function mcpFindSkillNoAgent(keyword) {
  const reqInit = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test-client' } }
  };
  const reqCall = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'find_skill',
      arguments: { keyword, limit: 1, compact: true }
    }
  };

  const env = Object.assign({}, process.env);
  delete env.ANTIGRAVITY_CONVERSATION_ID;
  env.ACTIVE_CLIENT = 'cursor';
  env.KONOHA_DB_PATH = DB;

  const payload = JSON.stringify(reqInit) + '\n' + JSON.stringify(reqCall) + '\n';
  const proc = spawnSync(process.execPath, [SERVER], {
    input: payload,
    env,
    encoding: 'utf8',
    timeout: 30000
  });

  if (proc.status !== 0) {
    throw new Error(proc.stderr || proc.stdout || `Server exited with ${proc.status}`);
  }
}

function cursorTranscriptLine(text, taskSubagent = null) {
  const blocks = [{ type: 'text', text }];
  if (taskSubagent) {
    blocks.push({
      type: 'tool_use',
      name: 'Task',
      input: { subagent_type: taskSubagent, prompt: 'test' }
    });
  }
  return JSON.stringify({ role: 'assistant', message: { content: blocks } });
}

function setupCursorSession(text, mtimeOffset = 7200) {
  const projectSlug = 'konoha-cursor-attribution-test';
  const convId = `test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const convDir = path.join(PROJECTS, projectSlug, 'agent-transcripts', convId);
  fs.mkdirSync(convDir, { recursive: true });
  const transcriptPath = path.join(convDir, `${convId}.jsonl`);
  fs.writeFileSync(transcriptPath, cursorTranscriptLine(text) + '\n', 'utf8');

  const now = (Date.now() / 1000) + mtimeOffset;
  try {
    fs.utimesSync(transcriptPath, now, now);
  } catch (_) {}

  return [convDir, transcriptPath];
}

function main() {
  const projectSlug = 'konoha-cursor-attribution-test';
  const results = [];

  for (let idx = 0; idx < AGENTS.length; idx++) {
    const [agent, text] = AGENTS[idx];
    const before = (loadStats()[agent] || {}).today || 0;
    const [convDir] = setupCursorSession(text, 7200 + idx * 120);
    try {
      mcpFindSkillNoAgent('jonin-skill');
      const logged = lastLoggedAgent();
      const after = (loadStats()[agent] || {}).today || 0;
      const ok = (logged === agent && after === before + 1);
      results.push([agent, ok, logged, before, after]);
      console.log(`[${ok ? 'PASS' : 'FAIL'}] ${agent}: logged=${logged} today ${before}->${after}`);
    } finally {
      fs.rmSync(path.join(PROJECTS, projectSlug), { recursive: true, force: true });
    }
  }

  const beforeDirect = directToday(loadStats());
  const [convDir] = setupCursorSession(
    '[Konoha] orchestrator active. Calling konoha.find_skill(...)',
    7200 + AGENTS.length * 120
  );
  try {
    mcpFindSkillNoAgent('jonin-skill');
    const logged = lastLoggedAgent();
    const afterDirect = directToday(loadStats());
    const ok = (logged === 'orchestrator' && afterDirect >= beforeDirect + 1);
    results.push(['orchestrator', ok, logged, beforeDirect, afterDirect]);
    console.log(`[${ok ? 'PASS' : 'FAIL'}] orchestrator: logged=${logged} direct today ${beforeDirect}->${afterDirect}`);
  } finally {
    fs.rmSync(path.join(PROJECTS, projectSlug), { recursive: true, force: true });
  }

  // Task-tool delegation path
  const beforeAnbu = (loadStats().anbu || {}).today || 0;
  const [convDirTask, transcriptPath] = setupCursorSession(
    '[Konoha] orchestrator active. Delegating to anbu.',
    7200 + (AGENTS.length + 1) * 120
  );
  fs.appendFileSync(transcriptPath, cursorTranscriptLine('Delegating.', 'anbu') + '\n', 'utf8');
  const now = (Date.now() / 1000) + 7200 + (AGENTS.length + 1) * 120;
  try {
    fs.utimesSync(transcriptPath, now, now);
  } catch (_) {}

  try {
    mcpFindSkillNoAgent('jonin-skill');
    const logged = lastLoggedAgent();
    const afterAnbu = (loadStats().anbu || {}).today || 0;
    const ok = (logged === 'anbu' && afterAnbu >= beforeAnbu + 1);
    results.push(['task-anbu', ok, logged, beforeAnbu, afterAnbu]);
    console.log(`[${ok ? 'PASS' : 'FAIL'}] task-delegation anbu: logged=${logged} today ${beforeAnbu}->${afterAnbu}`);
  } finally {
    fs.rmSync(path.join(PROJECTS, projectSlug), { recursive: true, force: true });
  }

  const failed = results.filter(r => !r[1]);
  console.log(`\nPassed ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) process.exit(1);
}

main();
