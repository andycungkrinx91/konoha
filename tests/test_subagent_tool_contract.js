'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const contract = require(path.join(ROOT, 'src/mcp/subagent_tool_contract'));
const { buildSubagentMcpBlock } = require(path.join(ROOT, 'src/mcp/memory_subagent_runner'));

const attachedStatus = { mcpKonoha: true, mcpAislop: true };
const detachedStatus = { mcpKonoha: false, mcpAislop: false };

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

function run() {
  console.log('test_subagent_tool_contract');
  let ok = true;

  ok = runCase('explicit handshake true keeps the catalog', () => {
    const policy = contract.resolveSubagentToolPolicy({ client: 'omp', mcpAttached: true });
    assert.strictEqual(policy.attached, true);
    assert.strictEqual(policy.source, 'dispatch_handshake');
    const block = buildSubagentMcpBlock('omp', 'jonin', { mcpAttached: true, statusResolver: () => detachedStatus });
    assert.ok(block.includes('mcp__konoha__read_file_range'), 'catalog rows missing');
  }) && ok;

  ok = runCase('detached client emits no catalog rows', () => {
    const block = buildSubagentMcpBlock('cursor', 'jonin', { statusResolver: () => detachedStatus });
    assert.ok(!block.includes('- `mcp__konoha__'), 'catalog rows leaked into a detached session');
    assert.ok(!block.includes('- `mcp__semble__'), 'semble rows leaked into a detached session');
    assert.ok(block.includes('No Konoha MCP server is registered'), 'detached note missing');
    assert.ok(Buffer.byteLength(block, 'utf8') < 400, `detached note too large: ${Buffer.byteLength(block, 'utf8')}`);
  }) && ok;

  ok = runCase('registered client keeps the catalog', () => {
    const block = buildSubagentMcpBlock('claude', 'anbu', { statusResolver: () => attachedStatus });
    assert.ok(block.includes('mcp__konoha__read_file_head'), 'catalog rows missing');
    assert.ok(block.includes('mcp__aislop__aislop_fix'), 'anbu must keep aislop_fix');
  }) && ok;

  ok = runCase('status without registration fields is treated as unverified', () => {
    const policy = contract.resolveSubagentToolPolicy({ client: 'pi', statusResolver: () => ({ installed: true }) });
    assert.strictEqual(policy.attached, true);
    assert.strictEqual(policy.source, 'unverified');
  }) && ok;

  ok = runCase('status lookup failure never drops the catalog', () => {
    const policy = contract.resolveSubagentToolPolicy({
      client: 'codex',
      statusResolver: () => { throw new Error('config unreadable'); }
    });
    assert.strictEqual(policy.attached, true);
    assert.strictEqual(policy.source, 'status_error');
  }) && ok;

  ok = runCase('no active client is unverified, not detached', () => {
    const policy = contract.resolveSubagentToolPolicy({ client: null, statusResolver: () => detachedStatus });
    assert.strictEqual(policy.attached, true);
    assert.strictEqual(policy.source, 'unverified');
  }) && ok;

  ok = runCase('detached note is far smaller than the catalog block', () => {
    const attached = buildSubagentMcpBlock('omp', 'jonin', { statusResolver: () => attachedStatus });
    const detached = buildSubagentMcpBlock('omp', 'jonin', { statusResolver: () => detachedStatus });
    const saved = Buffer.byteLength(attached, 'utf8') - Buffer.byteLength(detached, 'utf8');
    assert.ok(saved > 1000, `expected >1000 bytes saved, got ${saved}`);
  }) && ok;

  ok = runCase('unknown agent still receives the full catalog', () => {
    const block = buildSubagentMcpBlock('omp', 'mystery-ninja', { statusResolver: () => attachedStatus });
    assert.ok(block.includes('mcp__konoha__use_skills'), 'unknown agent lost the catalog');
  }) && ok;

  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  return ok;
}

if (require.main === module) {
  const passed = run();
  process.exit(passed ? 0 : 1);
}

module.exports = { run };
