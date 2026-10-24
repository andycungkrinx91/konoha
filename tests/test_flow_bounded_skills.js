/**
 * test_flow_bounded_skills.js
 *
 * Verifies flow-bounded skills, turn-by-turn persistence,
 * Task 1 vs Task 2 isolation, and soul-bound anti-slop/ADHD shaping.
 */

'use strict';

const assert = require('assert');
const path = require('path');

const { computeFlowHash, runSannin } = require('../src/mcp/workflow');
const { runMcpAgent } = require('../src/mcp/memory_reporting');
const { useSkills } = require('../src/mcp/skills');
const { executeToolSync } = require('../src/mcp/tool_dispatch');
const personaMemory = require('../src/persona_memory');

const ROOT = path.resolve(__dirname, '..');
const TEST_SESSION = 'test-session-' + Date.now();

console.log('Testing Flow-Bounded Skills & Dynamic Turn-by-Turn Contract:');

// 1. Flow Hash Determinism and Distinctness
const hash1 = computeFlowHash(TEST_SESSION, 'task-001', 'Fix buffer overflow in backend');
const hash2 = computeFlowHash(TEST_SESSION, 'task-002', 'Build marketing landing page');
const hash1_again = computeFlowHash(TEST_SESSION, 'task-001', 'Fix buffer overflow in backend');

assert.strictEqual(typeof hash1, 'string', 'hash1 must be a string');
assert.strictEqual(hash1.length, 12, 'flow_hash must be exactly 12 characters');
assert.strictEqual(hash1, hash1_again, 'flow_hash must be deterministic');
assert.notStrictEqual(hash1, hash2, 'Task 1 and Task 2 must have distinct flow hashes in the same session');
console.log('  ✓ Flow hash generation is deterministic and unique per task flow.');

// 2. Sannin Routes Flow Hash and Domain Skills
const sanninResStr = runSannin(
  'Fix buffer overflow in memory allocator using clang and static-analysis',
  null,
  ROOT,
  TEST_SESSION
);
const sanninRes = JSON.parse(sanninResStr);
assert.strictEqual(sanninRes.status, 'routed', 'Sannin must route the task');
assert.ok(sanninRes.task_id, 'Sannin must return task_id');
assert.ok(sanninRes.flow_hash, 'Sannin must return flow_hash');
assert.strictEqual(sanninRes.flow_hash.length, 12, 'Returned flow_hash must be 12 chars');
assert.ok(Array.isArray(sanninRes.skills), 'Sannin must return routed skills array');
assert.strictEqual(sanninRes.selected_agent, 'anbu', 'C++ memory allocator task routes to anbu');

// Verify routed skills are stored in persona_memories under flow_hash
const flowSkills = personaMemory.getFlowSkills(sanninRes.flow_hash);
assert.ok(Array.isArray(flowSkills), 'getFlowSkills must return an array');
console.log(`  ✓ Sannin routes skills [${sanninRes.skills.join(', ')}] and persists flow_hash: ${sanninRes.flow_hash}`);

// 3. runMcpAgent Turn 1 Injects Active Flow Skills and Soul Behavior
const agentResStr1 = runMcpAgent(
  sanninRes.selected_agent,
  'Investigate buffer overflow issue',
  'src/allocator.c',
  'No memory leaks',
  sanninRes.skills,
  null,
  ROOT,
  sanninRes.task_dir,
  TEST_SESSION,
  sanninRes.flow_hash
);
const agentRes1 = JSON.parse(agentResStr1);
assert.strictEqual(agentRes1.status, 'ready', 'Agent must be ready');
assert.strictEqual(agentRes1.flow_hash, sanninRes.flow_hash, 'Agent must return flow_hash');
assert.ok(agentRes1.instructions.includes('Active Flow Skills'), 'Instructions must declare Active Flow Skills');
assert.ok(agentRes1.instructions.includes(`Bound to Flow ${sanninRes.flow_hash}`), 'Instructions must anchor to flow_hash');
assert.ok(agentRes1.instructions.includes('ADHD Shaping (Soul-Bound)'), 'Instructions must contain soul-bound ADHD shaping');
assert.ok(agentRes1.instructions.includes('Anti-Slop Discipline (Soul-Bound)'), 'Instructions must contain soul-bound anti-slop discipline');
assert.ok(Buffer.byteLength(agentRes1.instructions, 'utf8') < 8000, `Prompt must be < 8000 bytes (got ${Buffer.byteLength(agentRes1.instructions, 'utf8')})`);
console.log('  ✓ Turn 1 prompt binds active flow skills and soul behaviors under 8,000 bytes.');

// 4. Turn-by-Turn Dynamic Skill Loading with use_skills
const useResStr = useSkills(
  ['c-cpp-compilers'],
  'anbu',
  { task_id: sanninRes.task_id, flow_hash: sanninRes.flow_hash, session_id: TEST_SESSION }
);
const useRes = JSON.parse(useResStr);
assert.ok(useRes.status === 'loaded' || useRes.status === 'success' || useRes.name === 'c-cpp-compilers', 'Skill must load');
assert.strictEqual(useRes.flow_hash, sanninRes.flow_hash, 'useSkills must return flow_hash');

// Verify skill is dynamically added to the flow in SQLite
const updatedFlowSkills = personaMemory.getFlowSkills(sanninRes.flow_hash);
assert.ok(updatedFlowSkills.includes('c-cpp-compilers'), 'Newly loaded skill must be bound to flow in SQLite');

// 5. runMcpAgent Turn 2 Retains Loaded Skill Without Amnesia
const agentResStr2 = runMcpAgent(
  sanninRes.selected_agent,
  'Apply compiler patch for allocator',
  null,
  null,
  [], // Empty explicitly passed skills to test persistence from flow
  null,
  ROOT,
  sanninRes.task_dir,
  TEST_SESSION,
  sanninRes.flow_hash
);
const agentRes2 = JSON.parse(agentResStr2);
assert.ok(agentRes2.instructions.includes('c-cpp-compilers'), 'Turn 2 must retain c-cpp-compilers from flow without amnesia');
assert.ok(Buffer.byteLength(agentRes2.instructions, 'utf8') < 8000, 'Turn 2 prompt must be < 8000 bytes');
console.log('  ✓ Turn 2 retains dynamically loaded skills across turns without amnesia.');

// 6. Cross-Task Isolation in Same Session (Task 1 vs Task 2)
const task2Prompt = 'Build landing page in Next.js with hero carousel and 10-theme switcher';
const sanninRes2 = JSON.parse(runSannin(task2Prompt, null, ROOT, TEST_SESSION));
assert.notStrictEqual(sanninRes2.flow_hash, sanninRes.flow_hash, 'Task 2 must have different flow_hash than Task 1');
assert.strictEqual(sanninRes2.selected_agent, 'jonin', 'Next.js task must route to jonin');

const task2Skills = personaMemory.getFlowSkills(sanninRes2.flow_hash);
assert.strictEqual(task2Skills.includes('c-cpp-compilers'), false, 'Task 2 flow must NOT inherit Task 1 C++ skills');

const agentResStrTask2 = runMcpAgent(
  'jonin',
  'Scaffold landing page',
  null,
  null,
  sanninRes2.skills,
  null,
  ROOT,
  sanninRes2.task_dir,
  TEST_SESSION,
  sanninRes2.flow_hash
);
const agentResTask2 = JSON.parse(agentResStrTask2);
assert.strictEqual(agentResTask2.instructions.includes('c-cpp-compilers'), false, 'Task 2 prompt must not contain Task 1 skills');
console.log('  ✓ Cross-task isolation verified: Task 2 is completely isolated from Task 1 in the same session.');

// 7. Direct tool_dispatch invocation with flow_hash forwards cleanly without task_id
const customFlow = 'flow_test_88';
const dispatchUseRes = JSON.parse(executeToolSync('use_skills', {
  skills: ['php-cve-patch-collection-maintenance'],
  flow_hash: customFlow
}, 'anbu'));
assert.strictEqual(dispatchUseRes.flow_hash, customFlow, 'use_skills must forward flow_hash from args');

const flowMemSkills = personaMemory.getFlowSkills(customFlow);
assert.ok(flowMemSkills.includes('php-cve-patch-collection-maintenance'), 'Skill loaded via dispatchTool with flow_hash must be recorded in SQLite');

const dispatchGetRes = JSON.parse(executeToolSync('get_skill', {
  name: 'clang',
  flow_hash: customFlow
}, 'anbu'));
assert.strictEqual(dispatchGetRes.flow_hash, customFlow, 'get_skill must forward flow_hash from args');
assert.ok(personaMemory.getFlowSkills(customFlow).includes('clang'), 'Skill retrieved via get_skill with flow_hash must be recorded in SQLite');

const dispatchFindRes = JSON.parse(executeToolSync('find_skill', {
  keyword: 'compiler',
  flow_hash: customFlow
}, 'anbu'));
assert.ok(dispatchFindRes.found > 0, 'find_skill must find skills when flow_hash passed');
console.log('  ✓ Direct tool_dispatch with flow_hash cleanly binds to SQLite without task_id.');

console.log('\nAll flow-bounded skill tests passed successfully!');
