#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');
// Sannin keyword-routing reads agents.delegation_keywords — seed the defaults.
require('./helpers/seed_agents');

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

const SERVER_PATH = path.join(__dirname, '..', 'src', 'server.js');

class McpClient {
  constructor(serverPath) {
    this.serverPath = serverPath;
    this.proc = null;
    this.rl = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  async start() {
    this.proc = spawn(process.execPath, [this.serverPath], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    this.rl = readline.createInterface({
      input: this.proc.stdout,
      terminal: false
    });

    this.rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          resolve(msg);
        }
      } catch (_) {}
    });

    const initResp = await this.send({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', clientInfo: { name: 'delegation-chain-test' } }
    });
    if (!initResp.result) {
      throw new Error(`Init failed: ${JSON.stringify(initResp)}`);
    }
  }

  send(msg) {
    return new Promise((resolve, reject) => {
      const id = msg.id !== undefined ? msg.id : this.nextId++;
      msg.id = id;
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(msg) + '\n');
    });
  }

  async callTool(name, args) {
    const resp = await this.send({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name, arguments: args }
    });
    if (resp.error) {
      return [{ status: 'transport_error', message: resp.error.message }, true];
    }
    const text = resp.result.content[0].text;
    try {
      return [JSON.parse(text), false];
    } catch (_) {
      return [{ raw: text }, false];
    }
  }

  stop() {
    if (this.proc) {
      this.proc.kill();
    }
  }
}

async function run() {
  const client = new McpClient(SERVER_PATH);
  await client.start();

  try {
    console.log('Running test_delegation_chain tests...');

    // 1. Sannin no prompt returns error
    const td1 = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
    try {
      const [resp, err] = await client.callTool('sannin', { task_dir: td1 });
      assert.ok(err || resp.status === 'error');
    } finally {
      fs.rmSync(td1, { recursive: true, force: true });
    }

    // 2. Route jonin frontend
    const td2 = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
    try {
      fs.writeFileSync(path.join(td2, 'prompt.md'), 'Build a responsive SvelteKit dashboard page with Tailwind CSS');
      const [resp] = await client.callTool('sannin', { task_dir: td2 });
      assert.strictEqual(resp.selected_agent, 'jonin');
    } finally {
      fs.rmSync(td2, { recursive: true, force: true });
    }

    // 3. Route anbu backend
    const td3 = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
    try {
      fs.writeFileSync(path.join(td3, 'prompt.md'), 'Debug the API endpoint middleware error handling');
      const [resp] = await client.callTool('sannin', { task_dir: td3 });
      assert.strictEqual(resp.selected_agent, 'anbu');
    } finally {
      fs.rmSync(td3, { recursive: true, force: true });
    }

    // 4. Route chunin research
    const td4 = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
    try {
      fs.writeFileSync(path.join(td4, 'prompt.md'), 'Research the latest web search best practices for evidence synthesis');
      const [resp] = await client.callTool('sannin', { task_dir: td4 });
      assert.strictEqual(resp.selected_agent, 'chunin');
    } finally {
      fs.rmSync(td4, { recursive: true, force: true });
    }

    // 5. Route kage architecture
    const td5 = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
    try {
      fs.writeFileSync(path.join(td5, 'prompt.md'), 'Security audit and architecture risk assessment of the auth system');
      const [resp] = await client.callTool('sannin', { task_dir: td5 });
      assert.strictEqual(resp.selected_agent, 'kage');
    } finally {
      fs.rmSync(td5, { recursive: true, force: true });
    }

    // 6. Route default kage no keywords
    const td6 = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
    try {
      fs.writeFileSync(path.join(td6, 'prompt.md'), 'do something complicated with no keywords');
      const [resp] = await client.callTool('sannin', { task_dir: td6 });
      assert.strictEqual(resp.selected_agent, 'kage');
    } finally {
      fs.rmSync(td6, { recursive: true, force: true });
    }

    // 7. Route tokubetsu_jonin docs
    const td7 = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
    try {
      fs.writeFileSync(path.join(td7, 'prompt.md'), 'Write a PRD and technical documentation for the new feature');
      const [resp] = await client.callTool('sannin', { task_dir: td7 });
      assert.strictEqual(resp.selected_agent, 'tokubetsu_jonin');
    } finally {
      fs.rmSync(td7, { recursive: true, force: true });
    }

    // 8. Route genin explore
    const td8 = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
    try {
      fs.writeFileSync(path.join(td8, 'prompt.md'), 'explore the codebase trace the auth flow find call graph');
      const [resp] = await client.callTool('sannin', { task_dir: td8 });
      assert.strictEqual(resp.selected_agent, 'genin');
    } finally {
      fs.rmSync(td8, { recursive: true, force: true });
    }

    // 9. Agent requires delegate.md
    const td9 = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
    try {
      const [resp, err] = await client.callTool('kage', { task_dir: td9 });
      assert.ok(err || resp.status === 'error');
    } finally {
      fs.rmSync(td9, { recursive: true, force: true });
    }

    // 10. Agent loads persona from db
    const td10 = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
    try {
      fs.writeFileSync(path.join(td10, 'delegate.md'), '---\ntitle: Test\n---\nAnalyze database migration.');
      const [resp, err] = await client.callTool('kage', { task_dir: td10 });
      assert.strictEqual(err, false);
      assert.strictEqual(resp.status, 'ready');
      assert.ok(resp.agent.includes('kage'));
      const instructions = resp.instructions || '';
      assert.ok(instructions.includes('Instructions:'));
      assert.ok(instructions.includes('Village Leader'));
      assert.strictEqual(instructions.includes('.cursor/skills'), false);
      assert.strictEqual(instructions.includes('.claude/skills'), false);
    } finally {
      fs.rmSync(td10, { recursive: true, force: true });
    }

    // 11. Anbu loads skills from sqlite
    const td11 = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
    try {
      fs.writeFileSync(path.join(td11, 'delegate.md'), 'Implement database migration.');
      const [resp, err] = await client.callTool('anbu', { task_dir: td11 });
      assert.strictEqual(err, false);
      assert.strictEqual(resp.status, 'ready');
      const instructions = resp.instructions || '';
      assert.ok(instructions.includes('Available Skills') || instructions.includes('anbu-skill'));
      assert.strictEqual(instructions.includes('.cursor/skills'), false);
      assert.strictEqual(instructions.includes('.claude/skills'), false);
    } finally {
      fs.rmSync(td11, { recursive: true, force: true });
    }

    // 12. Agent returns long enriched instructions
    const td12 = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
    try {
      fs.writeFileSync(path.join(td12, 'delegate.md'), 'Fix the login endpoint bug.');
      const [resp] = await client.callTool('anbu', { task_dir: td12 });
      assert.ok((resp.instructions || '').length > 500);
    } finally {
      fs.rmSync(td12, { recursive: true, force: true });
    }

    // 13. Genin reads from skills db
    const td13 = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
    try {
      fs.writeFileSync(path.join(td13, 'delegate.md'), 'Explore the auth flow codebase.');
      const [resp, err] = await client.callTool('genin', { task_dir: td13 });
      assert.strictEqual(err, false);
      const instructions = resp.instructions || '';
      assert.strictEqual(instructions.includes('.cursor/skills'), false);
      assert.strictEqual(instructions.includes('.claude/skills'), false);
    } finally {
      fs.rmSync(td13, { recursive: true, force: true });
    }

    // 14. Sannin result phase
    const td14 = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
    try {
      fs.writeFileSync(path.join(td14, 'prompt.md'), 'Build a feature');
      fs.writeFileSync(path.join(td14, 'result.md'), 'Task completed successfully');
      const [resp] = await client.callTool('sannin', { task_dir: td14 });
      assert.strictEqual(resp.status, 'completed');
      assert.strictEqual(resp.phase, 'result');
      assert.ok(resp.result.includes('Task completed successfully'));
    } finally {
      fs.rmSync(td14, { recursive: true, force: true });
    }

    console.log('✓ All delegation chain tests passed cleanly!');
  } finally {
    client.stop();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
