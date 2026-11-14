#!/usr/bin/env node
/**
 * HITL picker binding regression test.
 *
 * Defect pinned here: every gate rendered a numbered list and asked the human to
 * retype a label. That is text, not a picker — no harness was told which control
 * it actually has, so a human on Cursor/OMP/[CC]/Telegram got the same prose and
 * the verdict arrived as a free-form string that could not be distinguished from
 * a typo. The gate payload now carries a `picker` block naming the transport,
 * and the web fallback serves a real form that posts the verdict itself.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const gates = require(path.join(REPO, 'src', 'mcp', 'workflow_gates.js'));
const picker = require(path.join(REPO, 'src', 'mcp', 'hitl_picker.js'));
const { saveWorkflowStatus } = require(path.join(REPO, 'src', 'mcp', 'workflow_common.js'));

function withTaskDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-picker-'));
  return fn(dir);
}

function gate1(dir, client) {
  const raw = gates.buildGate1Prompt({ plan: 'step one' }, dir, path.basename(dir), 'step one', { client });
  return JSON.parse(raw);
}

test('every deployed client resolves to a transport', () => {
  const clients = ['antigravity', 'cursor', 'claude', 'opencode', 'commandcode', 'codex', 'pi', 'omp'];
  for (const client of clients) {
    const binding = picker.resolvePickerBinding(client);
    assert.ok(['native_tool', 'web_picker'].includes(binding.transport), `${client} must map to a real control, got ${binding.transport}`);
  }
  assert.equal(picker.resolvePickerBinding('omp').tool, 'ask');
  assert.equal(picker.resolvePickerBinding('claude').tool, 'AskUserQuestion');
  assert.equal(picker.resolvePickerBinding('no-such-harness').transport, 'web_picker', 'unknown harness must degrade to the web form, not to prose');
});

test('gate payload carries a picker whose call matches its transport', () => withTaskDir((dir) => {
  const omp = gate1(dir, 'omp');
  assert.equal(omp.picker.transport, 'native_tool');
  assert.equal(omp.picker.tool, 'ask');
  assert.equal(omp.picker.call.questions.length, 1);
  assert.equal(omp.picker.call.questions[0].multiSelect, false);
  assert.deepEqual(
    omp.picker.call.questions[0].options.map((o) => o.label),
    omp.interactive_prompt.options.map((o) => o.label),
    'the tool call must offer exactly the gate options, not a re-worded subset'
  );
  assert.deepEqual(omp.picker.submit_args, ['task_dir', 'choice', 'refinement']);
  assert.match(omp.picker.instruction, /ask/);

  const cursor = gate1(dir, 'cursor');
  assert.equal(cursor.picker.transport, 'web_picker');
  assert.match(cursor.picker.url, /\/api\/v1\/hitl\/picker\?/);
  assert.ok(cursor.picker.url.includes(encodeURIComponent(path.basename(dir))), 'picker URL must target this task');

}));

test('binding map names only tools that exist', () => {
  const toolNames = Object.values(picker.PICKER_BINDINGS)
    .filter((b) => b.transport === 'native_tool')
    .map((b) => b.tool)
    .sort();
  assert.deepEqual(toolNames, ['AskUserQuestion', 'ask'], 'a guessed tool name fails at call time; the map must stay honest');
  for (const [client, binding] of Object.entries(picker.PICKER_BINDINGS)) {
    assert.ok(binding.transport === 'native_tool' || binding.transport === 'web_picker', `${client} names a transport with no renderer`);
  }
});

test('picker page is a form that posts the verdict, not a dead document', () => {
  const html = picker.renderPickerPage({
    gate_name: 'Gate 1 (Plan Approval)',
    question: 'Proceed?',
    refinement_option: 'Input your own choice',
    options: [
      { label: 'Compact and approve', description: 'go' },
      { label: 'Input your own choice', description: 'type', accepts_text: true }
    ]
  }, { token: 'tok-123', taskDir: '/tmp/konoha-picker-x' });

  assert.match(html, /<form id="picker">/);
  assert.match(html, /name="choice" value="Compact and approve"/);
  assert.match(html, /<textarea id="refinement"/, 'the free-text escape hatch must be a field, not a guess at the label');
  assert.match(html, /CONFIG\.signature/, 'the verdict POST must carry the per-gate capability signature');
  assert.ok(!html.includes('tok-123'), 'the page must never embed the session token');
  assert.match(html, /\/api\/v1\/hitl\/verdict/);
  assert.ok(!/<script[^>]+src=/.test(html), 'the page must not depend on external assets');
  assert.ok(!/\son\w+=/.test(html), 'no inline event handlers');
  assert.ok(!html.includes('undefined'), 'an absent signature must not leak the string "undefined" into the page');

  const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
  assert.ok(script.length > 0, 'the page must ship its own submit script');
  assert.doesNotThrow(() => new Function(script), 'the inline submit script must parse; a syntax error would leave the form dead');
});

test('picker page escapes hostile gate content', () => {
  const html = picker.renderPickerPage({
    gate_name: '<img src=x onerror=alert(1)>',
    question: '"><script>alert(2)</script>',
    options: [{ label: '<b>bold</b>', description: '&' }]
  }, {});
  assert.ok(!html.includes('<img src=x'), 'gate name must be escaped');
  assert.ok(!html.includes('<script>alert(2)'), 'question must be escaped');
  assert.ok(html.includes('&lt;b&gt;bold&lt;/b&gt;'));
});

test('the picker is served only to a signed link and refuses an unsigned verdict', async () => {
  const { createWebServer } = require(path.join(REPO, 'src', 'web_server.js'));
  const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-picker-http-'));
  saveWorkflowStatus(taskDir, { status: 'pending_plan_approval', phase: 'plan_approval', plan: 'step one', tasks: [] });

  const port = 1480 + Math.floor(Math.random() * 60);
  const wrapper = createWebServer({ port });
  await new Promise((resolve) => wrapper.server.listen(port, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${port}`;
  const picker = require(path.join(REPO, 'src', 'mcp', 'hitl_picker.js'));
  const sig = picker.signTaskDir(taskDir, wrapper.token);
  assert.ok(sig, 'a gate capability must be signable');
  assert.ok(!picker.buildPickerUrl({ baseUrl: 'http://127.0.0.1:1', taskDir }).includes(wrapper.token),
    'the picker URL must never carry the session token');
  const url = `${base}/api/v1/hitl/picker?task_dir=${encodeURIComponent(taskDir)}&sig=${sig}`;

  try {
    const page = await fetch(url);
    const html = await page.text();
    assert.equal(page.status, 200, 'a tokenised picker URL must render: ' + html.slice(0, 160));
    assert.match(html, /<form id="picker">/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer', 'the capability URL must not leak through a referrer');
    assert.equal(page.headers.get('cache-control'), 'no-store', 'a capability URL must not be cached');

    const anonymous = await fetch(`${base}/api/v1/hitl/picker?task_dir=${encodeURIComponent(taskDir)}`);
    assert.equal(anonymous.status, 403, 'the page must not render without a capability signature');

    const forged = await fetch(`${base}/api/v1/hitl/picker?task_dir=${encodeURIComponent(taskDir)}&sig=${'0'.repeat(32)}`);
    assert.equal(forged.status, 403, 'a forged signature must be refused');

    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-picker-other-'));
    saveWorkflowStatus(otherDir, { status: 'pending_plan_approval', phase: 'plan_approval', plan: 'x', tasks: [] });
    const crossGate = await fetch(`${base}/api/v1/hitl/picker?task_dir=${encodeURIComponent(otherDir)}&sig=${sig}`);
    assert.equal(crossGate.status, 403, 'one gate signature must not open another gate');
    fs.rmSync(otherDir, { recursive: true, force: true });

    const noGate = await fetch(`${base}/api/v1/hitl/picker?sig=${sig}`);
    assert.equal(noGate.status, 404, 'a picker with no task must not render');

    const unsigned = await fetch(`${base}/api/v1/hitl/verdict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_dir: taskDir, choice: 'Compact and approve' })
    });
    assert.equal(unsigned.status, 403, 'a verdict without a signature must be refused');

    const noChoice = await fetch(`${base}/api/v1/hitl/verdict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_dir: taskDir, sig })
    });
    assert.equal(noChoice.status, 400, 'a verdict with no choice must be refused');
  } finally {
    wrapper.server.close();
    fs.rmSync(taskDir, { recursive: true, force: true });
  }
});

test('a gate raised by the LangGraph nodes renders in the picker', async () => {
  // Defect pinned here: the nodes record the pending gate in `hitl_gate` and
  // leave `phase` on the node that raised it (`plan`, `review`). The controller
  // keyed only off `status`/`phase`, so every graph-driven gate answered 409 and
  // a web-picker client was shown a dead link while the workflow sat parked.
  const { createWebServer } = require(path.join(REPO, 'src', 'web_server.js'));
  const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-picker-graph-'));
  saveWorkflowStatus(taskDir, { phase: 'plan', hitl_gate: 'pending_plan_approval', plan: 'step one', tasks: [] });

  const port = 1540 + Math.floor(Math.random() * 60);
  const wrapper = createWebServer({ port });
  await new Promise((resolve) => wrapper.server.listen(port, '127.0.0.1', resolve));
  const sig = picker.signTaskDir(taskDir, wrapper.token);

  try {
    const page = await fetch(`http://127.0.0.1:${port}/api/v1/hitl/picker?task_dir=${encodeURIComponent(taskDir)}&sig=${sig}`);
    const html = await page.text();
    assert.equal(page.status, 200, 'a graph-raised gate must render: ' + html.slice(0, 160));
    assert.match(html, /Gate 1/, 'the page must name the gate it is asking about');

    saveWorkflowStatus(taskDir, { phase: 'review', hitl_gate: 'pending_human_signoff', confidence: 100, report: 'ok', tasks: [] });
    const signoff = await fetch(`http://127.0.0.1:${port}/api/v1/hitl/picker?task_dir=${encodeURIComponent(taskDir)}&sig=${sig}`);
    assert.equal(signoff.status, 200, 'the sign-off gate must render too');
    assert.match(await signoff.text(), /Gate 2/);

    saveWorkflowStatus(taskDir, { phase: 'done', hitl_gate: null, tasks: [] });
    const done = await fetch(`http://127.0.0.1:${port}/api/v1/hitl/picker?task_dir=${encodeURIComponent(taskDir)}&sig=${sig}`);
    assert.equal(done.status, 409, 'a finished task must not render a gate');
  } finally {
    wrapper.server.close();
    fs.rmSync(taskDir, { recursive: true, force: true });
  }
});
