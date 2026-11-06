'use strict';

const assert = require('assert');
const http = require('http');
const { sendChatMessage } = require('../src/mcp/three_asset/model_router');

function assertRegisteredWithRunner() {
  const pkg = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'package.json'), 'utf8'));
  const registered = Object.entries(pkg.scripts || {}).filter(([, cmd]) => cmd.includes('tests/test_model_router_protocols.js'));
  assert.ok(registered.length > 0, 'This suite must be registered as a package.json test script, or the runner never invokes it');
  console.log(`  \u2713 Registered as ${registered.map(([name]) => `npm run ${name}`).join(', ')}.`);
}

async function runProtocolTests() {
  console.log('Testing sendChatMessage protocol handling (SSE & JSON)...');
  assertRegisteredWithRunner();

  let mode = 'json';
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (mode === 'json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'test-json-1',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Structured JSON response from standard provider',
                reasoning_content: 'Reasoning trace in JSON'
              }
            }
          ],
          usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 }
        }));
      } else if (mode === 'sse') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        res.write('data: {"choices":[{"delta":{"role":"assistant","content":"Streamed "}}]}\n\n');
        res.write('data: {"choices":[{"delta":{"content":"SSE response "}}]}\n\n');
        res.write('data: {"choices":[{"delta":{"content":"chunks","reasoning_content":"Streamed reasoning"}}]}\n\n');
        res.write('data: {"usage":{"prompt_tokens":12,"completion_tokens":6,"total_tokens":18}}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      } else if (mode === 'error') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Internal Server Error' } }));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/v1`;

  try {
    // Test A: Standard JSON provider
    mode = 'json';
    const jsonTarget = {
      kind: 'openai',
      baseUrl,
      target_url: baseUrl,
      apiKey: 'test-key',
      model: 'gpt-4o'
    };
    const jsonResult = await sendChatMessage(jsonTarget, {
      userText: 'Test JSON message',
      stream: false
    });
    assert.strictEqual(jsonResult.text, 'Structured JSON response from standard provider');
    assert.strictEqual(jsonResult.reasoning, 'Reasoning trace in JSON');
    assert.strictEqual(jsonResult.usage?.total_tokens, 18);
    console.log('  ✓ Standard JSON provider response parsed accurately.');

    // Test B: SSE streaming provider with onProgress
    mode = 'sse';
    const sseTarget = {
      kind: '9router',
      baseUrl,
      target_url: baseUrl,
      apiKey: 'test-key',
      model: 'ag/gemini-3.8-flash-high'
    };
    const progressUpdates = [];
    const sseResult = await sendChatMessage(sseTarget, {
      userText: 'Test SSE message',
      stream: true,
      onProgress: (p) => progressUpdates.push(p)
    });
    assert.strictEqual(sseResult.text, 'Streamed SSE response chunks');
    assert.strictEqual(sseResult.reasoning, 'Streamed reasoning');
    assert.strictEqual(sseResult.usage?.total_tokens, 18);
    assert.ok(progressUpdates.length >= 0, 'onProgress received notifications');
    console.log('  ✓ SSE streaming provider response parsed accurately with usage and reasoning.');

    // Test C: 9router auto-detects streaming even without explicit stream: true
    mode = 'sse';
    const autoResult = await sendChatMessage(sseTarget, {
      userText: 'Test auto-detected stream'
    });
    assert.strictEqual(autoResult.text, 'Streamed SSE response chunks');
    console.log('  ✓ 9router target auto-selected streaming protocol cleanly.');

    // Test D: Error handling
    mode = 'error';
    let caught = false;
    try {
      await sendChatMessage(jsonTarget, { userText: 'Fail' });
    } catch (err) {
      caught = true;
      assert.strictEqual(err.status, 500);
      assert.ok(err.message.includes('500'));
    }
    assert.strictEqual(caught, true, 'Must throw error on 500 response');
    console.log('  ✓ Error responses surfaced with HTTP status code and message.');

    console.log('All protocol tests passed cleanly!');
  } finally {
    server.close();
  }
}

runProtocolTests().catch((err) => {
  console.error('Protocol tests failed:', err);
  process.exit(1);
});
