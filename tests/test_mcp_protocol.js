#!/usr/bin/env node
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');

const serverPath = path.join(__dirname, '..', 'src', 'file_tools_mcp.js');
const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

function request(message) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Timed out waiting for ${message.method}`)), 5000);
    const id = message.id;
    const poll = () => {
      const lines = stdout.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].trim()) continue;
        let parsed;
        try { parsed = JSON.parse(lines[i]); } catch { continue; }
        if (parsed.id === id) {
          clearTimeout(deadline);
          resolve(parsed);
          return;
        }
      }
      setTimeout(poll, 10);
    };
    child.stdin.write(`${JSON.stringify(message)}\n`);
    poll();
  });
}

(async () => {
  const preInit = await request({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.strictEqual(preInit.error.code, -32002);
  const badVersion = await request({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '9999-01-01' } });
  assert.strictEqual(badVersion.error.code, -32602);
  const init = await request({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '2024-11-05', clientInfo: { name: 'protocol-test' } } });
  assert.strictEqual(init.result.protocolVersion, '2024-11-05');
  const listed = await request({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
  assert.ok(listed.result.tools.length >= 30);
  const unknown = await request({ jsonrpc: '2.0', id: 5, method: 'does/not/exist' });
  assert.strictEqual(unknown.error.code, -32601);
  child.stdin.end();
  await new Promise((resolve) => child.once('exit', resolve));
  assert.ok(!stdout.split('\n').some((line) => line.trim() && !JSON.parse(line)));
  assert.ok(!stderr.includes('uncaughtException'));
  console.log(`MCP protocol subprocess passed with ${listed.result.tools.length} tools`);
})().catch((error) => {
  child.kill();
  console.error(error.message);
  process.exitCode = 1;
});
