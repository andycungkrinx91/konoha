'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const { ensureCursorSetup } = require('../src/cursor_manager');
const { ensureOmpSetup, buildOmpMcpServers } = require('../src/omp_manager');
const { FILE_TOOLS_LAUNCHER_JS, SERVER_PATH } = require('../bin/lib/paths');

async function runMcpStdioHandshake(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';
    const responses = [];

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf-8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          responses.push(JSON.parse(line.trim()));
        } catch (e) {
          reject(new Error(`Corrupted JSON-RPC on stdout: ${line} (${e.message})`));
        }
      }
      if (responses.length >= 2) {
        child.kill();
        resolve({ responses, stderr: stderrBuffer });
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString('utf-8');
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (responses.length < 2) {
        reject(new Error(`Process closed before completing handshake (exit ${code}). Stderr: ${stderrBuffer}`));
      }
    });

    const initReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-harness', version: '1.0' }
      }
    }) + '\n';

    const toolsReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    }) + '\n';

    child.stdin.write(initReq);
    setTimeout(() => {
      try {
        child.stdin.write(toolsReq);
      } catch (_) { /* ignore */ }
    }, 100);
  });
}

async function runSuite() {
  process.stdout.write('Running fresh install MCP configuration & handshake verification...\n');

  const testSandbox = path.join('/tmp', `konoha_fresh_test_${Date.now()}`);
  fs.mkdirSync(testSandbox, { recursive: true });

  try {
    const cursorHome = path.join(testSandbox, 'cursor_home');
    const ompHome = path.join(testSandbox, 'omp_home');
    const projectDir = path.join(testSandbox, 'test_project');
    fs.mkdirSync(cursorHome, { recursive: true });
    fs.mkdirSync(ompHome, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    /* Cursor fresh setup verification */
    const cursorRes = ensureCursorSetup({
      home: cursorHome,
      projectRoot: projectDir,
      deployProject: true,
      appendProject: true,
      silent: true
    });
    assert.strictEqual(cursorRes.ok, true, 'Cursor setup should succeed');

    const cursorGlobalMcp = path.join(cursorHome, '.cursor', 'mcp.json');
    assert.strictEqual(fs.existsSync(cursorGlobalMcp), true, 'Cursor global mcp.json must exist');
    const cursorGlobalData = JSON.parse(fs.readFileSync(cursorGlobalMcp, 'utf-8'));

    assert.ok(cursorGlobalData.mcpServers.konoha, 'Cursor global config must contain konoha');
    assert.ok(cursorGlobalData.mcpServers.konoha.args[0], 'Launcher arg must exist');
    assert.strictEqual(
      cursorGlobalData.mcpServers.konoha.args[0].includes('${userHome}'),
      false,
      'Cursor launcher argument must NOT contain literal ${userHome}'
    );
    assert.ok(cursorGlobalData.mcpServers.konoha.env?.PATH, 'Cursor konoha must have env.PATH');

    assert.ok(cursorGlobalData.mcpServers.semble, 'Cursor global config must contain semble');
    assert.ok(cursorGlobalData.mcpServers.semble.command, 'Semble command must exist');
    assert.ok(cursorGlobalData.mcpServers.semble.env?.PATH, 'Cursor semble must have env.PATH');

    const cursorProjMcp = path.join(projectDir, '.cursor', 'mcp.json');
    assert.strictEqual(fs.existsSync(cursorProjMcp), true, 'Cursor project mcp.json must exist');
    const cursorProjData = JSON.parse(fs.readFileSync(cursorProjMcp, 'utf-8'));
    assert.strictEqual(
      cursorProjData.mcpServers.konoha.args[0].includes('${userHome}'),
      false,
      'Cursor project launcher argument must NOT contain literal ${userHome}'
    );

    /* OMP fresh setup verification */
    const ompRes = ensureOmpSetup({
      home: ompHome,
      projectRoot: projectDir,
      deployProject: true,
      silent: true
    });
    assert.strictEqual(ompRes.ok, true, 'OMP setup should succeed');

    const ompGlobalMcp = path.join(ompHome, '.omp', 'agent', 'mcp.json');
    assert.strictEqual(fs.existsSync(ompGlobalMcp), true, 'OMP agent mcp.json must exist');
    const ompGlobalData = JSON.parse(fs.readFileSync(ompGlobalMcp, 'utf-8'));

    assert.ok(ompGlobalData.mcpServers.konoha, 'OMP config must contain konoha');
    const ompLauncherPath = ompGlobalData.mcpServers.konoha.args[0];
    assert.ok(ompLauncherPath, 'OMP launcher arg must exist');
    assert.strictEqual(
      ompLauncherPath.includes('/tmp/konoha_fresh_install_vMZz3M'),
      false,
      'OMP launcher must not point to dead /tmp/ directory'
    );
    assert.ok(ompGlobalData.mcpServers.konoha.env?.PATH, 'OMP konoha must have env.PATH');

    assert.ok(ompGlobalData.mcpServers.semble, 'OMP config must contain semble');
    assert.ok(ompGlobalData.mcpServers.semble.env?.PATH, 'OMP semble must have env.PATH');

    /* Stdio JSON-RPC Handshake verification */
    const targetLauncher = fs.existsSync(FILE_TOOLS_LAUNCHER_JS) ? FILE_TOOLS_LAUNCHER_JS : SERVER_PATH;
    const { responses, stderr } = await runMcpStdioHandshake(
      process.execPath,
      [targetLauncher],
      { ACTIVE_CLIENT: 'omp', KONOHA_CLIENT: 'omp' }
    );

    assert.strictEqual(responses.length >= 2, true, 'Must receive at least 2 JSON-RPC responses');
    const initResp = responses[0];
    assert.strictEqual(initResp.id, 1, 'First response ID must be 1');
    assert.strictEqual(initResp.result?.serverInfo?.name, 'konoha', 'Server name must be konoha');

    const toolsResp = responses[1];
    assert.strictEqual(toolsResp.id, 2, 'Second response ID must be 2');
    assert.ok(Array.isArray(toolsResp.result?.tools), 'Tools must be an array');
    const toolNames = new Set(toolsResp.result.tools.map(t => t.name));
    assert.ok(toolNames.has('read_file_head'), 'Must expose read_file_head');
    assert.ok(toolNames.has('sannin'), 'Must expose sannin');
    assert.ok(toolNames.has('kage'), 'Must expose kage');

    process.stdout.write(`  ✓ Cursor MCP fresh config: PASS (no unexpanded variables, valid PATH)\n`);
    process.stdout.write(`  ✓ OMP MCP fresh config: PASS (valid launcher, schema, valid PATH)\n`);
    process.stdout.write(`  ✓ Stdio JSON-RPC initialize & tools/list: PASS (${toolsResp.result.tools.length} tools discovered)\n`);
    process.stdout.write('ALL FRESH INSTALL MCP CHECKS PASSED.\n');
  } finally {
    try {
      fs.rmSync(testSandbox, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }
}

runSuite().catch((err) => {
  process.stderr.write(`FAIL: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
