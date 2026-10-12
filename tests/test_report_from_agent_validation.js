'use strict';

const { assertSandbox } = require('./helpers/sandbox_guard');
assertSandbox();

const assert = require('assert');
const { reportFromAgent } = require('../src/mcp/memory_reporting');
const { detectReviewIndependence } = require('../src/sdlc_manager');
const db = require('../src/db');

// Setup DB connection
const dbConn = db.getDb();
const initialToolCalls = dbConn.prepare("SELECT COUNT(*) as count FROM tool_calls WHERE tool = 'report_from_agent'").get().count;
const initialMemories = dbConn.prepare("SELECT COUNT(*) as count FROM persona_memories").get().count;

// 1. Rejection of delegate_to_kage
const res1Raw = reportFromAgent('delegate_to_kage', 'Implemented feature', 'completed', [], [], ['test learning'], process.cwd(), null, null, ['npm test exited 0']);
const res1 = JSON.parse(res1Raw);
assert.strictEqual(res1.status, 'error');
assert.strictEqual(
  res1.message,
  'Invalid agent name: "delegate_to_kage". Direct specialist names (e.g. "kage", "jonin") must be used without delegate_to_ prefix.'
);

// 2. Rejection of delegated_to_kage
const res2Raw = reportFromAgent('delegated_to_kage', 'Implemented feature', 'completed', [], [], ['test learning'], process.cwd(), null, null, ['npm test exited 0']);
const res2 = JSON.parse(res2Raw);
assert.strictEqual(res2.status, 'error');
assert.strictEqual(
  res2.message,
  'Invalid agent name: "delegated_to_kage". Direct specialist names (e.g. "kage", "jonin") must be used without delegate_to_ prefix.'
);

// Assert zero rows inserted in tool_calls and persona_memories
const afterToolCalls = dbConn.prepare("SELECT COUNT(*) as count FROM tool_calls WHERE tool = 'report_from_agent'").get().count;
const afterMemories = dbConn.prepare("SELECT COUNT(*) as count FROM persona_memories").get().count;
assert.strictEqual(afterToolCalls, initialToolCalls, 'Must not insert tool_calls on rejection');
assert.strictEqual(afterMemories, initialMemories, 'Must not insert persona_memories on rejection');

// 3. Acceptance and normalization of valid agent names
const resKageRaw = reportFromAgent('kage', 'Architecture review', 'completed', [], [], null, process.cwd(), null, null, ['npm test exited 0']);
const resKage = JSON.parse(resKageRaw);
assert.strictEqual(resKage.status, 'recorded');
assert.strictEqual(resKage.agent, 'kage');

const resMcpKageRaw = reportFromAgent('mcp_kage', 'Architecture review', 'completed', [], [], null, process.cwd(), null, null, ['npm test exited 0']);
const resMcpKage = JSON.parse(resMcpKageRaw);
assert.strictEqual(resMcpKage.status, 'recorded');
assert.strictEqual(resMcpKage.agent, 'kage');

const resTokubetsuRaw = reportFromAgent('tokubetsu_jonin', 'Documentation report', 'completed', [], [], null, process.cwd(), null, null, ['npm test exited 0']);
const resTokubetsu = JSON.parse(resTokubetsuRaw);
assert.strictEqual(resTokubetsu.status, 'recorded');
assert.strictEqual(resTokubetsu.agent, 'tokubetsu-jonin');

// 4. Review independence evaluates cross-provider
const indSelf = detectReviewIndependence('kage', 'kage');
assert.strictEqual(indSelf.isCrossProvider, false, 'Same agent must not be cross-provider');
assert.strictEqual(indSelf.reviewMode, 'self', 'Same agent must be self-review mode');

const indCross = detectReviewIndependence('jonin', 'kage');
assert.strictEqual(typeof indCross.isCrossProvider, 'boolean');

console.log('test_report_from_agent_validation: PASS');
