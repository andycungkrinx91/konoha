#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const db = require('../src/db');
const agentStats = require('../src/agent_stats');

const SERVER = path.join(os.homedir(), '.konoha', 'server.js');
const DB = path.join(os.homedir(), '.konoha', 'konoha.db');
const BRAIN_CLI = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
const BRAIN_IDE = path.join(os.homedir(), '.gemini', 'antigravity-ide', 'brain');

const REGISTERED = new Set(['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin']);

const AGENTS = [
  ['genin', 'You are a Genin scout. Log: "[🍃 Genin] active".', '[🍃 Genin] active. Testing.'],
  ['kage', 'You are the Kage. Log: "[🌀 Kage] active".', '[🌀 Kage] active. Testing.'],
  ['chunin', 'You are the Chunin intel gatherer. Log: "[📜 Chunin] active".', '[📜 Chunin] active. Testing.'],
  ['jonin', 'You are the Jonin builder. Log: "[🛡️ Jonin] active".', '[🛡️ Jonin] active. Testing.'],
  ['anbu', 'You are the Anbu agent. Log: "[👥 Anbu] active".', '[👥 Anbu] active. Testing.'],
  ['tokubetsu-jonin', 'You are the Tokubetsu Jonin scribe. Log: "[🎯 Tokubetsu-Jonin] active".', '[🎯 Tokubetsu-Jonin] active. Testing.']
];

function loadStats() {
  return agentStats.computeStats(DB);
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

function mcpFindSkillNoAgent(keyword, convId = null) {
  const reqInit = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', clientInfo: { name: 'antigravity' } }
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
  if (convId) {
    env.ANTIGRAVITY_CONVERSATION_ID = convId;
  } else {
    delete env.ANTIGRAVITY_CONVERSATION_ID;
  }

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

function setupBrain(brainRoot, promptText, plannerLine, mtimeOffset = 3600) {
  const convId = `konoha-test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const convDir = path.join(brainRoot, convId);
  const logs = path.join(convDir, '.system_generated', 'logs');
  fs.mkdirSync(logs, { recursive: true });

  const promptPath = path.join(convDir, 'prompt.md');
  const transcriptPath = path.join(logs, 'transcript.jsonl');

  fs.writeFileSync(promptPath, promptText, 'utf8');
  fs.writeFileSync(transcriptPath, JSON.stringify({ type: 'PLANNER_RESPONSE', content: plannerLine }) + '\n', 'utf8');

  const now = (Date.now() / 1000) + mtimeOffset;
  try {
    fs.utimesSync(promptPath, now, now);
    fs.utimesSync(transcriptPath, now, now);
  } catch (_) {}

  return convDir;
}

function main() {
  const results = [];

  for (let idx = 0; idx < AGENTS.length; idx++) {
    const [agent, prompt, planner] = AGENTS[idx];
    const before = (loadStats()[agent] || {}).today || 0;
    const conv = setupBrain(BRAIN_CLI, prompt, planner, 7200 + idx * 120);
    try {
      mcpFindSkillNoAgent('jonin-skill', path.basename(conv));
      const logged = lastLoggedAgent();
      const after = (loadStats()[agent] || {}).today || 0;
      const ok = (logged === agent && after >= before + 1);
      results.push([agent, ok, logged, before, after]);
      console.log(`[${ok ? 'PASS' : 'FAIL'}] ${agent}: logged=${logged} today ${before}->${after}`);
    } finally {
      fs.rmSync(conv, { recursive: true, force: true });
    }
  }

  const beforeDirect = directToday(loadStats());
  const conv = setupBrain(
    BRAIN_IDE,
    '<USER_REQUEST>\nTest orchestrator attribution\n',
    '[🌀 Orchestrator] active. Testing orchestrator.',
    7200 + AGENTS.length * 120
  );
  try {
    mcpFindSkillNoAgent('jonin-skill', path.basename(conv));
    const logged = lastLoggedAgent();
    const afterDirect = directToday(loadStats());
    const ok = (logged === 'orchestrator' && afterDirect >= beforeDirect + 1);
    results.push(['orchestrator', ok, logged, beforeDirect, afterDirect]);
    console.log(`[${ok ? 'PASS' : 'FAIL'}] orchestrator: logged=${logged} direct today ${beforeDirect}->${afterDirect}`);
  } finally {
    fs.rmSync(conv, { recursive: true, force: true });
  }

  const failed = results.filter(r => !r[1]);
  console.log(`\nPassed ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) process.exit(1);
}

main();
