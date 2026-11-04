'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const web = require(path.join(ROOT, 'src/bridge/web_content'));
const payloadTools = require(path.join(ROOT, 'src/bridge/tool_payload'));
const adapters = require(path.join(ROOT, 'src/bridge/gateway_adapters'));

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

function buildDocPage() {
  const nav = Array.from({ length: 60 }, (_, i) => `<li><a href="/docs/section-${i}">Section ${i}</a></li>`).join('');
  const chrome = Array.from({ length: 220 }, (_, i) => `<div class="toolbar"><button data-x="${i}" aria-label="tool ${i}">tool ${i}</button><span class="hint">press to run</span></div>`).join('');
  const paragraphs = Array.from({ length: 120 }, (_, i) => (
    `<p>Paragraph ${i} explains signal handling with <code>onMount</code> and <strong>reactive state</strong>.</p>`
  )).join('');
  const links = Array.from({ length: 30 }, (_, i) => (
    `<p>See the <a href="https://svelte.dev/docs/svelte/${i}">official page ${i}</a> for details.</p>`
  )).join('');
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>Docs</title>',
    '<script>window.__DATA__ = {"big":"' + 'x'.repeat(20000) + '"};</script>',
    '<style>.toolbar{display:flex;gap:.5rem}' + 'y'.repeat(9000) + '</style>',
    '</head>',
    '<body>',
    '<nav><ul>' + nav + '</ul></nav>',
    chrome,
    '<main>',
    paragraphs,
    links,
    '<pre><code>const a = 1;\nconst b = 2;</code></pre>',
    '</main>',
    '<iframe src="https://ads.example/embed"></iframe>',
    '<noscript>Enable JS</noscript>',
    '<script>console.log("tracking")</script>',
    '</body>',
    '</html>'
  ].join('\n');
}

function run() {
  console.log('test_bridge_web_content');
  let ok = true;

  ok = runCase('detects markup pages and ignores source code', () => {
    assert.strictEqual(web.looksLikeHtml(buildDocPage()), true);
    const code = 'const x = "<div>" + "</div>";\n'.repeat(200);
    assert.strictEqual(web.looksLikeHtml(code), false);
    assert.strictEqual(web.looksLikeHtml(JSON.stringify({ rows: Array(400).fill({ a: '<p>x</p>' }) })), false);
    assert.strictEqual(web.looksLikeHtml(''), false);
  }) && ok;

  ok = runCase('strips scripts, styles, chrome and iframes', () => {
    const text = web.htmlToText(buildDocPage());
    assert.ok(!/window\.__DATA__/.test(text), 'inline script payload leaked');
    assert.ok(!/display:flex/.test(text), 'style block leaked');
    assert.ok(!/tracking/.test(text), 'trailing script leaked');
    assert.ok(!/ads\.example/.test(text), 'iframe source leaked');
    assert.ok(/Paragraph 119 explains signal handling/.test(text), 'article body missing');
  }) && ok;

  ok = runCase('preserves citations as text plus absolute url', () => {
    const text = web.htmlToText(buildDocPage());
    assert.ok(text.includes('official page 7 (https://svelte.dev/docs/svelte/7)'), 'citation url dropped');
  }) && ok;

  ok = runCase('decodes entities and collapses whitespace', () => {
    const html = '<html><body>' + '<p>a &amp; b &lt;c&gt; &#8212; d</p>'.repeat(80) + '</body></html>';
    const text = web.htmlToText(html);
    assert.ok(text.includes('a & b <c> \u2014 d'), 'entity decoding failed');
    assert.ok(!/\n{3,}/.test(text), 'blank-line runs not collapsed');
    assert.ok(!/[ \t]{2,}/.test(text), 'horizontal spacing not collapsed');
  }) && ok;

  ok = runCase('compresses a realistic page substantially', () => {
    const html = buildDocPage();
    const result = web.compressWebOutput(html);
    assert.strictEqual(result.changed, true);
    const ratio = result.text.length / html.length;
    assert.ok(ratio < 0.35, `expected strong reduction, got ${(ratio * 100).toFixed(1)}%`);
    assert.ok(result.text.length > 2000, 'article body must survive compression');
  }) && ok;

  ok = runCase('passes plain text and json through untouched', () => {
    const plain = 'plain tool output line\n'.repeat(400);
    const passthrough = web.compressWebOutput(plain);
    assert.strictEqual(passthrough.changed, false);
    assert.strictEqual(passthrough.text, plain);
    const json = JSON.stringify({ ok: true, items: Array(300).fill('row') });
    assert.strictEqual(web.compressWebOutput(json).text, json);
  }) && ok;

  ok = runCase('capToolOutputs compresses html before applying the char cap', () => {
    const html = buildDocPage();
    const messages = [{ role: 'tool', tool_call_id: 't1', content: html }];
    const capped = payloadTools.capToolOutputs(messages, { maxToolOutputChars: 200000 });
    const stats = capped._toolOutputStats;
    assert.ok(stats, 'stats missing for html compression');
    assert.strictEqual(stats.htmlCompressed, 1);
    assert.strictEqual(stats.truncated, 0, 'compressed page should fit the generous cap');
    assert.ok(stats.reclaimedHtmlChars > html.length * 0.6, 'reclamation understated');
    assert.ok(capped[0].content.length < html.length);
    assert.strictEqual(messages[0].content, html, 'input messages must not be mutated');
  }) && ok;

  ok = runCase('capToolOutputs still caps non-html tool output', () => {
    const messages = [{ role: 'tool', tool_call_id: 't2', content: 'z'.repeat(5000) }];
    const capped = payloadTools.capToolOutputs(messages, { maxToolOutputChars: 1000 });
    assert.strictEqual(capped[0].content.length <= 1000, true);
    assert.strictEqual(capped._toolOutputStats.truncated, 1);
    assert.strictEqual(capped._toolOutputStats.htmlCompressed, 0);
  }) && ok;

  ok = runCase('compression leaves user and assistant messages alone', () => {
    const html = buildDocPage();
    const messages = [
      { role: 'user', content: html },
      { role: 'assistant', content: html }
    ];
    const capped = payloadTools.capToolOutputs(messages, { maxToolOutputChars: 200 });
    assert.strictEqual(capped, messages);
  }) && ok;

  ok = runCase('adapter compresses html tool_result blocks before provider dispatch', () => {
    const html = buildDocPage();
    const body = {
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: 'research',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'summarise this page' }] },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'web_fetch', input: { url: 'https://svelte.dev/docs' } }]
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: html }] }
          ]
        }
      ]
    };
    const converted = adapters.anthropicMessagesToOpenAi(body.system, body.messages);
    const toolMessage = converted.find((m) => m.role === 'tool');
    assert.ok(toolMessage, 'tool_result was not converted to a tool message');
    assert.strictEqual(toolMessage.content, html, 'adapter conversion alone must not rewrite content');
    const payload = adapters.buildOpenAiPayloadFromAnthropic(body);
    const sent = payload.messages.find((m) => m.role === 'tool');
    assert.ok(sent.content.length < html.length * 0.4, 'provider payload still carries raw markup');
    assert.ok(/Paragraph 119 explains/.test(sent.content), 'article body lost in transit');
    assert.ok(sent.content.includes('official page 3 (https://svelte.dev/docs/svelte/3)'), 'citation lost in transit');
    assert.ok(!/window\.__DATA__/.test(sent.content), 'script payload reached the provider');
  }) && ok;

  console.log(ok ? 'ALL PASS' : 'FAILURES PRESENT');
  process.exitCode = ok ? 0 : 1;
}

run();
