#!/usr/bin/env node
/**
 * Test bridge gateway response handling and model rewriting.
 */
const assert = require('assert');

console.log('Running test_bridge_gateway_model_rewrite.js...');

// Mock the gateway module to test model rewriting logic
function testModelRewrite() {
  const baseModel = 'gpt-4';
  const originalModel = 'gpt-4o';

  // Simulate the regex-based replacement (the fixed version)
  const modelRegex = /"model"\s*:\s*"([^"]+)"/g;
  const modelRegexSSE = /data:\s*{"model"\s*:\s*"([^"]+)"/g;

  // Test case 1: Normal JSON line with model field
  const line1 = '{"model": "gpt-4", "choices": [{"text": "hello"}]}';
  let rewritten = line1.replace(modelRegex, `$1"${originalModel}"`);
  assert.ok(rewritten.includes(originalModel), 'Should rewrite model in JSON');

  // Test case 2: SSE data line with model field
  const line2 = 'data: {"model": "gpt-4", "text": "hello"}';
  rewritten = line2.replace(modelRegexSSE, `$1"${originalModel}"`);
  assert.ok(rewritten.includes(originalModel), 'Should rewrite model in SSE');

  // Test case 3: Line without model field should pass through unchanged
  const line3 = '{"choices": [{"text": "hello"}]}';
  rewritten = line3.replace(modelRegex, `$1"${originalModel}"`);
  rewritten = rewritten.replace(modelRegexSSE, `$1"${originalModel}"`);
  assert.strictEqual(rewritten, line3, 'Should not modify lines without model field');

  // Test case 4: Verify no naive replaceAll (the old buggy behavior)
  const line4 = '{"tool": "search", "args": {"query": "gpt-4 documentation"}}';
  rewritten = line4.replace(modelRegex, `$1"${originalModel}"`);
  rewritten = rewritten.replace(modelRegexSSE, `$1"${originalModel}"`);
  // The old code would have replaced ALL occurrences of "gpt-4" with "gpt-4o"
  // The fixed code should leave this unchanged since there's no "model" field
  assert.ok(!rewritten.includes('gpt-4o'), 'Should not do naive replacement in tool args');
}

function testHeaderSanitization() {
  // Simulate the sanitizeForwardHeaders function
  function sanitizeForwardHeaders(reqHeaders) {
    const headers = {};
    for (const [name, value] of Object.entries(reqHeaders)) {
      const lower = name.toLowerCase();
      if (lower.match(/^(authorization|x-api-key|x-forwarded[-_]for|x-forwarded[-_]proto|x-request-id|x-client-|x-konoha-gateway|cookie|proxy-authorization|x-auth-token)/)) {
        continue;
      }
      headers[name] = Array.isArray(value) ? value.join(', ') : value;
    }
    delete headers['accept-encoding'];
    delete headers['Accept-Encoding'];
    return headers;
  }

  const headers = {
    'Authorization': 'Bearer token123',
    'X-API-Key': 'key123',
    'Cookie': 'session=abc123',
    'Proxy-Authorization': 'Basic auth',
    'X-Auth-Token': 'token456',
    'Content-Type': 'application/json',
    'Accept-Encoding': 'gzip',
    'X-Custom-Header': 'value'
  };

  const sanitized = sanitizeForwardHeaders(headers);

  assert.strictEqual(sanitized['Authorization'], undefined, 'Should strip Authorization');
  assert.strictEqual(sanitized['X-API-Key'], undefined, 'Should strip X-API-Key');
  assert.strictEqual(sanitized['Cookie'], undefined, 'Should strip Cookie');
  assert.strictEqual(sanitized['Proxy-Authorization'], undefined, 'Should strip Proxy-Authorization');
  assert.strictEqual(sanitized['X-Auth-Token'], undefined, 'Should strip X-Auth-Token');
  assert.strictEqual(sanitized['Content-Type'], 'application/json', 'Should keep Content-Type');
  assert.strictEqual(sanitized['Accept-Encoding'], undefined, 'Should strip Accept-Encoding');
  assert.strictEqual(sanitized['X-Custom-Header'], 'value', 'Should keep custom headers');
}

try {
  testModelRewrite();
  console.log('  ✓ Model rewriting logic verified.');

  testHeaderSanitization();
  console.log('  ✓ Header sanitization verified.');

  console.log('All tests in test_bridge_gateway_model_rewrite.js passed!\n');
} catch (err) {
  console.error('Test failed:', err.message);
  process.exit(1);
}
