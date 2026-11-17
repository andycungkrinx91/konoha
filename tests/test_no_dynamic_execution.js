#!/usr/bin/env node
'use strict';

// Supply-chain guard: Konoha must never ship or emit a dynamic-execution sink.
//
// Historically the emitted client hooks (Pi extension, Claude Code bash guard,
// CommandCode blocker) rebuilt their guardrail checker with
// `new Function(source)()`. That is an eval surface inside a file we install into
// the user's agent config, and Socket flags it. The checker is now emitted as a
// plain function declaration. This test fails if any sink comes back.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');

console.log('Running test_no_dynamic_execution: dynamic-execution sinks...');

// --- 1. Source scan: no eval / Function / vm in first-party runtime code -----
const SCAN_DIRS = ['src', 'bin', 'scripts'];
const SKIP_PATTERNS = [
  /^src[\\/]templates[\\/]/,        // skill docs may quote the pattern
  /\.d\.ts$/,
  /[\\/]node_modules[\\/]/
];

// Matches `eval(` and `new Function(` / `Function(` as a constructor call.
// Deliberately ignores `Function.prototype` / `isFunction` / prose.
const SINK_PATTERNS = [
  { name: 'eval()', re: /(^|[^.\w$])eval\s*\(/ },
  { name: 'new Function()', re: /new\s+Function\s*\(/ },
  { name: 'Function() call', re: /(^|[^.\w$])Function\s*\(\s*['"`]/ },
  { name: 'vm module', re: /require\s*\(\s*['"](node:)?vm['"]\s*\)/ },
  { name: 'runInNewContext', re: /runIn(New)?Context\s*\(/ }
];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (SKIP_PATTERNS.some((re) => re.test(rel))) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.(js|cjs|mjs|ts)$/.test(entry.name)) out.push(full);
  }
}

const files = [];
for (const dir of SCAN_DIRS) {
  const abs = path.join(ROOT, dir);
  if (fs.existsSync(abs)) walk(abs, files);
}
assert.ok(files.length > 50, `expected to scan the runtime tree, only saw ${files.length} files`);

const violations = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const { name, re } of SINK_PATTERNS) {
    const match = source.match(re);
    if (!match) continue;
    const line = source.slice(0, match.index).split('\n').length;
    violations.push(`${path.relative(ROOT, file)}:${line} uses ${name}`);
  }
}
assert.deepStrictEqual(violations, [], `dynamic execution sinks found:\n  ${violations.join('\n  ')}`);
console.log(`  ok   ${files.length} runtime files free of eval/Function/vm`);

// --- 2. Emitted hook payloads must be plain declarations ---------------------
const { buildPiBlockerExtensionSource } = require(path.join(ROOT, 'src', 'pi_blocker_template.js'));
const { buildCommandCodeBlockerSource } = require(path.join(ROOT, 'src', 'mcp_clients', 'command_code.js'));
const { buildClaudeCodeBashGuardSource } = require(path.join(ROOT, 'src', 'mcp_clients', 'claude_code_hooks.js'));

const payloads = {
  'pi extension': buildPiBlockerExtensionSource(),
  'commandcode blocker': buildCommandCodeBlockerSource(),
  'claude bash guard': buildClaudeCodeBashGuardSource()
};

const checkerSource = require(path.join(ROOT, 'src', 'guardrails.js')).buildGuardrailCheckerSource();

for (const [label, source] of Object.entries(payloads)) {
  assert.ok(source.length > 2000, `${label} payload looks truncated`);
  assert.ok(
    !/new\s+Function\s*\(/.test(source),
    `${label} must not rebuild its checker with new Function()`
  );
  assert.ok(
    source.includes(checkerSource),
    `${label} must embed the guardrail checker source verbatim (single source of truth)`
  );
  // Non-module payloads must still parse as plain JS.
  if (!/^\s*import\s/m.test(source)) {
    assert.doesNotThrow(
      () => new (require('vm').Script)(source.replace(/^#!.*\n/, ''), { filename: label }),
      `${label} payload must parse`
    );
  }
}
console.log('  ok   emitted hook payloads declare the checker, no Function() constructor');

// --- 3. Behaviour is unchanged: generated guards still block -----------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-no-dynamic-exec-'));
try {
  const ccHook = path.join(tmpDir, 'cc_hook.js');
  const clHook = path.join(tmpDir, 'cl_hook.js');
  fs.writeFileSync(ccHook, payloads['commandcode blocker']);
  fs.writeFileSync(clHook, payloads['claude bash guard']);

  const runHook = (hook, input, managed = true) => {
    const res = cp.spawnSync(process.execPath, [hook], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: managed
        ? { ...process.env, KONOHA_MANAGED_CONTEXT: '1' }
        : Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'KONOHA_MANAGED_CONTEXT' && k !== 'KONOHA_TASK_ID')),
      timeout: 20000
    });
    assert.strictEqual(res.status, 0, `${path.basename(hook)} must exit 0, stderr: ${res.stderr}`);
    return res.stdout;
  };

  const nativeRead = runHook(ccHook, {
    tool_name: 'read_file',
    tool_input: { path: 'src/index.js' },
    konoha_managed: true
  });
  assert.match(nativeRead, /"permissionDecision":"deny"/, 'native read must still be denied');
  assert.match(nativeRead, /MANDATORY RULE VIOLATION/, 'denial reason must be preserved');

  const destructive = runHook(clHook, {
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf /' },
    konoha_managed: true
  });
  assert.match(destructive, /"decision":"block"/, 'destructive command must still be blocked');
  assert.match(destructive, /DESTRUCTIVE COMMAND BLOCKED/, 'block reason must be preserved');

  const benign = runHook(clHook, {
    tool_name: 'Bash',
    tool_input: { command: 'node tests/test_token_sampler.js' },
    konoha_managed: true
  });
  assert.doesNotMatch(benign, /"decision":"block"/, 'benign command must not be blocked');

  const unmanaged = runHook(clHook, {
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf /' },
    konoha_managed: false
  }, false);
  assert.strictEqual(unmanaged.trim(), '', 'unmanaged sessions must stay untouched');
  console.log('  ok   emitted guards block native reads + destructive commands, allow benign');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('\nAll test_no_dynamic_execution checks passed successfully!');
