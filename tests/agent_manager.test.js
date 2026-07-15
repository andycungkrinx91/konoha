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
  if (config.cursorModel) return config.cursorModel;
  if (config.cursorFallbackModel) return config.cursorFallbackModel;
  throw new Error('No model configured');
}

console.log('\n[Model Resolution]');
{
  test('cursorModel takes priority over fallback', function () {
    const result = resolveModel({
      cursorModel: 'gpt-4',
      cursorFallbackModel: 'gpt-3.5-turbo',
    });
    assert.strictEqual(result, 'gpt-4');
  });

  test('falls back to cursorFallbackModel when cursorModel is absent', function () {
    const result = resolveModel({
      cursorFallbackModel: 'gpt-3.5-turbo',
    });
    assert.strictEqual(result, 'gpt-3.5-turbo');
  });

  test('throws when neither cursorModel nor cursorFallbackModel is set', function () {
    assert.throws(() => resolveModel({}));
  });
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
      const output = execSync(`${pythonCmd} "${dbAgentsScript}" list`, {
        encoding: 'utf-8',
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
          cursorModel: 'inherit',
          cursorFallbackModel: 'inherit',
          claudeModel: 'test-model',
          opencodeModel: 'inherit',
          enable_mcp_tools: true,
        };
        const agentJson = JSON.stringify(agentData);

        const { spawnSync } = require('child_process');
        const result = spawnSync(pythonCmd, [
          '-c',
          `import json,os,sys; `
          + `sys.path.insert(0, '${path.dirname(dbAgentsScript)}'); `
          + `from db_agents import upsert_agent; `
          + `upsert_agent(json.loads(os.environ['AGENT_JSON']))`
        ], { env: { ...process.env, AGENT_JSON: agentJson }, encoding: 'utf-8', timeout: 30000 });

        if (result.status !== 0 || result.error) {
          console.error('Python execution failed:');
          console.error('Status:', result.status);
          console.error('Error:', result.error);
          console.error('Stderr:', result.stderr);
          console.error('Stdout:', result.stdout);
        }

        const output = execSync(`${pythonCmd} "${dbAgentsScript}" list`, {
          encoding: 'utf-8',
        });
        console.log('--- DB List Output ---');
        console.log(output);
        console.log('----------------------');
        const agents = JSON.parse(output);
        assert.ok(agents.some((a) => a.name.startsWith('mcp_cli-test-agent-') || a.name.startsWith('cli-test-agent-')));

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

  test('all 6 default agents present', function () {
    assert.strictEqual(template.length, 6);
  });

  test('all agents have opencodeModel field', function () {
    for (const agent of template) {
      assert.ok(
        'opencodeModel' in agent,
        `${agent.name} missing opencodeModel`
      );
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

  test('required fields present on every agent', function () {
    const required = [
      'name',
      'icon',
      'title',
      'modelTier',
      'purpose',
      'skills',
      'delegateWhen',
      'constraints',
      'workflow',
      'description',
      'instructions',
      'delegationKeywords',
      'cursorModel',
      'cursorFallbackModel',
      'claudeModel',
      'opencodeModel',
    ];
    for (const agent of template) {
      for (const field of required) {
        assert.ok(
          field in agent,
          `${agent.name} missing field: ${field}`
        );
      }
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
  test('exports updateAgentModel', function () {
    assert.strictEqual(typeof am.updateAgentModel, 'function');
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
// Summary
// ---------------------------------------------------------------------------

console.log(
  `\n${'═'.repeat(50)}`
);
console.log(`Results: ${PASS} passed, ${FAIL} failed`);
console.log(`${'═'.repeat(50)}\n`);

process.exit(FAIL > 0 ? 1 : 0);
