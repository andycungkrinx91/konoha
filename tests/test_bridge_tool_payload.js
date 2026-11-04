'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const payloadTools = require(path.join(ROOT, 'src/bridge/tool_payload'));
const { buildOpenAiPayloadFromAnthropic } = require(path.join(ROOT, 'src/bridge/gateway_adapters'));

function runCase(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (err) {
    console.log(`  FAIL ${name}: ${err.message}`);
    return false;
  }
}

function tool(name) {
  return { type: 'function', function: { name, description: `does ${name}`, parameters: { type: 'object', properties: {} } } };
}

function run() {
  console.log('test_bridge_tool_payload');
  let ok = true;

  ok = runCase('dedupe keeps first occurrence and caller order', () => {
    const input = [tool('b'), tool('a'), tool('b'), tool('c'), tool('a')];
    const out = payloadTools.dedupeToolDefinitions(input);
    assert.deepStrictEqual(out.map((t) => t.function.name), ['b', 'a', 'c']);
    assert.strictEqual(out[0], input[0], 'first occurrence identity lost');
  }) && ok;

  ok = runCase('dedupe drops nameless entries and passes through non-arrays', () => {
    const out = payloadTools.dedupeToolDefinitions([{ type: 'function', function: {} }, tool('ok')]);
    assert.deepStrictEqual(out.map((t) => t.function.name), ['ok']);
    assert.strictEqual(payloadTools.dedupeToolDefinitions(null), null);
    assert.deepStrictEqual(payloadTools.dedupeToolDefinitions([]), []);
  }) && ok;

  ok = runCase('short tool output is untouched', () => {
    const messages = [{ role: 'tool', tool_call_id: 'x', content: 'small' }];
    const capped = payloadTools.capToolOutputs(messages);
    assert.strictEqual(messages[0].content, 'small');
    assert.strictEqual(capped._toolOutputStats, undefined, 'stats must only exist when something was capped');
  }) && ok;

  ok = runCase('oversized tool output is capped with an explicit marker', () => {
    const max = 2000;
    const huge = 'x'.repeat(50000);
    const messages = [{ role: 'tool', content: huge }];
    const capped = payloadTools.capToolOutputs(messages, { maxToolOutputChars: max });
    const out = capped[0].content;
    assert.ok(out.length <= max, `capped length ${out.length} exceeds ${max}`);
    assert.ok(out.includes('konoha bridge truncated'), 'marker missing');
    assert.ok(out.includes('50000 total'), 'marker lost the original size');
    const stats = capped._toolOutputStats;
    assert.ok(stats, 'stats missing');
    assert.strictEqual(stats.truncated, 1);
    assert.strictEqual(stats.maxChars, max);
  }) && ok;

  ok = runCase('only tool-role string content is capped', () => {
    const huge = 'y'.repeat(40000);
    const messages = [
      { role: 'user', content: huge },
      { role: 'assistant', content: huge },
      { role: 'tool', content: [{ type: 'text', text: huge }] }
    ];
    const stats = payloadTools.capToolOutputs(messages, { maxToolOutputChars: 1000 })._toolOutputStats || { truncated: 0 };
    assert.strictEqual(stats.truncated, 0, 'non-string/non-tool content must be left alone');
    assert.strictEqual(messages[0].content.length, 40000);
  }) && ok;

  ok = runCase('pretty-printed JSON is minified losslessly instead of truncated', () => {
    const original = { items: [] };
    for (let i = 0; i < 90; i += 1) original.items.push({ id: i, name: `s${i}`, enabled: i % 2 === 0 });
    const pretty = JSON.stringify(original, null, 2);
    const minified = JSON.stringify(original);
    const max = Math.floor((pretty.length + minified.length) / 2);
    assert.ok(pretty.length > max, 'fixture must start over the cap');
    assert.ok(minified.length < max, 'minification must be able to fit this fixture under the cap');
    const capped = payloadTools.capToolOutputs([{ role: 'tool', content: pretty }], { maxToolOutputChars: max });
    const out = capped[0].content;
    assert.ok(!out.includes('konoha bridge truncated'), 'lossless compaction should never need a marker');
    assert.deepStrictEqual(JSON.parse(out), original, 'minification changed JSON values');
    const stats = capped._toolOutputStats;
    assert.strictEqual(stats.truncated, 0);
    assert.strictEqual(stats.jsonCompacted, 1);
    assert.ok(stats.reclaimedJsonChars > 0);
  }) && ok;

  ok = runCase('JSON still oversized after minification keeps the truncation marker', () => {
    const original = { rows: [] };
    for (let i = 0; i < 4000; i += 1) original.rows.push({ id: i, label: `row-${i}` });
    const minified = JSON.stringify(original);
    const max = 2000;
    assert.ok(minified.length > max, 'fixture must stay over the cap when minified');
    const capped = payloadTools.capToolOutputs([{ role: 'tool', content: JSON.stringify(original, null, 2) }], { maxToolOutputChars: max });
    const out = capped[0].content;
    assert.ok(out.length <= max, `capped length ${out.length} exceeds ${max}`);
    assert.ok(out.includes('konoha bridge truncated'), 'marker missing for over-cap JSON');
    assert.strictEqual(capped._toolOutputStats.jsonCompacted, 1);
    assert.strictEqual(capped._toolOutputStats.truncated, 1);
  }) && ok;

  ok = runCase('environment override is honoured', () => {
    const previous = process.env.KONOHA_BRIDGE_MAX_TOOL_OUTPUT_CHARS;
    process.env.KONOHA_BRIDGE_MAX_TOOL_OUTPUT_CHARS = '1500';
    try {
      assert.strictEqual(payloadTools.resolveMaxToolOutputChars(), 1500);
      assert.strictEqual(payloadTools.resolveMaxToolOutputChars({ maxToolOutputChars: 900 }), 900);
    } finally {
      if (previous === undefined) delete process.env.KONOHA_BRIDGE_MAX_TOOL_OUTPUT_CHARS;
      else process.env.KONOHA_BRIDGE_MAX_TOOL_OUTPUT_CHARS = previous;
    }
  }) && ok;

  ok = runCase('measurePayload reports bytes and a token estimate', () => {
    const measured = payloadTools.measurePayload({
      tools: [tool('a')],
      messages: [{ role: 'user', content: 'hi' }],
      system: 'sys'
    });
    assert.ok(measured.toolsBytes > 0 && measured.messagesBytes > 0 && measured.systemBytes === 5);
    assert.ok(measured.estimatedTokens > 0);
  }) && ok;

  ok = runCase('adapter dedupes tools and caps results end to end', () => {
    const huge = 'z'.repeat(60000);
    const out = buildOpenAiPayloadFromAnthropic({
      model: 'claude-x',
      max_tokens: 1024,
      tools: [
        { name: 'read_file_head', description: 'read', input_schema: { type: 'object', properties: {} } },
        { name: 'read_file_head', description: 'read again', input_schema: { type: 'object', properties: {} } }
      ],
      messages: [
        { role: 'user', content: 'go' },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call_1', content: huge }]
        }
      ]
    }, 'gpt-x');
    assert.strictEqual(out.tools.length, 1, 'duplicate tool definition survived the adapter');
    const toolMessage = out.messages.find((m) => m.role === 'tool');
    assert.ok(toolMessage, 'tool result message missing');
    assert.ok(toolMessage.content.length <= payloadTools.DEFAULT_MAX_TOOL_OUTPUT_CHARS);
    assert.ok(toolMessage.content.includes('konoha bridge truncated'));
  }) && ok;

  ok = runCase('adapter omits tools when the caller sent none', () => {
    const out = buildOpenAiPayloadFromAnthropic({ model: 'claude-x', messages: [{ role: 'user', content: 'hi' }] }, 'gpt-x');
    assert.strictEqual(out.tools, undefined);
  }) && ok;

  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  return ok;
}

if (require.main === module) {
  process.exit(run() ? 0 : 1);
}

module.exports = { run };
