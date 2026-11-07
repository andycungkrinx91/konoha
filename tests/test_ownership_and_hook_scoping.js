'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { spawnSync } = require('child_process');

const { cleanObsoleteAgentDirs, injectManagedConfig, isProtectedUserPath } = require('../src/agent_deployer');
const { _pruneStaleAgentDirs } = require('../src/antigravity_agents');
const { cleanStaleSessionAgents } = require('../src/antigravity_subagent_hook');
const { pruneWorkspacePollution } = require('../src/deploy_utils');
const { isKonohaInvocationPrompt, isKonohaSessionActive } = require('../src/hook-base');
const { buildClaudeCodeBashGuardSource } = require('../src/mcp_clients/claude_code_hooks');
const { buildPiBlockerExtensionSource } = require('../src/pi_blocker_template');

function runTests() {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-test-ownership-'));
  const prevKonohaHome = process.env.KONOHA_HOME;
  process.env.KONOHA_HOME = path.join(tmpBase, '.konoha');

  try {
    const customAgentDir = path.join(tmpBase, '.gemini', 'antigravity', 'agents', 'my-custom-agent');
    const customConvDir = path.join(tmpBase, '.gemini', 'antigravity', 'conversations', 'conv-123');
    const cursorAgentFile = path.join(tmpBase, '.cursor', 'agents', 'user-specialist.md');
    fs.mkdirSync(customAgentDir, { recursive: true });
    fs.mkdirSync(customConvDir, { recursive: true });
    fs.mkdirSync(path.dirname(cursorAgentFile), { recursive: true });
    fs.writeFileSync(path.join(customAgentDir, 'agent.json'), JSON.stringify({ name: 'my-custom-agent' }));
    fs.writeFileSync(path.join(customConvDir, 'history.jsonl'), '{"step":1}\n');
    fs.writeFileSync(cursorAgentFile, '# User Specialist\n');

    assert.strictEqual(isProtectedUserPath(customAgentDir), true, 'agents/ directory must be recognized as protected');
    assert.strictEqual(isProtectedUserPath(customConvDir), true, 'conversations/ directory must be recognized as protected');

    cleanObsoleteAgentDirs(tmpBase);
    assert.strictEqual(fs.existsSync(customAgentDir), true, 'cleanObsoleteAgentDirs must NEVER delete agents/');
    assert.strictEqual(fs.existsSync(customConvDir), true, 'cleanObsoleteAgentDirs must NEVER delete conversations/');
    assert.strictEqual(fs.existsSync(cursorAgentFile), true, 'cleanObsoleteAgentDirs must NEVER delete .cursor/agents/');

    _pruneStaleAgentDirs(path.join(tmpBase, '.gemini', 'antigravity', 'agents'), new Set(['sannin.json']));
    assert.strictEqual(fs.existsSync(customAgentDir), true, '_pruneStaleAgentDirs must NEVER delete non-Konoha agent directories');

    cleanStaleSessionAgents();
    assert.strictEqual(fs.existsSync(customAgentDir), true, 'cleanStaleSessionAgents must NEVER delete custom agents');

    const wsSkillDir = path.join(tmpBase, 'workspace', '.agents', 'skills', 'user-skill');
    const wsClaudeDir = path.join(tmpBase, 'workspace', '.claude', 'agents');
    fs.mkdirSync(wsSkillDir, { recursive: true });
    fs.mkdirSync(wsClaudeDir, { recursive: true });
    fs.writeFileSync(path.join(wsSkillDir, 'SKILL.md'), '# User Skill\n');
    fs.writeFileSync(path.join(wsClaudeDir, 'custom.md'), '# Claude Custom Agent\n');

    pruneWorkspacePollution(path.join(tmpBase, 'workspace'));
    assert.strictEqual(fs.existsSync(wsSkillDir), true, 'pruneWorkspacePollution must NEVER delete user workspace .agents/skills');
    assert.strictEqual(fs.existsSync(wsClaudeDir), true, 'pruneWorkspacePollution must NEVER delete user workspace .claude/agents');

    const mdFile = path.join(tmpBase, 'GEMINI.md');
    fs.writeFileSync(mdFile, '# User Top Header\n\nCustom instructions above.\n\n<!-- KONOHA-START -->\nold konoha\n<!-- KONOHA-END -->\n\n# User Bottom Footer\nKeep this footer.\n');
    const mergedMd = injectManagedConfig(mdFile, '<!-- KONOHA-START -->\nnew konoha\n<!-- KONOHA-END -->', {
      client: 'antigravity',
      scope: 'global'
    });
    assert.ok(mergedMd.includes('# User Top Header'), 'Text before KONOHA-START must be preserved');
    assert.ok(mergedMd.includes('# User Bottom Footer'), 'Text after KONOHA-END must be preserved');
    assert.ok(mergedMd.includes('new konoha'), 'Konoha managed section must be updated');

    assert.strictEqual(isKonohaInvocationPrompt('/konoha build an app'), true, '/konoha must activate Konoha context');
    assert.strictEqual(isKonohaInvocationPrompt('/anbu fix bug'), true, '/anbu must activate Konoha context');
    assert.strictEqual(isKonohaInvocationPrompt('/yamanaka create a 3d sword'), true, '/yamanaka must activate Konoha context');
    assert.strictEqual(isKonohaInvocationPrompt('Hello, how do I center a div in CSS?'), false, 'Normal message must NOT activate Konoha context');
    assert.strictEqual(isKonohaSessionActive({ prompt: 'Normal question' }, {}), false, 'Normal session without Konoha markers must NOT be active');

    const normalTranscript = path.join(tmpBase, 'normal_transcript.jsonl');
    fs.writeFileSync(normalTranscript, JSON.stringify({ type: 'USER_INPUT', content: 'Just a normal native question' }) + '\n');

    const promptHookPath = path.resolve(__dirname, '..', 'src', 'prompt_hook.js');
    const normalPromptRes = spawnSync(process.execPath, [promptHookPath], {
      input: JSON.stringify({ transcriptPath: normalTranscript }),
      encoding: 'utf8',
      env: { ...process.env, KONOHA_HOME: process.env.KONOHA_HOME }
    });
    assert.strictEqual(normalPromptRes.status, 0, 'prompt_hook must exit 0 on normal prompt');
    assert.strictEqual(normalPromptRes.stdout.trim(), '', 'Normal prompt must NOT have Konoha nudge injected');

    const reminderHookPath = path.resolve(__dirname, '..', 'src', 'workflow', 'sannin-orchestrator', 'workflow_reminder.js');
    const normalReminderRes = spawnSync(process.execPath, [reminderHookPath], {
      input: JSON.stringify({ prompt: 'Normal question without slash command' }),
      encoding: 'utf8',
      env: { ...process.env, KONOHA_HOME: process.env.KONOHA_HOME }
    });
    assert.strictEqual(normalReminderRes.status, 0);
    assert.strictEqual(normalReminderRes.stdout.trim(), '', 'Normal prompt must NOT trigger workflow_reminder output');

    const konohaReminderRes = spawnSync(process.execPath, [reminderHookPath], {
      input: JSON.stringify({ prompt: '/konoha audit backend' }),
      encoding: 'utf8',
      env: { ...process.env, KONOHA_HOME: process.env.KONOHA_HOME }
    });
    assert.strictEqual(konohaReminderRes.status, 0);
    assert.ok(konohaReminderRes.stdout.toLowerCase().includes('konoha'), '/konoha prompt must receive Konoha reminder');

    const sanitizeHookPath = path.resolve(__dirname, '..', 'src', 'antigravity_tool_sanitize_hook.js');
    const normalToolRes = spawnSync(process.execPath, [sanitizeHookPath], {
      input: JSON.stringify({ tool_name: 'grep_search', tool_input: { query: 'foo' } }),
      encoding: 'utf8',
      env: { ...process.env, KONOHA_HOME: process.env.KONOHA_HOME }
    });
    assert.strictEqual(normalToolRes.status, 0);
    const normalToolOut = JSON.parse(normalToolRes.stdout.trim());
    assert.strictEqual(normalToolOut.decision, 'allow', 'Native grep_search must be allowed in normal non-Konoha sessions');

    const invokeSubagentRes = spawnSync(process.execPath, [sanitizeHookPath], {
      input: JSON.stringify({ tool_name: 'invoke_subagent', tool_input: { agent: 'anbu' } }),
      encoding: 'utf8',
      env: { ...process.env, KONOHA_HOME: process.env.KONOHA_HOME, KONOHA_MANAGED_CONTEXT: '1' }
    });
    assert.strictEqual(invokeSubagentRes.status, 0);
    const invokeSubagentOut = JSON.parse(invokeSubagentRes.stdout.trim());
    assert.strictEqual(invokeSubagentOut.decision, 'allow', 'invoke_subagent must be allowed inside Antigravity');

    const claudeBlockerCode = buildClaudeCodeBashGuardSource();
    assert.ok(claudeBlockerCode.includes('isKonohaManaged'), 'Claude bash guard hook must check isKonohaManaged');
    const piBlockerCode = buildPiBlockerExtensionSource();
    assert.ok(piBlockerCode.includes('isKonohaManagedSession'), 'Pi blocker extension must check isKonohaManagedSession');

    console.log('PASS: test_ownership_and_hook_scoping.js');
  } finally {
    if (prevKonohaHome === undefined) delete process.env.KONOHA_HOME;
    else process.env.KONOHA_HOME = prevKonohaHome;
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

runTests();
