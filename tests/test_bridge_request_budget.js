'use strict';

/**
 * Tests for Request Budget & Context Compaction Guardrails
 * Verifies pre-flight token estimation, Gemini ceiling enforcement,
 * compactContext preservation, <50,000 token bounding, and handler forwarding.
 */

const assert = require('assert');
const http = require('http');
const { EventEmitter } = require('events');
const {
  LIMITS,
  estimateTokens,
  compactConversationHistory,
  validateRequestBudget,
  clampMaxTokens,
  createSessionBudget
} = require('../src/bridge/request_budget');
const {
  buildOpenAiPayloadFromAnthropic,
  handleAnthropicMessages
} = require('../src/bridge/gateway_adapters');

async function run() {
  console.log('Running test_bridge_request_budget.js...');

  console.log('--- Testing Token Estimation & Basic Payloads ---');
  assert.strictEqual(estimateTokens(null), 0);
  assert.strictEqual(estimateTokens(''), 0);
  const sampleText = 'a'.repeat(350);
  assert.strictEqual(estimateTokens(sampleText), 100);

  const validPayload = {
    model: 'claude-3-5-sonnet',
    system: 'You are an elite coding shinobi.',
    messages: [
      { role: 'user', content: 'Hello Konoha!' }
    ]
  };
  const resValid = validateRequestBudget(validPayload);
  assert.strictEqual(resValid.ok, true);
  assert.ok(resValid.estimated_input_tokens > 0);
  console.log('  ✓ Valid payload passes budget gate.');

  console.log('--- Testing Invalid Payloads & Message Ceilings ---');
  const resInvalid = validateRequestBudget(null);
  assert.strictEqual(resInvalid.ok, false);
  assert.strictEqual(resInvalid.reason, 'invalid_payload');

  const manyMessages = Array.from({ length: 2005 }, (_, i) => ({ role: 'user', content: 'msg ' + i }));
  const resTooMany = validateRequestBudget({ messages: manyMessages });
  assert.strictEqual(resTooMany.ok, false);
  assert.strictEqual(resTooMany.reason, 'too_many_messages');
  console.log('  ✓ Invalid payload and message count ceilings enforced.');

  console.log('--- Testing Gemini Ceiling & Automatic Compaction (<50k Tokens) ---');
  const bigTextTurn = 'word '.repeat(30000);
  const initialSystem = 'System architecture contract for Konoha 2.2.18.';
  const conversationalPayload = {
    model: 'claude-3-5-sonnet',
    system: initialSystem,
    messages: [
      { role: 'user', content: 'Initial user task: Build production 3D asset engine.' },
      { role: 'assistant', content: 'Step 1 response: ' + bigTextTurn },
      { role: 'user', content: 'Follow up 1: ' + bigTextTurn },
      { role: 'assistant', content: 'Step 2 response: ' + bigTextTurn },
      { role: 'user', content: 'Follow up 2: ' + bigTextTurn },
      { role: 'assistant', content: 'Recent turn -2: Verified PBR materials.' },
      { role: 'user', content: 'Recent turn -1: Verified storage manager.' },
      { role: 'user', content: 'Latest active turn: Please verify the 3D pipeline.' }
    ]
  };

  const initialTokens = estimateTokens(conversationalPayload);
  assert.ok(initialTokens > 120000, 'Test payload must simulate realistic ~160k token history');
  console.log('  Payload initial estimated tokens:', initialTokens);

  const targetModel = 'ag/gemini-3.8-flash-high';
  const isGemini = /gemini/i.test(targetModel);
  const budgetRes = validateRequestBudget(conversationalPayload, { is_gemini: isGemini, model: targetModel });
  assert.strictEqual(budgetRes.ok, true, 'Compacted payload must pass budget check');
  assert.strictEqual(budgetRes.is_gemini, true, 'Must detect Gemini model via targetModel resolution');
  assert.strictEqual(budgetRes.compacted, true, 'Must trigger automatic compaction');
  assert.strictEqual(budgetRes.compactContext, true, 'Must set compactContext in return value');
  assert.strictEqual(conversationalPayload.compactContext, true, 'Must set compactContext on payload');
  assert.ok(budgetRes.estimated_input_tokens < 50000, 'Compacted tokens must be bounded under 50,000 tokens');

  const forwardedPayload = buildOpenAiPayloadFromAnthropic(conversationalPayload, targetModel);
  assert.strictEqual(forwardedPayload.model, targetModel);
  assert.strictEqual(forwardedPayload.compactContext, true, 'Forwarded payload must carry compactContext flag');
  assert.strictEqual(forwardedPayload.messages[0].role, 'system');
  assert.strictEqual(forwardedPayload.messages[0].content, initialSystem, 'System prompt preserved');
  assert.strictEqual(forwardedPayload.messages[1].content, 'Initial user task: Build production 3D asset engine.', 'Initial task prompt preserved');
  assert.strictEqual(forwardedPayload.messages[forwardedPayload.messages.length - 1].content, 'Latest active turn: Please verify the 3D pipeline.', 'Latest active turn preserved');
  const forwardedTokens = estimateTokens(forwardedPayload);
  assert.ok(forwardedTokens < 50000, 'Forwarded payload tokens must remain under 50,000');
  console.log('  ✓ Forwarding helper verified: preserved system, turn 0, latest 3 turns, compactContext: true, and', forwardedTokens, 'tokens (<50k).');

  console.log('--- Testing End-to-End handleAnthropicMessages Forwarding with Mock Bridge ---');
  let receivedUpstreamBody = null;
  const mockUpstreamServer = http.createServer((mReq, mRes) => {
    if (mReq.url === '/v1/models') {
      mRes.writeHead(200, { 'Content-Type': 'application/json' });
      mRes.end(JSON.stringify({ data: [{ id: 'ag/gemini-3.8-flash-high' }] }));
      return;
    }
    let raw = '';
    mReq.on('data', chunk => { raw += chunk.toString(); });
    mReq.on('end', () => {
      if (raw) {
        receivedUpstreamBody = JSON.parse(raw);
      }
      mRes.writeHead(200, { 'Content-Type': 'application/json' });
      mRes.end(JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'ag/gemini-3.8-flash-high',
        choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 150, completion_tokens: 10, total_tokens: 160 }
      }));
    });
  });

  await new Promise(resolve => mockUpstreamServer.listen(0, '127.0.0.1', resolve));
  const upstreamPort = mockUpstreamServer.address().port;

  try {
    const activeBridges = new Map();
    activeBridges.set('gemini', { targetModel: 'ag/gemini-3.8-flash-high', bridgeConfig: { port: upstreamPort, apiKey: 'test-key', provider: 'gemini' }, models: ['ag/gemini-3.8-flash-high'] });

    // Simulate inbound HTTP request to handleAnthropicMessages
    const inboundPayload = {
      model: 'ag/gemini-3.8-flash-high',
      system: initialSystem,
      messages: [
        { role: 'user', content: 'Initial user task: Build production 3D asset engine.' },
        { role: 'assistant', content: 'Step 1 response: ' + bigTextTurn },
        { role: 'user', content: 'Follow up 1: ' + bigTextTurn },
        { role: 'assistant', content: 'Step 2 response: ' + bigTextTurn },
        { role: 'user', content: 'Follow up 2: ' + bigTextTurn },
        { role: 'assistant', content: 'Recent turn -2: Verified PBR materials.' },
        { role: 'user', content: 'Recent turn -1: Verified storage manager.' },
        { role: 'user', content: 'Latest active turn: Please verify the 3D pipeline.' }
      ]
    };
    const inboundJson = JSON.stringify(inboundPayload);

    // Mock IncomingMessage
    const mockReq = new EventEmitter();
    mockReq.headers = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(inboundJson)) };
    mockReq.method = 'POST';
    mockReq.url = '/v1/messages';

    let responseEnded = false;
    let responseStatus = 200;
    let responseHeaders = {};
    let responseBody = '';
    const mockRes = new EventEmitter();
    mockRes.headersSent = false;
    mockRes.writeHead = (status, headers) => { responseStatus = status; Object.assign(responseHeaders, headers); };
    mockRes.setHeader = (name, val) => { responseHeaders[name.toLowerCase()] = val; };
    mockRes.getHeader = (name) => responseHeaders[name.toLowerCase()];
    mockRes.write = (chunk) => { responseBody += (chunk ? chunk.toString() : ''); return true; };
    mockRes.end = (chunk) => { if (chunk) responseBody += chunk.toString(); responseEnded = true; mockRes.emit('finish'); };

    const handlePromise = handleAnthropicMessages(activeBridges, mockReq, mockRes);
    mockReq.emit('data', Buffer.from(inboundJson));
    mockReq.emit('end');
    await handlePromise;

    // Wait for mockRes to finish
    await new Promise(resolve => { if (responseEnded) resolve(); else mockRes.on('finish', resolve); });

    if (responseStatus !== 200) console.error('500 Error body:', responseBody);
    assert.strictEqual(responseStatus, 200, 'Handler must return 200 OK');
    assert.ok(receivedUpstreamBody !== null, 'Upstream must have received forwarded body');
    assert.strictEqual(receivedUpstreamBody.compactContext, true, 'Upstream payload must carry compactContext: true');
    assert.strictEqual(receivedUpstreamBody.messages[0].role, 'system', 'System message must be message 0');
    assert.strictEqual(receivedUpstreamBody.messages[0].content, initialSystem, 'System prompt preserved in upstream body');
    assert.strictEqual(receivedUpstreamBody.messages[1].content, 'Initial user task: Build production 3D asset engine.', 'Initial task prompt preserved');
    assert.strictEqual(receivedUpstreamBody.messages[receivedUpstreamBody.messages.length - 1].content, 'Latest active turn: Please verify the 3D pipeline.', 'Latest active turn preserved');
    const upstreamTokens = estimateTokens(receivedUpstreamBody);
    assert.ok(upstreamTokens < 50000, 'Upstream tokens must be < 50,000 (observed: ' + upstreamTokens + ')');
    console.log('  ✓ handleAnthropicMessages integration verified: upstream received compacted body with compactContext: true and', upstreamTokens, 'tokens (<50k).');
  } finally {
    await new Promise(resolve => mockUpstreamServer.close(resolve));
  }

  console.log('--- Testing Unresolvable Oversized Rejection ---');
  const giantSingleMessage = {
    model: 'ag/gemini-3.8-flash-high',
    system: 'System',
    messages: [
      { role: 'user', content: 'x'.repeat(120000 * 4) }
    ]
  };
  const resGiant = validateRequestBudget(giantSingleMessage);
  assert.strictEqual(resGiant.ok, false);
  assert.strictEqual(resGiant.reason, 'input_tokens_exceeded');
  assert.strictEqual(resGiant.is_gemini, true);
  console.log('  ✓ Unresolvable oversized request cleanly rejected with 413 error shape.');

  console.log('--- Testing clampMaxTokens & createSessionBudget ---');
  assert.strictEqual(clampMaxTokens(4000, 1000), 1000);
  assert.strictEqual(clampMaxTokens(500, 1000), 500);
  assert.strictEqual(clampMaxTokens(50000, 60000, 32000), 32000);

  const session = createSessionBudget(10000);
  assert.strictEqual(session.remaining(), 10000);
  assert.strictEqual(session.exhausted(), false);
  session.record(6000);
  assert.strictEqual(session.remaining(), 4000);
  session.record(5000);
  assert.strictEqual(session.remaining(), 0);
  assert.strictEqual(session.exhausted(), true);
  console.log('  ✓ Token clamp and session budget accounting verified.');

  console.log('All tests in test_bridge_request_budget.js passed cleanly!');
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
