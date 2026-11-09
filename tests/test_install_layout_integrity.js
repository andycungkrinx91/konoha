#!/usr/bin/env node
'use strict';

/**
 * tests/test_install_layout_integrity.js
 *
 * Guards the two install-layout failures fixed in 2.2.19:
 *   1. No flattened legacy mirrors (~/.konoha/mcp, file_tools, workflow, bridge)
 *      may survive — they drop langgraph/{nodes,edges}/ and break index.js.
 *   2. The kanonical runtime tree must resolve: langgraph/index.js and a nested
 *      node module must both load from an isolated HOME.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { isolateHome } = require('./helpers/isolate_home');

const ROOT = path.resolve(__dirname, '..');
const home = isolateHome();
let failures = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  PASS ${label}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${label}: ${err.message}`);
  }
}

try {
  const { purgeInvalidRuntimeMirrors } = require(path.join(ROOT, 'bin', 'commands', 'doctor_runtime.js'));

  const context = {
    records: [],
    repairs: 0,
    errors: 0,
    record(label, status, detail) { this.records.push({ label, status, detail }); },
    incrementRepairs() { this.repairs++; },
    markError() { this.errors++; }
  };

  // Seed the layout-invalid mirror the pre-2.2.19 installer created: top-level
  // files only, with the nested trees the deployed router requires missing.
  for (const sub of ['mcp', 'workflow']) {
    const dir = path.join(home.konohaDir, sub);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), "'use strict';\nrequire('./nodes/plan');\n");
  }

  check('purge removes flattened mirrors', () => {
    purgeInvalidRuntimeMirrors(context);
    for (const sub of ['mcp', 'workflow']) {
      assert.strictEqual(fs.existsSync(path.join(home.konohaDir, sub)), false, `${sub} still exists`);
    }
  });

  check('purge records a repair per removed mirror', () => {
    assert.strictEqual(context.repairs, 2, `expected 2 repairs, got ${context.repairs}`);
    assert.strictEqual(context.errors, 0);
  });

  check('purge is idempotent when nothing is present', () => {
    const again = { records: [], repairs: 0, errors: 0, record() {}, incrementRepairs() { this.repairs++; }, markError() { this.errors++; } };
    purgeInvalidRuntimeMirrors(again);
    assert.strictEqual(again.repairs, 0);
    assert.strictEqual(again.errors, 0);
  });

  check('purge preserves a complete mirror tree', () => {
    // A full copy is load-bearing: the deployed file_tools_router.js requires
    // ./mcp/runtime_state and ./workflow/qa-automation/qa_tools.
    const mcpDir = path.join(home.konohaDir, 'mcp');
    fs.mkdirSync(path.join(mcpDir, 'langgraph', 'nodes'), { recursive: true });
    fs.writeFileSync(path.join(mcpDir, 'langgraph', 'index.js'), 'module.exports={};\n');
    fs.writeFileSync(path.join(mcpDir, 'runtime_state.js'), 'module.exports={};\n');
    const wfDir = path.join(home.konohaDir, 'workflow', 'qa-automation');
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'qa_tools.js'), 'module.exports={};\n');
    const before = { records: [], repairs: 0, errors: 0, record() {}, incrementRepairs() { this.repairs++; }, markError() { this.errors++; } };
    purgeInvalidRuntimeMirrors(before);
    assert.strictEqual(before.repairs, 0, 'complete mirror was deleted');
    assert.ok(fs.existsSync(path.join(mcpDir, 'runtime_state.js')), 'required module removed');
    assert.ok(fs.existsSync(path.join(wfDir, 'qa_tools.js')), 'required module removed');
  });

  // The runtime tree must load from the canonical src/ layout, and the node
  // modules referenced by index.js must exist with exact case.
  check('langgraph index and nested nodes load', () => {
    const index = path.join(ROOT, 'src', 'mcp', 'langgraph', 'index.js');
    require(index);
    require(path.join(ROOT, 'src', 'mcp', 'langgraph', 'nodes', 'plan.js'));
  });

  check('every ./nodes/* require resolves to an exact-case file', () => {
    const nodesDir = path.join(ROOT, 'src', 'mcp', 'langgraph', 'nodes');
    const onDisk = new Set(fs.readdirSync(nodesDir));
    const indexSrc = fs
      .readFileSync(path.join(ROOT, 'src', 'mcp', 'langgraph', 'index.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const required = [...indexSrc.matchAll(/require\('\.\/nodes\/([A-Za-z0-9_-]+)'\)/g)].map(m => `${m[1]}.js`);
    assert.ok(required.length > 0, 'no node requires found');
    for (const file of required) {
      assert.ok(onDisk.has(file), `missing or case-mismatched: ${file}`);
    }
  });
} finally {
  home.cleanup();
}

console.log(failures === 0 ? '\ninstall layout integrity: OK' : `\ninstall layout integrity: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
