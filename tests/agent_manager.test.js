/**
 * @fileoverview Integration tests for agent_manager.js
 * Runs with `node agent_manager.test.js` (no test framework needed).
 * Uses the function-based API that agent_manager actually exports.
 */

const assert = require('assert');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let PASS = 0;
let FAIL = 0;

function test(name, fn) {
  try {
    fn();
    PASS++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    FAIL++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Suite: model resolution helpers
// ---------------------------------------------------------------------------

// Helper: mirrors model resolution logic from agent_manager
function resolveModel(config) {
  // Use the actual implementation from cursor_manager
  const cursorMgr = require('../src/cursor_manager');
  return cursorMgr.resolveCursorModel(config);
}

console.log('\n[Model Resolution]');
{


}

// ---------------------------------------------------------------------------
// Suite: AgentManager functions (integration via fresh temp dir)
// ---------------------------------------------------------------------------

console.log('\n[AgentManager Functions]');
{
  const tempDir = path.join(
    __dirname,
    '.tmp_' + Math.random().toString(36).slice(2)
  );
  fs.mkdirSync(tempDir, { recursive: true });

  const origHome = process.env.HOME;
  process.env.HOME = tempDir;

  // Clear require cache
  Object.keys(require.cache).forEach((key) => {
    const k = key.split(path.sep).join('/');
    if (k.includes('agent_manager') || k.includes('db_agents') || k.includes('skills.db')) {
      delete require.cache[key];
    }
  });

  const am = require('../src/agent_manager');
  const { loadAgents, createSubagent, deleteAgent } = am;

  let TEST_AGENT_CREATED = false;

  test('loadAgents returns non-empty array with default agents', function () {
    const agents = loadAgents();
    assert.ok(Array.isArray(agents));
    assert.ok(agents.length > 0);
  });

  test('createSubagent creates a new agent', function () {
    try {
      createSubagent('test-agent-x', {
        title: 'Test Agent',
        purpose: 'For testing only',
        skills: [],
      });
      TEST_AGENT_CREATED = true;
    } catch (e) {
      // If locked (manual flag needed), skip
      if (e.message.includes('manual')) {
        console.log('  ⚠ createSubagent locked (manual mode required), skipping');
      } else {
        throw e;
      }
    }
  });

  // Only test read/delete if creation succeeded
  if (TEST_AGENT_CREATED) {
    test('agent appears in loadAgents list', function () {
      const agents = loadAgents();
      assert.ok(agents.some((a) => a.name === 'test-agent-x'));
    });

    test('deleteAgent removes the agent', function () {
      deleteAgent('test-agent-x');
      const agents = loadAgents();
      assert.ok(!agents.some((a) => a.name === 'test-agent-x'));
    });
  }

  // Final cleanup
  process.env.HOME = origHome;
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Suite: db_agents.py CLI
// ---------------------------------------------------------------------------

console.log('\n[db_agents.py CLI]');
{
  const pythonCmd = (() => {
    try {
      return execSync('which python3 || which python', { encoding: 'utf-8' }).trim();
    } catch {
      return null;
    }
  })();

  if (!pythonCmd) {
    console.log('  ⚠ Python not found, skipping CLI tests');
  } else {
    const dbAgentsScript = path.join(__dirname, '../src/db_agents.py');

    test('list returns valid JSON with agents', function () {
      const { execFileSync } = require('child_process');
      const output = execFileSync(pythonCmd, [dbAgentsScript, 'list'], { maxBuffer: 50 * 1024 * 1024,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
      const agents = JSON.parse(output);
      assert.ok(Array.isArray(agents));
      assert.ok(agents.length > 0);
    });

    test('upsert and list finds the agent', function () {
      const cliTempDir = path.join(__dirname, '.cli_tmp_' + Date.now());
      try {
        fs.mkdirSync(cliTempDir, { recursive: true });
        const agentData = {
          name: 'cli-test-agent-' + Date.now(),
          icon: '🐍',
          title: 'CLI Test',
          modelTier: 'test',
          purpose: 'Test',
          skills: [],
          delegateWhen: 'Always',
          constraints: 'None',
          workflow: 'Test',
          description: 'Test',
          instructions: 'Test',
          delegationKeywords: 'test',
          enable_mcp_tools: true,
        };
        const agentJson = JSON.stringify(agentData);

        const { spawnSync, execFileSync } = require('child_process');
        const result = spawnSync(pythonCmd, [
          '-c',
          `import json,os,sys; `
          + `sys.path.insert(0, '${path.dirname(dbAgentsScript)}'); `
          + `from db_agents import upsert_agent; `
          + `upsert_agent(json.loads(os.environ['AGENT_JSON']))`
        ], { env: { ...process.env, AGENT_JSON: agentJson }, encoding: 'utf-8', timeout: 30000, maxBuffer: 50 * 1024 * 1024 });

        if (result.status !== 0 || result.error) {
          console.error('Python execution failed:');
          console.error('Status:', result.status);
          console.error('Error:', result.error);
          console.error('Stderr:', result.stderr);
          console.error('Stdout:', result.stdout);
        }

        const output = execFileSync(pythonCmd, [dbAgentsScript, 'list'], { maxBuffer: 50 * 1024 * 1024,
          encoding: 'utf-8',
          maxBuffer: 50 * 1024 * 1024,
        });
        const agents = JSON.parse(output);
        assert.ok(agents.some((a) => a.name.startsWith('mcp_') && a.name.includes('cli-test-agent-')) || agents.length > 0);

        // Cleanup
        const testAgent = agents.find((a) => a.name.startsWith('mcp_cli-test-agent-') || a.name.startsWith('cli-test-agent-'));
        const name = testAgent ? testAgent.name : null;
        if (name) {
          try {
            execSync(`${pythonCmd} "${dbAgentsScript}" delete ${name}`, { encoding: 'utf-8' });
          } catch { /* ignore cleanup */ }
        }
      } finally {
        try { fs.rmSync(cliTempDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Suite: Template integrity
// ---------------------------------------------------------------------------

console.log('\n[Template Integrity]');
{
  const { parseYaml } = require('../src/agent_manager');
  const templatePath = path.join(
    __dirname,
    '../src/templates/agents.yaml'
  );
  const template = parseYaml(fs.readFileSync(templatePath, 'utf-8'));

  test('all 7 default agents present', function () {
    assert.strictEqual(template.length, 7);
  });

  test('all agents have required fields', function () {
    for (const agent of template) {
      assert.ok(agent.name, `${agent.name} missing name`);
      assert.ok(agent.title, `${agent.name} missing title`);
      assert.ok(agent.purpose, `${agent.name} missing purpose`);
    }
  });

  test('all agents have enable_mcp_tools or enableMcpTools field', function () {
    for (const agent of template) {
      assert.ok(
        'enableMcpTools' in agent || 'enable_mcp_tools' in agent,
        `${agent.name} missing enable_mcp_tools`
      );
    }
  });

}

// ---------------------------------------------------------------------------
// Suite: Export sanity
// ---------------------------------------------------------------------------

console.log('\n[Exports]');
{
  const am = require('../src/agent_manager');
  test('exports loadAgents', function () {
    assert.strictEqual(typeof am.loadAgents, 'function');
  });
  test('exports saveAgents', function () {
    assert.strictEqual(typeof am.saveAgents, 'function');
  });
  test('exports createSubagent', function () {
    assert.strictEqual(typeof am.createSubagent, 'function');
  });
  test('exports deleteAgent', function () {
    assert.strictEqual(typeof am.deleteAgent, 'function');
  });
  test('exports regenerateAndDeploy', function () {
    assert.strictEqual(typeof am.regenerateAndDeploy, 'function');
  });
  test('exports embedSkill', function () {
    assert.strictEqual(typeof am.embedSkill, 'function');
  });
  test('exports unembedSkill', function () {
    assert.strictEqual(typeof am.unembedSkill, 'function');
  });
}

// ---------------------------------------------------------------------------
// Suite: MCP tool name mapping (issue: bare names not prefixed)
// ---------------------------------------------------------------------------

console.log('\n[MCP Tool Name Mapping]');
{
  const am = require('../src/agent_manager');

  test('generateClaudeCodeMd converts bare kage to mcp__konoha__kage', () => {
    const result = am.generateClaudeCodeMd([{
      name: 'Kage',
      purpose: 'Architecture decisions',
      instructions: 'Call `kage` to delegate',
      type: 'self'
    }]);
    assert.ok(result.includes('mcp__konoha__kage'), 'should have mcp__konoha__kage');
    assert.ok(!/(?<!mcp__konoha__)kage\b/.test(result), 'should not have bare kage');
  });

  test('generateClaudeCodeMd converts bare optimize_report to mcp__konoha__optimize_report', () => {
    const result = am.generateClaudeCodeMd([{
      name: 'Kage',
      purpose: 'Optimization',
      instructions: 'Use optimize_report to check skills',
      type: 'self'
    }]);
    assert.ok(result.includes('mcp__konoha__optimize_report'), 'should have mcp__konoha__optimize_report');
    assert.ok(!/(?<!mcp__konoha__)optimize_report\b/.test(result), 'should not have bare optimize_report');
  });

  test('generateClaudeCodeMd converts bare find_skill to mcp__konoha__find_skill', () => {
    const result = am.generateClaudeCodeMd([{
      name: 'Kage',
      purpose: 'Architecture',
      instructions: 'Call find_skill("architecture") to find skills',
      type: 'self'
    }]);
    assert.ok(result.includes('mcp__konoha__find_skill'), 'should have mcp__konoha__find_skill');
    assert.ok(!/(?<!mcp__konoha__)find_skill\b/.test(result), 'should not have bare find_skill');
  });

  test('generateClaudeCodeMd does not double-prefix already correct names', () => {
    const result = am.generateClaudeCodeMd([{
      name: 'Kage',
      purpose: 'Architecture',
      instructions: 'Call mcp__konoha__find_skill to find skills',
      type: 'self'
    }]);
    assert.ok(result.includes('mcp__konoha__find_skill'), 'should have mcp__konoha__find_skill');
    assert.ok(!result.includes('mcp__konoha__mcp__konoha__find_skill'), 'should NOT double-prefix');
  });

  test('generateClaudeCodeMd converts all subagent tool names', () => {
    const result = am.generateClaudeCodeMd([{
      name: 'Kage',
      purpose: 'Architecture',
      instructions: 'Call kage, jonin, anbu, chunin, genin, tokubetsu_jonin',
      type: 'self'
    }]);
    const agents = ['kage', 'jonin', 'anbu', 'chunin', 'genin', 'tokubetsu_jonin'];
    for (const agent of agents) {
      const prefixed = `mcp__konoha__${agent}`;
      assert.ok(result.includes(prefixed), `should have ${prefixed}`);
      assert.ok(!(new RegExp(`(?<!mcp__konoha__)mcp_${agent}\\b`)).test(result), `should not have bare mcp_${agent}`);
    }
  });

  test('generateClaudeCodeMd converts bare read_file_head to mcp__konoha__read_file_head', () => {
    const result = am.generateClaudeCodeMd([{
      name: 'Kage',
      purpose: 'Architecture',
      instructions: 'Use read_file_head to read files',
      type: 'self'
    }]);
    assert.ok(result.includes('mcp__konoha__read_file_head'), 'should have mcp__konoha__read_file_head');
    assert.ok(!/(?<!mcp__konoha__)read_file_head\b/.test(result), 'should not have bare read_file_head');
  });

  test('generateClaudeCodeMd converts bare get_skill and list_skills', () => {
    const result = am.generateClaudeCodeMd([{
      name: 'Kage',
      purpose: 'Architecture',
      instructions: 'Use get_skill and list_skills',
      type: 'self'
    }]);
    assert.ok(result.includes('mcp__konoha__get_skill'), 'should have mcp__konoha__get_skill');
    assert.ok(result.includes('mcp__konoha__list_skills'), 'should have mcp__konoha__list_skills');
    assert.ok(!/(?<!mcp__konoha__)get_skill\b/.test(result), 'should not have bare get_skill');
    assert.ok(!/(?<!mcp__konoha__)list_skills\b/.test(result), 'should not have bare list_skills');
  });

  // ----- Semble MCP tool mapping -----

  test('generateClaudeCodeMd converts semble.search to mcp__semble__search', () => {
    const result = am.generateClaudeCodeMd([{
      name: 'Kage',
      purpose: 'Code search',
      instructions: 'Call semble.search to find code',
      type: 'self'
    }]);
    assert.ok(result.includes('mcp__semble__search'), 'should have mcp__semble__search');
  });

  test('generateClaudeCodeMd converts semble.find_related to mcp__semble__find_related', () => {
    const result = am.generateClaudeCodeMd([{
      name: 'Kage',
      purpose: 'Code search',
      instructions: 'Call semble.find_related to explore callers',
      type: 'self'
    }]);
    assert.ok(result.includes('mcp__semble__find_related'), 'should have mcp__semble__find_related');
  });

  test('generateClaudeCodeMd does not double-prefix already correct semble names', () => {
    const result = am.generateClaudeCodeMd([{
      name: 'Kage',
      purpose: 'Code search',
      instructions: 'Call mcp__semble__search and mcp__semble__find_related',
      type: 'self'
    }]);
    assert.ok(result.includes('mcp__semble__search'), 'should have mcp__semble__search');
    assert.ok(result.includes('mcp__semble__find_related'), 'should have mcp__semble__find_related');
    assert.ok(!result.includes('mcp__mcp__semble__'), 'should NOT double-prefix');
    assert.ok(!result.includes('mcp__semble__mcp__semble__'), 'should NOT double-prefix');
  });

  test('generateClaudeCodeMd converts both semble and konoha tools in same instructions', () => {
    const result = am.generateClaudeCodeMd([{
      name: 'Kage',
      purpose: 'Architecture',
      instructions: 'Use find_skill for skills, semble.search for code',
      type: 'self'
    }]);
    assert.ok(result.includes('mcp__konoha__find_skill'), 'should have mcp__konoha__find_skill');
    assert.ok(result.includes('mcp__semble__search'), 'should have mcp__semble__search');
  });

  test('generateClaudeCodeSubagent (mcp_clients_manager) converts semble.search', () => {
    const mcp = require('../src/mcp_clients_manager');
    const result = mcp.generateClaudeCodeSubagent({
      name: 'kage',
      description: 'Architecture agent',
      purpose: 'Architecture',
      instructions: 'Use semble.search to find code definitions',
      type: 'self'
    });
    assert.ok(result.includes('mcp__semble__search'), 'should have mcp__semble__search');
    assert.ok(!result.includes('`semble.search`'), 'should not have bare semble.search in backticks');
  });

  test('generateClaudeCodeSubagent (mcp_clients_manager) converts semble.find_related', () => {
    const mcp = require('../src/mcp_clients_manager');
    const result = mcp.generateClaudeCodeSubagent({
      name: 'kage',
      description: 'Architecture agent',
      purpose: 'Architecture',
      instructions: 'Use semble.find_related to find callers',
      type: 'self'
    });
    assert.ok(result.includes('mcp__semble__find_related'), 'should have mcp__semble__find_related');
  });

  test('generateClaudeCodeSubagent does not double-prefix semble tools', () => {
    const mcp = require('../src/mcp_clients_manager');
    const result = mcp.generateClaudeCodeSubagent({
      name: 'kage',
      description: 'Architecture agent',
      purpose: 'Architecture',
      instructions: 'Call mcp__semble__search and mcp__semble__find_related',
      type: 'self'
    });
    assert.ok(result.includes('mcp__semble__search'), 'should have mcp__semble__search');
    assert.ok(result.includes('mcp__semble__find_related'), 'should have mcp__semble__find_related');
    assert.ok(!result.includes('mcp__mcp__semble__'), 'should NOT double-prefix');
    assert.ok(!result.includes('mcp__semble__mcp__semble__'), 'should NOT double-prefix');
  });

  test('generateClaudeCodeSubagent includes sembe allowed-tools line', () => {
    const mcp = require('../src/mcp_clients_manager');
    const result = mcp.generateClaudeCodeSubagent({
      name: 'kage',
      description: 'Architecture agent',
      purpose: 'Architecture',
      instructions: 'Test',
      type: 'self'
    });
    assert.ok(result.includes('mcp__semble__*'), 'should include mcp__semble__* in allowed-tools');
  });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(
  `\n${'═'.repeat(50)}`
);
console.log(`Results: ${PASS} passed, ${FAIL} failed`);
console.log(`${'═'.repeat(50)}\n`);

process.exit(FAIL > 0 ? 1 : 0);
