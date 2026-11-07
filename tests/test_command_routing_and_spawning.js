'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { spawnSync } = require('child_process');

const {
  parseKonohaCommandInvocation,
  routeByKeywordsWithPrompt,
  classifyExecutionTrack,
  runSannin
} = require('../src/mcp/workflow_sannin');
const { runMcpWorkflow } = require('../src/mcp/workflow_runner');
const { reportFromAgent } = require('../src/mcp/memory_project_context');
const { resolveSpawnDescriptor, buildSpawnDirective } = require('../src/mcp/lazy_subagent');
const { ensureAntigravityMcpSchemas } = require('../src/antigravity_manager');

function runTests() {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-test-routing-'));

  try {
    const kCmd = parseKonohaCommandInvocation('/konoha build a fullstack billing service and React dashboard');
    assert.strictEqual(kCmd.invocationMode, 'konoha_orchestrator');
    assert.strictEqual(kCmd.targetAgent, null);
    assert.strictEqual(kCmd.cleanPrompt, 'build a fullstack billing service and React dashboard');
    assert.strictEqual(classifyExecutionTrack('/konoha build a fullstack billing service and React dashboard'), 'full_sdlc', '/konoha must preserve full_sdlc track for complex prompts');

    const subCmd = parseKonohaCommandInvocation('/anbu fix race condition in webhook handler');
    assert.strictEqual(subCmd.invocationMode, 'direct_subagent');
    assert.strictEqual(subCmd.targetAgent, 'anbu');
    assert.strictEqual(subCmd.cleanPrompt, 'fix race condition in webhook handler');
    assert.strictEqual(classifyExecutionTrack('/anbu fix race condition in webhook handler'), 'fast_track', '/<subagent-name> must use fast_track direct execution');

    const yamanakaCmd = parseKonohaCommandInvocation('/yamanaka generate a low-poly 3D pagoda in Blender');
    assert.strictEqual(yamanakaCmd.invocationMode, 'direct_subagent');
    assert.strictEqual(yamanakaCmd.targetAgent, 'yamanaka');
    assert.strictEqual(routeByKeywordsWithPrompt(tmpBase, '/yamanaka generate a low-poly 3D pagoda in Blender'), 'yamanaka');

    const directTaskDir = path.join(tmpBase, 'task_direct_anbu');
    fs.mkdirSync(directTaskDir, { recursive: true });
    const sanninDirectRaw = runSannin('/anbu fix webhook signature check', directTaskDir, tmpBase, 'sess_test_1');
    const sanninDirect = JSON.parse(sanninDirectRaw);
    assert.strictEqual(sanninDirect.invocation_mode, 'direct_subagent');
    assert.strictEqual(sanninDirect.selected_agent, 'anbu');
    assert.strictEqual(sanninDirect.mandatory_kage_review, true);

    const wfStep1Raw = runMcpWorkflow(directTaskDir, { prompt: '/anbu fix webhook signature check', project_path: tmpBase });
    const wfStep1 = JSON.parse(wfStep1Raw);
    assert.strictEqual(wfStep1.phase, 'execute', 'Direct subagent invocation must bypass explore/plan and enter execute directly');
    assert.strictEqual(wfStep1.agent, 'anbu', 'Direct subagent invocation must dispatch only the requested subagent');

    reportFromAgent({
      agentName: 'anbu',
      summary: 'Fixed webhook signature check with constant-time comparison.',
      status: 'completed',
      filesModified: ['src/webhook.js'],
      validation: ['node tests/test_webhook.js exited 0'],
      projectPath: tmpBase,
      taskDir: directTaskDir,
      dispatchId: wfStep1.dispatch_id,
      taskId: wfStep1.task_id
    });

    const wfStep2Raw = runMcpWorkflow(directTaskDir, { project_path: tmpBase });
    const wfStep2 = JSON.parse(wfStep2Raw);
    assert.strictEqual(wfStep2.phase, 'review', 'Direct subagent completion must transition immediately to mandatory Kage review');
    assert.strictEqual(wfStep2.agent, 'kage', 'Mandatory review after direct subagent must be assigned to kage');

    const clients = ['antigravity', 'cursor', 'claude', 'commandcode', 'opencode', 'codex', 'pi', 'omp'];
    for (const c of clients) {
      const desc = resolveSpawnDescriptor(c);
      assert.ok(desc && desc.tool, `Client ${c} must have a valid subagent spawn descriptor`);
      const directive = buildSpawnDirective({ client: c, agent: 'anbu', prompt: 'test' });
      assert.ok(directive.includes('anbu'), `Spawn directive for ${c} must reference target agent`);
    }

    const cliPath = path.resolve(__dirname, '..', 'bin', 'cli.js');
    const runAgentRes = spawnSync(process.execPath, [
      cliPath, 'run-agent', '--agent', 'anbu', '--task', 'Verify backend health check endpoint', '--project-path', tmpBase
    ], { encoding: 'utf8' });
    assert.strictEqual(runAgentRes.status, 0, 'konoha run-agent CLI must succeed');
    const runAgentJson = JSON.parse(runAgentRes.stdout.trim());
    assert.strictEqual(runAgentJson.status, 'ready');
    assert.strictEqual(runAgentJson.agent, 'anbu');
    assert.strictEqual(runAgentJson.mandatory_next_step, 'kage_review', 'run-agent output must enforce mandatory_next_step=kage_review');

    const schemaRes = ensureAntigravityMcpSchemas({ home: tmpBase });
    assert.strictEqual(schemaRes.ok, true);
    const konohaSchemaDir = path.join(tmpBase, '.gemini', 'antigravity-cli', 'mcp', 'konoha');
    assert.strictEqual(fs.existsSync(path.join(konohaSchemaDir, 'yamanaka.json')), true, 'Antigravity MCP schemas must include yamanaka.json');
    assert.strictEqual(fs.existsSync(path.join(konohaSchemaDir, 'read_file_range.json')), true, 'Antigravity MCP schemas must include full manifest tools');
    const anbuSchema = JSON.parse(fs.readFileSync(path.join(konohaSchemaDir, 'anbu.json'), 'utf8'));
    const anbuProps = (anbuSchema.inputSchema || anbuSchema.parameters || {}).properties || {};
    assert.ok(anbuProps.task, 'Subagent MCP schema must expose structured task parameter');
    assert.ok(anbuProps.skills, 'Subagent MCP schema must expose structured skills parameter');

    console.log('PASS: test_command_routing_and_spawning.js');
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

runTests();
