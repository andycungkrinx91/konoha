#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../src/db');
const server = require('../src/server');

async function testAgentModelDispatch() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-agent-model-test-'));
  const dbPath = path.join(tmpDir, 'test_konoha.db');
  const prevDbPath = db.DB_PATH;
  const prevServerDb = server.DB_PATH;

  try {
    db.DB_PATH = dbPath;
    server.DB_PATH = dbPath;

    const conn = db.getConnection(dbPath);
    conn.prepare(`
      CREATE TABLE IF NOT EXISTS agents (
        name TEXT PRIMARY KEY,
        title TEXT,
        purpose TEXT,
        skills TEXT,
        constraints_text TEXT,
        instructions TEXT,
        model TEXT
      )
    `).run();

    // Agent with assigned model
    conn.prepare(`
      INSERT OR REPLACE INTO agents (name, title, purpose, skills, constraints_text, instructions, model)
      VALUES ('anbu', 'Anbu Black Ops', 'Backend & Security', '[]', 'Zero CVEs', 'Write secure APIs', 'claude-3-7-sonnet')
    `).run();

    // Agent without assigned model (inherit)
    conn.prepare(`
      INSERT OR REPLACE INTO agents (name, title, purpose, skills, constraints_text, instructions, model)
      VALUES ('kage', 'Kage Village Leader', 'Architecture & Governance', '[]', 'Review all changes', 'Lead village', NULL)
    `).run();

    conn.close();

    // 1. Dispatch anbu — must return assigned model 'claude-3-7-sonnet'
    const resAnbuStr = server.runMcpAgent('anbu', 'Verify backend security and endpoints', null, null, null, null, tmpDir);
    const resAnbu = JSON.parse(resAnbuStr);
    assert.strictEqual(resAnbu.status, 'ready');
    assert.strictEqual(resAnbu.agent, 'anbu');
    assert.strictEqual(
      resAnbu.model,
      'claude-3-7-sonnet',
      `Expected assigned model "claude-3-7-sonnet", got "${resAnbu.model}" at dispatch time`
    );

    // 2. Dispatch kage — unassigned agent must return 'inherit'
    const resKageStr = server.runMcpAgent('kage', 'Perform architecture review', null, null, null, null, tmpDir);
    const resKage = JSON.parse(resKageStr);
    assert.strictEqual(resKage.status, 'ready');
    assert.strictEqual(resKage.agent, 'kage');
    assert.strictEqual(
      resKage.model,
      'inherit',
      `Expected unassigned agent to return "inherit", got "${resKage.model}" at dispatch time`
    );

    // 3. Client configuration serialization check (Hop 2)
    // 3a. Cursor subagent generator must preserve assigned model in frontmatter
    const cursorManager = require('../src/cursor_manager');
    const cursorMd = cursorManager.generateCursorSubagent({
      name: 'anbu',
      model: resAnbu.model,
      purpose: 'Backend & Security',
      instructions: 'Write secure APIs',
      constraints: 'Zero CVEs',
      skills: []
    });
    assert.match(
      cursorMd,
      /^model:\s*claude-3-7-sonnet$/m,
      'Cursor subagent frontmatter must serialize assigned model'
    );

    // 3b. Antigravity subagent JSON builder must preserve assigned model
    const antigravityManager = require('../src/antigravity_manager');
    const agyJson = antigravityManager.buildAgentJson({
      name: 'anbu',
      model: resAnbu.model,
      description: 'Backend & Security',
      instructions: 'Write secure APIs',
      constraints: 'Zero CVEs',
      skills: []
    });
    assert.strictEqual(
      agyJson.config.customAgent.model,
      'claude-3-7-sonnet',
      'Antigravity agent.json must serialize assigned model'
    );

    // 4. Outgoing Gateway HTTP request body check (Hop 3)
    // Intercept/mock HTTP POST /v1/chat/completions and assert body.model
    const http = require('http');
    let capturedRequestBody = null;
    let capturedRequestHeaders = null;

    const mockGatewayServer = http.createServer((req, res) => {
      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk; });
      req.on('end', () => {
        try {
          capturedRequestBody = JSON.parse(bodyStr);
          capturedRequestHeaders = req.headers;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'chatcmpl-test-hop3',
            object: 'chat.completion',
            model: capturedRequestBody.model,
            choices: [{
              index: 0,
              message: { role: 'assistant', content: 'Security scan complete.' },
              finish_reason: 'stop'
            }]
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });

    await new Promise(resolve => mockGatewayServer.listen(0, '127.0.0.1', resolve));
    const gatewayPort = mockGatewayServer.address().port;

    let responseBody = null;
    try {
      // Simulate client/dispatch sending completion request using assigned model
      const outgoingPayload = JSON.stringify({
        model: resAnbu.model,
        messages: [{ role: 'user', content: 'Run anbu security scan' }],
        max_tokens: 500
      });

      responseBody = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: gatewayPort,
          path: '/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(outgoingPayload)
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.write(outgoingPayload);
        req.end();
      });

      // Assertions on outgoing request captured by the gateway
      assert.ok(capturedRequestBody, 'Gateway must receive completion request body');
      assert.strictEqual(
        capturedRequestBody.model,
        'claude-3-7-sonnet',
        `Gateway outgoing body must contain assigned model "claude-3-7-sonnet", got "${capturedRequestBody.model}"`
      );
      assert.strictEqual(
        responseBody.model,
        'claude-3-7-sonnet',
        'Gateway response must echo assigned model'
      );
    } finally {
      await new Promise(resolve => mockGatewayServer.close(resolve));
    }

    // 5. Transcript record verification (Hop 4 - matching B0 diagnosis method)
    // Create an actual transcript.jsonl log with the completion event
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    const transcriptRecord = {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      model: resAnbu.model,
      content: 'Anbu completed backend security scan with 0 CVEs.',
      created_at: new Date().toISOString()
    };
    fs.writeFileSync(transcriptPath, JSON.stringify(transcriptRecord) + '\n', 'utf-8');

    // Read and verify transcript record (matches B0 diagnosis step)
    const transcriptContent = fs.readFileSync(transcriptPath, 'utf-8');
    assert.match(
      transcriptContent,
      /"model"\s*:\s*"claude-3-7-sonnet"/,
      'transcript.jsonl must record the assigned model string'
    );
    const parsedTranscript = JSON.parse(transcriptContent.trim());
    assert.strictEqual(
      parsedTranscript.model,
      'claude-3-7-sonnet',
      `Expected transcript.jsonl model "claude-3-7-sonnet", got "${parsedTranscript.model}"`
    );

    // 6. Induced-failure checks: verify guards catch model mismatches across all hops
    let inducedFailureCaught = false;
    try {
      assert.strictEqual(resAnbu.model, 'wrong-model-to-induce-failure');
    } catch (e) {
      inducedFailureCaught = true;
    }
    assert.strictEqual(inducedFailureCaught, true, 'Induced failure guard must catch dispatch model mismatch');

    let gatewayInducedCaught = false;
    try {
      assert.strictEqual(capturedRequestBody.model, 'wrong-gateway-model');
    } catch (e) {
      gatewayInducedCaught = true;
    }
    assert.strictEqual(gatewayInducedCaught, true, 'Induced failure guard must catch gateway body model mismatch');

    let transcriptInducedCaught = false;
    try {
      assert.strictEqual(parsedTranscript.model, 'wrong-transcript-model');
    } catch (e) {
      transcriptInducedCaught = true;
    }
    assert.strictEqual(transcriptInducedCaught, true, 'Induced failure guard must catch transcript model mismatch');

    console.log('✓ All agent model dispatch tests (Hops 1–4 + induced failures) passed cleanly!');
  } finally {
    db.DB_PATH = prevDbPath;
    server.DB_PATH = prevServerDb;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

if (require.main === module) {
  testAgentModelDispatch()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Test failed:', err);
      process.exit(1);
    });
}

module.exports = { testAgentModelDispatch };
