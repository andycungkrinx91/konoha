'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const { FILE_TOOLS_LAUNCHER_JS, SERVER_PATH } = require('../bin/lib/paths');

async function testProtocolIntegrity() {
  process.stdout.write('Testing stdio MCP protocol purity and tool execution...\n');

  const launcher = fs.existsSync(FILE_TOOLS_LAUNCHER_JS) ? FILE_TOOLS_LAUNCHER_JS : SERVER_PATH;

  const child = spawn(process.execPath, [launcher], {
    env: {
      ...process.env,
      ACTIVE_CLIENT: 'omp',
      KONOHA_CLIENT: 'omp'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdoutBuffer = '';
  let stderrBuffer = '';
  const responses = [];

  const donePromise = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf-8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line.trim());
          responses.push(parsed);
        } catch (e) {
          reject(new Error(`Corrupted JSON-RPC line on stdout: ${line} (${e.message})`));
        }
      }

      if (responses.length >= 3) {
        child.kill();
        resolve({ responses, stderr: stderrBuffer });
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString('utf-8');
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (responses.length < 3) {
        reject(new Error(`Process terminated prematurely (code ${code}). Stderr: ${stderrBuffer}`));
      }
    });
  });

  /* Initialize */
  child.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 101,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'omp-tester', version: '2.2.18' }
    }
  }) + '\n');

  /* tools/list */
  setTimeout(() => {
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 102,
      method: 'tools/list'
    }) + '\n');
  }, 50);

  /* tools/call read_file_head */
  setTimeout(() => {
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 103,
      method: 'tools/call',
      params: {
        name: 'read_file_head',
        arguments: {
          file_path: 'package.json',
          max_lines: 5
        }
      }
    }) + '\n');
  }, 100);

  const { responses: resps } = await donePromise;

  assert.strictEqual(resps.length >= 3, true, 'Expected at least 3 responses');

  const r1 = resps.find(r => r.id === 101);
  assert.ok(r1 && r1.result, 'Init response must exist');
  assert.strictEqual(r1.result.serverInfo.name, 'konoha', 'Server name must be konoha');

  const r2 = resps.find(r => r.id === 102);
  assert.ok(r2 && r2.result && Array.isArray(r2.result.tools), 'tools/list must return array');
  assert.strictEqual(r2.result.tools.length >= 20, true, 'Should expose all canonical tools');

  const r3 = resps.find(r => r.id === 103);
  assert.ok(r3 && r3.result, 'tools/call must return result');
  assert.strictEqual(Boolean(r3.error), false, 'tools/call must not error');

  process.stdout.write('  ✓ Protocol handshake: OK\n');
  process.stdout.write(`  ✓ Tool discovery: OK (${r2.result.tools.length} canonical tools)\n`);
  process.stdout.write('  ✓ Tool invocation: OK (read_file_head passed with clean JSON-RPC)\n');
  process.stdout.write('ALL PROTOCOL INTEGRITY CHECKS PASSED.\n');
}

testProtocolIntegrity().catch((err) => {
  process.stderr.write(`FAIL: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
